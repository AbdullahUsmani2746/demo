// scripts/demo/test-features.mjs — proves every Settings → Features switch both ways through the API.
//   node --env-file=.env scripts/demo/test-features.mjs [--base http://localhost:3000]   (app running, demo database; or DEMO_BASE_URL)
// Saves each feature on / off, checks the server behaves accordingly, and resets them to the defaults.
if (!(process.env.DEMO_DATABASE === "1" || process.env.DATABASE_URL?.includes("bizlogist_demo"))) { console.error("Refusing: not the demo database."); process.exit(1); }
import { PrismaClient } from "@prisma/client";
import { runSubAccountsAndRmc } from "./features/subAccountsRmc.mjs";
import { runProduction } from "./features/production.mjs";
import { runFixedAssets } from "./features/fixedAssets.mjs";
import { runHrPayroll } from "./features/hrPayroll.mjs";
import { runHrSmsPort } from "./features/hrSmsPort.mjs";
import { runSalesDispatch } from "./features/salesDispatch.mjs";
import { runPlanLab } from "./features/planLab.mjs";
import { runAccountingPort } from "./features/accounting.mjs";
import { runCostingPort } from "./features/costing.mjs";
const prisma = new PrismaClient();
const BASE = process.argv.includes("--base") ? process.argv[process.argv.indexOf("--base") + 1] : (process.env.DEMO_BASE_URL || "http://localhost:3000");

async function login(u) {
  const jar = new Map();
  const keep = (r) => { for (const c of r.headers.getSetCookie()) { const [p] = c.split(";"); const i = p.indexOf("="); jar.set(p.slice(0, i), p.slice(i + 1)); } };
  const cookie = () => [...jar].map(([k, v]) => `${k}=${v}`).join("; ");
  const c = await fetch(`${BASE}/api/auth/csrf`); keep(c); const { csrfToken } = await c.json();
  const r = await fetch(`${BASE}/api/auth/callback/credentials`, { method: "POST", redirect: "manual", headers: { "content-type": "application/x-www-form-urlencoded", cookie: cookie() }, body: new URLSearchParams({ csrfToken, email: u, password: "demo123", json: "true" }) });
  keep(r);
  return async (method, path, body) => {
    const res = await fetch(`${BASE}${path}`, { method, headers: { "content-type": "application/json", cookie: cookie() }, body: body ? JSON.stringify(body) : undefined });
    let j = null; try { j = await res.json(); } catch {}
    return { status: res.status, body: j };
  };
}
const results = [];
const check = (name, ok, detail = "") => { results.push(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + detail : ""}`); };

const admin = await login("admin");
const viewer = await login("sales");
// every server route reads Settings → Features through its own 10 s cache
const set = async (values) => { const r = await admin("PUT", "/api/settings/features", { values }); await new Promise((ok) => setTimeout(ok, 11000)); return r; };
// The switches the company had before the run — put back at the end (the demo
// database runs with its own set, scripts/demo/demoFeatures.mjs).
const featuresBefore = (await admin("GET", "/api/settings/features")).body?.values || null;
const vr = async (tc) => (await admin("GET", `/api/voucher/next-vr-no?tran_code=${tc}`)).body.nextVrNo;

try {
  // 0. reading + rights
  const g = await admin("GET", "/api/settings/features");
  check("GET features (admin)", g.status === 200 && g.body.values["dispatch.produceOnDispatch"] === true && g.body.canEdit === true);
  const gv = await viewer("GET", "/api/settings/features");
  check("GET features (sales user, read-only)", gv.status === 200 && gv.body.canEdit === false);
  const pv = await viewer("PUT", "/api/settings/features", { values: { "documents.servicesPanel": false } });
  check("PUT features refused for sales user", pv.status === 403, `status ${pv.status}`);
  const bad = await set({ "nope.x": true });
  check("PUT unknown feature refused", bad.status === 400, bad.body?.message);

  // 1. recipe mode
  await set({ "production.processOrderSource": "recipe" });
  const bom = await prisma.bomMaster.findFirst({ where: { finished_id: 601 } });
  const recipe = await prisma.rECEIPE_MASTER.findFirst({ where: { finished_id: 601 } });
  const order = (extra) => ({
    type: "new", dated: "2026-11-14", bom_id: bom.id, ...extra,
    outputs: [{ line_no: 1, finished_id: 601, qty: 100, godown: 3, batch_no: "TEST-1", bom_id: bom.id }],
    productionPlanDetail: [{ sno: 1, material_id: 103, material_qty: 22, material_percentage: 22, output_line: 1, godown: 1, unit: "KG" }],
  });
  const r1 = await admin("POST", "/api/manufacturing/production", order({}));
  check("recipe mode: new process order without recipe refused", r1.status === 422, r1.body?.error);
  const other = await prisma.rECEIPE_MASTER.findFirst({ where: { finished_id: 602 } });
  const r2 = await admin("POST", "/api/manufacturing/production", order({ receipe_id: other.receipe_id }));
  check("recipe mode: recipe of another item refused", r2.status === 422, r2.body?.error);
  const r3 = await admin("POST", "/api/manufacturing/production", order({ receipe_id: recipe.receipe_id }));
  check("recipe mode: with its recipe saved", r3.status === 201, `plan ${r3.body?.id} receipe ${r3.body?.receipe_id}`);
  await set({ "production.processOrderSource": "bom" });
  const r4 = await admin("POST", "/api/manufacturing/production", order({}));
  check("BOM mode: process order without recipe saved", r4.status === 201, `status ${r4.status} ${r4.body?.error || ""} plan ${r4.body?.id}`);

  // 2. produce on dispatch off → a BOM line cannot produce (801 is never in stock)
  const so = await prisma.orderMaster.findFirst({ where: { order_catagory: 6 }, orderBy: { order_no: "desc" } });
  const dispatchBody = async () => ({
    master: { tran_code: 6, vr_no: await vr(6), dated: "2026-11-14", pycd: so.party_code, godown: 3, godown2: 1, rmk: "feature test" },
    lines: [{ itcd: 801, qty: 10, unit: "KG", godown: 3, materials: [{ itcd: 102, qty: 3, godown: 1 }, { itcd: 301, qty: 2, godown: 1 }, { itcd: 306, qty: 5, godown: 1 }] }],
  });
  await set({ "dispatch.produceOnDispatch": false });
  const d1 = await admin("POST", "/api/voucher/dispatch", await dispatchBody());
  check("produce-on-dispatch OFF: BOM materials ignored → refused for no FG stock", d1.status === 422, d1.body?.message?.slice(0, 120));
  await set({ "dispatch.produceOnDispatch": true });
  const d2 = await admin("POST", "/api/voucher/dispatch", await dispatchBody());
  const autoBom = d2.body?.voucherId ? await prisma.transactionsMaster.count({ where: { rmk4: String(d2.body.voucherId), rmk1: { in: ["AUTO_DISPATCH_BOM", "AUTO_DISPATCH_PROD"] } } }) : 0;
  check("produce-on-dispatch ON: dispatch saved with auto issue + production", d2.status === 201 && autoBom === 2, `status ${d2.status}, auto vouchers ${autoBom}`);

  // 3. services panel off → services in the body are not booked
  const svc = await prisma.service.findFirst();
  const grnBody = async (no) => ({
    master: { tran_code: 4, vr_no: await vr(4), dated: "2026-11-14", pycd: 3001, godown: 1, rmk: `feature test ${no}` },
    lines: [{ itcd: 101, qty: 5 + no, unit: "KG", godown: 1 }],
    services: [{ service_id: svc.id, pycd: 4001, qty: 1, rate: 2500, st_rate: 0, invoice_no: `SVC-${no}` }],
  });
  await set({ "documents.servicesPanel": false });
  const s1 = await admin("POST", "/api/voucher/grn", await grnBody(1));
  const linked1 = s1.body?.voucherId ? await prisma.serviceInvoiceLink.count({ where: { source_tran_id: s1.body.voucherId } }).catch(() => -1) : -1;
  check("services panel OFF: GRN saved, no service invoice booked", s1.status === 201 && linked1 === 0, `status ${s1.status}, links ${linked1}`);
  await set({ "documents.servicesPanel": true });
  const s2 = await admin("POST", "/api/voucher/grn", await grnBody(2));
  const linked2 = s2.body?.voucherId ? await prisma.serviceInvoiceLink.count({ where: { source_tran_id: s2.body.voucherId } }).catch(() => -1) : -1;
  check("services panel ON: GRN saved with its service invoice", s2.status === 201 && linked2 === 1, `status ${s2.status}, links ${linked2} ${s2.body?.message || ""}`);

  // 4. batch check API
  const b = await admin("GET", "/api/dispatch/batch-check?batch_no=B1001");
  check("dispatch batch-check API answers", b.status === 200 && typeof b.body?.used === "object", JSON.stringify(b.body).slice(0, 80));

  // 5. knockoff.matchReturns — a sale return traced to no invoice (no dispatch named)
  {
    const runKnockoff = async () => (await admin("POST", "/api/invoice-knockoff/run")).body;
    await set({ "knockoff.matchReturns": false });
    await runKnockoff(); // settle what receipts can first, so the return meets an open invoice
    // the customer owing most on their invoices
    const [cust] = await prisma.$queryRaw`
      SELECT tm.pycd AS acno FROM "TRANSACTIONS_MASTER" tm
      WHERE tm.tran_code = 6 AND tm.invoice_no IS NOT NULL
      GROUP BY tm.pycd
      ORDER BY (SELECT SUM(COALESCE(t.damt, 0) - COALESCE(t.camt, 0)) FROM "Transactions" t WHERE t.acno = tm.pycd) DESC
      LIMIT 1`;
    // qty differs per run and per return: the save route refuses an identical document within minutes
    const runSeed = Math.floor(Date.now() / 1000) % 50;
    const retQty = (no) => 3 + runSeed + no * 100;
    const postReturn = async (no) => {
      const res = await admin("POST", "/api/voucher/dispatchReturn", {
        master: { tran_code: 10, vr_no: await vr(10), dated: "2026-08-25", pycd: Number(cust.acno), godown: 3, rmk: `feature test return ${no}` },
        // a different qty each time (the save route refuses an identical document twice)
        lines: [{ itcd: 601, qty: retQty(no), original_qty: retQty(no), unit: "KG", godown: 3 }],
      });
      const id = res.body?.voucherId;
      if (!id) return { res };
      const lines = await prisma.transactions.findMany({ where: { tran_id: id, sub_tran_id: 1 }, select: { id: true } });
      const inv = await admin("POST", "/api/invoicing/sale-return/generate", {
        invoices: [{ tran_id: id, lines: lines.map((t) => ({ line_id: t.id, rate: 100, st_rate: 18 })) }],
      });
      return { res, inv, id };
    };
    const allocs = (id) => prisma.invoiceKnockoff.count({ where: { source_tran_id: id, reversed_at: null } });
    const r1 = await postReturn(1);
    check("matchReturns: sale return with no dispatch posted + invoiced", r1.res.status === 201 && r1.inv?.status === 200 && JSON.stringify(r1.inv?.body).includes('"invoiced"'), `return ${r1.res.status} ${r1.res.body?.message || ""} invoicing ${r1.inv?.status} ${JSON.stringify(r1.inv?.body?.results ?? r1.inv?.body)?.slice(0, 120)}`);
    const cand = async () => ((await admin("GET", `/api/invoice-knockoff/candidates?acno=${cust.acno}`)).body?.data || []).some((c) => c.sourceTranId === r1.id);
    const k1 = await runKnockoff();
    const off = r1.id ? await allocs(r1.id) : -1;
    check("matchReturns OFF: the return is not knocked off nor listed for review", off === 0 && !(await cand()), `run ${k1?.runId}, allocations ${off}`);
    const manual = await admin("POST", "/api/invoice-knockoff", { source_line_id: (await prisma.transactions.findFirst({ where: { tran_id: r1.id ?? 0, sub_tran_id: 3, acno: Number(cust.acno) } }))?.id ?? 0, allocations: [{ invoice_no: "X", amount: 1 }] });
    check("matchReturns OFF: manual knock-off of a return refused", manual.status === 400, manual.body?.message);
    await set({ "knockoff.matchReturns": true });
    const listed = await cand();
    const k2 = await runKnockoff();
    const on = r1.id ? await prisma.invoiceKnockoff.findMany({ where: { source_tran_id: r1.id, reversed_at: null } }) : [];
    const total = on.reduce((s, k) => s + k.allocated_amount, 0);
    check("matchReturns ON: listed for review, then FIFO-matched as RETURN for its full amount", listed && on.length > 0 && on.every((k) => k.source_type === "RETURN") && Math.abs(total - retQty(1) * 118) < 0.01, `run ${k2?.runId} matched ${k2?.linesMatched}, rows ${on.length}, total ${total}`);
    const ret = r1.id ? await prisma.transactions.count({ where: { tran_id: r1.id } }) : 0;
    check("matchReturns ON: the return document itself is not split", ret === 4 || ret === 3, `lines ${ret}`);
    await set({ "knockoff.matchReturns": false });
    const r2 = await postReturn(2);
    await runKnockoff();
    const kept = r1.id ? await allocs(r1.id) : -1;
    const off2 = r2.id ? await allocs(r2.id) : -1;
    check("matchReturns OFF again: earlier matches kept, a new return not matched", kept === on.length && off2 === 0, `kept ${kept}, new ${off2} ${r2.res.status} ${r2.res.body?.message || ""}`);
    const unlock = r1.id ? await admin("POST", "/api/invoicing/sale-return/unlock", { tran_id: r1.id }) : { status: 0 };
    check("a knocked-off return cannot be unlocked until reversed", unlock.status >= 400 && /knocked off/i.test(unlock.body?.message || unlock.body?.error || ""), `${unlock.status} ${unlock.body?.message || unlock.body?.error || ""}`);
  }

  // 6. Fix FIFO order (knockoff.refifo) — admin tool, permission-gated
  {
    const g1 = await admin("GET", "/api/invoice-knockoff/refifo");
    check("refifo: preview for admin", g1.status === 200 && Array.isArray(g1.body?.parties) && Array.isArray(g1.body?.backups), `status ${g1.status} ${g1.body?.message || ""}`);
    const g2 = await viewer("GET", "/api/invoice-knockoff/refifo");
    check("refifo: refused without knockoff.refifo", g2.status === 403, `status ${g2.status}`);
    const waitJob = async () => { for (let i = 0; i < 90; i++) { const j = (await admin("GET", "/api/invoice-knockoff/refifo")).body?.job; if (j && j.status !== "running") return j; await new Promise((ok) => setTimeout(ok, 2000)); } return null; };
    // Make a customer out of order: an invoice dated before the invoices their receipts already paid.
    const [party] = await prisma.$queryRaw`
      SELECT k.invoice_party_acno AS acno FROM "INVOICE_KNOCKOFF" k
      JOIN "TRANSACTIONS_MASTER" i ON i.tran_id = k.invoice_tran_id AND i.tran_code = 6
      WHERE k.reversed_at IS NULL AND k.run_id IS NOT NULL AND k.is_manual = false AND k.allocated_amount > 0
      GROUP BY 1 ORDER BY SUM(k.allocated_amount) DESC LIMIT 1`;
    const acno = Number(party?.acno);
    const d = await admin("POST", "/api/voucher/dispatch", {
      master: { tran_code: 6, vr_no: await vr(6), dated: "2026-06-01", pycd: acno, godown: 3, rmk: `feature test late invoice ${Date.now()}` },
      lines: [{ itcd: 601, qty: 1 + (Math.floor(Date.now() / 1000) % 50) / 10, unit: "KG", godown: 3 }],
    });
    const dl = d.body?.voucherId ? await prisma.transactions.findMany({ where: { tran_id: d.body.voucherId, sub_tran_id: 1 }, select: { id: true } }) : [];
    const di = await admin("POST", "/api/invoicing/sale/generate", { invoices: [{ tran_id: d.body?.voucherId, lines: dl.map((t) => ({ line_id: t.id, rate: 1000, st_rate: 18 })) }] });
    const g3 = await admin("GET", "/api/invoice-knockoff/refifo?party=customer");
    check("refifo: a late, older invoice puts the customer on the list", d.status === 201 && g3.body?.parties?.some((p) => p.acno === acno), `dispatch ${d.status}, invoicing ${JSON.stringify(di.body?.results ?? di.body).slice(0, 80)}, parties ${g3.body?.parties?.map((p) => p.acno).join(",")}`);
    const snapshot = async () => (await prisma.invoiceKnockoff.findMany({ where: { invoice_party_acno: acno, reversed_at: null }, select: { id: true, invoice_no: true, allocated_amount: true }, orderBy: { id: "asc" } })).map((k) => `${k.id}:${k.invoice_no}:${k.allocated_amount.toFixed(2)}`).join("|");
    const before = await snapshot();
    const a = await admin("POST", "/api/invoice-knockoff/refifo?action=apply", { party: "customer" });
    const ja = a.status === 200 ? await waitJob() : null;
    const oldInv = d.body?.voucherId ? await prisma.invoiceKnockoff.count({ where: { invoice_tran_id: d.body.voucherId, reversed_at: null } }) : 0;
    check("refifo: fix re-matches oldest first (the late invoice gets paid)", ja?.status === "completed" && !!ja.result?.stamp && oldInv > 0, `${a.status} ${a.body?.message || ""} ${ja?.status} ${ja?.log?.at(-1)?.message || ""}, allocations on the late invoice ${oldInv}`);
    if (ja?.result?.stamp) {
      const u = await admin("POST", "/api/invoice-knockoff/refifo?action=restore", { stamp: ja.result.stamp });
      const ju = u.status === 200 ? await waitJob() : null;
      const after = await snapshot();
      check("refifo: undo puts the customer's knock-offs back exactly", ju?.status === "completed" && after === before, `${ju?.status} ${ju?.log?.at(-1)?.message || ""} ${after === before ? "" : `before ${before.slice(0, 80)} after ${after.slice(0, 80)}`}`);
    }
  }

  // 7–8. vouchers.subAccounts, reports.rmcInputRates (scripts/demo/features/subAccountsRmc.mjs)
  await runSubAccountsAndRmc({ admin, viewer, set, vr, check, prisma });

  // A + 11–17. Production setup, BOM / process order switches (scripts/demo/features/production.mjs)
  await runProduction({ admin, viewer, set, check, prisma });
  await runFixedAssets({ admin, viewer, set, check, prisma });
  await runHrPayroll({ admin, viewer, set, check, prisma });
  await runHrSmsPort({ admin, viewer, set, check, prisma });

  // Sale Order / Dispatch switches + trial line billing (scripts/demo/features/salesDispatch.mjs)
  await runSalesDispatch({ admin, viewer, set, vr, check, prisma });

  // Sale Order → Production Plan → Lab Nature → Process Order → Dispatch (scripts/demo/features/planLab.mjs)
  await runPlanLab({ admin, set, vr, check, prisma });

  // Ported from Accounting: GRN direct rate, sale return link, line WHT, planned qty (scripts/demo/features/accounting.mjs)
  await runAccountingPort({ admin, set, vr, check, prisma });

  // Ported from Accounting: costing method, semi-finished CC, reconciliation screens (scripts/demo/features/costing.mjs)
  await runCostingPort({ admin, viewer, set, check, prisma });

  // 9. Audit trail in words (always on) + Sale Order line edit stamps
  {
    const [so] = await prisma.$queryRaw`
      SELECT o.order_no FROM "OrderMaster" o WHERE o.order_catagory = 6
        AND NOT EXISTS (SELECT 1 FROM "TRANSACTIONS_MASTER" t WHERE t.so_no = o.order_no)
        AND (SELECT COUNT(*) FROM "OrderDetail" d WHERE d.order_no = o.order_no) >= 2
      ORDER BY o.order_no DESC LIMIT 1`;
    const o = await prisma.orderMaster.findUnique({ where: { order_no: so.order_no }, include: { orderDetails: { orderBy: { id: "asc" } } } });
    const [first, second] = o.orderDetails;
    const lineOf = (d, qty) => ({ itcd: d.itcd, qty, rate: d.rate, amount: qty * d.rate, unit: d.unit, no_of_packs: d.no_of_packs, qty_per_pack: d.qty_per_pack, st_rate: d.st_rate, st_amount: d.st_amount });
    const put = await admin("PUT", "/api/orders/saleOrder", {
      master: { order_no: o.order_no, party_code: { value: o.party_code }, godown: o.godown, dated: o.dated.toISOString().slice(0, 10), due_date: o.due_date, sale_po: o.sale_po, region: o.region, delivery_terms: o.delivery_terms, payment_terms: o.payment_terms, delivery_location: o.delivery_location, additional_instructions: o.additional_instructions },
      lines: o.orderDetails.map((d, i) => lineOf(d, i === 0 ? d.qty + 1 : d.qty)),
    });
    const after = await prisma.orderDetail.findMany({ where: { order_no: o.order_no }, orderBy: { id: "asc" } });
    // lines are recreated in the same order — compare by position (an item may be on two lines)
    const [a1, a2] = after;
    check("SO line edit: the changed line is stamped (who, when, previous qty); the unchanged one keeps its stamp",
      put.status === 200 && a1?.edited_by && a1.prev_qty === first.qty && a1.edited_at && a2?.edited_by === second.edited_by && a2?.prev_qty === second.prev_qty,
      `PUT ${put.status} ${put.body?.message || ""}; changed ${a1?.edited_by} prev ${a1?.prev_qty}; unchanged ${a2?.edited_by} prev ${a2?.prev_qty}`);
    await new Promise((ok) => setTimeout(ok, 1500)); // the audit rows are written in the background
    const au = await admin("GET", `/api/audit?doc_model=OrderMaster&doc_id=${o.order_no}`);
    const rows = au.body?.rows || [];
    const named = rows.find((r) => r.model_name === "OrderDetail" && r.item?.code && r.story);
    check("audit trail: rows carry the item's code + name and a sentence", au.status === 200 && !!named, named?.story?.slice(0, 110));
    const changed = rows.find((r) => r.resave && !r.resave.same && r.resave.diffs?.some((d) => d.field === "qty"));
    check("audit trail: the re-saved line is paired and shows qty old → new", !!changed, changed ? changed.story.slice(0, 140) : `${rows.length} rows, none paired`);
    const who = rows.find((r) => r.model_name === "OrderMaster" && r.action === "update");
    check("audit trail: the save is recorded under the user who made it", !!who?.user_id && who.source === "user", `${who?.user_name ?? "no user"} / ${who?.source}`);
    const acc = rows.find((r) => r.model_name === "OrderMaster" && r.account?.name);
    check("audit trail: the order's customer is named", !!acc, acc?.account?.name);
  }

  // 10. BI built-in dashboard filters switched on / off (always on; Settings key biDashboardFilters)
  {
    const g = await admin("GET", "/api/bi/dash-filters");
    const field = (rows, f) => rows?.find((x) => x.field === f);
    check("BI dash filters: Book on, Item Category / Series off by default", g.status === 200 && field(g.body?.filters, "book")?.enabled === true && field(g.body?.filters, "series")?.enabled === false && field(g.body?.filters, "item_category")?.enabled === false, JSON.stringify(g.body?.filters?.map((x) => [x.field, x.enabled])));
    const gv = await viewer("GET", "/api/bi/dash-filters");
    check("BI dash filters: switch refused without bi.design", gv.status === 403, `status ${gv.status}`);
    const dash = await prisma.biDashboard.findFirst({ where: { is_active: true }, orderBy: { id: "asc" } });
    const builtins = async () => ((await admin("GET", `/api/bi/my/${dash.id}?period=m3`)).body?.builtinFilters || []).map((x) => x.field);
    const values = async (f) => (await admin("GET", `/api/bi/my/${dash.id}/values?field=${f}`)).body?.values || [];
    const before = await builtins();
    const s1 = await admin("POST", "/api/bi/dash-filters", { series: true, item_category: true, book: false });
    const on = await builtins();
    const cats = await values("item_category");
    check("BI dash filters ON: dashboard offers Item Category + Series, Book hidden", s1.status === 200 && on.includes("series") && on.includes("item_category") && !on.includes("book") && before.includes("book"), `before ${before} after ${on}; ${cats.length} categories`);
    const narrowed = await admin("GET", `/api/bi/my/${dash.id}?period=m3&f_book=Off%20books`);
    check("BI dash filters: a switched-off filter is ignored by the server", !narrowed.body?.filters?.some((f) => f.field === "book"), JSON.stringify(narrowed.body?.filters));
    await admin("POST", "/api/bi/dash-filters", { series: false, item_category: false, book: true });
    const off = await builtins();
    const none = await values("series");
    check("BI dash filters OFF again: back to Book only, Series has no choices", off.join() === "book" && none.length === 0, `${off} / ${none.length}`);
  }
} finally {
  await admin("PUT", "/api/settings/features", { reset: true });
  if (featuresBefore) await admin("PUT", "/api/settings/features", { values: featuresBefore });
  console.log(results.join("\n"));
  if (results.some((r) => r.startsWith("FAIL"))) process.exitCode = 1;
  await prisma.$disconnect();
}
