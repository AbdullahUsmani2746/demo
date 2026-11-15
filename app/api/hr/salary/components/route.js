// /api/hr/salary/components
//   GET   pay components (with how many salaries use each)
//   POST  component form → create (hr.salary.manage)
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { HR_PERMS } from "@/lib/hr/access";
import { hrRoute, jsonBody } from "@/lib/hr/route";
import { componentData } from "@/lib/hr/salary/components";

export const GET = hrRoute([HR_PERMS.salaryView, HR_PERMS.salaryManage, HR_PERMS.salaryApprove], async () => {
  const rows = await prisma.hrPayComponent.findMany({
    orderBy: [{ is_active: "desc" }, { kind: "asc" }, { sort: "asc" }, { id: "asc" }],
    include: { _count: { select: { lines: true } } },
  });
  const acnos = [...new Set(rows.map((r) => r.gl_acno).filter(Boolean))];
  const accounts = acnos.length ? await prisma.aCNO.findMany({ where: { acno: { in: acnos } }, select: { acno: true, acname: true } }) : [];
  const accName = new Map(accounts.map((a) => [a.acno, a.acname]));
  return NextResponse.json({
    components: rows.map(({ _count, ...c }) => ({ ...c, used: _count.lines, gl_name: c.gl_acno ? accName.get(c.gl_acno) ?? null : null })),
  });
});

export const POST = hrRoute([HR_PERMS.salaryManage], async (req) => {
  const data = componentData(await jsonBody(req));
  if (await prisma.hrPayComponent.findUnique({ where: { code: data.code } })) {
    return NextResponse.json({ error: `Code ${data.code} is already used.` }, { status: 409 });
  }
  if (data.gl_acno && !(await prisma.aCNO.findUnique({ where: { acno: data.gl_acno }, select: { acno: true } }))) {
    return NextResponse.json({ error: `Account ${data.gl_acno} does not exist.` }, { status: 400 });
  }
  const component = await prisma.hrPayComponent.create({ data });
  return NextResponse.json({ component, message: `${component.name} created.` }, { status: 201 });
});
