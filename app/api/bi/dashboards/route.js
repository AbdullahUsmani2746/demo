// /api/bi/dashboards — BI Designer only
//   GET  → every dashboard with its assignments
//   POST { name, description?, layout, default_period } → create
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { bi, biJson } from "@/lib/bi/http";
import { cleanDashboard } from "@/lib/bi/validate";

export const GET = guard(
  null,
  bi(async () => {
    const rows = await prisma.biDashboard.findMany({
      orderBy: { name: "asc" },
      include: { assignments: true },
    });
    return biJson({ data: rows });
  }, { design: true }),
);

export const POST = guard(
  null,
  bi(async (req, { session }) => {
    const data = cleanDashboard(await req.json());
    const row = await prisma.biDashboard.create({ data: { ...data, created_by: session.user.id } });
    return biJson(row, 201);
  }, { design: true }),
);
