import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getCustomerMacnos } from "@/lib/accounts/partyMacnos";
import { guard } from "@/lib/auth/route";
import { scopedSalesPersons, scopedCustomerAcnos } from "@/lib/auth/salesScope";
import { syncTargetRecovery } from "@/lib/salesTargets/autoTarget";
import { can } from "@/lib/auth/permissions";
import { monthHasEnded } from "@/lib/salesTargets/monthKey";

const toDated = (year, month) => new Date(Number(year), Number(month) - 1, 1);

// GET ?acno=&year=&month=            -> single CustomerMonthlyTarget record (or null if none yet)
// GET ?year=&month=[&search=]        -> ALL customers for that period,
//                                        each with its target merged in (nulls if none yet)
//                                        + meta { canRunMonthEnd, lockedAt }
// Target Recovery is set by the system (lib/salesTargets/autoTarget.js) —
// brought up to date here for the customers listed, unless the month is locked.
export const GET = guard(null, async (request, { session }) => {
  const { searchParams } = new URL(request.url);
  const acnoParam = searchParams.get("acno");
  const year = Number(searchParams.get("year"));
  const month = Number(searchParams.get("month"));

  if (!year || !month) {
    return NextResponse.json({ error: "year and month are required" }, { status: 400 });
  }
  const dated = toDated(year, month);

  if (acnoParam) {
    const acno = Number(acnoParam);
    const record = await prisma.customerMonthlyTarget.findUnique({
      where: { acno_dated: { acno, dated } },
    });
    return NextResponse.json({ data: record });
  }

  // Bulk mode: every customer, with its target for this period merged in
  const search = searchParams.get("search") || "";
  const salesPerson = searchParams.get("salesPerson") || "";

  // Same rule as the Sales Team MIS: a sales person may enter targets only
  // for their own customers. Supervisors holding salesTeam.viewAll (and
  // ADMIN/ACCOUNTANT) see the whole team. The salesPerson query parameter can
  // narrow that set but never widen it, so editing the URL cannot reach
  // somebody else's accounts.
  // lib/auth/salesScope.js: all / own + team (Permissions → Sales visibility) / own.
  const persons = await scopedSalesPersons(session, salesPerson || null);
  const salesAreaFilter = persons === null ? {} : { salesArea: { in: persons } };

  const customers = await prisma.aCNO.findMany({
    where: {
      macno: { in: await getCustomerMacnos() },
      ...(search ? { acname: { contains: search, mode: "insensitive" } } : {}),
      ...salesAreaFilter,
    },
    select: { acno: true, acname: true, salesArea: true, customerStatus: true, isActive: true },
    orderBy: { acname: "asc" },
  });

  // Target Recovery = the customer's minimum, written before reading below.
  const { minByAcno } = await syncTargetRecovery({ year, month, customers });

  const acnoList = customers.map((c) => c.acno);
  const targets = acnoList.length
    ? await prisma.customerMonthlyTarget.findMany({
        where: { acno: { in: acnoList }, dated },
      })
    : [];
  const targetByAcno = new Map(targets.map((t) => [t.acno, t]));

  // A month still running has no lock of its own yet: show the previous
  // month's closing (its Locked Recovery / OverDue) so the month just locked
  // on the 1st is visible on the month being worked on.
  const running = !monthHasEnded(year, month);
  const prev = month === 1 ? { year: year - 1, month: 12 } : { year, month: month - 1 };
  const prevDated = toDated(prev.year, prev.month);
  const prevTargets = running && acnoList.length
    ? await prisma.customerMonthlyTarget.findMany({
        where: { acno: { in: acnoList }, dated: prevDated, lockedAt: { not: null } },
        select: { acno: true, lockedTargetRecovery: true, lockedOverdue: true, lockedAt: true },
      })
    : [];
  const prevByAcno = new Map(prevTargets.map((t) => [t.acno, t]));

  const salesPersonIds = [...new Set(customers.map((c) => c.salesArea).filter(Boolean))];
  const users = salesPersonIds.length
    ? await prisma.user.findMany({ where: { id: { in: salesPersonIds } }, select: { id: true, name: true } })
    : [];
  const nameById = new Map(users.map((u) => [u.id, u.name]));

  const data = customers.map((c) => {
    const t = targetByAcno.get(c.acno);
    return {
      acno: c.acno,
      acname: c.acname,
      salesPersonName: (c.salesArea && nameById.get(c.salesArea)) || "",
      targetQty: t?.targetQty ?? null,
      targetRecovery: t?.targetRecovery ?? null,
      lockedTargetRecovery: t?.lockedAt ? t.lockedTargetRecovery : null,
      // Frozen by the same month-end run: what the customer still owed past
      // their credit terms on the last day of the month. Cash in beside debt
      // out, so the two can be read together.
      lockedOverdue: t?.lockedAt ? t.lockedOverdue : null,
      lockedAt: t?.lockedAt ?? null,
      // Previous month's closing, while this month is still running
      prevLockedTargetRecovery: prevByAcno.get(c.acno)?.lockedTargetRecovery ?? null,
      prevLockedOverdue: prevByAcno.get(c.acno)?.lockedOverdue ?? null,
      // Minimum Target Recovery — see lib/salesTargets/minRecovery.js
      category: minByAcno.get(c.acno)?.category ?? null,
      minRecoveryPct: minByAcno.get(c.acno)?.minPct ?? null,
      overdueBase: minByAcno.get(c.acno)?.overdue ?? 0,
      minRecovery: minByAcno.get(c.acno)?.minRecovery ?? 0,
    };
  });

  // When the month was locked (any customer), and whether this person may
  // run / re-run month-end (salesTarget.monthEnd — Permissions → Approvals).
  const [lockedAgg, prevLockedAgg, canRunMonthEnd] = await Promise.all([
    prisma.customerMonthlyTarget.aggregate({ where: { dated, lockedAt: { not: null } }, _max: { lockedAt: true } }),
    running
      ? prisma.customerMonthlyTarget.aggregate({ where: { dated: prevDated, lockedAt: { not: null } }, _max: { lockedAt: true } })
      : null,
    can(session, "salesTarget.monthEnd"),
  ]);

  return NextResponse.json({
    data,
    meta: {
      canRunMonthEnd,
      lockedAt: lockedAgg._max.lockedAt ?? null,
      running,
      // The month whose closing is shown while this one runs
      prev: running ? { ...prev, lockedAt: prevLockedAgg?._max.lockedAt ?? null } : null,
    },
  });
});

// PUT { acno, year, month, targetQty }  — Target Recovery is not written here:
// the system sets it (lib/salesTargets/autoTarget.js).
/**
 * The set of accounts this caller may write a target against, or null when
 * they may write against any. Reading is scoped in GET; without the same test
 * here a sales person could still POST a target onto somebody else's
 * customer, since account.manage is held by every role.
 */
async function writableAcnos(session) {
  const acnos = await scopedCustomerAcnos(session);
  return acnos === null ? null : new Set(acnos);
}

// Only the user-editable fields can be written here, and only the ones present
// in the body — omit a field to leave it untouched, send "" to clear it.
// lockedTargetRecovery is a locked, system-calculated field — only ever
// written by utils/monthlySalesTeamSnapshot.js.
export const PUT = guard("account.manage", async (request, { session }) => {
  const body = await request.json();
  const allowed = await writableAcnos(session);
  if (allowed && !allowed.has(Number(body.acno))) {
    return NextResponse.json(
      { error: "That customer is not assigned to you." },
      { status: 403 },
    );
  }
  const saved = await saveOne(body);
  if (saved.error) return NextResponse.json({ error: saved.error }, { status: 400 });
  return NextResponse.json({ data: saved.data });
});

// POST { year, month, rows: [{ acno, targetQty?, targetRecovery? }, ...] }
// Bulk save for the "All Customers" grid - same rules/fields as PUT, one row per
// customer. Each row carries only the fields that were edited, so a save that
// touches just the qty leaves that customer's recovery alone.
export const POST = guard("account.manage", async (request, { session }) => {
  const body = await request.json();
  const { year, month, rows } = body;
  const allowed = await writableAcnos(session);

  if (!year || !month || !Array.isArray(rows) || rows.length === 0) {
    return NextResponse.json(
      { error: "year, month and a non-empty rows array are required" },
      { status: 400 }
    );
  }

  const results = [];
  let refused = 0;
  for (const row of rows) {
    if (allowed && !allowed.has(Number(row.acno))) {
      refused += 1;
      continue;
    }
    const saved = await saveOne({ ...row, year, month });
    if (!saved.error) results.push(saved.data);
  }

  return NextResponse.json({
    data: results,
    saved: results.length,
    requested: rows.length,
    ...(refused ? { refused } : {}),
  });
});

async function saveOne(body) {
  const acno = Number(body.acno);
  const year = Number(body.year);
  const month = Number(body.month);

  if (!acno || !year || !month) {
    return { error: "acno, year and month are required" };
  }
  const dated = toDated(year, month);

  const toNumberOrNull = (v) => (v !== undefined && v !== null && v !== "" ? Number(v) : null);

  /* PARTIAL UPDATE — only the fields actually sent are written.

     Targets are rarely filled in one sitting: the qty goes in today and the
     recovery a day or two later. Writing both fields every time meant the
     second save posted an absent targetQty and blanked the number typed
     earlier. A field that is missing from the request is left exactly as it
     is in the database; sending it as "" (or null) is still how you clear it. */
  const has = (key) =>
    Object.prototype.hasOwnProperty.call(body, key) && body[key] !== undefined;

  // Target Recovery is never taken from the request — the system sets it.
  const data = {};
  if (has("targetQty")) data.targetQty = toNumberOrNull(body.targetQty);

  if (Object.keys(data).length === 0) {
    return { error: "nothing to save — send targetQty (Target Recovery is set by the system)" };
  }

  const saved = await prisma.customerMonthlyTarget.upsert({
    where: { acno_dated: { acno, dated } },
    update: data,
    create: { acno, dated, ...data },
  });

  return { data: saved };
}
