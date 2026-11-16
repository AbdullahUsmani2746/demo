// scripts/demo/features/accounting.mjs — checks for the Settings → Features switches
// ported from Accounting (prisma/sql/2026-11-21_accounting_features.sql), run from
// scripts/demo/test-features.mjs (which owns login, set() and the final reset):
//   grn.directRateByItem          typed GRN rate kept for ticked items → invoicing default
//   saleReturn.requireDispatchLink a return names its dispatch / old dispatch no + cost rate
//   tax.lineWht                   payment line tax law → WHT deduction on the law's account
//   planned quantities            INPUT_FOR_PP save → Production Planning Qtr Qty
// Each saves the switch on and off and proves both behaviours through the API.
export async function runAccountingPort({ admin, set, vr, check, prisma }) {
  const day = "2026-11-14";

  // ── grn.directRateByItem ──────────────────────────────────────────────
  {
    const godown = (await prisma.godown.findFirst({ where: { is_active: true }, select: { id: true } }))?.id;
    const vendor = (await prisma.transactionsMaster.findFirst({ where: { tran_code: 4, pycd: { not: null } }, select: { pycd: true }, orderBy: { tran_id: "desc" } }))?.pycd;
    const item = await prisma.item.findFirst({ select: { itcd: true, grn_direct_rate: true }, orderBy: { itcd: "asc" } });
    if (!godown || !vendor || !item) {
      check("grn.directRateByItem: demo data (godown, vendor, item) present", false);
    } else {
      await prisma.item.update({ where: { itcd: item.itcd }, data: { grn_direct_rate: true } });
      // Each save differs in quantity: the save guard (lib/voucher/saveGuard.js)
      // refuses the same GRN saved twice within two minutes.
      const grn = async (qty) => {
        const r = await admin("POST", "/api/voucher/grn", {
          master: { tran_code: 4, dated: day, pycd: vendor, godown, rmk: "feature test GRN direct rate" },
          lines: [{ itcd: item.itcd, no_of_pack: 1, qty_per_pack: qty, qty, rate: 123.45 }],
        });
        const line = r.body?.voucherId
          ? await prisma.transactions.findFirst({ where: { tran_id: r.body.voucherId, itcd: item.itcd, sub_tran_id: 1 }, select: { rate: true, damt: true, camt: true } })
          : null;
        return { r, line };
      };
      await set({ "grn.directRateByItem": false });
      const g0 = await grn(10);
      check("grn.directRateByItem OFF: GRN saved quantity only (rate 0)", g0.r.status === 201 && Number(g0.line?.rate) === 0, `${g0.r.status} ${g0.r.body?.message || ""} ${JSON.stringify(g0.line)}`);
      await set({ "grn.directRateByItem": true });
      const g1 = await grn(11);
      check("grn.directRateByItem ON: ticked item keeps the typed rate, no amounts", g1.r.status === 201 && Number(g1.line?.rate) === 123.45 && !Number(g1.line?.damt) && !Number(g1.line?.camt), `${g1.r.status} ${g1.r.body?.message || ""} ${JSON.stringify(g1.line)}`);
      const api = await admin("GET", `/api/forms/items/grn-direct-rate?itcds=${item.itcd}`);
      check("grn.directRateByItem ON: item reported as direct-rate", (api.body?.itcds || []).map(Number).includes(item.itcd), JSON.stringify(api.body));
      await set({ "grn.directRateByItem": false });
      await prisma.item.update({ where: { itcd: item.itcd }, data: { grn_direct_rate: item.grn_direct_rate } });
    }
  }

  // ── saleReturn.requireDispatchLink ────────────────────────────────────
  {
    const dispatch = await prisma.transactionsMaster.findFirst({
      where: { tran_code: 6, dispatch_no: { not: null }, godown: { not: null } },
      select: { tran_id: true, dispatch_no: true, pycd: true, godown: true },
      orderBy: { tran_id: "desc" },
    });
    const line = dispatch && (await prisma.transactions.findFirst({ where: { tran_id: dispatch.tran_id, itcd: { not: null } }, select: { itcd: true } }));
    // Each return a different quantity: the save guard refuses the same return saved twice within two minutes.
    let n = 0;
    const ret = (master, itcd = line?.itcd, extra = {}) => {
      const qty = ++n;
      return admin("POST", "/api/voucher/saleReturn", {
        master: { tran_code: 10, dated: day, pycd: dispatch.pycd, godown: dispatch.godown, rmk: "feature test sale return", ...master },
        lines: [{ itcd, no_of_pack: 1, qty_per_pack: qty, qty, ...extra }],
      });
    };
    if (!dispatch || !line) {
      check("saleReturn: demo dispatch present", false);
    } else {
      await set({ "saleReturn.requireDispatchLink": false });
      const r0 = await ret({});
      check("saleReturn.requireDispatchLink OFF: a return without a dispatch is saved (as before)", r0.status === 201, `${r0.status} ${r0.body?.message || ""}`);
      await set({ "saleReturn.requireDispatchLink": true });
      const r1 = await ret({});
      check("saleReturn.requireDispatchLink ON: a return without a dispatch is refused", r1.status === 422, `${r1.status} ${r1.body?.message || ""}`);
      const r2 = await ret({ dispatch_no: dispatch.dispatch_no });
      check("saleReturn.requireDispatchLink ON: a return of its dispatch's item is saved", r2.status === 201, `${r2.status} ${r2.body?.message || ""}`);
      const other = await prisma.item.findFirst({ where: { itcd: { not: line.itcd } }, select: { itcd: true } });
      const r3 = await ret({ dispatch_no: dispatch.dispatch_no }, other?.itcd);
      check("saleReturn.requireDispatchLink ON: an item not on the dispatch is refused", r3.status === 422, `${r3.status} ${r3.body?.message || ""}`);
      const r4 = await ret({ ref_dispatch_no: "OLD-123" }, line.itcd, { cost_rate: 77 });
      const stored = r4.body?.voucherId ? await prisma.transactions.findFirst({ where: { tran_id: r4.body.voucherId, itcd: line.itcd }, select: { cost_rate: true } }) : null;
      check("saleReturn.requireDispatchLink ON: an old dispatch return carries its cost rate", r4.status === 201 && Number(stored?.cost_rate) > 0, `${r4.status} ${r4.body?.message || ""} ${JSON.stringify(stored)}`);
      const cost = r2.body?.voucherId ? await admin("GET", `/api/voucher/sale-return-cost?tran_id=${r2.body.voucherId}`) : { status: 0 };
      check("saleReturn: cost of a linked return is traced to its dispatch month", cost.status === 200 && cost.body?.dispatch_no === dispatch.dispatch_no, `${cost.status} ${JSON.stringify(cost.body)?.slice(0, 160)}`);
      await set({ "saleReturn.requireDispatchLink": false });
    }
  }

  // ── tax.lineWht ───────────────────────────────────────────────────────
  {
    const law = await prisma.taxLaws.findFirst({ select: { tax_law_code: true, rate_filer: true, tax_acno: true } });
    const cash = await prisma.transactionsMaster.findFirst({ where: { tran_code: 2, pycd: { not: null } }, select: { pycd: true }, orderBy: { tran_id: "desc" } });
    const party = await prisma.transactions.findFirst({
      where: { transactionsMaster: { tran_code: 2 }, sub_tran_id: 1, acno: { not: null }, damt: { gt: 0 } },
      select: { acno: true },
      orderBy: { id: "desc" },
    });
    if (!law || !cash || !party) {
      check("tax.lineWht: demo tax law / payment present", false);
    } else {
      const payable = law.tax_acno ?? cash.pycd;
      if (!law.tax_acno) await prisma.taxLaws.update({ where: { tax_law_code: law.tax_law_code }, data: { tax_acno: payable } });
      // Each payment a different amount: the save guard refuses the same payment saved twice within two minutes.
      const pay = async (damt) => {
        const r = await admin("POST", "/api/voucher/payment", {
          master: { tran_code: 2, vr_no: await vr(2), dated: day, pycd: cash.pycd, rmk: "feature test WHT" },
          lines: [{ acno: party.acno, damt, narration1: "WHT test", tax_law_code: law.tax_law_code }],
        });
        const ded = r.body?.voucherId
          ? await prisma.transactions.findMany({ where: { tran_id: r.body.voucherId, sub_tran_id: 2 }, select: { acno: true, camt: true, tax_law_code: true } })
          : [];
        return { r, ded };
      };
      await set({ "tax.lineWht": false });
      const p0 = await pay(10000);
      check("tax.lineWht OFF: no deduction is built", p0.r.status === 201 && p0.ded.length === 0, `${p0.r.status} ${p0.r.body?.message || ""} ${JSON.stringify(p0.ded)}`);
      await set({ "tax.lineWht": true });
      const p1 = await pay(12000);
      check("tax.lineWht ON: a WHT deduction on the law's payable account", p1.r.status === 201 && p1.ded.length === 1 && Number(p1.ded[0].acno) === Number(payable) && Number(p1.ded[0].camt) > 0, `${p1.r.status} ${p1.r.body?.message || ""} ${JSON.stringify(p1.ded)}`);
      await set({ "tax.lineWht": false });
      if (!law.tax_acno) await prisma.taxLaws.update({ where: { tax_law_code: law.tax_law_code }, data: { tax_acno: null } });
    }
  }

  // ── Planned quantities (always available) ─────────────────────────────
  {
    const item = await prisma.item.findFirst({ select: { itcd: true }, orderBy: { itcd: "desc" } });
    const put = await admin("PUT", "/api/material/input-for-pp", {
      entries: [
        { itcd: item.itcd, period_type: "MONTHLY", month: 11, year: 2026, qty: 40 },
        { itcd: item.itcd, period_type: "MONTHLY", month: 12, year: 2026, qty: 60 },
      ],
    });
    const get = await admin("GET", "/api/material/input-for-pp?year=2026&period_type=MONTHLY");
    const mine = (get.body?.data || []).filter((r) => r.itcd === item.itcd);
    check("planned quantities: saved and listed", put.status === 200 && mine.length === 2, `${put.status} ${put.body?.error || ""} rows ${mine.length}`);
    const clear = await admin("PUT", "/api/material/input-for-pp", {
      entries: [11, 12].map((month) => ({ itcd: item.itcd, period_type: "MONTHLY", month, year: 2026, qty: null })),
    });
    check("planned quantities: an empty quantity removes the entry", clear.status === 200, `${clear.status} ${clear.body?.message || clear.body?.error || ""}`);
  }
}
