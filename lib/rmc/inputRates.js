// lib/rmc/inputRates.js
// ============================================================
// RMC "Input Based" rates (table RmcInputRate) — feature
// "reports.rmcInputRates" (lib/features/catalog.js; ported from Eastland).
// Read by the RMC report (lib/reports/rmc.js, summary type "input") and the
// RMC Input Rates screen (app/api/rmc-rates). MonthlyOpeningRate is never
// written here.
// ============================================================
import prisma from "@/lib/prisma";

export const RMC_INPUT_FEATURE = "reports.rmcInputRates";

/** Map<itcd, { rate, updated_at, updated_by }> of the typed input rates. */
export async function getRmcInputRates(itcds) {
  const rows = await prisma.rmcInputRate.findMany({
    where: itcds ? { itcd: { in: itcds } } : {},
    select: { itcd: true, rate: true, updated_at: true, updated_by: true },
  });
  return new Map(rows.map((r) => [r.itcd, r]));
}

/** Summary type "input" chosen on the RMC report? */
export function isInputBased(filters) {
  const v = filters?.summaryType;
  return String((v && typeof v === "object" ? v.value : v) ?? "normal").toLowerCase() === "input";
}
