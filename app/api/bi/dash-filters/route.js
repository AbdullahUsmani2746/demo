// app/api/bi/dash-filters/route.js — switch the built-in dashboard filters
// (Book, Item Category, Series — lib/bi/dashFilters.js) on / off for every
// dashboard and everybody.
//   GET                          → { filters: [{ field, label, kind, description, enabled }] }
//   POST { "<field>": boolean }  → the same, after saving
// BI designers only (bi.design). Who changed it is in the Settings row and
// the audit trail.
import { guard } from "@/lib/auth/route";
import { bi, biJson } from "@/lib/bi/http";
import { dashFilterSettings, saveDashFilterSwitches } from "@/lib/bi/dashFilters";

export const GET = guard(
  null,
  bi(async () => biJson({ filters: await dashFilterSettings() }), { design: true }),
);

export const POST = guard(
  null,
  bi(
    async (req, { session }) => {
      const body = await req.json().catch(() => ({}));
      const by = session.user.name || session.user.email || session.user.id;
      return biJson({ filters: await saveDashFilterSwitches(body, by) });
    },
    { design: true },
  ),
);
