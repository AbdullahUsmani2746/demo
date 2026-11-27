import { Prisma } from "@prisma/client";

// In-process item ⇄ its production item (Item.plant_id, the old ERP's
// ITEM.PLANT_ID). An in-process item (e.g. 172 ETHYL ACETATE – IN PROCESS)
// points to the item whose production it holds (16 ETHYL ACETATE
// (PRODUCTION)). Set on Item setup → "In-process stock of"; the link is data,
// never an item code in the program.
//
// One level only: a production item is not itself linked, and an item that
// other items point to cannot be linked to another.

/** Normalise the form value: "" / null / undefined → null, else an itcd. */
export function plantIdOf(value) {
  if (value === "" || value === null || value === undefined) return null;
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Why `plantId` cannot be the production item of `itcd` (null = fine).
 * `itcd` is null for a new item.
 */
export async function processLinkError(db, itcd, plantId) {
  if (plantId == null) return null;
  if (itcd != null && Number(itcd) === plantId) return "An item cannot be the in-process stock of itself.";

  const target = await db.item.findUnique({ where: { itcd: plantId }, select: { itcd: true, item: true, plant_id: true } });
  if (!target) return `Item ${plantId} does not exist.`;
  if (target.plant_id != null) {
    return `"${target.item}" is itself the in-process stock of item ${target.plant_id} — choose the production item.`;
  }
  if (itcd != null) {
    const linkedHere = await db.item.findFirst({ where: { plant_id: Number(itcd) }, select: { itcd: true, item: true } });
    if (linkedHere) {
      return `"${linkedHere.item}" is the in-process stock of this item, so this item cannot be linked to another.`;
    }
  }
  return null;
}

/**
 * SQL: the item a Material Issue (tran_code 7) line was issued for —
 *   · its voucher's process order (TRANSACTIONS_MASTER.rmk5 = productionPlanMaster.id):
 *     the output the line was issued for (Transactions.source_line_no =
 *     productionPlanOutput.line_no — lib/manufacturing/processOrder.js), else
 *     the order's product;
 *   · else the old ERP's PAY_CODE, kept by the import as the line narration
 *     "For item <itcd>" (scripts/import-7-8-history.py, import-jul-oct-26.py).
 * Neither (consumables …) = NULL. Needs aliases tm, t, pm and po joined with
 *   ISSUED_FOR_JOINS.
 */
export const ISSUED_FOR_JOINS = Prisma.sql`
  LEFT JOIN "productionPlanMaster" pm ON pm.id::text = tm.rmk5
  LEFT JOIN "productionPlanOutput" po ON po.plan_id = pm.id AND po.line_no = t.source_line_no`;
export const ISSUED_FOR_SQL = Prisma.sql`COALESCE(po.finished_id, pm.finished_id, NULLIF(substring(t.narration2 from '^For item ([0-9]+)$'), '')::int)`;

/**
 * What each in-process item's production item consumed in a period —
 * Stock Activity With Rate shows it on the in-process row (172 ← the
 * materials issued for 16) as "Linked production", apart from the item's own
 * figures, so its stock and the report totals never count it twice.
 *
 *   qty         = Σ Material Issue qty issued for the production item
 *                 (ISSUED_FOR_SQL; auto issues — dispatch BOM / packing — and
 *                 issues of the production item or its in-process items left out),
 *                 same period and godown rule as the report;
 *   byMaterial  = that qty per material, for the caller to value at each
 *                 material's issue rate.
 *
 * Returns Map<in-process itcd, { plant_itcd, plant_item, qty, byMaterial: Map<itcd, qty>, rate: 0, amount: 0 }>.
 */
export async function linkedIssuesFor(db, { itcds, dateFrom, dateTo, godown }) {
  const ids = [...new Set((itcds || []).map(Number).filter(Boolean))];
  if (!ids.length) return new Map();

  const links = await db.item.findMany({
    where: { itcd: { in: ids }, plant_id: { not: null } },
    select: { itcd: true, plant_id: true },
  });
  if (!links.length) return new Map();
  const plantIds = [...new Set(links.map((l) => l.plant_id))];
  // Every in-process item of those production items (not only the ones shown)
  const allLinks = await db.item.findMany({
    where: { plant_id: { in: plantIds } },
    select: { itcd: true, plant_id: true },
  });
  const ownItems = new Set([...plantIds, ...allLinks.map((l) => l.itcd)]);

  const g = godown ? parseInt(godown, 10) : null;
  const [plants, issued] = await Promise.all([
    db.item.findMany({ where: { itcd: { in: plantIds } }, select: { itcd: true, item: true, code: true } }),
    db.$queryRaw`
      SELECT ${ISSUED_FOR_SQL} AS for_itcd, t.itcd, COALESCE(SUM(t.qty), 0)::float8 AS qty
        FROM "TRANSACTIONS_MASTER" tm
        JOIN "Transactions" t ON t.tran_id = tm.tran_id
        ${ISSUED_FOR_JOINS}
       WHERE tm.tran_code = 7
         AND COALESCE(tm.rmk1, '') NOT LIKE 'AUTO%'
         AND t.itcd IS NOT NULL
         AND t.qty IS NOT NULL
         AND (t.sub_tran_id IS NULL OR t.sub_tran_id != 3)
         AND ${ISSUED_FOR_SQL} = ANY(${plantIds}::int[])
         ${g ? Prisma.sql`AND (tm.godown = ${g} OR tm.godown2 = ${g})` : Prisma.empty}
         ${dateFrom ? Prisma.sql`AND tm.dated >= ${new Date(dateFrom)}` : Prisma.empty}
         ${dateTo ? Prisma.sql`AND tm.dated <= ${new Date(dateTo)}` : Prisma.empty}
       GROUP BY 1, 2`,
  ]);

  const plantOf = new Map(plants.map((p) => [p.itcd, p]));
  const byPlant = new Map(); // plant itcd → Map<material, qty>
  for (const r of issued) {
    const plant = Number(r.for_itcd), material = Number(r.itcd);
    if (ownItems.has(material)) continue; // the product / its in-process stock: adjustments, not inputs
    if (!byPlant.has(plant)) byPlant.set(plant, new Map());
    const m = byPlant.get(plant);
    m.set(material, (m.get(material) || 0) + (Number(r.qty) || 0));
  }

  const out = new Map();
  for (const l of links) {
    const p = plantOf.get(l.plant_id);
    const byMaterial = byPlant.get(l.plant_id) || new Map();
    out.set(l.itcd, {
      plant_itcd: l.plant_id,
      plant_item: p ? `${p.code || p.itcd} ${p.item || ""}`.trim() : String(l.plant_id),
      qty: [...byMaterial.values()].reduce((a, b) => a + b, 0),
      byMaterial,
      rate: 0,
      amount: 0,
    });
  }
  return out;
}
