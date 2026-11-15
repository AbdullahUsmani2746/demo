// lib/audit/enteredBy.js — "Entered by": who keyed a voucher / order.
//
// The creator is stored on the document itself — TRANSACTIONS_MASTER.user_id
// and OrderMaster.userid, both set from the session by the save routes. Older
// rows that have none fall back to the AuditLog "create" entry of that
// document (lib/prisma.js writes one per create), then to a legacy imported
// user code ("Users".user_id). A system job (runAsSystem) leaves the column
// null and its audit entry is source "system" → "System".
//
// One batched lookup per page / report — never one query per row. Read-only,
// through the extended `prisma` client (rule 14: off-books rows stay hidden).
import prisma from "@/lib/prisma";

/** The User fields a list needs for the name — never the whole row (password hash). */
export const ENTERED_BY_USER_SELECT = { id: true, name: true, username: true, email: true };

/** Display name of a User row: name → username → email. */
export function userDisplayName(u) {
  if (!u) return null;
  return (u.name && u.name.trim()) || (u.username && u.username.trim()) || u.email || null;
}

const MODELS = {
  TransactionsMaster: { delegate: "transactionsMaster", id: "tran_id", userId: "user_id", relation: "user", legacy: true },
  OrderMaster: { delegate: "orderMaster", id: "order_no", userId: "userid", relation: "users", legacy: false },
};

const CHUNK = 5000;
const chunks = (list) => {
  const out = [];
  for (let i = 0; i < list.length; i += CHUNK) out.push(list.slice(i, i + CHUNK));
  return out;
};

/**
 * Map(String(id) → name | null) for documents of `model`
 * ("TransactionsMaster" | "OrderMaster").
 */
export async function enteredByMap(model, ids) {
  const m = MODELS[model];
  const out = new Map();
  if (!m) return out;
  const unique = [...new Set((ids || []).map(Number).filter((n) => Number.isInteger(n) && n > 0))];
  if (!unique.length) return out;

  // 1. The stored creator.
  const rawUser = new Map(); // id → stored user id that is not an app User
  for (const part of chunks(unique)) {
    const rows = await prisma[m.delegate].findMany({
      where: { [m.id]: { in: part } },
      select: { [m.id]: true, [m.userId]: true, [m.relation]: { select: ENTERED_BY_USER_SELECT } },
    });
    for (const r of rows) {
      const key = String(r[m.id]);
      const name = userDisplayName(r[m.relation]);
      out.set(key, name);
      if (!name && r[m.userId]) rawUser.set(key, String(r[m.userId]));
    }
  }

  // 2. No app user → the AuditLog creator of that document.
  const missing = [...out.keys()].filter((k) => !out.get(k));
  if (missing.length) {
    for (const part of chunks(missing)) {
      const logs = await prisma.auditLog.findMany({
        where: { model_name: model, action: "create", record_id: { in: part } },
        select: { record_id: true, user_name: true, source: true, user: { select: ENTERED_BY_USER_SELECT } },
        orderBy: { id: "asc" },
      });
      for (const l of logs) {
        if (out.get(l.record_id)) continue; // first create entry wins
        const name = userDisplayName(l.user) || l.user_name || (l.source === "system" ? "System" : null);
        if (name) out.set(l.record_id, name);
      }
    }
  }

  // 3. Legacy imported vouchers carry a "Users".user_id code (not an app user).
  const stillRaw = [...rawUser.entries()].filter(([k]) => !out.get(k));
  if (stillRaw.length) {
    let legacy = new Map();
    if (m.legacy) {
      const codes = [...new Set(stillRaw.map(([, code]) => code))];
      try {
        for (const part of chunks(codes)) {
          const rows = await prisma.users.findMany({ where: { user_id: { in: part } }, select: { user_id: true, user_name: true } });
          rows.forEach((r) => legacy.set(r.user_id, r.user_name));
        }
      } catch {
        legacy = new Map();
      }
    }
    for (const [k, code] of stillRaw) out.set(k, legacy.get(code) || code);
  }
  return out;
}

/**
 * Set `row[field]` ("entered_by") on every row that carries a document id
 * (`idKey`, default the model's id). Rows that already have a name keep it.
 * Mutates and returns `rows`.
 */
export async function attachEnteredBy(rows, model, { idKey, field = "entered_by" } = {}) {
  if (!Array.isArray(rows) || !rows.length || !MODELS[model]) return rows;
  const key = idKey || MODELS[model].id;
  const ids = rows.map((r) => (r && typeof r === "object" && !r[field] ? r[key] : null)).filter((v) => v != null);
  if (!ids.length) return rows;
  const names = await enteredByMap(model, ids);
  for (const r of rows) {
    if (!r || typeof r !== "object" || r[key] == null || r[field]) continue;
    r[field] = names.get(String(Number(r[key]))) ?? null;
  }
  return rows;
}
