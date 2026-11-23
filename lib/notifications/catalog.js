// ============================================
// NOTIFICATION EVENT CATALOG
// ============================================
// Single source of truth for every notification event the system can raise.
// Seeded into NotificationEvent / NotificationRule on first emit (see
// emit.js → ensureCatalog). Admins then own the rules from
// Admin → Notifications (rules and, ADMIN only, the texts); the defaults below are only used when an event
// is seen for the very first time.
//
// To add an event: add an entry here, then call emit(prisma, "<code>", …)
// from a handler. Nothing else to wire.
//
// `urgent: true` — someone has to act (an approval waiting, an escalation):
// on a phone it stays on screen until tapped (lib/notifications/push.js).

// Recipient roles are the role catalogue (Admin → Roles, lib/auth/roleCatalog.js).

export const NOTIFICATION_CATEGORIES = [
  "Vouchers",
  "Orders",
  "Warehouse",
  "Quality",
  "Production",
  "Requisitions",
  "Inventory",
  "Finance",
  "Users & HR",
  "Approvals",
  "Follow-ups",
  "Dashboards",
];

const FIN = ["ADMIN", "ACCOUNTANT"];
const OPS = ["ADMIN", "MANAGER"];
const FIN_OPS = ["ADMIN", "ACCOUNTANT", "MANAGER"];

/**
 * @typedef {object} CatalogEvent
 * @property {string}   code          stable id, referenced by handlers
 * @property {string}   category      one of NOTIFICATION_CATEGORIES
 * @property {string}   label
 * @property {string}   description
 * @property {string[]} defaultRoles  roles subscribed when first seeded
 * @property {boolean}  notifyActor   also notify the user who performed the action
 * @property {{name: string, description: string}[]} [vars]
 *                                    extra {placeholders} the emitting code passes
 *                                    as emit(…, { vars }) for the admin's text
 *                                    templates (Admin → Notifications). {actor},
 *                                    {title} and {message} work on every event
 *                                    (template.js) and are not listed here.
 */

// ── Template placeholders (documentation for the admin screen) ──────────────
const V = (name, description) => ({ name, description });
const VOUCHER_VARS = [V("voucher_type", "Voucher type, e.g. Receipt Voucher"), V("vr_no", "Voucher number")];
const ORDER_VARS = [V("order_no", "Order number"), V("party", "Customer / supplier name")];
const SO_APPROVAL_VARS = [...ORDER_VARS, V("kind", "Why it needs approval, e.g. Free of Cost")];
const SO_DECISION_VARS = [...SO_APPROVAL_VARS, V("approver", "Who approved / rejected")];
const SR_VARS = [V("vr_no", "Sale return number"), V("customer", "Customer name")];
const FOLLOWUP_VARS = [V("count", "Number of follow-ups"), V("list", "The first few, with days overdue")];

/** @type {CatalogEvent[]} */
export const NOTIFICATION_CATALOG = [
  // ── Vouchers (TransactionsMaster, keyed by tran_code) ─────────────────────
  { code: "receiptCreated",          category: "Vouchers", label: "Receipt voucher created",        description: "Cash / bank receipt (tran_code 1)",              defaultRoles: FIN,     notifyActor: true, vars: VOUCHER_VARS },
  { code: "paymentCreated",          category: "Vouchers", label: "Payment voucher created",        description: "Cash / bank payment (tran_code 2)",              defaultRoles: FIN,     notifyActor: true, vars: VOUCHER_VARS },
  { code: "journalCreated",          category: "Vouchers", label: "Journal voucher created",        description: "Journal entry (tran_code 3)",                    defaultRoles: FIN,     notifyActor: true, vars: VOUCHER_VARS },
  { code: "grnCreated",              category: "Warehouse", label: "GRN created",                   description: "Goods received against a purchase order (tran_code 4)", defaultRoles: FIN_OPS, notifyActor: true, vars: [V("vr_no", "GRN number"), V("items", "Number of item lines")] },
  { code: "dispatchCreated",         category: "Warehouse", label: "Dispatch created",              description: "Stock dispatched against a sale order (tran_code 6)",   defaultRoles: FIN_OPS, notifyActor: true, vars: [V("ref", "Dispatch / voucher number"), V("so_no", "Sale order number")] },
  { code: "materialIssueCreated",    category: "Production", label: "Material issue created",       description: "Raw material issued to production (tran_code 7)", defaultRoles: OPS,     notifyActor: true, vars: VOUCHER_VARS },
  { code: "productionInputCreated",  category: "Production", label: "Production input created",     description: "Finished goods received from production (tran_code 8)", defaultRoles: OPS, notifyActor: true, vars: VOUCHER_VARS },
  { code: "purchaseReturnCreated",   category: "Vouchers", label: "Purchase return created",        description: "Stock returned to vendor (tran_code 9)",         defaultRoles: FIN_OPS, notifyActor: true, vars: VOUCHER_VARS },
  { code: "saleReturnCreated",       category: "Vouchers", label: "Sale return created",            description: "Stock returned by customer (tran_code 10)",      defaultRoles: FIN_OPS, notifyActor: true, vars: VOUCHER_VARS },
  { code: "transferCreated",         category: "Warehouse", label: "Stock transfer created",        description: "Godown-to-godown transfer (tran_code 11)",       defaultRoles: OPS,     notifyActor: true, vars: VOUCHER_VARS },
  // Sale return remarks. The approval request goes to whoever holds
  // saleReturn.approve and the decision to the sales person who entered it
  // (both passed as extraUserIds), not to a role.
  { code: "saleReturnApprovalRequired", category: "Vouchers", label: "Sale return needs approval", description: "Technical reason on a sale return waiting for approval", defaultRoles: [], urgent: true, notifyActor: true, vars: [...SR_VARS, V("kind", "Technical / Commercial"), V("remarks", "The reason entered")] },
  // A new sale return → the customer's sales person (ACNO.salesArea), to
  // enter the reason on Sale Return Remarks. Passed as extraUserIds.
  { code: "saleReturnReasonNeeded",  category: "Vouchers", label: "Sale return — enter reason",     description: "Sale return made for your customer; enter the reason", defaultRoles: [], notifyActor: false, vars: SR_VARS },
  { code: "saleReturnApproved",      category: "Vouchers", label: "Sale return reason approved",    description: "Technical reason on a sale return approved",     defaultRoles: [],      notifyActor: false },
  { code: "saleReturnRejected",      category: "Vouchers", label: "Sale return reason rejected",    description: "Technical reason on a sale return rejected",     defaultRoles: [],      notifyActor: false },
  { code: "serviceInvoiceCreated",   category: "Vouchers", label: "Service invoice created",        description: "Service invoice (tran_code 21)",                 defaultRoles: FIN,     notifyActor: true, vars: VOUCHER_VARS },
  { code: "transactionCreated",      category: "Vouchers", label: "Other voucher created",          description: "Any voucher type not listed above",              defaultRoles: FIN,     notifyActor: true, vars: VOUCHER_VARS },
  { code: "transactionUpdated",      category: "Vouchers", label: "Voucher modified",               description: "Any voucher header updated after posting",       defaultRoles: FIN,     notifyActor: true, vars: VOUCHER_VARS },

  // ── Orders ────────────────────────────────────────────────────────────────
  { code: "purchaseOrderCreated",    category: "Orders", label: "Purchase order created",           description: "New PO raised for a vendor",                     defaultRoles: FIN_OPS, notifyActor: true, vars: ORDER_VARS },
  { code: "purchaseOrderApproved",   category: "Orders", label: "Purchase order approved",          description: "PO approved and ready for GRN",                  defaultRoles: FIN_OPS, notifyActor: true, vars: [V("order_no", "Order number")] },
  { code: "salesOrderCreated",       category: "Orders", label: "Sale order created",               description: "New SO raised for a customer",                   defaultRoles: [...FIN_OPS, "SALES"], notifyActor: true, vars: ORDER_VARS },
  // Free of Cost / Trial Sale Orders (status 3). The approval request goes to
  // whoever holds saleOrder.approve (passed as extraUserIds), not to a role.
  { code: "salesOrderApprovalRequired", category: "Orders", label: "Sale order needs approval", description: "Free of Cost / Trial sale order waiting for approval", defaultRoles: [],                urgent: true, notifyActor: true, vars: SO_APPROVAL_VARS },
  { code: "approvalRequested",       category: "Approvals", label: "Document waiting for your approval", description: "A document matched an approval rule (Permissions → Approvals) and is held until approved", defaultRoles: [], urgent: true, notifyActor: false, vars: [V("requester", "Who asked"), V("type", "Document type"), V("summary", "What is being asked"), V("id", "Request number (R-…)"), V("rule", "Approval rule that matched")] },
  { code: "approvalDecided",         category: "Approvals", label: "Your request was decided",            description: "Your held document was approved (and posted) or rejected", defaultRoles: [], notifyActor: false, vars: [V("type", "Document type"), V("id", "Request number (R-…)"), V("decision", "Approved / rejected text"), V("summary", "What was asked"), V("remarks", "Approver's remarks")] },
  // Approval rules that approve in steps (lib/approvals/docChains.js): to the rule's watchers and the requester
  { code: "approvalProgress",        category: "Approvals", label: "Entry moved an approval step",       description: "An entry held by an approval rule that approves in steps was approved at a step, forwarded or rejected", defaultRoles: [], notifyActor: false, vars: [V("type", "Document type"), V("id", "Request number (R-…)"), V("step", "Step it is on"), V("status", "What happened"), V("summary", "What was asked")] },
  // HR approval chains (lib/hr/chains.js): sent to the chain's watchers, the requester and the employee — and "ready to pay" to the pay step's people
  { code: "hrRequestProgress",       category: "Approvals", label: "HR request moved a step",            description: "A leave / advance / loan request in an approval chain was approved at a step, forwarded, rejected or paid", defaultRoles: [], notifyActor: false, vars: [V("type", "Request type"), V("id", "Request number (R-…)"), V("step", "Step it is on"), V("status", "What happened"), V("summary", "What was asked")] },
  { code: "salesOrderRejected",      category: "Orders", label: "Sale order rejected",              description: "Sale order rejected by the approver — the reason goes to the sales person", defaultRoles: [], notifyActor: false, vars: [...SO_DECISION_VARS, V("reason", "Rejection reason")] },
  { code: "followupDigest",          category: "Follow-ups", label: "Your follow-ups due (daily summary)", description: "Each morning: the follow-ups you own that are due (Free of Cost / Trial …)", defaultRoles: [], notifyActor: false, vars: FOLLOWUP_VARS },
  { code: "followupEscalated",       category: "Follow-ups", label: "Overdue follow-ups escalated to you", description: "Follow-ups still open past the escalation step of their scenario", defaultRoles: [], urgent: true, notifyActor: false, vars: FOLLOWUP_VARS },
  // To the approvers of the scenario's approval rules (config.followup.approverRules)
  // 08:00 — yesterday at a glance from the person's own landing dashboard,
  // worked out under their own data access (lib/bi/morning.js).
  { code: "biMorningSummary",        category: "Dashboards", label: "Morning summary (8:00)",           description: "Yesterday's headline figures and what needs attention, from your own dashboard", defaultRoles: ["ADMIN"], notifyActor: false, vars: [V("summary", "The summary sentence"), V("dashboard", "Dashboard name")] },
  { code: "followupLogged",          category: "Follow-ups", label: "A follow-up was logged",            description: "A sales person logged the result + remarks of a follow-up you approve (Free of Cost / Trial …)", defaultRoles: [], notifyActor: false, vars: [V("item", "The follow-up item, e.g. SO no · customer"), V("by", "Who logged it"), V("result", "Result chosen"), V("remarks", "What they wrote"), V("scenario", "Follow-up list name")] },
  { code: "salesOrderApproved",      category: "Orders", label: "Sale order approved",              description: "Free of Cost / Trial sale order approved by the approver", defaultRoles: [...FIN_OPS, "SALES"], notifyActor: false, vars: SO_DECISION_VARS },
  { code: "serviceOrderCreated",     category: "Orders", label: "Service order created",            description: "New service order raised",                       defaultRoles: FIN_OPS, notifyActor: true, vars: ORDER_VARS },
  { code: "orderUpdated",            category: "Orders", label: "Order modified",                   description: "Any order header updated",                       defaultRoles: OPS,     notifyActor: true, vars: [V("order_type", "Purchase / Sales / Service Order"), V("order_no", "Order number")] },

  // ── Quality ───────────────────────────────────────────────────────────────
  { code: "qualityCheckCreated",     category: "Quality", label: "QC initiated",                    description: "Quality check started for a batch",              defaultRoles: OPS,     notifyActor: false },
  { code: "qualityCheckApproved",    category: "Quality", label: "QC approved",                     description: "Batch passed quality check",                     defaultRoles: FIN_OPS, notifyActor: false },
  { code: "qualityCheckRejected",    category: "Quality", label: "QC rejected",                     description: "Batch failed quality check",                     defaultRoles: FIN_OPS, notifyActor: false },
  { code: "qualityCheckRework",      category: "Quality", label: "QC rework required",              description: "Batch sent back for rework",                     defaultRoles: OPS,     notifyActor: false },
  { code: "qualityCheckUpdated",     category: "Quality", label: "QC updated (other)",               description: "Any other QC status change",                     defaultRoles: OPS,     notifyActor: false },

  // ── Production ────────────────────────────────────────────────────────────
  { code: "productionCreated",       category: "Production", label: "Production plan created",      description: "New production plan",                            defaultRoles: OPS,     notifyActor: false },
  { code: "soPlanLineAdded",         category: "Production", label: "Sale Order added to a production plan", description: "Sale Order lines added to a dispatch Production Plan (Features: saleOrder.planFromOrder) — e.g. for the Lab to mark the Nature", defaultRoles: OPS, notifyActor: false, vars: [V("so_no", "Sale order number"), V("plan_no", "Production plan number"), V("items", "Items added")] },
  { code: "productionStarted",       category: "Production", label: "Production started",           description: "Plan moved to In Progress",                      defaultRoles: OPS,     notifyActor: false },
  { code: "productionCompleted",     category: "Production", label: "Production completed",         description: "Plan completed, awaiting QC",                    defaultRoles: OPS,     notifyActor: false },
  { code: "productionPosted",        category: "Production", label: "Production posted to stock",   description: "Finished goods posted, materials consumed",      defaultRoles: FIN_OPS, notifyActor: false },
  { code: "productionUpdated",       category: "Production", label: "Production updated (other)",   description: "Any other production plan status change",        defaultRoles: OPS,     notifyActor: false },

  // ── Requisitions ──────────────────────────────────────────────────────────
  { code: "requisitionCreated",      category: "Requisitions", label: "Requisition created",        description: "New purchase / store requisition",               defaultRoles: OPS,     notifyActor: true },
  { code: "requisitionApproved",     category: "Requisitions", label: "Requisition approved",       description: "Requisition approved for PO / transfer",         defaultRoles: OPS,     notifyActor: true },
  { code: "requisitionUpdated",      category: "Requisitions", label: "Requisition updated (other)", description: "Any other requisition change",                  defaultRoles: OPS,     notifyActor: false },

  // ── Inventory ─────────────────────────────────────────────────────────────
  { code: "itemCreated",             category: "Inventory", label: "Item created",                  description: "New item added to the item master",              defaultRoles: FIN_OPS, notifyActor: false },
  { code: "itemUpdated",             category: "Inventory", label: "Item updated",                  description: "Item master changed (incl. critical stock alert)", defaultRoles: FIN_OPS, notifyActor: false },

  // ── Finance ───────────────────────────────────────────────────────────────
  { code: "taxChallanCreated",       category: "Finance", label: "Tax challan created",             description: "New tax challan",                                defaultRoles: FIN,     notifyActor: false },
  { code: "taxChallanUpdated",       category: "Finance", label: "Tax challan updated",             description: "Challan paid / cancelled / edited",              defaultRoles: FIN,     notifyActor: false },

  // ── Users & HR ────────────────────────────────────────────────────────────
  { code: "userCreated",             category: "Users & HR", label: "User account created",         description: "New login created (the new user is always welcomed)", defaultRoles: ["ADMIN"], notifyActor: false },
  { code: "userUpdated",             category: "Users & HR", label: "User account updated",         description: "Login changed / activated / deactivated",        defaultRoles: ["ADMIN"], notifyActor: false },
  { code: "employeeCreated",         category: "Users & HR", label: "Employee added",               description: "New employee record",                            defaultRoles: ["ADMIN", "HR_MANAGER", "MANAGER"], notifyActor: false },
  { code: "employeeUpdated",         category: "Users & HR", label: "Employee updated",             description: "Employee record changed",                        defaultRoles: ["ADMIN", "HR_MANAGER"], notifyActor: false },
];

/** tran_code → voucher event code. Anything else falls back to transactionCreated. */
export const TRAN_CODE_EVENT = {
  1: "receiptCreated",
  2: "paymentCreated",
  3: "journalCreated",
  4: "grnCreated",
  6: "dispatchCreated",
  7: "materialIssueCreated",
  8: "productionInputCreated",
  9: "purchaseReturnCreated",
  10: "saleReturnCreated",
  11: "transferCreated",
  21: "serviceInvoiceCreated",
};

export const CATALOG_BY_CODE = Object.fromEntries(
  NOTIFICATION_CATALOG.map((e) => [e.code, e]),
);
