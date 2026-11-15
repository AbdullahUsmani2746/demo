// /api/bi/events — dated notes shown as flags on dashboard trend charts.
//   GET  ?from=YYYY-MM-DD&to=YYYY-MM-DD  any signed-in user (newest first, max 200)
//   POST { dated, label, note? }          bi.design
//   DELETE ?id=                           bi.design
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { bi, biJson } from "@/lib/bi/http";
import { BiError } from "@/lib/bi/engine";
import { fromDayKey } from "@/lib/bi/periods";

const shape = (e) => ({ id: e.id, dated: e.dated.toISOString().slice(0, 10), label: e.label, note: e.note });
const asDate = (s) => {
  const d = fromDayKey(s);
  return d ? new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate())) : null;
};

export const GET = guard(
  null,
  bi(async (req) => {
    const sp = new URL(req.url).searchParams;
    const from = asDate(sp.get("from"));
    const to = asDate(sp.get("to"));
    const rows = await prisma.biEvent.findMany({
      where: { ...(from || to ? { dated: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}) },
      orderBy: { dated: "desc" },
      take: 200,
    });
    return biJson({ data: rows.map(shape) });
  }),
);

export const POST = guard(
  null,
  bi(
    async (req, { session }) => {
      const b = await req.json();
      const dated = asDate(b?.dated);
      const label = String(b?.label || "").trim().slice(0, 60);
      if (!dated) throw new BiError("Pick the date.");
      if (!label) throw new BiError("Write a short label, e.g. Price +6%.");
      const e = await prisma.biEvent.create({
        data: { dated, label, note: b?.note ? String(b.note).trim().slice(0, 300) || null : null, created_by: session.user.id },
      });
      return biJson(shape(e), 201);
    },
    { design: true },
  ),
);

export const DELETE = guard(
  null,
  bi(
    async (req) => {
      const id = Number(new URL(req.url).searchParams.get("id"));
      if (!Number.isFinite(id)) throw new BiError("Which event?");
      await prisma.biEvent.deleteMany({ where: { id } });
      return biJson({ ok: true });
    },
    { design: true },
  ),
);
