// lib/manufacturing/processOrderRef.js
// ============================================================
// Which process order (productionPlanMaster.id) a voucher belongs to — the
// ONE definition every reader uses.
//
//   TRANSACTIONS_MASTER.process_order_id   the link (prisma/sql/2026-11-27_
//                                          process_order_id.sql); written by
//                                          every process-order posting
//   TRANSACTIONS_MASTER.rmk5               the older place — still written
//                                          (Process Order Reconciliation, lists)
//                                          and read when process_order_id is empty,
//                                          but NEVER on automatic vouchers (rmk1
//                                          "AUTO_…": dispatch BOM / packing keep the
//                                          dispatch no. in rmk5 — read as a process
//                                          order it put packing issues into costing)
//
// SQL: poRefSql("tm") (server, lib/manufacturing/processOrderRefSql.js) = the
// reference as text; JS: poRefOf(tm); Prisma where: poWhere(id). Client-safe.
// Never read rmk5 as a process order directly.
// ============================================================

/** SQL text (string) of a voucher's process order reference — alias of TRANSACTIONS_MASTER. */
export const poRefSqlText = (alias = "tm") =>
  `COALESCE(${alias}.process_order_id::text, CASE WHEN COALESCE(${alias}.rmk1, '') NOT LIKE 'AUTO%' THEN ${alias}.rmk5 END)`;

const isAuto = (tm) => String(tm?.rmk1 ?? "").startsWith("AUTO");

/** A voucher row's process order reference (string) or null. */
export function poRefOf(tm) {
  if (tm?.process_order_id != null) return String(tm.process_order_id);
  if (isAuto(tm)) return null;
  const r = tm?.rmk5 == null ? "" : String(tm.rmk5).trim();
  return r || null;
}

/** Prisma `where` part: the vouchers of process order `id`. */
export function poWhere(id) {
  const n = Number(id);
  return {
    OR: [
      { process_order_id: n },
      {
        process_order_id: null,
        rmk5: String(n),
        OR: [{ rmk1: null }, { rmk1: { not: { startsWith: "AUTO" } } }],
      },
    ],
  };
}
