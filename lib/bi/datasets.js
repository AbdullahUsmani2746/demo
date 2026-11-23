// lib/bi/datasets.js
// ============================================================
// BI DATASETS — the safe, ready-made views admins build questions from.
//
// Each dataset is written once by a developer, with the ERP's rules built in
// (sub_tran_id 3 excluded, KG vs LTR, opening stock, which account is the
// party …), so every chart agrees with the reports. Admins never write SQL:
// they pick fields and measures BY KEY, and lib/bi/engine.js only ever puts
// these trusted fragments into a query — values always go in as parameters.
//
//   base(ctx)  — a SELECT whose columns are named exactly like the field /
//                measure `column`s below (one row per line / record)
//   dateColumn — the column the period (Today, This Month …) filters on;
//                null for a point-in-time dataset (Stock Balance)
//   scope      — dimension (lib/auth/scopeDimensions.js) → column. Department
//                and personal limits are applied to every question on it.
//   fields     — what can be grouped by / filtered on
//   measures   — what can be summed / averaged / counted
//   drill      — columns listed when someone clicks into a figure
//   orderColumn (on a field) — sort that field by another column (aging
//                buckets in age order, not alphabetically)
//
// To add a dataset: one entry below. It then appears in the builder, and in
// Admin → BI → Data Access, with no other change.
//
// SMS rules built in:
//   · customer / vendor main accounts come from Finance → Account Settings
//     (lib/accounts/partyMacnos.js) — never hard-coded; base() is async so it
//     reads them per run (cached 60s by the settings helper)
//   · stock = latest Monthly Opening Stock + movements since, per MASTER
//     godown, exactly like lib/stock/godownStock.js; godown2 is a transfer-only
//     column (tran 11) — a dispatch's godown2 is never a stock location
//   · automatic vouchers made by dispatches (tran 7 rmk1 AUTO_PACKING /
//     AUTO_DISPATCH_BOM, tran 8 AUTO_DISPATCH_PROD) are real stock movements
//     and count in Stock and Production
//   · sub_tran_id 3 control rows never count as stock or as item lines
//   · ledger datasets read the Trial Balance tran_codes only (LEDGER_TRAN_CODES)
// ============================================================
import { Prisma } from "@prisma/client";
import { getLatestOpeningPeriod, openingQtyByGodownSql } from "@/lib/openingStock";
import { customerAgingRowsSql } from "@/lib/reports/customerAging";
import { getCustomerMacnos, getVendorMacnos, getCashBankMacnos } from "@/lib/accounts/partyMacnos";

// `col IN (…)` list for a main-account group. An unset group (no main accounts
// chosen in Account Settings) matches nothing — IN (NULL) — instead of making
// Prisma.join throw on an empty list.
const macnoList = (macnos) => Prisma.join(macnos?.length ? macnos : [null]);

// The tran_codes the Account Ledger / Trial Balance post (lib/reports/fundsCommon.js).
const LEDGER_TRAN_CODES = [1, 2, 3, 4, 5, 6, 9, 10, 12, 21];

// Debit / credit of a posting line — the Dr/Cr rules of the account ledger
// (CLAUDE.md): Receipt sub 1 credits the party, sub 2/3 debit; Payment the
// other way round; every other document reads damt / camt as they are.
const LEDGER_DR = Prisma.sql`CASE
  WHEN tm.tran_code = 1 AND t.sub_tran_id IN (2, 3) THEN COALESCE(t.damt, 0)
  WHEN tm.tran_code = 2 AND t.sub_tran_id = 1      THEN COALESCE(t.damt, 0)
  WHEN tm.tran_code NOT IN (1, 2)                  THEN COALESCE(t.damt, 0)
  ELSE 0 END`;
const LEDGER_CR = Prisma.sql`CASE
  WHEN tm.tran_code = 1 AND t.sub_tran_id = 1      THEN COALESCE(t.camt, 0)
  WHEN tm.tran_code = 2 AND t.sub_tran_id IN (2, 3) THEN COALESCE(t.camt, 0)
  WHEN tm.tran_code NOT IN (1, 2)                  THEN COALESCE(t.camt, 0)
  ELSE 0 END`;
const DOC_TYPE = Prisma.sql`CASE tm.tran_code
  WHEN 1 THEN 'Receipt' WHEN 2 THEN 'Payment' WHEN 3 THEN 'Journal' WHEN 4 THEN 'Purchase (GRN)'
  WHEN 5 THEN 'POS' WHEN 6 THEN 'Sale / Dispatch' WHEN 7 THEN 'Material Issue' WHEN 8 THEN 'Production'
  WHEN 9 THEN 'Purchase Return' WHEN 10 THEN 'Sale Return' WHEN 11 THEN 'Transfer' WHEN 12 THEN 'Misc IN'
  WHEN 21 THEN 'Service Invoice'
  ELSE 'Other' END`;

// Common item / customer columns, reused by several datasets.
const ITEM_FIELDS = [
  { key: "item", label: "Item", type: "text" },
  { key: "item_code", label: "Item Code", type: "text" },
  { key: "main_category", label: "Main Category", type: "text" },
  { key: "item_category", label: "Item Category", type: "text" },
  { key: "series", label: "Series", type: "text" },
];
const ITEM_JOINS = Prisma.sql`
  LEFT JOIN "Item" i          ON i.itcd = t.itcd
  LEFT JOIN "MainCategory" mc ON mc.id = i.mc_id
  LEFT JOIN "ItemCategory" ic ON ic.id = i.ic_id`;
const ITEM_COLUMNS = Prisma.sql`
  i.item AS item, i.code AS item_code, mc.mc_name AS main_category, ic.ic_name AS item_category, i.series AS series`;

// The cash / bank account on the other side of a receipt or payment: its
// sub_tran_id 3 control row (the voucher's pycd — a bank or cash account).
const CASH_BANK_LATERAL = Prisma.sql`
  LEFT JOIN LATERAL (
    SELECT b.acname
    FROM "Transactions" t2
    JOIN "acno" b ON b.acno = t2.acno
    WHERE t2.tran_id = tm.tran_id AND t2.sub_tran_id = 3
    ORDER BY t2.id
    LIMIT 1
  ) cb ON TRUE`;

// On books / Off books — the account (or its main account in MACNO) switched
// off (is_active = false) is OFF the books, the unofficial book. Same rule as
// lib/accounts/books.js. Every dataset that joins an account as "a" carries
// it as the "book" field.
const BOOK_SQL = Prisma.sql`CASE
          WHEN a.acno IS NULL THEN NULL
          WHEN a.is_active = false
            OR EXISTS (SELECT 1 FROM "MACNO" mb WHERE mb.macno = a.macno AND mb.is_active = false) THEN 'Off books'
          ELSE 'On books'
        END`;

export const DATASETS = [
  // ── Sales / Dispatch (tran_code 6) ─────────────────────────────────────
  {
    key: "sales",
    drill: ["dated", "dispatch_no", "customer", "item", "godown", "qty_kg", "qty_ltr", "amount", "invoice_status"],
    label: "Sales & Dispatch",
    description: "Every dispatched item line (tran_code 6) — qty in KG and LTR, sale amount, customer, sales person, godown. A dispatch priced at invoicing carries its amount once it is invoiced.",
    icon: "TrendingUp",
    dateColumn: "dated",
    scope: { godown: "godown_id", customer: "customer_id", region: "region" },
    fields: [
      { key: "book", label: "Book (On / Off)", type: "text" },
      { key: "dated", label: "Date", type: "date" },
      { key: "customer", label: "Customer", type: "text" },
      { key: "sales_person", label: "Sales Person", type: "text" },
      { key: "city", label: "City", type: "text" },
      { key: "region", label: "Region", type: "text" },
      { key: "customer_status", label: "Customer Status", type: "text" },
      { key: "godown", label: "Godown", type: "text" },
      ...ITEM_FIELDS,
      { key: "unit", label: "Unit (KG/LTR)", type: "text" },
      { key: "invoice_status", label: "Invoiced?", type: "text" },
      { key: "dispatch_no", label: "Dispatch No", type: "number" },
      { key: "so_no", label: "SO No", type: "number" },
    ],
    measures: [
      { key: "amount", label: "Sale Amount", column: "amount", format: "currency" },
      { key: "qty_kg", label: "Qty (KG)", column: "qty_kg", format: "qty" },
      { key: "qty_ton", label: "Qty (Ton)", column: "qty_ton", format: "qty" },
      { key: "qty_ltr", label: "Qty (LTR)", column: "qty_ltr", format: "qty" },
      { key: "dispatches", label: "Dispatches", column: "tran_id", format: "number", aggs: ["distinct"] },
      { key: "customers", label: "Customers", column: "customer_id", format: "number", aggs: ["distinct"] },
      { key: "lines", label: "Lines", column: "line_id", format: "number", aggs: ["count"] },
    ],
    base: async () => Prisma.sql`
      SELECT
        ${BOOK_SQL} AS book,
        t.id AS line_id, tm.tran_id, tm.dated::date AS dated, tm.dispatch_no, tm.so_no,
        tm.pycd AS customer_id, a.acname AS customer, a.city,
        COALESCE(a.customer_status, '') AS customer_status,
        COALESCE(u.name, 'OPEN') AS sales_person, om.region,
        tm.godown AS godown_id, g.godown AS godown,
        t.itcd AS item_id, ${ITEM_COLUMNS},
        COALESCE(NULLIF(UPPER(t.unit), ''), 'KG') AS unit,
        CASE WHEN COALESCE(tm.invoice_no, '') = '' THEN 'Not invoiced' ELSE 'Invoiced' END AS invoice_status,
        COALESCE(t.qty, 0)::float8 AS qty_kg,
        (COALESCE(t.qty, 0) / 1000.0)::float8 AS qty_ton,
        (CASE WHEN UPPER(t.unit) = 'LTR' THEN COALESCE(t.qty_ltr, 0) ELSE 0 END)::float8 AS qty_ltr,
        COALESCE(t.camt, 0)::float8 AS amount
      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      LEFT JOIN "acno" a ON a.acno = tm.pycd
      LEFT JOIN "User" u ON u.id = a.sales_ares
      LEFT JOIN "OrderMaster" om ON om.order_no = tm.so_no
      LEFT JOIN "Godown" g ON g.id = tm.godown
      ${ITEM_JOINS}
      WHERE tm.tran_code = 6 AND COALESCE(t.sub_tran_id, 1) = 1`,
  },

  // ── Receipts (tran_code 1) ─────────────────────────────────────────────
  {
    key: "receipts",
    drill: ["dated", "party", "cash_bank", "amount"],
    label: "Receipts",
    description: "Money received (tran_code 1): the party credited, amount, and the cash / bank account it went into.",
    icon: "ArrowDownCircle",
    dateColumn: "dated",
    scope: { customer: "party_id" },
    fields: [
      { key: "book", label: "Book (On / Off)", type: "text" },
      { key: "dated", label: "Date", type: "date" },
      { key: "party", label: "Received From", type: "text" },
      { key: "party_type", label: "Party Type", type: "text" },
      { key: "sales_person", label: "Sales Person", type: "text" },
      { key: "city", label: "City", type: "text" },
      { key: "cash_bank", label: "Cash / Bank", type: "text" },
    ],
    measures: [
      { key: "amount", label: "Amount Received", column: "amount", format: "currency" },
      { key: "receipts", label: "Receipts", column: "tran_id", format: "number", aggs: ["distinct"] },
      { key: "parties", label: "Parties", column: "party_id", format: "number", aggs: ["distinct"] },
    ],
    base: async () => Prisma.sql`
      SELECT
        ${BOOK_SQL} AS book,
        tm.tran_id, tm.dated::date AS dated,
        t.acno AS party_id, a.acname AS party, a.city,
        CASE WHEN a.macno IN (${macnoList(await getCustomerMacnos())}) THEN 'Customer' ELSE 'Other' END AS party_type,
        COALESCE(u.name, 'OPEN') AS sales_person,
        COALESCE(cb.acname, 'Unknown') AS cash_bank,
        COALESCE(t.camt, 0)::float8 AS amount
      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      LEFT JOIN "acno" a ON a.acno = t.acno
      LEFT JOIN "User" u ON u.id = a.sales_ares
      ${CASH_BANK_LATERAL}
      WHERE tm.tran_code = 1 AND t.sub_tran_id = 1`,
  },

  // ── Payments (tran_code 2) ─────────────────────────────────────────────
  {
    key: "payments",
    drill: ["dated", "party", "cash_bank", "amount"],
    label: "Payments",
    description: "Money paid out (tran_code 2): the party debited, amount, and the cash / bank account it came from.",
    icon: "ArrowUpCircle",
    dateColumn: "dated",
    scope: {},
    fields: [
      { key: "book", label: "Book (On / Off)", type: "text" },
      { key: "dated", label: "Date", type: "date" },
      { key: "party", label: "Paid To", type: "text" },
      { key: "cash_bank", label: "Cash / Bank", type: "text" },
    ],
    measures: [
      { key: "amount", label: "Amount Paid", column: "amount", format: "currency" },
      { key: "payments", label: "Payments", column: "tran_id", format: "number", aggs: ["distinct"] },
      { key: "parties", label: "Parties", column: "party_id", format: "number", aggs: ["distinct"] },
    ],
    base: async () => Prisma.sql`
      SELECT
        ${BOOK_SQL} AS book,
        tm.tran_id, tm.dated::date AS dated,
        t.acno AS party_id, a.acname AS party,
        COALESCE(cb.acname, 'Unknown') AS cash_bank,
        COALESCE(t.damt, 0)::float8 AS amount
      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      LEFT JOIN "acno" a ON a.acno = t.acno
      ${CASH_BANK_LATERAL}
      WHERE tm.tran_code = 2 AND t.sub_tran_id = 1`,
  },

  // ── Purchases / GRN (tran_code 4) ──────────────────────────────────────
  {
    key: "purchases",
    drill: ["dated", "grn_no", "vendor", "item", "godown", "qty_kg", "rate", "amount"],
    label: "Purchases (GRN)",
    description: "Every received item line (tran_code 4): vendor, item, qty, rate, value, godown.",
    icon: "Truck",
    dateColumn: "dated",
    scope: { godown: "godown_id" },
    fields: [
      { key: "book", label: "Book (On / Off)", type: "text" },
      { key: "dated", label: "Date", type: "date" },
      { key: "vendor", label: "Vendor", type: "text" },
      { key: "godown", label: "Godown", type: "text" },
      ...ITEM_FIELDS,
      { key: "import_type", label: "Local / Imported", type: "text" },
      { key: "grn_no", label: "GRN No", type: "number" },
    ],
    measures: [
      { key: "amount", label: "Purchase Value", column: "amount", format: "currency" },
      { key: "qty_kg", label: "Qty (KG)", column: "qty_kg", format: "qty" },
      { key: "rate", label: "Rate", column: "rate", format: "currency", aggs: ["avg", "min", "max"] },
      { key: "grns", label: "GRNs", column: "tran_id", format: "number", aggs: ["distinct"] },
      { key: "vendors", label: "Vendors", column: "vendor_id", format: "number", aggs: ["distinct"] },
    ],
    base: async () => Prisma.sql`
      SELECT
        ${BOOK_SQL} AS book,
        tm.tran_id, tm.vr_no AS grn_no, tm.dated::date AS dated,
        tm.pycd AS vendor_id, a.acname AS vendor,
        tm.godown AS godown_id, g.godown AS godown,
        t.itcd AS item_id, ${ITEM_COLUMNS},
        COALESCE(NULLIF(UPPER(i.import_type), ''), 'UNSPECIFIED') AS import_type,
        COALESCE(t.qty, 0)::float8 AS qty_kg,
        NULLIF(t.rate, 0)::float8 AS rate,
        COALESCE(t.damt, 0)::float8 AS amount
      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      LEFT JOIN "acno" a ON a.acno = tm.pycd
      LEFT JOIN "Godown" g ON g.id = tm.godown
      ${ITEM_JOINS}
      WHERE tm.tran_code = 4 AND COALESCE(t.sub_tran_id, 1) = 1`,
  },

  // ── Purchase Orders: ordered / received / remaining ──
  // One row per PO and item. Received = GRN qty − GRN Return qty against the
  // PO (tran_code 4 / 9 with po_no) — the same rule as the Purchase Order
  // Balance report. Remaining never goes below 0; Pending Value = remaining ×
  // the PO's average rate for the item. Status: Closed (closed by hand) ·
  // Fully received · Partly received · Not received.
  {
    key: "purchase_orders",
    drill: ["dated", "order_no", "vendor", "item", "ordered_qty", "received_qty", "remaining_qty", "pending_value", "po_status", "days_open"],
    label: "Purchase Orders",
    description: "Every PO line: ordered, received (GRNs − GRN returns against the PO) and remaining qty, pending value, status and days open.",
    icon: "ClipboardList",
    dateColumn: "dated",
    scope: {},
    fields: [
      { key: "book", label: "Book (On / Off)", type: "text" },
      { key: "dated", label: "PO Date", type: "date" },
      { key: "vendor", label: "Vendor", type: "text" },
      { key: "po_status", label: "PO Status", type: "text" },
      { key: "open_or_closed", label: "Open / Closed", type: "text" },
      ...ITEM_FIELDS,
      { key: "order_no", label: "PO No", type: "number" },
      { key: "days_open", label: "Days Since PO", type: "number" },
    ],
    measures: [
      { key: "ordered_qty", label: "Ordered Qty", column: "ordered_qty", format: "qty" },
      { key: "received_qty", label: "Received Qty", column: "received_qty", format: "qty" },
      { key: "remaining_qty", label: "Remaining Qty", column: "remaining_qty", format: "qty" },
      { key: "ordered_value", label: "Ordered Value", column: "ordered_value", format: "currency" },
      { key: "pending_value", label: "Pending Value", column: "pending_value", format: "currency" },
      { key: "orders", label: "Purchase Orders", column: "order_no", format: "number", aggs: ["distinct"] },
      { key: "vendors", label: "Vendors", column: "vendor_id", format: "number", aggs: ["distinct"] },
    ],
    base: async () => Prisma.sql`
      WITH rec AS (
        SELECT tm.po_no AS order_no, t.itcd,
          SUM(CASE WHEN tm.tran_code = 4 THEN COALESCE(t.qty, 0) ELSE -COALESCE(t.qty, 0) END)::float8 AS received
        FROM "Transactions" t
        JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
        WHERE tm.tran_code IN (4, 9) AND tm.po_no IS NOT NULL AND t.itcd IS NOT NULL AND COALESCE(t.sub_tran_id, 1) = 1
        GROUP BY tm.po_no, t.itcd
      ),
      ord AS (
        SELECT om.order_no, od.itcd,
          SUM(COALESCE(od.qty, 0))::float8 AS ordered,
          SUM(COALESCE(od.amount, 0))::float8 AS amount,
          BOOL_AND(COALESCE(od.status, 1) = 2) AS lines_closed
        FROM "OrderMaster" om
        JOIN "OrderDetail" od ON od.order_no = om.order_no
        WHERE om.order_catagory = 4 AND od.itcd IS NOT NULL
        GROUP BY om.order_no, od.itcd
      )
      SELECT
        ${BOOK_SQL} AS book,
        o.order_no, om.dated::date AS dated,
        om.party_code AS vendor_id, a.acname AS vendor,
        o.itcd, ${ITEM_COLUMNS},
        o.ordered AS ordered_qty,
        COALESCE(r.received, 0) AS received_qty,
        GREATEST(o.ordered - COALESCE(r.received, 0), 0) AS remaining_qty,
        o.amount AS ordered_value,
        CASE WHEN o.ordered > 0 THEN GREATEST(o.ordered - COALESCE(r.received, 0), 0) * o.amount / o.ordered ELSE 0 END AS pending_value,
        CASE
          WHEN om.status = 2 OR o.lines_closed THEN 'Closed'
          WHEN COALESCE(r.received, 0) >= o.ordered THEN 'Fully received'
          WHEN COALESCE(r.received, 0) > 0 THEN 'Partly received'
          ELSE 'Not received'
        END AS po_status,
        CASE WHEN om.status = 2 OR o.lines_closed OR COALESCE(r.received, 0) >= o.ordered THEN 'Closed' ELSE 'Open' END AS open_or_closed,
        (CURRENT_DATE - om.dated::date) AS days_open
      FROM ord o
      JOIN "OrderMaster" om ON om.order_no = o.order_no
      LEFT JOIN rec r ON r.order_no = o.order_no AND r.itcd = o.itcd
      LEFT JOIN "acno" a ON a.acno = om.party_code
      LEFT JOIN "Item" i          ON i.itcd = o.itcd
      LEFT JOIN "MainCategory" mc ON mc.id = i.mc_id
      LEFT JOIN "ItemCategory" ic ON ic.id = i.ic_id`,
  },


  // ── Stock Balance (point in time: today) ───────────────────────────────
  {
    key: "stock",
    drill: ["item_code", "item", "item_category", "godown", "qty_kg", "below_reorder"],
    label: "Stock Balance",
    description: "Stock in hand right now, per item and godown (in the item's unit) — latest Monthly Opening Stock + movements since, the same rule as the voucher stock check. Includes the automatic packing / BOM issues and productions made by dispatches.",
    icon: "Boxes",
    dateColumn: null,
    scope: { godown: "godown_id" },
    fields: [
      { key: "godown", label: "Godown", type: "text" },
      ...ITEM_FIELDS,
      { key: "unit", label: "Unit", type: "text" },
      { key: "below_reorder", label: "Below Re-order?", type: "text" },
    ],
    measures: [
      { key: "qty_kg", label: "Stock Qty", column: "qty_kg", format: "qty" },
      { key: "qty_ton", label: "Stock Qty (Ton)", column: "qty_ton", format: "qty" },
      { key: "items", label: "Items", column: "item_id", format: "number", aggs: ["distinct"] },
    ],
    base: async () => {
      const now = new Date();
      const period = await getLatestOpeningPeriod(now);
      const start = period ? new Date(period.year, period.month - 1, 1) : null;
      const range = start
        ? Prisma.sql`AND tm.dated >= ${start} AND tm.dated <= ${now}`
        : Prisma.sql`AND tm.dated <= ${now}`;
      const opening = period
        ? Prisma.sql`UNION ALL SELECT o.itcd, o.godown, o.opening_qty::float8 FROM (${openingQtyByGodownSql(period.month, period.year)}) o`
        : Prisma.empty;
      return Prisma.sql`
        WITH moves AS (
          SELECT t.itcd, tm.godown,
            CASE WHEN tm.tran_code IN (4, 8, 10, 12) THEN COALESCE(t.qty, 0) ELSE -COALESCE(t.qty, 0) END::float8 AS qty
          FROM "Transactions" t
          JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
          WHERE t.qty IS NOT NULL AND (t.sub_tran_id IS NULL OR t.sub_tran_id <> 3)
            AND tm.godown IS NOT NULL AND tm.tran_code IN (4, 5, 6, 7, 8, 9, 10, 11, 12) ${range}
          UNION ALL
          SELECT t.itcd, tm.godown2, COALESCE(t.qty, 0)::float8
          FROM "Transactions" t
          JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
          WHERE t.qty IS NOT NULL AND (t.sub_tran_id IS NULL OR t.sub_tran_id <> 3)
            AND tm.tran_code = 11 AND tm.godown2 IS NOT NULL ${range}
          ${opening}
        ),
        bal AS (
          SELECT itcd, godown, SUM(qty) AS qty FROM moves WHERE itcd IS NOT NULL GROUP BY itcd, godown
        )
        SELECT
          b.itcd AS item_id, ${ITEM_COLUMNS},
          COALESCE(i.unit, 'KG') AS unit,
          b.godown AS godown_id, g.godown AS godown,
          CASE WHEN i.re_order IS NOT NULL AND b.qty < i.re_order THEN 'Yes' ELSE 'No' END AS below_reorder,
          b.qty::float8 AS qty_kg,
          (b.qty / 1000.0)::float8 AS qty_ton
        FROM bal b
        JOIN "Item" i ON i.itcd = b.itcd
        LEFT JOIN "MainCategory" mc ON mc.id = i.mc_id
        LEFT JOIN "ItemCategory" ic ON ic.id = i.ic_id
        LEFT JOIN "Godown" g ON g.id = b.godown
        WHERE ABS(b.qty) > 0.0001`;
    },
  },

  // ── Sale Orders (order_catagory 6) ─────────────────────────────────────
  {
    key: "sale_orders",
    drill: ["dated", "order_no", "customer", "sales_person", "item", "qty_kg", "amount", "order_status"],
    label: "Sale Orders",
    description: "Sale Order lines: ordered qty and value, customer, sales person, order and line status.",
    icon: "ClipboardList",
    dateColumn: "dated",
    scope: { customer: "customer_id", region: "region" },
    fields: [
      { key: "book", label: "Book (On / Off)", type: "text" },
      { key: "dated", label: "Order Date", type: "date" },
      { key: "customer", label: "Customer", type: "text" },
      { key: "sales_person", label: "Sales Person", type: "text" },
      { key: "region", label: "Region", type: "text" },
      { key: "order_status", label: "Order Status", type: "text" },
      { key: "line_status", label: "Line Status", type: "text" },
      ...ITEM_FIELDS,
      { key: "order_no", label: "SO No", type: "number" },
    ],
    measures: [
      { key: "amount", label: "Order Value", column: "amount", format: "currency" },
      { key: "qty_kg", label: "Ordered Qty (KG)", column: "qty_kg", format: "qty" },
      { key: "orders", label: "Orders", column: "order_no", format: "number", aggs: ["distinct"] },
      { key: "customers", label: "Customers", column: "customer_id", format: "number", aggs: ["distinct"] },
    ],
    base: async () => Prisma.sql`
      SELECT
        ${BOOK_SQL} AS book,
        om.order_no, om.dated::date AS dated,
        om.party_code AS customer_id, a.acname AS customer,
        COALESCE(u.name, 'OPEN') AS sales_person, om.region,
        CASE om.status WHEN 1 THEN 'Open' WHEN 2 THEN 'Closed' WHEN 3 THEN 'Pending Approval' ELSE 'Other' END AS order_status,
        CASE od.status WHEN 2 THEN 'Closed' ELSE 'Open' END AS line_status,
        od.itcd AS item_id, i.item AS item, i.code AS item_code, mc.mc_name AS main_category, ic.ic_name AS item_category, i.series AS series,
        COALESCE(od.qty, 0)::float8 AS qty_kg,
        COALESCE(od.amount, 0)::float8 AS amount
      FROM "OrderMaster" om
      JOIN "OrderDetail" od ON od.order_no = om.order_no
      LEFT JOIN "acno" a ON a.acno = om.party_code
      LEFT JOIN "User" u ON u.id = a.sales_ares
      LEFT JOIN "Item" i ON i.itcd = od.itcd
      LEFT JOIN "MainCategory" mc ON mc.id = i.mc_id
      LEFT JOIN "ItemCategory" ic ON ic.id = i.ic_id
      WHERE om.order_catagory = 6`,
  },

  // ── Sale Order follow-up (one row per Sale Order) ──────────────────────
  // For chasing orders that need a person's attention: Trial / Free of Cost /
  // Rate-negotiation orders, bad-payment customers, what has been dispatched
  // and how long ago. "Days Since First Dispatch" ≥ 7 + Order Type = Trial
  // Process = trials whose result is due. A sales person sees only their own
  // customers' orders (lib/bi/engine.js), so one question serves the CEO and
  // every sales person.
  {
    key: "so_followup",
    drill: ["order_no", "dated", "customer", "sales_person", "order_type", "customer_status", "dispatch_status", "first_dispatch", "days_since_first_dispatch", "ordered_kg", "dispatched_kg", "balance_kg"],
    label: "Sale Order Follow-up",
    description: "One row per Sale Order: order type (Trial / Free of Cost / Rate negotiation), customer status, approval, what is dispatched, and days since the first / last dispatch — for follow-up lists.",
    icon: "ClipboardCheck",
    dateColumn: "dated",
    scope: { customer: "customer_id", region: "region" },
    fields: [
      { key: "book", label: "Book (On / Off)", type: "text" },
      { key: "dated", label: "Order Date", type: "date" },
      { key: "order_no", label: "SO No", type: "number" },
      { key: "customer", label: "Customer", type: "text" },
      { key: "sales_person", label: "Sales Person", type: "text" },
      { key: "region", label: "Region", type: "text" },
      { key: "order_type", label: "Order Type", type: "text" },
      { key: "customer_status", label: "Customer Status", type: "text" },
      { key: "no_godown", label: "No Godown?", type: "text" },
      { key: "approval_reasons", label: "Approval Reasons", type: "text" },
      { key: "order_status", label: "Order Status", type: "text" },
      { key: "approved_by", label: "Approved By", type: "text" },
      { key: "dispatch_status", label: "Dispatch Status", type: "text" },
      { key: "invoiced", label: "Invoiced?", type: "text" },
      { key: "first_dispatch", label: "First Dispatch", type: "date" },
      { key: "last_dispatch", label: "Last Dispatch", type: "date" },
      { key: "days_since_first_dispatch", label: "Days Since First Dispatch", type: "number" },
      { key: "days_since_last_dispatch", label: "Days Since Last Dispatch", type: "number" },
      { key: "order_age_days", label: "Order Age (days)", type: "number" },
      // used by follow-ups (lib/bi/followups.js), not shown in the builder
      { key: "owner_id", label: "Owner (user)", type: "text", hidden: true },
      { key: "customer_id", label: "Customer id", type: "number", hidden: true },
    ],
    // Follow-ups: who owns a row (the customer's sales person) and its party.
    followup: { owner: "owner_id", party: "customer_id" },
    measures: [
      { key: "orders", label: "Orders", column: "order_no", format: "number", aggs: ["distinct"] },
      { key: "customers", label: "Customers", column: "customer_id", format: "number", aggs: ["distinct"] },
      { key: "ordered_kg", label: "Ordered (KG)", column: "ordered_kg", format: "qty" },
      { key: "dispatched_kg", label: "Dispatched (KG)", column: "dispatched_kg", format: "qty" },
      { key: "balance_kg", label: "Balance to Dispatch (KG)", column: "balance_kg", format: "qty" },
      { key: "order_value", label: "Order Value", column: "order_value", format: "currency" },
      { key: "days_since_dispatch", label: "Days Since First Dispatch", column: "days_since_first_dispatch", format: "number", aggs: ["max", "min", "avg"] },
    ],
    base: async () => Prisma.sql`
      SELECT
        ${BOOK_SQL} AS book,
        om.order_no, om.dated::date AS dated,
        om.party_code AS customer_id, a.acname AS customer,
        COALESCE(u.name, 'OPEN') AS sales_person, om.region,
        a.sales_ares AS owner_id,
        CASE WHEN om."freeOfCost" THEN 'Free of Cost'
             WHEN om."trialProcess" THEN 'Trial Process'
             WHEN om."rateUnderNegotiation" THEN 'Rate Under Negotiation'
             WHEN om."dispatchWithoutGodown" THEN 'Despatch Without Godown'
             ELSE 'Normal' END AS order_type,
        CASE WHEN om."noGodown" THEN 'Yes' ELSE 'No' END AS no_godown,
        COALESCE(NULLIF(a.customer_status, ''), 'Normal') AS customer_status,
        COALESCE(om.approval_reasons, '') AS approval_reasons,
        CASE om.status WHEN 1 THEN 'Open' WHEN 2 THEN 'Closed' WHEN 3 THEN 'Pending Approval' WHEN 4 THEN 'Rejected' ELSE 'Other' END AS order_status,
        COALESCE(ap.name, '') AS approved_by,
        o.ordered_kg::float8 AS ordered_kg,
        o.order_value::float8 AS order_value,
        COALESCE(d.dispatched_kg, 0)::float8 AS dispatched_kg,
        GREATEST(o.ordered_kg - COALESCE(d.dispatched_kg, 0), 0)::float8 AS balance_kg,
        d.first_dispatch, d.last_dispatch,
        (CURRENT_DATE - d.first_dispatch) AS days_since_first_dispatch,
        (CURRENT_DATE - d.last_dispatch) AS days_since_last_dispatch,
        (CURRENT_DATE - om.dated::date) AS order_age_days,
        CASE WHEN COALESCE(d.dispatched_kg, 0) = 0 THEN 'Not dispatched'
             WHEN d.dispatched_kg + 0.5 >= o.ordered_kg THEN 'Fully dispatched'
             ELSE 'Partly dispatched' END AS dispatch_status,
        CASE WHEN COALESCE(d.invoiced, 0) > 0 THEN 'Yes' ELSE 'No' END AS invoiced
      FROM "OrderMaster" om
      JOIN (
        SELECT order_no, SUM(COALESCE(qty, 0)) AS ordered_kg, SUM(COALESCE(amount, 0)) AS order_value
        FROM "OrderDetail" GROUP BY order_no
      ) o ON o.order_no = om.order_no
      LEFT JOIN (
        SELECT tm.so_no,
               SUM(COALESCE(t.qty, 0)) AS dispatched_kg,
               MIN(tm.dated)::date AS first_dispatch,
               MAX(tm.dated)::date AS last_dispatch,
               COUNT(DISTINCT tm.tran_id) FILTER (WHERE COALESCE(tm.invoice_no, '') <> '') AS invoiced
        FROM "TRANSACTIONS_MASTER" tm
        JOIN "Transactions" t ON t.tran_id = tm.tran_id
        WHERE tm.tran_code = 6 AND tm.so_no IS NOT NULL
          AND COALESCE(t.sub_tran_id, 1) = 1 AND t.itcd IS NOT NULL
        GROUP BY tm.so_no
      ) d ON d.so_no = om.order_no
      LEFT JOIN "acno" a ON a.acno = om.party_code
      LEFT JOIN "User" u ON u.id = a.sales_ares
      LEFT JOIN "User" ap ON ap.id = om.approved_by
      WHERE om.order_catagory = 6`,
  },

  // ── Imports pipeline (one row per L/C item line, as of today) ──────────
  // Where every import stands — the same stages as the Imported Material In
  // Transit / Deals in Process reports:
  //   Open Deal → Expiring Soon (≤ 15 days) / LC Expired   (not shipped: no BL date)
  //   In Transit → ETA Passed                               (BL date given)
  //   Arrived - In Bond → Received (GRN)                    (In-Bond entry / GRN made)
  // "Days to ETA" 0–7 = arriving this week; "Days Past ETA" > 0 = late.
  {
    key: "imports",
    drill: ["lc_no", "lc_date", "supplier", "item", "stage", "eta", "days_to_eta", "qty", "fc_amount", "pkr_amount"],
    label: "Imports Pipeline (L/C)",
    description: "Every L/C item line and its stage today: Open Deal, Expiring Soon, LC Expired, In Transit, ETA Passed, Arrived - In Bond, Received (GRN) — with ETA, days to ETA / expiry, supplier, bank, qty and value.",
    icon: "Ship",
    dateColumn: null,
    scope: {},
    fields: [
      { key: "stage", label: "Stage", type: "text", orderColumn: "stage_order" },
      { key: "lc_no", label: "L/C No", type: "text" },
      { key: "lc_date", label: "L/C Date", type: "date" },
      { key: "import_type", label: "Import Type", type: "text" },
      { key: "supplier", label: "Supplier (Beneficiary)", type: "text" },
      { key: "bank", label: "Bank", type: "text" },
      ...ITEM_FIELDS,
      { key: "currency", label: "Currency", type: "text" },
      { key: "vessel", label: "Vessel", type: "text" },
      { key: "ship_company", label: "Shipping Company", type: "text" },
      { key: "etd", label: "ETD", type: "date" },
      { key: "eta", label: "ETA", type: "date" },
      { key: "bl_date", label: "BL Date", type: "date" },
      { key: "docs_arrived", label: "Docs Arrived?", type: "text" },
      { key: "days_to_eta", label: "Days to ETA", type: "number" },
      { key: "days_past_eta", label: "Days Past ETA", type: "number" },
      { key: "days_to_expiry", label: "Days to L/C Expiry", type: "number" },
      { key: "lc_age_days", label: "L/C Age (days)", type: "number" },
      { key: "hidden", label: "Hidden on Transit report?", type: "text" },
    ],
    measures: [
      { key: "lcs", label: "L/Cs", column: "lc_id", format: "number", aggs: ["distinct"] },
      { key: "qty", label: "Qty", column: "qty", format: "qty" },
      { key: "fc_amount", label: "Value (FC)", column: "fc_amount", format: "number" },
      { key: "pkr_amount", label: "Value (PKR)", column: "pkr_amount", format: "currency" },
      { key: "lines", label: "Item Lines", column: "line_id", format: "number", aggs: ["count"] },
    ],
    base: async () => Prisma.sql`
      WITH bonds AS (
        SELECT l.id AS lcm_id, im.id AS inbound_id
        FROM "LCMaster" l JOIN "InboundMaster" im ON im."lCMasterId" = l.id
        UNION
        SELECT l.id, im.id
        FROM "LCMaster" l JOIN "InboundMaster" im ON im.lc_no = l.lc_gl
      ),
      grn AS (
        SELECT l.id AS lcm_id
        FROM "LCMaster" l JOIN "TRANSACTIONS_MASTER" tm ON tm.lc_no = l.lc_no AND tm.tran_code = 4
        UNION
        SELECT b.lcm_id
        FROM bonds b JOIN "TRANSACTIONS_MASTER" tm ON tm.bond_id = b.inbound_id AND tm.tran_code = 4
      ),
      staged AS (
        SELECT l.*,
          CASE
            WHEN l.id IN (SELECT lcm_id FROM grn) THEN 'Received (GRN)'
            WHEN l.id IN (SELECT lcm_id FROM bonds) THEN 'Arrived - In Bond'
            WHEN l.bl_date IS NOT NULL AND l.bl_date::date <= CURRENT_DATE
              THEN CASE WHEN l.eta IS NOT NULL AND l.eta::date < CURRENT_DATE THEN 'ETA Passed' ELSE 'In Transit' END
            WHEN l.lc_exp_date IS NOT NULL AND l.lc_exp_date::date < CURRENT_DATE THEN 'LC Expired'
            WHEN l.lc_exp_date IS NOT NULL AND l.lc_exp_date::date <= CURRENT_DATE + 15 THEN 'Expiring Soon'
            ELSE 'Open Deal'
          END AS stage
        FROM "LCMaster" l
      )
      SELECT
        d.id AS line_id, l.id AS lc_id, l.lc_no, l.lc_date::date AS lc_date,
        COALESCE(l.import_type, '') AS import_type,
        l.stage,
        CASE l.stage WHEN 'Open Deal' THEN 1 WHEN 'Expiring Soon' THEN 2 WHEN 'LC Expired' THEN 3
          WHEN 'In Transit' THEN 4 WHEN 'ETA Passed' THEN 5 WHEN 'Arrived - In Bond' THEN 6 ELSE 7 END AS stage_order,
        COALESCE(ben.acname, '') AS supplier,
        COALESCE(bank.acname, 'No Bank') AS bank,
        i.item AS item, i.code AS item_code, mc.mc_name AS main_category, ic.ic_name AS item_category, i.series AS series,
        COALESCE(l.curr, '') AS currency,
        COALESCE(l.vessel, '') AS vessel, COALESCE(l.ship_company, '') AS ship_company,
        l.etd::date AS etd, l.eta::date AS eta, l.bl_date::date AS bl_date,
        CASE WHEN l.doc_arr_date IS NOT NULL AND l.doc_arr_date::date <= CURRENT_DATE THEN 'Yes' ELSE 'No' END AS docs_arrived,
        (l.eta::date - CURRENT_DATE) AS days_to_eta,
        GREATEST(CURRENT_DATE - l.eta::date, 0) AS days_past_eta,
        (l.lc_exp_date::date - CURRENT_DATE) AS days_to_expiry,
        (CURRENT_DATE - l.lc_date::date) AS lc_age_days,
        CASE WHEN l.is_hidden THEN 'Yes' ELSE 'No' END AS hidden,
        COALESCE(d.qty, 0)::float8 AS qty,
        COALESCE(d.fc_amount, 0)::float8 AS fc_amount,
        COALESCE(d.pkr_amount, 0)::float8 AS pkr_amount
      FROM staged l
      JOIN "LCDetail" d ON d.lcm_id = l.id
      LEFT JOIN "Item" i ON i.itcd = d.itcd
      LEFT JOIN "MainCategory" mc ON mc.id = i.mc_id
      LEFT JOIN "ItemCategory" ic ON ic.id = i.ic_id
      LEFT JOIN "acno" ben ON ben.acno = l.beneficiary
      LEFT JOIN "acno" bank ON bank.acno = l.bank`,
  },

  // ── Follow-up status (one row per follow-up item) ──────────────────────
  // How well follow-ups are being done: per sales person / scenario, how many
  // are overdue, escalated, snoozed or done, and with what result. Items come
  // from the follow-up scenarios (lib/bi/followups.js); a sales person sees
  // only their own customers' items.
  {
    key: "followups",
    drill: ["scenario", "item", "customer", "sales_person", "status", "result", "days_overdue", "due_since", "done_date"],
    label: "Follow-up Status",
    description: "Every follow-up item (Free of Cost / Trial orders and other scenarios): owner, customer, status (Overdue / Snoozed / Done), result, escalated, days overdue.",
    icon: "ClipboardCheck",
    dateColumn: null,
    scope: { customer: "customer_id" },
    fields: [
      { key: "book", label: "Book (On / Off)", type: "text" },
      { key: "scenario", label: "Scenario", type: "text" },
      { key: "item", label: "Item", type: "text" },
      { key: "sales_person", label: "Sales Person / Owner", type: "text" },
      { key: "customer", label: "Customer", type: "text" },
      { key: "status", label: "Status", type: "text" },
      { key: "result", label: "Result", type: "text" },
      { key: "escalated", label: "Escalated?", type: "text" },
      { key: "days_overdue", label: "Days Overdue", type: "number" },
      { key: "due_since", label: "Due Since", type: "date" },
      { key: "done_date", label: "Done On", type: "date" },
    ],
    measures: [
      { key: "items", label: "Follow-ups", column: "id", format: "number", aggs: ["count"] },
      { key: "days_overdue_m", label: "Days Overdue", column: "days_overdue", format: "number", aggs: ["max", "avg"] },
    ],
    base: async () => Prisma.sql`
      SELECT
        ${BOOK_SQL} AS book,
        f.id, q.name AS scenario, COALESCE(f.item_label, f.item_key) AS item,
        COALESCE(u.name, 'Unassigned') AS sales_person,
        f.party_id AS customer_id, a.acname AS customer,
        CASE WHEN f.status = 'done' THEN 'Done' WHEN f.due_since > now() THEN 'Snoozed' ELSE 'Overdue' END AS status,
        CASE f.result WHEN 'approved' THEN 'Customer approved' WHEN 'not_suitable' THEN 'Not suitable'
          WHEN 'more_time' THEN 'Needs more time' WHEN 'other' THEN 'Other' ELSE '' END AS result,
        CASE WHEN f.level > 0 AND f.status = 'open' THEN 'Yes' ELSE 'No' END AS escalated,
        (CASE WHEN f.status = 'open' AND f.due_since <= now() THEN CURRENT_DATE - f.due_since::date ELSE 0 END) AS days_overdue,
        f.due_since::date AS due_since,
        f.done_at::date AS done_date
      FROM "BiFollowup" f
      JOIN "BiQuestion" q ON q.id = f.question_id
      LEFT JOIN "User" u ON u.id = f.owner_id
      LEFT JOIN "acno" a ON a.acno = f.party_id
      WHERE f.status IN ('open', 'done')`,
  },

  // ── General Ledger (every posting) ─────────────────────────────────────
  {
    key: "ledger",
    label: "General Ledger",
    description: "Every posting line with its account, group, head (Assets / Liabilities / Income / Expenses) and debit / credit, using the ledger's receipt / payment rules. Account Type (Cash & Bank / Customer / Vendor / Other) follows Finance → Account Settings. Expenses = Main Head is EXPENSES; bank balance = All Time, Account Type Cash & Bank, group by account.",
    icon: "BookOpen",
    dateColumn: "dated",
    scope: { customer: "account_id" },
    drill: ["dated", "doc_type", "vr_no", "account", "account_group", "debit", "credit"],
    fields: [
      { key: "book", label: "Book (On / Off)", type: "text" },
      { key: "dated", label: "Date", type: "date" },
      { key: "main_head", label: "Main Head", type: "text" },
      { key: "head", label: "Head", type: "text" },
      { key: "account_group", label: "Account Group", type: "text" },
      { key: "account_type", label: "Account Type", type: "text" },
      { key: "account", label: "Account", type: "text" },
      { key: "doc_type", label: "Document Type", type: "text" },
      { key: "vr_no", label: "Voucher No", type: "number" },
    ],
    measures: [
      { key: "net_debit", label: "Net (Debit − Credit)", column: "net_debit", format: "currency" },
      { key: "net_credit", label: "Net (Credit − Debit)", column: "net_credit", format: "currency" },
      { key: "debit", label: "Debit", column: "debit", format: "currency" },
      { key: "credit", label: "Credit", column: "credit", format: "currency" },
      { key: "accounts", label: "Accounts", column: "account_id", format: "number", aggs: ["distinct"] },
    ],
    base: async () => {
      const [cashBank, customers, vendors] = await Promise.all([getCashBankMacnos(), getCustomerMacnos(), getVendorMacnos()]);
      return Prisma.sql`
      SELECT
        ${BOOK_SQL} AS book,
        t.id AS line_id, tm.tran_id, tm.dated::date AS dated, tm.vr_no,
        ${DOC_TYPE} AS doc_type,
        t.acno AS account_id, a.acname AS account,
        COALESCE(m.macname, '(no group)') AS account_group,
        CASE
          WHEN a.macno IN (${macnoList(cashBank)}) THEN 'Cash & Bank'
          WHEN a.macno IN (${macnoList(customers)}) THEN 'Customer'
          WHEN a.macno IN (${macnoList(vendors)}) THEN 'Vendor'
          ELSE 'Other'
        END AS account_type,
        COALESCE(b."bscdDetail", '(no head)') AS head,
        COALESCE(mb."mbscdDetail", '(no main head)') AS main_head,
        v.dr::float8 AS debit, v.cr::float8 AS credit,
        (v.dr - v.cr)::float8 AS net_debit, (v.cr - v.dr)::float8 AS net_credit
      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      JOIN "acno" a ON a.acno = t.acno
      LEFT JOIN "MACNO" m ON m.macno = a.macno
      LEFT JOIN "BSCD" b ON b.bscd = m.bscd
      LEFT JOIN "MBSCD" mb ON mb.mbscd = b.mbscd
      CROSS JOIN LATERAL (SELECT ${LEDGER_DR} AS dr, ${LEDGER_CR} AS cr) v
      WHERE t.acno IS NOT NULL AND tm.tran_code IN (${Prisma.join(LEDGER_TRAN_CODES)})`;
    },
  },

  // ── Receivables / Customer Aging (point in time: today) ────────────────
  {
    key: "receivables",
    label: "Receivables (Aging)",
    description: "What every customer owes right now, split into Current / 1-30 / 31-60 / 61-90 / 90+ days past their credit terms — the same figures as the Customer Aging report and the Sales Team MIS.",
    icon: "Hourglass",
    dateColumn: null,
    scope: { customer: "customer_id" },
    drill: ["customer", "sales_person", "city", "customer_status", "bucket", "amount"],
    fields: [
      { key: "book", label: "Book (On / Off)", type: "text" },
      { key: "bucket", label: "Aging Bucket", type: "text", orderColumn: "bucket_order" },
      { key: "customer", label: "Customer", type: "text" },
      { key: "sales_person", label: "Sales Person", type: "text" },
      { key: "city", label: "City", type: "text" },
      { key: "customer_status", label: "Customer Status", type: "text" },
      { key: "credit_days", label: "Credit Days", type: "number" },
    ],
    measures: [
      { key: "amount", label: "Outstanding", column: "amount", format: "currency" },
      { key: "overdue", label: "Overdue (past terms)", column: "overdue", format: "currency" },
      { key: "customers", label: "Customers", column: "customer_id", format: "number", aggs: ["distinct"] },
    ],
    base: async () => Prisma.sql`
      SELECT
        ${BOOK_SQL} AS book,
        r.customer_id, r.bucket, r.bucket_order,
        a.acname AS customer, a.city, COALESCE(a.cr_days, 0) AS credit_days,
        COALESCE(a.customer_status, '') AS customer_status,
        COALESCE(u.name, 'OPEN') AS sales_person,
        r.amount::float8 AS amount,
        (CASE WHEN r.bucket <> 'Current' THEN r.amount ELSE 0 END)::float8 AS overdue
      FROM (${await customerAgingRowsSql(new Date())}) r
      JOIN "acno" a ON a.acno = r.customer_id
      LEFT JOIN "User" u ON u.id = a.sales_ares`,
  },

  // ── Payables (point in time: today) ────────────────────────────────────
  {
    key: "payables",
    label: "Payables (Vendors)",
    description: "What is owed to every vendor right now (ledger credit − debit), with the last purchase and last payment dates.",
    icon: "Landmark",
    dateColumn: null,
    scope: {},
    drill: ["vendor", "vendor_group", "balance", "last_purchase", "last_payment"],
    fields: [
      { key: "book", label: "Book (On / Off)", type: "text" },
      { key: "vendor", label: "Vendor", type: "text" },
      { key: "vendor_group", label: "Vendor Group", type: "text" },
      { key: "last_purchase", label: "Last Purchase", type: "text" },
      { key: "last_payment", label: "Last Payment", type: "text" },
    ],
    measures: [
      { key: "balance", label: "Payable Balance", column: "balance", format: "currency" },
      { key: "vendors", label: "Vendors", column: "vendor_id", format: "number", aggs: ["distinct"] },
    ],
    base: async () => Prisma.sql`
      WITH led AS (
        SELECT t.acno, tm.tran_code, tm.dated, ${LEDGER_DR} AS dr, ${LEDGER_CR} AS cr
        FROM "Transactions" t
        JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
        JOIN "acno" va ON va.acno = t.acno AND va.macno IN (${macnoList(await getVendorMacnos())})
        WHERE tm.tran_code IN (${Prisma.join(LEDGER_TRAN_CODES)})
      )
      SELECT
        ${BOOK_SQL} AS book,
        l.acno AS vendor_id, a.acname AS vendor, COALESCE(m.macname, '') AS vendor_group,
        SUM(l.cr - l.dr)::float8 AS balance,
        COALESCE(to_char(MAX(l.dated) FILTER (WHERE l.tran_code IN (4, 21)), 'YYYY-MM-DD'), '—') AS last_purchase,
        COALESCE(to_char(MAX(l.dated) FILTER (WHERE l.tran_code = 2), 'YYYY-MM-DD'), '—') AS last_payment
      FROM led l
      JOIN "acno" a ON a.acno = l.acno
      LEFT JOIN "MACNO" m ON m.macno = a.macno
      GROUP BY l.acno, a.acname, m.macname, book
      HAVING ABS(SUM(l.cr - l.dr)) >= 0.5`,
  },

  // ── Production (issues tran_code 7 + output tran_code 8) ───────────────
  {
    key: "production",
    label: "Production",
    description: "Material issued (tran_code 7) and finished output (tran_code 8) per item and godown. The automatic vouchers made by dispatches (packing consumed, BOM materials issued, produce-on-dispatch output) are real movements and are included, each as its own Movement.",
    icon: "Factory",
    dateColumn: "dated",
    scope: { godown: "godown_id" },
    drill: ["dated", "movement", "item", "godown", "qty_kg"],
    fields: [
      { key: "dated", label: "Date", type: "date" },
      { key: "movement", label: "Movement", type: "text" },
      { key: "godown", label: "Godown", type: "text" },
      ...ITEM_FIELDS,
    ],
    measures: [
      { key: "produced_kg", label: "Produced (KG)", column: "produced_kg", format: "qty" },
      { key: "issued_kg", label: "Issued (KG)", column: "issued_kg", format: "qty" },
      { key: "qty_kg", label: "Qty (KG)", column: "qty_kg", format: "qty" },
      { key: "documents", label: "Documents", column: "tran_id", format: "number", aggs: ["distinct"] },
    ],
    base: async () => Prisma.sql`
      SELECT
        t.id AS line_id, tm.tran_id, tm.dated::date AS dated,
        CASE
          WHEN tm.tran_code = 8 AND tm.rmk1 = 'AUTO_DISPATCH_PROD' THEN 'Produced (dispatch)'
          WHEN tm.tran_code = 8 THEN 'Produced'
          WHEN tm.rmk1 = 'AUTO_PACKING' THEN 'Packing (dispatch)'
          WHEN tm.rmk1 = 'AUTO_DISPATCH_BOM' THEN 'Issued (dispatch BOM)'
          ELSE 'Issued'
        END AS movement,
        -- the master godown, as stock counts it (lib/stock/godownStock.js)
        tm.godown AS godown_id, g.godown AS godown,
        t.itcd AS item_id, ${ITEM_COLUMNS},
        COALESCE(t.qty, 0)::float8 AS qty_kg,
        (CASE WHEN tm.tran_code = 8 THEN COALESCE(t.qty, 0) ELSE 0 END)::float8 AS produced_kg,
        (CASE WHEN tm.tran_code = 7 THEN COALESCE(t.qty, 0) ELSE 0 END)::float8 AS issued_kg
      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      LEFT JOIN "Godown" g ON g.id = tm.godown
      ${ITEM_JOINS}
      WHERE tm.tran_code IN (7, 8) AND COALESCE(t.sub_tran_id, 1) = 1 AND t.itcd IS NOT NULL`,
  },

  // ── Sale Returns (tran_code 10) ────────────────────────────────────────
  {
    key: "sale_returns",
    label: "Sale Returns",
    description: "Every returned item line (tran_code 10): customer, item, qty and value, godown it came back into.",
    icon: "Undo2",
    dateColumn: "dated",
    scope: { godown: "godown_id", customer: "customer_id" },
    drill: ["dated", "return_no", "customer", "item", "godown", "qty_kg", "amount", "invoice_no"],
    fields: [
      { key: "book", label: "Book (On / Off)", type: "text" },
      { key: "dated", label: "Date", type: "date" },
      { key: "customer", label: "Customer", type: "text" },
      { key: "sales_person", label: "Sales Person", type: "text" },
      { key: "godown", label: "Godown", type: "text" },
      ...ITEM_FIELDS,
      { key: "invoice_no", label: "Against Invoice", type: "text" },
    ],
    measures: [
      { key: "amount", label: "Return Value", column: "amount", format: "currency" },
      { key: "qty_kg", label: "Qty (KG)", column: "qty_kg", format: "qty" },
      { key: "returns", label: "Returns", column: "tran_id", format: "number", aggs: ["distinct"] },
      { key: "customers", label: "Customers", column: "customer_id", format: "number", aggs: ["distinct"] },
    ],
    base: async () => Prisma.sql`
      SELECT
        ${BOOK_SQL} AS book,
        t.id AS line_id, tm.tran_id, tm.vr_no AS return_no, tm.dated::date AS dated,
        tm.pycd AS customer_id, a.acname AS customer, COALESCE(u.name, 'OPEN') AS sales_person,
        tm.godown AS godown_id, g.godown AS godown,
        t.itcd AS item_id, ${ITEM_COLUMNS},
        COALESCE(NULLIF(tm.invoice_no, ''), '—') AS invoice_no,
        COALESCE(t.qty, 0)::float8 AS qty_kg,
        COALESCE(t.damt, 0)::float8 AS amount
      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      LEFT JOIN "acno" a ON a.acno = tm.pycd
      LEFT JOIN "User" u ON u.id = a.sales_ares
      LEFT JOIN "Godown" g ON g.id = tm.godown
      ${ITEM_JOINS}
      WHERE tm.tran_code = 10 AND COALESCE(t.sub_tran_id, 1) = 1 AND t.itcd IS NOT NULL`,
  },

  // ── Sales Targets vs Actual (per customer per month) ───────────────────
  {
    key: "sales_targets",
    label: "Sales Targets vs Actual",
    description:
      "Per customer per month: Target Qty (Ton) and Target Recovery from the Sales Targets screen, against actual dispatch (Ton, sale amount) and actual recovery (knock-offs in the month against invoices already overdue when it began) — the same rules as the Sales Team MIS. Achievement % is calculated on the totals.",
    icon: "Target",
    dateColumn: "month",
    scope: { customer: "customer_id" },
    drill: ["month", "customer", "sales_person", "category", "target_qty_ton", "actual_qty_ton", "target_recovery", "actual_recovery"],
    fields: [
      { key: "book", label: "Book (On / Off)", type: "text" },
      { key: "month", label: "Month", type: "date" },
      { key: "customer", label: "Customer", type: "text" },
      { key: "sales_person", label: "Sales Person", type: "text" },
      { key: "category", label: "Category (Active / Inactive / Bad Debt …)", type: "text" },
      { key: "city", label: "City", type: "text" },
    ],
    measures: [
      { key: "target_qty_ton", label: "Target Qty (Ton)", column: "target_qty_ton", format: "qty" },
      { key: "actual_qty_ton", label: "Actual Qty (Ton)", column: "actual_qty_ton", format: "qty" },
      { key: "qty_achievement", label: "Qty Achievement %", column: "actual_qty_ton", format: "percent", ratio: { num: "actual_qty_ton", den: "target_qty_ton" } },
      { key: "target_recovery", label: "Target Recovery", column: "target_recovery", format: "currency" },
      { key: "actual_recovery", label: "Actual Recovery", column: "actual_recovery", format: "currency" },
      { key: "recovery_achievement", label: "Recovery Achievement %", column: "actual_recovery", format: "percent", ratio: { num: "actual_recovery", den: "target_recovery" } },
      { key: "sale_amount", label: "Sale Amount", column: "sale_amount", format: "currency" },
      { key: "customers", label: "Customers", column: "customer_id", format: "number", aggs: ["distinct"] },
    ],
    base: async () => Prisma.sql`
      WITH tgt AS (
        -- +12h folds month-end rows written at local midnight (19:00 UTC the
        -- day before) into the month they belong to.
        SELECT t.acno, date_trunc('month', t.dated + interval '12 hours')::date AS month,
               SUM(COALESCE(t."targetQty", 0))::float8 AS target_qty_ton,
               SUM(COALESCE(t."targetRecovery", 0))::float8 AS target_recovery
        FROM "CustomerMonthlyTarget" t
        GROUP BY 1, 2
      ),
      disp AS (
        SELECT tm.pycd AS acno, date_trunc('month', tm.dated)::date AS month,
               (SUM(COALESCE(t.qty, 0)) / 1000.0)::float8 AS actual_qty_ton,
               SUM(COALESCE(t.camt, 0))::float8 AS sale_amount
        FROM "Transactions" t
        JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
        WHERE tm.tran_code = 6 AND COALESCE(t.sub_tran_id, 1) = 1 AND tm.pycd IS NOT NULL
        GROUP BY 1, 2
      ),
      -- Actual Recovery (Sales Team MIS rule, lib/reports/salesTeamMis.js):
      -- receipts / JVs knocked off (INVOICE_KNOCKOFF) whose document is dated
      -- in the month, against invoices already OVERDUE before the month began
      -- (invoice date + credit days earlier than the day before the 1st).
      rec AS (
        SELECT k.invoice_party_acno AS acno, date_trunc('month', src.dated)::date AS month,
               SUM(k.allocated_amount)::float8 AS actual_recovery
        FROM "INVOICE_KNOCKOFF" k
        JOIN "TRANSACTIONS_MASTER" src ON src.tran_id = k.source_tran_id
        JOIN "TRANSACTIONS_MASTER" inv ON inv.tran_id = k.invoice_tran_id
        JOIN "acno" ka ON ka.acno = k.invoice_party_acno
        WHERE k.reversed_at IS NULL AND k.invoice_party_acno IS NOT NULL
          AND (inv.dated::date + COALESCE(ka.cr_days, 0)) < (date_trunc('month', src.dated)::date - 1)
        GROUP BY 1, 2
      ),
      keys AS (SELECT acno, month FROM tgt UNION SELECT acno, month FROM disp UNION SELECT acno, month FROM rec)
      SELECT
        ${BOOK_SQL} AS book,
        k.acno AS customer_id, k.month,
        a.acname AS customer, a.city,
        COALESCE(u.name, 'OPEN') AS sales_person,
        CASE
          WHEN UPPER(TRIM(COALESCE(a.customer_status, ''))) IN ('BAD-DEBT', 'BAD DEBT', 'BAD-DEBTS') THEN 'BAD-DEBTS'
          WHEN UPPER(TRIM(COALESCE(a.customer_status, ''))) IN ('BAD-PAYMENT', 'BAD PAYMENT', 'BAD-PAYMENTS') THEN 'BAD-PAYMENTS'
          WHEN TRIM(COALESCE(a.customer_status, '')) = '' THEN CASE WHEN a.is_active THEN 'Active' ELSE 'Inactive' END
          ELSE UPPER(TRIM(a.customer_status))
        END AS category,
        COALESCE(tg.target_qty_ton, 0)::float8 AS target_qty_ton,
        COALESCE(d.actual_qty_ton, 0)::float8 AS actual_qty_ton,
        COALESCE(tg.target_recovery, 0)::float8 AS target_recovery,
        COALESCE(r.actual_recovery, 0)::float8 AS actual_recovery,
        COALESCE(d.sale_amount, 0)::float8 AS sale_amount
      FROM keys k
      JOIN "acno" a ON a.acno = k.acno AND a.macno IN (${macnoList(await getCustomerMacnos())})
      LEFT JOIN "User" u ON u.id = a.sales_ares
      LEFT JOIN tgt tg ON tg.acno = k.acno AND tg.month = k.month
      LEFT JOIN disp d ON d.acno = k.acno AND d.month = k.month
      LEFT JOIN rec r ON r.acno = k.acno AND r.month = k.month`,
  },
];

export const datasetByKey = (key) => DATASETS.find((d) => d.key === key);

/** What the builder may see — no SQL, no internal columns. */
export const datasetMeta = (d) => ({
  key: d.key,
  label: d.label,
  description: d.description,
  icon: d.icon,
  hasDate: Boolean(d.dateColumn),
  fields: d.fields.filter((f) => !f.hidden).map(({ key, label, type }) => ({ key, label, type })),
  followup: d.followup ? { owner: Boolean(d.followup.owner), party: Boolean(d.followup.party) } : null,
  drill: (d.drill ?? []).map((c) => {
    const fld = d.fields.find((x) => x.key === c);
    const msr = d.measures.find((x) => x.column === c);
    return { column: c, label: fld?.label ?? msr?.label ?? c, format: msr?.format ?? null };
  }),
  measures: d.measures.map(({ key, label, format, aggs, ratio }) => ({
    key,
    label,
    format,
    aggs: ratio ? ["ratio"] : aggs ?? ["sum", "avg", "min", "max"],
  })),
});
