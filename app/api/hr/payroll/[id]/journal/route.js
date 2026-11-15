// /api/hr/payroll/[id]/journal — the journal voucher this payroll posts (or
// posted), with account names, and anything missing in Account Settings.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { HR_PERMS } from "@/lib/hr/access";
import { hrRoute, intParam } from "@/lib/hr/route";
import { journalFor } from "@/lib/hr/payroll/post";

export const GET = hrRoute([HR_PERMS.payrollView, HR_PERMS.payrollManage, HR_PERMS.payrollApprove, HR_PERMS.payrollPost], async (req, { params }) => {
  const id = intParam((await params).id);
  const run = await prisma.hrPayrollRun.findUnique({
    where: { id },
    include: { payslips: { include: { employee: { select: { id: true, firstName: true, middleName: true, surname: true } } } } },
  });
  if (!run) return NextResponse.json({ error: "Payroll not found." }, { status: 404 });
  let lines;
  let missing = [];
  if (run.jv_tran_id) {
    lines = await prisma.transactions.findMany({ where: { tran_id: run.jv_tran_id }, select: { acno: true, ccno: true, damt: true, camt: true, narration1: true }, orderBy: { id: "asc" } });
  } else {
    const jv = await journalFor(run, run.payslips);
    lines = jv.lines;
    missing = jv.missing;
  }
  const acnos = [...new Set(lines.map((l) => l.acno).filter(Boolean))];
  const ccnos = [...new Set(lines.map((l) => l.ccno).filter(Boolean))];
  const [accounts, centres] = await Promise.all([
    prisma.aCNO.findMany({ where: { acno: { in: acnos } }, select: { acno: true, acname: true } }),
    ccnos.length ? prisma.costCenter.findMany({ where: { ccno: { in: ccnos } }, select: { ccno: true, ccname: true } }) : [],
  ]);
  const acName = new Map(accounts.map((a) => [a.acno, a.acname]));
  const ccName = new Map(centres.map((c) => [c.ccno, c.ccname]));
  const out = lines
    .map((l) => ({ ...l, acname: acName.get(l.acno) ?? null, ccname: l.ccno ? ccName.get(l.ccno) ?? null : null }))
    .sort((a, b) => (b.damt || 0) - (a.damt || 0) || String(a.acname).localeCompare(String(b.acname)));
  const debit = out.reduce((s, l) => s + (l.damt || 0), 0);
  const credit = out.reduce((s, l) => s + (l.camt || 0), 0);
  return NextResponse.json({ posted: Boolean(run.jv_tran_id), tran_id: run.jv_tran_id, lines: out, missing, debit, credit });
});
