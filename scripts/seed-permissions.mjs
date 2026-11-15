// scripts/seed-permissions.mjs
//
// Fills the Permission catalogue from the config the app already has, so a
// new document type or report becomes controllable without anyone
// remembering to add a permission by hand.
//
//   node --env-file=.env scripts/seed-permissions.mjs          # dry run
//   node --env-file=.env scripts/seed-permissions.mjs --apply
//
// Idempotent: existing codes are updated, new ones inserted, and codes that
// no longer exist in config are reported (never deleted automatically —
// a grant may still point at one).
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

// Document actions generated for every voucher/order type.
const DOC_ACTIONS = [
  // "view" gates the list/search screen for a document type. Without it a
  // person barred from creating dispatches could still open the dispatch
  // register and read every one of them.
  ["view", "View"],
  ["create", "Create"],
  ["update", "Edit"],
  ["delete", "Delete"],
  ["print", "Print / export"],
];

// Which module a document type belongs to, for grouping the admin screen.
const DOC_MODULE = (type) => {
  const t = type.toLowerCase();
  if (/(sale|dispatch|customer)/.test(t)) return "Sales";
  // if (/(purchase|grn|vendor|inbond|lc|service)/.test(t)) return "Purchasing";
  if (/(purchase|grn|vendor|inbond|exbond|lc|service)/.test(t)) return "Purchasing";
  if (/(production|material|requisition|bom|fg|transfer|plan)/.test(t)) return "Manufacturing";
  if (/(receipt|payment|journal|voucher)/.test(t)) return "Finance";
  if (/(asset)/.test(t)) return "Fixed Assets";
  return "Documents";
};

const REPORT_MODULE = {
  sales: "Reports · Sales",
  purchase: "Reports · Purchasing",
  stock: "Reports · Stock",
  production: "Reports · Manufacturing",
  financial: "Reports · Finance",
  service: "Reports · Service",
  hr: "Reports · HR",
  other: "Reports · Other",
};

// Actions that are not a document or a report.
const SPECIAL = [
  // Areas that are not a voucher, a report or a setup master, but still have
  // routes that write. Added once those routes were guarded — a guard whose
  // code is not in the catalogue resolves to "unknown", which is a refusal.
  // Sales people see only the customers assigned to them on the Sales Team
  // MIS and the Sales Targets screen. This right lifts that for the few
  // people who supervise the whole team.
  ["salesTeam.viewAll", "Sales", "See every sales person's customers (reports, MIS, targets, loans)"],
  // A team lead: their own customers PLUS the sales persons listed on the
  // grant (constraints.salesPersons). Set on Permissions → Sales visibility.
  ["salesTeam.viewTeam", "Sales", "See own customers plus chosen sales persons' customers"],
  // Sale Orders needing approval (Free of Cost, Trial, No Godown, …) wait at
  // status 3 until someone holding this approves them (Permissions →
  // Approvals). lib/orders/saleOrderApproval.js
  ["saleOrder.approve", "Sales", "Approve Sale Orders held for approval (Free of Cost / Trial / No Godown …)"],
  // Sale Returns given a Technical reason wait for this (granted on
  // Permissions → Approvals). lib/saleReturns/remarks.js
  ["saleReturn.approve", "Sales", "Approve sale returns with a Technical reason"],
  ["salesTarget.monthEnd", "Sales", "Run the Sales Targets month-end calculation (locks Recovery / OverDue)"],
  // Write the review remark on a sale return reason (was a hard-coded user).
  ["saleReturn.remark", "Sales", "Write review remarks on sale return reasons"],
  ["account.manage", "Finance", "Create or edit chart-of-account masters"],
  ["bom.manage", "Manufacturing", "Create or edit a bill of materials"],
  ["recipe.manage", "Manufacturing", "Create or edit a recipe"],
  ["machineInstruction.manage", "Manufacturing", "Create or edit machine instructions"],
  ["costing.manage", "Stock & Costing", "Maintain BOM costing and future costing"],
  ["qualityControl.manage", "Manufacturing", "Record or amend QC results"],
  ["pos.manage", "Sales", "Operate the point of sale (orders, products, returns)"],
  ["notification.manage", "Administration", "Change notification settings or mark notifications read"],
  ["employee.manage", "Administration", "Create or edit employee records"],
  ["fixedAsset.manage", "Fixed Assets", "Maintain fixed-asset records"],
  ["taxChallan.manage", "Finance", "Create or edit tax challans"],
  ["dispatch.invoice", "Sales", "Generate sales invoices from dispatches"],
  ["dispatch.rate.override", "Sales", "Override dispatch rates (otherwise taken from the Sale Order / customer price list)"],
  ["bi.design", "Administration", "Design BI questions and dashboards, assign them, and set dataset access (BI Designer)"],
  ["dispatch.unlock", "Sales", "Unlock an invoiced dispatch (reverse the invoice)"],
  // Invoicing (/api/invoicing/[kind], lib/invoicing/core.js): GRNs, dispatches
  // and their returns are saved with quantity only and priced here later.
  ["invoicing.sale.view", "Invoicing", "View dispatches pending / invoiced as sale invoices"],
  ["invoicing.sale.generate", "Invoicing", "Price dispatches and generate sale invoices"],
  ["invoicing.sale.unlock", "Invoicing", "Unlock a sale invoice (reverse its pricing and ledger posting)"],
  ["invoicing.sale-return.view", "Invoicing", "View sale returns pending / invoiced"],
  ["invoicing.sale-return.generate", "Invoicing", "Price sale returns and generate credit notes"],
  ["invoicing.sale-return.unlock", "Invoicing", "Unlock an invoiced sale return"],
  ["invoicing.purchase.view", "Invoicing", "View GRNs pending / invoiced as purchase invoices"],
  ["invoicing.purchase.generate", "Invoicing", "Price GRNs and generate purchase invoices"],
  ["invoicing.purchase.unlock", "Invoicing", "Unlock a purchase invoice (reverse its pricing and ledger posting)"],
  ["invoicing.purchase-return.view", "Invoicing", "View purchase returns pending / invoiced"],
  ["invoicing.purchase-return.generate", "Invoicing", "Price purchase returns and generate debit notes"],
  ["invoicing.purchase-return.unlock", "Invoicing", "Unlock an invoiced purchase return"],
  ["salesItem.rate.update", "Sales", "Update customer item rates"],
  ["customer.create", "Sales", "Create a customer"],
  ["customer.update", "Sales", "Edit a customer"],
  ["customer.delete", "Sales", "Delete a customer account"],
  ["customer.creditTerms.update", "Sales", "Change credit days, credit limit or tax rate"],
  ["customer.book.update", "Sales", "Move a customer between the ON and OFF books"],
  ["offBooks.hide", "Administration", "Hide all OFF books from the whole system (the header switch) — for everyone, until shown again"],
  ["customer.import", "Sales", "Bulk-import customers, contacts or rates from Excel"],
  ["knockoff.run", "Finance", "Run invoice knock-off matching"],
  ["knockoff.allocate", "Finance", "Allocate a receipt to an invoice manually"],
  ["knockoff.reverse", "Finance", "Reverse a knock-off allocation or run"],
  ["period.lock", "Stock & Costing", "Lock or unlock an accounting period"],
  ["openingStock.calculate", "Stock & Costing", "Recalculate monthly opening stock"],
  ["stock.adjust", "Stock & Costing", "Adjust stock directly"],
  ["maintenance.bulkUpdate", "Administration", "Run bulk data-fix utilities"],
  ["users.manage", "Administration", "Create and edit users"],
  ["permissions.manage", "Administration", "Grant and revoke permissions"],
  ["menus.manage", "Administration", "Assign screens to employees"],
  ["settings.manage", "Administration", "Change company settings"],
  ["export.excel", "Reports", "Export any report to Excel"],
  ["export.pdf", "Reports", "Export any report to PDF"],
  // HR · Attendance (lib/hr). Which employees a person sees is the
  // "Departments (HR)" data scope on Admin → Permissions.
  ["hr.attendance.view", "HR", "View attendance (daily register, monthly sheet, punches)"],
  ["hr.attendance.mark", "HR", "Mark / correct attendance (older days go for approval)"],
  ["hr.attendance.approve", "HR", "Approve attendance corrections; edit any day directly"],
  ["hr.attendance.import", "HR", "Import attendance files and sync attendance machines"],
  ["hr.attendance.own", "HR", "See own attendance (My HR) and ask for corrections of own days"],
  ["hr.devices.manage", "HR", "Add and edit attendance machines; map machine user ids"],
  ["hr.shifts.manage", "HR", "Create shifts, assign them to employees, set attendance rules"],
  ["hr.holidays.manage", "HR", "Add and remove holidays"],
  ["hr.leave.apply", "HR", "Apply for own leave; see own balances"],
  ["hr.leave.view", "HR", "View everyone's leave, balances and the leave calendar"],
  ["hr.leave.manage", "HR", "Apply leave for others, adjust balances, carry forward, edit leave types"],
  ["hr.leave.approve", "HR", "Approve or reject leave requests"],
  ["hr.salary.view", "HR", "View salaries and pay components"],
  ["hr.salary.manage", "HR", "Revise salaries (goes to approval) and edit pay components"],
  ["hr.salary.approve", "HR", "Approve salary revisions; revise salaries directly"],
  ["hr.loan.apply", "HR", "Apply for own salary advance / loan; see own loans"],
  ["hr.loan.view", "HR", "View everyone's advances and loans"],
  ["hr.loan.manage", "HR", "Apply for others, record repayments, skip or reschedule instalments"],
  ["hr.loan.approve", "HR", "Approve or reject advances and loans"],
  ["hr.payroll.view", "HR", "View payroll runs and payslips"],
  ["hr.payroll.manage", "HR", "Create and calculate payroll, adjust payslips, submit for approval, income-tax slabs and payroll rules"],
  ["hr.payroll.approve", "HR", "Approve or reject a payroll run"],
  ["hr.payroll.post", "HR", "Post an approved payroll to accounts (journal voucher) and reverse it"],
  ["hr.payslip.own", "HR", "See own payslips"],
  ["hr.loan.disburse", "HR", "Pay out advances / loans and receive repayments (posts payment / receipt vouchers)"],
  ["hr.payroll.pay", "HR", "Pay the net salaries of a posted payroll (posts payment vouchers)"],
  ["hr.team.manage", "HR", "Set who reports to whom (HR → Team structure)"],
  ["hr.scope.all", "HR", "See every employee in HR when no HR data scope is set (otherwise only their own team)"],
  ["audit.view", "Administration", "Open the Audit Trail (who changed what, when — every table)"],
];

const titleise = (s) =>
  s.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();

async function loadConfigKeys() {
  // These configs were read with a regex once. It silently missed `grn` and
  // `saleReturn` — two live voucher types — because one is indented three
  // spaces and the other four, so they never got a permission code and would
  // have been refused the moment their route was guarded.
  //
  // The config is therefore compiled and evaluated instead of pattern-matched.
  // A stray indent can no longer cost someone their access.
  const esbuild = await import("esbuild");
  const fs = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  // This file is ESM; the bundle it produces is CommonJS.
  const { createRequire } = await import("node:module");
  const require = createRequire(import.meta.url);

  const evaluate = async (entry, exportName) => {
    const out = path.join(
      await fs.mkdtemp(path.join(os.tmpdir(), "perm-seed-")),
      "config.cjs",
    );
    await esbuild.build({
      entryPoints: [entry],
      bundle: true,
      format: "cjs",
      platform: "node",
      outfile: out,
      loader: { ".js": "jsx" },
      jsx: "transform",
      external: ["next/*", "react", "react-dom"],
      logLevel: "silent",
    });
    // The configs carry a few JSX labels; they are never rendered here, so a
    // stub is enough to let the module finish evaluating.
    globalThis.React ??= { createElement: () => null, Fragment: Symbol("F") };
    const mod = require(out);
    await fs.rm(path.dirname(out), { recursive: true, force: true });
    return mod[exportName];
  };

  const VOUCHER_CONFIG = await evaluate(
    "components/Category/constants.js", "VOUCHER_CONFIG",
  );
  const REPORT_CONFIG = await evaluate(
    "components/Reports/config.js", "REPORT_CONFIG",
  );

  // Every top-level key is a document type. Filtering on tran_code looks
  // tempting but drops letterOfCredit and inBond, which post through their
  // own routes (differApi) and carry no tran_code of their own.
  const docTypes = Object.keys(VOUCHER_CONFIG).filter((k) => VOUCHER_CONFIG[k]);
  const reportTypes = Object.keys(REPORT_CONFIG);

  // Setup entities share one CRUD route, so they are enumerated from the map
  // that route dispatches on rather than listed by hand.
  const mapSrc = await fs.readFile("lib/entityModelMap.js", "utf8");
  const setupEntities = [
    ...new Set(
      [...mapSrc.matchAll(/^ {2}([A-Za-z0-9_]+):\s*\{/gm)]
        .map((m) => m[1])
        .filter((k) => !["defaultSort", "defaultWhere"].includes(k)),
    ),
  ];

  return { docTypes, reportTypes, setupEntities };
}

function reportCategory(reportType) {
  // HR reports (hrAttendanceSummary, …) are generated from
  // lib/hr/reports/catalog.js and carry category "hr" in REPORT_CONFIG.
  if (/^hr[A-Z]/.test(reportType)) return "hr";
  const categories = {
    stock: ["stock", "stockActivity", "stockActivityView", "stockLedger", "stockMetrics", "tradingMargin", "monthlyStock", "monthlyStockValuation", "stockActivityWithRate", "stockWithCost", "fgstock", "fgdailystock"],
    production: ["productionCosting", "materialProduction", "materialIssuance", "directMaterialIssuanceCost", "bom", "qc", "orderQc", "qcParameters", "batchCosting", "batchBalance", "batchLedger", "processOrderReconciliation", "processOrderTiming", "productionPlanning", "costOfGoodsManufactured", "masterSample", "rmc"],
    sales: ["sale", "saleOrder", "saleOrderToDispatch", "saleReturn", "posTransactions", "customerAging", "salesPerformanceWeekly", "dispatch", "dispatchReturn", "dailyDispatch", "salesOrderBalance", "salesTeamMis", "customerMargin", "costOfSales"],
    purchase: ["purchase", "purchaseOrder", "purchaseReturn", "grn", "grnReturn", "purchaseOrderBalance", "materialprocurement", "materialprocurementenquiry", "importedMaterialStock", "importedMaterialinTransit", "importedMaterialDeals", "costOfGoodsSold", "exbondReport"],
    financial: ["accountLedger", "accountLedgerSummary", "trialBalance", "trialBalancePeriod", "trialBalanceSheet", "profitLoss", "accountsActivity", "payment", "receipt", "journal", "cbBook", "fundsFlow", "fundsPosition", "checksInHand"],
    service: ["serviceOrder", "serviceEntry", "serviceInvoice"],
  };
  for (const [cat, list] of Object.entries(categories)) if (list.includes(reportType)) return cat;
  return "other";
}

async function main() {
  const { docTypes, reportTypes, setupEntities } = await loadConfigKeys();
  const wanted = new Map();
  const add = (code, module, label, sort) => wanted.set(code, { code, module, label, sort });

  SPECIAL.forEach(([code, module, label], i) => add(code, module, label, 100 + i));

  docTypes.forEach((type, i) => {
    const module = DOC_MODULE(type);
    DOC_ACTIONS.forEach(([action, verb], j) => {
      add(`${type}.${action}`, module, `${verb} ${titleise(type)}`, 1000 + i * 10 + j);
    });
  });

  reportTypes.forEach((type, i) => {
    add(`report.${type}.view`, REPORT_MODULE[reportCategory(type)], `View ${titleise(type)} report`, 5000 + i);
  });

  // Setup masters (items, godowns, currencies, …) all pass through
  // /api/setup/[entity]. "view" is read, "manage" is create/edit/delete —
  // finer than that would be 200 codes nobody would ever use.
  setupEntities.forEach((entity, i) => {
    add(`setup.${entity}.view`, "Setup", `View ${titleise(entity)}`, 8000 + i * 2);
    add(`setup.${entity}.manage`, "Setup", `Add, edit or delete ${titleise(entity)}`, 8001 + i * 2);
  });

  const existing = await prisma.permission.findMany({ select: { code: true } });
  const existingCodes = new Set(existing.map((e) => e.code));
  const toAdd = [...wanted.values()].filter((p) => !existingCodes.has(p.code));
  const orphaned = [...existingCodes].filter((c) => !wanted.has(c));

  console.log(`${APPLY ? "APPLYING" : "DRY RUN"}`);
  console.log(`  document types ${docTypes.length} × ${DOC_ACTIONS.length} actions`);
  console.log(`  reports        ${reportTypes.length}`);
  console.log(`  special        ${SPECIAL.length}`);
  console.log(`  setup entities ${setupEntities.length} × 2 actions`);
  console.log(`  ─ total wanted ${wanted.size} | already present ${existingCodes.size} | new ${toAdd.length}`);
  if (orphaned.length) console.log(`  ! ${orphaned.length} code(s) in the database are no longer in config: ${orphaned.slice(0, 5).join(", ")}${orphaned.length > 5 ? " …" : ""}`);

  const byModule = {};
  for (const p of wanted.values()) byModule[p.module] = (byModule[p.module] || 0) + 1;
  console.table(Object.entries(byModule).sort((a, b) => b[1] - a[1]).map(([module, count]) => ({ module, count })));

  if (!APPLY) {
    console.log("\nNo changes written. Re-run with --apply.");
    return;
  }

  // Batched: ~240 sequential upserts over a remote connection is enough
  // round-trips for the server to close it mid-run (seen as P1017). New codes
  // go in chunks; existing ones are refreshed in batched transactions.
  const CHUNK = 50;
  let inserted = 0;
  for (let i = 0; i < toAdd.length; i += CHUNK) {
    const res = await prisma.permission.createMany({
      data: toAdd.slice(i, i + CHUNK),
      skipDuplicates: true,
    });
    inserted += res.count;
  }

  const refresh = [...wanted.values()].filter((x) => existingCodes.has(x.code));
  for (let i = 0; i < refresh.length; i += CHUNK) {
    await prisma.$transaction(
      refresh.slice(i, i + CHUNK).map((x) =>
        prisma.permission.update({
          where: { code: x.code },
          data: { module: x.module, label: x.label, sort: x.sort },
        }),
      ),
    );
  }

  const total = await prisma.permission.count();
  console.log(`
Seeded: ${inserted} new, ${refresh.length} refreshed. Catalogue holds ${total} permissions.`);
}

main()
  .catch((e) => { console.error("Seed failed:", e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
