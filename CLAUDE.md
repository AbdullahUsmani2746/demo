# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

**Bizlogist ERP** (built on the SMS system, merging Eastland and Accounting) — A full-stack Next.js enterprise ERP for financial accounting, inventory management, manufacturing, and point-of-sale operations. Multi-user with role-based access control and real-time notifications.

**Stack:** Next.js 15 (App Router) · React 19 · PostgreSQL · Prisma 6 · NextAuth v4 · TailwindCSS · shadcn/ui

---

## Essential Commands

```bash
npm run dev           # Start dev server with Turbopack
npm run build         # Build for production (includes Prisma codegen)
npm start             # Start production server
npm run lint          # Run ESLint

npm run prisma:sync   # Push schema changes to DB and regenerate Prisma client
npx prisma studio     # Interactive database GUI

npm run test:process-order-reconciliation-pdf
npm run test:process-order-drilldown
```

---

## Architecture

```
app/(pages)/      → UI pages by feature module
app/api/          → Serverless API route handlers
components/       → Reusable UI + PDF templates
lib/              → Prisma client, auth, reports, notifications
context/          → Global providers (company, currency, settings)
hooks/            → Custom React hooks
prisma/           → Schema (100+ models) + seed
validators/       → Zod schemas
instrumentation.js → loads instrumentation-node.js (Node runtime only): node-cron jobs (invoice knock-off, sales-team MIS snapshot, follow-ups, HR machines)
```

`middleware.js` enforces role-based access before every request.

---

## Core Architectural Patterns

### 1. Transaction System (Central Concept)

All financial and inventory activity flows through two tables:
- `TRANSACTIONS_MASTER` — one header row per transaction
- `Transactions` — multiple line items per transaction

Every transaction has a `tran_code` (integer) that defines its type:

| tran_code | Type |
|---|---|
| 1 | Receipt (cash/bank IN) |
| 2 | Payment (cash/bank OUT) |
| 3 | Journal Voucher (adjustments, payroll JV, reversals) |
| 4 | Purchase Invoice (stock IN) |
| 5 | POS (stock OUT) |
| 6 | Sale Invoice (stock OUT) |
| 7 | Material Issue (raw materials OUT) |
| 8 | Production (finished goods IN) |
| 9 | Purchase Return (stock OUT) |
| 10 | Sale Return (stock IN) |
| 11 | Stock Transfer |
| 12 | Miscellaneous IN |

**Rule:** Always filter queries by `tran_code`. Never query `TRANSACTIONS_MASTER` without specifying which type(s) you need.

#### Sub-transaction lines (`sub_tran_id`)
- `sub_tran_id=1` — Main line (stock row or primary Dr/Cr)
- `sub_tran_id=2` — Secondary/charges line
- `sub_tran_id=3` — Control/tax row — **always exclude from stock calculations and balance reports** (these double-count)

### 2. Universal Setup CRUD

All setup entities (currencies, items, godowns, categories, etc.) share one API route:
```
GET/POST/PUT/DELETE /api/setup/[entity]
  → lib/entityModelMap.js  →  Prisma model
```
To add a new setup entity: add a Prisma model → add to `lib/entityModelMap.js` → it's done. The `DynamicEntity.jsx` component handles the frontend automatically.

### 3. Report Engine

All 25+ reports use the same pattern:
```
GET /api/reports/[reportType]?filters...
  → lib/reports/[reportType].js  → { data, summary }
  → ReportViewer.jsx (universal component)
```
Report filters, columns, and display config live in `components/Reports/config.js`. To add a new report: create `lib/reports/[type].js` + add config entry — the API route and UI auto-wire.

### 4. Authentication & Authorization

- **Provider:** Credentials (email + bcrypt password) via NextAuth v4
- **Sessions:** JWT
- **Roles are data** (`app_roles`, Admin → Roles `/admin/roles`): a person has a main role (`User.role`) and may hold more (`user_roles`); the session carries `roles`, `superAdmin`, `navMode`, `areas` (`lib/auth/sessionGuard.js`, refreshed every minute). Helpers: `lib/auth/roles.js` (pure — `rolesOf`, `isSuperAdmin`, `usersWithRoles`), `lib/auth/roleCatalog.js` (server), assigning roles only through `lib/auth/roleAssign.js` (only a Super Admin gives / takes Super Admin; the last one keeps it). Labels in the UI: `hooks/useRoles.js` / `lib/auth/roleNames.js`.
- **Only Super Admin (code `ADMIN`) skips the checks.** Everyone else: user deny > user allow > any role deny > any role allow > their **Employee menus** (`lib/auth/menuPermissions.js`: a screen given to a person lets them view / add / edit / print there; delete, approve, unlock, post, pay stay with roles) > deny. Role templates: `prisma/sql/2026-11-16_roles.sql`.
- **Sidebar** = the roles' "Sidebar" setting: `all` (whole menus table — Super Admin, management) or `assigned` (their Employee menus); `/admin/*` shows `navAdmin`.

| Path prefix | Who may open it (`middleware.js`) |
|---|---|
| `/admin/*` | Super Admin, or anyone holding users / permissions / menus / settings / notification `.manage` (`AREA_PERMISSIONS`) |
| `/accounting/*` | Any signed-in user; each page is checked against their menus, each action against permissions |
| `/pos/*` | Super Admin or `pos.manage` |
| `/dashboard/*` | Any authenticated user |

### 5. Automatic Notifications

The Prisma client in `lib/prisma.js` has a custom extension — when any registered model is created/updated, `dispatchNotification()` fires automatically. Never manually call a notification sender; just call `prisma.create()` / `prisma.update()` normally. Events are registered in `lib/notifications/config.js`.

---

## Critical Calculation Rules

### Stock Formula
```
Stock = SUM(qty WHERE tran_code IN (4, 8, 9, 10, 12))   // IN
      - SUM(qty WHERE tran_code IN (5, 6, 7))            // OUT
      + SUM(qty WHERE tran_code=11 AND godown2=X)        // Transfer IN
      - SUM(qty WHERE tran_code=11 AND godown=X)         // Transfer OUT
```
Transfers (tran_code=11) cancel out when summing across ALL godowns.

### Account Balance
- **Receipt (tran_code=1):** `sub_tran_id=1` rows → credit party; `sub_tran_id=2,3` → debit charges
- **Payment (tran_code=2):** `sub_tran_id=1` rows → debit party; `sub_tran_id=2,3` → credit charges
- **All others:** `damt` = debit, `camt` = credit (always)

Opening balance = SUM of all transactions **strictly before** `dateFrom`.

### Main Account Groups (MACNO)
- `macno=35` — Customers (Debtors)
- `macno=53` — Vendors (Creditors)
- `macno=65` — Cash/Banks

### Date Range Normalization (always apply before Prisma queries)
```javascript
dateFrom.setHours(0, 0, 0, 0)
dateTo.setHours(23, 59, 59, 999)
```

### Monthly Opening Stock
Two tables: `MonthlyOpeningStock` = qty per **(item, godown)**, godown NOT NULL; `MonthlyOpeningRate` = rate per **item**. "All godowns" is always `SUM(opening_qty)` — there is no aggregate row. Never query these models directly; use `lib/openingStock.js` (`getOpening`, `getOpeningOne`, `getOpeningRates`, `getOpeningQty`, `getOpeningByGodown`, `openingSql` for raw-SQL CTEs). Written only by `lib/openingStockGenerate.js` (period lock / Calculate button) or `scripts/import-opening-stock.mjs`.

### BigInt Conversion
PostgreSQL `COUNT()` in raw queries returns `BigInt`. Always convert before JSON response:
```javascript
count: Number(result.count)
```

---

## Key Files

| Need | Location |
|---|---|
| Transaction type constants | `components/Category/constants.js` (`VOUCHER_CONFIG`) |
| Setup entity ↔ Prisma model map | `lib/entityModelMap.js` |
| Report data functions | `lib/reports/[type].js` |
| Report display config | `components/Reports/config.js` |
| Report Display settings (per user) | "Display" on every report (`components/Reports/DisplayMenu.jsx`, design: artifact "Report Table Redesign") — text size, bold numbers (amounts / rates / quantities / totals), lakh 12,34,567 or international grouping, full / thousand / lakh / crore, negatives in brackets, decimals, date format, striped rows. "Highlight" next to it (`components/Reports/HighlightMenu.jsx`): each user's own no-code colour rules per report — When <column> <is less than / at least / equal / contains / is empty / negative …> <value> → colour the row or just that cell (red / amber / green / blue / purple) — plus amount ≥ X and negative-amount rules on every report; never hard-code a colour rule for one user. A report's own warnings stay in its config and always show: `highlightRow` (red row), `blinkCells` (red pulse), `blinkCellsPurple` (yellow row, e.g. below re-order level), `rowTextClass` (text colour). Saved on the account in Settings `reportDisplay:<userId>` (`lib/reports/displayPrefs.js`, `/api/reports/display`, `hooks/useReportDisplay.js`); every formatter reads it (`setReportDisplay` / `formatValue` / `formatAmount` in `components/Reports/layout.js`) — table, cards, row panel, KPI strip, Excel / PDF. Never format report numbers another way. The wide table also has: no filler column (widest text column flexes), action column sized to its icons and pinned right, tick rows → sum bar + Copy, search highlight, click-a-value filter chips, header ▾ (sort / hide / pin), amount in words on hover, arrow keys, and "Compare with previous period" (ReportViewer fetches the prior period; rows matched by the pinned identity columns) |
| Universal report UI | `components/Reports/ReportViewer.jsx` |
| Notification config | `lib/notifications/config.js` |
| Notification handlers | `lib/notifications/handlers/` |
| Barcode scanner logic | `lib/factory-scan/parser.js`, `config.js` |
| PDF templates (18 pre-built) | `components/Template/` |
| Prisma client (with extensions) | `lib/prisma.js` |
| Auth config | `lib/auth.js` |
| Period lock (month, date range, per-user exceptions) | `lib/periodLock.js` — every route that writes a dated document calls `checkPeriodLock(dates, tran_code, { action: "create"|"update"|"delete" })`; on edit pass `[storedDate, newDate]`. Lockable types: `lib/periodLockCatalog.js` (add new tran_codes there). Locks are managed by holders of `period.lock` (Accounts Manager role). Managed on `/accounting/period-lock` |
| Closed godowns | `Godown.is_active=false` — `/api/setup/godowns` hides them unless `?includeInactive=true` (reports + Setup pass it); write routes call `closedGodownError(ids, { allow: storedIds })` from `lib/godowns.js` |
| Services on GRN / Dispatch | `lib/service/documentServices.js` — the form's Services panel (`components/Category/DocumentServicesPanel.jsx`, config `documentServices`, Alt+V) is sent as `body.services` and booked by the voucher route as Service Invoices (tran_code 21), one per vendor + vendor invoice no, linked via `service_invoice_links`, in the document's save transaction. Only invoices linked to that document alone and unpaid are editable there. A GRN / dispatch with service invoices cannot be deleted |
| Dispatch produce-on-dispatch (BOM) | `lib/dispatch/bomProduction.js` — each dispatch line's materials (`line.materials = [{ itcd, qty, godown }]`) are issued from the row's own godown or, when blank, the header's "Issue Materials From" (`master.godown2`, never stored on the dispatch); one auto Material Issue (tran_code 7, `rmk1="AUTO_DISPATCH_BOM"`) **per issue godown** + one Production (8, `AUTO_DISPATCH_PROD`) into the dispatch godown, `rmk4` = dispatch tran_id. Manual paper numbers: `TransactionsMaster.manual_no` (Dispatch "Manual DC No", GRN "Manual GRN No"; the vendor's DC stays in GRN `rmk3`) |
| Sale Order / Dispatch feature switches | Server checks in one place each: `lib/orders/saleOrderChecks.js` (duplicate items, price list only + ticked Sales Items, FOC / Trial history, credit limit / overdue → warn or approval reason "Credit limit exceeded" / "Overdue invoices", LTR off) run by the orders route before the approval gate and on save; `lib/dispatch/dispatchChecks.js` (without Sale Order, over-dispatch band — also `checkOrderStatus`, batch required, Manual DC No / City / Route, packing consumption, LTR off) run by the voucher route. Forms: `feature` / `featureKeep` / `requiredBy` on voucher fields (`lib/features/apply.js`); config callbacks read `lib/features/client.js`. An edit never refuses what the stored document already had |
| Trial line billing (`orders.trialLineBilling`) | SO line `line_type` NORMAL / TRIAL / RATE_NEG (`lib/orders/lineTypes.js`); dispatch lines stamped server-side (`stampDispatchLineTypes`), priced 0 on Sale Invoicing (stamp is data — kept when the feature is off); the client's approval = SO line edited to Normal with its rate; Sale Invoicing → Approved trial items (`/api/invoicing/sale/trial-items`) MOVES the lines into dispatch part `N-2` (same date, no return, stock unchanged; `dispatch_part`, trigger `prisma/sql/2026-11-19_sales_dispatch_features.sql`). A part and a dispatch with parts are never edited / deleted by hand (`trialDispatchLockError`) — correct with a Sale Return |
| Dispatch packing consumption | `lib/dispatch/packingConsumption.js` — dispatch create/edit/delete keeps one auto tran_code 7 (`rmk1="AUTO_PACKING"`, `rmk4`=dispatch tran_id, `rmk5`=dispatch_no) with qty = Σ `no_of_pack` per `packing_material_code`. Short packing stock follows the stock check policy type `packing` (default warn). Stock per godown: `lib/stock/godownStock.js` |
| Stock check policy | `lib/stock/policy.js` (+ pure `lib/stock/policyConfig.js`: types, defaults) + `lib/stock/checkStock.js`; every stock-out save calls `checkStockForSave` (dispatch FG / BOM via `lib/dispatch/bomProduction.js`, packing, process order via `assertIssueStock`). Modes off / warn / block per document type, Settings → Stock checking (`settings.manage`, Settings key `stockCheckPolicy`); no row = the old behaviour. Forms: `hooks/useStockPolicy.js`, `lib/stock/policyClient.js`, field `stockCheckType` in `components/Category/constants.js` |
| HR access, scope, settings | `lib/hr/access.js` (`HR_PERMS`, `employeeScopeWhere`) · reporting line `lib/hr/team.js` · HR approvals `lib/hr/approvals.js` |
| Off-day swaps & comp-off | Planned: `lib/hr/attendance/swaps.js` (`hr_off_swaps`, Attendance → Off-day swaps, approval type `hrOffSwap`) — an approved swap makes its `work_date` a working day and its `off_date` a week-off; `dayTypeOf` in `lib/hr/attendance/sheet.js` reads it, nothing is written to `hr_attendance`. Unplanned: a week-off / holiday worked earns `comp_off_earned` (1, ½ for half a day) when the shift's `off_day_work` = `COMP_OFF` (default; `OVERTIME` = the old overtime), spent as leave of a `comp_off` leave type within `comp_off_valid_days` (30), oldest first — `lib/hr/leave/compOff.js`, checked in `assertLeaveFits`. Earned days are never stored |
| HR vouchers (pay-out, repayment, salary payment, reversal) | `lib/hr/vouchers.js` · payroll JV `lib/hr/payroll/post.js` · salary payments `lib/hr/payroll/pay.js` |
| HR payroll additions (features `hr.bankDisbursement`, `hr.payHistory`, `hr.taxCertificate`, `hr.providentFund`, `hr.gratuity`, `hr.leavingProcess` — default off; `prisma/sql/2026-11-21_hr_payroll_additions.sql`) | Bank files: layouts as data in Settings `hr.bank_file_formats` (`lib/hr/payroll/bankFile.js`, `lib/hr/settingsData.js`, `/api/hr/payroll/[id]/bank-files`) · pay history `/accounting/hr/pay-history` · tax certificates `lib/hr/taxCertificate.js` (tax year start = rule `hr.tax.year_start_month`) · PF / gratuity arithmetic `lib/hr/benefits.js`, figures stored on `hr_payslips.pf_employee / pf_employer / gratuity`, posted in the payroll JV · leaving `lib/hr/leaving/separation.js` (approval `hrSeparation`, clearance items Settings `hr.leaving.clearance_items`) · final settlement `lib/hr/leaving/settlement.js` (approval `hrSettlement`, system vouchers `HR_SETTLEMENT` / `HR_SETTLEMENT_PAY` via `postJournal` / `postCashVoucher`; payroll leaves out months a settlement pays — `settledIn` in `lib/hr/payroll/run.js`) · reports `hrPayHistory`, `hrPfLedger`, `hrGratuityProvision` (`lib/hr/reports/benefits.js`) · PF loans / withdrawals (feature `hr.pfLoans`, needs `hr.providentFund`): `HrLoan.kind` `PF_LOAN` / `PF_WDL` through the loan flow (`LOAN_KINDS` in `lib/hr/loans/schedule.js` = account / approval / refundable per kind), limit and fund `lib/hr/loans/pf.js` (Settings `hr.pf.loan_limit_percent` 80, `hr.pf.loan_max_installments` 24), approval type `hrPfLoan` (`hr.pfloan.approve`, `prisma/sql/2026-11-21_hr_pf_loans.sql`), pay-out Dr PF Payable / Cr cash-bank |
| System-voucher registry (read-only vouchers) | `lib/vouchers/systemVouchers.js` + trigger in `prisma/sql/2026-11-04_hr_accounting.sql` |
| Approval chains on any form | Every approval rule (Admin → Permissions → Approvals → Approval rules → "Approve in steps") may have `steps` + `watchers` (`ApprovalRule`, `prisma/sql/2026-11-20_rule_chains.sql`); engine `lib/approvals/docChains.js` — a held entry goes step by step (people / roles / requester's reporting manager, "chooses who takes the next step"), only the LAST step posts it (`runApprovedRequest`); the rule's `approver_users/roles` = the last step. Steps are copied into `ApprovalRequest.chain` when held, so editing a rule changes new entries only. A new form gets rules **and** chains by being added to `VOUCHER_SAVE_TYPES` / `ORDER_SAVE_TYPES` in `lib/approvals/rules.js`; HR requests use `lib/hr/chains.js` (`CHAIN_DOC_TYPES`, `hr_approval_chains`). Same step shape, same Approvals page |
| Request deletion (no delete right) | Feature `approvals.deletionRequests` (default off). `lib/approvals/deletions.js` — the list's Delete button becomes "Request deletion" (reason) for anyone without `<type>.delete`; `POST /api/approvals/delete-requests` keeps an `ApprovalRequest` (action `delete`, rule-less, snapshot + reason in `payload`). Holders of `deletion.approve` (built-in approval `deletion`, Super Admin always) decide it on `/dashboard/approvals`; approving runs the form's own DELETE route with header `x-approval-delete` (re-checked by `deletionCallAllowed`), so period lock / invoiced / system-voucher checks still apply (`prisma/sql/2026-11-20_deletion_requests.sql`) |
| Printed PO / Sale Order, loan / advance letters | `generatePurchaseOrderPDF` / `generateSalesOrderPDF` print the standard layout, or the company letterhead (`components/Template/OrderLetterhead.js` — the company's own logo / address / NTN, `<COMPANY>/PO/<no>/<year>`) when feature `documents.orderLetterhead` is on. "Approved form (PDF)" on Approvals: `components/HR/approvedFormPdf.js` — standard layout, or the Loan / Advance Salary Application letters filled from the approval chain when `hr.applicationLetters` is on |
| Fixed assets (register, depreciation, relocation 16, disposal 15) | `lib/fixedAssets/*` (pure rules `calc.js`; company rules Settings → Fixed assets = Settings key `fixedAssetSettings`, `settingsDefs.js`; per-category defaults + accounts `fa_category_defaults`, fallback Account Settings section FIXED_ASSETS). Asset rows `fixed_assets` written only by `register.js` (GRN 14 save / backfill), runs only by `depreciation.js`, disposals / relocations only by `disposal.js` via `lib/fixedAssets/voucher.js` from the voucher route. System journals FA_CAPITALISATION / FA_DEPRECIATION(_REVERSAL) / FA_DISPOSAL(_REVERSAL) (`prisma/sql/2026-11-20_fixed_assets.sql`). Features `fixedAssets.*` (all off by default). Reports `lib/reports/fixedAssets.js` |
| Notification texts / recipients | `lib/notifications/catalog.js`, `lib/notifications/template.js`, Admin → Notifications |
| Installed app + phone notifications (PWA / Web Push) | Manifest `app/manifest.js`, service worker `public/sw.js` (registered by `components/pwa/PwaRegister.jsx`; no offline cache), icons `public/pwa/`. Every row `emit.js` / `alerts.js` writes is also pushed to the recipient's devices by `lib/notifications/push.js` (`createManyAndReturn` → `pushNotifications`, fire-and-forget; link = the bell's `attachNotificationLinks`; catalog `urgent: true` stays on screen). Devices: table `push_subscriptions` (`PushSubscription`, not audited), `/api/push` (+ `/test`); browser side `lib/pwa/client.js`, `hooks/usePushNotifications.js`, on/off card `components/Notifications/PhoneNotifications.jsx` (Notifications page + bell). Sign-out buttons use `signOutAndForgetDevice` (`lib/pwa/signOut.js`). Needs https; iPhone only from the Home Screen app (iOS 16.4+) |
| Follow-ups (Trial / FOC chasing etc.) | Any BI table question can be a scenario (`config.followup`, BI Designer → Follow-up): its highlighted rows become `BiFollowup` items (`lib/bi/followups.js`: sync every 30 min, 09:00 digest + escalation, `blockFoc` blocks new FOC/Trial SOs). Due date from data (`dueField` + `dueDays`, e.g. First Dispatch + 7). **Who oversees = approvers of approval rules** (`approverRules`): they see every item, get `followupLogged` on each remark (`notifyOnLog`) and escalations (step `approvers: true`) — never a user id in code. Logged on `/dashboard/followups`, from the dashboard row, or the bell's Follow-up tab (each person's own due items); one list for all three: `lib/bi/followupList.js`; visibility `lib/bi/followupAccess.js` |
| BI dashboards (My Dashboards, design: artifact "CEO Dashboard Redesign") | Periods are one string — `today · yday · w7 · mtd · pm · ytd · m3 · m6 · m12 · all · custom:YYYY-MM-DD:YYYY-MM-DD` — read only through `lib/bi/periods.js` (`parsePeriod` → range, previous period of the same length, same dates last year; `prorateMonthly` for monthly targets). KPI results carry `sel / prev / ly / spark` (+ today / w7 / mtd / pm); date trends carry `compare.ly` (`lib/bi/engine.js`). A section's `kind` (BI Designer → Layout → Shown as): `hero` (HeroCard), `compact` (MiniCard), `attention` (AlertTile, most urgent first by colour rule, Seen per browser) — `components/bi/DashboardCanvas.jsx`, `Cards.jsx`. Card options: `monthlyTarget`, `target` + `targetLabel`, `goodWhen: "down"`, `opens: "approvals"`, `topN`. Extra visuals `bullet` / `multiples` / `share` (`MoreVisuals.jsx`). Summary line by rules (`lib/bi/summary.js`), Why did it change (`breakdownChange`, `/api/bi/my/[id]/why`), per-person Customize + saved views (Settings `biPrefs:<user>:<dash>`, `/api/bi/my/[id]/prefs`), event flags (`bi_events`, BI Designer → Events), Present mode, PDF = print CSS (`bi-redesign.css`), 08:00 summary (`lib/bi/morning.js`, catalog `biMorningSummary` — recipients on Admin → Notifications, figures under each recipient's own access) |
| Stock held by vouchers pending approval | `lib/stock/pendingApprovals.js` — a voucher held on `/dashboard/approvals` is not posted, but its qty is spoken for: every stock CHECK returns available = posted − pending OUT (`/api/voucher/check-stock`, `/api/inventory/stock`, `getGodownStock` — so `checkStockForSave` too); an edit request counts only what it adds over the posted voucher; the requester's own re-opened request (`?approvalRequest=`) is not held against itself. Stock / Stock Activity / Stock Ledger show pending In / Out and Available explicitly (ledger: `R-… — PENDING APPROVAL` rows). New stock checks use these helpers |
| KG ⇄ LTR (stock always KG) | `lib/units/litres.js` — Sale Order / Dispatch lines may be in LTR (`qty_ltr`, KG derived via `Item.ltr_rate` = density). Sale / Purchase Invoicing can switch a line's billing unit to LTR with a per-line Density (`withBillingUnit` in `lib/invoicing/core.js`): LTR = KG ÷ density, amount = LTR × rate; only `unit` / `qty_ltr` are written, `qty` (KG, stock) never changes; a dispatch line whose SO line is LTR stays LTR |
| Production setup (which item categories are finished / semi / raw / packing; production, FG and FG-transfer godowns) | `lib/production/setupConfig.js` (client-safe readers) · `lib/production/setup.js` (server, cached) · `hooks/useProductionSetup.js` · Settings → Production setup (`productionSetup`). Never hard-code a category or godown id |
| Settings → Features (company-switchable flows) | `lib/features/catalog.js` · `lib/features/server.js` · `hooks/useFeatures.js` · `lib/features/apply.js` — rule 16 |
| Sale Order → Production Plan → Lab Nature → Process Order → Dispatch (features saleOrder.planFromOrder, production.labNature, dispatch.requirePostedProcessOrder) | `lib/orders/soPlan.js` · `lib/production/planDuplicates.js` · `lib/production/planNature.js` · `/api/orders/saleOrder/plan` · `/api/orders/so-nature` · reports `isoTimeline`, `pendingReport` (`lib/reports/`) |
| Monthly opening stock (read/write) | `lib/openingStock.js` (helper) · `lib/openingStockGenerate.js` (only writer, runs on period lock) |

---

## Environment Variables

```env
DATABASE_URL              # PostgreSQL connection string (required)
NEXTAUTH_URL             # Auth callback URL
NEXTAUTH_SECRET          # JWT signing secret
WOOCOMMERCE_URL          # Optional (sync currently disabled)
WOOCOMMERCE_CONSUMER_KEY # Optional
VAPID_PUBLIC_KEY         # Phone notifications (npx web-push generate-vapid-keys) — same pair on every server;
VAPID_PRIVATE_KEY        #   a new pair silently cuts off every subscribed phone
VAPID_SUBJECT            # mailto:<company IT contact> (or the https site URL)
```

Use `.env` for development, `.env.production` for production.

---

## Key Dependencies

| Library | Purpose |
|---|---|
| Prisma 6 + Accelerate | ORM + query caching |
| TanStack Query v5 | Server state (caching, refetch) |
| React Hook Form + Zod | Form state + validation |
| jsPDF + jspdf-autotable | PDF generation |
| ExcelJS + xlsx | Excel export |
| Framer Motion | Animations |
| Axios | HTTP client |

---

## Standing Rules — follow these, do not invent another way

> **Rule 0 — No patch work. Ever.** Bizlogist ERP is one product for many companies. Never write code for one client, one company, one user or one record: no `if (company === …)`, no hard-coded account / godown / category / user id, no copied file "for Eastland", no quick fix that only makes today's case pass. Where companies work differently, the difference is a **setting** (rule 16); where a value belongs to the company, it is **data** (Account Settings, Settings, roles, permissions, menus). Fix the cause, not the symptom: a change that hides an error, skips a check, catches and ignores, or special-cases one row is not finished work. If the proper way is bigger than the task, say so and ask — do not patch.

These are decisions already made with the owner. Anyone changing the code (person or AI assistant) follows them; changing one is a conversation with the owner first, never a side effect of a task.

1. **System-posted vouchers are read-only.** A voucher a module posts by itself (payroll JV, advance/loan pay-out, loan repayment, salary payment, reversals) carries its marker in `TRANSACTIONS_MASTER.rmk4` (registry: `lib/vouchers/systemVouchers.js`) and its record id in `rmk5`. It is never edited or deleted — not from a screen, not by script, not by SQL. The voucher routes refuse it (`systemVoucherError`), and a database trigger (`prisma/sql/2026-11-04_hr_accounting.sql`) rejects changes to its date, type, cash/bank account, marker, lines and amounts. Corrections = a reversal JV posted from the owning screen; both stay in the books. Never drop or bypass the trigger. A new module that posts on its own adds its marker to the registry **and** the trigger list (new SQL file).
2. **HR money always goes through the books, through `lib/hr/vouchers.js`.** Advance/loan paid out → Payment voucher (2); repaid outside payroll → Receipt voucher (1); payroll → JV (3); net salaries paid → Payment voucher (2); undo → mirror JV. Never record money in an HR table without its voucher, never write `TRANSACTIONS_MASTER` from HR code directly. Payroll recovers only advances/loans that were actually paid out.
3. **Who does what is data, not code.** Rights are permission codes (Admin → Permissions; HR codes in `lib/hr/access.js` `HR_PERMS`, seeded by `scripts/seed-permissions.mjs` + a `prisma/sql` file). Which rows a person sees is a data scope (`lib/auth/scopeDimensions.js`). Never hard-code a role, a user, a department or a location in a feature to decide access — not even `ADMIN`: use `isSuperAdmin()` for the few Super-Admin-only things, a permission code for everything else, and the role catalogue (`useRoles` / `activeRoleCodes`) for any list of roles.
4. **HR scope = departments ∩ work locations ∩ employees/team** (`employeeScopeWhere` in `lib/hr/access.js`). A plant time-keeper gets "Work locations (HR) = FACTORY"; a team leader gets "Employees (HR) = Theirs" (their reporting team, `lib/hr/team.js`). With no HR scope recorded, only holders of `hr.scope.all` see everyone; others see their own team. Every HR list, write, report and approval goes through it — approvers only decide for employees in their scope, and nobody approves their own request.
5. **Separation of duties for HR money:** HR prepares (`hr.payroll.manage`, `hr.loan.manage`), an approver approves through Approvals (`hr.payroll.approve`, `hr.loan.approve`), finance posts and pays (`hr.payroll.post`, `hr.payroll.pay`, `hr.loan.disburse`). Keep these as separate rights.
6. **Reports go through the main report engine** (`/api/reports/[reportType]` + `components/Reports/config.js` + `ReportViewer`). No module builds its own report page/runner. HR reports: `lib/reports/hr.js` + `lib/hr/reports/catalog.js` (keys `hr<Name>`).
7. **Notifications are data.** Built-in events are listed in `lib/notifications/catalog.js`; admins change who gets them and their texts on Admin → Notifications. A *new* kind of notification ("when X changes, tell Y") is an **alert** created on Admin → Notifications → Alerts (`lib/notifications/alerts.js`, table `notification_alerts`) — it works on any table because it runs on the audit trail. Don't add code for a new notification unless it needs data the record doesn't have; then add a catalog event and `emit(prisma, code, { title, message, vars })`. Phones get every notification automatically (`lib/notifications/push.js`) — never send push from a feature, and never write `Notification` rows anywhere but `emit.js` / `alerts.js`.
8. **Database changes are hand-written SQL files in `prisma/sql/`** (additive, re-runnable, `IF NOT EXISTS` / `ON CONFLICT DO NOTHING`), applied with `npx prisma db execute --file … --schema prisma/schema.prisma` only after the owner approves that run. Never `prisma db push` / `npm run prisma:sync` / `migrate reset` on a shared database.
9. **UI:** every screen works at phone width (360px) — wide tables become cards under `md`, toolbars wrap, dialogs scroll. Reuse `components/HR/shared.jsx` and `components/ui/*`; brand colour `#800000`. Voucher form header: fields in labelled groups (`components/Category/formLayout.js`); a voucher with many header fields of its own kind sets `masterGroups: [{ key, label }]` + `group` on each field and is shown as full-width bands (reference: `letterOfCredit`). Voucher lines on a phone are cards (`table.vf-grid`, `app/globals.css`): pickers / text areas (`td.vf-wide`, or a line field with `wide: true`) take the full width, figures two per row (three from 480px).
10. **Every write is audited, through `lib/prisma.js`.** The extension records create / createMany / update / updateMany / upsert / delete / deleteMany per record into `AuditLog` (with the parent document, the save's batch id and the user) and runs notifications/audit in the background — never `await` side effects inside a write, never write business tables with the base client or raw SQL (raw SQL is not audited; if unavoidable, say so in the code). A child table of a document gets an `AUDIT_PARENTS` entry in `lib/audit/catalog.js`. Route handlers call `setAuditActor(session)`; cron jobs wrap work in `runAsSystem("job name", fn)`. The trail is read on the Audit Trail page (`/dashboard/audit-trail`, `audit.view`).
11. **One approvals inbox.** Every approval (held vouchers, sale orders, HR) is decided on `/dashboard/approvals`; no module builds its own approval page.
12. **Approvals — the standard.** Never hard-code approvers. *Document* approvals are **approval rules** (`ApprovalRule`, Admin → Permissions → Approvals; `hold` = held as an `ApprovalRequest`, `flag` = Sale Order saved at status 3 with the rule names as reasons); every save route calls `approvalGate()` and `runApprovedRequest()` (`lib/approvals/rules.js`). *Action* approvals (one person may run a button) are a **built-in approval** in `lib/approvals/catalog.js` — one permission drives page, API, menu and notifications; `gatesPage: false` when the page is everyone's and only the action is gated (e.g. `salesMonthEnd` → `salesTarget.monthEnd`). **An approver's own save is not sent to them:** `findHoldingRule(..., session)` skips rules the saver `canDecide`; a Sale Order whose every reason the saver may approve (`approverScope` / `mayApprove`) is saved approved, stamped `approved_by` / `approved_at` / "Saved by an approver". A rule someone else approves still holds it; Super Admin counts as an approver of every rule (ACCOUNTANT no longer does — it is an ordinary role since 2026-11-16). In the inbox nobody approves their own request (Super Admin excepted, owner's decision — `selfDecisionError`, `hrSelfError`). A new gated action = permission in `scripts/seed-permissions.mjs` + a `prisma/sql` insert, `guard("<code>")` on the route, and the page hides the button from the GET's `meta` (`can(session, code)`).
13. **Locked vs. editable — keep it this way.** Posted vouchers: only through their form, subject to period lock + approval rules; system-posted vouchers never (rule 1). Sale Order at status 3 / 4: an edit sends it back for approval unless the editor is its approver. Sales Targets: **Target Qty** — user-entered; **Target Recovery** — set by the system only (`lib/salesTargets/autoTarget.js`: the customer's minimum = opening overdue × 100% / 40% BAD-PAYMENTS / 25% BAD-DEBTS, `lib/salesTargets/minRecovery.js`; written when the page opens, on the 1st by cron and at month-end; the API ignores it in PUT / POST); **Locked Recovery / Locked OverDue** — month-end only (`utils/monthlySalesTeamSnapshot.js`, cron on the 1st or "Run Month-End" by holders of `salesTarget.monthEnd`, who may re-run a locked month). Monthly opening stock: `lib/openingStockGenerate.js` only. `AuditLog`: `lib/prisma.js` only. A new system-calculated figure follows the same pattern: one writer function, the API ignores it from users, the page shows it read-only with how it was worked out, and it is listed here.
14. **ON books / OFF books, and "Hide off books".** Off books (the unofficial book) = an account with `acno.is_active = false` or whose main account (`MACNO.is_active`) is false; a voucher is off books when its party (`pycd`) or ANY line is such an account, an order when its customer is. One definition: `lib/accounts/books.js` (BI: the **Book (On / Off)** field, `BOOK_SQL` in `lib/bi/datasets.js`, and the All / On books / Off books buttons on every dashboard — built-in dashboard filter `book`). The header switch (`offBooks.hide`, `Settings` key `hideOffBooks`) hides all off books from the whole system for everyone, with no banner: `lib/prisma.js` adds an ON-books `where` to reads of `ACNO`, `TransactionsMaster`, `Transactions`, `OrderMaster`, `OrderDetail`, `CustomerMonthlyTarget`, `ChecksInHand` and a filter join after those tables in raw SELECTs. Writes and named background jobs (`runAsSystem`) are never filtered. New code: read through `prisma` (not the base client); add a new customer / voucher table to `ON_BOOK_WHERE` + `ON_BOOK_SQL`; reference those tables in raw SQL as `FROM` / `JOIN "<table>" [alias]`, not in a comma list.
15. **Report layout and drill trail — every report, including new ones.** Reports render through `ReportViewer` with the standard wide-report layout (design: artifact "Wide Report Layout"); a new report gets it by adding a `layout` (and, if its rows can go deeper, `drill`) entry next to its `columns` in `components/Reports/config.js` — never its own table code. `layout` (object, or a function of `filters` when columns change by summary type): `pinned` (identity fields kept on the left — code/name, or date/document no), `groups` (`[{ id, label, fields, foldTo }]` — a header band over related columns; a folded group shows only `foldTo`), `views` (`[{ id, label, fields }]` ready-made column sets, `defaultView`), `rowGroupBy` (field(s) that become group rows with subtotals instead of columns), `unitSwitch` (paired KG/LTR-style columns shown one set at a time), `card` (phone card: `title`, `subtitle`, up to 4 `figures`). Without `layout` the engine still pins the first identity column, hides all-empty numeric columns, keeps the totals row pinned, gives a row-detail panel and phone cards. Every user may save personal views. Excel exports the current view or everything (group band as merged header, frozen panes); PDF exports the current view. **Drill trail:** every row that comes from a voucher carries `tran_id` + `tran_code` (or the config says how to get them) and opens that voucher read-only through `voucherHref()` (`lib/vouchers/voucherLink.js`); summary rows drill to the next report with `drill: [{ label, href(row, filters) }]` (e.g. Stock → Stock Ledger for that item and period → the voucher). The viewer keeps the trail (breadcrumb + Back) across those steps, with each step's filters in its URL so Back returns to the same place. A new report that lists transactions without a voucher drill is not finished. Exact keys and defaults: the header of `components/Reports/layout.js` (engine: `WideTable.jsx`, `RowDetailPanel.jsx`, `ReportCards.jsx`, `reportTrail.js`, `wideExport.js`); reference entries: `stockActivityWithRate`, `stock`, `stockLedger`. The report API returns `tran_id` + `tran_code` (and `rmk1` / `service_id` / `order_no` where they apply) on every transaction row. Every voucher / order row — in voucher and order lists, view windows and transaction-level reports — also shows **Entered by** (the user's name from `TransactionsMaster.user_id` / `OrderMaster.userid`); create routes set that id from the session on the server, never from the request body (system jobs leave it null = "System"). **Grouped reports** (document header + lines, sections, hierarchies) also go through the wide engine — `layout.groupRows` reads the API's `row_type` stream as it is (header → group row, lines → its rows, server totals recomputed or kept with `keepTotal` / `totalFrom` when they are not a plain sum), or `rowGroupBy` when the rows already carry the grouping keys; never a report-specific grouped table or the removed `groupedDetailView`. Every grouped report keeps search, filters, views, totals, voucher drill and the standard Excel / PDF; reference entry for grouped documents: `payment` (Detail View). The lines behind a row (`detailColumns`) open in the standard Record Details sheet (`RecordLinesSheet.jsx`).


16. **Every difference between companies is a Feature setting** — Settings → Features, one catalogue: `lib/features/catalog.js` (`FEATURES`, groups, defaults, where each behaviour came from). Example: Services on GRN / dispatch on or off; produce-on-dispatch from the BOM on or off; process orders made from a BOM (optional) or a Recipe (required). Rules:
    - **The default is today's SMS behaviour**, so a company that changes nothing gets exactly that. A new feature's default never changes what existing companies see.
    - **One switch, every layer.** The server enforces it (`await feature("<key>")` from `lib/features/server.js` in the route — a switched-off flow cannot happen through any request, whatever a screen sends); screens follow it (`useFeatures().on("<key>")` / `.value("<key>")` from `hooks/useFeatures.js` — hide the panel, field or button, never just disable it); reports, approvals and notifications read the same key. A feature that only hides UI is not finished.
    - **Switching off never destroys data.** Existing documents keep what they were saved with (e.g. an old dispatch keeps its BOM materials on edit; linked service invoices stay); "off" governs new work.
    - **Never test a client in code.** No `if (client === "eastland")`, no per-client copies of a file, no flag in an env variable. If two companies need two behaviours, add one feature with two values.
    - **Unknown keys fail loudly** (`feature()` throws on a key not in the catalogue). Values are stored in Settings key `featureFlags` (only those differing from the default), changed only by holders of `settings.manage`, through `/api/settings/features` (audited). Each route caches them 10 s.
    - **Adding one:** catalogue entry (key, group, type toggle | choice, label, plain-words description, origin, default) → server check in every route the flow touches → screen → a re-runnable test (see `scripts/demo/`) that saves it on and off and proves both behaviours through the API.
17. **Porting from another client system (Eastland, Accounting, …).** Port the behaviour, not the client: what the other system does differently becomes a feature (rule 16), its fixed numbers become Account Settings / Settings data, its tran_codes are translated to this system's (Service Invoice = 21 here), its schema changes arrive as hand-written `prisma/sql` files (rule 8), and its reports go through the report engine (rules 6, 15). Opening stock is per godown here — read it only through `lib/openingStock.js`. Client names, logos, people, imports and one-off data fixes are never ported. What is merged and what is still to do: `docs/merge/*.md`.
18. **Demo database and real data.** The demo server runs only on made-up data (`scripts/demo/`: `build-demo-db.mjs` rebuilds it, `seed-masters.mjs` the company, `seed-documents.mjs` the documents through the app's own API). Never point it at a client database, never copy client data into this repository, and the scripts refuse any DATABASE_URL that is not the demo one. Logins: one per role, password `demo123` (`admin` = Super Admin).
## Notes

- **Transactions are immutable by convention:** corrections are reversal documents (return invoices, reversal JVs). The generic voucher edit/delete routes exist for hand-keyed vouchers only and refuse system-posted ones (rule 1).
- **WooCommerce sync** is disabled in `services/wooCommerceSync.js`.
- **Raw SQL** (`prisma.$queryRaw`) is used for window functions (running balances), CTEs, and complex aggregations.
- **`VOUCHER_CONFIG`** in `components/Category/constants.js` is the authoritative mapping of `tran_code` to human-readable labels, PDF templates, and route paths — check it before adding new transaction types.
