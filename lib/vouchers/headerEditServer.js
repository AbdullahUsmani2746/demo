// lib/vouchers/headerEditServer.js — the ONE writer of header-only changes on
// a saved GRN / dispatch / return (lib/vouchers/headerEdit.js says which).
// Used by PATCH /api/voucher/[type]/header (the "Edit header" dialog, behind
// its feature switch) and /api/voucher/[type]/manual-no (always on).
// Nothing that posts is touched, so the document stays invoiced and needs no
// approval rule; the document's own right (`<type>.update`, checked by the
// route), its data scope and the period lock apply, a system-posted voucher is
// refused (rule 1); lib/prisma.js audits it.
import prisma from "@/lib/prisma";
import { VOUCHER_CONFIG } from "@/components/Category/constants";
import { documentScopeError } from "@/lib/auth/documentScope";
import { checkPeriodLock } from "@/lib/periodLock";
import { systemVoucherError } from "@/lib/vouchers/systemVouchers";
import { feature } from "@/lib/features/server";
import { cleanHeaderValue, headerEditFields } from "@/lib/vouchers/headerEdit";

export class HeaderEditError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Save `values` ({ field: text }) on document `tran_id` of route type `type`.
 * `only` limits the fields (e.g. ["manual_no"]). Returns { changed, values }.
 */
export async function saveHeaderFields({ type, tran_id, values, session, only = null }) {
  const tran_code = VOUCHER_CONFIG[type]?.tran_code;
  const fields = [];
  for (const f of headerEditFields(tran_code)) {
    if (only && !only.includes(f.name)) continue;
    if (f.feature && !(await feature(f.feature))) continue; // switched off → not written
    fields.push(f);
  }
  if (!fields.length) throw new HeaderEditError("This document has no header details that can be changed this way.");
  const id = Number(tran_id);
  if (!Number.isInteger(id) || id <= 0) throw new HeaderEditError("Pick the document.");

  const stored = await prisma.transactionsMaster.findFirst({
    where: { tran_id: id, tran_code },
    select: { tran_id: true, tran_code: true, dated: true, pycd: true, godown: true, godown2: true, rmk4: true, ...Object.fromEntries(fields.map((f) => [f.name, true])) },
  });
  if (!stored) throw new HeaderEditError("Document not found.", 404);
  const systemError = systemVoucherError(stored);
  if (systemError) throw new HeaderEditError(systemError, 403);
  const scopeError = await documentScopeError(session, tran_code, stored);
  if (scopeError) throw new HeaderEditError(scopeError, 403);
  const lockError = await checkPeriodLock(stored.dated, tran_code, { action: "update" });
  if (lockError) throw new HeaderEditError(lockError, 422);

  const data = {};
  for (const f of fields) {
    if (!values || !(f.name in values)) continue;
    const v = cleanHeaderValue(f, values[f.name]);
    if ((stored[f.name] ?? null) !== v) data[f.name] = v;
  }
  if (Object.keys(data).length) await prisma.transactionsMaster.update({ where: { tran_id: id }, data });
  const out = Object.fromEntries(fields.map((f) => [f.name, f.name in data ? data[f.name] : (stored[f.name] ?? null)]));
  return { changed: Object.keys(data), values: out };
}
