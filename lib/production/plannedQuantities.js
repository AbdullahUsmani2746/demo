// lib/production/plannedQuantities.js
// ============================================================
// Planned quantities per item and period (INPUT_FOR_PP, model InputForPP) —
// ported from Accounting's "Input for PP". A planning input typed on
// Production → Planned Quantities (/accounting/planned-quantities,
// app/api/material/input-for-pp); read by the Production Planning report
// (Planned (Month) / Qtr Qty columns, lib/reports/productionPlanning.js).
//
//   period_type MONTHLY   → month 1-12, quarter 0
//   period_type QUARTERLY → quarter 1-4, month 0
// A quarter's figure = its direct QUARTERLY entry, else the sum of its three
// MONTHLY entries (never both — no double counting).
// ============================================================
import prisma from "@/lib/prisma";

export const PLANNED_QTY_MANAGE = "plannedQty.manage";

const ints = (list) => [...new Set((list || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];

/** { month: Map<itcd, qty>, quarter: Map<itcd, qty> } for the plan month / its quarter. */
export async function getPlannedQuantities(itcds, month, year) {
  const ids = ints(itcds);
  const out = { month: new Map(), quarter: new Map() };
  if (!ids.length) return out;
  const quarter = Math.ceil(month / 3);
  const qMonths = [quarter * 3 - 2, quarter * 3 - 1, quarter * 3];
  const rows = await prisma.inputForPP.findMany({
    where: {
      itcd: { in: ids },
      year,
      OR: [
        { period_type: "MONTHLY", month: { in: qMonths } },
        { period_type: "QUARTERLY", quarter },
      ],
    },
    select: { itcd: true, period_type: true, month: true, qty: true },
  });
  const monthlySum = new Map();
  const direct = new Map();
  for (const r of rows) {
    const itcd = Number(r.itcd);
    const qty = Number(r.qty) || 0;
    if (r.period_type === "QUARTERLY") direct.set(itcd, qty);
    else {
      monthlySum.set(itcd, (monthlySum.get(itcd) || 0) + qty);
      if (r.month === month) out.month.set(itcd, qty);
    }
  }
  for (const itcd of new Set([...monthlySum.keys(), ...direct.keys()])) {
    out.quarter.set(itcd, direct.has(itcd) ? direct.get(itcd) : monthlySum.get(itcd));
  }
  return out;
}

/** Entries of one year (optionally one period type), with the item. */
export async function listPlannedQuantities({ year, periodType } = {}) {
  return prisma.inputForPP.findMany({
    where: { year, ...(periodType ? { period_type: periodType } : {}) },
    include: { item: { select: { itcd: true, code: true, item: true, unit: true } } },
    orderBy: [{ itcd: "asc" }, { quarter: "asc" }, { month: "asc" }],
  });
}

/**
 * One entry → the row to upsert, or an error string.
 * { itcd, period_type: "MONTHLY"|"QUARTERLY", month?, quarter?, year, qty }
 */
export function plannedEntry(raw) {
  const itcd = parseInt(raw?.itcd?.value ?? raw?.itcd, 10);
  const period_type = String(raw?.period_type || "MONTHLY").toUpperCase();
  const year = parseInt(raw?.year, 10);
  const month = period_type === "MONTHLY" ? parseInt(raw?.month, 10) : 0;
  const quarter = period_type === "QUARTERLY" ? parseInt(raw?.quarter, 10) : 0;
  const qty = raw?.qty === "" || raw?.qty == null ? null : Number(raw.qty);
  if (!Number.isInteger(itcd) || itcd <= 0) return "Choose the item";
  if (!["MONTHLY", "QUARTERLY"].includes(period_type)) return "Period must be MONTHLY or QUARTERLY";
  if (!Number.isInteger(year) || year < 2000 || year > 2100) return "Enter a valid year";
  if (period_type === "MONTHLY" && !(month >= 1 && month <= 12)) return "Month must be 1–12";
  if (period_type === "QUARTERLY" && !(quarter >= 1 && quarter <= 4)) return "Quarter must be 1–4";
  if (qty != null && (!Number.isFinite(qty) || qty < 0)) return "Quantity must be 0 or more";
  return { itcd, period_type, month, quarter, year, qty };
}

/** Save entries (qty empty = remove the entry). Returns { saved, removed }. */
export async function savePlannedQuantities(entries) {
  let saved = 0;
  let removed = 0;
  await prisma.$transaction(async (tx) => {
    for (const e of entries) {
      const key = { itcd: e.itcd, period_type: e.period_type, month: e.month, year: e.year, quarter: e.quarter };
      if (e.qty == null) {
        removed += (await tx.inputForPP.deleteMany({ where: key })).count;
      } else {
        await tx.inputForPP.upsert({
          where: { itcd_period_type_month_year_quarter: key },
          create: { ...key, qty: e.qty },
          update: { qty: e.qty },
        });
        saved += 1;
      }
    }
  });
  return { saved, removed };
}
