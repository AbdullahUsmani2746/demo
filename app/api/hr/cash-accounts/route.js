// /api/hr/cash-accounts — cash & bank accounts this person may pay from /
// receive into (Finance → Account Settings → Cash & Bank, narrowed by their
// "Cash & Bank Accounts" data scope; locked accounts left out). lib/hr/vouchers.js.
import { NextResponse } from "next/server";
import { HR_PERMS } from "@/lib/hr/access";
import { hrRoute } from "@/lib/hr/route";
import { cashBankAccounts } from "@/lib/hr/vouchers";

export const GET = hrRoute([HR_PERMS.loanDisburse, HR_PERMS.payrollPay], async (req, { session }) => {
  return NextResponse.json({ accounts: await cashBankAccounts(session) });
});
