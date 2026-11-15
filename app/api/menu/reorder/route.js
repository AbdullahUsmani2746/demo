// POST /api/menu/reorder — save a drag-and-drop on Accounting → Menus.
//   body { items: [{ id, parent_id, order_no }] }  (only the rows that moved)
//   → { updated: n }
// Same right as editing a menu (setup.menus.manage). Refuses a move that
// would put a menu under itself or one of its own children. Writes through
// the audited client, in one transaction.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { setAuditActor } from "@/lib/audit/context";

export const POST = guard("setup.menus.manage", async (req, { session }) => {
  setAuditActor(session);
  const body = await req.json().catch(() => ({}));
  const items = Array.isArray(body?.items) ? body.items : [];
  if (!items.length) return NextResponse.json({ updated: 0 });
  if (items.length > 2000) return NextResponse.json({ error: "Too many rows" }, { status: 400 });

  const moves = new Map();
  for (const it of items) {
    const id = Number(it?.id);
    const parent = it?.parent_id == null || it.parent_id === "" ? null : Number(it.parent_id);
    const order = Number(it?.order_no);
    if (!Number.isInteger(id) || (parent !== null && !Number.isInteger(parent)) || !Number.isInteger(order) || order < 0) {
      return NextResponse.json({ error: "Invalid menu order" }, { status: 400 });
    }
    if (parent === id) return NextResponse.json({ error: "A menu cannot be its own parent" }, { status: 422 });
    moves.set(id, { parent_id: parent, order_no: order });
  }

  const all = await prisma.menus.findMany({ select: { id: true, parent_id: true, order_no: true } });
  const byId = new Map(all.map((m) => [m.id, m]));
  for (const id of moves.keys()) {
    if (!byId.has(id)) return NextResponse.json({ error: `Menu ${id} not found` }, { status: 404 });
  }
  for (const { parent_id } of moves.values()) {
    if (parent_id !== null && !byId.has(parent_id)) {
      return NextResponse.json({ error: `Parent menu ${parent_id} not found` }, { status: 404 });
    }
  }

  // The tree after the move must have no loops.
  const parentOf = (id) => (moves.has(id) ? moves.get(id).parent_id : byId.get(id)?.parent_id ?? null);
  for (const id of moves.keys()) {
    const seen = new Set([id]);
    for (let p = parentOf(id); p !== null; p = parentOf(p)) {
      if (seen.has(p)) return NextResponse.json({ error: "A menu cannot be moved under one of its own sub-menus" }, { status: 422 });
      seen.add(p);
    }
  }

  const changed = [...moves.entries()].filter(([id, m]) => {
    const cur = byId.get(id);
    return cur.parent_id !== m.parent_id || cur.order_no !== m.order_no;
  });
  if (changed.length) {
    await prisma.$transaction(
      changed.map(([id, m]) => prisma.menus.update({ where: { id }, data: { parent_id: m.parent_id, order_no: m.order_no } })),
    );
  }
  return NextResponse.json({ updated: changed.length });
});
