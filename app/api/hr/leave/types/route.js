// /api/hr/leave/types
//   GET   every leave type
//   POST  leave-type form → create (hr.leave.manage)
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { HR_PERMS } from "@/lib/hr/access";
import { hrRoute, jsonBody } from "@/lib/hr/route";
import { leaveTypeData } from "@/lib/hr/leave/types";

export const GET = hrRoute(Object.values(HR_PERMS), async () => {
  const types = await prisma.hrLeaveType.findMany({
    orderBy: [{ is_active: "desc" }, { sort: "asc" }, { id: "asc" }],
    include: { _count: { select: { requests: true, attendance: true } } },
  });
  return NextResponse.json({ types: types.map(({ _count, ...t }) => ({ ...t, used: _count.requests + _count.attendance })) });
});

export const POST = hrRoute([HR_PERMS.leaveManage], async (req) => {
  const data = leaveTypeData(await jsonBody(req));
  if (await prisma.hrLeaveType.findUnique({ where: { code: data.code } })) {
    return NextResponse.json({ error: `Code ${data.code} is already used.` }, { status: 409 });
  }
  const type = await prisma.hrLeaveType.create({ data });
  return NextResponse.json({ type, message: `${type.name} created.` }, { status: 201 });
});
