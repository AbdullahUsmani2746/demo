// lib/voucher/saveGuard.js
// ============================================================
// Stops one document being saved twice.
//
// Seen in live data (Oct 2026): the same dispatch saved two or three times,
// 0.1–14 s apart — a double-click while the form was still validating, or a
// Save pressed again after a slow / dropped connection — and two users
// dispatching the same Sale Order 12 ms apart. Three layers, each covering
// what the one before can miss:
//
//   1. Request id — the form sends one id per document it is saving. A
//      repeat of that id (retry after a timeout, double-click) gets the FIRST
//      save's answer back instead of creating a second document.
//   2. One save at a time per Sale Order (or per party when there is none),
//      so two users / two tabs cannot post against the same order at once.
//   3. Recent-duplicate check — inside that lock, a document of the same type,
//      party, order, date and the same lines saved in the last 2 minutes is
//      refused with its number. Covers a server restart losing layer 1.
//
// Layers 1–2 are in-process: this app runs as one Next.js server. Layer 3 is
// in the database, so it holds regardless.
// ============================================================
import prisma from "@/lib/prisma";

const DUPLICATE_WINDOW_SECONDS = 120;
const REQUEST_TTL_MS = 10 * 60 * 1000;

// ── Layer 1: request id → the first save's result ─────────────
// Keyed by user + id: a client-chosen id must never hand one user another
// user's save result.
const requests = new Map(); // "<userId>:<clientRequestId>" → { promise, at }

function sweepRequests() {
  const cutoff = Date.now() - REQUEST_TTL_MS;
  for (const [id, entry] of requests) if (entry.at < cutoff) requests.delete(id);
}

// ── Layer 2: per-key mutex ───────────────────────────────────
const tails = new Map(); // key → promise of the last queued run

async function withKeyLock(key, fn) {
  const previous = tails.get(key) || Promise.resolve();
  let release;
  const current = new Promise((resolve) => (release = resolve));
  const tail = previous.then(() => current);
  tails.set(key, tail);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (tails.get(key) === tail) tails.delete(key);
  }
}

// ── Layer 3: same document saved moments ago? ────────────────
const num = (v) => {
  const n = Number(v?.value ?? v);
  return Number.isFinite(n) ? n : null;
};
const round = (v) => Math.round((Number(v) || 0) * 100) / 100;

/** What makes two saves "the same document": items + quantities, or accounts + amounts. */
function incomingLines(lines) {
  return (Array.isArray(lines) ? lines : [])
    .map((l) => ({
      itcd: num(l?.itcd),
      qty: round(l?.qty),
      acno: num(l?.acno),
      amt: round(Number(l?.damt) || Number(l?.camt) || 0),
    }))
    .filter((l) => l.itcd != null || l.acno != null);
}

function sameLines(incoming, stored) {
  const items = incoming.filter((l) => l.itcd != null);
  if (items.length) {
    const pool = stored.filter((s) => s.itcd != null);
    if (pool.length !== items.length) return false;
    return items.every((l) => {
      // Litre items are stored converted, so either column may hold the
      // quantity the form sent.
      const i = pool.findIndex(
        (s) => s.itcd === l.itcd && (round(s.qty) === l.qty || round(s.qty_ltr) === l.qty),
      );
      if (i < 0) return false;
      pool.splice(i, 1);
      return true;
    });
  }
  const accounts = incoming.filter((l) => l.acno != null && l.amt);
  if (!accounts.length) return false;
  const pool = stored.filter((s) => s.acno != null);
  return accounts.every((l) => {
    const i = pool.findIndex(
      (s) => s.acno === l.acno && (round(s.damt) === l.amt || round(s.camt) === l.amt),
    );
    if (i < 0) return false;
    pool.splice(i, 1);
    return true;
  });
}

async function findRecentDuplicate({ tranCode, master, lines }) {
  const incoming = incomingLines(lines);
  if (!incoming.length) return null;
  const pycd = num(master?.pycd);
  const soNo = num(master?.so_no);
  const dated = master?.dated ? new Date(master.dated) : null;
  if (!dated || Number.isNaN(dated.getTime())) return null;
  const day = dated.toISOString().slice(0, 10);

  const candidates = await prisma.$queryRaw`
    SELECT tm.tran_id, tm.vr_no, tm.dispatch_no, tm.grn_no,
           EXTRACT(EPOCH FROM (now() - tm.created_at))::int AS seconds_ago
    FROM "TRANSACTIONS_MASTER" tm
    WHERE tm.tran_code = ${tranCode}
      AND tm.pycd IS NOT DISTINCT FROM ${pycd}::int
      AND tm.so_no IS NOT DISTINCT FROM ${soNo}::int
      AND tm.dated::date = ${day}::date
      AND tm.created_at >= now() - make_interval(secs => ${DUPLICATE_WINDOW_SECONDS})
    ORDER BY tm.created_at DESC
    LIMIT 10
  `;
  if (!candidates.length) return null;

  const stored = await prisma.transactions.findMany({
    where: {
      tran_id: { in: candidates.map((c) => c.tran_id) },
      OR: [{ sub_tran_id: null }, { sub_tran_id: { not: 3 } }],
    },
    select: { tran_id: true, itcd: true, qty: true, qty_ltr: true, acno: true, damt: true, camt: true },
  });
  for (const c of candidates) {
    const mine = stored.filter((s) => s.tran_id === c.tran_id);
    if (sameLines(incoming, mine)) return c;
  }
  return null;
}

function duplicateResponse(dup, label) {
  const no = dup.dispatch_no ?? dup.grn_no ?? dup.vr_no ?? dup.tran_id;
  return Response.json(
    {
      message:
        `This ${label} was already saved as #${no} ${Number(dup.seconds_ago) || 0} seconds ago — ` +
        `it has NOT been saved again. Check #${no} before entering it once more.`,
      duplicateOf: Number(dup.tran_id),
    },
    { status: 409 },
  );
}

/**
 * Runs `save()` (which returns a Response) under all three layers.
 * `body` is the parsed request body; `label` names the document in messages;
 * `userId` the person saving (scopes the request id).
 */
export async function guardedSave({ body, tranCode, label = "document", userId = null, save }) {
  const master = body?.master || {};
  const requestId =
    typeof body?.clientRequestId === "string" ? `${userId ?? "anon"}:${body.clientRequestId}` : null;

  if (requestId) {
    sweepRequests();
    const seen = requests.get(requestId);
    if (seen) {
      const first = await seen.promise;
      return Response.json(first.json, { status: first.status });
    }
  }

  const run = async () => {
    const soNo = num(master.so_no);
    const key = soNo ? `so:${soNo}` : `${tranCode}:${num(master.pycd) ?? "-"}`;
    const res = await withKeyLock(key, async () => {
      const dup = await findRecentDuplicate({ tranCode, master, lines: body?.lines });
      if (dup) return duplicateResponse(dup, label);
      return save();
    });
    let json = null;
    try {
      json = await res.clone().json();
    } catch {
      json = null;
    }
    return { res, json, status: res.status };
  };

  if (!requestId) return (await run()).res;

  const promise = run();
  requests.set(requestId, { promise, at: Date.now() });
  try {
    const out = await promise;
    // Only a save that went through is replayed; a failed one may be retried.
    if (out.status >= 400) requests.delete(requestId);
    return out.res;
  } catch (error) {
    requests.delete(requestId);
    throw error;
  }
}
