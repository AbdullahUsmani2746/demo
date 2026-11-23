// app/api/hr/approval-chains/route.js — Admin → Permissions → Approvals →
// "HR approval chains" (lib/hr/chains.js).
//
//   GET                       → { chains, docTypes, loanKinds, stepTypes,
//                                 fallbacks, fallbackOptions, users, roles,
//                                 locations, departments }
//   POST   { …chain }         → create
//   PUT    { id, …chain }     → update (requests already filed keep their copy)
//   PUT    { fallbacks }      → "When no chain fits", per request type
//   DELETE ?id=               → delete (requests already filed carry on)
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { activeRoleCodes } from "@/lib/auth/roleCatalog";
import {
  CHAIN_DOC_TYPES,
  FALLBACK_OPTIONS,
  LOAN_KIND_OPTIONS,
  STEP_TYPES,
  cleanChain,
  getFallbacks,
  saveFallbacks,
} from "@/lib/hr/chains";

const wrap = (fn) => async (req, ctx) => {
  try {
    return await fn(req, ctx);
  } catch (e) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: e.status || 400 });
  }
};

export const GET = guard(
  "permissions.manage",
  wrap(async () => {
    const [chains, users, roles, locations, departments, fallbacks, open] = await Promise.all([
      prisma.hrApprovalChain.findMany({ orderBy: [{ doc_type: "asc" }, { sort: "asc" }, { id: "asc" }] }),
      prisma.user.findMany({ where: { isActive: true }, select: { id: true, name: true, email: true, role: true }, orderBy: { name: "asc" } }),
      activeRoleCodes(),
      prisma.workLocation.findMany({ select: { id: true, location_name: true }, orderBy: { id: "asc" } }),
      prisma.department.findMany({ select: { id: true, dept_name: true }, orderBy: { dept_name: "asc" } }),
      getFallbacks(),
      prisma.approvalRequest.groupBy({ by: ["chain_id"], where: { chain_id: { not: null }, status: { in: ["pending", "posting"] } }, _count: { _all: true } }),
    ]);
    const pending = new Map(open.map((o) => [o.chain_id, o._count._all]));
    return NextResponse.json({
      chains: chains.map((c) => ({ ...c, pending: pending.get(c.id) || 0 })),
      docTypes: Object.entries(CHAIN_DOC_TYPES).map(([value, t]) => ({ value, ...t })),
      loanKinds: LOAN_KIND_OPTIONS,
      stepTypes: STEP_TYPES,
      fallbacks,
      fallbackOptions: FALLBACK_OPTIONS,
      users: users.map((u) => ({ id: u.id, name: u.name || u.email, role: u.role })),
      roles,
      locations: locations.map((l) => ({ id: l.id, name: l.location_name })),
      departments: departments.map((d) => ({ id: d.id, name: d.dept_name })),
    });
  }),
);

export const POST = guard(
  "permissions.manage",
  wrap(async (req, { session }) => {
    const data = cleanChain(await req.json(), { roles: await activeRoleCodes() });
    const chain = await prisma.hrApprovalChain.create({ data: { ...data, created_by: session.user.id } });
    return NextResponse.json({ chain, message: `Chain "${chain.name}" added.` }, { status: 201 });
  }),
);

export const PUT = guard(
  "permissions.manage",
  wrap(async (req) => {
    const body = await req.json();
    if (body?.fallbacks) {
      const fallbacks = await saveFallbacks(body.fallbacks);
      return NextResponse.json({ fallbacks, message: "Saved." });
    }
    const id = Number(body?.id);
    if (!Number.isInteger(id)) throw new Error("Which chain?");
    const data = cleanChain(body, { roles: await activeRoleCodes() });
    const chain = await prisma.hrApprovalChain.update({ where: { id }, data });
    return NextResponse.json({ chain, message: `Chain "${chain.name}" saved — new requests follow it; requests already waiting keep their steps.` });
  }),
);

export const DELETE = guard(
  "permissions.manage",
  wrap(async (req) => {
    const id = Number(new URL(req.url).searchParams.get("id"));
    if (!Number.isInteger(id)) throw new Error("Which chain?");
    await prisma.hrApprovalChain.delete({ where: { id } });
    return NextResponse.json({ message: "Chain deleted — requests already waiting finish on their own steps." });
  }),
);
