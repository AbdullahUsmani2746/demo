// /api/hr/shifts — HR shifts.
//   GET   every shift + how many active employees work it today
//   POST  shift form → create (lib/hr/shifts.js validates)
import { NextResponse } from "next/server";
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { HR_PERMS } from "@/lib/hr/access";
import { hrRoute, jsonBody } from "@/lib/hr/route";
import { shiftData } from "@/lib/hr/shifts";
import { SHIFT_SELECT } from "@/lib/hr/attendance/sheet";
import { todayKey } from "@/lib/hr/time";

/** shift id → active employees whose assignment in force today is that shift. */
async function headcountByShift() {
  const rows = await prisma.$queryRaw`
    SELECT cur.shift_id, COUNT(*)::int AS n
      FROM (SELECT DISTINCT ON (a.employee_id) a.employee_id, a.shift_id
              FROM "hr_shift_assignments" a
             WHERE a.effective_from <= ${todayKey()}::date
             ORDER BY a.employee_id, a.effective_from DESC) cur
      JOIN "Employee" e ON e.id = cur.employee_id AND e.status = 'ACTIVE'
     GROUP BY cur.shift_id`;
  return new Map(rows.map((r) => [r.shift_id, Number(r.n)]));
}

export const GET = hrRoute(Object.values(HR_PERMS), async () => {
  const [shifts, counts] = await Promise.all([
    prisma.hrShift.findMany({ select: SHIFT_SELECT, orderBy: [{ is_active: "desc" }, { start_time: "asc" }] }),
    headcountByShift(),
  ]);
  return NextResponse.json({ shifts: shifts.map((s) => ({ ...s, employees: counts.get(s.id) ?? 0 })) });
});

export const POST = hrRoute([HR_PERMS.shifts], async (req, { session }) => {
  const data = shiftData(await jsonBody(req));
  try {
    const shift = await prisma.hrShift.create({ data: { ...data, created_by: session.user.id }, select: SHIFT_SELECT });
    return NextResponse.json({ shift, message: `Shift ${shift.code} created.` }, { status: 201 });
  } catch (e) {
    if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === "P2002") {
      return NextResponse.json({ error: `Code ${data.code} is already used by another shift.` }, { status: 409 });
    }
    throw e;
  }
});
