// /api/bi/questions — saved questions (BI Designer only)
//   GET  → list   ·   POST { name, description?, config } → create
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { bi, biJson } from "@/lib/bi/http";
import { assertFollowupAllowed, cleanQuestion } from "@/lib/bi/validate";

export const GET = guard(
  null,
  bi(async () => {
    const rows = await prisma.biQuestion.findMany({ orderBy: { updated_at: "desc" } });
    return biJson({ data: rows });
  }, { design: true }),
);

export const POST = guard(
  null,
  bi(async (req, { session }) => {
    const data = cleanQuestion(await req.json());
    assertFollowupAllowed(session, data.config);
    const row = await prisma.biQuestion.create({ data: { ...data, created_by: session.user.id } });
    return biJson(row, 201);
  }, { design: true }),
);
