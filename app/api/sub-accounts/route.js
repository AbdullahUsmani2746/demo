// app/api/sub-accounts/route.js
// ============================================================
// Sub Accounts of an account (model subAccount) — the "Sub Account" field on
// Payment / Receipt / Journal lines and Finance → Sub Accounts. Feature
// "vouchers.subAccounts" (lib/vouchers/subAccounts.js); switched off → 403.
//
// GET    ?acno=2531[&search=FUEL]   → { data: [{ id, acname }] } of that account
// GET    ?acno=2531&acname=FUEL     → that one (the form looks a saved name up)
// GET    ?acno=2531&required=1      → { required } — the account's main account is
//                                      in Account Settings "sub_account_groups"
// POST   { acno, acname }           → the sub account, saved in CAPS; one that
//                                      already exists for the account is returned
//                                      (subAccount.manage, or creating receipts /
//                                      payments / journals — "Add new" on a line)
// PUT    { id, acname }             → rename (subAccount.manage; only while no
//                                      voucher line uses it)
// DELETE ?id=7                      → delete (subAccount.manage; only while unused)
// ============================================================
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { can } from "@/lib/auth/permissions";
import { feature } from "@/lib/features/server";
import {
  SUB_ACCOUNT_FEATURE,
  accountsNeedingSubAccount,
  cleanSubAccount,
} from "@/lib/vouchers/subAccounts";

const MANAGE = "subAccount.manage";
// Entering one of these vouchers lets a person add a sub account from its line.
const VOUCHER_CREATE = ["payment.create", "receipt.create", "journal.create"];

const OFF = () =>
  NextResponse.json(
    { error: "Sub Accounts are switched off (Settings → Features)." },
    { status: 403 },
  );

/** Voucher lines that carry this sub account (by its account + name). */
async function usageCount(sub) {
  const rows = await prisma.transactions.findMany({
    where: { acno: sub.acno, sub_account: { equals: sub.acname, mode: "insensitive" } },
    select: { id: true },
    take: 1,
  });
  return rows.length;
}

export const GET = guard(null, async (request) => {
  if (!(await feature(SUB_ACCOUNT_FEATURE))) return OFF();
  const p = new URL(request.url).searchParams;
  const acno = Number(p.get("acno"));

  if (p.get("required") === "1") {
    if (!acno) return NextResponse.json({ required: false });
    return NextResponse.json({ required: (await accountsNeedingSubAccount([acno])).has(acno) });
  }

  if (!acno) return NextResponse.json({ data: [] });
  const exact = cleanSubAccount(p.get("acname"));
  const search = (p.get("search") || "").trim();
  const data = await prisma.subAccount.findMany({
    where: {
      acno,
      ...(exact
        ? { acname: { equals: exact, mode: "insensitive" } }
        : search
          ? { acname: { contains: search, mode: "insensitive" } }
          : {}),
    },
    select: { id: true, acname: true },
    orderBy: { acname: "asc" },
    take: 50,
  });
  return NextResponse.json({ data });
});

export const POST = guard(null, async (request, { session }) => {
  if (!(await feature(SUB_ACCOUNT_FEATURE))) return OFF();
  const allowed =
    (await can(session, MANAGE)) ||
    (await Promise.all(VOUCHER_CREATE.map((c) => can(session, c)))).some(Boolean);
  if (!allowed) {
    return NextResponse.json(
      { error: `You do not have permission to add sub accounts (${MANAGE}).`, permission: MANAGE },
      { status: 403 },
    );
  }

  const body = await request.json().catch(() => ({}));
  const acno = Number(body?.acno?.value ?? body?.acno);
  const acname = cleanSubAccount(body?.acname);
  if (!acno) return NextResponse.json({ error: "Select the A/c Name first" }, { status: 400 });
  if (!acname) return NextResponse.json({ error: "Sub Account name is required" }, { status: 400 });
  if (String(body?.acname).trim().length > 250) {
    return NextResponse.json({ error: "Sub Account name is too long (250 characters at most)" }, { status: 400 });
  }

  const account = await prisma.aCNO.findUnique({ where: { acno }, select: { acno: true } });
  if (!account) return NextResponse.json({ error: `Account ${acno} not found` }, { status: 400 });

  const existing = await prisma.subAccount.findFirst({
    where: { acno, acname: { equals: acname, mode: "insensitive" } },
    select: { id: true, acno: true, acname: true },
  });
  if (existing) return NextResponse.json(existing);

  const created = await prisma.subAccount.create({
    data: { acno, acname },
    select: { id: true, acno: true, acname: true },
  });
  return NextResponse.json(created, { status: 201 });
});

export const PUT = guard(MANAGE, async (request) => {
  if (!(await feature(SUB_ACCOUNT_FEATURE))) return OFF();
  const body = await request.json().catch(() => ({}));
  const id = Number(body?.id);
  const acname = cleanSubAccount(body?.acname);
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  if (!acname) return NextResponse.json({ error: "Sub Account name is required" }, { status: 400 });

  const sub = await prisma.subAccount.findUnique({ where: { id } });
  if (!sub) return NextResponse.json({ error: "Sub Account not found" }, { status: 404 });
  if (cleanSubAccount(sub.acname) === acname) return NextResponse.json(sub);
  // Lines store the name, so a used sub account keeps it (books never change behind a voucher).
  if (await usageCount(sub)) {
    return NextResponse.json(
      { error: `"${sub.acname}" is used on vouchers and cannot be renamed. Add a new sub account instead.` },
      { status: 422 },
    );
  }
  const clash = await prisma.subAccount.findFirst({
    where: { acno: sub.acno, id: { not: id }, acname: { equals: acname, mode: "insensitive" } },
    select: { id: true },
  });
  if (clash) return NextResponse.json({ error: `"${acname}" already exists under this account` }, { status: 422 });

  const updated = await prisma.subAccount.update({ where: { id }, data: { acname } });
  return NextResponse.json(updated);
});

export const DELETE = guard(MANAGE, async (request) => {
  if (!(await feature(SUB_ACCOUNT_FEATURE))) return OFF();
  const id = Number(new URL(request.url).searchParams.get("id"));
  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });
  const sub = await prisma.subAccount.findUnique({ where: { id } });
  if (!sub) return NextResponse.json({ error: "Sub Account not found" }, { status: 404 });
  if (await usageCount(sub)) {
    return NextResponse.json(
      { error: `"${sub.acname}" is used on vouchers and cannot be deleted.` },
      { status: 422 },
    );
  }
  await prisma.subAccount.delete({ where: { id } });
  return NextResponse.json({ ok: true, message: `Deleted "${sub.acname}"` });
});
