// lib/notifications/alertData.js — validating a notification alert from the
// admin screen (lib/notifications/alerts.js runs them).
import { ALERT_OPS } from "./alerts";
import { TEMPLATE_LIMITS } from "./template";
import { fieldsOf, isAuditModel } from "@/lib/audit/meta";

export class AlertError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const ACTIONS = ["create", "update", "delete"];
const TYPES = ["info", "success", "warning", "error"];
const strList = (v) => (Array.isArray(v) ? [...new Set(v.map((x) => String(x).trim()).filter(Boolean))] : []);

/** Body → the columns of notification_alerts, or an AlertError. */
export function alertData(b) {
  const name = String(b?.name ?? "").trim().slice(0, 150);
  if (!name) throw new AlertError("Give the alert a name.");
  const model_name = String(b?.model_name ?? "");
  if (!isAuditModel(model_name)) throw new AlertError("Choose what the alert watches.");
  const fields = new Set(fieldsOf(model_name).map((f) => f.name));
  const actions = strList(b.actions).filter((a) => ACTIONS.includes(a));
  const conditions = (Array.isArray(b.conditions) ? b.conditions : []).map((c, i) => {
    if (!fields.has(c?.field)) throw new AlertError(`Condition ${i + 1}: choose a field.`);
    if (!ALERT_OPS[c.op]) throw new AlertError(`Condition ${i + 1}: choose how to compare.`);
    if (ALERT_OPS[c.op].needsValue && String(c.value ?? "").trim() === "") throw new AlertError(`Condition ${i + 1}: enter a value.`);
    return { field: c.field, op: c.op, ...(ALERT_OPS[c.op].needsValue ? { value: String(c.value).trim().slice(0, 200) } : {}) };
  });
  const r = b.recipients ?? {};
  const recipients = {
    roles: strList(r.roles),
    users: strList(r.users),
    departments: strList(r.departments).map(Number).filter(Number.isFinite),
    userFields: strList(r.userFields).filter((f) => fields.has(f)),
    employeeFields: strList(r.employeeFields).filter((f) => fields.has(f)),
  };
  const notify_actor = Boolean(b.notify_actor);
  if (!Object.values(recipients).some((x) => x.length) && !notify_actor) throw new AlertError("Choose who is told.");
  const title_template = String(b.title_template ?? "").trim();
  const message_template = String(b.message_template ?? "").trim();
  if (!title_template) throw new AlertError("Write the title.");
  if (!message_template) throw new AlertError("Write the message.");
  if (title_template.length > TEMPLATE_LIMITS.title) throw new AlertError(`Title: at most ${TEMPLATE_LIMITS.title} characters.`);
  if (message_template.length > TEMPLATE_LIMITS.message) throw new AlertError(`Message: at most ${TEMPLATE_LIMITS.message} characters.`);
  return {
    name,
    description: b.description ? String(b.description).trim().slice(0, 500) || null : null,
    is_active: b.is_active !== false,
    model_name,
    actions,
    conditions,
    match: b.match === "any" ? "any" : "all",
    recipients,
    notify_actor,
    type: TYPES.includes(b.type) ? b.type : "info",
    title_template,
    message_template,
  };
}
