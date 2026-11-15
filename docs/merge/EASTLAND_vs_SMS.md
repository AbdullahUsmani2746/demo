# Eastland → Bizlogist demo: what to port

Base = SMS. SMS is the newer and more general codebase: it has Account Settings, data roles, a stock-check policy and one Invoicing screen. Port only what Eastland adds, and put any behaviour difference behind a setting.

## Reports to add
| Key | Title | Eastland source | Needs |
|---|---|---|---|
| `isoTimeline` | ISO To Invoice Time Tracking | `lib/reports/isoTimeline.js`, config ~13737 | `OrderMaster.created_at/updated_at`, `ReqDetail.nature/nature_at/created_at/updated_at`, `ReqMaster.created_at`, `Transactions.plan_no`, `TransactionsMaster.invoiced_at` — **ported 2026-11-21** as "Sale Order To Invoice Time Tracking" (key kept), feature `saleOrder.planFromOrder`; times in the viewer's clock; `invoiced_at` stamped by `lib/invoicing/core.js` |
| `pendingReport` | Pending Report (plan lines with no posted Process Order) | `lib/reports/pendingReport.js`, `components/Template/PendingReport.jsx` | `ReqDetail.nature` — **ported 2026-11-21**, feature `production.labNature`; drill → Create Process Order; standard PDF/Excel (sign-off print template not ported) |
| `profitLossMonthly` | Profit & Loss: Month on Month | inline in `app/api/reports/[reportType]/route.js` ~6671 | add tran_code 21 (SMS Service Invoice) |

Reports that exist in both but behave differently. Each Eastland behaviour becomes an option:
- **Account Ledger:** item narration on invoice rows; Sub Account column and summary.
- **Account Ledger Summary:** knock-off amount column.
- **Customer Aging:** unapplied credit pays the oldest debt first.
- **Sales Team MIS:** recovery = all credits.
- **RMC:** "Input Based" view (RmcInputRate). Drop Eastland's fixed `EICL_RATE`.
- **Stock:** Ink Series view; `re_order` column.
- **Dispatch report:** litres on every line.

## Features to add, each behind a setting
| Feature | Eastland files | Setting |
|---|---|---|
| Sale Order line types (Normal / Trial / Rate Negotiation); trial lines priced 0; approved trial items billed as dispatch part `-2` | `lib/orders/lineTypes.js`, `lib/orders/trialBilling.js`, `lib/dispatch/trialBilling.js`, `api/dispatch-invoicing/trial-items`, `ApprovedTrialItems.jsx` | `orders.trialLineBilling` — **ported 2026-11-19** into SMS Sale Invoicing (`lib/invoicing/core.js` prices trial lines 0, all-trial dispatch blocked; `/api/invoicing/sale/trial-items`, `components/Invoicing/ApprovedTrialItems.jsx`); billing MOVES the lines into part `-2` (no Sale Return — Eastland's route comment was stale); number trigger `prisma/sql/2026-11-19_sales_dispatch_features.sql` |
| Sale Order Plan Date / Qty → Production Plan line; approved order planned automatically | `lib/orders/soPlan.js`, `api/orders/saleOrder/plan`, `SaleOrderPlanCell.jsx` | `saleOrder.planFromOrder` — **ported 2026-11-21**: planned by the server on save / approval, godowns from Production setup (`productionGodown`, new `planFromGodown`) |
| FOC / Trial history warning on Sale Order | `api/orders/saleOrder/foc-trial-check` | `saleOrder.focTrialWarning` — **ported 2026-11-19** (form blocks Save, server refuses) |
| Price list only (ticked Sales Items) on Sale Order | `saleOrderItemsError`, `sales-items` PATCH | `saleOrder.priceListOnly` — **ported 2026-11-19** |
| Sale Order / Dispatch company switches (new) | — | **added 2026-11-19**, `lib/orders/saleOrderChecks.js`, `lib/dispatch/dispatchChecks.js`: `saleOrder.duplicateItems`, `saleOrder.creditLimit`, `saleOrder.overdueCheck`, `saleOrder.litreUnits`, `dispatch.withoutSaleOrder`, `dispatch.overDispatchTolerance`, `dispatch.packingConsumption`, `dispatch.batchRequired`, `dispatch.extraFields` |
| Lab "Nature" on plan lines (FINISHED / PROCESS / MANUFACTURING); changing it needs approval | `api/orders/so-nature`, `lib/approvals/rules.js` (`plan` kind) | `production.labNature` — **ported 2026-11-21**: Nature on plan lines, saved-Nature change held by rules on "Production Plan" (kind `plan`); Process Order from a plan line (`?fromPlan=`) |
| Dispatch blocked until the Process Order is posted or the Lab has marked the line | `Form.jsx` 3535-3549 | `dispatch.requirePostedProcessOrder` — **ported 2026-11-21**: `lib/production/planNature.js`, enforced in the voucher route; `plan_no` / `process_order_no` stamped by the server |
| Batch-reuse warning (dispatch, process order) | `api/dispatch/batch-check`, `api/manufacturing/production/batch-check` | `dispatch.batchReuseWarning` |
| Plan qty ≤ Sale Order qty | `lib/production/planDuplicates.js` | part of `saleOrder.planFromOrder` — **ported 2026-11-21** (also on manual plan create / edit) |
| Sub Accounts on voucher lines (required for EXPENSES) — **done**: `lib/vouchers/subAccounts.js`, Finance → Sub Accounts, ledger column / filter / Summary by Sub Account; "required" = Account Settings `sub_account_groups` | `api/sub-accounts`, model `subAccount` | `vouchers.subAccounts` |
| RMC input rates screen — **done**: Production → Costing → RMC Input Rates, RMC "Input Based" summary type | `accounting/rmc-rates`, `api/rmc-rates`, model `RmcInputRate` | `reports.rmcInputRates` (default off) |
| Knock-off matches returns with no invoice (FIFO); re-FIFO admin tool | `lib/ledger/invoiceMatcher.js`, `lib/ledger/refifo.js` | `knockoff.matchReturns` — **ported 2026-11-19**: matcher + Knock-Off Review "Fix FIFO order" (`knockoff.refifo`, backups in Settings `knockoffRefifo:<stamp>`) |
| Audit trail in words; Sale Order line change log | `lib/audit/explain.js`, `refs.js`, `orderLines.js` | always on — **ported 2026-11-19**: names + sentences on `/api/audit`; the line change log is the paired re-save (no extra AuditLog writer); SO lines stamp `prev_qty` / `prev_rate` / `edited_by` / `edited_at` |
| BI dashboard filter switches | `api/bi/dash-filters`, `lib/bi/dashFilters.js` | always on — **ported 2026-11-19**: Book (on) / Item Category / Series (off by default; Ink Series → item Series) |
| Quantity-only Create GRN priced from the PO | `grnEntry`, `grnEdit` in `constants.js` | `grn.priceOnSave` |

**Dispatch differences:**
- SMS does produce-on-dispatch from the BOM, packing consumption and a Services panel. Eastland does none of these: no BOM and no stock reservations.
- These become settings: `dispatch.produceOnDispatch` and `documents.servicesPanel`.

## Do not port (Eastland client-specific)
- EASTLAND / EICL / MNT names and logos.
- Fixed account, godown and macno numbers: 221, 49, 384, 78, 36/37, 86, godown 12, 2576.
- The CEO wording in approval texts.
- People's names in comments.
- One-off data fixes and imports (`scripts/sql/*`).
- The `Role` enum: SMS stores roles as strings.
- Service Invoice tran_code 20: SMS uses 21.

## Schema to add (hand-written SQL)
- **New tables:** `subAccount`, `RmcInputRate`.
- **`OrderDetail`:** `line_type`, `plan_date`, `plan_qty`, `prev_qty`, `prev_rate`, `edited_at`, `edited_by`, `created_at`, `updated_at`.
- **`OrderMaster`:** `created_at`, `updated_at`.
- **`ReqDetail`:** `nature`, `nature_at`, `created_at`, `updated_at`.
- **`ReqMaster`:** `created_at`, `updated_at`.
- **`Transactions`:** `line_type`, `plan_no`, `process_order_no`, `sub_account`.
- **`TransactionsMaster`:** `dispatch_part`, `invoiced_at`.
- **`SALES_ITEM_CUST`:** `checked`, `updated_by`.
- **Enum `KnockoffSourceType`:** add `RETURN`.
