// lib/hr/payroll/bankFile.js — salary transfer files laid out per bank.
// Pure and client-safe: the server validates formats with it (Settings key
// "hr.bank_file_formats", lib/hr/settingsData.js) and the screen builds the
// file from the rows the API sends (/api/hr/payroll/[id]/bank-files).
//
// A format is data, edited on HR → Payroll → Bank files:
//   { id, name, bank_ids: [Bank.id…] (empty = any bank without its own),
//     file: "csv" | "xlsx", delimiter, header: true|false,
//     date_format: "DD/MM/YYYY" | "YYYY-MM-DD" | "DDMMYYYY" | "MM/DD/YYYY" | "DD-MMM-YYYY",
//     amount_format: "0.00" | "0" | "#,##0.00" | "paisa" (amount × 100, no point),
//     columns: [{ field, header, value? }] }   field "fixed" writes `value`.

export const BANK_FILE_FIELDS = [
  { value: "account", label: "Account number" },
  { value: "iban", label: "Account number without spaces / dashes" },
  { value: "title", label: "Account title" },
  { value: "amount", label: "Amount" },
  { value: "emp_id", label: "Employee no." },
  { value: "name", label: "Employee name" },
  { value: "cnic", label: "CNIC" },
  { value: "bank", label: "Bank name" },
  { value: "branch", label: "Branch name" },
  { value: "branch_code", label: "Branch code" },
  { value: "department", label: "Department" },
  { value: "date", label: "Value date" },
  { value: "month", label: "Salary month (e.g. Nov 2026)" },
  { value: "reference", label: "Reference (payroll no. + employee)" },
  { value: "narration", label: "Narration (Salary <month>)" },
  { value: "debit_account", label: "Company debit account (entered on download)" },
  { value: "serial", label: "Serial no." },
  { value: "fixed", label: "Fixed text" },
];
const FIELD_SET = new Set(BANK_FILE_FIELDS.map((f) => f.value));

export const DATE_FORMATS = ["DD/MM/YYYY", "YYYY-MM-DD", "DDMMYYYY", "MM/DD/YYYY", "DD-MMM-YYYY"];
export const AMOUNT_FORMATS = [
  { value: "0.00", label: "1234.50" },
  { value: "0", label: "1235 (rounded)" },
  { value: "#,##0.00", label: "1,234.50" },
  { value: "paisa", label: "123450 (in paisa)" },
];

export const DEFAULT_BANK_FORMATS = {
  default: "standard",
  formats: [
    {
      id: "standard",
      name: "Standard (CSV)",
      bank_ids: [],
      file: "csv",
      delimiter: ",",
      header: true,
      date_format: "DD/MM/YYYY",
      amount_format: "0.00",
      columns: [
        { field: "account", header: "Account Number" },
        { field: "title", header: "Account Title" },
        { field: "amount", header: "Amount" },
        { field: "emp_id", header: "Employee No" },
        { field: "cnic", header: "CNIC" },
        { field: "reference", header: "Reference" },
      ],
    },
  ],
};

const bad = (message) => Object.assign(new Error(message), { status: 400 });

/** Formats from the screen → clean, or a 400 naming what is wrong. */
export function cleanBankFormats(input) {
  const list = Array.isArray(input?.formats) ? input.formats : null;
  if (!list || !list.length) throw bad("Keep at least one bank file layout.");
  if (list.length > 30) throw bad("At most 30 layouts.");
  const ids = new Set();
  const banks = new Map();
  const formats = list.map((f, i) => {
    const name = String(f?.name ?? "").trim().slice(0, 60);
    if (!name) throw bad(`Layout ${i + 1}: give it a name.`);
    const id = String(f?.id ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 30) || `f${i + 1}`;
    if (ids.has(id)) throw bad(`${name}: two layouts have the id "${id}".`);
    ids.add(id);
    const bank_ids = [...new Set((Array.isArray(f.bank_ids) ? f.bank_ids : []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
    for (const b of bank_ids) {
      if (banks.has(b)) throw bad(`A bank is in two layouts ("${banks.get(b)}" and "${name}") — keep it in one.`);
      banks.set(b, name);
    }
    const columns = (Array.isArray(f.columns) ? f.columns : []).map((c, j) => {
      const field = String(c?.field ?? "");
      if (!FIELD_SET.has(field)) throw bad(`${name}, column ${j + 1}: choose what it holds.`);
      return { field, header: String(c?.header ?? "").slice(0, 60), ...(field === "fixed" ? { value: String(c?.value ?? "").slice(0, 100) } : {}) };
    });
    if (!columns.length) throw bad(`${name}: add at least one column.`);
    if (columns.length > 40) throw bad(`${name}: at most 40 columns.`);
    if (!columns.some((c) => c.field === "amount")) throw bad(`${name}: one column must be the amount.`);
    const delimiter = [",", ";", "|", "\t"].includes(f.delimiter) ? f.delimiter : ",";
    return {
      id,
      name,
      bank_ids,
      file: f.file === "xlsx" ? "xlsx" : "csv",
      delimiter,
      header: f.header !== false,
      date_format: DATE_FORMATS.includes(f.date_format) ? f.date_format : DATE_FORMATS[0],
      amount_format: AMOUNT_FORMATS.some((a) => a.value === f.amount_format) ? f.amount_format : "0.00",
      columns,
    };
  });
  const def = ids.has(input.default) ? input.default : formats[0].id;
  return { default: def, formats };
}

/** The layout a bank uses: its own, else the default one. */
export function formatForBank(formats, bankId) {
  const list = formats?.formats ?? [];
  return list.find((f) => f.bank_ids?.includes(Number(bankId))) ?? list.find((f) => f.id === formats?.default) ?? list[0] ?? DEFAULT_BANK_FORMATS.formats[0];
}

const MONTHS = ["JAN", "FEB", "MAR", "APR", "MAY", "JUN", "JUL", "AUG", "SEP", "OCT", "NOV", "DEC"];

/** "2026-11-30" in a bank's date layout. */
export function formatDate(dayKey, layout) {
  const [y, m, d] = String(dayKey ?? "").split("-");
  if (!y || !m || !d) return "";
  switch (layout) {
    case "YYYY-MM-DD": return `${y}-${m}-${d}`;
    case "DDMMYYYY": return `${d}${m}${y}`;
    case "MM/DD/YYYY": return `${m}/${d}/${y}`;
    case "DD-MMM-YYYY": return `${d}-${MONTHS[Number(m) - 1]}-${y}`;
    default: return `${d}/${m}/${y}`;
  }
}

/** An amount in a bank's number layout. */
export function formatAmount(n, layout) {
  const v = Math.round((Number(n) || 0) * 100) / 100;
  switch (layout) {
    case "0": return String(Math.round(v));
    case "#,##0.00": return v.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    case "paisa": return String(Math.round(v * 100));
    default: return v.toFixed(2);
  }
}

/**
 * The file of one bank: header row (when the layout has one) + a row per
 * employee, every value already a string in the layout's formats.
 * rows: [{ emp_id, name, account, title, cnic, bank, branch, branch_code, department, amount }]
 * ctx:  { date, month, monthLabel, runId, debitAccount }
 */
export function buildBankFile(format, rows, ctx) {
  const header = format.header ? format.columns.map((c) => c.header) : null;
  const lines = rows.map((r, i) => format.columns.map((c) => {
    switch (c.field) {
      case "amount": return formatAmount(r.amount, format.amount_format);
      case "date": return formatDate(ctx.date, format.date_format);
      case "month": return ctx.monthLabel ?? ctx.month ?? "";
      case "reference": return `P${ctx.runId}-${r.emp_id}`;
      case "narration": return `Salary ${ctx.monthLabel ?? ctx.month ?? ""}`.trim();
      case "debit_account": return ctx.debitAccount ?? "";
      case "serial": return String(i + 1);
      case "fixed": return c.value ?? "";
      case "iban": return String(r.account ?? "").replace(/[\s-]/g, "");
      default: return r[c.field] == null ? "" : String(r[c.field]);
    }
  }));
  return { header, lines };
}

/** CSV text of a built file (values with the delimiter, quotes or new lines are quoted). */
export function toCsv(file, delimiter = ",") {
  const q = (v) => {
    const s = String(v ?? "");
    return s.includes(delimiter) || /["\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  return [...(file.header ? [file.header] : []), ...file.lines].map((row) => row.map(q).join(delimiter)).join("\r\n");
}
