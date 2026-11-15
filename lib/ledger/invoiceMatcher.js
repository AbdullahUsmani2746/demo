import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { getCustomerOutstanding, getVendorOutstanding } from "./outstandingInvoices";
import {
  getCustomerMacnos,
  getVendorMacnos,
  isCustomerMacno,
} from "@/lib/accounts/partyMacnos";

// `IN (...)` over a configured group. An unset group (empty list) matches
// nothing instead of making Prisma.join throw.
const sqlIn = (list) => Prisma.join(list.length ? list : [null]);

// ============================================================
// Automatic invoice knock-off / reconciliation engine
// ------------------------------------------------------------
// Finds Receipt (tran_code=1) / Payment (tran_code=2) / JV
// (tran_code=3) settlement lines that were posted WITHOUT an
// invoice_no (i.e. NOT created through the "Auto FIFO Settlement"
// screen), and FIFO-matches each one (oldest invoice first)
// against the party's currently outstanding invoices — without
// mutating the original posted transaction. Matches are recorded
// in INVOICE_KNOCKOFF.
//
// Called by both the twice-daily cron (instrumentation.js) and the
// manual "Run Now" API route (app/api/invoice-knockoff/run), same
// shape as lib/openingStockGenerate.js's generateMonthlyOpeningStock.
//
// Partial matches are allowed: a line that can only be partially
// covered by open invoices gets allocated what FIFO can cover, and
// the remainder is left for the next run / manual review.
// ============================================================

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// Arbitrary fixed key for a Postgres session advisory lock — guards against
// the cron and a manual "Run Now" click racing each other.
const ADVISORY_LOCK_KEY = 918273645;

// ============================================================
// Split the settlement line into one row per invoice it pays off
// ------------------------------------------------------------
// INVOICE_KNOCKOFF stays the source of truth for the allocation — it is the
// only place holding a per-invoice amount. This reshapes the posted
// Transactions rows to mirror it, one row per invoice:
//
//   Receipt Rs 50,000 vs open INV-1 10,000 / INV-2 20,000 / INV-3 40,000
//
//     id     camt     invoice_no
//     90211  10,000   INV-1        fully knocked off
//     90312  20,000   INV-2        fully knocked off
//     90313  20,000   INV-3        partial — 20,000 of 40,000 still open
//            ------
//            50,000   = the amount that was posted, unchanged
//
// The first slice reuses the original row (same id), so anything already
// pointing at that line keeps resolving; the extra slices are new rows
// carrying split_from_line_id = the original id. Whatever FIFO could not
// cover stays behind as a slice with invoice_no NULL — an unapplied advance,
// which the next run picks up as a fresh candidate once new invoices exist.
//
// The group total never changes, so the voucher still balances against its
// untouched cash/bank side, and every invoice_no now holds a single real
// invoice number rather than a joined "INV-1,INV-2,INV-3" string.
//
// This runs after every allocation change — auto match, manual override,
// single reversal, whole-run reversal — and always rebuilds the group from
// the currently-active INVOICE_KNOCKOFF rows, so a reversal that leaves
// nothing active collapses the group back to one untagged row.
// ============================================================

// Columns carried onto a newly created slice. Deliberately excludes the
// item/stock and tax/gross columns: a settlement line never populates them,
// and copying a monetary field would multiply it across the group. Rates
// (percentages) are safe to carry; amounts are not.
const SLICE_CARRIED_FIELDS = [
  "tran_id",
  "acno",
  "ccno",
  "sub_tran_id",
  "currency",
  "narration1",
  "narration2",
  "narration3",
  "narration4",
  "narration5",
  "chno",
  "check_date",
  "party_name",
  "wht_rate",
  "st_rate",
];

// ------------------------------------------------------------
// Signed settlement value of a line — mirrors the CASE in findCandidateLines
// ------------------------------------------------------------
// A Receipt credits the customer and a Payment debits the vendor, so those
// are always positive settlements. A JV can go either way, and BOTH sides
// count: for a customer the value is camt - damt, for a vendor damt - camt.
//
// A credit-side JV on a customer behaves like a receipt — it knocks invoices
// down. A debit-side JV is a debit note: it pushes an invoice back UP, so it
// carries a NEGATIVE settlement value and produces negative allocations.
// This is the same netting the legacy ledger used and that
// scripts/backfill-invoice-knockoffs.mjs still preserves.
export function settlementValue(row, tranCode, isCustomer) {
  const damt = Number(row?.damt) || 0;
  const camt = Number(row?.camt) || 0;
  if (tranCode === 1) return round2(camt);
  if (tranCode === 2) return round2(damt);
  return round2(isCustomer ? camt - damt : damt - camt);
}

// The inverse: which columns a slice carrying `value` must be written with.
// A negative value flips to the opposite column as a positive number, so the
// row still reads as an ordinary debit or credit in the ledger.
export function settlementColumns(value, tranCode, isCustomer) {
  const v = round2(value);
  // The side a positive settlement is posted on.
  const positiveSide = tranCode === 1 ? "camt" : tranCode === 2 ? "damt" : isCustomer ? "camt" : "damt";
  const negativeSide = positiveSide === "camt" ? "damt" : "camt";
  return v >= 0
    ? { [positiveSide]: v, [negativeSide]: 0 }
    : { [positiveSide]: 0, [negativeSide]: round2(-v) };
}

// Resolves any slice id to the whole group: the root row (the originally
// posted line) plus every slice split off it, oldest id first.
async function loadLineGroup(client, lineId) {
  const line = await client.transactions.findUnique({
    where: { id: lineId },
    include: { transactionsMaster: true, acnoDetails: true },
  });
  if (!line) return null;

  const rootId = line.split_from_line_id ?? line.id;
  const root =
    rootId === line.id
      ? line
      : await client.transactions.findUnique({
          where: { id: rootId },
          include: { transactionsMaster: true, acnoDetails: true },
        });
  if (!root) return null;

  const extra = await client.transactions.findMany({
    where: { split_from_line_id: root.id },
    orderBy: { id: "asc" },
  });

  const tranCode = root.transactionsMaster.tran_code;
  const isCustomer = await isCustomerMacno(root.acnoDetails?.macno);
  const slices = [root, ...extra];

  return {
    root,
    slices,
    tranCode,
    isCustomer,
    sliceIds: slices.map((s) => s.id),
    // Signed, so a debit-note JV group totals negative.
    total: round2(
      slices.reduce((sum, s) => sum + settlementValue(s, tranCode, isCustomer), 0),
    ),
  };
}

// The full posted amount of a settlement line, summed across its slices.
// Manual allocation validates against this rather than against one row, so
// an already-split line can still be re-allocated up to its original value.
export async function getSettlementLineGroup(client, lineId) {
  return loadLineGroup(client, lineId);
}

export async function resyncLineSplit(client, lineId) {
  const group = await loadLineGroup(client, lineId);
  if (!group) return null;

  const { root, tranCode, isCustomer, sliceIds, total } = group;

  // Active allocations across the whole group, oldest first — FIFO order.
  const active = await client.invoiceKnockoff.findMany({
    where: { source_line_id: { in: sliceIds }, reversed_at: null },
    orderBy: { id: "asc" },
  });

  // One target row per allocation, plus a trailing untagged row holding
  // whatever is still unapplied.
  const targets = active.map((a) => ({
    invoice_no: a.invoice_no,
    amount: round2(a.allocated_amount),
    knockoffId: a.id,
  }));

  const allocated = round2(targets.reduce((sum, t) => sum + t.amount, 0));
  const remainder = round2(total - allocated);

  if (targets.length === 0) {
    targets.push({ invoice_no: null, amount: total, knockoffId: null });
  } else if (Math.abs(remainder) > 0.01) {
    // Signed: an under-applied receipt leaves a positive advance, an
    // under-applied debit note leaves a negative one.
    targets.push({ invoice_no: null, amount: remainder, knockoffId: null });
  } else if (remainder !== 0) {
    // Sub-paisa drift out of the allocation rounding — absorb it into the
    // last slice so the group still sums to exactly what was posted.
    const last = targets[targets.length - 1];
    last.amount = round2(last.amount + remainder);
  }

  // Park every allocation on the root before touching any row, so deleting a
  // surplus slice can never orphan an INVOICE_KNOCKOFF row — reversed ones
  // are kept for audit and still point into this group.
  await client.invoiceKnockoff.updateMany({
    where: { source_line_id: { in: sliceIds } },
    data: { source_line_id: root.id },
  });

  const surplus = sliceIds.slice(targets.length);
  if (surplus.length > 0) {
    await client.transactions.deleteMany({ where: { id: { in: surplus } } });
  }

  const carried = Object.fromEntries(SLICE_CARRIED_FIELDS.map((k) => [k, root[k]]));
  const finalIds = [];

  for (let i = 0; i < targets.length; i += 1) {
    const data = {
      // Signed value back into the right debit/credit column.
      ...settlementColumns(targets[i].amount, tranCode, isCustomer),
      invoice_no: targets[i].invoice_no,
    };

    if (i < sliceIds.length) {
      await client.transactions.update({ where: { id: sliceIds[i] }, data });
      finalIds.push(sliceIds[i]);
    } else {
      const created = await client.transactions.create({
        data: { ...carried, ...data, split_from_line_id: root.id },
      });
      finalIds.push(created.id);
    }
  }

  // Point each allocation back at the slice that now carries it. Anything
  // still on the root (slice 0, and every reversed row) is already correct.
  for (let i = 0; i < targets.length; i += 1) {
    if (targets[i].knockoffId == null || finalIds[i] === root.id) continue;
    await client.invoiceKnockoff.update({
      where: { id: targets[i].knockoffId },
      data: { source_line_id: finalIds[i] },
    });
  }

  return { rootId: root.id, lineIds: finalIds, total, allocated };
}

// Same thing for callers that are not already inside a transaction — the
// rebuild deletes and creates rows, so it must not be observed half-applied.
export function resyncLineSplitAtomic(lineId) {
  return prisma.$transaction((tx) => resyncLineSplit(tx, lineId));
}

// ------------------------------------------------------------
// One allocation row per (line group, invoice)
// ------------------------------------------------------------
// Allocations move between slice rows as the group is rebuilt, and
// INVOICE_KNOCKOFF is uniquely keyed on (source_line_id, invoice_no,
// invoice_party_acno). Creating a second row for an invoice the group has
// already touched — re-matching after a reversal, or a manual override
// replacing an auto match — would collide on that key. So an invoice the
// group has seen before is updated in place and un-reversed rather than
// inserted again.
//
// mode "add" accumulates onto an active row (the FIFO engine topping up a
// partial match); mode "set" replaces it outright (a manual override).
export async function upsertGroupAllocation(
  client,
  { sliceIds, rootId, invoiceNo, acno, amount, mode = "add", data = {} },
) {
  const existing = await client.invoiceKnockoff.findFirst({
    where: {
      source_line_id: { in: sliceIds },
      invoice_no: invoiceNo,
      invoice_party_acno: acno,
    },
    orderBy: { id: "asc" },
  });

  if (existing) {
    // A reversed row restarts from zero; an active one is topped up.
    const base = existing.reversed_at ? 0 : Number(existing.allocated_amount) || 0;
    return client.invoiceKnockoff.update({
      where: { id: existing.id },
      data: {
        ...data,
        allocated_amount: mode === "add" ? round2(base + amount) : round2(amount),
        reversed_at: null,
        reversed_by: null,
      },
    });
  }

  return client.invoiceKnockoff.create({
    data: {
      ...data,
      source_line_id: rootId,
      invoice_no: invoiceNo,
      invoice_party_acno: acno,
      allocated_amount: round2(amount),
    },
  });
}

export function sourceTypeFromTranCode(tranCode) {
  if (tranCode === 1) return "RECEIPT";
  if (tranCode === 2) return "PAYMENT";
  return "JV";
}

// ------------------------------------------------------------
// Voucher edit / delete hooks
// ------------------------------------------------------------
// INVOICE_KNOCKOFF.source_line_id is a hard FK onto Transactions.id, and the
// voucher PUT rebuilds a document by deleting and re-creating every line. So
// a Receipt/Payment/JV that the engine has already allocated could not be
// edited or deleted at all (FK violation). The two hooks below bracket that
// rebuild:
//
//   clearVoucherAllocations  — BEFORE the lines go: drop every allocation
//                              whose source is this voucher. Reversed rows go
//                              too; they point at line ids that will no
//                              longer exist.
//   syncTaggedVoucherLines   — AFTER the new lines exist: any line the user
//                              tagged with an invoice_no becomes an allocation
//                              again (the same rule the one-time backfill
//                              used). Untagged lines are left for the FIFO
//                              cron, exactly like a freshly posted voucher.
//
// Both take the transaction client so the rebuild stays atomic.

const SETTLEMENT_TRAN_CODES = [1, 2, 3];

export async function clearVoucherAllocations(client, tranId) {
  const { count } = await client.invoiceKnockoff.deleteMany({
    where: { source_tran_id: Number(tranId) },
  });
  return count;
}

// Batched on purpose: every round trip to the database costs hundreds of
// milliseconds here, and a receipt can carry 70+ tagged lines. Three queries
// regardless of line count — lines, invoice lookup, one createMany.
export async function syncTaggedVoucherLines(client, tranId, { userId = null } = {}) {
  const [customerMacnos, vendorMacnos] = await Promise.all([getCustomerMacnos(), getVendorMacnos()]);
  const lines = await client.$queryRaw`
    SELECT
      t.id, t.acno, t.invoice_no, t.damt, t.camt,
      tm.tran_code, a.macno
    FROM "Transactions" t
    JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
    JOIN "acno" a ON a.acno = t.acno
    WHERE t.tran_id = ${Number(tranId)}
      AND tm.tran_code IN (1, 2, 3)
      AND t.invoice_no IS NOT NULL AND t.invoice_no <> ''
      AND (t.sub_tran_id IS NULL OR t.sub_tran_id <> 3)
      AND a.macno IN (${sqlIn([...customerMacnos, ...vendorMacnos])})
    ORDER BY t.id ASC
  `;
  if (lines.length === 0) return 0;

  // tran_id of the invoice each (party, invoice_no) tag points at: the latest
  // Sale/Purchase/Service Invoice with that number, else a JV-raised invoice line.
  const acnos = [...new Set(lines.map((l) => Number(l.acno)))];
  const invoiceNos = [...new Set(lines.map((l) => l.invoice_no))];
  const invoices = await client.$queryRaw`
    SELECT DISTINCT ON (party_acno, invoice_no) party_acno, invoice_no, tran_id
    FROM (
      SELECT tm.pycd AS party_acno, tm.invoice_no, tm.tran_id, tm.dated, 0 AS prio
      FROM "TRANSACTIONS_MASTER" tm
      WHERE tm.tran_code IN (4, 6, 21)
        AND tm.pycd IN (${Prisma.join(acnos)})
        AND tm.invoice_no IN (${Prisma.join(invoiceNos)})
      UNION ALL
      SELECT t.acno, t.invoice_no, t.tran_id, tm.dated, 1
      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      WHERE tm.tran_code = 3
        AND t.acno IN (${Prisma.join(acnos)})
        AND t.invoice_no IN (${Prisma.join(invoiceNos)})
        AND t.tran_id <> ${Number(tranId)}
    ) x
    ORDER BY party_acno, invoice_no, prio, dated DESC, tran_id DESC
  `;
  const invoiceTranId = new Map(
    invoices.map((r) => [`${Number(r.party_acno)}:${r.invoice_no}`, Number(r.tran_id)]),
  );

  const rows = [];
  for (const line of lines) {
    const tranCode = Number(line.tran_code);
    const isCustomer = customerMacnos.includes(Number(line.macno));
    const amount = settlementValue(line, tranCode, isCustomer);
    if (Math.abs(amount) < 0.01) continue;
    const acno = Number(line.acno);
    rows.push({
      source_tran_id: Number(tranId),
      source_line_id: Number(line.id),
      source_type: sourceTypeFromTranCode(tranCode),
      source_acno: acno,
      invoice_no: line.invoice_no,
      invoice_party_acno: acno,
      invoice_tran_id: invoiceTranId.get(`${acno}:${line.invoice_no}`) ?? null,
      allocated_amount: amount,
      is_manual: false,
      run_id: null,
      created_by: userId,
    });
  }
  if (rows.length === 0) return 0;

  // The voucher's allocations were cleared (PUT) or never existed (POST);
  // skipDuplicates keeps a re-run harmless under the unique key.
  const { count } = await client.invoiceKnockoff.createMany({ data: rows, skipDuplicates: true });
  return count;
}

// Untagged (invoice_no IS NULL) Receipt/Payment/JV settlement lines, with
// how much of each has already been allocated (for partial-match support).
// `partyType`/`acno` filters are used by the review UI's candidates list;
// the matching engine itself calls this with no filters.
export async function findCandidateLines({ partyType, acno } = {}) {
  // Customers and vendors are the "customers" / "vendors" account groups of
  // Finance → Account Settings (lib/accounts/partyMacnos.js).
  const [customerList, vendorList] = await Promise.all([getCustomerMacnos(), getVendorMacnos()]);
  const macnoFilter =
    partyType === "vendor"
      ? vendorList
      : partyType === "customer"
        ? customerList
        : null;
  const customerMacnos = sqlIn(customerList);
  const vendorMacnos = sqlIn(vendorList);

  return prisma.$queryRaw`
    SELECT
      t.id                                     AS line_id,
      t.tran_id                                AS source_tran_id,
      t.acno                                   AS source_acno,
      a.acname                                 AS party_name,
      tm.tran_code,
      tm.dated,
      tm.vr_no,
      a.macno,
      -- Signed settlement value; mirrors settlementValue() above. A JV nets
      -- BOTH sides, so a debit-only JV on a customer is a negative amount
      -- (a debit note that pushes an invoice back up) rather than invisible.
      CASE
        WHEN tm.tran_code = 1 THEN COALESCE(t.camt, 0)
        WHEN tm.tran_code = 2 THEN COALESCE(t.damt, 0)
        WHEN tm.tran_code = 3 AND a.macno IN (${customerMacnos})
          THEN COALESCE(t.camt, 0) - COALESCE(t.damt, 0)
        WHEN tm.tran_code = 3 AND a.macno IN (${vendorMacnos})
          THEN COALESCE(t.damt, 0) - COALESCE(t.camt, 0)
      END                                       AS line_amount,
      COALESCE(k.allocated, 0)                  AS already_allocated
    FROM "Transactions" t
    JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
    JOIN "acno" a ON a.acno = t.acno
    LEFT JOIN (
      SELECT source_line_id, SUM(allocated_amount) AS allocated
      FROM "INVOICE_KNOCKOFF"
      WHERE reversed_at IS NULL
      GROUP BY source_line_id
    ) k ON k.source_line_id = t.id
    WHERE t.invoice_no IS NULL
      AND (t.sub_tran_id IS NULL OR t.sub_tran_id != 3)
      AND ${macnoFilter ? Prisma.sql`a.macno IN (${sqlIn(macnoFilter)})` : Prisma.sql`1=1`}
      AND ${acno ? Prisma.sql`t.acno = ${Number(acno)}` : Prisma.sql`1=1`}
      AND (
        (tm.tran_code = 1 AND a.macno IN (${customerMacnos}) AND COALESCE(t.camt, 0) > 0)
        OR (tm.tran_code = 2 AND a.macno IN (${vendorMacnos}) AND COALESCE(t.damt, 0) > 0)
        -- A JV qualifies whenever its two sides do not cancel, in either
        -- direction: credit-side settles invoices, debit-side re-opens them.
        OR (
          tm.tran_code = 3
          AND a.macno IN (${customerMacnos}, ${vendorMacnos})
          AND COALESCE(t.camt, 0) <> COALESCE(t.damt, 0)
        )
      )
    ORDER BY tm.dated ASC, t.id ASC
  `;
}

export async function runInvoiceKnockoffMatching({ trigger = "MANUAL", userId = null } = {}) {
  const lockRows = await prisma.$queryRaw`
    SELECT pg_try_advisory_lock(${ADVISORY_LOCK_KEY}::bigint) AS locked
  `;
  const locked = lockRows?.[0]?.locked === true;

  if (!locked) {
    const skippedRun = await prisma.invoiceKnockoffRun.create({
      data: {
        trigger,
        status: "FAILED",
        triggered_by: userId,
        finished_at: new Date(),
        error_message: "Another invoice knock-off run is already in progress",
      },
    });
    return { runId: skippedRun.id, linesScanned: 0, linesMatched: 0, amountMatched: 0 };
  }

  const run = await prisma.invoiceKnockoffRun.create({
    data: { trigger, status: "RUNNING", triggered_by: userId },
  });

  let linesScanned = 0;
  let linesMatched = 0;
  let amountMatched = 0;

  try {
    const customerMacnos = await getCustomerMacnos();
    const candidates = await findCandidateLines();
    linesScanned = candidates.length;

    // Each line re-queries the party's outstanding invoices, and every
    // allocation is committed before the next line is processed — so what
    // earlier lines in THIS run already consumed is visible in that query.
    // There is deliberately no in-memory "consumed" map on top of it:
    // subtracting the same amount twice under-allocates the older invoice
    // and over-allocates the next one down the FIFO chain.
    for (const line of candidates) {
      const lineAmount = round2(line.line_amount);
      const alreadyAllocated = round2(line.already_allocated);
      // Signed: positive settles invoices, negative (a debit-note JV) pushes
      // them back up. Either direction is worth allocating.
      let remaining = round2(lineAmount - alreadyAllocated);
      if (Math.abs(remaining) <= 0.01) continue;

      const isCustomer = customerMacnos.includes(Number(line.macno));
      const acno = Number(line.source_acno);

      // The candidate may itself be a leftover slice of an already-split
      // line, so allocations are keyed to the whole group.
      const group = await loadLineGroup(prisma, line.line_id);
      const rootId = group?.root?.id ?? line.line_id;
      const sliceIds = group?.sliceIds ?? [line.line_id];

      const outstandingInvoices = isCustomer
        ? await getCustomerOutstanding(acno)
        : await getVendorOutstanding(acno);

      let lineMatched = false;

      for (const inv of outstandingInvoices) {
        if (Math.abs(remaining) <= 0.01) break;

        const invRemaining = round2(Number(inv.outstanding));
        if (invRemaining <= 0.01) continue;

        // The invoice's currently-open amount caps how much lands on it in
        // EITHER direction, so a debit note bigger than the oldest open
        // invoice spills down the FIFO chain onto the next one.
        const take =
          remaining > 0
            ? round2(Math.min(remaining, invRemaining))
            : -round2(Math.min(-remaining, invRemaining));
        if (Math.abs(take) <= 0.01) continue;

        await prisma.$transaction((tx) =>
          upsertGroupAllocation(tx, {
            sliceIds,
            rootId,
            invoiceNo: inv.invoice_no,
            acno,
            amount: take,
            mode: "add",
            data: {
              source_tran_id: line.source_tran_id,
              source_type: sourceTypeFromTranCode(line.tran_code),
              source_acno: acno,
              invoice_tran_id: inv.tran_id ?? null,
              is_manual: false,
              run_id: run.id,
            },
          }),
        );

        remaining = round2(remaining - take);
        amountMatched = round2(amountMatched + take);
        lineMatched = true;
      }

      if (lineMatched) {
        linesMatched += 1;
        // Reshape the posted row into one row per invoice just matched.
        await resyncLineSplitAtomic(line.line_id);
      }
    }

    await prisma.invoiceKnockoffRun.update({
      where: { id: run.id },
      data: {
        status: "COMPLETED",
        finished_at: new Date(),
        lines_scanned: linesScanned,
        lines_matched: linesMatched,
        amount_matched: amountMatched,
      },
    });
  } catch (error) {
    await prisma.invoiceKnockoffRun.update({
      where: { id: run.id },
      data: {
        status: "FAILED",
        finished_at: new Date(),
        lines_scanned: linesScanned,
        lines_matched: linesMatched,
        amount_matched: amountMatched,
        error_message: String(error?.message || error),
      },
    });
    throw error;
  } finally {
    await prisma.$queryRaw`SELECT pg_advisory_unlock(${ADVISORY_LOCK_KEY}::bigint)`;
  }

  return { runId: run.id, linesScanned, linesMatched, amountMatched };
}
