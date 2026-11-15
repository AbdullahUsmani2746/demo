// lib/auth/documentScope.js
// ============================================================
// Applies the data scope (lib/auth/scope.js) outside the report engine,
// driven entirely by lib/auth/scopeDimensions.js:
//
//   setupScopeWhere     — /api/setup/<entity> dropdowns (Godown list, …)
//   documentScopeWhere  — document lists (TRANSACTIONS_MASTER)
//   documentScopeError  — refuse saving / editing / deleting a document
//                         outside the scope (returns a message, or null)
//
// A document is in scope when ANY of a dimension's fields holds a permitted
// value — so a transfer is visible/allowed when either side is the user's.
// documents.via: the permitted values are a field of the record the document
// field points at (vendorGroup: pycd → ACNO.macno), not the field itself.
// Full-access roles and users with no rule are never touched.
// ============================================================
import prisma from "@/lib/prisma";
import { scopeFor, isUnrestricted } from "./scope";
import { SCOPE_DIMENSIONS, typedValues } from "./scopeDimensions";

const plain = (v) => (v && typeof v === "object" ? v.value ?? v.id ?? null : v);

// via the party account: { relation: "acno", field: "macno" } — the account's
// main account. The only kind of `via` there is today.
const docFieldWhere = (dim, f, vals) =>
  dim.documents.via
    ? { [dim.documents.via.relation]: { is: { [dim.documents.via.field]: { in: vals } } } }
    : { [f]: { in: vals } };

/** The values a document's field stands for under this dimension. */
async function viaValues(dim, vals) {
  if (!dim.documents.via || vals.length === 0) return vals;
  const accounts = await prisma.aCNO.findMany({
    where: { acno: { in: vals.map(Number).filter(Number.isFinite) } },
    select: { [dim.documents.via.field]: true },
  });
  return accounts.map((a) => a[dim.documents.via.field]).filter((v) => v != null);
}

/** True when some dimension limits this setup entity's list. */
export const isScopedSetupEntity = (entity) =>
  SCOPE_DIMENSIONS.some((d) => d.setup?.entity === entity);

/** Prisma where for a setup entity's list, or null when unrestricted. */
export async function setupScopeWhere(session, entity) {
  const dim = SCOPE_DIMENSIONS.find((d) => d.setup?.entity === entity);
  if (!dim || !session?.user?.id) return null;
  const scope = await scopeFor(session, dim.key);
  if (isUnrestricted(scope)) return null;
  return { [dim.setup.field]: { in: typedValues(dim, scope.values) } };
}

const documentDims = (tranCode) =>
  SCOPE_DIMENSIONS.filter((d) => d.documents && d.documents.tranCodes.includes(Number(tranCode)));

/** Prisma where fragments (to AND together) for a document list. */
export async function documentScopeWhere(session, tranCode) {
  const out = [];
  for (const dim of documentDims(tranCode)) {
    const scope = await scopeFor(session, dim.key);
    if (isUnrestricted(scope)) continue;
    const vals = typedValues(dim, scope.values);
    out.push({ OR: dim.documents.fields.map((f) => docFieldWhere(dim, f, vals)) });
  }
  return out;
}

/**
 * Message when `doc` (master fields, plain or {value,label}) — or any of its
 * `lines` that names its own godown — lies outside the user's scope for this
 * document type; null when allowed.
 */
export async function documentScopeError(session, tranCode, doc, lines = []) {
  for (const dim of documentDims(tranCode)) {
    const scope = await scopeFor(session, dim.key);
    if (isUnrestricted(scope)) continue;
    const allowed = new Set(scope.values.map(String));
    const vals = await viaValues(
      dim,
      dim.documents.fields.map((f) => plain(doc?.[f])).filter((v) => v !== null && v !== undefined && v !== ""),
    );
    const what = dim.documents.noun ?? dim.label.replace(/s$/, "").toLowerCase();
    // A document with no value in the header counts as outside, unless its
    // lines carry one (checked below).
    const lineVals = (Array.isArray(lines) ? lines : []).flatMap((l) =>
      (dim.documents.lineFields ?? [])
        .map((f) => plain(l?.[f]))
        .filter((v) => v !== null && v !== undefined && v !== ""),
    );
    if (vals.length === 0 && lineVals.length === 0) {
      return `You can only work with your assigned ${dim.label.toLowerCase()} — choose one of them.`;
    }
    if (vals.length > 0 && !vals.some((v) => allowed.has(String(v)))) {
      return `You can only work with your assigned ${dim.label.toLowerCase()} — this document's ${what} is outside them.`;
    }
    const badLine = lineVals.find((v) => !allowed.has(String(v)));
    if (badLine !== undefined) {
      return `You can only work with your assigned ${dim.label.toLowerCase()} — a line uses ${what} ${badLine}, which is outside them.`;
    }
  }
  return null;
}

// ── Helpers for routes outside the document engine ──────────────────────────

/**
 * Permitted values of a dimension for this user, typed for Prisma — or null
 * when unrestricted. For routes that build their own `where` (requisitions,
 * dispatch invoicing, stock look-ups, …).
 */
export async function scopeValues(session, key) {
  const dim = SCOPE_DIMENSIONS.find((d) => d.key === key);
  if (!dim || !session?.user?.id) return null;
  const scope = await scopeFor(session, key);
  return isUnrestricted(scope) ? null : typedValues(dim, scope.values);
}

/** Message when any of these TRANSACTIONS_MASTER documents is out of scope. */
export async function documentsScopeError(session, prisma, tranIds) {
  const ids = [...new Set((tranIds || []).map(Number).filter(Number.isFinite))];
  if (ids.length === 0 || !session?.user?.id) return null;
  const docs = await prisma.transactionsMaster.findMany({
    where: { tran_id: { in: ids } },
    select: { tran_id: true, tran_code: true, godown: true, godown2: true, pycd: true },
  });
  for (const d of docs) {
    const err = await documentScopeError(session, d.tran_code, d);
    if (err) return err;
  }
  return null;
}

/** A single godown (stock look-ups): message when it is not permitted. */
export async function godownScopeError(session, godown) {
  const vals = await scopeValues(session, "godown");
  if (!vals) return null;
  const g = Number(godown?.value ?? godown);
  return vals.includes(g) ? null : "You can only see stock of your assigned godowns.";
}

/**
 * For any record whose dimension values live in other fields (requisitions:
 * issued_for / issued_by). Prisma where — any field permitted — or null.
 */
export async function recordScopeWhere(session, key, fields) {
  const vals = await scopeValues(session, key);
  if (!vals) return null;
  return { OR: fields.map((f) => ({ [f]: { in: vals } })) };
}

/** Message unless at least one of `values` is permitted (either side). */
export async function recordScopeError(session, key, values) {
  const vals = await scopeValues(session, key);
  if (!vals) return null;
  const dim = SCOPE_DIMENSIONS.find((d) => d.key === key);
  const present = values.map(plain).filter((v) => v !== null && v !== undefined && v !== "");
  const ok = present.some((v) => vals.map(String).includes(String(v)));
  return ok ? null : `You can only work with your assigned ${dim.label.toLowerCase()}.`;
}

/**
 * Prisma where fragments (to AND together) for an account picker of these
 * Account Settings groups (/api/accounts/acno?group=…): for every limited
 * dimension tied to one of the groups (`pickers` in scopeDimensions.js), an
 * account of that group must be a permitted one; accounts of other groups in
 * the same picker are left alone. `groupMacnos(key)` resolves a group.
 */
export async function pickerScopeWhere(session, groupKeys, groupMacnos) {
  if (!session?.user?.id || !groupKeys?.length) return [];
  const out = [];
  for (const dim of SCOPE_DIMENSIONS.filter((d) => d.pickers && groupKeys.includes(d.pickers.group))) {
    const scope = await scopeFor(session, dim.key);
    if (isUnrestricted(scope)) continue;
    const macnos = await groupMacnos(dim.pickers.group);
    out.push({
      OR: [
        { macno: { notIn: macnos } },
        { [dim.pickers.field]: { in: typedValues(dim, scope.values) } },
      ],
    });
  }
  return out;
}
