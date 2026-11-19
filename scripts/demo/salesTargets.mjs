// scripts/demo/salesTargets.mjs — Target Qty on Sales & Recovery Targets for every
// demo customer and month, entered by the sales manager through the app's own API
// (POST /api/accounts/customer-monthly-target, the "All Customers" grid save).
// Target Recovery is not sent — the system sets it (lib/salesTargets/autoTarget.js).
//
// Target = the customer's average monthly dispatched KG over the demo period × 1.1,
// rounded to 50 KG (a customer with no dispatches yet gets 500 KG), so the page,
// the Sales Team MIS and the BI dashboards show believable achievement figures.
// Called from scripts/demo/seed-documents.mjs; on an existing demo database run
// scripts/demo/seed-sales-targets.mjs.

const round50 = (n) => Math.max(50, Math.round(n / 50) * 50);

export async function seedSalesTargets({ call, prisma, from, to, log = console.log }) {
  const dispatched = await prisma.$queryRawUnsafe(
    `SELECT m.pycd AS acno, SUM(t.qty)::float AS qty, COUNT(DISTINCT to_char(m.dated, 'YYYY-MM'))::int AS months
       FROM "TRANSACTIONS_MASTER" m
       JOIN "Transactions" t ON t.tran_id = m.tran_id AND t.sub_tran_id = 1
      WHERE m.tran_code = 6
      GROUP BY m.pycd`,
  );
  const avg = new Map(dispatched.map((r) => [Number(r.acno), r.qty / Math.max(1, r.months)]));

  // every month from `from` to `to` (inclusive), as { year, month }
  const months = [];
  for (let d = new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), 1)); d <= to; d = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1))) {
    months.push({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1 });
  }

  // the customer list is the page's own (customer account groups from Account Settings)
  const list = await call("sales.manager", "GET", `/api/accounts/customer-monthly-target?year=${months[0].year}&month=${months[0].month}`);
  const customers = (list?.data || []).map((r) => ({ acno: r.acno }));

  let saved = 0;
  for (const [k, { year, month }] of months.entries()) {
    // a little month-to-month movement so the targets are not one flat number
    const swing = [1, 1.05, 1.1, 0.95, 1, 1.05][k % 6];
    const rows = customers.map(({ acno }) => ({ acno: Number(acno), targetQty: round50((avg.get(Number(acno)) ?? 455) * 1.1 * swing) }));
    const res = await call("sales.manager", "POST", "/api/accounts/customer-monthly-target", { year, month, rows });
    saved += res?.saved ?? 0;
  }
  log(`  sales targets: ${saved} customer-months saved (${customers.length} customers × ${months.length} months)`);
}
