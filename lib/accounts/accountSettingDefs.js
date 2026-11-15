// lib/accounts/accountSettingDefs.js
// ============================================================
// Finance > Account Settings — the ONE list of every account / account group
// the system posts to (or picks parties from) automatically. Client-safe (no
// Prisma): the settings screen renders from it; the server helper
// (lib/accounts/accountSettings.js) resolves values from the account_settings
// table (prisma/sql/2026-10-24_account_settings.sql seeds them).
//
// Never hard-code an account or macno in code again: add a definition here,
// seed it in a new SQL file (INSERT ... ON CONFLICT DO NOTHING) and read it
// with getAccount / requireAccount / getAccountGroup / getAccountList.
//
//   kind ACCOUNT  one posting account (acno)
//   kind GROUP    one or more MAIN ACCOUNTS (macno) — their accounts are the
//                 parties (customers, vendors, ...) or cash / bank accounts.
//                 SMS groups the chart by ACNO.macno, not by a parent account.
//   kind LIST     a list of individual accounts (acno)
//   required      true  → a posting that needs it is refused (422) while unset
//                 false → optional: when unset the posting step is skipped
//   postings      where the account is used: [{ doc, side: "Dr"|"Cr", contra }]
//
// There are deliberately NO code fallbacks: a value that is not in the table
// is "not set". Run the SQL seed before deploying code that reads a new key.
//
// Item lines resolve per ITEM CATEGORY first (CATEGORY_ACCOUNT_COLUMNS, edited
// on the same screen) and fall back to the matching default below.
// ============================================================

export const ACCOUNT_SETTING_SECTIONS = [
  { id: "ITEMS", title: "Item Posting Defaults", description: "Used for an item line when its item category has no account of its own (see Item Category Accounts below)." },
  { id: "TAXES", title: "Sales Tax", description: "Sales tax split out of sale and purchase documents. An item category can override these." },
  { id: "FREIGHT", title: "Freight & Transport", description: "Transport charges entered on GRNs, purchase invoices and dispatches." },
  { id: "SERVICES", title: "Services", description: "Service Invoices: each service posts to its own expense account; this is the fallback." },
  { id: "COSTING", title: "Costing Journals", description: "COGM / COGS and material-issuance journal vouchers generated from the costing reports." },
  { id: "POS", title: "Point of Sale", description: "Counter sales and returns." },
  { id: "PARTIES", title: "Party Groups", description: "Main accounts (macno) whose accounts are listed as customers, vendors, transporters, cash and bank." },
  { id: "IMPORTS", title: "Imports & LC", description: "Letter of credit and import accounts." },
  { id: "VOUCHERS", title: "Voucher Rules", description: "Restrictions on manual vouchers." },
  { id: "PAYROLL", title: "Payroll", description: "The payroll journal voucher posted from HR → Payroll. A pay component or an employee's own advance / loan account overrides these." },
];

const itemDefault = (key, label, side, doc, contra, help) => ({
  key, kind: "ACCOUNT", section: "ITEMS", label, help, usedBy: [doc],
  postings: [{ doc, side, contra }], required: true,
});

export const ACCOUNT_SETTING_DEFS = [
  // ── Item posting defaults (category override → these) ───────────────────
  itemDefault("sales", "Sales", "Cr", "Dispatch / Sale Invoice", "Customer (Dr)",
    "Credited with the goods value of a dispatch / sale invoice line."),
  itemDefault("purchase", "Purchases", "Dr", "GRN / Purchase Invoice", "Vendor (Cr)",
    "Debited with the goods value of a GRN / purchase invoice line."),
  itemDefault("sales_return", "Sales Return", "Dr", "Sale Return", "Customer (Cr)",
    "Debited with the goods value of a sale return line."),
  itemDefault("purchase_return", "Purchase Return", "Cr", "Purchase Return", "Vendor (Dr)",
    "Credited with the goods value of a purchase return line."),
  itemDefault("stock", "Stock (Issue / Production / Transfer)", "Cr", "Material Issue / Production / Transfer", "—",
    "Account stamped on material issue, production and godown transfer lines (quantity movements) when the item's category has no stock account."),

  // ── Taxes ────────────────────────────────────────────────────────────────
  {
    key: "sales_tax_output", kind: "ACCOUNT", section: "TAXES",
    label: "Sales Tax on Sales (Output Tax)",
    help: "Sales tax charged to customers: credited on a dispatch / sale invoice, debited on a sale return.",
    usedBy: ["Dispatch", "Sale Invoice", "Dispatch Invoicing", "Sale Return"],
    postings: [
      { doc: "Dispatch / Sale Invoice", side: "Cr", contra: "Customer (Dr)" },
      { doc: "Sale Return", side: "Dr", contra: "Customer (Cr)" },
    ],
    required: true,
  },
  {
    key: "sales_tax_input", kind: "ACCOUNT", section: "TAXES",
    label: "Sales Tax on Purchases (Input Tax)",
    help: "Claimable sales tax on purchases: debited on a GRN / purchase / service invoice, credited on a purchase return.",
    usedBy: ["GRN", "Purchase Invoice", "Service Invoice", "Purchase Return"],
    postings: [
      { doc: "GRN / Purchase / Service Invoice", side: "Dr", contra: "Vendor (Cr)" },
      { doc: "Purchase Return", side: "Cr", contra: "Vendor (Dr)" },
    ],
    required: true,
  },

  // ── Freight ──────────────────────────────────────────────────────────────
  {
    key: "freight_inward", kind: "ACCOUNT", section: "FREIGHT",
    label: "Transportation Inward",
    help: "Debited with the transport amount of a GRN / purchase invoice; the transporter is credited.",
    usedBy: ["GRN", "Purchase Invoice"],
    postings: [{ doc: "GRN / Purchase Invoice", side: "Dr", contra: "Transporter (Cr)" }],
    required: true,
  },
  {
    key: "freight_outward", kind: "ACCOUNT", section: "FREIGHT",
    label: "Transportation Outward",
    help: "Debited with the transport amount of a dispatch / sale invoice; the transporter is credited.",
    usedBy: ["Dispatch", "Sale Invoice", "Dispatch Invoicing"],
    postings: [{ doc: "Dispatch / Sale Invoice", side: "Dr", contra: "Transporter (Cr)" }],
    required: true,
  },

  // ── Services ─────────────────────────────────────────────────────────────
  {
    key: "service_expense", kind: "ACCOUNT", section: "SERVICES",
    label: "Service Expense (default)",
    help: "Debited with a Service Invoice line when neither the service nor its category has an expense account of its own (Setup → Services / Service Categories).",
    usedBy: ["Service Invoice"],
    postings: [{ doc: "Service Invoice", side: "Dr", contra: "Vendor (Cr)" }],
    required: false,
  },

  // ── Costing journals ─────────────────────────────────────────────────────
  {
    key: "conversion_cost", kind: "ACCOUNT", section: "COSTING",
    label: "Conversion Cost (COGM credit)",
    help: "Credited by the COGM journal with the conversion cost absorbed into production. Also excluded from the conversion-overhead pool.",
    usedBy: ["Cost of Goods Manufactured journal", "Costing"],
    postings: [{ doc: "COGM journal", side: "Cr", contra: "Finished-goods stock (Dr)" }],
    required: true,
  },
  {
    key: "cogs", kind: "ACCOUNT", section: "COSTING",
    label: "Cost of Goods Sold",
    help: "Debited by the COGS journal with the cost of goods dispatched.",
    usedBy: ["Cost of Goods Sold journal"],
    postings: [{ doc: "COGS journal", side: "Dr", contra: "Finished-goods stock (Cr)" }],
    required: true,
  },
  {
    key: "conversion_overheads", kind: "GROUP", section: "COSTING",
    label: "Conversion Overhead Accounts",
    help: "Main accounts whose net expense for the month is the conversion-cost pool spread over finished goods produced.",
    usedBy: ["Costing — conversion cost rate"],
    postings: [],
    required: true,
  },
  {
    key: "stock_lost", kind: "ACCOUNT", section: "COSTING",
    label: "Stock Lost (cleaning issuances)",
    help: "Debited by the Direct Material Issuance journal for cleaning issuances.",
    usedBy: ["Direct Material Issuance journal"],
    postings: [{ doc: "Material issuance — cleaning", side: "Dr", contra: "Item stock account (Cr)" }],
    required: false,
  },
  {
    key: "qc_cost", kind: "ACCOUNT", section: "COSTING",
    label: "QC / Lab Sample Cost",
    help: "Debited by the Direct Material Issuance journal for lab / QC sample issuances.",
    usedBy: ["Direct Material Issuance journal"],
    postings: [{ doc: "Material issuance — lab / QC", side: "Dr", contra: "Item stock account (Cr)" }],
    required: false,
  },

  // ── POS ──────────────────────────────────────────────────────────────────
  {
    key: "pos_sales", kind: "ACCOUNT", section: "POS",
    label: "POS Sales (default)",
    help: "Sales account for POS lines whose item category has no POS account of its own.",
    usedBy: ["POS Sale", "POS Return"],
    postings: [{ doc: "POS Sale", side: "Cr", contra: "Cash / card (Dr)" }],
    required: false,
  },

  // ── Party groups (macno) ─────────────────────────────────────────────────
  {
    key: "customers", kind: "GROUP", section: "PARTIES", label: "Customers",
    help: "Customer accounts are listed from (and created under) these main accounts. The first is the default for new customers.",
    usedBy: ["Dispatch", "Sale Invoice", "Sale Order", "Receipt", "Customer Setup", "Customer Aging", "Sales reports"],
    postings: [{ doc: "Dispatch / Sale Invoice", side: "Dr", contra: "Sales + sales tax (Cr)" }],
    required: true,
  },
  {
    key: "vendors", kind: "GROUP", section: "PARTIES", label: "Vendors",
    help: "Supplier accounts for purchase orders, GRNs, purchase / service invoices. The first is the default for new vendors.",
    usedBy: ["Purchase Order", "GRN", "Purchase Invoice", "Service Invoice", "Payment", "Vendor Setup"],
    postings: [{ doc: "GRN / Purchase Invoice", side: "Cr", contra: "Purchases + input tax (Dr)" }],
    required: true,
  },
  {
    key: "transporters", kind: "GROUP", section: "PARTIES", label: "Transporters",
    help: "Transporter accounts credited with transport charges (the Transporter pickers on GRN / dispatch / invoices).",
    usedBy: ["GRN", "Dispatch", "Sale Invoice"],
    postings: [{ doc: "Freight", side: "Cr", contra: "Transportation inward / outward (Dr)" }],
    required: true,
  },
  {
    key: "cash_bank", kind: "GROUP", section: "PARTIES", label: "Cash & Bank",
    help: "Main accounts of cash and bank accounts — the 'Paid From' / 'Received At' list on payment and receipt vouchers, cheque deposits and funds reports.",
    usedBy: ["Payment", "Receipt", "Checks in Hand", "Funds Flow / Position", "Cash & Bank Book"],
    postings: [
      { doc: "Receipt", side: "Dr", contra: "Party (Cr)" },
      { doc: "Payment", side: "Cr", contra: "Party / expense (Dr)" },
    ],
    required: true,
  },
  {
    key: "fixed_asset_vendors", kind: "GROUP", section: "PARTIES", label: "Fixed Asset Vendors",
    help: "Vendors listed on the Fixed Assets GRN.",
    usedBy: ["Fixed Assets GRN"],
    postings: [],
    required: false,
  },

  // ── Imports ──────────────────────────────────────────────────────────────
  {
    key: "lc_accounts", kind: "GROUP", section: "IMPORTS", label: "LC / Import Accounts",
    help: "Main accounts of letter-of-credit / import accounts (LC setup, In-Bond, Ex-Bond, LC vendor pickers).",
    usedBy: ["Letter of Credit", "In-Bond", "Ex-Bond", "LC Setup"],
    postings: [],
    required: false,
  },
  {
    key: "beneficiaries", kind: "GROUP", section: "IMPORTS", label: "LC Beneficiaries",
    help: "Main accounts of foreign suppliers named as LC beneficiaries.",
    usedBy: ["Letter of Credit", "Beneficiary Setup"],
    postings: [],
    required: false,
  },

  // ── Voucher rules ────────────────────────────────────────────────────────
  {
    key: "blocked_voucher_accounts", kind: "LIST", section: "VOUCHERS",
    label: "Accounts not allowed on manual vouchers",
    help: "Control accounts (sales, stock, ...) that only automatic postings may touch. They are not offered on payment / receipt / journal lines.",
    usedBy: ["Payment", "Receipt", "Journal"],
    postings: [],
    required: false,
  },

  // ── Payroll (lib/hr/payroll/post.js) ─────────────────────────────────────
  {
    key: "payroll_salary_expense", kind: "ACCOUNT", section: "PAYROLL",
    label: "Salaries & Wages Expense",
    help: "Debited with basic pay and every allowance that has no account of its own (HR → Salary → Pay components), by cost centre.",
    usedBy: ["Payroll journal"], postings: [{ doc: "Payroll journal", side: "Dr", contra: "Salaries Payable (Cr)" }], required: true,
  },
  {
    key: "payroll_overtime_expense", kind: "ACCOUNT", section: "PAYROLL",
    label: "Overtime Expense",
    help: "Debited with overtime pay. When not set, overtime goes to Salaries & Wages Expense.",
    usedBy: ["Payroll journal"], postings: [{ doc: "Payroll journal", side: "Dr", contra: "Salaries Payable (Cr)" }], required: false,
  },
  {
    key: "payroll_salary_payable", kind: "ACCOUNT", section: "PAYROLL",
    label: "Salaries Payable",
    help: "Credited with the net pay of the run; cleared by the salary payment voucher.",
    usedBy: ["Payroll journal"], postings: [{ doc: "Payroll journal", side: "Cr", contra: "Salary expense (Dr)" }], required: true,
  },
  {
    key: "payroll_eobi_expense", kind: "ACCOUNT", section: "PAYROLL",
    label: "EOBI — Employer Contribution (expense)",
    help: "Debited with the employer EOBI share.",
    usedBy: ["Payroll journal"], postings: [{ doc: "Payroll journal", side: "Dr", contra: "EOBI Payable (Cr)" }], required: true,
  },
  {
    key: "payroll_eobi_payable", kind: "ACCOUNT", section: "PAYROLL",
    label: "EOBI Payable",
    help: "Credited with the employee and employer EOBI shares.",
    usedBy: ["Payroll journal"], postings: [{ doc: "Payroll journal", side: "Cr", contra: "Salary / EOBI expense (Dr)" }], required: true,
  },
  {
    key: "payroll_tax_payable", kind: "ACCOUNT", section: "PAYROLL",
    label: "Income Tax Deducted on Salaries (payable)",
    help: "Credited with the income tax withheld from salaries.",
    usedBy: ["Payroll journal"], postings: [{ doc: "Payroll journal", side: "Cr", contra: "Salary expense (Dr)" }], required: true,
  },
  {
    key: "payroll_staff_advances", kind: "ACCOUNT", section: "PAYROLL",
    label: "Staff Advances (default)",
    help: "Credited with advance recoveries of employees who have no advance account of their own (Employee → advance account).",
    usedBy: ["Payroll journal"], postings: [{ doc: "Payroll journal", side: "Cr", contra: "Salary expense (Dr)" }], required: true,
  },
  {
    key: "payroll_staff_loans", kind: "ACCOUNT", section: "PAYROLL",
    label: "Staff Loans (default)",
    help: "Credited with loan instalments of employees who have no loan account of their own (Employee → loan account).",
    usedBy: ["Payroll journal"], postings: [{ doc: "Payroll journal", side: "Cr", contra: "Salary expense (Dr)" }], required: true,
  },
  {
    key: "payroll_other_deductions", kind: "ACCOUNT", section: "PAYROLL",
    label: "Other Salary Deductions (default)",
    help: "Credited with deductions (pay components and one-off deductions) that have no account of their own.",
    usedBy: ["Payroll journal"], postings: [{ doc: "Payroll journal", side: "Cr", contra: "Salary expense (Dr)" }], required: true,
  },
];

// Per-category accounts (ItemCategory columns) — shown as a table on the
// settings screen. `fallbackKey` is the default used when the cell is empty.
export const CATEGORY_ACCOUNT_COLUMNS = [
  { key: "sale_acno", label: "Sales", fallbackKey: "sales", help: "Credited by dispatch / sale invoice lines of this category." },
  { key: "purchase_acno", label: "Purchases", fallbackKey: "purchase", help: "Debited by GRN / purchase invoice lines of this category." },
  { key: "sale_return_acno", label: "Sales Return", fallbackKey: "sales_return", help: "Debited by sale return lines of this category." },
  { key: "purchase_return_acno", label: "Purchase Return", fallbackKey: "purchase_return", help: "Credited by purchase return lines of this category." },
  { key: "sales_tax_acno", label: "Sales Tax (Sales)", fallbackKey: "sales_tax_output", help: "Output sales tax for this category's sales." },
  { key: "purchase_tax_acno", label: "Sales Tax (Purchases)", fallbackKey: "sales_tax_input", help: "Input sales tax for this category's purchases." },
  { key: "stock_acno", label: "Stock", fallbackKey: "stock", help: "Material issue / transfer lines, and the credit side of the material-issuance journal." },
  { key: "pos_acno", label: "POS Sales", fallbackKey: "pos_sales", help: "POS sale / return lines of this category." },
  { key: "cogs_acno", label: "COGS", help: "Cost of goods sold for this category (costing)." },
  { key: "cogm_acno", label: "COGM", help: "Cost of goods manufactured for this category (costing)." },
];

export const ACCOUNT_SETTING_BY_KEY = Object.fromEntries(
  ACCOUNT_SETTING_DEFS.map((d) => [d.key, d]),
);

/** The message shown when a posting needs an account that is not set. */
export const missingAccountMessage = (key) =>
  `Set '${ACCOUNT_SETTING_BY_KEY[key]?.label ?? key}' in Finance → Account Settings`;
