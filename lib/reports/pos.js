// lib/reports/pos.js
// ============================================================
// Point-of-sale reports for the report engine (rule 6 / 15):
//   posTransactions     every POS receipt (sales and returns) — voucher drill
//   posDailySales       one row per day: sales, returns, net, by payment method
//   posSalesByItem      one row per item: sold, returned, net qty and value
//   posSalesByPayment   one row per payment method: taken, refunded, net
//   posSalesByCashier   one row per cashier: receipts, returns, net, average bill
//   posReturns          every POS return with the receipt it refunds
//
// A person without pos.allShifts sees only the receipts they rang up (the
// cashier filter is forced to them). Sales = tran_code 5; POS returns =
// tran_code 12 made at the till (a pos_receipts row). Old POS sales made before
// pos_receipts existed are included with their figures taken from the voucher
// lines and payment "—".
// ============================================================
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { can } from "@/lib/auth/permissions";
import { round2 } from "@/lib/pos/calc";
import { getAccount } from "@/lib/accounts/accountSettings";

export const POS_REPORTS = ["posTransactions", "posDailySales", "posSalesByItem", "posSalesByPayment", "posSalesByCashier", "posReturns"];

const METHOD_LABEL = { CASH: "Cash", CARD: "Card / Bank", CREDIT: "Credit (account)" };

function range(filters) {
  const from = filters.dateFrom ? new Date(filters.dateFrom) : new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const to = filters.dateTo ? new Date(filters.dateTo) : new Date();
  from.setHours(0, 0, 0, 0);
  to.setHours(23, 59, 59, 999);
  return { from, to };
}

async function cashierFilter(filters, session) {
  if (session && !(await can(session, "pos.allShifts"))) return String(session.user.id);
  return filters.cashier ? String(filters.cashier) : null;
}

/** One row per receipt in the period (sales + till returns). */
async function receiptRows(filters, session) {
  const { from, to } = range(filters);
  const cashier = await cashierFilter(filters, session);
  const customer = filters.customer && filters.customer !== "all" ? Number(filters.customer) : null;
  const item = filters.item ? Number(filters.item) : null;

  const rows = await prisma.$queryRaw`
    SELECT tm.tran_id, tm.tran_code, tm.vr_no, tm.invoice_no, tm.dated, tm.time, tm.user_id, tm.pycd,
           tm.rmk1 AS reason,
           a.acname AS party_name,
           pr.customer_name, pr.ref_tran_id, pr.subtotal, pr.discount, pr.tax, pr.rounding, pr.total,
           pr.tendered, pr.change_due, (pr.tran_id IS NOT NULL) AS has_receipt,
           ref.invoice_no AS ref_invoice_no,
           u.name AS entered_by,
           l.gross, l.net, l.ltax, l.qty
      FROM "TRANSACTIONS_MASTER" tm
      LEFT JOIN pos_receipts pr ON pr.tran_id = tm.tran_id
      LEFT JOIN acno a ON a.acno = tm.pycd
      LEFT JOIN "User" u ON u.id = tm.user_id
      LEFT JOIN LATERAL (SELECT r.invoice_no FROM "TRANSACTIONS_MASTER" r WHERE r.tran_id = pr.ref_tran_id) ref ON true
      LEFT JOIN LATERAL (
        SELECT SUM(COALESCE(t.gross_amount, 0)) AS gross,
               SUM(CASE WHEN tm.tran_code = 5 THEN COALESCE(t.camt, 0) ELSE COALESCE(t.damt, 0) END) AS net,
               SUM(COALESCE(t.st_amount, 0)) AS ltax,
               SUM(COALESCE(t.qty, 0)) AS qty
          FROM "Transactions" t
         WHERE t.tran_id = tm.tran_id AND t.sub_tran_id = 1 AND t.itcd IS NOT NULL
      ) l ON true
     WHERE tm.tran_code IN (5, 12)
       AND (tm.tran_code = 5 OR pr.tran_id IS NOT NULL)
       AND tm.dated >= ${from} AND tm.dated <= ${to}
       ${cashier ? Prisma.sql`AND tm.user_id = ${cashier}` : Prisma.empty}
       ${customer ? Prisma.sql`AND tm.pycd = ${customer}` : Prisma.empty}
       ${item ? Prisma.sql`AND EXISTS (SELECT 1 FROM "Transactions" ti WHERE ti.tran_id = tm.tran_id AND ti.itcd = ${item})` : Prisma.empty}
     ORDER BY tm.dated, tm.tran_id`;

  const till = new Set((await Promise.all([getAccount("pos_cash"), getAccount("pos_card")])).filter((a) => a != null));
  const ids = rows.map((r) => r.tran_id);
  const pays = ids.length ? await prisma.posPayment.findMany({ where: { tran_id: { in: ids } } }) : [];
  const payOf = new Map();
  for (const p of pays) {
    const m = payOf.get(p.tran_id) || {};
    m[p.method] = round2((m[p.method] || 0) + p.amount);
    payOf.set(p.tran_id, m);
  }
  return rows.map((r) => {
    const sale = r.tran_code === 5;
    const net = Number(r.net || 0);
    const tax = r.has_receipt ? Number(r.tax || 0) : Number(r.ltax || 0);
    const total = r.has_receipt ? Number(r.total || 0) : round2(net + tax);
    const pay = payOf.get(r.tran_id) || {};
    const methods = Object.keys(pay);
    return {
      tran_id: r.tran_id,
      tran_code: r.tran_code,
      kind: sale ? "Sale" : "Return",
      vr_no: r.vr_no,
      invoice_no: r.invoice_no,
      dated: r.time || r.dated,
      time: (r.time || r.dated) ? new Date(r.time || r.dated).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : "",
      day: r.dated,
      user_id: r.user_id,
      entered_by: r.user_id ? r.entered_by || "" : "System",
      // Till receipts carry their customer; old POS sales: the party, unless it is the POS Cash / Card account (walk-in).
      customer_name: r.has_receipt ? r.customer_name || "" : till.has(r.pycd) ? "" : r.party_name || "",
      pycd: r.pycd,
      ref_tran_id: r.ref_tran_id,
      ref_invoice_no: r.ref_invoice_no || "",
      reason: sale ? "" : r.reason || "",
      qty: Number(r.qty || 0),
      gross: r.has_receipt ? Number(r.subtotal || 0) : Number(r.gross || 0),
      discount: r.has_receipt ? Number(r.discount || 0) : round2(Number(r.gross || 0) - net),
      net,
      tax,
      rounding: Number(r.rounding || 0),
      total,
      tendered: Number(r.tendered || 0),
      change_due: Number(r.change_due || 0),
      cash: pay.CASH || 0,
      card: pay.CARD || 0,
      credit: pay.CREDIT || 0,
      payment_mode: methods.length ? methods.map((m) => METHOD_LABEL[m] || m).join(" + ") : "—",
      methods,
    };
  });
}

const sign = (r) => (r.tran_code === 5 ? 1 : -1);

// ── posTransactions ─────────────────────────────────────────────────────
async function posTransactions(filters, session) {
  let rows = await receiptRows(filters, session);
  const kind = filters.kind || "all";
  if (kind === "sale") rows = rows.filter((r) => r.tran_code === 5);
  if (kind === "return") rows = rows.filter((r) => r.tran_code === 12);
  const mode = String(filters.paymentMode || "all").toUpperCase();
  if (mode !== "ALL") rows = rows.filter((r) => r.methods.includes(mode));
  return rows.map(({ methods, day, user_id, ...r }) => ({
    ...r,
    // Returns count against the totals.
    total_signed: round2(sign(r) * r.total),
  }));
}

function posTransactionsSummary(rows) {
  const sales = rows.filter((r) => r.tran_code === 5);
  const rets = rows.filter((r) => r.tran_code === 12);
  const sum = (list, f) => round2(list.reduce((s, r) => s + Number(r[f] || 0), 0));
  return {
    receipts: sales.length,
    returns: rets.length,
    sales_total: sum(sales, "total"),
    returns_total: sum(rets, "total"),
    net_total: round2(sum(sales, "total") - sum(rets, "total")),
    discount: sum(sales, "discount"),
  };
}

// ── posDailySales ───────────────────────────────────────────────────────
function dayKey(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, "0")}-${String(x.getDate()).padStart(2, "0")}`;
}

async function posDailySales(filters, session) {
  const rows = await receiptRows(filters, session);
  const days = new Map();
  for (const r of rows) {
    const k = dayKey(r.day);
    const d = days.get(k) || { dated: new Date(`${k}T00:00:00`), day_key: k, receipts: 0, returns: 0, qty: 0, gross_sales: 0, discount: 0, tax: 0, sales_total: 0, returns_total: 0, net_sales: 0, cash: 0, card: 0, credit: 0 };
    const s = sign(r);
    if (s > 0) {
      d.receipts += 1;
      d.qty += r.qty;
      d.gross_sales += r.gross;
      d.discount += r.discount;
      d.sales_total += r.total;
    } else {
      d.returns += 1;
      d.qty -= r.qty;
      d.returns_total += r.total;
    }
    d.tax += s * r.tax;
    d.net_sales += s * r.total;
    d.cash += s * r.cash;
    d.card += s * r.card;
    d.credit += s * r.credit;
    days.set(k, d);
  }
  return [...days.values()].map((d) => {
    const out = { ...d };
    for (const f of ["qty", "gross_sales", "discount", "tax", "sales_total", "returns_total", "net_sales", "cash", "card", "credit"]) out[f] = round2(out[f]);
    out.average_bill = d.receipts ? round2(d.sales_total / d.receipts) : 0;
    return out;
  });
}

// ── posSalesByPayment ───────────────────────────────────────────────────
async function posSalesByPayment(filters, session) {
  const rows = await receiptRows(filters, session);
  const out = new Map();
  for (const r of rows) {
    const entries = r.methods.length ? r.methods.map((m) => [m, r[m.toLowerCase()]]) : [["UNKNOWN", r.total]];
    for (const [m, amt] of entries) {
      const x = out.get(m) || { method: m, payment_mode: METHOD_LABEL[m] || "Not recorded (old sales)", receipts: 0, returns: 0, taken: 0, refunded: 0, net: 0 };
      if (r.tran_code === 5) { x.receipts += 1; x.taken += amt; } else { x.returns += 1; x.refunded += amt; }
      x.net = x.taken - x.refunded;
      out.set(m, x);
    }
  }
  const total = [...out.values()].reduce((s, x) => s + x.net, 0);
  return [...out.values()].map((x) => ({ ...x, taken: round2(x.taken), refunded: round2(x.refunded), net: round2(x.net), share: total ? round2((x.net / total) * 100) : 0 }));
}

// ── posSalesByCashier ───────────────────────────────────────────────────
async function posSalesByCashier(filters, session) {
  const rows = await receiptRows(filters, session);
  const out = new Map();
  for (const r of rows) {
    const k = r.user_id || "system";
    const x = out.get(k) || { cashier: r.user_id || "", cashier_name: r.entered_by || "System", receipts: 0, returns: 0, qty: 0, discount: 0, sales_total: 0, returns_total: 0, net_sales: 0, cash: 0 };
    const s = sign(r);
    if (s > 0) { x.receipts += 1; x.qty += r.qty; x.discount += r.discount; x.sales_total += r.total; } else { x.returns += 1; x.qty -= r.qty; x.returns_total += r.total; }
    x.net_sales += s * r.total;
    x.cash += s * r.cash;
    out.set(k, x);
  }
  return [...out.values()].map((x) => ({
    ...x,
    qty: round2(x.qty), discount: round2(x.discount), sales_total: round2(x.sales_total), returns_total: round2(x.returns_total), net_sales: round2(x.net_sales), cash: round2(x.cash),
    average_bill: x.receipts ? round2(x.sales_total / x.receipts) : 0,
  }));
}

// ── posReturns ──────────────────────────────────────────────────────────
async function posReturns(filters, session) {
  const rows = (await receiptRows(filters, session)).filter((r) => r.tran_code === 12);
  return rows.map(({ methods, day, user_id, ...r }) => ({ ...r, refund_mode: r.payment_mode }));
}

// ── posSalesByItem ──────────────────────────────────────────────────────
async function posSalesByItem(filters, session) {
  const { from, to } = range(filters);
  const cashier = await cashierFilter(filters, session);
  const category = filters.category ? Number(filters.category) : null;
  const rows = await prisma.$queryRaw`
    SELECT t.itcd, i.code AS item_code, i.item AS item_name, ic.ic_name AS category,
           SUM(CASE WHEN tm.tran_code = 5 THEN COALESCE(t.qty, 0) ELSE 0 END) AS qty_sold,
           SUM(CASE WHEN tm.tran_code = 12 THEN COALESCE(t.qty, 0) ELSE 0 END) AS qty_returned,
           SUM(CASE WHEN tm.tran_code = 5 THEN COALESCE(t.gross_amount, 0) ELSE 0 END) AS gross_sales,
           SUM(CASE WHEN tm.tran_code = 5 THEN COALESCE(t.gross_amount, 0) - COALESCE(t.camt, 0) ELSE 0 END) AS discount,
           SUM(CASE WHEN tm.tran_code = 5 THEN COALESCE(t.camt, 0) ELSE 0 END) AS sales_value,
           SUM(CASE WHEN tm.tran_code = 12 THEN COALESCE(t.damt, 0) ELSE 0 END) AS returns_value,
           SUM(CASE WHEN tm.tran_code = 5 THEN COALESCE(t.st_amount, 0) ELSE -COALESCE(t.st_amount, 0) END) AS tax,
           COUNT(DISTINCT CASE WHEN tm.tran_code = 5 THEN tm.tran_id END) AS receipts
      FROM "TRANSACTIONS_MASTER" tm
      JOIN "Transactions" t ON t.tran_id = tm.tran_id AND t.sub_tran_id = 1 AND t.itcd IS NOT NULL
      LEFT JOIN pos_receipts pr ON pr.tran_id = tm.tran_id
      LEFT JOIN "Item" i ON i.itcd = t.itcd
      LEFT JOIN "ItemCategory" ic ON ic.id = i.ic_id
     WHERE tm.tran_code IN (5, 12)
       AND (tm.tran_code = 5 OR pr.tran_id IS NOT NULL)
       AND tm.dated >= ${from} AND tm.dated <= ${to}
       ${cashier ? Prisma.sql`AND tm.user_id = ${cashier}` : Prisma.empty}
       ${category ? Prisma.sql`AND i.ic_id = ${category}` : Prisma.empty}
     GROUP BY t.itcd, i.code, i.item, ic.ic_name
     ORDER BY SUM(CASE WHEN tm.tran_code = 5 THEN COALESCE(t.camt, 0) ELSE -COALESCE(t.damt, 0) END) DESC`;
  return rows.map((r) => {
    const sold = Number(r.qty_sold || 0);
    const ret = Number(r.qty_returned || 0);
    const sv = Number(r.sales_value || 0);
    const rv = Number(r.returns_value || 0);
    return {
      itcd: r.itcd,
      item_code: r.item_code || "",
      item_name: r.item_name || `Item #${r.itcd}`,
      category: r.category || "",
      receipts: Number(r.receipts || 0),
      qty_sold: round2(sold),
      qty_returned: round2(ret),
      net_qty: round2(sold - ret),
      gross_sales: round2(Number(r.gross_sales || 0)),
      discount: round2(Number(r.discount || 0)),
      sales_value: round2(sv),
      returns_value: round2(rv),
      net_value: round2(sv - rv),
      tax: round2(Number(r.tax || 0)),
      average_rate: sold ? round2(sv / sold) : 0,
    };
  });
}

const sumOf = (rows, fields) => Object.fromEntries(fields.map((f) => [f, round2(rows.reduce((s, r) => s + Number(r[f] || 0), 0))]));

/** The engine's entry point: { data, summary }. */
export async function getPosReport(reportType, filters, session) {
  switch (reportType) {
    case "posTransactions": {
      const data = await posTransactions(filters, session);
      return { data, summary: posTransactionsSummary(data) };
    }
    case "posDailySales": {
      const data = await posDailySales(filters, session);
      return { data, summary: sumOf(data, ["receipts", "returns", "sales_total", "returns_total", "net_sales", "cash", "card", "credit", "discount"]) };
    }
    case "posSalesByItem": {
      const data = await posSalesByItem(filters, session);
      return { data, summary: { items: data.length, ...sumOf(data, ["net_qty", "sales_value", "returns_value", "net_value"]) } };
    }
    case "posSalesByPayment": {
      const data = await posSalesByPayment(filters, session);
      return { data, summary: sumOf(data, ["taken", "refunded", "net"]) };
    }
    case "posSalesByCashier": {
      const data = await posSalesByCashier(filters, session);
      return { data, summary: { cashiers: data.length, ...sumOf(data, ["receipts", "sales_total", "returns_total", "net_sales"]) } };
    }
    case "posReturns": {
      const data = await posReturns(filters, session);
      return { data, summary: { returns: data.length, ...sumOf(data, ["qty", "total"]) } };
    }
    default:
      throw new Error(`Unknown POS report ${reportType}`);
  }
}
