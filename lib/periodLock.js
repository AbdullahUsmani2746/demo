// lib/periodLock.js
// ============================================================
// The ONE place that decides whether a dated write is allowed.
//
// Locks (managed on /accounting/period-lock):
//   • Month lock  — CostingPeriod. Locking a month (POST /api/costing/lock-period)
//                   also generates next month's opening stock.
//   • Date range  — PeriodLock. Inclusive from/to, optionally limited to some
//                   document types (tran_codes; empty = all).
//
// Exceptions — PeriodLockException. Re-opens a locked span for ONE user,
// for chosen document types and actions (create / update / delete), until it
// expires or is revoked. Month locks are only overridden when the exception
// says so (override_month_lock), since editing a closed month leaves next
// month's opening stock stale until the month is locked again.
//
// The user is read from the audit context that guard()/setAuditActor sets
// for every request, so routes only state the action:
//
//   import { checkPeriodLock } from "@/lib/periodLock";
//
//   const lockError = await checkPeriodLock(master.dated, tran_code, { action: "create" });
//   if (lockError) return NextResponse.json({ message: lockError }, { status: 422 });
//
// On EDIT pass both dates — the stored one and the new one — otherwise a
// locked document can escape by having its date moved into an open period:
//
//   await checkPeriodLock([existing.dated, body.master.dated], tran_code, { action: "update" });
//
// Every block and every exception use is written to PeriodLockLog.
// ============================================================
import prisma from "@/lib/prisma";
import { getAuditActor } from "@/lib/audit/context";
import { LOCKABLE_CODES, documentLabel } from "@/lib/periodLockCatalog";

// tran_codes covered by period locks — see lib/periodLockCatalog.js.
export const PERIOD_LOCK_TRAN_CODES = new Set(LOCKABLE_CODES);

export const PERIOD_LOCK_ACTIONS = ["create", "update", "delete"];
const ACTION_FIELD = { create: "can_create", update: "can_update", delete: "can_delete" };

export const PERIOD_LOCK_STATUS = 422;

const ASK_FOR_ACCESS = " Ask an Admin or Accountant for an exception if you need to change it.";

/**
 * Calendar day of a document date, or null if there is no usable date.
 * A plain "YYYY-MM-DD" string is read literally so the server's timezone
 * can never shift the 1st of a month into the previous one.
 */
export function dayOf(dated) {
  if (!dated) return null;
  if (typeof dated === "string") {
    const m = dated.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  }
  const d = new Date(dated);
  if (Number.isNaN(d.getTime())) return null;
  return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
}

/** Month/year of a document date, or null. */
export function periodOf(dated) {
  const d = dayOf(dated);
  return d && { month: d.month, year: d.year };
}

/** "YYYY-MM-DD" for a @db.Date column value or a {year,month,day}. */
export function isoDay(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  const pad = (n) => String(n).padStart(2, "0");
  return `${value.year}-${pad(value.month)}-${pad(value.day)}`;
}

/** {year,month,day} → the UTC-midnight Date Prisma uses for a @db.Date column. */
export function dbDate({ year, month, day }) {
  return new Date(Date.UTC(year, month - 1, day));
}

export function periodLockMessage(month, year) {
  return `Period ${month}/${year} is locked. No new entries or changes are allowed.`;
}

export function rangeLockMessage(lock, tran_code) {
  const from = isoDay(lock.date_from);
  const to = isoDay(lock.date_to);
  const span = from === to ? `Date ${from} is` : `Dates ${from} to ${to} are`;
  const scope = lock.tran_codes?.length && tran_code != null ? ` for ${documentLabel(tran_code)}` : "";
  const why = lock.reason ? ` (${lock.reason})` : "";
  return `${span} locked${scope}${why}. No new entries or changes are allowed.`;
}

// Matches a row whose tran_codes list is empty (= every type) or contains code.
const coversCode = (code) =>
  code == null ? {} : { OR: [{ tran_codes: { isEmpty: true } }, { tran_codes: { has: Number(code) } }] };

/** True if the given month/year is month-locked. Pass `db` to read inside a transaction. */
export async function isPeriodLocked(month, year, db = prisma) {
  const lock = await db.costingPeriod.findUnique({
    where: { month_year: { month: Number(month), year: Number(year) } },
    select: { is_locked: true },
  });
  return lock?.is_locked === true;
}

/**
 * The active date-range lock covering a {year,month,day} — for tran_code if
 * given (respecting each lock's document scope), else any lock — or null.
 */
export async function findRangeLock(day, db = prisma, tran_code = null) {
  const d = dbDate(day);
  return db.periodLock.findFirst({
    where: { is_active: true, date_from: { lte: d }, date_to: { gte: d }, ...coversCode(tran_code) },
    select: { id: true, date_from: true, date_to: true, reason: true, tran_codes: true },
    orderBy: { date_from: "asc" },
  });
}

/** The user's live exception covering this day / document / action, or null. */
export async function findException({ userId, day, tran_code, action, monthLocked }, db = prisma) {
  if (!userId || !ACTION_FIELD[action]) return null;
  const d = dbDate(day);
  return db.periodLockException.findFirst({
    where: {
      user_id: String(userId),
      is_active: true,
      date_from: { lte: d },
      date_to: { gte: d },
      [ACTION_FIELD[action]]: true,
      ...(monthLocked ? { override_month_lock: true } : {}),
      AND: [
        coversCode(tran_code),
        { OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }] },
      ],
    },
    select: { id: true },
    orderBy: { granted_at: "desc" },
  });
}

/** Append to PeriodLockLog. Never throws — logging must not break a write. */
export async function logPeriodLockEvent(event, fields = {}) {
  try {
    const actor = getAuditActor();
    await prisma.periodLockLog.create({
      data: {
        event,
        actor_id: fields.actor_id ?? actor.userId ?? null,
        actor_name: (fields.actor_name ?? actor.userName ?? null)?.slice(0, 100) ?? null,
        lock_id: fields.lock_id ?? null,
        exception_id: fields.exception_id ?? null,
        tran_code: fields.tran_code != null ? Number(fields.tran_code) : null,
        action: fields.action ?? null,
        doc_date: fields.doc_date ? dbDate(fields.doc_date) : null,
        detail: fields.detail ? String(fields.detail).slice(0, 500) : null,
      },
    });
  } catch (err) {
    console.error("PeriodLockLog write failed:", err);
  }
}

/**
 * Error message if any of the dates is locked for this tran_code and action,
 * and the current user holds no exception for it; null if the write may go.
 *
 * @param {Date|string|Array<Date|string>} dates one date, or several for an edit
 * @param {number|string} tran_code
 * @param {{ action?: "create"|"update"|"delete", db?: object, force?: boolean, userId?: string }} [opts]
 *        action: what the route is doing — exceptions are granted per action.
 *                Omitted → no exception can apply (strictest).
 *        userId: override the user read from the audit context.
 *        force:  check even if tran_code is not a lockable document type.
 */
export async function checkPeriodLock(dates, tran_code, { action, db = prisma, force = false, userId } = {}) {
  if (!force && !PERIOD_LOCK_TRAN_CODES.has(Number(tran_code))) return null;

  const uid = userId ?? getAuditActor().userId;

  // De-duplicate so an edit within the same month/day costs one query each.
  const days = new Map();
  for (const dated of [].concat(dates)) {
    const d = dayOf(dated);
    if (d) days.set(isoDay(d), d);
  }

  const monthLocked = new Map();
  const exceptionsUsed = new Map(); // exception id → day, for the usage log

  for (const d of days.values()) {
    const monthKey = `${d.year}-${d.month}`;
    if (!monthLocked.has(monthKey)) {
      monthLocked.set(monthKey, await isPeriodLocked(d.month, d.year, db));
    }
    const isMonthLocked = monthLocked.get(monthKey);
    const range = isMonthLocked ? null : await findRangeLock(d, db, tran_code);
    if (!isMonthLocked && !range) continue;

    const exception = await findException(
      { userId: uid, day: d, tran_code, action, monthLocked: isMonthLocked },
      db,
    );
    if (exception) {
      if (!exceptionsUsed.has(exception.id)) exceptionsUsed.set(exception.id, d);
      continue;
    }

    const message = isMonthLocked
      ? periodLockMessage(d.month, d.year)
      : rangeLockMessage(range, tran_code);
    await logPeriodLockEvent("BLOCKED", {
      lock_id: range?.id,
      tran_code,
      action,
      doc_date: d,
      detail: message,
    });
    return message + ASK_FOR_ACCESS;
  }

  for (const [exception_id, d] of exceptionsUsed) {
    await logPeriodLockEvent("EXCEPTION_USED", {
      exception_id,
      tran_code,
      action,
      doc_date: d,
      detail: `${documentLabel(tran_code)} ${action || "write"} dated ${isoDay(d)}`,
    });
    try {
      await prisma.periodLockException.update({
        where: { id: exception_id },
        data: { use_count: { increment: 1 }, last_used_at: new Date() },
      });
    } catch (err) {
      console.error("PeriodLockException usage update failed:", err);
    }
  }
  return null;
}
