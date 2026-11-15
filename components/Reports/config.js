import { format } from "date-fns";
import { de, fi } from "date-fns/locale";
import {
  CUSTOMER_GROUP_PARAM,
  VENDOR_GROUP_PARAM,
  PARTY_GROUP_PARAM,
  CASH_BANK_GROUP_PARAM,
  LC_GROUP_PARAM,
  BENEFICIARY_GROUP_PARAM,
} from "@/lib/accounts/groupParams";
import { engineColumns, HR_REPORTS, hrEngineKey } from "@/lib/hr/reports/catalog";
import { fiscalYearStart } from "@/lib/hr/payroll/compute";

// report-config-helpers.js

// 1st of the current month as dd-MM-yyyy — where the Stock / FG Stock report
// opens the Stock Ledger from. Its opening comes from the Monthly Opening
// Stock, so there is no need to start in 2000.
const currentMonthStartDMY = () => {
  const d = new Date();
  return format(new Date(d.getFullYear(), d.getMonth(), 1), "dd-MM-yyyy");
};

// Drill trail (CLAUDE.md rule 15): the Stock Ledger of one item, for the
// period / godown the summary report was run for. Dates stay in the
// dd-MM-yyyy form the report filters use.
const stockLedgerHref = ({ item, dateFrom, dateTo, godown }) => {
  const p = new URLSearchParams();
  p.set("item", String(item));
  if (dateFrom) p.set("dateFrom", String(dateFrom));
  if (dateTo) p.set("dateTo", String(dateTo));
  if (godown) p.set("godown", String(godown));
  return `/accounting/reports/stockLedger?${p.toString()}`;
};
// 1st of the month of a dd-MM-yyyy date ("As Of" reports drill from there).
const monthStartOfDMY = (dmy) => {
  const m = /^(\d{2})-(\d{2})-(\d{4})$/.exec(String(dmy || ""));
  return m ? `01-${m[2]}-${m[3]}` : currentMonthStartDMY();
};

// A select filter's value — plain, or { value, label } when it is a default.
const filterValue = (v) => (v && typeof v === "object" && !Array.isArray(v) && "value" in v ? v.value : v);

// /accounting/reports/<report>?… for a drill step. Empty / "all" / false
// values are left out, multi-select arrays are joined with commas.
const reportHref = (report, params = {}) => {
  const p = new URLSearchParams();
  Object.entries(params).forEach(([k, raw]) => {
    let v = filterValue(raw);
    if (Array.isArray(v)) v = v.map(filterValue).filter((x) => x !== "" && x != null).join(",");
    if (v === undefined || v === null || v === "" || v === false || v === "all") return;
    p.set(k, String(v));
  });
  return `/accounting/reports/${report}?${p.toString()}`;
};
// The filters a drill step carries over unchanged.
const pickFilters = (filters, names) => Object.fromEntries(names.map((n) => [n, filters?.[n]]));

// One layout for every summary type of a report: fields the columns of the
// chosen type do not have are dropped (groups left empty go too), so the
// layout always names real columns.
const fitLayout = (report, build) => (filters) => {
  const spec = build(filters);
  if (!spec) return spec;
  const cfg = REPORT_CONFIG[report];
  const cols = (cfg?.getColumns ? cfg.getColumns(filters) : cfg?.columns) || [];
  const have = new Set(cols.map((c) => c.field ?? c.colId));
  const keep = (fields) => (fields || []).filter((f) => typeof f !== "string" || have.has(f));
  const out = { ...spec, pinned: keep(spec.pinned) };
  if (spec.groups) out.groups = spec.groups.map((g) => ({ ...g, fields: keep(g.fields) })).filter((g) => g.fields.length);
  if (spec.views) out.views = spec.views.map((v) => (v.fields ? { ...v, fields: keep(v.fields) } : v));
  if (spec.rowGroupBy) out.rowGroupBy = [].concat(spec.rowGroupBy).filter((g) => have.has(typeof g === "string" ? g : g.field));
  if (spec.unitSwitch) {
    const options = spec.unitSwitch.options.map((o) => ({ ...o, fields: keep(o.fields) })).filter((o) => o.fields.length);
    out.unitSwitch = options.length > 1 ? { ...spec.unitSwitch, options } : undefined;
  }
  if (spec.card) {
    const ok = (f) => typeof f !== "string" || have.has(f);
    out.card = { ...spec.card, figures: (spec.card.figures || []).filter(ok) };
    if (!ok(spec.card.title)) delete out.card.title;
    if (!ok(spec.card.subtitle)) delete out.card.subtitle;
  }
  return out;
};

// Drill trail: the Account Ledger of one account for a period.
const accountLedgerHref = ({ account, dateFrom, dateTo }) => reportHref("accountLedger", { account, dateFrom, dateTo });
// Aging reports open the ledger from the start of the books (as their old
// drillDown did) so every open invoice is in view.
const BOOKS_START_DMY = "01-01-2000";

// Customer / Vendor Aging share columns (vendor rows reuse the customer field
// names). Summary views are one row per party; detail views one row per
// invoice, grouped by party with subtotals.
const AGING_BUCKETS = ["currentAmount", "days1To30", "days31To60", "days61To90", "days91To120", "daysOver120"];
const agingLayout = (filters) => {
  const view = filterValue(filters?.view) || "detailed";
  const over60 = { label: "Over 60 days", type: "currency", value: (r) => (Number(r.days61To90) || 0) + (Number(r.days91To120) || 0) + (Number(r.daysOver120) || 0) };
  if (view === "summary" || view === "noInterval") {
    return {
      pinned: ["customerCode", "customerName"],
      groups: [
        { id: "due", label: "Due status", fields: ["totalOutstanding", "currentDueAmount", "overdueAmount"], foldTo: "totalOutstanding" },
        { id: "aging", label: "Aging", fields: AGING_BUCKETS },
      ],
      card: { title: "customerName", subtitle: "customerCode", figures: ["totalOutstanding", "days1To30", "days31To60", over60] },
    };
  }
  return {
    pinned: ["invoiceNo", "invoiceDate"],
    groups: [
      { id: "inv", label: "Invoice", fields: ["customerName", "customerCode", "dueDate", "salePoNumber", "dispatchNo"] },
      { id: "amt", label: "Amounts", fields: ["invoiceAmount", "directReceipts", "outstandingAmount", "daysOutstanding"], foldTo: "outstandingAmount" },
      { id: "due", label: "Due status", fields: ["currentDueAmount", "overdueAmount"] },
      { id: "aging", label: "Aging", fields: AGING_BUCKETS },
    ],
    views: [
      {
        id: "aging",
        label: "Aging",
        fields: ["dueDate", "invoiceAmount", "directReceipts", "outstandingAmount", "daysOutstanding", "currentDueAmount", "overdueAmount", ...AGING_BUCKETS],
      },
      { id: "all", label: "Everything" },
    ],
    defaultView: "aging",
    rowGroupBy: [{ field: "customerCode", label: (r) => [r.customerCode, r.customerName].filter(Boolean).join(" — "), subtotalLabel: "Total" }],
    card: {
      title: "customerName",
      subtitle: (r) => [r.invoiceNo && `INV ${r.invoiceNo}`, r.daysOutstanding ? `${r.daysOutstanding} days` : ""].filter(Boolean).join(" · "),
      figures: ["outstandingAmount", "overdueAmount", "invoiceAmount", over60],
    },
  };
};
// summary row → that party's invoices; any row → the party's ledger.
// Invoice rows open their voucher from tran_id + tran_code.
const agingDrill = (report, partyFilter) => [
  {
    label: "Open invoices",
    when: (row, filters) => !!row.customerCode && ["summary", "noInterval"].includes(filterValue(filters?.view)),
    href: (row, filters) =>
      reportHref(report, { reportDate: filters.reportDate, [partyFilter]: row.customerCode, view: "detailed", sale_person: filters.sale_person }),
  },
  {
    label: "Open account ledger",
    when: (row) => !!row.customerCode && row.customerCode !== "-",
    href: (row, filters) => accountLedgerHref({ account: row.customerCode, dateFrom: BOOKS_START_DMY, dateTo: filters.reportDate }),
  },
];

// Trial Balance / P&L: the API returns one flat row per account
// (trialBalanceAccountRows in app/api/reports/[reportType]/route.js); the
// account tree becomes group rows (main group › sub group › main account)
// with subtotals, codes padded as the old printout (01 · 01 · 001). Debit /
// Credit are the account's balance on its side, Balance = Debit − Credit
// (+ Dr, − Cr), so every subtotal is a plain sum. The "Tree" view keeps only
// the account and its balances; Dr / Cr movement are the gross postings.
const ACCOUNT_TREE_GROUPS = [
  { field: "mbscd", title: "Main group", label: (r) => [r.mbscd !== "" && r.mbscd != null ? String(r.mbscd).padStart(2, "0") : "", r.mbscdName].filter(Boolean).join(" "), subtotalLabel: "Total" },
  { field: "bscd", title: "Sub group", label: (r) => [r.bscd !== "" && r.bscd != null ? String(r.bscd).padStart(2, "0") : "", r.bscdName].filter(Boolean).join(" "), subtotalLabel: "Total" },
  { field: "macno", title: "Main account", label: (r) => [r.macno !== "" && r.macno != null ? String(r.macno).padStart(3, "0") : "", r.macaccount].filter(Boolean).join(" "), subtotalLabel: "Total" },
];
const accountTreeLayout = {
  pinned: ["acno", "account"],
  groups: [
    { id: "tree", label: "Account tree", fields: ["mbscd", "mbscdName", "bscd", "bscdName", "macno", "macaccount"] },
    { id: "move", label: "Movement", fields: ["dr_movement", "cr_movement"] },
    { id: "bal", label: "Balance", fields: ["debit", "credit", "balance"], foldTo: "balance" },
  ],
  views: [
    { id: "tree", label: "Tree", fields: ["debit", "credit", "balance"] },
    { id: "movement", label: "With movement", fields: ["dr_movement", "cr_movement", "debit", "credit", "balance"] },
    { id: "all", label: "Everything" },
  ],
  defaultView: "tree",
  rowGroupBy: ACCOUNT_TREE_GROUPS,
  card: { title: "account", subtitle: "acno", figures: ["balance", "debit", "credit"] },
};
// Trial Balance Period: the period's movement next to the balance it leaves,
// each under its own header band, both shown by default.
const accountTreePeriodLayout = {
  ...accountTreeLayout,
  groups: [
    { id: "tree", label: "Account tree", fields: ["mbscd", "mbscdName", "bscd", "bscdName", "macno", "macaccount"] },
    { id: "move", label: "Period movement", fields: ["dr_movement", "cr_movement"] },
    { id: "bal", label: "Period balance", fields: ["debit", "credit", "balance"], foldTo: "balance" },
  ],
  views: [
    { id: "movement", label: "Movement + balance", fields: ["dr_movement", "cr_movement", "debit", "credit", "balance"] },
    { id: "tree", label: "Balance only", fields: ["debit", "credit", "balance"] },
    { id: "all", label: "Everything" },
  ],
  defaultView: "movement",
  card: { title: "account", subtitle: "acno", figures: ["balance", "dr_movement", "cr_movement"] },
};

// Customer Based Gross Margin: one row per customer × product, grouped by
// customer (contiguous — the API sorts customers A-Z). Rates and margin % of a
// subtotal are weighted: Σ value / Σ qty, Σ margin / Σ cost × 100.
const customerMarginLayout = {
  pinned: ["product", "item_name"],
  groups: [
    { id: "sales", label: "Sales", fields: ["qty", "sales_value", "sale_rate"] },
    { id: "cost", label: "Cost", fields: ["cost_rate", "cost_value"] },
    { id: "margin", label: "Margin", fields: ["margin_amount", "margin_percent"], foldTo: "margin_amount" },
  ],
  rowGroupBy: [
    { field: "customer_acno", title: "Customer", contiguous: true, label: (r) => [r.customer_acno || "", r.customer].filter(Boolean).join(" — "), subtotalLabel: "Total" },
  ],
  card: { title: "item_name", subtitle: (r) => [r.product, r.customer].filter(Boolean).join(" · "), figures: ["sales_value", "cost_value", "margin_amount", "margin_percent"] },
};

// Checks In Hand: one row per cheque; the Report Base picks the groups
// (contiguous — lib/reports/checksInHand.js sorts the rows in print order).
const checksInHandLayout = (filters) => {
  const base = filterValue(filters?.reportBase) || "salesPerson";
  const groupBy =
    base === "date"
      ? [{ field: "groupDateKey", title: "Date", contiguous: true, label: (r) => `Date: ${r.groupDate || r.chqDate || ""}`, subtotalLabel: "Total" }]
      : [
          { field: "salesPersonName", title: "Sales person", contiguous: true, label: (r) => `Sales Person: ${r.salesPersonName || "OPEN"}`, subtotalLabel: "Total" },
          { field: "customerCode", title: "Customer", contiguous: true, label: (r) => [r.customerCode, r.customer, r.category ? `[${r.category}]` : ""].filter(Boolean).join("  "), subtotalLabel: "Total" },
        ];
  return {
    pinned: ["chqNo", "chqDate"],
    groups: [
      { id: "chq", label: "Cheque", fields: ["customer", "bank", "amount", "count"] },
      { id: "dep", label: "Deposit", fields: ["depAcno", "depDate", "status"] },
    ],
    rowGroupBy: groupBy,
    card: { title: "customer", subtitle: (r) => [r.chqNo && `Chq ${r.chqNo}`, r.chqDate, r.status].filter(Boolean).join(" · "), figures: ["amount"] },
  };
};

// Material Procurement: one row per material, grouped into Local / Imported /
// Unclassified sections (section_no keeps that order) with subtotals of the
// stock, order and month columns — what the old section totals carried.
const materialProcurementLayout = (filters) => {
  const months = procurementMonthCols(filters).map((c) => c.field);
  return {
    pinned: ["code", "product_description"],
    groups: [
      { id: "cons", label: "Consumption", fields: ["avg_cons_6m", "max_cons_6m"] },
      { id: "stock", label: "Stock", fields: ["opening_stock", "total_stock", "stock_factory", "stock_prod", "stock_fg", "stock_bond", "stock_transit"], foldTo: "total_stock" },
      { id: "order", label: "Reorder", fields: ["re_order_level", "order_qty", "stock_sufficient_months"] },
      { id: "months", label: "Monthly consumption", fields: months },
    ],
    rowGroupBy: [{ field: "section_no", title: "Section", label: (r) => r.section_label || "Unclassified", subtotalLabel: "Total" }],
    card: { title: "product_description", subtitle: "code", figures: ["total_stock", "order_qty", "avg_cons_6m", "stock_sufficient_months"] },
  };
};

// SalesOrder Balance: how far a line was shipped OVER its order, as a %.
// 20 ordered, 30 shipped → "50.00%". Blank when not over, or nothing ordered.
const overShipPct = (ordered, shipped) => {
  const o = Number(ordered) || 0;
  const s = Number(shipped) || 0;
  if (o <= 0 || s <= o) return "";
  // Up to 2 decimals, no trailing zeros: 300% · 4% · 1.5% · 12.35%
  return `${Number((((s - o) / o) * 100).toFixed(2))}%`;
};

export const dynamicEndpoints = {
  // For orderType -> account mapping
  orderTypeAccount: (orderType) => {
    switch (orderType) {
      case "4":
        return `/api/accounts/acno?${VENDOR_GROUP_PARAM}`; // Purchase Order → Vendors
      case "6":
        return `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`; // Sales Order → Customers
      default:
        return `/api/accounts/acno?${PARTY_GROUP_PARAM}`; // All → Both
    }
  },

  // Generic: filter → endpoint mapping
  conditionalEndpoint: (filterValue, mappings) => {
    return mappings[filterValue] || mappings.default;
  },
};

const formatDate = (date) => {
  if (!date) return "";

  // DD-MM-YYYY 
  const [day, month, year] = date.split("-");

  const d = new Date(year, month - 1, day);

  const months = [
    "JAN", "FEB", "MAR", "APR", "MAY", "JUN",
    "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"
  ];

  return `${String(d.getDate()).padStart(2, "0")}-${months[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
};

// const formatDate = (date) => {
//   if (!date) return "";

//   const d = new Date(date);
//   const months = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

//   return `${String(d.getDate()).padStart(2, "0")}-${months[d.getMonth()]}-${String(d.getFullYear()).slice(-2)}`;
// };

export const dynamicLabels = {
  // For orderType -> account label
  accountLabel: (orderType) => {
    switch (orderType) {
      case "4":
        return "Vendor";
      case "6":
        return "Customer";
      default:
        return "Account";
    }
  },

  // Generic placeholder
  accountPlaceholder: (orderType) => {
    switch (orderType) {
      case "4":
        return "Select Vendor";
      case "6":
        return "Select Customer";
      default:
        return "Select Account";
    }
  },
};

// Template system utilities
export const template = {
  // Simple value replacement: {{filterName}}
  value: (filterName) => `{{${filterName}}}`,

  // Conditional: if filter=value then result
  conditional: (filterName, mappings) => {
    const conditions = Object.entries(mappings)
      .map(([value, result]) => `${filterName}=${value}→${result}`)
      .join("|");
    return `{{${conditions}}}`;
  },

  // Fallback chain: try first, then second, etc
  fallback: (...values) => `{{${values.join("|")}}}`,
};

// ── Voucher reports: receipt, payment and journal ─────────────────────────
// All three come from getTransactionReport() and share one shape, so their
// view switch and grouped detail view are built here instead of being written
// out three times.

// Adds "Summary View" (one row per voucher, lines behind the eye icon) and
// "Detail View" (lines inline in the table). The API reads this filter name.
const voucherViewFilter = {
  name: "view",
  label: "View",
  type: "select",
  options: [
    { value: "summaryView", label: "Summary View" },
    { value: "detailView", label: "Detail View" },
  ],
  default: { value: "detailView", label: "Detail View" },
  clearable: false,
};

// Detail View = grouped documents on the wide engine (CLAUDE.md rule 15,
// `layout.groupRows` — this is the reference entry for grouped documents):
// voucher header › its lines, a recomputed voucher subtotal, the grand total.
// Row types match the row_type tags toVoucherDetailRows() writes in
// app/api/reports/[reportType]/route.js; the API is unchanged. Lines are
// sub_tran_id 1 and 2 only — the generated cash/bank contra is not shown — so
// Σ lines = the server's voucher_total (dropped, recomputed by the engine).
const isVoucherDetailView = (filters) => filterValue(filters?.view) === "detailView";
const voucherDetailColumns = (accountHeaderName) => [
  { field: "tran_id", headerName: "Tran #", width: 14, type: "text" },
  { field: "dated", headerName: "Date", width: 18, type: "date" },
  { field: "vr_no", headerName: "Vr #", width: 12 },
  { field: "account", headerName: accountHeaderName, width: 60 },
  { field: "chno", headerName: "Cheque / TID #", width: 28 },
  { field: "damt", headerName: "Debit", width: 24, type: "currency", showTotal: true },
  { field: "camt", headerName: "Credit", width: 24, type: "currency", showTotal: true },
  { field: "narration", headerName: "Narration", width: 60 },
];
const voucherColumns = (report, accountHeaderName) => (filters) =>
  isVoucherDetailView(filters) ? voucherDetailColumns(accountHeaderName) : REPORT_CONFIG[report].columns;
const voucherLayout = (filters) =>
  isVoucherDetailView(filters)
    ? {
        pinned: ["tran_id", "dated"],
        groupRows: {
          levels: [
            {
              header: "voucher_header",
              total: "voucher_total",
              title: "Voucher",
              label: (h) => `Vr ${h.vr_no || "—"} · ${h.account || ""}`,
              // the header row shows the voucher's own identity in its columns
              headerFields: ["tran_id", "dated", "vr_no", "account", "narration"],
              inherit: ["dated", "vr_no"],
              subtotalLabel: (h) => `Voucher ${h.vr_no || ""} total`,
            },
          ],
          detail: "detail_row",
        },
        card: { title: "account", subtitle: (r) => [r.vr_no && `Vr ${r.vr_no}`, r.chno].filter(Boolean).join(" · "), figures: ["damt", "camt"] },
      }
    : null;

// ── Material Procurement Enquiry — which field of each row type sits in
// which of the six shared columns (getMaterialProcurementEnquiry rows).
const ENQUIRY_CELLS = {
  product_header: ["label", "", "", "", "", ""],
  info_row: ["label", "value", "date", "ref", "vendor", "qty"],
  vendor_row: ["vendor", "avg", "range", "last_rate", "last_date", "qty"],
  purchase_row: ["date", "ref", "vendor", "qty", "rate", "amount"],
  purchase_total: ["label", "", "", "qty", "rate", "amount"],
};

// ── Sales Team MIS — Detail mode columns (wide engine, rule 15) ────────────
const misPct = ({ row }) => {
  const t = Number(row?.targetRecovery) || 0;
  return t > 0 ? ((Number(row?.actualRecovery) || 0) / t) * 100 : null;
};
const SALES_TEAM_MIS_DETAIL_COLUMNS = [
  { field: "code", headerName: "Code", width: 12 },
  { field: "customer", headerName: "Customer", width: 32 },
  { field: "terms", headerName: "Terms", width: 10, type: "integer" },
  { field: "customerStatus", headerName: "Customer Status", width: 20 },
  { field: "reconStatus", headerName: "Recon Status", width: 14 },
  { field: "reconciliationRemarks", headerName: "Recon Rmks", width: 24 },
  { field: "targetQty", headerName: "Target Qty (Ton)", width: 15, type: "number", showTotal: true },
  { field: "dispatchTon", headerName: "Dispatch (Ton)", width: 14, type: "number", showTotal: true },
  { field: "dispatchKg", headerName: "Dispatch (KG)", width: 14, type: "number", showTotal: true },
  { field: "saleAmount", headerName: "Sale Amount", width: 16, type: "currency", showTotal: true },
  { field: "targetRecovery", headerName: "Target Recovery", width: 16, type: "currency", showTotal: true },
  // Knock-offs this month on invoices overdue at the opening, and ÷ target
  { field: "actualRecovery", headerName: "Actual Recovery", width: 16, type: "currency", showTotal: true },
  { field: "recoveryPct", headerName: "Recovery %", width: 11, type: "percent", valueGetter: misPct, totalRatio: { num: "actualRecovery", den: "targetRecovery", scale: 100 } },
  { field: "openingOverdue", headerName: "Open OverDue", width: 16, type: "currency", showTotal: true },
  { field: "currentOverdue", headerName: "Curr OverDue", width: 16, type: "currency", showTotal: true },
  { field: "lockedTargetRecovery", headerName: "Recovery Month", width: 18, type: "currency", showTotal: true },
  { field: "lockedOverdue", headerName: "Locked OverDue", width: 18, type: "currency", showTotal: true },
  { field: "currentBalance", headerName: "Curr Balance", width: 16, type: "currency", showTotal: true },
  { field: "salesPersonName", headerName: "Sales Person", width: 18 },
  { field: "category", headerName: "Category", width: 16 },
];

// ── Sales Order Balance — Group Detail views on the wide engine ────────────
const ORDER_BALANCE_GROUPED_VIEWS = ["groupDetail", "groupSalesPerson"];
const ORDER_BALANCE_GROUPED_COLUMNS = [
  { field: "orderNo", headerName: "So No", width: 12, type: "text" },
  { field: "orderDate", headerName: "So Date", width: 14 },
  { field: "partyCode", headerName: "Party Code", width: 12 },
  { field: "customer", headerName: "Customer", width: 44 },
  { field: "sale_po", headerName: "Cust PO", width: 18 },
  { field: "salesPerson", headerName: "Sales Person", width: 22 },
  { field: "code", headerName: "Code", width: 16 },
  { field: "itemName", headerName: "Description", width: 40 },
  { field: "unit", headerName: "Unit", width: 9 },
  { field: "orderedQty", headerName: "SO Qty (KG)", width: 14, type: "number", showTotal: true },
  { field: "rate", headerName: "Rate", width: 16, type: "currency" },
  { field: "amount", headerName: "Amount", width: 18, type: "currency", showTotal: true },
  { field: "shipQty", headerName: "Ship (KG)", width: 14, type: "number", showTotal: true },
  { field: "pendingQty", headerName: "Bal (KG)", width: 14, type: "number", showTotal: true },
  // Litres — filled only on lines ordered in LTR (blank on KG lines)
  { field: "orderedQtyLtr", headerName: "SO Qty (LTR)", width: 14, type: "number", showTotal: true },
  { field: "shipQtyLtr", headerName: "Ship (LTR)", width: 14, type: "number", showTotal: true },
  { field: "pendingQtyLtr", headerName: "Bal (LTR)", width: 14, type: "number", showTotal: true },
];
const SO_FIELDS = ["orderNo", "orderDate", "partyCode", "customer", "sale_po"];
const orderBalanceGroupedLayout = () => ({
  pinned: ["orderNo", "orderDate"],
  groups: [
    { id: "order", label: "Order", fields: ["partyCode", "customer", "sale_po", "salesPerson"], foldTo: "customer" },
    { id: "item", label: "Item", fields: ["code", "itemName", "unit"] },
    { id: "kg", label: "KG", fields: ["orderedQty", "rate", "amount", "shipQty", "pendingQty"], foldTo: "pendingQty" },
    { id: "ltr", label: "Litre", fields: ["orderedQtyLtr", "shipQtyLtr", "pendingQtyLtr"], foldTo: "pendingQtyLtr" },
  ],
  groupRows: {
    levels: [
      {
        header: "sales_person_header",
        total: "sales_person_total",
        title: "Sales Person",
        label: (h) => `Sales Person: ${h.salesPerson || "—"}`,
      },
      {
        key: "_orderNo",
        total: "so_total",
        title: "Sale Order",
        label: (first) => [`SO ${first._orderNo}`, first.orderDate, first.customer].filter(Boolean).join(" · "),
        inherit: SO_FIELDS,
        subtotalLabel: (first) => `SO ${first._orderNo} total`,
      },
    ],
    detail: "so_line",
  },
  card: {
    title: "itemName",
    subtitle: (r) => [r.code, r.unit].filter(Boolean).join(" · "),
    figures: ["orderedQty", "shipQty", "pendingQty", "amount"],
  },
  // so_line carries order_no + tran_code → the sale order opens read-only.
});

// Shared filters for the L/C stage reports (In Transit / Deals in Process).
// As Of Date, like Imported Material Stock: the report shows each L/C's
// stage on that date.
const LC_STAGE_DATE_FILTERS = [
  {
    name: "dateTo",
    label: "As Of Date",
    type: "date",
    default: new Date(),
    required: true,
  },
];

const LC_STAGE_COMMON_FILTERS = [
  {
    name: "lc_no",
    label: "LC No",
    type: "select",
    options: "lcs",
    apiEndpoint: "/api/lc/options",
    valueKey: "lc_no",
    nameKeys: ["lc_no"],
    default: { value: "", label: "All LCs" },
    clearable: true,
  },
    {
    name: "itcd",
    label: "Item",
    type: "select",
    options: "products",
    apiEndpoint: "/api/setup/items",
    valueKey: "itcd",
    nameKeys: ["code", "item"],
    separator: " - ",
    default: { value: "", label: "All Items" },
    clearable: true,
  },
  {
    name: "beneficiary",
    label: "Beneficiary",
    type: "select",
    options: "beneficiaries",
    apiEndpoint: `/api/accounts/acno?${BENEFICIARY_GROUP_PARAM}`,
    valueKey: "acno",
    nameKeys: ["acno", "acname"],
    separator: " - ",
    default: { value: "", label: "All Beneficiaries" },
    clearable: true,
  },
   {
    name: "bank",
    label: "Bank",
    type: "select",
    options: "banks",
    apiEndpoint: `/api/accounts/acno?${CASH_BANK_GROUP_PARAM}`,
    valueKey: "acno",
    nameKeys: ["acno", "acname"],
    separator: " - ",
    default: { value: "", label: "All Banks" },
    clearable: true,
  },
  {
    name: "import_type",
    label: "Import Type",
    type: "select",
    clearable: true,
    options: [
      { value: "LC", label: "LC" },
      { value: "CONT", label: "CONT" },
    ],
  },
];

export const REPORT_CONFIG = {
  purchase: {
    title: "Purchase Report",
    description: "Detailed report of all purchase transactions",
    apiEndpoint: "/api/reports/purchase",

    // ------------------ FILTERS ------------------
    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        required: true,
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        required: true,
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
      },
      {
        name: "dateOrder",
        label: "Sort by Date",
        type: "select",
        options: [
          { value: "desc", label: "Descending (Newest First)" },
          { value: "asc", label: "Ascending (Oldest First)" },
        ],
        default: { value: "desc", label: "Descending (Newest First)" },
        clearable: false,
      },
      {
        name: "vendor",
        label: "Vendor",
        valueKey: "acno",
        type: "select",
        nameKeys: ["acno", "acname"],
        separator: " - ",
        options: "vendors",
        default: { value: "", label: "All Vendors" },
        apiEndpoint: `/api/accounts/acno?${VENDOR_GROUP_PARAM}`,
        clearable: true,
      },
      {
        name: "godown",
        label: "Godown",
        nameKey: "godown",
        type: "select",
        options: "godowns",
        default: { value: "", label: "All Godowns" },
        apiEndpoint: "/api/setup/godowns?includeInactive=true",
        clearable: true,
      },
      {
        name: "item",
        label: "Item",
        type: "select",
        options: "products",
        default: { value: "", label: "All Items" },
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["code", "item"],
        separator: " - ",
        clearable: true,
      },
      {
        name: "po_no",
        label: "Purchase Order No",
        type: "select",
        options: "orders",
        apiEndpoint: "/api/orders/purchaseOrder",
        valueKey: "order_no",
        nameKey: "order_no",
        clearable: true,
      },
      {
        name: "type",
        label: "Summary Type",
        type: "select",
        options: [
          { label: "Product Summary", value: "product" },
          { label: "Product Detail", value: "productDetail" },
          { label: "Vendor Summary", value: "vendor" },
          { label: "Vendor Detail", value: "vendorDetail" },
          { label: "Invoice Summary", value: "invoiceSummary" },
          { label: "Invoice Awaited", value: "invoiceAwaited" },
        ],
        default: { value: "productDetail", label: "Product Detail" },
        clearable: true,
      },
      {
        name: "includeReturns",
        label: "Include Returns",
        type: "checkbox",
        default: false,
      },
      {
        // Only documents with no rate or no invoice number (getPSTransactionReport)
        name: "withoutRate",
        label: "Without Rate",
        type: "checkbox",
        default: false,
      },
    ],

    // ------------------ COLUMNS ------------------
    getColumns: (filters) => {
      if (filters?.type === "vendor") {
        // 🔹 Vendor summarized view
        return [
          {
            field: "pycd",
            headerName: "Vendor Code",
            width: 40,
            type: "number",
          },
          {
            field: "vendorName",
            headerName: "Vendor Name",
            width: 80,
          },
          {
            field: "total_qty",
            headerName: "Total Quantity",
            width: 50,
            type: "number",
            showTotal: true,
          },
          { field: "avg_rate", headerName: "Avg Rate", width: 40, type: "currency" },
          {
            field: "gross_amount",
            headerName: "Gross Amount",
            type: "currency",
            showTotal: true,
            valueGetter: (params) =>
              params.row.transactions?.reduce(
                (sum, item) => sum + (item.damt || item.camt || 0),
                0
              ) || 0,
          },
          {
            field: "st_rate",
            headerName: "Sales Tax Amount",
            type: "currency",
            showTotal: true,
            valueGetter: (params) =>
              params.row?.transactions?.reduce(
                (sum, item) => sum + (item.st_amount || 0),
                0
              ) || 0,
          },
          {
            field: "total_amount",
            headerName: "Total Net Amount",
            width: 35,
            type: "currency",
            showTotal: true,
            valueGetter: (params) => {
              const grossAmount =
                params.row?.transactions?.reduce(
                  (sum, item) => sum + (item.damt || item.camt || 0),
                  0
                ) || 0;

              const stAmount =
                params.row?.transactions?.reduce(
                  (sum, item) => sum + (item.st_amount || 0),
                  0
                ) || 0;

              return grossAmount + stAmount;
            },
          },
          // {
          //   field: "total_amount",
          //   headerName: "Total Amount",
          //   width: 60,
          //   type: "currency",
          //   fixed: true,
          // },
        ];
      }

      if (filters?.type === "vendorDetail") {
        return [
          {
            field: "pycd",
            headerName: "Vendor Code",
            width: 40,
            type: "number",
          },
          {
            field: "vendorName",
            headerName: "Vendor Name",
            width: 80,
          },
          {
            field: "total_qty",
            headerName: "Total Quantity",
            width: 50,
            type: "number",
            showTotal: true,
          },
          {
            field: "gross_amount",
            headerName: "Gross Amount",
            type: "currency",
            showTotal: true,
          },
          {
            field: "st_amount",
            headerName: "Sales Tax Amount",
            type: "currency",
            showTotal: true,
          },
          {
            field: "total_amount",
            headerName: "Total Net Amount",
            width: 35,
            type: "currency",
            showTotal: true,
          },
        ];
      }

      if (filters?.type === "product") {
        // 🔹 Product summarized view
        return [
          {
            field: "itcd",
            headerName: "Product Code",
            width: 40,
            // type: "number",
          },
          {
            field: "productName",
            headerName: "Product Name",
            width: 80,
          },
          {
            field: "total_qty",
            headerName: "Total Quantity",
            width: 50,
            type: "number",
            showTotal: true,
          },
          { field: "avg_rate", headerName: "Avg Rate", width: 40, type: "currency" },
          // {
          //   field: "total_amount",
          //   headerName: "Total Amount",
          //   width: 60,
          //   type: "currency",
          //   fixed: true,
          // },
          {
            field: "gross_amount",
            headerName: "Gross Amount",
            type: "currency",
            showTotal: true,
            valueGetter: (params) =>
              params.row.transactions?.reduce(
                (sum, item) => sum + (item.damt || item.camt || 0),
                0
              ) || 0,
          },
          {
            field: "st_rate",
            headerName: "Sales Tax Amount",
            type: "currency",
            showTotal: true,
            valueGetter: (params) =>
              params.row?.transactions?.reduce(
                (sum, item) => sum + (item.st_amount || 0),
                0
              ) || 0,
          },

          {
            field: "total_amount",
            headerName: "Total Net Amount",
            width: 35,
            type: "currency",
            showTotal: true,
            valueGetter: (params) => {
              const grossAmount =
                params.row?.transactions?.reduce(
                  (sum, item) => sum + (item.damt || item.camt || 0),
                  0
                ) || 0;

              const stAmount =
                params.row?.transactions?.reduce(
                  (sum, item) => sum + (item.st_amount || 0),
                  0
                ) || 0;

              return grossAmount + stAmount;
            },
          },
        ];
      }

      if (filters?.type === "productDetail") {
        return [
          { field: "dated", headerName: "Date", width: 100, type: "date" },
          { field: "tran_id", headerName: "Transaction #", width: 90, type: "text" },
          { field: "grn_no", headerName: "GRN No", width: 80 },
          { field: "invoice_no", headerName: "Invoice No", width: 100 },
          { field: "pycd", headerName: "Vendor Code", width: 80, type: "number" },
          { field: "vendorName", headerName: "Vendor Name", width: 160 },
          { field: "godown", headerName: "Godown", width: 100 },
          { field: "code", headerName: "Item Code", width: 90 },
          { field: "productName", headerName: "Product Name", width: 180 },
          { field: "mc_name", headerName: "Ink Series", width: 100 },
          { field: "po_no", headerName: "PO No", width: 80 },
          { field: "total_qty", headerName: "Quantity", width: 80, type: "number", showTotal: true },
          { field: "unit", headerName: "Unit", width: 60 },
          { field: "qty_ltr", headerName: "Qty (Ltr)", width: 80, type: "number" },
          { field: "rate", headerName: "Rate", width: 90, type: "currency" },
          { field: "gross_amount", headerName: "Gross Amount", width: 110, type: "currency", showTotal: true },
          { field: "st_rate", headerName: "ST Rate", width: 70, type: "number" },
          { field: "additional_tax", headerName: "Further Tax Rate", width: 110, type: "number" },
          { field: "st_amount", headerName: "Tax Amount", width: 100, type: "currency", showTotal: true },
          { field: "total_amount", headerName: "Net Amount", width: 110, type: "currency", fixed: true, showTotal: true },
        ];
      }

      if (filters?.type === "invoiceSummary") {
        return [
          { field: "invoice_no", headerName: "Invoice No#", width: 60 },
          { field: "dated", headerName: "Invoice Date", width: 100, type: "date" },
          { field: "po_no", headerName: "PO No", width: 32 },
          { field: "grn_no", headerName: "GRN#", width: 32 },
          {
            field: "acno.ntnNo",
            headerName: "NTN#",
            width: 80,
            valueGetter: (params) => params.row.acno?.ntnNo || "",
          },
          {
            field: "vendorName",
            headerName: "Vendor Name",
            width: 120,
            valueGetter: (params) => params.row.acno?.acname || "",
          },
          {
            field: "total_qty", showTotal: true,
            headerName: "Total Quantity",
            width: 50,
            type: "number",
          },
          {
            field: "gross_amount", showTotal: true,
            headerName: "Gross Amount",
            type: "currency",
            valueGetter: (params) =>
              params.row.transactions?.reduce(
                (sum, item) => sum + (item.damt || item.camt || 0),
                0
              ) || 0,
          },
          {
            field: "st_rate", showTotal: true,
            headerName: "Sales Tax Amount",
            type: "currency",
            valueGetter: (params) =>
              params.row?.transactions?.reduce(
                (sum, item) => sum + (item.st_amount || 0),
                0
              ) || 0,
          },
          {
            field: "total_amount", showTotal: true,
            headerName: "Total Net Amount",
            width: 35,
            type: "currency",
            valueGetter: (params) => {
              const grossAmount =
                params.row?.transactions?.reduce(
                  (sum, item) => sum + (item.damt || item.camt || 0),
                  0
                ) || 0;

              const stAmount =
                params.row?.transactions?.reduce(
                  (sum, item) => sum + (item.st_amount || 0),
                  0
                ) || 0;

              return grossAmount + stAmount;
            },
          },

          // { field: "total_amount", headerName: "Total Amount", width: 100, type: "currency" },
        ];
      }

      if (filters?.type === "invoiceAwaited") {
        return [
          { field: "invoice_no", headerName: "Invoice No#", width: 60 },
          { field: "dated", headerName: "Invoice Date", width: 100, type: "date" },
          { field: "grn_no", headerName: "GRN#", width: 32 },
          { field: "po_no", headerName: "PO No", width: 32 },
          {
            field: "acno.ntnNo",
            headerName: "NTN#",
            width: 80,
            valueGetter: (params) => params.row.acno?.ntnNo || "",
          },
          {
            field: "vendorName",
            headerName: "Vendor Name",
            width: 120,
            valueGetter: (params) => params.row.acno?.acname || "",
          },
          {
            field: "total_qty", showTotal: true,
            headerName: "Total Quantity",
            width: 50,
            type: "number",
          },
          {
            field: "gross_amount", showTotal: true,
            headerName: "Gross Amount",
            type: "currency",
            valueGetter: (params) =>
              params.row.transactions?.reduce(
                (sum, item) => sum + (item.damt || item.camt || 0),
                0
              ) || 0,
          },
          {
            field: "st_rate", showTotal: true,
            headerName: "Sales Tax Amount",
            type: "currency",
            valueGetter: (params) =>
              params.row?.transactions?.reduce(
                (sum, item) => sum + (item.st_amount || 0),
                0
              ) || 0,
          },
          {
            field: "total_amount", showTotal: true,
            headerName: "Total Net Amount",
            width: 35,
            type: "currency",
            valueGetter: (params) => {
              const grossAmount =
                params.row?.transactions?.reduce(
                  (sum, item) => sum + (item.damt || item.camt || 0),
                  0
                ) || 0;

              const stAmount =
                params.row?.transactions?.reduce(
                  (sum, item) => sum + (item.st_amount || 0),
                  0
                ) || 0;

              return grossAmount + stAmount;
            },
          },

          // { field: "total_amount", headerName: "Total Amount", width: 100, type: "currency" },
        ];
      }


      // 🔹 Default detailed columns (existing full view)
      return [
        {
          field: "dated",
          headerName: "Date",
          width: 32,
          type: "date",
        },
        {
          field: "tran_id",
          headerName: "Transaction #",
          width: 32,
          type: "text",
        },
        { field: "grn_no", headerName: "GRN No", width: 32 },
        { field: "invoice_no", headerName: "Invoice No", width: 32 },
        {
          field: "ac_no",
          headerName: "Account No",
          width: 32,
          valueGetter: (params) => params.row.acno?.acno || "",
        },
        {
          field: "vendor_name",
          headerName: "Vendor",
          width: 48,
          valueGetter: (params) => params.row.acno?.acname || "",
        },
        {
          field: "godown_name",
          headerName: "Godown",
          width: 52,
          valueGetter: (params) => params.row.godownDetails?.godown || "",
        },
        {
          field: "total_qty", showTotal: true,
          headerName: "Total Qty",
          width: 32,
          type: "number",
        },
        {
          field: "gross_amount", showTotal: true,
          headerName: "Gross Amount",
          type: "currency",
          valueGetter: (params) =>
            params.row.transactions?.reduce(
              (sum, item) => sum + (item.damt || item.camt || 0),
              0
            ) || 0,
        },
        {
          field: "st_rate", showTotal: true,
          headerName: "Sales Tax Amount",
          type: "currency",
          valueGetter: (params) =>
            params.row?.transactions?.reduce(
              (sum, item) => sum + (item.st_amount || 0),
              0
            ) || 0,
        },
        {
          field: "additional_tax", showTotal: true,
          headerName: "Further Tax Amount",
          type: "currency",
        },
        {
          field: "total_amount", showTotal: true,
          headerName: "Total Net Amount",
          width: 35,
          type: "currency",
          valueGetter: (params) => {
            const grossAmount =
              params.row?.transactions?.reduce(
                (sum, item) => sum + (item.damt || item.camt || 0),
                0
              ) || 0;

            const stAmount =
              params.row?.transactions?.reduce(
                (sum, item) => sum + (item.st_amount || 0),
                0
              ) || 0;

            return grossAmount + stAmount;
          },
        },
        { field: "rmk", headerName: "Narration", width: 40 },
      ];
    },

    // ------------------ DETAIL COLUMNS ------------------

    // Wide-report layout (CLAUDE.md rule 15) — one per summary type.
    layout: fitLayout("purchase", (filters) => {
      const type = filterValue(filters?.type);
      const amountGroup = (fields) => ({ id: "amt", label: "Amount & tax", fields, foldTo: "total_amount" });
      if (type === "productDetail") {
        return {
          pinned: ["dated", "invoice_no"],
          groups: [
            { id: "doc", label: "Document", fields: ["tran_id", "grn_no", "po_no"] },
            { id: "vendor", label: "Vendor", fields: ["pycd", "vendorName"] },
            { id: "item", label: "Item", fields: ["godown", "code", "productName", "mc_name"] },
            { id: "qty", label: "Quantity", fields: ["total_qty", "unit", "qty_ltr"] },
            amountGroup(["rate", "gross_amount", "st_rate", "additional_tax", "st_amount", "total_amount"]),
          ],
          views: [
            {
              id: "standard",
              label: "Standard",
              fields: ["grn_no", "po_no", "pycd", "vendorName", "code", "productName", "mc_name", "total_qty", "unit", "qty_ltr", "rate", "gross_amount", "st_rate", "st_amount", "total_amount"],
            },
            { id: "all", label: "Everything" },
          ],
          defaultView: "standard",
          unitSwitch: {
            label: "Quantity",
            options: [
              { id: "kg", label: "KG", fields: ["total_qty"] },
              { id: "ltr", label: "Litre", fields: ["qty_ltr"] },
            ],
            default: "kg",
          },
          card: {
            title: (r) => [r.invoice_no, r.vendorName].filter(Boolean).join(" · "),
            subtitle: (r) => [r.code, r.productName].filter((x) => x && x !== "-").join(" "),
            figures: ["total_qty", "rate", "total_amount"],
          },
        };
      }
      if (type === "product") {
        return {
          pinned: ["itcd", "productName"],
          groups: [{ id: "qty", label: "Quantity", fields: ["total_qty", "avg_rate"] }, amountGroup(["gross_amount", "st_rate", "total_amount"])],
          card: { title: "productName", subtitle: "itcd", figures: ["total_qty", "avg_rate", "total_amount"] },
        };
      }
      if (type === "vendor" || type === "vendorDetail") {
        return {
          pinned: ["pycd", "vendorName"],
          groups: [{ id: "qty", label: "Quantity", fields: ["total_qty", "avg_rate"] }, amountGroup(["gross_amount", "st_rate", "st_amount", "total_amount"])],
          card: { title: "vendorName", subtitle: "pycd", figures: ["total_qty", "gross_amount", "total_amount"] },
        };
      }
      if (type === "invoiceSummary" || type === "invoiceAwaited") {
        return {
          pinned: ["invoice_no", "dated"],
          groups: [
            { id: "doc", label: "Document", fields: ["grn_no", "po_no"] },
            { id: "vendor", label: "Vendor", fields: ["acno.ntnNo", "vendorName"] },
            amountGroup(["total_qty", "gross_amount", "st_rate", "total_amount"]),
          ],
          card: { title: "vendorName", subtitle: "invoice_no", figures: ["total_qty", "gross_amount", "total_amount"] },
        };
      }
      return {
        pinned: ["dated", "invoice_no"],
        groups: [
          { id: "doc", label: "Document", fields: ["tran_id", "grn_no", "godown_name"] },
          { id: "vendor", label: "Vendor", fields: ["ac_no", "vendor_name"] },
          amountGroup(["total_qty", "gross_amount", "st_rate", "additional_tax", "total_amount"]),
        ],
        card: { title: "vendor_name", subtitle: (r) => [r.invoice_no && `INV ${r.invoice_no}`, r.grn_no && `GRN ${r.grn_no}`].filter(Boolean).join(" · "), figures: ["total_qty", "gross_amount", "total_amount"] },
      };
    }),
    // Drill trail: product / vendor summary → product detail for that item /
    // vendor; vendor → its ledger; transaction rows → their voucher.
    drill: (() => {
      const KEEP = ["dateFrom", "dateTo", "dateOrder", "vendor", "godown", "item", "po_no", "includeReturns", "withoutRate"];
      return [
        {
          label: "Open product detail",
          when: (row, filters) => filterValue(filters?.type) === "product" && !!row.itcd,
          href: (row, filters) => reportHref("purchase", { ...pickFilters(filters, KEEP), item: row.itcd, type: "productDetail" }),
        },
        {
          label: "Open vendor detail",
          when: (row, filters) => ["vendor", "vendorDetail"].includes(filterValue(filters?.type)) && !!row.pycd,
          href: (row, filters) => reportHref("purchase", { ...pickFilters(filters, KEEP), vendor: row.pycd, type: "productDetail" }),
        },
        {
          label: "Open account ledger",
          when: (row, filters) => ["vendor", "vendorDetail"].includes(filterValue(filters?.type)) && !!row.pycd,
          href: (row, filters) => accountLedgerHref({ account: row.pycd, dateFrom: filters.dateFrom, dateTo: filters.dateTo }),
        },
      ];
    })(),
    detailColumns: [
      {
        field: "itcd",
        headerName: "Item Code",
        width: 50,
        valueGetter: (params) => params.row.itemDetails?.itcd || "",
      },
      {
        field: "item",
        headerName: "Item",
        width: 60,
        valueGetter: (params) => params.row.itemDetails?.item || "",
      },
      { field: "qty", headerName: "Qty", width: 20, type: "number" },
      { field: "rate", headerName: "Rate", width: 20, type: "currency" },
      {
        field: "gross_amount",
        headerName: "Gross Amt",
        width: 40,
        type: "currency",
      },
      { field: "st_rate", headerName: "ST Rate", width: 20, type: "number" },
      {
        field: "st_amount",
        headerName: "ST Amt",
        width: 20,
        type: "currency",
      },
      {
        field: "additional_tax",
        headerName: "Add Tax",
        width: 20,
        type: "currency",
      },
      { field: "damt", headerName: "Amount", width: 40, type: "currency" },
    ],

    // ------------------ SUMMARY FIELDS ------------------
    summaryFields: [
      { field: "total_purchase_qty", label: "Total Purchase", type: "number" },
      { field: "total_purchase_return_qty", label: "Total Purchase Return", type: "number" },

      { field: "total_qty", label: "Total Quantity", type: "number" },
      {
        field: "total_gross_amount",
        label: "Total Gross Amount",
        type: "currency",
      },
      { field: "total_tax", label: "Total Tax", type: "currency" },
      { field: "total_amount", label: "Total Net Amount", type: "currency" },
    ],

    // ------------------ EXPORT ------------------
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },
  purchaseReturn: {
    title: "Purchase Return Report",
    description: "Detailed report of all purchase return transactions",
    apiEndpoint: "/api/reports/purchaseReturn",
    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        required: true,
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        required: true,
      },
      {
        name: "vendor",
        nameKeys: ["acno", "acname"],
        separator: " - ",
        valueKey: "acno",
        label: "Vendor",
        type: "select",
        default: { value: "", label: "All Vendors" },
        options: "vendors",
        apiEndpoint: `/api/accounts/acno?${VENDOR_GROUP_PARAM}`,
        clearable: true,
      },
      {
        name: "godown",
        nameKey: "godown",
        label: "Godown",
        type: "select",
        options: "godowns",
        default: { value: "", label: "All Godowns" },
        apiEndpoint: "/api/setup/godowns?includeInactive=true",
        clearable: true,
      },
      {
        name: "item",
        label: "Item",
        type: "select",
        default: { value: "", label: "All Items" },
        options: "products",
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["itcd", "item", "code"],
        separator: " - ",
        clearable: true,
      },
      {
        name: "po_no",
        label: "Purchase Order No",
        default: { value: "", label: "All Purchase Orders No" },
        type: "select",
        options: "orders",
        apiEndpoint: "/api/orders/purchaseOrder",
        valueKey: "order_no",
        nameKey: "order_no",
        clearable: true,
      },
      {
        name: "type",
        label: "Summary Type",
        type: "select",
        options: [
          { label: "Vendor Summary", value: "vendor" },
          { label: "Product Summary", value: "product" },
        ],
        clearable: true,
      },
      {
        // Only documents with no rate or no invoice number (getPSTransactionReport)
        name: "withoutRate",
        label: "Without Rate",
        type: "checkbox",
        default: false,
      },
    ],
    // ------------------ COLUMNS ------------------
    //This function returns columns based on filters
    getColumns: (filters) => {
      if (filters?.type === "vendor") {
        return [
          {
            field: "pycd",
            headerName: "Vendor Code",
            width: 40,
            type: "number",
          },
          {
            field: "vendorName",
            headerName: "Vendor Name",
            width: 80,
          },
          {
            field: "total_qty", showTotal: true,
            headerName: "Total Quantity",
            width: 50,
            type: "number",
          },
          {
            field: "total_amount", showTotal: true,
            headerName: "Total Amount",
            width: 60,
            type: "currency",
            fixed: true,
          },
        ];
      }

      if (filters?.type === "product") {
        return [
          {
            field: "itcd",
            headerName: "Product Code",
            width: 40,
            // type: "number",
          },
          {
            field: "productName",
            headerName: "Product Name",
            width: 80,
          },
          {
            field: "total_qty", showTotal: true,
            headerName: "Total Quantity",
            width: 50,
            type: "number",
          },
          {
            field: "total_amount", showTotal: true,
            headerName: "Total Amount",
            width: 60,
            type: "currency",
            fixed: true,
          },
        ];
      }

      // Default detailed view
      return [
        { field: "dated", headerName: "Date", width: 18, type: "date" },
        {
          field: "tran_id",
          headerName: "Tran #",
          width: 15,
          type: "text",
        },
        { field: "grn_no", headerName: "Grn No", width: 15 },
        { field: "invoice_no", headerName: "Invoice No", width: 15 },
        {
          field: "vendor_name",
          headerName: "Vendor",
          width: 50,
          valueGetter: (params) => params.row.acno?.acname || "",
        },
        {
          field: "godown_name",
          headerName: "Godown",
          width: 40,
          valueGetter: (params) => params.row.godownDetails?.godown || "",
        },
        {
          field: "total_qty", showTotal: true,
          headerName: "Total Qty",
          width: 30,
          type: "number",
        },
        {
          field: "total_amount", showTotal: true,
          headerName: "Total Amount",
          width: 50,
          type: "currency",
          fixed: true,
        },
        { field: "rmk", headerName: "Narration", width: 45 },
      ];
    },

    // Wide-report layout (rule 15) — one per summary type.
    layout: (filters) => {
      const type = filterValue(filters?.type);
      if (type === "vendor") {
        return { pinned: ["pycd", "vendorName"], card: { title: "vendorName", subtitle: "pycd", figures: ["total_qty", "total_amount"] } };
      }
      if (type === "product") {
        return { pinned: ["itcd", "productName"], card: { title: "productName", subtitle: "itcd", figures: ["total_qty", "total_amount"] } };
      }
      return {
        pinned: ["dated", "invoice_no"],
        groups: [{ id: "doc", label: "Document", fields: ["tran_id", "grn_no", "godown_name"] }],
        card: {
          title: "vendor_name",
          subtitle: (r) => [r.invoice_no && `INV ${r.invoice_no}`, r.grn_no && `GRN ${r.grn_no}`].filter(Boolean).join(" · "),
          figures: ["total_qty", "total_amount"],
        },
      };
    },
    // Summary rows → the document list for that vendor / item; documents → voucher.
    drill: (() => {
      const KEEP = ["dateFrom", "dateTo", "vendor", "godown", "item", "po_no", "withoutRate"];
      return [
        {
          label: "Open documents",
          when: (row, filters) => filterValue(filters?.type) === "vendor" && !!row.pycd,
          href: (row, filters) => reportHref("purchaseReturn", { ...pickFilters(filters, KEEP), vendor: row.pycd }),
        },
        {
          label: "Open documents",
          when: (row, filters) => filterValue(filters?.type) === "product" && !!row.itcd,
          href: (row, filters) => reportHref("purchaseReturn", { ...pickFilters(filters, KEEP), item: row.itcd }),
        },
      ];
    })(),
    detailColumns: [
      {
        field: "itcd",
        headerName: "Item Code",
        width: 50,
        valueGetter: (params) => params.row.itemDetails?.itcd || "",
      },
      {
        field: "item",
        headerName: "Item",
        width: 90,
        valueGetter: (params) => params.row.itemDetails?.item || "",
      },
      { field: "qty", headerName: "Qty", width: 20, type: "number" },
      { field: "rate", headerName: "Rate", width: 20, type: "currency" },
      {
        field: "gross_amount",
        headerName: "Gross Amt",
        width: 30,
        type: "currency",
      },
      { field: "st_rate", headerName: "ST Rate", width: 20, type: "number" },
      {
        field: "st_amount",
        headerName: "ST Amt",
        width: 20,
        type: "currency",
      },
      {
        field: "additional_tax",
        headerName: "Add Tax",
        width: 20,
        type: "currency",
      },
      { field: "camt", headerName: "Amount", width: 20, type: "currency" },
    ],
    summaryFields: [
      { field: "total_qty", label: "Total Quantity", type: "number" },
      {
        field: "total_gross_amount",
        label: "Total Gross Amount",
        type: "currency",
      },
      { field: "total_tax", label: "Total Tax", type: "currency" },
      { field: "total_amount", label: "Total Net Amount", type: "currency" },
    ],
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },
  purchaseOrder: {
    title: "Purchase Order Report",
    description: "Detailed report of all purchase order transactions",
    apiEndpoint: "/api/reports/purchaseOrder",
    detailData: "orderDetails",
    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        required: true,
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        required: true,
      },
      {
        name: "vendor",
        nameKeys: ["acno", "acname"],
        separator: " - ",
        valueKey: "acno",
        label: "Vendor",
        type: "select",
        options: "vendors",
        default: { value: "", label: "All Vendors" },
        apiEndpoint: `/api/accounts/acno?${VENDOR_GROUP_PARAM}`,
        clearable: true,
      },
      {
        name: "godown",
        nameKey: "godown",
        label: "Godown",
        type: "select",
        options: "godowns",
        default: { value: "", label: "All Godowns" },
        apiEndpoint: "/api/setup/godowns?includeInactive=true",
        clearable: true,
      },
      {
        name: "item",
        label: "Item",
        type: "select",
        options: "products",
        default: { value: "", label: "All Items" },
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKey: "item",
        clearable: true,
      },
    ],
    columns: [
      { field: "dated", headerName: "Date", width: 20, type: "date" },
      {
        field: "tran_id",
        headerName: "Transaction #",
        width: 25,
        type: "text",
      },
      { field: "po_no", headerName: "PO No", width: 30 },
      {
        field: "ac_no",
        headerName: "Account No",
        width: 30,
        valueGetter: (params) => params.row.acno?.acno || "",
      },
      {
        field: "vendor_name",
        headerName: "Vendor",
        width: 80,
        valueGetter: (params) => params.row.acno?.acname || "",
      },
      {
        field: "total_amount",
        headerName: "Total Amount",
        width: 60,
        type: "currency",
      },
      { field: "rmk", headerName: "Narration", width: 60 },
    ],
    detailColumns: [
      {
        field: "itcd",
        headerName: "Item Code",
        width: 50,
        valueGetter: (params) => params.row.items?.itcd || "",
      },
      {
        field: "item",
        headerName: "Item",
        width: 90,
        valueGetter: (params) => params.row.items?.item || "",
      },
      { field: "qty", headerName: "Qty", width: 20, type: "number" },
      { field: "amount", headerName: "Amount", width: 20, type: "currency" },
    ],
    summaryFields: [
      { field: "total_qty", label: "Total Quantity", type: "number" },
      { field: "total_amount", label: "Total Amount", type: "currency" },
    ],
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },
  saleOrder: {
    title: "Sales Order Report",
    description: "Detailed report of all sales order transactions",
    apiEndpoint: "/api/reports/saleOrder",
    detailData: "orderDetails",

    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        required: true,
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        required: true,
      },
      {
        name: "vendor",
        nameKeys: ["acno", "acname"],
        separator: " - ",
        valueKey: "acno",
        label: "Vendor",
        type: "select",
        options: "vendors",
        default: { value: "", label: "All Vendors" },
        apiEndpoint: `/api/accounts/acno?${VENDOR_GROUP_PARAM}`,
        clearable: true,
      },
      {
        name: "godown",
        nameKey: "godown",
        label: "Godown",
        type: "select",
        default: { value: "", label: "All Godowns" },
        options: "godowns",
        apiEndpoint: "/api/setup/godowns?includeInactive=true",
        clearable: true,
      },
      {
        name: "item",
        label: "Item",
        type: "select",
        default: { value: "", label: "All Items" },
        options: "products",
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["itcd", "item", "code"],
        separator: " - ",
        clearable: true,
      },

      {
        name: "freeOfCost",
        label: "show Free of Cost Items Only",
        type: "checkbox",
        default: false,
      },
    ],
    columns: [
      //{ field: "dated", headerName: "Date", width: 20, type: "date" },
      { field: "order_no", headerName: "Order #", width: 25, type: "text" },
      {
        field: "acno", headerName: "Account No", width: 30,
        valueGetter: (params) => params.row.acno?.acno || ""
      },
      {
        field: "customer_name",
        headerName: "Customer",
        width: 90,
        valueGetter: (params) => params.row.acno?.acname || "",
      },
      {
        field: "total_amount",
        headerName: "Total Amount",
        width: 80,
        type: "currency",
      },
      { field: "rmk", headerName: "Narration", width: 60 },
      { field: "balance", headerName: "Balance", width: 60 },
    ],
    detailColumns: [
      {
        field: "itcd",
        headerName: "Item Code",
        width: 50,
        valueGetter: (params) => params.row.items?.itcd || "",
      },
      {
        field: "code",
        headerName: "Ink Code",
        width: 50,
        valueGetter: (params) => params.row.items?.code || "",
      },

      {
        field: "item",
        headerName: "Item",
        width: 90,
        valueGetter: (params) => params.row.items?.item || "",
      },
      { field: "qty", headerName: "Qty", width: 20, type: "number" },
      { field: "amount", headerName: "Amount", width: 20, type: "currency" },
    ],

    summaryFields: [
      { field: "total_qty", label: "Total Quantity", type: "number" },
      { field: "total_amount", label: "Total Amount", type: "currency" },
    ],
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },
  saleOrderToDispatch: {
    title: "Sale Order to Dispatch Status Report",
    description: "Tracks stage and current status of Sale Orders from Requisition and Production to Dispatch",
    apiEndpoint: "/api/reports/saleOrderToDispatch",
    detailData: "details",
    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        required: true,
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        required: true,
      },
      {
        name: "vendor",
        nameKeys: ["acno", "acname"],
        separator: " - ",
        valueKey: "acno",
        label: "Customer",
        type: "select",
        options: "customers",
        default: { value: "", label: "All Customers" },
        apiEndpoint: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`,
        clearable: true,
      },
      {
        name: "item",
        label: "Item",
        type: "select",
        default: { value: "", label: "All Items" },
        options: "products",
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["itcd", "item", "code"],
        separator: " - ",
        clearable: true,
      },
      {
        name: "so_no",
        label: "Sale Order No",
        type: "text",
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          { label: "All Statuses", value: "" },
          { label: "Material Required / Requisition Pending", value: "Material Required / Requisition Pending" },
          { label: "Production in Process", value: "Production in Process" },
          { label: "Production Ready", value: "Production Ready" },
          { label: "Dispatch Pending", value: "Dispatch Pending" },
          { label: "Dispatch Completed", value: "Dispatch Completed" },
        ],
        clearable: true,
      },
    ],
    columns: [
      { field: "dated", headerName: "SO Date", width: 30, type: "date" },
      { field: "order_no", headerName: "SO #", width: 25, type: "text" },
      { field: "customer_name", headerName: "Customer", width: 70 },
      { field: "item_code", headerName: "Item Code", width: 35 },
      { field: "item_name", headerName: "Item Name", width: 80 },
      { field: "ordered_qty", headerName: "Ordered Qty", width: 35, type: "number", showTotal: true },
      { field: "dispatched_qty", headerName: "Dispatched Qty", width: 35, type: "number", showTotal: true },
      { field: "remaining_qty", headerName: "Balance Qty", width: 35, type: "number", showTotal: true },
      { field: "req_no", headerName: "Req #", width: 25 },
      { field: "req_status", headerName: "Req Status", width: 45 },
      { field: "prod_plan_id", headerName: "Prod Plan #", width: 30 },
      { field: "prod_status", headerName: "Prod Status", width: 45 },
      { field: "status", headerName: "Current Status", width: 65, type: "status" },
    ],
    detailColumns: [
      { field: "itcd", headerName: "Item Code", width: 40 },
      { field: "item_name", headerName: "Item Name", width: 80 },
      { field: "ordered_qty", headerName: "Ordered Qty", width: 30, type: "number" },
      { field: "dispatched_qty", headerName: "Dispatched Qty", width: 30, type: "number" },
      { field: "remaining_qty", headerName: "Balance Qty", width: 30, type: "number" },
      { field: "req_no", headerName: "Req #", width: 25 },
      { field: "req_status", headerName: "Req Status", width: 40 },
      { field: "prod_plan_id", headerName: "Prod Plan #", width: 25 },
      { field: "prod_status", headerName: "Prod Status", width: 40 },
      { field: "status", headerName: "Status", width: 50 },
    ],
    summaryFields: [
      { field: "total_orders", label: "Total Orders", type: "number" },
      { field: "total_ordered_qty", label: "Total Ordered Qty", type: "number" },
      { field: "total_dispatched_qty", label: "Total Dispatched Qty", type: "number" },
      { field: "total_remaining_qty", label: "Total Balance Qty", type: "number" },
    ],
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },
  serviceOrder: {
    title: "Service Order Report",
    description: "Detailed report of all service order transactions",
    apiEndpoint: "/api/reports/serviceOrder",
    detailData: "orderDetails",
    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        required: true,
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        required: true,
      },
      {
        name: "req_no",
        label: "Requisition",
        type: "select",
        options: "requisitions",
        apiEndpoint: "/api/material/requisition?category=SERVICE",
        nameKey: "tran_id",
        valueKey: "tran_id",
        clearable: true,
      },
      {
        name: "service",
        label: "Service",
        type: "select",
        options: "services",
        apiEndpoint: "/api/setup/services",
        nameKey: "service_name",
        valueKey: "id",
        clearable: true,
      },
      {
        name: "godown",
        nameKey: "godown",
        label: "Godown",
        type: "select",
        options: "godowns",
        default: { value: "", label: "All Godowns" },
        apiEndpoint: "/api/setup/godowns?includeInactive=true",
        clearable: true,
      },
    ],
    columns: [
      { field: "dated", headerName: "Date", width: 50, type: "date" },
      { field: "order_no", headerName: "Service Order No", width: 65 },
      // {
      //   field: "vendor_name",
      //   headerName: "Vendor",
      //   width: 200,
      //   valueGetter: (params) => params.row.acno?.acname || "",
      // },
      {
        field: "req_no",
        headerName: "Material Requisition No",
        width: 60,
        valueGetter: (params) => params.row.req_no || "",
      },
      {
        field: "total_amount",
        headerName: "Total Amount",
        width: 100,
        type: "currency",
      },
    ],
    detailColumns: [
      {
        field: "service_id",
        headerName: "Service",
        width: 90,
        valueGetter: (params) => params.row.services?.service_name || "",
      },
      { field: "qty", headerName: "Qty", width: 20, type: "number" },
      { field: "amount", headerName: "Amount", width: 20, type: "currency" },
    ],
    summaryFields: [
      { field: "total_qty", label: "Total Quantity", type: "number" },
      { field: "total_amount", label: "Total Amount", type: "currency" },
    ],
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },
  serviceEntry: {
    title: "Service Entry Report",
    description: "Detailed report of all service entry transactions",
    apiEndpoint: "/api/reports/serviceEntry",
    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        required: true,
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        required: true,
      },
      {
        name: "service",
        label: "Service Order",
        type: "select",
        options: "serviceOrders",
        apiEndpoint: "/api/orders/serviceOrder",
        valueKey: "order_no",
        nameKey: "order_no",
        clearable: true,
      },
      {
        name: "vendor",
        nameKey: "acname",
        valueKey: "acno",
        label: "Vendor",
        type: "select",
        options: "vendors",
        default: { value: "", label: "All Vendors" },
        apiEndpoint: `/api/accounts/acno?${VENDOR_GROUP_PARAM}`,
        clearable: true,
      },
      {
        name: "godown",
        nameKey: "godown",
        label: "Godown",
        type: "select",
        options: "godowns",
        default: { value: "", label: "All Godowns" },
        apiEndpoint: "/api/setup/godowns?includeInactive=true",
        clearable: true,
      },
    ],
    columns: [
      { field: "dated", headerName: "Date", width: 60, type: "date" },
      { field: "vr_no", headerName: "Voucher #", width: 60, type: "text" },
      { field: "service_id", headerName: "Service Order #", width: 70 },
      { field: "account", headerName: "Vendor", width: 85 },
      // { field: "amount", headerName: "Amount", width: 150, type: "currency" },
      // { field: "narration", headerName: "Narration", width: 200 },
    ],
    // detailColumns: [
    //   { field: "item", headerName: "Item", width: 90 },
    //   { field: "qty", headerName: "Qty", width: 20, type: "number" },
    //   { field: "amount", headerName: "Amount", width: 20, type: "currency" },
    // ],
    summaryFields: [
      { field: "total_qty", label: "Total Quantity", type: "number" },
      { field: "total_amount", label: "Total Amount", type: "currency" },
    ],
    exportOptions: { pdf: true, excel: true, csv: false },
  },
  serviceInvoice: {
    title: "Service Invoice Report",
    description: "Detailed report of all service invoices",
    apiEndpoint: "/api/reports/serviceInvoice",
    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        required: true,
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        required: true,
      },
      {
        name: "so_no",
        label: "Service Order No",
        type: "select",
        options: "serviceOrders",
        apiEndpoint: "/api/orders/serviceOrder",
        valueKey: "order_no",
        nameKey: "order_no",
        clearable: true,
      },
      {
        name: "vendor",
        nameKeys: ["acno", "acname"],
        separator: " - ",
        valueKey: "acno",
        label: "Vendor",
        type: "select",
        options: "vendors",
        default: { value: "", label: "All Vendors" },
        apiEndpoint: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`,
        clearable: true,
      },
    ],
    columns: [
      { field: "dated", headerName: "Date", width: 60, type: "date" },
      { field: "vr_no", headerName: "Voucher #", width: 60, type: "text" },
      { field: "service_id", headerName: "Service Order #", width: 70 },
      {
        field: "damt",
        headerName: "Total Amount",
        width: 85,
        type: "currency",
      },
    ],
    // detailColumns: [
    //   { field: "item", headerName: "Item", width: 90, valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.item || "" },
    //   { field: "qty", headerName: "Qty", width: 20, type: "number" },
    //   { field: "amount", headerName: "Amount", width: 20, type: "currency" },
    // ],
    summaryFields: [
      { field: "total_qty", label: "Total Quantity", type: "number" },
      { field: "total_amount", label: "Total Amount", type: "currency" },
    ],
    exportOptions: { pdf: true, excel: true, csv: false },
  },
  grn: {
    title: "GRN Report",
    description: "Detailed report of all GRN transactions",
    apiEndpoint: "/api/reports/grn",
    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        required: true,
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        required: true,
      },
      {
        name: "vendor",
        label: "Vendor",
        type: "select",
        nameKeys: ["acno", "acname"],
        separator: " - ",
        valueKey: "acno",
        options: "vendors",
        default: { value: "", label: "All Vendors" },
        apiEndpoint: `/api/accounts/acno?${VENDOR_GROUP_PARAM}`,
        clearable: true,
      },
      {
        name: "item",
        label: "Item",
        type: "select",
        default: { value: "", label: "All Items" },
        options: "products",
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["code", "item"],
        separator: " - ",
        clearable: true,
      },
      {
        name: "godown",
        nameKeys: ["id","godown"],
        label: "Warehouse",
        type: "select",
        default: { value: "", label: "All Godowns" },
        options: "godowns",
        apiEndpoint: "/api/setup/godowns?includeInactive=true",
        clearable: true,
      },
      {
        name: "po_no",
        label: "Purchase Order No",
        type: "select",
        default: { value: "", label: "All Purchase Orders No" },
        options: "orders",
        apiEndpoint: "/api/orders/purchaseOrder",
        valueKey: "order_no",
        nameKey: "order_no",
        clearable: true,
      },
      {
        name: "grn_no",
        label: "Good Receipts No",
        type: "select",
        default: { value: "", label: "All Good Receipts No" },
        options: "transactions",
        apiEndpoint: "/api/voucher/grn",
        valueKey: "grn_no",
        nameKey: "grn_no",
        clearable: true,
      },
      {
        name: "type",
        label: "Summary Type",
        type: "select",
        default: { label: "Product Detail", value: "product" },
        options: [
          { label: "Customer Summary", value: "customer" },
          { label: "Product Detail", value: "product" },
        ],
        clearable: true,
      },
    ],

    getColumns: (filters) => {
      if (filters?.type === "customer") {
        // 🔹 Customer summarized view
        return [
          { field: "dated", headerName: "Date", width: 30, type: "date" },
          // {
          //   field: "tran_id",
          //   headerName: "Transaction #",
          //   width: 30,
          //   type: "text",
          // },
          { field: "grn_no", headerName: "GRN No", width: 40 },
          {
            field: "vendor",
            headerName: "Vendor",
            width: 100,
            valueGetter: (params) => params.row?.acno?.acname || "",
          },
          {
            field: "po_no",
            headerName: "PO NO",
            width: 50,
          },
          {
            field: "rmk3",
            headerName: "Bill No",
            width: 50,
          },

          // {
          //   field: "itcd",
          //   headerName: "MM code",
          //   width: 50,
          //   valueGetter: (params) => params.row.transactions?.[0]?.itcd || "",
          // },
          {
            field: "code",
            headerName: "Code",
            width: 50,
            valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.code || "",
          },
          {
            field: "item",
            headerName: "Item Name",
            width: 50,
            valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.item || "",
          },
          { field: "rmk5", headerName: "Category", width: 35, type: "text" },

       
          {
            field: "qty", headerName: "Qty", width: 20, type: "number",
            valueGetter: (params) => params.row.transactions?.reduce((acc, transaction) => acc + transaction.qty, 0) || "", showTotal: true,
          },
          { field: "rmk", headerName: "Narration", width: 80 },

        ];
      }

      if (filters?.type === "product") {
        // 🔹 Product summarized view
        return [
          { field: "dated", headerName: "Date", width: 30, type: "date" },
          // {
          //   field: "tran_id",
          //   headerName: "Transaction #",
          //   width: 30,
          //   type: "text",
          // },
          { field: "grn_no", headerName: "GRN No", width: 40 },
          {
            field: "vendor",
            headerName: "Vendor",
            width: 100,
            valueGetter: (params) => params.row?.acno?.acname || "",
          },
          {
            field: "po_no",
            headerName: "PO NO",
            width: 50,
          },
          {
            field: "code",
            headerName: "Code",
            width: 50,
            valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.code || "",
          },
          // {
          //   field: "itcd",
          //   headerName: "MM code",
          //   width: 50,
          //   valueGetter: (params) => params.row.transactions?.[0]?.itcd || "",
          // },
          {
            field: "item",
            headerName: "Item Name",
            width: 50,
            valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.item || "",
          },
          { field: "rmk5", headerName: "Category", width: 35, type: "text" },

          
          {
            field: "qty", headerName: "Qty", width: 20, type: "number",
            valueGetter: (params) => params.row.transactions?.reduce((acc, transaction) => acc + transaction.qty, 0) || "", showTotal: true,
          },
          { field: "rmk", headerName: "Narration", width: 80 },

        ];
      }

      return [
        { field: "dated", headerName: "Date", width: 30, type: "date" },
        // {
        //   field: "tran_id",
        //   headerName: "Transaction #",
        //   width: 30,
        //   type: "text",
        // },
        { field: "grn_no", headerName: "GRN No", width: 40 },
        {
          field: "rmk3",
          headerName: "Bill No",
          width: 50,
        },
        {
          field: "acno",
          headerName: "Account No",
          width: 50,
          valueGetter: (params) => params.row.acno?.acno || "",
        },
        {
          field: "vendor_name",
          headerName: "Vendor",
          width: 100,
          valueGetter: (params) => params.row.acno?.acname || "",
        },
        {
          field: "po_no",
          headerName: "PO NO",
          width: 50,
        },
        {
          field: "code",
          headerName: "Code",
          width: 50,
          valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.code || "",
        },
        // {
        //   field: "itcd",
        //   headerName: "MM code",
        //   width: 50,
        //   valueGetter: (params) => params.row.transactions?.[0]?.itcd || "",
        // },
        {
          field: "item",
          headerName: "Item Name",
          width: 50,
          valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.item || "",
        },
        { field: "rmk5", headerName: "Category", width: 35, type: "text" },

   
        {
          field: "qty", headerName: "Qty", width: 20, type: "number",
          valueGetter: (params) => params.row.transactions?.reduce((acc, transaction) => acc + transaction.qty, 0) || "", showTotal: true,
        },
        { field: "rmk", headerName: "Narration", width: 80 },

      ];
    },




    // Wide-report layout (rule 15). Rows are GRN lines: each opens its voucher.
    layout: fitLayout("grn", (filters) => {
      const party = filterValue(filters?.type) === "customer" || filterValue(filters?.type) === "product" ? "vendor" : "vendor_name";
      return {
        pinned: ["dated", "grn_no"],
        groups: [
          { id: "doc", label: "Document", fields: ["rmk3", "po_no", "rmk"] },
          { id: "vendor", label: "Vendor", fields: ["acno", party] },
          { id: "item", label: "Item", fields: ["code", "item", "rmk5"] },
        ],
        card: {
          title: party,
          subtitle: (r) => [r.grn_no && `GRN ${r.grn_no}`, r.item].filter(Boolean).join(" · "),
          figures: ["qty"],
        },
      };
    }),
    detailColumns: [
      // {
      //   field: "itcd",
      //   headerName: "MM code",
      //   width: 50,
      // },
      {
        field: "code",
        headerName: "Ink Code",
        width: 90,
        valueGetter: (params) => params.row.itemDetails?.code || "",
      },
      {
        field: "item",
        headerName: "Item",
        width: 90,
        valueGetter: (params) => params.row.itemDetails?.item || "",
      },
      { field: "qty", headerName: "Qty", width: 20 },
    ],
    summaryFields: [
      { field: "total_qty", label: "Total Quantity", type: "number" },
    ],
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },

  // grn return report

  grnReturn: {
    title: "GRN Return Report",
    description: "Detailed report of all GRN transactions",
    apiEndpoint: "/api/reports/grnReturn",
    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        required: true,
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        required: true,
      },
      {
        name: "vendor",
        label: "Vendor",
        type: "select",
        nameKeys: ["acno", "acname"],
        separator: " - ",
        valueKey: "acno",
        options: "vendors",
        default: { value: "", label: "All Vendors" },
        apiEndpoint: `/api/accounts/acno?${VENDOR_GROUP_PARAM}`,
        clearable: true,
      },
      {
        name: "godown",
        nameKey: "godown",
        label: "Warehouse",
        type: "select",
        default: { value: "", label: "All Godowns" },
        options: "godowns",
        apiEndpoint: "/api/setup/godowns?includeInactive=true",
        clearable: true,
      },
      {
        name: "item",
        label: "Item",
        type: "select",
        default: { value: "", label: "All Items" },
        options: "products",
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["code", "item"],
        separator: " - ",
        clearable: true,
      },
      {
        name: "po_no",
        label: "Purchase Order No",
        type: "select",
        default: { value: "", label: "All Purchase Orders No" },
        options: "orders",
        apiEndpoint: "/api/orders/purchaseOrder",
        valueKey: "order_no",
        nameKey: "order_no",
        clearable: true,
      },
      {
        name: "grn_no",
        label: "Good Receipts No",
        type: "select",
        default: { value: "", label: "All Good Receipts No" },
        options: "transactions",
        apiEndpoint: "/api/voucher/grn",
        valueKey: "grn_no",
        nameKey: "grn_no",
        clearable: true,
      },
      {
        name: "type",
        label: "Summary Type",
        type: "select",
        default: { label: "Product Detail", value: "product" },
        options: [
          { label: "Customer Summary", value: "customer" },
          { label: "Product Detail", value: "product" },
        ],
        clearable: true,
      },
    ],

    getColumns: (filters) => {
      if (filters?.type === "customer") {
        // 🔹 Customer summarized view
        return [
          { field: "dated", headerName: "Date", width: 30, type: "date" },
          // {
          //   field: "tran_id",
          //   headerName: "Transaction #",
          //   width: 30,
          //   type: "text",
          // },
          { field: "grn_no", headerName: "GRN No", width: 40 },
          {
            field: "vendor",
            headerName: "Vendor",
            width: 100,
            valueGetter: (params) => params.row?.acno?.acname || "",
          },
          {
            field: "po_no",
            headerName: "PO NO",
            width: 50,
          },
          {
            field: "rmk3",
            headerName: "Bill No",
            width: 50,
          },

          // {
          //   field: "itcd",
          //   headerName: "MM code",
          //   width: 50,
          //   valueGetter: (params) => params.row.transactions?.[0]?.itcd || "",
          // },
          // {
          //   field: "item",
          //   headerName: "Item Name",
          //   width: 50,
          //   valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.item || "",
          // },
          // {
          //   field: "code",
          //   headerName: "Ink Code",
          //   width: 50,
          //   valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.code || "",
          // },

          { field: "rmk", headerName: "Narration", width: 80 },
          {
            field: "qty", headerName: "Qty", width: 20, type: "number",
            valueGetter: (params) => params.row.transactions?.reduce((acc, transaction) => acc + transaction.qty, 0) || "", showTotals: true
          }

        ];
      }

      if (filters?.type === "product") {
        // 🔹 Product summarized view
        return [
          { field: "dated", headerName: "Date", width: 30, type: "date" },
          // {
          //   field: "tran_id",
          //   headerName: "Transaction #",
          //   width: 30,
          //   type: "text",
          // },
          { field: "grn_no", headerName: "GRN No", width: 40 },
          {
            field: "vendor",
            headerName: "Vendor",
            width: 100,
            valueGetter: (params) => params.row?.acno?.acname || "",
          },
          {
            field: "po_no",
            headerName: "PO NO",
            width: 50,
          },
          // {
          //   field: "itcd",
          //   headerName: "MM code",
          //   width: 50,
          //   valueGetter: (params) => params.row.transactions?.[0]?.itcd || "",
          // },
          {
            field: "code",
            headerName: "Ink Code",
            width: 50,
            valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.code || "",
          },
          {
            field: "item",
            headerName: "Item Name",
            width: 50,
            valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.item || "",
          },

          { field: "rmk", headerName: "Narration", width: 80 },
          {
            field: "qty", showTotal: true, headerName: "Qty", width: 20, type: "number",
            valueGetter: (params) => params.row.transactions?.reduce((acc, transaction) => acc + transaction.qty, 0) || "", showTotals: true
          }

        ];
      }

      return [
        { field: "dated", headerName: "Date", width: 30, type: "date" },
        // {
        //   field: "tran_id",
        //   headerName: "Transaction #",
        //   width: 30,
        //   type: "text",
        // },
        { field: "grn_no", headerName: "GRN No", width: 40 },
        {
          field: "rmk3",
          headerName: "Bill No",
          width: 50,
        },
        {
          field: "acno",
          headerName: "Account No",
          width: 50,
          valueGetter: (params) => params.row.acno?.acno || "",
        },
        {
          field: "vendor_name",
          headerName: "Vendor",
          width: 100,
          valueGetter: (params) => params.row.acno?.acname || "",
        },
        {
          field: "po_no",
          headerName: "PO NO",
          width: 50,
        },
        // {
        //   field: "itcd",
        //   headerName: "MM code",
        //   width: 50,
        //   valueGetter: (params) => params.row.transactions?.[0]?.itcd || "",
        // },
        // {
        //   field: "code",
        //   headerName: "Ink Code",
        //   width: 50,
        //   valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.code || "",
        // },
        // {
        //   field: "item",
        //   headerName: "Item Name",
        //   width: 50,
        //   valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.item || "",
        // },

        { field: "rmk", headerName: "Narration", width: 80 },
        {
          field: "qty", headerName: "Qty", width: 20, type: "number",
          valueGetter: (params) => params.row.transactions?.reduce((acc, transaction) => acc + transaction.qty, 0) || "", showTotal: true
        }

      ];
    },


    // columns: [
    // { field: "dated", headerName: "Date", width: 30, type: "date" },
    // // {
    // //   field: "tran_id",
    // //   headerName: "Transaction #",
    // //   width: 30,
    // //   type: "text",
    // // },
    // { field: "grn_no", headerName: "GRN No", width: 40 },
    // {
    //   field: "vendor_name",
    //   headerName: "Vendor",
    //   width: 100,
    //   valueGetter: (params) => params.row.acno?.acname || "",
    // },
    // {
    //   field: "po_no",
    //   headerName: "PO NO",
    //   width: 50,
    // },
    // {
    //   field: "itcd",
    //   headerName: "MM code",
    //   width: 50,
    //   valueGetter: (params) => params.row.transactions?.[0]?.itcd || "",
    // },
    // {
    //   field: "item",
    //   headerName: "Item Name",
    //   width: 50,
    //   valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.item || "",
    // },
    // {
    //   field: "code",
    //   headerName: "Ink Code",
    //   width: 50,
    //   valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.code || "",
    // },

    // { field: "rmk", headerName: "Narration", width: 80 },
    // {
    //   field: "qty", headerName: "Qty", width: 20, type: "number",
    //   valueGetter: (params) => params.row.transactions?.reduce((acc, transaction) => acc + transaction.qty, 0) || "",
    // }
    // ],



    // Wide-report layout (rule 15). Rows are GRN lines: each opens its voucher.
    layout: fitLayout("grnReturn", (filters) => {
      const party = filterValue(filters?.type) === "customer" || filterValue(filters?.type) === "product" ? "vendor" : "vendor_name";
      return {
        pinned: ["dated", "grn_no"],
        groups: [
          { id: "doc", label: "Document", fields: ["rmk3", "po_no", "rmk"] },
          { id: "vendor", label: "Vendor", fields: ["acno", party] },
          { id: "item", label: "Item", fields: ["code", "item", "rmk5"] },
        ],
        card: {
          title: party,
          subtitle: (r) => [r.grn_no && `GRN ${r.grn_no}`, r.item].filter(Boolean).join(" · "),
          figures: ["qty"],
        },
      };
    }),
    detailColumns: [
      {
        field: "itcd",
        headerName: "MM code",
        width: 50,
      },
      {
        field: "item",
        headerName: "Item",
        width: 90,
        valueGetter: (params) => params.row.itemDetails?.item || "",
      },
      {
        field: "code",
        headerName: "Ink code",
        width: 90,
        valueGetter: (params) => params.row.itemDetails?.code || "",
      },
      { field: "qty", headerName: "Qty", width: 20 },
    ],
    summaryFields: [
      { field: "total_qty", label: "Total Quantity", type: "number" },
    ],
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },
  // grn: {
  //   title: "GRN Report",
  //   description: "Detailed report of all GRN transactions",
  //   apiEndpoint: "/api/reports/grn",
  //   filters: [
  //     {
  //       name: "dateFrom",
  //       label: "From Date",
  //       type: "date",
  //       default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  //       required: true,
  //     },
  //     {
  //       name: "dateTo",
  //       label: "To Date",
  //       type: "date",
  //       default: new Date(),
  //       required: true,
  //     },
  //     {
  //       name: "vendor",
  //       label: "Vendor",
  //       type: "select",
  //       nameKey: "acname",
  //       valueKey: "acno",
  //       options: "vendors",
  //       default: { value: "", label: "All Vendors" },
  //       apiEndpoint: `/api/accounts/acno?${VENDOR_GROUP_PARAM}`,
  //       clearable: true,
  //     },
  //     {
  //       name: "godown",
  //       nameKey: "godown",
  //       label: "Warehouse",
  //       type: "select",
  //       default: { value: "", label: "All Godowns" },
  //       options: "godowns",
  //       apiEndpoint: "/api/setup/godowns?includeInactive=true",
  //       clearable: true,
  //     },
  //     {
  //       name: "item",
  //       label: "Item",
  //       type: "select",
  //       default: { value: "", label: "All Items" },
  //       options: "products",
  //       apiEndpoint: "/api/setup/items",
  //       valueKey: "itcd",
  //       nameKeys: ["itcd", "item", "code"],
  //       separator: " - ",
  //       clearable: true,
  //     },
  //     {
  //       name: "po_no",
  //       label: "Purchase Order No",
  //       type: "select",
  //       default: { value: "", label: "All Purchase Orders No" },
  //       options: "orders",
  //       apiEndpoint: "/api/orders/purchaseOrder",
  //       valueKey: "order_no",
  //       nameKey: "order_no",
  //       clearable: true,
  //     },
  //     {
  //       name: "grn_no",
  //       label: "Good Receipts No",
  //       type: "select",
  //       default: { value: "", label: "All Good Receipts No" },
  //       options: "transactions",
  //       apiEndpoint: "/api/voucher/grn",
  //       valueKey: "grn_no",
  //       nameKey: "grn_no",
  //       clearable: true,
  //     },
  //     {
  //       name: "type",
  //       label: "Summary Type",
  //       type: "select",
  //       options: [
  //         { label: "Product Detail", value: "product" },
  //         { label: "Customer Summary", value: "customer" },
  //       ],
  //       clearable: true,
  //     },
  //   ],

  //    getColumns: (filters) => {
  //     if (filters?.type === "customer") {
  //       // 🔹 Customer summarized view
  //       return [
  //         { field: "dated", headerName: "Date", width: 30, type: "date" },
  //     // {
  //     //   field: "tran_id",
  //     //   headerName: "Transaction #",
  //     //   width: 30,
  //     //   type: "text",
  //     // },
  //     { field: "grn_no", headerName: "GRN No", width: 40 },
  //     {
  //       field: "customer_name",
  //       headerName: "Customer Name",
  //       width: 100,
  //       valueGetter: (params) => params.row.customer_name || "",
  //     },
  //     {
  //       field: "po_no",
  //       headerName: "PO NO",
  //       width: 50,
  //     },
  //     {
  //       field: "itcd",
  //       headerName: "MM code",
  //       width: 50,
  //       valueGetter: (params) => params.row.transactions?.[0]?.itcd || "",
  //     },
  //     {
  //       field: "item",
  //       headerName: "Item Name",
  //       width: 50,
  //       valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.item || "",
  //     },
  //     {
  //       field: "code",
  //       headerName: "Ink Code",
  //       width: 50,
  //       valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.code || "",
  //     },

  //     { field: "rmk", headerName: "Narration", width: 80 },
  //     {
  //       field: "qty", headerName: "Qty", width: 20, type: "number",
  //       valueGetter: (params) => params.row.transactions?.reduce((acc, transaction) => acc + transaction.qty, 0) || "",
  //     }

  //       ];
  //     }

  //     if (filters?.type === "product") {
  //       // 🔹 Product summarized view
  //       return [
  //         { field: "dated", headerName: "Date", width: 30, type: "date" },
  //     // {
  //     //   field: "tran_id",
  //     //   headerName: "Transaction #",
  //     //   width: 30,
  //     //   type: "text",
  //     // },
  //     { field: "grn_no", headerName: "GRN No", width: 40 },
  //     {
  //       field: "vendor_name",
  //       headerName: "Vendor",
  //       width: 100,
  //       valueGetter: (params) => params.row.acno?.acname || "",
  //     },
  //     {
  //       field: "po_no",
  //       headerName: "PO NO",
  //       width: 50,
  //     },
  //     {
  //       field: "itcd",
  //       headerName: "MM code",
  //       width: 50,
  //       valueGetter: (params) => params.row.transactions?.[0]?.itcd || "",
  //     },
  //     {
  //       field: "item",
  //       headerName: "Item Name",
  //       width: 50,
  //       valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.item || "",
  //     },
  //     {
  //       field: "code",
  //       headerName: "Ink Code",
  //       width: 50,
  //       valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.code || "",
  //     },

  //     { field: "rmk", headerName: "Narration", width: 80 },
  //     {
  //       field: "qty", headerName: "Qty", width: 20, type: "number",
  //       valueGetter: (params) => params.row.transactions?.reduce((acc, transaction) => acc + transaction.qty, 0) || "",
  //     }

  //       ];
  //     }

  //     return [
  //         { field: "dated", headerName: "Date", width: 30, type: "date" },
  //     // {
  //     //   field: "tran_id",
  //     //   headerName: "Transaction #",
  //     //   width: 30,
  //     //   type: "text",
  //     // },
  //     { field: "grn_no", headerName: "GRN No", width: 40 },
  //     {
  //       field: "vendor_name",
  //       headerName: "Vendor",
  //       width: 100,
  //       valueGetter: (params) => params.row.acno?.acname || "",
  //     },
  //     {
  //       field: "po_no",
  //       headerName: "PO NO",
  //       width: 50,
  //     },
  //     {
  //       field: "itcd",
  //       headerName: "MM code",
  //       width: 50,
  //       valueGetter: (params) => params.row.transactions?.[0]?.itcd || "",
  //     },
  //     {
  //       field: "item",
  //       headerName: "Item Name",
  //       width: 50,
  //       valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.item || "",
  //     },
  //     {
  //       field: "code",
  //       headerName: "Ink Code",
  //       width: 50,
  //       valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.code || "",
  //     },

  //     { field: "rmk", headerName: "Narration", width: 80 },
  //     {
  //       field: "qty", headerName: "Qty", width: 20, type: "number",
  //       valueGetter: (params) => params.row.transactions?.reduce((acc, transaction) => acc + transaction.qty, 0) || "",
  //     }

  //     ];
  //   },


  //   // columns: [
  //     // { field: "dated", headerName: "Date", width: 30, type: "date" },
  //     // // {
  //     // //   field: "tran_id",
  //     // //   headerName: "Transaction #",
  //     // //   width: 30,
  //     // //   type: "text",
  //     // // },
  //     // { field: "grn_no", headerName: "GRN No", width: 40 },
  //     // {
  //     //   field: "vendor_name",
  //     //   headerName: "Vendor",
  //     //   width: 100,
  //     //   valueGetter: (params) => params.row.acno?.acname || "",
  //     // },
  //     // {
  //     //   field: "po_no",
  //     //   headerName: "PO NO",
  //     //   width: 50,
  //     // },
  //     // {
  //     //   field: "itcd",
  //     //   headerName: "MM code",
  //     //   width: 50,
  //     //   valueGetter: (params) => params.row.transactions?.[0]?.itcd || "",
  //     // },
  //     // {
  //     //   field: "item",
  //     //   headerName: "Item Name",
  //     //   width: 50,
  //     //   valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.item || "",
  //     // },
  //     // {
  //     //   field: "code",
  //     //   headerName: "Ink Code",
  //     //   width: 50,
  //     //   valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.code || "",
  //     // },

  //     // { field: "rmk", headerName: "Narration", width: 80 },
  //     // {
  //     //   field: "qty", headerName: "Qty", width: 20, type: "number",
  //     //   valueGetter: (params) => params.row.transactions?.reduce((acc, transaction) => acc + transaction.qty, 0) || "",
  //     // }
  //   // ],


  //   detailColumns: [
  //     {
  //       field: "itcd",
  //       headerName: "MM code",
  //       width: 50,
  //     },
  //     {
  //       field: "item",
  //       headerName: "Item",
  //       width: 90,
  //       valueGetter: (params) => params.row.itemDetails?.item || "",
  //     },
  //     { field: "qty", headerName: "Qty", width: 20 },
  //   ],
  //   summaryFields: [
  //     { field: "total_qty", label: "Total Quantity", type: "number" },
  //   ],
  //   exportOptions: {
  //     pdf: true,
  //     excel: true,
  //     csv: false,
  //   },
  // },

  dispatch: {
    title: "Dispatch Report",
    description: "Detailed report of all dispatch transactions",
    apiEndpoint: "/api/reports/dispatch",
    groupBy: "so_no",
    layout: "nested",
    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        required: true,
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        required: true,
      },
      {
        name: "customer",
        label: "Customer",
        type: "select",
        nameKeys: ["acno", "acname"],
        separator: " - ",
        valueKey: "acno",
        options: "customers",
        default: { value: "", label: "All Customers" },
        apiEndpoint: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`,
        clearable: true,
      },
      {
        name: "item",
        label: "Item",
        type: "select",
        default: { value: "", label: "All Items" },
        options: "products",
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["code", "item"],
        separator: " - ",
        clearable: true,
      },
      {
        name: "godown",
        nameKeys:["id","godown"],
        label: "Warehouse",
        type: "select",
        default: { value: "", label: "All Warehouses" },
        options: "godowns",
        apiEndpoint: "/api/setup/godowns?includeInactive=true",
        clearable: true,
      },
      {
        name: "inkSeries",
        label: "Ink Series",
        type: "select",
        options: "main_categories",
        default: { value: "", label: "All Ink Series" },
        apiEndpoint: "/api/setup/main_categories",
        valueKey: "id",
        nameKeys: ["mc_name"],
        clearable: true,
        multiple: true,
      },
      {
        name: "so_no",
        label: "Sale Order No",
        type: "select",
        options: "orders",
        apiEndpoint: "/api/orders/saleOrder?limit=1000",
        valueKey: "order_no",
        nameKey: "order_no",
        default: { value: "", label: "All Sale Orders No" },
        clearable: true,
      },
      {
        // Dispatch No (getSaleReport) — the latest 1000 dispatches, searchable
        name: "dispatch_no",
        label: "Dispatch No",
        type: "select",
        options: "dispatches",
        apiEndpoint: "/api/voucher/dispatch?limit=1000",
        valueKey: "dispatch_no",
        nameKey: "dispatch_no",
        default: { value: "", label: "All Dispatch No" },
        clearable: true,
      },
      {
        name: "type",
        label: "Summary Type",
        type: "select",
        default: { label: "Product Detail", value: "product" },
        options: [
          { label: "Customer Summary", value: "customer" },
          { label: "Product Detail", value: "product" },
        ],
        clearable: true,
      },
      {
        // Only dispatches with no invoice number yet (no rates) — same
        // rows as the Dispatch Without Rates report
        name: "withoutRate",
        label: "Without Rate",
        type: "checkbox",
        default: false,
      },
      {
        // Off by default: lines with 0 qty / 0 litres are hidden
        name: "showZeroQty",
        label: "Show Zero Qty",
        type: "checkbox",
        default: false,
      },
      // {
      //   name: "region",
      //   label: "Region",
      //   type: "select",
      //   options: [
      //     { value: "NORTH", label: "NORTH" },
      //     { value: "SOUTH", label: "SOUTH" },
      //   ],
      //   clearable: true,
      //   defaultValue: { value: "NORTH", label: "NORTH" },
      // },
    ],
    getColumns: (filters) => {
      if (filters?.type === "customer") {
        // 🔹 Customer summarized view
        return [
          { field: "dated", headerName: "Date", width: 30, type: "date" },
          { field: "so_no", headerName: "SO NO", width: 30, type: "text" },
          { field: "po_no", headerName: "PO NO", width: 30, type: "text" },
          {
            field: "tran_id",
            headerName: "Transaction #",
            width: 30,
            type: "text",
          },
          { field: "dispatch_no", headerName: "Dispatch No", width: 40 },
          {
            field: "vendor_name",
            headerName: "Customer",
            width: 100,
            valueGetter: (params) => params.row.acno?.acname || "",
          },
          {
            field: "qty", headerName: "Qty (KG)", width: 20, type: "number",
            valueGetter: (params) => params.row.transactions?.reduce((acc, transaction) => acc + transaction.qty, 0) || "", showTotal: true
          },
          // Litres — only on lines dispatched in LTR, blank on KG lines
          {
            field: "qty_ltr", headerName: "Qty (LTR)", width: 20, showTotal: true,
            valueGetter: (params) => { const ls = (params.row.transactions || []).filter((l) => String(l?.unit || "").toUpperCase() === "LTR"); return ls.length ? ls.reduce((a, l) => a + (Number(l.qty_ltr) || 0), 0) : ""; },
          },
          { field: "rmk", headerName: "Narration", width: 80 },

        ];
      }

      if (filters?.type === "product") {

        return [
          { field: "dated", headerName: "Date", width: 30, type: "date" },
          { field: "so_no", headerName: "SO NO", width: 30, type: "text" },
          { field: "po_no", headerName: "PO NO", width: 30, type: "text" },
          {
            field: "tran_id",
            headerName: "Transaction #",
            width: 30,
            type: "text",
          },
          { field: "dispatch_no", headerName: "Dispatch No", width: 40 },
          {
            field: "vendor_name",
            headerName: "Customer",
            width: 100,
            valueGetter: (params) => params.row.acno?.acname || "",
          },
          {
            field: "code",
            headerName: "Code",
            width: 50,
            valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.code || "",
          },
          {
            field: "item",
            headerName: "Item",
            width: 100,
            valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.item || "",
          },
          {
            // Ink Series = the item's Main Category (Item.mc_id)
            field: "ink_series",
            headerName: "Ink Series",
            width: 60,
            valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.mainCategory?.mc_name || "",
          },
       

          {
            field: "qty", headerName: "Qty (KG)", width: 20, type: "number",
            valueGetter: (params) => params.row.transactions?.reduce((acc, transaction) => acc + transaction.qty, 0) || "",
            showTotal: true
          },
          // Litres — only on lines dispatched in LTR, blank on KG lines
          {
            field: "qty_ltr", headerName: "Qty (LTR)", width: 20,  showTotal: true ,
            valueGetter: (params) => { const ls = (params.row.transactions || []).filter((l) => String(l?.unit || "").toUpperCase() === "LTR"); return ls.length ? ls.reduce((a, l) => a + (Number(l.qty_ltr) || 0), 0) : "";  },
          },
          { field: "rmk", headerName: "Narration", width: 80 },
        ];
      }

      return [
        { field: "dated", headerName: "Date", width: 30, type: "date" },
        { field: "so_no", headerName: "SO NO", width: 30, type: "text" },
        { field: "po_no", headerName: "PO NO", width: 30, type: "text" },
        {
          field: "tran_id",
          headerName: "Transaction #",
          width: 30,
          type: "text",
        },
        { field: "dispatch_no", headerName: "Dispatch No", width: 40 },
        { field: "ac_no", headerName: "Account No", width: 30, valueGetter: (params) => params.row.acno?.acno || "" },
        {
          field: "region",
          headerName: "Region",
          valueGetter: (params) => params.row.ordersSO?.region || "",
        },
        {
          field: "vendor_name",
          headerName: "Customer",
          width: 100,
          valueGetter: (params) => params.row.acno?.acname || "",
        },
        {
          field: "code",
          headerName: "Code",
          width: 50,
          valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.code || "",
        },
        // {
        //   field: "itcd",
        //   headerName: "MM code",
        //   width: 50,
        //   valueGetter: (params) => params.row.transactions?.[0]?.itcd || "",
        // },
        {
          field: "item",
          headerName: "Item",
          width: 100,
          valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.item || "",
        },
        { field: "rmk5", headerName: "Category", width: 35, type: "text" },
        {
          field: "qty", headerName: "Qty (KG)", width: 20, type: "number",
          valueGetter: (params) => params.row.transactions?.reduce((acc, transaction) => acc + transaction.qty, 0) || "",
          showTotal: true
        },
        // Litres — only on lines dispatched in LTR, blank on KG lines
        {
          field: "qty_ltr", headerName: "Qty (LTR)", width: 20, showTotal: true ,
          valueGetter: (params) => { const ls = (params.row.transactions || []).filter((l) => String(l?.unit || "").toUpperCase() === "LTR"); return ls.length ? ls.reduce((a, l) => a + (Number(l.qty_ltr) || 0), 0) : ""; },
        },
        { field: "rmk", headerName: "Narration", width: 80 },
      ]
    },

    // columns: [
    //   { field: "dated", headerName: "Date", width: 30, type: "date" },
    //   { field: "so_no", headerName: "SO NO", width: 30, type: "text" },
    //   { field: "po_no", headerName: "PO NO", width: 30, type: "text" },
    //   {
    //     field: "tran_id",
    //     headerName: "Transaction #",
    //     width: 30,
    //     type: "text",
    //   },
    //   { field: "dispatch_no", headerName: "Dispatch No", width: 40 },
    //   {
    //     field: "vendor_name",
    //     headerName: "Customer",
    //     width: 100,
    //     valueGetter: (params) => params.row.acno?.acname || "",
    //   },
    //   {
    //     field: "itcd",
    //     headerName: "MM code",
    //     width: 50,
    //     valueGetter: (params) => params.row.transactions?.[0]?.itcd || "",
    //   },
    //   {
    //     field: "code",
    //     headerName: "Ink Code",
    //     width: 50,
    //     valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.code || "",
    //   },
    //   { field: "rmk", headerName: "Narration", width: 80 },
    //   {
    //     field: "qty", headerName: "Qty", width: 20, type: "number",
    //     valueGetter: (params) => params.row.transactions?.reduce((acc, transaction) => acc + transaction.qty, 0) || "",
    //   }
    // ],

    // Wide-report layout (rule 15). `layout` is still "nested" (classic
    // customer-block export), so this sits in wideLayout — resolveLayout()
    // (components/Reports/layout.js) has to read config.wideLayout ?? config.layout.
    // Rows are dispatch documents / lines: each opens its voucher.
    wideLayout: fitLayout("dispatch", () => ({
      pinned: ["dated", "dispatch_no"],
      groups: [
        { id: "doc", label: "Document", fields: ["so_no", "po_no", "tran_id"] },
        { id: "cust", label: "Customer", fields: ["ac_no", "region", "vendor_name"] },
        { id: "item", label: "Item", fields: ["code", "item", "rmk5", "ink_series"] },
        { id: "qty", label: "Quantity", fields: ["qty", "qty_ltr"] },
      ],
      views: [
        { id: "standard", label: "Standard", fields: ["so_no", "po_no", "ac_no", "vendor_name", "code", "item", "rmk5", "ink_series", "qty", "qty_ltr"] },
        { id: "all", label: "Everything" },
      ],
      defaultView: "standard",
      unitSwitch: {
        label: "Quantity",
        options: [
          { id: "kg", label: "KG", fields: ["qty"] },
          { id: "ltr", label: "LTR", fields: ["qty_ltr"] },
        ],
        default: "kg",
      },
      card: {
        title: "vendor_name",
        subtitle: (r) => [r.dispatch_no && `DC ${r.dispatch_no}`, r.so_no && `SO ${r.so_no}`, r.item].filter(Boolean).join(" · "),
        figures: ["qty", "qty_ltr"],
      },
    })),
    detailColumns: [
      // {
      //   field: "itcd",
      //   headerName: "MM#",
      //   width: 30,
      //   type: "text",
      //   valueGetter: (params) => params.row.itemDetails?.itcd || "",
      // },
      {
        field: "item",
        headerName: "Product Description",
        width: 90,
        valueGetter: (params) => params.row.itemDetails?.item || "",
      },
      { field: "code", headerName: "Code", width: 20, type: "number", valueGetter: (params) => params.row.itemDetails?.code || "", },
      { field: "batch_no", headerName: "Batch#", width: 20, type: "number" },
      { field: "qty", headerName: "Qty (KG)", width: 20, type: "number" },
      { field: "qty_ltr", headerName: "Qty (LTR)", width: 20, valueGetter: (params) => (String(params.row.unit || "").toUpperCase() === "LTR" ? params.row.qty_ltr ?? "" : "") },
    ],
    summaryFields: [
      { field: "total_qty", label: "Total Quantity (KG)", type: "number" },
      { field: "total_qty_ltr", label: "Total Quantity (LTR)", type: "number" },
    ],
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },

  //  Dispatch Return Report
  dispatchReturn: {
    title: "Dispatch Return Report",
    description: "Detailed report of all dispatch transactions",
    apiEndpoint: "/api/reports/dispatchReturn",
    groupBy: "so_no",
    layout: "nested",
    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        required: true,
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        required: true,
      },
      {
        name: "customer",
        label: "Customer",
        type: "select",
        nameKeys: ["acno", "acname"],
        separator: " - ",
        valueKey: "acno",
        options: "customers",
        default: { value: "", label: "All Customers" },
        apiEndpoint: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`,
        clearable: true,
      },
      {
        name: "godown",
        nameKeys: ["id","godown"],
        label: "Warehouse",
        type: "select",
        default: { value: "", label: "All Warehouses" },
        options: "godowns",
        apiEndpoint: "/api/setup/godowns?includeInactive=true",
        clearable: true,
      },
      {
        name: "item",
        label: "Item",
        type: "select",
        default: { value: "", label: "All Items" },
        options: "products",
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["code","item"],
        separator: " - ",
        clearable: true,
      },
      {
        name: "so_no",
        label: "Sale Order No",
        type: "select",
        options: "orders",
        apiEndpoint: "/api/orders/saleOrder",
        valueKey: "order_no",
        nameKey: "order_no",
        default: { value: "", label: "All Sale Orders No" },
        clearable: true,
      },
      {
        name: "type",
        label: "Summary Type",
        type: "select",
        default: { label: "Product Detail", value: "product" },
        options: [
          { label: "Customer Summary", value: "customer" },
          { label: "Product Detail", value: "product" },
        ],
        clearable: true,
      },
    ],
    getColumns: (filters) => {
      if (filters?.type === "customer") {
        // 🔹 Customer summarized view
        return [
          { field: "dated", headerName: "Date", width: 30, type: "date" },
          { field: "so_no", headerName: "SO NO", width: 30, type: "text" },
          { field: "po_no", headerName: "PO NO", width: 30, type: "text" },
          {
            field: "tran_id",
            headerName: "Transaction #",
            width: 30,
            type: "text",
          },
          { field: "dispatch_no", headerName: "Dispatch No", width: 40 },
          {
            field: "vendor_name",
            headerName: "Customer",
            width: 100,
            valueGetter: (params) => params.row.acno?.acname || "",
          },
          // {
          //   field: "itcd",
          //   headerName: "MM code",
          //   width: 50,
          //   valueGetter: (params) => params.row.transactions?.[0]?.itcd || "",
          // },
          // {
          //   field: "code",
          //   headerName: "Ink Code",
          //   width: 50,
          //   valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.code || "",
          // },
          { field: "rmk", headerName: "Narration", width: 80 },
          {
            field: "qty", headerName: "Qty", width: 20, type: "number",
            valueGetter: (params) => params.row.transactions?.reduce((acc, transaction) => acc + transaction.qty, 0) || "", showTotals: true
          }

        ];
      }

      if (filters?.type === "product") {

        return [
          { field: "dated", headerName: "Date", width: 30, type: "date" },
          { field: "so_no", headerName: "SO NO", width: 30, type: "text" },
          { field: "dispatch_no", headerName: "Dispatch No", width: 40 },
          { field: "po_no", headerName: "PO NO", width: 30, type: "text" },
          {
            field: "tran_id",
            headerName: "Transaction #",
            width: 30,
            type: "text",
          },
          {
            field: "vendor_name",
            headerName: "Customer",
            width: 100,
            valueGetter: (params) => params.row.acno?.acname || "",
          },
          {
            field: "code",
            headerName: "Ink Code",
            width: 50,
            valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.code || "",
          },
          {
            field: "item",
            headerName: "Item",
            width: 100,
            valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.item || "",
          },
          // {
          //   field: "itcd",
          //   headerName: "MM code",
          //   width: 50,
          //   valueGetter: (params) => params.row.transactions?.[0]?.itcd || "",
          // },
          { field: "rmk", headerName: "Narration", width: 80 },
          {
            field: "qty", showTotal: true, headerName: "Qty", width: 20, type: "number",
            valueGetter: (params) => params.row.transactions?.reduce((acc, transaction) => acc + transaction.qty, 0) || "", showTotals: true
          }
        ];
      }

      return [
        { field: "dated", headerName: "Date", width: 30, type: "date" },
        { field: "so_no", headerName: "SO NO", width: 30, type: "text" },
        { field: "po_no", headerName: "PO NO", width: 30, type: "text" },
        {
          field: "tran_id",
          headerName: "Transaction #",
          width: 30,
          type: "text",
        },
        { field: "dispatch_no", headerName: "Dispatch No", width: 40 },
        { field: "ac_no", headerName: "Account No", width: 30, valueGetter: (params) => params.row.acno?.acno || "" },
        {
          field: "vendor_name",
          headerName: "Customer",
          width: 100,
          valueGetter: (params) => params.row.acno?.acname || "",
        },
        // {
        //   field: "itcd",
        //   headerName: "MM code",
        //   width: 50,
        //   valueGetter: (params) => params.row.transactions?.[0]?.itcd || "",
        // },
        // {
        //   field: "code",
        //   headerName: "Ink Code",
        //   width: 50,
        //   valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.code || "",
        // },
        { field: "rmk", headerName: "Narration", width: 80 },
        {
          field: "qty", showTotal: true, headerName: "Qty", width: 20, type: "number",
          valueGetter: (params) => params.row.transactions?.reduce((acc, transaction) => acc + transaction.qty, 0) || "", showTotals: true
        }
      ]
    },

    // columns: [
    //   { field: "dated", headerName: "Date", width: 30, type: "date" },
    //   { field: "so_no", headerName: "SO NO", width: 30, type: "text" },
    //   { field: "po_no", headerName: "PO NO", width: 30, type: "text" },
    //   {
    //     field: "tran_id",
    //     headerName: "Transaction #",
    //     width: 30,
    //     type: "text",
    //   },
    //   { field: "dispatch_no", headerName: "Dispatch No", width: 40 },
    //   {
    //     field: "vendor_name",
    //     headerName: "Customer",
    //     width: 100,
    //     valueGetter: (params) => params.row.acno?.acname || "",
    //   },
    //   {
    //     field: "itcd",
    //     headerName: "MM code",
    //     width: 50,
    //     valueGetter: (params) => params.row.transactions?.[0]?.itcd || "",
    //   },
    //   {
    //     field: "code",
    //     headerName: "Ink Code",
    //     width: 50,
    //     valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.code || "",
    //   },
    //   { field: "rmk", headerName: "Narration", width: 80 },
    //   {
    //     field: "qty", headerName: "Qty", width: 20, type: "number",
    //     valueGetter: (params) => params.row.transactions?.reduce((acc, transaction) => acc + transaction.qty, 0) || "",
    //   }
    // ],

    // Wide-report layout (rule 15). `layout` is still "nested" (classic
    // customer-block export), so this sits in wideLayout — resolveLayout()
    // (components/Reports/layout.js) has to read config.wideLayout ?? config.layout.
    // Rows are dispatch documents / lines: each opens its voucher.
    wideLayout: fitLayout("dispatchReturn", () => ({
      pinned: ["dated", "dispatch_no"],
      groups: [
        { id: "doc", label: "Document", fields: ["so_no", "po_no", "tran_id"] },
        { id: "cust", label: "Customer", fields: ["ac_no", "region", "vendor_name"] },
        { id: "item", label: "Item", fields: ["code", "item", "rmk5", "ink_series"] },
        { id: "qty", label: "Quantity", fields: ["qty"] },
      ],
      views: [
        { id: "standard", label: "Standard", fields: ["so_no", "po_no", "ac_no", "vendor_name", "code", "item", "rmk5", "ink_series", "qty"] },
        { id: "all", label: "Everything" },
      ],
      defaultView: "standard",
      card: {
        title: "vendor_name",
        subtitle: (r) => [r.dispatch_no && `DC ${r.dispatch_no}`, r.so_no && `SO ${r.so_no}`, r.item].filter(Boolean).join(" · "),
        figures: ["qty"],
      },
    })),
    detailColumns: [
      // {
      //   field: "itcd",
      //   headerName: "MM#",
      //   width: 30,
      //   type: "text",
      //   valueGetter: (params) => params.row.itemDetails?.itcd || "",
      // },
      {
        field: "item",
        headerName: "Product Description",
        width: 90,
        valueGetter: (params) => params.row.itemDetails?.item || "",
      },
      { field: "code", headerName: "Code", width: 20, type: "number", valueGetter: (params) => params.row.itemDetails?.code || "", },
      { field: "batch_no", headerName: "Batch#", width: 20, type: "number" },
      { field: "qty", headerName: "Qty", width: 20, type: "number", showTotal: true },
    ],
    summaryFields: [
      { field: "total_qty", label: "Total Quantity", type: "number" },
    ],
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },
  // dispatch: {
  //   title: "Dispatch Report",
  //   description: "Detailed report of all dispatch transactions",
  //   apiEndpoint: "/api/reports/dispatch",
  //   groupBy: "so_no",
  //   layout: "nested",
  //   filters: [
  //     {
  //       name: "dateFrom",
  //       label: "From Date",
  //       type: "date",
  //       default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  //       required: true,
  //     },
  //     {
  //       name: "dateTo",
  //       label: "To Date",
  //       type: "date",
  //       default: new Date(),
  //       required: true,
  //     },
  //     {
  //       name: "customer",
  //       label: "Customer",
  //       type: "select",
  //       nameKey: "acname",
  //       valueKey: "acno",
  //       options: "customers",
  //       default: { value: "", label: "All Customers" },
  //       apiEndpoint: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`,
  //       clearable: true,
  //     },
  //     {
  //       name: "godown",
  //       nameKey: "godown",
  //       label: "Warehouse",
  //       type: "select",
  //       default: { value: "", label: "All Warehouses" },
  //       options: "godowns",
  //       apiEndpoint: "/api/setup/godowns?includeInactive=true",
  //       clearable: true,
  //     },
  //     {
  //       name: "item",
  //       label: "Item",
  //       type: "select",
  //       default: { value: "", label: "All Items" },
  //       options: "products",
  //       apiEndpoint: "/api/setup/items",
  //       valueKey: "itcd",
  //       nameKeys: ["itcd", "item", "code"],
  //       separator: " - ",
  //       clearable: true,
  //     },
  //     {
  //       name: "so_no",
  //       label: "Sale Order No",
  //       type: "select",
  //       options: "orders",
  //       apiEndpoint: "/api/orders/saleOrder",
  //       valueKey: "order_no",
  //       nameKey: "order_no",
  //       default: { value: "", label: "All Sale Orders No" },
  //       clearable: true,
  //     },
  //   ],
  //   columns: [
  //     { field: "so_no", headerName: "SO NO", width: 30, type: "text" },
  //     { field: "po_no", headerName: "PO NO", width: 30, type: "text" },
  //     { field: "dated", headerName: "Date", width: 30, type: "date" },
  //     {
  //       field: "tran_id",
  //       headerName: "Transaction #",
  //       width: 30,
  //       type: "text",
  //     },
  //     { field: "dispatch_no", headerName: "Dispatch No", width: 40 },
  //     {
  //       field: "vendor_name",
  //       headerName: "Customer",
  //       width: 100,
  //       valueGetter: (params) => params.row.acno?.acname || "",
  //     },
  //     {
  //       field: "itcd",
  //       headerName: "MM code",
  //       width: 50,
  //       valueGetter: (params) => params.row.transactions?.[0]?.itcd || "",
  //     },
  //     {
  //       field: "code",
  //       headerName: "Ink Code",
  //       width: 50,
  //       valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.code || "",
  //     },
  //     { field: "rmk", headerName: "Narration", width: 80 },
  //     {
  //       field: "qty", headerName: "Qty", width: 20, type: "number",
  //       valueGetter: (params) => params.row.transactions?.reduce((acc, transaction) => acc + transaction.qty, 0) || "",
  //     }
  //   ],
  //   detailColumns: [
  //     {
  //       field: "itcd",
  //       headerName: "MM#",
  //       width: 30,
  //       type: "text",
  //       valueGetter: (params) => params.row.itemDetails?.itcd || "",
  //     },
  //     {
  //       field: "item",
  //       headerName: "Product Description",
  //       width: 90,
  //       valueGetter: (params) => params.row.itemDetails?.item || "",
  //     },
  //     { field: "code", headerName: "Code", width: 20, type: "number", valueGetter: (params) => params.row.itemDetails?.code || "", },
  //     { field: "batch_no", headerName: "Batch#", width: 20, type: "number" },
  //     { field: "qty", headerName: "Qty", width: 20, type: "number" },
  //   ],
  //   summaryFields: [
  //     { field: "total_qty", label: "Total Quantity", type: "number" },
  //   ],
  //   exportOptions: {
  //     pdf: true,
  //     excel: true,
  //     csv: false,
  //   },
  // },

  dailyDispatch: {
    title: "Daily Dispatch Report",
    description: "Daily Dispatch report by MM Code and Date",
    apiEndpoint: "/api/reports/dailyDispatch",
    filters: [
      { name: "dateFrom", label: "From Date", type: "date", required: true, default: new Date() },
      { name: "dateTo", label: "To Date", type: "date", required: true, default: new Date() },
      { name: "region", label: "Region", type: "select", options: [{ value: "NORTH", label: "NORTH" }, { value: "SOUTH", label: "SOUTH" }], clearable: true },
      { name: "itcd", label: "MM Code", type: "select" },
    ],
    getColumns: function (filters = {}) {
      const fixedColumns = [
        { field: "itcd", headerName: "MM Code", width: 120 },
        { field: "item_name", headerName: "Description", width: 250 },
      ];

      if (!filters.dateFrom || !filters.dateTo) {
        return fixedColumns;
      }

      const parseFilterDate = (val) => {
        if (!val) return null;
        // DD-MM-YYYY (how ReportViewer stores filter dates)
        if (/^\d{2}-\d{2}-\d{4}$/.test(val)) {
          const [dd, mm, yyyy] = val.split("-");
          return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
        }
        const d = new Date(val);
        return isNaN(d) ? null : d;
      };

      const startDate = parseFilterDate(filters.dateFrom);
      const endDate = parseFilterDate(filters.dateTo);
      if (!startDate || !endDate) {
        return fixedColumns;
      }

      const dateColumns = [];
      const currentDate = new Date(startDate);
      while (currentDate <= endDate) {
        const dateKey = currentDate.toLocaleDateString('en-US', { day: 'numeric', month: 'numeric', year: 'numeric' });
        const safeField = `date_${dateKey.replace(/\//g, "_")}`;
        const dd = String(currentDate.getDate()).padStart(2, "0");
        const mm = String(currentDate.getMonth() + 1).padStart(2, "0");
        const yy = String(currentDate.getFullYear()).slice(-2);
        dateColumns.push({
          field: safeField,
          headerName: `${dd}-${mm}-${yy}`,
          width: 100,
          type: "number",
          valueGetter: (params) => {
            const val = params.row[dateKey];
            return (val === undefined || val === null || Number.isNaN(val)) ? "" : val;
          },
        });
        currentDate.setDate(currentDate.getDate() + 1);
      }
      return [...fixedColumns, ...dateColumns];
    },
  },

  sale: {
    title: "Sales Report",
    description: "Detailed report of all sales transactions",
    apiEndpoint: "/api/reports/sale",
    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        required: true,
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        required: true,
      },
      {
        name: "dateOrder",
        label: "Sort by Date",
        type: "select",
        options: [
          { value: "desc", label: "Descending (Newest First)" },
          { value: "asc", label: "Ascending (Oldest First)" },
        ],
        default: { value: "desc", label: "Descending (Newest First)" },
        clearable: false,
      },
      {
        name: "customer",
        label: "Customer",
        type: "select",
        multiple: true,
        nameKeys: ["acno", "acname"],
        separator: " - ",
        valueKey: "acno",
        options: "customers",
        default: { value: "", label: "All Customers" },
        apiEndpoint: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`,
        clearable: true,
      },
      {
        name: "item",
        label: "Item",
        type: "select",
        multiple: true,
        options: "products",
        default: { value: "", label: "All Items" },
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["code","item"],
        separator: " - ",
        clearable: true,
      },
      {
        name: "category",
        label: "Ink Series",
        type: "select",
        options: "main_categories",
        default: { value: "", label: "All Categories" },
        apiEndpoint: "/api/setup/main_categories",
        valueKey: "id",
        nameKeys: ["mc_name"],
        clearable: true,
        multiple: true, },
      {
        name: "godown",
        label: "Godown",
        nameKeys: ["id","godown"],
        type: "select",
        multiple: true,
        options: "godowns",
        default: { value: "", label: "All Godowns" },
        apiEndpoint: "/api/setup/godowns?includeInactive=true",
        clearable: true,
      },
      {
        name: "so_no",
        label: "Sale Order No",
        type: "select",
        multiple: true,
        default: { value: "", label: "All Sale Orders No" },
        options: "orders",
        apiEndpoint: "/api/orders/saleOrder?limit=1000",
        valueKey: "order_no",
        nameKey: "order_no",
        clearable: true,
      },
      {
        name: "dispatch_no",
        label: "Dispatch No",
        type: "select",
        multiple: true,
        apiEndpoint: "/api/dispatch",
        valueKey: "value",
        nameKey: "label",
        default: { value: "", label: "All Dispatches" },
        clearable: true,
      },
      {
        name: "sale_person",
        label: "Sales Person",
        type: "select",
        multiple: true,
        options: "salesPersons",
        // apiEndpoint: "/api/accounts/customer-sales-persons",
        // scope=own: a sales person is offered only themselves
        apiEndpoint: "/api/accounts/customer-sales-persons?scope=own",
        valueKey: "id",
        nameKey: "name",
        default: { value: "", label: "All Sales Persons" },
        clearable: true,
      },
      {
        name: "type",
        label: "Summary Type",
        type: "select",
        options: [
          { label: "Customer Summary", value: "customer" },
          { label: "Customer Detail", value: "customerDetail" },
          { label: "Product Summary", value: "product" },
          { label: "Product Detail", value: "productDetail" },
          { label: "Invoice Summary", value: "invoiceSummary" },
        ],
        default: { value: "productDetail", label: "Product Detail" },
        clearable: true,
      },
      {
        name: "region",
        label: "Region",
        type: "select",
        multiple: true,
        options: [
          { value: "NORTH", label: "NORTH" },
          { value: "SOUTH", label: "SOUTH" },
        ],
        clearable: true,
        defaultValue: { value: "NORTH", label: "NORTH" },
      },
      {
        name: "invoice_no",
        label: "Invoice No",
        type: "select",
        multiple: true,
        apiEndpoint: "/api/invoice?tran_code=6",
        valueKey: "value",
        nameKey: "label", 
        default: { value: "", label: "All Invoices" },
        clearable: true,
      },
      // {
      //   name: "lamination",
      //   label: "SR Lamination",
      //   type: "select",
      //   multiple: true,
      //   options: "laminations",
      //   apiEndpoint: "/api/setup/sr_laminations",
      //   valueKey: "sr_lamination",
      //   nameKey: "sr_lamination",
      //   default: { value: "", label: "All Laminations" },
      //   clearable: true,
      // },
      // {
      //   name: "color",
      //   label: "Color Code",
      //   type: "select",
      //   multiple: true,
      //   options: "colorCodes",
      //   apiEndpoint: "/api/setup/color_codes",
      //   valueKey: "color_code",
      //   nameKey: "color_code",
      //   default: { value: "", label: "All Colors" },
      //   clearable: true,
      // },
      // {
      //   name: "ink_type",
      //   label: "Ink Type",
      //   type: "select",
      //   multiple: true,
      //   options: "inkTypes",
      //   apiEndpoint: "/api/setup/ink_types",
      //   valueKey: "ink_type",
      //   nameKey: "ink_type",
      //   default: { value: "", label: "All Ink Types" },
      //   clearable: true,
      // },
      // {
      //   name: "subtrates",
      //   label: "Substrate",
      //   type: "select",
      //   multiple: true,
      //   options: "subtrates",
      //   apiEndpoint: "/api/setup/subtrates",
      //   valueKey: "subtrate",
      //   nameKey: "subtrate",
      //   default: { value: "", label: "All Substrates" },
      //   clearable: true,
      // },
      // {
      //   name: "business_unit",
      //   label: "Business Unit",
      //   type: "select",
      //   multiple: true,
      //   options: "businessUnits",
      //   apiEndpoint: "/api/setup/business_units",
      //   valueKey: "business_unit",
      //   nameKey: "business_unit",
      //   default: { value: "", label: "All Business Units" },
      //   clearable: true,
      // },
      // {
      //   name: "printing_property",
      //   label: "Printing Property",
      //   type: "select",
      //   multiple: true,
      //   options: "printingProperties",
      //   apiEndpoint: "/api/setup/printing_properties",
      //   valueKey: "printing_property",
      //   nameKey: "printing_property",
      //   default: { value: "", label: "All Printing Properties" },
      //   clearable: true,
      // },
      // {
      //   name: "city",
      //   label: "City",
      //   type: "select",
      //   multiple: true,
      //   options: "cities",
      //   apiEndpoint: `/api/accounts/cities?${CUSTOMER_GROUP_PARAM}`,
      //   valueKey: "city",
      //   nameKey: "city",
      //   default: { value: "", label: "All Cities" },
      //   clearable: true,
      // },
      // {
      //   name: "nature_of_ink",
      //   label: "Nature of Ink",
      //   type: "select",
      //   multiple: true,
      //   options: "natureOfInks",
      //   apiEndpoint: "/api/setup/nature_of_inks",
      //   valueKey: "nature_of_ink",
      //   nameKey: "nature_of_ink",
      //   default: { value: "", label: "All Nature of Ink" },
      //   clearable: true,
      // },
      {
        name: "includeReturns",
        label: "Include Returns",
        type: "checkbox",
        default: false,
      },
      {
        // Only documents with no rate or no invoice number (getPSTransactionReport)
        name: "withoutRate",
        label: "Without Rate",
        type: "checkbox",
        default: false,
      },
    ],
    // ------------------ COLUMNS ------------------
    getColumns: (filters) => {
      if (filters?.type === "customer" || filters?.type === "customerSummary") {
        // 🔹 Customer summarized view
        return [
          {
            field: "pycd",
            headerName: "Customer Code",
            width: 40,
            type: "number",
          },
          {
            field: "customerName",
            headerName: "Customer Name",
            width: 120,
          },
          {
            field: "acno.ntnNo",
            headerName: " Customer NTN",
            width: 80,
            valueGetter: (params) => params.row.acno?.ntnNo || "",
          },
          { field: "invoice_no", headerName: "Invoice No", width: 20 },
          {
            field: "dated",
            headerName: "Invoice Date",
            width: 80,
            type: "date",
          },
          {
            field: "total_qty", showTotal: true,
            headerName: "Total Quantity",
            width: 50,
            type: "number",
          },
          { field: "avg_rate", headerName: "Avg Rate", width: 40, type: "currency" },
          // {
          //   field: "total_amount",
          //   headerName: "Total Amount",
          //   width: 60,
          //   type: "currency",
          //   fixed: true,
          // },
          {
            field: "gross_amount", showTotal: true,
            headerName: "Gross Amount",
            type: "currency",
            valueGetter: (params) =>
              params.row.transactions?.reduce(
                (sum, item) => sum + (item.camt || 0),
                0
              ) || 0,
          },

          {
            field: "st_rate", showTotal: true,
            headerName: "Sales Tax Amount",
            type: "currency",
            valueGetter: (params) =>
              params.row?.transactions?.reduce(
                (sum, item) => sum + (item.st_amount || 0),
                0
              ) || 0,
          },

          {
            field: "additional_tax", showTotal: true,
            headerName: "Further Tax Amount",
            type: "currency",
          },

          {
            field: "total_amount", showTotal: true,
            headerName: "Total Net Amount",
            width: 35,
            type: "currency",
            valueGetter: (params) => {
              const grossAmount =
                params.row?.transactions?.reduce(
                  (sum, item) => sum + (item.camt || 0),
                  0
                ) || 0;

              const stAmount =
                params.row?.transactions?.reduce(
                  (sum, item) => sum + (item.st_amount || 0),
                  0
                ) || 0;

              return grossAmount + stAmount;
            },
          },
        ];
      }

      if (filters?.type === "product") {
        // 🔹 Product summarized view
        return [
          // {
          //   field: "itcd",
          //   headerName: "Product Code",
          //   width: 40,
          //   // type: "number",
          // },
          {
            field: "code",
            headerName: "Code",
            width: 90,
            valueGetter: (params) => params.row.code || params.row.itemDetails?.code|| "-",
          },
          {
            field: "productName",
            headerName: "Product Name",
            width: 80,
          },
          {
            field: "total_qty", showTotal: true,
            headerName: "Total Quantity",
            width: 50,
            type: "number",
          },
          { field: "avg_rate", headerName: "Avg Rate", width: 40, type: "currency" },
          // {
          //   field: "total_amount",
          //   headerName: "Total Amount",
          //   width: 60,
          //   type: "currency",
          //   fixed: true,
          // },
          {
            field: "gross_amount", showTotal: true,
            headerName: "Gross Amount",
            type: "currency",
            valueGetter: (params) =>
              params.row.transactions?.reduce(
                (sum, item) => sum + (item.camt || 0),
                0
              ) || 0,
          },

          {
            field: "st_rate", showTotal: true,
            headerName: "Sales Tax Amount",
            type: "currency",
            valueGetter: (params) =>
              params.row?.transactions?.reduce(
                (sum, item) => sum + (item.st_amount || 0),
                0
              ) || 0,
          },

          {
            field: "additional_tax", showTotal: true,
            headerName: "Further Tax Amount",
            type: "currency",
          },

          {
            field: "total_amount", showTotal: true,
            headerName: "Total Net Amount",
            width: 35,
            type: "currency",
            valueGetter: (params) => {
              const grossAmount =
                params.row?.transactions?.reduce(
                  (sum, item) => sum + (item.camt || 0),
                  0
                ) || 0;

              const stAmount =
                params.row?.transactions?.reduce(
                  (sum, item) => sum + (item.st_amount || 0),
                  0
                ) || 0;

              return grossAmount + stAmount;
            },
          },
        ];
      }
      if (filters?.type === "productDetail") {
        return [
          { field: "dated", headerName: "Date", width: 100, type: "date" },
          { field: "tran_id", headerName: "Transaction #", width: 90, type: "text" },
          { field: "invoice_no", headerName: "Invoice No", width: 100 },
          { field: "dispatch_no", headerName: "Dispatch No", width: 90 },
          { field: "so_no", headerName: "Sale Order No", width: 90 },
          { field: "pycd", headerName: "Customer Code", width: 90, type: "number" },
          { field: "customerName", headerName: "Customer Name", width: 180 },
          { field: "godown", headerName: "Godown", width: 100 },
          { field: "code", headerName: "Item Code", width: 90 },
          { field: "productName", headerName: "Product Name", width: 180 },
          { field: "mc_name", headerName: "Ink Series", width: 100 },
          { field: "ic_name", headerName: "Item Category", width: 110 },
          { field: "total_qty", headerName: "Quantity", width: 80, type: "number", showTotal: true },
          { field: "unit", headerName: "Unit", width: 60 },
          { field: "qty_ltr", headerName: "Qty (Ltr)", width: 80, type: "number" },
          { field: "rate", headerName: "Rate", width: 90, type: "currency" },
          { field: "gross_amount", headerName: "Gross Amount", width: 110, type: "currency", showTotal: true },
          { field: "st_rate", headerName: "ST Rate", width: 70, type: "number" },
          { field: "additional_tax", headerName: "Further Tax Rate", width: 110, type: "number" },
          { field: "st_amount", headerName: "Tax Amount", width: 100, type: "currency", showTotal: true },
          { field: "total_amount", headerName: "Net Amount", width: 110, type: "currency", fixed: true, showTotal: true },
        ];
      }

      if (filters?.type === "customerDetail") {
        return [
           { field: "dated", headerName: "Date", width: 100, type: "date" },
          // {
          //   field: "dateFrom",
          //   headerName: "Date From",
          //   width: 120,
          //   type: "text",
          //   valueGetter: () => formatDate(filters?.dateFrom),
          // },
          // {
          //   field: "dateTo",
          //   headerName: "Date To",
          //   width: 120,
          //   type: "text",
          //   valueGetter: () => formatDate(filters?.dateTo),
          // },
          {
            field: "invoice_no", headerName: "Invoice #",
            width: 60,
            // valueGetter: (params) => {
            //   console.log(params.row);
            //   return params.row.invoice_no || "";
            // },
          },
          { field: "customerName", headerName: "Customer Name", width: 120 },
          {
            field: "code",
            headerName: "Item Code",
            width: 90,
            valueGetter: (params) => params.row.itemDetails?.code || "-",
          },
          {
            field: "item",
            headerName: "Item",
            width: 150,
            valueGetter: (params) => params.row.itemDetails?.item || params.row.productName || "",
          },
          {
            field: "mc_name",
            headerName: "Ink Series",
            width: 100,
            valueGetter: (params) => params.row.mc_name || "-",
          },
          { field: "qty", showTotal: true, headerName: "Qty", width: 60, type: "number" },
          { field: "rate", headerName: "Rate", width: 80, type: "currency" },
          {
            field: "total_gross_amount", showTotal: true,
            headerName: "Gross Amount",
            width: 100,
            type: "currency",
            valueGetter: (params) => params.row.camt,
          },
          { field: "st_rate", headerName: "ST Rate", width: 60, type: "number" },
          {
            field: "st_amount", showTotal: true,
            headerName: "ST Amt",
            width: 80,
            type: "currency",
            valueGetter: (params) => params.row.st_amount,
          },
          {
            field: "additional_tax", showTotal: true,
            headerName: "Add Tax",
            width: 80,
            type: "currency",
          },
          {
            field: "total_amount", showTotal: true,
            headerName: "Amount",
            width: 100,
            type: "currency",
            valueGetter: (params) => {
              const val = Number(params.row.camt || 0) +
                Number(params.row.st_amount || 0) +
                Number(params.row.additional_tax || 0);
              return Number(val.toFixed(2));
            },
          },
        ];
      }
      if (filters?.type === "invoiceSummary") {
        return [
          { field: "invoice_no", headerName: "Invoice No#", width: 60 },
          { field: "dated", headerName: "Invoice Date", width: 100, type: "date" },
          { field: "po_no", headerName: "PO No", width: 32 },
          { field: "grn_no", headerName: "GRN#", width: 32 },
          {
            field: "acno.ntnNo",
            headerName: "NTN#",
            width: 80,
            valueGetter: (params) => params.row.acno?.ntnNo || "",
          },
          {
            field: "vendorName",
            headerName: "Vendor Name",
            width: 120,
            valueGetter: (params) => params.row.acno?.acname || "",
          },
          {
            field: "total_qty", showTotal: true,
            headerName: "Total Quantity",
            width: 50,
            type: "number",
          },
          // {
          //   field: "city", headerName: "Destination 1", type: "text",
          //   valueGetter: (params) => params.row.acno?.city || "",
          // },
          // {
          //   field: "country", headerName: "Destination 2", type: "text",
          //   valueGetter: (params) => params.row.acno?.country || "",
          // },
          {
            field: "gross_amount", showTotal: true,
            headerName: "Gross Amount",
            type: "currency",
            valueGetter: (params) =>
              params.row.transactions?.reduce(
                (sum, item) => sum + (item.damt || item.camt || 0),
                0
              ) || 0,
          },
          {
            field: "st_rate", showTotal: true,
            headerName: "Sales Tax Amount",
            type: "currency",
            valueGetter: (params) =>
              params.row?.transactions?.reduce(
                (sum, item) => sum + (item.st_amount || 0),
                0
              ) || 0,
          },
          {
            field: "total_amount", showTotal: true,
            headerName: "Total Net Amount",
            width: 35,
            type: "currency",
            valueGetter: (params) => {
              const grossAmount =
                params.row?.transactions?.reduce(
                  (sum, item) => sum + (item.damt || item.camt || 0),
                  0
                ) || 0;

              const stAmount =
                params.row?.transactions?.reduce(
                  (sum, item) => sum + (item.st_amount || 0),
                  0
                ) || 0;

              return grossAmount + stAmount;
            },
          },

          // { field: "total_amount", headerName: "Total Amount", width: 100, type: "currency" },
        ];
      }

      // if (filters?.type === "invoice") {
      //   return [
      //     { field: "dated", headerName: "Date", width: 100, type: "date" },
      //     { field: "invoice_no", headerName: "Invoice #", width: 60 },
      //     {
      //       field: "customerName",
      //       headerName: "Customer",
      //       width: 150,
      //       valueGetter: (params) => params.row.acno?.acname || params.row.customerName,
      //     },
      //     {
      //       field: "acno.ntnNo",
      //       headerName: " Customer NTN",
      //       width: 80,
      //       valueGetter: (params) => params.row.acno?.ntnNo || "",
      //     },
      //     { field: "total_qty", headerName: "Total Qty", width: 80, type: "number" },
      //     {
      //       field: "gross_amount",
      //       headerName: "Gross Amount",
      //       type: "currency",
      //       valueGetter: (params) =>
      //         params.row.transactions?.reduce(
      //           (sum, item) => sum + (item.camt || 0),
      //           0
      //         ) || 0,
      //     },

      //     {
      //       field: "st_rate",
      //       headerName: "Sales Tax Amount",
      //       type: "currency",
      //       valueGetter: (params) =>
      //         params.row?.transactions?.reduce(
      //           (sum, item) => sum + (item.st_amount || 0),
      //           0
      //         ) || 0,
      //     },

      //     {
      //       field: "additional_tax",
      //       headerName: "Further Tax Amount",
      //       type: "currency",
      //     },

      //     {
      //       field: "total_amount",
      //       headerName: "Total Net Amount",
      //       width: 35,
      //       type: "currency",
      //       valueGetter: (params) => {
      //         const grossAmount =
      //           params.row?.transactions?.reduce(
      //             (sum, item) => sum + (item.camt || 0),
      //             0
      //           ) || 0;

      //         const stAmount =
      //           params.row?.transactions?.reduce(
      //             (sum, item) => sum + (item.st_amount || 0),
      //             0
      //           ) || 0;

      //         return grossAmount + stAmount;
      //       },
      //     },
      //     // { field: "total_amount", headerName: "Total Amount", width: 100, type: "currency" },
      //   ];
      // }

      // 🔹 Default detailed columns (existing full view)
      return [
         { field: "dated", headerName: "Date", width: 20, type: "date" },
        // {
        //   field: "dateFrom",
        //   headerName: "Date From",
        //   width: 120,
        //   type: "text",
        //   valueGetter: () => formatDate(filters?.dateFrom),
        // },
        // {
        //   field: "dateTo",
        //   headerName: "Date To",
        //   width: 120,
        //   type: "text",
        //   valueGetter: () => formatDate(filters?.dateTo),
        // },

        {
          field: "tran_id",
          headerName: "Tran #",
          width: 20,
          type: "text",
        },
        {
          field: "so_no",
          headerName: "ISO",
          width: 20,
          type: "text",
        },
        { field: "dispatch_no", headerName: "Dispatch No", width: 20 },
        { field: "invoice_no", headerName: "Invoice No", width: 20 },
        { field: "acno.acno", headerName: "Account No", width: 30, valueGetter: (params) => params.row.acno?.acno || "" },
        {
          field: "customer_name",
          headerName: "Customer",
          width: 80,
          valueGetter: (params) => params.row.acno?.acname || "",
        },
        // {
        //   field: "acno.ntnNo",
        //   headerName: " Customer NTN",
        //   width: 80,
        //   valueGetter: (params) => params.row.acno?.ntnNo || "",
        // },
        {
          field: "dated",
          headerName: "Invoice Date",
          width: 80,
          type: "date"

        },
        {
          field: "godown_name",
          headerName: "Godown",
          width: 35,
          valueGetter: (params) => params.row.godownDetails?.godown || "",
        },

        // {
        //   field: "city", headerName: "Destination 1", type: "text",
        //   valueGetter: (params) => params.row.acno?.city || "",
        // },
        // {
        //   field: "subCategory",
        //   headerName: "Province",
        //   width: 35,
        //   valueGetter: (params) => {
        //     const value = params.row.acno?.subCategory;

        //     if (value === "N") return "NORTH";
        //     if (value === "S") return "SOUTH";

        //     return value || "";
        //   },
        // },
        // {
        //   field: "country", headerName: "Destination 2", type: "text",
        //   valueGetter: (params) => params.row.acno?.country || "",
        // },
        {
          field: "total_qty", showTotal: true,
          headerName: "Total Qty",
          width: 30,
          type: "number",
        },
        // {
        //   field: "total_amount",
        //   headerName: "Total Amount",
        //   width: 35,
        //   type: "currency",
        //   fixed: true,
        // },
        {
          field: "gross_amount", showTotal: true,
          headerName: "Gross Amount",
          type: "currency",
          valueGetter: (params) =>
            params.row.transactions?.reduce(
              (sum, item) => sum + (item.camt || 0),
              0
            ) || 0,
        },

        {
          field: "st_rate", showTotal: true,
          headerName: "Sales Tax Amount",
          type: "currency",
          valueGetter: (params) =>
            params.row?.transactions?.reduce(
              (sum, item) => sum + (item.st_amount || 0),
              0
            ) || 0,
        },

        {
          field: "additional_tax", showTotal: true,
          headerName: "Further Tax Amount",
          type: "currency",
        },
        {
          field: "total_amount", showTotal: true,
          headerName: "Total Net Amount",
          width: 35,
          type: "currency",
          valueGetter: (params) => {
            const grossAmount =
              params.row?.transactions?.reduce(
                (sum, item) => sum + (item.camt || 0),
                0
              ) || 0;

            const stAmount =
              params.row?.transactions?.reduce(
                (sum, item) => sum + (item.st_amount || 0),
                0
              ) || 0;

            return grossAmount + stAmount;
          },
        },
        { field: "rmk", headerName: "Narration", width: 40 },
        // {
        //   field: "hsCode",
        //   headerName: "HsCode",
        //   type: "text",
        //   valueGetter: (params) => params.row.hsCode || "3215.1110:-TANNING OR DYEING",
        // },

      ];
    },

    // Wide-report layout (CLAUDE.md rule 15) — one per summary type.
    layout: (filters) => {
      const type = filterValue(filters?.type);
      const amountGroup = (fields, foldTo) => ({ id: "amt", label: "Amount & tax", fields, foldTo });
      if (type === "productDetail") {
        return {
          pinned: ["dated", "invoice_no"],
          groups: [
            { id: "doc", label: "Document", fields: ["tran_id", "dispatch_no", "so_no"] },
            { id: "cust", label: "Customer", fields: ["pycd", "customerName"] },
            { id: "item", label: "Item", fields: ["godown", "code", "productName", "mc_name", "ic_name"] },
            { id: "qty", label: "Quantity", fields: ["total_qty", "unit", "qty_ltr"] },
            amountGroup(["rate", "gross_amount", "st_rate", "additional_tax", "st_amount", "total_amount"], "total_amount"),
          ],
          views: [
            {
              id: "standard",
              label: "Standard",
              fields: ["dispatch_no", "so_no", "pycd", "customerName", "code", "productName", "mc_name", "total_qty", "unit", "qty_ltr", "rate", "gross_amount", "st_rate", "st_amount", "total_amount"],
            },
            { id: "all", label: "Everything" },
          ],
          defaultView: "standard",
          unitSwitch: {
            label: "Quantity",
            options: [
              { id: "kg", label: "KG", fields: ["total_qty"] },
              { id: "ltr", label: "Litre", fields: ["qty_ltr"] },
            ],
            default: "kg",
          },
          card: {
            title: (r) => [r.invoice_no, r.customerName].filter(Boolean).join(" · "),
            subtitle: (r) => [r.code, r.productName].filter((x) => x && x !== "-").join(" "),
            figures: ["total_qty", "rate", "total_amount"],
          },
        };
      }
      if (type === "customerDetail") {
        return {
          pinned: ["dated", "invoice_no"],
          groups: [
            { id: "item", label: "Item", fields: ["customerName", "code", "item", "mc_name"] },
            { id: "qty", label: "Quantity", fields: ["qty", "rate"] },
            amountGroup(["total_gross_amount", "st_rate", "st_amount", "additional_tax", "total_amount"], "total_amount"),
          ],
          card: {
            title: (r) => [r.invoice_no, r.customerName].filter(Boolean).join(" · "),
            subtitle: "item",
            figures: ["qty", "rate", "total_amount"],
          },
        };
      }
      if (type === "customer" || type === "customerSummary") {
        return {
          pinned: ["pycd", "customerName"],
          groups: [
            { id: "cust", label: "Customer", fields: ["acno.ntnNo", "invoice_no", "dated"] },
            { id: "qty", label: "Quantity", fields: ["total_qty", "avg_rate"] },
            amountGroup(["gross_amount", "st_rate", "additional_tax", "total_amount"], "total_amount"),
          ],
          card: { title: "customerName", subtitle: "pycd", figures: ["total_qty", "avg_rate", "total_amount"] },
        };
      }
      if (type === "product") {
        return {
          pinned: ["code", "productName"],
          groups: [
            { id: "qty", label: "Quantity", fields: ["total_qty", "avg_rate"] },
            amountGroup(["gross_amount", "st_rate", "additional_tax", "total_amount"], "total_amount"),
          ],
          card: { title: "productName", subtitle: "code", figures: ["total_qty", "avg_rate", "total_amount"] },
        };
      }
      if (type === "invoiceSummary") {
        return {
          pinned: ["invoice_no", "dated"],
          groups: [
            { id: "doc", label: "Document", fields: ["po_no", "grn_no"] },
            { id: "cust", label: "Customer", fields: ["acno.ntnNo", "vendorName"] },
            amountGroup(["total_qty", "gross_amount", "st_rate", "total_amount"], "total_amount"),
          ],
          card: { title: "vendorName", subtitle: "invoice_no", figures: ["total_qty", "gross_amount", "total_amount"] },
        };
      }
      // No summary type: one row per invoice.
      return {
        pinned: ["dated", "invoice_no"],
        groups: [
          { id: "doc", label: "Document", fields: ["tran_id", "so_no", "dispatch_no", "godown_name"] },
          { id: "cust", label: "Customer", fields: ["acno.acno", "customer_name"] },
          amountGroup(["total_qty", "gross_amount", "st_rate", "additional_tax", "total_amount"], "total_amount"),
        ],
        views: [
          { id: "standard", label: "Standard", fields: ["so_no", "dispatch_no", "acno.acno", "customer_name", "total_qty", "gross_amount", "st_rate", "additional_tax", "total_amount", "rmk"] },
          { id: "all", label: "Everything" },
        ],
        defaultView: "standard",
        card: {
          title: "customer_name",
          subtitle: (r) => [r.invoice_no && `INV ${r.invoice_no}`, r.dispatch_no && `DC ${r.dispatch_no}`].filter(Boolean).join(" · "),
          figures: ["total_qty", "gross_amount", "total_amount"],
        },
      };
    },

    // Drill trail: summary rows open their detail for the same period and
    // filters; detail / invoice rows open their voucher (tran_id + tran_code).
    drill: (() => {
      const KEEP = ["dateFrom", "dateTo", "dateOrder", "customer", "item", "category", "godown", "so_no", "dispatch_no", "sale_person", "region", "invoice_no", "includeReturns", "withoutRate"];
      return [
        {
          label: "Open product detail",
          when: (row, filters) => filterValue(filters?.type) === "product" && !!row.itcd,
          href: (row, filters) => reportHref("sale", { ...pickFilters(filters, KEEP), item: row.itcd, type: "productDetail" }),
        },
        {
          label: "Open customer detail",
          when: (row, filters) => ["customer", "customerSummary"].includes(filterValue(filters?.type)) && !!row.pycd,
          href: (row, filters) => reportHref("sale", { ...pickFilters(filters, KEEP), customer: row.pycd, type: "customerDetail" }),
        },
        {
          label: "Open account ledger",
          when: (row, filters) => ["customer", "customerSummary"].includes(filterValue(filters?.type)) && !!row.pycd,
          href: (row, filters) => accountLedgerHref({ account: row.pycd, dateFrom: filters.dateFrom, dateTo: filters.dateTo }),
        },
      ];
    })(),
    detailColumns: [
      {
        field: "code",
        headerName: "Ink Code",
        width: 40,
        valueGetter: (params) => params.row.itemDetails?.code || "-",
      },
      {
            field: "mc_name",
            headerName: "Ink Series",
            width: 100,
            valueGetter: (params) => params.row.mc_name || "-",
      },
      // {
      //   field: "itcd",
      //   headerName: "Item code",
      //   width: 40,
      //   valueGetter: (params) => params.row.itemDetails?.itcd || "-",
      // },
      {
        field: "item",
        headerName: "Item",
        width: 90,
        valueGetter: (params) => params.row.itemDetails?.item || "",
      },
      { field: "qty", headerName: "Qty", width: 20, type: "number" },
      { field: "rate", headerName: "Rate", width: 20, type: "currency" },
      {
        field: "total_gross_amount",
        headerName: "Gross Amount",
        width: 30,
        type: "currency",
        valueGetter: (params) => params.row.camt,


      },
      { field: "st_rate", headerName: "ST Rate", width: 20, type: "number" },
      {
        field: "st_amount",
        headerName: "ST Amt",
        width: 20,
        type: "currency",
        valueGetter: (params) => params.row.st_amount,
      },
      {
        field: "additional_tax",
        headerName: "Add Tax",
        width: 20,
        type: "currency",
      },
      {
        field: "camt", headerName: "Amount", width: 20, type: "currency",
        valueGetter: (params) => Number(params.row.camt) + Number(params.row.st_amount) + Number(params.row.additional_tax) || "",
      },
    ],
    summaryFields: [
      { field: "total_qty", label: "Total Quantity", type: "number" },
      {
        field: "total_gross_amount",
        label: "Total Gross Amount",
        type: "currency",
      },
      { field: "total_tax", label: "Total Tax", type: "currency" },
      { field: "total_amount", label: "Total Net Amount", type: "currency" },
    ],
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },
  saleReturn: {
    title: "Sales Return Report",
    description: "Detailed report of all sales return transactions",
    apiEndpoint: "/api/reports/saleReturn",
    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        required: true,
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        required: true,
      },
      {
        name: "customer",
        label: "Customer",
        type: "select",
        nameKeys: ["acno", "acname"],
        separator: " - ",
        valueKey: "acno",
        default: { value: "", label: "All Customers" },
        options: "customers",
        apiEndpoint: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`,
        clearable: true,
      },
      {
        name: "godown",
        label: "Godown",
        type: "select",
        nameKey: ["id","godown"],
        default: { value: "", label: "All Godowns" },
        options: "godowns",
        apiEndpoint: "/api/setup/godowns?includeInactive=true",
        clearable: true,
      },
      {
        name: "item",
        label: "Item",
        type: "select",
        default: { value: "", label: "All Items" },
        options: "products",
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["itcd", "item", "code"],
        separator: " - ",
        clearable: true,
      },
      {
        name: "po_no",
        label: "Purchase Order No",
        type: "select",
        default: { value: "", label: "All Purchase Orders No" },
        options: "orders",
        apiEndpoint: "/api/orders/purchaseOrder",
        valueKey: "order_no",
        nameKey: "order_no",
        clearable: true,
      },
      {
        name: "type",
        label: "Summary Type",
        type: "select",
        options: [
          { label: "Customer Summary", value: "customer" },
          { label: "Product Summary", value: "product" },
        ],
        clearable: true,
      },
      {
        // Only documents with no rate or no invoice number (getPSTransactionReport)
        name: "withoutRate",
        label: "Without Rate",
        type: "checkbox",
        default: false,
      },
    ],
    // ------------------ COLUMNS ------------------
    getColumns: (filters) => {
      if (filters?.type === "customer") {
        return [
          {
            field: "pycd",
            headerName: "Customer Code",
            width: 40,
            type: "number",
          },
          {
            field: "customerName",
            headerName: "Customer Name",
            width: 80,
          },
          {
            field: "total_qty", showTotal: true,
            headerName: "Total Quantity",
            width: 50,
            type: "number",
          },
          {
            field: "total_amount", showTotal: true,
            headerName: "Total Amount",
            width: 60,
            type: "currency",
            fixed: true,
          },
        ];
      }

      if (filters?.type === "product") {
        return [
          {
            field: "itcd",
            headerName: "Product Code",
            width: 40,
            // type: "number",
          },
          {
            field: "productName",
            headerName: "Product Name",
            width: 80,
          },
          {
            field: "total_qty", showTotal: true,
            headerName: "Total Quantity",
            width: 50,
            type: "number",
          },
          {
            field: "total_amount", showTotal: true,
            headerName: "Total Amount",
            width: 60,
            type: "currency",
            fixed: true,
          },
        ];
      }

      // Default detailed view
      return [
        { field: "dated", headerName: "Date", width: 20, type: "date" },
        {
          field: "tran_id",
          headerName: "Tran #",
          width: 20,
          type: "text",
        },
        { field: "dispatch_no", headerName: "dispatch No", width: 15 },
        { field: "invoice_no", headerName: "Invoice No", width: 15 },
        {
          field: "customer_name",
          headerName: "Customer",
          width: 50,
          valueGetter: (params) => params.row.acno?.acname || "",
        },
        {
          field: "godown_name",
          headerName: "Godown",
          width: 50,
          valueGetter: (params) => params.row.godownDetails?.godown || "",
        },
        {
          field: "total_qty", showTotal: true,
          headerName: "Total Qty",
          width: 20,
          type: "number",
        },
        {
          field: "total_amount", showTotal: true,
          headerName: "Total Amount",
          width: 40,
          type: "currency",
          fixed: true,
        },
        { field: "rmk", headerName: "Narration", width: 50 },
      ];
    },

    // Wide-report layout (rule 15) — one per summary type.
    layout: (filters) => {
      const type = filterValue(filters?.type);
      if (type === "customer") {
        return { pinned: ["pycd", "customerName"], card: { title: "customerName", subtitle: "pycd", figures: ["total_qty", "total_amount"] } };
      }
      if (type === "product") {
        return { pinned: ["itcd", "productName"], card: { title: "productName", subtitle: "itcd", figures: ["total_qty", "total_amount"] } };
      }
      return {
        pinned: ["dated", "invoice_no"],
        groups: [{ id: "doc", label: "Document", fields: ["tran_id", "dispatch_no", "godown_name"] }],
        card: {
          title: "customer_name",
          subtitle: (r) => [r.invoice_no && `INV ${r.invoice_no}`, r.dispatch_no && `DC ${r.dispatch_no}`].filter(Boolean).join(" · "),
          figures: ["total_qty", "total_amount"],
        },
      };
    },
    // Summary rows → the document list for that customer / item; documents → voucher.
    drill: (() => {
      const KEEP = ["dateFrom", "dateTo", "customer", "godown", "item", "po_no", "withoutRate"];
      return [
        {
          label: "Open documents",
          when: (row, filters) => filterValue(filters?.type) === "customer" && !!row.pycd,
          href: (row, filters) => reportHref("saleReturn", { ...pickFilters(filters, KEEP), customer: row.pycd }),
        },
        {
          label: "Open documents",
          when: (row, filters) => filterValue(filters?.type) === "product" && !!row.itcd,
          href: (row, filters) => reportHref("saleReturn", { ...pickFilters(filters, KEEP), item: row.itcd }),
        },
      ];
    })(),
    detailColumns: [
      {
        field: "code",
        headerName: "Ink Code",
        width: 90,
        valueGetter: (params) => params.row.itemDetails?.code || "-",
      },
      {
        field: "itcd",
        headerName: "Item Code",
        width: 90,
        valueGetter: (params) => params.row.itemDetails?.itcd || "-",
      },
      {
        field: "item",
        headerName: "Item",
        width: 90,
        valueGetter: (params) => params.row.itemDetails?.item || "",
      },
      { field: "qty", headerName: "Qty", width: 20, type: "number" },
      { field: "rate", headerName: "Rate", width: 20, type: "currency" },
      {
        field: "gross_amount",
        headerName: "Gross Amt",
        width: 25,
        type: "currency",
      },
      { field: "st_rate", headerName: "ST Rate", width: 20, type: "number" },
      {
        field: "st_amount",
        headerName: "ST Amount",
        width: 20,
        type: "currency",
      },
      {
        field: "additional_tax",
        headerName: "Additional Tax",
        width: 20,
        type: "currency",
      },
      { field: "damt", headerName: "Amount", width: 20, type: "currency" },
    ],
    summaryFields: [
      { field: "total_qty", label: "Total Quantity", type: "number" },
      {
        field: "total_gross_amount",
        label: "Total Gross Amount",
        type: "currency",
      },
      { field: "total_tax", label: "Total Tax", type: "currency" },
      { field: "total_amount", label: "Total Net Amount", type: "currency" },
    ],
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },
  payment: {
    title: "Payment Report",
    description: "Detailed report of all payment transactions",
    apiEndpoint: "/api/reports/payment",
    filters: [
      {
        name: "dateFrom", label: "From Date", type: "date", required: true, default: new Date(new Date().getFullYear(), new Date().getMonth(), 1), // ← added
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        required: true,
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
      },
      {
        name: "paidfrom",
        label: "Paid From",
        type: "select",
        nameKey: "acname",
        valueKey: "acno",
        options: "vendors",
        apiEndpoint: `/api/accounts/acno?${CASH_BANK_GROUP_PARAM}`,
        clearable: true,
      },
      {
        name: "type",
        label: "Payment Type",
        type: "select",
        options: [
          { label: "All", value: "" },
          { label: "Cash", value: "cash" },
          { label: "Bank", value: "bank" },
        ],
        clearable: true,
      },
      voucherViewFilter,
    ],
    columns: [
      { field: "dated", headerName: "Date", width: 30, type: "date" },
      {
        field: "tran_id",
        headerName: "Transaction #",
        width: 15,
        type: "text",
      },
      // { field: "vr_no", headerName: "Voucher No", width: 15 },
      { field: "check_no", headerName: "Cheque No", width: 15 },

      {
        field: "account",
        headerName: "Paid From",
        width: 80,
        // valueGetter: (params) => params.row.acno?.acname || "",
      },
      { field: "amount", headerName: "Amount", width: 60, type: "currency" },
      { field: "narration", headerName: "Remarks", width: 75 },
    ],
    // Summary view: the eye icon opens the voucher's lines in a modal.
    detailColumns: [
      { field: "acno", headerName: "Code", width: 18, type: "text" },
      { field: "acname", headerName: "Paid To / Account", width: 75 },
      { field: "chno", headerName: "Cheque / TID #", width: 38 },
      { field: "damt", headerName: "Debit", width: 35, type: "currency" },
      { field: "camt", headerName: "Credit", width: 35, type: "currency" },
      { field: "narration", headerName: "Narration", width: 85 },
    ],
    // Detail view: the same lines inline, grouped under their voucher.
    getColumns: voucherColumns("payment", "Paid To / Account"),
    layout: voucherLayout,
    summaryFields: [
      {
        field: "total_transactions",
        label: "Total Transactions",
        type: "number",
      },
      { field: "total_net", label: "Total Net Amount", type: "currency" },
    ],
    exportOptions: { pdf: true, excel: true, csv: false },
  },
  receipt: {
    title: "Receipt Report",
    description: "Detailed report of all receipt transactions",
    apiEndpoint: "/api/reports/receipt",
    filters: [
      {
        name: "dateFrom", label: "From Date", type: "date", required: true, default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      },

      { name: "dateTo", label: "To Date", type: "date", required: true, default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0), },
      {
        name: "receivedat",
        label: "Recieved At",
        type: "select",
        nameKey: "acname",
        valueKey: "acno",
        options: "customers",
        apiEndpoint: `/api/accounts/acno?${CASH_BANK_GROUP_PARAM}`,
        clearable: true,
      },
      {
        name: "type",
        label: "Receipt Type",
        type: "select",
        options: [
          { label: "All", value: "" },
          { label: "Cash", value: "cash" },
          { label: "Bank", value: "bank" },
        ],
        clearable: true,
      },
      {
        name: "customer",
        label: "Customer",
        type: "select",
        nameKeys: ["acno", "acname"],
        separator: " - ",
        valueKey: "acno",
        options: "customers",
        apiEndpoint: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`,
        clearable: true,
      },
      {
        name: "region",
        label: "Region",
        type: "select",
        options: [
          { value: "NORTH", label: "NORTH" },
          { value: "SOUTH", label: "SOUTH" },
        ],
        clearable: true,
        defaultValue: { value: "NORTH", label: "NORTH" },
      },
      {
        name: "sale_person",
        label: "Sales Person",
        type: "select",
        multiple: true,
        options: "salesPersons",
        apiEndpoint: "/api/accounts/customer-sales-persons",
        valueKey: "id",
        nameKey: "name",
        default: { value: "", label: "All Sales Persons" },
        clearable: true,
      },
      voucherViewFilter,
    ],
    columns: [
      { field: "dated", headerName: "Date", width: 30, type: "date" },
      {
        field: "tran_id",
        headerName: "Transaction #",
        width: 20,
        type: "text",
      },

      { field: "check_no", headerName: "Cheque #", width: 30 },
      {
        field: "account",
        headerName: "Received At",
        width: 90,
        // valueGetter: (params) => params.row.acno?.acname || "",
      },
      {
        field: "customer",
        headerName: "Received From",
        width: 90,
        // valueGetter: (params) => params.row.acno?.acname || "",
      },
      { field: "amount", headerName: "Amount", width: 50, type: "currency" },
      { field: "narration", headerName: "Remarks", width: 75 },
    ],
    // Summary view: the eye icon opens the voucher's lines in a modal. One
    // receipt commonly holds a dozen cheques from different customers — this
    // is where they become visible.
    detailColumns: [
      { field: "acno", headerName: "Code", width: 18, type: "text" },
      { field: "acname", headerName: "Received From", width: 75 },
      { field: "chno", headerName: "Cheque / TID #", width: 38 },
      { field: "check_date", headerName: "Cheque Date", width: 28 },
      { field: "camt", headerName: "Credit", width: 35, type: "currency" },
      { field: "damt", headerName: "Debit", width: 35, type: "currency" },
      { field: "narration", headerName: "Narration", width: 85 },
    ],
    // Detail view: the same lines inline, grouped under their voucher.
    getColumns: voucherColumns("receipt", "Received From"),
    layout: voucherLayout,
    summaryFields: [
      {
        field: "total_transactions",
        label: "Total Transactions",
        type: "number",
      },
      { field: "total_net", label: "Total Net Amount", type: "currency" },
    ],
    exportOptions: { pdf: true, excel: true, csv: false },
  },
  journal: {
    title: "Journal Voucher Report",
    description: "Detailed report of all journal vouchers",
    apiEndpoint: "/api/reports/journal",
    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        required: true,
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        required: true,
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
      },
      voucherViewFilter,
    ],
    columns: [
      { field: "dated", headerName: "Date", width: 40, type: "date" },
      {
        field: "tran_id",
        headerName: "Transaction #",
        width: 32,
        type: "text",
      },
      { field: "vr_no", headerName: "Voucher No", width: 40 },
      { field: "damt", headerName: "Debit", width: 60, type: "currency" },
      { field: "camt", headerName: "Credit", width: 60, type: "currency" },
      { field: "narration", headerName: "Narration", width: 75 },
    ],
    // Summary view: the eye icon opens both sides of the adjustment in a
    // modal. Journals carry no auto entry — every line is sub_tran_id 1 and
    // the debits already equal the credits in the voucher itself.
    detailColumns: [
      { field: "acno", headerName: "Code", width: 18, type: "text" },
      { field: "acname", headerName: "Account", width: 80 },
      { field: "chno", headerName: "Ref / Cheque #", width: 35 },
      { field: "damt", headerName: "Debit", width: 40, type: "currency" },
      { field: "camt", headerName: "Credit", width: 40, type: "currency" },
      { field: "narration", headerName: "Narration", width: 90 },
    ],
    // Detail view: the same lines inline, grouped under their voucher.
    getColumns: voucherColumns("journal", "Account"),
    layout: voucherLayout,
    summaryFields: [
      {
        field: "total_transactions",
        label: "Total Transactions",
        type: "number",
      },
      { field: "total_damt", label: "Total Debit", type: "currency" },
      { field: "total_camt", label: "Total Credit", type: "currency" },
    ],
    exportOptions: { pdf: true, excel: true, csv: false },
  },
  materialProduction: {
    title: "Material Production Report",
    description: "Production details with actual yield quantities",
    apiEndpoint: "/api/reports/materialProduction",
    showSummary: true,

    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        required: true,
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        required: true,
      },
      {
        name: "processOrder",
        label: "Process Order No",
        type: "select",
        options: "processOrders",
        apiEndpoint: "/api/voucher/productionPlan",
        valueKey: "id",
        nameKey: "id",
        clearable: true,
      },
      {
        name: "salesOrder",
        label: "Sales Order No",
        type: "select",
        options: "orders",
        apiEndpoint: "/api/orders/saleOrder",
        valueKey: "order_no",
        nameKey: "order_no",
        clearable: true,
      },
      {
        name: "batchNo",
        label: "Batch No",
        type: "select",
        options: "batches",
        apiEndpoint: "/api/quality/batches",
        valueKey: "batch_no",
        nameKey: "batch_no",
        clearable: true,
      },
      {
        name: "item",
        label: "Production Material",
        type: "select",
        options: "products",
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["itcd", "item", "code"],
        separator: " - ",
        clearable: true,
      },
    ],

    // Main columns
    columns: [
      {
        field: "dated",
        headerName: "Date",
        width: 30,
        type: "date",
        valueGetter: (params) => {
          if (!params.row.dated) return "";
          return new Date(params.row.dated).toLocaleDateString("en-PK", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          });
        },
      },
      {
        field: "vr_no",
        headerName: "VR No",
        width: 20,
      },
      {
        field: "process_order_no",
        headerName: "Process Order No",
        width: 30,
      },
      {
        field: "sales_order_no",
        headerName: "Sales Order No",
        width: 30,
      },
      {
        field: "batch_no",
        headerName: "Batch No",
        width: 20,
      },
      {
        field: "production_item_code",
        headerName: "Material Code",
        width: 25,
        valueGetter: (params) => params.row.production_item?.itcd || "",
      },
      {
        field: "production_item_name",
        headerName: "Material Name",
        width: 60,
        valueGetter: (params) => params.row.production_item?.item || "",
      },
      {
        field: "actual_yield_qty",
        headerName: "Actual Yield Qty",
        width: 30,
        type: "number",
        valueGetter: (params) => {
          const qty =
            params.row.transactions?.reduce(
              (sum, t) => sum + (t.qty || 0),
              0
            ) || 0;
          return qty.toLocaleString();
        },
      },
    ],

    // Detail columns (for expanded view)
    detailColumns: [
      {
        field: "item_code",
        headerName: "Material Code",
        width: 25,
        valueGetter: (params) =>
          params.row.itemDetails?.itcd || params.row.itcd || "",
      },
      {
        field: "item_name",
        headerName: "Material Name",
        width: 80,
        valueGetter: (params) => params.row.itemDetails?.item || "",
      },
      {
        field: "qty",
        headerName: "Quantity",
        width: 25,
        type: "number",
      },
      {
        field: "rate",
        headerName: "Rate",
        width: 25,
        type: "currency",
      },
      {
        field: "amount",
        headerName: "Amount",
        width: 30,
        type: "currency",
      },
      {
        field: "godown",
        headerName: "Godown",
        width: 40,
        valueGetter: (params) => params.row.godownDetails?.godown || "",
      },
    ],

    summaryFields: [
      {
        field: "total_transactions",
        label: "Total Transactions",
        type: "number",
      },
      {
        field: "total_yield_qty",
        label: "Total Yield Quantity",
        type: "number",
      },
      { field: "total_amount", label: "Total Amount", type: "currency" },
    ],

    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },

  materialIssuance: {
    title: "Material Issuance Report",
    description: "Material issuance details by process order",
    apiEndpoint: "/api/reports/materialIssuance",
    showSummary: true,

    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        required: true,
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        required: true,
      },
      {
        name: "processOrder",
        label: "Process Order No",
        type: "select",
        options: "processOrders",
        apiEndpoint: "/api/voucher/productionPlan",
        valueKey: "id",
        nameKey: "id",
        clearable: true,
      },
      {
        name: "salesOrder",
        label: "Sales Order No",
        type: "select",
        options: "orders",
        apiEndpoint: "/api/orders/saleOrder",
        valueKey: "order_no",
        nameKey: "order_no",
        clearable: true,
      },
      {
        name: "item",
        label: "Issued Material",
        type: "select",
        options: "products",
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["itcd", "item", "code"],
        separator: " - ",
        clearable: true,
      },
    ],

    // Main columns
    columns: [
      {
        field: "dated",
        headerName: "Date",
        width: 30,
        type: "date",
        valueGetter: (params) => {
          if (!params.row.dated) return "";
          return new Date(params.row.dated).toLocaleDateString("en-PK", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          });
        },
      },
      {
        field: "vr_no",
        headerName: "VR No",
        width: 20,
      },
      {
        field: "process_order_no",
        headerName: "Process Order No",
        width: 30,
      },
      {
        field: "sales_order_no",
        headerName: "Sales Order No",
        width: 30,
      },
      {
        field: "issued_item_code",
        headerName: "Material Code",
        width: 25,
        valueGetter: (params) => params.row.issued_item?.itcd || "",
      },
      {
        field: "issued_item_name",
        headerName: "Material Name",
        width: 60,
        valueGetter: (params) => params.row.issued_item?.item || "",
      },
      {
        field: "issued_qty",
        headerName: "Issued Qty",
        width: 30,
        type: "number",
        valueGetter: (params) => {
          const qty =
            params.row.transactions?.reduce(
              (sum, t) => sum + (t.qty || 0),
              0
            ) || 0;
          return qty.toLocaleString();
        },
      },
    ],

    // Detail columns (for expanded view)
    detailColumns: [
      {
        field: "item_code",
        headerName: "Material Code",
        width: 25,
        valueGetter: (params) =>
          params.row.itemDetails?.itcd || params.row.itcd || "",
      },
      {
        field: "item_name",
        headerName: "Material Name",
        width: 80,
        valueGetter: (params) => params.row.itemDetails?.item || "",
      },
      {
        field: "qty",
        headerName: "Quantity",
        width: 25,
        type: "number",
      },
      {
        field: "rate",
        headerName: "Rate",
        width: 25,
        type: "currency",
      },
      {
        field: "amount",
        headerName: "Amount",
        width: 30,
        type: "currency",
      },
      {
        field: "godown",
        headerName: "Godown",
        width: 40,
        valueGetter: (params) => params.row.godownDetails?.godown || "",
      },
      {
        field: "remarks",
        headerName: "Remarks",
        width: 80,
        valueGetter: (params) => params.row.narration1 || "",
      },
    ],

    summaryFields: [
      {
        field: "total_transactions",
        label: "Total Transactions",
        type: "number",
      },
      {
        field: "total_issued_qty",
        label: "Total Issued Quantity",
        type: "number",
      },
      { field: "total_amount", label: "Total Amount", type: "currency" },
    ],

    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },

  materialTransfer: {
    title: "Material Transfer Report",
    description: "Shows material transfers with quantities and batch details.",
    apiEndpoint: "/api/reports/materialTransfer",
    filters: [
      { name: "dateFrom", label: "From Date", type: "date", required: true, default: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      { name: "dateTo", label: "To Date", type: "date", required: true, default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0), },
      { name: "product", label: "Product", type: "select", options: "products", apiEndpoint: "/api/setup/items", default: { value: "", label: "All Products" }, valueKey: "itcd", nameKeys: ["code", "item"], separator: " - ", clearable: true },
      {
        name: "transferFrom",
        label: "Transfer From",
        type: "select",
        nameKey: "godown",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns?includeInactive=true",
        clearable: true,
      },
      {
        name: "transferTo",
        label: "Transfer To",
        type: "select",
        nameKey: "godown",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns?includeInactive=true",
        clearable: true,
      },
    ],
    getColumns: () => [
      { field: "dated", headerName: "Date", width: 35, type: "date" },
      { field: "tran_id", headerName: "Tran #", width: 35, type: "text" },
      { field: "ink_code", headerName: "Code", width: 35, type: "text" },
      // { field: "mm_code", headerName: "MM", width: 25, type: "text" },
      { field: "productName", headerName: "Product", width: 80, type: "text" },

      // { field: "batch_no", headerName: "Batch No", width: 30, type: "text" },
      { field: "transfer_qty", headerName: "Transfer Qty", width: 35, type: "number", showTotal: true, },
      // { field: "req_no", headerName: "Requisition No", width: 35, type: "text" },

      { field: "transfer_from", headerName: "Transfer From", width: 35, type: "text" },
      { field: "transfer_to", headerName: "Transfer To", width: 35, type: "text" },
      { field: "narration1", headerName: "Narration", width: 35, type: "text" }

    ],
    exportOptions: { excel: true, pdf: true },
  },

  stock: {
    title: "Stock Report",
    description: "Comprehensive stock analysis with purchase/sale data",
    apiEndpoint: "/api/reports/stock",
    // Whole row blinks when the stock is in minus.
    blinkCells: (row) => Number(row.actualStock || row.stock || 0) < 0,
    filters: [
      // {
      //   name: "dateFrom",
      //   label: "From Date",
      //   type: "date",
      //   required: true,
      //   default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      // },
      {
        name: "dateTo",
        label: "As Of Date",
        type: "date",
        required: true,
        default: new Date(),
      },
      {
        // Multi-select: sent as a comma list of itcds, which getStockReport
        // turns into itcd IN (...).
        name: "item",
        label: "Item",
        type: "select",
        multiple: true,
        options: "items",
        apiEndpoint: "/api/setup/items",
        clearable: true,
        valueKey: "itcd",
        nameKeys: ["code", "item"],
        separator: " - ",
      },
      {
        name: "category",
        label: "Category",
        nameKey: "ic_name",
        type: "select",
        options: "itemCategories",
        apiEndpoint: "/api/setup/item_categories",
        clearable: true,
      },
      {
        name: "inkSeries",
        label: "Sub Category",
        type: "select",
        options: "main_categories",
        default: { value: "", label: "All Categories" },
        apiEndpoint: "/api/setup/main_categories",
        valueKey: "id",
        nameKeys: ["mc_name"],
        clearable: true,
        multiple: true, },
      {
        name: "godown",
        label: "Warehouse",
        type: "select",
        nameKeys: ["id", "godown"],
        options: "godowns",
        apiEndpoint: "/api/setup/godowns?includeInactive=true",
        clearable: true,
      },
      {
        // Like Stock Activity: items with 0 stock are hidden unless ticked
        name: "showZeroStock",
        label: "Show Zero Stock",
        type: "checkbox",
        default: true,
      },
    ],
    columns: [
      // {
      //   field: "itcd",
      //   headerName: "MM",
      //   width: 30,
      //   valueGetter: (params) => params.row.itcd || "-",
      // },

      // COLUMN 2: INK CODE
      {
        field: "inkcode",
        headerName: "Ink Code",
        width: 110,
        valueGetter: (params) => params.row.code || "-"
      },

      // COLUMN 3: ITEM NAME
      {
        field: "item",
        headerName: "Item Name",
        width: 80,
        valueGetter: (params) => params.row.item || "-",
      },
      {
        field: "category",
        headerName: "Category",
        width: 55,
        valueGetter: (params) => params.row.itemcategory || "",
      },
      {
        field: "ink_series",
        headerName: "Sub Category",
        width: 55,
        valueGetter: (params) => params.row.ink_series || "",
      },
      // Current Stock Information
      {
        field: "currentStock",
        headerName: "Current Stock",
        width: 30,
        type: "number",
        valueGetter: (params) =>
          params.row.actualStock || params.row.stock || 0,
      },
      // Vouchers waiting on Approvals (not posted yet — lib/stock/pendingApprovals.js).
      // Available = Current Stock − Pending Out; pending IN is not counted.
      {
        field: "pendingOut",
        headerName: "Pending Approval Out",
        width: 30,
        type: "number",
        valueGetter: (params) => params.row.pendingOut || 0,
      },
      {
        field: "pendingIn",
        headerName: "Pending Approval In",
        width: 30,
        type: "number",
        valueGetter: (params) => params.row.pendingIn || 0,
      },
      {
        field: "availableStock",
        headerName: "Available Stock",
        width: 30,
        type: "number",
        valueGetter: (params) =>
          params.row.availableStock ?? (params.row.actualStock || params.row.stock || 0),
      },
      // {
      //   field: "currentStockValue",
      //   headerName: "Stock Value",
      //   width: 50,
      //   type: "currency",
      //   valueGetter: (params) => params.row.currentStockValue || 0,
      // },
      // {
      //   field: "potentialSaleValue",
      //   headerName: "Potential Sale Value",
      //   width: 160,
      //   type: "currency",
      //   valueGetter: (params) => params.row.stockAnalysis?.potentialSaleValue || 0,
      // },

      // // Purchase Analysis
      // {
      //   field: "netPurchased",
      //   headerName: "Net Purchased",
      //   width: 130,
      //   type: "number",
      //   valueGetter: (params) => params.row.stockAnalysis?.totalPurchased || 0,
      // },
      // {
      //   field: "avgPurchaseRate",
      //   headerName: "Avg Purchase Rate",
      //   width: 150,
      //   type: "currency",
      //   valueGetter: (params) => params.row.stockAnalysis?.avgPurchaseRate || 0,
      // },
      // {
      //   field: "netPurchaseValue",
      //   headerName: "Total Purchase Value",
      //   width: 160,
      //   type: "currency",
      //   valueGetter: (params) => params.row.stockAnalysis?.totalPurchaseValue || 0,
      // },

      // // Sales Analysis
      // {
      //   field: "netSold",
      //   headerName: "Net Sold",
      //   width: 120,
      //   type: "number",
      //   valueGetter: (params) => params.row.stockAnalysis?.netSold || 0,
      // },
      // {
      //   field: "avgSaleRate",
      //   headerName: "Avg Sale Rate",
      //   width: 140,
      //   type: "currency",
      //   valueGetter: (params) => params.row.stockAnalysis?.avgSaleRate || 0,
      // },
      // {
      //   field: "netSaleValue",
      //   headerName: "Total Sale Value",
      //   width: 150,
      //   type: "currency",
      //   valueGetter: (params) => params.row.stockAnalysis?.netSaleValue || 0,
      // },

      // // Performance Metrics
      // {
      //   field: "profitMargin",
      //   headerName: "Profit Margin (%)",
      //   width: 140,
      //   type: "number",
      //   valueGetter: (params) => params.row.stockAnalysis?.profitMargin || 0,
      //   cellRenderer: (params) => `${params.value}%`,
      // },
      // {
      //   field: "stockTurnover",
      //   headerName: "Stock Turnover (%)",
      //   width: 150,
      //   type: "number",
      //   valueGetter: (params) => params.row.stockAnalysis?.stockTurnover || 0,
      //   cellRenderer: (params) => `${params.value}%`,
      // },

      // // Transaction Counts
      // {
      //   field: "purchaseCount",
      //   headerName: "Purchase Transactions",
      //   width: 160,
      //   type: "number",
      //   valueGetter: (params) => params.row.stockAnalysis?.transactionCounts?.purchases || 0,
      // },
      // {
      //   field: "saleCount",
      //   headerName: "Sale Transactions",
      //   width: 140,
      //   type: "number",
      //   valueGetter: (params) => params.row.stockAnalysis?.transactionCounts?.sales || 0,
      // },
      // {
      //   field: "returnCount",
      //   headerName: "Returns",
      //   width: 100,
      //   type: "number",
      //   valueGetter: (params) => {
      //     const analysis = params.row.stockAnalysis?.transactionCounts;
      //     return (analysis?.purchaseReturns || 0) + (analysis?.saleReturns || 0);
      //   },
      // },
    ],

    // Column Groups for better organization
    // columnGroups: [
    //   {
    //     groupId: "basic",
    //     headerName: "Basic Info",
    //     children: ["item", "sku", "category"]
    //   },
    //   {
    //     groupId: "stock",
    //     headerName: "Current Stock",
    //     children: ["currentStock", "currentStockValue", "potentialSaleValue"]
    //   },
    //   {
    //     groupId: "purchase",
    //     headerName: "Purchase Analysis",
    //     children: ["netPurchased", "avgPurchaseRate", "netPurchaseValue"]
    //   },
    //   {
    //     groupId: "sales",
    //     headerName: "Sales Analysis",
    //     children: ["netSold", "avgSaleRate", "netSaleValue"]
    //   },
    //   {
    //     groupId: "performance",
    //     headerName: "Performance Metrics",
    //     children: ["profitMargin", "stockTurnover"]
    //   },
    //   {
    //     groupId: "transactions",
    //     headerName: "Transaction Summary",
    //     children: ["purchaseCount", "saleCount", "returnCount"]
    //   }
    // ],

    // Default visible columns (others can be toggled)
    defaultVisibleColumns: [
      "itcd", // ITCD code
      "inkcode", // Ink Code
      "item",
      "sku",
      "category",
      "ink_series",
      "currentStock",
      "currentStockValue",
      "avgPurchaseRate",
      "avgSaleRate",
      "profitMargin",
    ],

    // Drill trail (rule 15): the item's ledger for the month of "As Of", same
    // godown. In the wide table it replaces the drillDown below (which asked
    // for the date again in a modal); the drillDown stays for the old table.
    drill: [
      {
        label: "Open stock ledger",
        when: (row) => !!row.itcd,
        href: (row, filters) =>
          stockLedgerHref({ item: row.itcd, dateFrom: monthStartOfDMY(filters.dateTo), dateTo: filters.dateTo, godown: filters.godown }),
      },
    ],

    drillDown: {
      enabled: true,
      label: "View Stock Ledger",
      modalTitle: "View Stock Ledger Details",
      fields: [
        {
          name: "dateTo",
          label: "To Date",
          type: "date",
          required: true,
          default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        },
      ],
      linkBuilder: (row, filters) =>
        `/accounting/reports/stockLedger?item=${row.itcd}&dateFrom=${currentMonthStartDMY()}&dateTo=${filters.dateTo}`,
    },

    summaryFields: [
      { field: "total_items", label: "Total Items", type: "number" },
      { field: "total_stock", label: "Total Current Stock", type: "number" },
      // { field: "total_value", label: "Total Stock Value", type: "currency" },
      // { field: "total_potential_value", label: "Total Potential Sale Value", type: "currency" },
      // { field: "total_purchase_value", label: "Total Purchase Value", type: "currency" },
      // { field: "total_sale_value", label: "Total Sale Value", type: "currency" },
      // { field: "overall_profit_margin", label: "Overall Profit Margin (%)", type: "percentage" },
      // { field: "total_transactions", label: "Total Transactions", type: "number" },
    ],

    // Enhanced export options
    exportOptions: {
      pdf: {
        enabled: true,
        orientation: "landscape", // Due to many columns
        title: "Stock Analysis Report",
      },
      excel: {
        enabled: true,
        worksheets: [
          {
            name: "Stock Analysis",
            includeAll: true,
          },
          {
            name: "Summary",
            summaryOnly: true,
          },
        ],
      },
      // csv: {
      //   enabled: false,
      //   filename: "stock_analysis_report",
      // },
    },

    // Additional configuration for better UX
    pagination: {
      defaultPageSize: 50,
      pageSizeOptions: [25, 50, 100, 200],
    },

    sorting: {
      defaultSort: [{ field: "item", sort: "asc" }],
      multiSort: true,
    },

    filtering: {
      enabled: true,
      quickFilter: true,
    },
  },

  fgstock: {
    title: "FG Stock Report",
    description: "Comprehensive finished goods stock analysis with purchase/sale data",
    apiEndpoint: "/api/reports/fgstock",
    // Whole row blinks when the stock is in minus.
    blinkCells: (row) => Number(row.actualStock || row.stock || 0) < 0,
    filters: [
      {
        name: "dateTo",
        label: "As Of Date",
        type: "date",
        required: true,
        default: new Date(),
      },
      {
        name: "category",
        label: "Category",
        nameKey: "ic_name",
        type: "select",
        options: "itemCategories",
        apiEndpoint: "/api/setup/item_categories",
        clearable: true,
      },
      {
        name: "item",
        label: "Item",
        type: "select",
        options: "items",
        apiEndpoint: "/api/setup/items",
        clearable: true,
        valueKey: "itcd",
        nameKeys: ["code", "item"],
        separator: " - ",
      },
      {
        name: "godown",
        label: "Warehouse",
        type: "select",
        locked: true,
        default: 6,
        defaultLabel: "FINISHED GOODS",
        options: [{ value: 6, label: "FINISHED GOODS" }],
      },
    ],
    columns: [
      // {
      //   field: "itcd",
      //   headerName: "MM",
      //   width: 30,
      //   valueGetter: (params) => params.row.itcd || "-",
      // },

      // COLUMN 2: INK CODE
      {
        field: "inkcode",
        headerName: "Ink Code",
        width: 110,
        valueGetter: (params) => params.row.code || "-"
      },

      // COLUMN 3: ITEM NAME
      {
        field: "item",
        headerName: "Item Name",
        width: 80,
        valueGetter: (params) => params.row.item || "-",
      },
      {
        field: "category",
        headerName: "Category",
        width: 55,
        valueGetter: (params) => params.row.itemcategory || "",
      },
      // Current Stock Information
      {
        field: "currentStock",
        headerName: "Current Stock",
        width: 30,
        type: "number",
        valueGetter: (params) =>
          params.row.actualStock || params.row.stock || 0,
      },

    ],



    // Default visible columns (others can be toggled)
    defaultVisibleColumns: [
      "itcd", // ITCD code
      "inkcode", // Ink Code
      "item",
      "sku",
      "category",
      "currentStock",
      "currentStockValue",
      "avgPurchaseRate",
      "avgSaleRate",
      "profitMargin",
    ],

    drillDown: {
      enabled: true,
      label: "View Stock Ledger",
      modalTitle: "View Stock Ledger Details",
      fields: [
        {
          name: "dateTo",
          label: "To Date",
          type: "date",
          required: true,
          default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        },
      ],
      linkBuilder: (row, filters) =>
        `/accounting/reports/stockLedger?item=${row.itcd}&dateFrom=${currentMonthStartDMY()}&dateTo=${filters.dateTo}`,
    },

    summaryFields: [
      { field: "total_items", label: "Total Items", type: "number" },
      { field: "total_stock", label: "Total Current Stock", type: "number" },
      // { field: "total_value", label: "Total Stock Value", type: "currency" },
      // { field: "total_potential_value", label: "Total Potential Sale Value", type: "currency" },
      // { field: "total_purchase_value", label: "Total Purchase Value", type: "currency" },
      // { field: "total_sale_value", label: "Total Sale Value", type: "currency" },
      // { field: "overall_profit_margin", label: "Overall Profit Margin (%)", type: "percentage" },
      // { field: "total_transactions", label: "Total Transactions", type: "number" },
    ],

    // Enhanced export options
    exportOptions: {
      pdf: {
        enabled: true,
        orientation: "landscape", // Due to many columns
        title: "Stock Analysis Report",
      },
      excel: {
        enabled: true,
        worksheets: [
          {
            name: "Stock Analysis",
            includeAll: true,
          },
          {
            name: "Summary",
            summaryOnly: true,
          },
        ],
      },
      // csv: {
      //   enabled: false,
      //   filename: "stock_analysis_report",
      // },
    },

    // Additional configuration for better UX
    pagination: {
      defaultPageSize: 50,
      pageSizeOptions: [25, 50, 100, 200],
    },

    sorting: {
      defaultSort: [{ field: "item", sort: "asc" }],
      multiSort: true,
    },

    filtering: {
      enabled: true,
      quickFilter: true,
    },
  },

  fgdailystock: {
    title: "FG Daily Update Report",
    description: "Comprehensive Daily finished goods stock analysis with purchase/sale data",
    apiEndpoint: "/api/reports/fgdailystock",
    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        required: true,
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        required: true,
      },
      {
        name: "region",
        label: "Region",
        type: "select",
        options: [
          { value: "NORTH", label: "NORTH" },
          { value: "SOUTH", label: "SOUTH" },
        ],
        clearable: true,
        defaultValue: { value: "NORTH", label: "NORTH" },
      },
      {
        name: "item",
        label: "Item",
        type: "select",
        options: "items",
        apiEndpoint: "/api/setup/items",
        clearable: true,
        valueKey: "itcd",
        nameKeys: ["code", "item"],
        separator: " - ",
      },
      {
        name: 'mm',
        label: 'MM No',
        type: 'text'
      }
    ],
    getColumns: (filters) => {
      const columns = [
        {
          field: "item",
          headerName: "Item Name",
          width: 200,
          valueGetter: (params) => {
            const item = params.row.item || "";
            const inkCode = params.row.code || "";
            return inkCode ? `${inkCode} - ${item}` : item;
          },
        },
        {
          field: "uom",
          headerName: "UOM",
          type: "text",
          valueGetter: (params) => params.row.uom || "KG",
        },
        {
          field: "itcd",
          headerName: "MM NO",
          width: 80,
          valueGetter: (params) => params.row.itcd || "-",
        },
      ];

      if (filters?.dateFrom && filters?.dateTo) {
        // Parse DD-MM-YYYY format
        const parseDate = (val) => {
          if (val instanceof Date) return val;
          if (typeof val === 'string' && /^\d{2}-\d{2}-\d{4}$/.test(val)) {
            const [day, month, year] = val.split('-');
            return new Date(parseInt(year), parseInt(month) - 1, parseInt(day));
          }
          return new Date(val);
        };
        const dateFrom = parseDate(filters.dateFrom);
        const dateTo = parseDate(filters.dateTo);

        if (!isNaN(dateFrom.getTime()) && !isNaN(dateTo.getTime())) {
          for (let d = new Date(dateFrom); d <= dateTo; d.setDate(d.getDate() + 1)) {
            const yyyy = d.getFullYear();
            const mm = String(d.getMonth() + 1).padStart(2, '0');
            const dd = String(d.getDate()).padStart(2, '0');
            const dateStr = `${yyyy}-${mm}-${dd}`;
            const dateLabel = new Date(d).toLocaleDateString('en-US', { day: 'numeric', month: 'numeric', year: 'numeric' });

            columns.push(
              { field: `${dateStr}_opn`, headerName: `OPN (${dateLabel})`, type: "number", width: 100, sortable: false },
              { field: `${dateStr}_rec`, headerName: `REC (${dateLabel})`, type: "number", width: 100, sortable: false },
              { field: `${dateStr}_disp`, headerName: `DISP (${dateLabel})`, type: "number", width: 100, sortable: false },
              { field: `${dateStr}_closing`, headerName: `CLOSING (${dateLabel})`, type: "number", width: 100, sortable: false }
            );
          }
        }
      }
      return columns;
    },

    summaryFields: [
      { field: "total_items", label: "Total Items", type: "number" },
    ],

    exportOptions: {
      pdf: {
        enabled: true,
        orientation: "landscape",
        title: "FG Daily Update Report",
      },
      excel: {
        enabled: true,
      },
    },

    pagination: {
      defaultPageSize: 50,
      pageSizeOptions: [25, 50, 100, 200],
    },

    sorting: {
      defaultSort: [{ field: "item", sort: "asc" }],
      multiSort: true,
    },

    filtering: {
      enabled: true,
      quickFilter: true,
    },
  },

  stockActivity: {
    title: "Stock Activity Report",
    description: "Product-wise stock movement analysis",
    apiEndpoint: "/api/reports/stockActivity",
    // Whole row blinks when the closing stock balance is in minus.
    blinkCells: (row) => Number(row.stock_balance ?? 0) < 0,
    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        required: true,
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        required: true,
      },
      {
        name: "product",
        label: "Product",
        type: "select",
        options: "products",
        default: { value: "", label: "All Products" },
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["code", "item"],
        separator: " - ",
        clearable: true,
      },
      {
        name: "category",
        label: "Category",
        default: { value: "", label: "All Categories" },
        type: "select",
        options: "itemCategories",
        apiEndpoint: "/api/setup/item_categories",
        nameKey: "ic_name",
        clearable: true,
      },
      {
        name: "inkSeries",
        label: "Sub Category",
        type: "select",
        options: "main_categories",
        default: { value: "", label: "All Categories" },
        apiEndpoint: "/api/setup/main_categories",
        valueKey: "id",
        nameKeys: ["mc_name"],
        clearable: true,
        multiple: true, },
      {
        name: "godown",
        label: "Warehouse",
        type: "select",
        nameKeys: ["id", "godown"],
        default: { value: "", label: "All Godowns" },
        options: "godowns",
        apiEndpoint: "/api/setup/godowns?includeInactive=true",
        clearable: true,
      },
      {
        name: "showZeroStock",
        label: "Show Zero Stock",
        type: "checkbox",
        default: false,
      },
      {
        // Adds an IN and an OUT column for each godown that moved stock in the
        // period (only those, not all twelve). The column list comes from the
        // API — see getStockActivityReportWithColumns() in the report route.
        name: "godownWise",
        label: "Godown Wise Transfers",
        type: "checkbox",
        default: false,
      },
    ],
    columns: [
      { field: "inkcode", headerName: "Code", width: 15 },
      { field: "product_name", headerName: "Product Name", width: 80 },
      { field: "category", headerName: "Category", width: 30 },
      { field: "ink_series", headerName: "Sub Category", width: 30 },
      {
        field: "opening_stock", showTotal: true,
        headerName: "Open Stock",
        width: 15,
        type: "number",
      },
      {
        field: "purchase_qty", showTotal: true,
        headerName: "Pur Qty",
        width: 15,
        type: "number",
      },
      {
        field: "purchase_ret_qty", showTotal: true,
        headerName: "P.R Qty",
        width: 15,
        type: "number",
      },
      {
        field: "transfer_in_qty", showTotal: true,
        headerName: "T-IN QTY",
        width: 15,
        type: "number",
      },
      {
        field: "transfer_out_qty", showTotal: true,
        headerName: "T-OUT QTY",
        width: 15,
        type: "number",
      },
      { field: "sale_qty", showTotal: true, headerName: "Sa QTY", width: 15, type: "number" },
      {
        field: "sale_ret_qty", showTotal: true,
        headerName: "SALE RET QTY",
        width: 15,
        type: "number",
      },
      { field: "production_qty", showTotal: true, headerName: "PROD QTY", width: 15, type: "number" },
      { field: "issued_qty", showTotal: true, headerName: "ISS QTY", width: 15, type: "number" },
      { field: "pos_qty", showTotal: true, headerName: "POS QTY", width: 15, type: "number" },
      {
        field: "pos_ret_qty", showTotal: true,
        headerName: "POS-R QTY",
        width: 15,
        type: "number",
      },
      {
        field: "stock_balance", showTotal: true,
        headerName: "St Bal",
        width: 15,
        type: "number",
      },
      // Vouchers waiting on Approvals — not posted, so not in St Bal.
      // Avail = St Bal − Pending Out (lib/stock/pendingApprovals.js).
      { field: "pending_out_qty", headerName: "Pending Appr. Out", width: 15, type: "number", showTotal: true },
      { field: "pending_in_qty", headerName: "Pending Appr. In", width: 15, type: "number", showTotal: true },
      { field: "available_balance", headerName: "Avail Bal", width: 15, type: "number", showTotal: true },
    ],

    // Opening + In − Out = Closing, plus a total for every movement column.

    // Wide-report layout (rule 15): movements grouped in / out, rows by category.
    layout: (() => {
      const IN = ["purchase_qty", "sale_ret_qty", "transfer_in_qty", "production_qty", "pos_ret_qty"];
      const OUT = ["purchase_ret_qty", "sale_qty", "transfer_out_qty", "issued_qty", "pos_qty"];
      const sum = (row, fields) => fields.reduce((a, f) => a + (Number(row?.[f]) || 0), 0);
      return {
        pinned: ["inkcode", "product_name"],
        groups: [
          { id: "open", label: "Opening", fields: ["opening_stock"] },
          { id: "in", label: "In", fields: IN },
          { id: "out", label: "Out", fields: OUT },
          { id: "close", label: "Closing", fields: ["stock_balance"] },
        ],
        rowGroupBy: "category",
        card: {
          title: "product_name",
          subtitle: "inkcode",
          figures: ["stock_balance", "opening_stock", { label: "In", value: (row) => sum(row, IN) }, { label: "Out", value: (row) => sum(row, OUT) }],
        },
      };
    })(),
    // Drill trail: an item's movements, same period and godown.
    drill: [
      {
        label: "Open stock ledger",
        when: (row) => !!row.product_code,
        href: (row, filters) =>
          stockLedgerHref({ item: row.product_code, dateFrom: filters.dateFrom, dateTo: filters.dateTo, godown: filters.godown }),
      },
    ],
    summaryFields: [
      { field: "total_items", label: "Items", type: "number" },
      { field: "total_opening", label: "Opening", type: "number" },
      { field: "total_purchase", label: "Purchase", type: "number" },
      { field: "total_production", label: "Production", type: "number" },
      { field: "total_sale_ret", label: "Sale Return", type: "number" },
      { field: "total_pos_ret", label: "POS Return", type: "number" },
      { field: "total_transfer_in", label: "Transfer In", type: "number" },
      { field: "total_in", label: "Total In", type: "number" },
      { field: "total_sale", label: "Sale", type: "number" },
      { field: "total_pos", label: "POS", type: "number" },
      { field: "total_issued", label: "Issued", type: "number" },
      { field: "total_purchase_ret", label: "Purchase Return", type: "number" },
      { field: "total_transfer_out", label: "Transfer Out", type: "number" },
      { field: "total_out", label: "Total Out", type: "number" },
      { field: "total_movement", label: "Net Movement", type: "number" },
      { field: "total_stock", label: "Closing Stock", type: "number" },
      { field: "total_pending_out", label: "Pending Approval Out", type: "number" },
      { field: "total_available", label: "Available", type: "number" },
    ],
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },

  stockActivityView: {
    title: "Stock Activity View",
    description: "Product-wise stock activity view (Opening, In, Out, Close)",
    apiEndpoint: "/api/reports/stockActivityView",
    showSummary: true,
    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        required: true,
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        required: true,
      },
      {
        name: "product",
        label: "Product",
        type: "select",
        options: "products",
        default: { value: "", label: "All Products" },
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["code", "item"],
        separator: " - ",
        clearable: true,
      },
      {
        name: "category",
        label: "Category",
        default: { value: "", label: "All Categories" },
        type: "select",
        options: "itemCategories",
        apiEndpoint: "/api/setup/item_categories",
        nameKey: "ic_name",
        clearable: true,
      },
      {
        name: "inkSeries",
        label: "Sub Category",
        type: "select",
        options: "main_categories",
        default: { value: "", label: "All Categories" },
        apiEndpoint: "/api/setup/main_categories",
        valueKey: "id",
        nameKeys: ["mc_name"],
        clearable: true,
        multiple: true, },
      {
        name: "godown",
        label: "Warehouse",
        type: "select",
        nameKeys: ["id", "godown"],
        default: { value: "", label: "All Godowns" },
        options: "godowns",
        apiEndpoint: "/api/setup/godowns?includeInactive=true",
        clearable: true,
      },
      {
        name: "showZeroStock",
        label: "Show Zero Stock",
        type: "checkbox",
        default: false,
      },
    ],
    columns: [
      {
        field: "inkcode",
        headerName: "Ink Code",
        width: 110,
        valueGetter: (params) => params.row.code || "-"
      },
      // { field: "product_code", headerName: "Code", width: 15 },
      { field: "product_name", headerName: "Product Name", width: 80 },
      { field: "category", headerName: "Category", width: 30 },
      { field: "ink_series", headerName: "Sub Category", width: 30 },
      {
        field: "opening",
        headerName: "Opening",
        width: 15,
        type: "number",
      },
      {
        field: "qty_in",
        headerName: "In",
        width: 15,
        type: "number",
      },
      {
        field: "qty_out",
        headerName: "Out",
        width: 15,
        type: "number",
      },
      {
        field: "closing",
        headerName: "Close",
        width: 15,
        type: "number",
      },
    ],
    summaryFields: [
      { field: "total_opening", label: "Total Opening", type: "number" },
      { field: "total_in", label: "Total In", type: "number" },
      { field: "total_out", label: "Total Out", type: "number" },
      { field: "total_closing", label: "Total Closing", type: "number" },
    ],
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },



  tradingMargin: {
    title: "Trading Margin Report",
    description:
      "Profitability analysis by item (Purchase, Sales, Returns, POS)",
    apiEndpoint: "/api/reports/tradingMargin",
    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        required: true,
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        required: true,
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
      },
      {
        name: "item",
        valueKey: "itcd",
        nameKeys: ["itcd", "item", "code"],
        separator: " - ",
        label: "Item",
        type: "select",
        options: "items",
        default: { value: "", label: "All Items" },
        apiEndpoint: "/api/setup/items",
        clearable: true,
      },
      {
        name: "category",
        label: "Category",
        nameKey: "ic_name",
        default: { value: "", label: "All Categories" },
        type: "select",
        options: "itemCategories",
        apiEndpoint: "/api/setup/item_categories",
        clearable: true,
      },
    ],
    columns: [
      {
        field: "item",
        headerName: "Item",
        width: 40,
        valueGetter: (params) => params.row.itemDetails?.item || "",
      },
      {
        field: "category",
        headerName: "Cat",
        width: 30,
        valueGetter: (params) =>
          params.row.itemDetails?.itemCategories?.ic_name || "",
      },

      // --- Purchases ---
      {
        field: "purchase_qty",
        headerName: "Pur Qty",
        width: 10,
        type: "number",
      },
      {
        field: "purchase_amount",
        headerName: "Pur Amt",
        width: 15,
        type: "currency",
      },
      {
        field: "purchase_return_qty",
        headerName: "P.R Qty",
        width: 10,
        type: "number",
      },
      {
        field: "purchase_return_amount",
        headerName: "P.R Amt",
        width: 15,
        type: "currency",
      },

      // --- Sales ---
      { field: "sale_qty", headerName: "Sa Qty", width: 15, type: "number" },
      {
        field: "sale_amount",
        headerName: "Sa Amt",
        width: 15,
        type: "currency",
      },
      {
        field: "sale_return_qty",
        headerName: "S.R Qty",
        width: 15,
        type: "number",
      },
      {
        field: "sale_return_amount",
        headerName: "S.R Amt",
        width: 15,
        type: "currency",
      },

      // --- POS ---
      { field: "pos_qty", headerName: "Pos Qty", width: 15, type: "number" },
      {
        field: "pos_amount",
        headerName: "POS Amt",
        width: 15,
        type: "currency",
      },

      // --- Averages and Margins ---
      {
        field: "avg_purchase_rate",
        headerName: "Avg P.Rate",
        width: 15,
        type: "currency",
      },
      {
        field: "avg_sale_rate",
        headerName: "Avg S.Rate",
        width: 20,
        type: "currency",
      },
      { field: "margin", headerName: "Margin", width: 15, type: "currency" },
      {
        field: "margin_percent",
        headerName: "Margin %",
        width: 20,
        type: "percent",
      },
    ],
    summaryFields: [
      {
        field: "total_purchase_qty",
        label: "Total Purchase Qty",
        type: "number",
      },
      {
        field: "total_purchase_amount",
        label: "Total Purchase Amount",
        type: "currency",
      },
      {
        field: "total_purchase_return_qty",
        label: "Total Purchase Return Qty",
        type: "number",
      },
      {
        field: "total_purchase_return_amount",
        label: "Total Purchase Return Amt",
        type: "currency",
      },

      { field: "total_sale_qty", label: "Total Sale Qty", type: "number" },
      {
        field: "total_sale_amount",
        label: "Total Sale Amount",
        type: "currency",
      },
      {
        field: "total_sale_return_qty",
        label: "Total Sale Return Qty",
        type: "number",
      },
      {
        field: "total_sale_return_amount",
        label: "Total Sale Return Amt",
        type: "currency",
      },

      { field: "total_pos_qty", label: "Total POS Qty", type: "number" },
      {
        field: "total_pos_amount",
        label: "Total POS Amount",
        type: "currency",
      },

      { field: "total_margin", label: "Total Margin", type: "currency" },
      { field: "avg_margin_percent", label: "Avg Margin %", type: "percent" },
    ],
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },
  stockLedger: {
    showSummary: true,
    title: "Stock Ledger Report",
    description: "Detailed movement of stock items over time",
    apiEndpoint: "/api/reports/stockLedger",
    // Whole row blinks when the running (closing) qty is in minus.
    blinkCells: (row) => Number(row.closing_qty ?? 0) < 0,
    // Rows "R-… — PENDING APPROVAL": a voucher waiting on Approvals, not
    // posted yet — its OUT qty is already taken off the balance
    // (lib/stock/pendingApprovals.js).
    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        required: true,
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        required: true,
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
      },
      //  {
      //     name: "dateFrom",
      //     label: "From Date",
      //     type: "date",
      //     default: new Date(new Date().getFullYear(), new Date().getMonth(), 1), // ← added
      //     required: true,
      //   },
      //   {
      //     name: "dateTo",
      //     label: "To Date",
      //     type: "date",
      //     required: true,
      //   },
      {
        name: "item",
        label: "Item",
        type: "select",
        nameKeys: ["code", "item"],
        separator: " - ",
        valueKey: "itcd",
        options: "items",
        apiEndpoint: "/api/setup/items",
        required: true,
        clearable: true,
      },
      {
        name: "godown",
        label: "Warehouse",
        type: "select",
        nameKeys: ["id","godown"],
        options: "godowns",
        apiEndpoint: "/api/setup/godowns?includeInactive=true",
        clearable: true,
      },
      {
        name: "batchNo",
        label: "Batch No",
        type: "select",
        options: "batches",
        apiEndpoint: "/api/forms/qualitycontrol",
        valueKey: "batch_no",
        nameKey: "batch_no",
        clearable: true,
      },
    ],
    columns: [
      { field: "dated", headerName: "Date", width: 20, type: "date" },
      { field: "transaction_no", headerName: "VR #", width: 15 },
      { field: "code", headerName: "Code", width: 20, valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.code || ""  },
      { field: "item_name", headerName: "Item Name", width: 120,
        valueGetter: (params) => params.row.transactions?.[0]?.itemDetails?.item || ""},
      // { field: "tran_id", headerName: "Transaction #", width: 20 },
      { field: "reference_no", headerName: "Reference No #", width: 25 },
      { field: "transaction_type", headerName: "Trans Type", width: 40 },
      { field: "vendor_customer", headerName: "Vendor/Customer", width: 90 },
      {
        field: "opening_qty",
        headerName: "Qty Opening",
        width: 25,
        type: "number",
      },
      { field: "qty_in", headerName: "Qty In", width: 25, type: "number", showTotal: true },
      { field: "qty_out", headerName: "Qty Out", width: 25, type: "number", showTotal: true },
      {
        field: "closing_qty",
        headerName: "Qty Closing",
        width: 25,
        type: "number",
        showTotal: true,
        totalType: "last", // a running balance: the total is where it ends
      },
    ],
    // Wide-report layout (rule 15). Each row carries tran_id + tran_code from
    // the API, so it opens its voucher (lib/vouchers/voucherLink.js).
    layout: {
      pinned: ["dated", "transaction_no"],
      card: {
        title: (row) => row.vendor_customer || row.transaction_type || "",
        subtitle: (row) => [row.dated, row.transaction_no && `VR ${row.transaction_no}`, row.transaction_type].filter(Boolean).join(" · "),
        figures: ["closing_qty", "qty_in", "qty_out"],
      },
    },
    detailColumns: [
      {
        field: "item",
        headerName: "Item",
        width: 30,
        valueGetter: (params) => params.row.itemDetails?.item || "",
      },
      { field: "qty", headerName: "Qty", width: 30, type: "number" },
      { field: "rate", headerName: "Rate", width: 30, type: "currency" },
      {
        field: "gross_amount",
        headerName: "Gross Amount",
        width: 30,
        type: "currency",
      },
      { field: "st_rate", headerName: "ST Rate", width: 30, type: "number" },
      {
        field: "st_amount",
        headerName: "ST Amount",
        width: 30,
        type: "currency",
      },
      {
        field: "additional_tax",
        headerName: "Additional Tax",
        width: 30,
        type: "currency",
      },
      { field: "camt", headerName: "Amount", width: 30, type: "currency" },
    ],
    summaryFields: [
      { field: "total_in", label: "Total In", type: "number" },
      { field: "total_out", label: "Total Out", type: "number" },
      { field: "net_movement", label: "Net Movement", type: "number" },
      { field: "closing_balance", label: "Closing Balance", type: "number" },
      { field: "pending_out", label: "Pending Approval Out", type: "number" },
      { field: "pending_in", label: "Pending Approval In", type: "number" },
      { field: "available_balance", label: "Available", type: "number" },
    ],
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },
  posTransactions: {
    showSummary: true,
    title: "POS Transactions Report",
    description: "Detailed report of all Point of Sale transactions",
    apiEndpoint: "/api/reports/posTransactions",
    filters: [
      { name: "dateFrom", label: "From Date", type: "date", required: true, default: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        required: true,
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
      },
      {
        name: "customer",
        label: "Customer",
        type: "select",
        nameKeys: ["acno", "acname"],
        separator: " - ",
        valueKey: "acno",
        options: "customers",
        apiEndpoint: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`,
        clearable: true,
      },
      {
        name: "paymentMode",
        label: "Payment Mode",
        type: "select",
        options: [
          { value: "all", label: "All" },
          { value: "cash", label: "Cash" },
          { value: "card", label: "Card" },
          { value: "upi", label: "UPI" },
          { value: "credit", label: "Credit" },
        ],
        default: "all",
      },
    ],
    columns: [
      { field: "dated", headerName: "Date", width: 20, type: "date" },
      { field: "vr_no", headerName: "Vr #", width: 20 },
      { field: "invoice_no", headerName: "Invoice No", width: 35 },
      {
        field: "customer_name",
        headerName: "Customer",
        width: 40,
        valueGetter: (params) => params.row.acno?.acname || "Walk-in Customer",
      },
      { field: "payment_mode", headerName: "Payment Mode", width: 40 },
      {
        field: "total_qty",
        headerName: "Total Qty",
        width: 20,
        type: "number",
      },
      {
        field: "total_amount",
        headerName: "Total Amount",
        width: 40,
        type: "currency",
      },
      {
        field: "discount",
        headerName: "Discount",
        width: 20,
        type: "currency",
      },
      {
        field: "net_amount",
        headerName: "Net Amount",
        width: 40,
        type: "currency",
      },
    ],
    detailColumns: [
      {
        field: "item",
        headerName: "Item",
        width: 200,
        valueGetter: (params) => params.row.itemDetails?.item || "",
      },
      { field: "qty", headerName: "Qty", width: 100, type: "number" },
      { field: "rate", headerName: "Rate", width: 100, type: "currency" },
      {
        field: "gross_amount",
        headerName: "Amount",
        width: 150,
        type: "currency",
      },
      {
        field: "discount",
        headerName: "Line Discount",
        width: 150,
        type: "currency",
      },
    ],
    summaryFields: [
      {
        field: "total_transactions",
        label: "Total Transactions",
        type: "number",
      },
      { field: "total_qty", label: "Total Quantity", type: "number" },
      { field: "total_amount", label: "Total Amount", type: "currency" },
      { field: "total_discount", label: "Total Discount", type: "currency" },
      {
        field: "total_net_amount",
        label: "Total Net Amount",
        type: "currency",
      },
    ],
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },
  accountLedger: {
    // Multi-account runs read as one block per account: a header row names the
    // account, the rows follow, then a subtotal row closes it. Turns on only
    // when 2+ accounts are selected. Handled generically by ReportViewer.
    rowGrouping: {
      by: "acno",
      labelFields: ["acno", "acname"],
      labelSeparator: " — ",
      activateWhen: { filter: "account", minSelected: 2 },
      subtotalLabel: "Account Total",
      showHeader: true,
    },
    showSummary: true,
    title: "Account Ledger",
    description:
      "Detailed ledger entries for a specific account showing running balance",
    apiEndpoint: "/api/reports/accountLedger",
    filters: [
      {
        name: "dateFrom", label: "From Date", type: "date", required: true, default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      },
      { name: "dateTo", label: "To Date", type: "date", required: true, default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0), },
      {
        name: "account",
        label: "Account",
        type: "select",
        nameKeys: ["acno", "acname"],
        separator: " - ",
        valueKey: "acno",
        options: "accounts",
        apiEndpoint: "/api/accounts/acno",
        required: true,
        clearable: true,
        multiple: true,
      },
      // Summary = one row per voucher line of this account (a receipt's cash
      // account = one total row). Detailed = that total split per counter-line
      // (lib/reports/ledgerDetail.js); balances are the same either way.
      {
        name: "ledgerDetail",
        label: "Detail",
        type: "select",
        section: "display",
        options: [
          { value: "summary", label: "Summary — one row per voucher" },
          { value: "detailed", label: "Detailed — one row per voucher line" },
        ],
        default: { value: "summary", label: "Summary — one row per voucher" },
        clearable: false,
      },
    ],
    columns: [
      {
        field: "dated",
        headerName: "Date",
        width: 30,
        type: "date",
        valueGetter: (params) =>
          params.row.dated
            ? format(new Date(params.row.dated), "MMM dd, yyyy")
            : null,
      },
      { field: "vr_no", headerName: "VR #", width: 15 },
      { field: "slip_no", headerName: "Slip #", width: 15 },
      { field: "detail_invoice_no", headerName: "Invoice #", width: 20 },
      { field: "rmk5", headerName: "Tran #", width: 20 },
      {
        field: "acno", headerName: "Account No", width: 20
        , valueGetter: (params) => params.row.acno || ""
      },
      { field: "acname", headerName: "Account", width: 30 },
      { field: "against", headerName: "Against account", width: 35 },
      // { field: "narration", headerName: "Narration", width: 50 },
      { field: "tran_type", headerName: "Type", width: 25 },
      { field: "narration", headerName: "Narration", width: 45 },
      { field: "user_name", headerName: "User", width: 20 },
      {
        field: "debit",
        headerName: "Debit",
        width: 40,
        type: "currency",
        fixed: true,
        showTotal: true,
      },
      {
        field: "credit",
        headerName: "Credit",
        width: 40,
        type: "currency",
        fixed: true,
        showTotal: true,
      },
      {
        field: "balance",
        headerName: "Balance",
        width: 40,
        type: "currency",
        fixed: true,
        showTotal: true,
        totalType: "last"
      },
    ],

    // Wide-report layout (rule 15). Each row opens its voucher (tran_id +
    // tran_code); 2+ accounts still group per account via rowGrouping above.
    layout: {
      pinned: ["dated", "vr_no"],
      groups: [
        { id: "doc", label: "Document", fields: ["detail_invoice_no", "rmk5", "tran_type", "narration", "user_name"] },
        { id: "acc", label: "Account", fields: ["acno", "acname", "against"] },
        { id: "amt", label: "Amounts", fields: ["debit", "credit", "balance"], foldTo: "balance" },
      ],
      views: [
        { id: "standard", label: "Standard", fields: ["dated", "vr_no", "slip_no", "detail_invoice_no", "acname", "against", "tran_type", "narration", "user_name", "debit", "credit", "balance"] },
        { id: "all", label: "All columns" },
      ],
      card: {
        title: (r) => r.narration || r.acname || r.tran_type || "",
        subtitle: (r) => [r.vr_no && `VR ${r.vr_no}`, r.tran_type, r.detail_invoice_no && `INV ${r.detail_invoice_no}`, r.against && `vs ${r.against}`, r.user_name].filter(Boolean).join(" · "),
        figures: ["debit", "credit", "balance"],
      },
    },
    summaryFields: [
      {
        field: "total_debit",
        label: "Total Debit",
        type: "currency",
      },
      {
        field: "total_credit",
        label: "Total Credit",
        type: "currency",
      },
      {
        field: "closing",
        label: "Balance",
        type: "currency",

      },
    ],
    detailColumns: [
      {
        field: "vr_no",
        headerName: "VR #",
        width: 20,
      },
      {
        field: "acname",
        headerName: "Account",
        width: 100,
      },
      {
        field: "credit",
        headerName: "Credit Amount",
        width: 35,
        type: "currency",
      },
      {
        field: "debit",
        headerName: "Debit Amount",
        width: 35,
        type: "currency",
      },
      {
        field: "balance",
        headerName: "Balance",
        width: 40,
        type: "currency",
      },
    ],

    exportOptions: { pdf: true, excel: true, csv: false },
  },

  // Account Ledger, one row per voucher, with the items of every invoice /
  // return as columns (lib/reports/accountLedgerSummary.js). An invoice with
  // several items: the voucher row carries the first item and the amounts,
  // each further item is a row under it (item_line) — every row opens the
  // voucher.
  accountLedgerSummary: {
    rowGrouping: {
      by: "acno",
      labelFields: ["acno", "acname"],
      labelSeparator: " — ",
      activateWhen: { filter: "account", minSelected: 2 },
      subtotalLabel: "Account Total",
      showHeader: true,
    },
    showSummary: true,
    title: "Account Ledger Summary",
    description: "Account ledger, one row per voucher, with the items of each invoice and return",
    apiEndpoint: "/api/reports/accountLedgerSummary",
    filters: [
      {
        name: "dateFrom", label: "From Date", type: "date", required: true, default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      },
      { name: "dateTo", label: "To Date", type: "date", required: true, default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0), },
      {
        name: "account",
        label: "Account",
        type: "select",
        nameKeys: ["acno", "acname"],
        separator: " - ",
        valueKey: "acno",
        options: "accounts",
        apiEndpoint: "/api/accounts/acno",
        required: true,
        clearable: true,
        multiple: true,
      },
      // Same as the Account Ledger: Summary = one row per voucher, Detailed =
      // one row per voucher line (lib/reports/ledgerDetail.js).
      {
        name: "ledgerDetail",
        label: "Detail",
        type: "select",
        section: "display",
        options: [
          { value: "summary", label: "Summary — one row per voucher" },
          { value: "detailed", label: "Detailed — one row per voucher line" },
        ],
        default: { value: "summary", label: "Summary — one row per voucher" },
        clearable: false,
      },
    ],
    columns: [
      {
        field: "dated",
        headerName: "Date",
        width: 30,
        type: "date",
        valueGetter: (params) =>
          params.row.dated
            ? format(new Date(params.row.dated), "MMM dd, yyyy")
            : null,
      },
      { field: "vr_no", headerName: "VR #", width: 15 },
      { field: "slip_no", headerName: "Slip #", width: 15 },
      { field: "detail_invoice_no", headerName: "Invoice #", width: 20 },
      { field: "rmk5", headerName: "Tran #", width: 20 },
      {
        field: "acno", headerName: "Account No", width: 20
        , valueGetter: (params) => params.row.acno || ""
      },
      { field: "acname", headerName: "Account", width: 30 },
      { field: "against", headerName: "Against account", width: 35 },
      { field: "tran_type", headerName: "Type", width: 25 },
      { field: "narration", headerName: "Narration", width: 45 },
      // Invoice / return items
      { field: "item_code", headerName: "Code", width: 20 },
      { field: "item_name", headerName: "Item", width: 30 },
      { field: "item_rate", headerName: "Rate", width: 18, type: "number" },
      { field: "item_qty", headerName: "Qty", width: 18, type: "number", showTotal: true },
      { field: "item_unit", headerName: "Unit", width: 12 },
      { field: "item_st", headerName: "Item ST", width: 18, type: "currency", showTotal: true },
      { field: "item_amount", headerName: "Amount", width: 22, type: "currency", showTotal: true },
      { field: "user_name", headerName: "User", width: 20 },
      // The invoice's total sales tax, on its voucher row
      { field: "st_amount", headerName: "ST Amount", width: 25, type: "currency", showTotal: true },
      {
        field: "debit",
        headerName: "Debit",
        width: 40,
        type: "currency",
        fixed: true,
        showTotal: true,
      },
      {
        field: "credit",
        headerName: "Credit",
        width: 40,
        type: "currency",
        fixed: true,
        showTotal: true,
      },
      {
        field: "balance",
        headerName: "Balance",
        width: 40,
        type: "currency",
        fixed: true,
        showTotal: true,
        totalType: "last"
      },
    ],

    // Wide-report layout (rule 15). Each row opens its voucher (tran_id +
    // tran_code); 2+ accounts still group per account via rowGrouping above.
    layout: {
      pinned: ["dated", "vr_no"],
      groups: [
        { id: "doc", label: "Document", fields: ["slip_no", "detail_invoice_no", "rmk5", "tran_type", "narration", "user_name"] },
        { id: "acc", label: "Account", fields: ["acno", "acname", "against"] },
        { id: "items", label: "Items", fields: ["item_code", "item_name", "item_rate", "item_qty", "item_unit", "item_st", "item_amount"], foldTo: "item_amount" },
        { id: "amt", label: "Amounts", fields: ["st_amount", "debit", "credit", "balance"], foldTo: "balance" },
      ],
      views: [
        { id: "standard", label: "Standard", fields: ["dated", "vr_no", "detail_invoice_no", "rmk5", "acno", "acname", "tran_type", "narration", "item_code", "item_name", "item_rate", "item_qty", "item_unit", "item_st", "item_amount", "st_amount", "debit", "credit", "balance"] },
        { id: "all", label: "All columns" },
      ],
      card: {
        title: (r) => (r.item_line ? r.item_name : r.acname || r.tran_type || ""),
        subtitle: (r) =>
          r.item_line
            ? [r.item_code, r.item_qty != null && `${r.item_qty} ${r.item_unit || ""}`].filter(Boolean).join(" · ")
            : [r.vr_no && `VR ${r.vr_no}`, r.tran_type, r.detail_invoice_no && `INV ${r.detail_invoice_no}`, r.item_name, r.narration].filter(Boolean).join(" · "),
        figures: ["debit", "credit", "balance", "st_amount"],
      },
    },
    summaryFields: [
      { field: "total_debit", label: "Total Debit", type: "currency" },
      { field: "total_credit", label: "Total Credit", type: "currency" },
      { field: "closing", label: "Balance", type: "currency" },
    ],

    exportOptions: { pdf: true, excel: true, csv: false },
  },

  cbBook: {
    // Multi-account runs read as one block per account: a header row names the
    // account, the rows follow, then a subtotal row closes it. Turns on only
    // when 2+ accounts are selected. Handled generically by ReportViewer.
    rowGrouping: {
      by: "acno",
      labelFields: ["acno", "acname"],
      labelSeparator: " — ",
      activateWhen: { filter: "account", minSelected: 2 },
      subtotalLabel: "Account Total",
      showHeader: true,
    },
    showSummary: true,
    title: "Cash And Bank Books",
    description:
      "Detailed ledger entries for a specific account showing running balance",
    apiEndpoint: "/api/reports/accountLedger",
    filters: [
      {
        name: "dateFrom", label: "From Date", type: "date", required: true, default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      },
      { name: "dateTo", label: "To Date", type: "date", required: true, default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0), },
      {
        name: "account",
        label: "Account",
        type: "select",
        nameKeys: ["acno", "acname"],
        separator: " - ",
        valueKey: "acno",
        options: "accounts",
        apiEndpoint: `/api/accounts/acno?${CASH_BANK_GROUP_PARAM}`,
        required: true,
        clearable: true,
        multiple: true,
      },
      // Same option as the Account Ledger (lib/reports/ledgerDetail.js).
      {
        name: "ledgerDetail",
        label: "Detail",
        type: "select",
        section: "display",
        options: [
          { value: "summary", label: "Summary — one row per voucher" },
          { value: "detailed", label: "Detailed — one row per voucher line" },
        ],
        default: { value: "summary", label: "Summary — one row per voucher" },
        clearable: false,
      },
    ],
    columns: [
      {
        field: "dated",
        headerName: "Date",
        width: 30,
        type: "date",
        valueGetter: (params) =>
          params.row.dated
            ? format(new Date(params.row.dated), "MMM dd, yyyy")
            : null,
      },
      { field: "vr_no", headerName: "VR #", width: 15 },
      { field: "slip_no", headerName: "Slip #", width: 15 },
      { field: "detail_invoice_no", headerName: "Invoice #", width: 20 },
      {
        field: "acno", headerName: "Account No", width: 20
        , valueGetter: (params) => params.row.acno || ""
      },
      { field: "acname", headerName: "Account", width: 30 },
      { field: "against", headerName: "Against account", width: 35 },
      // { field: "narration", headerName: "Narration", width: 50 },
      { field: "tran_type", headerName: "Type", width: 25 },
      { field: "narration", headerName: "Narration", width: 45 },
      { field: "user_name", headerName: "User", width: 20 },
      {
        field: "debit",
        headerName: "Receipts",
        width: 40,
        type: "currency",
        fixed: true,
        showTotal: true,
      },
      {
        field: "credit",
        headerName: "Payments",
        width: 40,
        type: "currency",
        fixed: true,
        showTotal: true,
      },
      {
        field: "balance",
        headerName: "Balance",
        width: 40,
        type: "currency",
        fixed: true,
        showTotal: true,
        totalType: "last"
      },
    ],
    summaryFields: [
      {
        field: "total_debit",
        label: "Total Paymnets",
        type: "currency",
      },
      {
        field: "total_credit",
        label: "Total Receipts",
        type: "currency",
      },
      {
        field: "closing",
        label: "Balance",
        type: "currency",

      },
    ],
    detailColumns: [
      {
        field: "chno",
        headerName: "Cheque #",
        width: 20,
      },
      {
        field: "acname",
        headerName: "Account",
        width: 100,
      },
      {
        field: "credit",
        headerName: "Credit Amount",
        width: 35,
        type: "currency",
      },
      {
        field: "debit",
        headerName: "Debit Amount",
        width: 35,
        type: "currency",
      },
      {
        field: "balance",
        headerName: "Balance",
        width: 40,
        type: "currency",
      },
    ],

    exportOptions: { pdf: true, excel: true, csv: false },
  },

  accountsActivity: {
    title: "Accounts Activity Report",
    description:
      "Summarized activity for all accounts showing opening, transactions, and closing",
    apiEndpoint: "/api/reports/accountsActivity",
    filters: [
      { name: "dateFrom", label: "From Date", type: "date", required: true, default: new Date(new Date().getFullYear(), new Date().getMonth(), 1), },
      { name: "dateTo", label: "To Date", type: "date", required: true, default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0), },
      {
        name: "macno",
        label: "Main Account",
        type: "select",
        nameKeys: ["macno", "macname"],
        separator: " - ",
        valueKey: "macno",
        options: "macnos",
        apiEndpoint: "/api/accounts/macno",
        clearable: true,
      },
      {
        name: "compareMonths",
        label: "Compare Months",
        type: "select",
        multiple: true,
        options: generateCompareMonthOptions(),
        valueKey: "value",
        nameKey: "label",
        clearable: true,
        placeholder: "Select months to compare",
      },
    ],
    columns: [
      { field: "ac_no", headerName: "Account No", width: 20, valueGetter: (params) => params.row.acno || "" },
      { field: "account", headerName: "Account", width: 115 },
      { field: "macno", headerName: "M Account No", width: 20 },
      {
        field: "opening_balance",
        headerName: "Opening Balance",
        width: 40,
        type: "currency",
      },
      { field: "debit", headerName: "Debit", width: 40, type: "currency" },
      { field: "credit", headerName: "Credit", width: 40, type: "currency" },
      {
        field: "closing_balance",
        headerName: "Closing Balance",
        width: 40,
        type: "currency",
      },
    ],

    summaryFields: [
      {
        field: "total_accounts",
        label: "Total Accounts",
        type: "text",
      },
      {
        field: "total_debit",
        label: "Total Debit",
        type: "currency",
      },
      {
        field: "total_credit",
        label: "Total Credit",
        type: "currency",
      },
    ],
    drillDown: {
      enabled: true,
      label: "View Ledger",
      modalTitle: "View Account Ledger Details",
      // fields: [
      //   {
      //     name: "dateTo",
      //     label: "To Date",
      //     type: "date",
      //     required: true,
      //   },
      // ],
      linkBuilder: (row, filters) =>
        `/accounting/reports/accountLedger?account=${row.acno
        }&dateFrom=${filters.dateFrom
          ? new Date(filters.dateFrom).toISOString()
          : new Date().toISOString()
        }&dateTo=${filters.dateTo
          ? new Date(filters.dateTo).toISOString()
          : new Date().toISOString()
        }`,
    },
    exportOptions: { pdf: true, excel: true, csv: false },
  },

  trialBalance: {
    title: "Trial Balance",
    description:
      "A summary of all ledger accounts with debit and credit totals to verify ledger integrity. Leave 'From Date' empty for a cumulative as-of balance, or set it to get opening + period movement + closing.",
    apiEndpoint: "/api/reports/trialBalance",
    filters: [
      // Optional. Empty → cumulative "as of" balance (legacy behaviour).
      // Set → opening balance before this date + movement inside the range.
      { name: "dateFrom", label: "From Date", type: "date", clearable: true },
      { name: "dateTo", label: "To Date (As of)", type: "date", required: true, default: new Date(), },
      {
        name: "macno",
        label: "Main Account",
        type: "select",
        nameKeys: ["macno", "macname"],
        separator: " - ",
        valueKey: "macno",
        options: "macnos",
        apiEndpoint: "/api/accounts/macno",
        clearable: true,
        multiple: true,
      },
      {
        name: "acno",
        label: "Account",
        type: "select",
        nameKeys: ["acno", "acname"],
        separator: " - ",
        valueKey: "acno",
        options: "accounts",
        // Narrows to the selected main account(s) when one is picked.
        apiEndpoint: "/api/accounts/acno?macno={{macno=all→|macno}}",
        clearable: true,
        multiple: true,
      },
      {
        // Only the voucher types that actually post Dr/Cr are offered — 7
        // (material issue), 8 (production) and 11 (transfer) move stock only
        // and would come back as all-zero rows. Narrowing this makes the
        // report one-sided, so Difference is expected to be non-zero.
        name: "tran_code",
        label: "Voucher Type",
        type: "select",
        options: [
          { label: "1 - Receipt", value: "1" },
          { label: "2 - Payment", value: "2" },
          { label: "3 - Journal / Adjustment", value: "3" },
          { label: "4 - Purchase Invoice (GRN)", value: "4" },
          { label: "5 - POS", value: "5" },
          { label: "6 - Sale Invoice", value: "6" },
          { label: "9 - Purchase Return", value: "9" },
          { label: "10 - Sale Return", value: "10" },
          { label: "12 - Miscellaneous IN", value: "12" },
          { label: "21 - Service Invoice", value: "21" },
        ],
        clearable: true,
        multiple: true,
      },
    ],
    columns: [
      { field: "macno", headerName: "M Account No", width: 30 },
      {
        field: "macaccount",
        headerName: "M Account",
        width: 62,
      },
      { field: "acno", headerName: "Account No", width: 25 },
      {
        field: "account",
        headerName: "Account",
        width: 62,
      },
      {
        field: "debit",
        headerName: "Debit",
        width: 30,
        type: "currency",
        fixed: true,
      },
      {
        field: "credit",
        headerName: "Credit",
        width: 30,
        type: "currency",
        fixed: true,
      },
      {
        field: "balance",
        headerName: "Balance",
        width: 30,
        type: "currency",
        fixed: true,
      },
    ],

    // With a From Date the report becomes Opening + period Debit/Credit +
    // Closing; without one it stays the cumulative as-of balance.
    getColumns: (filters) => {
      const base = [
        { field: "macno", headerName: "M Account No", width: 30 },
        { field: "macaccount", headerName: "M Account", width: 62 },
        { field: "acno", headerName: "Account No", width: 25 },
        { field: "account", headerName: "Account", width: 62 },
      ];

      const hasRange = !!filters?.dateFrom;

      if (hasRange) {
        base.push({
          field: "opening",
          headerName: "Opening",
          width: 30,
          type: "currency",
          fixed: true,
        });
      }

      base.push(
        {
          field: "debit",
          headerName: "Debit",
          width: 30,
          type: "currency",
          fixed: true,
        },
        {
          field: "credit",
          headerName: "Credit",
          width: 30,
          type: "currency",
          fixed: true,
        },
        {
          field: "balance",
          headerName: hasRange ? "Closing" : "Balance",
          width: 30,
          type: "currency",
          fixed: true,
        },
      );

      return base;
    },

    summaryFields: [
      {
        field: "total_debit",
        label: "Total Debit",
        type: "currency",
      },
      {
        field: "total_credit",
        label: "Total Credit",
        type: "currency",
      },
      {
        field: "diff",
        label: "Difference",
        type: "currency",
      },
    ],
    drillDown: {
      enabled: true,
      label: "View Ledger",
      modalTitle: "View Account Ledger Details",
      linkBuilder: (row, filters) => {
        // ReportViewer stores filter dates as DD-MM-YYYY.
        const parseFilterDate = (val) => {
          if (!val) return null;
          if (val instanceof Date) return isNaN(val) ? null : val;
          if (/^\d{2}-\d{2}-\d{4}$/.test(val)) {
            const [dd, mm, yyyy] = String(val).split("-");
            return new Date(Number(yyyy), Number(mm) - 1, Number(dd));
          }
          const d = new Date(val);
          return isNaN(d) ? null : d;
        };

        const from = parseFilterDate(filters?.dateFrom);
        const to = parseFilterDate(filters?.dateTo) || new Date();

        return `/accounting/reports/accountLedger?account=${row.acno}&dateFrom=${from ? from.toISOString() : "2000-01-01T11:00:00.000Z"
          }&dateTo=${to.toISOString()}`;
      },
    },
    exportOptions: { pdf: true, excel: true, csv: false },
  },
  // --------------------
  trialBalancePeriod: {
    title: "Trial Balance Period Report",
    description: "A summary of Level 4 ledger accounts with debit and credit totals to verify ledger integrity ",
    apiEndpoint: "/api/reports/trialBalancePeriod",
    filters: [
      { name: "dateFrom", type: "date", label: "From Date", required: true, default: new Date(new Date().getFullYear(), new Date().getMonth(), 1), },
      { name: "dateTo", type: "date", label: "To Date", required: true, default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0), },
      //   {
      //   name: "view",
      //   label: "View",
      //   type: "select",
      //   options: [
      //     { value: "detailView", label: "Detail View" },
      //     { value: "summaryView", label: "Summary View" },
      //   ],
      //   default: { value: "detailView", label: "Detail View" },
      //   clearable: false,
      // },
    ],
    columns: [
      { field: "mbscd", headerName: "MBSCD No", width: 25 },
      { field: "mbscdName", headerName: "MBSCD", width: 35 },
      { field: "bscd", headerName: "BSCD No", width: 25 },
      { field: "bscdName", headerName: "BSCD", width: 35 },
      { field: "macno", headerName: "M Account No", width: 25 },
      {
        field: "macaccount",
        headerName: "M Account",
        width: 40,
      },
      { field: "acno", headerName: "Account No", width: 25 },
      {
        field: "account",
        headerName: "Account",
        width: 35,
      },

      { field: "dr_movement", showTotal: true, headerName: "Period Debit", width: 25, type: "currency" },
      { field: "cr_movement", showTotal: true, headerName: "Period Credit", width: 25, type: "currency" },
      { field: "debit", showTotal: true, headerName: "Debit Balance", width: 25, type: "currency" },
      { field: "credit", showTotal: true, headerName: "Credit Balance", width: 25, type: "currency" },
      {
        field: "balance", showTotal: true,
        headerName: "Balance",
        width: 30,
        type: "currency",
        fixed: true,
      },

    ],

    // Wide-report layout (rule 15): account tree as group rows + "Tree" view.
    layout: accountTreePeriodLayout,
    // Account row → its ledger for the same period.
    drill: [
      {
        label: "Open account ledger",
        when: (row) => !!row.acno,
        href: (row, filters) => accountLedgerHref({ account: row.acno, dateFrom: filters.dateFrom, dateTo: filters.dateTo }),
      },
    ],
    // No groupedDetailView: rows are flat accounts and the wide layout above
    // draws the tree, its subtotals and the exports (CLAUDE.md rule 15).
    summaryFields: [
      {
        field: "total_debit",
        label: "Total Debit",
        type: "currency",
      },
      {
        field: "total_credit",
        label: "Total Credit",
        type: "currency",
      },
      {
        field: "diff",
        label: "Difference",
        type: "currency",
        valueGetter: (data) => (data.total_debit || 0) - (data.total_credit || 0),
      },
    ],
    exportOptions: { pdf: true, excel: true, csv: true },
  },


  trialBalanceSheet: {
    title: "Trial Balance Sheet Report",
    description: "A summary of Level 3 ledger accounts with debit and credit totals to verify ledger integrity ",
    apiEndpoint: "/api/reports/trialBalanceSheet",
    filters: [
      { name: "dateTo", label: "As of Date", type: "date", required: true, default: new Date(), },
      //   {
      //   name: "view",
      //   label: "View",
      //   type: "select",
      //   options: [
      //     { value: "detailView", label: "Detail View" },
      //     { value: "summaryView", label: "Summary View" },
      //   ],
      //   default: { value: "detailView", label: "Detail View" },
      //   clearable: false,
      // },
    ],
    columns: [
      { field: "mbscd", headerName: "MBSCD No", width: 25 },
      { field: "mbscdName", headerName: "MBSCD", width: 35 },
      { field: "bscd", headerName: "BSCD No", width: 25 },
      { field: "bscdName", headerName: "BSCD", width: 35 },
      { field: "macno", headerName: "M Account No", width: 25 },
      {
        field: "macaccount",
        headerName: "M Account",
        width: 40,
      },
      { field: "acno", headerName: "Account No", width: 25 },
      {
        field: "account",
        headerName: "Account",
        width: 35,
      },

      { field: "dr_movement", showTotal: true, headerName: "Total Debit", width: 25, type: "currency" },
      { field: "cr_movement", showTotal: true, headerName: "Total Credit", width: 25, type: "currency" },
      { field: "debit", showTotal: true, headerName: "Debit Balance", width: 25, type: "currency" },
      { field: "credit", showTotal: true, headerName: "Credit Balance", width: 25, type: "currency" },
      {
        field: "balance", showTotal: true,
        headerName: "Balance",
        width: 30,
        type: "currency",
        fixed: true,
      },

    ],

    // Wide-report layout (rule 15): account tree as group rows + "Tree" view.
    layout: accountTreeLayout,
    // Account row → its ledger for the month of "As Of" (opening carries the rest).
    drill: [
      {
        label: "Open account ledger",
        when: (row) => !!row.acno,
        href: (row, filters) => accountLedgerHref({ account: row.acno, dateFrom: monthStartOfDMY(filters.dateTo), dateTo: filters.dateTo }),
      },
    ],
    // No groupedDetailView: rows are flat accounts and the wide layout above
    // draws the tree, its subtotals and the exports (CLAUDE.md rule 15).
    summaryFields: [
      {
        field: "total_debit",
        label: "Total Debit",
        type: "currency",
      },
      {
        field: "total_credit",
        label: "Total Credit",
        type: "currency",
      },
      {
        field: "diff",
        label: "Difference",
        type: "currency",
        valueGetter: (data) => (data.total_debit || 0) - (data.total_credit || 0),

      },
    ],
    exportOptions: { pdf: true, excel: true, csv: true },
  },

  profitLoss: {
    title: "Profit and Loss Report",
    description: "A summary of 2 ledger accounts with profiit and loss to verify ledger integrity ",
    apiEndpoint: "/api/reports/profitLoss",
    filters: [
      { name: "dateFrom", type: "date", label: "From Date", required: true, default: new Date(new Date().getFullYear(), new Date().getMonth(), 1), },
      { name: "dateTo", type: "date", label: "To Date", required: true, default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0), },
      //   {
      //   name: "view",
      //   label: "View",
      //   type: "select",
      //   options: [
      //     { value: "detailView", label: "Detail View" },
      //     { value: "summaryView", label: "Summary View" },
      //   ],
      //   default: { value: "detailView", label: "Detail View" },
      //   clearable: false,
      // },
    ],
    columns: [
      { field: "mbscd", headerName: "MBSCD No", width: 25 },
      { field: "mbscdName", headerName: "MBSCD", width: 35 },
      { field: "bscd", headerName: "BSCD No", width: 25 },
      { field: "bscdName", headerName: "BSCD", width: 35 },
      { field: "macno", headerName: "M Account No", width: 25 },
      {
        field: "macaccount",
        headerName: "M Account",
        width: 40,
      },
      { field: "acno", headerName: "Account No", width: 25 },
      {
        field: "account",
        headerName: "Account",
        width: 35,
      },

      { field: "dr_movement", showTotal: true, headerName: "Period Debit", width: 25, type: "currency" },
      { field: "cr_movement", showTotal: true, headerName: "Period Credit", width: 25, type: "currency" },
      { field: "debit", showTotal: true, headerName: "Debit Balance", width: 25, type: "currency" },
      { field: "credit", showTotal: true, headerName: "Credit Balance", width: 25, type: "currency" },
      {
        field: "balance", showTotal: true,
        headerName: "Balance",
        width: 30,
        type: "currency",
        fixed: true,
      },

    ],

    // Wide-report layout (rule 15): account tree as group rows + "Tree" view.
    layout: accountTreeLayout,
    drill: [
      {
        label: "Open account ledger",
        when: (row) => !!row.acno,
        href: (row, filters) => accountLedgerHref({ account: row.acno, dateFrom: filters.dateFrom, dateTo: filters.dateTo }),
      },
    ],
    // No groupedDetailView: rows are flat accounts and the wide layout above
    // draws the tree, its subtotals and the exports (CLAUDE.md rule 15).
    summaryFields: [
      {
        field: "total_debit",
        label: "Total Debit",
        type: "currency",
      },
      {
        field: "total_credit",
        label: "Total Credit",
        type: "currency",
      },
      {
        field: "diff",
        label: "Difference",
        type: "currency",
        valueGetter: (data) => (data.total_debit || 0) - (data.total_credit || 0),
      },
    ],
    exportOptions: { pdf: true, excel: true, csv: true },
  },

  // config.js
  stockMetrics: {
    title: "Stock Metrics by Godown",
    description: "Detailed view of stock quantities across all godowns",
    apiEndpoint: "/api/reports/stockMetrics",
    filters: [
      {
        name: "category",
        label: "Category",
        nameKey: "ic_name",
        type: "select",
        options: "itemCategories",
        apiEndpoint: "/api/setup/item_categories",
        clearable: true,
      },
      {
        name: "godown",
        nameKey: "godown",
        label: "Warehouse",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns?includeInactive=true",
        clearable: true,
      },
      {
        name: "item",
        label: "Item",
        type: "select",
        options: "products",
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["code","item"],
        separator: " - ",
        clearable: true,
      },
      {
        // Ink Series = Item.mc_id (Main Category)
        name: "inkSeries",
        label: "Ink Series",
        type: "select",
        options: "main_categories",
        default: { value: "", label: "All Ink Series" },
        apiEndpoint: "/api/setup/main_categories",
        valueKey: "id",
        nameKeys: ["mc_name"],
        clearable: true,
        multiple: true,
      },
      {
        name: "showZero",
        label: "Show Zero Stock",
        type: "checkbox",
        default: false,
      },
    ],
    columns: [
      {
        field: "ink_series",
        headerName: "Ink Series",
        width: 60,
        valueGetter: (params) => params.row.ink_series || "",
      },
      { field: "code", headerName: "Code", width: 30 },
      { field: "item", headerName: "Item Name", width: 80 },
      { field: "sku", headerName: "SKU", width: 30 },
      // {
      //   field: "category",
      //   headerName: "Category",
      //   width: 60,
      //   valueGetter: (params) => params.row.itemCategories?.ic_name || "",
      // },
      {
        field: "totalstock",
        headerName: "Total Stock",
        width: 40,
        type: "number",
        valueGetter: (params) => params.row.totalstock || 0,
      },
    ],
    dynamicColumns: true, // Flag to indicate we'll generate columns dynamically

    summaryFields: [
      { field: "total_items", label: "Total Items", type: "number" },
      { field: "total_stock", label: "Total Current Stock", type: "number" },
    ],
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },

  // orderBalance: {
  //   title: "Order Balance Report",
  //   apiEndpoint: "/api/reports/orderBalance",
  //   description:
  //     "Shows the balance between ordered and received/delivered quantities",

  //   filters: [
  //     {
  //       name: "dateFrom",
  //       type: "date",
  //       label: "From Date",
  //       default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  //       required: true,
  //     },
  //     {
  //       name: "dateTo",
  //       type: "date",
  //       label: "To Date",
  //       default: new Date(),
  //       required: true,
  //     },
  //     {
  //       name: "orderType",
  //       type: "select",
  //       label: "Order Type",
  //       options: [
  //         // { value: "all", label: "All" },
  //         { value: "4", label: "Purchase Order" },
  //         { value: "6", label: "Sales Order" },
  //       ],
  //       default: { value: "6", label: "Sales Order" },
  //       clearable: true,
  //       // ✅ This will auto-clear dependent filters (configures in ReportViewer)
  //     },
  //     {
  //       name: "customer",
  //       // ✅ Dynamic label based on orderType
  //       label: (filters) => dynamicLabels.accountLabel(filters?.orderType),
  //       type: "select",
  //       nameKey: "acname",
  //       valueKey: "acno",
  //       options: "accounts",
  //       // ✅ Template-based dynamic endpoint
  //       apiEndpoint: template.conditional("orderType", {
  //         4: `/api/accounts/acno?${VENDOR_GROUP_PARAM}`, // PO → Vendors
  //         6: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`, // SO → Customers
  //         // all: "/api/accounts/acno?group=customers,vendors", // All → Both/
  //         default: `/api/accounts/acno?${PARTY_GROUP_PARAM}`,
  //       }),
  //       clearable: true,
  //       // ✅ Dynamic placeholder
  //       placeholder: (filters) =>
  //         dynamicLabels.accountPlaceholder(filters?.orderType),
  //       dependsOn: "orderType", // ✅ Declare dependency
  //       clearOnDependencyChange: true, // ✅ Auto-clear when orderType changes
  //     },
  //     {
  //       name: "item",
  //       label: "Item",
  //       type: "select",
  //       options: "products",
  //       apiEndpoint: "/api/setup/items",
  //       valueKey: "itcd",
  //       nameKey: "item",
  //       clearable: true,
  //     },
  //     {
  //       name: "region",
  //       label: "Region",
  //       type: "select",
  //       options: [
  //         { value: "NORTH", label: "NORTH" },
  //         { value: "SOUTH", label: "SOUTH" },
  //       ],
  //       clearable: true,
  //       defaultValue: { value: 1, label: "NORTH" },
  //     },
  //   ],

  //   // ✅ Dynamic columns based on filters
  //   getColumns: (filters) => {
  //     const orderType = filters?.orderType;
  //     const accountHeader =
  //       orderType === "4"
  //         ? "VENDOR"
  //         : orderType === "6"
  //           ? "CUSTOMER"
  //           : "Account";

  //     const totalHeader =
  //       orderType === "4" ? "RECEIVED" : orderType === "6" ? "SHIP" : "Total";

  //     return [
  //       { field: "customer", headerName: accountHeader, width: 60 },
  //       { field: "orderNo", headerName: "ISO", width: 10 },
  //       {
  //         field: "orderDate",
  //         headerName: "DATE",
  //         width: 20,
  //         valueGetter: (params) =>
  //           new Date(params.row.orderDate).toLocaleDateString(),
  //       },
  //       {
  //         field: "sale_po",
  //         headerName: "P.O NUMBER",
  //         width: 20,
  //       },
  //       {
  //         field: "itemCode",
  //         headerName: "MM#",
  //         width: 25,
  //       },
  //       {
  //         field: "itemName",
  //         headerName: "ITEM",
  //         width: 85,
  //       },
  //       { field: "orderedQty", headerName: "QTY", width: 20 },
  //       { field: "purchasedQty", headerName: totalHeader, width: 20 },
  //       { field: "pendingQty", headerName: "BAL", width: 20 },
  //     ];
  //   },

  //   summaryFields: [
  //     { field: "totalPurchased", label: "Total Purchased", type: "number" },
  //     {
  //       field: "totalNetReceived",
  //       label: "Total Net Received",
  //       type: "number",
  //     },
  //   ],

  //   exportOptions: {
  //     pdf: true,
  //     excel: true,
  //   },
  // },
  salesOrderBalance: {
    title: "SalesOrder Balance Report",
    apiEndpoint: "/api/reports/salesOrderBalance",
    description:
      "Shows the balance between ordered and received/delivered quantities",

    filters: [
      {
        name: "dateFrom",
        type: "date",
        label: "From Date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        required: true,
      },
      {
        name: "dateTo",
        type: "date",
        label: "To Date",
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        required: true,
      },
      {
        name: "orderType",
        type: "select",
        label: "Order Type",
        options: [
          // { value: "all", label: "All" },
          // { value: "4", label: "Purchase Order" },
          { value: "6", label: "Sales Order" },
        ],
        default: { value: "6", label: "Sales Order" },
        clearable: true,
        // ✅ This will auto-clear dependent filters (configures in ReportViewer)
      },
      {
        name: "customer",
        // ✅ Dynamic label based on orderType
        label: "CUSTOMER",
        type: "select",
        nameKeys: ["acno", "acname"],
        separator: " - ",
        valueKey: "acno",
        options: "accounts",
        // ✅ Template-based dynamic endpoint
        apiEndpoint: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`,
        clearable: true,
        // ✅ Dynamic placeholder
        placeholder: "CUSTOMER",
      },
      {
        name: "item",
        label: "Item",
        type: "select",
        options: "products",
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["code", "item"],
        separator: " - ",
        clearable: true,
      },
      {
        // Ink Series = Item.mc_id (getOrderBalanceReport)
        name: "inkSeries",
        label: "Ink Series",
        type: "select",
        options: "main_categories",
        default: { value: "", label: "All Ink Series" },
        apiEndpoint: "/api/setup/main_categories",
        valueKey: "id",
        nameKeys: ["mc_name"],
        clearable: true,
        multiple: true,
      },
      // {
      //   name: "region",
      //   label: "Region",
      //   type: "select",
      //   options: [
      //     { value: "NORTH", label: "NORTH" },
      //     { value: "SOUTH", label: "SOUTH" },
      //   ],
      //   clearable: true,
      //   defaultValue: { value: 1, label: "NORTH" },
      // },
      {
        name: "orderNo",
        label: "ISO",
        type: "select",
        options: "orders",
        apiEndpoint: "/api/orders/saleOrder?limit=1000",
        valueKey: "order_no",
        nameKey: "order_no",
        default: { value: "", label: "All ISO" },
        clearable: true,
        // placeholder removed to rely on default
      },
      {
        name: "view",
        label: "View",
        type: "select",
        options: [
          { value: "standard", label: "Standard View" },
          { value: "customer", label: "Customer Wise View" },
          { value: "datewise", label: "Date Wise View" },
          { value: "groupDetail", label: "Group Detail (Sale Order)" },
          { value: "groupSalesPerson", label: "Group Detail (Sales Person)" },
        ],
        default: { value: "datewise", label: "Date Wise View" },
        clearable: false,
      },
      // {
      //   name: "city",
      //   label: "City",
      //   type: "select",
      //   options: "cities",
      //   apiEndpoint: `/api/accounts/cities?${CUSTOMER_GROUP_PARAM}`,
      //   valueKey: "city",
      //   nameKey: "city",
      //   default: { value: "", label: "All Cities" },
      //   clearable: true,
      // },
      {
        name: "sale_person",
        label: "Sales Person",
        type: "select",
        options: "salesPersons",
        // apiEndpoint: "/api/accounts/customer-sales-persons",
        // scope=own: a sales person is offered only themselves
        apiEndpoint: "/api/accounts/customer-sales-persons?scope=own",
        valueKey: "id",
        nameKey: "name",
        default: { value: "", label: "All Sales Persons" },
        multiple: true,
        clearable: true,
      },
      {
        name: "showCustomerTotal",
        label: "Show Customer Total",
        type: "checkbox",
        default: false,
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "", label: "All Status" },
          { value: "pending", label: "Pending" },
          { value: "complete", label: "Complete" },
        ],
        default: { value: "pending", label: "Pending" },
        clearable: false,
      },
      {
      
        name: "balanceLessThan",
        label: "Balance Less Than",
        type: "text",
        placeholder: "e.g. -5",
      },
      {
    
        name: "balanceGreaterThan",
        label: "Balance Greater Than",
        type: "text",
        placeholder: "e.g. 0",
      },
    ],

    groupBy: "orderNo",
    layout: "nested",

    // Group Detail views — one block per sale order (its item lines, an "SO
    // total"), optionally under a sales-person group. Rows come tagged with
    // row_type from buildOrderBalanceGroupedRows() in
    // app/api/reports/[reportType]/route.js (unchanged); the wide engine reads
    // them through wideLayout.groupRows. The SO has no header row — the order
    // level opens on the line's _orderNo, and the SO columns (on the first line
    // only) are copied to the order's other lines. so_total / sales_person_total
    // are plain sums of the lines, so they are dropped and recomputed.
    getColumns: (filters) =>
      ORDER_BALANCE_GROUPED_VIEWS.includes(filterValue(filters?.view)) ? ORDER_BALANCE_GROUPED_COLUMNS : REPORT_CONFIG.salesOrderBalance.columns,

    // ✅ Dynamic columns based on filters
    columns: [
      { field: "customer", headerName: "CUSTOMER", width: 60 },
      { field: "orderNo", headerName: "ISO", width: 25 },
      {
        field: "orderDate",
        headerName: "DATE",
        width: 20,
        valueGetter: (params) =>
          new Date(params.row.orderDate).toLocaleDateString(),
      },
      {
        field: "sale_po",
        headerName: "PO NO.",
        width: 20,
      },
      // {
      //   field: "itemCode",
      //   headerName: "MM",
      //   width: 20,
      //   valueGetter: (params) => params.row.transactions?.[0]?.itemCode || "",
      // },
      {
        field: "code",
        headerName: "ITEM",
        width: 20,
        valueGetter: (params) =>
          params.row.transactions?.[0]
            ? `${params.row.transactions[0].code}  ${params.row.transactions[0].itemName}`
            : "",
      },
      {
        field: "inkSeries",
        headerName: "INK SERIES",
        width: 25,
        valueGetter: (params) => params.row.transactions?.[0]?.inkSeries || "",
      },
      { field: "unit", headerName: "UNIT", width: 12 },
      {
        field: "totalOrdered",
        headerName: "QTY (KG)",
        width: 20,
        type: "number",
        showTotal: true
      },
      {
        field: "totalShip", showTotal: true,
        headerName: "SHIP (KG)",
        width: 20,
        type: "number",
      },
      {
        field: "totalPending", showTotal: true,
        headerName: "BAL (KG)",
        width: 20,
        type: "number",
      },
      // % shipped over the ordered KG (e.g. 20 ordered, 30 shipped = 50%)
      {
        field: "varianceKg",
        headerName: "VAR (KG) %",
        width: 20,
        valueGetter: (params) => overShipPct(params.row.totalOrdered, params.row.totalShip),
      },
      // Litres — only on lines ordered in LTR, blank on KG lines
      {
        field: "totalOrderedLtr",
        headerName: "QTY (LTR)",
        width: 20,
        valueGetter: (params) => params.row.totalOrderedLtr ?? "",
      },
      {
        field: "totalShipLtr",
        headerName: "SHIP (LTR)",
        width: 20,
        valueGetter: (params) => params.row.totalShipLtr ?? "",
      },
      {
        field: "totalPendingLtr",
        headerName: "BAL (LTR)",
        width: 20,
        valueGetter: (params) => params.row.totalPendingLtr ?? "",
      },
      // % shipped over the ordered litres (e.g. 20 ordered, 30 shipped = 50%)
      {
        field: "varianceLtr",
        headerName: "VAR (LTR) %",
        width: 20,
        valueGetter: (params) => overShipPct(params.row.totalOrderedLtr, params.row.totalShipLtr),
      },
    ],


    // Wide-report layout (rule 15). `layout` is still "nested" (the classic
    // customer-block export), so this sits in wideLayout — resolveLayout()
    // (components/Reports/layout.js) has to read config.wideLayout ?? config.layout.
    wideLayout: (filters) => ORDER_BALANCE_GROUPED_VIEWS.includes(filterValue(filters?.view)) ? orderBalanceGroupedLayout(filters) : ({
      pinned: ["orderNo", "orderDate"],
      groups: [
        { id: "order", label: "Order", fields: ["customer", "sale_po"] },
        { id: "item", label: "Item", fields: ["code", "inkSeries", "unit"] },
        { id: "kg", label: "KG", fields: ["totalOrdered", "totalShip", "totalPending", "varianceKg"], foldTo: "totalPending" },
        { id: "ltr", label: "Litre", fields: ["totalOrderedLtr", "totalShipLtr", "totalPendingLtr", "varianceLtr"], foldTo: "totalPendingLtr" },
      ],
      unitSwitch: {
        label: "Unit",
        options: [
          { id: "kg", label: "KG", fields: ["totalOrdered", "totalShip", "totalPending", "varianceKg"] },
          { id: "ltr", label: "LTR", fields: ["totalOrderedLtr", "totalShipLtr", "totalPendingLtr", "varianceLtr"] },
        ],
        default: "kg",
      },
      rowGroupBy: filterValue(filters?.view) === "customer" ? [{ field: "customer", subtotalLabel: "Total" }] : [],
      card: {
        title: "customer",
        subtitle: (r) => [r.orderNo && `ISO ${r.orderNo}`, r.sale_po && `PO ${r.sale_po}`].filter(Boolean).join(" · "),
        figures: ["totalOrdered", "totalShip", "totalPending"],
      },
      // Each row is a sale order (OrderMaster): open it read-only.
      voucher: (row) => (row.orderNo ? { tran_code: 600, tran_id: row.orderNo, order_no: row.orderNo } : null),
    }),
    detailColumns: [
      // {
      //   field: "itemCode",
      //   headerName: "MM#",
      //   width: 25,
      // },
      // { field: "customer", headerName: "CUSTOMER", width: 50 },
      { field: "orderNo", headerName: "ISO", width: 25 },
      {
        field: "code",
        headerName: "INK CODE",
        width: 30,
      },
      {
        field: "itemName",
        headerName: "ITEM",
        width: 110,
      },
      { field: "inkSeries", headerName: "INK SERIES", width: 40 },
      { field: "unit", headerName: "UNIT", width: 12 },
      { field: "orderedQty", headerName: "QTY (KG)", width: 20, type: "number" },
      { field: "shipQty", headerName: "SHIP (KG)", width: 20, type: "number" },
      { field: "pendingQty", headerName: "BAL (KG)", width: 20, type: "number" },
      { field: "varianceKg", headerName: "VAR (KG) %", width: 20, valueGetter: (params) => overShipPct(params.row.orderedQty, params.row.shipQty) },
      { field: "orderedQtyLtr", headerName: "QTY (LTR)", width: 20, valueGetter: (params) => params.row.orderedQtyLtr ?? "" },
      { field: "shipQtyLtr", headerName: "SHIP (LTR)", width: 20, valueGetter: (params) => params.row.shipQtyLtr ?? "" },
      { field: "pendingQtyLtr", headerName: "BAL (LTR)", width: 20, valueGetter: (params) => params.row.pendingQtyLtr ?? "" },
      { field: "varianceLtr", headerName: "VAR (LTR) %", width: 20, valueGetter: (params) => overShipPct(params.row.orderedQtyLtr, params.row.shipQtyLtr) },
    ],

    summaryFields: [
      { field: "totalOrdered", label: "Total Sales", type: "number" },
      {
        field: "totalShip",
        label: "Total Shipped",
        type: "number",
      },
      {
        field: "totalPending",
        label: "Total Pending",
        type: "number",
      },
      { field: "totalOrderedLtr", label: "Total Sales (LTR)", type: "number" },
      { field: "totalShipLtr", label: "Total Shipped (LTR)", type: "number" },
      { field: "totalPendingLtr", label: "Total Pending (LTR)", type: "number" },
    ],

    exportOptions: {
      pdf: true,
      excel: true,
    },
  },
  purchaseOrderBalance: {
    title: "Purchase Order Balance Report",
    apiEndpoint: "/api/reports/purchaseOrderBalance",
    description:
      "Shows the balance between ordered and received/delivered quantities",

    filters: [
      {
        name: "dateFrom",
        type: "date",
        label: "From Date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        required: true,
      },
      {
        name: "dateTo",
        type: "date",
        label: "To Date",
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        required: true,
      },
      {
        name: "orderType",
        type: "select",
        label: "Order Type",
        options: [
          // { value: "all", label: "All" },
          { value: "4", label: "Purchase Order" },
          // { value: "6", label: "Sales Order" },
        ],
        //default: { value: "4", label: "Purchase Order" },
        clearable: true,
        // ✅ This will auto-clear dependent filters (configures in ReportViewer)
      },
      {
        name: "customer",
        // ✅ Dynamic label based on orderType
        label: (filters) => dynamicLabels.accountLabel(filters?.orderType),
        type: "select",
        //nameKey: "acname",
        nameKeys: ["acno", "acname"],
        separator: " - ",
        valueKey: "acno",
        options: "accounts",
        // ✅ Template-based dynamic endpoint
        apiEndpoint: `/api/accounts/acno?${VENDOR_GROUP_PARAM}`,
        // apiEndpoint: template.conditional("orderType", {
        //   4: `/api/accounts/acno?${VENDOR_GROUP_PARAM}`, // PO → Vendors
        //  // 6: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`, // SO → Customers
        //   // all: "/api/accounts/acno?group=customers,vendors", // All → Both/
        //   default: `/api/accounts/acno?${PARTY_GROUP_PARAM}`,
        // }),
        clearable: true,
        // ✅ Dynamic placeholder
        placeholder: (filters) =>
          dynamicLabels.accountPlaceholder(filters?.orderType),
        dependsOn: "orderType", // ✅ Declare dependency
        clearOnDependencyChange: true, // ✅ Auto-clear when orderType changes
      },
      {
        name: "item",
        label: "Item",
        type: "select",
        options: "products",
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["itcd", "item", "code"],
        separator: " - ",
        clearable: true,
      },
      // {
      //   name: "region",
      //   label: "Region",
      //   type: "select",
      //   options: [
      //     { value: "NORTH", label: "NORTH" },
      //     { value: "SOUTH", label: "SOUTH" },
      //   ],
      //   clearable: true,
      //   defaultValue: { value: 1, label: "NORTH" },
      // },
    ],
    columns: [
      { field: "customer", headerName: "VENDOR", width: 60 },
      { field: "ac_no", headerName: "Account no", width: 20, valueGetter: (params) => params.row.acno?.acno || "" },
      { field: "orderNo", headerName: "P.O NUMBER", width: 10 },
      {
        field: "orderDate",
        headerName: "DATE",
        width: 20,
        valueGetter: (params) =>
          new Date(params.row.orderDate).toLocaleDateString(),
      },
      // {
      //   field: "sale_po",
      //   headerName: "P.O NUMBER",
      //   width: 20,
      // },
      // {
      //   field: "itemCode",
      //   headerName: "MM#",
      //   width: 25,
      // },
      {
        field: "itemName",
        headerName: "ITEM",
        width: 85,
      },
      {
        field: "code",
        headerName: "Ink Code",
        width: 90,
        valueGetter: (params) => params.row.code || "-",
      },
      { field: "orderedQty", headerName: "QTY", width: 20 },
      { field: "purchasedQty", headerName: "RECEIVED", width: 20 },
      { field: "pendingQty", headerName: "BAL", width: 20 },
    ],

    // ✅ Dynamic columns based on filters
    // getColumns: (filters) => {
    //   const orderType = filters?.orderType;
    //   const accountHeader =
    //     orderType === "4"
    //       ? "VENDOR"
    //       : orderType === "6"
    //         ? "CUSTOMER"
    //         : "Account";

    //   const totalHeader =
    //     orderType === "4" ? "RECEIVED" : orderType === "6" ? "SHIP" : "Total";

    //   return [
    //     { field: "customer", headerName: accountHeader, width: 60 },
    //     { field: "orderNo", headerName: "ISO", width: 10 },
    //     {
    //       field: "orderDate",
    //       headerName: "DATE",
    //       width: 20,
    //       valueGetter: (params) =>
    //         new Date(params.row.orderDate).toLocaleDateString(),
    //     },
    //     {
    //       field: "sale_po",
    //       headerName: "P.O NUMBER",
    //       width: 20,
    //     },
    //     {
    //       field: "itemCode",
    //       headerName: "MM#",
    //       width: 25,
    //     },
    //     {
    //       field: "itemName",
    //       headerName: "ITEM",
    //       width: 85,
    //     },
    //     { field: "orderedQty", headerName: "QTY", width: 20 },
    //     { field: "purchasedQty", headerName: "RECEIVED", width: 20 },
    //     { field: "pendingQty", headerName: "BAL", width: 20 },
    //   ];
    // },

    summaryFields: [
      { field: "totalOrdered", label: "Total Purchased", type: "number" },

      {
        field: "totalNetReceived",
        label: "Total Net Received",
        type: "number",
      },
    ],

    exportOptions: {
      pdf: true,
      excel: true,
    },
  },

  customerAging: {
    title: "Customer Aging Report",
    description:
      "Aging analysis of customer accounts to track outstanding balances by time periods",
    apiEndpoint: "/api/reports/customerAging",
    // Blink specific cells when the invoice is overdue and has an outstanding balance
    // blinkCells: (row, field) => {
    //   const overdue = !!(row.invoiceNo && row.daysOutstanding > 0 && row.outstandingAmount > 0);
    //   return overdue && (field === "invoiceNo" || field === "dueDate");
    // },
    filters: [
      {
        name: "reportDate",
        label: "As of Date",
        type: "date",
        required: true,
        default: new Date(),
      },
      {
        name: "customer",
        label: "Customer",
        type: "select",
        nameKeys: ["acno", "acname"],
        separator: " - ",
        valueKey: "acno",
        options: "accounts",
        default: { value: "", label: "All Customers" },
        apiEndpoint: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}&scope=sales`,
        required: false,
        clearable: true,
      },
      // {
      //   name: "po_no",
      //   label: "Purchase Order No",
      //   type: "select",
      //   default: { value: "", label: "All Purchase Orders No" },
      //   options: "orders",
      //   apiEndpoint: "/api/orders/purchaseOrder",
      //   valueKey: "order_no",
      //   nameKey: "order_no",
      //   clearable: true,
      // },
      // {
      //   name: "region",
      //   label: "Region",
      //   type: "select",
      //   options: [
      //     { value: "NORTH", label: "NORTH" },
      //     { value: "SOUTH", label: "SOUTH" },
      //   ],
      //   clearable: true,
      //   defaultValue: { value: "all", label: "All Regions" },
      // },
      {
        name: "view",
        label: "View",
        type: "select",
        options: [
          { value: "summary", label: "Summary (With Credit Days)" },
          { value: "detailed", label: "Consolidated View" },
          { value: "noInterval", label: "Without Interval" },
          { value: "consolidateInterval", label: "Consolidated View Interval" },
        ],
        default: { value: "detailed", label: "Consolidated View" },
      },
      // {
      //   name: "city",
      //   label: "City",
      //   type: "select",
      //   options: "cities",
      //   apiEndpoint: `/api/accounts/cities?${CUSTOMER_GROUP_PARAM}`,
      //   valueKey: "city",
      //   nameKey: "city",
      //   default: { value: "", label: "All Cities" },
      //   clearable: true,
      // },
      {
        name: "sale_person",
        label: "Sales Person",
        type: "select",
        options: "salesPersons",
        apiEndpoint: "/api/accounts/customer-sales-persons?scope=own",
        valueKey: "id",
        nameKey: "name",
        default: { value: "", label: "All Sales Persons" },
        multiple: true,
        clearable: true,
      },
    ],
    getColumns: (filters) => {
      const view = filters?.view || "detailed";

      if (view === "summary") {
        return [
          { field: "customerCode", headerName: "Customer Code", width: 200 },
          { field: "customerName", headerName: "Customer", width: 200 },
          // { field: "totalInvoiceAmount", headerName: "Amount", width: 150, type: "currency" },
          { field: "totalOutstanding", showTotal: true, headerName: "Due Amount", width: 150, type: "currency" },
          { field: "currentDueAmount", showTotal: true, headerName: "Current Due (Not Yet Due)", width: 150, type: "currency" },
          { field: "overdueAmount", showTotal: true, headerName: "Overdue", width: 140, type: "currency" },
          { field: "currentAmount", showTotal: true, headerName: "Current (Not Due)", width: 130, type: "currency" },
          // { field: "days1To30", headerName: "1-30 Days", width: 120, type: "currency" },
          // { field: "currentDueAmount", headerName: "Current Due (Not Yet Due)", width: 150, type: "currency" },
          // { field: "overdueAmount", headerName: "Overdue", width: 140, type: "currency" },
          { field: "days1To30", showTotal: true, headerName: "1-30 Days", width: 120, type: "currency" },
          { field: "days31To60", showTotal: true, headerName: "31-60 Days", width: 120, type: "currency" },
          { field: "days61To90", showTotal: true, headerName: "61-90 Days", width: 120, type: "currency" },
          { field: "days91To120", showTotal: true, headerName: "91-120 Days", width: 130, type: "currency" },
          { field: "daysOver120", showTotal: true, headerName: "Over 120 Days", width: 130, type: "currency" },
        ];
      }

      if (view === "noInterval") {
        return [
          { field: "customerCode", headerName: "Customer Code", width: 200 },
          { field: "customerName", headerName: "CUSTOMER", width: 200 },
          // { field: "totalInvoiceAmount", headerName: "Amount", width: 150, type: "currency" },
          { field: "totalOutstanding", showTotal: true, headerName: "Due Amount", width: 150, type: "currency" },
          // { field: "days1To30", headerName: "1-30 Days", width: 120, type: "currency" },
          { field: "days1To30", showTotal: true, headerName: "1-30 Days", width: 120, type: "currency" },
          { field: "days31To60", showTotal: true, headerName: "31-60 Days", width: 120, type: "currency" },
          { field: "days61To90", showTotal: true, headerName: "61-90 Days", width: 120, type: "currency" },
          { field: "days91To120", showTotal: true, headerName: "91-120 Days", width: 130, type: "currency" },
          { field: "daysOver120", showTotal: true, headerName: "Over 120 Days", width: 130, type: "currency" },
        ];
      }

      if (view === "consolidateInterval") {
        return [
          { field: "customerName", headerName: "CUSTOMER", width: 60, },
          { field: "customerCode", headerName: "Account no", width: 20 },


          {
            field: "invoiceDate",
            headerName: "Invoice Date",
            width: 30,
            valueGetter: (params) =>
              new Date(params.row.invoiceDate).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              }),
          },
          {
            field: "dueDate",
            headerName: "Due Date",
            width: 30,
            valueGetter: (params) =>
              new Date(params.row.dueDate).toLocaleDateString("en-US", {
                month: "long",
                day: "numeric",
                year: "numeric",
              }),
          },
          { field: "invoiceNo", headerName: "INV NO", width: 20 },
          { field: "salePoNumber", headerName: "P.O NO", width: 20 },
          { field: "dispatchNo", headerName: "DISP NO", width: 20 },
          // { field: "region", headerName: "Region", width: 20 },
          {
            field: "invoiceAmount", showTotal: true,
            headerName: "INVOICE AMOUNT",
            width: 35,
            type: "currency",
          },

          {
            field: "directReceipts", showTotal: true,
            headerName: "PAID",
            width: 30,
            type: "currency",
          },

          {
            field: "outstandingAmount", showTotal: true,
            headerName: "BAL",
            width: 40,
            type: "currency",
          },
          {
            field: "daysOutstanding",
            headerName: "DAYS",
            width: 20,
            type: "number",
          },
          {
            field: "currentDueAmount", showTotal: true,
            headerName: "Current Due (Not Yet Due)",
            width: 150,
            type: "currency",
          },
          {
            field: "overdueAmount", showTotal: true,
            headerName: "Overdue",
            width: 140,
            type: "currency",
          },
          {
            field: "currentAmount", showTotal: true,
            headerName: "Current",
            width: 120,
            type: "currency",
          },
          {
            field: "days1To30", showTotal: true,
            headerName: "1-30 Days",
            width: 120,
            type: "currency",
          },
          {
            field: "days31To60", showTotal: true,
            headerName: "31-60 Days",
            width: 120,
            type: "currency",
          },
          {
            field: "days61To90", showTotal: true,
            headerName: "61-90 Days",
            width: 120,
            type: "currency",
          },
          {
            field: "days91To120", showTotal: true,
            headerName: "91-120 Days",
            width: 130,
            type: "currency",
          },
          {
            field: "daysOver120", showTotal: true,
            headerName: "Over 120 Days",
            width: 130,
            type: "currency",
          },
        ];
      }

      return [
        { field: "customerName", headerName: "CUSTOMER", width: 60, },
        { field: "customerCode", headerName: "Account no", width: 20 },


        {
          field: "invoiceDate",
          headerName: "Invoice Date",
          width: 30,
          valueGetter: (params) =>
            new Date(params.row.invoiceDate).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            }),
        },
        {
          field: "dueDate",
          headerName: "Due Date",
          width: 30,
          valueGetter: (params) =>
            new Date(params.row.dueDate).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            }),
        },
        { field: "invoiceNo", headerName: "INV NO", width: 20 },
        { field: "salePoNumber", headerName: "P.O NO", width: 20 },
        { field: "dispatchNo", headerName: "DISP NO", width: 20 },
        // { field: "region", headerName: "Region", width: 20 },
        {
          field: "invoiceAmount", showTotal: true,
          headerName: "INVOICE AMOUNT",
          width: 35,
          type: "currency",
        },

        {
          field: "directReceipts", showTotal: true,
          headerName: "PAID",
          width: 30,
          type: "currency",
        },

        {
          field: "outstandingAmount", showTotal: true,
          headerName: "BAL",
          width: 40,
          type: "currency",
        },
        {
          field: "daysOutstanding",
          headerName: "DAYS",
          width: 20,
          type: "number",
        },
        {
          field: "currentDueAmount", showTotal: true,
          headerName: "Current Due (Not Yet Due)",
          width: 150,
          type: "currency",
        },
        {
          field: "overdueAmount", showTotal: true,
          headerName: "Overdue",
          width: 140,
          type: "currency",
        },
        {
          field: "currentAmount", showTotal: true,
          headerName: "Current",
          width: 120,
          type: "currency",
        },
        {
          field: "days1To30", showTotal: true,
          headerName: "1-30 Days",
          width: 120,
          type: "currency",
        },
        {
          field: "days31To60", showTotal: true,
          headerName: "31-60 Days",
          width: 120,
          type: "currency",
        },
        {
          field: "days61To90", showTotal: true,
          headerName: "61-90 Days",
          width: 120,
          type: "currency",
        },
        {
          field: "days91To120", showTotal: true,
          headerName: "91-120 Days",
          width: 130,
          type: "currency",
        },
        {
          field: "daysOver120", showTotal: true,
          headerName: "Over 120 Days",
          width: 130,
          type: "currency",
        },
      ];
    },

    // Wide-report layout (rule 15): see agingLayout at the top of this file.
    layout: fitLayout("customerAging", agingLayout),
    drill: agingDrill("customerAging", "customer"),
    summaryFields: [
      {
        field: "totalInvoiceAmount",
        label: "Total Amount",
        type: "currency",
      },
      {
        field: "totalOutstanding",
        label: "Total Outstanding",
        type: "currency",
      },
      {
        field: "currentAmount",
        label: "Current (Not Due)",
        type: "currency",
      },
      {
        field: "days1To30",
        label: "1-30 Days",
        type: "currency",
      },
      {
        field: "days31To60",
        label: "31-60 Days",
        type: "currency",
      },
      {
        field: "days61To90",
        label: "61-90 Days",
        type: "currency",
      },
      {
        field: "days91To120",
        label: "91-120 Days",
        type: "currency",
      },
      {
        field: "daysOver120",
        label: "Over 120 Days",
        type: "currency",
      },
      {
        field: "averageDaysOutstanding",
        label: "Average Days Outstanding",
        type: "number",
      },
    ],
    drillDown: {
      enabled: true,
      label: "View Customer Ledger",
      modalTitle: "View Customer Account Details",
      linkBuilder: (row, filters) =>
        `/accounting/reports/accountLedger?account=${row.customer || row.customerCode
        }&dateFrom=2000-01-01T11%3A00%3A00.000Z&dateTo=${filters.reportDate}`,
    },
    exportOptions: {
      pdf: true,
      excel: true,
    },
  },

  // Same as Customer Aging, for what we OWE vendors: bills are Purchase
  // Invoices (4), settled by Payments (2) / JVs through INVOICE_KNOCKOFF.
  // Rows reuse the customer field names (customerName, customerCode …) so the
  // shared summary code works unchanged; only the headers say "Vendor".
  vendorAging: {
    title: "Vendor Aging Report",
    description:
      "Aging analysis of vendor accounts to track payable balances by time periods",
    apiEndpoint: "/api/reports/vendorAging",
    filters: [
      {
        name: "reportDate",
        label: "As of Date",
        type: "date",
        required: true,
        default: new Date(),
      },
      {
        name: "vendor",
        label: "Vendor",
        type: "select",
        nameKeys: ["acno", "acname"],
        separator: " - ",
        valueKey: "acno",
        options: "accounts",
        default: { value: "", label: "All Vendors" },
        apiEndpoint: `/api/accounts/acno?${VENDOR_GROUP_PARAM}`,
        required: false,
        clearable: true,
      },
      // {
      //   name: "po_no",
      //   label: "Purchase Order No",
      //   type: "select",
      //   default: { value: "", label: "All Purchase Orders No" },
      //   options: "orders",
      //   apiEndpoint: "/api/orders/purchaseOrder",
      //   valueKey: "order_no",
      //   nameKey: "order_no",
      //   clearable: true,
      // },
      // {
      //   name: "region",
      //   label: "Region",
      //   type: "select",
      //   options: [
      //     { value: "NORTH", label: "NORTH" },
      //     { value: "SOUTH", label: "SOUTH" },
      //   ],
      //   clearable: true,
      //   defaultValue: { value: "all", label: "All Regions" },
      // },
      {
        name: "view",
        label: "View",
        type: "select",
        options: [
          { value: "summary", label: "Summary (With Credit Days)" },
          { value: "detailed", label: "Consolidated View" },
          { value: "noInterval", label: "Without Interval" },
          { value: "consolidateInterval", label: "Consolidated View Interval" },
        ],
        default: { value: "detailed", label: "Consolidated View" },
      },
      // {
      //   name: "city",
      //   label: "City",
      //   type: "select",
      //   options: "cities",
      //   apiEndpoint: `/api/accounts/cities?${VENDOR_GROUP_PARAM}`,
      //   valueKey: "city",
      //   nameKey: "city",
      //   default: { value: "", label: "All Cities" },
      //   clearable: true,
      // },
      {
        name: "sale_person",
        label: "Sales Person",
        type: "select",
        options: "salesPersons",
        apiEndpoint: "/api/accounts/customer-sales-persons",
        valueKey: "id",
        nameKey: "name",
        default: { value: "", label: "All Sales Persons" },
        multiple: true,
        clearable: true,
      },
    ],
    getColumns: (filters) => {
      const view = filters?.view || "detailed";

      const buckets = [
        { field: "days1To30", showTotal: true, headerName: "1-30 Days", width: 120, type: "currency" },
        { field: "days31To60", showTotal: true, headerName: "31-60 Days", width: 120, type: "currency" },
        { field: "days61To90", showTotal: true, headerName: "61-90 Days", width: 120, type: "currency" },
        { field: "days91To120", showTotal: true, headerName: "91-120 Days", width: 130, type: "currency" },
        { field: "daysOver120", showTotal: true, headerName: "Over 120 Days", width: 130, type: "currency" },
      ];

      if (view === "summary") {
        return [
          { field: "customerCode", headerName: "Vendor Code", width: 200 },
          { field: "customerName", headerName: "Vendor", width: 200 },
          { field: "totalOutstanding", showTotal: true, headerName: "Due Amount", width: 150, type: "currency" },
          { field: "currentDueAmount", showTotal: true, headerName: "Current Due (Not Yet Due)", width: 150, type: "currency" },
          { field: "overdueAmount", showTotal: true, headerName: "Overdue", width: 140, type: "currency" },
          { field: "currentAmount", showTotal: true, headerName: "Current (Not Due)", width: 130, type: "currency" },
          ...buckets,
        ];
      }

      if (view === "noInterval") {
        return [
          { field: "customerCode", headerName: "Vendor Code", width: 200 },
          { field: "customerName", headerName: "VENDOR", width: 200 },
          { field: "totalOutstanding", showTotal: true, headerName: "Due Amount", width: 150, type: "currency" },
          ...buckets,
        ];
      }

      // "detailed" and "consolidateInterval" — one row per bill
      return [
        { field: "customerName", headerName: "VENDOR", width: 60 },
        { field: "customerCode", headerName: "Account no", width: 20 },
        {
          field: "invoiceDate",
          headerName: "Invoice Date",
          width: 30,
          valueGetter: (params) =>
            new Date(params.row.invoiceDate).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            }),
        },
        {
          field: "dueDate",
          headerName: "Due Date",
          width: 30,
          valueGetter: (params) =>
            new Date(params.row.dueDate).toLocaleDateString("en-US", {
              month: "long",
              day: "numeric",
              year: "numeric",
            }),
        },
        { field: "invoiceNo", headerName: "INV NO", width: 20 },
        { field: "salePoNumber", headerName: "P.O NO", width: 20 },
        { field: "dispatchNo", headerName: "GRN NO", width: 20 },
        // { field: "region", headerName: "Region", width: 20 },
        { field: "invoiceAmount", showTotal: true, headerName: "INVOICE AMOUNT", width: 35, type: "currency" },
        { field: "directReceipts", showTotal: true, headerName: "PAID", width: 30, type: "currency" },
        { field: "outstandingAmount", showTotal: true, headerName: "BAL", width: 40, type: "currency" },
        { field: "daysOutstanding", headerName: "DAYS", width: 20, type: "number" },
        { field: "currentDueAmount", showTotal: true, headerName: "Current Due (Not Yet Due)", width: 150, type: "currency" },
        { field: "overdueAmount", showTotal: true, headerName: "Overdue", width: 140, type: "currency" },
        { field: "currentAmount", showTotal: true, headerName: "Current", width: 120, type: "currency" },
        ...buckets,
      ];
    },

    // Wide-report layout (rule 15): same as Customer Aging (agingLayout).
    layout: fitLayout("vendorAging", agingLayout),
    drill: agingDrill("vendorAging", "vendor"),
    summaryFields: [
      { field: "totalInvoiceAmount", label: "Total Amount", type: "currency" },
      { field: "totalOutstanding", label: "Total Outstanding", type: "currency" },
      { field: "currentAmount", label: "Current (Not Due)", type: "currency" },
      { field: "days1To30", label: "1-30 Days", type: "currency" },
      { field: "days31To60", label: "31-60 Days", type: "currency" },
      { field: "days61To90", label: "61-90 Days", type: "currency" },
      { field: "days91To120", label: "91-120 Days", type: "currency" },
      { field: "daysOver120", label: "Over 120 Days", type: "currency" },
      { field: "averageDaysOutstanding", label: "Average Days Outstanding", type: "number" },
    ],
    drillDown: {
      enabled: true,
      label: "View Vendor Ledger",
      modalTitle: "View Vendor Account Details",
      linkBuilder: (row, filters) =>
        `/accounting/reports/accountLedger?account=${row.customer || row.customerCode
        }&dateFrom=2000-01-01T11%3A00%3A00.000Z&dateTo=${filters.reportDate}`,
    },
    exportOptions: {
      pdf: true,
      excel: true,
    },
  },

  bom: {
    title: "Bill of Materials Report",
    description: "Detailed Bill of Materials for manufactured products",
    apiEndpoint: "/api/reports/bom",
    showSummary: true,
    detailData: "materials",

    // ==== FILTERS ====
    filters: [
      { name: "dateFrom", type: "date", label: "From Date", default: new Date(new Date().getFullYear(), new Date().getMonth(), 1), },
      { name: "dateTo", type: "date", label: "To Date", default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0), },
    ],

    // ==== COLUMNS (BOM ITEMS) ====
    columns: [
      { field: "bomId", headerName: "BOM ID", width: 120 },

      {
        field: "bomDate",
        headerName: "Date",
        width: 130,
        valueGetter: (params) =>
          new Date(params.row.bomDate).toLocaleDateString(),
      },

      { field: "finishedItem", headerName: "Finished Product", width: 220 },

      {
        field: "materials",
        headerName: "Materials Used",
        width: 140,
        valueGetter: (params) => params.row.materials?.length || "0",
      },
    ],

    // ==== SUMMARY ====
    summaryFields: [
      {
        field: "totalBOMs",
        label: "Total BOMs",
        type: "number",
      },
      {
        field: "totalMaterialsUsed",
        label: "Total Materials Used",
        type: "number",
      },
      {
        field: "avgMaterialCount",
        label: "Avg Materials per BOM",
        type: "number",
      },
      {
        field: "avgPercentage",
        label: "Avg Material Percentage",
        type: "number",
      },
      {
        field: "fullyAllocatedBOMs",
        label: "100% Complete BOMs",
        type: "number",
      },
      {
        field: "underAllocatedBOMs",
        label: "Under 100% BOMs",
        type: "number",
      },
      {
        field: "overAllocatedBOMs",
        label: "Over 100% BOMs",
        type: "number",
      },
    ],

    detailColumns: [
      {
        field: "materialId",
        headerName: "ID",
        width: 60,
        valueGetter: (params) => params.row.materialId || "",
      },
      {
        field: "materialName",
        headerName: "Name",
        width: 60,
        valueGetter: (params) => params.row.materialName || "",
      },
      {
        field: "code",
        headerName: "Ink Code",
        width: 90,
        valueGetter: (params) => params.row.code || "-",
      },
      {
        field: "percentage",
        headerName: "percentage",
        width: 60,
        valueGetter: (params) => `${params.row.percentage}%` || "",
      },
    ],

    // ==== EXPORT OPTIONS ====
    exportOptions: {
      pdf: true,
      excel: true,
    },
  },
  processOrderReconciliation: {
    title: "Process Order Reconciliation",
    description: "Issuance vs production reconciliation by process order",
    apiEndpoint: "/api/reports/processOrderReconciliation",
    showSummary: true,
    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        required: true,
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        required: true,
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
      },
      {
        name: "processOrder",
        label: "Process Order No",
        type: "select",
        options: "productions",
        apiEndpoint: "/api/manufacturing/production?fetchOnlyid=true",
        valueKey: "id",
        nameKey: "id",
        clearable: true,
      },
      {
        name: "item",
        label: "Item",
        type: "select",
        options: "items",
        apiEndpoint: "/api/setup/items",
        clearable: true,
        valueKey: "itcd",
        nameKeys: ["code", "item"],
        separator: " - ",
      },
      {
        name: "category",
        label: "Category",
        type: "select",
        options: [
          { value: "SEMI FINISHED (HALB)", label: "SemiFinished" },
          { value: "FINISHED GOODS (FERT)", label: "Finished Goods" },
        ],
        default: { value: "", label: "All Category" },
        clearable: true,
      },
    ],
    columns: [
      { field: "process_order_no", headerName: "Process Order", width: 35 },
      {
        field: "dated",
        headerName: "Date",
        width: 30,
        type: "date",
        valueGetter: (params) =>
          params.row.dated
            ? new Date(params.row.dated).toLocaleDateString("en-PK", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })
            : "",
      },
      // {
      //   field: "mm", headerName: "MM#", width: 25,
      //   valueGetter: (params) =>
      //     params.row.process_order_no ? params.row.mm : "",
      // },
      {
        field: "code",
        headerName: "Ink Code",
        width: 40,
        valueGetter: (params) =>
          params.row.process_order_no ? params.row.code : "",

      },
      {
        field: "material_description",
        headerName: "Material Description",
        width: 70,
        valueGetter: (params) =>
          params.row.process_order_no ? params.row.material_description : "",
      },
      {
        field: "batch_no",
        headerName: "Batch No",
        width: 40,
        valueGetter: (params) =>
          params.row.process_order_no ? params.row.batch_no : "",

      },


      { field: "issuance", headerName: "Qty Issued", width: 12, type: "number" },
      {
        field: "production",
        headerName: "Qty Produced",
        width: 12,
        type: "number",
      },
      { field: "var", headerName: "Variance", width: 10, type: "number" },
      { field: "var_percent", headerName: "Var %", width: 10, type: "number" },
    ],
    summaryFields: [
      {
        field: "total_process_orders",
        label: "Total Process Orders",
        type: "number",
      },
      { field: "total_issuance", label: "Total Issuance", type: "number" },
      { field: "total_production", label: "Total Production", type: "number" },
      { field: "total_variance", label: "Total Variance", type: "number" },
      { field: "total_variance_percent", label: "Total Variance %", type: "number" },
    ],
    // Wide engine (rule 15) for the list. A row's "Open reconciliation"
    // opens the order's own reconciliation window (material-wise issue vs
    // production, with its own PDF / Excel) — that window keeps its own UI.
    layout: {
      pinned: ["process_order_no", "dated"],
      groups: [{ id: "qty", label: "Quantities", fields: ["issuance", "production", "var", "var_percent"], foldTo: "var" }],
      card: { title: "material_description", subtitle: "process_order_no", figures: ["issuance", "production", "var", "var_percent"] },
    },
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },
  qc: {
    title: "Quality Control Report",
    description: "Detailed report of all production quality control records",
    apiEndpoint: "/api/reports/qc",
    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        required: true,
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        required: true,
      },
      {
        name: "item",
        label: "Item",
        type: "select",
        options: "products",
        default: { value: "", label: "All Items" },
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["itcd", "item", "code"],
        separator: " - ",
        clearable: true,
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "DRAFT", label: "Draft" },
          { value: "APPROVED", label: "Approved" },
          { value: "REJECTED", label: "Rejected" },
          { value: "REWORK", label: "Rework" },
        ],
        default: { value: "", label: "All" },
        clearable: true,
      },
      {
        name: "batchNo",
        label: "Batch No",
        type: "select",
        options: "batches",
        apiEndpoint: "/api/forms/qualitycontrol",
        valueKey: "batch_no",
        nameKey: "batch_no",
        clearable: true,
      },
    ],
    // Dynamic columns based on parameters
    getColumns: (filters) => {
      // Base columns with user-specified header names
      const baseColumns = [
        {
          field: "mfg_date",
          headerName: "MFG Date",
          width: 50,
          type: "date",
          valueGetter: (params) => {
            if (!params.row.mfg_date) return "";
            const date = new Date(params.row.mfg_date);
            const day = String(date.getDate()).padStart(2, "0");
            const month = format(date, "MMM").toUpperCase();
            const year = String(date.getFullYear()).slice(-2);
            return `${day}-${month}-${year}`;
          },
        },

        {
          field: "proc_ord_no",
          headerName: "PR ORD NO",
          width: 50,
          type: "integer",
        },
        {
          field: "itcd",
          headerName: "ITCD",
          width: 40,
          type: "integer",
        },
        {
          field: "item_name",
          headerName: "PRODUCT",
          width: 150,
        },
        {
          field: "batch_size",
          headerName: "BATCH_SIZE",
          width: 50,
          valueGetter: (params) => params.row.batch_size || "",
        },
        {
          field: "batch_no",
          headerName: "BATCH_NO",
          width: 50,
          type: "integer",
          valueGetter: (params) => params.row.batch_no || "",
        },

      ];

      // Parameter columns will be added dynamically by the API
      // REJECT_REASON and STATUS columns will be added at the end
      return baseColumns;
    },
    // Dynamic parameter columns are handled in the API response
    dynamicColumns: true,
    detailColumns: [
      {
        field: "parameter_name",
        headerName: "Parameter",
        width: 100,
      },
      {
        field: "quality_standard",
        headerName: "Standard",
        width: 80,
      },
      {
        field: "quality_realized",
        headerName: "Realized",
        width: 80,
      },
      {
        field: "attempt_no",
        headerName: "Attempt No",
        width: 40,
        type: "number",
      },
      {
        field: "attempt_date",
        headerName: "Attempt Date",
        width: 50,
        type: "date",
        valueGetter: (params) =>
          params.row.attempt_date
            ? format(new Date(params.row.attempt_date), "MMM dd, yyyy")
            : "-",
      },
      {
        field: "reject_reason",
        headerName: "Reject Reason",
        width: 150,
        valueGetter: (params) => params.row.reject_reason || "-",
      },
    ],
    summaryFields: [
      { field: "total_qc_records", label: "Total QC Records", type: "number" },
      { field: "total_batch_size", label: "Total Batch Size", type: "number" },
      { field: "approved_count", label: "Approved", type: "number" },
      { field: "rejected_count", label: "Rejected", type: "number" },
      { field: "draft_count", label: "Draft", type: "number" },
      { field: "rework_count", label: "Rework", type: "number" },
    ],
    // Wide engine (rule 15): one row per batch; its QC attempts (parameter ×
    // standard × realized per attempt) open in the Record Details sheet.
    layout: {
      pinned: ["proc_ord_no", "item_name"],
      card: { title: "item_name", subtitle: (r) => [r.batch_no && `Batch ${r.batch_no}`, r.proc_ord_no && `PO ${r.proc_ord_no}`].filter(Boolean).join(" · ") },
    },
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },
  orderQc: {
    title: "Order Quality Control Report",
    description: "Detailed report of all order quality control records",
    apiEndpoint: "/api/reports/orderQc",
    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        required: true,
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        required: true,
      },
      {
        name: "item",
        label: "Item",
        type: "select",
        options: "products",
        default: { value: "", label: "All Items" },
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["itcd", "item", "code"],
        separator: " - ",
        clearable: true,
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "DRAFT", label: "Draft" },
          { value: "APPROVED", label: "Approved" },
          { value: "REJECTED", label: "Rejected" },
        ],
        default: { value: "", label: "All" },
        clearable: true,
      },
    ],
    // Dynamic columns based on parameters
    getColumns: (filters) => {
      // Base columns with user-specified header names
      const baseColumns = [
        {
          field: "order_date",
          headerName: "ORDER DATE",
          width: 50,
          type: "date",
          valueGetter: (params) => {
            if (!params.row.order_date) return "";
            const date = new Date(params.row.order_date);
            const day = String(date.getDate()).padStart(2, "0");
            const month = format(date, "MMM").toUpperCase();
            const year = String(date.getFullYear()).slice(-2);
            return `${day}-${month}-${year}`;
          },
        },
        {
          field: "order_no",
          headerName: "ORDER NO",
          width: 50,
          type: "integer",
        },
        {
          field: "itcd",
          headerName: "ITCD",
          width: 40,
          type: "integer",
        },
        {
          field: "item_name",
          headerName: "PRODUCT",
          width: 150,
        },
      ];

      // Parameter columns will be added dynamically by the API
      // REJECT_REASON and STATUS columns will be added at the end
      return baseColumns;
    },
    // Dynamic parameter columns are handled in the API response
    dynamicColumns: true,
    detailColumns: [
      {
        field: "parameter_name",
        headerName: "Parameter",
        width: 100,
      },
      {
        field: "quality_standard",
        headerName: "Standard",
        width: 80,
      },
      {
        field: "quality_realized",
        headerName: "Realized",
        width: 80,
      },
      {
        field: "attempt_no",
        headerName: "Attempt No",
        width: 40,
        type: "number",
      },
      {
        field: "attempt_date",
        headerName: "Attempt Date",
        width: 50,
        type: "date",
        valueGetter: (params) =>
          params.row.attempt_date
            ? format(new Date(params.row.attempt_date), "MMM dd, yyyy")
            : "-",
      },
      {
        field: "reject_reason",
        headerName: "Reject Reason",
        width: 150,
        valueGetter: (params) => params.row.reject_reason || "-",
      },
    ],
    summaryFields: [
      { field: "total_qc_records", label: "Total QC Records", type: "number" },
      { field: "total_batch_size", label: "Total Batch Size", type: "number" },
      { field: "approved_count", label: "Approved", type: "number" },
      { field: "rejected_count", label: "Rejected", type: "number" },
      { field: "draft_count", label: "Draft", type: "number" },
    ],
    // Wide engine (rule 15): one row per order item; its QC attempts open in
    // the Record Details sheet.
    layout: {
      pinned: ["order_no", "item_name"],
      card: { title: "item_name", subtitle: (r) => [r.order_no && `SO ${r.order_no}`, r.itcd].filter(Boolean).join(" · ") },
    },
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },
  // Add this to your REPORT_CONFIG object

  qcParameters: {
    title: "QC Parameters Report",
    description:
      "Quality Control report with parameters as columns showing approved attempt values",
    apiEndpoint: "/api/reports/qcParameters",

    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        required: true,
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        required: true,
      },
      {
        name: "item",
        label: "Item",
        type: "select",
        options: "products",
        default: { value: "", label: "All Items" },
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["itcd", "item", "code"],
        separator: " - ",
        clearable: true,
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "APPROVED", label: "Approved" },
          { value: "REJECTED", label: "Rejected" },
          { value: "DRAFT", label: "Draft" },
          { value: "REWORK", label: "Rework" },
          { value: "all", label: "All Statuses" },
        ],
        default: { value: "APPROVED", label: "Approved" },
        clearable: true,
      },
      {
        name: "batchNo",
        label: "Batch No",
        type: "select",
        options: "batches",
        apiEndpoint: "/api/forms/qualitycontrol",
        valueKey: "batch_no",
        nameKey: "batch_no",
        clearable: true,
      },
    ],
    dynamicColumns: true,

    // Base columns (will be extended with parameter columns from API)
    getColumns: (filters, parameterColumns = []) => {
      const baseColumns = [
        {
          field: "mfg_date",
          headerName: "MFG Date",
          width: 20,
          type: "date",
          valueGetter: (params) => {
            if (!params.row.mfg_date) return "";
            const date = new Date(params.row.mfg_date);
            const day = String(date.getDate()).padStart(2, "0");
            const month = format(date, "MMM").toUpperCase();
            const year = String(date.getFullYear()).slice(-2);
            return `${day}-${month}-${year}`;
          },
        },
        {
          field: "proc_ord_no",
          headerName: "PR ORD NO",
          width: 20,
          type: "integer",
        },
        {
          field: "itcd",
          headerName: "ITCD",
          width: 15,
          type: "integer",
        },
        {
          field: "item_name",
          headerName: "PRODUCT",
          width: 40,
        },
        {
          field: "batch_no",
          headerName: "BATCH_NO",
          width: 20,
          type: "string",
          valueGetter: (params) => params.row.batch_no?.toString() || ""
        },
        {
          field: "batch_size",
          headerName: "BATCH SIZE",
          width: 15,
          type: "float",
          valueGetter: (params) => params.row.batch_size || "",
        },
      ];

      const lastColumns = [
        // {
        //   field: "attempt_no",
        //   headerName: "ATTEMPT NO",
        //   width: 15,
        //   type: "number",
        //   valueGetter: (params) => params.row.attempt_no || "",
        // },
        {
          field: "attempt_date",
          headerName: "ATTEMPT DATE",
          width: 20,
          type: "date",
          valueGetter: (params) => {
            if (!params.row.attempt_date) return "-";
            return format(new Date(params.row.attempt_date), "MMM dd, yyyy");
          },
        },
        {
          field: "status",
          headerName: "STATUS",
          width: 20,
          valueGetter: (params) => params.row.status || "",
        },
        {
          field: "reject_reason",
          headerName: "REJECT REASON",
          width: 20,
          valueGetter: (params) => params.row.reject_reason || "-",
        },
      ];

      // If parameterColumns are provided from API, merge them with base columns
      if (parameterColumns && parameterColumns.length > 0) {
        return [...baseColumns, ...parameterColumns, ...lastColumns];
      }

      // Return only base columns if no parameters provided
      return [...baseColumns, ...lastColumns];
    },

    // No detail columns needed since everything is in main table
    // detailColumns: [],

    summaryFields: [
      { field: "total_qc_records", label: "Total QC Records", type: "number" },
      { field: "total_batch_size", label: "Total Batch Size", type: "number" },
      { field: "approved_count", label: "Approved", type: "number" },
      { field: "rejected_count", label: "Rejected", type: "number" },
      { field: "draft_count", label: "Draft", type: "number" },
      { field: "rework_count", label: "Rework", type: "number" },
    ],

    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },

  returnablePacking: {
    title: "Returnable Packing Material Report",
    description: "Track dispatch (OUT) and return (IN) of returnable packing materials",
    apiEndpoint: "/api/reports/returnablePacking",

    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        required: true,
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        required: true,
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
      },
      {
        name: "item",
        label: "Packing Material",
        type: "select",
        options: "packingMaterials",
        apiEndpoint: "/api/setup/all-packing-materials",
        valueKey: "itcd",
        nameKeys: ["itcd", "item", "code"],
        separator: " - ",
        clearable: true,
      },
      {
        name: "customer",
        label: "Customer",
        type: "select",
        nameKeys: ["acno", "acname"],
        separator: " - ",
        valueKey: "acno",
        options: "accounts",
        apiEndpoint: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`, // Customers only
        clearable: true,
      },
      {
        name: "godown",
        label: "Godown",
        type: "select",
        nameKey: "godown",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns?includeInactive=true",
        clearable: true,
      },
    ],

    columns: [
      { field: "dated", headerName: "Date", width: 20, type: "date" },
      { field: "transaction_type", headerName: "Type", width: 25 },
      { field: "reference_no", headerName: "Ref No", width: 20 },
      { field: "party_name", headerName: "Party", width: 50 },
      { field: "godown", headerName: "Godown", width: 30 },

      // Packing material details
      { field: "item_code", headerName: "Code", width: 20 },
      { field: "item_name", headerName: "Packing Material", width: 50 },
      {
        field: "dispatch_qty",
        headerName: "Dispatch Qty",
        width: 20,
        type: "number",
        valueGetter: (params) => params.row.dispatch_qty || 0
      },
      {
        field: "returned_qty",
        headerName: "Return Qty",
        width: 20,
        type: "number",
        valueGetter: (params) => params.row.returned_qty || 0
      },
      {
        field: "balance_qty",
        headerName: "Balance",
        width: 20,
        type: "number",
        valueGetter: (params) => params.row.balance_qty || 0
      },

    ],


    summaryFields: [
      { field: "total_transactions", label: "Total Transactions", type: "number" },
      { field: "total_dispatches", label: "Total Dispatches", type: "number" },
      { field: "total_returns", label: "Total Returns", type: "number" },
      { field: "total_dispatched_qty", label: "Total Dispatched Qty", type: "number" },
      { field: "total_returned_qty", label: "Total Returned Qty", type: "number" },
      { field: "net_outstanding_qty", label: "Net Outstanding Qty", type: "number" },
    ],

    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },
  monthlyStock: {
    title: "Monthly Stock Report",
    description: "Monthly stock movement and valuation report",
    apiEndpoint: "/api/reports/monthlyStock",

    filters: [
      { name: 'year', type: 'select', label: 'Year', options: generateYearOptions(), default: String(new Date().getFullYear()), },
      { name: 'month', type: 'select', label: 'Month', options: generateMonthOptions(), default: String(new Date().getMonth() + 1), },
      { name: 'item', type: 'item', label: 'Item' },
      { name: 'category', type: 'category', label: 'Category' },
      { name: 'godown', type: 'godown', label: 'Godown' },
    ],
    columns: [
      { field: 'item', headerName: 'Item Name', width: 40 },
      { field: 'category', headerName: 'Category', width: 30 },
      { field: 'opening_stock', headerName: 'Opening Stock', width: 15, type: 'number' },
      { field: 'opening_value', headerName: 'Opening Value', width: 30, type: 'number' },
      { field: 'purchase_qty', headerName: 'Purchase Qty', width: 20, type: 'number' },
      { field: 'purchase_value', headerName: 'Purchase Value', width: 25, type: 'number' },
      { field: 'sale_qty', headerName: 'Sale Qty', width: 20, type: 'number' },
      { field: 'sale_value', headerName: 'Sale Value', width: 25, type: 'number' },
      { field: 'closing_stock', headerName: 'Closing Stock', width: 15, type: 'number' },
      { field: 'closing_rate', headerName: 'Closing Rate', width: 30, type: 'number' },
      { field: 'closing_value', headerName: 'Closing Value', width: 30, type: 'number' },
    ],

    exportOptions: { excel: true, pdf: true }
  },

  batchCosting: {
    title: "Batch Costing Report",
    description: "Production batch cost analysis",
    apiEndpoint: "/api/reports/batchCosting",

    filters: [
      { name: 'batchNo', type: 'text', label: 'Batch Number' },
      { name: 'processOrder', type: 'text', label: 'Process Order No' },
      { name: 'dateFrom', type: 'date', label: 'From Date', default: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      { name: 'dateTo', type: 'date', label: 'To Date', default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0), },
      { name: 'item', type: 'item', label: 'Item' },
    ],
    columns: [
      { field: 'batch_no', headerName: 'Batch No', width: 20 },
      { field: 'finished_item', headerName: 'Finished Item', width: 30 },
      { field: 'production_date', headerName: 'Production Date', width: 25, type: 'date' },
      { field: 'planned_qty', headerName: 'Planned Qty', width: 20, type: 'number' },
      { field: 'actual_yield', headerName: 'Actual Yield', width: 20, type: 'number' },
      { field: 'yield_percentage', headerName: 'Yield %', width: 20, type: 'number' },
      { field: 'material_issued_qty', headerName: 'Material Qty', width: 25, type: 'number' },
      { field: 'material_cost', headerName: 'Material Cost', width: 25, type: 'number' },
      { field: 'finished_produced_qty', headerName: 'Produced Qty', width: 25, type: 'number' },
      { field: 'finished_value', headerName: 'Finished Value', width: 30, type: 'number' },
      { field: 'material_cost_per_unit', headerName: 'Material/Unit', width: 20, type: 'number' },
      { field: 'production_cost_per_unit', headerName: 'Cost/Unit', width: 20, type: 'number' },
    ],

    exportOptions: { excel: true, pdf: true }
  },

  // -- Funds Flow -----------------------------------------------------------
  // Opening funds -> sources (FUNDS RECEIVED) -> uses (FUNDS DISBURSED) ->
  // closing funds. Rows are built in lib/reports/fundsFlow.js and tagged by
  // `row_type`; disbursed amounts arrive already negative.
  fundsFlow: {
    title: "Funds Flow",
    description: "Movement of cash, bank and director I.O.U. funds: opening balance, sources received, amounts disbursed and closing balance",
    apiEndpoint: "/api/reports/fundsFlow",
    showSummary: true,
    // "Arrange accounts" — the user's own saved order of accounts within each
    // control-account group (components/Reports/AccountOrderPanel.jsx).
    accountOrder: { groupRow: "group_header", groupKeyField: "code", accountRow: "detail_row", acnoField: "code", nameField: "label" },
    filters: [
      { name: "dateFrom", label: "From Date", type: "date", required: true, default: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      { name: "dateTo", label: "To Date", type: "date", required: true, default: new Date() },
    ],
    columns: [
      { field: "code", headerName: "Code", width: 15 },
      { field: "label", headerName: "Description", width: 70 },
      { field: "amount", headerName: "Amount", width: 25, type: "currency", showTotal: true },
    ],
    // Wide engine (rule 15): section (Opening / Received / Disbursed) ›
    // control account › accounts, in the user's saved account order (applied
    // on the server; the engine never re-sorts unless a header is clicked).
    // Section and control totals are plain sums → recomputed. There is no
    // grand total: Received + Disbursed is not a figure — the closing line
    // (Opening + Received − Disbursed) is the server's and shows as it comes.
    layout: {
      pinned: ["code", "label"],
      groupRows: {
        levels: [
          // the Opening section has no lines — its amount sits on the header
          { header: "section_header", total: "section_total", title: "Section", label: (h) => h.label, headerFields: ["amount"] },
          { header: "group_header", total: "group_total", title: "Control account", label: (h) => `${h.code} ${h.label}`, headerFields: ["code", "label"] },
        ],
        detail: "detail_row",
        extra: { closing_row: "total" },
        grandTotal: false,
      },
      card: { title: "label", subtitle: "code", figures: ["amount"] },
    },
    drill: [
      {
        label: "Open account ledger",
        when: (row) => row.row_type === "detail_row" && !!row.code,
        href: (row, filters) => accountLedgerHref({ account: row.code, dateFrom: filters.dateFrom, dateTo: filters.dateTo }),
      },
    ],
    summaryFields: [
      { field: "openingFunds", label: "Opening Funds In Hand", type: "currency" },
      { field: "fundsReceived", label: "Funds Received", type: "currency" },
      { field: "fundsDisbursed", label: "Funds Disbursed", type: "currency" },
      { field: "closingFunds", label: "Closing Funds In Hand", type: "currency" },
    ],
    exportOptions: { excel: true, pdf: true },
  },

  // -- Funds Position -------------------------------------------------------
  // Per fund account: Opening + Receipts (debits to the fund) - Payments
  // (credits to the fund) = Closing, grouped by control account (macno
  // 21/32/65/85). Figures are the account ledger, so Closing = Trial Balance.
  fundsPosition: {
    title: "Funds Position",
    description: "Opening, movement and closing balance of every bank, cash and director I.O.U. account, grouped by control account",
    apiEndpoint: "/api/reports/fundsPosition",
    showSummary: true,
    // "Arrange accounts" — the user's own saved order of accounts within each
    // control account; the panel lists zero-activity accounts too.
    accountOrder: { groupRow: "control_header", groupKeyField: "macno", accountRow: "account_row", acnoField: "acno", nameField: "acname", params: { showZeroBalance: true } },
    filters: [
      { name: "dateFrom", label: "From Date", type: "date", required: true, default: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      { name: "dateTo", label: "To Date", type: "date", required: true, default: new Date() },
      { name: "showZeroBalance", type: "checkbox", label: "Show Zero-Activity Accounts", default: false },
    ],
    columns: [
      { field: "account", headerName: "Account", width: 55 },
      { field: "opening", headerName: "Opening", width: 22, type: "currency", showTotal: true },
      { field: "payments", headerName: "Payments", width: 22, type: "currency", showTotal: true },
      { field: "receipts", headerName: "Receipts", width: 22, type: "currency", showTotal: true },
      { field: "closing", headerName: "Closing", width: 22, type: "currency", showTotal: true },
    ],
    // Wide engine (rule 15): control account › its accounts. The accounts
    // arrive in the user's saved order (lib/reports/accountOrder.js, applied
    // on the server) and the engine keeps it — only a click on a column
    // header re-sorts, and then only inside each control account. Control /
    // grand totals are plain sums of the accounts → dropped and recomputed.
    layout: {
      pinned: ["account"],
      groupRows: {
        levels: [{ header: "control_header", total: "control_total", title: "Control account", label: (h) => h.label }],
        detail: "account_row",
        drop: ["grand_total"],
      },
      card: { title: "account", figures: ["opening", "receipts", "payments", "closing"] },
    },
    // Account row → its Account Ledger for the same period.
    drill: [
      {
        label: "Open account ledger",
        when: (row) => !!row.acno,
        href: (row, filters) => accountLedgerHref({ account: row.acno, dateFrom: filters.dateFrom, dateTo: filters.dateTo }),
      },
    ],
    summaryFields: [
      { field: "openingFunds", label: "Opening", type: "currency" },
      { field: "totalPayments", label: "Payments", type: "currency" },
      { field: "totalReceipts", label: "Receipts", type: "currency" },
      { field: "closingFunds", label: "Closing", type: "currency" },
    ],
    exportOptions: { excel: true, pdf: true },
  },

  // -- Customer Based Gross Margin ------------------------------------------
  // Per customer, per product: sales qty/value against costed value, with the
  // margin amount and margin % (on cost). Built in lib/reports/customerMargin.js
  customerMargin: {
    title: "Customer Based Gross Margin",
    description: "Sales value versus cost value per product for every customer, with gross margin amount and percentage",
    apiEndpoint: "/api/reports/customerMargin",
    showSummary: true,
    filters: [
      { name: "dateFrom", label: "From Date", type: "date", required: true, default: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
      { name: "dateTo", label: "To Date", type: "date", required: true, default: new Date() },
      {
        name: "customer",
        label: "Customer",
        type: "select",
        nameKeys: ["acno", "acname"],
        separator: " - ",
        valueKey: "acno",
        default: { value: "", label: "All Customers" },
        apiEndpoint: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`,
      },
      {
        name: "item",
        label: "Product",
        type: "select",
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["code", "item"],
        separator: " - ",
        default: { value: "", label: "All Products" },
      },
    ],
    columns: [
      { field: "customer_acno", headerName: "Customer Code", width: 16 },
      { field: "customer", headerName: "Customer", width: 30 },
      { field: "product", headerName: "Sales Product", width: 20 },
      { field: "item_name", headerName: "Product Name", width: 30 },
      { field: "qty", headerName: "Sales Qty", width: 18, type: "number", showTotal: true },
      { field: "sales_value", headerName: "Sales Value", width: 22, type: "currency", showTotal: true },
      { field: "sale_rate", headerName: "Sale Rate", width: 18, type: "currency", totalRatio: { num: "sales_value", den: "qty" } },
      { field: "cost_rate", headerName: "Cost Rate", width: 18, type: "currency", totalRatio: { num: "cost_value", den: "qty" } },
      { field: "cost_value", headerName: "Cost Value", width: 22, type: "currency", showTotal: true },
      { field: "margin_amount", headerName: "Margin Amount", width: 22, type: "currency", showTotal: true },
      { field: "margin_percent", headerName: "Margin %", width: 18, type: "percent", totalRatio: { num: "margin_amount", den: "cost_value", scale: 100 } },
    ],
    // Wide-report layout (rule 15): grouped by customer with weighted subtotals.
    // No groupedDetailView — the API returns flat customer × product rows.
    layout: customerMarginLayout,
    drill: [
      {
        label: "Open customer sales",
        when: (row) => !!row.customer_acno,
        href: (row, filters) => reportHref("sale", { dateFrom: filters.dateFrom, dateTo: filters.dateTo, customer: row.customer_acno, item: filters.item, type: "customerDetail" }),
      },
      {
        label: "Open account ledger",
        when: (row) => !!row.customer_acno,
        href: (row, filters) => accountLedgerHref({ account: row.customer_acno, dateFrom: filters.dateFrom, dateTo: filters.dateTo }),
      },
    ],
    summaryFields: [
      { field: "totalQty", label: "Total Qty", type: "number" },
      { field: "totalSales", label: "Total Sales", type: "currency" },
      { field: "totalCost", label: "Total Cost", type: "currency" },
      { field: "totalMargin", label: "Gross Margin", type: "currency" },
      { field: "marginPercent", label: "Margin %", type: "number" },
    ],
    exportOptions: { excel: true, pdf: true },
  },

  // ─── Checks In Hand ────────────────────────────────────────────────────────
  // Post-dated / undeposited customer cheques physically held by the company,
  // reproducing the legacy "CHECKS IN HAND" printout. Rows are built and
  // tagged with a row_type in lib/reports/checksInHand.js; entry lives at
  // /accounting/checks-in-hand.
  checksInHand: {
    title: "Checks In Hand",
    description:
      "Customer cheques held by the company - grouped by Sales Person or by cheque date, with Pending / Cleared status and deposit dates",
    apiEndpoint: "/api/reports/checksInHand",
    showSummary: true,

    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        required: true,
        default: new Date(new Date().getFullYear(), 0, 1),
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        required: true,
        default: new Date(),
      },
      {
        // Which of the cheque's four dates the From/To range applies to. The
        // default is the cheque date (what the legacy printout ranged over);
        // the others are real alternatives — see lib/reports/checksInHand.js.
        name: "dateField",
        label: "Date Based On",
        type: "select",
        options: [
          { value: "chqDate", label: "Cheque Date" },
          { value: "chqRcvDate", label: "Received Date" },
          { value: "depDate", label: "Deposit Date" },
          { value: "dated", label: "Entry Date" },
        ],
        default: { value: "chqDate", label: "Cheque Date" },
      },
      {
        name: "customer",
        label: "Customer",
        type: "select",
        // Dedicated endpoint rather than /api/accounts/acno: that one hides
        // isActive=false accounts, which would drop the whole unofficial book.
        apiEndpoint: "/api/accounts/checks-in-hand/customers",
        valueKey: "acno",
        nameKeys: ["acno", "acname"],
        separator: " - ",
        default: { value: "", label: "All Customers" },
        clearable: true,
      },
      {
        name: "reportBase",
        label: "Report Base",
        type: "select",
        options: [
          { value: "salesPerson", label: "Sales Person wise" },
          { value: "date", label: "Date wise" },
        ],
        default: { value: "date", label: "Date wise" },
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "all", label: "All" },
          { value: "PENDING", label: "Pending" },
          { value: "CLEARED", label: "Cleared" },
        ],
        default: { value: "PENDING", label: "Pending" },
      },
      {
        // Dual book: ACNO.isActive true = Official ("SEGMENT: E" on the legacy
        // header), false = Unofficial.
        name: "category",
        label: "Official / Unofficial Book",
        type: "select",
        options: [
          { value: "all", label: "All Customers" },
          { value: "active", label: "Official Book Customers" },
          { value: "inactive", label: "Unofficial Book Customers" },
        ],
        default: { value: "all", label: "All Customers" },
      },
    ],

    columns: [
      { field: "chqNo", headerName: "Check#", width: 20 },
      { field: "chqDate", headerName: "Check Date", width: 16 },
      { field: "customerCode", headerName: "Customer Code", width: 16 },
      { field: "customer", headerName: "Customer", width: 34 },
      { field: "salesPersonName", headerName: "Sales Person", width: 22 },
      { field: "bank", headerName: "Bank Drawn", width: 24 },
      { field: "amount", headerName: "Amount", width: 20, type: "currency", showTotal: true },
      { field: "count", headerName: "Cheques", width: 12, type: "integer", showTotal: true },
      { field: "depAcno", headerName: "Deposit Bank", width: 24 },
      { field: "depDate", headerName: "Deposit Date", width: 16 },
      { field: "chqRcvDate", headerName: "Received Date", width: 16 },
      { field: "rmk", headerName: "Remarks", width: 28 },
      { field: "status", headerName: "Status", width: 14 },
    ],

    // Wide-report layout (rule 15): flat cheque rows (lib/reports/checksInHand.js)
    // grouped by Sales Person › Customer, or by date, with count + amount
    // subtotals. No groupedDetailView. A cheque is not a voucher (no tran_id
    // on checks_in_hand), so a row drills to the customer's ledger.
    layout: checksInHandLayout,
    drill: [
      {
        label: "Open customer ledger",
        when: (row) => !!row.customerCode,
        href: (row, filters) => accountLedgerHref({ account: row.customerCode, dateFrom: filters.dateFrom, dateTo: filters.dateTo }),
      },
    ],

    summaryFields: [
      { field: "totalCount", label: "Total Cheques", type: "number" },
      { field: "totalAmount", label: "Total Amount", type: "currency" },
      { field: "pendingCount", label: "Pending Cheques", type: "number" },
      { field: "pendingAmount", label: "Pending Amount", type: "currency" },
      { field: "clearedCount", label: "Cleared Cheques", type: "number" },
      { field: "clearedAmount", label: "Cleared Amount", type: "currency" },
    ],

    exportOptions: { excel: true, pdf: true, csv: true },
  },

  rmc: {
    title: "Raw Material Cost Estimation (RMC)",
    description: "Explodes a finished item's BOM to raw materials, prices them, and derives estimated cost of goods manufactured",
    apiEndpoint: "/api/reports/rmc",
    showSummary: true,

    filters: [
      {
        name: "finishedItem",
        label: "Finished / Semi-Finished Item",
        type: "select",
        required: true,
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["itcd", "item", "code"],
        separator: " - ",
        clearable: "true"
      },
      { name: "year", type: "select", label: "Rate Year", options: generateYearOptions(), default: String(new Date().getFullYear()), required: true },
      { name: "month", type: "select", label: "Rate Month", options: generateMonthOptions(), default: String(new Date().getMonth() + 1), required: true },
      { name: "wastagePercentage", type: "text", label: "Wastage %", default: "2.5" },
      { name: "tonage", type: "text", label: "Tonage", default: "150" },
      { name: "marginPercentage", type: "text", label: "Margin %", default: "10" },
      { name: "localRebatePercentage", type: "text", label: "Local RM Rebate (-) %", default: "12" },
      { name: "importTaxPercentage", type: "text", label: "Imp RM Tax %", default: "0" },
      { name: "showOfficial", type: "checkbox", label: "Show Official Price (@18%)", default: true },
      { name: "showUnofficial", type: "checkbox", label: "Show Unofficial Price (@22%)", default: true },
    ],

    // One waterfall — Imported materials + subtotal, Local Purchase materials
    // + subtotal, then tax/rebate/wastage/margin/overhead down to the final
    // Official/Unofficial prices. Row shapes are built in lib/reports/rmc.js
    // (getRMCReport), tagged by `row_type` (API unchanged). Build-up lines
    // carry `label` / `rate_pct` / `tonage` / `amount`; the columns read both.
    columns: [
      { field: "material_code", headerName: "Material Id", width: 20 },
      { field: "material_name", headerName: "RM Item / Line", width: 50, valueGetter: ({ row }) => row.material_name ?? row.label ?? "" },
      { field: "percentage", headerName: "%", width: 15, type: "number", showTotal: true },
      { field: "rate", headerName: "Rate", width: 20, type: "currency" },
      { field: "factor", headerName: "Rate % / Tons", width: 16, type: "number", valueGetter: ({ row }) => row.rate_pct ?? row.tonage ?? null },
      { field: "mat_cost", headerName: "Mat Cost / Amount", width: 20, type: "currency", showTotal: true, valueGetter: ({ row }) => row.mat_cost ?? row.amount ?? null },
    ],
    // Wide engine (rule 15): section › materials with a recomputed section
    // subtotal (= the server's section_total, a plain sum), then the cost
    // build-up lines exactly as the server worked them out. No grand total —
    // the materials alone are not the cost; the build-up below them is.
    layout: {
      pinned: ["material_code", "material_name"],
      groupRows: {
        levels: [{ header: "section_header", total: "section_total", title: "Section", label: (h) => h.label }],
        detail: "material_row",
        extra: { rate_line: "line", overhead_line: "line", total_line: "total", cogm_line: "total", price_line: "total" },
        grandTotal: false,
      },
      card: { title: "material_name", subtitle: "material_code", figures: ["percentage", "rate", "mat_cost"] },
    },

    summaryFields: [
      { field: "importedTotal", label: "Imported Total", type: "currency" },
      { field: "localTotal", label: "Local Total", type: "currency" },
      { field: "materialCostTotal", label: "Material Cost Total", type: "currency" },
      { field: "estimatedCOGM", label: "Estimated COGM", type: "currency" },
      { field: "priceOfficial", label: "Price for Official (@18%)", type: "currency" },
      { field: "priceUnofficial", label: "Price for Unofficial (@22%)", type: "currency" },
    ],

    exportOptions: { excel: true, pdf: true }
  },

  monthlyStockValuation: {
    title: "Monthly Stock Valuation Report",
    description: "Monthly stock valuation and profitability analysis",
    apiEndpoint: "/api/reports/monthlyStockValuation",
    filters: [
      { name: 'year', type: 'select', label: 'Year', options: generateYearOptions(), default: String(new Date().getFullYear()), },
      { name: 'month', type: 'select', label: 'Month', options: generateMonthOptions(), default: String(new Date().getMonth() + 1), },
      {
        name: 'valuationMethod', type: 'select', label: 'Valuation Method',
        options: [
          { value: 'FIFO', label: 'FIFO' },
          { value: 'WA', label: 'Weighted Average' },
        ]
      },
    ],
    columns: [
      { field: 'item', headerName: 'Item Name', width: 30 },
      { field: 'category', headerName: 'Category', width: 18 },
      { field: 'opening_qty', headerName: 'Opening Qty', width: 20, type: 'number' },
      { field: 'opening_value', headerName: 'Opening Value', width: 20, type: 'number' },
      { field: 'purchase_qty', headerName: 'Purchase Qty', width: 20, type: 'number' },
      { field: 'purchase_value', headerName: 'Purchase Value', width: 20, type: 'number' },
      { field: 'sale_qty', headerName: 'Sale Qty', width: 20, type: 'number' },
      { field: 'sale_value', headerName: 'Sale Value', width: 20, type: 'number' },
      { field: 'closing_qty', headerName: 'Closing Qty', width: 20, type: 'number' },
      { field: 'weighted_avg_rate', headerName: 'Avg Rate', width: 20, type: 'number' },
      { field: 'closing_value_weighted_avg', headerName: 'Closing Value', width: 20, type: 'number' },
      { field: 'cogs_weighted_avg', headerName: 'COGS', width: 20, type: 'number' },
      { field: 'gross_profit_weighted_avg', headerName: 'Gross Profit', width: 20, type: 'number' },
      { field: 'gross_profit_percentage', headerName: 'GP %', width: 15, type: 'number' },
    ],

    exportOptions: { excel: true, pdf: true }
  },






  stockActivityWithRate: {
    title: "Stock Activity With Rate Report",
    description: "Comprehensive stock movement analysis with production costing",
    apiEndpoint: "/api/reports/stockActivityWithRate",
    showSummary: true,

    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        required: true,
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1), // Start of current month
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        required: true,
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
      },
      {
        name: "product",
        label: "Product",
        type: "select",
        options: "products",
        default: { value: "", label: "All Products" },
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["itcd", "item", "code"],
        separator: " - ",
        clearable: true,
      },
      {
        name: "category",
        label: "Category",
        type: "select",
        options: "itemCategories",
        default: { value: "", label: "All Categories" },
        apiEndpoint: "/api/setup/item_categories",
        nameKey: "ic_name",
        clearable: true,
      },
      {
        name: "godown",
        label: "Godown",
        type: "select",
        nameKey: "godown",
        default: { value: "", label: "All Godowns" },
        options: "godowns",
        apiEndpoint: "/api/setup/godowns?includeInactive=true",
        clearable: true,
      },
      {
        name: "itemType",
        label: "Item Type",
        type: "select",
        options: [
          { value: "", label: "All Types" },
          { value: "FINISHED_GOOD", label: "Finished Goods" },
          { value: "RAW_MATERIAL", label: "Raw Materials" },
          { value: "CONSUMABLE", label: "Consumables" },
          { value: "OTHER", label: "Others" },
        ],
        clearable: true,
      },
      {
        name: "viewMode",
        label: "View Mode",
        type: "select",
        options: [
          { value: "summary", label: "Summary View" },
          { value: "detailed", label: "Detailed View" },
          { value: "production", label: "Production Focus" },
          { value: "rawMaterials", label: "Raw Materials Usage" },
        ],
        default: { value: "summary", label: "Summary View" },
      },
      {
        name: "showZeroStock",
        label: "Show Zero Stock Items",
        type: "checkbox",
        default: false,
      },
    ],

    // Dynamic columns based on view mode
    getColumns: (filters) => {
      const viewMode = filters?.viewMode || "summary";

      const baseColumns = [
        { field: "product_code", headerName: "Code", width: 15, pinned: "left" },
        { field: "product_name", headerName: "Product Name", width: 60, pinned: "left" },
        { field: "category", headerName: "Category", width: 30 },
      ];

      // Raw purchase rate = purchase_amount / purchase_qty (actual invoice rate, not blended)
      // The viewer calls valueGetter({ row }); p.data alone always read 0 here.
      const rawPurRate = (p) => { const d = p.row ?? p.data; return d?.purchase_qty > 0 ? (d?.purchase_amount || 0) / d.purchase_qty : 0; };
      const rawPurRetRate = (p) => { const d = p.row ?? p.data; return d?.purchase_ret_qty > 0 ? (d?.purchase_ret_amount || 0) / d.purchase_ret_qty : 0; };

      // Full column set in flow order:
      //   Opening → Purchase → Pur Return → Production → Blended Rate
      //   → Sale → Sale Return → POS → POS Return → Issuance → Trf In → Trf Out → Closing
      const allColumns = [
        // ── Opening ──────────────────────────────────────────────────────────
        { field: "opening_stock", headerName: "Open Qty", width: 13, type: "number", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        { field: "opening_rate", headerName: "Open Rate", width: 13, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        { field: "opening_value", headerName: "Open Value", width: 16, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        // ── Purchase ─────────────────────────────────────────────────────────
        { field: "purchase_qty", headerName: "Pur Qty", width: 12, type: "number", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        { colId: "purchase_rate", headerName: "Pur Rate", width: 12, type: "currency", cellClass: "text-right", valueGetter: rawPurRate },
        { field: "purchase_amount", headerName: "Pur Amt", width: 15, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        // ── Purchase Return ───────────────────────────────────────────────────
        { field: "purchase_ret_qty", headerName: "Pur Ret Qty", width: 13, type: "number", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        { colId: "purchase_ret_rate", headerName: "Pur Ret Rate", width: 13, type: "currency", cellClass: "text-right", valueGetter: rawPurRetRate },
        { field: "purchase_ret_amount", headerName: "Pur Ret Amt", width: 15, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        // ── Production Output (tran_code=8) ──────────────────────────────────
        { field: "material_production_qty", headerName: "Prod Qty", width: 12, type: "number", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        { field: "material_production_rate", headerName: "Prod Rate", width: 12, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        { field: "material_production_amount", headerName: "Prod Amt", width: 15, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        // ── Blended Avg Rate (Opening + Purchase + Production) ────────────────
        { field: "total_cost_rate", headerName: "Blended Rate", width: 15, type: "currency", cellClass: "text-right fw-bold", valueFormatter: (p) => p.value ?? 0 },
        // ── Sale ─────────────────────────────────────────────────────────────
        { field: "sale_qty", headerName: "Sale Qty", width: 12, type: "number", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        { field: "sale_cost_rate", headerName: "Sale Rate", width: 12, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        { field: "sale_cost_amount", headerName: "Sale Cost", width: 15, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        // ── Sale Return ───────────────────────────────────────────────────────
        { field: "sale_ret_qty", headerName: "Sale Ret Qty", width: 13, type: "number", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        { field: "sale_ret_rate", headerName: "Sale Ret Rate", width: 13, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        { field: "sale_ret_amount", headerName: "Sale Ret Amt", width: 15, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        // ── POS ──────────────────────────────────────────────────────────────
        { field: "pos_qty", headerName: "POS Qty", width: 11, type: "number", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        { field: "pos_rate", headerName: "POS Rate", width: 11, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        { field: "pos_amount", headerName: "POS Amt", width: 14, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        // ── POS Return ────────────────────────────────────────────────────────
        { field: "pos_ret_qty", headerName: "POS Ret Qty", width: 13, type: "number", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        { field: "pos_ret_rate", headerName: "POS Ret Rate", width: 13, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        { field: "pos_ret_amount", headerName: "POS Ret Amt", width: 14, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        // ── Material Issuance (tran_code=7) ──────────────────────────────────
        { field: "material_issuance_qty", headerName: "Issue Qty", width: 12, type: "number", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        { field: "material_issuance_rate", headerName: "Issue Rate", width: 12, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        { field: "material_issuance_amount", headerName: "Issue Amt", width: 15, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        // ── Transfer In ───────────────────────────────────────────────────────
        { field: "transfer_in_qty", headerName: "Trf In Qty", width: 12, type: "number", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        { field: "transfer_in_rate", headerName: "Trf In Rate", width: 12, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        { field: "transfer_in_amount", headerName: "Trf In Amt", width: 14, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        // ── Transfer Out ──────────────────────────────────────────────────────
        { field: "transfer_out_qty", headerName: "Trf Out Qty", width: 12, type: "number", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        { field: "transfer_out_rate", headerName: "Trf Out Rate", width: 12, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        { field: "transfer_out_amount", headerName: "Trf Out Amt", width: 14, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        // ── Closing ───────────────────────────────────────────────────────────
        { field: "closing_qty", headerName: "Closing Qty", width: 13, type: "number", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
        { field: "closing_rate", headerName: "Closing Rate", width: 13, type: "currency", cellClass: "text-right" },
        { field: "closing_value", headerName: "Closing Value ", width: 16, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
      ];

      // Totals: quantities and amounts add up; a rate's total is the weighted
      // rate of its group (Σ amount / Σ qty). The blended rate has no total.
      const RATE_OF = {
        opening_rate: ["opening_value", "opening_stock"],
        purchase_rate: ["purchase_amount", "purchase_qty"],
        purchase_ret_rate: ["purchase_ret_amount", "purchase_ret_qty"],
        material_production_rate: ["material_production_amount", "material_production_qty"],
        sale_cost_rate: ["sale_cost_amount", "sale_qty"],
        sale_ret_rate: ["sale_ret_amount", "sale_ret_qty"],
        pos_rate: ["pos_amount", "pos_qty"],
        pos_ret_rate: ["pos_ret_amount", "pos_ret_qty"],
        material_issuance_rate: ["material_issuance_amount", "material_issuance_qty"],
        transfer_in_rate: ["transfer_in_amount", "transfer_in_qty"],
        transfer_out_rate: ["transfer_out_amount", "transfer_out_qty"],
        closing_rate: ["closing_value", "closing_qty"],
      };
      const withTotals = allColumns.map((c) => {
        const k = c.field ?? c.colId;
        if (RATE_OF[k]) return { ...c, totalRatio: { num: RATE_OF[k][0], den: RATE_OF[k][1] } };
        if (k === "total_cost_rate") return c;
        return { ...c, showTotal: true };
      });

      return [...baseColumns, ...withTotals];
    },

    // Wide-report layout (CLAUDE.md rule 15) — groups in the order stock flows.
    layout: (() => {
      const G = (id, label, qty, rate, amt) => ({ id, label, fields: [qty, rate, amt], foldTo: amt });
      const groups = [
        G("open", "Opening", "opening_stock", "opening_rate", "opening_value"),
        G("pur", "Purchase", "purchase_qty", "purchase_rate", "purchase_amount"),
        G("purret", "Purchase return", "purchase_ret_qty", "purchase_ret_rate", "purchase_ret_amount"),
        G("prod", "Production", "material_production_qty", "material_production_rate", "material_production_amount"),
        { id: "blend", label: "Blended", fields: ["total_cost_rate"], foldTo: "total_cost_rate" },
        G("sale", "Sale", "sale_qty", "sale_cost_rate", "sale_cost_amount"),
        G("saleret", "Sale return", "sale_ret_qty", "sale_ret_rate", "sale_ret_amount"),
        G("pos", "POS", "pos_qty", "pos_rate", "pos_amount"),
        G("posret", "POS return", "pos_ret_qty", "pos_ret_rate", "pos_ret_amount"),
        G("issue", "Issue", "material_issuance_qty", "material_issuance_rate", "material_issuance_amount"),
        G("trfin", "Transfer in", "transfer_in_qty", "transfer_in_rate", "transfer_in_amount"),
        G("trfout", "Transfer out", "transfer_out_qty", "transfer_out_rate", "transfer_out_amount"),
        G("close", "Closing", "closing_qty", "closing_rate", "closing_value"),
      ];
      const pick = (n) => groups.flatMap((g) => (g.fields.length === 3 ? [g.fields[n]] : n === 1 ? g.fields : []));
      const sum = (row, fields) => fields.reduce((a, f) => a + (Number(row?.[f]) || 0), 0);
      const IN = ["purchase_qty", "material_production_qty", "sale_ret_qty", "pos_ret_qty", "transfer_in_qty"];
      const OUT = ["purchase_ret_qty", "sale_qty", "pos_qty", "material_issuance_qty", "transfer_out_qty"];
      return {
        pinned: ["product_code", "product_name"],
        groups,
        views: [
          { id: "qty", label: "Quantities", fields: pick(0) },
          { id: "val", label: "Values", fields: pick(2) },
          { id: "rate", label: "Rates", fields: pick(1) },
          { id: "all", label: "Everything" },
        ],
        defaultView: "qty",
        rowGroupBy: "category",
        card: {
          title: "product_name",
          subtitle: "product_code",
          figures: [
            "closing_qty",
            "closing_value",
            { label: "In", value: (row) => sum(row, IN) },
            { label: "Out", value: (row) => sum(row, OUT) },
          ],
        },
      };
    })(),

    // Drill trail: an item's movements, same period and godown.
    drill: [
      {
        label: "Open stock ledger",
        href: (row, filters) =>
          stockLedgerHref({ item: row.product_code, dateFrom: filters.dateFrom, dateTo: filters.dateTo, godown: filters.godown }),
      },
    ],

    // Detail columns for expanded view
    detailColumns: [
      {
        field: "transaction_type",
        headerName: "Type",
        width: 30,
        valueGetter: (params) => {
          const typeMap = {
            4: "Purchase",
            6: "Sale",
            9: "Pur Return",
            10: "Sale Return",
            5: "POS",
            12: "POS Return",
            7: "Prod Issue",
            8: "Prod Output",
            11: "Transfer",
          };
          return typeMap[params.row.tran_code] || "Other";
        },
      },
      {
        field: "dated",
        headerName: "Date",
        width: 25,
        type: "date",
        valueGetter: (params) =>
          params.row.dated ? format(new Date(params.row.dated), "MMM dd, yyyy") : "",
      },
      {
        field: "vr_no",
        headerName: "VR No",
        width: 15,
      },
      {
        field: "invoice_no",
        headerName: "Invoice",
        width: 20,
      },
      {
        field: "party_name",
        headerName: "Party",
        width: 50,
      },
      {
        field: "qty",
        headerName: "Qty",
        width: 15,
        type: "number",
        cellClass: "text-right",
      },
      {
        field: "rate",
        headerName: "Rate",
        width: 15,
        type: "currency",
        cellClass: "text-right",
      },
      {
        field: "amount",
        headerName: "Amount",
        width: 20,
        type: "currency",
        cellClass: "text-right",
      },
      {
        field: "godown",
        headerName: "Godown",
        width: 30,
      },
    ],

    // Dynamic detail columns based on view mode
    getDetailColumns: (filters) => {
      const viewMode = filters?.viewMode;

      if (viewMode === "production") {
        return [
          {
            field: "process_order_no",
            headerName: "Process Order",
            width: 20,
          },
          {
            field: "batch_no",
            headerName: "Batch No",
            width: 15,
          },
          {
            field: "production_date",
            headerName: "Prod Date",
            width: 25,
            type: "date",
          },
          {
            field: "planned_qty",
            headerName: "Planned Qty",
            width: 15,
            type: "number",
            cellClass: "text-right",
          },
          {
            field: "actual_yield",
            headerName: "Actual Yield",
            width: 15,
            type: "number",
            cellClass: "text-right",
          },
          {
            field: "yield_percentage",
            headerName: "Yield %",
            width: 12,
            type: "percent",
            cellClass: "text-right",
            valueGetter: (params) => {
              if (params.row.planned_qty > 0) {
                return (params.row.actual_yield * 100 / params.row.planned_qty);
              }
              return 0;
            },
          },
        ];
      }

      if (viewMode === "rawMaterials") {
        return [
          {
            field: "finished_product",
            headerName: "Used For",
            width: 40,
          },
          {
            field: "process_order_no",
            headerName: "Process Order",
            width: 20,
          },
          {
            field: "standard_qty",
            headerName: "Std Qty",
            width: 15,
            type: "number",
            cellClass: "text-right",
          },
          {
            field: "actual_qty_issued",
            headerName: "Actual Qty",
            width: 15,
            type: "number",
            cellClass: "text-right",
          },
          {
            field: "variance_percentage",
            headerName: "Variance %",
            width: 15,
            type: "percent",
            cellClass: "text-right",
            cellRenderer: (params) => {
              const value = params.value || 0;
              const color = value > 0 ? "text-danger" : value < 0 ? "text-success" : "";
              return `<span class="${color}">${value.toFixed(2)}%</span>`;
            },
          },
        ];
      }

      return []; // Default to no detail columns for other views
    },

    // Summary fields
    summaryFields: [
      { field: "total_items", label: "Total Items", type: "number" },
      { field: "finished_goods", label: "Finished Goods", type: "number" },
      { field: "raw_materials", label: "Raw Materials", type: "number" },
      { field: "opening_stock_total", label: "Opening Stock", type: "number" },
      { field: "opening_value_total", label: "Opening Value", type: "currency" },
      { field: "total_purchase_qty", label: "Total Purchased", type: "number" },
      { field: "total_purchase_amount", label: "Purchase Value", type: "currency" },
      { field: "total_sale_qty", label: "Total Sold", type: "number" },
      { field: "total_production_qty", label: "Total Produced", type: "number" },
      { field: "total_production_value", label: "Production Value", type: "currency" },
      { field: "total_raw_material_used", label: "Raw Mat Used", type: "number" },
      { field: "total_issue_value", label: "Issue Value", type: "currency" },
      { field: "total_sales_cost_value", label: "Sales Cost Value", type: "currency" },
      { field: "closing_stock_total", label: "Closing Stock", type: "number" },
      { field: "closing_value_total", label: "Closing Value", type: "currency" },
      // { field: "gross_profit", label: "Gross Profit", type: "currency" },
      // {
      //   field: "average_stock_days",
      //   label: "Avg Stock Days",
      //   type: "number",
      //   format: (value) => value.toFixed(1)
      // },
    ],

    // Chart configuration
    charts: {
      enabled: true,
      types: ["pie", "bar", "line"],
      defaultType: "bar",
      dataPoints: [
        { label: "Opening Stock", field: "opening_stock_total" },
        { label: "Purchases", field: "total_purchase_qty" },
        { label: "Sales", field: "total_sale_qty" },
        { label: "Production", field: "total_production_qty" },
        { label: "Closing Stock", field: "closing_stock_total" },
      ],
    },

    // Drill-down configuration
    drillDown: {
      enabled: true,
      actions: [
        {
          label: "View Stock Ledger",
          icon: "📊",
          action: (row) => {
            return `/accounting/reports/stockLedger?item=${row.product_code}&dateFrom=${row.dateFrom}&dateTo=${row.dateTo}`;
          },
        },
        {
          label: "View Production Details",
          icon: "🏭",
          action: (row) => {
            if (row.item_type === "FINISHED_GOOD" || row.item_type === "RAW_MATERIAL") {
              return `/production/reports/productionCosting?item=${row.product_code}`;
            }
            return null;
          },
          condition: (row) => row.item_type === "FINISHED_GOOD" || row.item_type === "RAW_MATERIAL",
        },
        {
          label: "View Transactions",
          icon: "📋",
          action: (row) => {
            return `/accounting/transactions?item=${row.product_code}`;
          },
        },
      ],
    },

    // Export options with enhanced formatting
    exportOptions: {
      pdf: {
        enabled: true,
        orientation: "landscape",
        title: "Stock Activity Report",
        header: {
          title: "Stock Activity Analysis",
          subtitle: "Comprehensive stock movement and production analysis",
          logo: true,
          dateRange: true,
          filters: true,
        },
        footer: {
          pageNumbers: true,
          timestamp: true,
          companyInfo: true,
        },
      },
      excel: {
        enabled: true,
        worksheets: [
          {
            name: "Stock Summary",
            includeAll: true,
          },
          {
            name: "Production Details",
            condition: (data) => data.some(item => item.item_type === "FINISHED_GOOD"),
            fields: ["product_code", "product_name", "production_plans", "material_production_qty", "material_issuance_qty"],
          },
          {
            name: "Raw Materials",
            condition: (data) => data.some(item => item.item_type === "RAW_MATERIAL"),
            fields: ["product_code", "product_name", "raw_material_consumption", "material_issuance_qty", "stock_balance"],
          },
        ],
        formatting: {
          numberFormat: "#,##0.00",
          currencyFormat: '"$"#,##0.00',
          percentFormat: "0.00%",
          autoFilter: true,
          freezePanes: true,
          columnWidths: true,
        },
      },
      csv: {
        enabled: true,
        filename: "stock_activity_report",
        delimiter: ",",
        includeHeaders: true,
      },
    },

    // Pagination and sorting
    pagination: {
      defaultPageSize: 50,
      pageSizeOptions: [25, 50, 100, 200],
      showTotal: true,
    },

    sorting: {
      defaultSort: [{ field: "product_name", sort: "asc" }],
      multiSort: true,
      sortableColumns: ["product_name", "category", "opening_stock", "stock_balance", "stock_value"],
    },

    filtering: {
      enabled: true,
      quickFilter: true,
      columnFilters: true,
      filterOptions: [
        {
          field: "item_type",
          type: "select",
          options: [
            { value: "", label: "All" },
            { value: "FINISHED_GOOD", label: "Finished Goods" },
            { value: "RAW_MATERIAL", label: "Raw Materials" },
            { value: "CONSUMABLE", label: "Consumables" },
          ],
        },
        {
          field: "stock_balance",
          type: "range",
          min: 0,
          max: 10000,
          step: 100,
        },
      ],
    },

    // Additional features
    features: {
      rowGrouping: true,
      pivotMode: false,
      fullScreen: true,
      columnChooser: true,
      density: true,
      refresh: true,
      print: true,
      email: true,
      saveView: true,
    },

    // Toolbar configuration
    toolbar: [
      "export",
      "print",
      "refresh",
      "columnChooser",
      "density",
      "fullScreen",
      "charts",
      "filters",
      "search",
    ],

    // Column groups for better organization
    columnGroups: [
      {
        groupId: "basic",
        headerName: "Basic Info",
        children: ["product_code", "product_name", "category", "item_type"],
        openByDefault: true,
      },
      {
        groupId: "opening",
        headerName: "Opening Stock",
        children: ["opening_stock", "opening_value"],
        openByDefault: true,
      },
      {
        groupId: "movements",
        headerName: "Stock Movements",
        children: ["purchase_qty", "sale_qty", "material_production_qty", "material_issuance_qty"],
        openByDefault: true,
      },
      {
        groupId: "closing",
        headerName: "Closing Stock",
        children: ["stock_balance", "stock_value", "avg_rate_after_purchase"],
        openByDefault: true,
      },
    ],

    // Default column visibility
    defaultVisibleColumns: [
      "product_code",
      "product_name",
      "category",
      "item_type",
      "opening_stock",
      "purchase_qty",
      "sale_qty",
      "stock_balance",
      "stock_value",
    ],

    // Additional settings
    settings: {
      showGridLines: true,
      alternatingRowColors: true,
      showRowNumbers: true,
      autoHeight: true,
      suppressRowHoverHighlight: false,
      animateRows: true,
      suppressDragLeaveHidesColumns: true,
      enableCellTextSelection: true,
      ensureDomOrder: true,
    },
  },


  // Production Costing Report (Complementary report)
  // productionCosting: {
  //   title: "Production Costing Report",
  //   description: "Detailed analysis of production costs and material consumption",
  //   apiEndpoint: "/api/reports/productionCosting",
  //   showSummary: true,

  //   filters: [
  //     {
  //       name: "dateFrom",
  //       label: "From Date",
  //       type: "date",
  //       required: true,
  //       default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
  //     },
  //     {
  //       name: "dateTo",
  //       label: "To Date",
  //       type: "date",
  //       required: true,
  //       default: new Date(),
  //     },
  //     {
  //       name: "processOrder",
  //       label: "Process Order No",
  //       type: "select",
  //       options: "processOrders",
  //       apiEndpoint: "/api/voucher/productionPlan",
  //       valueKey: "id",
  //       nameKey: "id",
  //       clearable: true,
  //     },
  //     {
  //       name: "batchNo",
  //       label: "Batch No",
  //       type: "select",
  //       options: "batches",
  //       apiEndpoint: "/api/quality/batches",
  //       valueKey: "batch_no",
  //       nameKey: "batch_no",
  //       clearable: true,
  //     },
  //     {
  //       name: "finishedProduct",
  //       label: "Finished Product",
  //       type: "select",
  //       options: "finishedProducts",
  //       apiEndpoint: "/api/setup/items?type=FINISHED",
  //       valueKey: "itcd",
  //       nameKey: "item",
  //       clearable: true,
  //     },
  //     {
  //       name: "rawMaterial",
  //       label: "Raw Material",
  //       type: "select",
  //       options: "rawMaterials",
  //       apiEndpoint: "/api/setup/items?type=RAW",
  //       valueKey: "itcd",
  //       nameKey: "item",
  //       clearable: true,
  //     },
  //   ],

  //   columns: [
  //     {
  //       field: "process_order_no",
  //       headerName: "Process Order",
  //       width: 25,
  //       pinned: "left",
  //     },
  //     {
  //       field: "batch_no",
  //       headerName: "Batch No",
  //       width: 20,
  //     },
  //     {
  //       field: "production_date",
  //       headerName: "Prod Date",
  //       width: 25,
  //       type: "date",
  //       valueGetter: (params) =>
  //         params.row.production_date ? format(new Date(params.row.production_date), "MMM dd, yyyy") : "",
  //     },
  //     {
  //       field: "finished_product",
  //       headerName: "Finished Product",
  //       width: 50,
  //     },
  //     {
  //       field: "planned_qty",
  //       headerName: "Planned Qty",
  //       width: 20,
  //       type: "number",
  //       cellClass: "text-right",
  //     },
  //     {
  //       field: "actual_yield",
  //       headerName: "Actual Yield",
  //       width: 20,
  //       type: "number",
  //       cellClass: "text-right",
  //     },
  //     {
  //       field: "yield_percentage",
  //       headerName: "Yield %",
  //       width: 15,
  //       type: "percent",
  //       cellClass: "text-right",
  //       cellRenderer: (params) => {
  //         const value = params.value || 0;
  //         const color = value >= 95 ? "text-success" : value >= 90 ? "text-warning" : "text-danger";
  //         return `<span class="${color}">${value.toFixed(2)}%</span>`;
  //       },
  //     },
  //     {
  //       field: "standard_material_cost",
  //       headerName: "Std Mat Cost",
  //       width: 25,
  //       type: "currency",
  //       cellClass: "text-right",
  //     },
  //     {
  //       field: "actual_material_cost",
  //       headerName: "Act Mat Cost",
  //       width: 25,
  //       type: "currency",
  //       cellClass: "text-right",
  //     },
  //     {
  //       field: "qty_variance",
  //       headerName: "Qty Variance",
  //       width: 20,
  //       type: "number",
  //       cellClass: "text-right",
  //       cellRenderer: (params) => {
  //         const value = params.value || 0;
  //         const color = value <= 0 ? "text-success" : "text-danger";
  //         const sign = value > 0 ? "+" : "";
  //         return `<span class="${color}">${sign}${value.toFixed(2)}</span>`;
  //       },
  //     },
  //     {
  //       field: "production_cost_per_unit",
  //       headerName: "Cost/Unit",
  //       width: 20,
  //       type: "currency",
  //       cellClass: "text-right",
  //     },
  //   ],

  //   detailColumns: [
  //     {
  //       field: "material_name",
  //       headerName: "Material",
  //       width: 60,
  //     },
  //     {
  //       field: "standard_qty",
  //       headerName: "Std Qty",
  //       width: 20,
  //       type: "number",
  //       cellClass: "text-right",
  //     },
  //     {
  //       field: "issued_qty",
  //       headerName: "Act Qty",
  //       width: 20,
  //       type: "number",
  //       cellClass: "text-right",
  //     },
  //     {
  //       field: "issued_value",
  //       headerName: "Act Cost",
  //       width: 25,
  //       type: "currency",
  //       cellClass: "text-right",
  //     },
  //     {
  //       field: "avg_rate",
  //       headerName: "Avg Rate",
  //       width: 20,
  //       type: "currency",
  //       cellClass: "text-right",
  //     },
  //     {
  //       field: "variance",
  //       headerName: "Variance",
  //       width: 20,
  //       cellClass: "text-right",
  //       valueGetter: (params) => {
  //         if (params.row.standard_qty > 0) {
  //           return ((params.row.issued_qty - params.row.standard_qty) * 100 / params.row.standard_qty);
  //         }
  //         return 0;
  //       },
  //       cellRenderer: (params) => {
  //         const value = params.value || 0;
  //         const color = value <= 0 ? "text-success" : "text-danger";
  //         const sign = value > 0 ? "+" : "";
  //         return `<span class="${color}">${sign}${value.toFixed(2)}%</span>`;
  //       },
  //     },
  //   ],

  //   summaryFields: [
  //     { field: "total_orders", label: "Total Orders", type: "number" },
  //     { field: "total_planned_qty", label: "Total Planned Qty", type: "number" },
  //     { field: "total_actual_yield", label: "Total Actual Yield", type: "number" },
  //     { field: "average_yield_percentage", label: "Avg Yield %", type: "percent" },
  //     { field: "total_standard_cost", label: "Total Std Cost", type: "currency" },
  //     { field: "total_actual_cost", label: "Total Act Cost", type: "currency" },
  //     { field: "total_cost_variance", label: "Total Cost Variance", type: "currency" },
  //     { field: "average_cost_per_unit", label: "Avg Cost/Unit", type: "currency" },
  //   ],

  //   exportOptions: {
  //     pdf: true,
  //     excel: true,
  //     csv: false,
  //   },
  // },

  // ─── Cost of Goods Sold ──────────────────────────────────────────────────
  costOfGoodsSold: {
    title: "Cost of Goods Sold (COGS)",
    description: "Period COGS per product: Sale vs RM Cost vs Conversion Cost (CC, finished goods only) — Margin analysis",
    apiEndpoint: "/api/reports/costOfGoodsSold",
    showSummary: true,

    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        required: true,
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        required: true,
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
      },
      {
        name: "product",
        label: "Product",
        type: "select",
        options: "products",
        default: { value: "", label: "All Products" },
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["itcd", "item", "code"],
        separator: " - ",
        clearable: true,
      },
      {
        name: "category",
        label: "Category",
        type: "select",
        options: "itemCategories",
        default: { value: "", label: "All Categories" },
        apiEndpoint: "/api/setup/item_categories",
        nameKey: "ic_name",
        clearable: true,
      },
      {
        name: "showZeroStock",
        label: "Include Zero-Movement Items",
        type: "checkbox",
        default: false,
      },
      {
        name: "showCC",
        label: "Show Conversion Cost (CC)",
        type: "checkbox",
        default: false,
      },
    ],

    columns: [
      { field: "product_code", headerName: "Code", width: 15, pinned: "left" },
      { field: "product_name", headerName: "Description", width: 55, pinned: "left" },
      { field: "ink_code", headerName: "Ink Code", width: 30, type: "text", pinned: "left" },
      { field: "category", headerName: "Category", width: 28 },
      // Qty & Sale
      { field: "qty", headerName: "Qty", width: 13, type: "number", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
      { field: "sale_rate", headerName: "Sale Rate", width: 16, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
      { field: "sale_amount", headerName: "Sale Amount", width: 18, type: "currency", cellClass: "text-right font-semibold", valueFormatter: (p) => p.value ?? 0 },
      // RM Cost
      { field: "rm_rate", headerName: "RM Rate", width: 16, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
      { field: "rm_cost_amount", headerName: "RM Cost", width: 18, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },

      // Margin (before conversion cost)
      {
        field: "margin_rate",
        headerName: "Margin Rate (excl CC)",
        width: 16,
        type: "currency",
      },
      {
        field: "margin_amount",
        headerName: "Margin (excl CC)",
        width: 18,
        type: "currency",
      },
      {
        field: "gross_margin_pct",
        headerName: "Margin %",
        width: 13,
        type: "percent",
      },
      // Conversion Cost (finished goods only)
      {
        field: "cc_rate",
        headerName: "Con Cost Rate",
        width: 17,
        type: "currency",
      },
      {
        field: "cc_cost_amount",
        headerName: "Con Cost",
        width: 18,
        type: "currency",
      },
      // Total Cost
      {
        field: "total_cost_rate",
        headerName: "Total Cost Rate",
        width: 17,
        type: "currency",
      },
      {
        field: "total_cost_amount",
        headerName: "Total Cost",
        width: 18,
        type: "currency",
      },
      // Gross Profit (after deducting conversion cost)
      {
        field: "gross_profit_rate",
        headerName: "GP Rate",
        width: 16,
        type: "currency",
      },
      {
        field: "gross_profit_amount",
        headerName: "Gross Profit",
        width: 18,
        type: "currency",
        cellClass: "text-right font-semibold",
      },
      {
        field: "gross_profit_pct",
        headerName: "GP %",
        width: 13,
        type: "percent",
      },
      // // Closing
      // { field: "closing_qty",   headerName: "Close Qty",   width: 13, type: "number",   cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
      // { field: "closing_value", headerName: "Close Value", width: 18, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
    ],

    summaryFields: [
      { field: "total_items", label: "Total Items", type: "number" },
      { field: "total_sold_qty", label: "Total Sold Qty", type: "number" },
      { field: "total_revenue", label: "Total Revenue", type: "currency" },
      { field: "total_rm_cost", label: "Total RM Cost", type: "currency" },
      { field: "total_cc_cost", label: "Total CC Cost", type: "currency" },
      { field: "total_cost", label: "Total Cost", type: "currency" },
      { field: "total_margin", label: "Total Margin (excl CC)", type: "currency" },
      { field: "avg_gross_margin", label: "Avg Margin %", type: "percent" },
      { field: "total_gross_profit", label: "Total Gross Profit", type: "currency" },
      { field: "avg_gross_profit_pct", label: "Avg GP %", type: "percent" },
    ],

    getColumns(filters) {
      if (!filters?.showCC) {
        return this.columns.filter((col) => !["cc_rate", "cc_cost_amount", "rm_rate", "total_cost_rate", "gross_profit_rate"].includes(col.field));
      }
      return this.columns;
    },

    // Toolbar action → POST /api/reports/costOfGoodsSold { action:"postJV" }
    // Builds a balanced Journal Voucher (tran_code 3):
    //   Dr  COGS account (49)      = Σ total cost
    //   Cr  item stock_acno        = Σ total cost (merged by GL)
    postJV: {
      tag: "COGS",
      label: "Post COGS JV",
      confirmTitle: "Post Cost of Goods Sold Journal Voucher",
      confirmMessage:
        "This creates a balanced Journal Voucher (JV / tran_code 3) for the selected period: DEBIT the COGS account (49) and CREDIT each item's stock account for the total cost. Lines sharing the same GL account are merged. Continue?",
    },

    exportOptions: { pdf: true, excel: true, csv: true },
  },

  // ─── Direct Material Issuance Cost ───────────────────────────────────────
  directMaterialIssuanceCost: {
    title: "Direct Material Issuance Cost",
    description:
      "Directly-posted material issuances (tran_code 7, not linked to a production plan) valued at the blended cost rate from Stock Activity With Rate — with a Post JV action",
    apiEndpoint: "/api/reports/directMaterialIssuanceCost",
    showSummary: true,

    filters: [
      {
        name: "month",
        label: "Month",
        type: "select",
        options: [
          { value: "1", label: "January" }, { value: "2", label: "February" },
          { value: "3", label: "March" }, { value: "4", label: "April" },
          { value: "5", label: "May" }, { value: "6", label: "June" },
          { value: "7", label: "July" }, { value: "8", label: "August" },
          { value: "9", label: "September" }, { value: "10", label: "October" },
          { value: "11", label: "November" }, { value: "12", label: "December" },
        ],
        default: { value: String(new Date().getMonth() + 1), label: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][new Date().getMonth()] },
      },
      {
        name: "year",
        label: "Year",
        type: "select",
        options: Array.from({ length: 5 }, (_, i) => ({
          value: String(new Date().getFullYear() - i),
          label: String(new Date().getFullYear() - i),
        })),
        default: { value: String(new Date().getFullYear()), label: String(new Date().getFullYear()) },
      },
    ],

    columns: [
      { field: "product_code", headerName: "Item #", width: 15, type: "text" },
      { field: "product_name", headerName: "Item", width: 60 },
      { field: "issuance_type_label", headerName: "Type", width: 20 },
      { field: "issue_qty", headerName: "Issued Qty", width: 22, type: "number", cellClass: "text-right" },
      { field: "blended_rate", headerName: "Blended Rate", width: 22, type: "currency", cellClass: "text-right" },
      { field: "total_cost_amount", headerName: "Cost", width: 24, type: "currency", cellClass: "text-right font-semibold" },
      { field: "posted_amount", headerName: "Posted Amt", width: 22, type: "currency", cellClass: "text-right" },
      { field: "tran_count", headerName: "Vouchers", width: 14, type: "number" },
    ],

    summaryFields: [
      { field: "total_items", label: "Items", type: "number" },
      { field: "total_qty", label: "Total Issued Qty", type: "number" },
      { field: "total_cost", label: "Total Cost", type: "currency" },
    ],

    // Toolbar action → POST /api/reports/directMaterialIssuanceCost { action:"postJV" }
    // Builds a balanced Journal Voucher (tran_code 3):
    //   Dr  Stock Lost (384)  = Σ cost of Cleaning issuances
    //   Dr  QC Cost (78)      = Σ cost of Lab/QC issuances
    //   Cr  each item's stock_acno = Σ cost (merged by GL)
    postJV: {
      tag: "MATISS",
      label: "Post Material Issuance JV",
      confirmTitle: "Post Direct Material Issuance Journal Voucher",
      confirmMessage:
        "This creates a balanced Journal Voucher (JV / tran_code 3) for the selected month: DEBIT Stock Lost (384) for Cleaning issuances and QC Cost (78) for Lab/QC issuances, and CREDIT each item's stock account for the blended cost. Lines sharing the same GL account are merged. Continue?",
    },

    exportOptions: { pdf: true, excel: true, csv: true },
  },

  // ─── Cost of Goods Manufactured ──────────────────────────────────────────
  costOfGoodsManufactured: {
    title: "Cost of Goods Manufactured (COGM)",
    description: "Production cost by finished good: RM cost, Conversion Cost, and Net Cost — with summary and material-level detail views",
    apiEndpoint: "/api/reports/costOfGoodsManufactured",
    showSummary: true,

    filters: [
      {
        name: "month",
        label: "Month",
        type: "select",
        options: [
          { value: "1", label: "January" }, { value: "2", label: "February" },
          { value: "3", label: "March" }, { value: "4", label: "April" },
          { value: "5", label: "May" }, { value: "6", label: "June" },
          { value: "7", label: "July" }, { value: "8", label: "August" },
          { value: "9", label: "September" }, { value: "10", label: "October" },
          { value: "11", label: "November" }, { value: "12", label: "December" },
        ],
        default: { value: String(new Date().getMonth() + 1), label: ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][new Date().getMonth()] },
      },
      {
        name: "year",
        label: "Year",
        type: "select",
        options: Array.from({ length: 5 }, (_, i) => ({
          value: String(new Date().getFullYear() - i),
          label: String(new Date().getFullYear() - i),
        })),
        default: { value: String(new Date().getFullYear()), label: String(new Date().getFullYear()) },
      },
      {
        name: "product",
        label: "Materials",
        type: "select",
        options: "products",
        default: { value: "", label: "All Products" },
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["itcd", "item", "code"],
        separator: " - ",
        clearable: true,
      },
      {
        name: "category",
        label: "Category",
        type: "select",
        options: "itemCategories",
        default: { value: "", label: "All Categories" },
        apiEndpoint: "/api/setup/item_categories",
        nameKey: "ic_name",
        clearable: true,
      },
      {
        name: "viewMode",
        label: "View Mode",
        type: "select",
        options: [
          { value: "summary", label: "Summary (per Finished Good)" },
          { value: "detail", label: "Detail (per Material)" },
        ],
        default: { value: "summary", label: "Summary (per Finished Good)" },
      },
      {
        name: "plan_id",
        label: "Process Order #",
        type: "number",
        default: "",
        placeholder: "Filter by order number",
        clearable: true,
      },
    ],

    columns: [
      { field: "mm_no", headerName: "MM #", width: 12, pinned: "left", type: "text" },
      { field: "mm_description", headerName: "MM Description", width: 55, pinned: "left" },
      { field: "mm_code", headerName: "Code", width: 18 },
      { field: "category", headerName: "Category", width: 28 },
      // Detail-only columns (material breakdown)
      // { field: "material_itcd",  headerName: "Mat #",        width: 12, type: "text" },
      // { field: "material_name",  headerName: "Material",     width: 45 },
      // { field: "material_code",  headerName: "Mat Code",     width: 18 },
      // Common columns
      { field: "qty", showTotal: true, headerName: "Qty", width: 14, type: "number", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
      { field: "rm_rate", headerName: "RM Rate", width: 16, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
      { field: "rm_cost", showTotal: true, headerName: "RM Cost", width: 18, type: "currency", cellClass: "text-right font-semibold", valueFormatter: (p) => p.value ?? 0 },
      {
        field: "cc_rate",
        headerName: "CC Rate",
        width: 16,
        type: "currency",

      },
      {
        field: "cc_cost", showTotal: true,
        headerName: "CC Cost",
        width: 18,
        type: "currency",
      },
      {
        field: "net_rate",
        headerName: "Net Rate",
        width: 16,
        type: "currency",

      },
      {
        field: "net_cost", showTotal: true,
        headerName: "Net Cost",
        width: 18,
        type: "currency",

      },
      // Summary-only
      { field: "production_orders", showTotal: true, headerName: "Orders", width: 11, type: "number" },
    ],


    // Detail mode: finished product › process order › materials (row_type
    // stream from getCOGMReport in app/api/reports/[reportType]/route.js,
    // unchanged).
    getColumns: (filters) =>
      filterValue(filters?.viewMode) === "detail"
        ? [
            { field: "material_itcd", headerName: "Mat #", width: 12, type: "text" },
            { field: "material_name", headerName: "Material Description", width: 52 },
            { field: "material_code", headerName: "Mat Code", width: 16 },
            { field: "qty", headerName: "Qty", width: 14, type: "number", showTotal: true },
            { field: "rm_rate", headerName: "RM Rate", width: 15, type: "currency" },
            { field: "rm_cost", headerName: "RM Cost", width: 18, type: "currency", showTotal: true },
            { field: "cc_cost", headerName: "CC Cost", width: 18, type: "currency", showTotal: true },
            { field: "net_cost", headerName: "Net Cost", width: 18, type: "currency", showTotal: true },
          ]
        : REPORT_CONFIG.costOfGoodsManufactured.columns,
    // Wide-report layout (rule 15). Summary: one row per finished good by
    // category. Detail: grouped — the server's own figures are kept as the
    // subtotals because they are NOT sums of the material lines: a process
    // order's Qty is the finished quantity costed (not Σ material kg) and its
    // RM cost is qty × the order's actual RM rate; the product's figures sit on
    // its header row. Grand total = Σ products (= the summary cards).
    layout: (filters) =>
      filterValue(filters?.viewMode) === "detail"
        ? {
            pinned: ["material_itcd", "material_name"],
            groupRows: {
              levels: [
                {
                  header: "product_header",
                  title: "Finished product",
                  label: (h) =>
                    `${h.mm_no} · ${h.mm_description}${h.mm_code ? ` (${h.mm_code})` : ""}${h.category ? ` [${h.category}]` : ""} · ${h.production_orders} order(s)`,
                  totalFrom: "header",
                  subtotalLabel: (h) => `Total ${h.mm_description}`,
                },
                {
                  header: "po_header",
                  total: "po_total",
                  title: "Process order",
                  label: (h) => `Process Order No: ${h.plan_id}`,
                  keepTotal: true,
                  subtotalLabel: (h) => `Process order ${h.plan_id} total`,
                },
              ],
              detail: "material",
              grandTotal: "groups",
            },
            card: { title: "material_name", subtitle: "material_code", figures: ["qty", "rm_rate", "rm_cost"] },
          }
        : {
            pinned: ["mm_code", "mm_description"],
            groups: [
              { id: "rm", label: "Raw material", fields: ["rm_rate", "rm_cost"], foldTo: "rm_cost" },
              { id: "cc", label: "Conversion", fields: ["cc_rate", "cc_cost"], foldTo: "cc_cost" },
              { id: "net", label: "Net", fields: ["net_rate", "net_cost"], foldTo: "net_cost" },
            ],
            rowGroupBy: "category",
            card: { title: "mm_description", subtitle: "mm_code", figures: ["qty", "net_rate", "net_cost", "production_orders"] },
          },
    // Product row → its material breakdown (Detail view) for the same month.
    drill: [
      {
        label: "Open material detail",
        when: (row, filters) => !!row.mm_no && filterValue(filters?.viewMode) !== "detail",
        href: (row, filters) =>
          reportHref("costOfGoodsManufactured", { ...pickFilters(filters, ["month", "year", "category", "plan_id"]), product: row.mm_no, viewMode: "detail" }),
      },
    ],
    summaryFields: [
      { field: "total_items", label: "Finished Goods", type: "number" },
      { field: "total_production_orders", label: "Production Orders", type: "number" },
      { field: "total_qty", label: "Total Qty", type: "number" },
      { field: "total_rm_cost", label: "Total RM Cost", type: "currency" },
      { field: "total_cc_cost", label: "Total CC Cost", type: "currency" },
      { field: "total_net_cost", label: "Total Net Cost", type: "currency" },
      { field: "avg_net_rate", label: "Avg Net Rate", type: "currency" },
      { field: "cc_rate_per_unit", label: "CC Rate / Unit", type: "currency" },
    ],

    // Toolbar action → POST /api/reports/costOfGoodsManufactured { action:"postJV" }
    // Builds a balanced Journal Voucher (tran_code 3):
    //   Dr  finished good stock_acno = Σ net cost (RM + CC)
    //   Cr  raw-material stock_acno  = Σ RM cost   (merged by GL)
    //   Cr  Conversion Cost acct (221) = Σ CC cost
    postJV: {
      tag: "COGM",
      label: "Post COGM JV",
      confirmTitle: "Post Cost of Goods Manufactured Journal Voucher",
      confirmMessage:
        "This creates a balanced Journal Voucher (JV / tran_code 3) for the selected month: DEBIT each finished good's stock account with its net cost, CREDIT each raw material's stock account, and CREDIT the Conversion Cost account (221). Lines sharing the same GL account are merged. Continue?",
    },

    exportOptions: { pdf: true, excel: true, csv: true },
  },

  // ─── Sales Team MIS ────────────────────────────────────────────────────────
  salesTeamMis: {
    title: "Sales Team MIS",
    description: "Per-customer sales/recovery targets vs actuals, balances and overdue, by Sales Person and Customer Category",
    apiEndpoint: "/api/reports/salesTeamMis",
    showSummary: true,

    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        required: true,
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        required: true,
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
      },
      {
        name: "sale_person",
        label: "Sales Person",
        type: "select",
        multiple: true,
        options: "salesPersons",
        apiEndpoint: "/api/accounts/customer-sales-persons?scope=own",
        valueKey: "id",
        nameKey: "name",
        default: { value: "", label: "All Sales Persons" },
        clearable: true,
      },
      {
        name: "viewMode",
        label: "View Mode",
        type: "select",
        options: [
          { value: "summary", label: "Summary (Sales Person x Category)" },
          { value: "detail", label: "Detail (per Customer)" },
        ],
        default: { value: "detail", label: "Detail (per Customer)" },
      },
      {
        name: "viewBy",
        label: "Group By",
        type: "select",
        options: [
          { value: "bySalesPerson", label: "Sales Person wise" },
          { value: "byCustomer", label: "Customer wise" },
        ],
        default: { value: "bySalesPerson", label: "Sales Person wise" },
      },
    ],

    // Summary view (viewMode=summary). Group By decides the rows:
    //   Sales Person wise → one row per Sales Person x Category (columns below)
    //   Customer wise     → one row per customer (getColumns)
    getColumns: (filters) => {
      if (filterValue(filters?.viewMode) === "detail") return SALES_TEAM_MIS_DETAIL_COLUMNS;
      if (filters?.viewBy !== "byCustomer") return REPORT_CONFIG.salesTeamMis.columns;
      return [
        { field: "code", headerName: "Code", width: 12 },
        { field: "customer", headerName: "Customer", width: 32 },
        { field: "salesPersonName", headerName: "Sales Person", width: 22 },
        { field: "category", headerName: "Category", width: 18 },
        { field: "terms", headerName: "Terms", width: 10, type: "number" },
        { field: "targetQty", headerName: "Target Qty (Ton)", width: 18, type: "number" },
        { field: "dispatchTon", headerName: "Qty Ton", width: 16, type: "number" },
        { field: "dispatchKg", headerName: "Qty KG", width: 16, type: "number" },
        { field: "saleAmount", headerName: "Sale Amount", width: 20, type: "currency" },
        { field: "openingBalance", headerName: "Opening Balance", width: 20, type: "currency" },
        { field: "openingOverdue", headerName: "Opening OverDue", width: 20, type: "currency" },
        { field: "targetRecovery", headerName: "Target Recovery", width: 20, type: "currency" },
        { field: "actualRecovery", headerName: "Actual Recovery", width: 20, type: "currency" },
        { field: "recoveryPct", headerName: "Recovery %", width: 14 },
        { field: "lockedTargetRecovery", headerName: "Recovery Month", width: 22, type: "currency" },
        { field: "lockedOverdue", headerName: "Locked OverDue", width: 22, type: "currency" },
        { field: "currentBalance", headerName: "Current Balance", width: 20, type: "currency" },
        { field: "currentOverdue", headerName: "Current OverDue", width: 20, type: "currency" },
      ];
    },
    columns: [
      { field: "salesPersonName", headerName: "Sales Person", width: 30 },
      { field: "category", headerName: "Category", width: 22 },
      { field: "customerCount", headerName: "Customers", width: 16, type: "number" },
      { field: "targetQty", headerName: "Target Qty (Ton)", width: 18, type: "number" },
      { field: "dispatchTon", headerName: "Dispatch (Ton)", width: 16, type: "number" },
      { field: "dispatchKg", headerName: "Dispatch (KG)", width: 16, type: "number" },
      { field: "saleAmount", headerName: "Sale Amount", width: 20, type: "currency" },
      { field: "openingBalance", headerName: "Opening Balance", width: 20, type: "currency" },
      { field: "openingOverdue", headerName: "Opening OverDue", width: 20, type: "currency" },
      { field: "targetRecovery", headerName: "Target Recovery", width: 20, type: "currency" },
      { field: "actualRecovery", headerName: "Actual Recovery", width: 20, type: "currency" },
      { field: "recoveryPct", headerName: "Recovery %", width: 14 },
      { field: "lockedTargetRecovery", headerName: "Recovery Month", width: 22, type: "currency" },
      { field: "lockedOverdue", headerName: "Locked OverDue", width: 22, type: "currency" },
      { field: "currentBalance", headerName: "Current Balance", width: 20, type: "currency" },
      { field: "currentOverdue", headerName: "Current OverDue", width: 20, type: "currency" },
    ],


    // Wide-report layout (rule 15) for the Summary view mode. The API ends the
    // list with its own Grand Total row, so no column totals / row groups here
    // (they would count it twice).
    layout: fitLayout("salesTeamMis", (filters) => {
      const groups = [
        { id: "tvd", label: "Target vs dispatch", fields: ["customerCount", "targetQty", "dispatchTon", "dispatchKg", "saleAmount"] },
        { id: "rec", label: "Recovery", fields: ["targetRecovery", "actualRecovery", "recoveryPct", "lockedTargetRecovery"] },
        { id: "bal", label: "Balance", fields: ["openingBalance", "openingOverdue", "lockedOverdue", "currentBalance", "currentOverdue"], foldTo: "currentOverdue" },
      ];
      const figures = ["targetQty", "dispatchTon", "actualRecovery", "currentOverdue"];
      // Detail mode: Sales Person › Category › customers (Sales Person wise),
      // or the flat customer list (Customer wise — no header rows, so the
      // same spec simply yields no groups). Category / sales-person totals are
      // plain sums of the customers → dropped and recomputed; Recovery % is
      // re-derived as Σ actual ÷ Σ target.
      if (filterValue(filters?.viewMode) === "detail") {
        return {
          pinned: ["code", "customer"],
          groups: [
            { id: "status", label: "Status", fields: ["terms", "customerStatus", "reconStatus", "reconciliationRemarks"], foldTo: "customerStatus" },
            { id: "tvd", label: "Target vs dispatch", fields: ["targetQty", "dispatchTon", "dispatchKg", "saleAmount"] },
            { id: "rec", label: "Recovery", fields: ["targetRecovery", "actualRecovery", "recoveryPct", "lockedTargetRecovery"] },
            { id: "bal", label: "Balance", fields: ["openingOverdue", "currentOverdue", "lockedOverdue", "currentBalance"], foldTo: "currentOverdue" },
            { id: "who", label: "Sales person", fields: ["salesPersonName", "category"] },
          ],
          groupRows: {
            levels: [
              { header: "salesperson_header", total: "salesperson_total", title: "Sales Person", label: (h) => `Sales Person: ${h.salesPersonName}` },
              { header: "category_header", total: "category_total", title: "Category", label: (h) => `Customer Category: ${h.category}` },
            ],
            detail: "customer_row",
          },
          card: { title: "customer", subtitle: (r) => [r.code, r.salesPersonName, r.category].filter(Boolean).join(" · "), figures },
        };
      }
      if (filterValue(filters?.viewBy) === "byCustomer") {
        return {
          pinned: ["code", "customer"],
          groups: [{ id: "cust", label: "Customer", fields: ["salesPersonName", "category", "terms"] }, ...groups],
          card: { title: "customer", subtitle: (r) => [r.code, r.salesPersonName, r.category].filter(Boolean).join(" · "), figures },
        };
      }
      return {
        pinned: ["salesPersonName", "category"],
        groups,
        card: { title: "salesPersonName", subtitle: "category", figures },
      };
    }),
    // Customer row → that customer's Account Ledger for the same period.
    drill: [
      {
        label: "Open account ledger",
        when: (row) => !!row.code,
        href: (row, filters) => accountLedgerHref({ account: row.code, dateFrom: filters.dateFrom, dateTo: filters.dateTo }),
      },
    ],
    summaryFields: [
      { field: "customerCount", label: "Customers", type: "number" },
      { field: "targetQty", label: "Total Target Qty (Ton)", type: "number" },
      { field: "dispatchTon", label: "Total Dispatch (Ton)", type: "number" },
      { field: "saleAmount", label: "Total Sale Amount", type: "currency" },
      { field: "targetRecovery", label: "Total Target Recovery", type: "currency" },
      { field: "actualRecovery", label: "Total Actual Recovery", type: "currency" },
      { field: "recoveryPct", label: "Recovery %" },
      { field: "lockedTargetRecovery", label: "Total Recovery Month", type: "currency" },
      { field: "lockedOverdue", label: "Total Locked OverDue", type: "currency" },
      { field: "currentBalance", label: "Total Current Balance", type: "currency" },
      { field: "currentOverdue", label: "Total Current OverDue", type: "currency" },
    ],

    exportOptions: { pdf: true, excel: true, csv: true },
  },

  // ─── Stock Report With Cost ────────────────────────────────────────────────
  stockWithCost: {
    title: "Stock Report with Cost",
    description: "Current stock position valued at cost (opening rate / weighted average purchase rate)",
    apiEndpoint: "/api/reports/stockWithCost",
    showSummary: true,

    filters: [
      {
        name: "year",
        type: "select",
        label: "Year",
        options: generateYearOptions(),
        default: String(new Date().getFullYear()),
      },
      {
        name: "month",
        type: "select",
        label: "Month",
        options: generateMonthOptions(),
        default: String(new Date().getMonth() + 1),
      },
      {
        name: "product",
        label: "Product",
        type: "select",
        options: "products",
        default: { value: "", label: "All Products" },
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["itcd", "item", "code"],
        separator: " - ",
        clearable: true,
      },
      {
        name: "category",
        label: "Category",
        type: "select",
        options: "itemCategories",
        default: { value: "", label: "All Categories" },
        apiEndpoint: "/api/setup/item_categories",
        nameKey: "ic_name",
        clearable: true,
      },
      {
        name: "godown",
        label: "Godown",
        type: "select",
        options: "godowns",
        default: { value: "", label: "All Godowns" },
        apiEndpoint: "/api/setup/godowns?includeInactive=true",
        nameKey: "godown",
        clearable: true,
      },
    ],

    columns: [
      { field: "product_code", headerName: "Code", width: 14, pinned: "left" },
      { field: "product_name", headerName: "Product", width: 50, pinned: "left" },
      { field: "category", headerName: "Category", width: 28 },
      { field: "unit", headerName: "Unit", width: 10 },
      // { field: "godown_name", headerName: "Godown", width: 20 },
      // From MonthlyOpeningStock (qty per godown) + MonthlyOpeningRate (item rate)
      { field: "opening_qty", headerName: "Opening Qty", width: 16, type: "number", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
      { field: "rm_rate", headerName: "RM Rate", width: 14, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
      { field: "cc_rate", headerName: "CC Rate", width: 14, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
      { field: "opening_rate", headerName: "Opening Rate", width: 16, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
      { field: "rm_value", headerName: "RM Value", width: 16, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
      { field: "cc_cost", headerName: "CC Cost", width: 16, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
      { field: "opening_value", headerName: "Opening Value", width: 18, type: "currency", cellClass: "text-right font-bold", valueFormatter: (p) => p.value ?? 0 },
    ],

    summaryFields: [
      { field: "total_items", label: "Total Items", type: "number" },
      { field: "total_opening_qty", label: "Total Opening Qty", type: "number" },
      { field: "total_rm_value", label: "Total RM Value", type: "currency" },
      { field: "total_cc_cost", label: "Total CC Cost", type: "currency" },
      { field: "total_opening_value", label: "Opening Stock Value", type: "currency" },
    ],

    exportOptions: { pdf: true, excel: true, csv: true },
  },

  // ─── Cost of Sales (transaction-level) ────────────────────────────────────
  costOfSales: {
    title: "Cost of Sales",
    description: "Sale & POS transaction details with cost rate, COGS and gross profit per line",
    apiEndpoint: "/api/reports/costOfSales",
    showSummary: true,

    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0],
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        // default: new Date().toISOString().split("T")[0],
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
      },
      {
        name: "product",
        label: "Product",
        type: "select",
        options: "products",
        default: { value: "", label: "All Products" },
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["itcd", "item", "code"],
        separator: " - ",
        clearable: true,
      },
      {
        name: "category",
        label: "Category",
        type: "select",
        options: "itemCategories",
        default: { value: "", label: "All Categories" },
        apiEndpoint: "/api/setup/item_categories",
        nameKey: "ic_name",
        clearable: true,
      },
      {
        name: "godown",
        label: "Godown",
        type: "select",
        options: "godowns",
        default: { value: "", label: "All Godowns" },
        apiEndpoint: "/api/setup/godowns?includeInactive=true",
        nameKey: "godown",
        clearable: true,
      },
    ],

    columns: [
      { field: "dated", headerName: "Date", width: 16, type: "date", pinned: "left" },
      { field: "tran_type", headerName: "Type", width: 10 },
      { field: "vr_no", headerName: "Vr No", width: 12 },
      { field: "invoice_no", headerName: "Invoice", width: 16 },
      { field: "party_name", headerName: "Customer", width: 35 },
      { field: "godown_name", headerName: "Godown", width: 20 },
      { field: "product_code", headerName: "Code", width: 14 },
      { field: "product_name", headerName: "Product", width: 45, pinned: "left" },
      { field: "category", headerName: "Category", width: 25 },
      { field: "unit", headerName: "Unit", width: 10 },
      // Sales figures
      { field: "qty", headerName: "Qty", width: 12, type: "number", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
      { field: "sale_rate", headerName: "Sale Rate", width: 14, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
      { field: "sale_amount", headerName: "Sale Amt", width: 16, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
      // Cost figures
      { field: "cost_rate", headerName: "Cost Rate", width: 14, type: "currency", cellClass: "text-right", valueFormatter: (p) => p.value ?? 0 },
      {
        field: "cogs",
        headerName: "COGS",
        width: 16,
        type: "currency",
        cellClass: "text-right font-bold",
        valueFormatter: (p) => p.value ?? 0,
      },
      {
        field: "gross_profit",
        headerName: "Gross Profit",
        width: 16,
        type: "currency",
        cellClass: "text-right",
        valueFormatter: (p) => p.value ?? 0,
        cellRenderer: (params) => {
          const v = Number(params.value || 0);
          const cls = v >= 0 ? "text-emerald-700" : "text-red-600";
          return `<span class="${cls} font-semibold">${v.toLocaleString("en-US", { minimumFractionDigits: 2 })}</span>`;
        },
      },
      {
        field: "gross_margin_pct",
        headerName: "Margin %",
        width: 13,
        type: "percent",
        cellClass: "text-right",
        valueFormatter: (p) => p.value ?? 0,
        cellRenderer: (params) => {
          const v = Number(params.value || 0);
          const cls = v >= 20 ? "text-emerald-700" : v >= 10 ? "text-amber-600" : "text-red-600";
          return `<span class="${cls}">${v.toFixed(1)}%</span>`;
        },
      },
    ],

    summaryFields: [
      { field: "total_transactions", label: "Total Lines", type: "number" },
      { field: "total_invoices", label: "Sale Invoices", type: "number" },
      { field: "total_pos", label: "POS Sales", type: "number" },
      { field: "total_qty", label: "Total Qty Sold", type: "number" },
      { field: "total_sale_amount", label: "Total Revenue", type: "currency" },
      { field: "total_cogs", label: "Total COGS", type: "currency" },
      { field: "total_gross_profit", label: "Gross Profit", type: "currency" },
      { field: "avg_gross_margin", label: "Avg Margin %", type: "percent" },
    ],

    exportOptions: { pdf: true, excel: true, csv: true },
  },

  productionPlanning: {
    title: "Production Planning Report",
    description: "Raw material requirements based on monthly sales, with available stock and procurement gap",
    apiEndpoint: "/api/reports/productionPlanning",
    showSummary: true,
    detailData: "detail",

    filters: [
      {
        name: "year",
        type: "select",
        label: "Year",
        options: generateYearOptions(),
        default: String(new Date().getFullYear()),
      },
      {
        name: "month",
        type: "select",
        label: "Planning Month (GRN Month)",
        options: generateMonthOptions(),
        default: String(new Date().getMonth() + 1),
      },
    ],

    columns: [
      { field: "material_id", headerName: "MM#", width: 15 },
      { field: "material_code", headerName: "Code", width: 15 },
      { field: "material_name", headerName: "Raw Material", width: 40 },
      { field: "unit", headerName: "Unit", width: 12 },
      { field: "category", headerName: "Category", width: 18 },
      // { field: "finished_items",  headerName: "Used In (Finished)",  width: 40 },
      {
        field: "required_qty",
        headerName: "Required Qty",
        width: 20,
        type: "number",
        valueGetter: (params) => params.row.required_qty ?? 0,
      },
      {
        field: "available_stock",
        headerName: "Avail Stock (Opening)",
        width: 25,
        type: "number",
        valueGetter: (params) => params.row.available_stock ?? 0,
      },
      {
        field: "net_required",
        headerName: "Net Required",
        width: 20,
        type: "number",
        valueGetter: (params) => params.row.net_required ?? 0,
      },
      {
        field: "purchased_qty",
        headerName: "GRN / Purchased",
        width: 20,
        type: "number",
        valueGetter: (params) => params.row.purchased_qty ?? 0,
      },
      {
        field: "remaining_qty",
        headerName: "Remaining Gap",
        width: 20,
        type: "number",
        valueGetter: (params) => params.row.remaining_qty ?? 0,
      },
    ],

    summaryFields: [
      { field: "total_finished_items", label: "Finished Items Sold", type: "number" },
      { field: "total_raw_materials", label: "Raw Materials", type: "number" },
      { field: "total_required_qty", label: "Total Required", type: "number" },
      { field: "total_available_stock", label: "Total Available Stock", type: "number" },
      { field: "total_net_required", label: "Total Net Required", type: "number" },
      { field: "total_purchased_qty", label: "Total GRN/Purchased", type: "number" },
      { field: "total_remaining_qty", label: "Total Remaining Gap", type: "number" },
    ],

    exportOptions: { pdf: true, excel: true },
  },

  //  masterSample: {
  //   title: "Master Sample Report",
  //   description: "Master Sample Report",
  //   apiEndpoint: "/api/reports/masterSample",
  //   showSummary: true,
  //   detailData: "detail",

  //   filters: [
  //   {
  //       name: "dateFrom",
  //       label: "From Date",
  //       type: "date",
  //       default: new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString().split("T")[0],
  //     },
  //     {
  //       name: "dateTo",
  //       label: "To Date",
  //       type: "date",
  //       default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
  //     },

  //     {
  //       name: "item",
  //       label: "Item",
  //       type: "select",
  //       options: "products",
  //       default: { value: "", label: "All Items" },
  //       apiEndpoint: "/api/reports/mastersample",
  //       valueKey: "itcd",
  //       nameKey: "item",
  //       clearable: true,
  //     },
  //     {
  //       name: "alternate_id ",
  //       label: "Master Sample",
  //       type: "select",
  //       options: "products",
  //       default: { value: "", label: "Master Sample" },
  //       apiEndpoint: "/api/reports/mastersample",
  //       valueKey: "alternate_id",
  //       nameKey: "item",
  //       clearable: true,
  //     },

  //   ],

  //   columns: [
  //     { field: "valid_from", headerName: "valid_From Date", width: 15 },
  //     { field: "valid_to", headerName: "valid_To Date", width: 15 },
  //     { field: "itcd", headerName: "MM code", width: 40 },
  //     { field: "item", headerName: "Item", width: 12 },
  //     { field: "alternate_id", headerName: "Master Sample", width: 12 },
  //     { field: "batch_no", headerName: "Batch_No", width: 12 },
  //     { field: "batch_size", headerName: "Batch_size", width: 12 },

  //     {
  //       field: "alternate_id",
  //       headerName: "Master Sample_NO",
  //       width: 20,
  //       type: "number",
  //     },
  //   ],
  //   exportOptions: { pdf: true, excel: true },
  // },

  masterSample: {
    title: "Master Sample Report",
    description:
      "List of Master Samples",
    apiEndpoint: "/api/reports/masterSample",

    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth(), 1),
        required: true,
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        required: true,
      },
      {
        name: "item",
        label: "Item",
        type: "select",
        options: "products",
        default: { value: "", label: "All Items" },
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["itcd", "item", "code"],
        separator: " - ",
        clearable: true,
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "APPROVED", label: "Approved" },
          { value: "REJECTED", label: "Rejected" },
          { value: "DRAFT", label: "Draft" },
          { value: "REWORK", label: "Rework" },
          { value: "all", label: "All Statuses" },
        ],
        default: { value: "APPROVED", label: "Approved" },
        clearable: true,
      },
      {
        name: "batchNo",
        label: "Batch No",
        type: "select",
        options: "batches",
        apiEndpoint: "/api/forms/qualitycontrol",
        valueKey: "batch_no",
        nameKey: "batch_no",
        clearable: true,
      },
    ],
    dynamicColumns: true,

    // Base columns (will be extended with parameter columns from API)
    getColumns: (filters, parameterColumns = []) => {
      const baseColumns = [
        {
          field: "mfg_date",
          headerName: "MFG Date",
          width: 20,
          type: "date",
          valueGetter: (params) => {
            if (!params.row.mfg_date) return "";
            const date = new Date(params.row.mfg_date);
            const day = String(date.getDate()).padStart(2, "0");
            const month = format(date, "MMM").toUpperCase();
            const year = String(date.getFullYear()).slice(-2);
            return `${day}-${month}-${year}`;
          },
        },
        {
          field: "expiry_dae",
          headerName: "Expiry Date",
          width: 20,
          type: "date",
          valueGetter: (params) => {
            if (!params.row.expiry_date) return "";
            const date = new Date(params.row.expiry_date);
            const day = String(date.getDate()).padStart(2, "0");
            const month = format(date, "MMM").toUpperCase();
            const year = String(date.getFullYear()).slice(-2);
            return `${day}-${month}-${year}`;
          },
        },
        {
          field: "itcd",
          headerName: "ITCD",
          width: 15,
          type: "integer",
        },
        {
          field: "item_name",
          headerName: "PRODUCT",
          width: 40,
        },
        {
          field: "master_sample",
          headerName: "Master Sample #",
          width: 40,
        },
        {
          field: "batch_no",
          headerName: "BATCH_NO",
          width: 20,
          type: "string",
          valueGetter: (params) => params.row.batch_no?.toString() || ""
        },
        {
          field: "batch_size",
          headerName: "BATCH SIZE",
          width: 15,
          type: "float",
          valueGetter: (params) => params.row.batch_size || "",
        },
      ];

      const lastColumns = [
        // {
        //   field: "attempt_no",
        //   headerName: "ATTEMPT NO",
        //   width: 15,
        //   type: "number",
        //   valueGetter: (params) => params.row.attempt_no || "",
        // },
        {
          field: "attempt_date",
          headerName: "ATTEMPT DATE",
          width: 20,
          type: "date",
          valueGetter: (params) => {
            if (!params.row.attempt_date) return "-";
            return format(new Date(params.row.attempt_date), "MMM dd, yyyy");
          },
        },
        {
          field: "status",
          headerName: "STATUS",
          width: 20,
          valueGetter: (params) => params.row.status || "",
        },
        {
          field: "reject_reason",
          headerName: "REJECT REASON",
          width: 20,
          valueGetter: (params) => params.row.reject_reason || "-",
        },
      ];

      // If parameterColumns are provided from API, merge them with base columns
      if (parameterColumns && parameterColumns.length > 0) {
        return [...baseColumns, ...parameterColumns, ...lastColumns];
      }

      // Return only base columns if no parameters provided
      return [...baseColumns, ...lastColumns];
    },

    // No detail columns needed since everything is in main table
    // detailColumns: [],

    summaryFields: [
      { field: "total_qc_records", label: "Total QC Records", type: "number" },
      { field: "total_batch_size", label: "Total Batch Size", type: "number" },
      { field: "approved_count", label: "Approved", type: "number" },
      { field: "rejected_count", label: "Rejected", type: "number" },
      { field: "draft_count", label: "Draft", type: "number" },
      { field: "rework_count", label: "Rework", type: "number" },
    ],

    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },

  // ─── BATCH REPORTS ────────────────────────────────────────────────────────

  batchBalance: {
    title: "Batch Balance Report",
    description: "Current stock balance per batch per item per warehouse",
    apiEndpoint: "/api/reports/batchBalance",
    filters: [
      { name: "itcd", label: "Item", type: "select", apiEndpoint: "/api/setup/items", nameKey: "item", valueKey: "itcd" },
      { name: "godown", label: "Godown", type: "select", apiEndpoint: "/api/setup/godowns?includeInactive=true", nameKey: "godown", valueKey: "id" },
      { name: "batch_no", label: "Batch #", type: "text" },
      { name: "showEmpty", label: "Show Zero Balance", type: "checkbox" },
    ],
    columns: [
      { field: "item_name", label: "Item", type: "text" },
      { field: "unit", label: "Unit", type: "text" },
      { field: "godown_name", label: "Godown", type: "text" },
      { field: "batch_no", label: "Batch No", type: "text" },
      { field: "mfg_date", label: "Mfg Date", type: "date" },
      { field: "first_grn_at", label: "First GRN", type: "date" },
      { field: "qty_in", label: "Total In", type: "number" },
      { field: "qty_out", label: "Total Out", type: "number" },
      { field: "balance", label: "Balance", type: "number" },
      { field: "rate", label: "Rate", type: "number" },
      { field: "value", label: "Value", type: "number" },
    ],
    summaryFields: [
      { field: "total_batches", label: "Total Batches", type: "number" },
      { field: "total_balance", label: "Total Balance", type: "number" },
      { field: "total_value", label: "Total Value", type: "number" },
    ],
    exportOptions: { pdf: true, excel: true, csv: true },
  },

  batchLedger: {
    title: "Batch Ledger Report",
    description: "All IN/OUT movements for a specific batch",
    apiEndpoint: "/api/reports/batchLedger",
    filters: [
      { name: "itcd", label: "Item", type: "select", apiEndpoint: "/api/setup/items", nameKey: "item", valueKey: "itcd" },
      { name: "batch_no", label: "Batch #", type: "text" },
      { name: "godown", label: "Godown", type: "select", apiEndpoint: "/api/setup/godowns?includeInactive=true", nameKey: "godown", valueKey: "id" },
      { name: "dateFrom", label: "Date From", type: "date" },
      { name: "dateTo", label: "Date To", type: "date" },
    ],
    columns: [
      { field: "dated", label: "Date", type: "date" },
      { field: "tran_code", label: "Type", type: "text" },
      { field: "vr_no", label: "Vr #", type: "number" },
      { field: "item_name", label: "Item", type: "text" },
      { field: "godown_name", label: "Godown", type: "text" },
      { field: "batch_no", label: "Batch No", type: "text" },
      { field: "qty_in", label: "Qty In", type: "number" },
      { field: "qty_out", label: "Qty Out", type: "number" },
      { field: "balance", label: "Running Bal", type: "number" },
    ],
    summaryFields: [
      { field: "total_in", label: "Total In", type: "number" },
      { field: "total_out", label: "Total Out", type: "number" },
      { field: "net", label: "Net", type: "number" },
    ],
    exportOptions: { pdf: true, excel: true, csv: true },
  },

  // ─── CHANGELOG / AUDIT LOG REPORT ────────────────────────────────────────

  changelog: {
    title: "Changelog",
    description: "Field-level history of who changed what, across every model",
    apiEndpoint: "/api/reports/changelog",
    filters: [
      { name: "model_name", label: "Model", type: "text" },
      { name: "record_id", label: "Record ID", type: "text" },
      { name: "user_id", label: "User ID", type: "text" },
      { name: "dateFrom", label: "Date From", type: "date" },
      { name: "dateTo", label: "Date To", type: "date" },
    ],
    columns: [
      { field: "dated", headerName: "Date", type: "date" },
      { field: "model_name", headerName: "Model", type: "text" },
      { field: "record_id", headerName: "Record ID", type: "text" },
      { field: "action", headerName: "Action", type: "text" },
      { field: "user_name", headerName: "Changed By", type: "text" },
      { field: "changes", headerName: "Changes", type: "text" },
    ],
    summaryFields: [
      { field: "total", label: "Total Entries", type: "number" },
      { field: "creates", label: "Creates", type: "number" },
      { field: "updates", label: "Updates", type: "number" },
      { field: "deletes", label: "Deletes", type: "number" },
    ],
    exportOptions: { pdf: true, excel: true, csv: true },
  },

  // ─── PROCESS ORDER TIMING REPORT ─────────────────────────────────────────

  processOrderTiming: {
    title: "Process Order Timing Report",
    description: "Stage-by-stage timing for process orders — flags late stages",
    apiEndpoint: "/api/reports/processOrderTiming",
    filters: [
      { name: "dateFrom", label: "Date From", type: "date" },
      { name: "dateTo", label: "Date To", type: "date" },
      { name: "proc_ord_no", label: "Order #", type: "text" },
      { name: "lateOnly", label: "Late Only", type: "checkbox" },
    ],
    columns: [
      { field: "proc_ord_no", label: "Order #", type: "number" },
      { field: "item_name", label: "Item", type: "text" },
      { field: "stage", label: "Stage", type: "text" },
      { field: "scanned_at", label: "Scanned At", type: "date" },
      { field: "expected_at", label: "Expected At", type: "date" },
      { field: "is_late", label: "Late?", type: "text" },
      { field: "scanned_by", label: "Scanned By", type: "text" },
      { field: "delay_minutes", label: "Delay (min)", type: "number" },
    ],
    summaryFields: [
      { field: "total_scans", label: "Total Scans", type: "number" },
      { field: "late_count", label: "Late Stages", type: "number" },
      { field: "on_time_count", label: "On Time", type: "number" },
    ],
    exportOptions: { pdf: true, excel: true, csv: true },
  },

  // ─── Item Creation Report ───────────────────────────────────────────────────
  discard: {
    title: "Discard MM Report",
    description: "List of all created items with discard action for unused items",
    apiEndpoint: "/api/reports/discard",

    filters: [
      {
        name: "dateFrom",
        label: "From Date",
        type: "date",
        default: new Date(new Date().getFullYear() - 2, 0, 1), // 2 years back
        required: false,
      },
      {
        name: "dateTo",
        label: "To Date",
        type: "date",
        default: new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0),
        required: false,
      },
    ],

    getColumns: () => [
      {
        field: "itcd",
        headerName: "MM",
        width: 15,
        type: "integer",
        valueGetter: (params) => params.row.itcd || "",
      },
      {
        field: "item_name",
        headerName: "Item Name",
        width: 60,
        valueGetter: (params) => params.row.item_name || "",
      },
      {
        field: "alternate_id",
        headerName: "Master Sample",
        width: 60,
        valueGetter: (params) => params.row.alternate_id || "",
      },
      {
        field: "code",
        headerName: "Code",
        width: 30,
        valueGetter: (params) => params.row.code || "",
      },
      {
        field: "cdate",
        headerName: "Creation Date",
        width: 30,
        type: "date",
        valueGetter: (params) => {
          if (!params.row.cdate) return "";
          const date = new Date(params.row.cdate);
          if (isNaN(date.getTime())) return "";
          return format(date, "MMM dd, yyyy");
        },
      },
      {
        field: "canDiscard",
        headerName: "Status",
        width: 25,
        valueGetter: (params) =>
          params.row.canDiscard ? "Unused (1+ yr)" : "In Use",
      },
    ],

    // Discard row action — only visible for items not used in production for 1+ year
    rowActions: [
      {
        label: "Discard",
        variant: "destructive",
        className: "bg-red-600 hover:bg-red-700 text-white",
        show: (row) => row.canDiscard === true,
        confirm: (row) =>
          `"${row.item_name}" ko discard karna chahte hain?\n\nYeh item 1 saal se production plan mein use nahi hua.\nDiscard karne ke baad aap is naam se nayi item bana sakte hain.`,
        onClick: async (row) => {
          const res = await fetch(
            `/api/reports/discardItem?id=${row.itcd}`,
            { method: "PUT" }
          );
          if (!res.ok) {
            const err = await res.json();
            throw new Error(err.error || "Discard failed");
          }
        },
      },
    ],

    summaryFields: [
      { field: "total", label: "Total Items", type: "number" },
      { field: "canDiscard", label: "Discardable Items", type: "number" },
    ],

    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },
  salesPerformanceWeekly: {
    title: "Sales Performance Weekly Report",
    description: "Weekly target versus actual sales performance and recovery report",
    apiEndpoint: "/api/reports/salesPerformanceWeekly",
    filters: [
      {
        name: "month",
        label: "Month",
        type: "select",
        options: generateMonthOptions(),
        default: String(new Date().getMonth() + 1),
        required: true,
      },
      {
        name: "year",
        label: "Year",
        type: "select",
        options: generateYearOptions(),
        default: String(new Date().getFullYear()),
        required: true,
      },
      {
        name: "customer",
        label: "Customer",
        valueKey: "acno",
        type: "select",
        nameKeys: ["acno", "acname"],
        separator: " - ",
        options: "customers",
        default: { value: "", label: "All Customers" },
        apiEndpoint: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`,
        clearable: true,
      },
    ],
    columns: [
      { field: "customerName", headerName: "CUSTOMER", width: 85 },

      { field: "saleTargetQtyMonth", headerName: "SALE TARGET QTY MONTH", type: "number", width: 80, showTotal: true },
      { field: "recTargetAmtMonth", headerName: "REC TARGET AMT MONTH", type: "currency", width: 80, showTotal: true },
      { field: "saleActualQtyMonth", headerName: "SALE ACTUAL QTY MONTH", type: "number", width: 80, showTotal: true },
      { field: "recActualAmtMonth", headerName: "REC ACTUAL AMT MONTH", type: "currency", width: 80, showTotal: true },

      { field: "saleTargetQtyWeek1", headerName: "SALE TARGET QTY WEEK-1", type: "number", width: 80, showTotal: true },
      { field: "recTargetAmtWeek1", headerName: "REC TARGET AMT WEEK-1", type: "currency", width: 80, showTotal: true },
      { field: "saleActualQtyWeek1", headerName: "SALE ACTUAL QTY WEEK-1", type: "number", width: 80, showTotal: true },
      { field: "recActualAmtWeek1", headerName: "REC ACTUAL AMT WEEK-1", type: "currency", width: 80, showTotal: true },

      { field: "saleTargetQtyWeek2", headerName: "SALE TARGET QTY WEEK-2", type: "number", width: 80, showTotal: true },
      { field: "recTargetAmtWeek2", headerName: "REC TARGET AMT WEEK-2", type: "currency", width: 80, showTotal: true },
      { field: "saleActualQtyWeek2", headerName: "SALE ACTUAL QTY WEEK-2", type: "number", width: 80, showTotal: true },
      { field: "recActualAmtWeek2", headerName: "REC ACTUAL AMT WEEK-2", type: "currency", width: 80, showTotal: true },

      { field: "saleTargetQtyWeek3", headerName: "SALE TARGET QTY WEEK-3", type: "number", width: 80, showTotal: true },
      { field: "recTargetAmtWeek3", headerName: "REC TARGET AMT WEEK-3", type: "currency", width: 80, showTotal: true },
      { field: "saleActualQtyWeek3", headerName: "SALE ACTUAL QTY WEEK-3", type: "number", width: 80, showTotal: true },
      { field: "recActualAmtWeek3", headerName: "REC ACTUAL AMT WEEK-3", type: "currency", width: 80, showTotal: true },

      { field: "saleTargetQtyWeek4", headerName: "SALE TARGET QTY WEEK-4", type: "number", width: 80, showTotal: true },
      { field: "recTargetAmtWeek4", headerName: "REC TARGET AMT WEEK-4", type: "currency", width: 80, showTotal: true },
      { field: "saleActualQtyWeek4", headerName: "SALE ACTUAL QTY WEEK-4", type: "number", width: 80, showTotal: true },
      { field: "recActualAmtWeek4", headerName: "REC ACTUAL AMT WEEK-4", type: "currency", width: 80, showTotal: true },
    ],
    summaryFields: [
      { field: "saleTargetQtyMonth", label: "Sale Target Qty Month", type: "number" },
      { field: "recTargetAmtMonth", label: "Rec Target Amt Month", type: "currency" },
      { field: "saleActualQtyMonth", label: "Sale Actual Qty Month", type: "number" },
      { field: "recActualAmtMonth", label: "Rec Actual Amt Month", type: "currency" },
    ],
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },

  importedMaterialStock: {
    showSummary: true,
    title: "Imported Material Stock",
    description: "Imported material in bonded warehouse as of a date — In-Bond qty less Ex-Bond GRN qty",
    apiEndpoint: "/api/reports/importedMaterialStock",
    groupBy: "bank_name",
    filters: [
      {
        name: "dateTo",
        label: "As Of Date",
        type: "date",
        default: new Date(),
        required: true,
      },
      {
        name: "status",
        label: "Status",
        type: "select",
        options: [
          { value: "pending", label: "Balance in Bond (All Pending)" },
          { value: "in_bond", label: "In Bond (Nothing Released)" },
          { value: "partial", label: "Partially Released" },
          { value: "expired", label: "Bond Limit Expired" },
          { value: "released", label: "Fully Released" },
          { value: "over", label: "Over Released" },
          { value: "all", label: "All" },
        ],
        default: { value: "pending", label: "Balance in Bond (All Pending)" },
        clearable: false,
      },
      {
        name: "lc_no",
        label: "LC No",
        type: "select",
        options: "lcs",
        apiEndpoint: "/api/lc/options",
        valueKey: "lc_no",
        nameKeys: ["lc_no"],
        default: { value: "", label: "All LCs" },
        clearable: true,
      },
      {
        name: "bond_id",
        label: "Bond No",
        type: "select",
        options: "inboundEntries",
        apiEndpoint: "/api/inbond/options",
        valueKey: "id",
        nameKeys: ["bond_id", "lc"],
        separator: " - ",
        default: { value: "", label: "All Bonds" },
        clearable: true,
      },
      {
        name: "bond_location_id",
        label: "Bond Location",
        type: "select",
        options: "bondLocations",
        apiEndpoint: "/api/setup/bond_locations",
        valueKey: "id",
        nameKey: "location",
        default: { value: "", label: "All Locations" },
        clearable: true,
      },
      {
        name: "itcd",
        label: "Item",
        type: "select",
        options: "products",
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["code", "item"],
        separator: " - ",
        default: { value: "", label: "All Items" },
        clearable: true,
      },
      {
        name: "import_type",
        label: "Import Type",
        type: "select",
        clearable: true,
        options: [
          { value: "LC", label: "LC" },
          { value: "CONT", label: "CONT" },
        ],
      },
    ],
    columns: [
      { field: "lc_no", headerName: "LC No", width: 30 },
      { field: "lc_date", headerName: "LC Date", width: 25 },
      { field: "import_type", headerName: "Type", width: 18 },
      { field: "bond_no", headerName: "BL No", width: 28 },
      { field: "bond_location", headerName: "Bond Location", width: 35 },
      { field: "into_bond_date", headerName: "Into Bond", width: 25 },
      { field: "bond_limit", headerName: "Bond Limit", width: 25 },
      { field: "days_to_limit", headerName: "Days Left", width: 20, type: "number" },
      { field: "code", headerName: "Code", width: 20 },
      { field: "material_description", headerName: "Material Description", width: 90 },
      { field: "unit", headerName: "Unit", width: 15 },
      { field: "inbond_qty", headerName: "In-Bond Qty", width: 28, type: "number" },
      { field: "released_qty", headerName: "Ex-Bond (GRN) Qty", width: 30, type: "number" },
      { field: "balance_qty", headerName: "Balance Qty", width: 28, type: "number" },
      { field: "last_grn_date", headerName: "Last GRN", width: 25 },
      { field: "rate", headerName: "FC Rate", width: 22, type: "number" },
      { field: "fc_amount", headerName: "Balance FC Amt", width: 32, type: "number" },
      { field: "exc_rate", headerName: "Exch Rate", width: 22, type: "number" },
      { field: "pkr_amount", headerName: "Balance PKR Amt", width: 35, type: "number" },
      { field: "status", headerName: "Status", width: 35, type: "badge" },
    ],
    summaryFields: [
      { field: "total_inbond_qty", label: "Total In-Bond Qty", type: "number" },
      { field: "total_released_qty", label: "Total Ex-Bond Qty", type: "number" },
      { field: "total_balance_qty", label: "Balance in Bond", type: "number" },
      { field: "total_fc_amount", label: "Balance FC Amount", type: "number" },
      { field: "total_pkr_amount", label: "Balance PKR Amount", type: "number" },
      { field: "in_bond_lines", label: "In Bond", type: "number" },
      { field: "partial_lines", label: "Partially Released", type: "number" },
      { field: "expired_lines", label: "Bond Limit Expired", type: "number" },
      { field: "released_lines", label: "Fully Released", type: "number" },
    ],
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },

  importedMaterialinTransit: {
    showSummary: true,
    title: "Imported Material in Transit",
    description: "Shipped L/Cs (B/L Date given) that have not landed. An L/C drops off as soon as it has an In-Bond entry or a GRN. Status merges the stages reached, e.g. In Transit, ETA Passed, Docs Arrived.",
    apiEndpoint: "/api/reports/importedMaterialinTransit",
    groupBy: "bank_name",
    filters: [
      ...LC_STAGE_DATE_FILTERS,
      ...LC_STAGE_COMMON_FILTERS,
    ],
    columns: [
      { field: "lc_no", headerName: "LC No", width: 28 },
      { field: "lc_date", headerName: "LC Date", width: 22 },
      { field: "import_type", headerName: "Type", width: 16 },
      { field: "beneficiary", headerName: "Beneficiary", width: 50 },
      { field: "bl_no", headerName: "B/L No", width: 38 },
      { field: "bl_date", headerName: "B/L Date", width: 22 },
      { field: "days_since_shipment", headerName: "Days Since Ship", width: 20, type: "number" },
      { field: "vessel", headerName: "Vessel", width: 40 },
      { field: "voyage", headerName: "Voyage", width: 20 },
      { field: "ship_company", headerName: "Shipping Co", width: 40 },
      { field: "etd", headerName: "ETD", width: 22 },
      { field: "eta", headerName: "ETA", width: 22 },
      { field: "doc_arr_date", headerName: "Doc Arrival", width: 22 },
      { field: "doc_rtd_due_date", headerName: "Doc Rtd Due", width: 22 },
      { field: "doc_rtd_date", headerName: "Doc Rtd", width: 22 },
      { field: "code", headerName: "Code", width: 18 },
      { field: "material_description", headerName: "Material Description", width: 80 },
      { field: "qty", headerName: "Qty", width: 22, type: "number" },
      { field: "curr", headerName: "Curr", width: 14 },
      { field: "rate", headerName: "FC Rate", width: 20, type: "number" },
      { field: "fc_amount", headerName: "FC Amount", width: 30, type: "number" },
      { field: "exc_rate", headerName: "Exch Rate", width: 20, type: "number" },
      { field: "pkr_amount", headerName: "PKR Amount", width: 35, type: "number" },
      { field: "remarks", headerName: "Remarks", width: 45 },
      { field: "status", headerName: "Status", width: 32, type: "badge" },
    ],
    summaryFields: [
      { field: "total_lcs", label: "Total LCs", type: "number" },
      { field: "total_qty", label: "Total Qty", type: "number" },
      { field: "total_fc_amount", label: "Total FC Amount", type: "number" },
      { field: "total_pkr_amount", label: "Total PKR Amount", type: "number" },
      { field: "eta_passed_lcs", label: "ETA Passed", type: "number" },
      { field: "docs_arrived_lcs", label: "Docs Arrived", type: "number" },
    ],
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },

  importedMaterialDeals: {
    showSummary: true,
    title: "Imported Material Deals in Process",
    description: "L/Cs not yet shipped (no BL Date) with expiry status",
    apiEndpoint: "/api/reports/importedMaterialDeals",
    groupBy: "bank_name",
    filters: [
      ...LC_STAGE_DATE_FILTERS,
      ...LC_STAGE_COMMON_FILTERS,
    ],
    columns: [
      { field: "lc_no", headerName: "LC No", width: 28 },
      { field: "lc_date", headerName: "LC Date", width: 22 },
      { field: "import_type", headerName: "Type", width: 16 },
      { field: "lc_exp_date", headerName: "LC Expiry", width: 22 },
      { field: "days_to_expiry", headerName: "Days to Expiry", width: 20, type: "number" },
      { field: "beneficiary", headerName: "Beneficiary", width: 50 },
      { field: "terms", headerName: "Terms", width: 20 },
      { field: "indent_no", headerName: "Indent No", width: 25 },
      { field: "per_inv_no", headerName: "Proforma Inv No", width: 30 },
      { field: "per_inv_date", headerName: "Proforma Inv Date", width: 22 },
      { field: "inc_no", headerName: "MCN No", width: 40 },
      { field: "roi_no", headerName: "ROI No", width: 22 },
      { field: "code", headerName: "Code", width: 18 },
      { field: "material_description", headerName: "Material Description", width: 80 },
      { field: "qty", headerName: "Qty", width: 22, type: "number" },
      { field: "curr", headerName: "Curr", width: 14 },
      { field: "rate", headerName: "FC Rate", width: 20, type: "number" },
      { field: "fc_amount", headerName: "FC Amount", width: 30, type: "number" },
      { field: "exc_rate", headerName: "Exch Rate", width: 20, type: "number" },
      { field: "pkr_amount", headerName: "PKR Amount", width: 35, type: "number" },
      { field: "status", headerName: "Status", width: 28, type: "badge" },
    ],
    summaryFields: [
      { field: "total_lcs", label: "Total LCs", type: "number" },
      { field: "total_qty", label: "Total Qty", type: "number" },
      { field: "total_fc_amount", label: "Total FC Amount", type: "number" },
      { field: "total_pkr_amount", label: "Total PKR Amount", type: "number" },
      { field: "open_lcs", label: "Open Deals", type: "number" },
      { field: "expiring_lcs", label: "Expiring Soon", type: "number" },
      { field: "expired_lcs", label: "LC Expired", type: "number" },
    ],
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },


  materialprocurement: {
    title: "Material Procurement",
    description:
      "Six months of consumption ending in the month chosen, against what is in stock, in bond and at sea — and the order quantity that implies. Local and imported are reported separately.",
    apiEndpoint: "/api/reports/materialprocurement",
    showSummary: true,
    showEmptyTable: true,
    filters: [
      // The user picks the closing month; the report always covers the six
      // months ending there. A free range would let someone pick four months
      // and still see the total divided by six.
      {
        name: "month",
        label: "Month (period ends here)",
        type: "select",
        options: generateMonthOptions(),
        default: String(new Date().getMonth() + 1),
        clearable: false,
        required: true,
      },
      {
        name: "year",
        label: "Year",
        type: "select",
        options: generateYearOptions(),
        default: String(new Date().getFullYear()),
        clearable: false,
        required: true,
      },
      {
        name: "product",
        label: "Product",
        type: "select",
        options: "products",
        default: { value: "", label: "All Products" },
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["code", "item"],
        separator: " - ",
        clearable: true,
      },
      {
        name: "category",
        label: "Category",
        type: "select",
        options: "main_categories",
        default: { value: "", label: "All Categories" },
        apiEndpoint: "/api/setup/main_categories",
        valueKey: "id",
        nameKeys: ["mc_name"],
        clearable: true,
      },
      {
        name: "import_type",
        label: "Local / Imported",
        type: "select",
        options: [
          { value: "LOCAL", label: "Local" },
          { value: "IMPORTED", label: "Imported" },
        ],
        default: { value: "", label: "Local & Imported" },
        clearable: true,
      },
    ],

    // The flat column set, used for the plain grid and as the basis of the
    // exports. Month columns follow the chosen period.
    getColumns: (filters = {}) => [
      { field: "category", headerName: "Category", width: 26 },
      { field: "code", headerName: "Code", width: 16 },
      { field: "product_description", headerName: "Product Description", width: 70 },
      { field: "avg_cons_6m", headerName: "Avg Cons 6 Month", width: 20, type: "number" },
      { field: "max_cons_6m", headerName: "Max Cons 6 Month", width: 20, type: "number" },
      { field: "opening_stock", headerName: "Opening Stock", width: 20, type: "number", showTotal: true },
      { field: "total_stock", headerName: "Total Stock", width: 20, type: "number", showTotal: true },
      { field: "stock_factory", headerName: "Stock Factory", width: 20, type: "number", showTotal: true },
      { field: "stock_prod", headerName: "Stock Prod", width: 18, type: "number", showTotal: true },
      { field: "stock_fg", headerName: "Stock FG", width: 18, type: "number", showTotal: true },
      { field: "stock_bond", headerName: "Stock Bond", width: 18, type: "number", showTotal: true },
      { field: "stock_transit", headerName: "Stock Transit", width: 20, type: "number", showTotal: true },
      { field: "re_order_level", headerName: "Re Order Level", width: 20, type: "number" },
      { field: "order_qty", headerName: "Order Qty", width: 18, type: "number", showTotal: true },
      { field: "stock_sufficient_months", headerName: "Stock Sufficient for Months", width: 24, type: "number" },
      ...procurementMonthCols(filters).map((c) => ({ ...c, showTotal: true })),
    ],

    // Wide-report layout (rule 15): flat material rows grouped into Local /
    // Imported / Unclassified with subtotals (lib/reports/materialProcurement.js).
    // No groupedDetailView. A material drills to its Stock Ledger for the
    // six-month period.
    layout: materialProcurementLayout,
    drill: [
      {
        label: "Open stock ledger",
        when: (row) => !!row.itcd,
        href: (row, filters) => {
          const cols = procurementMonthCols(filters);
          const [y1, m1] = cols[0].field.slice(2).split("_");
          const [y2, m2] = cols[cols.length - 1].field.slice(2).split("_");
          const last = new Date(Number(y2), Number(m2), 0).getDate();
          return stockLedgerHref({ item: row.itcd, dateFrom: `01-${m1}-${y1}`, dateTo: `${String(last).padStart(2, "0")}-${m2}-${y2}` });
        },
      },
    ],

    summaryFields: [
      { field: "total_items", label: "Materials", type: "number" },
      { field: "total_opening_stock", label: "Opening Stock", type: "number" },
      { field: "total_stock", label: "Total Stock", type: "number" },
      { field: "total_bond", label: "In Bond", type: "number" },
      { field: "total_transit", label: "In Transit", type: "number" },
      { field: "total_consumption", label: "Consumption (6 Months)", type: "number" },
      { field: "items_to_reorder", label: "Materials to Reorder", type: "number" },
      { field: "total_order_qty", label: "Total Order Qty", type: "number" },
    ],
    exportOptions: {
      pdf: true,
      excel: true,
      csv: false,
    },
  },
  materialprocurementenquiry: {
    title: "Material Procurement Enquiry",
    description:
      "One product: stock and consumption for the month chosen, and its purchase rates (min / max / last / average) over the last 6 months by default — each with the GRN, date and vendor behind it.",
    apiEndpoint: "/api/reports/materialprocurementenquiry",
    showEmptyTable: true,
    filters: [
      // A month, not a free date range: stock is as of its last day, MTD is
      // that month, and purchase rates look back from it.
      {
        name: "month",
        label: "Month",
        type: "select",
        options: generateMonthOptions(),
        default: String(new Date().getMonth() + 1),
        clearable: false,
        required: true,
      },
      {
        name: "year",
        label: "Year",
        type: "select",
        options: generateYearOptions(),
        default: String(new Date().getFullYear()),
        clearable: false,
        required: true,
      },
      {
        name: "purchase_months",
        label: "Purchase Rates Over",
        type: "select",
        options: [
          { value: "3", label: "Last 3 Months" },
          { value: "6", label: "Last 6 Months" },
          { value: "12", label: "Last 1 Year" },
          { value: "18", label: "Last 18 Months" },
          { value: "24", label: "Last 2 Years" },
          { value: "36", label: "Last 3 Years" },
        ],
        default: "6",
        clearable: false,
        required: true,
      },
      {
        // The enquiry reads one product down the page, so one must be chosen.
        name: "product",
        label: "Product",
        type: "select",
        options: "products",
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["code", "item"],
        separator: " - ",
        clearable: true,
        required: true,
      },
    ],

    // Six columns shared by every section; each section names its own
    // columns on its section_header row (c1…c6), which the wide engine shows
    // in the columns of the section's group row. Every row type maps its own
    // fields onto the six (ENQUIRY_CELLS). The API is unchanged; its values
    // are already formatted text, so there are no column totals.
    columns: [1, 2, 3, 4, 5, 6].map((n) => ({
      field: `c${n}`,
      headerName: ["Particular", "Value", "Detail", "Ref", "Vendor / Note", "Qty / Amount"][n - 1],
      width: [250, 150, 120, 120, 200, 120][n - 1],
      valueGetter: ({ row }) => {
        const map = ENQUIRY_CELLS[row?.row_type];
        return map ? row[map[n - 1]] ?? "" : row?.[`c${n}`] ?? "";
      },
    })),
    layout: {
      pinned: ["c1"],
      groupRows: {
        levels: [
          { header: "product_header", title: "Product", label: (h) => `Product ${h.label}`, subtotal: false },
          { header: "section_header", title: "Section", label: (h) => h.c1, headerFields: ["c1", "c2", "c3", "c4", "c5", "c6"], subtotal: false },
        ],
        detail: ["info_row", "vendor_row", "purchase_row"],
        extra: { purchase_total: "total" },
        grandTotal: false,
      },
      card: { title: "c1", subtitle: "c2" },
    },

    exportOptions: { excel: true, pdf: true },
  },

  sales_matrix_monthwise: {
    title: "SALES MATRIX MONTHWISE",
    description: "Monthwise Sales Matrix showing Tons, Sale Amount, Sale Cost, and Recovery",
    apiEndpoint: "/api/reports/sales_matrix_monthwise",
    filters: [
      {
        name: "monthFrom",
        label: "From Month",
        type: "select",
        options: generateMonthOptions(),
        // default: "1",
        // Opens on the last 5 months up to this one (e.g. June → October),
        // never before January since the report covers one year.
        default: Math.max(1, new Date().getMonth() + 1 - 4).toString(),
        required: true,
      },
      {
        name: "monthTo",
        label: "To Month",
        type: "select",
        options: generateMonthOptions(),
        default: (new Date().getMonth() + 1).toString(),
        required: true,
      },
      {
        name: "year",
        label: "Year",
        type: "select",
        options: generateYearOptions(),
        default: new Date().getFullYear().toString(),
        required: true,
      },
      {
        name: "customer",
        label: "Customer",
        type: "select",
        multiple: true,
        nameKeys: ["acno", "acname"],
        separator: " - ",
        valueKey: "acno",
        options: "customers",
        default: { value: "", label: "All Customers" },
        apiEndpoint: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`,
        clearable: true,
      },
      {
        name: "item",
        label: "Item",
        type: "select",
        multiple: true,
        options: "products",
        default: { value: "", label: "All Items" },
        apiEndpoint: "/api/setup/items",
        valueKey: "itcd",
        nameKeys: ["code", "item"],
        separator: " - ",
        clearable: true,
      },
      {
        // Ink Series = the item's Main Category (same source as other reports)
        name: "category",
        label: "Ink Series",
        type: "select",
        multiple: true,
        options: "main_categories",
        default: { value: "", label: "All Series" },
        apiEndpoint: "/api/setup/main_categories",
        valueKey: "id",
        nameKeys: ["mc_name"],
        clearable: true,
      },
      {
        name: "sale_person",
        label: "Sales Person",
        type: "select",
        multiple: true,
        options: "salesPersons",
        // apiEndpoint: "/api/accounts/customer-sales-persons",
        // scope=own: a sales person is offered only themselves
        apiEndpoint: "/api/accounts/customer-sales-persons?scope=own",
        valueKey: "id",
        nameKey: "name",
        default: { value: "", label: "All Sales Persons" },
        clearable: true,
      },
      {
        name: "type",
        label: "Summary Type",
        type: "select",
        default: "customerSummary",
        options: [
          { value: "customerSummary", label: "Customer Summary" },
          { value: "customerDetail", label: "Customer Detail" },
          { value: "productSummary", label: "Product Summary" },
          { value: "productDetail", label: "Product Detail" },
          { value: "seriesSummary", label: "Ink Series Summary" },
        ],
      },
    ],
    getColumns: (filters = {}) => {
      const yr = parseInt(filters.year) || new Date().getFullYear();
      let mFrom = parseInt(filters.monthFrom) || 1;
      let mTo = parseInt(filters.monthTo) || (new Date().getMonth() + 1);

      if (mFrom > mTo) {
        const tmp = mFrom;
        mFrom = mTo;
        mTo = tmp;
      }

      let baseCols = [];

      if (filters.type === "customerDetail" || filters.type === "productDetail") {
        baseCols = [
          {
            field: "customerName",
            headerName: "Customer Name",
            width: 180,
            type: "text",
          },
          {
            field: "customerCode",
            headerName: "Customer Code",
            width: 110,
            type: "text",
          },
          {
            field: "productName",
            headerName: "Item Name",
            width: 220,
            type: "text",
          },
          {
            field: "mc_name",
            headerName: "Ink Series",
            width: 100,
            valueGetter: (params) => params.row.mc_name || "-",
          },
        ];
      } else if (filters.type === "productSummary") {
        baseCols = [
          {
            field: "productName",
            headerName: "Item Name",
            width: 220,
            type: "text",
          },
          {
            field: "mc_name",
            headerName: "Ink Series",
            width: 100,
            valueGetter: (params) => params.row.mc_name || "-",
          },
        ];
      } else if (filters.type === "seriesSummary") {
        // One row per Ink Series (all its items merged)
        baseCols = [
          {
            field: "mc_name",
            headerName: "Ink Series",
            width: 160,
            valueGetter: (params) => params.row.mc_name || "-",
          },
        ];
      } else {
        // Default: customerSummary
        baseCols = [
          {
            field: "customerName",
            headerName: "Customer Name",
            width: 180,
            type: "text",
          },
           {
            field: "customerCode",
            headerName: "Customer Code",
            width: 110,
            type: "text",
          },
        ];
      }

      const monthCols = [];
      for (let m = mFrom; m <= mTo; m++) {
        const mStr = String(m).padStart(2, "0");
        const key = `${mStr}-${yr}`;

        monthCols.push(
          {
            field: `${key}_tons`,
            headerName: "Tons",
            groupHeader: key,
            exportHeader: `${key} Tons`,
            width: 80,
            type: "number",
            align: "right",
          },
          {
            field: `${key}_kg`,
            headerName: "KG",
            groupHeader: key,
            exportHeader: `${key} KG`,
            width: 90,
            type: "number",
            align: "right",
          },
          {
            field: `${key}_sale_amt`,
            headerName: "Sale Amt",
            groupHeader: key,
            exportHeader: `${key} Sale Amt`,
            width: 100,
            type: "currency",
            align: "right",
          },
          {
            field: `${key}_sale_cost`,
            headerName: "Sale Cost",
            groupHeader: key,
            exportHeader: `${key} Sale Cost`,
            width: 100,
            type: "currency",
            align: "right",
          },
          {
            field: `${key}_margin`,
            headerName: "Margin",
            groupHeader: key,
            exportHeader: `${key} Margin`,
            width: 100,
            type: "currency",
            align: "right",
          },
          {
            field: `${key}_margin_pct`,
            headerName: "Margin %",
            groupHeader: key,
            exportHeader: `${key} Margin %`,
            width: 80,
            type: "percent",
            align: "right",
            valueGetter: (params) => `${Number(params.row[`${key}_margin_pct`] || 0).toFixed(2)}%`,
          },
          {
            field: `${key}_recovery`,
            headerName: "Recovery",
            groupHeader: key,
            exportHeader: `${key} Recovery`,
            width: 100,
            type: "currency",
            align: "right",
          }
        );
      }

      const totalCols = [
        {
          field: "total_tons",
          headerName: "Tons",
          groupHeader: "Total",
          exportHeader: "Total Tons",
          width: 90,
          type: "number",
          align: "right",
        },
        {
          field: "total_kg",
          headerName: "KG",
          groupHeader: "Total",
          exportHeader: "Total KG",
          width: 90,
          type: "number",
          align: "right",
        },
        {
          field: "total_sale_amt",
          headerName: "Sale Amt",
          groupHeader: "Total",
          exportHeader: "Total Sale Amt",
          width: 110,
          type: "currency",
          align: "right",
        },
        {
          field: "total_sale_cost",
          headerName: "Sale Cost",
          groupHeader: "Total",
          exportHeader: "Total Sale Cost",
          width: 110,
          type: "currency",
          align: "right",
        },
        {
          field: "total_margin",
          headerName: "Margin",
          groupHeader: "Total",
          exportHeader: "Total Margin",
          width: 110,
          type: "currency",
          align: "right",
        },
        {
          field: "total_margin_pct",
          headerName: "Margin %",
          groupHeader: "Total",
          exportHeader: "Total Margin %",
          width: 90,
          type: "percent",
          align: "right",
          valueGetter: (params) => `${Number(params.row.total_margin_pct || 0).toFixed(2)}%`,
        },
        {
          field: "total_recovery",
          headerName: "Recovery",
          groupHeader: "Total",
          exportHeader: "Total Recovery",
          width: 110,
          type: "currency",
          align: "right",
        },
      ];

      return [...baseCols, ...monthCols, ...totalCols];
    },

    // Margin % is worked out from the summed Sale Amt and Margin (never summed).
    summaryFields: [
      { field: "row_count", label: "Rows", type: "number" },
      { field: "total_tons", label: "Total Tons", type: "number" },
      { field: "total_kg", label: "Total KG", type: "number" },
      { field: "total_sale_amt", label: "Total Sale Amt", type: "currency" },
      { field: "total_sale_cost", label: "Total Sale Cost", type: "currency" },
      { field: "total_margin", label: "Total Margin", type: "currency" },
      { field: "total_margin_pct", label: "Margin %", type: "percent" },
      { field: "total_recovery", label: "Total Recovery", type: "currency" },
      { field: "recovery_pct", label: "Recovery % of Sales", type: "percent" },
    ],

    exportOptions: { excel: true, pdf: true },
  },
};

// ── SALES MATRIX MONTHWISE: with and without cost ────────────────────────────
// sales_matrix_monthwise_margin is the full report (Sale Cost, Margin,
// Margin %). sales_matrix_monthwise is the same report without those three —
// the API strips them too — so cost and margin can be given only to the
// people who should see them (report.<type>.view).
const isSalesMatrixCostField = (field) => /_(sale_cost|margin|margin_pct)$/.test(String(field || ""));
const salesMatrixFull = REPORT_CONFIG.sales_matrix_monthwise;

REPORT_CONFIG.sales_matrix_monthwise_margin = {
  ...salesMatrixFull,
  title: "SALES MATRIX MONTHWISE (WITH MARGIN)",
  description: "Monthwise Sales Matrix showing Tons, Sale Amount, Sale Cost, Margin and Recovery",
  apiEndpoint: "/api/reports/sales_matrix_monthwise_margin",
};

REPORT_CONFIG.sales_matrix_monthwise = {
  ...salesMatrixFull,
  description: "Monthwise Sales Matrix showing Tons, Sale Amount and Recovery",
  getColumns: (filters = {}) =>
    salesMatrixFull.getColumns(filters).filter((c) => !isSalesMatrixCostField(c.field)),
  summaryFields: salesMatrixFull.summaryFields.filter((f) => !isSalesMatrixCostField(f.field)),
};

// ── DISPATCH WITHOUT RATES ───────────────────────────────────────────────────
// The Dispatch Report limited to dispatches that have no invoice number yet —
// still unpriced, so not in any ledger (see app/api/voucher/[type] deferred
// pricing). Same filters and columns; the API adds the "no invoice" condition.
REPORT_CONFIG.dispatchWithoutRates = {
  ...REPORT_CONFIG.dispatch,
  title: "Dispatch Without Rates",
  description: "Dispatches that have no invoice number (no rates) yet",
  apiEndpoint: "/api/reports/dispatchWithoutRates",
  // "As of Date" instead of From / To: every uninvoiced dispatch up to that
  // date. It is still the dateTo filter underneath (the API normalises it).
  filters: REPORT_CONFIG.dispatch.filters
    // always without rates here, so no toggle
    .filter((f) => f.name !== "dateFrom" && f.name !== "withoutRate")
    .map((f) => (f.name === "dateTo" ? { ...f, label: "As of Date", default: new Date() } : f)),
};

// Exbond Report — the GRN Report limited to LC vendors (the "lc_accounts" group).
// Same filters and columns; the API adds the vendor macno condition.
REPORT_CONFIG.exbondReport = {
  ...REPORT_CONFIG.grn,
  title: "Exbond Report",
  description: "GRNs of LC vendors (LC / Import Accounts group)",
  apiEndpoint: "/api/reports/exbondReport",
  // No PO No in the Exbond Report — neither the filter nor the column.
  filters: REPORT_CONFIG.grn.filters
    .filter((f) => f.name !== "po_no")
    .map((f) => (f.name === "vendor" ? { ...f, apiEndpoint: `/api/accounts/acno?${LC_GROUP_PARAM}` } : f)),
  getColumns: (filters) =>
    REPORT_CONFIG.grn.getColumns(filters).filter((c) => c.field !== "po_no"),
};

// ─── HR reports ──────────────────────────────────────────────────────────────
// One entry per report in lib/hr/reports/catalog.js (titles, kinds, columns),
// keyed hrAttendanceSummary, hrLeaveRegister, … (hrEngineKey). Rows come from
// lib/reports/hr.js, which also checks the report's HR right and keeps to the
// employees the person may see. Defaults and range limits (a year of days,
// three years of months) are enforced there too.
const HR_FILTERS = {
  month: () => [
    { name: "month", label: "Month", type: "select", options: hrMonthOptions(), default: hrMonthOptions()[0], required: true },
  ],
  range: () => [
    { name: "dateFrom", label: "From Date", type: "date", required: true, default: new Date(new Date().getFullYear(), new Date().getMonth(), 1) },
    { name: "dateTo", label: "To Date", type: "date", required: true, default: new Date() },
  ],
  monthRange: () => {
    const options = hrMonthOptions();
    const fyStart = fiscalYearStart(options[0].value);
    return [
      { name: "fromMonth", label: "From Month", type: "select", options, default: options.find((o) => o.value === fyStart) ?? options[0], required: true },
      { name: "toMonth", label: "To Month", type: "select", options, default: options[0], required: true },
    ];
  },
  kind: (def) => [
    { name: "kind", label: "Show", type: "select", options: def.kinds, default: def.kinds[0] },
  ],
};

Object.entries(HR_REPORTS).forEach(([key, def]) => {
  const type = hrEngineKey(key);
  REPORT_CONFIG[type] = {
    title: def.title,
    description: def.description,
    apiEndpoint: `/api/reports/${type}`,
    category: "hr",
    filters: [
      ...def.filters.flatMap((f) => HR_FILTERS[f](def)),
      // "department" / "location" are also the HR data-scope filters
      // (lib/auth/scopeDimensions.js) — multiple, so a person limited to
      // several is narrowed to them rather than asked to pick one.
      {
        name: "department",
        label: "Department",
        type: "select",
        multiple: true,
        apiEndpoint: "/api/setup/departments",
        valueKey: "id",
        nameKey: "dept_name",
        default: { value: "", label: "All Departments" },
        clearable: true,
      },
      {
        name: "location",
        label: "Work Location",
        type: "select",
        multiple: true,
        apiEndpoint: "/api/setup/work_locations",
        valueKey: "id",
        nameKey: "location_name",
        default: { value: "", label: "All Work Locations" },
        clearable: true,
      },
      { name: "q", label: "Employee (name or no.)", type: "text", placeholder: "Name or no." },
    ],
    columns: engineColumns(def.columns),
    // Leave taken builds a column per leave type; the API sends them.
    apiColumns: def.columns.length === 0,
    summaryFields: [
      { field: "period", label: "Period" },
      { field: "rows", label: "Rows", type: "number" },
    ],
  };
});

/** The last 48 months, newest first, as { value: "2026-10", label: "Oct 2026" }. */
function hrMonthOptions() {
  const now = new Date();
  return Array.from({ length: 48 }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    return { value: `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`, label: format(d, "MMM yyyy") };
  });
}




// ── "Entered by" on document reports ─────────────────────────────────────────
// Who keyed each voucher / order. The API fills `entered_by` on every row that
// carries the document's id (app/api/reports/[reportType]/route.js →
// lib/audit/enteredBy.js: the stored user, else the AuditLog creator). Here
// every column set of these reports whose rows are documents (it has a date /
// document-number column) gets the column at the end, and the layout views
// with a field list ("Standard" …) include it. Report → the document model.
// accountLedger / cbBook have their own "User" column; fundsFlow / fundsPosition
// are not document lists.
export const ENTERED_BY_REPORTS = {
  purchase: "TransactionsMaster",
  purchaseReturn: "TransactionsMaster",
  sale: "TransactionsMaster",
  saleReturn: "TransactionsMaster",
  grn: "TransactionsMaster",
  exbondReport: "TransactionsMaster",
  grnReturn: "TransactionsMaster",
  dispatch: "TransactionsMaster",
  dispatchWithoutRates: "TransactionsMaster",
  dispatchReturn: "TransactionsMaster",
  serviceEntry: "TransactionsMaster",
  serviceInvoice: "TransactionsMaster",
  payment: "TransactionsMaster",
  receipt: "TransactionsMaster",
  journal: "TransactionsMaster",
  materialProduction: "TransactionsMaster",
  materialIssuance: "TransactionsMaster",
  materialTransfer: "TransactionsMaster",
  stockLedger: "TransactionsMaster",
  posTransactions: "TransactionsMaster",
  batchLedger: "TransactionsMaster",
  purchaseOrder: "OrderMaster",
  saleOrder: "OrderMaster",
  serviceOrder: "OrderMaster",
};
const ENTERED_BY_COLUMN = { field: "entered_by", headerName: "Entered by", width: 30, type: "text", searchable: false };
const ENTERED_BY_DOC_FIELDS = new Set(["tran_id", "vr_no", "dated", "invoice_no", "grn_no", "dispatch_no", "order_no"]);
const withEnteredBy = (cols) => {
  if (!Array.isArray(cols) || cols.some((c) => c?.field === "entered_by")) return cols;
  return cols.some((c) => ENTERED_BY_DOC_FIELDS.has(c?.field)) ? [...cols, ENTERED_BY_COLUMN] : cols;
};
const viewsWithEnteredBy = (spec, cols) => {
  if (!spec || typeof spec !== "object" || !Array.isArray(spec.views)) return spec;
  if (!cols.some((c) => c?.field === "entered_by")) return spec;
  return {
    ...spec,
    views: spec.views.map((v) =>
      Array.isArray(v.fields) && !v.fields.includes("entered_by") ? { ...v, fields: [...v.fields, "entered_by"] } : v,
    ),
  };
};
Object.keys(ENTERED_BY_REPORTS).forEach((key) => {
  const cfg = REPORT_CONFIG[key];
  if (!cfg) return;
  const colsOf = (filters, ...rest) => (cfg.getColumns ? cfg.getColumns(filters, ...rest) : cfg.columns) || [];
  if (typeof cfg.getColumns === "function") {
    const base = cfg.getColumns;
    cfg.getColumns = (...args) => withEnteredBy(base(...args));
  } else if (Array.isArray(cfg.columns)) {
    cfg.columns = withEnteredBy(cfg.columns);
  }
  ["layout", "wideLayout"].forEach((prop) => {
    const spec = cfg[prop];
    if (typeof spec === "function") {
      cfg[prop] = (filters, ...rest) => viewsWithEnteredBy(spec(filters, ...rest), colsOf(filters || {}));
    } else if (spec && typeof spec === "object") {
      cfg[prop] = viewsWithEnteredBy(spec, colsOf({}));
    }
  });
});

// Helper function to get config
export function getReportConfig(reportType) {
  return REPORT_CONFIG[reportType];
}

// Helper function to get all report types
export function getAllReportTypes() {
  return Object.keys(REPORT_CONFIG).map(key => ({
    value: key,
    label: REPORT_CONFIG[key].title,
    description: REPORT_CONFIG[key].description,
    category: getReportCategory(key),
  }));
}

// Categorize reports
function getReportCategory(reportType) {
  const categories = {
    stock: ["stock", "stockActivity", "stockActivityView", "stockLedger", "stockMetrics", "tradingMargin"],
    production: ["productionCosting", "materialProduction", "materialIssuance", "directMaterialIssuanceCost", "bom", "qc"],
    sales: ["sale", "saleOrder", "saleOrderToDispatch", "saleReturn", "posTransactions", "customerAging", "salesPerformanceWeekly", "sales_matrix_monthwise", "sales_matrix_monthwise_margin", "dispatchWithoutRates"],
    purchase: ["purchase", "purchaseOrder", "purchaseReturn", "grn","exbondReport", "vendorAging"],
    financial: ["accountLedger", "accountLedgerSummary", "trialBalance", "accountsActivity", "payment", "receipt", "journal"],
    service: ["serviceOrder", "serviceEntry", "serviceInvoice"],
  };
  // HR reports carry their category (category: "hr").
  if (REPORT_CONFIG[reportType]?.category) return REPORT_CONFIG[reportType].category;

  for (const [category, reports] of Object.entries(categories)) {
    if (reports.includes(reportType)) {
      return category;
    }
  }

  return "other";
}

// Get reports by category
export function getReportsByCategory(category) {
  return Object.entries(REPORT_CONFIG)
    .filter(([key]) => getReportCategory(key) === category)
    .map(([key, config]) => ({
      value: key,
      label: config.title,
      description: config.description,
    }));
}

// Helper functions for month/year options
function generateYearOptions() {
  const currentYear = new Date().getFullYear();
  return Array.from({ length: 10 }, (_, i) => ({
    value: (currentYear - 5 + i).toString(),
    label: (currentYear - 5 + i).toString()
  }));
}

// Year-aware month options (last 24 months) for the Accounts Activity
// "Compare Months" multi-select. Values are "YYYY-MM"; labels are "MMM yyyy".
function generateCompareMonthOptions() {
  const opts = [];
  const now = new Date();
  for (let i = 0; i < 24; i++) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const value = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    opts.push({ value, label: format(d, 'MMM yyyy') });
  }
  return opts;
}

/**
 * One column per month of the Material Procurement period — the six months
 * ending at the chosen month. Mirrors monthKeys/monthField in
 * lib/reports/materialProcurement.js; duplicated rather than imported because
 * that module pulls in Prisma and this config is loaded in the browser.
 */
function procurementMonthCols(filters = {}) {
  const NAMES = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];
  const now = new Date();
  const month = Number(filters.month) || now.getMonth() + 1;
  const year = Number(filters.year) || now.getFullYear();

  const cols = [];
  for (let back = 5; back >= 0; back--) {
    const d = new Date(year, month - 1 - back, 1);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, "0");
    cols.push({
      field: `m_${y}_${m}`,
      headerName: `${NAMES[d.getMonth()]}-${String(y).slice(2)}`,
      width: 18,
      type: "number",
    });
  }
  return cols;
}

function generateMonthOptions() {
  return [
    { value: '1', label: 'January' },
    { value: '2', label: 'February' },
    { value: '3', label: 'March' },
    { value: '4', label: 'April' },
    { value: '5', label: 'May' },
    { value: '6', label: 'June' },
    { value: '7', label: 'July' },
    { value: '8', label: 'August' },
    { value: '9', label: 'September' },
    { value: '10', label: 'October' },
    { value: '11', label: 'November' },
    { value: '12', label: 'December' }
  ];
}
