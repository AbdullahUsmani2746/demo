// lib/reports/accountOrder.js
// ============================================================
// A user's own order of accounts on a report (Funds Flow / Funds Position).
//
// Saved per user per report in Settings:
//   key   = reportAccountOrder:<reportType>:<userId>
//   value = JSON { accounts: [acno, ...], updatedAt }
// Written only by /api/reports/account-order (audited, through lib/prisma.js).
//
// The order only moves accounts WITHIN their group / section — headers,
// group totals and grand totals stay where the report puts them. Accounts not
// in the saved list (new ones) follow the saved ones in the default order;
// saved accounts that no longer appear are simply skipped.
//
// The pure helpers here have no imports so they can be tested in plain Node.
// ============================================================

export const ACCOUNT_ORDER_REPORTS = ["fundsFlow", "fundsPosition"];
export const ACCOUNT_ORDER_MAX = 2000;

export const accountOrderKey = (reportType, userId) =>
  `reportAccountOrder:${reportType}:${userId}`;

/** A clean list of distinct integer account numbers, or null if invalid. */
export function cleanAccountList(accounts) {
  if (!Array.isArray(accounts) || accounts.length > ACCOUNT_ORDER_MAX) return null;
  const out = [];
  const seen = new Set();
  for (const a of accounts) {
    const n = typeof a === "string" && a.trim() !== "" ? Number(a) : a;
    if (!Number.isInteger(n)) return null;
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
  }
  return out;
}

/** Parse a stored Settings value → [acno, ...] (empty when unreadable). */
export function parseAccountOrder(value) {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return cleanAccountList(parsed?.accounts) || [];
  } catch {
    return [];
  }
}

/**
 * Sort `items` by the saved order. Stable: saved accounts first in saved
 * order, the rest after them in their original (default) order.
 * Returns a new array; `items` is not changed.
 */
export function sortByAccountOrder(items, order, acnoOf = (x) => x.acno) {
  if (!Array.isArray(items) || !order?.length) return items;
  const rank = new Map();
  order.forEach((acno, i) => {
    if (!rank.has(Number(acno))) rank.set(Number(acno), i);
  });
  return items
    .map((item, index) => {
      const r = rank.get(Number(acnoOf(item)));
      return { item, index, r: r === undefined ? Infinity : r };
    })
    .sort((a, b) => (a.r === b.r ? a.index - b.index : a.r - b.r))
    .map((x) => x.item);
}

/** The caller's saved order for a report ([] when none). Server only. */
export async function getSavedAccountOrder(reportType, userId) {
  if (!userId || !ACCOUNT_ORDER_REPORTS.includes(reportType)) return [];
  const { default: prisma } = await import("@/lib/prisma");
  const row = await prisma.settings.findUnique({
    where: { key: accountOrderKey(reportType, userId) },
    select: { value: true },
  });
  return parseAccountOrder(row?.value);
}
