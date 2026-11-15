// components/Settings/alertShared.js — client-side constants and wording for
// the notification-alert builder (Admin → Notifications → Alerts).
//
// ALERT_OPS is a COPY of the list in lib/notifications/alerts.js (that file
// runs on the server and is not guaranteed client-safe). Keep the two in step:
// a new operator there needs its row here.

export const ALERT_OPS = {
  changed: { label: "changed", needsValue: false },
  changed_to: { label: "changed to", needsValue: true },
  changed_from: { label: "changed from", needsValue: true },
  eq: { label: "is", needsValue: true },
  neq: { label: "is not", needsValue: true },
  gt: { label: "is more than", needsValue: true },
  gte: { label: "is at least", needsValue: true },
  lt: { label: "is less than", needsValue: true },
  lte: { label: "is at most", needsValue: true },
  contains: { label: "contains", needsValue: true },
  in: { label: "is one of", needsValue: true },
  empty: { label: "is empty", needsValue: false },
  not_empty: { label: "is not empty", needsValue: false },
};

const NUMERIC = new Set(["Int", "BigInt", "Float", "Decimal"]);
export const fieldKind = (type) =>
  NUMERIC.has(type) ? "number" : type === "Boolean" ? "boolean" : type === "DateTime" ? "date" : type === "Json" ? "json" : "text";

// Which comparisons make sense for a field. Dates compare as text
// (YYYY-MM-DD), so "contains 2026-11" means "in November 2026".
const OPS_BY_KIND = {
  number: ["changed", "changed_to", "changed_from", "eq", "neq", "gt", "gte", "lt", "lte", "in", "empty", "not_empty"],
  text: ["changed", "changed_to", "changed_from", "eq", "neq", "contains", "in", "empty", "not_empty"],
  boolean: ["changed", "changed_to", "eq", "neq"],
  date: ["changed", "eq", "neq", "contains", "empty", "not_empty"],
  json: ["changed", "empty", "not_empty"],
};
export const opsFor = (type) => OPS_BY_KIND[fieldKind(type)] || OPS_BY_KIND.text;

export const ACTIONS = [
  { key: "create", label: "Created", word: "created" },
  { key: "update", label: "Changed", word: "changed" },
  { key: "delete", label: "Deleted", word: "deleted" },
];

// Role names come from the catalogue (Admin → Roles) — lib/auth/roleNames.js.
import { roleLabel } from "@/lib/auth/roleNames";

export { roleLabel };

export const TEMPLATE_LIMITS = { title: 200, message: 500 }; // lib/notifications/template.js

// Field names people recognise; anything else is humanised.
const FIELD_LABELS = {
  tran_code: "Voucher type",
  tran_id: "Voucher id",
  tr_amount: "Amount",
  vr_no: "Voucher no.",
  dated: "Date",
  user_id: "User",
  created_by: "Created by",
  requested_by: "Requested by",
  decided_by: "Decided by",
  employee_id: "Employee",
  acno: "Account",
  pycd: "Cash / bank account",
  godown: "Godown",
  godown2: "To godown",
  rmk: "Remarks",
};
export function fieldLabel(name) {
  if (FIELD_LABELS[name]) return FIELD_LABELS[name];
  const s = String(name)
    .replace(/_/g, " ")
    .replace(/([a-z0-9])([A-Z])/g, "$1 $2")
    .replace(/\bid\b/i, "id")
    .trim()
    .toLowerCase();
  return s.charAt(0).toUpperCase() + s.slice(1);
}

// Value hints for well-known fields (CLAUDE.md tran_code table).
export const VALUE_HINTS = {
  tran_code: [
    ["1", "Receipt"],
    ["2", "Payment"],
    ["3", "Journal voucher"],
    ["4", "Purchase invoice"],
    ["5", "POS"],
    ["6", "Sale invoice"],
    ["7", "Material issue"],
    ["8", "Production"],
    ["9", "Purchase return"],
    ["10", "Sale return"],
    ["11", "Stock transfer"],
    ["12", "Miscellaneous in"],
  ],
};

/** Fields that probably hold a login (User.id) / an Employee.id — offered first. */
export const looksLikeUserField = (f) => f.type === "String" && /(^|_)(user_id|userid|created_by|requested_by|decided_by|approved_by|approver|owner|by)$|By$|UserId$/i.test(f.name);
export const looksLikeEmployeeField = (f) => NUMERIC.has(f.type) && /(^|_)employee_?id$|^employeeId$|managerId$/i.test(f.name);

export const COMMON_VARS = [
  { name: "actor", description: "Who made the change" },
  { name: "table", description: "What changed (e.g. Vouchers)" },
  { name: "action", description: "created / changed / deleted" },
  { name: "record", description: "Record id" },
  { name: "changes", description: "List of changed fields" },
];

/** Sample values for the live preview. */
export function sampleVars(model, alert) {
  const vars = {
    actor: "Ali Raza",
    table: model?.label || "Record",
    action: ACTIONS.find((a) => a.key === alert.actions?.[0])?.word || "changed",
    record: "143086",
    changes: "status: active → inactive",
  };
  for (const f of model?.fields || []) {
    const fromCond = alert.conditions?.find((c) => c.field === f.name && ALERT_OPS[c.op]?.needsValue && c.value);
    const kind = fieldKind(f.type);
    const v = fromCond
      ? String(fromCond.value).split(",")[0].trim()
      : kind === "number"
        ? f.name.endsWith("_code") ? "6" : /amount|amt|rate|total|days/i.test(f.name) ? "525000" : "1024"
        : kind === "date"
          ? new Date().toISOString().slice(0, 10)
          : kind === "boolean"
            ? "true"
            : `[${f.name}]`;
    vars[f.name] = v;
    vars[`old_${f.name}`] = kind === "number" ? "0" : `[old ${f.name}]`;
  }
  return vars;
}

export function emptyAlert() {
  return {
    name: "",
    description: "",
    is_active: true,
    model_name: "",
    actions: ["create"],
    conditions: [],
    match: "all",
    recipients: { roles: [], users: [], departments: [], userFields: [], employeeFields: [] },
    notify_actor: false,
    type: "info",
    title_template: "",
    message_template: "",
  };
}

/** Ready-made starting points — they only pre-fill the builder. */
export const ALERT_TEMPLATES = [
  {
    key: "big-payment",
    label: "Big payment made",
    hint: "A payment voucher over 500,000 → accountants and admins",
    alert: {
      name: "Big payment made",
      description: "Any payment voucher above 500,000.",
      model_name: "TransactionsMaster",
      actions: ["create"],
      conditions: [
        { field: "tran_code", op: "eq", value: "2" },
        { field: "tr_amount", op: "gt", value: "500000" },
      ],
      match: "all",
      recipients: { roles: ["ACCOUNTANT", "ADMIN"], users: [], departments: [], userFields: [], employeeFields: [] },
      type: "warning",
      title_template: "Big payment: {tr_amount}",
      message_template: "{actor} made payment voucher #{vr_no} for {tr_amount} on {dated}.",
    },
  },
  {
    key: "employee-status",
    label: "Employee status changed",
    hint: "An employee's status changes → HR managers",
    alert: {
      name: "Employee status changed",
      description: "Joining, leaving, suspension — any status change.",
      model_name: "Employee",
      actions: ["update"],
      conditions: [{ field: "status", op: "changed" }],
      match: "all",
      recipients: { roles: ["HR_MANAGER", "ADMIN"], users: [], departments: [], userFields: [], employeeFields: [] },
      type: "info",
      title_template: "{firstName} {surname}: {status}",
      message_template: "{actor} changed the status of {firstName} {surname} from {old_status} to {status}.",
    },
  },
  {
    key: "leave-approved",
    label: "Leave approved → tell the employee",
    hint: "A leave request is approved → the employee it belongs to",
    alert: {
      name: "Leave request approved",
      description: "Tells the employee their leave was approved.",
      model_name: "HrLeaveRequest",
      actions: ["update"],
      conditions: [{ field: "status", op: "changed_to", value: "approved" }],
      match: "all",
      recipients: { roles: [], users: [], departments: [], userFields: [], employeeFields: ["employee_id"] },
      type: "success",
      title_template: "Your leave is approved",
      message_template: "Your leave from {from_date} to {to_date} ({days} days) was approved by {actor}.",
    },
  },
];

/** Alert row → builder form (fills gaps). */
export function toForm(a) {
  const base = emptyAlert();
  return {
    ...base,
    ...a,
    description: a?.description || "",
    actions: Array.isArray(a?.actions) ? a.actions : base.actions,
    conditions: Array.isArray(a?.conditions) ? a.conditions.map((c) => ({ field: c.field || "", op: c.op || "eq", value: c.value ?? "" })) : [],
    recipients: { ...base.recipients, ...(a?.recipients || {}) },
  };
}

/** Form → request body. */
export function toBody(f) {
  return {
    name: f.name,
    description: f.description,
    is_active: f.is_active,
    model_name: f.model_name,
    actions: f.actions,
    conditions: f.conditions.map((c) => (ALERT_OPS[c.op]?.needsValue ? { field: c.field, op: c.op, value: c.value } : { field: c.field, op: c.op })),
    match: f.match,
    recipients: f.recipients,
    notify_actor: f.notify_actor,
    type: f.type,
    title_template: f.title_template,
    message_template: f.message_template,
  };
}

const joinWords = (list, last = "and") =>
  list.length <= 1 ? list.join("") : `${list.slice(0, -1).join(", ")} ${last} ${list[list.length - 1]}`;

/**
 * The alert as one sentence:
 * "When Vouchers are created and Voucher type is 2 and Amount is more than 500000 → tell Accountant, Ali Raza".
 * Returns { when, who } so the card can style the two halves.
 */
export function describeAlert(a, meta) {
  const model = meta?.models?.find((m) => m.model === a.model_name);
  const table = model?.label || a.model_name || "a table";
  const acts = (a.actions?.length ? a.actions : ACTIONS.map((x) => x.key)).map((k) => ACTIONS.find((x) => x.key === k)?.word || k);
  let when = `When ${table} ${/s$/i.test(table) ? "are" : "is"} ${joinWords(acts, "or")}`;
  const conds = (a.conditions || []).filter((c) => c.field && ALERT_OPS[c.op]);
  if (conds.length) {
    const parts = conds.map((c) => {
      const op = ALERT_OPS[c.op];
      let value = op.needsValue ? ` ${c.value}` : "";
      if (c.op === "in") value = ` ${String(c.value).split(",").map((s) => s.trim()).filter(Boolean).join(", ")}`;
      const hint = VALUE_HINTS[c.field]?.find(([v]) => v === String(c.value));
      if (hint && op.needsValue && c.op !== "in") value += ` (${hint[1]})`;
      return `${fieldLabel(c.field)} ${op.label}${value}`;
    });
    when += a.match === "any" && parts.length > 1 ? ` and either ${parts.join(" or ")}` : ` and ${parts.join(" and ")}`;
  }
  const r = a.recipients || {};
  const users = new Map((meta?.users || []).map((u) => [String(u.id), u.name]));
  const depts = new Map((meta?.departments || []).map((d) => [Number(d.id), d.name]));
  const who = [
    ...(r.roles || []).map(roleLabel),
    ...(r.users || []).map((id) => users.get(String(id)) || "a user"),
    ...(r.departments || []).map((id) => `${depts.get(Number(id)) || "a department"} department`),
    ...(r.userFields || []).map((f) => `the user in “${fieldLabel(f)}”`),
    ...(r.employeeFields || []).map((f) => `the employee in “${fieldLabel(f)}”`),
    ...(a.notify_actor ? ["whoever made the change"] : []),
  ];
  return { when, who: who.length ? `tell ${joinWords(who)}` : "tell nobody yet" };
}
