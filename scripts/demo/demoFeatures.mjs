// scripts/demo/demoFeatures.mjs — the Settings → Features switches the demo
// company runs with (a paint / ink manufacturer). Applied by seed-documents.mjs
// at the start (so the documents are saved under them) and again at the end.
// Switches that would change the core SMS flows the seeder posts stay at their
// default; these only add checks, panels, postings or reports.
export const DEMO_FEATURES = {
  // fixed assets: register from GRN, monthly depreciation, relocation, disposal
  "fixedAssets.autoRegisterFromGrn": true,
  "fixedAssets.depreciation": true,
  "fixedAssets.disposalPosting": true,
  "fixedAssets.relocation": true,
  // HR payroll additions
  "hr.providentFund": true,
  "hr.gratuity": true,
  "hr.bankDisbursement": true,
  "hr.payHistory": true,
  "hr.taxCertificate": true,
  "hr.leavingProcess": true,
  "hr.pfLoans": true,
  // sales / dispatch / documents (warnings and panels only)
  "documents.batchReuseWarning": true,
  "saleOrder.focTrialWarning": true,
  "dispatch.fulfilmentPanel": true,
  // sale order → production plan made from the order line, the Lab's Nature on it
  "saleOrder.planFromOrder": true,
  "production.labNature": true,
  // withholding tax deducted per payment line (Finance → Withholding Tax report)
  "tax.lineWht": true,
  // accounting / costing
  "vouchers.subAccounts": true,
  "knockoff.matchReturns": true,
  "reports.rmcInputRates": true,
  "costing.reconciliation": true,
};

// Switched only after the documents are posted (the seeder's history needs the
// defaults: most demo customers end up past their credit limit, and some demo
// dispatches are produced from the BOM). From then on, as the Sales tutorial shows:
//  - a Sale Order that takes a customer over the limit waits on Approvals with the
//    reason "Credit limit exceeded";
//  - a dispatch takes finished goods from stock (the demo company makes them on
//    process orders), so the form has no BOM materials panel.
export const DEMO_FEATURES_AFTER_SEED = {
  "saleOrder.creditLimit": "hold",
  "dispatch.produceOnDispatch": false,
};

const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** PUT the demo switches (Super Admin) and wait out the 10 s feature cache of each route. */
export async function applyDemoFeatures(call, log = console.log, { afterSeed = false } = {}) {
  const values = afterSeed ? { ...DEMO_FEATURES, ...DEMO_FEATURES_AFTER_SEED } : DEMO_FEATURES;
  await call("admin", "PUT", "/api/settings/features", { values });
  log(`  features on: ${Object.keys(values).length}`);
  await wait(11000);
}
