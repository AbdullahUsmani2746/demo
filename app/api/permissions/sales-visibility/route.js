// app/api/permissions/sales-visibility/route.js — Admin → Permissions → Sales visibility.
//
// Whose customers each person sees on every sales screen (lib/auth/salesScope.js):
//   all  — salesTeam.viewAll
//   team — own + chosen sales persons: salesTeam.viewTeam, constraints.salesPersons
//   own  — neither (the default)
//
//   GET → { people: [{ id, name, role, mode, team, locked, viaRole }], salesPersons }
//   PUT { userId, mode, team? } → sets the person's two grants to match
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { guard } from "@/lib/auth/route";
import { FULL_ACCESS_ROLES, SALES_TEAM_VIEW_ALL } from "@/lib/auth/permissions";
import { roleCodesByUser, userRoleCodes } from "@/lib/auth/roleCatalog";
import { SALES_TEAM_VIEW_TEAM } from "@/lib/auth/salesScope";
import { getCustomerMacnos } from "@/lib/accounts/partyMacnos";

async function permissionIds() {
  const rows = await prisma.permission.findMany({
    where: { code: { in: [SALES_TEAM_VIEW_ALL, SALES_TEAM_VIEW_TEAM] } },
    select: { id: true, code: true },
  });
  const by = Object.fromEntries(rows.map((r) => [r.code, r.id]));
  return { all: by[SALES_TEAM_VIEW_ALL], team: by[SALES_TEAM_VIEW_TEAM] };
}

export const GET = guard("permissions.manage", async () => {
  const ids = await permissionIds();
  const [users, grants, counts] = await Promise.all([
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: "asc" },
    }),
    prisma.permissionGrant.findMany({
      where: { permissionId: { in: [ids.all, ids.team].filter(Boolean) } },
      select: { permissionId: true, userId: true, role: true, allow: true, constraints: true },
    }),
    prisma.aCNO.groupBy({
      by: ["salesArea"],
      where: { macno: { in: await getCustomerMacnos() }, salesArea: { not: null } },
      _count: { _all: true },
    }),
  ]);
  const customersOf = new Map(counts.map((c) => [c.salesArea, c._count._all]));
  const rolesBy = await roleCodesByUser(users);

  const userGrant = (pid, uid) => grants.find((g) => g.permissionId === pid && g.userId === uid);
  // Any of the person's roles (a deny on one of them wins).
  const roleGrant = (pid, roles) => {
    const g = grants.filter((x) => x.permissionId === pid && x.role && roles.includes(x.role));
    return g.length ? { allow: g.every((x) => x.allow) } : null;
  };
  const ownerIds = new Set(customersOf.keys());

  const people = users.map((u) => {
    const roles = rolesBy.get(String(u.id)) || [];
    const locked = roles.some((r) => FULL_ACCESS_ROLES.includes(r));
    const allU = userGrant(ids.all, u.id);
    const allR = roleGrant(ids.all, roles);
    const teamU = userGrant(ids.team, u.id);
    const seesAll = locked || (allU ? allU.allow : Boolean(allR?.allow));
    const team = teamU?.allow && Array.isArray(teamU.constraints?.salesPersons) ? teamU.constraints.salesPersons : [];
    return {
      id: u.id,
      name: u.name || u.email,
      role: u.role,
      locked,
      viaRole: !allU && Boolean(allR?.allow),
      mode: seesAll ? "all" : team.length ? "team" : "own",
      team,
      ownCustomers: customersOf.get(u.id) || 0,
      isSalesPerson: ownerIds.has(u.id),
    };
  });

  return NextResponse.json({
    people,
    salesPersons: people.filter((p) => p.isSalesPerson).map((p) => ({ id: p.id, name: p.name, customers: p.ownCustomers })),
  });
});

export const PUT = guard("permissions.manage", async (request, { session }) => {
  const { userId, mode, team = [] } = await request.json();
  if (!userId || !["all", "team", "own"].includes(mode)) {
    return NextResponse.json({ error: "userId and mode (all | team | own) are required" }, { status: 400 });
  }
  const ids = await permissionIds();
  if (!ids.all || !ids.team) {
    return NextResponse.json({ error: "Run prisma/sql/2026-10-25_phase3_approvals.sql (or node scripts/seed-permissions.mjs --apply) first (salesTeam.viewTeam missing)." }, { status: 409 });
  }
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { id: true, role: true } });
  if (!user) return NextResponse.json({ error: "User not found" }, { status: 404 });
  const roles = await userRoleCodes(user.id, user.role);
  if (roles.some((r) => FULL_ACCESS_ROLES.includes(r))) {
    return NextResponse.json({ error: "A Super Admin always sees all sales." }, { status: 400 });
  }

  const roleSeesAll = await prisma.permissionGrant.findFirst({
    where: { permissionId: ids.all, role: { in: roles }, allow: true },
    select: { id: true },
  });
  const by = session.user.id;
  const setUserGrant = (permissionId, allow, constraints = Prisma.DbNull) =>
    prisma.permissionGrant.upsert({
      where: { permissionId_userId: { permissionId, userId } },
      update: { allow, constraints, grantedById: by },
      create: { permissionId, userId, allow, constraints, grantedById: by },
    });
  const dropUserGrant = (permissionId) => prisma.permissionGrant.deleteMany({ where: { permissionId, userId } });
  const cleanTeam = [...new Set(team.map(String).filter((t) => t && t !== userId))];

  const ops =
    mode === "all"
      ? [setUserGrant(ids.all, true), dropUserGrant(ids.team)]
      : mode === "team"
        ? [
            // their role may see all — a personal deny keeps them to the team
            roleSeesAll ? setUserGrant(ids.all, false) : dropUserGrant(ids.all),
            setUserGrant(ids.team, true, { salesPersons: cleanTeam }),
          ]
        : [roleSeesAll ? setUserGrant(ids.all, false) : dropUserGrant(ids.all), dropUserGrant(ids.team)];
  await prisma.$transaction(ops);

  return NextResponse.json({ success: true, message: "Sales visibility saved" });
});
