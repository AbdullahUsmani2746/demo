// Click-through links for notifications.
//
// A notification already stores WHAT it is about (entity + entity_id), so the
// link is worked out when the list is read — nothing new is stored, no schema
// change. Each page is opened with ?search=<the number the user sees>, which
// its list's own search box picks up (Table.jsx / ProductionTab.jsx).
//
// Cost: at most one primary-key lookup per entity type for the batch
// (WHERE <pk> IN (...)). Called from GET /api/notifications/link only, i.e.
// when a notification is CLICKED — never from the bell's 1-second poll.

// tran_code → the list page of that voucher type
// (app/(pages)/accounting/[category]/[type]) and which number to search by.
// The "…Edit" pages are the ones that list the saved documents.
const TRAN_CODE_PAGE = {
  1: { path: "/accounting/voucher/receipt", no: "vr_no" },
  2: { path: "/accounting/voucher/payment", no: "vr_no" },
  3: { path: "/accounting/voucher/journal", no: "vr_no" },
  4: { path: "/accounting/report/grnEdit", no: "grn_no" },
  6: { path: "/accounting/report/dispatchEdit", no: "dispatch_no" },
  7: { path: "/accounting/production/materialIssue", no: "vr_no" },
  8: { path: "/accounting/production/materialInput", no: "vr_no" },
  9: { path: "/accounting/return/purchaseReturn", no: "vr_no" },
  10: { path: "/accounting/return/saleReturn", no: "vr_no" },
  11: { path: "/accounting/godown/transferEdit", no: "vr_no" },
  14: { path: "/accounting/report/fixedAssetsGrn", no: "vr_no" },
  15: { path: "/accounting/report/fixedAssetDisposal", no: "vr_no" },
  16: { path: "/accounting/report/fixedAssetRelocation", no: "vr_no" },
  19: { path: "/accounting/invoice/debit", no: "vr_no" },
  21: { path: "/accounting/report/serviceInvoice", no: "vr_no" },
};

// OrderMaster.order_catagory → order list page
const ORDER_PAGE = {
  4: "/accounting/order/purchaseOrder",
  5: "/accounting/order/serviceOrder",
  6: "/accounting/order/saleOrder",
};

// event_code → fixed page, for events whose action lives somewhere other than
// the entity's own list (e.g. a Sale Order waiting for approval).
const EVENT_PAGE = {
  salesOrderApprovalRequired: "/dashboard/approvals?type=saleOrder",
  saleReturnApprovalRequired: "/accounting/forms/saleReturnApprovals",
  followupDigest: "/dashboard/followups",
  followupEscalated: "/dashboard/followups",
};

const withSearch =(path, value) =>
  value == null || value === ""
    ? path
    : `${path}${path.includes("?") ? "&" : "?"}search=${encodeURIComponent(value)}`;

const idsOf = (notifications, entity) => [
  ...new Set(
    notifications
      .filter((n) => n.entity === entity && n.entity_id != null)
      .map((n) => Number(n.entity_id))
      .filter(Number.isFinite),
  ),
];

/**
 * Returns the notifications with a `link` (string or null) on each.
 * Never throws — a failed lookup just leaves that link null, and the
 * notification still works as before (click = mark as read).
 */
export async function attachNotificationLinks(prisma, notifications = []) {
  if (!notifications.length) return notifications;

  const tranIds = idsOf(notifications, "transaction");
  const orderNos = idsOf(notifications, "order");

  const [vouchers, orders] = await Promise.all([
    tranIds.length
      ? prisma.transactionsMaster
          .findMany({
            where: { tran_id: { in: tranIds } },
            select: { tran_id: true, tran_code: true, vr_no: true, grn_no: true, dispatch_no: true },
          })
          .catch(() => [])
      : [],
    orderNos.length
      ? prisma.orderMaster
          .findMany({
            where: { order_no: { in: orderNos } },
            select: { order_no: true, order_catagory: true },
          })
          .catch(() => [])
      : [],
  ]);

  const voucherById = new Map(vouchers.map((v) => [v.tran_id, v]));
  const orderByNo = new Map(orders.map((o) => [o.order_no, o]));

  const linkFor = (n) => {
    // A Sale Order waiting for approval opens on itself in the Approvals inbox.
    if (n.event_code === "salesOrderApprovalRequired" && n.entity === "order" && Number.isFinite(Number(n.entity_id)) && n.entity_id != null) {
      return `${EVENT_PAGE.salesOrderApprovalRequired}&id=so-${Number(n.entity_id)}`;
    }
    // Event-specific pages win over the generic entity page.
    if (EVENT_PAGE[n.event_code]) return EVENT_PAGE[n.event_code];

    const id = n.entity_id == null ? null : Number(n.entity_id);
    if (id == null || !Number.isFinite(id)) return null;

    switch (n.entity) {
      case "transaction": {
        const v = voucherById.get(id);
        const page = v && TRAN_CODE_PAGE[v.tran_code];
        if (!page) return null;
        // The document number shown on the list; tran_id when it is blank
        // (the list search matches tran_id too).
        return withSearch(page.path, v[page.no] ?? v.tran_id);
      }
      case "order": {
        const o = orderByNo.get(id);
        const path = o && ORDER_PAGE[o.order_catagory];
        return path ? withSearch(path, id) : null;
      }
      case "production": // Process Order = productionPlanMaster.id
        return withSearch("/accounting/material?tab=production", id);
      case "requisition": // reqMaster.tran_id
        return withSearch("/accounting/material/requisition", id);
      case "item":
        return "/accounting/forms/items";
      case "saleReturn": // SaleReturnRemark.tran_id — the list search matches it
        return withSearch("/accounting/forms/saleReturnRemarks", id);
      case "approvalRequest": // a document held by an approval rule
        return `/dashboard/approvals?id=${id}`;
      default:
        return null; // quality, user, employee, tax_challan … — no page
    }
  };

  return notifications.map((n) => ({ ...n, link: linkFor(n) }));
}
