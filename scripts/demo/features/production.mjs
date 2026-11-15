// scripts/demo/features/production.mjs — Settings → Production setup + the BOM / process order
// switches of Settings → Features, run from scripts/demo/test-features.mjs (which owns login,
// set() and the final feature reset). This file restores the production setup itself.
//   A.  Production setup (Settings key "productionSetup") — rights, validation, consumers follow it
//   11. production.bomRequired     12. bom.percentRule       13. production.multiOutput
//   14. production.postingDate     15. production.yieldEditWindow
//   16. production.autoLoadBom     17. bom.oneActivePerItem
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const today = () => new Date().toISOString().slice(0, 10);

export async function runProduction({ admin, viewer, set, check, prisma }) {
  // Each route caches the production setup 10 s, like the features.
  const setSetup = async (body) => { const r = await admin("PUT", "/api/settings/production-setup", body); await wait(11000); return r; };

  const bom601 = await prisma.bomMaster.findFirst({ where: { finished_id: 601, instructions: "A" }, orderBy: { id: "asc" } });
  // One raw material line out of the raw material store (1 KG, so stock never runs short).
  const order = ({ outputs, dated = today(), extra = {} } = {}) => ({
    type: "new", dated, ...extra,
    outputs: outputs || [{ line_no: 1, finished_id: 601, qty: 10, batch_no: `FT-${Date.now()}`, bom_id: bom601.id }],
    productionPlanDetail: (outputs || [{ line_no: 1 }]).map((o, i) => ({ sno: i + 1, material_id: 101, material_qty: 1, material_percentage: 10, output_line: o.line_no, godown: 1, unit: "KG" })),
  });
  const plans = [];
  const createOrder = async (args) => { const r = await admin("POST", "/api/manufacturing/production", order(args)); if (r.body?.id) plans.push(r.body.id); return r; };
  const getPlan = async (id) => (await admin("GET", `/api/manufacturing/production?id=${id}`)).body?.data?.[0];

  // ── A. Production setup ────────────────────────────────────────────────
  try {
    const g = await admin("GET", "/api/settings/production-setup");
    check("production setup: defaults = the old fixed ids", g.status === 200 && g.body.canEdit === true &&
      JSON.stringify(g.body.values) === JSON.stringify({ finishedCategoryIds: [1], semiFinishedCategoryIds: [2], rawMaterialCategoryIds: [3], packingCategoryIds: [4], productionGodown: 2, finishedGoodsGodown: 3, fgTransferGodown: 6 }), JSON.stringify(g.body.values));
    const gv = await viewer("GET", "/api/settings/production-setup");
    check("production setup: sales user reads it, read-only", gv.status === 200 && gv.body.canEdit === false);
    const pv = await viewer("PUT", "/api/settings/production-setup", { values: { productionGodown: 1 } });
    check("production setup: PUT refused for sales user", pv.status === 403, `status ${pv.status}`);
    const ov = await admin("PUT", "/api/settings/production-setup", { values: { packingCategoryIds: [3, 4] } });
    check("production setup: a category of two kinds refused", ov.status === 400, ov.body?.message);
    const uk = await admin("PUT", "/api/settings/production-setup", { values: { finishedCategoryIds: [1, 999] } });
    check("production setup: unknown category refused", uk.status === 400, uk.body?.message);

    const packing = async () => ((await admin("GET", "/api/setup/all-packing-materials")).body?.data || []).map((i) => i.ic_id);
    const p0 = await packing();
    const plan = await createOrder({ outputs: [{ line_no: 1, finished_id: 601, qty: 10, batch_no: `FT-G-${Date.now()}`, bom_id: bom601.id }] });
    const godownOf = async () => (await getPlan(plan.body?.id))?.outputs?.[0]?.godown;
    // the order was saved without an output godown → it follows the setup
    const before = await godownOf();
    check("production setup: default FG output godown = 3, packing list = category 4", plan.status === 201 && before === 3 && p0.length > 0 && p0.every((c) => c === 4), `order ${plan.status} ${plan.body?.error || ""} godown ${before}, packing categories ${[...new Set(p0)]}`);
    const s1 = await setSetup({ values: { finishedGoodsGodown: 5, packingCategoryIds: [4, 5] } });
    const after = await godownOf();
    const p1 = await packing();
    check("production setup changed: process order output godown + packing list follow it", s1.status === 200 && after === 5 && p1.includes(5) && p1.includes(4), `PUT ${s1.status} ${s1.body?.message || ""}, godown ${after}, packing categories ${[...new Set(p1)]}`);
    const fgDaily = await admin("GET", "/api/reports/fgdailystock?dateFrom=2026-11-01&dateTo=2026-11-30&limit=5");
    check("production setup changed: FG daily update report still answers", fgDaily.status === 200, `status ${fgDaily.status}`);
  } finally {
    const r = await setSetup({ reset: true });
    const back = (await admin("GET", "/api/settings/production-setup")).body?.values;
    check("production setup: reset to defaults", r.status === 200 && back?.finishedGoodsGodown === 3 && JSON.stringify(back?.packingCategoryIds) === "[4]", JSON.stringify(back));
  }

  // ── 11. production.bomRequired ─────────────────────────────────────────
  {
    const noBom = { outputs: [{ line_no: 1, finished_id: 601, qty: 10, batch_no: `FT-B-${Date.now()}` }] };
    await set({ "production.bomRequired": true });
    const r1 = await createOrder(noBom);
    check("bomRequired ON: process order without a BOM refused", r1.status === 422 && /BOM/.test(r1.body?.error || ""), `${r1.status} ${r1.body?.error || ""}`);
    const r2 = await createOrder();
    check("bomRequired ON: with its BOM saved", r2.status === 201, `${r2.status} ${r2.body?.error || ""}`);
    await set({ "production.bomRequired": false });
    const r3 = await createOrder(noBom);
    check("bomRequired OFF: without a BOM saved (free entry)", r3.status === 201, `${r3.status} ${r3.body?.error || ""}`);
  }

  // ── 13. production.multiOutput ─────────────────────────────────────────
  {
    const two = { outputs: [
      { line_no: 1, finished_id: 601, qty: 10, batch_no: `FT-M1-${Date.now()}`, bom_id: bom601.id },
      { line_no: 2, finished_id: 602, qty: 5, batch_no: `FT-M2-${Date.now()}` },
    ] };
    const multi = await createOrder(two); // default ON
    check("multiOutput ON: order with two production items saved", multi.status === 201, `${multi.status} ${multi.body?.error || ""}`);
    await set({ "production.multiOutput": false });
    const r1 = await createOrder(two);
    check("multiOutput OFF: a second production item refused", r1.status === 422 && /One production item/.test(r1.body?.error || ""), `${r1.status} ${r1.body?.error || ""}`);
    const r2 = await createOrder();
    check("multiOutput OFF: one production item saved", r2.status === 201, `${r2.status} ${r2.body?.error || ""}`);
    if (multi.body?.id) {
      const p = await getPlan(multi.body.id);
      const body = { ...order(two), dated: p.dated, outputs: p.outputs.map((o) => ({ ...o, qty: o.qty + 1 })), productionPlanDetail: p.productionPlanDetail.map((d) => ({ ...d, godown: d.issue_godown, unit: d.issue_unit })) };
      const e = await admin("PUT", `/api/manufacturing/production/${multi.body.id}`, body);
      check("multiOutput OFF: a saved two-item order is still editable as saved", e.status === 200, `${e.status} ${e.body?.error || ""}`);
    }
    await set({ "production.multiOutput": true });
  }

  // ── 14. production.postingDate + 15. production.yieldEditWindow ──────────
  {
    const send = (id) => admin("POST", "/api/manufacturing/production/send-to-production", { productionPlanId: id });
    const voucherDates = async (id) => (await prisma.transactionsMaster.findMany({ where: { rmk5: String(id), tran_code: { in: [7, 8] } }, select: { dated: true } })).map((t) => t.dated.toISOString().slice(0, 10));
    const local = (d) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

    await set({ "production.postingDate": "plan" });
    const a = await createOrder({ dated: "2026-11-10" });
    const sa = a.body?.id ? await send(a.body.id) : { status: 0 };
    const da = a.body?.id ? await voucherDates(a.body.id) : [];
    check("postingDate PLAN: issue + production vouchers carry the plan date", sa.status === 200 && da.length >= 2 && da.every((d) => d === "2026-11-10"), `order ${a.status} ${a.body?.error || ""} send ${sa.status} ${sa.body?.error || ""} dates ${da}`);
    await set({ "production.postingDate": "sent" });
    const b = await createOrder({ dated: "2026-11-10" });
    const sb = b.body?.id ? await send(b.body.id) : { status: 0 };
    const db = b.body?.id ? (await prisma.transactionsMaster.findMany({ where: { rmk5: String(b.body.id), tran_code: { in: [7, 8] } }, select: { dated: true } })).map((t) => local(t.dated)) : [];
    check("postingDate SENT: vouchers dated the day they are sent", sb.status === 200 && db.length >= 2 && db.every((d) => d === local(new Date())), `order ${b.status} ${b.body?.error || ""} send ${sb.status} ${sb.body?.error || ""} dates ${db}`);

    // yield window on order b (just posted)
    const yieldPut = async (id, y) => {
      const p = await getPlan(id);
      return admin("PUT", `/api/manufacturing/production/${id}`, {
        type: "new", dated: p.dated,
        outputs: p.outputs.map((o) => ({ ...o, actual_yield: y })),
        productionPlanDetail: p.productionPlanDetail.map((d) => ({ ...d, godown: d.issue_godown, unit: d.issue_unit })),
      });
    };
    if (b.body?.id) {
      const y0 = await yieldPut(b.body.id, 9.5);
      check("yieldEditWindow 24h: yield of a just-posted order changes", y0.status === 200, `${y0.status} ${y0.body?.error || ""}`);
      await set({ "production.yieldEditWindow": "never" });
      const y1 = await yieldPut(b.body.id, 9.4);
      check("yieldEditWindow NEVER: refused even right after posting", y1.status === 400, `${y1.status} ${y1.body?.error || ""}`);
      // demo fixture: make the order look posted 30 hours ago (the only way to age it)
      await prisma.productionPlanMaster.update({ where: { id: b.body.id }, data: { sent_to_production_date: new Date(Date.now() - 30 * 3600 * 1000) } });
      await set({ "production.yieldEditWindow": "24h" });
      const y2 = await yieldPut(b.body.id, 9.3);
      check("yieldEditWindow 24h: refused 30 h after posting", y2.status === 400, `${y2.status} ${y2.body?.error || ""}`);
      await set({ "production.yieldEditWindow": "72h" });
      const y3 = await yieldPut(b.body.id, 9.2);
      const t8 = await prisma.transactions.findFirst({ where: { itcd: 601, tran_id: { in: (await prisma.transactionsMaster.findMany({ where: { rmk5: String(b.body.id), tran_code: 8 }, select: { tran_id: true } })).map((t) => t.tran_id) } }, select: { qty: true } });
      check("yieldEditWindow 72h: allowed 30 h after posting, production voucher follows", y3.status === 200 && Math.abs((t8?.qty ?? 0) - 9.2) < 1e-6, `${y3.status} ${y3.body?.error || ""} T8 qty ${t8?.qty}`);
      await set({ "production.yieldEditWindow": "24h" });
    }
  }

  // ── 16. production.autoLoadBom (a screen behaviour: the form loads the active BOM on pick) ──
  {
    await set({ "production.autoLoadBom": true });
    const on = (await admin("GET", "/api/settings/features")).body?.values?.["production.autoLoadBom"];
    const bomList = await admin("GET", "/api/manufacturing/bom?finished_id=601&filterStatus=Active&limit=1");
    await set({ "production.autoLoadBom": false });
    const off = (await admin("GET", "/api/settings/features")).body?.values?.["production.autoLoadBom"];
    check("autoLoadBom: saved on / off; the active-BOM lookup the form uses answers", on === true && off === false && bomList.body?.data?.[0]?.finished_id === 601, `${on}/${off} bom ${bomList.body?.data?.[0]?.id}`);
  }

  // ── 12. bom.percentRule + 17. bom.oneActivePerItem ───────────────────────
  {
    const mats = (await admin("GET", `/api/manufacturing/bom/${bom601.id}`)).body?.materials || [];
    const details = (total) => {
      const base = mats.reduce((s, m) => s + Number(m.percentage || 0), 0) || 100;
      return mats.map((m) => ({ material_id: m.id, material_percentage: (Number(m.percentage) * total) / base }));
    };
    const testBoms = [];
    try {
      // a test BOM for 601, saved Inactive so it never competes with the real one
      const c = await admin("POST", "/api/manufacturing/bom", { finished_id: 601, instructions: "B", bomDetails: details(100) });
      if (c.body?.id) testBoms.push(c.body.id);
      const put = (total, extra = {}) => admin("PUT", `/api/manufacturing/bom/${c.body.id}`, { finished_id: 601, instructions: "B", bomDetails: details(total), ...extra });
      const c2 = await admin("POST", "/api/manufacturing/bom", { finished_id: 601, instructions: "B", bomDetails: details(105) });
      if (c2.body?.id) testBoms.push(c2.body.id);
      check("percentRule SMS: a new finished BOM must total 100 % (105 refused by the API)", c.status === 201 && c2.status === 422, `${c.status} ${c.body?.error || JSON.stringify(c.body)?.slice(0, 80)} / ${c2.status} ${c2.body?.error || ""}`);
      const e1 = await put(105);
      const e2 = await put(80);
      check("percentRule SMS: an edited finished BOM may total 99–111 % (105 ok, 80 refused)", e1.status === 200 && e2.status === 422, `${e1.status} / ${e2.status} ${e2.body?.error || ""}`);
      await set({ "bom.percentRule": "exact100" });
      const x1 = await put(105);
      const x2 = await put(100);
      check("percentRule EXACT 100: 105 refused, 100 saved", x1.status === 422 && x2.status === 200, `${x1.status} ${x1.body?.error || ""} / ${x2.status}`);
      await set({ "bom.percentRule": "none" });
      const n1 = await put(60);
      check("percentRule NONE: any total saved (60 %)", n1.status === 200, `${n1.status} ${n1.body?.error || ""}`);
      await set({ "bom.percentRule": "sms" });
      await put(100);

      // one active BOM per item
      const activeOf601 = async () => (await prisma.bomMaster.findMany({ where: { finished_id: 601, instructions: "A" }, select: { id: true } })).map((b) => b.id).sort();
      const a0 = await put(100, { instructions: "A" }); // OFF (default): two active BOMs
      const off = await activeOf601();
      check("oneActivePerItem OFF: a second active BOM of the item is allowed", a0.status === 200 && off.includes(bom601.id) && off.includes(c.body.id), `${a0.status} active ${off}`);
      await put(100, { instructions: "B" });
      await set({ "bom.oneActivePerItem": true });
      const a1 = await put(100, { instructions: "A" });
      const on = await activeOf601();
      check("oneActivePerItem ON: activating a BOM makes the item's other active BOM inactive (kept)", a1.status === 200 && on.length === 1 && on[0] === c.body.id && !!(await prisma.bomMaster.findUnique({ where: { id: bom601.id } })), `${a1.status} active ${on}`);
      // give the real BOM its Active status back through the API (this makes the test BOM inactive)
      const back = await admin("PUT", `/api/manufacturing/bom/${bom601.id}`, { finished_id: 601, instructions: "A", bomDetails: mats.map((m) => ({ material_id: m.id, material_percentage: m.percentage })) });
      const restored = await activeOf601();
      check("oneActivePerItem ON: the original BOM re-activated, the test one now inactive", back.status === 200 && restored.length === 1 && restored[0] === bom601.id, `${back.status} ${back.body?.error || ""} active ${restored}`);
      await set({ "bom.oneActivePerItem": false });
    } finally {
      for (const id of testBoms) await admin("DELETE", `/api/manufacturing/bom/${id}`);
    }
  }
  return plans;
}
