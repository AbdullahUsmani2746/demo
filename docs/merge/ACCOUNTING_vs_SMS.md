# Accounting → Bizlogist demo: what to port

Base = SMS. Accounting branched before SMS and continued only on costing, sale returns, GRN rates and the dispatch check panel. Behaviour differences become settings on Settings → Features (`lib/features/catalog.js`).

## Done
- **10 reports:** customerFile, dailyProduction, digitalInvoice, ilfile, monthWiseRMMovingAverage, pcfile, prfile, purchasingfile, rmCosting, withHoldingTax.
  - Distributor codes moved to the Settings key `distributorFileCodes`.
  - RM Costing reads opening stock through `lib/openingStock.js`.
- **Process order source:** choose BOM or Recipe (`production.processOrderSource`).
- **Costing:** `costing.method` (average / blendedCC — `lib/costing/issueRate.js`, `ccRates.js`; production costing, Stock Activity With Rate CC split, COGS, COGM, opening rates at period lock), `costing.semiFinishedCC` (`lib/costing/ccPolicy.js`, start month = Settings key `costingSemiCcFrom`, set on Production Costing), `costing.reconciliation` (Stock ↔ GL reconciliation `lib/reconciliation/stockGl.js`, Item cost trace `itemTrace.js`; permission `costing.reconcile`, `prisma/sql/2026-11-21_accounting_costing.sql`).

## To port
| Item | Accounting source | Setting / note |
|---|---|---|
| Planned qty per item (monthly / quarterly) | `api/material/input-for-pp`, model `InputForPP`, `lib/reports/productionPlanning.js` | Screen. Production Planning shows the Qtr Qty. |
| GRN direct rate per item / category | `api/forms/items/grn-direct-rate`, `lib/grnDirectRate.js`, `Item.grn_direct_rate`, `ItemCategory.grn_direct_rate` | `grn.directRateByItem` |
| Sale return costed at the original month; dispatch link required | `api/voucher/sale-return-cost`, `lib/costing/costRates.js`, `Transactions.cost_rate` | `saleReturn.costAtOriginalMonth`, `saleReturn.requireDispatchLink` |
| Fulfilment check panel on dispatch / transfer | `components/Category/FulfilmentCheckPanel.jsx`, `lib/stock/currentStock.js` | `dispatch.fulfilmentPanel` |
| FIFO split for repeated items on a sale order | `lib/orderLineAllocation.js` | Check what SMS does first. |
| Line-level withholding tax | `Transactions.tax_law_code`, `TaxLaws.tax_acno`, `wht_rate` | `tax.lineWht`. Map Accounting's fixed accounts 38 / 66 to Account Settings. |
| Fixed asset disposal (15) and relocation (16) | `VOUCHER_CONFIG` + voucher route ~1135–1193, `api/forms/fixed-assets-by-department` | New vouchers. Also add 15 / 16 to `lib/periodLockCatalog.js`. |
| Reprocessing waits for Send to Production | `productionPlanMaster.batch_required` | `processOrder.batchRequiredReprocessing` |
| Reorder level and minimum order quantity | `Item.re_order_level`, `Item.minimum_order_quantity` | Columns. |
| Requisition rejected qty | `ReqDetail.rejected_qty` | Column. |
| Withholding tax rates with decimals | `TaxLaws.rate_filer` / `rate_non_filer` | Change Int to Float. |

## Conflicts (keep SMS)
- **MonthlyOpeningStock:** SMS stores qty per godown, NOT NULL, with rates per item in `MonthlyOpeningRate`. Accounting uses a `godown = null` row. Rewrite every ported reader against `lib/openingStock.js`.
- **Category hierarchy:** SMS categories are flat; Accounting chains them.
- **`User.role`:** SMS stores it as text; Accounting uses an enum.
- **Service Invoice tran_code:** SMS uses 21; Accounting uses 20, which collides with Credit Note.

## Skip
- **Replaced by SMS:**
  - Self-service attendance (`employer/*`, `AttendanceRecord`, `Holiday`): SMS has an HR module.
  - `scheduled-jobs/`: SMS has `openingStockGenerate`.
  - `departmentAccess`: SMS has data scopes.
  - `periodLockAccess`: SMS has a permission for it.
  - `cashPayment` / `cashReceipt`: SMS uses account groups.
- **Not worth porting:**
  - `forms/duplicate`: mostly dead code.
  - `voucher/vendor-rate`: unsound formula.
- **Client-specific:**
  - SIEGWERK branding.
  - User "27373".
  - Fixed accounts and godowns: 38 / 66 / 268 / 1 / 2 / 6, macno 27.
