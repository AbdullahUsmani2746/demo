import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { can } from "@/lib/auth/permissions";
import {
  dayOf,
  dbDate,
  isPeriodLocked,
  findRangeLock,
  logPeriodLockEvent,
} from "@/lib/periodLock";
import { documentsSummary, parseDay, parseTranCodes } from "@/lib/periodLockCatalog";

// ============================================================
// /api/period-lock — data for the Period Lock page
//
// GET  ?year=2026 → { months, ranges, today, my_exceptions, can_manage }
// POST { date_from, date_to, tran_codes?: number[], reason? }
//      → lock a date range (inclusive); tran_codes empty/omitted = all documents
//
// Month lock/unlock is NOT here: it stays on /api/costing/lock-period because
// locking a month also generates next month's opening stock.
// ============================================================

export const GET = guard(null, async (request, { session }) => {
  try {
    const { searchParams } = new URL(request.url);
    const year = parseInt(searchParams.get("year")) || new Date().getFullYear();

    const today = dayOf(new Date());
    const [periods, ranges, todayMonthLocked, todayRange, myExceptions] = await Promise.all([
      prisma.costingPeriod.findMany({ where: { year } }),
      prisma.periodLock.findMany({
        orderBy: [{ is_active: "desc" }, { date_from: "desc" }],
        take: 200,
      }),
      isPeriodLocked(today.month, today.year),
      findRangeLock(today),
      prisma.periodLockException.findMany({
        where: {
          user_id: String(session.user.id),
          is_active: true,
          OR: [{ expires_at: null }, { expires_at: { gt: new Date() } }],
        },
        orderBy: { granted_at: "desc" },
      }),
    ]);

    const byMonth = new Map(periods.map((p) => [p.month, p]));
    const months = Array.from({ length: 12 }, (_, i) => {
      const p = byMonth.get(i + 1);
      return {
        month: i + 1,
        year,
        is_locked: p?.is_locked ?? false,
        locked_at: p?.locked_at ?? null,
        locked_by: p?.locked_by ?? null,
      };
    });

    return NextResponse.json({
      months,
      ranges,
      today: { ...today, month_locked: todayMonthLocked, range: todayRange },
      my_exceptions: myExceptions,
      can_manage: await can(session, "period.lock"),
    });
  } catch (error) {
    console.error("Period lock GET error:", error);
    return NextResponse.json({ error: "Failed to load period locks" }, { status: 500 });
  }
});

export const POST = guard("period.lock", async (request, { session }) => {
  try {

    const { date_from, date_to, reason, tran_codes } = await request.json();

    const from = parseDay(date_from);
    const to = parseDay(date_to);
    if (!from || !to) {
      return NextResponse.json(
        { error: "date_from and date_to are required (YYYY-MM-DD)" },
        { status: 400 },
      );
    }
    if (date_from > date_to) {
      return NextResponse.json(
        { error: "From date must be on or before To date" },
        { status: 400 },
      );
    }
    const codes = parseTranCodes(tran_codes);
    if (codes === null) {
      return NextResponse.json({ error: "Unknown document type in tran_codes" }, { status: 400 });
    }

    const lock = await prisma.periodLock.create({
      data: {
        date_from: dbDate(from),
        date_to: dbDate(to),
        tran_codes: codes,
        reason: reason?.trim() ? reason.trim().slice(0, 255) : null,
        locked_by: session?.user?.email ?? null,
      },
    });

    await logPeriodLockEvent("RANGE_LOCK", {
      lock_id: lock.id,
      detail: `${date_from} to ${date_to} · ${documentsSummary(codes)}${lock.reason ? ` · ${lock.reason}` : ""}`,
    });

    return NextResponse.json(lock, { status: 201 });
  } catch (error) {
    console.error("Period lock POST error:", error);
    return NextResponse.json({ error: "Failed to lock date range" }, { status: 500 });
  }
});
