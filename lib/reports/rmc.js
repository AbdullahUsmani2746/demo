import prisma from "@/lib/prisma";
import { getOpeningRates } from "@/lib/openingStock";

// ic_id category ids (same convention used across the BOM/costing engine —
// see components/Material/Bom/FutureCostingBOMView.js CATEGORY_MAP and
// lib/reports/productionPlanning.js explodeBOM)
const IC_RAW_MATERIAL = 3;
const IC_PACKAGING = 4;

const OFFICIAL_RATE = 18; // fixed markup % for the official book (ACNO.isActive = true)
const UNOFFICIAL_RATE = 22; // fixed markup % for the unofficial book (isActive = false)
const OVERHEAD_POOL = 15588200; // fixed total overhead pool — not user-entered, see overheadAmount calc below

function toNumber(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function round2(v) {
  return Math.round((v + Number.EPSILON) * 100) / 100;
}

function fmtDate(d) {
  const day = String(d.getDate()).padStart(2, "0");
  const month = String(d.getMonth() + 1).padStart(2, "0");
  const year = d.getFullYear();
  return `${day}-${month}-${year}`;
}

// Recursively explode a finished/semi-finished item's ACTIVE BOM
// (BomMaster.instructions = "A") down to raw material / packaging leaves,
// carrying the cumulative percentage of the top-level finished item down
// each branch. Leaves reached via more than one branch are merged (their
// percentages summed). Mirrors explodeBOM in lib/reports/productionPlanning.js.
function explodeBOM(itemId, pct, bomMap, visited, acc) {
  if (visited.has(itemId)) return;
  const seen = new Set(visited);
  seen.add(itemId);

  const bom = bomMap[itemId];
  if (!bom || !bom.bomDetails.length) return;

  for (const detail of bom.bomDetails) {
    const childPct = (pct * (detail.material_percentage || 0)) / 100;
    const item = detail.item;
    const icId = item?.ic_id;

    if (icId === IC_RAW_MATERIAL || icId === IC_PACKAGING) {
      const existing = acc.get(detail.material_id);
      if (existing) {
        existing.percentage += childPct;
      } else {
        acc.set(detail.material_id, {
          material_id: detail.material_id,
          material_name: item.item || "",
          material_code: item.code || String(detail.material_id),
          import_type: (item.import_type || "").toLowerCase(),
          percentage: childPct,
        });
      }
    } else {
      // Finished / semi-finished intermediate — drill into its own active BOM
      explodeBOM(detail.material_id, childPct, bomMap, seen, acc);
    }
  }
}

/**
 * Raw Material Cost estimation report ("RMC") — mirrors the legacy RMC
 * dialog/printout: explode a finished item's BOM to its raw materials,
 * split them into Imported / Local Purchase, price them off the
 * MonthlyOpeningRate rate for a chosen month/year, then layer on
 * tax/rebate, wastage, margin and overhead to land on a cost-of-goods-
 * manufactured figure and (optionally) official/unofficial-book sale prices.
 */
export async function getRMCReport(filters = {}) {
  const finishedId = parseInt(filters.finishedItem);
  const month = parseInt(filters.month) || new Date().getMonth() + 1;
  const year = parseInt(filters.year) || new Date().getFullYear();

  if (!finishedId) {
    return { data: [], summary: {} };
  }

  const finishedItem = await prisma.item.findUnique({
    where: { itcd: finishedId },
    select: { itcd: true, item: true, code: true, ic_id: true },
  });
  if (!finishedItem) {
    throw new Error("Selected finished item was not found");
  }

  // Load every active BOM once so nested (semi-finished-in-finished) BOMs
  // resolve without extra round trips.
  const allBoms = await prisma.bomMaster.findMany({
    where: { instructions: "A" },
    include: {
      bomDetails: {
        include: {
          item: { select: { itcd: true, item: true, code: true, ic_id: true, import_type: true } },
        },
      },
    },
    orderBy: { dated: "desc" },
  });
  const bomMap = {};
  for (const bom of allBoms) {
    if (!bomMap[bom.finished_id]) bomMap[bom.finished_id] = bom; // latest active BOM wins
  }

  if (!bomMap[finishedId]) {
    throw new Error("No active BOM found for this item");
  }

  const materialsAcc = new Map();
  explodeBOM(finishedId, 100, bomMap, new Set(), materialsAcc);
  const materials = Array.from(materialsAcc.values());

  // ───────────────────────────────────────────────────────────────────
  // Rate = the CLOSING rate of the month the user picked.
  //
  // MonthlyOpeningRate stores the rate as at the FIRST day of its month, so
  // the rate that closes July is the row stamped August. Pick July and you
  // want August's opening_rate — reading July's own row would give you the
  // rate that closed June, a month behind, while the printout underneath
  // still says "Latest Rate Update: 31-07-…".
  //
  // December rolls into January of the next year.
  const rateMonth = month === 12 ? 1 : month + 1;
  const rateYear = month === 12 ? year + 1 : year;

  const itcds = materials.map((m) => m.material_id);
  const [closingRates, selectedMonthRates] = await Promise.all([
    getOpeningRates(rateMonth, rateYear, { itcds }),
    // Fallback only: the following month's snapshot does not exist yet when
    // the period is still open, and pricing everything at zero would be a
    // worse answer than pricing at the month's opening rate.
    getOpeningRates(month, year, { itcds }),
  ]);

  const rateMap = new Map();
  const fallbackItcds = [];
  for (const itcd of itcds) {
    const closing = closingRates.get(itcd);
    if (closing) {
      rateMap.set(itcd, closing.opening_rate || 0);
    } else if (selectedMonthRates.has(itcd)) {
      rateMap.set(itcd, selectedMonthRates.get(itcd).opening_rate || 0);
      fallbackItcds.push(itcd);
    }
  }
  const usedFallback = fallbackItcds.length > 0;

  const materialRows = materials.map((m) => {
    const rate = rateMap.get(m.material_id) ?? 0;
    const matCost = (m.percentage / 100) * rate;
    const isImported = m.import_type === "import" || m.import_type === "imported";
    return {
      material_id: m.material_id,
      material_code: m.material_code,
      material_name: m.material_name,
      section: isImported ? "Imported" : "Local Purchase",
      percentage: round2(m.percentage),
      rate: round2(rate),
      has_rate: rateMap.has(m.material_id),
      mat_cost: round2(matCost),
    };
  }).sort((a, b) => (a.section === b.section ? b.percentage - a.percentage : a.section === "Imported" ? -1 : 1));

  const importedRows = materialRows.filter((r) => r.section === "Imported");
  const localRows = materialRows.filter((r) => r.section === "Local Purchase");

  const importedTotal = importedRows.reduce((s, r) => s + r.mat_cost, 0);
  const localTotal = localRows.reduce((s, r) => s + r.mat_cost, 0);

  const importTaxPercentage = toNumber(filters.importTaxPercentage);
  const localRebatePercentage = toNumber(filters.localRebatePercentage);
  const taxAmount = importedTotal * (importTaxPercentage / 100);
  const rebateAmount = localTotal * (localRebatePercentage / 100);

  const materialCostTotal = importedTotal + localTotal + taxAmount - rebateAmount;

  const wastagePercentage = toNumber(filters.wastagePercentage);
  const wastageAmount = materialCostTotal * (wastagePercentage / 100);
  const materialCostWithWastage = materialCostTotal + wastageAmount;

  const marginPercentage = toNumber(filters.marginPercentage);
  const marginAmount = materialCostWithWastage * (marginPercentage / 100);
  const materialCostWithMargin = materialCostWithWastage + marginAmount;

  const tonage = toNumber(filters.tonage);

  // ─────────────────────────────────────────────────────────────────────
  // OVERHEAD AMOUNT = Overhead Pool ÷ (Tonage × 1000)
  // Overhead Pool is a fixed total (OVERHEAD_POOL above), not user-entered.
  // Tonage is entered in tons and converted to KG (×1000) as the divisor,
  // spreading the pool per KG of output.
  // Example: pool 15,588,200 ÷ (150 × 1000) = 103.92.
  // ─────────────────────────────────────────────────────────────────────
  const overheadPool = OVERHEAD_POOL;
  const overheadAmount = tonage > 0 ? overheadPool / (tonage * 1000) : 0;

  const estimatedCOGM = materialCostWithMargin + overheadAmount;

  const showOfficial = filters.showOfficial === true || filters.showOfficial === "true";
  const showUnofficial = filters.showUnofficial === true || filters.showUnofficial === "true";

  // The date printed under each section must match the rate actually used:
  // the month's closing date normally, or its opening date when the closing
  // snapshot does not exist yet and every item fell back.
  const lastStockRateDate =
    closingRates.size === 0 && usedFallback
      ? new Date(year, month - 1, 1) // first day of the selected month
      : new Date(year, month, 0); // last day of the selected month

  const summary = {
    finishedItemCode: finishedItem.code || String(finishedItem.itcd),
    finishedItemName: finishedItem.item || "",
    lastStockRateDate,
    // Which MonthlyOpeningRate period the prices actually came from, and
    // whether any item had to fall back because that period is not generated.
    rateMonth,
    rateYear,
    ratesFromFallback: fallbackItcds.length,
    importedTotal: round2(importedTotal),
    localTotal: round2(localTotal),
    importTaxPercentage,
    taxAmount: round2(taxAmount),
    localRebatePercentage,
    rebateAmount: round2(rebateAmount),
    materialCostTotal: round2(materialCostTotal),
    wastagePercentage,
    wastageAmount: round2(wastageAmount),
    materialCostWithWastage: round2(materialCostWithWastage),
    marginPercentage,
    marginAmount: round2(marginAmount),
    materialCostWithMargin: round2(materialCostWithMargin),
    tonage,
    overheadPool: round2(overheadPool),
    overheadAmount: round2(overheadAmount),
    estimatedCOGM: round2(estimatedCOGM),
  };
  // Official/Unofficial prices are "on/off" toggles — when off, the key is left out entirely so
  // the summary card just doesn't render (rather than showing a misleading 0).
  if (showOfficial) summary.priceOfficial = round2(estimatedCOGM * (1 + OFFICIAL_RATE / 100));
  if (showUnofficial) summary.priceUnofficial = round2(estimatedCOGM * (1 + UNOFFICIAL_RATE / 100));

  // ─────────────────────────────────────────────────────────────────────
  // Build the printable, grouped-detail-view row list — this is what
  // actually renders in the table (see rmc.groupedDetailView in
  // components/Reports/config.js). Mirrors the legacy RMC printout:
  // an Imported section + subtotal, a Local Purchase section + subtotal,
  // then the tax/rebate/wastage/margin/overhead waterfall down to the
  // final official/unofficial prices.
  // ─────────────────────────────────────────────────────────────────────
  const rateDateLabel = fmtDate(lastStockRateDate);
  const data = [];

  const pushSection = (label, sectionRows, total, pctTotal) => {
    if (sectionRows.length === 0) return;
    data.push({ row_type: "section_header", label: `${label} — Latest Rate Update: ${rateDateLabel}` });
    sectionRows.forEach((r) => data.push({ row_type: "material_row", ...r }));
    data.push({ row_type: "section_total", percentage: round2(pctTotal), mat_cost: round2(total) });
  };

  pushSection("Imported", importedRows, importedTotal, importedRows.reduce((s, r) => s + r.percentage, 0));
  pushSection("Local Purchase", localRows, localTotal, localRows.reduce((s, r) => s + r.percentage, 0));

  data.push({ row_type: "rate_line", label: "Tax Impact on Imported Raw Material", rate_pct: importTaxPercentage, amount: round2(taxAmount) });
  data.push({ row_type: "rate_line", label: "Rebate on Local Purchased Raw Material", rate_pct: localRebatePercentage, amount: -round2(rebateAmount) });
  data.push({ row_type: "total_line", label: "Material Cost Total", amount: round2(materialCostTotal) });
  data.push({ row_type: "rate_line", label: "Wastage", rate_pct: wastagePercentage, amount: round2(wastageAmount) });
  data.push({ row_type: "total_line", label: "Material Cost with Wastage", amount: round2(materialCostWithWastage) });
  data.push({ row_type: "rate_line", label: "Margin Amount", rate_pct: marginPercentage, amount: round2(marginAmount) });
  data.push({ row_type: "total_line", label: "Material Cost with Margin Amount", amount: round2(materialCostWithMargin) });
  data.push({ row_type: "overhead_line", label: "Overhead Amount", tonage: round2(tonage), amount: round2(overheadAmount) });
  data.push({ row_type: "cogm_line", label: "Estimated Cost of Goods Manufactured", amount: round2(estimatedCOGM) });
  if (showOfficial) data.push({ row_type: "price_line", label: "Price for Official", rate_pct: OFFICIAL_RATE, amount: summary.priceOfficial });
  if (showUnofficial) data.push({ row_type: "price_line", label: "Price for Unofficial", rate_pct: UNOFFICIAL_RATE, amount: summary.priceUnofficial });

  return { data, summary };
}
