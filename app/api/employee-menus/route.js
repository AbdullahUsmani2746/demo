// app/api/employee-menus/route.js — Settings → Employee menus.
//
//   GET                 → { employees, menus, meta }
//                         employees [{ id, name, code, department, departmentId,
//                                      status, role, menuCount }]
//                         menus     the active menu rows the tree is built from
//                         meta      { canEdit, myEmployeeId, fullMenuRoles }
//   GET ?employeeId=    → { menuIds }  that employee's direct employee_menu rows
//   GET ?menuId=        → { employeeIds, inherited: [{ employeeId, viaMenuId }] }
//                         direct rows on that menu, and employees who get it
//                         through a row on a menu above it (buildMenu adds
//                         every active descendant of an assigned menu)
//   PUT { employeeId, menuIds }  → replace that employee's rows
//   PUT { menuId, employeeIds }  → replace who has a direct row on that menu
//
// Same permission codes as the generic setup route for this entity:
// setup.employee_menus.view (read; .manage also reads) and
// setup.employee_menus.manage (write). No data scope applies — employee_menus
// is not a scoped setup entity (lib/auth/scopeDimensions.js).
//
// Writes go through `prisma` (lib/prisma.js) in one transaction, so every
// added / removed row is audited, parented to the Employee (lib/audit/catalog.js
// AUDIT_PARENTS.employee_menu). Rows on switched-off menus are left alone on an
// employee save — the screen does not show those menus, so it cannot mean to
// remove them.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { authorize, authErrorResponse } from "@/lib/auth/route";
import { setAuditActor } from "@/lib/audit/context";
import { can } from "@/lib/auth/permissions";
import { resolveEmployeeId } from "@/lib/menu/sessionEmployee";
import { listRoles, roleCodesByUser } from "@/lib/auth/roleCatalog";

const VIEW = "setup.employee_menus.view";
const MANAGE = "setup.employee_menus.manage";
const MAX_MENU_IDS = 2000;
const MAX_EMPLOYEE_IDS = 5000;

const bad = (error, status = 400) => NextResponse.json({ error }, { status });

const toId = (v) => {
  const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
  return Number.isInteger(n) && n > 0 && n <= 2147483647 ? n : null;
};

/** A list of positive integer ids, de-duplicated, or null when anything is off. */
function idList(value, max) {
  if (!Array.isArray(value) || value.length > max) return null;
  const out = new Set();
  for (const v of value) {
    const id = toId(v);
    if (id == null) return null;
    out.add(id);
  }
  return [...out];
}

async function access() {
  const { session } = await authorize(null);
  const canEdit = await can(session, MANAGE);
  const canView = canEdit || (await can(session, VIEW));
  return { session, canEdit, canView };
}

const fail = (error) => {
  const res = authErrorResponse(error);
  if (res) return res;
  console.error("[employee-menus]", error);
  return bad(error?.message || "Something went wrong", 500);
};

const fullName = (e) => [e.firstName, e.middleName, e.surname].filter(Boolean).join(" ").trim();

export async function GET(req) {
  try {
    const { session, canEdit, canView } = await access();
    if (!canView) return bad(`You do not have permission to view employee menus (${VIEW}).`, 403);

    const sp = new URL(req.url).searchParams;

    if (sp.has("employeeId")) {
      const employeeId = toId(sp.get("employeeId"));
      if (!employeeId) return bad("employeeId must be a whole number");
      const rows = await prisma.employee_menu.findMany({ where: { employee_id: employeeId }, select: { menu_id: true } });
      return NextResponse.json({ menuIds: rows.map((r) => r.menu_id).sort((a, b) => a - b) });
    }

    if (sp.has("menuId")) {
      const menuId = toId(sp.get("menuId"));
      if (!menuId) return bad("menuId must be a whole number");
      const all = await prisma.menus.findMany({ select: { id: true, parent_id: true, is_active: true } });
      const byId = new Map(all.map((m) => [m.id, m]));
      if (!byId.has(menuId)) return bad("No such menu", 404);
      // Menus above this one whose row would give it: walk up while active —
      // buildMenu goes down only through active menus.
      const above = [];
      const seen = new Set([menuId]);
      for (let p = byId.get(menuId).parent_id; p != null && !seen.has(p); p = byId.get(p)?.parent_id) {
        const m = byId.get(p);
        if (!m || !m.is_active) break;
        seen.add(p);
        above.push(p);
      }
      const rows = await prisma.employee_menu.findMany({
        where: { menu_id: { in: [menuId, ...above] } },
        select: { employee_id: true, menu_id: true },
      });
      const employeeIds = [...new Set(rows.filter((r) => r.menu_id === menuId).map((r) => r.employee_id))].sort((a, b) => a - b);
      const direct = new Set(employeeIds);
      const inherited = new Map();
      // nearest menu above wins as the "via" label
      for (const via of above) {
        for (const r of rows) {
          if (r.menu_id === via && !direct.has(r.employee_id) && !inherited.has(r.employee_id)) inherited.set(r.employee_id, via);
        }
      }
      return NextResponse.json({
        employeeIds,
        inherited: [...inherited].map(([employeeId, viaMenuId]) => ({ employeeId, viaMenuId })),
      });
    }

    const [employees, menus, myEmployeeId] = await Promise.all([
      prisma.employee.findMany({
        select: {
          id: true,
          firstName: true,
          middleName: true,
          surname: true,
          status: true,
          departmentId: true,
          department: { select: { dept_name: true } },
          user: { select: { id: true, role: true } },
          _count: { select: { employee_menu: true } },
        },
        orderBy: [{ firstName: "asc" }, { surname: "asc" }, { id: "asc" }],
      }),
      prisma.menus.findMany({
        where: { is_active: true },
        select: { id: true, title: true, url: true, icon: true, parent_id: true, order_no: true },
      }),
      resolveEmployeeId(session),
    ]);

    // Roles that show the whole menu (Admin → Roles) — their menus here change nothing.
    const roleList = await listRoles();
    const allMenuRoles = roleList.filter((r) => r.is_active && r.nav_mode === "all").map((r) => r.code);
    const roleName = new Map(roleList.map((r) => [r.code, r.name]));
    const rolesBy = await roleCodesByUser(employees.map((e) => e.user).filter(Boolean));
    return NextResponse.json({
      employees: employees.map((e) => ({
        id: e.id,
        code: e.id,
        name: fullName(e) || `Employee ${e.id}`,
        departmentId: e.departmentId,
        department: e.department?.dept_name || null,
        status: e.status,
        role: e.user?.role ? roleName.get(e.user.role) ?? e.user.role : null,
        fullMenu: !!e.user && (rolesBy.get(String(e.user.id)) || []).some((c) => allMenuRoles.includes(c)),
        menuCount: e._count?.employee_menu ?? 0,
      })),
      menus,
      meta: { canEdit, myEmployeeId: toId(myEmployeeId) },
    });
  } catch (error) {
    return fail(error);
  }
}

export async function PUT(req) {
  try {
    const { session, canEdit } = await access();
    if (!canEdit) return bad(`You do not have permission to change employee menus (${MANAGE}).`, 403);
    setAuditActor(session); // here, in the function that writes (lib/audit/context.js)

    let body;
    try {
      body = await req.json();
    } catch {
      return bad("The request body is not valid JSON");
    }

    // ── one employee, their whole set ───────────────────────────────
    if (body?.employeeId != null) {
      const employeeId = toId(body.employeeId);
      if (!employeeId) return bad("employeeId must be a whole number");
      const menuIds = idList(body.menuIds, MAX_MENU_IDS);
      if (!menuIds) return bad(`menuIds must be a list of at most ${MAX_MENU_IDS} whole numbers`);

      const employee = await prisma.employee.findUnique({ where: { id: employeeId }, select: { id: true } });
      if (!employee) return bad("No such employee", 404);
      const found = menuIds.length
        ? await prisma.menus.findMany({ where: { id: { in: menuIds } }, select: { id: true, is_active: true } })
        : [];
      const activeIds = new Set(found.filter((m) => m.is_active).map((m) => m.id));
      const wrong = menuIds.filter((id) => !activeIds.has(id));
      if (wrong.length) return bad(`These menus do not exist or are switched off: ${wrong.slice(0, 20).join(", ")}`);

      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.employee_menu.findMany({
          where: { employee_id: employeeId },
          select: { menu_id: true, menu: { select: { is_active: true } } },
        });
        const want = new Set(menuIds);
        const have = new Set(existing.map((r) => r.menu_id));
        // rows on switched-off menus are kept (not on the screen's tree)
        const removed = existing.filter((r) => r.menu?.is_active !== false && !want.has(r.menu_id)).map((r) => r.menu_id);
        const added = menuIds.filter((id) => !have.has(id));
        if (removed.length) {
          await tx.employee_menu.deleteMany({ where: { employee_id: employeeId, menu_id: { in: removed } } });
        }
        if (added.length) {
          await tx.employee_menu.createMany({
            data: added.map((menu_id) => ({ employee_id: employeeId, menu_id })),
            skipDuplicates: true,
          });
        }
        const now = await tx.employee_menu.findMany({ where: { employee_id: employeeId }, select: { menu_id: true } });
        return { added, removed, menuIds: now.map((r) => r.menu_id).sort((a, b) => a - b) };
      });
      return NextResponse.json({ ...result, employeeId, menuCount: result.menuIds.length });
    }

    // ── one menu, who has a direct row on it ────────────────────────
    if (body?.menuId != null) {
      const menuId = toId(body.menuId);
      if (!menuId) return bad("menuId must be a whole number");
      const employeeIds = idList(body.employeeIds, MAX_EMPLOYEE_IDS);
      if (!employeeIds) return bad(`employeeIds must be a list of at most ${MAX_EMPLOYEE_IDS} whole numbers`);

      const menu = await prisma.menus.findUnique({ where: { id: menuId }, select: { id: true, is_active: true } });
      if (!menu) return bad("No such menu", 404);
      if (!menu.is_active) return bad("This menu is switched off — switch it on in Menus first");
      const found = employeeIds.length
        ? await prisma.employee.findMany({ where: { id: { in: employeeIds } }, select: { id: true } })
        : [];
      const ok = new Set(found.map((e) => e.id));
      const wrong = employeeIds.filter((id) => !ok.has(id));
      if (wrong.length) return bad(`These employees do not exist: ${wrong.slice(0, 20).join(", ")}`);

      const result = await prisma.$transaction(async (tx) => {
        const existing = await tx.employee_menu.findMany({ where: { menu_id: menuId }, select: { employee_id: true } });
        const want = new Set(employeeIds);
        const have = new Set(existing.map((r) => r.employee_id));
        const removed = [...have].filter((id) => !want.has(id));
        const added = employeeIds.filter((id) => !have.has(id));
        if (removed.length) {
          await tx.employee_menu.deleteMany({ where: { menu_id: menuId, employee_id: { in: removed } } });
        }
        if (added.length) {
          await tx.employee_menu.createMany({
            data: added.map((employee_id) => ({ employee_id, menu_id: menuId })),
            skipDuplicates: true,
          });
        }
        return { added, removed };
      });
      return NextResponse.json({ ...result, menuId, employeeIds: [...employeeIds].sort((a, b) => a - b) });
    }

    return bad("Send { employeeId, menuIds } or { menuId, employeeIds }");
  } catch (error) {
    return fail(error);
  }
}
