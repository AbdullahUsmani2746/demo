// app/api/reports/account-order/route.js — "Arrange accounts" on Funds Flow /
// Funds Position. Each user keeps their own order (lib/reports/accountOrder.js).
//   GET    ?report=fundsFlow|fundsPosition   → { report, accounts, updatedAt }
//   PUT    { report, accounts: [acno, ...] } → save the caller's order
//   DELETE ?report=…                         → back to the default order
// Needs the report's own view right (report.<type>.view). Writes go through
// lib/prisma.js, so they are in the audit trail (Settings row).
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { authorize, authErrorResponse } from "@/lib/auth/route";
import {
  ACCOUNT_ORDER_MAX,
  ACCOUNT_ORDER_REPORTS,
  accountOrderKey,
  cleanAccountList,
  parseAccountOrder,
} from "@/lib/reports/accountOrder";

const bad = (error, status = 400) => NextResponse.json({ error }, { status });

// Validate the report key, then check the caller may view that report.
async function access(report) {
  if (!ACCOUNT_ORDER_REPORTS.includes(report)) {
    return { res: bad("Account order is only available on Funds Flow and Funds Position.") };
  }
  try {
    const { session } = await authorize(`report.${report}.view`);
    return { session, key: accountOrderKey(report, session.user.id) };
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return { res };
    throw error;
  }
}

function payload(report, row) {
  let updatedAt = null;
  try {
    updatedAt = row?.value ? JSON.parse(row.value)?.updatedAt ?? null : null;
  } catch {
    updatedAt = null;
  }
  return { report, accounts: parseAccountOrder(row?.value), updatedAt };
}

export async function GET(req) {
  const report = new URL(req.url).searchParams.get("report");
  const { res, key } = await access(report);
  if (res) return res;
  const row = await prisma.settings.findUnique({ where: { key }, select: { value: true } });
  return NextResponse.json(payload(report, row));
}

export async function PUT(req) {
  let body;
  try {
    body = await req.json();
  } catch {
    return bad("Invalid request body.");
  }
  const report = body?.report;
  const { res, key, session } = await access(report);
  if (res) return res;

  const accounts = cleanAccountList(body?.accounts);
  if (!accounts) {
    return bad(`accounts must be a list of up to ${ACCOUNT_ORDER_MAX} account numbers.`);
  }

  const value = JSON.stringify({ accounts, updatedAt: new Date().toISOString() });
  const description = `Account order on ${report} for ${session.user.name || session.user.email || session.user.id}`.slice(0, 190);
  const row = await prisma.settings.upsert({
    where: { key },
    update: { value, description },
    create: { key, value, description },
    select: { value: true },
  });
  return NextResponse.json({ ...payload(report, row), message: "Order saved" });
}

export async function DELETE(req) {
  const report = new URL(req.url).searchParams.get("report");
  const { res, key } = await access(report);
  if (res) return res;
  // deleteMany: no error when nothing was saved
  await prisma.settings.deleteMany({ where: { key } });
  return NextResponse.json({ report, accounts: [], updatedAt: null, message: "Default order restored" });
}
