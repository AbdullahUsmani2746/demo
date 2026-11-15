// POST /api/bi/run — BI Designer live preview.
//   { config, period? }            → result of the question
//   { values: { dataset, field } } → distinct values for a filter pick-list
//   { drill: true, config, period?, point } → the records behind a figure
// Data scope (department / personal limits) applies, as for everyone.
import { guard } from "@/lib/auth/route";
import { bi, biJson } from "@/lib/bi/http";
import { runQuestion, fieldValues, drillRows } from "@/lib/bi/engine";

export const POST = guard(
  null,
  bi(async (req, { session }) => {
    const body = await req.json();
    if (body?.values) {
      return biJson({ values: await fieldValues(body.values.dataset, body.values.field, { session }) });
    }
    if (body?.drill) {
      return biJson(await drillRows(body.config, { session, period: body.period, point: body.point }));
    }
    return biJson(await runQuestion(body?.config, { session, period: body?.period }));
  }, { design: true }),
);
