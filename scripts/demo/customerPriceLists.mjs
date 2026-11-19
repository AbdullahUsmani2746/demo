// scripts/demo/customerPriceLists.mjs — each demo customer's price list (Customers →
// Item rates, SALES_ITEM_CUST), entered by the sales manager through the app's own
// API (POST /api/forms/sales-items, the screen's "Add item rate").
// A customer's list = the products they have ordered, at their latest order rate
// and sales-tax rate, so a new Sale Order picks up the agreed rate by itself.
// Called from scripts/demo/seed-documents.mjs; on an existing demo database run
// scripts/demo/seed-sales-extras.mjs. Re-runnable (the route updates an existing rate).

export async function seedCustomerPriceLists({ call, prisma, log = console.log }) {
  const lines = await prisma.orderDetail.findMany({
    where: { itcd: { not: null }, rate: { gt: 0 } },
    select: { itcd: true, rate: true, st_rate: true, orderMaster: { select: { party_code: true, dated: true } } },
  });
  const latest = new Map(); // "acno:itcd" → line
  for (const l of lines) {
    const k = `${l.orderMaster.party_code}:${l.itcd}`;
    const prev = latest.get(k);
    if (!prev || l.orderMaster.dated > prev.orderMaster.dated) latest.set(k, l);
  }
  let saved = 0;
  for (const l of latest.values()) {
    await call("sales.manager", "POST", "/api/forms/sales-items", {
      acno: l.orderMaster.party_code, itcd: l.itcd, rate: l.rate, gst_rate: l.st_rate ?? 18,
    });
    saved++;
  }
  log(`  customer price lists: ${saved} item rates on ${new Set([...latest.values()].map((l) => l.orderMaster.party_code)).size} customers`);
}
