// scripts/demo/features/subAccountsRmc.mjs — checks for two Settings → Features switches,
// run from scripts/demo/test-features.mjs (which owns login, set() and the final reset):
//   7. vouchers.subAccounts    Sub Account on receipt / payment / journal lines
//   8. reports.rmcInputRates   RMC Input Rates screen + the RMC "Input Based" summary type
export async function runSubAccountsAndRmc({ admin, viewer, set, vr, check, prisma }) {
  const menuHas = async (url) => JSON.stringify((await admin("GET", "/api/buildMenu?all=true")).body || []).includes(`"${url}"`);

  // 7. vouchers.subAccounts — required for accounts in Account Settings "sub_account_groups"
  {
    const EXP = 5223; // TRAVELLING & CONVEYANCE (main account 522, seeded into "sub_account_groups")
    const CASH = 1011;
    const pay = async (lines) => {
      const r = await admin("POST", "/api/voucher/payment", { master: { tran_code: 2, vr_no: await vr(2), dated: "2026-11-14", pycd: CASH, rmk: "feature test sub account" }, lines });
      const stored = r.body?.voucherId ? await prisma.transactions.findMany({ where: { tran_id: r.body.voucherId, acno: EXP }, select: { sub_account: true } }) : [];
      return { r, stored };
    };
    const ledger = async (q) => (await admin("GET", `/api/reports/accountLedger?account=${EXP}&dateFrom=01-11-2026&dateTo=30-11-2026&limit=1000&${q}`)).body;

    await set({ "vouchers.subAccounts": false });
    const g0 = await admin("GET", `/api/sub-accounts?acno=${EXP}`);
    check("subAccounts OFF: API refuses", g0.status === 403, `status ${g0.status}`);
    check("subAccounts OFF: Sub Accounts menu hidden", !(await menuHas("/accounting/sub-accounts")));
    const p0 = await pay([{ acno: EXP, damt: 1000, narration1: "taxi", sub_account: { value: "FUEL TEST", label: "FUEL TEST" } }]);
    check("subAccounts OFF: payment saved, sub account not written, none required", p0.r.status === 201 && p0.stored.length === 1 && p0.stored[0].sub_account === null, `status ${p0.r.status} ${p0.r.body?.message || ""} stored ${JSON.stringify(p0.stored)}`);
    const l0 = await ledger("viewMode=summary");
    check("subAccounts OFF: ledger ignores the Summary by Sub Account view", Array.isArray(l0?.allData) && l0.allData.length > 0 && l0.allData.every((r) => r.row_kind !== "subAccount" && !("sub_account" in r)), `rows ${l0?.allData?.length}`);

    await set({ "vouchers.subAccounts": true });
    check("subAccounts ON: Sub Accounts menu shown", await menuHas("/accounting/sub-accounts"));
    const req1 = (await admin("GET", `/api/sub-accounts?acno=${EXP}&required=1`)).body?.required;
    const req2 = (await admin("GET", `/api/sub-accounts?acno=${CASH}&required=1`)).body?.required;
    check("subAccounts ON: required for an expense account, not for cash", req1 === true && req2 === false, `${req1} / ${req2}`);
    const c1 = await admin("POST", "/api/sub-accounts", { acno: EXP, acname: "fuel test" });
    check("subAccounts ON: sub account added (saved in CAPS)", [200, 201].includes(c1.status) && c1.body?.acname === "FUEL TEST", `status ${c1.status} ${JSON.stringify(c1.body)}`);
    const p1 = await pay([{ acno: EXP, damt: 1000, narration1: "taxi" }]);
    check("subAccounts ON: expense line without a sub account refused", p1.r.status === 422 && /Sub Account is required/i.test(p1.r.body?.message || ""), `${p1.r.status} ${p1.r.body?.message || ""}`);
    const p2 = await pay([{ acno: EXP, damt: 1000, narration1: "taxi", sub_account: "NO SUCH SUB" }]);
    check("subAccounts ON: unknown sub account refused", p2.r.status === 422, `${p2.r.status} ${p2.r.body?.message || ""}`);
    const p3 = await pay([{ acno: EXP, damt: 1250, narration1: "fuel", sub_account: { value: "FUEL TEST", label: "FUEL TEST" } }]);
    check("subAccounts ON: payment saved with its sub account", p3.r.status === 201 && p3.stored[0]?.sub_account === "FUEL TEST", `status ${p3.r.status} ${p3.r.body?.message || ""} stored ${JSON.stringify(p3.stored)}`);
    const l1 = await ledger("viewMode=summary");
    const fuelRow = (l1?.allData || []).find((r) => r.sub_account === "FUEL TEST");
    check("subAccounts ON: ledger Summary by Sub Account has the FUEL TEST row", fuelRow?.row_kind === "subAccount" && fuelRow.net_amount >= 1250 && fuelRow.sub_account_id === c1.body?.id, JSON.stringify(fuelRow));
    const l2 = await ledger(`subAccount=${c1.body?.id}`);
    const lines2 = (l2?.allData || []).filter((r) => !r.isOpening);
    check("subAccounts ON: ledger filtered to the sub account shows only its lines", lines2.length > 0 && lines2.every((r) => r.sub_account === "FUEL TEST"), `lines ${lines2.length}`);
    const d1 = await admin("DELETE", `/api/sub-accounts?id=${c1.body?.id}`);
    check("subAccounts ON: a used sub account cannot be deleted", d1.status === 422, `${d1.status} ${d1.body?.error || ""}`);

    await set({ "vouchers.subAccounts": false });
    const id3 = p3.r.body?.voucherId;
    const e3 = id3
      ? await admin("PUT", "/api/voucher/payment", {
          master: { tran_id: id3, tran_code: 2, vr_no: p3.r.body?.vrNo, dated: "2026-11-14", pycd: CASH, rmk: "feature test sub account (edited)" },
          lines: [
            { acno: EXP, damt: 1250, narration1: "fuel", sub_account: "FUEL TEST" },
            { acno: 5222, damt: 10, narration1: "new line", sub_account: "SNEAKED IN" },
          ],
        })
      : { status: 0 };
    const after = id3 ? await prisma.transactions.findMany({ where: { tran_id: id3, acno: { in: [EXP, 5222] } }, select: { acno: true, sub_account: true } }) : [];
    const kept = after.find((t) => t.acno === EXP)?.sub_account;
    const sneaked = after.find((t) => t.acno === 5222)?.sub_account;
    check("subAccounts OFF again: an edit keeps the saved sub account, adds no new one", e3.status === 200 && kept === "FUEL TEST" && sneaked === null, `status ${e3.status} ${e3.body?.message || ""} kept ${kept} new ${sneaked}`);
    const stillThere = c1.body?.id ? await prisma.subAccount.count({ where: { id: c1.body.id } }) : 0;
    check("subAccounts OFF again: sub accounts are kept", stillThere === 1);
  }

  // 8. reports.rmcInputRates — RMC Input Rates screen + "Input Based" summary type
  {
    const now = new Date();
    const rmc = async (type) => (await admin("GET", `/api/reports/rmc?finishedItem=601&month=${now.getMonth() + 1}&year=${now.getFullYear()}&summaryType=${type}&limit=1000`)).body;
    const rateOf = (rep, itcd) => (rep?.allData || []).find((r) => r.row_type === "material_row" && r.material_id === itcd)?.rate;

    await set({ "reports.rmcInputRates": false });
    const g0 = await admin("GET", "/api/rmc-rates");
    const pOff = await admin("PUT", "/api/rmc-rates", { rates: [{ itcd: 101, rate: 1 }] });
    check("rmcInputRates OFF: API refuses (GET and PUT)", g0.status === 403 && pOff.status === 403, `${g0.status} / ${pOff.status}`);
    check("rmcInputRates OFF: RMC Input Rates menu hidden", !(await menuHas("/accounting/rmc-rates")));

    await set({ "reports.rmcInputRates": true });
    check("rmcInputRates ON: RMC Input Rates menu shown", await menuHas("/accounting/rmc-rates"));
    const g1 = await admin("GET", "/api/rmc-rates");
    const normalRep = await rmc("normal");
    const item = (g1.body?.data || []).find((i) => rateOf(normalRep, i.itcd) != null);
    check("rmcInputRates ON: rate list of the RMC materials", g1.status === 200 && !!item, `status ${g1.status}, items ${g1.body?.data?.length}`);
    const sv = await viewer("PUT", "/api/rmc-rates", { rates: [{ itcd: item?.itcd, rate: 1 }] });
    check("rmcInputRates ON: saving refused without rmcRates.manage", sv.status === 403, `status ${sv.status}`);
    const p1 = await admin("PUT", "/api/rmc-rates", { rates: [{ itcd: item?.itcd, rate: 4321.5 }] });
    check("rmcInputRates ON: input rate saved", p1.status === 200 && p1.body?.data?.find((i) => i.itcd === item?.itcd)?.input_rate === 4321.5, `${p1.status} ${p1.body?.message || p1.body?.error || ""}`);
    const inputRep = await rmc("input");
    check("rmcInputRates ON: Input Based prices with the input rate", inputRep?.summary?.summaryType === "Input Based" && rateOf(inputRep, item?.itcd) === 4321.5, `${inputRep?.summary?.summaryType} rate ${rateOf(inputRep, item?.itcd)}`);
    const normal2 = await rmc("normal");
    check("rmcInputRates ON: System Average keeps the monthly rate", normal2?.summary?.summaryType === "System Average" && rateOf(normal2, item?.itcd) === rateOf(normalRep, item?.itcd), `rate ${rateOf(normal2, item?.itcd)}`);

    await set({ "reports.rmcInputRates": false });
    const off2 = await rmc("input");
    check("rmcInputRates OFF again: Input Based not applied", off2?.summary?.summaryType === "System Average" && rateOf(off2, item?.itcd) === rateOf(normalRep, item?.itcd), `${off2?.summary?.summaryType} rate ${rateOf(off2, item?.itcd)}`);
    const kept = item ? await prisma.rmcInputRate.findUnique({ where: { itcd: item.itcd } }) : null;
    check("rmcInputRates OFF again: typed rates are kept", kept?.rate === 4321.5);
    if (kept) await prisma.rmcInputRate.delete({ where: { itcd: item.itcd } }); // leave the demo data as it was
  }
}
