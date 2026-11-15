// /api/hr/leave/types/[id]
//   PUT     edit (new entitlement rules apply to every balance at once)
//   DELETE  only a type never used — otherwise switch it off
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { HR_PERMS } from "@/lib/hr/access";
import { hrRoute, intParam, jsonBody } from "@/lib/hr/route";
import { leaveTypeData } from "@/lib/hr/leave/types";

export const PUT = hrRoute([HR_PERMS.leaveManage], async (req, { params }) => {
  const id = intParam((await params).id);
  const data = leaveTypeData(await jsonBody(req));
  const clash = await prisma.hrLeaveType.findFirst({ where: { code: data.code, NOT: { id } } });
  if (clash) return NextResponse.json({ error: `Code ${data.code} is already used.` }, { status: 409 });
  const type = await prisma.hrLeaveType.update({ where: { id }, data });
  return NextResponse.json({ type, message: `${type.name} saved.` });
});

export const DELETE = hrRoute([HR_PERMS.leaveManage], async (req, { params }) => {
  const id = intParam((await params).id);
  const [requests, days, balances] = await Promise.all([
    prisma.hrLeaveRequest.count({ where: { leave_type_id: id } }),
    prisma.hrAttendance.count({ where: { leave_type_id: id } }),
    prisma.hrLeaveBalance.count({ where: { leave_type_id: id } }),
  ]);
  if (requests || days || balances) {
    return NextResponse.json({ error: "This leave type has been used — switch it off instead of deleting it." }, { status: 409 });
  }
  const type = await prisma.hrLeaveType.delete({ where: { id } });
  return NextResponse.json({ success: true, message: `${type.name} deleted.` });
});
