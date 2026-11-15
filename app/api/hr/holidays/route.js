// /api/hr/holidays
//   GET   ?year=2026   holidays of the year
//   POST  { date, name, is_paid } — or { dates: [...], name, is_paid } for several days
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { HR_PERMS } from "@/lib/hr/access";
import { hrRoute, jsonBody } from "@/lib/hr/route";
import { dayKeyOfDb, dbDay, isDayKey, todayKey } from "@/lib/hr/time";

export const GET = hrRoute(Object.values(HR_PERMS), async (req) => {
  const y = Number(new URL(req.url).searchParams.get("year")) || Number(todayKey().slice(0, 4));
  const rows = await prisma.hrHoliday.findMany({
    where: { date: { gte: dbDay(`${y}-01-01`), lte: dbDay(`${y}-12-31`) } },
    orderBy: { date: "asc" },
  });
  return NextResponse.json({ year: y, holidays: rows.map((h) => ({ ...h, date: dayKeyOfDb(h.date) })) });
});

export const POST = hrRoute([HR_PERMS.holidays], async (req, { session }) => {
  const b = await jsonBody(req);
  const dates = [...new Set(Array.isArray(b.dates) ? b.dates : [b.date])];
  const name = String(b.name ?? "").trim();
  if (!name || name.length > 100) return NextResponse.json({ error: "Name is required (100 characters at most)." }, { status: 400 });
  if (!dates.length || dates.length > 31 || !dates.every(isDayKey)) {
    return NextResponse.json({ error: "Pick 1 to 31 valid dates." }, { status: 400 });
  }
  const locked = await prisma.hrAttendance.count({ where: { date: { in: dates.map(dbDay) }, locked: true } });
  if (locked) return NextResponse.json({ error: "Payroll has been posted for one of these days — it cannot become a holiday now." }, { status: 409 });
  const taken = await prisma.hrHoliday.findMany({ where: { date: { in: dates.map(dbDay) } }, select: { date: true, name: true } });
  if (taken.length) {
    return NextResponse.json({ error: `Already a holiday: ${taken.map((t) => `${dayKeyOfDb(t.date)} (${t.name})`).join(", ")}.` }, { status: 409 });
  }
  await prisma.hrHoliday.createMany({
    data: dates.map((d) => ({ date: dbDay(d), name, is_paid: b.is_paid !== false, created_by: session.user.id })),
  });
  return NextResponse.json({ success: true, message: `${dates.length} holiday day(s) added: ${name}.` }, { status: 201 });
});
