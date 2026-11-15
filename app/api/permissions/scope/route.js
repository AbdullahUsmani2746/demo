// app/api/permissions/scope/route.js
//
// Data scope for one PERSON or one DEPARTMENT — which customers / regions /
// godowns / … they may see and work with. Every dimension comes from
// lib/auth/scopeDimensions.js, so a new one appears here with no code change.
//
//   GET ?userId=…  | ?departmentId=…
//       → { dimensions, scopes, inherited?, options, departments }
//   PUT { userId | departmentId, dimension, mode, values }
//       Person:     ALL | OWN | LIST | INHERIT (= no personal rule → department)
//       Department: ALL | LIST
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { SCOPE_DIMENSIONS, dimensionByKey } from "@/lib/auth/scopeDimensions";
import { getAccountGroup } from "@/lib/accounts/accountSettings";

const USER_MODES = ["ALL", "OWN", "LIST", "INHERIT"];
const DEPT_MODES = ["ALL", "LIST"];

const hasDeptTable = () => Boolean(prisma.departmentScope);

/** Admin pick-list for a dimension, from its declarative `options`. */
async function optionsFor(dim, userId) {
  const o = dim.options;
  const fields = [...new Set([o.value, ...o.label, ...(dim.key === "customer" ? ["salesArea"] : [])])];
  const rows = await prisma[o.model].findMany({
    // accountGroup: the main accounts come from Finance → Account Settings.
    where: o.accountGroup
      ? { ...(o.where || {}), macno: { in: await getAccountGroup(o.accountGroup) } }
      : o.where,
    select: Object.fromEntries(fields.map((f) => [f, true])),
    ...(o.distinct && { distinct: o.distinct }),
    ...(o.orderBy && { orderBy: o.orderBy }),
  });
  return rows.map((r) => ({
    value: String(r[o.value]),
    label: o.label.map((f) => r[f]).filter((v) => v != null && v !== "").join(" — "),
    ...(dim.key === "customer" && userId ? { owned: r.salesArea === userId } : {}),
  }));
}

const asRule = (row) => (row ? { mode: row.mode, values: row.values ?? [] } : null);

export const GET = guard("permissions.manage", async (request) => {
  const { searchParams } = new URL(request.url);
  const userId = searchParams.get("userId");
  const departmentId = Number(searchParams.get("departmentId")) || null;
  // No subject → just the department list (for the page's picker).
  if (!userId && !departmentId) {
    const departments = await prisma.department.findMany({
      select: { id: true, dept_name: true, _count: { select: { user: true } } },
      orderBy: { id: "asc" },
    });
    return NextResponse.json({
      departments: departments.map((d) => ({ id: d.id, dept_name: d.dept_name, users: d._count.user })),
    });
  }

  const [departments, user] = await Promise.all([
    prisma.department.findMany({ select: { id: true, dept_name: true }, orderBy: { id: "asc" } }),
    userId ? prisma.user.findUnique({ where: { id: userId }, select: { departmentId: true } }) : null,
  ]);

  const deptForRules = departmentId ?? user?.departmentId ?? null;
  const [userRows, deptRows, optionLists] = await Promise.all([
    userId ? prisma.dataScope.findMany({ where: { userId } }) : [],
    deptForRules && hasDeptTable()
      ? prisma.departmentScope.findMany({ where: { departmentId: deptForRules } })
      : [],
    Promise.all(SCOPE_DIMENSIONS.map((d) => optionsFor(d, userId))),
  ]);

  const scopes = {};
  const inherited = {};
  SCOPE_DIMENSIONS.forEach((d) => {
    const deptRule = asRule(deptRows.find((r) => r.dimension === d.key));
    if (userId) {
      const own = asRule(userRows.find((r) => r.dimension === d.key));
      scopes[d.key] = own ?? { mode: "INHERIT", values: [] };
      inherited[d.key] = deptRule ?? { mode: "ALL", values: [] };
    } else {
      scopes[d.key] = deptRule ?? { mode: "ALL", values: [] };
    }
  });

  return NextResponse.json({
    // Metadata the admin page renders cards from (no options loaders).
    dimensions: SCOPE_DIMENSIONS.map(({ key, label, icon, ownable }) => ({ key, label, icon, ownable })),
    scopes,
    ...(userId && {
      inherited,
      department: departments.find((d) => d.id === user?.departmentId) ?? null,
    }),
    options: Object.fromEntries(SCOPE_DIMENSIONS.map((d, i) => [d.key, optionLists[i]])),
    departments,
    departmentTableReady: hasDeptTable(),
  });
});

export const PUT = guard("permissions.manage", async (request) => {
  const { userId, departmentId, dimension, mode, values = [] } = await request.json();
  const dim = dimensionByKey(dimension);
  const deptId = Number(departmentId) || null;

  if ((!userId && !deptId) || !dim) {
    return NextResponse.json(
      { error: "userId or departmentId, and a known dimension, are required" },
      { status: 400 },
    );
  }
  const modes = userId ? USER_MODES : DEPT_MODES;
  if (!modes.includes(mode) || (mode === "OWN" && !dim.ownable)) {
    return NextResponse.json({ error: `mode must be one of ${modes.join(" | ")}` }, { status: 400 });
  }
  if (mode === "LIST" && values.length === 0) {
    return NextResponse.json({ error: "Choose at least one value, or use All." }, { status: 400 });
  }
  const stored = mode === "LIST" ? values.map(String) : [];

  if (userId) {
    // INHERIT = remove the personal rule; the department's (if any) applies.
    if (mode === "INHERIT") {
      await prisma.dataScope.deleteMany({ where: { userId, dimension } });
      return NextResponse.json({ ok: true });
    }
    const scope = await prisma.dataScope.upsert({
      where: { userId_dimension: { userId, dimension } },
      create: { userId, dimension, mode, values: stored },
      update: { mode, values: stored },
    });
    return NextResponse.json(scope);
  }

  if (!hasDeptTable()) {
    return NextResponse.json(
      { error: "Department scope table is not set up yet — run prisma/sql/2026-10-21_department_scope.sql and prisma generate." },
      { status: 503 },
    );
  }
  // ALL = no department rule (same as having none) — remove it.
  if (mode === "ALL") {
    await prisma.departmentScope.deleteMany({ where: { departmentId: deptId, dimension } });
    return NextResponse.json({ ok: true });
  }
  const scope = await prisma.departmentScope.upsert({
    where: { departmentId_dimension: { departmentId: deptId, dimension } },
    create: { departmentId: deptId, dimension, mode, values: stored },
    update: { mode, values: stored },
  });
  return NextResponse.json(scope);
});
