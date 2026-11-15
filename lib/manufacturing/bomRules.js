// lib/manufacturing/bomRules.js
// ============================================================
// Server checks of a BOM save, as Settings → Features says
// (lib/features/catalog.js, group "bom"):
//   bom.percentRule       what the material percentages must total
//                         (lib/production/rules.js — the form uses the same rule)
//   bom.oneActivePerItem  an Active BOM makes the item's other active BOMs Inactive
// "Finished good" = Settings → Production setup "Finished goods" categories.
// ============================================================
import prisma from "@/lib/prisma";
import { feature } from "@/lib/features/server";
import { getProductionSetup, isFinishedCategory } from "@/lib/production/setup";
import { bomPercentError } from "@/lib/production/rules";

export const BOM_ACTIVE = "A";

/** Refusal message for a BOM body, or null. `editing` = PUT of an existing BOM. */
export async function bomSaveError({ finished_id, bomDetails }, { editing = false, db = prisma } = {}) {
  const finishedId = Number(finished_id);
  if (!Number.isInteger(finishedId) || finishedId <= 0) return "Select the product";
  if (!Array.isArray(bomDetails) || bomDetails.length === 0) return "Add at least one material";
  for (const d of bomDetails) {
    const id = Number(d?.material_id);
    if (!Number.isInteger(id) || id <= 0) return "Every material line needs an item";
    if (id === finishedId) return "Master product cannot be added as a material";
    if (!(Number(d.material_percentage) >= 0)) return "Every material needs a percentage";
  }
  const item = await db.item.findUnique({ where: { itcd: finishedId }, select: { ic_id: true } });
  if (!item) return `Unknown product ${finishedId}`;
  const [rule, setup] = await Promise.all([feature("bom.percentRule"), getProductionSetup()]);
  const total = bomDetails.reduce((s, d) => s + (Number(d.material_percentage) || 0), 0);
  return bomPercentError(rule, total, { finished: isFinishedCategory(setup, item.ic_id), editing });
}

/**
 * bom.oneActivePerItem: after saving `bomId` as Active, every other active
 * BOM of the same item becomes Inactive (kept, never deleted). Off: nothing.
 * @returns {Promise<number[]>} the BOMs made inactive
 */
export async function deactivateOtherBoms(db, { bomId, finishedId, instructions }) {
  if (instructions !== BOM_ACTIVE) return [];
  if (!(await feature("bom.oneActivePerItem"))) return [];
  const others = await db.bomMaster.findMany({
    where: { finished_id: Number(finishedId), instructions: BOM_ACTIVE, NOT: { id: Number(bomId) } },
    select: { id: true },
  });
  if (!others.length) return [];
  await db.bomMaster.updateMany({ where: { id: { in: others.map((b) => b.id) } }, data: { instructions: "B" } });
  return others.map((b) => b.id);
}
