// lib/approvals/conditions.js — does a document match an approval rule?
//
// Pure functions, no imports: the voucher save route uses them to decide
// whether to hold a document, and the rule builder uses the same field list.
//
// A condition is { field, op, value }:
//   field  "m:<name>"  a header field of the form (VOUCHER_CONFIG masterFields)
//          "l:<name>"  a line field — true when ANY line matches
//          "@lines" | "@totalQty" | "@totalAmount"   computed from the lines
//          "@customerStatus"  the party's customer status (Bad Debt, Bad Payment …),
//                             looked up by the server into body.__ctx
//   op     empty | notEmpty | eq | neq | contains | in | gt | gte | lt | lte
//   value  text / number; for "in", values separated by commas
// A select field ({ value, label }) matches on either its value or its label,
// so "Reason is STORES-CONSUMED" and "Reason is 8 - STORES-CONSUMED" both work.

export const CONDITION_OPS = [
  { key: "empty", label: "is empty", needsValue: false },
  { key: "notEmpty", label: "is filled", needsValue: false },
  { key: "eq", label: "is", needsValue: true },
  { key: "neq", label: "is not", needsValue: true },
  { key: "contains", label: "contains", needsValue: true },
  { key: "in", label: "is one of (a, b, c)", needsValue: true },
  { key: "gt", label: "more than", needsValue: true },
  { key: "gte", label: "at least", needsValue: true },
  { key: "lt", label: "less than", needsValue: true },
  { key: "lte", label: "at most", needsValue: true },
];

export const COMPUTED_FIELDS = [
  { key: "@lines", label: "Number of lines", type: "number" },
  { key: "@totalQty", label: "Total quantity (all lines)", type: "number" },
  { key: "@totalAmount", label: "Total amount (all lines)", type: "number" },
  { key: "@customerStatus", label: "Customer status (from the customer)", type: "text" },
];

/** The fields a rule on this form can test, from its VOUCHER_CONFIG entry. */
export function ruleFieldsFor(config) {
  if (!config) return [];
  const pick = (f) => f && f.name && !f.hidden && f.type !== "button";
  return [
    ...(config.masterFields || []).filter(pick).map((f) => ({ key: `m:${f.name}`, label: f.label || f.name, type: f.type, group: "Header" })),
    ...(config.lineFields || []).filter(pick).map((f) => ({ key: `l:${f.name}`, label: `Any line: ${f.label || f.name}`, type: f.type, group: "Lines" })),
    ...COMPUTED_FIELDS.map((f) => ({ ...f, group: "Totals" })),
  ];
}

const isBlank = (v) => v === null || v === undefined || (typeof v === "string" && v.trim() === "") || (Array.isArray(v) && v.length === 0);

/** The texts a raw form value can be matched by: { value, label } → both. */
function texts(v) {
  if (isBlank(v)) return [];
  // several values (e.g. an older order with two order-type flags on): any may match
  if (Array.isArray(v)) return v.flatMap(texts);
  if (typeof v === "object" && !Array.isArray(v)) {
    return [v.value, v.label].filter((x) => !isBlank(x)).map((x) => String(x).trim().toLowerCase());
  }
  return [String(v).trim().toLowerCase()];
}
const numberOf = (v) => {
  const raw = typeof v === "object" && v !== null ? v.value : v;
  const n = Number(raw);
  return Number.isFinite(n) ? n : null;
};

function test(v, op, value) {
  const t = texts(v);
  if (op === "empty") return t.length === 0 || t.every((x) => x === "" || x === "0" || x === "null");
  if (op === "notEmpty") return !(t.length === 0 || t.every((x) => x === "" || x === "0" || x === "null"));
  const want = String(value ?? "").trim().toLowerCase();
  if (op === "eq") return t.includes(want);
  if (op === "neq") return !t.includes(want);
  if (op === "contains") return t.some((x) => x.includes(want));
  if (op === "in") {
    const list = want.split(",").map((x) => x.trim()).filter(Boolean);
    return t.some((x) => list.includes(x));
  }
  const n = numberOf(v);
  const w = Number(value);
  if (n === null || !Number.isFinite(w)) return false;
  return op === "gt" ? n > w : op === "gte" ? n >= w : op === "lt" ? n < w : op === "lte" ? n <= w : false;
}

const lineHasData = (l) => l && Object.values(l).some((v) => !isBlank(v));

function computed(key, lines, body) {
  if (key === "@customerStatus") return body?.__ctx?.customerStatus ?? "";
  const real = lines.filter(lineHasData);
  if (key === "@lines") return real.length;
  if (key === "@totalQty") return real.reduce((s, l) => s + (numberOf(l.qty) || 0), 0);
  if (key === "@totalAmount") {
    return real.reduce((s, l) => s + (numberOf(l.amount) || numberOf(l.damt) || numberOf(l.camt) || (numberOf(l.qty) || 0) * (numberOf(l.rate) || 0)), 0);
  }
  return null;
}

/** One condition against a save body { master, lines }. */
export function conditionMatches(cond, body) {
  const master = body?.master || {};
  const lines = Array.isArray(body?.lines) ? body.lines : [];
  const f = String(cond?.field || "");
  if (f.startsWith("@")) return test(computed(f, lines, body), cond.op, cond.value);
  if (f.startsWith("l:")) {
    const name = f.slice(2);
    const real = lines.filter(lineHasData);
    return real.some((l) => test(l[name], cond.op, cond.value));
  }
  if (f.startsWith("m:")) return test(master[f.slice(2)], cond.op, cond.value);
  return false;
}

/** A rule { match: all|any, conditions[] } against a save body. No conditions = always. */
export function ruleMatches(rule, body) {
  const conds = Array.isArray(rule?.conditions) ? rule.conditions.filter((c) => c && c.field && c.op) : [];
  if (conds.length === 0) return true;
  return rule.match === "any" ? conds.some((c) => conditionMatches(c, body)) : conds.every((c) => conditionMatches(c, body));
}

/** A readable sentence for a rule's conditions. */
export function describeConditions(rule, fields = []) {
  const conds = Array.isArray(rule?.conditions) ? rule.conditions : [];
  if (!conds.length) return "every document";
  const label = (k) => fields.find((f) => f.key === k)?.label ?? k.replace(/^[ml]:/, "");
  const opLabel = (o) => CONDITION_OPS.find((x) => x.key === o)?.label ?? o;
  return conds
    .map((c) => `${label(c.field)} ${opLabel(c.op)}${CONDITION_OPS.find((x) => x.key === c.op)?.needsValue ? ` ${c.value}` : ""}`)
    .join(rule.match === "any" ? " OR " : " AND ");
}
