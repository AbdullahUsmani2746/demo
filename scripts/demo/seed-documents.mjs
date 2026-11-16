// scripts/demo/seed-documents.mjs — five and a half months of demo business,
// posted through the app's OWN API (so numbering, stock, ledger postings,
// approvals and the audit trail come from the real logic).
// ============================================================
//   node --env-file=.env scripts/demo/seed-documents.mjs [--base http://localhost:3000]
//
// Needs: the app running against the demo database, masters seeded
// (scripts/demo/seed-masters.mjs). Each document is entered by the person whose
// job it is (sales → sale orders, store keeper → GRN / dispatch, accounts →
// invoicing / vouchers); if that login lacks the right, the Super Admin enters it.
//
// The one thing the app cannot do for history: Send to Production posts at the
// current time. Those vouchers are moved to the process order's date afterwards
// (backdateProcessOrder) — demo database only.
// ============================================================
import { PrismaClient } from "@prisma/client";
import { AC, CUSTOMERS, VENDORS, TRANSPORTERS, ITEMS, BOMS, SF_BOMS, categoryOf, DEMO_PASSWORD } from "./seed-masters.mjs";
import { seedFixedAssetDocuments } from "./fixedAssetDocuments.mjs";
import { seedPosDocuments } from "./posDocuments.mjs";
import { hrDocuments } from "./hrDocuments.mjs";
import { applyDemoFeatures } from "./demoFeatures.mjs";
import { moreDocuments } from "./moreDocuments.mjs";

if (!(process.env.DEMO_DATABASE === "1" || process.env.DATABASE_URL?.includes("bizlogist_demo"))) {
  console.error("Refusing: DATABASE_URL is not the demo database.");
  process.exit(1);
}
const BASE = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : "http://localhost:3000";
const prisma = new PrismaClient();

const START = new Date("2026-06-01T00:00:00Z");
const END = new Date("2026-11-14T00:00:00Z");

// ── deterministic randomness (same demo every build) ───────────────────────
let seed = 20261115;
const rand = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const between = (a, b) => a + rand() * (b - a);
const int = (a, b) => Math.floor(between(a, b + 1));
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const chance = (p) => rand() < p;
const round = (n, step = 1) => Math.round(n / step) * step;
const r2 = (n) => Math.round(n * 100) / 100;

const iso = (d) => d.toISOString().slice(0, 10);
const addDays = (d, n) => new Date(d.getTime() + n * 86400000);
const isWorkday = (d) => d.getUTCDay() !== 0; // Mon–Sat

// ── HTTP sessions ──────────────────────────────────────────────────────────
const sessions = new Map();
async function login(username) {
  if (sessions.has(username)) return sessions.get(username);
  const jar = new Map();
  const keep = (res) => {
    for (const c of res.headers.getSetCookie?.() || []) {
      const [pair] = c.split(";");
      const i = pair.indexOf("=");
      jar.set(pair.slice(0, i), pair.slice(i + 1));
    }
  };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const csrfRes = await fetch(`${BASE}/api/auth/csrf`);
  keep(csrfRes);
  const { csrfToken } = await csrfRes.json();
  const res = await fetch(`${BASE}/api/auth/callback/credentials`, {
    method: "POST",
    redirect: "manual",
    headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie() },
    body: new URLSearchParams({ csrfToken, email: username, password: DEMO_PASSWORD, callbackUrl: BASE, json: "true" }),
  });
  keep(res);
  if (![...jar.keys()].some((k) => k.includes("session-token"))) throw new Error(`login failed for ${username}`);
  const s = { username, cookie };
  sessions.set(username, s);
  return s;
}

const stats = { ok: 0, fallback: 0, failed: 0, warnings: 0 };
const fallbacks = new Map(); // "<user> <METHOD> <path>" → count — a role template that lacks a right shows here
async function call(username, method, path, body, attempt = 1) {
  const s = await login(username);
  const res = await fetch(`${BASE}${path}`, {
    method,
    headers: { "content-type": "application/json", cookie: s.cookie() },
    body: body ? JSON.stringify(body) : undefined,
  });
  let json = null;
  try { json = await res.json(); } catch { /* empty */ }
  // The dev server answers with an empty / HTML page while it recompiles: wait and retry
  // (only reads, or a write that never reached the route — no JSON at all).
  if ((json === null || res.status === 502 || res.status === 503) && attempt < 4) {
    await new Promise((r) => setTimeout(r, 3000 * attempt));
    return call(username, method, path, body, attempt + 1);
  }
  if (res.status === 403 && username !== "admin") {
    stats.fallback++;
    const key = `${username} ${method} ${path.split("?")[0]}`;
    fallbacks.set(key, (fallbacks.get(key) || 0) + 1);
    return call("admin", method, path, body);
  }
  if (!res.ok) {
    stats.failed++;
    const msg = json?.message || json?.error || res.statusText;
    throw new Error(`${method} ${path} → ${res.status} ${msg}`);
  }
  stats.ok++;
  if (json?.warnings?.length) stats.warnings++;
  return json;
}
const post = (u, p, b) => call(u, "POST", p, b);
const get = (u, p) => call(u, "GET", p);

// A voucher form sends its type (tran_code) and the next voucher no (/api/voucher/next-vr-no);
// the save route keeps both as sent. GRN / dispatch numbers come from the DB trigger.
const TRAN = { receipt: 1, payment: 2, journal: 3, grn: 4, dispatch: 6, materialIssueLanded: 7, materialIssue: 7, grnReturn: 9, dispatchReturn: 10, transfer: 11 };
async function voucher(u, type, body) {
  const tran_code = TRAN[type];
  const { nextVrNo } = await get(u, `/api/voucher/next-vr-no?tran_code=${tran_code}`);
  return post(u, `/api/voucher/${type}`, { ...body, master: { ...body.master, tran_code, vr_no: nextVrNo } });
}

// ── reference data ─────────────────────────────────────────────────────────
const itemOf = new Map(ITEMS.map(([itcd, code, name, group, unit, price, ltr]) => ({ itcd, code, name, ic: categoryOf(group), group, unit, price, ltr })).map((i) => [i.itcd, i]));
const FG = [...itemOf.values()].filter((i) => i.ic === 1);
const RM = [...itemOf.values()].filter((i) => i.ic === 3);
const PM = [...itemOf.values()].filter((i) => i.ic === 4);
const bomOf = new Map([...BOMS, ...SF_BOMS].map(([fg, mats]) => [fg, mats]));
// Decorative paints are tinted / filled to order: produced on dispatch from their BOM (SMS feature).
const PRODUCE_ON_DISPATCH = new Set([801, 802, 803]);
// Who buys what
const vendorFor = (it) => (it.ic === 4 ? (it.itcd <= 504 ? 3005 : 3006)
  : it.group === 1 ? 3001 : it.group === 2 ? 3002 : it.group === 3 ? (it.itcd === 306 ? 3004 : 3003) : 3007);
const SLOW_PAYERS = new Set([2009, 2011, 2003]);

// Local running stock so every document is postable (godown → itcd → qty)
const stock = new Map();
const st = (g, i) => stock.get(`${g}:${i}`) || 0;
const move = (g, i, q) => stock.set(`${g}:${i}`, st(g, i) + q);

// Demand per finished good (kg / working day) — sizes purchases and production.
const DAILY = { 601: 180, 602: 160, 603: 110, 604: 100, 605: 140, 701: 80, 702: 70, 703: 90, 801: 260, 802: 180, 803: 120 };
const materialDaily = new Map();
for (const [fg, mats] of BOMS) for (const [m, pct] of mats) materialDaily.set(m, (materialDaily.get(m) || 0) + (DAILY[fg] * pct) / 100);

// ── documents ──────────────────────────────────────────────────────────────
const openSO = [];        // { order_no, party, date, lines: [{itcd, qty, rate, left}] }
const dispatched = [];    // { tran_id, party, date, so }
const invoicesAR = [];    // { party, date, due, amount, paid }
const invoicesAP = [];    // { party, date, due, amount, paid }
const grnsToInvoice = []; // { tran_id, date, rates: Map itcd→rate }
let batchNo = 1000;

async function openingBalances(d) {
  const debtors = CUSTOMERS.map(([acno]) => [acno, round(between(150000, 1400000), 1000)]);
  const creditors = VENDORS.slice(0, 6).map(([acno]) => [acno, round(between(250000, 1800000), 1000)]);
  const lines = [
    [AC.cash, 650000, 0], [AC.pettyCash, 75000, 0], [AC.bankHbl, 18500000, 0], [AC.bankMcb, 7200000, 0],
    [AC.plant, 42000000, 0], [AC.vehicles, 9800000, 0], [AC.furniture, 2600000, 0], [AC.computers, 1900000, 0],
    [AC.securityDeposits, 1200000, 0],
    ...debtors.map(([a, v]) => [a, v, 0]),
    ...creditors.map(([a, v]) => [a, 0, v]),
    [AC.bankLoan, 0, 15000000], [AC.capital, 0, 50000000],
  ];
  const dr = lines.reduce((s, l) => s + l[1], 0);
  const cr = lines.reduce((s, l) => s + l[2], 0);
  lines.push([AC.retained, dr > cr ? 0 : cr - dr, dr > cr ? dr - cr : 0]);
  await voucher("accounts.manager", "journal", {
    master: { dated: iso(d), rmk: "Opening balances as at 1 June 2026" },
    lines: lines.map(([acno, damt, camt]) => ({ acno, damt, camt, narration1: "Opening balance" })),
  });
  for (const [acno, v] of debtors) invoicesAR.push({ party: acno, date: d, due: addDays(d, 20), amount: v, paid: 0 });
  for (const [acno, v] of creditors) invoicesAP.push({ party: acno, date: d, due: addDays(d, 25), amount: v, paid: 0 });
}

async function openingStock(d) {
  // Opening stock as a Misc IN would need its own form; buy it instead on day one.
  const byVendor = new Map();
  for (const it of [...RM, ...PM]) {
    const qty = it.ic === 4 ? round(between(150, 400)) : round((materialDaily.get(it.itcd) || 20) * between(12, 18), 25);
    const v = vendorFor(it);
    if (!byVendor.has(v)) byVendor.set(v, []);
    byVendor.get(v).push([it, qty]);
  }
  for (const [vendor, rows] of byVendor) await grn(d, vendor, rows, { opening: true });
}

async function grn(d, vendor, rows, { opening = false } = {}) {
  const godown = rows[0][0].ic === 4 ? 4 : 1;
  // Purchase order first (not for the opening receipt)
  let po_no = null;
  const rates = new Map(rows.map(([it]) => [it.itcd, r2(it.price * between(0.96, 1.05))]));
  if (!opening) {
    // Some purchases start as a store requisition, approved by the store manager.
    const poDate = addDays(d, -int(3, 8));
    const req_no = chance(0.4) ? await more.purchaseRequisition(iso(addDays(poDate, -3)), iso(addDays(poDate, -2)), rows, godown) : null;
    const po = await post("purchase", "/api/orders/purchaseOrder", {
      master: { party_code: { value: vendor, label: String(vendor) }, godown, dated: iso(poDate), payment_terms: "30 DAYS", ...(req_no ? { req_no } : {}) },
      lines: rows.map(([it, qty]) => ({ itcd: it.itcd, qty, rate: rates.get(it.itcd), amount: r2(qty * rates.get(it.itcd)), st_rate: 18, unit: it.unit })),
    });
    po_no = po.order_no;
  }
  const res = await voucher("storekeeper", "grn", {
    master: {
      dated: iso(d), pycd: vendor, godown, po_no, vendor_bill_no: `INV-${int(10000, 99999)}`,
      rmk: opening ? "Opening stock receipt" : `Against PO ${po_no}`,
    },
    lines: rows.map(([it, qty]) => ({ itcd: it.itcd, qty, unit: it.unit, godown, po_qty: qty })),
  });
  for (const [it, qty] of rows) move(godown, it.itcd, qty);
  grnsToInvoice.push({ tran_id: res.voucherId, date: d, vendor, rates });
}

async function weeklyPurchasing(d) {
  const byVendor = new Map();
  for (const it of RM) {
    const daily = materialDaily.get(it.itcd) || 5;
    const target = daily * 16;
    const have = st(1, it.itcd);
    if (have < daily * 9) {
      const qty = round(Math.max(target - have, daily * 6), 25);
      const v = vendorFor(it);
      if (!byVendor.has(v)) byVendor.set(v, []);
      byVendor.get(v).push([it, qty]);
    }
  }
  for (const it of PM) {
    if (st(4, it.itcd) + st(3, it.itcd) < 120) {
      const v = vendorFor(it);
      if (!byVendor.has(v)) byVendor.set(v, []);
      byVendor.get(v).push([it, round(between(200, 500), 10)]);
    }
  }
  for (const [vendor, rows] of byVendor) await grn(d, vendor, rows);
}

async function packingTransfer(d) {
  const lines = [];
  for (const it of PM) {
    const need = 160 - st(3, it.itcd);
    const qty = Math.min(st(4, it.itcd), Math.max(0, round(need, 10)));
    if (qty > 0) lines.push({ itcd: it.itcd, qty, unit: it.unit });
  }
  if (!lines.length) return;
  await voucher("storekeeper", "transfer", {
    master: { dated: iso(d), godown: 4, godown2: 3, rmk: "Packing material to finished goods store" },
    lines,
  });
  for (const l of lines) { move(4, l.itcd, -l.qty); move(3, l.itcd, l.qty); }
}

async function saleOrder(d) {
  const [party, , , region] = pick(CUSTOMERS);
  const lines = [];
  for (const fg of new Set(Array.from({ length: int(1, 3) }, () => pick(FG)))) {
    const qty = round(between(150, 1400), 25);
    const rate = r2(fg.price * between(0.95, 1.08));
    lines.push({ itcd: fg.itcd, qty, rate, amount: r2(qty * rate), st_rate: 18, unit: "KG", left: qty });
  }
  const planToday = chance(0.3);
  const res = await post(region === "NORTH" ? "sales.north" : "sales", "/api/orders/saleOrder", {
    master: {
      party_code: { value: party, label: String(party) }, godown: 3, dated: iso(d), region,
      delivery_terms: "EX-FACTORY", payment_terms: "CREDIT", due_date: iso(addDays(d, int(3, 10))),
    },
    // Some orders ask production to plan the first line the same day (Sale Order production plan).
    lines: lines.map(({ left, ...l }, i) => (i === 0 && planToday ? { ...l, plan_pending: true, plan_date: iso(d), plan_qty: l.qty } : l)),
  });
  openSO.push({ order_no: res.order_no, party, date: d, lines });
}

async function produce(d) {
  // Finished goods needed: open order qty not yet in stock, plus a small buffer.
  const need = new Map();
  for (const so of openSO) for (const l of so.lines) if (l.left > 0) need.set(l.itcd, (need.get(l.itcd) || 0) + l.left);
  let made = 0;
  for (const fg of FG) {
    if (PRODUCE_ON_DISPATCH.has(fg.itcd)) continue;
    const short = (need.get(fg.itcd) || 0) + DAILY[fg.itcd] * 2 - st(3, fg.itcd);
    if (short <= 0 || made >= 3) continue;
    const qty = round(Math.max(short, 400), 50);
    const mats = bomOf.get(fg.itcd).map(([m, pct]) => [m, r2((qty * pct) / 100)]);
    if (mats.some(([m, q]) => st(1, m) < q)) continue; // wait for materials
    const bom = await prisma.bomMaster.findFirst({ where: { finished_id: fg.itcd }, select: { id: true } });
    const batch = `B${++batchNo}`;
    const plan = await post("production", "/api/manufacturing/production", {
      type: "new", dated: iso(d), bom_id: bom.id,
      outputs: [{ line_no: 1, finished_id: fg.itcd, qty, godown: 3, batch_no: batch, bom_id: bom.id, unit: "KG" }],
      productionPlanDetail: mats.map(([m, q], i) => ({
        sno: i + 1, material_id: m, material_qty: q, material_percentage: bomOf.get(fg.itcd)[i][1],
        material_desc: itemOf.get(m).name, output_line: 1, godown: 1, unit: "KG",
      })),
    });
    await more.qcProcessOrder(plan.id, fg.itcd, iso(d), { retest: chance(0.1) });
    const yieldQty = r2(qty * between(0.975, 0.995));
    await post("production.manager", "/api/manufacturing/production/send-to-production", { productionPlanId: plan.id, actualYield: yieldQty });
    await backdateProcessOrder(plan.id, d);
    for (const [m, q] of mats) move(1, m, -q);
    move(3, fg.itcd, yieldQty);
    made++;
  }
}

// Send to Production posts "now"; move its vouchers to the plan date and give
// them that day's next voucher numbers (demo history only).
async function backdateProcessOrder(planId, d) {
  const when = new Date(`${iso(d)}T10:${String(int(10, 59)).padStart(2, "0")}:00+05:00`);
  const rows = await prisma.transactionsMaster.findMany({
    where: { rmk5: String(planId), tran_code: { in: [7, 8] } },
    select: { tran_id: true, tran_code: true },
    orderBy: { tran_id: "asc" },
  });
  for (const r of rows) {
    const dayStart = new Date(`${iso(d)}T00:00:00+05:00`);
    const last = await prisma.transactionsMaster.findFirst({
      where: { tran_code: r.tran_code, dated: { gte: dayStart, lt: addDays(dayStart, 1) } },
      orderBy: { vr_no: "desc" },
      select: { vr_no: true },
    });
    await prisma.transactionsMaster.update({
      where: { tran_id: r.tran_id },
      data: { dated: when, time: when, vr_no: (last?.vr_no || 0) + 1 },
    });
  }
  await prisma.productionPlanMaster.update({ where: { id: planId }, data: { sent_to_production_date: when } });
}

async function dispatchOrders(d) {
  for (const so of openSO) {
    if (so.date >= d || so.lines.every((l) => l.left <= 0)) continue;
    const lines = [];
    let fromBom = false;
    for (const l of so.lines) {
      if (l.left <= 0) continue;
      const fg = itemOf.get(l.itcd);
      // Bulk printing ink goes in returnable MS drums (Drum Loan Ledger); the rest in tins / pails.
      const drum = fg.group === 6 && l.left >= 360 && chance(0.4);
      const pack = drum ? 501 : fg.group === 8 ? 504 : 502;
      const perPack = drum ? 180 : fg.group === 8 ? 18 : 20;
      if (PRODUCE_ON_DISPATCH.has(l.itcd)) {
        const mats = bomOf.get(l.itcd).map(([m, pct]) => ({ itcd: m, qty: r2((l.left * pct) / 100), godown: 1 }));
        if (mats.some((m) => st(1, m.itcd) < m.qty)) continue;
        lines.push({ l, qty: l.left, pack, perPack, materials: mats });
        fromBom = true;
      } else {
        const qty = Math.min(l.left, Math.floor(st(3, l.itcd)));
        if (qty < Math.min(50, l.left)) continue;
        lines.push({ l, qty, pack, perPack });
      }
    }
    if (!lines.length) continue;
    const city = CUSTOMERS.find((c) => c[0] === so.party)[2];
    const res = await voucher("storekeeper", "dispatch", {
      master: {
        dated: iso(d), pycd: so.party, godown: 3, so_no: so.order_no, city,
        route: city === "KARACHI" ? "LOCAL" : "NATIONAL HIGHWAY", rmk2: String(pick(TRANSPORTERS)[0]),
        manual_no: `DC-${int(1000, 9999)}`, ...(fromBom ? { godown2: 1 } : {}),
        rmk: `Vehicle ${pick(["JX", "KM", "LES", "TKA"])}-${int(100, 999)}`,
      },
      lines: lines.map(({ l, qty, pack, perPack, materials }) => {
        const packs = Math.ceil(qty / perPack);
        const usePack = st(3, pack) >= packs;
        return {
          itcd: l.itcd, qty, so_qty: l.qty, unit: "KG", godown: 3, batch_no: `B${batchNo}`,
          ...(usePack ? { packing_material_code: pack, no_of_pack: packs, qty_per_pack: perPack, ...(pack === 501 ? { returnable: true } : {}) } : {}),
          ...(materials ? { materials } : {}),
        };
      }),
    });
    for (const { l, qty, pack, perPack, materials } of lines) {
      l.left -= qty;
      if (materials) for (const m of materials) move(1, m.itcd, -m.qty);
      else move(3, l.itcd, -qty);
      const packs = Math.ceil(qty / perPack);
      if (st(3, pack) >= packs) move(3, pack, -packs);
    }
    dispatched.push({ tran_id: res.voucherId, party: so.party, date: d, so, lines: lines.map(({ l, qty }) => ({ itcd: l.itcd, qty, rate: l.rate })) });
  }
}

async function invoiceSales(d, { upTo }) {
  const due = dispatched.filter((x) => !x.invoiced && x.date <= upTo);
  for (let i = 0; i < due.length; i += 20) {
    const chunk = due.slice(i, i + 20);
    const invoices = [];
    for (const x of chunk) {
      const lineRows = await prisma.transactions.findMany({ where: { tran_id: x.tran_id, sub_tran_id: 1, itcd: { not: null } }, select: { id: true, itcd: true, qty: true } });
      invoices.push({ tran_id: x.tran_id, lines: lineRows.map((t) => ({ line_id: t.id, rate: x.lines.find((l) => l.itcd === t.itcd)?.rate ?? itemOf.get(t.itcd).price, st_rate: 18 })) });
    }
    const res = await post("accountant", "/api/invoicing/sale/generate", { invoices });
    for (const r of res.results) {
      const x = chunk.find((c) => c.tran_id === r.tran_id);
      if (r.status !== "invoiced") { console.log(`  ! sale invoice ${r.tran_id}: ${r.message}`); continue; }
      x.invoiced = true;
      const cust = CUSTOMERS.find((c) => c[0] === x.party);
      const amount = r.total ?? x.lines.reduce((s, l) => s + l.qty * l.rate * 1.18, 0);
      invoicesAR.push({ party: x.party, date: x.date, due: addDays(x.date, cust[4] + (SLOW_PAYERS.has(x.party) ? int(25, 60) : int(-3, 12))), amount: r2(amount), paid: 0 });
    }
  }
}

async function invoicePurchases(d, { upTo }) {
  const due = grnsToInvoice.filter((g) => !g.invoiced && g.date <= upTo);
  for (let i = 0; i < due.length; i += 20) {
    const chunk = due.slice(i, i + 20);
    const invoices = [];
    for (const g of chunk) {
      const lineRows = await prisma.transactions.findMany({ where: { tran_id: g.tran_id, sub_tran_id: 1, itcd: { not: null } }, select: { id: true, itcd: true, qty: true } });
      invoices.push({
        tran_id: g.tran_id, vendor_bill_no: `VB-${g.tran_id}`, bill_date: iso(g.date),
        lines: lineRows.map((t) => ({ line_id: t.id, rate: g.rates.get(t.itcd) ?? itemOf.get(t.itcd).price, st_rate: 18 })),
      });
    }
    const res = await post("accounts.officer", "/api/invoicing/purchase/generate", { invoices });
    for (const r of res.results) {
      const g = chunk.find((c) => c.tran_id === r.tran_id);
      if (r.status !== "invoiced") { console.log(`  ! purchase invoice ${r.tran_id}: ${r.message}`); continue; }
      g.invoiced = true;
      const lines = await prisma.transactions.findMany({ where: { tran_id: g.tran_id, sub_tran_id: 1 }, select: { qty: true, itcd: true } });
      const amount = r.total ?? lines.reduce((s, l) => s + Number(l.qty) * (g.rates.get(l.itcd) || 0) * 1.18, 0);
      invoicesAP.push({ party: g.vendor, date: g.date, due: addDays(g.date, int(28, 45)), amount: r2(amount), paid: 0 });
    }
  }
}

async function customerReceipts(d) {
  const byParty = new Map();
  for (const inv of invoicesAR) {
    if (inv.paid >= inv.amount - 1 || inv.due > d) continue;
    if (!chance(SLOW_PAYERS.has(inv.party) ? 0.15 : 0.45)) continue;
    const pay = chance(0.8) ? inv.amount - inv.paid : round((inv.amount - inv.paid) * between(0.3, 0.7), 1000);
    byParty.set(inv.party, (byParty.get(inv.party) || 0) + pay);
    inv.paid += pay;
  }
  for (const [party, amount] of byParty) {
    const bank = chance(0.85) ? pick([AC.bankHbl, AC.bankMcb]) : AC.cash;
    await voucher(bank === AC.cash ? "cashier" : "accountant", "receipt", {
      master: { dated: iso(d), pycd: bank, rmk: "Received against invoices" },
      lines: [{ acno: party, camt: r2(amount), narration1: bank === AC.cash ? "Cash received" : `Cheque ${int(100000, 999999)}`, chno: String(int(100000, 999999)) }],
    });
  }
}

async function vendorPayments(d) {
  const byParty = new Map();
  for (const inv of invoicesAP) {
    if (inv.paid >= inv.amount - 1 || inv.due > d || !chance(0.6)) continue;
    const pay = inv.amount - inv.paid;
    byParty.set(inv.party, (byParty.get(inv.party) || 0) + pay);
    inv.paid += pay;
  }
  for (const [party, amount] of byParty) {
    // Income tax withheld on supplies (feature tax.lineWht): the bank pays the net.
    const wht = whtLaw && chance(0.35) ? { tax_law_code: whtLaw, narration5: "WHT 153(1)(a)" } : {};
    await voucher("accountant", "payment", {
      master: { dated: iso(d), pycd: pick([AC.bankHbl, AC.bankMcb]), rmk: "Payment to supplier" },
      lines: [{ acno: party, damt: r2(amount), narration1: `Cheque ${int(100000, 999999)}`, chno: String(int(100000, 999999)), ...wht }],
      deductions: [],
    });
  }
}

async function monthlyExpenses(d) {
  const lines = [
    [AC.rent, 450000, "Office & warehouse rent"], [AC.utilities, round(between(140000, 210000), 100), "Electricity & gas - head office"],
    [AC.factoryPower, round(between(780000, 1150000), 100), "Factory electricity (K-Electric)"], [AC.telephone, round(between(38000, 52000), 100), "Phones & internet"],
    [AC.printing, round(between(25000, 60000), 100), "Stationery"], [AC.professional, chance(0.4) ? 180000 : 0, "Audit / legal fee"],
    [AC.salesPromotion, round(between(60000, 160000), 100), "Trade promotion", "TRADE SCHEMES"], [AC.travelling, round(between(70000, 140000), 100), "Field staff travel", "FIELD STAFF"],
    [AC.factoryRepairs, round(between(90000, 260000), 100), "Machine repairs"], [AC.bankCharges, round(between(6000, 15000), 10), "Bank charges"],
  ].filter((l) => l[1] > 0);
  await voucher("accounts.manager", "payment", {
    master: { dated: iso(d), pycd: AC.bankHbl, rmk: `Monthly expenses ${d.toLocaleString("en", { month: "long", timeZone: "UTC" })}` },
    lines: lines.map(([acno, damt, n, sub]) => ({ acno, damt, narration1: n, ...(sub ? { sub_account: sub } : {}) })),
  });
  // Markup on running finance, accrued by JV
  await voucher("accounts.manager", "journal", {
    master: { dated: iso(d), rmk: "Markup accrued on running finance" },
    lines: [
      { acno: AC.markup, damt: round(15000000 * 0.21 / 12, 100), camt: 0, narration1: "Markup @ 21% p.a." },
      { acno: AC.accruedExpenses, damt: 0, camt: round(15000000 * 0.21 / 12, 100), narration1: "Markup payable" },
    ],
  });
  // Petty cash top-up
  await voucher("cashier", "payment", {
    master: { dated: iso(d), pycd: AC.cash, rmk: "Petty cash expenses" },
    lines: [
      { acno: AC.travelling, damt: round(between(15000, 30000), 10), narration1: "Local conveyance", sub_account: "LOCAL CONVEYANCE" },
      { acno: AC.printing, damt: round(between(4000, 9000), 10), narration1: "Photocopies & courier" },
    ],
  });
}

async function dispatchReturns() {
  // A few customers send goods back (quantity-only return, priced in Sale Return Invoicing).
  const picks = dispatched.filter((x) => x.invoiced && x.lines.some((l) => !PRODUCE_ON_DISPATCH.has(l.itcd))).filter((_, i) => i % 23 === 7).slice(0, 5);
  for (const x of picks) {
    const l = x.lines.find((y) => !PRODUCE_ON_DISPATCH.has(y.itcd));
    const qty = round(Math.max(25, l.qty * between(0.05, 0.15)), 5);
    const dn = await prisma.transactionsMaster.findUnique({ where: { tran_id: x.tran_id }, select: { dispatch_no: true } });
    const d = addDays(x.date, int(5, 12));
    if (d >= END) continue;
    const res = await voucher("storekeeper", "dispatchReturn", {
      master: { dated: iso(d), pycd: x.party, godown: 6, dispatch_no: dn.dispatch_no, rmk: pick(["Shade variation", "Viscosity complaint", "Damaged packing"]) },
      lines: [{ itcd: l.itcd, qty, original_qty: l.qty, unit: "KG", godown: 6 }],
    });
    const lines = await prisma.transactions.findMany({ where: { tran_id: res.voucherId, sub_tran_id: 1 }, select: { id: true } });
    await post("accountant", "/api/invoicing/sale-return/generate", {
      invoices: [{ tran_id: res.voucherId, lines: lines.map((t) => ({ line_id: t.id, rate: l.rate, st_rate: 18 })) }],
    });
  }
}

let more = null;  // moreDocuments.mjs — QC, requisitions, imports, services, finance, costing
let whtLaw = null; // tax law for withholding on supplier payments

// A process order that is planned but not sent (QC exceptions) or produced on the floor (FG transfer).
async function processOrder(itcd, d, { godown = 3, send = false } = {}) {
  const fg = itemOf.get(itcd);
  const qty = 400;
  const mats = bomOf.get(itcd).map(([m, pct]) => [m, r2((qty * pct) / 100)]);
  if (send && mats.some(([m, q]) => st(1, m) < q)) return {};
  const bom = await prisma.bomMaster.findFirst({ where: { finished_id: itcd }, select: { id: true } });
  const batch = `B${++batchNo}`;
  const plan = await post("production", "/api/manufacturing/production", {
    type: "new", dated: iso(d), bom_id: bom.id,
    outputs: [{ line_no: 1, finished_id: itcd, qty, godown, batch_no: batch, bom_id: bom.id, unit: "KG" }],
    productionPlanDetail: mats.map(([m, q], i) => ({
      sno: i + 1, material_id: m, material_qty: q, material_percentage: bomOf.get(itcd)[i][1],
      material_desc: itemOf.get(m).name, output_line: 1, godown: 1, unit: "KG",
    })),
  });
  if (send) {
    if (fg.ic === 1) await more.qcProcessOrder(plan.id, itcd, iso(d)); // QC is for finished goods

    const yieldQty = r2(qty * 0.985);
    await post("production.manager", "/api/manufacturing/production/send-to-production", { productionPlanId: plan.id, actualYield: yieldQty });
    await backdateProcessOrder(plan.id, d);
    for (const [m, q] of mats) move(1, m, -q);
    move(godown, itcd, yieldQty);
    return { planId: plan.id, date: iso(d), qty: yieldQty, fg };
  }
  return { planId: plan.id, date: iso(d) };
}

// Ink made on the production floor, sent to the FG store by an FG transfer requisition.
async function fgTransfers() {
  let n = 0;
  for (const [itcd, day, accept] of [[605, "2026-11-10", true], [602, "2026-11-11", true], [601, "2026-11-12", false]]) {
    const made = await processOrder(itcd, new Date(`${day}T00:00:00Z`), { godown: 2, send: true });
    if (!made.planId) continue;
    const qty = Math.floor(made.qty);
    const r = await post("production", "/api/material/requisition", {
      master: { req_catagory: { value: "FG_TRANSFER" }, dated: day, issued_by: { value: 2 }, issued_for: { value: 3 } },
      lines: [{ itcd, qty, remarks: `Process order #${made.planId}` }],
    });
    const tran_id = r.tran_no ?? r.tran_id ?? r.data?.tran_id;
    if (accept && tran_id) {
      await call("storekeeper", "PATCH", "/api/manufacturing/fg-transfer", { tran_id, action: "accept" });
      move(2, itcd, -qty); move(3, itcd, qty);
    }
    n++;
  }
  console.log(`  FG transfer requisitions: ${n} (one awaiting acceptance)`);
}

// Semi-finished bases made on the production floor (Daily Production report).
async function semiFinished() {
  let n = 0;
  for (const [itcd, day] of [[901, "2026-10-08"], [902, "2026-10-15"], [901, "2026-10-27"], [902, "2026-11-05"], [901, "2026-11-11"]]) {
    const made = await processOrder(itcd, new Date(`${day}T00:00:00Z`), { godown: 2, send: true });
    if (made.planId) n++;
  }
  console.log(`  semi-finished process orders: ${n}`);
}

// Consumables bought and issued to cleaning / the lab (Direct Material Issuance Cost):
// Material Consumption, "Production #" = CLEANING / LAB QC as the store writes it.
async function directIssues() {
  await grn(new Date("2026-10-05T00:00:00Z"), 3007, [[itemOf.get(1101), 120], [itemOf.get(1102), 600]]);
  for (const [day, rmk5, rmk1, lines] of [
    ["2026-10-12", "CLEANING", "STORES-CONSUMED", [[1102, 180], [1101, 20]]],
    ["2026-10-20", "LAB QC", "LAB TESTING", [[301, 5], [303, 2], [1102, 15]]],
    ["2026-10-29", "CLEANING", "STORES-CONSUMED", [[1102, 160], [1101, 25]]],
    ["2026-11-06", "LAB QC", "LAB TESTING", [[304, 2], [305, 2]]],
  ]) {
    const ok = lines.filter(([it, q]) => st(1, it) >= q);
    if (!ok.length) continue;
    await voucher("store.manager", "materialIssue", {
      master: { dated: day, godown: 1, rmk5, rmk1, rmk2: rmk5 === "CLEANING" ? "Mill and tank wash-down" : "Lab trials and QC samples" },
      lines: ok.map(([itcd, qty]) => ({ itcd, qty, unit: itemOf.get(itcd).unit, godown: 1 })),
    });
    for (const [it, q] of ok) move(1, it, -q);
  }
}

// Sales forecast for the next quarter (Sales Forecast screen), from each customer's Sep–Nov dispatches.
async function salesForecast() {
  const since = new Date("2026-09-01T00:00:00Z");
  const base = new Map();
  for (const x of dispatched) if (x.date >= since) for (const l of x.lines) base.set(`${x.party}:${l.itcd}`, (base.get(`${x.party}:${l.itcd}`) || 0) + l.qty);
  const records = [];
  for (const [key, qty] of base) {
    const [customer, itcd] = key.split(":").map(Number);
    ["Dec 2026", "Jan 2027", "Feb 2027"].forEach((month, i) => records.push({ month, customer, itcd, qty: round((qty / 2.5) * (1 + 0.04 * i) * between(0.9, 1.1), 25) }));
  }
  if (records.length) await post("sales.manager", "/api/reports/forecast", { records });
  console.log(`  sales forecast: ${records.length} rows`);
}

// Clearing material sent out against an LC — its cost goes to the LC account (landed cost).
async function issueLanded(lcAcno) {
  const it = itemOf.get(306);
  const qty = Math.min(400, Math.floor(st(1, 306)));
  if (qty <= 0) return;
  await voucher("store.manager", "materialIssueLanded", {
    master: { dated: "2026-09-24", godown: 1, pycd: lcAcno, rmk1: "Yes", rmk: "Filler sent with the TiO2 consignment for clearing / blending" },
    lines: [{ itcd: it.itcd, qty, rate: it.price, total: r2(qty * it.price) }],
  });
  move(1, 306, -qty);
}

// A few raw-material receipts go back to the supplier (quantity-only GRN return, priced in Purchase Return Invoicing).
async function grnReturns() {
  const picks = grnsToInvoice.filter((g) => g.invoiced && g.date > START).filter((_, i) => i % 17 === 5).slice(0, 4);
  for (const g of picks) {
    const m = await prisma.transactionsMaster.findUnique({ where: { tran_id: g.tran_id }, select: { grn_no: true, godown: true } });
    const line = await prisma.transactions.findFirst({ where: { tran_id: g.tran_id, sub_tran_id: 1, itcd: { not: null } }, select: { itcd: true, qty: true } });
    const qty = round(Math.max(10, Number(line.qty) * between(0.03, 0.08)), 5);
    if (st(m.godown, line.itcd) < qty) continue;
    const d = addDays(g.date, int(3, 9));
    if (d >= END) continue;
    const res = await voucher("storekeeper", "grnReturn", {
      master: { dated: iso(d), pycd: g.vendor, grn_no: m.grn_no, godown: m.godown, rmk: pick(["Failed QC - off specification", "Damaged bags", "Excess supplied"]) },
      lines: [{ itcd: line.itcd, qty, unit: itemOf.get(line.itcd).unit, godown: m.godown }],
    });
    move(m.godown, line.itcd, -qty);
    const lines = await prisma.transactions.findMany({ where: { tran_id: res.voucherId, sub_tran_id: 1 }, select: { id: true, itcd: true } });
    await post("accounts.officer", "/api/invoicing/purchase-return/generate", {
      invoices: [{ tran_id: res.voucherId, lines: lines.map((t) => ({ line_id: t.id, rate: g.rates.get(t.itcd) ?? itemOf.get(t.itcd).price, st_rate: 18 })) }],
    });
  }
}

async function main() {
  console.log(`Posting demo documents to ${BASE} …`);
  await applyDemoFeatures(call);
  more = moreDocuments({ call, prisma, rand });
  whtLaw = (await prisma.taxLaws.findFirst({ where: { section_description: { startsWith: "153(1)(a)" } }, select: { tax_law_code: true } }))?.tax_law_code ?? null;
  await more.setup();
  const hr = hrDocuments({ call, prisma });
  await hr.setup();
  let hrMonth = iso(START).slice(0, 7);
  await openingBalances(START);
  await openingStock(START);
  await packingTransfer(START);

  for (let d = addDays(START, 1); d < END; d = addDays(d, 1)) {
    if (!isWorkday(d)) continue;
    const dom = d.getUTCDate();
    // First working day of a month: last month's attendance, leave, loans and payroll.
    if (iso(d).slice(0, 7) !== hrMonth) { await hr.month(hrMonth, iso(d)); hrMonth = iso(d).slice(0, 7); }
    if (d.getUTCDay() === 1) await weeklyPurchasing(d);
    if (d.getUTCDay() === 3) await packingTransfer(d);
    if (dom >= 5 && dom <= 6 && !(await monthDone(d))) await monthlyExpenses(d);
    for (let n = int(0, 2); n > 0; n--) await saleOrder(d);
    await produce(d);
    await dispatchOrders(d);
    if (d.getUTCDay() === 6) {
      // Saturday: accounts invoice the week's dispatches and GRNs (the last week stays pending for the demo)
      if (addDays(d, 9) < END) {
        await invoiceSales(d, { upTo: d });
        await invoicePurchases(d, { upTo: d });
      }
    }
    if (d.getUTCDay() === 2 || d.getUTCDay() === 5) await customerReceipts(d);
    if (d.getUTCDay() === 4) await vendorPayments(d);
    if (dom === 1 || d.getUTCDay() === 6) console.log(`  ${iso(d)}  ok ${stats.ok}  fallback ${stats.fallback}  warnings ${stats.warnings}`);
  }
  await dispatchReturns();
  await grnReturns();
  await more.labNature();
  await more.imports({ issueLanded });
  await more.services([
    { order: "2026-08-03", entry: "2026-08-07", invoice: "2026-08-12" },
    { order: "2026-09-21", entry: "2026-09-24", invoice: "2026-09-30" },
    { order: "2026-10-13", entry: "2026-10-16", invoice: "2026-10-22" },
    { order: "2026-11-09", entry: "2026-11-11", invoice: "2026-11-12" },
  ]);
  await more.finance();
  await more.qcExceptions((itcd) => processOrder(itcd, new Date("2026-11-13T00:00:00Z")));
  await fgTransfers();
  await more.receiptQc();
  await semiFinished();
  await directIssues();
  await salesForecast();
  for (const [day, it] of [["2026-11-12", 105], ["2026-11-13", 304]]) await more.purchaseRequisition(day, null, [[itemOf.get(it), 500]], 1);
  await more.transferRequisitions([[505, 300], [506, 2000]], [[503, 120]]);
  await seedFixedAssetDocuments({ call });
  await seedPosDocuments({ call });
  await hr.finish();
  await more.pendingAndLoans(await prisma.employee.findMany({ select: { id: true, firstName: true, surname: true } }));
  await more.closeMonths();
  await applyDemoFeatures(call);
  await printCounts();
  console.log(`Done: ${stats.ok} calls ok, ${stats.fallback} entered by admin (role lacked the right), ${stats.warnings} with warnings.`);
  for (const [k, n] of fallbacks) console.log(`  fallback ×${n}: ${k}`);
}

async function printCounts() {
  const q = (sql) => prisma.$queryRawUnsafe(sql).then((r) => r.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === "bigint" ? Number(v) : v]))));
  console.log("Orders by category (OrderMaster.order_catagory):");
  console.table(await q(`SELECT order_catagory, COUNT(*) n FROM "OrderMaster" GROUP BY 1 ORDER BY 1`));
  console.log("Vouchers by tran_code (invoiced = invoice_no set):");
  console.table(await q(`SELECT tran_code, COUNT(*) n, COUNT(invoice_no) invoiced FROM "TRANSACTIONS_MASTER" GROUP BY 1 ORDER BY 1`));
  console.table({
    "process orders": await prisma.productionPlanMaster.count(), "fixed assets": await prisma.fixedAsset.count(),
    "depreciation runs": await prisma.fixedAssetDepreciationRun.count(), disposals: await prisma.fixedAssetDisposal.count(),
    "payroll runs": await prisma.hrPayrollRun.count(), payslips: await prisma.hrPayslip.count(), "leave requests": await prisma.hrLeaveRequest.count(),
    "attendance rows": await prisma.hrAttendance.count(), loans: await prisma.hrLoan.count(), settlements: await prisma.hrSettlement.count(),
  });
  console.table({
    "QC records": await prisma.qualityMaster.count(), "item standards": await prisma.item_Quality.count(), requisitions: await prisma.reqMaster.count(),
    "LCs": await prisma.lCMaster.count(), "in-bond": await prisma.inboundMaster.count(), "machines": await prisma.mACHINE_INSTRUCTION_MASTER.count(),
    "cheques in hand": await prisma.checksInHand.count(), "sales loans": await prisma.salesLoan.count(), "costing periods": await prisma.costingPeriod.count(),
    "opening rates": await prisma.monthlyOpeningRate.count(), "production cost entries": await prisma.productionCostEntry.count(),
    "dashboard assignments": await prisma.biDashboardAssignment.count(), "POS receipts": await prisma.posReceipt.count(),
  });
  if (more) console.table(more.counts);
}

const monthsPaid = new Set();
async function monthDone(d) {
  const key = iso(d).slice(0, 7);
  if (monthsPaid.has(key)) return true;
  monthsPaid.add(key);
  return false;
}

main()
  .catch((e) => {
    console.error(e);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
