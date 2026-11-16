// scripts/build-menus-sql.mjs
// ============================================================
// Build the menus table (module -> group -> screen) as reviewable SQL.
//
//   node scripts/build-menus-sql.mjs [--out scripts/sql/menus-seed.sql]
//
// Nothing is written to the database. Every url is checked against the real
// routes (app/(pages)/..., the [category]/[type] CONFIG, setup entities and
// REPORT_CONFIG keys); a url that matches nothing fails the build.
//
// Conventions the app relies on:
//   - top-level titles must match MENU_ORDER in lib/menu/buildMenuTree.js
//     exactly (that is how modules are ordered)
//   - titles are upper-case (the Setup -> Menu form upper-cases them)
//   - icon is a lucide-react export name (nav-main.jsx does Icons[item.icon])
//   - url NULL = a group heading that only holds children
// ============================================================
import fs from "node:fs";
import path from "node:path";

const OUT = process.argv.includes("--out") ? process.argv[process.argv.indexOf("--out") + 1] : "scripts/sql/menus-seed.sql";

const rep = (key, title, icon = "FileChartColumn") => [title, `/accounting/reports/${key}`, icon];
const setup = (entity, title, icon) => [title, `/accounting/setup/${entity}`, icon];

// [title, url | null, icon, children?]
const MENU = [
  ["SALES", null, "TrendingUp", [
    ["SALE ORDER", "/accounting/order/saleOrder", "ShoppingCart"],
    // Decided on /dashboard/approvals now (one approvals inbox) — kept hidden so the id stays.
    ["SALE ORDER APPROVALS", "/accounting/forms/saleOrderApprovals", "BadgeCheck", null, { hidden: true }],
    // Hidden 2026-10-25: sales go Dispatch → Dispatch Invoicing only.
    ["SALE INVOICE", "/accounting/invoice/sale", "ReceiptText", null, { hidden: true }],
    // Hidden 2026-10-25: returns are quantity-only Dispatch Returns (DESPATCH),
    // priced in FINANCE → INVOICING → Sale Return Invoicing.
    ["SALE RETURN", "/accounting/return/saleReturn", "Undo2", null, { hidden: true }],
    ["CUSTOMERS", "/accounting/forms/customer", "Users"],
    ["SALES TARGETS", "/accounting/forms/salesTargets", "Target"],
    ["SALES LOANS", "/accounting/forms/salesLoans", "HandCoins"],
    ["POINT OF SALE", "/pos", "MonitorSmartphone"],
    ["SALES REPORTS", null, "FileChartColumn", [
      rep("sale", "SALES REGISTER"),
      rep("saleOrder", "SALE ORDER REPORT"),
      rep("salesOrderBalance", "SALE ORDER BALANCE"),
      rep("saleOrderToDispatch", "SALE ORDER TO DISPATCH"),
      // Feature "saleOrder.planFromOrder" — hidden from the sidebar while it is off
      rep("isoTimeline", "SALE ORDER TO INVOICE TIME TRACKING", "Timer"),
      rep("saleReturn", "SALE RETURN REPORT"),
      rep("customerAging", "CUSTOMER AGING", "Hourglass"),
      rep("customerMargin", "CUSTOMER MARGIN", "Percent"),
      rep("salesTeamMis", "SALES TEAM MIS", "UsersRound"),
      rep("salesPerformanceWeekly", "WEEKLY SALES PERFORMANCE", "CalendarRange"),
      rep("sales_matrix_monthwise", "MONTH-WISE SALES MATRIX", "Grid3x3"),
      ["SALES FORECAST", "/accounting/reports/forecast", "ChartLine"],
    ]],
    // Data files a principal company asks its distributor for (codes: Settings "distributorFileCodes")
    ["DISTRIBUTOR FILES", null, "FileSpreadsheet", [
      rep("customerFile", "CUSTOMER FILE"),
      rep("ilfile", "IL FILE"),
      rep("pcfile", "PC FILE"),
      rep("prfile", "PR FILE"),
    ]],
  ]],
  ["LAB", null, "FlaskConical", [
    ["BOM", "/accounting/material?tab=bom", "ListTree"],
    ["RECIPE", "/accounting/material?tab=recipe", "BookOpen"],
    ["MACHINE", "/accounting/material?tab=machine", "Cog"],
    ["GRAND MASTER BOM", "/accounting/material?tab=grand-master-bom", "Network"],
    ["MATERIAL USAGE BOM", "/accounting/material?tab=material-usage-bom", "Layers"],
    rep("bom", "BOM REPORT"),
    rep("masterSample", "MASTER SAMPLE REPORT"),
  ]],
  ["STORES", null, "Warehouse", [
    ["GOODS RECEIPT NOTE", "/accounting/report/grn", "PackageCheck"],
    // Hidden 2026-10-25: the GRN is the purchase (vendor bill details are
    // entered on the GRN) — a separate invoice would post it twice.
    ["PURCHASE INVOICE", "/accounting/invoice/purchase", "FileText", null, { hidden: true }],
    // Hidden 2026-10-25: returns are quantity-only GRN Returns, priced in
    // FINANCE → INVOICING → Purchase Return Invoicing.
    ["PURCHASE RETURN", "/accounting/return/purchaseReturn", "Undo2", null, { hidden: true }],
    ["GRN RETURN", "/accounting/return/grnReturn", "PackageX"],
    ["MATERIAL REQUISITION", "/accounting/material/requisition", "ClipboardPen"],
    ["TRANSFER REQUISITION", "/accounting/material/requisitionTransfer", "ArrowLeftRight"],
    ["GODOWN TRANSFER", "/accounting/godown/transfer", "ArrowRightLeft"],
    ["ITEMS", "/accounting/forms/items", "Package"],
    ["PRINTING", null, "Printer", [
      ["STICKER PRINTING", "/accounting/stickerPrinting", "Sticker"],
      ["TAG PRINTING", "/accounting/tagPrinting", "Tag"],
    ]],
    ["STORES REPORTS", null, "FileChartColumn", [
      rep("stock", "STOCK"),
      rep("stockLedger", "STOCK LEDGER"),
      rep("stockActivity", "STOCK ACTIVITY"),
      rep("stockWithCost", "STOCK WITH COST"),
      rep("monthlyStock", "MONTHLY STOCK"),
      rep("monthlyStockValuation", "MONTHLY STOCK VALUATION"),
      rep("grn", "GRN REPORT"),
      rep("grnReturn", "GRN RETURN REPORT"),
      rep("returnablePacking", "RETURNABLE PACKING"),
      rep("materialTransfer", "MATERIAL TRANSFER"),
    ]],
  ]],
  ["PRODUCTION", null, "Factory", [
    ["PROCESS ORDER", "/accounting/material?tab=production", "Workflow"],
    ["PRODUCTION PLAN", "/accounting/material?tab=production-plan", "CalendarRange"],
    // Planned qty per item per month / quarter (INPUT_FOR_PP) — Production Planning's Qtr Qty
    ["PLANNED QUANTITIES", "/accounting/planned-quantities", "CalendarRange"],
    // Dispatch production plans (Sale Order lines, Lab Nature) — feature "saleOrder.planFromOrder"
    ["SALE ORDER PRODUCTION PLANS", "/accounting/material/dispatchTransfer", "ClipboardList"],
    ["MATERIAL CONSUMPTION", "/accounting/production/materialIssue", "PackageMinus"],
    ["MATERIAL INPUT", "/accounting/production/materialInput", "PackagePlus"],
    ["MATERIAL TRANSACTIONS", "/accounting/materialTransactions", "ArrowDownUp"],
    ["FG TRANSFER REQUISITION", "/accounting/material/requisitionFGTransfer", "ClipboardList"],
    ["FG TRANSFER ACCEPTANCE", "/accounting/fg-transfer", "PackageCheck"],
    ["FACTORY SCAN", "/accounting/factory-scan", "ScanBarcode"],
    ["COSTING", null, "Calculator", [
      ["COSTING OVERVIEW", "/accounting/costing", "Calculator"],
      ["COST RATES", "/accounting/costing/rates", "BadgeDollarSign"],
      ["ISSUANCE COSTING", "/accounting/costing/issuance", "PackageMinus"],
      ["PRODUCTION COSTING", "/accounting/costing/production", "Factory"],
      ["COST VARIANCE", "/accounting/costing/variance", "Scale"],
      ["COSTING CHECK", "/accounting/costing/checking", "ListChecks"],
      // Feature "costing.reconciliation" — hidden from the sidebar while it is off (lib/features/apply.js)
      ["STOCK ↔ GL RECONCILIATION", "/accounting/costing/reconciliation", "Scale"],
      ["ITEM COST TRACE", "/accounting/costing/item-reconciliation", "Search"],
      // Feature "reports.rmcInputRates" — hidden from the sidebar while it is off (lib/features/apply.js)
      ["RMC INPUT RATES", "/accounting/rmc-rates", "Calculator"],
    ]],
    ["PRODUCTION REPORTS", null, "FileChartColumn", [
      rep("productionPlanning", "PRODUCTION PLANNING"),
      rep("processOrderReconciliation", "PROCESS ORDER RECONCILIATION"),
      rep("processOrderTiming", "PROCESS ORDER TIMING", "Timer"),
      // Feature "production.labNature"
      rep("pendingReport", "PENDING REPORT (PROCESS ORDERS)", "ListChecks"),
      rep("materialProduction", "MATERIAL PRODUCTION"),
      rep("materialIssuance", "MATERIAL ISSUANCE"),
      rep("rmc", "RAW MATERIAL COST"),
      rep("batchCosting", "BATCH COSTING"),
      rep("batchBalance", "BATCH BALANCE"),
      rep("batchLedger", "BATCH LEDGER"),
      rep("fgstock", "FINISHED GOODS STOCK"),
      rep("fgdailystock", "FINISHED GOODS DAILY STOCK"),
      rep("costOfGoodsManufactured", "COST OF GOODS MANUFACTURED"),
      rep("directMaterialIssuanceCost", "DIRECT MATERIAL ISSUANCE COST"),
      rep("discard", "DISCARDED MATERIAL"),
      rep("dailyProduction", "DAILY PRODUCTION"),
      rep("monthWiseRMMovingAverage", "RM MOVING AVERAGE - MONTH WISE"),
      rep("rmCosting", "RM COSTING"),
    ]],
  ]],
  ["DESPATCH", null, "Truck", [
    // Direct dispatch (no Sale Order needed): the list of saved dispatches,
    // with its "New Dispatch" button. Dispatching against a Sale Order still
    // starts from the Sale Order list below.
    ["DISPATCH NOTE", "/accounting/report/dispatchEdit", "Truck"],
    ["DISPATCH FROM SALE ORDER", "/accounting/report/dispatch", "ClipboardList"],
    // Moved 2026-10-25 to FINANCE → INVOICING → Sale Invoicing.
    ["DISPATCH INVOICING", "/accounting/dispatch-invoicing", "FileCheck", null, { hidden: true }],
    // Quantity-only return made against a dispatch (priced in Sale Return
    // Invoicing). Uses the reworked saleReturn screen.
    ["DISPATCH RETURN", "/accounting/return/saleReturn", "Undo2"],
    ["DESPATCH REPORTS", null, "FileChartColumn", [
      rep("dispatch", "DISPATCH REPORT"),
      rep("dailyDispatch", "DAILY DISPATCH", "CalendarDays"),
      rep("dispatchReturn", "DISPATCH RETURN REPORT"),
    ]],
  ]],
  ["FINANCE", null, "Landmark", [
    ["FINANCE SETUP", null, "BookOpen", [
      ["ADD ACCOUNT", "/accounting/add-account", "CirclePlus"],
      ["SHOW ACCOUNTS", "/accounting/show-account", "BookOpen"],
      ["ACCOUNT SETTINGS", "/accounting/settings/accounts", "Landmark"],
      // Feature "vouchers.subAccounts" — hidden from the sidebar while it is off
      ["SUB ACCOUNTS", "/accounting/sub-accounts", "Layers"],
    ]],
    ["VOUCHERS", null, "NotebookPen", [
      ["PAYMENT VOUCHER", "/accounting/voucher/payment", "ArrowUpRight"],
      ["RECEIPT VOUCHER", "/accounting/voucher/receipt", "ArrowDownLeft"],
      ["JOURNAL VOUCHER", "/accounting/voucher/journal", "NotebookPen"],
      ["DEBIT NOTE", "/accounting/invoice/debit", "FileMinus"],
      ["CREDIT NOTE", "/accounting/invoice/credit", "FilePlus"],
    ]],
    // Physical documents (GRN, dispatch and their returns) carry quantities
    // only; they are priced and posted here.
    ["INVOICING", null, "FileCheck", [
      ["SALE INVOICING", "/accounting/invoicing/sale", "ReceiptText"],
      ["SALE RETURN INVOICING", "/accounting/invoicing/sale-return", "Undo2"],
      ["PURCHASE INVOICING", "/accounting/invoicing/purchase", "FileText"],
      ["PURCHASE RETURN INVOICING", "/accounting/invoicing/purchase-return", "PackageX"],
    ]],
    ["CHECKS IN HAND", "/accounting/checks-in-hand", "Banknote"],
    ["OUTSTANDING", "/accounting/outstanding", "Scale"],
    ["KNOCK-OFF REVIEW", "/accounting/knockoff-review", "ListChecks"],
    ["BALANCE CONFIRMATION LETTER", "/accounting/BalanceConfirmationLetter", "Mail"],
    ["FINANCE REPORTS", null, "FileChartColumn", [
      rep("accountLedger", "ACCOUNT LEDGER"),
      rep("cbBook", "CASH & BANK BOOK"),
      rep("trialBalance", "TRIAL BALANCE"),
      rep("trialBalancePeriod", "TRIAL BALANCE (PERIOD)"),
      rep("trialBalanceSheet", "BALANCE SHEET"),
      rep("profitLoss", "PROFIT & LOSS"),
      rep("profitLossMonthly", "PROFIT & LOSS - MONTH ON MONTH"),
      rep("accountsActivity", "ACCOUNTS ACTIVITY"),
      rep("payment", "PAYMENT REGISTER"),
      rep("receipt", "RECEIPT REGISTER"),
      rep("journal", "JOURNAL REGISTER"),
      rep("checksInHand", "CHECKS IN HAND REPORT"),
      rep("fundsFlow", "FUNDS FLOW"),
      rep("fundsPosition", "FUNDS POSITION"),
      rep("costOfGoodsSold", "COST OF GOODS SOLD"),
      rep("costOfSales", "COST OF SALES"),
      rep("tradingMargin", "TRADING MARGIN"),
      rep("withHoldingTax", "WITHHOLDING TAX"),
      rep("digitalInvoice", "FBR DIGITAL INVOICE"),
      ["ALL REPORTS", "/accounting/reports", "FolderOpen"],
    ]],
  ]],
  // One desk for the accounts staff: only the screens their access list names
  // (EMPLOYEE_MENUS below hands out single entries, not the whole module).
  ["ACCOUNTS DESK", null, "BriefcaseBusiness", [
    ["VOUCHERS", null, "Receipt", [
      ["PAYMENT VOUCHER", "/accounting/voucher/payment", "ArrowUpRight"],
      ["RECEIPT VOUCHER", "/accounting/voucher/receipt", "ArrowDownLeft"],
      ["JOURNAL VOUCHER", "/accounting/voucher/journal", "NotebookPen"],
    ]],
    rep("cbBook", "CASH & BANK BOOK", "BookOpen"),
    ["SALES & PURCHASE", null, "ArrowLeftRight", [
      rep("sale", "SALES REGISTER"),
      rep("purchase", "PURCHASE REGISTER"),
      ["SALE INVOICING", "/accounting/invoicing/sale", "ReceiptText"],
      ["PURCHASE INVOICING", "/accounting/invoicing/purchase", "FileText"],
    ]],
    ["SALE RETURNS", null, "Undo2", [
      rep("saleReturn", "SALE RETURN REPORT"),
      ["DISPATCH RETURN", "/accounting/return/saleReturn", "Undo2"],
      ["SALE RETURN INVOICING", "/accounting/invoicing/sale-return", "Undo2"],
    ]],
    ["LEDGERS", null, "BookOpenText", [
      rep("accountLedger", "CUSTOMER & VENDOR LEDGER", "BookOpenText"),
      rep("receipt", "RECEIPT REGISTER"),
      rep("payment", "PAYMENT REGISTER"),
    ]],
    ["BALANCES & AGING", null, "Scale", [
      ["OUTSTANDING BALANCES", "/accounting/outstanding", "Scale"],
      rep("customerAging", "CUSTOMER AGING", "Hourglass"),
      rep("vendorAging", "VENDOR AGING", "Hourglass"),
    ]],
    rep("returnablePacking", "DRUM LOAN LEDGER", "Cylinder"),
  ]],
  ["IMPORT", null, "Ship", [
    ["LETTER OF CREDIT", "/accounting/voucher/letterOfCredit", "FilePenLine"],
    ["IN-BOND ENTRY", "/accounting/voucher/inBond", "Container"],
    ["MATERIAL ISSUE FOR LANDED COST", "/accounting/production/materialIssueLanded", "Calculator"],
    setup("lc", "LC SETUP", "FileStack"),
    setup("beneficiary", "BENEFICIARIES", "Contact"),
    rep("importedMaterialStock", "IMPORTED MATERIAL STOCK"),
    rep("importedMaterialinTransit", "IMPORTED MATERIAL IN TRANSIT"),
    rep("importedMaterialDeals", "IMPORTED MATERIAL DEALS"),
  ]],
  ["HR OPERATIONS", null, "Users", [
    ["HR DASHBOARD", "/accounting/hr/dashboard", "LayoutDashboard"],
    ["TEAM STRUCTURE", "/accounting/hr/team", "GitBranch"],
    ["ATTENDANCE", "/accounting/hr/attendance", "CalendarCheck"],
    ["SHIFTS & HOLIDAYS", "/accounting/hr/shifts", "Clock"],
    ["LEAVE", "/accounting/hr/leave", "Plane"],
    ["SALARY", "/accounting/hr/salary", "BadgeDollarSign"],
    ["ADVANCES & LOANS", "/accounting/hr/loans", "HandCoins"],
    ["PAYROLL", "/accounting/hr/payroll", "Wallet"],
    // Features hr.payHistory / hr.leavingProcess — hidden while switched off (lib/features/catalog.js screens)
    ["PAY HISTORY", "/accounting/hr/pay-history", "History"],
    ["LEAVING & SETTLEMENT", "/accounting/hr/leaving", "UserMinus"],
    ["HR REPORTS", null, "ChartColumn", [
      rep("hrAttendanceSummary", "MONTHLY ATTENDANCE SUMMARY"),
      rep("hrAttendanceExceptions", "LATES, ABSENCES & MISSED PUNCHES"),
      rep("hrOvertime", "OVERTIME"),
      rep("hrLeaveRegister", "LEAVE REGISTER"),
      rep("hrLeaveTaken", "LEAVE TAKEN BY TYPE"),
      rep("hrPayrollSummary", "PAYROLL BY MONTH"),
      rep("hrPayrollByDepartment", "PAYROLL COST BY DEPARTMENT"),
      rep("hrIncomeTax", "INCOME TAX DEDUCTED"),
      rep("hrSalaryRegister", "SALARY REGISTER"),
      rep("hrLoansOutstanding", "ADVANCES & LOANS OUTSTANDING"),
      rep("hrPayHistory", "PAY HISTORY"),
      rep("hrPfLedger", "PROVIDENT FUND LEDGER"),
      rep("hrGratuityProvision", "GRATUITY PROVISION"),
      rep("hrHeadcount", "EMPLOYEE LIST & TURNOVER"),
    ]],
    ["HR SETUP", null, "Settings2", [
      setup("employees", "EMPLOYEES", "Users"),
      setup("departments", "DEPARTMENTS", "Building"),
      setup("designations", "DESIGNATIONS", "IdCard"),
      setup("work_locations", "WORK LOCATIONS", "MapPin"),
      setup("managers", "MANAGERS", "UserCog"),
      setup("employee_types", "EMPLOYEE TYPES", "UserRoundCog"),
      setup("employee_categories", "EMPLOYEE CATEGORIES", "Tags"),
    ]],
    ["PAYROLL SETUP", null, "Wallet", [
      setup("cost_centers", "COST CENTERS", "ChartPie"),
      setup("banks", "BANKS", "Landmark"),
      setup("bank_branches", "BANK BRANCHES", "GitBranch"),
      // Hidden 2026-11-01: pay components live on HR → Salary (hr_pay_components).
      [...setup("allowances", "ALLOWANCES", "CirclePlus"), null, { hidden: true }],
      [...setup("deductions", "DEDUCTIONS", "CircleMinus"), null, { hidden: true }],
      // Hidden 2026-10-31: leave types live on HR → Leave (hr_leave_types).
      [...setup("leaves", "LEAVES", "Umbrella"), null, { hidden: true }],
    ]],
  ]],
  ["FIXED ASSETS", null, "Building2", [
    ["FIXED ASSETS GRN", "/accounting/report/fixedAssetsGrn", "PackageCheck"],
    // lib/fixedAssets — depreciation / relocation menus hide while their
    // Settings → Features switch is off (catalog `screens`).
    ["FIXED ASSET REGISTER", "/accounting/fixed-assets", "ClipboardList"],
    ["DEPRECIATION RUN", "/accounting/fixed-assets/depreciation", "Calculator"],
    ["FIXED ASSET RELOCATION", "/accounting/report/fixedAssetRelocation", "MoveRight"],
    ["FIXED ASSET DISPOSAL", "/accounting/report/fixedAssetDisposal", "Trash2"],
    ["FIXED ASSET REPORTS", null, "FileChartColumn", [
      rep("fixedAssetRegister", "FIXED ASSET REGISTER REPORT"),
      rep("fixedAssetMovement", "FIXED ASSET MOVEMENT", "ArrowLeftRight"),
      rep("fixedAssetSchedule", "DEPRECIATION SCHEDULE", "CalendarRange"),
      rep("fixedAssetDisposals", "DISPOSAL GAIN / LOSS", "Scale"),
    ]],
    ["FIXED ASSET SETUP", null, "Settings2", [
      setup("fixed_asset_items", "FIXED ASSET ITEMS", "Boxes"),
      setup("fixed_asset_categories", "FIXED ASSET CATEGORIES", "FolderTree"),
    ]],
  ]],
  ["MANAGEMENT", null, "LayoutDashboard", [
    ["DASHBOARD", "/accounting/dashboard", "LayoutDashboard"],
    ["GRAPHS", "/accounting/graphs", "ChartLine"],
    ["MANAGER GRAPHS", "/accounting/graphs/manager", "ChartPie"],
    ["NOTIFICATIONS", "/accounting/notifications", "Bell"],
    ["APPROVALS", "/dashboard/approvals", "Inbox"],
    // Build questions / dashboards and assign them. Viewing needs no menu:
    // "My Dashboards" and "My Follow-ups" sit at the top of every sidebar.
    ["BI DESIGNER", "/accounting/bi-designer", "ChartPie"],
    ["SETUP", null, "Settings2", [
      setup("companies", "COMPANIES", "Building2"),
      setup("currencies", "CURRENCIES", "Coins"),
      setup("godowns", "GODOWNS", "Warehouse"),
      setup("bond_locations", "BOND LOCATIONS", "MapPinned"),
      setup("financial_years", "FINANCIAL YEARS", "CalendarDays"),
      setup("seasons", "SEASONS", "CalendarRange"),
      setup("cities", "CITIES", "MapPin"),
      setup("branches", "BRANCHES", "GitBranch"),
      setup("item_categories", "ITEM CATEGORIES", "FolderTree"),
      setup("main_categories", "MAIN CATEGORIES", "Folders"),
      setup("product_groups", "PRODUCT GROUPS", "Group"),
      setup("product_master_categories", "PRODUCT MASTER CATEGORIES", "FolderKanban"),
      setup("purchase_product_categories", "PURCHASE PRODUCT CATEGORIES", "FolderInput"),
      setup("delivery_modes", "DELIVERY MODES", "Truck"),
      setup("delivery_terms", "DELIVERY TERMS", "FileText"),
      setup("commission_terms", "COMMISSION TERMS", "Percent"),
      setup("tax_setups", "TAX SETUP", "Receipt"),
      setup("tax_laws", "TAX LAWS", "Scale"),
      setup("menus", "MENUS", "Menu"),
      setup("employee_menus", "EMPLOYEE MENUS", "ListChecks"),
    ]],
    ["SETTINGS", "/accounting/settings", "Settings"],
  ]],
  ["QUALITY ASSURANCE", null, "ShieldCheck", [
    ["QUALITY CONTROL", "/accounting/forms/qualitycontrol", "ClipboardCheck"],
    ["ORDER QUALITY CONTROL", "/accounting/forms/orderqualitycontrol", "ClipboardList"],
    ["QA ENTRY", "/accounting/forms/qaEntry", "ShieldCheck"],
    ["QC MASTER STICKER", "/accounting/QCMasterSticker", "Sticker"],
    setup("quality_parameters", "QUALITY PARAMETERS", "SlidersHorizontal"),
    rep("qc", "QC REPORT"),
    rep("orderQc", "ORDER QC REPORT"),
    rep("qcParameters", "QC PARAMETERS REPORT"),
  ]],
  ["PURCHASE & SUPPLY CHAIN", null, "Link", [
    ["PURCHASE REQUISITION", "/accounting/order/purchaseOrder", "ClipboardList"],
    ["PURCHASE ORDER", "/accounting/order/purchaseOrderEdit", "ShoppingBag"],
    ["VENDORS", "/accounting/forms/vendor", "Truck"],
    ["SERVICES", null, "Wrench", [
      ["SERVICE ORDER", "/accounting/order/serviceOrder", "Wrench"],
      ["SERVICE ENTRY", "/accounting/report/serviceEntry", "ClipboardPen"],
      ["SERVICE INVOICE", "/accounting/report/serviceInvoice", "ReceiptText"],
      setup("services", "SERVICES", "Wrench"),
      setup("service_categories", "SERVICE CATEGORIES", "FolderTree"),
    ]],
    ["PURCHASE REPORTS", null, "FileChartColumn", [
      rep("purchase", "PURCHASE REGISTER"),
      rep("purchaseOrder", "PURCHASE ORDER REPORT"),
      rep("purchaseOrderBalance", "PURCHASE ORDER BALANCE"),
      rep("purchaseReturn", "PURCHASE RETURN REPORT"),
      rep("materialprocurement", "MATERIAL PROCUREMENT"),
      rep("materialprocurementenquiry", "PROCUREMENT ENQUIRY"),
      rep("serviceOrder", "SERVICE ORDER REPORT"),
      rep("serviceEntry", "SERVICE ENTRY REPORT"),
      rep("serviceInvoice", "SERVICE INVOICE REPORT"),
      rep("purchasingfile", "PURCHASING FILE"),
    ]],
  ]],
];

// ---------- people with their own menu list ----------
// These employees get exactly these entries (paths as in menus-ids.json) and
// no department modules; the seed removes any other menu they hold.
const DESK = "ACCOUNTS DESK";
const DESK_FULL = [
  `${DESK} > VOUCHERS`, `${DESK} > CASH & BANK BOOK`, `${DESK} > SALES & PURCHASE`,
  `${DESK} > SALE RETURNS`, `${DESK} > LEDGERS`, `${DESK} > BALANCES & AGING`, `${DESK} > DRUM LOAN LEDGER`,
];
const DESK_PARTY = [`${DESK} > LEDGERS`, `${DESK} > BALANCES & AGING`, `${DESK} > DRUM LOAN LEDGER`];
// Per-person menu lists are data (Settings → Employee menus), not code.
const EMPLOYEE_MENUS = {};

// ---------- which modules each department gets ----------
// Granted through employee_menu (the sidebar reads that, by employee) to every
// employee in the department; /api/buildMenu adds each module's sub-menus.
// Keys must match Department.dept_name exactly; values are top-level titles.
const ALL_MODULES = MENU.map(([title]) => title);
const DEPARTMENT_MODULES = {
  "OPERATIONS": ["SALES", "STORES", "PRODUCTION", "DESPATCH", "QUALITY ASSURANCE", "PURCHASE & SUPPLY CHAIN", "IMPORT", "MANAGEMENT"],
  "DISPATCH": ["DESPATCH", "STORES"],
  "ADMINISTRATION - FACTORY": ["HR OPERATIONS", "FIXED ASSETS", "STORES", "PURCHASE & SUPPLY CHAIN"],
  "PLANT": ["PRODUCTION", "LAB", "QUALITY ASSURANCE"],
  "BOILER": ["PRODUCTION"],
  "SECURITY": ["DESPATCH"],
  "FINANCE": ["FINANCE", "IMPORT", "FIXED ASSETS", "SALES", "STORES", "MANAGEMENT"],
  "DRAWINGS": ALL_MODULES,
  "SMS INDUSTRIES DISTILLERY": ["PRODUCTION", "LAB", "QUALITY ASSURANCE", "STORES"],
  "ACCOUNTS": ["FINANCE", "IMPORT", "FIXED ASSETS"],
  "GENERAL ADMINISTRATION - HO": ["HR OPERATIONS", "MANAGEMENT", "FIXED ASSETS"],
  "SALES": ["SALES", "DESPATCH"],
};

// ---------- url validation against the real app ----------
const read = (p) => fs.readFileSync(p, "utf8");
const staticPages = new Set();
(function walk(dir, route) {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) walk(path.join(dir, e.name), `${route}/${e.name}`);
    else if (/^page\.jsx?$/.test(e.name)) staticPages.add(route || "/");
  }
})("app/(pages)", "");
const typePage = read("app/(pages)/accounting/[category]/[type]/page.js");
const catTypes = new Set();
{
  let cat = null;
  for (const l of typePage.slice(typePage.indexOf("const CONFIG = {")).split("\n").slice(1)) {
    const c = l.match(/^  ([a-zA-Z]+): \{/), t = l.match(/^    ([a-zA-Z]+): \{/);
    if (c) cat = c[1]; else if (t && cat) catTypes.add(`${cat}/${t[1]}`);
    if (/^};/.test(l)) break;
  }
}
const setupCfg = read("components/Setups/config.js");
const setupEntities = new Set([...setupCfg.matchAll(/^  ([a-zA-Z_]+): \{/gm)].map((m) => m[1]));
const repCfg = read("components/Reports/config.js");
const reportKeys = new Set([...repCfg.slice(repCfg.indexOf("REPORT_CONFIG = {")).matchAll(/^  ([a-zA-Z_]+): \{/gm)].map((m) => m[1]));
// HR reports are built from lib/hr/reports/catalog.js (key → hr<Key>, hrEngineKey).
const hrCatalog = read("lib/hr/reports/catalog.js");
for (const m of hrCatalog.slice(hrCatalog.indexOf("HR_REPORTS = {")).matchAll(/^  ([a-zA-Z]+): \{/gm)) reportKeys.add(`hr${m[1][0].toUpperCase()}${m[1].slice(1)}`);
const materialTabs = new Set(["bom", "recipe", "machine", "production", "production-plan", "grand-master-bom", "material-usage-bom"]);

function urlOk(url) {
  const [p, qs] = url.split("?");
  if (p === "/accounting/material" && qs) return materialTabs.has(new URLSearchParams(qs).get("tab"));
  // app/(pages)/accounting/invoicing/[kind]/page.jsx
  if (/^\/accounting\/invoicing\/(sale|sale-return|purchase|purchase-return)$/.test(p)) {
    return staticPages.has("/accounting/invoicing/[kind]");
  }
  if (staticPages.has(p)) return true;
  let m = p.match(/^\/accounting\/setup\/([a-zA-Z_]+)$/);
  if (m) return setupEntities.has(m[1]);
  m = p.match(/^\/accounting\/reports\/([a-zA-Z_]+)$/);
  if (m) return reportKeys.has(m[1]);
  m = p.match(/^\/accounting\/([a-zA-Z]+)\/([a-zA-Z]+)$/);
  if (m) return catTypes.has(`${m[1]}/${m[2]}`);
  return false;
}

// ---------- icon validation (lucide-react, if installed anywhere nearby) ----------
let lucideNames = null;
for (const dir of ["node_modules/lucide-react", "../accounting/node_modules/lucide-react"]) {
  const f = path.join(dir, "dist/lucide-react.d.ts");
  if (fs.existsSync(f)) {
    lucideNames = new Set([...read(f).matchAll(/declare const ([A-Z][A-Za-z0-9]*): react\.ForwardRefExoticComponent/g)].map((m) => m[1]));
    break;
  }
}

const MENU_ORDER = [...read("lib/menu/buildMenuTree.js").matchAll(/^  "([A-Z &]+)",/gm)].map((m) => m[1]);

// ---------- flatten ----------
// Ids are PERMANENT: scripts/sql/menus-ids.json maps each menu's title path
// ("FINANCE > CHECKS IN HAND") to the id it already has in the database.
// employee_menu grants point at these ids, so a menu inserted in the middle of
// the tree must never renumber the ones after it. New paths get the next free
// id and are written back to the file; a renamed / moved menu is a new path
// (its old row is left for you to retire via Setup → Menus).
const ID_FILE = "scripts/sql/menus-ids.json";
const idByPath = fs.existsSync(ID_FILE) ? JSON.parse(read(ID_FILE)) : {};
let nextId = Math.max(0, ...Object.values(idByPath)) + 1;
const rows = [];
const errors = [];
(function flat(nodes, parentId, parentPath) {
  nodes.forEach(([title, url, icon, children, opts], i) => {
    const menuPath = parentPath ? `${parentPath} > ${title}` : title;
    if (idByPath[menuPath] == null) idByPath[menuPath] = nextId++;
    const id = idByPath[menuPath];
    if (rows.some((r) => r.id === id)) errors.push(`${menuPath}: duplicate path`);
    if (title !== title.toUpperCase()) errors.push(`${title}: title must be upper-case`);
    if (url && !urlOk(url)) errors.push(`${title}: url ${url} matches no page/report/setup entity`);
    if (lucideNames && !lucideNames.has(icon)) errors.push(`${title}: icon ${icon} is not a lucide-react export`);
    if (!url && !children?.length) errors.push(`${title}: group without children`);
    if (parentId === null && !MENU_ORDER.includes(title)) errors.push(`${title}: top-level title not in MENU_ORDER`);
    rows.push({ id, title, url, icon, parentId, order: i + 1, active: !opts?.hidden });
    if (children) flat(children, id, menuPath);
  });
})(MENU, null, "");

for (const [dept, mods] of Object.entries(DEPARTMENT_MODULES))
  for (const m of mods) if (!ALL_MODULES.includes(m)) errors.push(`${dept}: module ${m} is not a top-level menu`);

if (!lucideNames) console.warn("lucide-react not found - icons NOT validated");
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }

const lit = (v) => (v == null ? "NULL" : `'${String(v).replace(/'/g, "''")}'`);
const tree = [];
(function print(parentId, depth) {
  for (const r of rows.filter((x) => x.parentId === parentId)) {
    tree.push(`--   ${"  ".repeat(depth)}${r.title}${r.url ? `  ->  ${r.url}` : ""}  [${r.icon}]`);
    print(r.id, depth + 1);
  }
})(null, 0);

const sql = [
  "-- =====================================================================",
  "-- MENUS - module -> group -> screen, with lucide icons",
  "-- Generated by scripts/build-menus-sql.mjs (edit the MENU tree there and regenerate)",
  `-- ${rows.length} menus. Every url was checked against the app's real pages/reports/setups.`,
  "-- Re-runnable: ids are fixed, existing ids are UPDATED.",
  "--",
  "-- Columns: id | title | url (NULL = group heading) | icon (lucide name) | parent_id | order_no",
  "--",
  ...tree,
  "-- =====================================================================",
  "BEGIN;",
  "",
  `INSERT INTO menus (id, title, url, icon, parent_id, order_no, is_active) VALUES`,
  rows.map((r, i) => `  (${r.id}, ${lit(r.title)}, ${lit(r.url)}, ${lit(r.icon)}, ${r.parentId ?? "NULL"}, ${r.order}, ${r.active})${i === rows.length - 1 ? "" : ","}`).join("\n"),
  "ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title, url = EXCLUDED.url, icon = EXCLUDED.icon,",
  "  parent_id = EXCLUDED.parent_id, order_no = EXCLUDED.order_no, is_active = EXCLUDED.is_active;",
  "",
  `SELECT setval(pg_get_serial_sequence('menus', 'id'), GREATEST((SELECT MAX(id) FROM menus), 1));`,
  "",
  "-- Department -> module grants, to every employee of the department.",
  "-- Additive: existing employee_menu rows are kept, duplicates skipped.",
  ...Object.entries(DEPARTMENT_MODULES).map(([d, mods]) => `--   ${d}: ${mods.join(", ")}`),
  "INSERT INTO employee_menu (employee_id, menu_id)",
  "SELECT e.id, m.id",
  `FROM "Employee" e`,
  `JOIN "Department" d ON d.id = e."departmentId"`,
  "JOIN (VALUES",
  Object.entries(DEPARTMENT_MODULES)
    .flatMap(([d, mods]) => mods.map((m) => `  (${lit(d)}, ${lit(m)})`))
    .join(",\n"),
  ") AS g(dept_name, module) ON g.dept_name = d.dept_name",
  "JOIN menus m ON m.title = g.module AND m.parent_id IS NULL",
  ...(Object.keys(EMPLOYEE_MENUS).length ? [`WHERE e.id NOT IN (${Object.keys(EMPLOYEE_MENUS).join(", ")})`] : []),
  "ON CONFLICT (employee_id, menu_id) DO NOTHING;",
  "",
  "-- People with their own menu list: exactly these entries.",
  ...Object.entries(EMPLOYEE_MENUS).flatMap(([emp, paths]) => {
    const ids = paths.map((p) => {
      if (!idByPath[p]) errors.push(`EMPLOYEE_MENUS ${emp}: unknown menu ${p}`);
      return idByPath[p];
    });
    return [
      `DELETE FROM employee_menu WHERE employee_id = ${emp} AND menu_id NOT IN (${ids.join(", ")});`,
      `INSERT INTO employee_menu (employee_id, menu_id) SELECT ${emp}, id FROM menus WHERE id IN (${ids.join(", ")})`,
      `  AND EXISTS (SELECT 1 FROM "Employee" WHERE id = ${emp}) ON CONFLICT (employee_id, menu_id) DO NOTHING;`,
    ];
  }),
  "",
  `SELECT setval(pg_get_serial_sequence('employee_menu', 'id'), GREATEST((SELECT MAX(id) FROM employee_menu), 1));`,
  "",
  "COMMIT;",
  "",
].join("\n");
fs.mkdirSync(path.dirname(OUT), { recursive: true });
if (errors.length) { console.error(errors.join("\n")); process.exit(1); }
fs.writeFileSync(OUT, sql);
fs.writeFileSync(ID_FILE, JSON.stringify(idByPath, null, 1) + "\n");
console.log(`wrote ${OUT} (${rows.length} menus, ${rows.filter((r) => r.parentId === null).length} modules)`);
