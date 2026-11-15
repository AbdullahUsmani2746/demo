// /api/hr/salary/[employeeId] — one employee's salary history (every revision).
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertEmployeesInScope, HR_PERMS } from "@/lib/hr/access";
import { hrRoute, intParam } from "@/lib/hr/route";
import { STRUCTURE_INCLUDE, structureLite } from "@/lib/hr/salary/service";

export const GET = hrRoute([HR_PERMS.salaryView, HR_PERMS.salaryManage, HR_PERMS.salaryApprove], async (req, { params, session }) => {
  const id = intParam((await params).employeeId, "employee");
  await assertEmployeesInScope(session, [id]);
  const rows = await prisma.hrSalaryStructure.findMany({
    where: { employee_id: id },
    orderBy: [{ effective_from: "desc" }, { id: "desc" }],
    include: STRUCTURE_INCLUDE,
  });
  const users = await prisma.user.findMany({
    where: { id: { in: [...new Set(rows.flatMap((r) => [r.created_by, r.decided_by]).filter(Boolean))] } },
    select: { id: true, name: true, email: true },
  });
  const nameOf = new Map(users.map((u) => [u.id, u.name || u.email]));
  return NextResponse.json({
    history: rows.map((r) => ({
      ...structureLite(r),
      created_by: nameOf.get(r.created_by) ?? r.created_by,
      decided_by: r.decided_by ? nameOf.get(r.decided_by) ?? r.decided_by : null,
      decided_at: r.decided_at,
    })),
  });
});
