// /api/hr/shifts/[id]
//   PUT     edit. New rules apply to every day not yet locked by payroll.
//   DELETE  only a shift nobody was ever assigned — otherwise switch it off.
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { HR_PERMS } from "@/lib/hr/access";
import { hrRoute, intParam, jsonBody } from "@/lib/hr/route";
import { shiftData } from "@/lib/hr/shifts";
import { SHIFT_SELECT } from "@/lib/hr/attendance/sheet";

export const PUT = hrRoute([HR_PERMS.shifts], async (req, { params }) => {
  const id = intParam((await params).id);
  const data = shiftData(await jsonBody(req));
  try {
    const shift = await prisma.hrShift.update({ where: { id }, data, select: SHIFT_SELECT });
    return NextResponse.json({ shift, message: `Shift ${shift.code} saved — its rules now apply to every open day.` });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: `Code ${data.code} is already used by another shift.` }, { status: 409 });
    }
    throw e;
  }
});

export const DELETE = hrRoute([HR_PERMS.shifts], async (req, { params }) => {
  const id = intParam((await params).id);
  const [assigned, days] = await Promise.all([
    prisma.hrShiftAssignment.count({ where: { shift_id: id } }),
    prisma.hrAttendance.count({ where: { shift_id: id } }),
  ]);
  if (assigned || days) {
    return NextResponse.json(
      { error: `This shift is in use (${assigned} assignment(s), ${days} attendance day(s)) — switch it off instead of deleting it.` },
      { status: 409 },
    );
  }
  const shift = await prisma.hrShift.delete({ where: { id } });
  return NextResponse.json({ success: true, message: `Shift ${shift.code} deleted.` });
});
