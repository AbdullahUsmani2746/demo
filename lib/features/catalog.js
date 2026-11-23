// lib/features/catalog.js
// ============================================================
// FEATURES — the ONE list of business flows a company can switch on or off,
// or choose between, on Settings → Features. Client-safe (no Prisma): the
// settings screen and every form read it; the server reads the stored values
// through lib/features/server.js, screens through hooks/useFeatures.js.
//
// Bizlogist ERP grew out of several client systems (SMS, Eastland,
// Accounting). Where they work differently, the difference is a feature here,
// never a copy of the code per client. The default is always the SMS
// behaviour, so a company that changes nothing gets exactly that.
//
//   type "toggle"  value true / false
//   type "choice"  value one of options[].value
//   origin         which system each behaviour came from (shown on the screen)
//   screens        (optional) page urls that exist only for this feature — a toggle
//                  switched off hides their menus (lib/features/apply.js)
//
// Stored as one Settings row, key "featureFlags", value JSON { key: value }.
// Only values that differ from the default need to be stored; an unknown key
// or an invalid value is ignored (the default applies).
//
// Adding a feature: add it here with its default = today's behaviour, read it
// with feature("<key>") on the server and useFeatures().on("<key>") / .value()
// on screens — never test a company name or a client in code.
// ============================================================

export const FEATURE_FLAGS_KEY = "featureFlags";

export const FEATURE_GROUPS = [
  { id: "production", title: "Production", description: "How process orders are planned and posted." },
  { id: "bom", title: "Bill of materials", description: "What a BOM must add up to and how many may be active." },
  { id: "saleOrder", title: "Sale Order", description: "What a Sale Order may contain and what is checked when it is saved." },
  { id: "dispatch", title: "Dispatch", description: "What a dispatch does besides moving finished goods out." },
  { id: "documents", title: "Documents", description: "Extra panels on GRN and dispatch." },
  { id: "approvals", title: "Approvals", description: "Extra ways an entry reaches the Approvals inbox." },
  { id: "knockoff", title: "Invoice knock-off", description: "What the automatic knock-off matches against open invoices." },
  { id: "vouchers", title: "Vouchers", description: "Extra fields on receipt, payment and journal vouchers." },
  { id: "reports", title: "Reports", description: "Extra views and the screens that feed them." },
  { id: "purchasing", title: "GRN & purchasing", description: "How goods received are priced." },
  { id: "costing", title: "Costing", description: "How issue rates and conversion cost are worked out at month end, and the costing check screens." },
  { id: "saleReturn", title: "Sale returns", description: "What a sale return must name and the cost its stock comes back at." },
  { id: "tax", title: "Tax", description: "Withholding tax on voucher lines." },
  { id: "fixedAssets", title: "Fixed assets", description: "Asset register, depreciation, relocation and disposal postings (the rules: Settings → Fixed assets)." },
  { id: "hr", title: "HR & payroll", description: "Extra payroll flows. Their rules: HR → Payroll → Rules; their accounts: Finance → Account Settings → Payroll." },
  { id: "pos", title: "Point of sale", description: "What the till allows. Its choices (godown, walk-in account, tax, rounding, receipt): Settings → Point of Sale." },
];

export const FEATURES = [
  {
    key: "production.processOrderSource",
    group: "production",
    type: "choice",
    label: "New process orders are made from",
    description:
      "BOM: the issuances come from the item's bill of materials (optional — lines may be typed freely). " +
      "Recipe: every new process order must name a recipe; its materials and instructions become the issuances.",
    options: [
      { value: "bom", label: "BOM (optional)", origin: "SMS / Eastland" },
      { value: "recipe", label: "Recipe (required)", origin: "Accounting" },
    ],
    default: "bom",
  },
  {
    key: "production.bomRequired",
    group: "production",
    type: "toggle",
    label: "A process order must name a BOM",
    description:
      "When process orders are made from a BOM, every production item of a new process order must name its BOM " +
      "(the issuances still come from it and may be adjusted). Off: the BOM is optional and lines may be typed freely. " +
      "Orders saved without a BOM keep it that way on edit.",
    origin: { on: "Eastland", off: "SMS / Accounting" },
    default: false,
  },
  {
    key: "production.multiOutput",
    group: "production",
    type: "toggle",
    label: "Several production items on one process order",
    description:
      "A process order may produce more than one item, each with its own issuances. Off: one production item per order — " +
      "the \"Add item\" button is hidden and the server refuses a second one; orders already saved with several items stay as saved.",
    origin: { on: "SMS", off: "Eastland / Accounting" },
    default: true,
  },
  {
    key: "production.autoLoadBom",
    group: "production",
    type: "toggle",
    label: "Load the item's BOM when it is picked",
    description:
      "Picking the production item of a new process order loads its active BOM into the issuances straight away. " +
      "Off: the BOM is loaded with the Load button (Alt+B) or by choosing it.",
    origin: { on: "new", off: "SMS / Eastland / Accounting" },
    default: false,
  },
  {
    key: "production.qcBeforeSend",
    group: "production",
    type: "toggle",
    label: "QC must pass a process order before Send to Production",
    description:
      "A process order of a finished good (Settings → Production setup) can be sent to production only after Quality " +
      "Control has passed it (Quality Assurance → Production QC), so its batch number comes from QC. Off: an order may be " +
      "sent without QC. Either way an order whose QC is Failed, On hold or Re-test is not sent.",
    origin: { on: "new", off: "SMS / Eastland / Accounting" },
    default: false,
  },
  {
    key: "production.postingDate",
    group: "production",
    type: "choice",
    label: "Material issue and production vouchers are dated",
    description:
      "The date the issue (7) and production (8) vouchers of a process order carry when it is sent to production " +
      "(and when a reprocessing order posts). The period lock is checked for that date.",
    options: [
      { value: "sent", label: "The day it is sent", origin: "SMS / Eastland / Accounting" },
      { value: "plan", label: "The order's plan date", origin: "new" },
    ],
    default: "sent",
  },
  {
    key: "production.yieldEditWindow",
    group: "production",
    type: "choice",
    label: "Actual yield of a posted order may change",
    description: "How long after posting the actual yield (and so the production voucher's quantity) may still be corrected.",
    options: [
      { value: "24h", label: "For 24 hours", origin: "SMS / Eastland / Accounting" },
      { value: "72h", label: "For 72 hours", origin: "new" },
      { value: "always", label: "Always", origin: "new" },
      { value: "never", label: "Never", origin: "new" },
    ],
    default: "24h",
  },
  {
    key: "production.labNature",
    group: "production",
    type: "toggle",
    label: "Lab marks each plan line Finished / Process / Manufacturing",
    description:
      "Every Production Plan line carries the Lab's Nature: FINISHED (dispatch from stock), PROCESS or MANUFACTURING " +
      "(a Process Order is needed — it can be started from the plan line). Changing a Nature already saved goes through " +
      "the approval rules on \"Production Plan\" (Admin → Permissions → Approvals). The Pending Report lists Process / " +
      "Manufacturing lines whose Process Order is not posted. Off: no Nature column; Natures already saved are kept.",
    origin: { on: "Eastland", off: "SMS / Accounting" },
    default: false,
    screens: ["/accounting/reports/pendingReport"],
  },
  {
    key: "bom.percentRule",
    group: "bom",
    type: "choice",
    label: "BOM material percentages must total",
    description:
      "SMS: a finished good's BOM totals 100 % when it is made (99–111 % when edited, up to 110 % may be typed); " +
      "any other BOM exactly 100 %. Exactly 100 %: every BOM, always. No check: any total. Checked by the server on every save.",
    options: [
      { value: "sms", label: "SMS rule (finished up to 110 %)", origin: "SMS / Eastland" },
      { value: "exact100", label: "Exactly 100 %", origin: "new" },
      { value: "none", label: "No check", origin: "new" },
    ],
    default: "sms",
  },
  {
    key: "bom.oneActivePerItem",
    group: "bom",
    type: "toggle",
    label: "One active BOM per item",
    description:
      "Saving a BOM as Active makes any other active BOM of the same item Inactive (they are kept), the way recipes work. " +
      "Off: a second active BOM of an item is only warned about on the screen.",
    origin: { on: "new (as recipes)", off: "SMS / Eastland" },
    default: false,
  },
  {
    key: "dispatch.produceOnDispatch",
    group: "dispatch",
    type: "toggle",
    label: "Produce on dispatch from the BOM",
    description:
      "A dispatch line may carry the materials it is made from: saving the dispatch issues them (Material Issue) " +
      "and produces the finished good (Production) automatically. Off: a dispatch only takes finished goods already in stock.",
    origin: { on: "SMS", off: "Eastland / Accounting" },
    default: true,
  },
  {
    key: "dispatch.issueMaterialsFrom",
    group: "dispatch",
    type: "choice",
    label: "Issue BOM materials from (default)",
    description:
      "Where a new dispatch's \"Issue Materials From\" starts — the godown its BOM materials are issued from when a line " +
      "is produced on dispatch. Production godown: Settings → Production setup. Same as the Warehouse: follows the " +
      "dispatch's Warehouse until the user picks another godown. Either way the user may pick any godown.",
    options: [
      { value: "production", label: "Production godown", origin: "SMS (until Nov 2026)" },
      { value: "warehouse", label: "Same as the Warehouse", origin: "SMS (from Nov 2026)" },
    ],
    default: "production",
  },
  {
    key: "dispatch.withoutSaleOrder",
    group: "dispatch",
    type: "choice",
    label: "A dispatch without a Sale Order",
    description:
      "Allowed: a dispatch may be made for a customer with no Sale Order (\"New Dispatch\"). Refused: every new dispatch " +
      "must name its Sale Order — the form makes it required and the server refuses one without. Dispatches already saved " +
      "without an order can still be edited.",
    options: [
      { value: "allowed", label: "Allowed", origin: "SMS / Eastland" },
      { value: "refused", label: "Refused", origin: "new" },
    ],
    default: "allowed",
  },
  {
    key: "dispatch.overDispatchTolerance",
    group: "dispatch",
    type: "choice",
    label: "Dispatch may exceed the Sale Order by",
    description:
      "How far the quantity dispatched against a Sale Order line (all its dispatches together) may go over the ordered " +
      "quantity. More is refused by the form and the server. A line also counts as fully dispatched once it is within " +
      "this band of the ordered quantity (either side).",
    options: [
      { value: "0", label: "Nothing (0 %)", origin: "new" },
      { value: "5", label: "5 %", origin: "new" },
      { value: "10", label: "10 %", origin: "SMS / Eastland" },
      { value: "20", label: "20 %", origin: "new" },
    ],
    default: "10",
  },
  {
    key: "dispatch.packingConsumption",
    group: "dispatch",
    type: "toggle",
    label: "Issue packing material automatically",
    description:
      "A dispatch line's packs of its packing material are issued from stock by an automatic Material Issue kept in step " +
      "with the dispatch. Off: new dispatches issue no packing material (issue it by hand); a dispatch that already has " +
      "its automatic packing issue keeps it up to date when edited.",
    origin: { on: "SMS", off: "Eastland / Accounting" },
    default: true,
  },
  {
    key: "dispatch.batchRequired",
    group: "dispatch",
    type: "toggle",
    label: "Every dispatch line needs a Batch No",
    description:
      "Each item line of a dispatch must carry its batch no — the form and the server refuse a line without one. " +
      "Off: Batch No is optional. On an edit, an item saved without a batch may stay so.",
    origin: { on: "new", off: "SMS / Eastland" },
    default: false,
  },
  {
    key: "dispatch.extraFields",
    group: "dispatch",
    type: "toggle",
    label: "Manual DC No, City and Route on the dispatch",
    description:
      "The dispatch form has the paper book's Manual DC No, the destination City and the Route. Off: the fields are " +
      "hidden and nothing new is saved in them; values already on dispatches are kept.",
    origin: { on: "SMS", off: "Eastland / Accounting" },
    default: true,
  },
  {
    key: "dispatch.requirePostedProcessOrder",
    group: "dispatch",
    type: "toggle",
    label: "No dispatch before the Process Order is posted",
    description:
      "A dispatch line is refused while its Production Plan line's Nature is PROCESS or MANUFACTURING and no Process Order " +
      "for that Sale Order item is posted, or while the Lab has not marked the Nature yet (only plan lines made after the " +
      "Lab started marking). Each dispatch line records the Plan No and Process Order No it came from. Works with " +
      "\"Lab marks each plan line\". Off: dispatch as usual; numbers already recorded on dispatch lines are kept.",
    origin: { on: "Eastland", off: "SMS / Accounting" },
    default: false,
  },
  {
    key: "orders.trialLineBilling",
    group: "saleOrder",
    type: "toggle",
    label: "Trial and Rate Negotiation per Sale Order line",
    description:
      "Each Sale Order line is Normal, Trial or Rate Negotiation (an order with such a line may not list an item twice). " +
      "Trial lines are rate 0. A dispatch line remembers the type its order line had and is priced 0 on Sale Invoicing. " +
      "When the client approves, the Sale Order line is changed to Normal with its rate; Sale Invoicing → Approved trial " +
      "items then moves those goods into a part of the dispatch (1234-2, same date, stock unchanged), invoiced like any " +
      "dispatch. Off: the Order Type applies to the whole order; lines and dispatches already typed keep their type.",
    origin: { on: "Eastland", off: "SMS / Accounting" },
    default: false,
  },
  {
    key: "saleOrder.focTrialWarning",
    group: "saleOrder",
    type: "toggle",
    label: "No second Free of Cost / Trial of the same item",
    description:
      "When an item on a Free of Cost order (or a Trial line) was already given to this customer as Free of Cost or Trial " +
      "on an earlier Sale Order (rejected ones aside), the form says so and cannot be saved, and the server refuses it.",
    origin: { on: "Eastland", off: "SMS / Accounting" },
    default: false,
  },
  {
    key: "saleOrder.duplicateItems",
    group: "saleOrder",
    type: "choice",
    label: "The same item twice on one Sale Order",
    description: "Allowed: an item may be on several lines. Refused: the form and the server ask for one line per item.",
    options: [
      { value: "allowed", label: "Allowed", origin: "SMS / Accounting" },
      { value: "refused", label: "Refused", origin: "new" },
    ],
    default: "allowed",
  },
  {
    key: "saleOrder.creditLimit",
    group: "saleOrder",
    type: "choice",
    label: "Customer over the credit limit",
    description:
      "Checked when a Sale Order is saved: the customer's outstanding balance plus this order (with tax) against the " +
      "credit limit on the customer. Warn: saved with a warning. Hold: saved waiting for approval (reason \"Credit limit " +
      "exceeded\", decided on Approvals by Sale Order approvers). A customer with no credit limit is not checked.",
    options: [
      { value: "off", label: "Not checked", origin: "SMS / Eastland" },
      { value: "warn", label: "Warn", origin: "new" },
      { value: "hold", label: "Hold for approval", origin: "new" },
    ],
    default: "off",
  },
  {
    key: "saleOrder.overdueCheck",
    group: "saleOrder",
    type: "choice",
    label: "Customer with overdue invoices",
    description:
      "Checked when a Sale Order is saved: any amount past the customer's credit days (the Customer Aging figures). " +
      "Warn: saved with a warning. Hold: saved waiting for approval (reason \"Overdue invoices\").",
    options: [
      { value: "off", label: "Not checked", origin: "SMS / Eastland" },
      { value: "warn", label: "Warn", origin: "new" },
      { value: "hold", label: "Hold for approval", origin: "new" },
    ],
    default: "off",
  },
  {
    key: "saleOrder.priceListOnly",
    group: "saleOrder",
    type: "toggle",
    label: "Only items on the customer's price list",
    description:
      "Every Sale Order item must be on the customer's Sales Items list and ticked there (Free of Cost and Trial orders " +
      "included); the product list offers only those and the server refuses others. Items already on an order may stay " +
      "when it is edited. Off: Normal orders offer the price list, Free of Cost / Trial orders every item, and the server " +
      "does not check.",
    origin: { on: "Eastland", off: "SMS / Accounting" },
    default: false,
  },
  {
    key: "saleOrder.litreUnits",
    group: "saleOrder",
    type: "toggle",
    label: "Order and dispatch in litres (LTR)",
    description:
      "A Sale Order or dispatch line may be in LTR; the KG that moves stock is worked out from the item's LTR Rate. " +
      "Off: lines are KG only — the Unit and Qty (LTR) columns are hidden and the server refuses new LTR lines; lines " +
      "already saved in LTR (and dispatches of them) stay in LTR.",
    origin: { on: "SMS", off: "Eastland / Accounting" },
    default: true,
  },
  {
    key: "saleOrder.planFromOrder",
    group: "saleOrder",
    type: "toggle",
    label: "Plan production from the Sale Order line",
    description:
      "Each Sale Order line has a Plan Date and Plan Qty with a Create button that adds it to that day's dispatch " +
      "Production Plan (a new plan when the day has none; godowns from Settings → Production setup). A new order marked " +
      "this way is planned as soon as it is approved. The plan qty may not exceed the ordered qty (over every plan), an " +
      "item is planned from its order once, and an item already dispatched is not planned. The Sale Order To Invoice " +
      "Time Tracking report follows each line from order to invoice. Off: no plan cells; plans and plan dates already " +
      "made are kept.",
    origin: { on: "Eastland", off: "SMS / Accounting" },
    default: false,
    screens: ["/accounting/reports/isoTimeline", "/accounting/material/dispatchTransfer"],
  },
  {
    key: "documents.servicesPanel",
    group: "documents",
    type: "toggle",
    label: "Services panel on GRN and dispatch",
    description:
      "Freight, loading and other services are entered on the GRN / dispatch itself and booked as linked Service Invoices. " +
      "Off: service invoices are entered on their own.",
    origin: { on: "SMS", off: "Eastland / Accounting" },
    default: true,
  },
  {
    key: "documents.returnablePacking",
    group: "documents",
    type: "toggle",
    label: "Returnable packing on GRN and returns",
    description:
      "GRN, GRN Return and Dispatch Return lines name the packing the goods came in / went back in and whether it is " +
      "returnable, as dispatch lines do; each such document keeps one automatic packing voucher in step (in for a GRN / " +
      "Dispatch Return, out for a GRN Return). Empty drums: a GRN without a PO (a customer's) or a GRN Return (back to the " +
      "vendor) with the drum itself as the item, ticked returnable — left out of Purchase / Purchase Return Invoicing. " +
      "Items get a default \"Packing Returnable?\". The Returnable Packing report shows who holds whose drums. Off: only " +
      "dispatches carry packing; documents already saved with packing keep it in step when edited.",
    origin: { on: "SMS (from Nov 2026)", off: "SMS (until Nov 2026) / Eastland / Accounting" },
    default: false,
  },
  {
    key: "documents.batchReuseWarning",
    group: "documents",
    type: "toggle",
    label: "Warn when a batch no is used again",
    description:
      "Creating a dispatch or a process order with a batch no that is already on another one shows a warning " +
      "(it never stops the save).",
    origin: { on: "Eastland", off: "SMS / Accounting" },
    default: false,
  },
  {
    // components/Template/OrderLetterhead.js — read by generatePurchaseOrderPDF
    // (PurchaseOrderNew.jsx) and generateSalesOrderPDF (SalesOrder.jsx).
    key: "documents.orderLetterhead",
    group: "documents",
    type: "toggle",
    label: "Print Purchase / Sale Orders on the letterhead",
    description:
      "Purchase and Sale Orders print on the company's own letterhead: logo, office address, order no as " +
      "<COMPANY>/PO/<no>/<year>, vendor / customer band with NTN, items with GST, payment terms and " +
      "Prepared / Checked / Approved By. Off: the standard order layout.",
    origin: { on: "SMS (Nov 2026)", off: "SMS before Nov 2026 / Eastland / Accounting" },
    default: false,
  },
  {
    // lib/approvals/deletions.js, components/Category/Table.jsx, /api/approvals/delete-requests.
    key: "approvals.deletionRequests",
    group: "approvals",
    type: "toggle",
    label: "Request deletion (with a reason)",
    description:
      "People without the delete right get \"Request deletion\" on voucher and order lists: they give a reason and the request waits " +
      "on Approvals for a holder of \"Decide deletion requests\" (Admin → Permissions → Approvals). Approving deletes the entry through " +
      "its own form (period lock, invoiced and system-voucher checks still apply); the reason stays on record. Off: only people " +
      "with the delete right can delete.",
    origin: { on: "SMS (Nov 2026)", off: "SMS before Nov 2026 / Eastland / Accounting" },
    default: false,
  },
  {
    key: "knockoff.matchReturns",
    group: "knockoff",
    type: "toggle",
    label: "Knock off returns that name no invoice",
    description:
      "A Sale Return / Purchase Return whose goods cannot be traced to an invoice is settled against the party's " +
      "oldest open invoices (first in, first out), like a receipt or payment. The return itself is never changed. " +
      "Off: such a return lowers the party's balance but stays unmatched; existing matches are kept.",
    origin: { on: "Eastland", off: "SMS / Accounting" },
    default: false,
  },
  {
    key: "vouchers.subAccounts",
    group: "vouchers",
    type: "toggle",
    label: "Sub Accounts on voucher lines",
    description:
      "Receipt, payment and journal lines may name a Sub Account of their account (e.g. FUEL under Vehicle Expenses), " +
      "kept on Finance → Sub Accounts. Accounts whose main account is listed in Account Settings → \"Accounts that need a " +
      "Sub Account\" must name one. The Account Ledger gets a Sub Account column, filter and a Summary by Sub Account view. " +
      "Off: the field, screen and ledger view are hidden and nothing new is saved; sub accounts already on vouchers are kept.",
    origin: { on: "Eastland", off: "SMS / Accounting" },
    default: false,
    screens: ["/accounting/sub-accounts"],
  },
  {
    key: "reports.rmcInputRates",
    group: "reports",
    type: "toggle",
    label: "RMC input rates (\"Input Based\" view)",
    description:
      "A screen to type your own rate per raw / packing material (Production → Costing → RMC Input Rates), and an " +
      "\"Input Based\" summary type on the Raw Material Cost (RMC) report that prices with those rates — an item with no " +
      "input rate keeps its monthly rate. Monthly opening rates are never changed. Off: the screen and the option are hidden; " +
      "rates already typed are kept.",
    origin: { on: "Eastland", off: "SMS / Accounting" },
    default: false,
    screens: ["/accounting/rmc-rates"],
  },
  // ── Ported from Accounting (prisma/sql/2026-11-21_accounting_features.sql) ──
  {
    key: "grn.directRateByItem",
    group: "purchasing",
    type: "toggle",
    label: "Rate typed on the GRN for chosen items",
    description:
      "Items (or whole item categories) ticked \"Rate entered on the GRN\" get a Rate box on the GRN line, prefilled with the " +
      "PO rate; Purchase Invoicing then proposes that typed rate instead of the PO rate (e.g. wood, priced at receipt). The GRN " +
      "still posts nothing to the ledger until it is invoiced. Off: every GRN is quantity only and invoicing proposes the PO rate; " +
      "rates already typed on GRNs and the ticks on items are kept.",
    origin: { on: "Accounting", off: "SMS" },
    default: false,
  },
  {
    key: "saleReturn.requireDispatchLink",
    group: "saleReturn",
    type: "toggle",
    label: "A sale return must name its dispatch",
    description:
      "Every new sale return names the Dispatch it returns and holds only items of that dispatch — the server refuses anything " +
      "else. A return of a dispatch from before the system started gives the Old Dispatch No and the warehouse instead, and " +
      "each line carries its cost rate (the system-start opening rate, or typed when the item has none). Off: the form asks " +
      "for the dispatch but the server does not check it; old dispatch numbers already saved are kept.",
    origin: { on: "Accounting", off: "SMS" },
    default: false,
  },
  {
    key: "costing.method",
    group: "costing",
    type: "choice",
    label: "Materials are issued and costed at",
    description:
      "Weighted average: production costing values raw materials at the month's opening + purchase average and semi-finished inputs at " +
      "their own production cost; only the conversion cost (CC) added at a finished good's own stage is split out. Blended issue rate: " +
      "every material is valued at the one rate the Stock Activity With Rate report issues it at — opening + purchases − purchase " +
      "returns + production value + returns of earlier months — so the COGM journal credits each material exactly what the stock report " +
      "issues, and the CC carried in by semi-finished / finished inputs is tracked through every stage (RM / CC split of stock, COGS, " +
      "COGM and the opening rates written when a month is locked). Months already costed keep their figures until they are costed again.",
    options: [
      { value: "average", label: "Weighted average", origin: "SMS" },
      { value: "blendedCC", label: "Blended issue rate, CC through stages", origin: "Accounting" },
    ],
    default: "average",
  },
  {
    key: "costing.semiFinishedCC",
    group: "costing",
    type: "toggle",
    label: "Semi-finished goods receive conversion cost",
    description:
      "From the month chosen on Costing → Production costing (\"Semi-finished CC from\"), production costing spreads the month's CC " +
      "pool over finished AND semi-finished production (categories from Settings → Production setup), so a semi-finished item carries its " +
      "own CC into the goods made from it. Months before it, and every month while this is off, give CC to finished goods only. The " +
      "start month cannot move across a locked costing month.",
    origin: { on: "Accounting", off: "SMS" },
    default: false,
  },
  {
    key: "costing.reconciliation",
    group: "costing",
    type: "toggle",
    label: "Stock ↔ GL reconciliation and item cost trace",
    description:
      "Two read-only check screens under Production → Costing: the month's stock value per stock account against the general ledger, " +
      "with the difference split into its causes, and a step-by-step trace of one item's cost (opening, purchases, production, issues, " +
      "sales, journals). Off: the screens are hidden.",
    origin: { on: "Accounting", off: "SMS" },
    default: false,
    screens: ["/accounting/costing/reconciliation", "/accounting/costing/item-reconciliation"],
  },
  {
    key: "saleReturn.costAtOriginalMonth",
    group: "saleReturn",
    type: "toggle",
    label: "Returns of earlier months come back at their original cost",
    description:
      "A return of an earlier month's dispatch brings the stock back at the cost rate of the month it was sold in (the system-start " +
      "rate for old dispatches): it enters that month's average cost at that rate, and the COGS report and COGS journal reverse it " +
      "at that cost in its own columns, netting only same-month returns against this month's sales. Off: every return nets " +
      "against this month's sales at this month's rate.",
    origin: { on: "Accounting", off: "SMS" },
    default: false,
  },
  {
    key: "dispatch.fulfilmentPanel",
    group: "dispatch",
    type: "toggle",
    label: "Fulfilment check on dispatch and transfer lines",
    description:
      "Dispatch and transfer forms show, per item, the Sale Order / requisition balance (ordered, already moved, this voucher, " +
      "left after) and the warehouse stock before and after the voucher, with a status per line. Read-only — the save checks " +
      "are unchanged. Off: not shown.",
    origin: { on: "Accounting", off: "SMS" },
    default: false,
  },
  {
    key: "tax.lineWht",
    group: "tax",
    type: "toggle",
    label: "Withholding tax per payment / receipt line",
    description:
      "A payment or receipt line may name a Tax Law: the server sets its WHT rate from the line account's filer status (filer / " +
      "non-filer rate of the law) and books the withholding as a deduction line on the law's payable account (Setup → Tax Laws " +
      "→ Payable account) — the bank moves the net. Off: the Tax Law column is hidden, deductions are typed by hand; tax laws " +
      "already on saved lines are kept.",
    origin: { on: "Accounting", off: "SMS" },
    default: false,
  },
  {
    key: "processOrder.batchRequiredReprocessing",
    group: "production",
    type: "toggle",
    label: "Reprocessing may wait for Send to Production",
    description:
      "A reprocessing order can be saved with \"Wait for Send to Production\": it is then saved like a new production order and " +
      "posts its material issue and production only on Send to Production. Off: a reprocessing order posts when it is saved; " +
      "orders already waiting can still be sent.",
    origin: { on: "Accounting", off: "SMS" },
    default: false,
  },
  {
    key: "fgTransfer.partialAcceptance",
    group: "production",
    type: "toggle",
    label: "FG transfer: accept part, reject the balance",
    description:
      "On FG Transfer Acceptance a requisition can be accepted in parts (each acceptance posts its own transfer) and the " +
      "remaining balance rejected; the requisition is Partial until every quantity is accepted or rejected (then Accepted, " +
      "Rejected or Closed). Off: a requisition is accepted or rejected as a whole; partial ones keep their quantities.",
    origin: { on: "Accounting", off: "SMS" },
    default: false,
  },

  // ── Fixed assets (lib/fixedAssets/*). Off by default: a company that does
  // nothing keeps today's Fixed Assets GRN (no register postings).
  {
    key: "fixedAssets.autoRegisterFromGrn",
    group: "fixedAssets",
    type: "toggle",
    label: "Fixed Assets GRN registers the assets",
    description:
      "Saving a Fixed Assets GRN puts every asset unit in the Fixed Asset Register (cost, in-service date, holder) and, " +
      "per Settings → Fixed assets, posts the capitalisation journal (Dr asset cost, Cr vendor). A GRN whose assets are " +
      "registered can no longer be edited or deleted. Off: the GRN only numbers the assets, as before; assets already " +
      "registered stay in the register.",
    origin: { on: "new", off: "SMS / Accounting" },
    default: false,
  },
  {
    key: "fixedAssets.depreciation",
    group: "fixedAssets",
    type: "toggle",
    label: "Monthly depreciation",
    description:
      "The Depreciation run screen (choose a month, preview per asset, post one journal: Dr depreciation expense, " +
      "Cr accumulated depreciation) and the Depreciation Schedule report. Off: the screen and the report are hidden and " +
      "no run can be posted or reversed; runs already posted stay in the books.",
    origin: { on: "new", off: "SMS / Accounting" },
    default: false,
    screens: ["/accounting/fixed-assets/depreciation", "/accounting/reports/fixedAssetSchedule"],
  },
  {
    key: "fixedAssets.disposalPosting",
    group: "fixedAssets",
    type: "toggle",
    label: "A disposal posts its gain / loss journal",
    description:
      "Saving a Fixed Asset Disposal posts a system journal: Dr accumulated depreciation, Dr the customer / bank with the " +
      "proceeds, Cr asset cost, and the gain or loss to the gain / loss account. Off: the disposal only records that the " +
      "asset is gone (as in Accounting) — the books are adjusted by your own voucher.",
    origin: { on: "new", off: "Accounting" },
    default: false,
  },
  {
    key: "fixedAssets.relocation",
    group: "fixedAssets",
    type: "toggle",
    label: "Fixed Asset Relocation voucher",
    description:
      "A voucher that moves assets to a new department / employee / location, kept as history (Fixed Asset Movement " +
      "report). Off: the voucher is hidden and refused; the holder is changed on the asset itself (also kept as history).",
    origin: { on: "Accounting", off: "SMS" },
    default: false,
    screens: ["/accounting/report/fixedAssetRelocation"],
  },

  // ── HR & payroll (lib/hr/*, prisma/sql/2026-11-21_hr_payroll_additions.sql) ──
  {
    // components/HR/approvedFormPdf.js — "Approved form (PDF)" on Approvals.
    key: "hr.applicationLetters",
    group: "hr",
    type: "toggle",
    label: "Loan / advance application letters",
    description:
      "An approved salary advance or loan prints as an application letter (Loan Application to the Managing Director, " +
      "Advance Salary Application to HR) with the employee's details, the department head's recommendation and the " +
      "final approval filled in from its approval chain. Off: the standard approved form (details, lines, every step).",
    origin: { on: "SMS (Nov 2026)", off: "Bizlogist" },
    default: false,
  },
  {
    key: "hr.bankDisbursement",
    group: "hr",
    type: "toggle",
    label: "Bank transfer files & advice letters",
    description:
      "A posted payroll gives one salary transfer file per bank (CSV or Excel, laid out as each bank wants — HR → Payroll → Bank files) " +
      "and a printable bank advice letter; cash-paid employees are listed separately. Off: only the plain bank sheet export.",
    origin: { on: "Bizlogist", off: "SMS" },
    default: false,
  },
  {
    key: "hr.payHistory",
    group: "hr",
    type: "toggle",
    label: "Pay history",
    description:
      "One screen per employee with every payslip month by month (gross, deductions, tax, net), salary changes, advances / loans " +
      "and settlements, and the Pay history report. Off: the screen and report are hidden and refused.",
    origin: { on: "Bizlogist", off: "SMS" },
    default: false,
    screens: ["/accounting/hr/pay-history", "/accounting/reports/hrPayHistory"],
  },
  {
    key: "hr.taxCertificate",
    group: "hr",
    type: "toggle",
    label: "Salary tax certificates",
    description:
      "A yearly certificate of salary paid and income tax deducted per employee (tax year from HR → Payroll → Rules), from posted payslips, " +
      "printable; employees print their own on My payslips. Off: hidden and refused.",
    origin: { on: "Bizlogist", off: "SMS" },
    default: false,
  },
  {
    key: "hr.providentFund",
    group: "hr",
    type: "toggle",
    label: "Provident fund",
    description:
      "Payroll deducts the employee share and adds the employer share (percentages, basic or gross, eligibility: HR → Payroll → Rules) " +
      "and the payroll journal posts both to Provident Fund Payable; the fund is paid out in the final settlement. PF ledger report. " +
      "Off: no PF on new payrolls; posted payrolls keep theirs.",
    origin: { on: "Bizlogist", off: "SMS" },
    default: false,
    screens: ["/accounting/reports/hrPfLedger"],
  },
  {
    key: "hr.pfLoans",
    group: "hr",
    type: "toggle",
    label: "Provident fund loans & withdrawals",
    description:
      "Needs Provident fund on. On Advances & loans an employee (or HR for them) applies for a PF loan — paid back through payroll in " +
      "instalments — or a PF withdrawal — paid once, never paid back, it reduces the fund. At most a set % of the employee's PF balance and " +
      "a set number of instalments (HR → Payroll → Rules). Approved in Approvals (PF loan approvers), paid out by finance as a payment " +
      "voucher Dr Provident Fund Payable / Cr cash-bank; recoveries credit PF Payable in the payroll journal; shown in the PF ledger. " +
      "Off: no new PF loans or withdrawals; existing ones keep running.",
    origin: { on: "Bizlogist", off: "SMS" },
    default: false,
    screens: ["/accounting/hr/loans", "/accounting/reports/hrPfLedger"],
  },
  {
    key: "hr.gratuity",
    group: "hr",
    type: "toggle",
    label: "Gratuity",
    description:
      "Gratuity on last basic or gross × days per year of service (HR → Payroll → Rules), provided every month in the payroll journal " +
      "or paid at exit only, and paid in the final settlement. Gratuity provision report. Off: no gratuity on new payrolls or settlements.",
    origin: { on: "Bizlogist", off: "SMS" },
    default: false,
    screens: ["/accounting/reports/hrGratuityProvision"],
  },
  {
    key: "hr.leavingProcess",
    group: "hr",
    type: "toggle",
    label: "Leaving process & final settlement",
    description:
      "Resignation / termination requests (by the employee or HR) approved in Approvals, notice period, clearance checklist, then the " +
      "leaving date and status are set; the full & final settlement (last salary, leave encashment, gratuity, PF, notice pay, loans) is " +
      "approved, posted as a journal and paid. Off: leaving is recorded on the employee by hand, as today.",
    origin: { on: "Bizlogist", off: "SMS" },
    default: false,
    screens: ["/accounting/hr/leaving"],
  },
  {
    key: "pos.creditSales",
    group: "pos",
    type: "toggle",
    label: "Sell on credit to a customer account",
    description:
      "The till offers \"Credit\" as a payment: the unpaid part of the bill is debited to the customer account picked on the bill " +
      "(needs the pos.credit right). Off: every POS bill is paid in full in cash or by card.",
    origin: { on: "new", off: "SMS" },
    default: false,
  },
  {
    key: "pos.requireShift",
    group: "pos",
    type: "toggle",
    label: "Selling needs an open shift",
    description:
      "A cashier opens a shift (with the opening float) before the first sale and closes it with the cash counted (Z report). " +
      "Off: shifts are optional — a sale made with no open shift is still in the day's figures.",
    origin: { on: "new", off: "SMS" },
    default: false,
  },
];

const BY_KEY = new Map(FEATURES.map((f) => [f.key, f]));

export const featureDef = (key) => BY_KEY.get(key) || null;

/** A stored value, or the default when it is missing / not valid for the feature. */
export function valueOf(def, raw) {
  if (!def) return undefined;
  if (def.type === "toggle") return typeof raw === "boolean" ? raw : def.default;
  if (def.type === "choice") return def.options.some((o) => o.value === raw) ? raw : def.default;
  return def.default;
}

/** Stored JSON (string / object / null) → { key: value } for EVERY feature. */
export function resolveFeatures(raw) {
  let stored = {};
  if (typeof raw === "string" && raw.trim()) {
    try { stored = JSON.parse(raw) || {}; } catch { stored = {}; }
  } else if (raw && typeof raw === "object") {
    stored = raw;
  }
  return Object.fromEntries(FEATURES.map((f) => [f.key, valueOf(f, stored[f.key])]));
}

/** What to store: only known keys whose value differs from the default. */
export function normalizeFeatures(values) {
  const out = {};
  for (const f of FEATURES) {
    if (!values || !(f.key in values)) continue;
    const v = valueOf(f, values[f.key]);
    if (v !== f.default) out[f.key] = v;
  }
  return out;
}

/** 400 message for a PUT body that is not { key: value } of known features, or null. */
export function featuresShapeError(values) {
  if (!values || typeof values !== "object" || Array.isArray(values)) return "values must be an object of feature: value";
  for (const [key, v] of Object.entries(values)) {
    const def = BY_KEY.get(key);
    if (!def) return `Unknown feature "${key}"`;
    if (def.type === "toggle" && typeof v !== "boolean") return `"${def.label}" must be on or off`;
    if (def.type === "choice" && !def.options.some((o) => o.value === v)) return `"${def.label}" has no option "${v}"`;
  }
  return null;
}
