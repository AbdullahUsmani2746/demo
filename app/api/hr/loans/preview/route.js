// /api/hr/loans/preview — the plan and the checks before applying.
//   POST { employee_id?, kind, amount, installment, start_month }
//   → { count, plan: [{ month, planned, balance }], flags, gross }
import { NextResponse } from "next/server";
import { HR_PERMS } from "@/lib/hr/access";
import { hrRoute, jsonBody } from "@/lib/hr/route";
import { loanActor } from "@/lib/hr/loans/access";
import { loanData, policyFlags, thisMonth } from "@/lib/hr/loans/service";
import { schedule } from "@/lib/hr/loans/schedule";

export const POST = hrRoute([HR_PERMS.loanApply, HR_PERMS.loanManage], async (req, { session }) => {
  const b = await jsonBody(req);
  const who = await loanActor(session, b.employee_id ? Number(b.employee_id) : null);
  const d = await loanData({ ...b, employee_id: who.employeeId });
  const { flags, gross } = await policyFlags({ employee_id: who.employeeId, kind: d.kind, amount: d.amount });
  const plan = schedule({ ...d, skip_months: [], status: "active" }, [], thisMonth());
  return NextResponse.json({ count: d.count, plan: plan.map((r) => ({ month: r.month, planned: r.planned, balance: r.balance })), flags, gross });
});
