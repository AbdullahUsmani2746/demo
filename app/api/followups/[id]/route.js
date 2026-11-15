// app/api/followups/[id]/route.js — one follow-up.
//   GET  → the item with its full history (every logged follow-up)
//   POST { result, remarks, next_date? } → log it (lib/bi/followups.js logFollowup)
// Visible to / loggable by the same people (lib/bi/followupAccess.js).
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { logFollowup, resultLabel, FOLLOWUP_RESULTS } from "@/lib/bi/followups";
import { followupViewer } from "@/lib/bi/followupAccess";

async function load(id, session) {
  const item = await prisma.biFollowup.findUnique({
    where: { id: Number(id) },
    include: { question: true, notes: { orderBy: { created_at: "desc" } } },
  });
  if (!item) return { error: NextResponse.json({ error: "Not found" }, { status: 404 }) };
  const viewer = await followupViewer(session);
  if (!viewer.canSee(item, item.question)) return { error: NextResponse.json({ error: "Not yours to see" }, { status: 403 }) };
  return { item };
}

export const GET = guard(null, async (req, { params, session }) => {
  const { item, error } = await load((await params).id, session);
  if (error) return error;
  const ids = [...new Set([item.owner_id, ...item.notes.map((n) => n.user_id)].filter(Boolean))];
  const users = ids.length ? await prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true } }) : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name || u.email]));
  const party = item.party_id ? await prisma.aCNO.findUnique({ where: { acno: item.party_id }, select: { acname: true } }) : null;
  return NextResponse.json({
    item: {
      id: item.id,
      scenario: item.question.name,
      label: item.item_label,
      key: item.item_key,
      flag: item.flag_label,
      customer: party?.acname ?? null,
      owner: item.owner_id ? nameOf.get(item.owner_id) ?? item.owner_id : "Unassigned",
      status: item.status,
      result: item.result,
      result_label: item.result ? resultLabel(item.result) : null,
      next_date: item.next_date,
      due_since: item.due_since,
    },
    history: item.notes.map((n) => ({ at: n.created_at, by: nameOf.get(n.user_id) ?? n.user_id, result: resultLabel(n.result), remarks: n.remarks })),
    results: FOLLOWUP_RESULTS,
  });
});

export const POST = guard(null, async (req, { params, session }) => {
  const { item, error } = await load((await params).id, session);
  if (error) return error;
  if (item.status === "cleared") return NextResponse.json({ error: "This follow-up is no longer due." }, { status: 409 });
  const { result, remarks, next_date } = await req.json();
  try {
    const saved = await logFollowup({
      id: item.id,
      userId: session.user.id,
      userName: session.user.name || session.user.email,
      result,
      remarks,
      nextDate: next_date,
    });
    return NextResponse.json({
      success: true,
      message: saved.status === "done" ? `Logged — ${resultLabel(saved.result)}.` : `Logged — follow up again on ${new Date(saved.next_date).toLocaleDateString("en-GB")}.`,
    });
  } catch (e) {
    return NextResponse.json({ error: e.message }, { status: 400 });
  }
});
