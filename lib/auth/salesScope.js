// lib/auth/salesScope.js
// ============================================================
// WHO SEES WHICH CUSTOMERS — the one rule for every sales-facing screen
// (Sales Targets, Sales Team MIS, Customer Aging, Sales Loans, Sale Return
// remarks, BI dashboards, customer lists).
//
// Managed on Admin → Permissions → Sales visibility, never in code:
//   · All sales     — permission salesTeam.viewAll (ADMIN / ACCOUNTANT always)
//   · Own + team    — permission salesTeam.viewTeam, whose grant carries
//                     constraints.salesPersons = [User.id, …]: they see their
//                     own customers plus those sales persons' customers
//   · Own only      — the default: ACNO.salesArea = their User.id
//
// Nobody is hard-coded here: grant salesTeam.viewAll / salesTeam.viewTeam on
// Permissions → Sales visibility.
// ============================================================
import prisma from "@/lib/prisma";
import { canViewAllSalesTeam, resolve } from "@/lib/auth/permissions";
import { getCustomerMacnos } from "@/lib/accounts/partyMacnos";

export const SALES_TEAM_VIEW_TEAM = "salesTeam.viewTeam";

// A salesArea no customer has, so "nothing" stays an IN-list, never "all".
export const NO_SALES_PERSON = "__none__";

/**
 * Sales persons whose customers this session may see:
 *   null      → every sales person (salesTeam.viewAll / ADMIN / ACCOUNTANT)
 *   [ids…]    → themselves + their team (salesTeam.viewTeam)
 */
export async function visibleSalesPersons(session) {
  if (await canViewAllSalesTeam(session)) return null;
  const me = session?.user?.id;
  if (!me) return [NO_SALES_PERSON];
  const { allowed, constraints } = await resolve(session, SALES_TEAM_VIEW_TEAM);
  const team = allowed && Array.isArray(constraints?.salesPersons) ? constraints.salesPersons.map(String) : [];
  return [...new Set([String(me), ...team])];
}

/** True if this session may see every sales person's customers. */
export async function seesAllSales(session) {
  return (await visibleSalesPersons(session)) === null;
}

/** ids from an array or "a,b,c"; null when nothing (or "all") was asked for. */
export function parseSalesPersonList(requested) {
  const list = Array.isArray(requested)
    ? requested.map(String).filter(Boolean)
    : typeof requested === "string" && requested.trim() && requested.trim() !== "all"
      ? requested.split(",").map((s) => s.trim()).filter(Boolean)
      : null;
  return list?.length ? list : null;
}

/**
 * Sales-person ids a report should be limited to, given what was asked for.
 *   · sees-all user: the request as-is (null = every sales person)
 *   · anyone else:   what they asked for, cut down to whom they may see
 *                    (nothing asked = all of those); asking only for somebody
 *                    outside it yields NO_SALES_PERSON, never everything
 *
 * @param {object} session
 * @param {string|string[]|null|undefined} requested  ids, or "a,b,c"
 * @returns {Promise<string[]|null>}
 */
export async function scopedSalesPersons(session, requested) {
  const list = parseSalesPersonList(requested);
  const visible = await visibleSalesPersons(session);
  if (visible === null) return list?.length ? list : null;
  if (!list?.length) return visible;
  const allowed = list.filter((id) => visible.includes(String(id)));
  return allowed.length ? allowed : [NO_SALES_PERSON];
}

/** Prisma `where` fragment for ACNO limited to this session's customers ({} = all). */
export async function customerScopeWhere(session) {
  const visible = await visibleSalesPersons(session);
  return visible === null ? {} : { salesArea: { in: visible } };
}

/** Customer account numbers this session may see, or null for "all". */
export async function scopedCustomerAcnos(session) {
  const visible = await visibleSalesPersons(session);
  if (visible === null) return null;
  const rows = await prisma.aCNO.findMany({
    where: { macno: { in: await getCustomerMacnos() }, salesArea: { in: visible } },
    select: { acno: true },
  });
  return rows.map((r) => r.acno);
}
