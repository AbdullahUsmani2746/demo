// lib/auth/scope.js
// ============================================================
// Row-level data scope — WHICH rows a user may see or touch.
//
// Who a rule belongs to, first match wins:
//   1. the user's own DataScope row          (Admin → Permissions → Person)
//   2. their department's DepartmentScope row (Admin → Permissions → Department)
//   3. none → unrestricted
// Dimensions (customer, region, godown, …): lib/auth/scopeDimensions.js
//
// A rule's mode:
//   mode ALL   — everything (the default when no row exists for a
//                full-access role; for everyone else the default is OWN)
//   mode OWN   — resolved from the data itself, never a stored list:
//                  customer → accounts whose sales person is this user
//                  region   → regions of those customers
//                  godown   → no natural owner, so OWN means none
//   mode LIST  — the explicit values stored on the row
//
// ADMIN and ACCOUNTANT always resolve to ALL.
//
// The resolved scope is applied in exactly two kinds of place: the report
// engine (so all 60+ reports are scoped at once) and the routes that list or
// write party data. Resolving is cached per request by the caller.
// ============================================================
import prisma from "@/lib/prisma";
import { hasFullAccess, ForbiddenError } from "./permissions";
import { getCustomerMacnos } from "@/lib/accounts/partyMacnos";
import { DIMENSION_KEYS } from "./scopeDimensions";
import { sessionTeamIds } from "@/lib/hr/team";

export const DIMENSIONS = DIMENSION_KEYS;

/** The department's rule for a dimension, or null. */
let warnedNoDepartmentScope = false;
async function departmentRule(userId, dimension) {
  // Until the DepartmentScope table exists (prisma/sql/2026-10-21_department_scope.sql
  // + prisma generate) there are simply no department rules. Fail-open, but
  // said out loud (once) so a missing table is not mistaken for "no rules".
  if (!prisma.departmentScope) {
    if (!warnedNoDepartmentScope) {
      warnedNoDepartmentScope = true;
      console.error("[scope] prisma.departmentScope is missing — department scope rules are NOT applied (run prisma generate / the department_scope SQL).");
    }
    return null;
  }
  try {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { departmentId: true } });
    if (!user?.departmentId) return null;
    return await prisma.departmentScope.findUnique({
      where: { departmentId_dimension: { departmentId: user.departmentId, dimension } },
      select: { mode: true, values: true },
    });
  } catch (e) {
    // Fail-open (treated as no department rule) — logged so it is noticed.
    console.error("[scope] department rule lookup failed — department scope NOT applied:", e.message);
    return null;
  }
}

/** Accounts whose assigned sales person is this user. */
async function ownCustomerAcnos(userId) {
  const rows = await prisma.aCNO.findMany({
    where: { macno: { in: await getCustomerMacnos() }, salesArea: userId },
    select: { acno: true },
  });
  return rows.map((r) => String(r.acno));
}

/**
 * Resolve one dimension for the session.
 * @returns {Promise<{mode: "ALL"|"LIST", values: string[]}>}
 *          mode ALL means unrestricted; LIST carries the permitted values
 *          (an empty list means the user may see nothing in this dimension).
 */
export async function scopeFor(session, dimension) {
  if (!session?.user?.id) return { mode: "LIST", values: [] };
  if (hasFullAccess(session)) return { mode: "ALL", values: [] };

  // Personal rule first, then the department's.
  const row =
    (await prisma.dataScope.findUnique({
      where: { userId_dimension: { userId: session.user.id, dimension } },
      select: { mode: true, values: true },
    })) ?? (await departmentRule(session.user.id, dimension));

  // No rule recorded → unrestricted. Scoping is opt-in so that adding these
  // tables does not silently blank out everyone's reports.
  if (!row) return { mode: "ALL", values: [] };

  if (row.mode === "ALL") return { mode: "ALL", values: [] };
  if (row.mode === "LIST") return { mode: "LIST", values: row.values ?? [] };

  // OWN
  if (dimension === "customer") {
    return { mode: "LIST", values: await ownCustomerAcnos(session.user.id) };
  }
  if (dimension === "region") {
    const acnos = await ownCustomerAcnos(session.user.id);
    if (acnos.length === 0) return { mode: "LIST", values: [] };
    const regions = await prisma.orderMaster.findMany({
      where: { party_code: { in: acnos.map(Number) }, region: { not: null } },
      select: { region: true },
      distinct: ["region"],
    });
    return { mode: "LIST", values: regions.map((r) => r.region) };
  }
  if (dimension === "hrTeam") {
    // Everyone below them in the reporting line (lib/hr/team.js).
    return { mode: "LIST", values: (await sessionTeamIds(session)).map(String) };
  }
  // A godown has no owner, so OWN grants nothing — use LIST for godowns.
  return { mode: "LIST", values: [] };
}

/**
 * True when a rule is recorded for this dimension (personal or department),
 * even one of mode ALL. scopeFor cannot tell "no rule" from "All" — HR needs
 * to, because HR falls back to the person's team when nothing is recorded.
 */
export async function hasScopeRule(session, dimension) {
  if (!session?.user?.id) return false;
  const own = await prisma.dataScope.findUnique({
    where: { userId_dimension: { userId: session.user.id, dimension } },
    select: { mode: true },
  });
  return Boolean(own ?? (await departmentRule(session.user.id, dimension)));
}

/** Every dimension at once — used by the report engine. */
export async function allScopes(session) {
  const entries = await Promise.all(
    DIMENSIONS.map(async (d) => [d, await scopeFor(session, d)]),
  );
  return Object.fromEntries(entries);
}

export const isUnrestricted = (scope) => !scope || scope.mode === "ALL";

/** True when this value is inside the scope. */
export function scopeAllows(scope, value) {
  if (isUnrestricted(scope)) return true;
  if (value === null || value === undefined || value === "") return false;
  return scope.values.includes(String(value));
}

/** Throwing form, for write routes. */
export function assertInScope(scope, value, label = "record") {
  if (!scopeAllows(scope, value)) {
    throw new ForbiddenError(`This ${label} is outside the data you are allowed to work with.`);
  }
}

/**
 * Narrow a report filter to the scope.
 *
 * The filter may already name one or several values (the user picked a
 * customer); we keep only those inside the scope. If they picked nothing, the
 * whole permitted list is applied, so an unfiltered report is still scoped.
 * Returns undefined when unrestricted, so the caller leaves the filter alone.
 */
export function narrowFilter(scope, current) {
  if (isUnrestricted(scope)) return undefined;

  const allowed = new Set(scope.values.map(String));
  const asArray = (v) =>
    v === null || v === undefined || v === ""
      ? []
      : Array.isArray(v)
        ? v.map(String)
        : String(v).split(",").map((s) => s.trim()).filter(Boolean);

  const picked = asArray(current);
  const result = picked.length > 0 ? picked.filter((v) => allowed.has(v)) : [...allowed];

  // An empty result must stay empty (show nothing), never fall back to "all".
  return result;
}

/**
 * Prisma `where` fragment for a customer-scoped query, or undefined when
 * unrestricted. Field name differs by model, hence the argument.
 */
export function customerWhere(scope, field = "acno") {
  if (isUnrestricted(scope)) return undefined;
  return { [field]: { in: scope.values.map(Number).filter((n) => !isNaN(n)) } };
}
