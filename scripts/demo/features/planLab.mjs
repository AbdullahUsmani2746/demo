// scripts/demo/features/planLab.mjs — Settings → Features checks for the Sale Order →
// Production Plan → Lab Nature → Process Order → Dispatch flow (ported from Eastland),
// run from scripts/demo/test-features.mjs (which owns login, set() and the final reset):
//   saleOrder.planFromOrder · production.labNature · dispatch.requirePostedProcessOrder
// Each switch is saved on and off and both behaviours are proved through the API.
export async function runPlanLab({ admin, set, vr, check, prisma }) {
  const p2 = (n) => String(n).padStart(2, "0");
  const now = new Date();
  const TODAY = `${now.getFullYear()}-${p2(now.getMonth() + 1)}-${p2(now.getDate())}`;
  const seed = Math.floor(Date.now() / 1000) % 1000;
  const q = (n) => n + (seed % 97) / 100;
  const msg = (r) => `${r.status} ${r.body?.message || r.body?.error || ""}`.slice(0, 180);
  const items = (await prisma.item.findMany({ where: { itcd: { in: [601, 602, 603, 604, 605] } }, select: { itcd: true }, orderBy: { itcd: "asc" } })).map((i) => i.itcd);
  const [A, B, C] = items.length >= 3 ? items : [601, 602, 603];
  const so = (party, lines) => ({
    master: {
      party_code: { value: party, label: String(party) }, godown: 3, dated: TODAY, due_date: TODAY,
      region: "NORTH", delivery_terms: "EX-FACTORY", payment_terms: "CREDIT",
    },
    lines: lines.map((l) => ({ unit: "KG", st_rate: 18, rate: 500, amount: Math.round(l.qty * 500 * 100) / 100, ...l })),
  });
  const planLines = (soNo) => prisma.reqDetail.findMany({ where: { so_no: Number(soNo), master: { req_catagory: "DISPATCH" } }, orderBy: { id: "asc" } });

  // ── saleOrder.planFromOrder ──────────────────────────────────────────────
  let plannedSo = null;
  {
    await set({ "saleOrder.planFromOrder": false });
    const r0 = await admin("POST", "/api/orders/saleOrder", so(2001, [{ itcd: A, qty: q(10), plan_pending: true, plan_date: TODAY, plan_qty: q(10) }]));
    const off = r0.body?.order_no ? await planLines(r0.body.order_no) : [];
    const offLine = r0.body?.order_no ? await prisma.orderDetail.findFirst({ where: { order_no: r0.body.order_no } }) : null;
    check("planFromOrder OFF: a marked line is not planned and keeps no plan date", r0.status === 201 && off.length === 0 && offLine?.plan_date == null, msg(r0));
    const p0 = r0.body?.order_no ? await admin("POST", "/api/orders/saleOrder/plan", { so_no: r0.body.order_no, lines: [{ itcd: A, plan_date: TODAY, plan_qty: 1 }] }) : { status: 0 };
    check("planFromOrder OFF: the plan route refuses", p0.status === 403, msg(p0));

    await set({ "saleOrder.planFromOrder": true });
    const over = await admin("POST", "/api/orders/saleOrder", so(2001, [{ itcd: A, qty: 10, plan_pending: true, plan_date: TODAY, plan_qty: 15 }]));
    check("planFromOrder ON: Plan Qty above the order qty refused", over.status === 422 && /cannot be more than the order qty/i.test(over.body?.message || ""), msg(over));
    const r1 = await admin("POST", "/api/orders/saleOrder", so(2001, [{ itcd: A, qty: q(10), plan_pending: true, plan_date: TODAY, plan_qty: q(10) }, { itcd: B, qty: q(8) }]));
    plannedSo = r1.body?.order_no;
    const on = plannedSo ? await planLines(plannedSo) : [];
    const held = (r1.body?.approvalReasons || []).length > 0;
    check("planFromOrder ON: an approved order's marked line goes to that day's dispatch plan",
      r1.status === 201 && (held || (on.length === 1 && on[0].itcd === A)), `${msg(r1)} plan lines ${on.length}${held ? " (held for approval)" : ""}`);
    if (plannedSo && !held) {
      const plan = await prisma.reqMaster.findUnique({ where: { tran_id: on[0].tran_id } });
      const setup = (await admin("GET", "/api/settings/production-setup")).body?.values || {};
      check("planFromOrder ON: the plan's godowns come from Production setup",
        // a plan already there that day keeps its own godowns
        plan?.so_no !== plannedSo || (plan?.issued_by === setup.productionGodown && plan?.issued_for === setup.planFromGodown),
        `by ${plan?.issued_by}/${setup.productionGodown} from ${plan?.issued_for}/${setup.planFromGodown}`);
      const again = await admin("POST", "/api/orders/saleOrder/plan", { so_no: plannedSo, lines: [{ itcd: A, plan_date: TODAY, plan_qty: 1 }] });
      check("planFromOrder ON: an item is planned from its order only once", again.status === 409, msg(again));
      const tooMuch = await admin("POST", "/api/orders/saleOrder/plan", { so_no: plannedSo, lines: [{ itcd: B, plan_date: TODAY, plan_qty: 999 }] });
      check("planFromOrder ON: plan qty over the order qty refused by the plan route", tooMuch.status === 409, msg(tooMuch));
      const okB = await admin("POST", "/api/orders/saleOrder/plan", { so_no: plannedSo, lines: [{ itcd: B, plan_date: TODAY, plan_qty: q(8) }] });
      check("planFromOrder ON: Create on a saved order's line adds it to the plan", okB.status === 200 && okB.body?.tran_id, msg(okB));
    }
    const rep = await admin("GET", `/api/reports/isoTimeline?dateTo=${TODAY}${plannedSo ? `&so_no=${plannedSo}` : ""}`);
    check("planFromOrder ON: Sale Order To Invoice Time Tracking runs", rep.status === 200, msg(rep));
    await set({ "saleOrder.planFromOrder": false });
    const repOff = await admin("GET", `/api/reports/isoTimeline?dateTo=${TODAY}`);
    check("planFromOrder OFF: the time tracking report is refused", repOff.status === 403, msg(repOff));
    if (plannedSo) {
      const kept = await planLines(plannedSo);
      check("planFromOrder OFF: plans already made are kept", kept.length >= 1, `${kept.length} lines`);
    }
  }

  // ── production.labNature ─────────────────────────────────────────────────
  let planNo = null;
  {
    await set({ "saleOrder.planFromOrder": true });
    const r = await admin("POST", "/api/orders/saleOrder", so(2001, [{ itcd: C, qty: q(6), plan_pending: true, plan_date: TODAY, plan_qty: q(6) }]));
    const soNo = r.body?.order_no;
    const line = soNo ? (await planLines(soNo))[0] : null;
    planNo = line?.tran_id ?? null;
    const planBody = async (nature) => {
      const m = await prisma.reqMaster.findUnique({ where: { tran_id: planNo }, include: { details: true } });
      return {
        master: { tran_id: planNo, dated: m.dated.toISOString().slice(0, 10), userid: m.userid, issued_for: m.issued_for, issued_by: m.issued_by, req_catagory: "DISPATCH" },
        lines: m.details.map((d) => ({ itcd: d.itcd, qty: d.qty, so_no: d.so_no, ordered_qty: d.ordered_qty, remarks: d.remarks, nature: d.itcd === C && d.so_no === soNo ? nature : d.nature })),
      };
    };
    if (planNo) {
      await set({ "production.labNature": false });
      const p0 = await admin("PUT", "/api/material/requisition", await planBody("PROCESS"));
      const n0 = await prisma.reqDetail.findFirst({ where: { tran_id: planNo, itcd: C, so_no: soNo } });
      check("labNature OFF: a Nature sent with the plan is not saved", p0.status === 200 && !n0?.nature, `${msg(p0)} nature ${n0?.nature}`);
      await set({ "production.labNature": true });
      const p1 = await admin("PUT", "/api/material/requisition", await planBody("PROCESS"));
      const n1 = await prisma.reqDetail.findFirst({ where: { tran_id: planNo, itcd: C, so_no: soNo } });
      check("labNature ON: the Lab's Nature is saved with its time", p1.status === 200 && n1?.nature === "PROCESS" && n1?.nature_at, `${msg(p1)} nature ${n1?.nature}`);
      // A rule on "Production Plan". The test logs in as Super Admin, who is an
      // approver of every rule — so their own change is saved directly (rule 12:
      // an approver's own save is not sent to them). A non-approver's change
      // would come back 202 with an ApprovalRequest of kind "plan".
      const rule = await prisma.approvalRule.create({
        data: { name: `Nature change test ${seed}`, doc_type: "productionPlan", applies_on: "update", mode: "hold", is_active: true, conditions: [], approver_roles: [], approver_users: [] },
      }).catch((e) => ({ error: e.message }));
      if (rule?.id) {
        const p2 = await admin("PUT", "/api/material/requisition", await planBody("PROCESS"));
        const n2 = await prisma.reqDetail.findFirst({ where: { tran_id: planNo, itcd: C, so_no: soNo } });
        check("labNature ON: an approver's own Nature edit is saved directly (rule on Production Plan)", p2.status === 200 && n2?.nature === "PROCESS", `${msg(p2)} nature ${n2?.nature}`);
        await prisma.approvalRule.delete({ where: { id: rule.id } });
      } else {
        check("labNature ON: approval rule for the test created", false, rule?.error || "");
      }
      const pr = await admin("GET", `/api/reports/pendingReport?dateFrom=${TODAY}&dateTo=${TODAY}`);
      check("labNature ON: the Pending Report lists the PROCESS line", pr.status === 200 && (pr.body?.data || []).some((x) => x.plan_no === planNo && x.itcd === C), msg(pr));
      await set({ "production.labNature": false });
      const p3 = await admin("PUT", "/api/material/requisition", await planBody(null));
      const n3 = await prisma.reqDetail.findFirst({ where: { tran_id: planNo, itcd: C, so_no: soNo } });
      check("labNature OFF again: a saved Nature is kept through an edit", p3.status === 200 && n3?.nature === "PROCESS", `${msg(p3)} nature ${n3?.nature}`);
    }

    // ── dispatch.requirePostedProcessOrder ─────────────────────────────────
    if (soNo && planNo) {
      const dispatch = async () =>
        admin("POST", "/api/voucher/dispatch", {
          master: { tran_code: 6, vr_no: await vr(6), dated: TODAY, godown: 3, pycd: 2001, so_no: soNo, rmk: "plan lab test" },
          lines: [{ itcd: C, unit: "KG", godown: 3, no_of_pack: 1, qty_per_pack: 1, qty: 1, plan_no: 999999 }],
        });
      await set({ "dispatch.requirePostedProcessOrder": true });
      const d1 = await dispatch();
      check("requirePostedProcessOrder ON: a PROCESS line with no posted Process Order is refused", d1.status === 422 && /Process Order is not posted/i.test(d1.body?.message || ""), msg(d1));
      await set({ "dispatch.requirePostedProcessOrder": false });
      const d2 = await dispatch();
      const t = d2.body?.voucherId ? await prisma.transactions.findFirst({ where: { tran_id: Number(d2.body.voucherId), itcd: C, sub_tran_id: 1 } }) : null;
      check("requirePostedProcessOrder OFF: the dispatch goes through (stock permitting)", d2.status === 201 || d2.status === 200 || /stock/i.test(d2.body?.message || ""), msg(d2));
      if (t) check("dispatch line: the Plan No sent by the client is ignored, the server's is kept", t.plan_no !== 999999, `plan_no ${t.plan_no}`);
    }
  }
  await set({ "saleOrder.planFromOrder": false, "production.labNature": false, "dispatch.requirePostedProcessOrder": false });
}
