// GET /api/bi/my — the dashboards assigned to the signed-in person
// (their own, their role's, their department's), landing page first.
import { guard } from "@/lib/auth/route";
import { bi, biJson } from "@/lib/bi/http";
import { dashboardsFor, canDesign } from "@/lib/bi/access";

export const GET = guard(
  null,
  bi(async (req, { session }) => {
    const [data, designer] = await Promise.all([dashboardsFor(session), canDesign(session)]);
    return biJson({ data, canDesign: designer });
  }),
);
