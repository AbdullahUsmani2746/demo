// scripts/seed-bi-dashboards.mjs — install the ready-made BI dashboards.
//
//   node scripts/seed-bi-dashboards.mjs           # DRY RUN (default) — preview only
//   node scripts/seed-bi-dashboards.mjs --apply   # write
//
// Definitions: scripts/bi/starterDashboards.mjs.
// Idempotent and safe to re-run: questions and dashboards are matched by
// NAME and updated in place; anything else in the BI Designer is left alone,
// and assignments (who sees a dashboard) are NEVER touched — assign them on
// BI Designer → Dashboards → Edit → Assign to.
//
// Needs the BI tables (prisma/sql/2026-10-25_bi_dashboards.sql) and a
// generated Prisma client.
import { PrismaClient } from "@prisma/client";
import { QUESTIONS, DASHBOARDS } from "./bi/starterDashboards.mjs";

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");

let seq = 0;
const uid = (p) => `${p}${Date.now().toString(36)}${(seq++).toString(36)}`;

async function main() {
  if (!prisma.biQuestion || !prisma.biDashboard) {
    throw new Error("BI tables are not set up — run prisma/sql/2026-10-25_bi_dashboards.sql, then npx prisma generate.");
  }
  console.log(APPLY ? "APPLYING" : "DRY RUN (nothing written — add --apply to write)");

  // ── questions ──
  const idByName = new Map();
  let qNew = 0, qUpd = 0;
  for (const q of QUESTIONS) {
    const found = await prisma.biQuestion.findFirst({ where: { name: q.name }, select: { id: true } });
    const data = { name: q.name, description: q.description ?? null, dataset: q.dataset, config: q.config };
    if (!APPLY) {
      found ? qUpd++ : qNew++;
      idByName.set(q.name, found?.id ?? -1);
      continue;
    }
    if (found) {
      await prisma.biQuestion.update({ where: { id: found.id }, data });
      idByName.set(q.name, found.id);
      qUpd++;
    } else {
      const row = await prisma.biQuestion.create({ data: { ...data, created_by: "seed" } });
      idByName.set(q.name, row.id);
      qNew++;
    }
  }
  console.log(`  questions:  ${qNew} new, ${qUpd} updated`);

  // ── dashboards ──
  let dNew = 0, dUpd = 0;
  for (const d of DASHBOARDS) {
    const layout = {
      sections: d.sections.map((s) => ({
        id: uid("s"),
        title: s.title,
        items: s.items.map((it) => {
          const qid = idByName.get(it.name);
          if (qid === undefined) throw new Error(`Dashboard "${d.name}" uses unknown question "${it.name}"`);
          return { id: uid("i"), questionId: qid, width: it.width };
        }),
      })),
      filters: d.filters,
    };
    const found = await prisma.biDashboard.findFirst({ where: { name: d.name }, select: { id: true } });
    const widgets = layout.sections.reduce((n, s) => n + s.items.length, 0);
    console.log(`  ${found ? "update" : "create"} dashboard "${d.name}" — ${layout.sections.length} sections, ${widgets} widgets, ${d.filters.length} filter(s)`);
    if (!APPLY) { found ? dUpd++ : dNew++; continue; }
    const data = { name: d.name, description: d.description, default_period: d.default_period, is_active: true, layout };
    if (found) {
      await prisma.biDashboard.update({ where: { id: found.id }, data });
      dUpd++;
    } else {
      await prisma.biDashboard.create({ data: { ...data, created_by: "seed" } });
      dNew++;
    }
  }
  console.log(`  dashboards: ${dNew} new, ${dUpd} updated`);
  if (APPLY) console.log("\nDone. Assign them in BI Designer → Dashboards → Edit → Assign to.");
}

main()
  .catch((e) => { console.error("BI seed failed:", e.message); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
