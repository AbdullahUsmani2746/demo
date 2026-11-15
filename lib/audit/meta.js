// lib/audit/meta.js — every table (Prisma model) and its fields, for the
// Audit Trail filters and the notification-alert builder. Read from the
// Prisma schema itself, so a new table shows up with no work.
import { Prisma } from "@prisma/client";
import { AUDIT_MODULES, AUDIT_PARENTS, auditLabel } from "./catalog";

const moduleOf = new Map(AUDIT_MODULES.flatMap((m) => m.models.map((model) => [model, m.key])));
const HIDDEN = new Set(["AuditLog", "Notification", "PushSubscription", "Session", "Account", "VerificationToken"]);

let cached = null;

/** [{ model, label, module, parent, fields: [{ name, type, list }] }] sorted by label. */
export function auditModels() {
  if (cached) return cached;
  cached = Prisma.dmmf.datamodel.models
    .filter((m) => !HIDDEN.has(m.name))
    .map((m) => ({
      model: m.name,
      label: auditLabel(m.name),
      module: moduleOf.get(m.name) ?? "other",
      parent: AUDIT_PARENTS[m.name]?.[0] ?? null,
      fields: m.fields
        .filter((f) => f.kind === "scalar" || f.kind === "enum")
        .map((f) => ({ name: f.name, type: f.kind === "enum" ? "Enum" : f.type, list: f.isList })),
    }))
    .sort((a, b) => a.label.localeCompare(b.label));
  return cached;
}

export const isAuditModel = (model) => auditModels().some((m) => m.model === model);
export const fieldsOf = (model) => auditModels().find((m) => m.model === model)?.fields ?? [];
