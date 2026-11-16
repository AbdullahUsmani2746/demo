// scripts/demo/posDocuments.mjs — the point-of-sale part of the demo documents
// (called from scripts/demo/seed-documents.mjs; can also be run on an existing
// demo database with a `call(username, method, path, body)`).
// Everything goes through the app's own API, as the demo cashier ("cashier",
// role CASHIER): a shift with a float, a few sales (cash with change, split
// cash + card, a discounted line, card), one refund, and the shift closed with
// the cash counted. POS documents are dated the day the seed runs (the till
// always posts "now").

export async function seedPosDocuments({ call, log = console.log }) {
  const get = (u, p) => call(u, "GET", p);
  const post = (u, p, b) => call(u, "POST", p, b);
  const C = "cashier";

  // Demo company data: the till sells finished goods (Settings → Point of Sale), as admin.
  const cats = (await get("admin", "/api/setup/item_categories?limit=1000")).data || [];
  const fg = cats.filter((c) => /FINISHED GOODS/i.test(c.ic_name)).map((c) => c.id);
  // Sell from the finished-goods store (Settings → Production setup), not the default godown.
  const setup = await get("admin", "/api/settings/production-setup").catch(() => null);
  const fgGodown = Number(setup?.values?.finishedGoodsGodown) || undefined;
  if (fg.length) await call("admin", "PUT", "/api/settings/pos", { values: { categoryIds: fg, ...(fgGodown ? { godown: fgGodown } : {}), receiptHeader: "Paint shop counter · Tel 042-000000", receiptFooter: "Thank you! Goods can be returned within 7 days with this receipt.", returnDays: 7 } });

  const { items = [] } = await get(C, "/api/pos/catalog?take=40");
  const priced = items.filter((i) => Number(i.price) > 0);
  if (priced.length < 3) {
    log("  POS: fewer than 3 priced items at the till — skipped");
    return;
  }
  const [a, b, c, d] = [priced[0], priced[1], priced[2], priced[3] || priced[0]];
  const ref = (n) => `demo-pos-${new Date().toISOString().slice(0, 10)}-${n}`;

  // The shift (one open shift per cashier — reuse it when the seed is re-run).
  const shifts = await get(C, "/api/pos/shifts");
  let shift = shifts.open;
  if (!shift) shift = (await post(C, "/api/pos/shifts", { openingFloat: 5000 })).shift;

  const sale = (n, lines, payments, extra = {}) => post(C, "/api/pos/orders", { clientRef: ref(n), lines, payments, ...extra });
  const s1 = await sale(1, [{ itcd: a.itcd, qty: 2 }, { itcd: b.itcd, qty: 1 }], [{ method: "CASH", amount: Math.ceil((a.price * 2 + b.price) / 500) * 500 + 500 }]);
  const t2 = c.price * 3;
  await sale(2, [{ itcd: c.itcd, qty: 3 }], [{ method: "CARD", amount: Math.floor(t2 / 2), reference: "VISA 4242" }, { method: "CASH", amount: t2 - Math.floor(t2 / 2) }], {
    customer: { name: "Walk-in — Mr. Kamran", phone: "0300-0000000" },
  });
  await sale(3, [{ itcd: d.itcd, qty: 1, discountPct: 5, note: "Loyal customer" }], [{ method: "CASH", amount: Math.ceil(d.price) }]);
  await sale(4, [{ itcd: b.itcd, qty: 2 }], [{ method: "CARD", amount: b.price * 2, reference: "MASTER 1111" }]);

  // One item of the first sale comes back (damaged), refunded in cash.
  const line = s1.receipt.items.find((i) => i.itcd === a.itcd);
  if (line && !(line.returned > 0)) {
    await post(C, "/api/pos/returns", { clientRef: ref("r1"), saleTranId: s1.tran_id, lines: [{ id: line.id, qty: 1 }], refundMethod: "CASH", reason: "Damaged" });
  }

  // Close the shift with the drawer counted exactly.
  const now = await get(C, "/api/pos/shifts");
  if (now.open) await post(C, `/api/pos/shifts/${now.open.id}`, { countedCash: now.open.live.expectedCash, notes: "Demo day close" });
  log(`  POS: shift #${shift.id}, 4 sales, 1 refund, closed`);
}
