// lib/accounts/importColumns.js
// ============================================================
// Chart of accounts — Excel import columns, shared by the Import dialog
// (components/accounts/chartOfAccountsComponent.jsx: template + header
// matching) and the import API (app/api/accounts/import/route.js: checks).
//
// Codes are never in the file: like the single create (POST
// /api/accounts/<level>), the database gives the next code on save.
// Lengths / types follow the MACNO and ACNO models in prisma/schema.prisma.
// ============================================================

const INT_MAX = 2147483647;

// key = the create route's body field. `upper` = typed in capitals on the
// Add / edit panel, so imported values are stored the same way.
export const IMPORT_LEVELS = {
  macno: {
    key: "macno",
    title: "Main accounts",
    parentKey: "bscd",
    parentTitle: "Business category",
    nameKey: "macname",
    sheet: "Main Accounts",
    file: "main_accounts_import_template.xlsx",
    columns: [
      { key: "bscd", header: "Business Category Code", type: "int", required: true, width: 22 },
      { key: "macname", header: "Main Account Name", type: "text", required: true, max: 100, width: 34 },
    ],
    example: { bscd: 1, macname: "Trade Debtors - North" },
  },
  acno: {
    key: "acno",
    title: "Sub-accounts",
    parentKey: "macno",
    parentTitle: "Main account",
    nameKey: "acname",
    sheet: "Accounts",
    file: "accounts_import_template.xlsx",
    columns: [
      { key: "macno", header: "Main Account Code", type: "int", required: true, width: 18 },
      { key: "acname", header: "Account Name", type: "text", required: true, max: 250, upper: true, width: 34 },
      { key: "contactPerson", header: "Contact Person", type: "text", max: 50, upper: true, width: 20 },
      { key: "phoneFax", header: "Phone / Fax", type: "text", max: 250, width: 16 },
      { key: "email", header: "Email", type: "email", max: 250, width: 24 },
      { key: "website", header: "Website", type: "website", max: 250, width: 20 },
      { key: "address", header: "Address", type: "text", max: 300, upper: true, width: 30 },
      { key: "city", header: "City", type: "text", max: 50, upper: true, width: 14 },
      { key: "area", header: "Area", type: "text", max: 50, upper: true, width: 14 },
      { key: "areaCode", header: "Area Code", type: "text", max: 10, width: 11 },
      { key: "country", header: "Country", type: "text", max: 25, upper: true, width: 13 },
      { key: "salesArea", header: "Sales Area", type: "text", max: 50, width: 13 },
      { key: "crDays", header: "Credit Days", type: "int", width: 12 },
      { key: "crDays2", header: "Credit Days 2", type: "int", width: 13 },
      { key: "crLimit", header: "Credit Limit", type: "int", width: 13 },
      { key: "stRate", header: "ST Rate %", type: "decimal", width: 11 },
      { key: "ntnNo", header: "NTN No", type: "text", max: 50, width: 14 },
      { key: "stRegNo", header: "ST Reg No", type: "text", max: 50, width: 14 },
      { key: "stReg", header: "ST Reg", type: "text", max: 50, width: 12 },
      { key: "tax_filing_status", header: "Tax Filing Status", type: "text", max: 25, width: 16 },
      { key: "tax_law_code", header: "Tax Law Code", type: "int", width: 13 },
      { key: "bankAccountNo", header: "Bank Account No", type: "text", max: 25, width: 18 },
      { key: "customerBank", header: "Customer Bank", type: "text", max: 250, upper: true, width: 18 },
      { key: "customerBankAddr", header: "Customer Bank Address", type: "text", max: 300, upper: true, width: 24 },
      { key: "category", header: "Category", type: "text", max: 50, upper: true, width: 14 },
      { key: "subCategory", header: "Sub Category", type: "text", max: 25, upper: true, width: 14 },
      { key: "lock", header: "Locked (Yes/No)", type: "bool", width: 15 },
    ],
    example: {
      macno: 35,
      acname: "ABC TRADERS",
      contactPerson: "ALI RAZA",
      phoneFax: "021-1234567",
      email: "accounts@abctraders.com",
      city: "KARACHI",
      country: "PAKISTAN",
      crDays: 30,
      crLimit: 500000,
      lock: "No",
    },
  },
};

// "Account Name", "account name *", "ACCOUNT_NAME" all match one column.
const squash = (s) => String(s ?? "").toLowerCase().replace(/[^a-z0-9]/g, "");

/** The file's header row → { columnIndex: fieldKey } for a level. */
export function matchHeaders(level, headerRow) {
  const cols = IMPORT_LEVELS[level].columns;
  const out = {};
  (headerRow || []).forEach((h, i) => {
    const s = squash(h);
    if (!s) return;
    const col = cols.find((c) => squash(c.header) === s || squash(c.key) === s);
    if (col && !Object.values(out).includes(col.key)) out[i] = col.key;
  });
  return out;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Same check as the Add / edit panel.
const WEBSITE = /^(https?:\/\/)?(www\.)?[-a-zA-Z0-9@:%._+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b([-a-zA-Z0-9()@:%_+.~#?&/=]*)$/;

/**
 * One raw row → { data, errors }. `data` is what the single create would
 * store (blank → null, numbers parsed, capitals where the panel uses them);
 * `errors` lists every field problem in the row. Parent existence and
 * duplicates are checked by the route, against the database.
 */
export function normalizeImportRow(level, raw) {
  const errors = [];
  const data = {};
  for (const col of IMPORT_LEVELS[level].columns) {
    const v = raw?.[col.key];
    const text = v === null || v === undefined ? "" : String(v).trim();
    if (!text) {
      if (col.required) errors.push(`${col.header} is required`);
      data[col.key] = col.type === "bool" ? false : null;
      continue;
    }
    if (col.type === "int") {
      const n = Number(text.replace(/,/g, ""));
      if (!Number.isInteger(n) || n < 0 || n > INT_MAX) errors.push(`${col.header} must be a whole number`);
      else data[col.key] = n;
    } else if (col.type === "decimal") {
      const n = Number(text.replace(/[,%]/g, ""));
      // Decimal(15, 2)
      if (!Number.isFinite(n) || Math.abs(n) >= 1e13) errors.push(`${col.header} must be a number`);
      else data[col.key] = Math.round(n * 100) / 100;
    } else if (col.type === "bool") {
      const s = text.toLowerCase();
      if (["yes", "y", "true", "1"].includes(s)) data[col.key] = true;
      else if (["no", "n", "false", "0"].includes(s)) data[col.key] = false;
      else errors.push(`${col.header} must be Yes or No`);
    } else {
      const s = col.upper ? text.toUpperCase() : text;
      if (col.max && s.length > col.max) errors.push(`${col.header} is longer than ${col.max} characters`);
      else if (col.type === "email" && !EMAIL.test(s)) errors.push(`${col.header} is not a full email address`);
      else if (col.type === "website" && !WEBSITE.test(s)) errors.push(`${col.header} should look like www.company.com`);
      else data[col.key] = s;
    }
  }
  return { data, errors };
}

/** Name key used for duplicate checks: same parent + same name (any case). */
export const dupKey = (parent, name) => `${parent}|${String(name ?? "").trim().toUpperCase()}`;
