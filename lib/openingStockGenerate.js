// lib/openingStockGenerate.js
// ============================================================
// THE ONLY automatic writer of monthly opening stock.
//
// generateMonthlyOpeningStock(month, year) closes period (month, year) and
// writes the opening of the FOLLOWING month:
//   - rates  : one Stock Activity run across all godowns → closing_rate /
//              cc_rate per item → MonthlyOpeningRate
//   - qtys   : one Stock Activity run per godown → closing_qty per item per
//              godown → MonthlyOpeningStock
//
// Both come from getStockActivityWithRateReport so the opening always equals
// what the report shows as closing. The target month is replaced wholesale
// (see replaceOpening) — re-locking a period overwrites earlier output.
//
// Reconciliation: some vouchers carry no godown on TRANSACTIONS_MASTER
// (notably purchase vouchers, tran_code 4). They count in the all-godown
// closing but in no per-godown run. Per item, any remainder
//   all_godown_closing − Σ per_godown_closing
// is booked to UNATTRIBUTED_GODOWN so Σ godown rows === all-godown closing
// (every costing route depends on that). The result reports how much was
// booked this way — the real fix is to set godown on those vouchers.
//
// Called from:
//   POST /api/costing/lock-period      (action: "lock")
//   POST /api/opening-stock/calculate  (manual "Calculate" button)
// ============================================================
import prisma from "@/lib/prisma";
import { replaceOpening } from "@/lib/openingStock";
import { getStockActivityWithRateReport } from "@/app/api/reports/[reportType]/route";

// Godown that receives stock movements whose voucher has no godown (FACTORY).
export const UNATTRIBUTED_GODOWN = 1;
const EPS = 1e-6;

export async function generateMonthlyOpeningStock(month, year) {
  // Full-day boundaries (local), identical to what the report's GET handler
  // produces via setHours(0,0,0,0) / setHours(23,59,59,999). We pass Date
  // objects, NOT date-only strings: a "YYYY-MM-DD" string parses as UTC
  // midnight, which would truncate the last day and drop that day's
  // transactions from the SQL `tm.dated <= dateTo` filter.
  const dateFrom = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const dateTo = new Date(year, month, 0, 23, 59, 59, 999);

  const nextMonth = month === 12 ? 1 : month + 1;
  const nextYear = month === 12 ? year + 1 : year;

  // ── 1. Item-level rates from the all-godown run ──────────────────────────
  const allItems = await getStockActivityWithRateReport({
    dateFrom,
    dateTo,
    viewMode: "summary",
    showZeroStock: "true", // keep zero-balance items so their rate carries forward
  });

  const rates = [];
  const allClosing = new Map(); // itcd → all-godown closing qty
  for (const item of allItems) {
    const itcd = Number(item.product_code);
    if (!itcd) continue;
    const closingRate = Number(item.closing_rate || 0);
    const cc_rate = Number(item.cc_rate || item.opening_cc_rate || 0);
    rates.push({
      itcd,
      opening_rate: Number.isFinite(closingRate) ? closingRate : 0,
      cc_rate,
      rm_rate: closingRate - cc_rate,
    });
    allClosing.set(itcd, Number(item.closing_qty || 0));
  }

  // ── 2. Godown-level closing qty, one report run per godown ──────────────
  const godowns = await prisma.godown.findMany({ select: { id: true } });
  const qtyByKey = new Map(); // "itcd|godown" → qty
  const attributed = new Map(); // itcd → Σ per-godown closing
  for (const { id: godown } of godowns) {
    const rows = await getStockActivityWithRateReport({
      dateFrom,
      dateTo,
      godown,
      viewMode: "summary",
    });
    for (const item of rows) {
      const itcd = Number(item.product_code);
      const closingQty = Number(item.closing_qty || 0);
      if (!itcd || Math.abs(closingQty) < EPS) continue;
      qtyByKey.set(`${itcd}|${godown}`, (qtyByKey.get(`${itcd}|${godown}`) || 0) + closingQty);
      attributed.set(itcd, (attributed.get(itcd) || 0) + closingQty);
    }
  }

  // ── 3. Reconcile: book per-item remainder to UNATTRIBUTED_GODOWN ─────────
  let unattributedItems = 0;
  let unattributedQty = 0;
  for (const [itcd, total] of allClosing) {
    const remainder = total - (attributed.get(itcd) || 0);
    if (Math.abs(remainder) < EPS) continue;
    const key = `${itcd}|${UNATTRIBUTED_GODOWN}`;
    qtyByKey.set(key, (qtyByKey.get(key) || 0) + remainder);
    unattributedItems++;
    unattributedQty += remainder;
  }

  const qtys = [...qtyByKey.entries()].map(([key, opening_qty]) => {
    const [itcd, godown] = key.split("|").map(Number);
    return { itcd, godown, opening_qty };
  });

  const written = await replaceOpening(nextMonth, nextYear, { rates, qtys });

  return {
    nextMonth,
    nextYear,
    godowns: godowns.length,
    rates: written.rates,
    qtys: written.qtys,
    // Non-zero here means vouchers without a godown exist in the period.
    unattributed: { godown: UNATTRIBUTED_GODOWN, items: unattributedItems, qty: unattributedQty },
  };
}
