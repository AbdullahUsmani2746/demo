import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import {
  CHECK_STATUS,
  CHECK_STATUSES,
  normalizeBank,
  normalizeText,
  normalizeStatus,
  startOfDay,
  serializeCheck,
} from "@/lib/accounts/checksInHand";
import { guard } from "@/lib/auth/route";

const withCustomer = {
  customer: { select: { acname: true, isActive: true, mainAccount: { select: { isActive: true } } } },
  depositBank: { select: { acno: true, acname: true } },
};

// GET /api/accounts/checks-in-hand/:id
export async function GET(_request, { params }) {
  try {
    const id = Number((await params).id);
    const row = await prisma.checksInHand.findUnique({
      where: { id },
      include: withCustomer,
    });
    if (!row) {
      return NextResponse.json({ error: "Cheque not found" }, { status: 404 });
    }
    return NextResponse.json({ data: serializeCheck(row) });
  } catch (error) {
    console.error("Error fetching cheque:", error);
    return NextResponse.json({ error: "Failed to fetch cheque" }, { status: 500 });
  }
}

// ─────────────────────────────────────────────────────────────────────────────
//  PATCH /api/accounts/checks-in-hand/:id
//  The status-only endpoint the desk uses day to day.
//
//  Body: { status: "CLEARED" | "PENDING", depDate?: <ISO date> }
//
//  Flipping to CLEARED stamps DEP_DATE with today's date automatically (the
//  caller may override it - e.g. back-dating a deposit that was actioned
//  yesterday). Flipping back to PENDING clears DEP_DATE again, so a cheque
//  never carries a deposit date it has not actually been deposited on.
// ─────────────────────────────────────────────────────────────────────────────
export const PATCH = guard("account.manage", async (request, { params }) => {
  try {
    const id = Number((await params).id);
    const body = await request.json();

    const status = normalizeBank(body?.status);
    if (!CHECK_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: "status must be one of: " + CHECK_STATUSES.join(", ") },
        { status: 400 }
      );
    }

    const existing = await prisma.checksInHand.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Cheque not found" }, { status: 404 });
    }

    // Clearing may also name the bank the cheque was transferred into. It is
    // NOT wiped when reverting to Pending: the transfer bank is usually chosen
    // on the entry form, before the cheque is deposited, so clearing it here
    // would silently throw away something the user typed. depDate alone is the
    // "actually deposited" stamp.
    const data = {
      status,
      depDate:
        status === CHECK_STATUS.CLEARED
          ? startOfDay(body?.depDate || new Date())
          : null,
    };
    if (body?.depAcno !== undefined) {
      data.depAcno = body.depAcno ? Number(body.depAcno) : null;
    }

    const updated = await prisma.checksInHand.update({
      where: { id },
      data,
      include: withCustomer,
    });

    return NextResponse.json({ data: serializeCheck(updated) });
  } catch (error) {
    console.error("Error updating cheque status:", error);
    return NextResponse.json(
      { error: "Failed to update cheque status" },
      { status: 500 }
    );
  }
});

// ─────────────────────────────────────────────────────────────────────────────
//  PUT /api/accounts/checks-in-hand/:id
//  Full edit of a cheque. Only fields present in the body are written, so a
//  partial payload will not blank out columns it does not mention.
// ─────────────────────────────────────────────────────────────────────────────
export const PUT = guard("account.manage", async (request, { params }) => {
  try {
    const id = Number((await params).id);
    const body = await request.json();

    const existing = await prisma.checksInHand.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Cheque not found" }, { status: 404 });
    }

    const data = {};

    if (body.acno !== undefined) {
      const acno = Number(body.acno);
      if (!acno) return NextResponse.json({ error: "Customer is required" }, { status: 400 });
      data.acno = acno;
    }

    if (body.bank !== undefined) {
      const bank = normalizeBank(body.bank);
      if (!bank) return NextResponse.json({ error: "Bank is required" }, { status: 400 });
      data.bank = bank;
    }

    if (body.chqNo !== undefined) {
      const chqNo = String(body.chqNo ?? "").trim().toUpperCase();
      if (!chqNo) return NextResponse.json({ error: "Cheque no. is required" }, { status: 400 });
      data.chqNo = chqNo;
    }

    if (body.chqDate !== undefined) {
      const chqDate = startOfDay(body.chqDate);
      if (Number.isNaN(chqDate.getTime())) {
        return NextResponse.json({ error: "Cheque date is invalid" }, { status: 400 });
      }
      data.chqDate = chqDate;
    }

    if (body.amount !== undefined) {
      const amount = Number(body.amount);
      if (!Number.isFinite(amount) || amount <= 0) {
        return NextResponse.json(
          { error: "Amount must be greater than zero" },
          { status: 400 }
        );
      }
      data.amount = amount;
    }

    if (body.depAcno !== undefined) {
      data.depAcno = body.depAcno ? Number(body.depAcno) : null;
      if (data.depAcno !== null && !Number.isFinite(data.depAcno)) {
        return NextResponse.json({ error: "Transfer bank is invalid" }, { status: 400 });
      }
    }

    if (body.chqRcvDate !== undefined) {
      data.chqRcvDate = body.chqRcvDate ? startOfDay(body.chqRcvDate) : null;
    }
    if (body.dated !== undefined && body.dated) {
      data.dated = startOfDay(body.dated);
    }
    if (body.rmk !== undefined) data.rmk = normalizeText(body.rmk);
    if (body.chqBrBy !== undefined) data.chqBrBy = normalizeText(body.chqBrBy);

    // Status handled with the same auto-stamp rule as PATCH, so editing a row
    // and flipping its status in one save behaves identically.
    if (body.status !== undefined) {
      const status = normalizeStatus(body.status);
      data.status = status;
      data.depDate =
        status === CHECK_STATUS.CLEARED
          ? startOfDay(body.depDate || existing.depDate || new Date())
          : null;
    } else if (body.depDate !== undefined && existing.status === CHECK_STATUS.CLEARED) {
      data.depDate = body.depDate ? startOfDay(body.depDate) : null;
    }

    // Guard the natural key if any part of it moved.
    const nextAcno = data.acno ?? existing.acno;
    const nextBank = data.bank ?? existing.bank;
    const nextChqNo = data.chqNo ?? existing.chqNo;
    if (data.acno || data.bank || data.chqNo) {
      const clash = await prisma.checksInHand.findFirst({
        where: {
          id: { not: id },
          acno: nextAcno,
          bank: nextBank,
          chqNo: nextChqNo,
        },
        select: { id: true },
      });
      if (clash) {
        return NextResponse.json(
          { error: "Another cheque with the same customer, bank and number already exists" },
          { status: 409 }
        );
      }
    }

    const updated = await prisma.checksInHand.update({
      where: { id },
      data,
      include: withCustomer,
    });

    return NextResponse.json({ data: serializeCheck(updated) });
  } catch (error) {
    console.error("Error updating cheque:", error);
    return NextResponse.json({ error: "Failed to update cheque" }, { status: 500 });
  }
});

// DELETE /api/accounts/checks-in-hand/:id
export const DELETE = guard("account.manage", async (_request, { params }) => {
  try {
    const id = Number((await params).id);
    const existing = await prisma.checksInHand.findUnique({ where: { id } });
    if (!existing) {
      return NextResponse.json({ error: "Cheque not found" }, { status: 404 });
    }
    await prisma.checksInHand.delete({ where: { id } });
    return NextResponse.json({ data: { id } });
  } catch (error) {
    console.error("Error deleting cheque:", error);
    return NextResponse.json({ error: "Failed to delete cheque" }, { status: 500 });
  }
});
