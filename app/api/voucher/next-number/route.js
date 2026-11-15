// /api/voucher/next-number?type=grn|dispatch
//
// Preview of the next GRN No / Dispatch No — shown read-only on Create GRN and
// Create Dispatch. Returns { nextNo }.
//
// The real number is NOT assigned by the app: the BEFORE INSERT trigger
// trigger_auto_numbers (auto_assign_numbers(), see sequence.txt) overwrites
// TRANSACTIONS_MASTER.grn_no / dispatch_no with nextval('grn_no_seq' /
// 'dispatch_no_seq') on every tran_code 4 / 6 insert, ignoring whatever the
// form sent. So the preview reads that same sequence — WITHOUT nextval, so
// opening a form never burns a number.
//
// Not MAX(grn_no) + 1: imported and *_off_seq numbers (5,000,000+) sit in the
// same column, and MAX would point at those instead of the live sequence.
//
// It is a preview only: two users creating at once both see the same number,
// and the database gives each its own on save.
//
// NOTE: the on/off split in sequence.txt (grn_no_off_seq / dispatch_no_off_seq
// for inactive parties) is dormant. If it is ever switched on, an off party's
// number would come from the *_off sequence and this preview would need pycd.

import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

// Whitelist — the sequence name never comes from the request.
const SEQUENCES = {
  grn: "grn_no_seq",
  dispatch: "dispatch_no_seq",
};

export async function GET(request) {
  const type = new URL(request.url).searchParams.get("type");
  const seqName = SEQUENCES[type];

  if (!seqName) {
    return NextResponse.json(
      { error: "type must be 'grn' or 'dispatch'" },
      { status: 400 },
    );
  }

  try {
    // Reads the sequence's single row — no table scan, no lock, no nextval.
    // seqName is from the whitelist above, never from the request.
    const [row] = await prisma.$queryRawUnsafe(
      `SELECT last_value, is_called FROM public."${seqName}"`,
    );

    // is_called = false right after SETVAL(..., false) (how sequence.txt seeds
    // these): the next nextval returns last_value itself, not last_value + 1.
    const last = Number(row.last_value);
    const nextNo = row.is_called ? last + 1 : last;

    return NextResponse.json({ nextNo }, { status: 200 });
  } catch (error) {
    console.error("Error fetching next document number:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
