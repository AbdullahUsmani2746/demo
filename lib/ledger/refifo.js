// lib/ledger/refifo.js
// ============================================================
// Fix FIFO order — redo the automatic knock-off for parties whose receipts /
// payments were matched OUT of first-in-first-out order.
// ------------------------------------------------------------
// The FIFO run only sees invoices that exist (and carry a number) when it
// runs. An invoice entered late, numbered later, or unlocked and re-invoiced
// leaves older bills open while newer ones were paid; numbering it afterwards
// moves nothing, so aging shows old invoices open although the balance is
// right.
//
// A party is affected when an invoice of theirs is still open (the same
// figure Knock-Off Review uses — lib/ledger/outstandingInvoices.js) while a
// NEWER invoice received an automatic allocation. applyRefifo, for those
// parties:
//   1. backs up their INVOICE_KNOCKOFF rows and the debit / credit totals of
//      every voucher those rows come from (Settings key
//      "knockoffRefifo:<stamp>");
//   2. reverses their automatic allocations (run_id set, not manual) —
//      manual overrides and invoice numbers typed on a voucher stay;
//   3. folds each split line back (resyncLineSplit);
//   4. runs the normal FIFO engine for those parties only;
//   5. checks every voucher still has its backed-up debit / credit totals.
// Only allocations move: voucher totals, the ledger and the trial balance do
// not. Every write goes through the audited client (lib/prisma.js).
//
// resumeRefifo finishes an apply that stopped part-way; restoreRefifo puts
// the parties back exactly as backed up. Driven by Knock-Off Review →
// "Fix FIFO order" (/api/invoice-knockoff/refifo, permission knockoff.refifo).
// ============================================================
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { runAsSystem } from "@/lib/audit/context";
import { getCustomerMacnos, getVendorMacnos } from "@/lib/accounts/partyMacnos";
import { getCustomerOutstanding, getVendorOutstanding } from "./outstandingInvoices";
import { resyncLineSplit, runInvoiceKnockoffMatching, round2 } from "./invoiceMatcher";

const BACKUP_PREFIX = "knockoffRefifo:";
const STAMP_RE = /^\d{8}_\d{6}$/;
const STALE_RUN_MS = 30 * 60 * 1000;
const TX_OPTIONS = { maxWait: 30_000, timeout: 10 * 60_000 };

const backupKey = (stamp) => {
  if (!STAMP_RE.test(String(stamp))) throw new Error(`Bad backup stamp "${stamp}"`);
  return `${BACKUP_PREFIX}${stamp}`;
};

function stampNow(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}_${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// ------------------------------------------------------------
// Which parties are out of FIFO order
// ------------------------------------------------------------
// side: "customer" | "vendor" | "all"
export async function findRefifoParties({ party = "all", acnos = null } = {}) {
  const [customers, vendors] = await Promise.all([getCustomerMacnos(), getVendorMacnos()]);
  const macnos = party === "customer" ? customers : party === "vendor" ? vendors : [...customers, ...vendors];
  if (!macnos.length) return [];

  // Money an automatic run put on an invoice. A negative allocation is a
  // debit note pushing an invoice back up — FIFO puts that on the oldest open
  // invoice by design, so it is not out of order.
  const paid = await prisma.$queryRaw`
    SELECT k.invoice_party_acno AS acno, a.acname, a.macno,
           MAX(i.dated) AS newest_paid,
           COUNT(DISTINCT k.source_line_id)::int AS lines,
           SUM(k.allocated_amount)::float8 AS amt
    FROM "INVOICE_KNOCKOFF" k
    JOIN "TRANSACTIONS_MASTER" i ON i.tran_id = k.invoice_tran_id
    JOIN "acno" a ON a.acno = k.invoice_party_acno
    WHERE k.reversed_at IS NULL AND k.run_id IS NOT NULL AND k.is_manual = false
      AND k.allocated_amount > 0
      AND a.macno IN (${Prisma.join(macnos)})
      ${acnos?.length ? Prisma.sql`AND k.invoice_party_acno = ANY(${acnos.map(Number)}::int[])` : Prisma.empty}
    GROUP BY k.invoice_party_acno, a.acname, a.macno
  `;

  const out = [];
  for (const r of paid) {
    const acno = Number(r.acno);
    const isCustomer = customers.includes(Number(r.macno));
    const open = (isCustomer ? await getCustomerOutstanding(acno) : await getVendorOutstanding(acno)).filter(
      (inv) => Number(inv.outstanding) > 1,
    );
    if (!open.length) continue;
    const oldestOpen = open.reduce((m, inv) => (new Date(inv.dated) < m ? new Date(inv.dated) : m), new Date(open[0].dated));
    const newestPaid = new Date(r.newest_paid);
    if (!(newestPaid > oldestOpen)) continue;
    out.push({
      acno,
      acname: r.acname,
      side: isCustomer ? "customer" : "vendor",
      oldestOpen,
      newestPaid,
      openAmount: round2(open.reduce((s, inv) => s + Number(inv.outstanding), 0)),
      fifoAmount: round2(r.amt),
      lines: Number(r.lines) || 0,
    });
  }
  return out.sort((a, b) => b.openAmount - a.openAmount);
}

// ------------------------------------------------------------
// Backup
// ------------------------------------------------------------
const lineRoots = async (lineIds) => {
  if (!lineIds.length) return new Map();
  const rows = await prisma.transactions.findMany({
    where: { id: { in: lineIds } },
    select: { id: true, split_from_line_id: true },
  });
  return new Map(rows.map((r) => [r.id, r.split_from_line_id ?? r.id]));
};

async function voucherTotals(tranIds) {
  if (!tranIds.length) return [];
  const rows = await prisma.transactions.groupBy({
    by: ["tran_id"],
    where: { tran_id: { in: tranIds } },
    _sum: { damt: true, camt: true },
  });
  return rows.map((r) => ({ tran_id: r.tran_id, d: round2(r._sum.damt), c: round2(r._sum.camt) }));
}

async function readBackup(stamp) {
  const row = await prisma.settings.findUnique({ where: { key: backupKey(stamp) }, select: { value: true } });
  if (!row) throw new Error(`Backup ${stamp} not found`);
  return JSON.parse(row.value);
}

async function takeBackup(stamp, parties, by) {
  const knockoffs = await prisma.invoiceKnockoff.findMany({ where: { invoice_party_acno: { in: parties } } });
  const roots = await lineRoots([...new Set(knockoffs.map((k) => k.source_line_id))]);
  const tranIds = [...new Set(knockoffs.map((k) => k.source_tran_id))];
  const value = {
    stamp,
    by,
    parties,
    knockoffs: knockoffs.map((k) => ({ ...k, root_line_id: roots.get(k.source_line_id) ?? k.source_line_id })),
    totals: await voucherTotals(tranIds),
  };
  await prisma.settings.create({
    data: {
      key: backupKey(stamp),
      value: JSON.stringify(value),
      description: `Fix FIFO order backup — ${parties.length} part${parties.length === 1 ? "y" : "ies"}${by ? ` — by ${by}` : ""}`.slice(0, 190),
    },
  });
  return value;
}

// Vouchers whose debit / credit totals differ from the backup (or that no
// longer exist).
async function changedVouchers(backup) {
  const now = new Map((await voucherTotals(backup.totals.map((t) => t.tran_id))).map((t) => [t.tran_id, t]));
  return backup.totals
    .filter((b) => {
      const c = now.get(b.tran_id);
      return !c || Math.abs(c.d - b.d) > 0.01 || Math.abs(c.c - b.c) > 0.01;
    })
    .map((b) => b.tran_id);
}

async function assertCanRun() {
  const running = await prisma.invoiceKnockoffRun.findFirst({
    where: { status: "RUNNING", started_at: { gte: new Date(Date.now() - STALE_RUN_MS) } },
    select: { id: true },
  });
  if (running) throw new Error(`Knock-off run #${running.id} is in progress — wait for it to finish.`);
}

const resyncAll = async (rootIds, log, verb) => {
  let done = 0;
  for (const id of rootIds) {
    await prisma.$transaction((tx) => resyncLineSplit(tx, id), TX_OPTIONS);
    done += 1;
    if (done % 200 === 0 || done === rootIds.length) log(`${verb} ${done} of ${rootIds.length} lines.`);
  }
};

// Steps 3–5, shared by apply and resume.
async function finish(backup, log, userId) {
  // Fold / re-split every line the parties' allocations come from, so each
  // posted row mirrors what is active now (idempotent).
  const active = await prisma.invoiceKnockoff.findMany({
    where: { invoice_party_acno: { in: backup.parties } },
    select: { source_line_id: true },
    distinct: ["source_line_id"],
  });
  const roots = [...new Set([...(await lineRoots(active.map((a) => a.source_line_id))).values()])];
  await resyncAll(roots, log, "Folded");

  log("Re-running FIFO, oldest invoice first …");
  const run = await runInvoiceKnockoffMatching({ trigger: "MANUAL", userId, acnos: backup.parties });
  const runRow = await prisma.invoiceKnockoffRun.findUnique({ where: { id: run.runId }, select: { status: true, error_message: true } });
  if (runRow?.status !== "COMPLETED") throw new Error(`FIFO run #${run.runId} did not complete: ${runRow?.error_message || "unknown error"}`);
  log(`FIFO run #${run.runId}: ${run.linesMatched} of ${run.linesScanned} lines matched.`);

  const changed = await changedVouchers(backup);
  if (changed.length) {
    throw new Error(
      `${changed.length} vouchers no longer match their backed-up totals (e.g. tran_id ${changed.slice(0, 5).join(", ")}). Undo this fix (${backup.stamp}).`,
    );
  }
  log("Check passed: every voucher keeps the same debit / credit totals.");
  return run;
}

export async function applyRefifo({ party = "all", userId = null, by = null, log = () => {} } = {}) {
  await assertCanRun();
  const parties = await findRefifoParties({ party });
  const ids = parties.map((r) => r.acno);
  if (!ids.length) {
    log("No party has knock-offs out of FIFO order — nothing to do.");
    return { stamp: null, parties: 0 };
  }

  const stamp = stampNow();
  log(`Backing up ${ids.length} parties as ${stamp} …`);
  const backup = await takeBackup(stamp, ids, by);

  // Reverse the automatic allocations. Manual overrides and voucher-typed
  // invoice numbers (run_id NULL) stay.
  const where = { reversed_at: null, run_id: { not: null }, is_manual: false, invoice_party_acno: { in: ids } };
  const lines = await prisma.invoiceKnockoff.findMany({ where, select: { source_line_id: true }, distinct: ["source_line_id"] });
  const { count } = await prisma.invoiceKnockoff.updateMany({ where, data: { reversed_at: new Date(), reversed_by: userId } });
  log(`Reversed ${count} allocations on ${lines.length} lines.`);

  const run = await finish(backup, log, userId);
  return { stamp, parties: ids.length, ...run };
}

export async function resumeRefifo(stamp, { userId = null, log = () => {} } = {}) {
  await assertCanRun();
  const backup = await readBackup(stamp);
  log(`Resuming ${backup.parties.length} parties from ${stamp} …`);
  const run = await finish(backup, log, userId);
  return { stamp, parties: backup.parties.length, ...run };
}

// Only the backed-up parties are touched. Refused if any of their vouchers
// changed totals since (edited / deleted): the old allocations would no
// longer fit them.
export async function restoreRefifo(stamp, { log = () => {} } = {}) {
  await assertCanRun();
  const backup = await readBackup(stamp);
  log(`Restoring ${backup.parties.length} parties from ${stamp} …`);

  const changed = await changedVouchers(backup);
  if (changed.length) {
    throw new Error(
      `${changed.length} vouchers changed since the backup (e.g. tran_id ${changed.slice(0, 5).join(", ")}). Not restoring.`,
    );
  }

  const current = await prisma.invoiceKnockoff.findMany({
    where: { invoice_party_acno: { in: backup.parties } },
    select: { id: true, source_line_id: true },
  });
  const currentRoots = await lineRoots([...new Set(current.map((k) => k.source_line_id))]);
  const roots = [...new Set([...currentRoots.values(), ...backup.knockoffs.map((k) => k.root_line_id)])];
  const keep = new Set(backup.knockoffs.map((k) => k.id));
  const existing = new Set(current.map((k) => k.id));

  await prisma.$transaction(async (tx) => {
    // Park every current row on its line's root first (one row per line
    // group and invoice, so this cannot collide), then drop what the fix
    // added and put back each backed-up row as it was.
    for (const k of current) {
      const root = currentRoots.get(k.source_line_id) ?? k.source_line_id;
      if (root !== k.source_line_id) await tx.invoiceKnockoff.update({ where: { id: k.id }, data: { source_line_id: root } });
    }
    const extra = current.filter((k) => !keep.has(k.id)).map((k) => k.id);
    if (extra.length) await tx.invoiceKnockoff.deleteMany({ where: { id: { in: extra } } });
    for (const b of backup.knockoffs) {
      const { root_line_id, id, ...rest } = b;
      const data = {
        ...rest,
        source_line_id: root_line_id,
        allocated_amount: Number(rest.allocated_amount),
        reversed_at: rest.reversed_at ? new Date(rest.reversed_at) : null,
        created_at: new Date(rest.created_at),
      };
      if (existing.has(id)) await tx.invoiceKnockoff.update({ where: { id }, data });
      else await tx.invoiceKnockoff.create({ data: { id, ...data } });
    }
  }, TX_OPTIONS);

  await resyncAll(roots, log, "Rebuilt");
  const after = await changedVouchers(backup);
  if (after.length) throw new Error(`${after.length} vouchers do not match their backed-up totals after the restore (e.g. tran_id ${after.slice(0, 5).join(", ")}).`);
  log("Restored — these parties are back as they were before the fix.");
  return { stamp, parties: backup.parties.length };
}

/** Backups taken by applyRefifo, newest first. */
export async function listRefifoBackups() {
  const rows = await prisma.settings.findMany({
    where: { key: { startsWith: BACKUP_PREFIX } },
    select: { key: true, value: true, created_at: true },
    orderBy: { key: "desc" },
  });
  return rows.map((r) => {
    let parties = 0;
    let by = null;
    try {
      const v = JSON.parse(r.value);
      parties = v.parties?.length ?? 0;
      by = v.by ?? null;
    } catch {
      /* unreadable backup: listed without counts */
    }
    return { stamp: r.key.slice(BACKUP_PREFIX.length), parties, by, at: r.created_at };
  });
}

// ------------------------------------------------------------
// One background job at a time (the page starts it, then polls)
// ------------------------------------------------------------
// Many parties outlast an HTTP request, so the route starts the work here
// and returns; the page polls getRefifoJob(). Held on globalThis so dev
// hot-reloads keep the same job. Lost on a server restart — the backup is
// not, so a stopped apply is finished with Resume. The work runs as a named
// system job (audited under that name, sees every book).
const JOB_KEY = "__knockoffRefifoJob";

export function getRefifoJob() {
  return globalThis[JOB_KEY] ?? null;
}

export function startRefifoJob(kind, by, work) {
  const current = getRefifoJob();
  if (current?.status === "running") throw new Error(`A ${current.kind} is already running — wait for it to finish.`);
  const job = { kind, by, status: "running", startedAt: new Date().toISOString(), finishedAt: null, log: [], result: null, error: null };
  globalThis[JOB_KEY] = job;
  const log = (message) => {
    job.log.push({ at: new Date().toISOString(), message });
    console.log(`[refifo] ${message}`);
  };
  runAsSystem(`Fix FIFO order${by ? ` (${by})` : ""}`, () => work(log))
    .then((result) => {
      job.result = result;
      job.status = "completed";
    })
    .catch((error) => {
      job.error = String(error?.message || error);
      job.status = "failed";
      log(`Stopped: ${job.error}`);
    })
    .finally(() => {
      job.finishedAt = new Date().toISOString();
    });
  return job;
}
