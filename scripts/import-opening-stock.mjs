// scripts/import-opening-stock.mjs
// ============================================================
// Import godown-wise opening stock from an Excel sheet.
//
//   node scripts/import-opening-stock.mjs <file.xlsx> [--sheet NAME] [--replace] [--dry-run]
//
// Expected columns (header row, case-insensitive):
//   year | month | GODOWN | itcd | QTY | opening_rate [| cc_rate | rm_rate]
//
//   - GODOWN is the Godown.id.
//   - opening_rate is item-level; if an item appears in several godowns
//     the first non-zero rate wins (they are expected to be identical).
//   - Every row must belong to the same (year, month).
//
// Writes:
//   MonthlyOpeningRate   one row per itcd            (upsert)
//   MonthlyOpeningStock  one row per (itcd, godown)  (upsert, zero-qty rows skipped)
//
// --replace  deletes everything already stored for that (year, month) first
//            (so items missing from the sheet disappear); default is upsert
//            on top of what exists.
// --dry-run  validates and prints the summary without writing.
// ============================================================
import { PrismaClient } from "@prisma/client";
import XLSX from "xlsx";
import path from "node:path";

const args = process.argv.slice(2);
const file = args.find((a) => !a.startsWith("--"));
const sheetArg = args.includes("--sheet") ? args[args.indexOf("--sheet") + 1] : null;
const replace = args.includes("--replace");
const dryRun = args.includes("--dry-run");

if (!file) {
  console.error("usage: node scripts/import-opening-stock.mjs <file.xlsx> [--sheet NAME] [--replace] [--dry-run]");
  process.exit(1);
}

const prisma = new PrismaClient();
const num = (v) => (v == null || v === "" ? 0 : Number(v));

function pick(row, ...names) {
  for (const n of names) {
    const k = Object.keys(row).find((key) => key.trim().toLowerCase() === n.toLowerCase());
    if (k != null) return row[k];
  }
  return undefined;
}

async function main() {
  const wb = XLSX.readFile(path.resolve(file));
  const sheetName = sheetArg || wb.SheetNames[0];
  const ws = wb.Sheets[sheetName];
  if (!ws) throw new Error(`Sheet "${sheetName}" not found. Available: ${wb.SheetNames.join(", ")}`);
  const raw = XLSX.utils.sheet_to_json(ws, { defval: null });
  console.log(`Read ${raw.length} rows from ${path.basename(file)} / ${sheetName}`);

  // ── Parse + validate ──────────────────────────────────────────────────────
  const errors = [];
  const periods = new Set();
  const rateByItem = new Map();
  const qtyByKey = new Map(); // "itcd|godown" → qty (summed if repeated)

  raw.forEach((row, i) => {
    const line = i + 2;
    const year = num(pick(row, "year"));
    const month = num(pick(row, "month"));
    const godown = num(pick(row, "godown"));
    const itcd = num(pick(row, "itcd", "item_code", "code"));
    const qty = num(pick(row, "qty", "opening_qty"));
    const rate = num(pick(row, "opening_rate", "rate"));
    const cc = pick(row, "cc_rate");
    const rm = pick(row, "rm_rate");

    if (!year || !month || month < 1 || month > 12) errors.push(`line ${line}: bad year/month`);
    if (!Number.isInteger(godown) || godown <= 0) errors.push(`line ${line}: bad GODOWN "${pick(row, "godown")}"`);
    if (!Number.isInteger(itcd) || itcd <= 0) errors.push(`line ${line}: bad itcd "${pick(row, "itcd")}"`);
    if (!Number.isFinite(qty)) errors.push(`line ${line}: bad QTY`);
    if (errors.length) return;

    periods.add(`${year}-${month}`);
    const key = `${itcd}|${godown}`;
    qtyByKey.set(key, (qtyByKey.get(key) || 0) + qty);

    const existing = rateByItem.get(itcd);
    if (!existing || (!existing.opening_rate && rate)) {
      rateByItem.set(itcd, {
        opening_rate: rate,
        cc_rate: cc == null || cc === "" ? null : num(cc),
        rm_rate: rm == null || rm === "" ? null : num(rm),
      });
    }
  });

  if (periods.size !== 1) errors.push(`sheet must contain exactly one (year, month); found: ${[...periods].join(", ")}`);
  if (errors.length) {
    console.error("Validation failed:\n  " + errors.slice(0, 30).join("\n  "));
    if (errors.length > 30) console.error(`  ... and ${errors.length - 30} more`);
    process.exit(1);
  }

  const [year, month] = [...periods][0].split("-").map(Number);

  // Referential checks
  const itcds = [...rateByItem.keys()];
  const godownIds = [...new Set([...qtyByKey.keys()].map((k) => Number(k.split("|")[1])))];
  const [items, godowns] = await Promise.all([
    prisma.item.findMany({ where: { itcd: { in: itcds } }, select: { itcd: true } }),
    prisma.godown.findMany({ where: { id: { in: godownIds } }, select: { id: true, godown: true } }),
  ]);
  const missingItems = itcds.filter((i) => !items.some((x) => x.itcd === i));
  const missingGodowns = godownIds.filter((g) => !godowns.some((x) => x.id === g));
  if (missingItems.length || missingGodowns.length) {
    if (missingItems.length) console.error(`Unknown itcd: ${missingItems.join(", ")}`);
    if (missingGodowns.length) console.error(`Unknown godown id: ${missingGodowns.join(", ")}`);
    process.exit(1);
  }

  const qtyRows = [...qtyByKey.entries()]
    .map(([k, opening_qty]) => {
      const [itcd, godown] = k.split("|").map(Number);
      return { itcd, godown, opening_qty };
    })
    .filter((r) => r.opening_qty !== 0);

  console.log(`Period ${month}/${year}`);
  console.log(`  items      : ${itcds.length} (${[...rateByItem.values()].filter((r) => !r.opening_rate).length} with zero rate)`);
  console.log(`  godowns    : ${godowns.map((g) => `${g.id}=${g.godown}`).join(", ")}`);
  console.log(`  qty rows   : ${qtyRows.length}`);
  console.log(`  total qty  : ${qtyRows.reduce((s, r) => s + r.opening_qty, 0).toFixed(3)}`);
  console.log(
    `  total value: ${qtyRows.reduce((s, r) => s + r.opening_qty * (rateByItem.get(r.itcd)?.opening_rate || 0), 0).toFixed(2)}`,
  );
  console.log(`  mode       : ${replace ? "REPLACE month" : "upsert"}${dryRun ? " (dry run)" : ""}`);

  if (dryRun) return;

  // ── Write ─────────────────────────────────────────────────────────────────
  await prisma.$transaction(
    async (tx) => {
      if (replace) {
        await tx.monthlyOpeningRate.deleteMany({ where: { month, year } });
        await tx.monthlyOpeningStock.deleteMany({ where: { month, year } });
      }
      for (const [itcd, r] of rateByItem) {
        await tx.monthlyOpeningRate.upsert({
          where: { month_year_itcd: { month, year, itcd } },
          update: r,
          create: { month, year, itcd, ...r },
        });
      }
      for (const q of qtyRows) {
        await tx.monthlyOpeningStock.upsert({
          where: { month_year_itcd_godown: { month, year, itcd: q.itcd, godown: q.godown } },
          update: { opening_qty: q.opening_qty },
          create: { month, year, ...q },
        });
      }
    },
    { timeout: 300000 },
  );

  // ── Verify ────────────────────────────────────────────────────────────────
  const [rateCount, qtyAgg] = await Promise.all([
    prisma.monthlyOpeningRate.count({ where: { month, year } }),
    prisma.monthlyOpeningStock.aggregate({ where: { month, year }, _count: true, _sum: { opening_qty: true } }),
  ]);
  console.log(`Done. DB now has ${rateCount} rate rows, ${qtyAgg._count} qty rows, total qty ${Number(qtyAgg._sum.opening_qty || 0).toFixed(3)} for ${month}/${year}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
