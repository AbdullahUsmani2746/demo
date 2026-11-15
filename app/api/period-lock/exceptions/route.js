import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { dbDate, logPeriodLockEvent } from "@/lib/periodLock";
import { documentsSummary, parseDay, parseTranCodes, LOCK_ACTIONS } from "@/lib/periodLockCatalog";

// ============================================================
// /api/period-lock/exceptions — re-open locked dates for one user
//
// GET  → latest 300 exceptions, each with status: active | expired | revoked
// POST { user_id, date_from, date_to, tran_codes?: number[],
//        can_create, can_update, can_delete, override_month_lock?,
//        expires_at?: ISO string | null, reason }
// ============================================================

function exceptionStatus(e, now = new Date()) {
  if (!e.is_active) return "revoked";
  if (e.expires_at && new Date(e.expires_at) <= now) return "expired";
  return "active";
}

export const GET = guard("period.lock", async (request, { session }) => {
  try {

    const rows = await prisma.periodLockException.findMany({
      orderBy: [{ is_active: "desc" }, { granted_at: "desc" }],
      take: 300,
    });
    const now = new Date();
    return NextResponse.json(rows.map((e) => ({ ...e, status: exceptionStatus(e, now) })));
  } catch (error) {
    console.error("Period lock exceptions GET error:", error);
    return NextResponse.json({ error: "Failed to load exceptions" }, { status: 500 });
  }
});

export const POST = guard("period.lock", async (request, { session }) => {
  try {

    const body = await request.json();
    const from = parseDay(body.date_from);
    const to = parseDay(body.date_to);
    if (!from || !to) {
      return NextResponse.json({ error: "From and To dates are required" }, { status: 400 });
    }
    if (body.date_from > body.date_to) {
      return NextResponse.json({ error: "From date must be on or before To date" }, { status: 400 });
    }

    const codes = parseTranCodes(body.tran_codes);
    if (codes === null) {
      return NextResponse.json({ error: "Unknown document type in tran_codes" }, { status: 400 });
    }

    const can_create = body.can_create === true;
    const can_update = body.can_update === true;
    const can_delete = body.can_delete === true;
    if (!can_create && !can_update && !can_delete) {
      return NextResponse.json(
        { error: "Choose at least one action: Create, Edit or Delete" },
        { status: 400 },
      );
    }

    const reason = String(body.reason ?? "").trim();
    if (!reason) {
      return NextResponse.json({ error: "A reason is required" }, { status: 400 });
    }

    let expires_at = null;
    if (body.expires_at) {
      expires_at = new Date(body.expires_at);
      if (Number.isNaN(expires_at.getTime())) {
        return NextResponse.json({ error: "Invalid expiry time" }, { status: 400 });
      }
      if (expires_at <= new Date()) {
        return NextResponse.json({ error: "Expiry must be in the future" }, { status: 400 });
      }
    }

    const user = body.user_id
      ? await prisma.user.findUnique({
          where: { id: String(body.user_id) },
          select: { id: true, name: true, email: true, isActive: true },
        })
      : null;
    if (!user) return NextResponse.json({ error: "User not found" }, { status: 400 });
    if (!user.isActive) {
      return NextResponse.json({ error: "That user account is inactive" }, { status: 400 });
    }

    const exception = await prisma.periodLockException.create({
      data: {
        user_id: user.id,
        user_name: (user.name || user.email).slice(0, 150),
        date_from: dbDate(from),
        date_to: dbDate(to),
        tran_codes: codes,
        can_create,
        can_update,
        can_delete,
        override_month_lock: body.override_month_lock === true,
        expires_at,
        reason: reason.slice(0, 255),
        granted_by: session?.user?.email ?? null,
      },
    });

    const actions = LOCK_ACTIONS.filter((a) => exception[a.field]).map((a) => a.label).join("/");
    await logPeriodLockEvent("EXCEPTION_GRANT", {
      exception_id: exception.id,
      detail:
        `${exception.user_name}: ${actions} · ${body.date_from} to ${body.date_to} · ` +
        `${documentsSummary(codes)}${exception.override_month_lock ? " · incl. closed months" : ""}` +
        ` · until ${expires_at ? expires_at.toISOString() : "revoked"} · ${reason}`,
    });

    return NextResponse.json({ ...exception, status: "active" }, { status: 201 });
  } catch (error) {
    console.error("Period lock exceptions POST error:", error);
    return NextResponse.json({ error: "Failed to grant exception" }, { status: 500 });
  }
});
