// scripts/backfill-invoice-knockoffs.mjs
//
// One-time backfill: converts every pre-existing Receipt/Payment/JV line
// that already carries an invoice_no (tagged historically via the "Auto
// FIFO Settlement" screen) into a row in INVOICE_KNOCKOFF, so the
// rewritten outstanding.js (which nets purely from INVOICE_KNOCKOFF) does
// not lose any settlement history.
//
// Run once, BEFORE the outstanding.js rewrite is relied upon in
// production. Safe to re-run — existing (source_line_id, invoice_no,
// invoice_party_acno) rows are skipped via the unique constraint.
//
// Usage: node scripts/backfill-invoice-knockoffs.mjs

import { PrismaClient, Prisma } from "@prisma/client";

const prisma = new PrismaClient();

// Customers / vendors are the main accounts chosen in Finance → Account
// Settings (groups "customers" / "vendors"). Read straight from
// account_settings: this runs under plain `node`, which cannot resolve the
// app's "@/" imports (lib/accounts/partyMacnos.js).
async function groupMacnos(key) {
  const row = await prisma.accountSetting.findUnique({ where: { key } });
  const macnos = (row?.macnos || []).map(Number).filter(Number.isFinite);
  if (!macnos.length) {
    throw new Error(`Account Settings group "${key}" is not set — set it in Finance → Account Settings first.`);
  }
  return macnos;
}
const customerMacnos = Prisma.join(await groupMacnos("customers"));
const vendorMacnos = Prisma.join(await groupMacnos("vendors"));
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

function sourceTypeFromTranCode(tranCode) {
  if (tranCode === 1) return "RECEIPT";
  if (tranCode === 2) return "PAYMENT";
  return "JV";
}

async function buildInvoiceTranIdMap() {
  const rows = await prisma.$queryRaw`
    SELECT tm.tran_id, tm.invoice_no, tm.pycd AS party_acno
    FROM "TRANSACTIONS_MASTER" tm
    WHERE tm.tran_code IN (4, 6) AND tm.invoice_no IS NOT NULL

    UNION ALL

    SELECT tm.tran_id, t.invoice_no, t.acno AS party_acno
    FROM "Transactions" t
    JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
    WHERE tm.tran_code = 3 AND t.invoice_no IS NOT NULL
  `;
  const map = new Map();
  for (const r of rows) {
    if (r.party_acno == null) continue;
    map.set(`${Number(r.party_acno)}:${r.invoice_no}`, r.tran_id);
  }
  return map;
}

async function findTaggedLines() {
  // Preserves the exact legacy netting formula from the old outstanding.js
  // ledger CTE: Receipt=camt, Payment=damt, JV=camt-damt (customer) or
  // damt-camt (vendor) — so backfilled totals match pre-change reports.
  return prisma.$queryRaw`
    SELECT
      t.id                                       AS line_id,
      t.tran_id                                  AS source_tran_id,
      t.acno                                     AS source_acno,
      t.invoice_no,
      tm.tran_code,
      a.macno,
      CASE
        WHEN tm.tran_code = 1 THEN COALESCE(t.camt, 0)
        WHEN tm.tran_code = 2 THEN COALESCE(t.damt, 0)
        WHEN tm.tran_code = 3 AND a.macno IN (${customerMacnos})
          THEN COALESCE(t.camt, 0) - COALESCE(t.damt, 0)
        WHEN tm.tran_code = 3 AND a.macno IN (${vendorMacnos})
          THEN COALESCE(t.damt, 0) - COALESCE(t.camt, 0)
      END                                         AS allocated_amount
    FROM "Transactions" t
    JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
    JOIN "acno" a ON a.acno = t.acno
    WHERE t.invoice_no IS NOT NULL
      AND (t.sub_tran_id IS NULL OR t.sub_tran_id != 3)
      AND tm.tran_code IN (1, 2, 3)
      AND a.macno IN (${customerMacnos}, ${vendorMacnos})
    ORDER BY t.id ASC
  `;
}

async function main() {
  console.log("Building invoice tran_id lookup map...");
  const invoiceTranIdMap = await buildInvoiceTranIdMap();

  console.log("Scanning tagged Receipt/Payment/JV lines...");
  const lines = await findTaggedLines();
  console.log(`Found ${lines.length} tagged lines to backfill.`);

  let inserted = 0;
  let skippedExisting = 0;
  let skippedZero = 0;
  const totalsByTranCode = { 1: 0, 2: 0, 3: 0 };

  for (const line of lines) {
    const amount = round2(line.allocated_amount);
    if (!amount || Math.abs(amount) < 0.01) {
      skippedZero += 1;
      continue;
    }

    const acno = Number(line.source_acno);
    const invoiceTranId = invoiceTranIdMap.get(`${acno}:${line.invoice_no}`) ?? null;

    try {
      await prisma.invoiceKnockoff.create({
        data: {
          source_tran_id: line.source_tran_id,
          source_line_id: line.line_id,
          source_type: sourceTypeFromTranCode(line.tran_code),
          source_acno: acno,
          invoice_no: line.invoice_no,
          invoice_party_acno: acno,
          invoice_tran_id: invoiceTranId,
          allocated_amount: amount,
          is_manual: false,
          run_id: null,
          created_by: null,
        },
      });
      inserted += 1;
      totalsByTranCode[line.tran_code] += amount;
    } catch (error) {
      if (error?.code === "P2002") {
        skippedExisting += 1;
      } else {
        throw error;
      }
    }
  }

  console.log("\n--- Backfill summary ---");
  console.log(`Rows scanned:          ${lines.length}`);
  console.log(`Rows inserted:         ${inserted}`);
  console.log(`Rows skipped (exists): ${skippedExisting}`);
  console.log(`Rows skipped (zero):   ${skippedZero}`);
  console.log(`$ backfilled — Receipt (tran_code 1): ${round2(totalsByTranCode[1])}`);
  console.log(`$ backfilled — Payment (tran_code 2): ${round2(totalsByTranCode[2])}`);
  console.log(`$ backfilled — JV (tran_code 3):      ${round2(totalsByTranCode[3])}`);
}

main()
  .catch((error) => {
    console.error("Backfill failed:", error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
