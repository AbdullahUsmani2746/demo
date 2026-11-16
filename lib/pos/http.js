// lib/pos/http.js — POS route helpers: one error shape for every POS API.
import { NextResponse } from "next/server";

/** A thrown PosError / 422 refusal (stock, accounts, period lock) → JSON; anything else → 500. */
export function posErrorResponse(error, where = "POS") {
  const status = Number(error?.status || error?.statusCode);
  if (status >= 400 && status < 500) {
    return NextResponse.json({ error: error.message, ...(error.shortages ? { shortages: error.shortages } : {}) }, { status });
  }
  console.error(`[${where}]`, error);
  return NextResponse.json({ error: "Something went wrong — nothing was saved. Try again." }, { status: 500 });
}

/** Any point-of-sale right at all (screens that only read). */
export const hasPosAccess = (rights) => rights.sell || rights.refund || rights.manage || rights.allShifts || rights.dayClose;

/** Receipts a person may see: their own, or every till with pos.allShifts. */
export function receiptScope(session, rights) {
  return rights.allShifts ? {} : { user_id: String(session.user.id) };
}
