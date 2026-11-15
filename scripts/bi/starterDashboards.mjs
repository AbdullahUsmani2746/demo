// scripts/bi/starterDashboards.mjs — the ready-made BI dashboards.
//
// Pure data (questions + layouts), loaded by scripts/seed-bi-dashboards.mjs.
// Every question is a normal BI question: after seeding, edit it in the BI
// Designer like any other. Re-seeding updates questions / dashboards by NAME
// and never touches who they are assigned to.
//
// Widths are out of 4 columns. KPI cards show Today / 7 Days / Month / Prev.

// ── helpers ────────────────────────────────────────────────────────────────
const m = (key, agg) => (agg ? { key, agg } : { key });
const kpi = (name, dataset, measure, extra = {}) => ({
  name, dataset, description: extra.description,
  config: { dataset, measures: [measure], dimensions: [], filters: extra.filters || [], visual: { type: "kpi", options: extra.options || {} } },
});
const q = (name, dataset, cfg, description) => ({
  name, dataset, description,
  config: { dataset, dimensions: [], filters: [], period: "mtd", ...cfg },
});
const RED = "rust", GREEN = "moss", AMBER = "brass";

// Follow-up scenario for Free of Cost / Trial orders (lib/bi/followups.js):
// one follow-up per SO, owned by the customer's sales person, due when the row
// is flagged (7+ days after first dispatch); while open, the customer cannot
// get another Free of Cost / Trial order. Escalation steps are left EMPTY on
// purpose — no user ids are seeded: add them in BI Designer → question →
// Follow-up → Escalation (e.g. sales manager on the due day, management a day
// later). Everything here is editable in the BI Designer.
const SO_FOLLOWUP = {
  enabled: true,
  key: "d:order_no",
  owner: "sales_person",
  assignees: [],
  escalation: [],
  blockFoc: true,
};

// ── questions (shared between dashboards by name) ─────────────────────────
export const QUESTIONS = [
  // KPIs
  kpi("Sales", "sales", m("amount", "sum"), { description: "Sale amount of dispatched lines" }),
  kpi("Dispatch Qty (Ton)", "sales", m("qty_ton", "sum")),
  kpi("Dispatches", "sales", m("dispatches", "distinct")),
  kpi("Customers Served", "sales", m("customers", "distinct")),
  kpi("Receipts", "receipts", m("amount", "sum")),
  kpi("Payments", "payments", m("amount", "sum")),
  kpi("Total Receivables", "receivables", m("amount", "sum")),
  kpi("Overdue Receivables", "receivables", m("overdue", "sum"), { options: { rules: [{ op: ">", value: 100000000, color: RED }] } }),
  kpi("Stock in Hand (Ton)", "stock", m("qty_ton", "sum")),
  kpi("Payables", "payables", m("balance", "sum")),
  kpi("Purchases", "purchases", m("amount", "sum")),
  kpi("Purchase Qty (KG)", "purchases", m("qty_kg", "sum")),
  kpi("Vendors Used", "purchases", m("vendors", "distinct")),
  kpi("Produced (KG)", "production", m("produced_kg", "sum")),
  kpi("Issued to Production (KG)", "production", m("issued_kg", "sum"), { filters: [{ field: "movement", op: "eq", value: "Issued" }] }),
  kpi("Packing Used by Dispatch (KG)", "production", m("qty_kg", "sum"), { filters: [{ field: "movement", op: "eq", value: "Packing (dispatch)" }] }),
  kpi("Recovery Achievement %", "sales_targets", m("recovery_achievement"), {
    options: { rules: [{ op: "<", value: 50, color: RED }, { op: "<", value: 80, color: AMBER }, { op: ">=", value: 80, color: GREEN }] },
  }),
  q("Dispatches Not Yet Invoiced", "sales", {
    measures: [m("dispatches", "distinct"), m("amount", "sum")],
    filters: [{ field: "invoice_status", op: "eq", value: "Not invoiced" }],
    period: "all", lockPeriod: true, visual: { type: "number", options: { rules: [{ op: ">", value: 0, color: RED }] } },
  }, "All dispatches still waiting for an invoice"),

  // Sales
  q("Sales Trend — 12 Months", "sales", {
    measures: [m("amount", "sum"), m("qty_ton", "sum")], dimensions: [{ field: "dated", grain: "month" }],
    period: "m12", lockPeriod: true, visual: { type: "combo", options: {} },
  }, "Sale amount (bars) and tons (line) per month"),
  q("Top 10 Customers", "sales", {
    measures: [m("amount", "sum")], dimensions: [{ field: "customer" }], limit: 10, visual: { type: "barH", options: {} },
  }),
  q("Sales by Sales Person & Category", "sales", {
    measures: [m("amount", "sum")], dimensions: [{ field: "sales_person" }, { field: "customer_status" }], visual: { type: "stacked", options: {} },
  }),
  q("Sales by Main Category", "sales", {
    measures: [m("amount", "sum")], dimensions: [{ field: "main_category" }], limit: 20, visual: { type: "treemap", options: {} },
  }),
  q("Targets vs Actual — by Sales Person", "sales_targets", {
    measures: [m("recovery_achievement"), m("target_recovery"), m("actual_recovery"), m("target_qty_ton"), m("actual_qty_ton")],
    dimensions: [{ field: "sales_person" }], period: "mtd",
    visual: { type: "table", options: { rules: [{ op: "<", value: 50, color: RED }, { op: "<", value: 80, color: AMBER }, { op: ">=", value: 80, color: GREEN }] } },
  }, "Recovery achievement coloured red < 50%, amber < 80%, green ≥ 80%"),
  q("Open Sale Orders by Customer", "sale_orders", {
    measures: [m("orders", "distinct"), m("qty_kg", "sum"), m("amount", "sum")], dimensions: [{ field: "customer" }],
    filters: [{ field: "line_status", op: "eq", value: "Open" }], period: "m3", lockPeriod: true, limit: 15,
    visual: { type: "table", options: {} },
  }, "Open SO lines of the last 3 months"),
  q("Sale Returns by Customer — 6 Months", "sale_returns", {
    measures: [m("amount", "sum")], dimensions: [{ field: "customer" }], limit: 10, period: "m6", lockPeriod: true, visual: { type: "bar", options: {} },
  }),

  // Receivables / finance
  q("Receivables Aging", "receivables", {
    measures: [m("amount", "sum")], dimensions: [{ field: "bucket" }], visual: { type: "bar", options: { showLabels: true } },
  }, "Outstanding by days past credit terms (as of now)"),
  q("Top 10 Overdue Customers", "receivables", {
    measures: [m("overdue", "sum"), m("amount", "sum")], dimensions: [{ field: "customer" }, { field: "sales_person" }], limit: 10,
    visual: { type: "table", options: { rules: [{ op: ">", value: 10000000, color: RED }, { op: ">", value: 5000000, color: AMBER }] } },
  }, "Red above Rs. 10M overdue, amber above Rs. 5M"),
  q("Cash Collected by Month", "receipts", {
    measures: [m("amount", "sum")], dimensions: [{ field: "dated", grain: "month" }], period: "m12", lockPeriod: true, visual: { type: "area", options: {} },
  }),
  q("Receipts by Bank / Cash", "receipts", {
    measures: [m("amount", "sum")], dimensions: [{ field: "cash_bank" }], visual: { type: "donut", options: {} },
  }),
  q("Payments by Bank / Cash", "payments", {
    measures: [m("amount", "sum")], dimensions: [{ field: "cash_bank" }], visual: { type: "donut", options: {} },
  }),
  q("Bank & Cash Balances", "ledger", {
    measures: [m("net_debit", "sum")], dimensions: [{ field: "account_group" }, { field: "account" }],
    // Account Type follows Finance → Account Settings → Cash & Bank (lib/bi/datasets.js)
    filters: [{ field: "account_type", op: "eq", value: "Cash & Bank" }], period: "all", lockPeriod: true,
    visual: { type: "table", options: { rules: [{ op: "<", value: 0, color: RED }] } },
  }, "Current balance of every cash and bank account (red when negative)"),
  q("Expenses by Head", "ledger", {
    measures: [m("net_debit", "sum")], dimensions: [{ field: "head" }], filters: [{ field: "main_head", op: "eq", value: "EXPENSES" }],
    visual: { type: "donut", options: {} },
  }),
  q("Top 10 Expense Accounts", "ledger", {
    measures: [m("net_debit", "sum")], dimensions: [{ field: "account" }], filters: [{ field: "main_head", op: "eq", value: "EXPENSES" }],
    limit: 10, visual: { type: "barH", options: {} },
  }),
  q("Top 10 Vendors Owed", "payables", {
    measures: [m("balance", "sum")], dimensions: [{ field: "vendor" }], limit: 10, visual: { type: "barH", options: {} },
  }, "Largest payable balances right now"),

  // Dispatch & stores
  q("Daily Dispatch — This Month", "sales", {
    measures: [m("qty_ton", "sum"), m("dispatches", "distinct")], dimensions: [{ field: "dated", grain: "day" }],
    period: "mtd", lockPeriod: true, visual: { type: "combo", options: {} },
  }, "Tons (bars) and number of dispatches (line) per day"),
  q("Dispatch by Godown", "sales", {
    measures: [m("qty_ton", "sum")], dimensions: [{ field: "godown" }], visual: { type: "donut", options: {} },
  }),
  q("Top 10 Customers by Tons", "sales", {
    measures: [m("qty_ton", "sum")], dimensions: [{ field: "customer" }], limit: 10, visual: { type: "barH", options: {} },
  }),
  q("Stock by Godown & Category", "stock", {
    measures: [m("qty_ton", "sum")], dimensions: [{ field: "godown" }, { field: "item_category" }], visual: { type: "stacked", options: {} },
  }),
  q("Items Below Re-order Level", "stock", {
    measures: [m("qty_kg", "sum")], dimensions: [{ field: "item_code" }, { field: "item" }, { field: "godown" }],
    filters: [{ field: "below_reorder", op: "eq", value: "Yes" }], limit: 50, visual: { type: "table", options: {} },
  }),

  // Purchasing
  q("Purchases by Month — 12 Months", "purchases", {
    measures: [m("amount", "sum")], dimensions: [{ field: "dated", grain: "month" }], period: "m12", lockPeriod: true, visual: { type: "bar", options: {} },
  }),
  q("Top 10 Vendors (Purchases)", "purchases", {
    measures: [m("amount", "sum")], dimensions: [{ field: "vendor" }], limit: 10, visual: { type: "barH", options: {} },
  }),
  q("Local vs Imported", "purchases", {
    measures: [m("amount", "sum")], dimensions: [{ field: "import_type" }], visual: { type: "donut", options: {} },
  }),
  q("Purchase Rates by Item", "purchases", {
    measures: [m("rate", "avg"), m("rate", "min"), m("rate", "max"), m("qty_kg", "sum")], dimensions: [{ field: "item" }],
    sort: { by: "m3", dir: "desc" }, limit: 20, period: "m6", lockPeriod: true, visual: { type: "table", options: {} },
  }, "Average / lowest / highest rate over the last 6 months, top 20 items by quantity"),
  q("Raw Material in Stock", "stock", {
    measures: [m("qty_kg", "sum")], dimensions: [{ field: "item" }], filters: [{ field: "item_category", op: "eq", value: "RAW MATERIAL" }],
    limit: 20, visual: { type: "barH", options: {} },
  }),

  // Production
  q("Produced vs Issued — 12 Months", "production", {
    measures: [m("produced_kg", "sum"), m("issued_kg", "sum")], dimensions: [{ field: "dated", grain: "month" }],
    period: "m12", lockPeriod: true, visual: { type: "combo", options: {} },
  }),
  q("Top 10 Produced Items", "production", {
    measures: [m("produced_kg", "sum")], dimensions: [{ field: "item" }], limit: 10, visual: { type: "barH", options: {} },
  }),
  q("Production by Godown", "production", {
    measures: [m("produced_kg", "sum")], dimensions: [{ field: "godown" }], filters: [{ field: "movement", op: "eq", value: "Produced" }],
    visual: { type: "donut", options: {} },
  }),
  q("Material Issued by Category", "production", {
    measures: [m("issued_kg", "sum")], dimensions: [{ field: "item_category" }], visual: { type: "treemap", options: {} },
  }),
  q("Daily Production — This Month", "production", {
    measures: [m("produced_kg", "sum")], dimensions: [{ field: "dated", grain: "day" }], period: "mtd", lockPeriod: true, visual: { type: "area", options: {} },
  }),

  // ── Sale Order follow-up (Trial / FOC / bad payment …) ────────────────
  // One set of questions for the CEO and for every sales person: a sales
  // person automatically sees only their own customers' orders.
  q("Trials Awaiting Result (7+ days)", "so_followup", {
    measures: [m("orders", "distinct")],
    filters: [{ field: "order_type", op: "eq", value: "Trial Process" }, { field: "days_since_first_dispatch", op: "gte", value: 7 }],
    period: "all", lockPeriod: true, visual: { type: "number", options: { rules: [{ op: ">", value: 0, color: RED }] } },
  }, "Trial Process orders dispatched a week or more ago — time to ask for the result"),
  q("Orders Pending Approval", "so_followup", {
    measures: [m("orders", "distinct"), m("order_value", "sum")],
    filters: [{ field: "order_status", op: "eq", value: "Pending Approval" }],
    period: "all", lockPeriod: true, visual: { type: "number", options: { rules: [{ op: ">", value: 0, color: AMBER }] } },
  }, "Sale Orders waiting for approval"),
  q("Free of Cost Orders", "so_followup", {
    measures: [m("orders", "distinct"), m("dispatched_kg", "sum")],
    filters: [{ field: "order_type", op: "eq", value: "Free of Cost" }],
    visual: { type: "number", options: {} },
  }, "Free of Cost orders in the period"),
  q("Bad-Payment Customers with Open Orders", "so_followup", {
    measures: [m("orders", "distinct"), m("balance_kg", "sum")],
    filters: [{ field: "customer_status", op: "contains", value: "BAD" }, { field: "order_status", op: "eq", value: "Open" }],
    period: "all", lockPeriod: true, visual: { type: "number", options: { rules: [{ op: ">", value: 0, color: RED }] } },
  }, "Open Sale Orders of customers marked Bad Payment / Bad Debt"),
  q("Trial Process — Follow-up List", "so_followup", {
    measures: [m("days_since_dispatch", "max"), m("dispatched_kg", "sum")],
    dimensions: [{ field: "order_no" }, { field: "customer" }, { field: "sales_person" }, { field: "first_dispatch", grain: "day" }],
    filters: [{ field: "order_type", op: "eq", value: "Trial Process" }, { field: "dispatch_status", op: "neq", value: "Not dispatched" }],
    period: "all", lockPeriod: true, limit: 100,
    visual: { type: "table", options: { rowRules: [{ column: "m:days_since_dispatch", op: ">=", value: 7, color: RED, label: "Follow up" }] } },
    followup: SO_FOLLOWUP,
  }, "Every dispatched trial: who, when, and how many days ago — flagged “Follow up” at 7+ days"),
  q("Free of Cost — Order List", "so_followup", {
    measures: [m("ordered_kg", "sum"), m("dispatched_kg", "sum"), m("days_since_dispatch", "max")],
    dimensions: [{ field: "order_no" }, { field: "customer" }, { field: "sales_person" }, { field: "dispatch_status" }],
    filters: [{ field: "order_type", op: "eq", value: "Free of Cost" }],
    period: "m6", limit: 100, sort: { by: "m2", dir: "desc" },
    visual: { type: "table", options: { rowRules: [{ column: "m:days_since_dispatch", op: ">=", value: 7, color: RED, label: "Follow up" }] } },
    followup: SO_FOLLOWUP,
  }, "Free of Cost orders — flagged “Follow up” once dispatched 7+ days ago, so the sales person collects the feedback"),
  q("Free of Cost — Follow-up Due (7+ days)", "so_followup", {
    measures: [m("orders", "distinct")],
    filters: [{ field: "order_type", op: "eq", value: "Free of Cost" }, { field: "days_since_first_dispatch", op: "gte", value: 7 }],
    period: "m6", lockPeriod: true, visual: { type: "number", options: { rules: [{ op: ">", value: 0, color: RED }] } },
  }, "Free of Cost orders dispatched a week or more ago (last 6 months)"),
  q("Rate Under Negotiation — Open Orders", "so_followup", {
    measures: [m("ordered_kg", "sum"), m("balance_kg", "sum")],
    dimensions: [{ field: "order_no" }, { field: "customer" }, { field: "sales_person" }, { field: "dated", grain: "day" }],
    filters: [{ field: "order_type", op: "eq", value: "Rate Under Negotiation" }, { field: "order_status", op: "neq", value: "Closed" }],
    period: "all", lockPeriod: true, limit: 100, visual: { type: "table", options: {} },
  }, "Orders whose rate is still being agreed"),
  q("Bad-Payment Customers — Open Orders", "so_followup", {
    measures: [m("balance_kg", "sum"), m("order_value", "sum")],
    dimensions: [{ field: "order_no" }, { field: "customer" }, { field: "sales_person" }, { field: "dispatch_status" }],
    filters: [{ field: "customer_status", op: "contains", value: "BAD" }, { field: "order_status", op: "eq", value: "Open" }],
    period: "all", lockPeriod: true, limit: 100, visual: { type: "table", options: {} },
  }, "Open orders of customers marked Bad Payment / Bad Debt"),
  q("Special Orders by Sales Person", "so_followup", {
    measures: [m("orders", "distinct")],
    dimensions: [{ field: "sales_person" }, { field: "order_type" }],
    filters: [{ field: "order_type", op: "neq", value: "Normal" }],
    period: "m6", visual: { type: "stacked", options: {} },
  }, "Trial / Free of Cost / Rate-negotiation orders per sales person, last 6 months"),

  // ── Follow-up discipline (Follow-up Status dataset) ──────────────────
  q("Overdue Follow-ups", "followups", {
    measures: [m("items", "count")],
    filters: [{ field: "status", op: "eq", value: "Overdue" }],
    visual: { type: "number", options: { rules: [{ op: ">", value: 0, color: RED }] } },
  }, "Follow-ups due and not yet logged"),
  q("Follow-up Status by Sales Person", "followups", {
    measures: [m("items", "count")],
    dimensions: [{ field: "sales_person" }, { field: "status" }],
    visual: { type: "stacked", options: {} },
  }, "Overdue / Snoozed / Done per sales person"),
  q("Follow-up Results", "followups", {
    measures: [m("items", "count")],
    dimensions: [{ field: "result" }],
    filters: [{ field: "status", op: "eq", value: "Done" }],
    visual: { type: "donut", options: {} },
  }, "What customers said — approved, not suitable, other"),
  q("Escalated Follow-ups — List", "followups", {
    measures: [m("days_overdue_m", "max")],
    dimensions: [{ field: "item" }, { field: "customer" }, { field: "sales_person" }, { field: "scenario" }],
    filters: [{ field: "escalated", op: "eq", value: "Yes" }],
    limit: 100,
    visual: { type: "table", options: { rowRules: [{ column: "m:days_overdue_m", op: ">=", value: 1, color: RED, label: "Escalated" }] } },
  }, "Open follow-ups already escalated (escalation steps are set per scenario in the BI Designer)"),

  // ── Imports pipeline ────────────────────────────────────────────────
  q("Open Deals (not shipped)", "imports", {
    measures: [m("lcs", "distinct"), m("pkr_amount", "sum")],
    filters: [{ field: "stage", op: "in", value: ["Open Deal", "Expiring Soon"] }],
    visual: { type: "number", options: {} },
  }, "L/Cs opened but not shipped yet"),
  q("Shipments at Sea", "imports", {
    measures: [m("lcs", "distinct"), m("pkr_amount", "sum")],
    filters: [{ field: "stage", op: "in", value: ["In Transit", "ETA Passed"] }, { field: "hidden", op: "eq", value: "No" }],
    visual: { type: "number", options: {} },
  }, "Shipped (BL date given), not yet arrived"),
  q("Arriving in the Next 7 Days", "imports", {
    measures: [m("lcs", "distinct"), m("qty", "sum")],
    filters: [{ field: "stage", op: "eq", value: "In Transit" }, { field: "days_to_eta", op: "gte", value: 0 }, { field: "days_to_eta", op: "lte", value: 7 }],
    visual: { type: "number", options: { rules: [{ op: ">", value: 0, color: AMBER }] } },
  }, "In transit with ETA in the coming week"),
  q("Late Shipments (ETA passed)", "imports", {
    measures: [m("lcs", "distinct"), m("pkr_amount", "sum")],
    filters: [{ field: "stage", op: "eq", value: "ETA Passed" }, { field: "hidden", op: "eq", value: "No" }],
    visual: { type: "number", options: { rules: [{ op: ">", value: 0, color: RED }] } },
  }, "ETA has passed but no In-Bond / GRN yet"),
  q("Import Pipeline by Stage", "imports", {
    measures: [m("pkr_amount", "sum")], dimensions: [{ field: "stage" }],
    filters: [{ field: "stage", op: "neq", value: "Received (GRN)" }],
    visual: { type: "funnel", options: {} },
  }, "Value at each stage, deal to arrival"),
  q("Shipments at Sea — List", "imports", {
    measures: [m("qty", "sum"), m("pkr_amount", "sum")],
    dimensions: [{ field: "lc_no" }, { field: "supplier" }, { field: "vessel" }, { field: "eta", grain: "day" }, { field: "stage" }],
    filters: [{ field: "stage", op: "in", value: ["In Transit", "ETA Passed"] }, { field: "hidden", op: "eq", value: "No" }],
    limit: 100, visual: { type: "table", options: { rowRules: [{ column: "d:stage", op: "=", value: "ETA Passed", color: RED, label: "Late" }] } },
  }, "Every shipment at sea with its vessel and ETA"),
  q("Open Deals — List", "imports", {
    measures: [m("qty", "sum"), m("fc_amount", "sum")],
    dimensions: [{ field: "lc_no" }, { field: "supplier" }, { field: "item" }, { field: "stage" }],
    filters: [{ field: "stage", op: "in", value: ["Open Deal", "Expiring Soon", "LC Expired"] }],
    limit: 100, visual: { type: "table", options: { rowRules: [
      { column: "d:stage", op: "=", value: "LC Expired", color: RED, label: "Expired" },
      { column: "d:stage", op: "=", value: "Expiring Soon", color: AMBER, label: "Expiring" },
    ] } },
  }, "L/Cs not shipped yet — watch Expiring Soon / LC Expired"),
  q("Arrived — In Bond (to clear)", "imports", {
    measures: [m("qty", "sum"), m("pkr_amount", "sum")],
    dimensions: [{ field: "lc_no" }, { field: "supplier" }, { field: "item" }],
    filters: [{ field: "stage", op: "eq", value: "Arrived - In Bond" }],
    limit: 100, visual: { type: "table", options: {} },
  }, "Landed in bond, GRN not made yet"),
  q("Imports by Supplier", "imports", {
    measures: [m("pkr_amount", "sum")], dimensions: [{ field: "supplier" }],
    filters: [{ field: "stage", op: "neq", value: "Received (GRN)" }], limit: 10,
    visual: { type: "barH", options: {} },
  }, "Value still in the pipeline per supplier"),
];

// ── dashboards ───────────────────────────────────────────────────────────
const sec = (title, items) => ({ title, items: items.map(([name, width]) => ({ name, width })) });

export const DASHBOARDS = [
  {
    name: "Management Overview",
    description: "The whole business at a glance — sales, cash, receivables, stock and performance.",
    default_period: "mtd",
    filters: [],
    sections: [
      sec("Today at a glance", [["Sales", 1], ["Dispatch Qty (Ton)", 1], ["Receipts", 1], ["Payments", 1],
        ["Total Receivables", 1], ["Overdue Receivables", 1], ["Stock in Hand (Ton)", 1], ["Payables", 1]]),
      sec("Sales & cash", [["Sales Trend — 12 Months", 2], ["Cash Collected by Month", 2]]),
      sec("Receivables", [["Receivables Aging", 2], ["Top 10 Overdue Customers", 2]]),
      sec("Performance", [["Sales by Sales Person & Category", 2], ["Top 10 Customers", 2]]),
      sec("Finance", [["Bank & Cash Balances", 2], ["Expenses by Head", 2]]),
    ],
  },
  {
    name: "Sales Desk",
    description: "Sales, targets and recovery — per sales person and customer.",
    default_period: "mtd",
    filters: [{ field: "sales_person", label: "Sales Person" }, { field: "customer", label: "Customer" }],
    sections: [
      sec("This period", [["Sales", 1], ["Dispatch Qty (Ton)", 1], ["Customers Served", 1], ["Recovery Achievement %", 1]]),
      sec("Targets", [["Targets vs Actual — by Sales Person", 4]]),
      sec("Sales", [["Sales Trend — 12 Months", 2], ["Top 10 Customers", 2], ["Sales by Main Category", 2], ["Receivables Aging", 2]]),
      sec("Orders & returns", [["Open Sale Orders by Customer", 2], ["Sale Returns by Customer — 6 Months", 2]]),
    ],
  },
  {
    name: "Finance & Accounts",
    description: "Cash in and out, bank balances, receivables, payables and expenses.",
    default_period: "mtd",
    filters: [{ field: "sales_person", label: "Sales Person" }],
    sections: [
      sec("Cash", [["Receipts", 1], ["Payments", 1], ["Total Receivables", 1], ["Overdue Receivables", 1]]),
      sec("Bank & cash", [["Bank & Cash Balances", 2], ["Receipts by Bank / Cash", 1], ["Payments by Bank / Cash", 1]]),
      sec("Receivables & payables", [["Receivables Aging", 2], ["Top 10 Overdue Customers", 2], ["Top 10 Vendors Owed", 2], ["Cash Collected by Month", 2]]),
      sec("Expenses", [["Expenses by Head", 2], ["Top 10 Expense Accounts", 2]]),
    ],
  },
  {
    name: "Dispatch & Stores",
    description: "Dispatches, invoicing backlog, stock by godown and re-order alerts.",
    default_period: "mtd",
    filters: [{ field: "godown", label: "Godown" }],
    sections: [
      sec("This period", [["Dispatch Qty (Ton)", 1], ["Dispatches", 1], ["Dispatches Not Yet Invoiced", 1], ["Stock in Hand (Ton)", 1]]),
      sec("Dispatch", [["Daily Dispatch — This Month", 4], ["Dispatch by Godown", 2], ["Top 10 Customers by Tons", 2]]),
      sec("Stock", [["Stock by Godown & Category", 2], ["Items Below Re-order Level", 2]]),
      sec("Orders to fulfil", [["Open Sale Orders by Customer", 4]]),
    ],
  },
  {
    name: "Purchasing & Supply",
    description: "Purchases, vendors, rates, raw material stock and what is owed.",
    default_period: "mtd",
    filters: [{ field: "vendor", label: "Vendor" }, { field: "item_category", label: "Item Category" }],
    sections: [
      sec("This period", [["Purchases", 1], ["Purchase Qty (KG)", 1], ["Vendors Used", 1], ["Payables", 1]]),
      sec("Purchases", [["Purchases by Month — 12 Months", 2], ["Top 10 Vendors (Purchases)", 2], ["Local vs Imported", 1], ["Purchase Rates by Item", 3]]),
      sec("Stock & payables", [["Raw Material in Stock", 2], ["Top 10 Vendors Owed", 2]]),
    ],
  },
  {
    name: "Production",
    description: "Output, material issued, packing used and daily production.",
    default_period: "mtd",
    filters: [{ field: "godown", label: "Godown" }, { field: "item_category", label: "Item Category" }],
    sections: [
      sec("This period", [["Produced (KG)", 1], ["Issued to Production (KG)", 1], ["Packing Used by Dispatch (KG)", 1], ["Stock in Hand (Ton)", 1]]),
      sec("Trend", [["Produced vs Issued — 12 Months", 2], ["Daily Production — This Month", 2]]),
      sec("Breakdown", [["Top 10 Produced Items", 2], ["Production by Godown", 1], ["Material Issued by Category", 1]]),
    ],
  },
  {
    name: "Sale Order Follow-up",
    description: "Trial, Free of Cost, rate-negotiation and bad-payment orders — what was dispatched and what needs a follow-up. A sales person sees only their own customers.",
    default_period: "m3",
    filters: [{ field: "sales_person", label: "Sales Person" }, { field: "customer", label: "Customer" }],
    sections: [
      sec("Needs attention", [["Trials Awaiting Result (7+ days)", 1], ["Free of Cost — Follow-up Due (7+ days)", 1], ["Orders Pending Approval", 1], ["Bad-Payment Customers with Open Orders", 1]]),
      sec("Trial process", [["Trial Process — Follow-up List", 4]]),
      sec("Free of cost & rates", [["Free of Cost — Order List", 2], ["Rate Under Negotiation — Open Orders", 2]]),
      sec("Customers & sales people", [["Bad-Payment Customers — Open Orders", 2], ["Special Orders by Sales Person", 2]]),
      sec("Follow-up discipline", [["Overdue Follow-ups", 1], ["Follow-up Results", 1], ["Follow-up Status by Sales Person", 2], ["Escalated Follow-ups — List", 4]]),
    ],
  },
  {
    name: "Imports Desk",
    description: "Every L/C from deal to arrival: open deals, shipments at sea, ETAs this week, late shipments and goods in bond.",
    default_period: "mtd",
    filters: [{ field: "supplier", label: "Supplier" }, { field: "import_type", label: "Import Type" }],
    sections: [
      sec("Pipeline", [["Open Deals (not shipped)", 1], ["Shipments at Sea", 1], ["Arriving in the Next 7 Days", 1], ["Late Shipments (ETA passed)", 1]]),
      sec("At sea", [["Shipments at Sea — List", 4]]),
      sec("Deals & arrivals", [["Open Deals — List", 2], ["Arrived — In Bond (to clear)", 2]]),
      sec("Overview", [["Import Pipeline by Stage", 2], ["Imports by Supplier", 2]]),
    ],
  },
  {
    // The CEO's landing page: every part of the business on one screen.
    // Assigned to the CEO user (BI Designer → Dashboards → Assign).
    name: "CEO Dashboard",
    description: "Sales, cash, receivables, payables, purchasing, production, stock and exceptions — the whole company on one screen.",
    default_period: "mtd",
    filters: [{ field: "sales_person", label: "Sales Person" }, { field: "customer", label: "Customer" }],
    sections: [
      sec("Headline", [
        ["Sales", 1], ["Dispatch Qty (Ton)", 1], ["Receipts", 1], ["Payments", 1],
        ["Total Receivables", 1], ["Overdue Receivables", 1], ["Payables", 1], ["Stock in Hand (Ton)", 1],
        ["Purchases", 1], ["Produced (KG)", 1], ["Recovery Achievement %", 1], ["Dispatches Not Yet Invoiced", 1],
      ]),
      sec("Sales", [
        ["Sales Trend — 12 Months", 2], ["Top 10 Customers", 2],
        ["Sales by Sales Person & Category", 2], ["Sales by Main Category", 2],
        ["Targets vs Actual — by Sales Person", 4],
      ]),
      sec("Cash & receivables", [
        ["Cash Collected by Month", 2], ["Bank & Cash Balances", 2],
        ["Receivables Aging", 2], ["Top 10 Overdue Customers", 2],
      ]),
      sec("Purchasing, payables & costs", [
        ["Purchases by Month — 12 Months", 2], ["Top 10 Vendors Owed", 2],
        ["Expenses by Head", 2], ["Top 10 Expense Accounts", 2],
      ]),
      sec("Operations", [
        ["Daily Dispatch — This Month", 2], ["Produced vs Issued — 12 Months", 2],
        ["Stock by Godown & Category", 2], ["Items Below Re-order Level", 2],
      ]),
      sec("Exceptions", [
        ["Orders Pending Approval", 2], ["Free of Cost Orders", 2],
        ["Overdue Follow-ups", 2], ["Sale Returns by Customer — 6 Months", 2],
      ]),
    ],
  },
];
