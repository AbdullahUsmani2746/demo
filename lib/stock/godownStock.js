// lib/stock/godownStock.js
// ============================================================
// Current stock of items in ONE godown, server-side.
//
// Same rule as POST /api/voucher/check-stock (fromOpening): the latest
// Monthly Opening Stock of this godown + every movement since the 1st of
// that month, up to the end of today. Falls back to all-time movements when
// no opening period has been generated yet.
//
//   IN : 4 GRN/Purchase, 8 Production, 10 Sale Return, 12 Misc IN,
//        11 Transfer where godown2 = this godown
//   OUT: 5 POS, 6 Dispatch, 7 Material Issue, 9 Purchase Return,
//        11 Transfer where godown  = this godown
// sub_tran_id = 3 control rows are excluded.
//
// Qty held by vouchers pending approval is subtracted (available stock —
// lib/stock/pendingApprovals.js); pass { pending: false } for posted only.
// ============================================================
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getLatestOpeningPeriod, openingQtySql } from "@/lib/openingStock";
import { getPendingOutQty } from "@/lib/stock/pendingApprovals";

/**
 * @param {number[]} itcds
 * @param {number}   godown
 * @param {{ db?: object, excludeTranIds?: number[], pending?: boolean }} [opts]
 *        excludeTranIds: documents to leave out — e.g. the consumption entry
 *        that is about to be rebuilt, so it is not counted twice.
 *        pending: subtract qty held by vouchers pending approval (default true).
 * @returns {Promise<Map<number, number>>} itcd → qty (0 when no movement)
 */
export async function getGodownStock(itcds, godown, { db = prisma, excludeTranIds = [], pending = true } = {}) {
  const ids = [...new Set((itcds ?? []).map(Number).filter(Number.isInteger))];
  const g = Number(godown);
  const result = new Map(ids.map((id) => [id, 0]));
  if (ids.length === 0 || !Number.isInteger(g)) return result;

  const endOfToday = new Date();
  endOfToday.setHours(23, 59, 59, 999);

  const period = await getLatestOpeningPeriod(new Date());
  const periodStart = period ? new Date(period.year, period.month - 1, 1, 0, 0, 0, 0) : null;
  const exclude = excludeTranIds.map(Number).filter(Number.isFinite);
  const excludeSql = exclude.length
    ? Prisma.sql`AND tm.tran_id NOT IN (${Prisma.join(exclude)})`
    : Prisma.empty;

  const movements = await db.$queryRaw`
    SELECT t.itcd,
      SUM(
        CASE
          WHEN tm.tran_code IN (4, 8, 10, 12) AND tm.godown = ${g} THEN t.qty
          WHEN tm.tran_code IN (5, 6, 7, 9)   AND tm.godown = ${g} THEN -t.qty
          WHEN tm.tran_code = 11 AND tm.godown  = ${g} THEN -t.qty
          WHEN tm.tran_code = 11 AND tm.godown2 = ${g} THEN t.qty
          ELSE 0
        END
      )::float AS qty
    FROM "Transactions" t
    JOIN "TRANSACTIONS_MASTER" tm ON t.tran_id = tm.tran_id
    WHERE t.itcd IN (${Prisma.join(ids)})
      AND COALESCE(t.sub_tran_id, 1) <> 3
      AND (tm.godown = ${g} OR tm.godown2 = ${g})
      AND tm.dated <= ${endOfToday}
      ${periodStart ? Prisma.sql`AND tm.dated >= ${periodStart}` : Prisma.empty}
      ${excludeSql}
    GROUP BY t.itcd
  `;
  for (const r of movements) result.set(Number(r.itcd), Number(r.qty) || 0);

  if (period) {
    const opening = await db.$queryRaw`
      SELECT o.itcd, o.opening_qty::float AS qty
      FROM (${openingQtySql(period.month, period.year, { godown: g })}) o
      WHERE o.itcd IN (${Prisma.join(ids)})
    `;
    for (const r of opening) {
      const id = Number(r.itcd);
      result.set(id, (result.get(id) || 0) + (Number(r.qty) || 0));
    }
  }

  if (pending) {
    const held = await getPendingOutQty(ids, g, { db });
    for (const [id, qty] of held) result.set(id, (result.get(id) || 0) - qty);
  }

  return result;
}
