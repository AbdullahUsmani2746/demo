// /api/bi/questions/[id] — one saved question (BI Designer only)
//   GET · PUT { name, description?, config } · DELETE (refused while a dashboard uses it)
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { bi, biJson, routeId } from "@/lib/bi/http";
import { BiError } from "@/lib/bi/engine";
import { layoutQuestionIds } from "@/lib/bi/access";
import { assertFollowupAllowed, cleanQuestion } from "@/lib/bi/validate";

async function load(id) {
  const row = await prisma.biQuestion.findUnique({ where: { id } });
  if (!row) throw new BiError("Question not found.", 404);
  return row;
}

export const GET = guard(null, bi(async (req, ctx) => biJson(await load(await routeId(ctx))), { design: true }));

export const PUT = guard(
  null,
  bi(async (req, ctx) => {
    const id = await routeId(ctx);
    const stored = await load(id);
    const data = cleanQuestion(await req.json());
    assertFollowupAllowed(ctx.session, data.config, stored.config);
    const row = await prisma.biQuestion.update({ where: { id }, data });
    return biJson(row);
  }, { design: true }),
);

export const DELETE = guard(
  null,
  bi(async (req, ctx) => {
    const id = await routeId(ctx);
    await load(id);
    const dashboards = await prisma.biDashboard.findMany({ select: { name: true, layout: true } });
    const usedIn = dashboards.filter((d) => layoutQuestionIds(d.layout).includes(id)).map((d) => d.name);
    if (usedIn.length) {
      throw new BiError(`Used on: ${usedIn.join(", ")}. Remove it from those dashboards first.`, 409);
    }
    await prisma.biQuestion.delete({ where: { id } });
    return biJson({ ok: true });
  }, { design: true }),
);
