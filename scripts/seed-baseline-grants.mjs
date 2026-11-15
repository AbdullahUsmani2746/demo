// scripts/seed-baseline-grants.mjs
//
// RETIRED (2026-11-16): roles now get best-practice templates
// (prisma/sql/2026-11-16_roles.sql) and are tuned on Admin → Roles /
// Permissions. Running this would hand almost every permission back to every
// role, so it refuses to run.
//
// Give every non-full-access role the access it already has today, so that
// switching enforcement on changes nothing for the 25 people using the system.
//
// The engine is default-deny: a code with no grant is refused. Seeding the
// catalogue alone would therefore have locked every EMPLOYEE out of every
// report and every voucher screen the moment a route was guarded. This script
// writes the "before" picture as explicit role grants, so the only codes
// actually restricted are the ones listed in WITHHELD — the administrative and
// destructive ones, plus the rate right this work started from.
//
// From here tightening is done in /admin/permissions, one row at a time, with
// the effect visible before it is saved.
//
//   node scripts/seed-baseline-grants.mjs            (dry run)
//   node scripts/seed-baseline-grants.mjs --apply
import { PrismaClient } from "@prisma/client";

console.error("seed-baseline-grants.mjs is retired — see the note at the top of the file.");
process.exit(1);

const prisma = new PrismaClient();
const APPLY = process.argv.includes("--apply");
// --all also grants the WITHHELD codes, i.e. every role gets everything.
// Used to start from "nobody is blocked" and tighten afterwards in
// /admin/permissions, which is the opposite order from the default baseline.
const ALL = process.argv.includes("--all");

// ADMIN and ACCOUNTANT bypass the tables entirely (FULL_ACCESS_ROLES), so they
// are deliberately absent here — granting them anything would be dead rows.
const ROLES = ["MANAGER", "CASHIER", "SALES", "EMPLOYEE", "HR_MANAGER"];

/** Codes NOT granted by the baseline: these become ADMIN/ACCOUNTANT-only. */
const WITHHELD = new Set([
  // the right this work started from
  "salesItem.rate.update",
  // commercial terms
  "customer.creditTerms.update",
  "customer.book.update",
  // administration
  "permissions.manage",
  "users.manage",
  "menus.manage",
  "settings.manage",
  "maintenance.bulkUpdate",
  // irreversible or period-wide
  "period.lock",
  "openingStock.calculate",
  "stock.adjust",
  "dispatch.unlock",
  "knockoff.reverse",
  // Menus decide which screens a person can reach, so letting a non-admin
  // edit them would let them grant themselves access — the one setup entity
  // that is part of the access-control surface itself.
  // Granted to named individuals, never to a whole role — the point of it
  // is that most sales people cannot see each other's books.
  "salesTeam.viewAll",
  "setup.menus.manage",
  "setup.employee_menus.manage",
]);

async function main() {
  const permissions = await prisma.permission.findMany({
    select: { id: true, code: true },
    orderBy: { code: "asc" },
  });
  if (permissions.length === 0) {
    throw new Error("No permissions found — run scripts/seed-permissions.mjs first.");
  }

  const granted = ALL ? permissions : permissions.filter((p) => !WITHHELD.has(p.code));
  const missing = [...WITHHELD].filter((c) => !permissions.some((p) => p.code === c));

  console.log(`${permissions.length} permissions · ${granted.length} granted to ` +
              `${ROLES.length} roles · ${ALL ? 0 : WITHHELD.size} withheld` +
              (ALL ? "  [--all: nothing is withheld]" : ""));
  if (missing.length) {
    console.log("WARNING — withheld codes that do not exist:", missing.join(", "));
  }

  const existing = await prisma.permissionGrant.count({ where: { role: { not: null } } });
  console.log(`existing role grants: ${existing}`);

  const rows = ROLES.flatMap((role) =>
    granted.map((p) => ({ permissionId: p.id, role, allow: true })),
  );

  if (!APPLY) {
    console.log(`\nDRY RUN — would create up to ${rows.length} role grants.`);
    if (!ALL) console.log("Withheld (ADMIN/ACCOUNTANT only):\n  " + [...WITHHELD].join("\n  "));
    console.log("\nRe-run with --apply to write them.");
    return;
  }

  // Chunked: a single 1,100-row insert dropped the connection during the
  // catalogue seed (P1017), so the same batching is used here.
  const CHUNK = 200;
  let created = 0;
  for (let i = 0; i < rows.length; i += CHUNK) {
    const res = await prisma.permissionGrant.createMany({
      data: rows.slice(i, i + CHUNK),
      skipDuplicates: true, // re-runnable; never overwrites a hand-made grant
    });
    created += res.count;
    process.stdout.write(`  ${Math.min(i + CHUNK, rows.length)}/${rows.length}\r`);
  }
  console.log(`\ncreated ${created} role grants (${rows.length - created} already present)`);
}

main()
  .catch((e) => { console.error(e); process.exitCode = 1; })
  .finally(() => prisma.$disconnect());
