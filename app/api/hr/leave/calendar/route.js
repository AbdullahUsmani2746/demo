// /api/hr/leave/calendar — who is on leave in a month (approved and pending).
//   GET ?month=YYYY-MM&department=&q=
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { employeeFilter, HR_PERMS } from "@/lib/hr/access";
import { hrRoute } from "@/lib/hr/route";
import { EMPLOYEE_SELECT, employeeLite } from "@/lib/hr/attendance/sheet";
import { dayKeyOfDb, dbDay, monthRange, todayKey } from "@/lib/hr/time";

export const GET = hrRoute([HR_PERMS.leaveView, HR_PERMS.leaveManage, HR_PERMS.leaveApprove], async (req, { session }) => {
  const sp = new URL(req.url).searchParams;
  const range = monthRange(sp.get("month")) ?? monthRange(todayKey().slice(0, 7));
  const [leaves, holidays] = await Promise.all([
    prisma.hrLeaveRequest.findMany({
      where: {
        status: { in: ["approved", "pending"] },
        from_date: { lte: dbDay(range.to) },
        to_date: { gte: dbDay(range.from) },
        employee: await employeeFilter(session, sp),
      },
      orderBy: [{ from_date: "asc" }],
      include: { employee: { select: EMPLOYEE_SELECT }, leaveType: { select: { id: true, code: true, name: true, color: true } } },
    }),
    prisma.hrHoliday.findMany({ where: { date: { gte: dbDay(range.from), lte: dbDay(range.to) } } }),
  ]);
  return NextResponse.json({
    month: range.from.slice(0, 7),
    from: range.from,
    to: range.to,
    today: todayKey(),
    holidays: holidays.map((h) => ({ date: dayKeyOfDb(h.date), name: h.name })),
    leaves: leaves.map((l) => ({
      id: l.id,
      employee: employeeLite(l.employee),
      type: l.leaveType,
      from: dayKeyOfDb(l.from_date),
      to: dayKeyOfDb(l.to_date),
      half_day: l.half_day,
      days: l.days,
      status: l.status,
    })),
  });
});
