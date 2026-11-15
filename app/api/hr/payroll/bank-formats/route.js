// /api/hr/payroll/bank-formats — salary transfer file layouts per bank
// (Settings "hr.bank_file_formats", lib/hr/payroll/bankFile.js).
//   GET → { formats, banks: [{ id, name }] }        hr.payroll.bankfile / payroll rights
//   PUT { default, formats: [...] }                 hr.payroll.bankfile
// Feature hr.bankDisbursement.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { HR_PERMS } from "@/lib/hr/access";
import { hrRoute, jsonBody, requireFeature } from "@/lib/hr/route";
import { getBankFormats, saveBankFormats } from "@/lib/hr/settingsData";

export const GET = hrRoute([HR_PERMS.bankFile, HR_PERMS.payrollView, HR_PERMS.payrollManage], async () => {
  await requireFeature("hr.bankDisbursement");
  const [formats, banks] = await Promise.all([getBankFormats(), prisma.bank.findMany({ select: { id: true, name: true }, orderBy: { name: "asc" } })]);
  return NextResponse.json({ formats, banks: banks.map((b) => ({ id: b.id, name: b.name || `Bank ${b.id}` })) });
});

export const PUT = hrRoute([HR_PERMS.bankFile], async (req) => {
  await requireFeature("hr.bankDisbursement");
  const formats = await saveBankFormats(await jsonBody(req));
  return NextResponse.json({ formats, message: "Bank file layouts saved." });
});
