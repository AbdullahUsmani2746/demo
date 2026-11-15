// app/api/settings/off-books/route.js — the "Hide off books" switch
// (lib/accounts/books.js).
//   GET  → { hidden, canToggle, changedAt, changedBy }   any signed-in user
//          (everyone sees the banner while off books are hidden)
//   POST { hidden }                                       offBooks.hide only
// Who flipped it and when is in the audit trail (Settings row).
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { can } from "@/lib/auth/permissions";
import {
  HIDE_OFF_BOOKS_KEY,
  HIDE_OFF_BOOKS_PERMISSION,
  primeOffBooksSwitch,
} from "@/lib/accounts/books";

async function state(session) {
  const [row, canToggle] = await Promise.all([
    prisma.settings.findUnique({ where: { key: HIDE_OFF_BOOKS_KEY }, select: { value: true, description: true, last_updated: true } }),
    can(session, HIDE_OFF_BOOKS_PERMISSION),
  ]);
  return {
    hidden: row?.value === "true",
    canToggle,
    changedAt: row?.last_updated ?? null,
    changedBy: row?.description ?? null,
  };
}

export const GET = guard(null, async (req, { session }) => NextResponse.json(await state(session)));

export const POST = guard(HIDE_OFF_BOOKS_PERMISSION, async (req, { session }) => {
  const { hidden } = await req.json();
  const on = hidden === true;
  const by = session.user.name || session.user.email || session.user.id;
  await prisma.settings.upsert({
    where: { key: HIDE_OFF_BOOKS_KEY },
    update: { value: String(on), description: `${on ? "Hidden" : "Shown"} by ${by}`.slice(0, 190) },
    create: { key: HIDE_OFF_BOOKS_KEY, value: String(on), description: `${on ? "Hidden" : "Shown"} by ${by}`.slice(0, 190) },
  });
  // This server process switches at once; any other within 10 s
  primeOffBooksSwitch(on);
  return NextResponse.json({
    ...(await state(session)),
    message: on ? "Off books are hidden — the whole system now shows the ON books only." : "Off books are shown again.",
  });
});
