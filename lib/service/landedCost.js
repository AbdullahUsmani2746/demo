// lib/service/landedCost.js — services spread onto the items of their document.
//
// A Service Invoice (tran_code 21) is linked to a whole GRN (4), dispatch (6)
// or sale return (10) through service_invoice_links (lib/service/serviceInvoice.js,
// lib/service/documentServices.js). Here each service amount is spread over
// that document's item lines (owner, 23 Nov 2026):
//
//   share of a line = its goods value ÷ the document's goods value
//                     (by quantity when the document has no prices yet)
//   an invoice linked to several documents is first split between them the
//   same way (by their goods value, else equally)
//   amount used     = the service line's value before tax (gross_amount, else
//                     damt) — the tax on a service invoice is input tax, not cost
//
// What the share means:
//   GRN (4)                → landed cost: added to the purchase value, so to the
//                            item's average / closing rate (Stock Activity,
//                            lib/stock/averageRate.js, the month-end opening rate)
//   dispatch (6), sale
//   return (10)            → cost of those goods sold (Stock Activity sale cost)
//
// Nothing is stored: the split is worked out when read, so editing a service
// or a document changes it at once. Every reader goes through this file.
// Stock Activity With Rate and Cost of Goods Sold also show it per SERVICE
// CATEGORY (servicesByItem purchaseBy / saleBy → serviceCategoryColumns).
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";

const SOURCE_CODES = [4, 6, 10];
const num = (v) => Number(v) || 0;

/** Goods value of an item line, by its document type (the same columns the reports use). */
const LINE_VALUE = Prisma.sql`CASE m.tran_code WHEN 6 THEN COALESCE(t.camt, 0) WHEN 9 THEN COALESCE(t.camt, 0) ELSE COALESCE(t.damt, 0) END`;

/**
 * The split itself, as SQL rows: one row per (item line, service).
 * `docWhere` limits the documents (a Prisma.sql condition on alias `m`).
 */
function allocationSql(docWhere) {
  return Prisma.sql`
    WITH docs AS (
      SELECT m.tran_id FROM "TRANSACTIONS_MASTER" m
       WHERE m.tran_code IN (${Prisma.join(SOURCE_CODES)}) AND ${docWhere}
    ), links AS (
      SELECT DISTINCT l.tran_id AS inv_id, l.source_tran_id AS doc_id
        FROM service_invoice_links l
        JOIN "TRANSACTIONS_MASTER" s ON s.tran_id = l.tran_id AND s.tran_code = 21
       WHERE l.tran_id IN (SELECT l2.tran_id FROM service_invoice_links l2 WHERE l2.source_tran_id IN (SELECT tran_id FROM docs))
    ), doclines AS (
      SELECT m.tran_id AS doc_id, m.tran_code, m.dated, COALESCE(t.godown, m.godown) AS godown,
             t.id AS line_id, t.itcd, COALESCE(t.qty, 0) AS qty, ${LINE_VALUE} AS val
        FROM "TRANSACTIONS_MASTER" m
        JOIN "Transactions" t ON t.tran_id = m.tran_id
       WHERE m.tran_id IN (SELECT doc_id FROM links)
         AND t.sub_tran_id = 1 AND t.itcd IS NOT NULL
    ), doctot AS (
      SELECT doc_id, SUM(val) AS val, SUM(qty) AS qty FROM doclines GROUP BY doc_id
    ), share AS (
      SELECT l.inv_id, l.doc_id,
             CASE WHEN SUM(d.val) OVER (PARTITION BY l.inv_id) > 0
                  THEN d.val / SUM(d.val) OVER (PARTITION BY l.inv_id)
                  ELSE 1.0 / COUNT(*) OVER (PARTITION BY l.inv_id) END AS w
        FROM links l JOIN doctot d ON d.doc_id = l.doc_id
    ), inv AS (
      SELECT t.tran_id AS inv_id, t.service_id, SUM(COALESCE(NULLIF(t.gross_amount, 0), t.damt, 0)) AS amt
        FROM "Transactions" t
       WHERE t.tran_id IN (SELECT inv_id FROM links) AND t.sub_tran_id = 1
       GROUP BY t.tran_id, t.service_id
    )
    SELECT dl.line_id, dl.doc_id, dl.tran_code, dl.itcd, dl.godown, dl.dated, i.service_id,
           (i.amt * s.w * CASE WHEN d.val > 0 THEN dl.val / d.val
                               WHEN d.qty > 0 THEN dl.qty / d.qty ELSE 0 END)::float AS amount
      FROM doclines dl
      JOIN doctot d ON d.doc_id = dl.doc_id
      JOIN share s ON s.doc_id = dl.doc_id
      JOIN inv i ON i.inv_id = s.inv_id
     WHERE dl.doc_id IN (SELECT tran_id FROM docs)`;
}

/**
 * Services per ITEM over a period, for stock valuation:
 *   Map(itcd → { purchase, sale, purchaseBy, saleBy })
 *     purchase = GRN services (landed cost), sale = dispatch + sale-return services;
 *     purchaseBy / saleBy = the same split by SERVICE CATEGORY ({ [sc_id]: amount },
 *     0 = a service without a category) — Stock Activity With Rate / COGS columns.
 * Filters as Stock Activity: dateFrom / dateTo, item, category, godown.
 */
export async function servicesByItem({ dateFrom, dateTo, item, category, godown } = {}) {
  const conds = [Prisma.sql`TRUE`];
  if (dateFrom) conds.push(Prisma.sql`m.dated >= ${new Date(dateFrom)}`);
  if (dateTo) conds.push(Prisma.sql`m.dated <= ${new Date(dateTo)}`);
  const rows = await prisma.$queryRaw`
    SELECT a.itcd, a.tran_code, COALESCE(sv.sc_id, 0) AS sc_id, SUM(a.amount)::float AS amount
      FROM (${allocationSql(Prisma.join(conds, " AND "))}) a
      JOIN "Item" i ON i.itcd = a.itcd
      LEFT JOIN "Service" sv ON sv.id = a.service_id
     WHERE TRUE
       ${item ? Prisma.sql`AND a.itcd = ${Number(item)}` : Prisma.empty}
       ${category ? Prisma.sql`AND i.ic_id = ${Number(category)}` : Prisma.empty}
       ${godown ? Prisma.sql`AND a.godown = ${Number(godown)}` : Prisma.empty}
     GROUP BY a.itcd, a.tran_code, COALESCE(sv.sc_id, 0)`;
  const out = new Map();
  for (const r of rows) {
    const cur = out.get(Number(r.itcd)) || { purchase: 0, sale: 0, purchaseBy: {}, saleBy: {} };
    const amt = num(r.amount);
    const cat = Number(r.sc_id) || 0;
    if (Number(r.tran_code) === 4) {
      cur.purchase += amt;
      cur.purchaseBy[cat] = (cur.purchaseBy[cat] || 0) + amt;
    } else {
      cur.sale += amt;
      cur.saleBy[cat] = (cur.saleBy[cat] || 0) + amt;
    }
    out.set(Number(r.itcd), cur);
  }
  return out;
}

/**
 * Sale-side services (dispatch + sale-return Service Invoices) per CUSTOMER
 * and item over a period, for Customer Based Gross Margin:
 *   Map(`${pycd}|${itcd}` → { total, by: { [sc_id]: amount } })   (0 = no category)
 * The customer is the dispatch's / return's party.
 */
export async function saleServicesByCustomerItem({ dateFrom, dateTo, customer, item } = {}) {
  const conds = [Prisma.sql`m.tran_code IN (6, 10)`];
  if (dateFrom) conds.push(Prisma.sql`m.dated >= ${new Date(dateFrom)}`);
  if (dateTo) conds.push(Prisma.sql`m.dated <= ${new Date(dateTo)}`);
  if (customer) conds.push(Prisma.sql`m.pycd = ${Number(customer)}`);
  const rows = await prisma.$queryRaw`
    SELECT dm.pycd, a.itcd, COALESCE(sv.sc_id, 0) AS sc_id, SUM(a.amount)::float AS amount
      FROM (${allocationSql(Prisma.join(conds, " AND "))}) a
      JOIN "TRANSACTIONS_MASTER" dm ON dm.tran_id = a.doc_id
      LEFT JOIN "Service" sv ON sv.id = a.service_id
     WHERE a.tran_code IN (6, 10)
       ${item ? Prisma.sql`AND a.itcd = ${Number(item)}` : Prisma.empty}
     GROUP BY dm.pycd, a.itcd, COALESCE(sv.sc_id, 0)`;
  const out = new Map();
  for (const r of rows) {
    const key = `${Number(r.pycd) || 0}|${Number(r.itcd)}`;
    const cur = out.get(key) || { total: 0, by: {} };
    const cat = Number(r.sc_id) || 0;
    cur.by[cat] = (cur.by[cat] || 0) + num(r.amount);
    cur.total += num(r.amount);
    out.set(key, cur);
  }
  return out;
}

/**
 * Report columns for amounts split by service category. Rows carry
 * `<prefix><sc_id>` fields (e.g. pur_svc_c2); each spec = { prefix, band,
 * bandLabel?, before? } names the report's header band the columns join (an
 * existing layout group id, or a new band) and the column they go in front
 * of. One column per category used, named after it; rows missing one get 0.
 * Sent as config.extraColumns (the report config sets `apiExtraColumns`).
 */
export async function serviceCategoryColumns(rows, specs) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const found = specs.map((s) => {
    const ids = new Set();
    for (const r of rows) for (const k of Object.keys(r)) if (k.startsWith(s.prefix)) ids.add(Number(k.slice(s.prefix.length)));
    return [...ids];
  });
  const all = [...new Set(found.flat())].filter(Boolean);
  const cats = all.length
    ? await prisma.serviceCategory.findMany({ where: { id: { in: all } }, select: { id: true, sc_name: true } })
    : [];
  const nameOf = new Map(cats.map((c) => [c.id, c.sc_name]));
  const columns = [];
  specs.forEach((s, i) => {
    const ids = found[i].sort((a, b) => String(nameOf.get(a) ?? "~").localeCompare(String(nameOf.get(b) ?? "~")));
    for (const id of ids) {
      const field = `${s.prefix}${id}`;
      for (const r of rows) if (r[field] == null) r[field] = 0;
      columns.push({
        field,
        headerName: `${nameOf.get(id) || "Other services"}${s.suffix ?? ""}`,
        width: 16,
        type: "currency",
        showTotal: true,
        extra: { id: s.band, label: s.bandLabel, before: s.before },
      });
    }
  });
  return columns;
}

/** GRN services of one item within [from, to) — for averageRate(). */
export async function purchaseServicesOf(itcd, from, to) {
  const rows = await prisma.$queryRaw`
    SELECT COALESCE(SUM(a.amount), 0)::float AS amount
      FROM (${allocationSql(Prisma.sql`m.tran_code = 4 AND m.dated >= ${from} AND m.dated < ${to}`)}) a
     WHERE a.itcd = ${Number(itcd)}`;
  return num(rows[0]?.amount);
}

/**
 * Services per item LINE, for the reports:
 *   { byLine: Map(line_id → { total, by: { [service_id]: amount } }),
 *     services: [{ id, name }] }   (the services that appear, by name)
 */
export async function servicesByLine(lineIds) {
  const ids = [...new Set((lineIds || []).map(Number).filter(Number.isInteger))];
  if (!ids.length) return { byLine: new Map(), services: [] };
  const rows = await prisma.$queryRaw`
    SELECT a.line_id, a.service_id, SUM(a.amount)::float AS amount
      FROM (${allocationSql(Prisma.sql`m.tran_id IN (SELECT tt.tran_id FROM "Transactions" tt WHERE tt.id IN (${Prisma.join(ids)}))`)}) a
     WHERE a.line_id IN (${Prisma.join(ids)})
     GROUP BY a.line_id, a.service_id`;
  const byLine = new Map();
  const used = new Set();
  for (const r of rows) {
    const amt = num(r.amount);
    if (!amt) continue;
    const cur = byLine.get(Number(r.line_id)) || { total: 0, by: {} };
    const sid = r.service_id == null ? 0 : Number(r.service_id);
    cur.by[sid] = (cur.by[sid] || 0) + amt;
    cur.total += amt;
    byLine.set(Number(r.line_id), cur);
    used.add(sid);
  }
  const names = used.size
    ? await prisma.service.findMany({ where: { id: { in: [...used].filter(Boolean) } }, select: { id: true, service_name: true } })
    : [];
  const nameOf = new Map(names.map((s) => [s.id, s.service_name]));
  const services = [...used]
    .map((id) => ({ id, name: nameOf.get(id) || (id ? `Service ${id}` : "Other service") }))
    .sort((a, b) => a.name.localeCompare(b.name));
  return { byLine, services };
}

const round2 = (n) => Math.round(num(n) * 100) / 100;

/**
 * Adds the services breakdown to report rows (GRN, dispatch, returns,
 * purchase, sale). A row is either a document / group with `transactions`
 * (its item lines) or one item line itself (`id` + `itcd`). Each row — and
 * each of its lines — gets:
 *   svc_<service_id>   that service's share
 *   services_amount    all services
 *   landed_amount      goods value + services (purchase side)  ·  goods − services (sale side)
 *   landed_rate        landed_amount ÷ qty
 * A line with a negative quantity (a return shown inside a purchase / sale
 * report) carries its services with the same sign.
 * `side`: "purchase" (GRN, purchase, GRN return) or "sale" (dispatch, sale, returns).
 * @returns {Promise<Array>} the report columns to add (one per service used + totals)
 */
export async function attachServices(rows, { side = "purchase", goodsField = null } = {}) {
  if (!Array.isArray(rows) || !rows.length) return [];
  const linesOf = (row) =>
    Array.isArray(row?.transactions) ? row.transactions.filter((l) => l && l.itcd != null && Number(l.sub_tran_id ?? 1) === 1) : row?.id && row?.itcd != null ? [row] : [];
  const ids = rows.flatMap((r) => linesOf(r).map((l) => l.id));
  const { byLine, services } = await servicesByLine(ids);
  const sign = (l) => (num(l.qty) < 0 ? -1 : 1);
  const lineGoods = (l) => {
    const v = num(l.gross_amount) || num(l.damt) || num(l.camt);
    return num(l.qty) < 0 ? -Math.abs(v) : v;
  };
  const decorate = (target, lines, goods, qty) => {
    let total = 0;
    const by = {};
    for (const l of lines) {
      const a = byLine.get(Number(l.id));
      if (!a) continue;
      for (const [sid, amt] of Object.entries(a.by)) by[sid] = (by[sid] || 0) + sign(l) * amt;
      total += sign(l) * a.total;
    }
    for (const s of services) target[`svc_${s.id}`] = round2(by[s.id] || 0);
    target.services_amount = round2(total);
    target.landed_amount = round2(side === "sale" ? goods - total : goods + total);
    target.landed_rate = qty ? round2(target.landed_amount / qty) : 0;
  };
  for (const row of rows) {
    const lines = linesOf(row);
    for (const l of lines) if (l !== row) decorate(l, [l], lineGoods(l), num(l.qty));
    const goods = goodsField && row[goodsField] != null ? num(row[goodsField]) : lines.reduce((s, l) => s + lineGoods(l), 0);
    const qty = row.total_qty != null ? num(row.total_qty) : lines.reduce((s, l) => s + num(l.qty), 0);
    decorate(row, lines, goods, qty);
  }
  return serviceColumns(services, side);
}

/** The report columns for a services breakdown. */
export function serviceColumns(services, side = "purchase") {
  return [
    ...services.map((s) => ({ field: `svc_${s.id}`, headerName: s.name, width: 110, type: "currency", showTotal: true })),
    { field: "services_amount", headerName: "Services total", width: 110, type: "currency", showTotal: true },
    side === "sale"
      ? { field: "landed_amount", headerName: "Net of services", width: 120, type: "currency", showTotal: true }
      : { field: "landed_amount", headerName: "Landed cost", width: 120, type: "currency", showTotal: true },
    side === "sale"
      ? { field: "landed_rate", headerName: "Net rate", width: 90, type: "currency" }
      : { field: "landed_rate", headerName: "Landed rate", width: 90, type: "currency" },
  ];
}
