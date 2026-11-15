import { can } from "@/lib/auth/permissions";
import { approvalReasons } from "@/lib/orders/saleOrderApprovalRules";

// The reasons (Free of Cost, Trial, No Godown, Rate Under Negotiation,
// Bad Debt / Bad Payment customer) live in saleOrderApprovalRules.js.
export * from "@/lib/orders/saleOrderApprovalRules";

/* ══════════════════════════════════════════════════════════════════════
   SALE ORDER APPROVAL — reasons: lib/orders/saleOrderApprovalRules.js

   OrderMaster.status on a Sale Order (order_catagory = 6):
     1  OPEN              — normal, can be dispatched
     2  CLOSED            — every line closed / fully dispatched
     3  PENDING_APPROVAL  — waiting for the approver (any approval reason)
     4  REJECTED          — the approver refused it (reason in approval_remarks);
                            cannot be dispatched. Editing it sends it back for
                            approval (or opens it, if no reason is left).

   An order with any approval reason is saved at status 3. Nothing can be dispatched against it until someone holding
   a holder of `saleOrder.approve` (Permissions → Approvals) approves it; approval moves it to
   1 (or 2 if every line is already closed). Editing such an order later puts
   it back to 3, because what was approved has changed.

   Every place that recalculates the header status from its lines (item
   close/reopen, dispatch progress) must leave a status-3 order alone —
   otherwise a pending order could slip to 1 without approval.
   ══════════════════════════════════════════════════════════════════════ */

export const SO_STATUS = {
  OPEN: 1,
  CLOSED: 2,
  PENDING_APPROVAL: 3,
  REJECTED: 4,
};

/** Statuses the line-driven recalculation (close item, dispatch) must not move. */
export const SO_HELD_STATUSES = [SO_STATUS.PENDING_APPROVAL, SO_STATUS.REJECTED];

export const SO_APPROVE_PERMISSION = "saleOrder.approve";

/** True when a Sale Order needs the approver's approval before it can be used. */
export const needsApproval = (order, ctx) => approvalReasons(order, ctx).length > 0;

export const canApproveSaleOrders = (session) => can(session, SO_APPROVE_PERMISSION);

/** Everyone holding the approve right — by person or by role (for notifications). */
export { permissionHolderIds as approverHolderIds } from "@/lib/approvals/holders";

/** The message a refused dispatch shows. */
export const pendingApprovalMessage = (orderNo) =>
  `Sale Order ${orderNo} is waiting for approval — it cannot be dispatched yet.`;

export const rejectedMessage = (orderNo) =>
  `Sale Order ${orderNo} was rejected by the approver — it cannot be dispatched. Edit it to send it for approval again.`;
