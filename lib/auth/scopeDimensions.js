// lib/auth/scopeDimensions.js
// ============================================================
// DATA-SCOPE DIMENSIONS — the one registry of "what can be limited".
//
// Admin → Permissions shows one card per entry here, for a Department or a
// Person, and every enforcement point reads the same entry:
//
//   options    — the list the admin ticks from (declarative Prisma lookup)
//   setup      — the /api/setup/<entity> dropdown narrowed to the scope, so
//                every form and report filter offers only permitted values
//   documents  — document lists (TRANSACTIONS_MASTER) narrowed, and saving /
//                editing / deleting outside the scope refused. A document is
//                in scope when ANY of `fields` holds a permitted value (a
//                transfer from FACTORY to FG-DESPATCH is visible to Despatch)
//   pickers    — account pickers of that Account Settings group
//                (/api/accounts/acno?group=…) offer only permitted accounts
//   reports    — report filters narrowed. strictReports: a report with no
//                such filter is refused (customer); otherwise it runs as is
//                (a godown limit says nothing about a finance report).
//                reportTypes: apply to these reports only.
//
// Once a dimension is listed here, limiting it is clicks only. Adding a new
// kind of limit (item category, cost centre, …) is one entry below.
//
// Pure data — no imports — so the admin page and the server share it.
// ============================================================

export const SCOPE_DIMENSIONS = [
  {
    key: "customer",
    label: "Customers",
    icon: "UserCog",
    ownable: true, // "Theirs" = accounts whose sales person is this user
    options: {
      model: "aCNO",
      accountGroup: "customers", // macnos from Finance → Account Settings (resolved by the API)
      value: "acno",
      label: ["acno", "acname"],
      orderBy: { acname: "asc" },
    },
    reports: { filters: ["customer", "account", "acno", "party", "party_code", "pycd"], strict: true },
  },
  {
    key: "region",
    label: "Regions",
    icon: "MapPin",
    ownable: true, // regions of the customers assigned to them
    options: {
      model: "orderMaster",
      where: { region: { not: null } },
      value: "region",
      label: ["region"],
      distinct: ["region"],
    },
    reports: { filters: ["region", "city"], strict: true },
  },
  {
    key: "godown",
    label: "Godowns",
    icon: "Warehouse",
    ownable: false, // a godown has no owner
    valueType: "int",
    options: {
      model: "godown",
      value: "id",
      label: ["id", "godown"],
      orderBy: { id: "asc" },
    },
    setup: { entity: "godowns", field: "id" },
    documents: {
      fields: ["godown", "godown2"],
      // A godown set on an individual line must be permitted too.
      lineFields: ["godown"],
      // Stock documents only. Orders are not limited: a Sale Order is
      // planned against FACTORY, and Despatch must still be able to pick it.
      tranCodes: [4, 5, 6, 7, 8, 9, 10, 11, 12],
    },
    reports: { filters: ["godown", "transferFrom", "transferTo"], strict: false },
  },
  {
    key: "cashBank",
    label: "Cash & Bank Accounts",
    icon: "Landmark",
    ownable: false,
    valueType: "int",
    options: {
      model: "aCNO",
      accountGroup: "cash_bank", // macnos from Finance → Account Settings
      value: "acno",
      label: ["acno", "acname"],
      orderBy: { acname: "asc" },
    },
    // Payment / Receipt: the cash or bank account is the party (pycd) — the
    // list, save and edit stay within the assigned accounts.
    documents: { fields: ["pycd"], tranCodes: [1, 2] },
    // The "Paid From" / "Received In" pickers (/api/accounts/acno?group=cash_bank)
    // offer only these accounts.
    pickers: { group: "cash_bank", field: "acno" },
    // Only the cash & bank book: "account" is also the party filter of the
    // account ledger and other reports, which this limit says nothing about.
    reports: { filters: ["account"], strict: false, reportTypes: ["cbBook"] },
  },
  {
    // Purchase documents of these vendors only (e.g. a buyer who invoices
    // only his own suppliers on Purchase Invoicing). Party = pycd.
    key: "vendor",
    label: "Vendors",
    icon: "Truck",
    ownable: false,
    valueType: "int",
    options: {
      model: "aCNO",
      accountGroup: "vendors", // macnos from Finance → Account Settings
      value: "acno",
      label: ["acno", "acname"],
      orderBy: { acname: "asc" },
    },
    // GRN / Purchase Invoice (4) and Purchase Return (9).
    documents: { fields: ["pycd"], tranCodes: [4, 9] },
    // Purchase-side reports narrow their Vendor filter; any other report
    // (a ledger, a stock report…) runs as is.
    reports: { filters: ["vendor"], strict: false },
    // Vendor pickers (/api/accounts/acno?group=vendors) offer only these.
    pickers: { group: "vendors", field: "acno" },
  },
  {
    // The same, by main account: every vendor under these main accounts
    // (also accounts opened under them later). Party = pycd → ACNO.macno.
    key: "vendorGroup",
    label: "Vendor groups (main accounts)",
    icon: "Layers",
    ownable: false,
    valueType: "int",
    options: {
      model: "mACNO",
      accountGroup: "vendors", // only the main accounts of the Vendors group
      value: "macno",
      label: ["macno", "macname"],
      orderBy: { macname: "asc" },
    },
    documents: { fields: ["pycd"], via: { relation: "acno", field: "macno" }, noun: "vendor's main account", tranCodes: [4, 9] },
    // Limits documents only; reports are not narrowed by main account.
    reports: { filters: [], strict: false },
    pickers: { group: "vendors", field: "macno" },
  },
  {
    // Item master: a person limited to these categories may add / edit /
    // delete only items of them (Material Management, /api/forms/items). The
    // item list and every item picker still show all items.
    key: "itemCategory",
    label: "Item categories",
    icon: "Boxes",
    ownable: false,
    valueType: "int",
    options: {
      model: "itemCategory",
      value: "id",
      label: ["id", "ic_name"],
      orderBy: { id: "asc" },
    },
    // Says nothing about reports.
    reports: { filters: [], strict: false },
  },
  {
    // HR screens (attendance, and later leave / payroll) show only employees
    // of these departments. lib/hr/access.js reads it.
    key: "department",
    label: "Departments (HR)",
    icon: "Building",
    ownable: false,
    valueType: "int",
    options: {
      model: "department",
      value: "id",
      label: ["id", "dept_name"],
      orderBy: { dept_name: "asc" },
    },
    // Says nothing about money or stock reports.
    reports: { filters: ["department"], strict: false },
  },
  {
    // HR screens show only employees working at these locations (e.g. a plant
    // time-keeper: FACTORY; an office admin: HEAD OFFICE). lib/hr/access.js.
    key: "workLocation",
    label: "Work locations (HR)",
    icon: "Factory",
    ownable: false,
    valueType: "int",
    options: {
      model: "workLocation",
      value: "id",
      label: ["id", "location_name"],
      orderBy: { location_name: "asc" },
    },
    reports: { filters: ["location"], strict: false },
  },
  {
    // HR screens show only these employees. "Theirs" = the people who report
    // to this user's employee, directly or further down (Employee.managerId →
    // Manager.employeeId; HR → Team structure). lib/hr/team.js.
    key: "hrTeam",
    label: "Employees (HR)",
    icon: "Users",
    ownable: true,
    valueType: "int",
    options: {
      model: "employee",
      where: { status: "ACTIVE" },
      value: "id",
      label: ["id", "firstName", "surname"],
      orderBy: { firstName: "asc" },
    },
    reports: { filters: ["employee"], strict: false },
  },
];

export const DIMENSION_KEYS = SCOPE_DIMENSIONS.map((d) => d.key);

export const dimensionByKey = (key) => SCOPE_DIMENSIONS.find((d) => d.key === key);

/** Stored values are strings; convert for a Prisma `in` on the real column. */
export const typedValues = (dim, values) =>
  dim?.valueType === "int"
    ? values.map(Number).filter((n) => Number.isFinite(n))
    : values.map(String);
