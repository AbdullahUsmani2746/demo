import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { saleServicesByCustomerItem } from "@/lib/service/landedCost";

// Customer Based Gross Margin
//   Sales      : tran_code 6 (invoice) + 5 (POS), less 10 (sale return)
//   Cost rate  : Production Cost Entry (incl. CC overhead)  ->
//                Monthly Opening Stock weighted rate        ->
//                period weighted-average purchase rate      -> 0
//   Margin     : sales value - cost value ;  Margin % on cost value
//   Services   : the Service Invoices on the customer's dispatches / sale
//                returns (freight-out …) spread onto their items
//                (lib/service/landedCost.js), one column per service category;
//   Net margin : sales - (cost + services) ; Net margin % on cost + services
export async function getCustomerMarginReport(filters = {}) {
  const from = filters.dateFrom ? new Date(filters.dateFrom) : new Date("1900-01-01");
  const to = filters.dateTo ? new Date(filters.dateTo) : new Date();

  const custFilter = filters.customer && filters.customer !== "all"
    ? Prisma.sql`AND tm.pycd = ${parseInt(filters.customer)}`
    : Prisma.empty;
  const itemFilter = filters.item && filters.item !== "all"
    ? Prisma.sql`AND t.itcd = ${parseInt(filters.item)}`
    : Prisma.empty;

  const salesRows = await prisma.$queryRaw`
    SELECT tm.pycd AS acno, a.acname,
           t.itcd, i.item, i.code AS item_code,
           SUM(CASE WHEN tm.tran_code = 10 THEN -COALESCE(t.qty,0)
                    ELSE COALESCE(t.qty,0) END) AS qty,
           SUM(CASE WHEN tm.tran_code = 10 THEN -COALESCE(t.damt,0)
                    WHEN tm.tran_code = 5  THEN COALESCE(t.gross_amount, t.camt, 0)
                    ELSE COALESCE(t.camt,0) END) AS value
    FROM "TRANSACTIONS_MASTER" tm
    JOIN "Transactions" t ON t.tran_id = tm.tran_id
    LEFT JOIN "acno" a ON a.acno = tm.pycd
    LEFT JOIN "Item" i ON i.itcd = t.itcd
    WHERE tm.tran_code IN (5, 6, 10)
      AND tm.dated >= ${from} AND tm.dated <= ${to}
      AND t.itcd IS NOT NULL
      AND COALESCE(t.sub_tran_id, 1) <> 3
      ${custFilter} ${itemFilter}
    GROUP BY tm.pycd, a.acname, t.itcd, i.item, i.code
    HAVING SUM(COALESCE(t.qty,0)) <> 0 OR SUM(COALESCE(t.camt,0)) <> 0
    ORDER BY a.acname, i.code
  `;

  if (!salesRows.length) {
    return { data: [], summary: { totalQty: 0, totalSales: 0, totalCost: 0, totalMargin: 0, marginPercent: 0 } };
  }

  const itcds = [...new Set(salesRows.map((r) => Number(r.itcd)))];
  const y1 = from.getFullYear(), m1 = from.getMonth() + 1;

  const [pceRates, openingRates, purchaseRates] = await Promise.all([
    prisma.$queryRaw`
      SELECT itcd,
             SUM(COALESCE(total_cost,0) + COALESCE(cc_cost,0)) / NULLIF(SUM(qty_costed),0) AS rate
      FROM "ProductionCostEntry"
      WHERE itcd IN (${Prisma.join(itcds)})
        AND (year * 100 + month) BETWEEN ${y1 * 100 + m1}
            AND ${to.getFullYear() * 100 + (to.getMonth() + 1)}
      GROUP BY itcd
    `,
    prisma.$queryRaw`
      SELECT itcd, COALESCE(opening_rate, 0) AS rate
      FROM "MonthlyOpeningRate"
      WHERE itcd IN (${Prisma.join(itcds)}) AND year = ${y1} AND month = ${m1}
    `,
    prisma.$queryRaw`
      SELECT t.itcd, SUM(COALESCE(t.damt,0)) / NULLIF(SUM(t.qty),0) AS rate
      FROM "Transactions" t
      JOIN "TRANSACTIONS_MASTER" tm ON tm.tran_id = t.tran_id
      WHERE tm.tran_code = 4 AND tm.dated >= ${from} AND tm.dated <= ${to}
        AND t.itcd IN (${Prisma.join(itcds)}) AND COALESCE(t.sub_tran_id,1) <> 3
      GROUP BY t.itcd
    `,
  ]);

  const toMap = (rows) => new Map(rows.filter((r) => r.rate != null).map((r) => [Number(r.itcd), Number(r.rate)]));
  const pce = toMap(pceRates), opening = toMap(openingRates), purchase = toMap(purchaseRates);
  const costRateOf = (itcd) => pce.get(itcd) ?? opening.get(itcd) ?? purchase.get(itcd) ?? 0;

  // Services on this customer's dispatches / sale returns (freight-out,
  // weighing …), by service category — lib/service/landedCost.js.
  const services = await saleServicesByCustomerItem({
    dateFrom: from,
    dateTo: to,
    customer: filters.customer && filters.customer !== "all" ? filters.customer : null,
    item: filters.item && filters.item !== "all" ? filters.item : null,
  });

  // Group by customer
  const customers = new Map();
  for (const r of salesRows) {
    const acno = Number(r.acno || 0);
    if (!customers.has(acno)) {
      customers.set(acno, { acno, acname: r.acname || "UNKNOWN", items: [], qty: 0, sales: 0, cost: 0, services: 0 });
    }
    const c = customers.get(acno);
    const itcd = Number(r.itcd);
    const qty = Number(r.qty || 0);
    const sales = Number(r.value || 0);
    const cost_rate = costRateOf(itcd);
    const cost_value = cost_rate * qty;
    const svc = services.get(`${acno}|${itcd}`) || { total: 0, by: {} };
    const total_cost_value = cost_value + svc.total;
    const net_margin_amount = sales - total_cost_value;
    c.items.push({
      itcd,
      product: r.item_code || r.item || String(itcd),
      item_name: r.item,
      qty,
      sales_value: sales,
      sale_rate: qty ? sales / qty : 0,
      cost_rate,
      cost_value,
      margin_amount: sales - cost_value,
      margin_percent: cost_value ? ((sales - cost_value) / cost_value) * 100 : 0,
      // services by category (sale_svc_c<id>, columns: serviceCategoryColumns)
      ...Object.fromEntries(Object.entries(svc.by).map(([cat, amt]) => [`sale_svc_c${cat}`, amt])),
      services_amount: svc.total,
      total_cost_value,
      net_margin_amount,
      net_margin_percent: total_cost_value ? (net_margin_amount / total_cost_value) * 100 : 0,
    });
    c.qty += qty; c.sales += sales; c.cost += cost_value; c.services += svc.total;
  }

  // One flat row per customer x product (CLAUDE.md rule 15). The viewer groups
  // them by customer with subtotals (config `layout.rowGroupBy`); margin % and
  // the rates of a subtotal are weighted (Σ / Σ, config `totalRatio`), the
  // same as the old customer / grand total rows.
  const data = [];
  const totals = { qty: 0, sales: 0, cost: 0, services: 0 };

  for (const c of [...customers.values()].sort((a, b) => a.acname.localeCompare(b.acname))) {
    c.items.forEach((it) => data.push({ customer_acno: c.acno, customer: c.acname, ...it }));
    totals.qty += c.qty; totals.sales += c.sales; totals.cost += c.cost; totals.services += c.services;
  }

  const grandMargin = totals.sales - totals.cost;
  const netMargin = grandMargin - totals.services;

  return {
    data,
    summary: {
      totalQty: totals.qty,
      totalSales: totals.sales,
      totalCost: totals.cost,
      totalMargin: grandMargin,
      marginPercent: totals.cost ? (grandMargin / totals.cost) * 100 : 0,
      totalServices: totals.services,
      netMargin,
      netMarginPercent: totals.cost + totals.services ? (netMargin / (totals.cost + totals.services)) * 100 : 0,
    },
  };
}
