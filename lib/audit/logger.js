import { Prisma } from "@prisma/client";
import { getAuditActor, newBatchId } from "./context";
import { AUDIT_IGNORED_FIELDS, AUDIT_PARENTS } from "./catalog";

// Models that must never be audit-logged. AuditLog itself is required here
// to prevent infinite recursion (logging a write to AuditLog would otherwise
// trigger another attempt to log that write).
// Notification: reading / clearing one's own inbox is not a business change.
// PushSubscription: a person's own phone turned on / off for notifications.
const EXCLUDED_MODELS = new Set(["AuditLog", "Notification", "PushSubscription"]);

// ── PK resolution, built once from the Prisma DMMF ──────────────────────────
// Handles both single `@id` fields and composite `@@id([...])` keys.

let idFieldsCache = null;

function getIdFieldsMap() {
  if (idFieldsCache) return idFieldsCache;
  idFieldsCache = {};
  for (const model of Prisma.dmmf.datamodel.models) {
    const singleIdFields = model.fields.filter((f) => f.isId).map((f) => f.name);
    idFieldsCache[model.name] =
      singleIdFields.length > 0 ? singleIdFields : (model.primaryKey?.fields ?? []);
  }
  return idFieldsCache;
}

function getRecordId(modelName, row) {
  if (!row) return null;
  const idFields = getIdFieldsMap()[modelName] ?? [];
  if (idFields.length === 0) return null;
  return idFields.map((f) => String(row[f] ?? "")).join("-");
}

// ── JSON-safety for values going into the `changes`/`snapshot` Json columns ─

function sanitizeForJson(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === "bigint") return value.toString();
  if (value instanceof Date) return value.toISOString();
  if (value instanceof Prisma.Decimal) return value.toString();
  if (Array.isArray(value)) return value.map(sanitizeForJson);
  if (typeof value === "object") {
    const out = {};
    for (const [key, v] of Object.entries(value)) out[key] = sanitizeForJson(v);
    return out;
  }
  return value;
}

// ── Field-level diffing ──────────────────────────────────────────────────
// Only compares scalar fields (string/number/boolean/null/Date/Decimal).
// Relation objects/arrays that a caller's `include` may have attached to
// `after` are skipped rather than misread as "field appeared".

function isScalar(value) {
  if (value === null || value === undefined) return true;
  if (value instanceof Date || value instanceof Prisma.Decimal) return true;
  const type = typeof value;
  return type !== "object" && type !== "function";
}

function normalize(value) {
  if (value instanceof Date) return value.getTime();
  if (value instanceof Prisma.Decimal) return value.toString();
  return value;
}

function diffRecords(before, after) {
  const changes = [];
  const keys = new Set([...Object.keys(before ?? {}), ...Object.keys(after ?? {})]);

  for (const key of keys) {
    const oldValue = before?.[key];
    const newValue = after?.[key];
    if (!isScalar(oldValue) || !isScalar(newValue)) continue;
    if (normalize(oldValue) === normalize(newValue)) continue;
    changes.push({ field: key, old: sanitizeForJson(oldValue), new: sanitizeForJson(newValue) });
  }

  return changes;
}

// ── Entry point, called from the Prisma extension in lib/prisma.js ─────────
// `basePrisma` must be the raw/unextended client so this write doesn't
// re-trigger the extension it's being called from.

//
// Every write is recorded — single and bulk alike (create / createMany /
// update / updateMany / upsert / delete / deleteMany): one AuditLog row per
// record, with the document it belongs to (lib/audit/catalog.js AUDIT_PARENTS),
// the request's batch id (one save = one batch) and who did it. A bulk write
// touching more than MAX_ROWS records is recorded as one summary row.
// Each new row is then offered to the notification alerts
// (lib/notifications/alerts.js), so any change to any table can notify.

const MAX_ROWS = 2000;

/** Only scalar columns, JSON-safe — what a create / delete snapshot keeps. */
function scalarSnapshot(row) {
  const out = {};
  for (const [k, v] of Object.entries(row ?? {})) if (isScalar(v)) out[k] = sanitizeForJson(v);
  return out;
}

function documentOf(model, row, record_id) {
  const parent = AUDIT_PARENTS[model];
  if (parent && row?.[parent[1]] != null) return { doc_model: parent[0], doc_id: String(row[parent[1]]) };
  return { doc_model: model, doc_id: record_id };
}

// Until prisma/sql/2026-11-07_audit_trail.sql adds doc_model / doc_id /
// batch_id / source, rows are written without them.
let extendedColumns = true;
const isMissingColumn = (err) => err?.code === "P2022" || /column .* does not exist/i.test(String(err?.message));

/**
 * Record a write. `rows` = [{ before, after }] — before is null for a create,
 * after is null for a delete. `summary` (bulk write too big to list) =
 * { count, where }.
 */
export async function recordAuditEvents({ model, action, rows = [], summary = null, basePrisma }) {
  if (EXCLUDED_MODELS.has(model)) return;
  try {
    const { userId, userName, batchId, source } = getAuditActor();
    const batch_id = batchId ?? newBatchId();
    const entries = [];

    if (summary) {
      entries.push({
        model_name: model,
        record_id: `${summary.count} rows`,
        action,
        changes: null,
        snapshot: sanitizeForJson({ count: summary.count, where: summary.where ?? null, data: summary.data ?? null }),
        doc_model: model,
        doc_id: null,
      });
    }

    for (const { before, after } of rows.slice(0, MAX_ROWS)) {
      const row = after ?? before;
      const record_id = getRecordId(model, row) || "new";
      let changes = null;
      let snapshot = null;
      if (action === "update") {
        changes = diffRecords(before, after).filter((c) => !AUDIT_IGNORED_FIELDS.has(c.field));
        if (changes.length === 0) continue; // nothing that matters changed
      } else {
        snapshot = scalarSnapshot(row);
      }
      entries.push({ model_name: model, record_id, action, changes, snapshot, ...documentOf(model, row, record_id), _row: row, _before: before });
    }
    if (!entries.length) return;

    const base = { user_id: userId, user_name: userName };
    const data = entries.map(({ _row, _before, doc_model, doc_id, ...e }) =>
      extendedColumns ? { ...e, ...base, doc_model, doc_id, batch_id, source: source ?? (userId ? "user" : "system") } : { ...e, ...base },
    );
    try {
      await basePrisma.auditLog.createMany({ data });
    } catch (err) {
      if (!extendedColumns || !isMissingColumn(err)) throw err;
      extendedColumns = false;
      console.error("[audit] doc_model / batch_id columns missing — run prisma/sql/2026-11-07_audit_trail.sql. Recording without them.");
      await basePrisma.auditLog.createMany({ data: data.map(({ doc_model, doc_id, batch_id: b, source: s, ...e }) => e) });
    }

    // Any change can raise an admin-defined notification alert.
    try {
      const { runAlerts } = await import("@/lib/notifications/alerts");
      await runAlerts(
        entries.map((e) => ({ model: e.model_name, action: e.action, record_id: e.record_id, changes: e.changes, after: e._row && action !== "delete" ? e._row : null, before: e._before ?? null })),
        { userId, userName, basePrisma },
      );
    } catch (err) {
      console.error("[audit] notification alerts failed:", err);
    }
  } catch (err) {
    console.error("Audit log error:", err);
  }
}

/** One record (the original single-row entry point). */
export function recordAuditEvent({ model, action, before, after, basePrisma }) {
  return recordAuditEvents({ model, action, rows: [{ before: before ?? null, after: after ?? null }], basePrisma });
}
