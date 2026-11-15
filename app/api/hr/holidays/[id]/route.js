// /api/hr/holidays/[id] — DELETE a holiday (not one payroll has already paid).
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { HR_PERMS } from "@/lib/hr/access";
import { hrRoute, intParam } from "@/lib/hr/route";
import { dayKeyOfDb } from "@/lib/hr/time";

export const DELETE = hrRoute([HR_PERMS.holidays], async (req, { params }) => {
  const id = intParam((await params).id);
  const h = await prisma.hrHoliday.findUnique({ where: { id } });
  if (!h) return NextResponse.json({ error: "Holiday not found." }, { status: 404 });
  const locked = await prisma.hrAttendance.count({ where: { date: h.date, locked: true } });
  if (locked) return NextResponse.json({ error: "Payroll has been posted for this day — the holiday stays." }, { status: 409 });
  await prisma.hrHoliday.delete({ where: { id } });
  return NextResponse.json({ success: true, message: `${dayKeyOfDb(h.date)} (${h.name}) is a normal day again.` });
});
