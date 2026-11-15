// lib/reports/subAccountLedger.js
// ============================================================
// Account Ledger + Sub Accounts (feature "vouchers.subAccounts", ported from
// Eastland; lib/vouchers/subAccounts.js). Used by the accountLedger case of
// app/api/reports/[reportType]/route.js only while the feature is on.
//
//   withSubAccounts(rows, filter)  each row's Sub Account (Transactions.sub_account,
//                                  looked up by line_id, so the ledger queries stay
//                                  as they are); with the Sub Account filter (ids)
//                                  only those lines are kept, plus the opening rows —
//                                  the balance column stays the account's.
//   summariseBySubAccount(rows)    View = Summary by Sub Account: one row per
//                                  Account + Sub Account with the period's net
//                                  amount (Debit − Credit); opening rows left out,
//                                  lines with none last as "(No Sub Account)".
// ============================================================
import prisma from "@/lib/prisma";
import { cleanSubAccount } from "@/lib/vouchers/subAccounts";

const idsOf = (filter) => {
  const list = Array.isArray(filter) ? filter : String(filter ?? "").split(",");
  return list
    .map((v) => Number(v && typeof v === "object" ? v.value : v))
    .filter((n) => Number.isInteger(n) && n > 0);
};

export async function withSubAccounts(rows, subAccountFilter) {
  const lineIds = [...new Set(rows.map((r) => r.line_id).filter(Boolean))];
  const lines = lineIds.length
    ? await prisma.transactions.findMany({ where: { id: { in: lineIds } }, select: { id: true, sub_account: true } })
    : [];
  const subMap = new Map(lines.map((l) => [Number(l.id), cleanSubAccount(l.sub_account) || ""]));
  const out = rows.map((r) => ({ ...r, sub_account: r.line_id ? subMap.get(Number(r.line_id)) || "" : "" }));

  const ids = idsOf(subAccountFilter);
  if (!ids.length) return out;
  const subs = await prisma.subAccount.findMany({ where: { id: { in: ids } }, select: { acno: true, acname: true } });
  const keep = new Set(subs.map((s) => `${Number(s.acno)}|${cleanSubAccount(s.acname)}`));
  return out.filter((r) => r.isOpening || keep.has(`${Number(r.acno)}|${r.sub_account}`));
}

export async function summariseBySubAccount(rows) {
  const groups = new Map();
  for (const r of rows) {
    if (r.isOpening) continue;
    const sub = r.sub_account || "";
    const key = `${Number(r.acno)}|${sub}`;
    if (!groups.has(key)) groups.set(key, { acno: Number(r.acno), acname: r.acname || "", sub_account: sub, net_amount: 0 });
    const g = groups.get(key);
    if (!g.acname && r.acname) g.acname = r.acname;
    g.net_amount += (Number(r.debit) || 0) - (Number(r.credit) || 0);
  }

  // The sub account's id, so a summary row can open the ledger filtered to it.
  const acnos = [...new Set([...groups.values()].map((g) => g.acno))];
  const subs = acnos.length
    ? await prisma.subAccount.findMany({ where: { acno: { in: acnos } }, select: { id: true, acno: true, acname: true } })
    : [];
  const idOf = new Map(subs.map((s) => [`${s.acno}|${cleanSubAccount(s.acname)}`, s.id]));

  const sorted = [...groups.values()].sort(
    (a, b) => a.acno - b.acno || (!a.sub_account) - (!b.sub_account) || a.sub_account.localeCompare(b.sub_account),
  );
  let prev = null;
  return sorted.map((g) => {
    const first = g.acno !== prev;
    prev = g.acno;
    return {
      row_kind: "subAccount",
      acno: g.acno,
      acname: g.acname,
      acno_label: first ? [g.acno, g.acname].filter(Boolean).join(" - ") : "",
      sub_account: g.sub_account || "(No Sub Account)",
      sub_account_id: g.sub_account ? idOf.get(`${g.acno}|${g.sub_account}`) ?? null : null,
      net_amount: Math.round(g.net_amount * 100) / 100,
    };
  });
}
