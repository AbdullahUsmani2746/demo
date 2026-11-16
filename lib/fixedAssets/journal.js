// lib/fixedAssets/journal.js — the system journals fixed assets post
// (CLAUDE.md rules 1, 2): a Journal voucher (tran_code 3) whose rmk4 is a
// marker of lib/vouchers/systemVouchers.js (FA_*) and rmk5 the record id —
// read-only for every screen, script and the database trigger. A correction
// is the mirror journal (postMirror), never an edit.
import { FaError } from "@/lib/fixedAssets/errors";
import { r2 } from "@/lib/fixedAssets/calc";

export const FA_LOCK_KEY = 914140020; // serialises fixed-asset postings

const dbDay = (day) => {
  const [y, m, d] = String(day).slice(0, 10).split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d));
};

async function assertAccountsOpen(tx, acnos) {
  const list = [...new Set(acnos.filter((a) => a != null))];
  const rows = await tx.aCNO.findMany({ where: { acno: { in: list } }, select: { acno: true, acname: true, lock: true } });
  const found = new Map(rows.map((r) => [r.acno, r]));
  for (const a of list) {
    if (!found.has(a)) throw new FaError(`Account ${a} does not exist.`, 422);
    if (found.get(a).lock) throw new FaError(`Account ${a} (${found.get(a).acname}) is locked — contact Finance.`, 422);
  }
}

/** Lines with the same account, side and narration merged; zero lines dropped. */
function tidy(lines) {
  const map = new Map();
  for (const l of lines) {
    const d = r2(l.damt);
    const c = r2(l.camt);
    if (!d && !c) continue;
    const k = `${l.acno}|${d ? "D" : "C"}|${l.narration ?? ""}|${l.ccno ?? ""}`;
    const cur = map.get(k) ?? { acno: l.acno, ccno: l.ccno ?? null, damt: 0, camt: 0, narration: l.narration ?? "" };
    cur.damt = r2(cur.damt + d);
    cur.camt = r2(cur.camt + c);
    map.set(k, cur);
  }
  return [...map.values()];
}

/**
 * Post a balanced journal inside `tx`. lines: [{ acno, damt, camt, narration, ccno? }]
 * @returns {{ tran_id, vr_no }} or null when there is nothing to post.
 */
export async function postJournal(tx, { date, marker, ref, remarks, lines, actor = null, pycd = null }) {
  const rows = tidy(lines);
  if (!rows.length) return null;
  const dr = r2(rows.reduce((s, l) => s + l.damt, 0));
  const cr = r2(rows.reduce((s, l) => s + l.camt, 0));
  if (Math.abs(dr - cr) > 0.01) throw new Error(`Fixed-asset journal does not balance (Dr ${dr} / Cr ${cr}).`);
  await assertAccountsOpen(tx, rows.map((l) => l.acno));
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(${FA_LOCK_KEY})`;
  const last = await tx.transactionsMaster.findFirst({ where: { tran_code: 3, vr_no: { not: null } }, orderBy: { vr_no: "desc" }, select: { vr_no: true } });
  const vr_no = (last?.vr_no ?? 0) + 1;
  const day = dbDay(date);
  const master = await tx.transactionsMaster.create({
    data: {
      tran_code: 3, vr_no, dated: day, time: day, check_date: day, pycd,
      rmk1: String(remarks).slice(0, 500), rmk4: marker, rmk5: String(ref), user_id: actor,
    },
  });
  await tx.transactions.createMany({
    data: rows.map((l) => ({
      tran_id: master.tran_id, sub_tran_id: 1, acno: l.acno, ccno: l.ccno, damt: l.damt, camt: l.camt,
      narration1: String(l.narration).slice(0, 250),
    })),
  });
  return { tran_id: master.tran_id, vr_no };
}

/** The mirror of a posted journal (every line's sides swapped), dated `date`. */
export async function postMirror(tx, { tranId, date, marker, ref, reason, actor = null }) {
  const original = await tx.transactionsMaster.findUnique({ where: { tran_id: tranId }, include: { transactions: true } });
  if (!original) throw new FaError(`Journal #${tranId} is missing.`, 409);
  return postJournal(tx, {
    date, marker, ref, actor, pycd: original.pycd,
    remarks: `Reversal of JV ${original.vr_no ?? ""} (#${tranId}) — ${reason}`,
    lines: original.transactions.map((l) => ({
      acno: l.acno, ccno: l.ccno, damt: l.camt ?? 0, camt: l.damt ?? 0, narration: `Reversal — ${l.narration1 ?? ""}`,
    })),
  });
}
