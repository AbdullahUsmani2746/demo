import { NextResponse } from 'next/server';
import prisma from '@/lib/prisma';
import { guard } from '@/lib/auth/route';
import { checkPeriodLock } from '@/lib/periodLock';
import { systemVoucherError } from '@/lib/vouchers/systemVouchers';

// ─────────────────────────────────────────────────────────────────────────────
//  SUPERSEDED — kept only so nothing that still holds the URL breaks.
//
//  The live document engine is app/api/voucher/[type]/route.js. Nothing in the
//  app calls this file any more: `submitVoucher` in lib/api.js is never
//  imported, and the one fetch that used it (uploadFiles in Form.jsx) is
//  defined but never invoked.
//
//  It stayed reachable all the same, and was dangerous: POST/PUT spread the
//  request body straight into TRANSACTIONS_MASTER (so a caller could set any
//  column, including tran_code, dated or user_id), and DELETE hard-deleted a
//  voucher and its lines by id — which CLAUDE.md states no API does, because
//  corrections are supposed to go through reversal documents.
//
//  All three are now behind an administrative permission, which in practice
//  means ADMIN/ACCOUNTANT only. This file should be deleted outright once you
//  confirm no integration outside this repo posts to it.
// ─────────────────────────────────────────────────────────────────────────────

export async function GET(request) {
  const { searchParams } = new URL(request.url);
  const type = searchParams.get('type');
  
  const tranCode = {
    payment: 2,
    receipt: 1,
    journal: 3
  }[type];

  const vouchers = await prisma.transactionsMaster.findMany({
    where: { tran_code: tranCode },
    include: { 
      transactions: true,
      acno:true,
      godownDetails:true,

    }
  });

  return NextResponse.json(vouchers);
}

export const POST = guard("maintenance.bulkUpdate", async (request, { session }) => {
  try {
    const data = await request.json();
    data.user_id = session?.user?.id ?? null; // Entered by — from the session, never the body

    const lockError = await checkPeriodLock(data.dated, data.tran_code, { action: "create" });
    if (lockError) {
      return NextResponse.json({ success: false, error: lockError }, { status: 422 });
    }

    const master = await prisma.transactionsMaster.create({
      data: {
        ...data,
        transactions: undefined
      }
    });

    if (data.transactions) {
      await prisma.transactions.createMany({
        data: data.transactions.map((t) => ({
          ...t,
          tran_id: master.tran_id
        }))
      });
    }

    return NextResponse.json({ success: true, data: master });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
});

export const PUT = guard("maintenance.bulkUpdate", async (request) => {
  try {
    const data = await request.json();

    const stored = await prisma.transactionsMaster.findUnique({
      where: { tran_id: data.tran_id },
      select: { dated: true, tran_code: true, rmk4: true },
    });
    const systemError = systemVoucherError(stored);
    if (systemError) {
      return NextResponse.json({ success: false, error: systemError }, { status: 422 });
    }
    const lockError = await checkPeriodLock(
      [stored?.dated, data.dated],
      data.tran_code ?? stored?.tran_code,
      { action: "update" },
    );
    if (lockError) {
      return NextResponse.json({ success: false, error: lockError }, { status: 422 });
    }

    const master = await prisma.transactionsMaster.update({
      where: { tran_id: data.tran_id },
      data: {
        ...data,
        transactions: undefined
      }
    });

    await prisma.transactions.deleteMany({
      where: { tran_id: data.tran_id }
    });

    if (data.transactions) {
      await prisma.transactions.createMany({
        data: data.transactions.map((t) => ({
          ...t,
          tran_id: master.tran_id
        }))
      });
    }

    return NextResponse.json({ success: true, data: master });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
});

export const DELETE = guard("maintenance.bulkUpdate", async (request) => {
  try {
    const { searchParams } = new URL(request.url);
    const id = parseInt(searchParams.get('id'));

    const stored = await prisma.transactionsMaster.findUnique({
      where: { tran_id: id },
      select: { dated: true, tran_code: true, rmk4: true },
    });
    const systemError = systemVoucherError(stored);
    if (systemError) {
      return NextResponse.json({ success: false, error: systemError }, { status: 422 });
    }
    const lockError = await checkPeriodLock(stored?.dated, stored?.tran_code, { action: "delete" });
    if (lockError) {
      return NextResponse.json({ success: false, error: lockError }, { status: 422 });
    }

    await prisma.transactions.deleteMany({
      where: { tran_id: id }
    });

    await prisma.transactionsMaster.delete({
      where: { tran_id: id }
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
});