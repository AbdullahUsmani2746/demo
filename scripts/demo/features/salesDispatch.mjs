// scripts/demo/features/salesDispatch.mjs — Settings → Features checks for Sale Order
// and Dispatch, run from scripts/demo/test-features.mjs (which owns login, set() and
// the final reset). Each feature is saved on and off and both behaviours are proved
// through the API:
//   saleOrder.duplicateItems · saleOrder.litreUnits · saleOrder.priceListOnly ·
//   saleOrder.focTrialWarning · saleOrder.creditLimit · saleOrder.overdueCheck ·
//   dispatch.withoutSaleOrder · dispatch.overDispatchTolerance · dispatch.packingConsumption ·
//   dispatch.batchRequired · dispatch.extraFields · orders.trialLineBilling
export async function runSalesDispatch({ admin, viewer, set, vr, check, prisma }) {
  const DAY = "2026-11-14";
  const seed = Math.floor(Date.now() / 1000) % 1000; // vary quantities: the save route refuses identical documents
  const q = (n) => n + (seed % 97) / 100;
  const so = (party, lines, extra = {}) => ({
    master: {
      party_code: { value: party, label: String(party) }, godown: 3, dated: DAY, due_date: "2026-11-30",
      region: "NORTH", delivery_terms: "EX-FACTORY", payment_terms: "CREDIT", ...extra,
    },
    lines: lines.map((l) => ({
      unit: "KG", st_rate: 18, ...l,
      amount: l.amount ?? Math.round((l.unit === "LTR" ? l.qty_ltr : l.qty) * (l.rate ?? 0) * 100) / 100,
    })),
  });
  const postSO = (body, who = admin) => who("POST", "/api/orders/saleOrder", body);
  const dispatch = async (master, lines) =>
    admin("POST", "/api/voucher/dispatch", {
      master: { tran_code: 6, vr_no: await vr(6), dated: DAY, godown: 3, rmk: "feature test", ...master },
      lines: lines.map((l) => ({ unit: "KG", godown: 3, ...l })),
    });
  const order = (no) => prisma.orderMaster.findUnique({ where: { order_no: Number(no) }, include: { orderDetails: { orderBy: { id: "asc" } } } });
  const msg = (r) => `${r.status} ${r.body?.message || r.body?.error || ""}`.slice(0, 160);
  const approvedSO = async (party, lines) => {
    const r = await postSO(so(party, lines));
    return r.body?.order_no;
  };

  // ── saleOrder.duplicateItems ─────────────────────────────────────────────
  {
    const body = () => so(2001, [{ itcd: 601, qty: q(10), rate: 500 }, { itcd: 601, qty: q(5), rate: 500 }]);
    await set({ "saleOrder.duplicateItems": "refused" });
    const r1 = await postSO(body());
    check("duplicateItems REFUSED: the same item twice refused", r1.status === 422 && /one line only/i.test(r1.body?.message || ""), msg(r1));
    await set({ "saleOrder.duplicateItems": "allowed" });
    const r2 = await postSO(body());
    check("duplicateItems ALLOWED: the same item twice saved (SMS)", r2.status === 201, msg(r2));
  }

  // ── saleOrder.litreUnits (SO + dispatch) ─────────────────────────────────
  {
    const item = await prisma.item.findFirst({ where: { itcd: { in: [601, 602, 603, 604, 605] }, ltr_rate: { gt: 0 } }, select: { itcd: true, ltr_rate: true } });
    const itcd = item?.itcd ?? 602;
    const body = () => so(2002, [{ itcd, unit: "LTR", qty_ltr: q(10), qty: null, rate: 400 }]);
    await set({ "saleOrder.litreUnits": false });
    const r1 = await postSO(body());
    check("litreUnits OFF: a new LTR Sale Order line refused", r1.status === 422 && /litres is switched off/i.test(r1.body?.message || ""), msg(r1));
    const d1 = await dispatch({ pycd: 2002 }, [{ itcd, unit: "LTR", no_of_pack: 1, qty_per_pack: 5, qty_ltr: 5, qty: 5 * (item?.ltr_rate || 1) }]);
    check("litreUnits OFF: a direct LTR dispatch line refused", d1.status === 422 && /Litres are switched off/i.test(d1.body?.message || ""), msg(d1));
    await set({ "saleOrder.litreUnits": true });
    const r2 = await postSO(body());
    const saved = r2.body?.order_no ? (await order(r2.body.order_no)).orderDetails[0] : null;
    check("litreUnits ON: a LTR Sale Order line saved in LTR", r2.status === 201 && saved?.unit === "LTR", `${msg(r2)} unit ${saved?.unit}`);
    // switched off again: the saved LTR order may still be edited in LTR
    await set({ "saleOrder.litreUnits": false });
    const o = r2.body?.order_no ? await order(r2.body.order_no) : null;
    const put = o
      ? await admin("PUT", "/api/orders/saleOrder", { ...so(2002, [{ itcd, unit: "LTR", qty_ltr: q(12), qty: null, rate: 400 }]), master: { ...so(2002, []).master, order_no: o.order_no } })
      : { status: 0 };
    check("litreUnits OFF again: a saved LTR line stays LTR on edit", put.status === 200, msg(put));
    await set({ "saleOrder.litreUnits": true });
  }

  // ── saleOrder.priceListOnly ──────────────────────────────────────────────
  {
    const PARTY = 2003;
    const add = await admin("POST", "/api/forms/sales-items", { acno: PARTY, itcd: 603, rate: 650, gst_rate: 18 });
    const row = add.body?.id ? add.body : await prisma.sALES_ITEM_CUST.findFirst({ where: { acno: PARTY, itcd: 603 } });
    await set({ "saleOrder.priceListOnly": true });
    const r1 = await postSO(so(PARTY, [{ itcd: 604, qty: q(10), rate: 500 }]));
    check("priceListOnly ON: an item not on the customer's price list refused", r1.status === 422 && /price list/i.test(r1.body?.message || ""), msg(r1));
    const r2 = await postSO(so(PARTY, [{ itcd: 603, qty: q(10), rate: 650 }]));
    check("priceListOnly ON: a price-list item saved", r2.status === 201, msg(r2));
    const tick = await admin("PATCH", "/api/forms/sales-items", { id: row?.id, checked: false });
    const r3 = await postSO(so(PARTY, [{ itcd: 603, qty: q(11), rate: 650 }]));
    const list = await admin("GET", `/api/forms/products?customer=${PARTY}`);
    const offered = JSON.stringify(list.body || {}).includes('"itcd":603');
    check("priceListOnly ON: an unticked item is refused and not offered", tick.status === 200 && r3.status === 422 && !offered, `tick ${tick.status}, save ${msg(r3)}, offered ${offered}`);
    await set({ "saleOrder.priceListOnly": false });
    const r4 = await postSO(so(PARTY, [{ itcd: 604, qty: q(12), rate: 500 }]));
    const tickOff = await admin("PATCH", "/api/forms/sales-items", { id: row?.id, checked: true });
    check("priceListOnly OFF: any item saved; ticking refused", r4.status === 201 && tickOff.status === 403, `${msg(r4)} / tick ${tickOff.status}`);
    if (row?.id) await admin("DELETE", "/api/forms/sales-items", { id: row.id }); // leave the demo price lists as they were
  }

  // ── saleOrder.focTrialWarning ────────────────────────────────────────────
  {
    const PARTY = 2006;
    const ITEM = 605;
    await set({ "saleOrder.focTrialWarning": false });
    const first = await postSO(so(PARTY, [{ itcd: ITEM, qty: q(3), rate: 0 }], { freeOfCost: true }));
    const again = await postSO(so(PARTY, [{ itcd: ITEM, qty: q(4), rate: 0 }], { freeOfCost: true }));
    check("focTrialWarning OFF: a second Free of Cost of the same item saved", first.status === 201 && again.status === 201, `${msg(first)} / ${msg(again)}`);
    const off = await admin("GET", `/api/orders/saleOrder/foc-trial-check?party_code=${PARTY}&itcd=${ITEM}`);
    await set({ "saleOrder.focTrialWarning": true });
    const on = await admin("GET", `/api/orders/saleOrder/foc-trial-check?party_code=${PARTY}&itcd=${ITEM}`);
    check("focTrialWarning: the check API answers only while on", off.body?.message === null && /already received/i.test(on.body?.message || ""), `${off.body?.message} / ${on.body?.message?.slice(0, 80)}`);
    const third = await postSO(so(PARTY, [{ itcd: ITEM, qty: q(5), rate: 0 }], { freeOfCost: true }));
    check("focTrialWarning ON: a third Free of Cost of the same item refused", third.status === 422 && /already received/i.test(third.body?.message || ""), msg(third));
    const normal = await postSO(so(PARTY, [{ itcd: ITEM, qty: q(6), rate: 900 }]));
    check("focTrialWarning ON: a Normal order of that item still saved", normal.status === 201, msg(normal));
    await set({ "saleOrder.focTrialWarning": false });
  }

  // ── saleOrder.creditLimit / saleOrder.overdueCheck ───────────────────────
  {
    const positions = [];
    for (let acno = 2001; acno <= 2012; acno++) {
      const p = (await admin("GET", `/api/accounts/position?acno=${acno}`)).body;
      positions.push({ acno, overdue: Number(p?.position?.overdue) || 0, creditLeft: p?.position?.creditLeft ?? null });
    }
    // a customer still under their limit (several demo customers are already over it)
    const roomy = positions.find((p) => Number(p.creditLeft) > 100)?.acno;
    const late = positions.find((p) => p.overdue > 1)?.acno;
    const big = [{ itcd: 601, qty: q(20000), rate: 1000 }]; // far over any demo credit limit
    await set({ "saleOrder.creditLimit": "off", "saleOrder.overdueCheck": "off" });
    const r0 = await postSO(so(2009, big), viewer);
    check("creditLimit OFF: an order over the limit is saved without a reason", r0.status === 201 && !(r0.body?.approvalReasons || []).includes("Credit limit exceeded") && !(r0.body?.warnings || []).length, msg(r0));
    await set({ "saleOrder.creditLimit": "warn" });
    const r1 = await postSO(so(2009, big), viewer);
    check("creditLimit WARN: saved, with a credit warning", r1.status === 201 && (r1.body?.warnings || []).some((w) => /Credit limit exceeded/.test(w)) && !(r1.body?.approvalReasons || []).includes("Credit limit exceeded"), `${msg(r1)} ${JSON.stringify(r1.body?.warnings)}`);
    await set({ "saleOrder.creditLimit": "hold" });
    const r2 = await postSO(so(2009, big), viewer);
    const held = r2.body?.order_no ? await order(r2.body.order_no) : null;
    check("creditLimit HOLD: waiting for approval with reason \"Credit limit exceeded\"", r2.status === 201 && held?.status === 3 && /Credit limit exceeded/.test(held?.approval_reasons || ""), `${msg(r2)} status ${held?.status} reasons ${held?.approval_reasons}`);
    const small = roomy ? await postSO(so(roomy, [{ itcd: 601, qty: 1, rate: 1 }]), viewer) : { status: 0 };
    const smallO = small.body?.order_no ? await order(small.body.order_no) : null;
    check("creditLimit HOLD: an order within the limit is not held for it", small.status === 201 && !/Credit limit exceeded/.test(smallO?.approval_reasons || ""), `customer ${roomy}: ${msg(small)} ${smallO?.approval_reasons}`);
    const inbox = await admin("GET", "/api/approvals/requests?box=inbox");
    const inInbox = JSON.stringify(inbox.body || {}).includes(`so-${r2.body?.order_no}`);
    check("creditLimit HOLD: the order is in the Approvals inbox", inInbox, `inbox ${inbox.status}`);
    await set({ "saleOrder.creditLimit": "off" });
    if (late) {
      const lines = [{ itcd: 601, qty: q(1), rate: 10 }];
      const o0 = await postSO(so(late, lines), viewer);
      await set({ "saleOrder.overdueCheck": "warn" });
      const o1 = await postSO(so(late, [{ itcd: 601, qty: q(2), rate: 10 }]), viewer);
      await set({ "saleOrder.overdueCheck": "hold" });
      const o2 = await postSO(so(late, [{ itcd: 601, qty: q(3), rate: 10 }]), viewer);
      const h2 = o2.body?.order_no ? await order(o2.body.order_no) : null;
      check(
        "overdueCheck: off saves, warn warns, hold holds (\"Overdue invoices\")",
        o0.status === 201 && !(o0.body?.warnings || []).length &&
          o1.status === 201 && (o1.body?.warnings || []).some((w) => /overdue/i.test(w)) &&
          h2?.status === 3 && /Overdue invoices/.test(h2?.approval_reasons || ""),
        `customer ${late}: ${o0.status}/${o1.status}/${o2.status} reasons ${h2?.approval_reasons}`,
      );
    } else {
      check("overdueCheck: a demo customer with overdue invoices", false, JSON.stringify(positions));
    }
    await set({ "saleOrder.overdueCheck": "off" });
  }

  // ── dispatch.withoutSaleOrder ────────────────────────────────────────────
  {
    await set({ "dispatch.withoutSaleOrder": "refused" });
    const d1 = await dispatch({ pycd: 2004 }, [{ itcd: 601, qty: q(1) }]);
    check("withoutSaleOrder REFUSED: a dispatch without a Sale Order refused", d1.status === 422 && /Sale Order/i.test(d1.body?.message || ""), msg(d1));
    const no = await approvedSO(2004, [{ itcd: 601, qty: 50, rate: 500 }]);
    const d2 = await dispatch({ pycd: 2004, so_no: no }, [{ itcd: 601, qty: q(1) }]);
    check("withoutSaleOrder REFUSED: a dispatch against a Sale Order saved", d2.status === 201, msg(d2));
    await set({ "dispatch.withoutSaleOrder": "allowed" });
    const d3 = await dispatch({ pycd: 2004 }, [{ itcd: 601, qty: q(1.5) }]);
    check("withoutSaleOrder ALLOWED: a dispatch without a Sale Order saved (SMS)", d3.status === 201, msg(d3));
  }

  // ── dispatch.overDispatchTolerance ───────────────────────────────────────
  {
    const no = await approvedSO(2005, [{ itcd: 601, qty: 10, rate: 500 }]);
    await set({ "dispatch.overDispatchTolerance": "0" });
    const d1 = await dispatch({ pycd: 2005, so_no: no }, [{ itcd: 601, qty: 10.5 }]);
    check("overDispatchTolerance 0 %: 10.5 KG on a 10 KG order refused", d1.status === 422 && /0 % allowed/.test(d1.body?.message || ""), msg(d1));
    await set({ "dispatch.overDispatchTolerance": "10" });
    const d2 = await dispatch({ pycd: 2005, so_no: no }, [{ itcd: 601, qty: 10.5 }]);
    const line = await prisma.orderDetail.findFirst({ where: { order_no: Number(no) } });
    check("overDispatchTolerance 10 % (SMS): 10.5 KG saved and the line counts as dispatched", d2.status === 201 && line?.status === 2, `${msg(d2)} line status ${line?.status}`);
    const d3 = await dispatch({ pycd: 2005, so_no: no }, [{ itcd: 601, qty: 1 }]);
    check("overDispatchTolerance 10 %: going past 11 KG refused", d3.status === 422, msg(d3));
  }

  // ── dispatch.packingConsumption ──────────────────────────────────────────
  {
    const line = (n) => ({ itcd: 601, qty: q(n), packing_material_code: 502, no_of_pack: 1, qty_per_pack: q(n) });
    const auto = (id) => prisma.transactionsMaster.count({ where: { tran_code: 7, rmk1: "AUTO_PACKING", rmk4: String(id) } });
    await set({ "dispatch.packingConsumption": false });
    const d1 = await dispatch({ pycd: 2007 }, [line(2)]);
    const a1 = d1.body?.voucherId ? await auto(d1.body.voucherId) : -1;
    check("packingConsumption OFF: dispatch saved, no automatic packing issue", d1.status === 201 && a1 === 0, `${msg(d1)} auto ${a1}`);
    await set({ "dispatch.packingConsumption": true });
    const d2 = await dispatch({ pycd: 2007 }, [line(3)]);
    const a2 = d2.body?.voucherId ? await auto(d2.body.voucherId) : -1;
    check("packingConsumption ON: dispatch saved with its automatic packing issue (SMS)", d2.status === 201 && a2 === 1, `${msg(d2)} auto ${a2}`);
    // off again: the dispatch that has one keeps it in step on edit
    await set({ "dispatch.packingConsumption": false });
    const e2 = d2.body?.voucherId
      ? await admin("PUT", "/api/voucher/dispatchEdit", {
          master: { tran_id: d2.body.voucherId, tran_code: 6, dated: DAY, pycd: 2007, godown: 3, rmk: "feature test (edited)" },
          lines: [{ ...line(4), unit: "KG", godown: 3 }],
        })
      : { status: 0 };
    const kept = d2.body?.voucherId ? await prisma.transactions.findFirst({ where: { transactionsMaster: { tran_code: 7, rmk1: "AUTO_PACKING", rmk4: String(d2.body.voucherId) }, itcd: 502 } }) : null;
    check("packingConsumption OFF again: an edit keeps the existing packing issue", e2.status === 200 && kept?.qty === 1, `${msg(e2)} packing qty ${kept?.qty}`);
    await set({ "dispatch.packingConsumption": true });
  }

  // ── dispatch.batchRequired ───────────────────────────────────────────────
  {
    await set({ "dispatch.batchRequired": true });
    const d1 = await dispatch({ pycd: 2008 }, [{ itcd: 601, qty: q(1) }]);
    check("batchRequired ON: a line without a Batch No refused", d1.status === 422 && /Batch No is required/i.test(d1.body?.message || ""), msg(d1));
    const d2 = await dispatch({ pycd: 2008 }, [{ itcd: 601, qty: q(1.2), batch_no: "FT-B1" }]);
    check("batchRequired ON: a line with a Batch No saved", d2.status === 201, msg(d2));
    await set({ "dispatch.batchRequired": false });
    const d3 = await dispatch({ pycd: 2008 }, [{ itcd: 601, qty: q(1.4) }]);
    check("batchRequired OFF: a line without a Batch No saved (SMS)", d3.status === 201, msg(d3));
  }

  // ── dispatch.extraFields ─────────────────────────────────────────────────
  {
    const extra = { manual_no: "DC-FT-1", city: "LAHORE", route: "GT ROAD" };
    const stored = (id) => prisma.transactionsMaster.findUnique({ where: { tran_id: id }, select: { manual_no: true, city: true, route: true } });
    await set({ "dispatch.extraFields": false });
    const d1 = await dispatch({ pycd: 2010, ...extra }, [{ itcd: 601, qty: q(1.1) }]);
    const s1 = d1.body?.voucherId ? await stored(d1.body.voucherId) : null;
    check("extraFields OFF: Manual DC No / City / Route not written", d1.status === 201 && s1 && !s1.manual_no && !s1.city && !s1.route, `${msg(d1)} ${JSON.stringify(s1)}`);
    await set({ "dispatch.extraFields": true });
    const d2 = await dispatch({ pycd: 2010, ...extra }, [{ itcd: 601, qty: q(1.3) }]);
    const s2 = d2.body?.voucherId ? await stored(d2.body.voucherId) : null;
    check("extraFields ON: Manual DC No / City / Route saved (SMS)", d2.status === 201 && s2?.manual_no === "DC-FT-1" && s2?.city === "LAHORE" && s2?.route === "GT ROAD", `${msg(d2)} ${JSON.stringify(s2)}`);
    await set({ "dispatch.extraFields": false });
    const e2 = d2.body?.voucherId
      ? await admin("PUT", "/api/voucher/dispatchEdit", {
          master: { tran_id: d2.body.voucherId, tran_code: 6, dated: DAY, pycd: 2010, godown: 3, city: "KARACHI", manual_no: "X", route: "Y", rmk: "feature test (edited)" },
          lines: [{ itcd: 601, qty: q(1.3), unit: "KG", godown: 3 }],
        })
      : { status: 0 };
    const s3 = d2.body?.voucherId ? await stored(d2.body.voucherId) : null;
    check("extraFields OFF again: an edit keeps the stored values", e2.status === 200 && s3?.city === "LAHORE" && s3?.manual_no === "DC-FT-1", `${msg(e2)} ${JSON.stringify(s3)}`);
    await set({ "dispatch.extraFields": true });
  }

  // ── orders.trialLineBilling ──────────────────────────────────────────────
  {
    const PARTY = 2011;
    await set({ "orders.trialLineBilling": true });
    const dup = await postSO(so(PARTY, [{ itcd: 601, qty: q(5), rate: 500 }, { itcd: 601, qty: q(2), rate: 500, line_type: "TRIAL" }]));
    check("trialLineBilling ON: an item twice on an order with a Trial line refused", dup.status === 422 && /same item twice/i.test(dup.body?.message || ""), msg(dup));
    const made = await postSO(so(PARTY, [{ itcd: 601, qty: 20, rate: 500, line_type: "NORMAL" }, { itcd: 603, qty: 10, rate: 650, line_type: "TRIAL" }]));
    const o = made.body?.order_no ? await order(made.body.order_no) : null;
    const tl = o?.orderDetails.find((d) => d.itcd === 603);
    const nl = o?.orderDetails.find((d) => d.itcd === 601);
    check("trialLineBilling ON: Sale Order lines typed — Trial at rate 0, Normal priced, order not Free of Cost",
      made.status === 201 && tl?.line_type === "TRIAL" && tl?.rate === 0 && nl?.line_type === "NORMAL" && nl?.rate === 500 && o?.trialProcess === true && o?.freeOfCost === false,
      `${msg(made)} trial ${tl?.line_type}/${tl?.rate} normal ${nl?.line_type}/${nl?.rate} trialProcess ${o?.trialProcess} foc ${o?.freeOfCost} status ${o?.status}`);
    const d = await dispatch({ pycd: PARTY, so_no: o?.order_no }, [{ itcd: 601, qty: 5, line_type: "TRIAL" }, { itcd: 603, qty: 4 }]);
    const dl = d.body?.voucherId ? await prisma.transactions.findMany({ where: { tran_id: d.body.voucherId, sub_tran_id: 1 }, orderBy: { id: "asc" } }) : [];
    check("trialLineBilling ON: dispatch lines stamped from the Sale Order (client value ignored)",
      d.status === 201 && dl.find((t) => t.itcd === 603)?.line_type === "TRIAL" && dl.find((t) => t.itcd === 601)?.line_type == null,
      `${msg(d)} ${dl.map((t) => `${t.itcd}:${t.line_type}`).join(",")}`);
    const row = async (id) =>
      ((await admin("GET", `/api/invoicing/sale?status=all&search=${id}&limit=50`)).body?.data || []).find((r) => r.tran_id === id);
    const r = d.body?.voucherId ? await row(d.body.voucherId) : null;
    const rl = r?.lines?.find((l) => l.itcd === 603);
    check("trialLineBilling: Sale Invoicing prices the trial line 0 (no rate asked)", rl?.rate === 0 && rl?.rate_source === "trial" && !r.issues.some((i) => i.type === "NO_RATE"), JSON.stringify(rl)?.slice(0, 140));
    const gen = await admin("POST", "/api/invoicing/sale/generate", { invoices: [{ tran_id: d.body?.voucherId, lines: dl.map((t) => ({ line_id: t.id, rate: t.itcd === 603 ? 999 : 500, st_rate: 18 })) }] });
    const after = d.body?.voucherId ? await prisma.transactions.findFirst({ where: { tran_id: d.body.voucherId, itcd: 603, sub_tran_id: 1 } }) : null;
    check("trialLineBilling: invoiced — the trial line stays at 0 whatever is sent", gen.body?.results?.[0]?.status === "invoiced" && after?.rate === 0 && after?.camt === 0, `${JSON.stringify(gen.body?.results?.[0])?.slice(0, 100)} rate ${after?.rate}`);
    const items0 = await admin("GET", "/api/invoicing/sale/trial-items");
    const w = (items0.body?.data || []).find((x) => x.tran_id === d.body?.voucherId && x.itcd === 603);
    check("trialLineBilling: Approved trial items lists it, not approved yet", items0.status === 200 && w && w.approved === false && w.left_kg === 4, JSON.stringify(w)?.slice(0, 120));
    // the client approves: the Sale Order line → Normal with its rate
    const put = await admin("PUT", "/api/orders/saleOrder", {
      ...so(PARTY, [{ itcd: 601, qty: 20, rate: 500, line_type: "NORMAL" }, { itcd: 603, qty: 10, rate: 650, line_type: "NORMAL" }]),
      master: { ...so(PARTY, []).master, order_no: o?.order_no },
    });
    check("trialLineBilling: the Sale Order edit names the approved, dispatched item", put.status === 200 && (put.body?.trialApproved || []).some((x) => x.itcd === 603), `${msg(put)}`);
    const bill = await admin("POST", "/api/invoicing/sale/trial-items", { tran_id: d.body?.voucherId });
    const part = bill.body?.billingTranId ? await prisma.transactionsMaster.findUnique({ where: { tran_id: bill.body.billingTranId }, include: { transactions: true } }) : null;
    const trialDispatch = d.body?.voucherId ? await prisma.transactionsMaster.findUnique({ where: { tran_id: d.body.voucherId } }) : null;
    const returns = await prisma.transactionsMaster.count({ where: { tran_code: 10, so_no: o?.order_no ?? -1 } });
    check("trialLineBilling: Bill moves the item into dispatch part -2 (same number and date, no Sale Return)",
      bill.status === 201 && part?.dispatch_part === 2 && part?.dispatch_no === trialDispatch?.dispatch_no && +part?.dated === +trialDispatch?.dated &&
        part.transactions.length === 1 && part.transactions[0].itcd === 603 && part.transactions[0].qty === 4 && returns === 0,
      `${msg(bill)} part ${part?.dispatch_no}-${part?.dispatch_part} lines ${part?.transactions?.length} returns ${returns}`);
    const pr = part ? await row(part.tran_id) : null;
    check("trialLineBilling: the part is on Sale Invoicing as 'N-2', priced from the Sale Order", pr?.doc_no === `${part?.dispatch_no}-2` && pr?.lines?.[0]?.rate === 650 && pr?.lines?.[0]?.rate_source === "order", `${pr?.doc_no} rate ${pr?.lines?.[0]?.rate} ${pr?.lines?.[0]?.rate_source}`);
    const edit = part ? await admin("DELETE", "/api/voucher/dispatchEdit", { tran_id: part.tran_id }) : { status: 0 };
    const editTrial = d.body?.voucherId ? await admin("DELETE", "/api/voucher/dispatchEdit", { tran_id: d.body.voucherId }) : { status: 0 };
    check("trialLineBilling: the part and the trial dispatch cannot be deleted by hand", edit.status === 422 && /bills approved trial items/.test(edit.body?.message || "") && editTrial.status === 422, `${msg(edit)} / ${msg(editTrial)}`);
    // an all-trial dispatch is not invoiced
    const allTrial = await postSO(so(PARTY, [{ itcd: 602, qty: 10, rate: 0, line_type: "TRIAL" }]));
    const d2 = await dispatch({ pycd: PARTY, so_no: allTrial.body?.order_no }, [{ itcd: 602, qty: 2 }]);
    const d2l = d2.body?.voucherId ? await prisma.transactions.findMany({ where: { tran_id: d2.body.voucherId, sub_tran_id: 1 } }) : [];
    const gen2 = await admin("POST", "/api/invoicing/sale/generate", { invoices: [{ tran_id: d2.body?.voucherId, lines: d2l.map((t) => ({ line_id: t.id, rate: 100, st_rate: 18 })) }] });
    check("trialLineBilling: an all-trial dispatch is not invoiced", d2.status === 201 && gen2.body?.results?.[0]?.status === "blocked" && /Trial/.test(gen2.body?.results?.[0]?.message || ""), `${msg(d2)} ${JSON.stringify(gen2.body?.results?.[0])?.slice(0, 120)}`);

    await set({ "orders.trialLineBilling": false });
    const g = await admin("GET", "/api/invoicing/sale/trial-items");
    const p = await admin("POST", "/api/invoicing/sale/trial-items", { tran_id: d2.body?.voucherId });
    check("trialLineBilling OFF: Approved trial items off (GET empty, Bill refused)", g.body?.enabled === false && (g.body?.data || []).length === 0 && p.status === 403, `${g.status} ${g.body?.enabled} / ${p.status}`);
    const offSO = await postSO(so(PARTY, [{ itcd: 604, qty: q(5), rate: 300, line_type: "TRIAL" }]));
    const offLine = offSO.body?.order_no ? (await order(offSO.body.order_no)).orderDetails[0] : null;
    check("trialLineBilling OFF: line types ignored — the line is Normal and keeps its rate (SMS)", offSO.status === 201 && offLine?.line_type === "NORMAL" && offLine?.rate === 300, `${msg(offSO)} ${offLine?.line_type}/${offLine?.rate}`);
    const still = d2.body?.voucherId ? await row(d2.body.voucherId) : null;
    check("trialLineBilling OFF: a dispatch sent on trial keeps pricing 0 (saved data kept)", still?.lines?.[0]?.rate === 0 && still?.issues?.some((i) => i.type === "ALL_TRIAL"), JSON.stringify(still?.issues)?.slice(0, 120));
  }
}
