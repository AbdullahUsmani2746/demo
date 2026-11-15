# ProjectEbizz — Accounting System: Deep Technical Reference
> Last updated: 2026-05-12  
> Purpose: Complete, deep explanation of every module, file, and piece of logic so you never need to re-explain it.

---

## TABLE OF CONTENTS
1. [Architecture Overview](#1-architecture-overview)
2. [Tech Stack (with Why)](#2-tech-stack-with-why)
3. [Authentication & Authorization](#3-authentication--authorization)
4. [Database Layer — Prisma Client](#4-database-layer--prisma-client)
5. [The Core Transaction System](#5-the-core-transaction-system)
6. [Notification System](#6-notification-system)
7. [API Routes — Deep Logic](#7-api-routes--deep-logic)
8. [Report Engine — Every Report Type](#8-report-engine--every-report-type)
9. [Manufacturing Module](#9-manufacturing-module)
10. [POS Module](#10-pos-module)
11. [Factory Scan System](#11-factory-scan-system)
12. [Setup / Entity CRUD System](#12-setup--entity-crud-system)
13. [Orders System](#13-orders-system)
14. [Pages (Frontend Routes)](#14-pages-frontend-routes)
15. [Components — Deep Breakdown](#15-components--deep-breakdown)
16. [Hooks](#16-hooks)
17. [Context Providers](#17-context-providers)
18. [PDF Template System](#18-pdf-template-system)
19. [Validators](#19-validators)
20. [Scheduled Jobs & Utils](#20-scheduled-jobs--utils)
21. [Services (WooCommerce)](#21-services-woocommerce)
22. [Key Patterns & Conventions](#22-key-patterns--conventions)

---

## 1. Architecture Overview

```
Browser (Next.js React 19 App Router)
    │
    ├── app/(pages)/   ← All UI pages, organized by feature
    ├── components/    ← Reusable UI components
    ├── hooks/         ← Custom React hooks
    ├── context/       ← Global React contexts
    │
    ▼
middleware.js          ← Route-level auth guard (runs before every request)
    │
    ▼
app/api/               ← All backend API routes (Next.js Route Handlers)
    │
    ▼
lib/prisma.js          ← Prisma ORM client (extended with notification hooks)
    │
    ▼
PostgreSQL Database     ← All data stored here
```

The app uses **Next.js App Router** — every folder under `app/` is either a page or an API route. There is no separate backend server; API routes run as serverless functions.

---

## 2. Tech Stack (with Why)

| Technology | Version | Purpose & Why It's Used |
|---|---|---|
| Next.js | 15.1.9 | Full-stack React framework. App Router gives file-based routing for both pages and APIs in one codebase |
| React | 19 | UI library |
| Prisma | 6.6 | ORM for PostgreSQL. Gives type-safe queries and schema migrations |
| PostgreSQL | — | Primary database. All accounting/transaction data stored here |
| NextAuth v4 | 4.24.11 | Session management and authentication. JWT strategy with bcrypt password hashing |
| TailwindCSS | — | Utility-first CSS |
| shadcn/ui (Radix) | — | Accessible, headless UI component primitives |
| TanStack React Query | 5 | Server state management — caching, background refetching for API calls |
| React Hook Form | 7 | Form state management with Zod validation |
| Zod | — | Schema validation for form inputs and API data |
| Chart.js + React-Chartjs-2 | 4 | Sales graphs and dashboards |
| jsPDF + jspdf-autotable | 3 | Generate PDF reports and vouchers client-side |
| pdf-lib | 1.17 | Merge/modify existing PDF templates |
| ExcelJS + xlsx | — | Export reports to Excel (.xlsx) |
| date-fns | 4 | Date formatting and arithmetic |
| Framer Motion | 12 | UI animations |
| Axios | 1.7 | HTTP client. Configured in `lib/axiosInstance.js` with base URL and auth headers |
| use-scan-detection | — | Detect barcode scanner input (USB HID scanners send keystrokes rapidly) |
| @dnd-kit | — | Drag-and-drop (menu builder, column ordering) |
| WooCommerce REST API | — | Sync products/orders with an external WooCommerce store (currently commented out) |
| Vercel + Docker | — | Dual deployment support |

---

## 3. Authentication & Authorization

### File: `middleware.js`
This is the **first line of defense**. It runs before EVERY page and API request.

**How it works:**
1. Uses `next-auth/middleware` (`withAuth`) to automatically check for a valid JWT session token
2. If no token → redirected to `/auth/signin`
3. If token exists, checks the user's `role` field against allowed roles per route:

| Route prefix | Allowed roles |
|---|---|
| `/admin/*` | `ADMIN` only |
| `/accounting/*` | `ADMIN`, `ACCOUNTANT`, `MANAGER`, `EMPLOYEE` |
| `/pos/*` | `ADMIN`, `MANAGER`, `CASHIER`, `ACCOUNTANT` |
| `/dashboard/*` | Any authenticated user |
| `/api/*` | Any authenticated user (API-level guards are separate) |

**Roles in the system:** `ADMIN`, `ACCOUNTANT`, `MANAGER`, `EMPLOYEE`, `CASHIER`

### File: `lib/auth.js`
NextAuth configuration:
- **Provider:** `CredentialsProvider` (email+password login, no OAuth)
- **Username OR email:** The `authorize` function checks if the input contains `@` and `.` to decide whether to query by `email` or `username`
- **Password hashing:** `bcryptjs.compare()` — passwords are never stored in plain text
- **Account deactivation:** If `user.isActive === false`, throws `"Account is deactivated"` error
- **JWT callback:** Adds `role` to the JWT token so middleware can read it without a DB call
- **Session callback:** Exposes `user.id` and `user.role` on the client-side session
- **Custom pages:** Login at `/auth/signin`, errors at `/auth/error`

### File: `lib/auth-helpers.js` and `lib/client-helpers.js`
Server-side and client-side utility functions to get the current session and check roles without repeating code across API routes.

---

## 4. Database Layer — Prisma Client

### File: `lib/prisma.js`
This is not a plain Prisma client — it has two important extensions:

#### Extension 1: `withAccelerate` (Prisma Accelerate)
Adds query result caching via Prisma's Accelerate service. Speeds up frequent repeated queries like account lookups.

#### Extension 2: Notification Middleware (Custom)
The Prisma client is extended to **automatically fire notifications** after any `create` or `update` operation:

```
prisma.anyModel.create(data)
    → runs query
    → result returned
    → calls dispatchNotification({ model, action: "create", result })
    → looks up which notification event to fire
    → calls the right handler
    → saves notification to database
```

**Why this is important:** You never need to manually trigger notifications after saving data. It happens automatically for every Prisma model that has an event registered in `lib/notifications/config.js`.

**Important:** The notification dispatcher uses `basePrisma` (the client WITHOUT the notification extension) to save the notification itself. This prevents an infinite loop where saving a notification triggers another notification.

### `prisma/schema.prisma`
Defines all database tables. Key models:

| Model | Table Name | Purpose |
|---|---|---|
| `TransactionsMaster` | `TRANSACTIONS_MASTER` | Header of every financial/inventory transaction |
| `Transactions` | `Transactions` | Line items for each transaction (Dr/Cr rows, stock rows) |
| `acno` | `acno` | Account ledger (sub-accounts, e.g. individual vendors, customers) |
| `MACNO` | `MACNO` | Main account groups (e.g. "Vendors" macno=53, "Customers" macno=35) |
| `Item` | `Item` | Item/product master |
| `ItemCategory` | `ItemCategory` | Item categories (links to GL accounts for COGS, sales) |
| `Godown` | `Godown` | Warehouse/storage locations |
| `OrderMaster` | `OrderMaster` | Header of purchase orders / sale orders |
| `OrderDetail` | `OrderDetail` | Line items of orders |
| `BomMaster` | `BomMaster` | Bill of Materials header |
| `BomDetail` | `BomDetail` | BOM line items (material → finished product %) |
| `QualityMaster` | `QualityMaster` | QC inspection records |
| `productionPlanMaster` | — | Production plan header |
| `productionPlanDetail` | — | Production plan materials |
| `User` | — | App users with roles |
| `Company` | — | Company profile |
| `Currency` | — | Currency settings |

---

## 5. The Core Transaction System

This is the most critical part of the entire application. **All financial and inventory movement flows through two tables.**

### `TRANSACTIONS_MASTER` — The Header
One row per transaction. Contains:
- `tran_id` — Auto-increment primary key
- `tran_code` — **The most important field.** Integer that defines what TYPE of transaction this is
- `dated` — Transaction date
- `vr_no` — Voucher number (per type)
- `invoice_no` — Invoice number (for purchases/sales)
- `pycd` — Main party account (vendor for purchase, customer for sale)
- `godown` — Primary godown (warehouse)
- `godown2` — Secondary godown (for inter-godown transfers)
- `po_no` — Linked purchase order number
- `so_no` — Linked sale order number
- `rmk`, `rmk1`–`rmk5` — Remarks/narration fields
- `discount`, `payment_mode` — POS-specific fields

### `Transactions` — The Line Items
Multiple rows per `tran_id`. Contains:
- `tran_id` — Foreign key to header
- `sub_tran_id` — Type of line item (see below)
- `acno` — Account code (for Dr/Cr entries)
- `itcd` — Item code (for stock entries)
- `damt` — Debit amount
- `camt` — Credit amount
- `qty` — Quantity (for stock transactions)
- `rate`, `gross_amount` — Pricing
- `narration1`–`narration5` — Line-level narration

### Transaction Codes (`tran_code`) — The Heart of the System

| Code | Name | Stock Effect | Account Effect |
|---|---|---|---|
| 1 | Receipt | None | Bank/Cash IN (credit party, debit bank) |
| 2 | Payment | None | Bank/Cash OUT (debit party, credit bank) |
| 3 | Journal / Opening Balance | None | Manual Dr/Cr entries |
| 4 | Purchase Invoice / GRN | +Stock IN | Debit inventory, Credit vendor |
| 5 | POS Sale | -Stock OUT | Debit cash/bank, Credit sales |
| 6 | Sale Invoice / Dispatch | -Stock OUT | Debit customer, Credit sales |
| 7 | Material Issue | -Stock OUT | Debit production, Credit inventory |
| 8 | Production / Material Input | +Stock IN (finished goods) | Debit inventory, Credit production |
| 9 | Purchase Return | -Stock OUT | Credit inventory, Debit vendor |
| 10 | Sale Return | +Stock IN | Credit customer, Debit sales |
| 11 | Inter-Godown Transfer | +/- between godowns | No account effect |
| 12 | POS Sale Return | +Stock IN | Credit cash, Debit sales return |
| 13 | Sales Order Shipment Return | +Stock IN | Debit customer, Credit sales |
| 20 | Service Entry / Invoice | None | Service billing |

### `sub_tran_id` — Line Item Types

| Value | Meaning |
|---|---|
| 1 | Main item line (stock row OR primary Dr/Cr) |
| 2 | Secondary line (charges, deductions, additional Dr/Cr) |
| 3 | Tax/control line — **excluded from most reports and calculations** |

### How Stock is Calculated (Any Report)
```
Stock =
  SUM(qty WHERE tran_code IN (4, 8, 10, 12))   -- Stock IN
  - SUM(qty WHERE tran_code IN (5, 6, 7, 9))   -- Stock OUT
  + SUM(qty WHERE tran_code=11 AND godown2=X)  -- Transfer IN to godown X
  - SUM(qty WHERE tran_code=11 AND godown=X)   -- Transfer OUT from godown X
```
When summing ALL godowns together, tran_code=11 transfers cancel out (IN and OUT are equal and opposite).

### How Account Balances are Calculated
The logic differs by `tran_code` and `sub_tran_id`:
- **Receipt (1):** sub_tran_id=1 → credit party; sub_tran_id=2,3 → debit charges
- **Payment (2):** sub_tran_id=1 → debit party; sub_tran_id=2,3 → credit charges
- **All others (3,4,5,6,9,10,12):** `damt` = debit, `camt` = credit, always

### Opening Balance Calculation
Used in account ledger and stock ledger. Logic: sum all transactions strictly BEFORE the `dateFrom` date. This gives the balance that existed before the report period started.

---

## 6. Notification System

### Architecture
```
Any Prisma create/update
    ↓
lib/prisma.js (extended client)
    ↓
lib/notifications/dispatcher.js → dispatchNotification()
    ↓
lib/notifications/config.js → looks up model → gets event name
    ↓
lib/notifications/handlers/ → specific handler (transaction, item, production, etc.)
    ↓
Saves to Notification table in DB
    ↓
NotificationBell.jsx polls api/notifications/route.js
```

### File: `lib/notifications/config.js`
Two key maps:
1. `notificationEvents` — Maps Prisma model names to event names:
   - `TransactionsMaster.create` → `"transactionCreated"`
   - `QualityMaster.create` → `"qualityCheckCreated"`
   - `productionPlanMaster.update` → `"productionUpdated"`
2. `NOTIFICATION_ROLES` — Maps event names to which user roles get notified:
   - Most notifications go to `ACCOUNTANT` role
   - Production events go to production-related roles

### Notification Events Supported
- `transactionCreated`, `transactionUpdated`
- `purchaseOrderCreated`, `purchaseOrderApproved`
- `grnCreated`
- `qualityCheckCreated`, `qualityCheckApproved`, `qualityCheckRejected`, `qualityCheckRework`, `qualityCheckUpdated`
- `productionCreated`, `productionStarted`, `productionCompleted`, `productionPosted`, `productionUpdated`
- `requisitionCreated`, `requisitionApproved`
- `salesOrderCreated`, `stockOutDispatched`
- `itemCreated`, `itemUpdated`
- `taxChallanCreated`, `taxChallanUpdated`
- `userCreated`, `userUpdated`, `employeeCreated`, `employeeUpdated`

### API: `api/notifications/`
- `GET /api/notifications` — Get all notifications for the current user
- `GET /api/notifications/all` — All notifications (admin)
- `POST /api/notifications/mark-all-read` — Mark all as read
- `PATCH /api/notifications/[id]` — Mark single as read
- `DELETE /api/notifications/[id]` — Delete a notification

---

## 7. API Routes — Deep Logic

### `api/invoice/route.js` — The Transaction Engine
This is the most complex API. It handles CREATE, READ, UPDATE, DELETE for ALL transaction types (vouchers, invoices, GRNs, etc.).

**GET:** Fetches invoices by `invoice_no`. Uses `$queryRawUnsafe` with CAST to INTEGER for sorting by invoice number numerically. Supports filtering by `tran_code`.

**POST/PUT (save transaction):** Flow:
1. Validates using `validators/voucherValidator.js` (Zod schema)
2. Checks stock availability via `api/invoice/check-stock` before saving
3. Checks invoice number uniqueness via `api/invoice/check-invoice`
4. Saves to `TRANSACTIONS_MASTER` (header)
5. Saves each line item to `Transactions` (details)
6. Prisma extension auto-fires `transactionCreated` notification

**Key sub-routes:**

| Sub-route | Purpose |
|---|---|
| `check-stock` | Queries current stock before allowing a sale/issue. Prevents overselling |
| `check-amount` | Validates total debits = total credits (double-entry rule) |
| `check-challan` | Checks if a tax challan number already exists |
| `next-vr-no` | Gets the next voucher number for a given `tran_code` |
| `next-invoice-no` | Gets the next invoice number, sorted numerically via CAST |
| `original-for-return` | Fetches original transaction so a return references correct qty/rates |
| `outstanding` | Returns all invoices with outstanding balances for a customer/vendor |
| `generate-pdf` | Triggers PDF generation using jsPDF templates from `components/Template/` |

### `api/setup/[entity]/route.js` — Universal CRUD
**The most reusable API in the project.** A single route that handles CRUD for 30+ different setup tables.

**How it works:**
1. `entity` URL param (e.g. `"godowns"`, `"item_categories"`, `"currencies"`) maps to `lib/entityModelMap.js`
2. `entityModelMap.js` returns the Prisma model, field mapping function, searchable fields, default sort, and optional `include`
3. The route dynamically builds `where`, `orderBy`, and `select` clauses
4. Supports: pagination, search, sort, dynamic filters from query params, `defaultWhere` for pre-filtering

**Dynamic filter logic:**
- Query params that are not `page`, `limit`, `search`, `sortField`, `sortOrder` are automatically added to the `where` clause
- String `"null"` is converted to actual `null`
- Numeric strings are converted to `Number`

### `api/accounts/` — Chart of Accounts
- `acno` — Individual accounts (sub-accounts). Filterable by `macno` (main group). Used by all dropdowns that need to pick a vendor, customer, bank, etc.
- `macno` — Main account groups (e.g. macno=53 = Vendors, macno=35 = Customers, macno=65 = Banks)
- `all` — Returns all accounts
- `bscd` / `mbscd` — Balance sheet codes for financial statement grouping

### `api/graphs/route.js`
Serves data for the dashboard graphs. Supports multiple graph types:
- Sales amount over time
- Sales quantity over time
- Sales by region
- Combined sales metrics

Also exposes `api/graphs/permissions` to control which users can see which graphs.

### `api/tax-challan/route.js`
Manages tax challans linked to purchase/sale invoices. Validates challan number uniqueness before saving.

### `api/dispatch/route.js`
Dispatch records — records when goods physically leave the warehouse linked to a sale invoice.

### `api/opening-stock/calculate/`
Calculates and stores opening stock for a given month/year/godown combination. Used by the monthly stock scheduled job and can be triggered manually.

### `api/material/requisition/`
Material requisition notes — a request from production to store to issue materials. Creates `ReqMaster` records which trigger the `requisitionCreated` notification.

### `api/store/qa-entry/`
Store QA entry — when received goods pass QC at the store level before being added to inventory.

### `api/inventory/stock/`
Returns current stock levels per item/godown. Used by the check-stock validation before allowing sales.

### `api/inventory/returnable-packing/`
Tracks returnable packaging materials sent to customers. Records both outgoing (with sales) and return of empty packaging.

---

## 8. Report Engine — Every Report Type

### Architecture
```
GET /api/reports/[reportType]?dateFrom=&dateTo=&item=&...
    ↓
route.js GET handler
    ↓
1. Looks up REPORT_CONFIG[reportType] in components/Reports/config.js
2. Reads all filters from URL params defined in config.filters
3. Builds queryOptions (pagination, search, sort)
4. switch(reportType) → calls the correct async data function
5. Calls matching calculateXSummary() function
6. Returns: { data, summary, pagination, allData, config }
```

### Response Structure (All Reports)
```json
{
  "data": [...],           // Paginated slice (page × limit)
  "allData": [...],        // Full dataset (for client-side Excel/PDF export)
  "summary": {...},        // Totals and aggregates
  "pagination": {
    "currentPage": 1,
    "pageSize": 10,
    "total": 150,
    "totalPages": 15,
    "hasNextPage": true,
    "hasPrevPage": false,
    "startRecord": 1,
    "endRecord": 10
  },
  "config": {
    "title": "Purchase Report",
    "columns": [...],
    "exportOptions": [...]
  }
}
```

### Every Report — Logic Deep Dive

#### `purchase` / `sale` / `purchaseReturn` / `saleReturn`
**Function:** `getPSTransactionReport(config)`
- Fetches from `TRANSACTIONS_MASTER` filtered by `tran_code` (4=purchase, 6=sale, 9=purchase return, 10=sale return)
- Includes: vendor/customer account, godown, line items with item details
- Filters `sub_tran_id IN (1,2)` — excludes tax/control rows (sub_tran_id=3)
- Optional grouping by vendor or by product if `filters.type` is set
- `amountField`: purchase uses `damt` (debit), sale uses `camt` (credit)

#### `grn` (Goods Receipt Note)
**Function:** `getPurchaseReport("grn", filters)`
- Same as purchase but specifically for GRN documents
- Groups `sub_tran_id IN (1,2)` line items
- Can group by vendor or product

#### `dispatch`
**Function:** `getSaleReport("dispatch", filters)`
- tran_code=6 sale invoices that are dispatch documents
- Includes dispatch number, customer, items shipped

#### `purchaseOrder` / `saleOrder` / `serviceOrder`
**Function:** `getOrderTransactionReport(orderCategory, filters)`
- Reads from `OrderMaster` / `OrderDetail` tables — NOT from `TRANSACTIONS_MASTER`
- `orderCategory`: 4=purchase orders, 5=service orders, 6=sale orders

#### `stock`
**Function:** `getStockReport(filters)`
- Complex raw SQL query
- Calculates per-item: `actualStock`, `totalPurchased`, `totalSold`, `avgPurchaseRate`, `avgSaleRate`, `currentStockValue`, `potentialSaleValue`, `profitMargin`, `stockTurnover`
- Uses formula: tran_codes (4,10,12) = IN; (5,6,9) = OUT
- Supports filters: category, item, godown, date range

#### `stockMetrics`
**Function:** `getStockMetricsReport(filters)`
- Uses a `CROSS JOIN` with all godowns to show stock PER GODOWN for each item
- Returns `jsonb_object_agg(godown_id, stock)` — a JSON object like `{"1": 50, "2": 30}`
- Also fetches `Godown` list for dynamic column headers in the table
- `HAVING SUM(stock) > 0` optionally filters out zero-stock items when `showZero=false`

#### `stockActivity`
**Function:** `getStockActivityReport(filters)`
- Summary of all stock movements per item broken down by transaction type:
  `purchase_qty`, `sale_qty`, `pos_qty`, `sale_ret_qty`, `pos_ret_qty`, `purchase_ret_qty`, `transfer_in_qty`, `transfer_out_qty`, `issued_qty`, `production_qty`
- Calculates `stock_balance` = total IN - total OUT
- Supports: dateFrom/dateTo, godown, item, category filters

#### `stockLedger`
**Function:** `getStockLedgerReport(filters)`
- Chronological list of every movement for ONE specific item
- First row = opening balance (calculated by `getOpeningBalanceRaw()`)
- Each row shows: date, transaction type, vendor/customer, qty_in, qty_out, running `closing_qty`
- Supports `batchNo` filter to track a specific production batch through its lifecycle
- `getOpeningBalanceRaw()`: uses raw SQL to sum all transactions BEFORE `dateFrom`. When a godown is specified, it handles transfer IN/OUT separately per godown

#### `tradingMargin`
**Function:** `getTradingMarginReport(filters)`
- Per-item profitability analysis
- Calculates for each item: purchase qty/amount, sale qty/amount, POS qty/amount, returns on both sides
- Derived fields: `avg_purchase_rate`, `avg_sale_rate`, `margin` (sale - purchase), `margin_percent`
- Category filter applied after fetching (JavaScript-side filtering on `itemCategories.id`)

#### `posTransactions`
**Function:** `getPOSTransactionsReport(filters)`
- tran_code=5 (POS) transactions only
- Filters `sub_tran_id IN (1,2)` line items
- Adds derived fields: `customer_name`, `payment_mode` (Cash if `pycd="0001"`, else Card), `total_qty`, `total_amount`, `net_amount`

#### `accountLedger`
**Function:** `getAccountLedger(filters)`
- Most complex query in the system — uses a 4-CTE (Common Table Expression) raw SQL structure:
  1. `txn` CTE — all transactions for the account, with debit/credit amounts correctly mapped per `tran_code` + `sub_tran_id`
  2. `opening` CTE — sum of all transactions BEFORE `dateFrom` = opening balance
  3. `period_txn` CTE — transactions within date range, with a **window function** to calculate running balance: `SUM(...) OVER (PARTITION BY acno ORDER BY dated, vr_no, sub_tran_id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW)`
  4. Final SELECT — joins opening + period transactions, outputs running `balance` per row
- Then runs a SECOND query to get all counter-party accounts for each `tran_id` (for drill-down detail view)
- Returns: opening balance row first, then all dated transactions with running balance

#### `accountsActivity`
**Function:** `getAccountActivity(filters)`
- Summary for ALL accounts — shows: opening_balance, period debit, period credit, closing_balance
- Single raw SQL query with conditional SUM buckets (CASE WHEN dated < dateFrom ... ELSE 0)
- `HAVING` clause excludes accounts with zero activity in all four buckets
- Useful for seeing which accounts had any movement in a period (like a summarized trial balance with open/close)

#### `trialBalance`
**Function:** `getTrialBalance(filters)`
- Standard accounting trial balance — all accounts showing debit OR credit balance
- Uses `GREATEST(SUM(...), 0)` so each account appears in either debit OR credit column, never both
- Also shows raw signed `balance` (positive = net debit, negative = net credit)
- Groups by `macno` for collapsing by main account group
- Only `dateTo` filter — cumulative from the beginning of time

#### `purchaseOrderBalance` / `salesOrderBalance`
**Function:** `getOrderBalanceReport(filters)`
- Compares ordered qty vs received/shipped qty per PO/SO line item
- For purchase orders: joins `OrderMaster` → `OrderDetail` → `TRANSACTIONS_MASTER (po_no)` → `Transactions`
- For sale orders: joins via `so_no`
- Status logic per line item:
  - `COMPLETE` — net_received = ordered_qty
  - `OVER_RECEIVED` — net_received > ordered_qty
  - `PARTIAL` — 0 < net_received < ordered_qty
  - `PENDING` — net_received = 0
- `salesOrderBalance` additionally runs `groupOrderBalanceByOrder()` to nest line items under their parent order

#### `customerAging`
**Function:** `getCustomerAgingReport(filters)`
- 6-bucket aging report: Current (days_outstanding ≤ 0), 1–30, 31–60, 61–90, 91–120, 120+
- **Due date logic:** Sale invoices (tran_code=6) get `due_date = invoice_date + INTERVAL '30 days'`. Opening balance entries (tran_code=3) are due immediately
- **Adjustments:** `direct_receipts` = payments (tran_code=1) and sale returns (tran_code=13) matched by `invoice_no` AND `customer_code`
- `outstanding_amount = invoice_amount - direct_receipts`
- Only shows rows where `outstanding_amount > 0.01` (filters out fully paid invoices)
- `view="summary"` mode collapses to one row per customer via `calculateCustomerWiseSummary()`

#### `bom`
**Function:** `getBOMReport(filters)`
- Reads `BomMaster` + `BomDetail`, joins `Item` for both finished product and each material
- Groups by `bom_id` — each BOM has: finished product name, list of materials with percentages
- Summary: `fullyAllocatedBOMs` (total % = 100), `overAllocatedBOMs` (> 100), `underAllocatedBOMs` (< 100)

#### `qc` (Production QC)
**Function:** `getQCReport(filters)`
- Reads `QualityMaster` where `proc_ord_no IS NOT NULL AND order_no IS NULL` — production QC only
- Also reads ALL `quality_parameters` to build **dynamic columns** — every parameter becomes a column
- QC status is encoded as `attempt_no = itcd * 1000` in `QualityDetailDetail`
- Returns `parameterColumns` array for dynamic table rendering in the UI

#### `orderQc`
**Function:** `getOrderQCReport(filters)`
- Same structure as `qc` but for `order_no IS NOT NULL` (goods arrival inspection from purchase orders)

#### `processOrderReconciliation`
**Function:** `getProcessOrderReconciliationData(filters)` in `lib/reports/processOrderReconciliation.js`
- Matches material issuance (tran_code=7) with production output (tran_code=8) by process order number
- Process order number is extracted from `rmk` / `rmk5` fields using PostgreSQL regex: `REGEXP_REPLACE(..., '[^0-9]', '', 'g')` — strips all non-numeric chars
- Groups by process order number → shows every material's issuance qty vs production qty

#### `materialProduction` / `materialIssuance`
- tran_code=8 (production/material input) and tran_code=7 (material issuance) respectively
- Show raw material consumption in the manufacturing process

#### `payment` / `receipt` / `journal`
**Function:** `getTransactionReport(tran_code, filters)`
- Generic report for tran_code=2 (payment), 1 (receipt), 3 (journal)
- Supports `type` filter: `"cash"` (macno=65) or `"bank"` to filter by account type
- Supports `service_id` filter for service-related vouchers
- Calculates `netAmount` per transaction (different for tran_code=1 vs others)

#### `returnablePacking`
- Tracks returnable packaging materials issued with sales and returned by customers

#### `monthlyStock` / `monthlyStockValuation`
- Monthly snapshot of stock levels and values (pre-calculated by the scheduled job on the 1st of each month)

#### `batchCosting`
- Cost breakdown per production batch: material costs, labor costs, overhead

#### `qcParameters`
- Extended QC report where each quality parameter becomes its own column
- Uses `getColumns(filters, parameterColumns)` — the column list is dynamic and built from `quality_parameters` table at runtime

---

## 9. Manufacturing Module

### API: `api/manufacturing/`

#### BOM (Bill of Materials) — `api/manufacturing/bom/`

**`GET route.js`** — Fetches BOM list using raw SQL because:
- Needs Date → ISO string conversion
- Needs BigInt → Number conversion (Prisma raw returns BigInt for COUNT)
- Custom `convertForJson()` helper handles this recursively for all nested objects

BOM structure: `BomMaster` (finished product) → `BomDetail` (material items with `material_percentage`)
- Each finished product can have multiple materials
- `material_percentage` defines how much of each material goes into 100 units of finished product

Sub-routes:
- `bom/bulk/` — Create multiple BOMs at once (batch operation for importing)
- `bom/select/` — Returns BOMs in `{value, label}` format for React Select dropdowns
- `bom/validation/` — Validates that BOM percentages are valid before save
- `bom/[id]/` — Single BOM CRUD (GET, PUT, DELETE)

#### Recipe — `api/manufacturing/recipe/`
Recipes are linked to BOMs. A recipe defines production instructions (temperatures, mixing times, viscosity targets) for making a product. A BOM can have multiple recipes (different production conditions for same product).

#### Production Plan — `api/manufacturing/production-plan/`
Production plans schedule manufacturing runs:
- `finished_id` — which product to produce
- `qty` — planned production quantity
- `batch_no` — batch number assigned to this production run
- `barcode` — generated barcode string for factory scanning
- `status` — lifecycle: `"Scheduled"` → `"In Progress"` → `"Completed"` → `"Posted"`
- `bom_id` — which BOM formula to follow
- `receipe_id` — which recipe instructions to follow
- `actual_yield` — what was actually produced (vs planned qty)
- `changeLogs` — full audit trail of every status change with timestamp and user

**GET supports:**
- Search by item name, barcode, batch_no, numeric ID
- `onlyWithBatch=true` — for sticker printing page (only plans that have a batch number assigned)
- Status filter
- Full pagination and sorting

#### Production — `api/manufacturing/production/route.js`
Handles tran_code=8 transactions (material inputs / production entries). When a production plan is "posted", it creates:
1. A `TRANSACTIONS_MASTER` record (tran_code=8)
2. `Transactions` line items for the finished goods (stock IN)
3. `Transactions` line items for the raw materials consumed (stock OUT via tran_code=7)

Sub-routes:
- `send-to-production/` — changes plan status from Scheduled to In Progress, logs the change
- `[id]/` — get/update single production record

#### Machine Instruction — `api/manufacturing/machine-instruction/`
Machine-specific operating instructions. Linked to production plans to guide operators on settings.

### Components: `components/Material/`

#### `Production/ProductionPlanForm.jsx`
Main form for creating/editing production plans. On selecting a finished product, it auto-loads the linked BOM and recipe. Validates that sufficient raw material stock exists before allowing submission.

#### `Production/ProductionQcScanner.jsx`
Barcode scanner UI for marking a production batch as QC-passed. Scans the production barcode, fetches the plan, presents QC parameters for entry.

#### `Production/SendToProductionModal.jsx`
Confirmation modal before sending a plan to the production floor. Shows summary of what will be produced.

#### `Production/StatusBadge.jsx` / `TypeBadge.jsx`
Colored badge components for plan status (Scheduled/In Progress/Completed/Posted) and type.

#### `Bom/BOMForm.js`
Form to create/edit BOMs. Allows adding multiple material rows, each with a percentage. Validates that total percentage does not exceed 100%.

#### `Bom/GrandMasterBOM.js`
View that shows the complete BOM tree — a finished product and all its nested materials with quantities and percentages.

#### `Bom/MaterialUsageBOM.js`
Reverse BOM lookup — given a raw material, shows which finished products use it and in what percentage.

---

## 10. POS Module

Pages at `app/(pages)/pos/`. All POS sales use `tran_code=5`. POS returns use `tran_code=12`.

### `api/pos/products/`
Returns items available for POS sale. Filtered by POS category. Includes current stock level.

### `api/pos/categories/`
POS-specific product categories (separate from accounting ItemCategory). Used to organize the POS product browsing screen.

### `api/pos/orders/`
POS order history with date, customer, and payment mode filters.

### `api/pos/returns/`
Processes POS returns — creates a tran_code=12 transaction and adds stock back.

### `api/pos/stats/`
POS dashboard statistics: today's total sales, revenue, number of transactions, average basket value.

### `api/pos/sync/`
WooCommerce sync endpoint (currently commented out in `services/wooCommerceSync.js`).

### Components: `components/POS/`
- `Cart.js` — Shopping cart state: add items, update quantities, apply discounts
- `ProductList.js` — Browse products with category filter and search
- `ProductDetail.js` — Single product detail, stock availability, add to cart
- `CategoryManager.js` — Manage POS categories (CRUD)
- `Checkout.js` — Process payment: cash/card mode, apply discount, print receipt
- `OrderList.js` + `OrderDetail.js` — View past POS transactions and their line items
- `PosReturn.js` + `PosReturnList.js` — Return items from a past POS transaction
- `StockLedger.js` + `StockActivity.js` — Stock views accessible from within the POS module

---

## 11. Factory Scan System

### Purpose
When a barcode scanner (USB HID device) scans a printed label, the system must route the user to the correct inspection form based on:
1. Which factory module the user is currently in (purchase receiving, production, lab, store)
2. What data the barcode encodes (order number, production plan ID, item code)

### Files: `lib/factory-scan/`

#### `config.js` — Workflow Definitions
Defines 4 factory modules and their sequential workflows:

```
PURCHASE  → workflow: [purchase → qa]
PRODUCTION → workflow: [production → qa → store]
LAB       → workflow: [lab → production → store]
STORE     → workflow: [store]
```

`buildFactoryRoute(moduleName, parsedScan)` — Given current module + parsed scan data, returns the URL to navigate to:
- production + productionPlanId → `/accounting/forms/qualitycontrol/[id]`
- purchase + orderNo → `/accounting/forms/orderqualitycontrol/[orderNo]?itcd=...`
- lab + productionPlanId → `/accounting/material`
- store + orderNo → `/accounting/forms/orderqualitycontrol/[orderNo]`

`normalizeFactoryModule()` — handles aliases (`"quality"`, `"qualitycontrol"` all map to `"qa"`).

#### `parser.js` — Barcode String Parser
Decodes the barcode string format printed on labels into structured data:
- `productionPlanId` — production plan ID
- `orderNo` — purchase/sale order number
- `itcd` — item code
Handles different barcode formats for different label types (production vs order labels).

### Barcode Generation: `lib/`
- `productionBarcode.js` — Generates barcode data strings for production plan labels (batch number, item, qty)
- `qualityControlBarcode.js` — Generates QC inspection barcode labels
- `orderQualityBarcode.js` — Generates order-level QC barcode labels

---

## 12. Setup / Entity CRUD System

**One set of code handles 30+ different setup tables.**

### How It Works (End-to-End)

1. **Page:** `app/(pages)/accounting/setup/[entity]/page.js` — renders `DynamicEntity.jsx` with entity name
2. **Component:** `components/Setups/DynamicEntity.jsx` — reads config, renders table + modals
3. **API:** `api/setup/[entity]/route.js` — maps entity → Prisma model via `entityModelMap.js`, builds dynamic queries

### `lib/entityModelMap.js` — Entity Configuration Registry
Each entity entry:
```js
entity_name: {
  model: prisma.ModelName,        // Prisma model to query
  fields: (body) => ({...}),      // Maps request body → Prisma create/update fields
  searchableFields: ["name"],     // Append "?" for numeric search fields
  defaultSort: { name: "asc" },  // Default ORDER BY
  include: { relation: true },   // Prisma relations to include
  select: {...},                  // Optional field selection
  defaultWhere: {...},            // Pre-applied WHERE condition
}
```

### All Registered Entities (partial list)
```
currencies, item_categories, godowns, financial_years, seasons,
services, service_categories, companies, subtrates, ink_types,
sr_laminations, color_codes, business_units, nature_of_inks,
printing_properties, items, product_master_categories, product_groups,
product_categories, main_categories, purchase_product_categories,
...and more
```

---

## 13. Orders System

### How Orders Relate to Transactions
Orders (`OrderMaster` / `OrderDetail`) and transactions (`TRANSACTIONS_MASTER`) are separate tables linked by foreign keys:
- When a purchase order is received → GRN created → `TRANSACTIONS_MASTER.po_no = OrderMaster.order_no`
- When a sale order is dispatched → Invoice created → `TRANSACTIONS_MASTER.so_no = OrderMaster.order_no`

### Order Categories
`OrderMaster.order_catagory`: 4 = Purchase Order, 5 = Service Order, 6 = Sale Order

### `api/orders/[type]/route.js`
Handles order CRUD with rich filtering:
- `activeOnly=true` — filters out orders where ALL `OrderDetail` items have `status=2` (fully delivered). Used by dispatch form so completed orders don't clutter the dropdown
- `multiFilters` — JSON-encoded array of multi-value filters (e.g. filter by multiple invoice numbers at once)
- Date range filters, search by customer name or order number
- Pagination + sorting

### `lib/createOrderGrn.js` — Auto-GRN from QC Approval
When a QC inspection for a purchase order is approved, this function automatically creates the GRN:
1. Checks for existing GRN for same `po_no` + item (prevents duplicates)
2. Creates `TRANSACTIONS_MASTER` (tran_code=4, `po_no` linked)
3. Creates stock IN line (sub_tran_id=1, `damt = qty × rate`)
4. Creates creditor line (sub_tran_id=3, `camt = amount`)
5. Updates `OrderDetail.status = 2` (marks line as received)
All within a Prisma transaction (`tx`) for atomicity — if any step fails, nothing is saved.

### `api/orders/fulfillment-progress/`
Returns per-order completion: ordered qty vs net received qty, as a percentage.

---

## 14. Pages (Frontend Routes)

### `/accounting/[category]/[type]` — Dynamic Voucher Form
The primary data entry page. Handles ALL transaction types in one dynamic page.
- `category` = voucher category group (e.g. `purchases`, `sales`, `vouchers`)
- `type` = specific transaction type, maps to `tran_code` via `VOUCHER_CONFIG` in `components/Category/constants.js`
- Example: `/accounting/purchases/purchase-invoice` → tran_code=4
- Example: `/accounting/sales/sale-invoice` → tran_code=6
- Example: `/accounting/vouchers/receipt` → tran_code=1

### `/accounting/reports/[reportType]`
Renders `components/Reports/ReportViewer.jsx` which:
- Reads `REPORT_CONFIG[reportType]` for filter definitions and column configuration
- Renders filter inputs (date pickers, select dropdowns, search)
- Fetches data from `GET /api/reports/[reportType]` via TanStack Query
- Renders a paginated, sortable, searchable data table
- Export buttons use `allData` (full dataset) to generate Excel or PDF

### `/accounting/forms/qualitycontrol/` + `/[id]`
- List: all QC records for production batches
- Detail (`[id]`): QC inspection form with dynamic parameter inputs from `quality_parameters` table

### `/accounting/forms/orderqualitycontrol/` + `/[id]`
QC inspection form for goods arriving from purchase orders. Auto-creates GRN on approval.

### `/accounting/forms/qaEntry`
Store QA entry form for the store department.

### `/accounting/factory-scan`
Barcode scanner interface. Shows current factory module. Listens for scanner input and routes automatically.

### `/accounting/material`
Material management page — view raw material levels, initiate issuance.

### `/accounting/materialTransactions`
Full history of all material issuance (tran_code=7) and production (tran_code=8) transactions.

### `/accounting/stickerPrinting`
Print sticker labels for production plans. Queries with `onlyWithBatch=true` to show plans that have batch numbers.

### `/accounting/tagPrinting`
Print product/item barcode tag labels.

### `/accounting/graphs/[type]`
Individual graph views. `/graphs/manager` lets admins configure which graphs are visible to which user roles.

### `/accounting/outstanding`
Customer and vendor outstanding balance summary.

### `/accounting/add-account` + `/show-account`
Add new sub-accounts to the chart of accounts. View and search existing accounts.

### `/pos/`
POS main terminal — browse products by category, add to cart, checkout.

### `/admin/user`
Admin-only user management: create users, assign roles, activate/deactivate accounts.

### `/admin/shift`
Shift management for the factory/POS operations.

### `/employer/setup/[entity]`
HR entity setup (employees, departments, designations). Uses same `DynamicEntity` CRUD system as accounting setup.

---

## 15. Components — Deep Breakdown

### `components/Reports/config.js` — Report Configuration Registry
The central config for all reports. Each entry contains:
```js
reportName: {
  title: "Human readable title",
  description: "Short description",
  apiEndpoint: "/api/reports/reportName",
  filters: [
    { name: "dateFrom", label: "From Date", type: "date" },
    { name: "vendor", type: "select", apiEndpoint: "/api/accounts/acno?macno=53" },
    ...
  ],
  columns: [
    { field: "vendorName", headerName: "Vendor", width: 150, sortable: true, searchable: true },
    ...
  ],
  getColumns: (filters, extraCols) => [...],  // Optional: dynamic columns based on selected filters
  detailColumns: [...],     // Columns shown in drill-down detail row
  exportOptions: { excel: true, pdf: true }
}
```
`dynamicEndpoints` — switches filter API endpoints based on other filter values (e.g. when orderType=4, the account filter fetches vendors; when orderType=6, it fetches customers).

### `components/Reports/ReportViewer.jsx`
Universal report UI:
- Renders filter bar from `config.filters`
- Uses TanStack Query for data fetching with caching
- Paginated, sortable, searchable table
- Column-level search using `searchableColumns`
- Export: ExcelJS for Excel, jsPDF for PDF
- Row expansion for detail view using `config.detailColumns`

### `components/Setups/DynamicEntity.jsx`
Generic entity CRUD page — all setup pages use this single component:
- Search bar, paginated data table
- Add modal, Edit modal, Delete confirmation
- All behavior driven by config + `api/setup/[entity]`

### `components/Category/constants.js` — `VOUCHER_CONFIG`
Maps URL type strings to transaction codes:
```js
VOUCHER_CONFIG = {
  "purchase-invoice": { tran_code: { 4: 4 }, label: "Purchase Invoice" },
  "sale-invoice": { tran_code: { 6: 6 }, label: "Sale Invoice" },
  "receipt": { tran_code: { 1: 1 }, label: "Receipt" },
  "payment": { tran_code: { 2: 2 }, label: "Payment" },
  ...
}
```

### `components/Template/` — PDF Templates (18 files)
Each is a renderer that takes data props and outputs a formatted jsPDF document:

| File | Document Type |
|---|---|
| `Grn.jsx` | Goods Receipt Note |
| `PurchaseOrder.jsx` + `PurchaseOrderNew.jsx` | Purchase Order (two formats) |
| `LocalPo.jsx` | Local Purchase Order |
| `SalesOrder.jsx` | Sales Order |
| `SalesBalance.jsx` | Sales Balance statement |
| `Dispatch.jsx` | Dispatch / delivery note |
| `Payment.jsx` | Payment voucher |
| `CustomerAging.jsx` | Customer aging report PDF |
| `OrderBalance.jsx` | PO/SO balance PDF |
| `ProcessOrder.jsx` | Process order document |
| `ProductionPlanPDF.jsx` | Production plan document |
| `Bom.jsx` | Bill of Materials document |
| `SaleTax.jsx` | Sales tax challan |
| `TransferNote.jsx` | Inter-godown transfer note |
| `RequistNote.jsx` | Material requisition note |
| `UnifiedReport.jsx` | Generic report PDF (fallback) |

### `components/sidebar/`
- `app-sidebar.jsx` — Main collapsible sidebar with nested navigation
- `nav-main.jsx` — Primary navigation links (reads from dynamic menu builder)
- `nav-user.jsx` — User avatar, name, role, and logout in sidebar footer
- `site-header.jsx` — Top header bar with breadcrumb, notification bell, search

### `components/accounts/`
- `accountSpreadsheetView.js` — Spreadsheet-style grid for viewing/editing account entries
- `chartOfAccountsComponent.jsx` — Tree view of all accounts organized by main account groups (MACNO)

### `components/Graphs/`
- `sales/SalesAmountGraph.jsx` — Line/bar chart of sales amounts over time
- `sales/SalesCombinedGraph.jsx` — Combined sales metrics on one chart
- `sales/SalesQuantityGraph.jsx` — Sales quantity chart
- `sales/SalesRegionGraph.jsx` — Sales by region (pie/bar)
- `shared/DashboardGrid.jsx` — Responsive grid layout for dashboard widgets
- `shared/GraphFilters.jsx` — Date range + filter controls shared by all graph components
- `permissions.js` — Logic to check which graphs the current user can see

### `components/shared/`
- `DataTable.jsx` — Generic data table with sort, search, pagination
- `AddModal.jsx` + `EditModal.jsx` — Standard CRUD dialog modals
- `EntityPageLayout.jsx` — Standard page wrapper (title, breadcrumb, action buttons, table)
- `Modal.jsx` — Base modal component

### `components/Dynamic/`
- `DynamicFormComponent.js` — Renders a form from a JSON field schema. Used by the menu/form builder
- `DataManagement.js` — Generic data management UI for dynamic forms

---

## 16. Hooks

| Hook | Logic |
|---|---|
| `useBOM.js` | Fetches BOM data for a finished product. Returns BOM header + all material details |
| `useRecipe.js` | Fetches recipe linked to a BOM ID |
| `useGrandMasterBom.js` | Fetches the full multi-level BOM tree for a product |
| `useProduction.js` | Fetches production orders with pagination and status filtering |
| `useMachineInstruction.js` | Fetches machine instruction document for a given machine ID |
| `useMaterialUsageData.js` | Fetches how much of a raw material has been consumed in production across a date range |
| `useFactoryScan.js` | Sets up `use-scan-detection` listener. On scan: calls `lib/factory-scan/parser.js`, then `buildFactoryRoute()`, then `router.push()` to navigate automatically |
| `useFormCookies.js` | Persists selected form field values in browser cookies so they survive page reload. Used for frequently-reused date filters and account selections |
| `useDebounce.js` | Standard 300ms debounce — prevents API calls on every keystroke in search inputs |
| `use-mobile.jsx` | Returns `true` if viewport width < 768px. Used for responsive sidebar collapse behavior |

---

## 17. Context Providers

### `context/CompanyContext.js`
Provides company name, logo URL, and address to all components without prop drilling. Loaded once from `api/settings/company` on app init. Used in PDF headers and the sidebar logo.

### `context/CurrencyContext.js`
Active currency symbol and decimal formatting rules. All monetary displays (`Intl.NumberFormat`) use this context to show the correct currency symbol (PKR, USD, etc.).

### `context/SettingsContext.js`
General application settings loaded from `api/settings`:
- Active financial year date range
- Default godown for new transactions
- System preferences

### `app/providers.js`
Wraps the entire application with:
- `SessionProvider` (NextAuth — provides session to all components)
- `QueryClientProvider` (TanStack Query — provides the query cache)
- `CompanyContext`, `CurrencyContext`, `SettingsContext` providers

### `app/queryProvides.js`
TanStack Query client configuration: stale time (how long cached data is considered fresh), retry count on failure, etc.

---

## 18. PDF Template System

### Generation Flow
```
User clicks Print / Export PDF button
    ↓
Component calls api/invoice/generate-pdf OR runs jsPDF directly in browser
    ↓
Template component (components/Template/*.jsx) is called with data as props
    ↓
jsPDF draws the document layout:
  - Company letterhead from CompanyContext
  - Table headers and column widths
  - Line items with amounts
  - Totals row
  - Signature / stamp blocks
    ↓
PDF blob → browser print dialog OR file download
```

### `lib/reports/processOrderReconciliation.js`
This file contains a **complete standalone jsPDF PDF renderer** for the process order reconciliation report. It's kept separate from the generic template system because this report requires very specific multi-page pagination and grouped layout that the generic `UnifiedReport.jsx` cannot handle.

---

## 19. Validators

### `validators/voucher-schemas.js`
Zod schema for the voucher/transaction creation form:
- `company_id` — required string
- `date_d` — must match regex `YYYY-MM-DD`
- `time` — must match regex `HH:MM`
- `tran_code` — required integer ≥ 1
- `vr_no` — required integer ≥ 1
- `pycd` — main party account, required
- `user_id` — required
- `rmk` through `rmk5` — optional, max 150 characters each

### `validators/voucherValidator.js`
Business-rule validation layer on top of Zod schemas:
- Validates that the transaction is within the active financial year
- Validates that item quantities are positive for stock transactions

### `validators/transactionValidator.js`
Double-entry accounting validation:
- Total `damt` must equal total `camt` across all line items
- Prevents unbalanced vouchers from being saved

### `validators/company.validator.js`
Zod schema for company settings (name required, email format validated, phone format validated).

### `validators/costCenter.validator.js`
Validation for cost center entries (name required, company association required).

---

## 20. Scheduled Jobs & Utils

### `instrumentation.js`
Root-level Next.js instrumentation hook (`register()`, runs once at server startup). Hosts all `node-cron` schedules for the app, since production runs as a single long-lived Docker container rather than serverless functions:
- Invoice knock-off / reconciliation matching (`lib/ledger/invoiceMatcher.js`) — twice daily, `01:30` and `20:00` Asia/Karachi.
- Monthly opening stock snapshot — `'0 2 1 * *'` (1st of every month, 2:00 AM) Asia/Karachi. Calls `calculateAndStoreMonthlyOpening(month, year, null)` for ALL godowns, pre-calculating stock snapshots so monthly reports don't need to recalculate from scratch every time. (Previously lived in `scheduled-jobs/monthlyStock.js`, which was never actually imported/run — that file has been removed.)

### `utils/monthlyOpeningStock.js`
The core logic:
- Calculates stock for each item as of the LAST DAY of the previous month
- Stores the result in the monthly opening stock table
- Future stock reports for that month read from this pre-calculated snapshot instead of re-aggregating all transactions

### `utils/generateNCRCertificate.js`
Generates a Non-Conformance Report (NCR) certificate PDF when a QC inspection fails:
- Item details, batch number
- Description of non-conformance
- Inspector name and date
- Corrective action block

### `utils/generateQCCertificate.js`
Generates a Quality Control Certificate PDF for batches that pass QC:
- Item details and specifications tested
- Parameter values measured vs acceptable limits
- Pass/fail status per parameter
- Inspector signature block
- Used as proof-of-quality for customers receiving dispatched goods

---

## 21. Services (WooCommerce)

### `services/wooCommerceSync.js`
Currently fully commented out. When enabled, this module would:
- **Product sync:** Create/update/delete products in WooCommerce when items change in the accounting system
- **Category sync:** Mirror ItemCategory hierarchy to WooCommerce product categories
- **Stock sync:** Update WooCommerce stock quantities from inventory
- **`sync_status` field** on `Item` records: `'synced'`, `'failed'`, `'deleted'`
- **`wc_product_id`** stored on Item records to link back to WooCommerce for future updates

The `api/pos/sync/` API endpoint would trigger this when called.

---

## 22. Key Patterns & Conventions

### Pattern 1: tran_code Is Everything
Every financial and inventory action = one `tran_code` integer. This is the primary filter in all queries. Always filter by `tran_code` — never query `TRANSACTIONS_MASTER` without it.

### Pattern 2: sub_tran_id=3 Is Always Excluded
In stock reports, balance calculations, and summaries, always apply `WHERE sub_tran_id != 3`. These are tax and control rows that would double-count amounts if included.

### Pattern 3: pycd = Main Party
`TRANSACTIONS_MASTER.pycd` = the primary account code for a transaction (vendor for purchases, customer for sales, bank for receipts/payments). This is how you group transactions by party across reports.

### Pattern 4: Date Range Normalization
`dateFrom` always gets `setHours(0,0,0,0)` and `dateTo` always gets `setHours(23,59,59,999)` before Prisma queries. This ensures boundary dates are fully inclusive regardless of time zone.

### Pattern 5: Prisma Raw SQL for Complex Aggregations
Window functions, CTEs, JSONB aggregation, and REGEXP_REPLACE require `prisma.$queryRaw` with parameterized `Prisma.sql` template literals. This prevents SQL injection while allowing full PostgreSQL power.

### Pattern 6: The Report Pattern
Every report follows strictly: `getData()` → `calculateSummary(data)` → return `{data, summary}`. Data fetching and summary calculation are always separate functions.

### Pattern 7: BigInt Conversion
PostgreSQL `COUNT()` and numeric aggregates in raw queries return `BigInt` in Node.js. Always convert: `Number(value)` or use `convertForJson()` recursively before sending JSON responses.

### Pattern 8: Opening Balance = Sum Before dateFrom
Every ledger has an opening balance row. Always calculated as the sum of ALL transactions with `dated < dateFrom` (strictly less than, not less-than-or-equal).

### Pattern 9: Dynamic Route → Single Handler
`[reportType]`, `[entity]`, `[type]`, `[category]` — dynamic URL segments map to configuration registry objects. One handler file → 30+ use cases with zero duplication.

### Pattern 10: Notification Side Effects Are Automatic
Never add manual `sendNotification()` calls after saving data. The Prisma client extension in `lib/prisma.js` fires notifications automatically for every registered model. Just call `prisma.model.create()` or `prisma.model.update()` normally.

### Pattern 11: Transfer Godown Logic
Inter-godown transfers (tran_code=11) use TWO godown fields: `godown` = source (stock OUT), `godown2` = destination (stock IN). When calculating stock for a specific godown, always check BOTH fields. When calculating total stock across ALL godowns, transfers cancel out and should contribute zero.

---

## MACNO Reference (Main Account Groups)

| macno | Group Name | Used For |
|---|---|---|
| 35 | Customers (Debtors) | Customer aging, sale invoice `pycd`, customer ledger |
| 53 | Vendors (Creditors) | Purchase order party, purchase invoice `pycd`, vendor ledger |
| 65 | Cash / Banks | Receipt and payment accounts, cash/bank filter in voucher reports |

---

## File Count Summary

| Area | Count |
|---|---|
| API Route files | ~65+ |
| Page files | ~35+ |
| Component files | ~85+ |
| Lib files | 15 |
| Hooks | 10 |
| Context files | 3 |
| Validator files | 5 |
| PDF Template files | 18 |
| Config files | 6 |
| Utils / Scheduled Jobs | 4 |
| **Total** | **~246+ files** |
