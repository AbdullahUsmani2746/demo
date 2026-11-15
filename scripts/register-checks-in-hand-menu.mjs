// scripts/register-checks-in-hand-menu.mjs
//
// Registers the two Checks In Hand screens in the `menus` table:
//
//   Checks In Hand          -> /accounting/checks-in-hand
//   Checks In Hand Report   -> /accounting/reports/checksInHand
//
// Menus in this app are database rows, not code — the sidebar, the app
// launcher AND the per-employee permission check in middleware.js all read
// them. ADMIN / ACCOUNTANT / MANAGER bypass the permission check and can open
// the pages by URL without this, but EMPLOYEE-role users cannot until a menu
// row exists and is assigned to them (Settings -> employee menus).
//
// Safe to re-run: rows are matched on their url and updated in place rather
// than duplicated.
//
// Usage:
//   node scripts/register-checks-in-hand-menu.mjs
//   node scripts/register-checks-in-hand-menu.mjs --parent "FINANCE"

import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

const ENTRIES = [
  {
    title: "Checks In Hand",
    url: "/accounting/checks-in-hand",
    icon: "Wallet",
    order_no: 900,
  },
  {
    title: "Checks In Hand Report",
    url: "/accounting/reports/checksInHand",
    icon: "FileBarChart",
    order_no: 901,
  },
];

function argValue(flag) {
  const i = process.argv.indexOf(flag);
  return i > -1 ? process.argv[i + 1] : null;
}

async function resolveParentId(parentTitle) {
  if (!parentTitle) return null;
  const parent = await prisma.menus.findFirst({
    where: { title: { equals: parentTitle, mode: "insensitive" } },
    select: { id: true, title: true },
  });
  if (!parent) {
    console.warn(
      `! No menu titled "${parentTitle}" found — creating the entries at top level instead.`
    );
    return null;
  }
  console.log(`Parent menu: ${parent.title} (id ${parent.id})`);
  return parent.id;
}

async function main() {
  const parentId = await resolveParentId(argValue("--parent"));

  for (const entry of ENTRIES) {
    const existing = await prisma.menus.findFirst({ where: { url: entry.url } });

    if (existing) {
      const updated = await prisma.menus.update({
        where: { id: existing.id },
        data: {
          title: entry.title,
          icon: entry.icon,
          is_active: true,
          ...(parentId ? { parent_id: parentId } : {}),
        },
      });
      console.log(`updated  #${updated.id}  ${updated.title} -> ${updated.url}`);
    } else {
      const created = await prisma.menus.create({
        data: { ...entry, parent_id: parentId, is_active: true },
      });
      console.log(`created  #${created.id}  ${created.title} -> ${created.url}`);
    }
  }

  console.log(
    "\nDone. Assign the new menus to non-admin employees in Settings if they need access."
  );
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
