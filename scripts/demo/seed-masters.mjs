// scripts/demo/seed-masters.mjs — master data for the Bizlogist ERP demo.
// ============================================================
// Made-up company "Apex Coatings & Chemicals (Pvt) Ltd": chart of accounts,
// Account Settings, godowns, units, item categories, items, BOMs, customers,
// vendors, departments, employees, one login per role with the screens that
// role works on. Every name, number and address here is invented.
//
//   node --env-file=.env scripts/demo/seed-masters.mjs
//
// Runs on an EMPTY demo database (scripts/demo/build-demo-db.mjs resets it).
// Refuses to run against anything that is not the demo database.
// ============================================================
import bcrypt from "bcryptjs";
import { PrismaClient } from "@prisma/client";
import { pathToFileURL } from "node:url";

if (!(process.env.DEMO_DATABASE === "1" || process.env.DATABASE_URL?.includes("bizlogist_demo"))) {
  console.error("Refusing: DATABASE_URL is not the demo database.");
  process.exit(1);
}
const prisma = new PrismaClient();
export const DEMO_PASSWORD = "demo123";

// ── Company ────────────────────────────────────────────────────────────────
const COMPANY = {
  id: 1,
  company: "APEX COATINGS & CHEMICALS (PVT) LTD",
  addr1: "Plot 14-B, Sector 23, Korangi Industrial Area",
  addr2: "Karachi 74900",
  city: "KARACHI",
  phone: "+92 21 3500 0000",
  email: "info@apex-demo.example",
  logo: "/pwa/icon-192.png", // square mark for the header; invoices print it too
};

// ── Chart of accounts: MBSCD → BSCD → MACNO → ACNO ─────────────────────────
// MBSCD 1-3 = balance sheet, 4-5 = P&L (the Balance Sheet / P&L reports key on it).
const MBSCD = [
  [1, "ASSETS"], [2, "LIABILITIES"], [3, "EQUITY"], [4, "INCOME"], [5, "EXPENSES"],
];
const BSCD = [
  [11, 1, "CURRENT ASSETS"], [12, 1, "NON-CURRENT ASSETS"],
  [21, 2, "CURRENT LIABILITIES"], [22, 2, "NON-CURRENT LIABILITIES"],
  [31, 3, "CAPITAL & RESERVES"],
  [41, 4, "REVENUE"], [42, 4, "OTHER INCOME"],
  [51, 5, "COST OF SALES"], [52, 5, "OPERATING EXPENSES"], [53, 5, "FINANCE COST"],
];
const MACNO = [
  [101, 11, "CASH & BANK"],
  [102, 11, "TRADE DEBTORS"],
  [103, 11, "STOCK IN TRADE"],
  [104, 11, "ADVANCES & DEPOSITS"],
  [105, 11, "TAX RECOVERABLE"],
  [121, 12, "PROPERTY, PLANT & EQUIPMENT"],
  [201, 21, "TRADE CREDITORS"],
  [202, 21, "TRANSPORTERS & SERVICE PROVIDERS"],
  [203, 21, "ACCRUED LIABILITIES"],
  [204, 21, "TAXES PAYABLE"],
  [221, 22, "LONG TERM FINANCING"],
  [301, 31, "SHARE CAPITAL & RESERVES"],
  [401, 41, "SALES"],
  [402, 41, "SALES RETURNS"],
  [411, 42, "OTHER INCOME"],
  [501, 51, "PURCHASES & MATERIAL COST"],
  [502, 51, "COST OF GOODS SOLD"],
  [503, 51, "FACTORY OVERHEADS"],
  [521, 52, "ADMINISTRATIVE EXPENSES"],
  [522, 52, "SELLING & DISTRIBUTION"],
  [523, 52, "SALARIES & WAGES"],
  [531, 53, "FINANCE COST"],
];

// Fixed account numbers: the transaction seed and Account Settings refer to them.
export const AC = {
  cash: 1011, pettyCash: 1012, bankHbl: 1013, bankMcb: 1014,
  staffAdvances: 1041, staffLoans: 1042, securityDeposits: 1043,
  inputTax: 1051, advanceTax: 1052,
  plant: 1211, vehicles: 1212, furniture: 1213, computers: 1214,
  accDepPlant: 1215, accDepVehicles: 1216, accDepFurniture: 1217, accDepComputers: 1218,
  depreciation: 5217, faGainLoss: 4113,
  stockRm: 1031, stockPm: 1032, stockFg: 1033,
  salaryPayable: 2031, eobiPayable: 2032, accruedExpenses: 2033, otherDeductions: 2034,
  outputTax: 2041, incomeTaxPayable: 2042, whtPayable: 2043,
  bankLoan: 2211,
  capital: 3011, retained: 3012,
  salesLocal: 4011, salesPos: 4012, salesReturn: 4021, scrapSales: 4111, otherIncome: 4112,
  purchases: 5011, purchaseReturn: 5012, freightIn: 5013,
  cogs: 5021,
  conversionCost: 5031, stockLost: 5032, qcCost: 5033, factoryPower: 5034, factoryRepairs: 5035, factoryWages: 5036,
  rent: 5211, utilities: 5212, printing: 5213, telephone: 5214, professional: 5215, serviceExpense: 5216,
  freightOut: 5221, salesPromotion: 5222, travelling: 5223,
  salaries: 5231, overtime: 5232, eobiExpense: 5233,
  bankCharges: 5311, markup: 5312,
};

const ACCOUNTS = [
  [AC.cash, 101, "CASH IN HAND - HEAD OFFICE"],
  [AC.pettyCash, 101, "PETTY CASH - FACTORY"],
  [AC.bankHbl, 101, "HBL - CURRENT A/C 0042"],
  [AC.bankMcb, 101, "MCB - CURRENT A/C 7781"],
  [AC.stockRm, 103, "STOCK - RAW MATERIAL"],
  [AC.stockPm, 103, "STOCK - PACKING MATERIAL"],
  [AC.stockFg, 103, "STOCK - FINISHED GOODS"],
  [AC.staffAdvances, 104, "STAFF ADVANCES"],
  [AC.staffLoans, 104, "STAFF LOANS"],
  [AC.securityDeposits, 104, "SECURITY DEPOSITS"],
  [AC.inputTax, 105, "SALES TAX RECEIVABLE (INPUT)"],
  [AC.advanceTax, 105, "ADVANCE INCOME TAX"],
  [AC.plant, 121, "PLANT & MACHINERY"],
  [AC.vehicles, 121, "VEHICLES"],
  [AC.furniture, 121, "FURNITURE & FIXTURES"],
  [AC.computers, 121, "COMPUTERS & IT EQUIPMENT"],
  [AC.accDepPlant, 121, "ACCUMULATED DEPRECIATION - PLANT & MACHINERY"],
  [AC.accDepVehicles, 121, "ACCUMULATED DEPRECIATION - VEHICLES"],
  [AC.accDepFurniture, 121, "ACCUMULATED DEPRECIATION - FURNITURE & FIXTURES"],
  [AC.accDepComputers, 121, "ACCUMULATED DEPRECIATION - COMPUTERS & IT"],
  [AC.depreciation, 521, "DEPRECIATION EXPENSE"],
  [AC.faGainLoss, 411, "GAIN / LOSS ON DISPOSAL OF FIXED ASSETS"],
  [AC.salaryPayable, 203, "SALARIES PAYABLE"],
  [AC.eobiPayable, 203, "EOBI PAYABLE"],
  [AC.accruedExpenses, 203, "ACCRUED EXPENSES"],
  [AC.otherDeductions, 203, "OTHER SALARY DEDUCTIONS"],
  [AC.outputTax, 204, "SALES TAX PAYABLE (OUTPUT)"],
  [AC.incomeTaxPayable, 204, "INCOME TAX DEDUCTED ON SALARIES"],
  [AC.whtPayable, 204, "WITHHOLDING TAX PAYABLE"],
  [AC.bankLoan, 221, "HBL - RUNNING FINANCE"],
  [AC.capital, 301, "SHARE CAPITAL"],
  [AC.retained, 301, "UNAPPROPRIATED PROFIT"],
  [AC.salesLocal, 401, "SALES - LOCAL"],
  [AC.salesPos, 401, "SALES - COUNTER (POS)"],
  [AC.salesReturn, 402, "SALES RETURNS"],
  [AC.scrapSales, 411, "SCRAP SALES"],
  [AC.otherIncome, 411, "MISCELLANEOUS INCOME"],
  [AC.purchases, 501, "PURCHASES - MATERIALS"],
  [AC.purchaseReturn, 501, "PURCHASE RETURNS"],
  [AC.freightIn, 501, "TRANSPORTATION INWARD"],
  [AC.cogs, 502, "COST OF GOODS SOLD"],
  [AC.conversionCost, 503, "CONVERSION COST APPLIED"],
  [AC.stockLost, 503, "STOCK LOST / CLEANING"],
  [AC.qcCost, 503, "QC & LAB SAMPLES"],
  [AC.factoryPower, 503, "FACTORY POWER & FUEL"],
  [AC.factoryRepairs, 503, "FACTORY REPAIRS & MAINTENANCE"],
  [AC.factoryWages, 503, "FACTORY WAGES"],
  [AC.rent, 521, "RENT, RATES & TAXES"],
  [AC.utilities, 521, "UTILITIES - HEAD OFFICE"],
  [AC.printing, 521, "PRINTING & STATIONERY"],
  [AC.telephone, 521, "TELEPHONE & INTERNET"],
  [AC.professional, 521, "LEGAL & PROFESSIONAL"],
  [AC.serviceExpense, 521, "SERVICES - GENERAL"],
  [AC.freightOut, 522, "TRANSPORTATION OUTWARD"],
  [AC.salesPromotion, 522, "SALES PROMOTION"],
  [AC.travelling, 522, "TRAVELLING & CONVEYANCE"],
  [AC.salaries, 523, "SALARIES & WAGES"],
  [AC.overtime, 523, "OVERTIME"],
  [AC.eobiExpense, 523, "EOBI - EMPLOYER CONTRIBUTION"],
  [AC.bankCharges, 531, "BANK CHARGES"],
  [AC.markup, 531, "MARKUP ON RUNNING FINANCE"],
];

// Parties (acno 2xxx customers, 3xxx vendors, 4xxx transporters — numbering only).
export const CUSTOMERS = [
  [2001, "SUNRISE PACKAGES (PVT) LTD", "KARACHI", "SOUTH", 30, 2500000],
  [2002, "CRESCENT FLEXIBLE PACKAGING", "LAHORE", "NORTH", 45, 4000000],
  [2003, "MEHRAN PRINTERS", "HYDERABAD", "SOUTH", 30, 1500000],
  [2004, "INDUS LABELS & TAGS", "KARACHI", "SOUTH", 15, 1000000],
  [2005, "GREENLEAF FOODS PACKAGING", "FAISALABAD", "NORTH", 60, 5000000],
  [2006, "AL-NOOR CORRUGATORS", "LAHORE", "NORTH", 30, 2000000],
  [2007, "PEARL PRINT HOUSE", "ISLAMABAD", "NORTH", 30, 1200000],
  [2008, "SAPPHIRE CARTONS", "KARACHI", "SOUTH", 45, 3000000],
  [2009, "VALLEY PAINT CENTRE", "PESHAWAR", "NORTH", 15, 800000],
  [2010, "HARBOUR HOME DECOR", "KARACHI", "SOUTH", 30, 1800000],
  [2011, "NORTHSTAR BUILDERS SUPPLY", "MULTAN", "NORTH", 30, 1500000],
  [2012, "CITY HARDWARE & PAINTS", "KARACHI", "SOUTH", 7, 500000],
];
export const VENDORS = [
  [3001, "GULF RESINS TRADING", "KARACHI"],
  [3002, "PRIME SOLVENTS LIMITED", "KARACHI"],
  [3003, "COLORTECH PIGMENTS", "LAHORE"],
  [3004, "ORBIT CHEMICAL SUPPLIES", "KARACHI"],
  [3005, "STARLINE DRUMS & CANS", "KARACHI"],
  [3006, "PACKWELL CARTONS", "LAHORE"],
  [3007, "EASTERN ADDITIVES CO.", "KARACHI"],
  [3008, "METRO ENGINEERING WORKS", "KARACHI"],
];
export const TRANSPORTERS = [
  [4001, "FAST TRACK GOODS TRANSPORT", "KARACHI"],
  [4002, "SHAHEEN CARGO SERVICES", "KARACHI"],
  [4003, "RAPID LOGISTICS", "LAHORE"],
];

// ── Stores, units, items ──────────────────────────────────────────────────
export const GODOWNS = [
  [1, "RAW MATERIAL STORE"], [2, "PRODUCTION FLOOR"], [3, "FINISHED GOODS STORE"],
  [4, "PACKING MATERIAL STORE"], [5, "LAHORE WAREHOUSE"], [6, "QC & REJECTION"],
];
const UNITS = ["KG", "LTR", "PCS", "DRUM", "TIN", "BAG", "CARTON", "MTR", "SET"];
const MAIN_CATEGORIES = [[1, "MATERIALS"], [2, "PRODUCTS"], [3, "FIXED ASSETS"], [4, "SERVICES & CONSUMABLES"]];
// [id, name, main, stock acno]
// The SMS code still treats category 1 as finished goods, 2 as semi finished
// and 4 as packing material (BOM form, process order stock check, packing
// pickers), so the demo keeps those ids. The product line / material type is
// the item's Series.
const CATEGORIES = [
  [1, "FINISHED GOODS", 2, AC.stockFg],
  [2, "SEMI FINISHED", 2, AC.stockFg],
  [3, "RAW MATERIAL", 1, AC.stockRm],
  [4, "PACKING MATERIAL", 1, AC.stockPm],
  [5, "CONSUMABLES & SPARES", 4, AC.stockRm],
  [6, "FIXED ASSET - MACHINERY", 3, AC.plant],
  [7, "FIXED ASSET - VEHICLES", 3, AC.vehicles],
  [8, "FIXED ASSET - FURNITURE", 3, AC.furniture],
  [9, "FIXED ASSET - COMPUTERS", 3, AC.computers],
];
// Fixed-asset categories: depreciation defaults + posting accounts
// (fa_category_defaults, Settings → Fixed assets). [ic_id, method, life months, rate %, salvage %, cost, acc. dep.]
export const FA_CATEGORY_DEFAULTS = [
  [6, "SL", 120, null, 5, AC.plant, AC.accDepPlant],
  [7, "RB", 60, 20, 10, AC.vehicles, AC.accDepVehicles],
  [8, "SL", 60, null, 0, AC.furniture, AC.accDepFurniture],
  [9, "SL", 36, null, 0, AC.computers, AC.accDepComputers],
];
// The item rows below use a finer group (G) → [category id, series].
const ITEM_GROUP = {
  1: [3, "RESINS"], 2: [3, "SOLVENTS"], 3: [3, "PIGMENTS"], 4: [3, "ADDITIVES"], 5: [4, "PACKING"],
  6: [1, "PRINTING INKS"], 7: [1, "INDUSTRIAL COATINGS"], 8: [1, "DECORATIVE PAINTS"], 9: [2, "BASES"], 11: [5, "CONSUMABLES"],
  12: [6, "MACHINERY"], 13: [7, "VEHICLES"], 14: [8, "FURNITURE"], 15: [9, "IT EQUIPMENT"],
};
export const categoryOf = (group) => ITEM_GROUP[group][0];
// [itcd, code, name, group G, unit, price(purchase rate or sale price), ltr_rate(density), re_order]
export const ITEMS = [
  // resins
  [101, "RM-R01", "ALKYD RESIN LONG OIL", 1, "KG", 610, null, 2000],
  [102, "RM-R02", "ACRYLIC EMULSION 50%", 1, "KG", 540, null, 2500],
  [103, "RM-R03", "POLYAMIDE RESIN", 1, "KG", 980, null, 800],
  [104, "RM-R04", "NITROCELLULOSE CHIPS", 1, "KG", 1250, null, 600],
  [105, "RM-R05", "EPOXY RESIN 828", 1, "KG", 1400, null, 500],
  // solvents
  [201, "RM-S01", "TOLUENE", 2, "KG", 310, null, 3000],
  [202, "RM-S02", "ETHYL ACETATE", 2, "KG", 360, null, 3000],
  [203, "RM-S03", "ISOPROPYL ALCOHOL", 2, "KG", 330, null, 2000],
  [204, "RM-S04", "MINERAL TURPENTINE", 2, "KG", 260, null, 2500],
  [205, "RM-S05", "XYLENE", 2, "KG", 320, null, 1500],
  // pigments
  [301, "RM-P01", "TITANIUM DIOXIDE RUTILE", 3, "KG", 1150, null, 1500],
  [302, "RM-P02", "CARBON BLACK", 3, "KG", 900, null, 400],
  [303, "RM-P03", "PHTHALO BLUE", 3, "KG", 2600, null, 200],
  [304, "RM-P04", "PIGMENT YELLOW 13", 3, "KG", 2900, null, 200],
  [305, "RM-P05", "PIGMENT RED 57:1", 3, "KG", 2700, null, 200],
  [306, "RM-P06", "CALCIUM CARBONATE", 3, "KG", 45, null, 5000],
  // additives
  [401, "RM-A01", "DISPERSING AGENT", 4, "KG", 1800, null, 150],
  [402, "RM-A02", "DEFOAMER", 4, "KG", 1600, null, 100],
  [403, "RM-A03", "COBALT DRIER 10%", 4, "KG", 2200, null, 80],
  [404, "RM-A04", "WAX DISPERSION", 4, "KG", 1350, null, 150],
  // packing
  [501, "PM-01", "MS DRUM 200 LTR", 5, "PCS", 5200, null, 100],
  [502, "PM-02", "TIN CAN 20 LTR", 5, "PCS", 780, null, 300],
  [503, "PM-03", "TIN CAN 4 LTR", 5, "PCS", 260, null, 600],
  [504, "PM-04", "PLASTIC PAIL 18 KG", 5, "PCS", 420, null, 400],
  [505, "PM-05", "CORRUGATED CARTON", 5, "PCS", 95, null, 1000],
  [506, "PM-06", "PRODUCT LABEL", 5, "PCS", 6, null, 5000],
  // finished goods — printing inks
  [601, "FG-INK-B", "FLEXO INK PROCESS BLUE", 6, "KG", 1650, 0.95, 300],
  [602, "FG-INK-K", "FLEXO INK BLACK", 6, "KG", 1350, 0.97, 300],
  [603, "FG-INK-Y", "GRAVURE INK YELLOW", 6, "KG", 1750, 0.93, 200],
  [604, "FG-INK-R", "GRAVURE INK RED", 6, "KG", 1720, 0.94, 200],
  [605, "FG-INK-W", "OPAQUE WHITE INK", 6, "KG", 1480, 1.1, 300],
  // industrial coatings
  [701, "FG-IC-01", "EPOXY PRIMER GREY", 7, "KG", 1950, 1.35, 150],
  [702, "FG-IC-02", "NC LACQUER CLEAR", 7, "KG", 1550, 0.92, 150],
  [703, "FG-IC-03", "ALKYD ENAMEL BLACK", 7, "KG", 1250, 1.05, 200],
  // decorative paints
  [801, "FG-DP-01", "EMULSION PAINT BRILLIANT WHITE", 8, "KG", 620, 1.4, 500],
  [802, "FG-DP-02", "WEATHER SHIELD EXTERIOR WHITE", 8, "KG", 880, 1.42, 400],
  [803, "FG-DP-03", "SYNTHETIC ENAMEL WHITE", 8, "KG", 1100, 1.2, 300],
  // semi finished
  [901, "SF-01", "WHITE BASE PASTE", 9, "KG", 0, null, 0],
  [902, "SF-02", "BLUE COLOUR CONCENTRATE", 9, "KG", 0, null, 0],
  // consumables
  [1101, "CS-01", "FILTER BAGS", 11, "PCS", 350, null, 100],
  [1102, "CS-02", "CLEANING SOLVENT", 11, "KG", 240, null, 200],
  // fixed assets (Fixed Assets GRN — one asset number per unit)
  [1201, "FA-MC-01", "HIGH SPEED DISPERSER 50 HP", 12, "PCS", 0, null, 0],
  [1202, "FA-MC-02", "BEAD MILL 25 LTR", 12, "PCS", 0, null, 0],
  [1211, "FA-VH-01", "PICKUP TRUCK 1 TON", 13, "PCS", 0, null, 0],
  [1221, "FA-FR-01", "OFFICE WORKSTATION", 14, "PCS", 0, null, 0],
  [1231, "FA-IT-01", "LAPTOP CORE I7", 15, "PCS", 0, null, 0],
  [1232, "FA-IT-02", "LASER PRINTER", 15, "PCS", 0, null, 0],
];
// BOM per finished item: [finished itcd, [[material itcd, % of batch]...]]
export const BOMS = [
  [601, [[103, 22], [202, 30], [203, 18], [303, 14], [401, 2], [404, 4], [306, 10]]],
  [602, [[103, 24], [202, 30], [203, 18], [302, 16], [401, 2], [404, 4], [306, 6]]],
  [603, [[104, 18], [201, 34], [202, 20], [304, 15], [401, 2], [306, 11]]],
  [604, [[104, 18], [201, 34], [202, 20], [305, 15], [401, 2], [306, 11]]],
  [605, [[103, 20], [202, 28], [203, 16], [301, 30], [401, 2], [404, 4]]],
  [701, [[105, 35], [205, 20], [301, 15], [306, 25], [401, 2], [402, 3]]],
  [702, [[104, 30], [202, 40], [201, 28], [402, 2]]],
  [703, [[101, 45], [204, 25], [302, 6], [306, 20], [403, 2], [402, 2]]],
  [801, [[102, 30], [301, 18], [306, 45], [401, 3], [402, 4]]],
  [802, [[102, 38], [301, 22], [306, 33], [401, 3], [402, 4]]],
  [803, [[101, 48], [204, 22], [301, 24], [403, 3], [402, 3]]],
];

// ── People ────────────────────────────────────────────────────────────────
const DEPARTMENTS = [
  [1, "MANAGEMENT"], [2, "ACCOUNTS & FINANCE"], [3, "SALES & MARKETING"], [4, "SUPPLY CHAIN"],
  [5, "STORES"], [6, "PRODUCTION"], [7, "QUALITY CONTROL"], [8, "HUMAN RESOURCES"], [9, "IT & ADMIN"],
];
const DESIGNATIONS = [
  [1, "CHIEF EXECUTIVE OFFICER"], [2, "CHIEF FINANCIAL OFFICER"], [3, "CHIEF OPERATING OFFICER"], [4, "DIRECTOR"],
  [5, "GENERAL MANAGER"], [6, "MANAGER"], [7, "ASSISTANT MANAGER"], [8, "OFFICER"], [9, "EXECUTIVE"],
  [10, "SUPERVISOR"], [11, "OPERATOR"], [12, "HELPER"], [13, "CASHIER"], [14, "STORE KEEPER"],
];
const WORK_LOCATIONS = [[1, "HEAD OFFICE"], [2, "FACTORY"], [3, "LAHORE OFFICE"]];
const COST_CENTERS = [[1, "ADMINISTRATION"], [2, "SALES"], [3, "PRODUCTION"], [4, "STORES & LOGISTICS"]];
const CITIES = ["KARACHI", "LAHORE", "ISLAMABAD", "FAISALABAD", "HYDERABAD", "MULTAN", "PESHAWAR", "QUETTA"];

// Role logins: [username, role, first, last, dept, designation, location, cost centre, basic salary]
// username = what the client types on the demo; password for all: demo123.
export const ROLE_USERS = [
  ["ceo", "CEO", "Kamran", "Siddiqui", 1, 1, 1, 1, 650000],
  ["cfo", "CFO", "Nadia", "Rahman", 2, 2, 1, 1, 480000],
  ["coo", "COO", "Faisal", "Qureshi", 1, 3, 2, 3, 460000],
  ["director", "DIRECTOR", "Saima", "Hassan", 1, 4, 1, 1, 420000],
  ["gm", "MANAGER", "Tariq", "Mehmood", 1, 5, 2, 1, 350000],
  ["sysadmin", "SYSTEM_ADMIN", "Usman", "Ghani", 9, 6, 1, 1, 180000],
  ["accounts.manager", "ACCOUNTS_MANAGER", "Bilal", "Ahmed", 2, 6, 1, 1, 260000],
  ["accountant", "ACCOUNTANT", "Hira", "Javed", 2, 8, 1, 1, 120000],
  ["accounts.officer", "ACCOUNTS_OFFICER", "Zain", "Abbas", 2, 9, 1, 1, 85000],
  ["cashier", "CASHIER", "Rizwan", "Akhtar", 2, 13, 1, 1, 70000],
  ["sales.manager", "SALES_MANAGER", "Omer", "Farooq", 3, 6, 1, 2, 280000],
  ["sales", "SALES", "Ayesha", "Malik", 3, 8, 1, 2, 110000],
  ["sales.north", "SALES", "Hamid", "Raza", 3, 8, 3, 2, 105000],
  ["purchase.manager", "PURCHASE_MANAGER", "Salman", "Yousuf", 4, 6, 1, 4, 240000],
  ["purchase", "PURCHASE_OFFICER", "Mariam", "Iqbal", 4, 8, 1, 4, 95000],
  ["store.manager", "STORE_MANAGER", "Asif", "Nawaz", 5, 6, 2, 4, 190000],
  ["storekeeper", "STORE_KEEPER", "Imran", "Shah", 5, 14, 2, 4, 75000],
  ["production.manager", "PRODUCTION_MANAGER", "Adnan", "Sheikh", 6, 6, 2, 3, 270000],
  ["production", "PRODUCTION_OFFICER", "Waqas", "Ali", 6, 8, 2, 3, 98000],
  ["hr.manager", "HR_MANAGER", "Sana", "Kazmi", 8, 6, 1, 1, 230000],
  ["hr", "HR_OFFICER", "Fatima", "Zaidi", 8, 8, 1, 1, 90000],
  ["employee", "EMPLOYEE", "Ali", "Hussain", 6, 11, 2, 3, 48000],
];
// Factory and office staff without a login (attendance / payroll volume).
const STAFF = [
  ["Noman", "Baig", 6, 10, 2, 3, 72000], ["Shahid", "Iqbal", 6, 11, 2, 3, 46000],
  ["Junaid", "Khan", 6, 11, 2, 3, 45000], ["Arif", "Hussain", 6, 12, 2, 3, 40000],
  ["Kashif", "Mirza", 6, 11, 2, 3, 47000], ["Sohail", "Ahmed", 7, 9, 2, 3, 82000],
  ["Rabia", "Anwar", 7, 8, 2, 3, 92000], ["Danish", "Latif", 5, 12, 2, 4, 40000],
  ["Yasir", "Saeed", 5, 9, 2, 4, 60000], ["Mehwish", "Tariq", 3, 9, 1, 2, 78000],
  ["Fahad", "Rauf", 3, 9, 3, 2, 76000], ["Amna", "Shafiq", 9, 9, 1, 1, 65000],
  ["Naveed", "Akram", 9, 12, 1, 1, 38000],
];

// Screens each staff role works on: top-level modules (menus.title) → every screen under them.
// Roles whose Sidebar setting is "all" (CEO, CFO, COO, Director, GM, Super Admin) see everything.
const ROLE_MODULES = {
  SYSTEM_ADMIN: ["MANAGEMENT"],
  ACCOUNTS_MANAGER: ["FINANCE", "ACCOUNTS DESK", "FIXED ASSETS", "MANAGEMENT"],
  ACCOUNTANT: ["FINANCE", "ACCOUNTS DESK"],
  ACCOUNTS_OFFICER: ["FINANCE", "ACCOUNTS DESK"],
  CASHIER: ["ACCOUNTS DESK"],
  SALES_MANAGER: ["SALES", "DESPATCH"],
  SALES: ["SALES", "DESPATCH"],
  PURCHASE_MANAGER: ["SUPPLY CHAIN", "IMPORT"],
  PURCHASE_OFFICER: ["SUPPLY CHAIN", "IMPORT"],
  STORE_MANAGER: ["STORES", "DESPATCH"],
  STORE_KEEPER: ["STORES", "DESPATCH"],
  PRODUCTION_MANAGER: ["PRODUCTION", "LAB", "QUALITY ASSURANCE"],
  PRODUCTION_OFFICER: ["PRODUCTION", "LAB", "QUALITY ASSURANCE"],
  HR_MANAGER: ["HR OPERATIONS"],
  HR_OFFICER: ["HR OPERATIONS"],
};

// ── helpers ───────────────────────────────────────────────────────────────
const step = (msg) => console.log(`• ${msg}`);
async function resetSequence(table, column) {
  await prisma.$executeRawUnsafe(
    `SELECT setval(pg_get_serial_sequence('"${table}"', '${column}'), COALESCE((SELECT MAX("${column}") FROM "${table}"), 0) + 1, false)`,
  );
}

async function main() {
  step("company");
  await prisma.company.create({ data: COMPANY });
  await resetSequence("Company", "id");
  await prisma.financialYear.create({
    data: { date_from: new Date("2026-07-01"), date_to: new Date("2027-06-30"), status: "OPEN", company_id: 1 },
  });
  await prisma.currency.createMany({ data: [{ currency: "PKR" }, { currency: "USD" }, { currency: "EUR" }], skipDuplicates: true });

  step("chart of accounts");
  await prisma.mBSCD.createMany({ data: MBSCD.map(([mbscd, mbscdDetail]) => ({ mbscd, mbscdDetail })) });
  await prisma.bSCD.createMany({ data: BSCD.map(([bscd, mbscd, bscdDetail]) => ({ bscd, mbscd, bscdDetail })) });
  await prisma.mACNO.createMany({ data: MACNO.map(([macno, bscd, macname]) => ({ macno, bscd, macname })) });
  await prisma.aCNO.createMany({ data: ACCOUNTS.map(([acno, macno, acname]) => ({ acno, macno, acname })) });
  await prisma.aCNO.createMany({
    data: CUSTOMERS.map(([acno, acname, city, region, crDays, crLimit], i) => ({
      acno, macno: 102, acname, city, area: region, salesArea: null, crDays, crLimit,
      address: `${12 + i * 7}, Main Boulevard`, phoneFax: `+92 3${String(10 + i).padStart(2, "0")} 555 0${100 + i}`,
      contactPerson: ["Mr. Ahmed", "Ms. Sara", "Mr. Bilal", "Mr. Kashif"][i % 4],
      ntnNo: `${4100000 + i * 137}-${i % 9}`, stRegNo: `32-77-8${String(700 + i)}-${10 + i}`, country: "PAKISTAN",
      customerStatus: "ACTIVE", category: region === "NORTH" ? "NORTH ZONE" : "SOUTH ZONE",
    })),
  });
  await prisma.aCNO.createMany({
    data: VENDORS.map(([acno, acname, city], i) => ({
      acno, macno: 201, acname, city, crDays: 30, country: "PAKISTAN",
      address: `Office ${3 + i}, Trade Centre`, phoneFax: `+92 21 3456 70${10 + i}`, ntnNo: `${5200000 + i * 211}-${i % 9}`,
    })),
  });
  await prisma.aCNO.createMany({
    data: TRANSPORTERS.map(([acno, acname, city]) => ({ acno, macno: 202, acname, city, country: "PAKISTAN" })),
  });
  for (const t of ["MBSCD:mbscd", "BSCD:bscd", "MACNO:macno", "acno:acno"]) {
    const [table, col] = t.split(":");
    await resetSequence(table, col);
  }

  step("account settings");
  const acct = (key, acno) => prisma.accountSetting.updateMany({ where: { key }, data: { acno, updated_by: "demo seed" } });
  const grp = (key, macnos) => prisma.accountSetting.updateMany({ where: { key }, data: { macnos, updated_by: "demo seed" } });
  // Rows exist from prisma/sql (2026-10-24 + HR accounting); fill the empty ones.
  const defs = {
    sales: AC.salesLocal, purchase: AC.purchases, sales_return: AC.salesReturn, purchase_return: AC.purchaseReturn,
    stock: AC.stockRm, sales_tax_output: AC.outputTax, sales_tax_input: AC.inputTax,
    freight_inward: AC.freightIn, freight_outward: AC.freightOut, service_expense: AC.serviceExpense,
    conversion_cost: AC.conversionCost, cogs: AC.cogs, stock_lost: AC.stockLost, qc_cost: AC.qcCost, pos_sales: AC.salesPos,
    payroll_salary_expense: AC.salaries, payroll_overtime_expense: AC.overtime, payroll_salary_payable: AC.salaryPayable,
    payroll_eobi_expense: AC.eobiExpense, payroll_eobi_payable: AC.eobiPayable, payroll_tax_payable: AC.incomeTaxPayable,
    payroll_staff_advances: AC.staffAdvances, payroll_staff_loans: AC.staffLoans, payroll_other_deductions: AC.otherDeductions,
    fa_depreciation_expense: AC.depreciation, fa_disposal_gain_loss: AC.faGainLoss,
  };
  const { ACCOUNT_SETTING_DEFS } = await import("../../lib/accounts/accountSettingDefs.js");
  for (const def of ACCOUNT_SETTING_DEFS) {
    await prisma.accountSetting.upsert({
      where: { key: def.key },
      update: {},
      create: { key: def.key, kind: def.kind, section: def.section, label: def.label, updated_by: "demo seed" },
    });
  }
  for (const [key, acno] of Object.entries(defs)) await acct(key, acno);
  await grp("customers", [102]);
  await grp("vendors", [201]);
  await grp("transporters", [202]);
  await grp("cash_bank", [101]);
  await grp("fixed_asset_vendors", [201]);
  await grp("conversion_overheads", [503]);
  await prisma.accountSetting.updateMany({ where: { key: "blocked_voucher_accounts" }, data: { acnos: [AC.salesLocal] } });

  step("cities, godowns, units, categories, items");
  await prisma.city.createMany({ data: CITIES.map((name) => ({ name })) });
  await prisma.godown.createMany({ data: GODOWNS.map(([id, godown]) => ({ id, godown, company_id: 1 })) });
  await resetSequence("Godown", "id");
  await prisma.unit.createMany({ data: UNITS.map((unit) => ({ unit })), skipDuplicates: true });
  await prisma.mainCategory.createMany({ data: MAIN_CATEGORIES.map(([id, mc_name]) => ({ id, mc_name })) });
  await resetSequence("MainCategory", "id");
  await prisma.itemCategory.createMany({
    data: CATEGORIES.map(([id, ic_name, mainCategoryId, stock_acno]) => ({
      id, ic_name, mainCategoryId, stock_acno,
      ...(mainCategoryId === 2 ? { sale_acno: AC.salesLocal, cogs_acno: AC.cogs, cogm_acno: AC.conversionCost } : {}),
    })),
  });
  await resetSequence("ItemCategory", "id");
  await prisma.item.createMany({
    data: ITEMS.map(([itcd, code, item, group, unit, price, ltr_rate, re_order]) => {
      const [ic_id, series] = ITEM_GROUP[group];
      return {
        itcd, code, item, ic_id, series, unit, price, ltr_rate, re_order,
        mc_id: CATEGORIES.find((c) => c[0] === ic_id)[2], sku: code,
        // finished goods are packed: the default pack shows on dispatch lines
        ...(ic_id === 1 ? { packing_material_code: group === 8 ? 504 : 502 } : {}),
      };
    }),
  });
  await resetSequence("Item", "itcd");
  await seedFixedAssetDefaults();

  step("BOMs");
  for (const [finished_id, mats] of BOMS) {
    const fg = ITEMS.find((i) => i[0] === finished_id);
    await prisma.bomMaster.create({
      data: {
        // instructions "A" = the active BOM (what dispatch BOM, RMC, costing and the BOM checks read)
        finished_id, unit: "KG", target_qty: 100, instructions: "A", remarks: `Standard batch formula for ${fg[2]}`,
        bomDetails: { create: mats.map(([material_id, material_percentage], i) => ({ material_id, material_percentage, sno: i + 1 })) },
      },
    });
  }

  step("recipes");
  // One active recipe per finished good (its BOM's materials + mixing steps), so
  // the demo works with Settings → Features → "process orders from recipe" too.
  const boms = await prisma.bomMaster.findMany({ include: { bomDetails: { orderBy: { sno: "asc" } } } });
  for (const bom of boms) {
    const steps = [
      { product_desc: "Charge solvent and resin into the mixer, stir 10 min at low speed" },
      ...bom.bomDetails.map((d) => ({ product_id: d.material_id, product_percentage: d.material_percentage, qty: d.material_percentage })),
      { product_desc: "Disperse 30 min at high speed, check fineness (< 10 µm) and viscosity before filling" },
    ];
    await prisma.rECEIPE_MASTER.create({
      data: {
        finished_id: bom.finished_id, bom_id: bom.id, status: "Active", dated: new Date("2026-05-15"), time_min: 90, finished_count: 1,
        receipeDetails: { create: steps.map((s, i) => ({ ...s, sno: i + 1 })) },
      },
    });
  }

  step("services");
  const sc = await prisma.serviceCategory.create({ data: { sc_name: "LOGISTICS", expense_acno: AC.freightOut } });
  const sc2 = await prisma.serviceCategory.create({ data: { sc_name: "FACTORY SERVICES", expense_acno: AC.factoryRepairs } });
  await prisma.service.createMany({
    data: [
      { service_name: "FREIGHT - OUTWARD", sc_id: sc.id, company_id: 1, expense_acno: AC.freightOut },
      { service_name: "FREIGHT - INWARD", sc_id: sc.id, company_id: 1, expense_acno: AC.freightIn },
      { service_name: "LOADING / UNLOADING", sc_id: sc.id, company_id: 1, expense_acno: AC.freightOut },
      { service_name: "MACHINE REPAIR", sc_id: sc2.id, company_id: 1, expense_acno: AC.factoryRepairs },
    ],
  });

  step("departments, designations, locations, cost centres");
  await prisma.department.createMany({ data: DEPARTMENTS.map(([id, dept_name]) => ({ id, dept_name, company_id: 1 })) });
  await prisma.designation.createMany({ data: DESIGNATIONS.map(([id, desg_name]) => ({ id, desg_name, company_id: 1 })) });
  await prisma.workLocation.createMany({ data: WORK_LOCATIONS.map(([id, location_name]) => ({ id, location_name, company_id: 1 })) });
  await prisma.costCenter.createMany({ data: COST_CENTERS.map(([ccno, ccname]) => ({ ccno, ccname, company_id: 1 })) });
  for (const t of ["Department:id", "Designation:id", "WorkLocation:id", "CostCenter:ccno"]) {
    const [table, col] = t.split(":");
    await resetSequence(table, col);
  }

  step("employees and logins");
  const password = await bcrypt.hash(DEMO_PASSWORD, 12);
  const menus = await prisma.menus.findMany({ select: { id: true, title: true, parent_id: true, url: true } });
  const childrenOf = new Map();
  for (const m of menus) {
    if (!childrenOf.has(m.parent_id)) childrenOf.set(m.parent_id, []);
    childrenOf.get(m.parent_id).push(m);
  }
  const subtree = (id) => [id, ...(childrenOf.get(id) || []).flatMap((c) => subtree(c.id))];
  const moduleId = (title) => menus.find((m) => m.parent_id == null && m.title === title)?.id;

  let empId = 1001;
  const people = [
    ...ROLE_USERS.map(([username, role, first, last, dept, desg, loc, cc, basic]) => ({ username, role, first, last, dept, desg, loc, cc, basic })),
    ...STAFF.map(([first, last, dept, desg, loc, cc, basic]) => ({ first, last, dept, desg, loc, cc, basic })),
  ];
  for (const [i, p] of people.entries()) {
    const id = empId++;
    const email = `${p.first}.${p.last}`.toLowerCase() + "@apex-demo.example";
    await prisma.employee.create({
      data: {
        id, firstName: p.first, surname: p.last, dob: new Date(1980 + (i % 18), i % 12, 1 + (i % 27)),
        gender: ["Ayesha", "Nadia", "Saima", "Hira", "Mariam", "Sana", "Fatima", "Rabia", "Mehwish", "Amna"].includes(p.first) ? "Female" : "Male",
        phoneNumber: `+92 300 55${String(10000 + i * 37).slice(-5)}`, emailAddress: email, status: "ACTIVE",
        cnicNumber: `42101-${String(1000000 + i * 7919).slice(-7)}-${i % 9}`,
        hireDate: new Date(2018 + (i % 7), (i * 3) % 12, 1), designationId: p.desg, departmentId: p.dept,
        workLocationId: p.loc, costCenterId: p.cc, company_id: 1, paymentMethod: i % 3 === 0 ? "CASH" : "DIRECT_DEPOSIT",
        payType: "SALARY", payFrequency: "MONTHLY", rate: p.basic, attendanceId: String(id),
        residentialAddress: `House ${20 + i}, Block ${String.fromCharCode(65 + (i % 8))}, Gulshan`, fatherName: "—",
      },
    }).catch(async (e) => {
      // payType / payFrequency enums differ between builds — retry without them
      if (!/payType|payFrequency|Invalid value/.test(e.message)) throw e;
      await prisma.employee.create({
        data: {
          id, firstName: p.first, surname: p.last, dob: new Date(1985, i % 12, 1 + (i % 27)), gender: "Male",
          phoneNumber: "+92 300 5550000", emailAddress: email, status: "ACTIVE", hireDate: new Date(2020, 0, 1),
          designationId: p.desg, departmentId: p.dept, workLocationId: p.loc, costCenterId: p.cc, company_id: 1,
          paymentMethod: "CASH", rate: p.basic, attendanceId: String(id),
        },
      });
    });
    if (!p.username) continue;
    await prisma.user.create({
      data: {
        id: `demo-${p.username}`, username: p.username, name: `${p.first} ${p.last}`, email,
        role: p.role, isActive: true, password, employeeId: id, departmentId: p.dept,
      },
    });
    const modules = ROLE_MODULES[p.role] || [];
    const menuIds = [...new Set(modules.flatMap((t) => (moduleId(t) ? subtree(moduleId(t)) : [])))];
    if (menuIds.length) {
      await prisma.employee_menu.createMany({ data: menuIds.map((menu_id) => ({ employee_id: id, menu_id })), skipDuplicates: true });
    }
  }
  // The Super Admin login is the owner's own demo account.
  await prisma.user.upsert({
    where: { username: "admin" },
    update: { role: "ADMIN", isActive: true, password },
    create: { id: "demo-admin", username: "admin", name: "Demo Admin", email: "admin@apex-demo.example", role: "ADMIN", isActive: true, password },
  });

  step("done");
}

// Settings → Fixed assets, per category (lib/fixedAssets). Re-runnable.
export async function seedFixedAssetDefaults(db = prisma) {
  for (const [ic_id, method, useful_life_months, rb_rate, salvage_pct, cost_acno, accdep_acno] of FA_CATEGORY_DEFAULTS) {
    const data = { method, useful_life_months, rb_rate, salvage_pct, cost_acno, accdep_acno, updated_by: "demo seed" };
    await db.faCategoryDefault.upsert({ where: { ic_id }, update: data, create: { ic_id, ...data } });
  }
}

// Run only when started directly (seed-documents.mjs imports the constants).
if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
    .catch((e) => {
      console.error(e);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
