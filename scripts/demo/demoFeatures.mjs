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

const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

/** PUT the demo switches (Super Admin) and wait out the 10 s feature cache of each route. */
export async function applyDemoFeatures(call, log = console.log) {
  await call("admin", "PUT", "/api/settings/features", { values: DEMO_FEATURES });
  log(`  features on: ${Object.keys(DEMO_FEATURES).length}`);
  await wait(11000);
}
