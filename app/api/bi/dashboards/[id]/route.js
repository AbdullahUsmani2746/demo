// /api/bi/dashboards/[id] — BI Designer only: GET · PUT · DELETE
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { bi, biJson, routeId } from "@/lib/bi/http";
import { BiError } from "@/lib/bi/engine";
import { cleanDashboard } from "@/lib/bi/validate";

async function load(id) {
  const row = await prisma.biDashboard.findUnique({ where: { id }, include: { assignments: true } });
  if (!row) throw new BiError("Dashboard not found.", 404);
  return row;
}

export const GET = guard(null, bi(async (req, ctx) => biJson(await load(await routeId(ctx))), { design: true }));

export const PUT = guard(
  null,
  bi(async (req, ctx) => {
    const id = await routeId(ctx);
    await load(id);
    const row = await prisma.biDashboard.update({ where: { id }, data: cleanDashboard(await req.json()) });
    return biJson(row);
  }, { design: true }),
);

export const DELETE = guard(
  null,
  bi(async (req, ctx) => {
    const id = await routeId(ctx);
    await load(id);
    await prisma.biDashboard.delete({ where: { id } }); // assignments cascade
    return biJson({ ok: true });
  }, { design: true }),
);
