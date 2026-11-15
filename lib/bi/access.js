// lib/bi/access.js
// ============================================================
// BI access — who may build, which datasets, which dashboards.
//
//   Designer   — ADMIN / ACCOUNTANT, or anyone holding `bi.design`
//   Datasets   — BiDatasetAccess rows for the user's department; a department
//                with no rows may use every dataset (designers: all)
//   Dashboards — BiDashboardAssignment rows matching the user, their role, or
//                their department (designers can open any)
//
// Row limits (godowns, customers, …) are separate and always apply — they
// live in lib/bi/engine.js via lib/auth/scope.js.
// ============================================================
import prisma from "@/lib/prisma";
import { can, hasFullAccess } from "@/lib/auth/permissions";
import { rolesOf } from "@/lib/auth/roles";
import { BiError } from "./engine";

export const BI_DESIGN = "bi.design";

const biReady = () => Boolean(prisma.biDashboard);

export function assertBiReady() {
  if (!biReady()) {
    throw new BiError(
      "BI is not set up yet — run prisma/sql/2026-10-25_bi_dashboards.sql and prisma generate.",
      503,
    );
  }
}

export async function canDesign(session) {
  if (!session?.user?.id) return false;
  if (hasFullAccess(session)) return true;
  return can(session, BI_DESIGN);
}

async function userDepartmentId(session) {
  const u = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { departmentId: true },
  });
  return u?.departmentId ?? null;
}

/** Set of dataset keys this user may use, or null = all. */
export async function allowedDatasets(session) {
  if (await canDesign(session)) return null;
  const dept = await userDepartmentId(session);
  if (!dept) return null;
  const rows = await prisma.biDatasetAccess.findMany({ where: { department_id: dept } });
  return rows.length ? new Set(rows.map((r) => r.dataset)) : null;
}

/** Dashboards assigned to this user (landing first), active only. */
export async function dashboardsFor(session) {
  const dept = await userDepartmentId(session);
  const or = [{ user_id: session.user.id }];
  const roles = rolesOf(session);
  if (roles.length) or.push({ role: { in: roles } });
  if (dept) or.push({ department_id: dept });

  const rows = await prisma.biDashboardAssignment.findMany({
    where: { OR: or, dashboard: { is_active: true } },
    include: { dashboard: { select: { id: true, name: true, description: true, default_period: true } } },
  });
  // One entry per dashboard; landing wins; personal beats role beats department.
  const rank = (r) => (r.user_id ? 0 : r.role ? 1 : 2);
  const byId = new Map();
  for (const r of rows.sort((a, b) => rank(a) - rank(b))) {
    const cur = byId.get(r.dashboard_id);
    if (!cur) byId.set(r.dashboard_id, { ...r.dashboard, is_landing: r.is_landing });
    else if (r.is_landing) cur.is_landing = true;
  }
  return [...byId.values()].sort(
    (a, b) => Number(b.is_landing) - Number(a.is_landing) || a.name.localeCompare(b.name),
  );
}

export async function canViewDashboard(session, dashboardId) {
  if (await canDesign(session)) return true;
  const list = await dashboardsFor(session);
  return list.some((d) => d.id === Number(dashboardId));
}

/** Question ids used by a dashboard layout. */
export const layoutQuestionIds = (layout) =>
  [...new Set((layout?.sections ?? []).flatMap((s) => (s.items ?? []).map((i) => Number(i.questionId))))].filter(
    Number.isFinite,
  );

/**
 * Dashboard filters from the query string, one parameter per chosen value:
 * ?f_godown=MAIN&f_customer=A&f_customer=B. Values are never split on
 * commas — customer names such as "SUZHOU … CO.,LTD" contain them.
 */
// Filters every dashboard has, without being set up in the Designer: Book
// (On books / Off books — lib/bi/datasets.js BOOK_SQL). Like any dashboard
// filter it narrows only the questions whose dataset has the field.
export const BUILTIN_DASH_FILTERS = ["book"];

export function readDashFilters(url, layout) {
  const fields = [...new Set([...(layout?.filters ?? []).map((f) => f.field), ...BUILTIN_DASH_FILTERS])];
  return fields
    .map((field) => ({ field, value: url.searchParams.getAll(`f_${field}`).filter(Boolean) }))
    .filter((f) => f.value.length);
}
