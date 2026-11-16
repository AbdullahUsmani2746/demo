// scripts/demo/moreDocuments.mjs — the rest of the demo documents, so no module
// screen is empty (called from scripts/demo/seed-documents.mjs). Everything goes
// through the app's own API, each step by the person whose job it is:
//   store.manager      quality standards per item, LC landed-cost issue
//   production.manager machine instructions, planned quantities, the Lab's Nature
//                      on Sale Order production plans, QC decisions
//   production         QC results on process orders, QA entry of receipts, FG transfer requisition
//   storekeeper        purchase requisitions, FG transfer acceptance
//   purchase(.manager) LCs, beneficiaries, in-bond, service orders / entries / invoices
//   accounts.manager   LC accounts, debit / credit notes, cheques in hand, knock-off,
//                      production costing and the month locks June – October
//   sales.manager      a sales loan;  hr.manager / employee  pending leaving + advance
//   sysadmin           ready-made BI dashboards assigned to the roles that use them
import { AC } from "./seed-masters.mjs";

// Quality standards per item (Item → Quality): [itcds, [[parameter, standard]...]]
export const QUALITY = [
  [[601, 602, 603, 604, 605], [["VISCOSITY (ZAHN #2, SEC)", "18-22"], ["SOLID CONTENT %", ">=35"], ["FINENESS OF GRIND (HEGMAN)", ">=7"], ["DRYING TIME (MIN)", "<=30"]]],
  [[701, 702, 703], [["VISCOSITY (FORD #4, SEC)", "60-90"], ["SOLID CONTENT %", ">=45"], ["DRYING TIME (MIN)", "<=45"], ["GLOSS 60°", "80-95"]]],
  [[801, 802, 803], [["VISCOSITY (KU)", "95-110"], ["SOLID CONTENT %", ">=50"], ["SPECIFIC GRAVITY", "1.35-1.45"], ["OPACITY %", ">=94"]]],
  [[101, 102, 103, 104, 105], [["SOLID CONTENT %", "48-72"], ["ACID VALUE", "<=10"]]],
  [[201, 202, 203, 204, 205], [["PURITY %", ">=99"], ["WATER CONTENT %", "<=0.1"]]],
  [[301, 302, 303, 304, 305, 306], [["PURITY %", ">=93"], ["MOISTURE %", "<=0.5"], ["OIL ABSORPTION", "15-45"]]],
];
const standardsOf = new Map(QUALITY.flatMap(([items, params]) => items.map((i) => [i, params])));

/** A result for a standard: in range, or (bad) just outside it. */
function resultFor(standard, rand, bad = false) {
  const r = (n, d = 2) => String(Math.round(n * 10 ** d) / 10 ** d);
  let m = standard.match(/^([\d.]+)-([\d.]+)$/);
  if (m) {
    const [a, b] = [Number(m[1]), Number(m[2])];
    return bad ? r(b + (b - a) * 0.25) : r(a + (b - a) * (0.25 + rand() * 0.5));
  }
  if ((m = standard.match(/^>=([\d.]+)$/))) return bad ? r(Number(m[1]) * 0.93) : r(Number(m[1]) * (1.01 + rand() * 0.05));
  if ((m = standard.match(/^<=([\d.]+)$/))) return bad ? r(Number(m[1]) * 1.3) : r(Number(m[1]) * (0.6 + rand() * 0.3));
  return "OK";
}

export function moreDocuments({ call, prisma, rand, log = console.log }) {
  const get = (u, p) => call(u, "GET", p);
  const post = (u, p, b) => call(u, "POST", p, b);
  const put = (u, p, b) => call(u, "PUT", p, b);
  const params = (itcd, bad = false) => (standardsOf.get(itcd) || []).map(([parameter_name, s], i) => ({ parameter_name, quality_realized: resultFor(s, rand, bad && i === 0) }));
  const voucherNo = async (u, tran_code) => (await get(u, `/api/voucher/next-vr-no?tran_code=${tran_code}`)).nextVrNo;
  const counts = {};
  const add = (k, n = 1) => (counts[k] = (counts[k] || 0) + n);

  /** Before the documents: item standards, machines, planned quantities, dashboards, setup. */
  async function setup() {
    for (const [items, list] of QUALITY) {
      for (const itcd of items) {
        await post("store.manager", `/api/forms/items/${itcd}/quality`, { qualityParameters: list.map(([parameter_name, quality_standard]) => ({ parameter_name, quality_standard })) });
        add("item quality standards", list.length);
      }
    }
    // Finished goods made on the production floor go to the FG store (Production setup).
    await put("sysadmin", "/api/settings/production-setup", { values: { fgTransferGodown: 3 } });

    // Lab: machines (fixed-asset items) and their operating instructions
    for (const [machine_id, descr, time_min, parts] of [
      [1201, "HIGH SPEED DISPERSER - PRE-MIX & LET DOWN", 45, [["Blade & shaft", 10, "Check the Cowles blade for wear; tip speed 18-22 m/s"], ["Vessel", 5, "Earth the vessel before charging solvent"], ["Speed", 30, "Low speed while charging pigment, then high speed 25 min"]]],
      [1202, "BEAD MILL 25 LTR - GRINDING", 90, [["Media", 15, "Zirconia beads 1.0 mm, 70% fill"], ["Cooling", 0, "Cooling water on before start; outlet below 45 °C"], ["Grind check", 15, "Hegman gauge every 30 min until 7+"]]],
    ]) {
      await post("production.manager", "/api/manufacturing/machine-instruction", {
        machine_id, descr, time_min, machineDetails: parts.map(([part, t, instructions]) => ({ machine_id, part, time_min: t, instructions })),
      });
      add("machine instructions");
    }

    // Planned quantities (monthly production budget per finished good)
    const DAILY = { 601: 180, 602: 160, 603: 110, 604: 100, 605: 140, 701: 80, 702: 70, 703: 90, 801: 260, 802: 180, 803: 120 };
    const entries = [];
    for (const [itcd, d] of Object.entries(DAILY)) {
      for (const month of [9, 10, 11, 12]) entries.push({ itcd: Number(itcd), period_type: "MONTHLY", month, year: 2026, qty: Math.round((d * 26 * (0.95 + rand() * 0.15)) / 50) * 50 });
      entries.push({ itcd: Number(itcd), period_type: "QUARTERLY", quarter: 4, year: 2026, qty: Math.round((d * 78) / 100) * 100 });
    }
    await put("production.manager", "/api/material/input-for-pp", { entries });
    add("planned quantities", entries.length);

    // BI: the ready-made dashboards for the people who use them (My Dashboards)
    const ASSIGN = {
      "CEO Dashboard": [{ role: "CEO", is_landing: true }, { role: "DIRECTOR" }, { role: "ADMIN" }],
      "Management Overview": ["CEO", "CFO", "COO", "DIRECTOR", "MANAGER", "ADMIN"].map((role) => ({ role })),
      "Sales Desk": [{ role: "SALES_MANAGER", is_landing: true }, { role: "SALES" }, { role: "MANAGER" }],
      "Finance & Accounts": [{ role: "CFO", is_landing: true }, { role: "ACCOUNTS_MANAGER", is_landing: true }, { role: "ACCOUNTANT" }],
      "Dispatch & Stores": [{ role: "STORE_MANAGER" }, { role: "COO" }],
      "Purchasing & Supply": [{ role: "PURCHASE_MANAGER" }, { role: "COO" }],
      Production: [{ role: "PRODUCTION_MANAGER" }, { role: "COO", is_landing: true }, { role: "MANAGER" }],
      "Sale Order Follow-up": [{ role: "SALES_MANAGER" }, { role: "MANAGER" }],
      "Imports Desk": [{ role: "PURCHASE_MANAGER" }, { role: "CFO" }],
    };
    const dashboards = await prisma.biDashboard.findMany({ select: { id: true, name: true } });
    for (const d of dashboards) {
      if (!ASSIGN[d.name]) continue;
      await put("sysadmin", `/api/bi/dashboards/${d.id}/assignments`, { assignments: ASSIGN[d.name] });
      add("dashboard assignments", ASSIGN[d.name].length);
    }
    log(`  setup: ${counts["item quality standards"]} standards, ${counts["machine instructions"]} machines, ${entries.length} planned qty rows, ${counts["dashboard assignments"] || 0} dashboard assignments`);
  }

  /** Production QC of a process order before it is sent (mostly passed, a few re-tested). */
  async function qcProcessOrder(planId, itcd, date, { retest = false } = {}) {
    const mfg = { mfg_date: date, expiry_date: `${Number(date.slice(0, 4)) + 1}${date.slice(4)}` };
    if (retest) {
      await post("production", `/api/forms/qualitycontrol/${planId}`, { ...mfg, parameters: params(itcd, true), remarks: "First check out of standard" });
      await post("production.manager", `/api/forms/qualitycontrol/${planId}`, { status: "REWORK", reason: "Viscosity out of range — adjust with solvent and re-test" });
      add("QC re-tested");
    }
    await post("production", `/api/forms/qualitycontrol/${planId}`, { ...mfg, parameters: params(itcd), remarks: retest ? "Re-test after adjustment" : "" });
    await post("production.manager", `/api/forms/qualitycontrol/${planId}`, { status: "APPROVED" });
    add("QC passed");
  }

  /** Process orders that stay with QC: on hold, failed, and one awaiting results. */
  async function qcExceptions(makePlan) {
    for (const [itcd, status, reason] of [
      [603, "HOLD", "Shade under review with the customer's standard"],
      [702, "REJECTED", "Gloss and drying time out of standard — batch to be reprocessed"],
      [604, null, null],
    ]) {
      const { planId, date } = await makePlan(itcd);
      if (!planId) continue;
      await post("production", `/api/forms/qualitycontrol/${planId}`, { mfg_date: date, parameters: params(itcd, !!status), remarks: status ? "Out of standard" : "Awaiting remaining results" });
      if (status) await post("production.manager", `/api/forms/qualitycontrol/${planId}`, { status, reason });
      add(`QC ${status || "pending"}`);
    }
  }

  /** A purchase requisition by the store, approved by the store manager; the PO quotes it. */
  async function purchaseRequisition(date, approvedOn, rows, godown) {
    const r = await post("storekeeper", "/api/material/requisition", {
      master: { req_catagory: { value: "PURCHASE" }, dated: date, issued_by: { value: godown }, issued_for: { value: godown } },
      lines: rows.map(([it, qty]) => ({ itcd: it.itcd, qty, remarks: "Below re-order level" })),
    });
    const tran_id = r.tran_no ?? r.tran_id ?? r.data?.tran_id;
    if (approvedOn && tran_id) {
      await put("store.manager", "/api/material/requisition", {
        master: { tran_id, dated: date, app_date: approvedOn, issued_by: { value: godown }, issued_for: { value: godown }, req_catagory: { value: "PURCHASE" } },
        lines: rows.map(([it, qty]) => ({ itcd: it.itcd, qty, ap_qty: qty })),
      });
    }
    add(approvedOn ? "requisitions approved" : "requisitions pending");
    return tran_id;
  }

  /** Store transfer requisitions (packing store → FG store): one approved, one pending. */
  async function transferRequisitions(approved, pending) {
    for (const [rows, ok] of [[approved, true], [pending, false]]) {
      const r = await post("storekeeper", "/api/material/requisition", {
        master: { req_catagory: { value: "TRANSFER" }, dated: "2026-11-11", issued_by: { value: 4 }, issued_for: { value: 3 } },
        lines: rows.map(([itcd, qty]) => ({ itcd, qty, remarks: "For filling line" })),
      });
      const tran_id = r.tran_no ?? r.tran_id;
      if (ok && tran_id) {
        await put("store.manager", "/api/material/requisition", {
          master: { tran_id, dated: "2026-11-11", app_date: "2026-11-12", issued_by: { value: 4 }, issued_for: { value: 3 }, req_catagory: { value: "TRANSFER" } },
          lines: rows.map(([itcd, qty]) => ({ itcd, qty, ap_qty: qty })),
        });
      }
      add("transfer requisitions");
    }
  }

  /** Lab's Nature on the Sale Order production plans. */
  async function labNature() {
    const plans = await prisma.reqMaster.findMany({ where: { req_catagory: "DISPATCH" }, include: { details: true }, orderBy: { tran_id: "asc" } });
    const natureOf = (itcd) => (itcd >= 800 ? "MANUFACTURING" : itcd >= 700 ? "PROCESS" : "FINISHED");
    for (const m of plans) {
      await put("production.manager", "/api/material/requisition", {
        master: { tran_id: m.tran_id, dated: m.dated.toISOString().slice(0, 10), userid: m.userid, issued_for: m.issued_for, issued_by: m.issued_by, req_catagory: "DISPATCH" },
        lines: m.details.map((d) => ({ itcd: d.itcd, qty: d.qty, so_no: d.so_no, ordered_qty: d.ordered_qty, remarks: d.remarks, nature: d.nature || natureOf(d.itcd) })),
      });
      add("plans with lab nature");
    }
    log(`  Lab nature set on ${plans.length} sale order production plans`);
  }

  /** Imports: beneficiaries, LC accounts, three LCs (landed, in transit, deal), in-bond, landed-cost issue. */
  async function imports({ issueLanded }) {
    const ben = {};
    for (const name of ["KRONOS TITAN GMBH", "SHANGHAI HUAYI PIGMENTS CO LTD", "CABOT SPECIALTY CHEMICALS"]) {
      const r = await post("purchase.manager", "/api/setup/beneficiary", { acname: name });
      ben[name] = r.data?.acno ?? r.acno;
    }
    const gl = {};
    for (const name of ["LC 0145 HBL - TIO2 KRONOS", "LC 0162 MCB - ORGANIC PIGMENTS", "LC 0171 HBL - CARBON BLACK"]) {
      const r = await post("accounts.manager", "/api/setup/lc", { acname: name, macno: 106 });
      gl[name] = r.data?.acno ?? r.acno;
    }
    const LCS = [
      { lc_no: "HBL/LC/2026/0145", gl: "LC 0145 HBL - TIO2 KRONOS", ben: "KRONOS TITAN GMBH", bank: AC.bankHbl, curr: "EUR", lc_date: "2026-07-28", lc_exp_date: "2026-11-30", terms: "CFR KARACHI", bl_no: "HLCUHAM2608123", bl_date: "2026-08-24", eta: "2026-09-21", exc: 312.5, lines: [[301, 18000, 2.45]] },
      { lc_no: "MCB/LC/2026/0162", gl: "LC 0162 MCB - ORGANIC PIGMENTS", ben: "SHANGHAI HUAYI PIGMENTS CO LTD", bank: AC.bankMcb, curr: "USD", lc_date: "2026-09-30", lc_exp_date: "2027-01-31", terms: "CFR KARACHI", bl_no: "COSU6421887310", bl_date: "2026-11-02", eta: "2026-11-24", exc: 281.4, lines: [[303, 2500, 7.9], [304, 2000, 8.6], [305, 2000, 8.2]] },
      { lc_no: "HBL/LC/2026/0171", gl: "LC 0171 HBL - CARBON BLACK", ben: "CABOT SPECIALTY CHEMICALS", bank: AC.bankHbl, curr: "USD", lc_date: "2026-11-06", lc_exp_date: "2027-02-28", terms: "FOB ANTWERP", lines: [[302, 6000, 2.9]] },
    ];
    const made = [];
    for (const l of LCS) {
      const r = await post("purchase.manager", "/api/lc", {
        master: {
          lc_no: l.lc_no, import_type: "LC", lc_gl: gl[l.gl], bank: l.bank, beneficiary: ben[l.ben], curr: l.curr,
          lc_date: l.lc_date, lc_exp_date: l.lc_exp_date, terms: l.terms, bl_no: l.bl_no ?? null, bl_date: l.bl_date ?? null, eta: l.eta ?? null, doc_arr_date: null,
        },
        lines: l.lines.map(([itcd, qty, fc_rate]) => ({ itcd, qty, fc_rate, fc_amount: qty * fc_rate, exc_rate: l.exc ?? 280, pkr_amount: Math.round(qty * fc_rate * (l.exc ?? 280)), bl_no: l.bl_no ?? null })),
      });
      made.push({ ...l, id: r.data?.id ?? r.id });
      add("letters of credit");
    }
    // The TiO2 shipment lands and goes into the port bond.
    const bonds = await get("purchase", "/api/setup/bond_locations");
    const bond = (bonds.data || bonds)[0];
    const lc1 = made[0];
    await post("purchase", "/api/inbond", {
      master: { lc_no: gl[lc1.gl], lc_ref: lc1.lc_no, lCMasterId: lc1.id, bond_id: lc1.bl_no, bond_location_id: bond.id, dated: "2026-09-23", bond_limit: "2027-03-22", bond_ref: "IB-QICT-2026-0912" },
      lines: lc1.lines.map(([itcd, qty]) => ({ itcd, qty, bl_no: lc1.bl_no })),
    });
    add("in-bond entries");
    // Clearing material sent out against the LC — its cost added to the LC (landed cost).
    await issueLanded(gl[lc1.gl]);
    add("landed-cost issues");
    log(`  imports: ${made.length} LCs, 1 in-bond, 1 landed-cost issue`);
  }

  /** Services: order (purchase) → entry (store) → invoice (purchase manager), linked by the order no. */
  async function services(dates) {
    const svc = new Map(((await get("purchase", "/api/setup/services")).data || []).map((s) => [s.service_name, s.id]));
    const JOBS = [
      [4001, "FREIGHT - OUTWARD", "TRIP", 6, 18500, "Karachi → Lahore deliveries"],
      [4002, "LOADING / UNLOADING", "JOB", 20, 2500, "Container destuffing — imported TiO2"],
      [4003, "FREIGHT - INWARD", "TRIP", 4, 14000, "Lahore warehouse replenishment"],
      [3008, "MACHINE REPAIR", "JOB", 1, 185000, "Bead mill seal replacement"],
    ];
    for (let i = 0; i < JOBS.length; i++) {
      const [party, name, unit, qty, rate, rmk] = JOBS[i];
      const d = dates[i % dates.length];
      const service_id = svc.get(name);
      const so = await post("purchase", "/api/orders/serviceOrder", {
        master: { party_code: { value: party }, godown: 1, dated: d.order, due_date: d.entry, rmk },
        lines: [{ service_id, no_of_packs: 1, qty_per_pack: qty, qty, unit, rate, amount: qty * rate }],
      });
      add("service orders");
      if (i === JOBS.length - 1) continue; // the repair is still open
      await post("storekeeper", "/api/voucher/serviceEntry", {
        master: { tran_code: 20, vr_no: await voucherNo("storekeeper", 20), dated: d.entry, service_id: so.order_no, pycd: party, godown: 1, rmk },
        lines: [{ service_id, no_of_pack: 1, qty_per_pack: qty, qty, rate, gross_amount: qty * rate, damt: qty * rate }],
      });
      add("service entries");
      if (i === 2) continue; // received, invoice not yet booked
      await post("purchase.manager", "/api/voucher/serviceInvoice", {
        master: { tran_code: 21, vr_no: await voucherNo("purchase.manager", 21), dated: d.invoice, pycd: party, po_no: so.order_no, godown: 1, invoice_no: `SI-${party}-${so.order_no}`, rmk },
        lines: [{ service_id, qty, rate, st_rate: 16 }],
      });
      add("service invoices");
    }
    log(`  services: ${counts["service orders"]} orders, ${counts["service entries"]} entries, ${counts["service invoices"]} invoices`);
  }

  /** Finance: debit / credit notes, cheques in hand. */
  async function finance() {
    const NOTES = [
      [19, "debit", "2026-07-14", 3003, [[3003, 46000, 0, "Short supply 40 kg Phthalo Blue — GRN July"], [AC.purchaseReturn, 0, 46000, "Short supply"]]],
      [19, "debit", "2026-09-09", 3002, [[3002, 28500, 0, "Rate difference on Toluene — agreed 300/kg"], [AC.purchases, 0, 28500, "Rate difference"]]],
      [19, "debit", "2026-10-21", 3005, [[3005, 15600, 0, "20 dented tins returned"], [AC.purchaseReturn, 0, 15600, "Damaged packing"]]],
      [20, "credit", "2026-08-18", 2002, [[AC.salesReturn, 85000, 0, "Quantity discount Q1 — Crescent"], [2002, 0, 85000, "Quantity discount"]]],
      [20, "credit", "2026-10-07", 2008, [[AC.salesPromotion, 40000, 0, "Trade scheme Oct"], [2008, 0, 40000, "Trade scheme"]]],
      [20, "credit", "2026-11-04", 2005, [[AC.salesReturn, 62000, 0, "Shade claim settled"], [2005, 0, 62000, "Claim settlement"]]],
    ];
    for (const [tran_code, type, dated, pycd, lines] of NOTES) {
      const u = tran_code === 19 ? "accountant" : "accounts.manager";
      await post(u, `/api/voucher/${type}`, {
        master: { tran_code, vr_no: await voucherNo(u, tran_code), dated, pycd, rmk: lines[0][3] },
        lines: lines.map(([acno, damt, camt, narration1]) => ({ acno, damt, camt, narration1, ...(acno === AC.salesPromotion ? { sub_account: "TRADE SCHEMES" } : {}) })),
      });
      add(`${type} notes`);
    }
    const CHEQUES = [
      [2002, "MEEZAN BANK", "00451267", "2026-10-20", "2026-11-30", 650000, "PENDING"],
      [2005, "BANK ALFALAH", "10293847", "2026-10-28", "2026-12-05", 1200000, "PENDING"],
      [2008, "UNITED BANK", "55120931", "2026-11-02", "2026-11-25", 480000, "PENDING"],
      [2001, "HABIB BANK", "73344120", "2026-10-02", "2026-10-15", 390000, "CLEARED"],
      [2010, "MCB BANK", "22019384", "2026-09-25", "2026-10-10", 275000, "CLEARED"],
      [2006, "ALLIED BANK", "61200458", "2026-11-09", "2026-12-20", 820000, "PENDING"],
    ];
    await post("accounts.manager", "/api/accounts/checks-in-hand", {
      rows: CHEQUES.map(([acno, bank, chqNo, chqRcvDate, chqDate, amount, status]) => ({
        acno, bank, chqNo, chqRcvDate, chqDate, amount, status, chqBrBy: "Sales team", rmk: "Post-dated cheque", depAcno: status === "CLEARED" ? AC.bankHbl : undefined,
      })),
    });
    add("cheques in hand", CHEQUES.length);
    await post("accounts.manager", "/api/invoice-knockoff/run", {});
    log(`  finance: ${counts["debit notes"]} debit notes, ${counts["credit notes"]} credit notes, ${CHEQUES.length} cheques, knock-off run`);
  }

  /** QA entry of raw-material receipts → order QC → GRN (posted by the pass, dated today). */
  async function receiptQc() {
    const RECEIPTS = [
      [3001, [[101, 2000, 615], [103, 800, 985]], "APPROVED"],
      [3002, [[201, 3000, 312]], "APPROVED"],
      [3003, [[301, 1500, 1160]], "REJECTED"],
      [3004, [[306, 5000, 46]], null],
    ];
    let batch = 260100;
    for (const [vendor, lines, outcome] of RECEIPTS) {
      const po = await post("purchase", "/api/orders/purchaseOrder", {
        master: { party_code: { value: vendor, label: String(vendor) }, godown: 1, dated: "2026-11-09", due_date: "2026-11-16", payment_terms: "30 DAYS" },
        lines: lines.map(([itcd, qty, rate]) => ({ itcd, qty, rate, amount: qty * rate, st_rate: 18, unit: "KG" })),
      });
      for (const [itcd, qty] of lines) {
        const qa = await post("production", "/api/store/qa-entry", { order_no: po.order_no, itcd, received_qty: qty, batch_no: String(++batch), mfg_date: "2026-10-20", expiry_date: "2027-10-19", remarks: "Received at gate, sample drawn" });
        add("QA entries");
        const qc_id = qa.quality_master_id ?? qa.data?.quality_master_id ?? qa.id;
        if (!outcome) continue;
        await post("production", `/api/forms/orderqualitycontrol/${po.order_no}`, { qc_id, parameters: params(itcd, outcome === "REJECTED"), batch_no: String(batch) });
        await post("production.manager", `/api/forms/orderqualitycontrol/${po.order_no}`, { qc_id, status: outcome, ...(outcome === "REJECTED" ? { reason: "Purity below 93% — returned to supplier" } : {}) });
        add(`receipt QC ${outcome}`);
      }
    }
    log(`  receipt QC: ${counts["QA entries"]} QA entries, ${counts["receipt QC APPROVED"] || 0} passed (GRN posted), ${counts["receipt QC REJECTED"] || 0} failed`);
  }

  /** Sales loan (stock lent to a customer), HR items left pending for the inbox. */
  async function pendingAndLoans(emps) {
    const loan = await post("sales.manager", "/api/sales-loans", {
      acno: 2008, to_acno: 2001, issue_date: "2026-10-12", expected_return_date: "2026-11-12", purpose: "Urgent job — stock lent until their order lands",
      lines: [{ itcd: 602, qty_issued: 200, unit: "KG" }],
    });
    const lid = loan.id ?? loan.data?.id;
    const line = (loan.lines || loan.data?.lines || [])[0];
    if (lid && line) await post("sales.manager", `/api/sales-loans/${lid}/returns`, { return_date: "2026-11-03", remarks: "Part returned", lines: [{ line_id: line.id, qty: 120 }] });
    await post("sales.manager", "/api/sales-loans", {
      acno: 2005, to_acno: 2002, issue_date: "2026-11-05", expected_return_date: "2026-12-05", purpose: "Shade trial", lines: [{ itcd: 601, qty_issued: 60, unit: "KG" }],
    });
    add("sales loans", 2);
    const leaver = emps.find((e) => `${e.firstName} ${e.surname}` === "Naveed Akram");
    if (leaver) await post("hr.manager", "/api/hr/leaving", { employee_id: leaver.id, kind: "RESIGNATION", notice_date: "2026-11-10", last_working_day: "2026-12-10", reason: "Continuing studies" });
    await post("employee", "/api/hr/loans", { kind: "ADVANCE", amount: 30000, installment: 10000, start_month: "2026-12", reason: "Medical expenses" });
    add("pending HR requests", 2);
  }

  /** Month-end costing and the locks June – October (November stays open). */
  async function closeMonths() {
    for (const month of [6, 7, 8, 9, 10]) {
      const c = await post("accounts.manager", "/api/costing/production", { month, year: 2026, auto_sequence: true });
      await post("accounts.manager", "/api/costing/production", { month, year: 2026, auto_orphans: true }).catch(() => null);
      const l = await post("accounts.manager", "/api/costing/lock-period", { month, year: 2026, action: "lock" });
      log(`  2026-${String(month).padStart(2, "0")}: ${c.costed ?? 0} process orders costed; locked${l.opening_stock?.errors?.length ? ` (opening errors ${l.opening_stock.errors.length})` : ""}`);
    }
  }

  return { setup, transferRequisitions, qcProcessOrder, qcExceptions, purchaseRequisition, labNature, imports, services, finance, receiptQc, pendingAndLoans, closeMonths, counts };
}
