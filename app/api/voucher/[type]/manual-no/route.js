// PATCH /api/voucher/[type]/manual-no   body { tran_id, manual_no } → { ok, manual_no }
//
// Sets ONLY the paper-book number (TransactionsMaster.manual_no: Dispatch
// "Manual DC No", GRN / Dispatch Return "Manual GRN No") on a saved document —
// also on an invoiced one, which stays invoiced. Always on (no feature switch
// of its own; a dispatch's Manual DC No follows "dispatch.extraFields").
// The writer is the header dialog's (lib/vouchers/headerEditServer.js):
// `<type>.update`, the user's document scope, the period lock, never a
// system-posted voucher (rule 1); audited.
import { NextResponse } from "next/server";
import { setAuditActor } from "@/lib/audit/context";
import { guardBy } from "@/lib/auth/route";
import { feature } from "@/lib/features/server";
import { HeaderEditError, saveHeaderFields } from "@/lib/vouchers/headerEditServer";
import { headerEditFields } from "@/lib/vouchers/headerEdit";
import { VOUCHER_CONFIG } from "@/components/Category/constants";

export const PATCH = guardBy(
  async (req, { params }) => `${(await params).type}.update`,
  async (req, { params, session }) => {
    setAuditActor(session);
    const { type } = await params;
    const field = headerEditFields(VOUCHER_CONFIG[type]?.tran_code).find((f) => f.name === "manual_no");
    if (!field) {
      return NextResponse.json({ message: "This document has no manual number." }, { status: 400 });
    }
    if (field.feature && !(await feature(field.feature))) {
      return NextResponse.json({ message: `${field.label} is switched off (Settings → Features).` }, { status: 403 });
    }
    let body = null;
    try {
      body = await req.json();
    } catch {
      body = null;
    }
    try {
      const r = await saveHeaderFields({ type, tran_id: body?.tran_id, values: { manual_no: body?.manual_no }, session, only: ["manual_no"] });
      return NextResponse.json({ ok: true, manual_no: r.values.manual_no });
    } catch (e) {
      if (e instanceof HeaderEditError) return NextResponse.json({ message: e.message }, { status: e.status });
      throw e;
    }
  },
);
