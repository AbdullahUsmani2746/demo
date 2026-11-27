// lib/costing/plantExpenseProducts.js — which products get plant expenses
// (overhead) in Costing → Production. Data, not code:
//   Item setup           "Gets plant expenses"  (Item.gets_plant_expenses)
//   Item Category setup  "Gets plant expenses"  (ItemCategory.gets_plant_expenses)
// A product shares when it OR its category is ticked. Nothing ticked anywhere
// = every product made on a process order shares (by kg). Plant expenses as
// a whole: Settings → Features "costing.plantOverhead".
// SQL: prisma/sql/2026-11-27_plant_expense_products.sql
import prisma from "@/lib/prisma";

/** { all: true } when nothing is ticked, else { all: false, itcds, categories }. */
export async function plantExpenseProducts(db = prisma) {
  const [items, cats] = await Promise.all([
    db.item.findMany({ where: { gets_plant_expenses: true }, select: { itcd: true } }),
    db.itemCategory.findMany({ where: { gets_plant_expenses: true }, select: { id: true } }),
  ]);
  if (!items.length && !cats.length) return { all: true, itcds: [], categories: [] };
  return { all: false, itcds: items.map((i) => i.itcd), categories: cats.map((c) => c.id) };
}

/** Does item { itcd, ic_id } get plant expenses under `rule` (plantExpenseProducts)? */
export function getsPlantExpenses(rule, item) {
  if (rule.all) return true;
  return rule.itcds.includes(Number(item?.itcd)) || rule.categories.includes(Number(item?.ic_id));
}
