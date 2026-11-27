// PATCH /api/voucher/[type]/header   body { tran_id, values: { field: text } }
//   → { ok, changed, values }
//
// Header details of a saved GRN / dispatch / return — also an invoiced one,
// which stays invoiced (lib/vouchers/headerEdit.js lists the fields; nothing
// that posts can change). Only while Settings → Features → "Edit header
// details on invoiced documents" is on. Same right as editing that document
// (`<type>.update`), its data scope and the period lock; audited.
import { NextResponse } from "next/server";
import { setAuditActor } from "@/lib/audit/context";
import { guardBy } from "@/lib/auth/route";
import { feature } from "@/lib/features/server";
import { HEADER_EDIT_FEATURE } from "@/lib/vouchers/headerEdit";
import { HeaderEditError, saveHeaderFields } from "@/lib/vouchers/headerEditServer";

export const PATCH = guardBy(
  async (req, { params }) => `${(await params).type}.update`,
  async (req, { params, session }) => {
    setAuditActor(session);
    if (!(await feature(HEADER_EDIT_FEATURE))) {
      return NextResponse.json({ message: "Editing header details of an invoiced document is switched off (Settings → Features)." }, { status: 403 });
    }
    const { type } = await params;
    let body = null;
    try {
      body = await req.json();
    } catch {
      body = null;
    }
    try {
      const r = await saveHeaderFields({ type, tran_id: body?.tran_id, values: body?.values ?? {}, session });
      return NextResponse.json({ ok: true, ...r });
    } catch (e) {
      if (e instanceof HeaderEditError) return NextResponse.json({ message: e.message }, { status: e.status });
      throw e;
    }
  },
);
