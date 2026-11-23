// PATCH /api/voucher/[type]/manual-no   body { tran_id, manual_no } → { ok, manual_no }
//
// Sets ONLY the paper-book number (TransactionsMaster.manual_no: Dispatch
// "Manual DC No", GRN / Dispatch Return "Manual GRN No") on a saved document —
// also on an invoiced one, which stays invoiced: no stock, qty, amount,
// invoice no or GST row is touched, so nothing has to be unlocked.
// Same right as editing that document (`<type>.update`), the user's document
// scope and the period lock (action "update"); never a system-posted voucher
// (rule 1). A dispatch's Manual DC No follows Settings → Features
// "dispatch.extraFields": off → nothing new is written. Audited by lib/prisma.js.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { VOUCHER_CONFIG } from "@/components/Category/constants";
import { setAuditActor } from "@/lib/audit/context";
import { guardBy } from "@/lib/auth/route";
import { documentScopeError } from "@/lib/auth/documentScope";
import { checkPeriodLock } from "@/lib/periodLock";
import { systemVoucherError } from "@/lib/vouchers/systemVouchers";
import { feature } from "@/lib/features/server";

// GRN (4), Dispatch (6), Dispatch Return (10) — the documents with a manual no.
const MANUAL_NO_CODES = [4, 6, 10];

export const PATCH = guardBy(
  async (req, { params }) => `${(await params).type}.update`,
  async (req, { params, session }) => {
    setAuditActor(session);
    const { type } = await params;
    const tran_code = VOUCHER_CONFIG[type]?.tran_code;
    if (!MANUAL_NO_CODES.includes(tran_code)) {
      return NextResponse.json({ message: "This document has no manual number." }, { status: 400 });
    }
    if (tran_code === 6 && !(await feature("dispatch.extraFields"))) {
      return NextResponse.json({ message: "Manual DC No is switched off (Settings → Features)." }, { status: 403 });
    }

    let body = null;
    try {
      body = await req.json();
    } catch {
      body = null;
    }
    const tran_id = Number(body?.tran_id);
    if (!Number.isInteger(tran_id) || tran_id <= 0) {
      return NextResponse.json({ message: "Pick the document." }, { status: 400 });
    }

    const stored = await prisma.transactionsMaster.findFirst({
      where: { tran_id, tran_code },
      select: { tran_id: true, tran_code: true, dated: true, pycd: true, godown: true, godown2: true, manual_no: true, rmk4: true },
    });
    if (!stored) return NextResponse.json({ message: "Document not found." }, { status: 404 });

    const systemError = systemVoucherError(stored);
    if (systemError) return NextResponse.json({ message: systemError }, { status: 403 });

    const scopeError = await documentScopeError(session, tran_code, stored);
    if (scopeError) return NextResponse.json({ message: scopeError }, { status: 403 });

    const lockError = await checkPeriodLock(stored.dated, tran_code, { action: "update" });
    if (lockError) return NextResponse.json({ message: lockError }, { status: 422 });

    const manual_no = String(body?.manual_no ?? "").trim().toUpperCase().slice(0, 50) || null;
    if ((stored.manual_no ?? null) === manual_no) return NextResponse.json({ ok: true, manual_no });

    await prisma.transactionsMaster.update({ where: { tran_id }, data: { manual_no } });
    return NextResponse.json({ ok: true, manual_no });
  },
);
