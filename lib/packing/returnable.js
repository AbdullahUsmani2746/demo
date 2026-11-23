// lib/packing/returnable.js
// ============================================================
// RETURNABLE PACKING — the shared definitions (client-safe, no Prisma).
// Settings → Features "documents.returnablePacking" (default off).
//
// A document line carries the packing its goods went out / came in
// (packing_material_code), whether that packing is returnable (returnable)
// and how many packs (no_of_pack). The automatic packing stock voucher is
// lib/dispatch/packingConsumption.js; the balances are the Returnable
// Packing report (lib/reports/returnablePacking.js).
//
// An EMPTY packing line is a line whose item IS a packing material (an item
// category ticked "Packing material" in Settings → Production setup), ticked
// returnable, with no packing of its own:
//   · on a GRN without a PO   → a customer's empty drums coming back
//   · on a GRN Return         → a vendor's empty drums going back
// A document made only of empty packing lines has nothing to bill, so it is
// left out of Purchase / Purchase Return Invoicing (packingOnlyWhere).
// ============================================================

export const RETURNABLE_PACKING_FEATURE = "documents.returnablePacking";

/**
 * Voucher types whose lines carry packing besides the dispatch (which always
 * has — "dispatch.packingConsumption"): Dispatch Return, GRN, GRN Return.
 */
export const RETURNABLE_PACKING_TYPES = new Set(["saleReturn", "dispatchReturn", "grn", "grnReturn"]);

/** Prisma `Transactions` filter: an empty returnable packing line. */
export const emptyPackingLineWhere = (packingCategoryIds) => ({
  returnable: true,
  packing_material_code: null,
  itemDetails: { is: { ic_id: { in: packingCategoryIds } } },
});

/**
 * Prisma `TransactionsMaster` filter: every main line is an empty packing
 * line (and there is at least one). `grn` = also no PO (a GRN against a PO
 * is a purchase of packing, which is billed).
 */
export function packingOnlyWhere(packingCategoryIds, { grn = false } = {}) {
  return {
    ...(grn ? { po_no: null } : {}),
    transactions: {
      some: { sub_tran_id: 1 },
      every: { OR: [{ sub_tran_id: { gt: 1 } }, emptyPackingLineWhere(packingCategoryIds)] },
    },
  };
}
