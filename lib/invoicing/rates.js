// lib/invoicing/rates.js
// ============================================================
// SERVER ONLY — the DEFAULT rate / GST % proposed for each line of a pending
// (not yet invoiced) document. The user may change any of them on the
// Invoicing screen before generating; these are only the starting point.
//
//   sale             line's saved rate (> 0)  → linked Sale Order line
//                    → customer price list    → 0 ("none")
//                    A Free-of-Cost Sale Order prices every line at 0.
//   purchase         line's saved rate (> 0)  → linked PO line
//                    → the item's last invoiced purchase rate from this vendor
//                    → from any vendor        → 0
//   sale-return      line's saved rate (> 0)  → the original dispatch's invoiced
//                    rate (master.dispatch_no → tran 6; else the Sale Order's
//                    invoiced dispatches)     → 0
//   purchase-return  line's saved rate (> 0)  → the original GRN's invoiced rate
//                    (master.grn_no → tran 4) → 0
//
// "saved" exists because documents posted before 2026-10-25 may still carry
// a rate on their lines; a new physical document always saves 0.
//
// Everything is batched per page of documents — a fixed handful of queries
// whatever the number of rows.
// ============================================================
import prisma from "@/lib/prisma";
import { customerPriceLists } from "@/lib/dispatch/linePricing";

const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const ints = (values) => [...new Set(values.map(Number).filter((n) => Number.isInteger(n) && n > 0))];

// Documents that count as invoiced for "original" / "last purchase" lookups.
const INVOICED_SQL = `(COALESCE(btrim(tm.invoice_no), '') <> '' OR tm.invoice_series = 'L')`;

/** First line per key with a positive rate, from rows already ordered newest first. */
function firstByKey(rows, keyOf) {
  const out = new Map();
  for (const r of rows) {
    const key = keyOf(r);
    if (!out.has(key) && num(r.rate) > 0) out.set(key, { rate: num(r.rate), st_rate: num(r.st_rate) });
  }
  return out;
}

/** Order lines (SO or PO) of the documents, by order_no → itcd. */
function orderRates(orderRelation) {
  const out = new Map();
  for (const d of orderRelation?.orderDetails ?? []) {
    if (d.itcd == null || out.has(d.itcd)) continue;
    if (num(d.rate) > 0) out.set(d.itcd, { rate: num(d.rate), st_rate: num(d.st_rate) });
  }
  return out;
}

async function lastPurchaseRates(docs, db) {
  const pycds = ints(docs.map((d) => d.pycd));
  const itcds = ints(docs.flatMap((d) => (d.transactions ?? []).map((t) => t.itcd)));
  if (!itcds.length) return { byVendor: new Map(), anyVendor: new Map() };

  const vendorRows = pycds.length
    ? await db.$queryRawUnsafe(
        `SELECT DISTINCT ON (tm.pycd, t.itcd) tm.pycd, t.itcd, t.rate, t.st_rate
           FROM "Transactions" t
           JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
          WHERE tm.tran_code = 4 AND ${INVOICED_SQL}
            AND t.sub_tran_id = 1 AND t.rate > 0
            AND t.itcd = ANY($1::int[]) AND tm.pycd = ANY($2::int[])
          ORDER BY tm.pycd, t.itcd, tm.dated DESC NULLS LAST, tm.tran_id DESC`,
        itcds,
        pycds,
      )
    : [];
  const anyRows = await db.$queryRawUnsafe(
    `SELECT DISTINCT ON (t.itcd) t.itcd, t.rate, t.st_rate
       FROM "Transactions" t
       JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      WHERE tm.tran_code = 4 AND ${INVOICED_SQL}
        AND t.sub_tran_id = 1 AND t.rate > 0
        AND t.itcd = ANY($1::int[])
      ORDER BY t.itcd, tm.dated DESC NULLS LAST, tm.tran_id DESC`,
    itcds,
  );
  return {
    byVendor: firstByKey(vendorRows, (r) => `${r.pycd}:${r.itcd}`),
    anyVendor: firstByKey(anyRows, (r) => r.itcd),
  };
}

/**
 * Invoiced rates of the ORIGINAL documents a return refers to.
 *   column    "dispatch_no" | "grn_no" | "so_no" — the link on the original
 *   tranCode  6 | 4 — the original's tran_code
 * @returns Map<"<link>:<itcd>", { rate, st_rate }> (latest invoiced first)
 */
async function originalRates(column, tranCode, links, db) {
  const values = ints(links);
  if (!values.length) return new Map();
  const rows = await db.$queryRawUnsafe(
    `SELECT DISTINCT ON (tm.${column}, t.itcd) tm.${column} AS link, t.itcd, t.rate, t.st_rate
       FROM "Transactions" t
       JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      WHERE tm.tran_code = ${Number(tranCode)} AND ${INVOICED_SQL}
        AND t.sub_tran_id = 1 AND t.rate > 0
        AND tm.${column} = ANY($1::int[])
      ORDER BY tm.${column}, t.itcd, tm.dated DESC NULLS LAST, tm.tran_id DESC`,
    values,
  );
  return firstByKey(rows, (r) => `${r.link}:${r.itcd}`);
}

const NONE = { rate: 0, st_rate: 0, source: "none" };

/**
 * Default rates for every sub_tran_id=1 line of `docs` (pending documents
 * loaded with INVOICING_INCLUDE from lib/invoicing/core.js).
 * @returns Map<line_id, { rate, st_rate, source }>
 */
export async function defaultRatesFor(kind, docs, { db = prisma } = {}) {
  const out = new Map();
  if (!docs.length) return out;

  let priceLists = new Map();
  let purchases = null;
  let originals = new Map();
  let bySo = new Map();

  if (kind === "sale") {
    priceLists = await customerPriceLists(
      docs.map((d) => d.pycd),
      docs.flatMap((d) => (d.transactions ?? []).map((t) => t.itcd)),
      { db },
    );
  } else if (kind === "purchase") {
    purchases = await lastPurchaseRates(docs, db);
  } else if (kind === "sale-return") {
    originals = await originalRates("dispatch_no", 6, docs.map((d) => d.dispatch_no), db);
    bySo = await originalRates("so_no", 6, docs.map((d) => d.so_no), db);
  } else if (kind === "purchase-return") {
    originals = await originalRates("grn_no", 4, docs.map((d) => d.grn_no), db);
  }

  for (const doc of docs) {
    const freeOfCost = kind === "sale" && doc.ordersSO?.freeOfCost === true;
    const so = kind === "sale" ? orderRates(doc.ordersSO) : null;
    const po = kind === "purchase" ? orderRates(doc.ordersPO) : null;
    const list = priceLists.get(doc.pycd);

    for (const line of doc.transactions ?? []) {
      if (line.sub_tran_id !== 1) continue;
      const itcd = line.itcd;
      let pick = null;

      if (freeOfCost) {
        pick = { rate: 0, st_rate: 0, source: "order" };
      } else if (num(line.rate) > 0) {
        pick = { rate: num(line.rate), st_rate: num(line.st_rate), source: "saved" };
      } else if (kind === "sale") {
        const o = so.get(itcd);
        const p = list?.get(itcd);
        if (o) pick = { ...o, source: "order" };
        else if (p) pick = { ...p, source: "price_list" };
      } else if (kind === "purchase") {
        const o = po.get(itcd);
        const v = purchases.byVendor.get(`${doc.pycd}:${itcd}`);
        const a = purchases.anyVendor.get(itcd);
        if (o) pick = { ...o, source: "order" };
        else if (v) pick = { ...v, source: "last_purchase" };
        else if (a) pick = { ...a, source: "last_purchase" };
      } else if (kind === "sale-return") {
        const o =
          (doc.dispatch_no ? originals.get(`${doc.dispatch_no}:${itcd}`) : null) ??
          (doc.so_no ? bySo.get(`${doc.so_no}:${itcd}`) : null);
        if (o) pick = { ...o, source: "original" };
      } else if (kind === "purchase-return") {
        const o = originals.get(`${doc.grn_no}:${itcd}`);
        if (o) pick = { ...o, source: "original" };
      }

      out.set(line.id, pick ?? NONE);
    }
  }
  return out;
}
