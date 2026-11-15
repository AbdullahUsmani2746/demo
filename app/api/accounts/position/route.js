// GET /api/accounts/position?acno=1102
//   The one-line position shown under an account picker on voucher forms
//   (lib/accounts/position.js): balance, and for a customer overdue / credit
//   left / open invoices, for a vendor open bills. Read-only.
//   → { position: {...} } or { position: null } (unknown, or a customer
//     outside the user's sales scope).
import { NextResponse } from "next/server";
import { authorize, authErrorResponse } from "@/lib/auth/route";
import { getAccountPosition } from "@/lib/accounts/position";

export async function GET(req) {
  let session;
  try {
    ({ session } = await authorize());
  } catch (error) {
    const res = authErrorResponse(error);
    if (res) return res;
    throw error;
  }

  try {
    const acno = new URL(req.url).searchParams.get("acno");
    return NextResponse.json({ position: await getAccountPosition(acno, session) });
  } catch (error) {
    console.error("GET /api/accounts/position:", error);
    return NextResponse.json({ error: "Failed to load the account position" }, { status: 500 });
  }
}
