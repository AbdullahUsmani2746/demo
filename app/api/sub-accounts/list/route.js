// app/api/sub-accounts/list/route.js
// ============================================================
// Every Sub Account (model subAccount) with its account — the options of the
// Account Ledger's "Sub Account" filter and the Finance → Sub Accounts screen.
// Feature "vouchers.subAccounts"; switched off → 403.
//
// GET [?acno=2531] → { data: [{ id, acname, acno, account_name, lines }], canManage }
//   lines = how many voucher lines carry it (a used one cannot be renamed / deleted)
// ============================================================
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { can } from "@/lib/auth/permissions";
import { feature } from "@/lib/features/server";
import { SUB_ACCOUNT_FEATURE, cleanSubAccount } from "@/lib/vouchers/subAccounts";

export const GET = guard(null, async (request, { session }) => {
  if (!(await feature(SUB_ACCOUNT_FEATURE))) {
    return NextResponse.json({ error: "Sub Accounts are switched off (Settings → Features)." }, { status: 403 });
  }
  const acno = Number(new URL(request.url).searchParams.get("acno")) || null;

  const [rows, used, canManage] = await Promise.all([
    prisma.subAccount.findMany({
      where: acno ? { acno } : {},
      select: { id: true, acname: true, acno: true, account: { select: { acname: true } } },
      orderBy: [{ acno: "asc" }, { acname: "asc" }],
    }),
    prisma.transactions.groupBy({
      by: ["acno", "sub_account"],
      where: { sub_account: { not: null }, ...(acno ? { acno } : {}) },
      _count: { _all: true },
    }),
    can(session, "subAccount.manage"),
  ]);

  const count = new Map();
  for (const u of used) {
    const key = `${u.acno}|${cleanSubAccount(u.sub_account)}`;
    count.set(key, (count.get(key) || 0) + u._count._all);
  }
  const data = rows.map((r) => ({
    id: r.id,
    acname: r.acname,
    acno: r.acno,
    account_name: r.account?.acname || "",
    lines: count.get(`${r.acno}|${cleanSubAccount(r.acname)}`) || 0,
  }));
  return NextResponse.json({ data, canManage });
});
