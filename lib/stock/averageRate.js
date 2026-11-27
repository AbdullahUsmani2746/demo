// lib/stock/averageRate.js
// ============================================================
// Weighted-average cost of an item for the month a date falls in:
//
//   avg = (opening_value + Σ purchases (4) + their services − Σ purchase returns (9))
//       / (opening_qty   + purchase qty                     − purchase return qty)
//   (services = the GRN's freight / off-load / … spread onto the item — landed
//   cost, lib/service/landedCost.js — the same as Stock Activity)
//
// Falls back, in order, to the month's opening rate and then to the most
// recent purchase rate on or before the date — so an item that simply was not
// bought this month (or before Monthly Opening Stock exists) is not valued at 0.
//
// Shared by GET /api/voucher/getRate and the dispatch BOM issue
// (lib/dispatch/bomProduction.js), so both always agree.
// ============================================================
import prisma from "@/lib/prisma";
import { getOpeningOne } from "@/lib/openingStock";
import { purchaseServicesOf } from "@/lib/service/landedCost";

const round4 = (n) => Math.round(n * 10000) / 10000;

/**
 * @returns {Promise<{ itcd, month, year, openingQty, openingRate, openingValue,
 *   purchaseQty, purchaseAmount, purchaseReturnQty, purchaseReturnAmount,
 *   totalQty, totalValue, averageRate, source: "average"|"opening"|"last_purchase"|"none" }>}
 */
export async function averageRate(itcd, date = new Date(), { db = prisma } = {}) {
  const refDate = new Date(date);
  const month = refDate.getMonth() + 1;
  const year = refDate.getFullYear();

  const opening = await getOpeningOne(month, year, itcd);
  const openingQty = Number(opening?.opening_qty ?? 0);
  const openingRate = Number(opening?.opening_rate ?? 0);
  const openingValue = Number(opening?.opening_value ?? openingQty * openingRate);

  const monthStart = new Date(year, month - 1, 1);
  const monthEnd = new Date(year, month, 1);
  const rows = await db.transactions.findMany({
    where: {
      itcd,
      sub_tran_id: 1,
      transactionsMaster: { tran_code: { in: [4, 9] }, dated: { gte: monthStart, lt: monthEnd } },
    },
    select: { qty: true, damt: true, camt: true, transactionsMaster: { select: { tran_code: true } } },
  });

  let purchaseQty = 0, purchaseAmount = 0, purchaseReturnQty = 0, purchaseReturnAmount = 0;
  for (const row of rows) {
    if (row.transactionsMaster?.tran_code === 4) {
      purchaseQty += Number(row.qty ?? 0);
      purchaseAmount += Number(row.damt ?? 0);
    } else {
      purchaseReturnQty += Number(row.qty ?? 0);
      purchaseReturnAmount += Number(row.camt ?? 0);
    }
  }

  // GRN services of the month spread onto this item — landed cost (lib/service/landedCost.js)
  const purchaseServices = await purchaseServicesOf(itcd, monthStart, monthEnd);

  const totalQty = openingQty + purchaseQty - purchaseReturnQty;
  const totalValue = openingValue + purchaseAmount + purchaseServices - purchaseReturnAmount;

  let rate = 0;
  let source = "none";
  if (totalQty > 0 && totalValue > 0) {
    rate = totalValue / totalQty;
    source = "average";
  } else if (openingRate > 0) {
    rate = openingRate;
    source = "opening";
  } else {
    const last = await db.transactions.findFirst({
      where: {
        itcd,
        sub_tran_id: 1,
        rate: { gt: 0 },
        transactionsMaster: { tran_code: 4, dated: { lt: monthEnd } },
      },
      orderBy: [{ transactionsMaster: { dated: "desc" } }, { id: "desc" }],
      select: { rate: true },
    });
    if (last?.rate) {
      rate = Number(last.rate);
      source = "last_purchase";
    }
  }

  return {
    itcd, month, year,
    openingQty, openingRate, openingValue,
    purchaseQty, purchaseAmount, purchaseServices, purchaseReturnQty, purchaseReturnAmount,
    totalQty, totalValue,
    averageRate: round4(rate),
    source,
  };
}

/** Map<itcd, averageRate> for several items on one date. */
export async function averageRates(itcds, date = new Date(), { db = prisma } = {}) {
  const unique = [...new Set(itcds.map(Number).filter(Number.isInteger))];
  const results = await Promise.all(unique.map((itcd) => averageRate(itcd, date, { db })));
  return new Map(results.map((r) => [r.itcd, r.averageRate]));
}
