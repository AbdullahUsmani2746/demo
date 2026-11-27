// /api/hr/letters — HR letters of one employee (lib/hr/letters/*).
//
//   GET  ?employee_id=   → { letters, employee, defaults, company, can: { issue, templates } }
//   POST { action: "preview" | "issue", employee_id, kind, dated, details, subject?, body? }
//        preview → the letter's text (nothing saved); issue → stored, returned
//
// Right hr.letters.issue (hr.letters.templates may read too); the employee must
// be in the person's HR scope (lib/hr/access.js).
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertEmployeesInScope, hrRights, HR_PERMS } from "@/lib/hr/access";
import { hrRoute, intParam, jsonBody, requireFeature } from "@/lib/hr/route";
import { getCompany } from "@/lib/company";
import { getLetterhead } from "@/lib/hr/letters/letterhead";
import { employeeLetterVars, issueLetter, letterRow, previewLetter } from "@/lib/hr/letters/service";

const READ = [HR_PERMS.lettersIssue, HR_PERMS.lettersTemplates];

export const GET = hrRoute(READ, async (req, { session }) => {
  await requireFeature("hr.letters"); // Settings → Features
  const employeeId = intParam(new URL(req.url).searchParams.get("employee_id"), "employee");
  await assertEmployeesInScope(session, [employeeId]);
  const [rows, rights, company, emp, letterhead] = await Promise.all([
    prisma.hrLetter.findMany({ where: { employee_id: employeeId }, orderBy: [{ dated: "desc" }, { id: "desc" }] }),
    hrRights(session),
    getCompany(),
    employeeLetterVars(employeeId),
    getLetterhead(),
  ]);
  const users = await prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.issued_by))] } }, select: { id: true, name: true, email: true } });
  const nameOf = new Map(users.map((u) => [u.id, u.name || u.email]));
  return NextResponse.json({
    letters: rows.map((r) => letterRow(r, nameOf)),
    employee: { id: employeeId, name: emp.vars.employee_name, designation: emp.vars.designation, department: emp.vars.department },
    defaults: emp.defaults,
    company: company ? { name: company.name, address: (company.address ?? []).filter(Boolean).join(", ") || null } : null,
    letterhead,
    can: { issue: rights.lettersIssue, templates: rights.lettersTemplates },
  });
});

export const POST = hrRoute([HR_PERMS.lettersIssue], async (req, { session }) => {
  await requireFeature("hr.letters"); // Settings → Features
  const b = await jsonBody(req);
  const employeeId = intParam(b.employee_id, "employee");
  await assertEmployeesInScope(session, [employeeId]);
  const args = { employeeId, kind: String(b.kind || ""), dated: b.dated, details: b.details || {} };
  if (b.action === "preview") {
    const p = await previewLetter(args);
    return NextResponse.json({ subject: p.subject, body: p.body, dated: p.dated });
  }
  if (b.action !== "issue") return NextResponse.json({ error: "action must be preview or issue" }, { status: 400 });
  const letter = await issueLetter({ ...args, subject: b.subject, body: b.body, session });
  return NextResponse.json({ letter: letterRow(letter), message: `${letter.ref_no} issued.` }, { status: 201 });
});
