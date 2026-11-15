// /api/hr/salary/components/[id]
//   PUT     edit (a change of fixed / % applies to every salary that has it)
//   DELETE  only one no salary uses — otherwise switch it off
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { HR_PERMS } from "@/lib/hr/access";
import { hrRoute, intParam, jsonBody } from "@/lib/hr/route";
import { componentData } from "@/lib/hr/salary/components";

export const PUT = hrRoute([HR_PERMS.salaryManage], async (req, { params }) => {
  const id = intParam((await params).id);
  const data = componentData(await jsonBody(req));
  if (await prisma.hrPayComponent.findFirst({ where: { code: data.code, NOT: { id } } })) {
    return NextResponse.json({ error: `Code ${data.code} is already used.` }, { status: 409 });
  }
  const before = await prisma.hrPayComponent.findUnique({ where: { id } });
  if (!before) return NextResponse.json({ error: "Not found." }, { status: 404 });
  const used = await prisma.hrSalaryLine.count({ where: { component_id: id } });
  if (used && (before.kind !== data.kind || before.calc !== data.calc)) {
    return NextResponse.json({ error: `${used} salary line(s) use this component — its type and calculation cannot change. Create a new one instead.` }, { status: 409 });
  }
  if (data.gl_acno && !(await prisma.aCNO.findUnique({ where: { acno: data.gl_acno }, select: { acno: true } }))) {
    return NextResponse.json({ error: `Account ${data.gl_acno} does not exist.` }, { status: 400 });
  }
  const component = await prisma.hrPayComponent.update({ where: { id }, data });
  return NextResponse.json({ component, message: `${component.name} saved.` });
});

export const DELETE = hrRoute([HR_PERMS.salaryManage], async (req, { params }) => {
  const id = intParam((await params).id);
  if (await prisma.hrSalaryLine.count({ where: { component_id: id } })) {
    return NextResponse.json({ error: "Salaries use this component — switch it off instead." }, { status: 409 });
  }
  const c = await prisma.hrPayComponent.delete({ where: { id } });
  return NextResponse.json({ success: true, message: `${c.name} deleted.` });
});
