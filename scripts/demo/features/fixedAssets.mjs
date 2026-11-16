// scripts/demo/features/fixedAssets.mjs — Fixed assets (lib/fixedAssets/*), run from
// scripts/demo/test-features.mjs (which owns login, set() and the final feature reset).
// Works on the demo company (scripts/demo/fixedAssetDocuments.mjs: GRNs Jun–Aug, runs
// Jun–Oct, a relocation, a laptop sold 05-11-2026) and leaves it as it found it:
// the demo disposal and the October run are reversed and posted again.
//   A. settings (rights, validation)        B. switches OFF: nothing registered / posted
//   C. GRN registers assets + capitalisation journal
//   D. depreciation: preview = expected, one read-only journal, no second run, overrides locked
//   E. disposal: right gain / loss journal; reversal
//   F. reports return the expected rows      G. registered GRN locked
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));
const r2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const FA_ON = { "fixedAssets.autoRegisterFromGrn": true, "fixedAssets.depreciation": true, "fixedAssets.disposalPosting": true, "fixedAssets.relocation": true };
const FA_OFF = Object.fromEntries(Object.keys(FA_ON).map((k) => [k, false]));

export async function runFixedAssets({ admin, viewer, set, check, prisma }) {
  const manager = admin; // accounts.manager holds the rights; admin keeps the suite independent of role grants
  const items = await prisma.item.findMany({ where: { code: { in: ["FA-IT-02", "FA-IT-01"] } } });
  const printer = items.find((i) => i.code === "FA-IT-02");
  const vendor = await prisma.aCNO.findFirst({ where: { macno: 201 }, orderBy: { acno: "asc" } });
  const customer = await prisma.aCNO.findFirst({ where: { macno: 102 }, orderBy: { acno: "asc" } });
  if (!printer || !vendor || !customer) {
    check("fixed assets: demo masters present (FA-IT-02, a vendor, a customer)", false, "run scripts/demo/seed-masters.mjs + seed-documents.mjs");
    return;
  }
  const grn = (date, qty, rate) =>
    admin("POST", "/api/voucher/fixedAssetsGrn", {
      master: { tran_code: 14, dated: date, pycd: vendor.acno, rmk3: `FT-${Date.now()}`, rmk4: "9", rmk5: "1006" },
      lines: [{ itcd: printer.itcd, qty, rate, narration2: "TEST" }],
    });
  const jvLines = (tranId) => prisma.transactions.findMany({ where: { tran_id: tranId } });
  const balanced = (lines) => Math.abs(r2(lines.reduce((t, l) => t + (l.damt || 0), 0)) - r2(lines.reduce((t, l) => t + (l.camt || 0), 0))) < 0.01;

  // ── A. settings ─────────────────────────────────────────────────────────
  const gs = await admin("GET", "/api/fixed-assets/settings");
  check("FA settings: readable, defaults resolved", gs.status === 200 && gs.body.settings.defaultMethod && gs.body.canEdit === true, JSON.stringify(gs.body?.settings));
  const pv = await viewer("PUT", "/api/fixed-assets/settings", { settings: { defaultMethod: "RB" } });
  check("FA settings: PUT refused without settings.manage", pv.status === 403, `status ${pv.status}`);
  const bad = await admin("PUT", "/api/fixed-assets/settings", { settings: { firstMonthRule: "WHENEVER" } });
  check("FA settings: invalid value refused", bad.status === 400, bad.body?.message);
  const ok = await admin("PUT", "/api/fixed-assets/settings", { settings: { firstMonthRule: "PRORATA", lastMonthRule: "PRORATA", grnCapitalisation: "JV", minCapitalisationValue: 0 } });
  check("FA settings: saved (first / last month pro-rata, capitalisation JV)", ok.status === 200, ok.body?.message);
  await wait(11000);

  // ── B. switches OFF ─────────────────────────────────────────────────────
  await set(FA_OFF);
  const g0 = await grn("2026-11-02", 1, 10000);
  const reg0 = g0.body?.voucherId ? await prisma.fixedAsset.count({ where: { grn_tran_id: g0.body.voucherId } }) : -1;
  check("autoRegisterFromGrn OFF: GRN saved, nothing registered", g0.status === 201 && reg0 === 0, `status ${g0.status}, registered ${reg0}`);
  const d0 = await manager("GET", "/api/fixed-assets/depreciation?period=2026-10");
  check("depreciation OFF: run screen refused", d0.status === 403, `status ${d0.status}`);
  const s0 = await admin("GET", "/api/reports/fixedAssetSchedule");
  check("depreciation OFF: schedule report refused", s0.status === 403, `status ${s0.status}`);
  const anyAsset = await prisma.fixedAsset.findFirst({ where: { status: "IN_USE" } });
  const rl0 = await admin("POST", "/api/voucher/fixedAssetRelocation", { master: { tran_code: 16, dated: "2026-11-03" }, lines: [{ party_name: anyAsset?.asset_no, narration4: "1" }] });
  check("relocation OFF: relocation voucher refused", rl0.status === 403, `status ${rl0.status} ${rl0.body?.message || ""}`);
  await set(FA_ON);

  // ── C. GRN registers ────────────────────────────────────────────────────
  // Re-runnable: a disposal an earlier run of this test left (voucher remark
  // "feature test") used the depreciation run reversed below — reverse it first.
  const leftovers = await prisma.fixedAssetDisposal.findMany({ where: { reversed_at: null }, select: { tran_id: true } });
  for (const { tran_id } of leftovers) {
    const v = await prisma.transactionsMaster.findUnique({ where: { tran_id }, select: { rmk: true } });
    if (v?.rmk === "feature test") await manager("POST", `/api/fixed-assets/disposals/${tran_id}/reverse`, { reason: "feature test re-run" });
  }
  const demoDisposal = await prisma.fixedAssetDisposal.findFirst({ where: { reversed_at: null, kind: "SALE" }, orderBy: { id: "asc" } });
  if (demoDisposal) {
    const rv = await manager("POST", `/api/fixed-assets/disposals/${demoDisposal.tran_id}/reverse`, { reason: "feature test" });
    const back = await prisma.fixedAsset.findUnique({ where: { id: demoDisposal.asset_id } });
    const mirror = rv.body?.journal?.tran_id ? await prisma.transactionsMaster.findUnique({ where: { tran_id: rv.body.journal.tran_id } }) : null;
    check("disposal reversal: mirror journal FA_DISPOSAL_REVERSAL, asset back in use", rv.status === 200 && back.status === "IN_USE" && mirror?.rmk4 === "FA_DISPOSAL_REVERSAL", `status ${rv.status} ${rv.body?.message || ""}`);
  }
  const lastRun = await prisma.fixedAssetDepreciationRun.findFirst({ where: { status: "POSTED" }, orderBy: { period: "desc" } });
  const period = lastRun?.period ?? "2026-10";
  if (lastRun) {
    const rr = await manager("POST", `/api/fixed-assets/depreciation/${lastRun.id}/reverse`, { reason: "feature test" });
    check(`run reversal: ${period} reversed with a mirror journal`, rr.status === 200 && rr.body?.run?.reversal_tran_id, `status ${rr.status} ${rr.body?.message || ""}`);
  }
  const day16 = `${period}-16`;
  const g1 = await grn(day16, 2, 120000);
  const assets = g1.body?.voucherId ? await prisma.fixedAsset.findMany({ where: { grn_tran_id: g1.body.voucherId }, orderBy: { asset_no: "asc" } }) : [];
  const cap = assets[0]?.capitalisation_tran_id ? await prisma.transactionsMaster.findUnique({ where: { tran_id: assets[0].capitalisation_tran_id } }) : null;
  const capLines = cap ? await jvLines(cap.tran_id) : [];
  check("GRN (qty 2 × 120,000) creates 2 asset records with their asset numbers and cost",
    g1.status === 201 && assets.length === 2 && assets.every((a) => a.cost === 120000 && a.asset_no) && g1.body?.registration?.registered === 2,
    `status ${g1.status} ${g1.body?.message || ""}; assets ${assets.map((a) => `${a.asset_no}:${a.cost}`).join(",")}`);
  check("GRN capitalisation journal: FA_CAPITALISATION, Dr asset cost 240,000 / Cr vendor",
    cap?.rmk4 === "FA_CAPITALISATION" && balanced(capLines) && capLines.some((l) => l.acno === vendor.acno && l.camt === 240000),
    `JV ${cap?.tran_id} ${cap?.rmk4}`);
  const [a1, a2] = assets;
  if (!a1) return;

  // ── D. depreciation ─────────────────────────────────────────────────────
  const ov = await admin("PUT", `/api/fixed-assets/${a1.id}`, { method: "SL", useful_life_months: 24, salvage_value: 0 });
  check("asset override saved (SL, 24 months, salvage 0)", ov.status === 200, ov.body?.message);
  const [y, m] = period.split("-").map(Number);
  const dim = new Date(Date.UTC(y, m, 0)).getUTCDate();
  const expected = r2((120000 / 24) * ((dim - 16 + 1) / dim));
  const prev = await manager("GET", `/api/fixed-assets/depreciation?period=${period}`);
  const row = prev.body?.preview?.rows?.find((r) => r.asset_id === a1.id);
  check(`depreciation preview: ${period} for the test asset = 120,000 ÷ 24 × ${dim - 15}/${dim} = ${expected}`, prev.status === 200 && row?.amount === expected, `got ${row?.amount} (factor ${row?.factor})`);
  const post = await manager("POST", "/api/fixed-assets/depreciation", { period });
  const jvId = post.body?.run?.jv_tran_id;
  const jv = jvId ? await prisma.transactionsMaster.findUnique({ where: { tran_id: jvId } }) : null;
  const lines = jvId ? await jvLines(jvId) : [];
  check("depreciation post: ONE journal FA_DEPRECIATION, balanced, total = preview",
    post.status === 201 && jv?.rmk4 === "FA_DEPRECIATION" && jv?.rmk5 === String(post.body.run.id) && balanced(lines) && r2(lines.reduce((t, l) => t + (l.damt || 0), 0)) === prev.body.preview.total,
    `status ${post.status} ${post.body?.message || ""}`);
  const runs = await prisma.fixedAssetDepreciationRun.count({ where: { period, status: "POSTED" } });
  check("depreciation post: one posted run for the month", runs === 1, `runs ${runs}`);
  if (jvId) {
    const ed = await admin("PUT", "/api/voucher/journal", { master: { tran_id: jvId, tran_code: 3, dated: jv.dated, rmk1: "x" }, lines: lines.map((l) => ({ acno: l.acno, damt: l.damt, camt: l.camt })) });
    check("depreciation journal: edit refused (system voucher)", ed.status === 422, `status ${ed.status} ${ed.body?.message?.slice(0, 80) || ""}`);
    const de = await admin("DELETE", "/api/voucher/journal", { tran_id: jvId });
    check("depreciation journal: delete refused (system voucher)", de.status === 422, `status ${de.status}`);
    let dbRefused = false;
    try { await prisma.$executeRawUnsafe(`UPDATE "Transactions" SET damt = damt + 1 WHERE tran_id = ${jvId}`); } catch { dbRefused = true; }
    check("depreciation journal: the database trigger refuses a direct change", dbRefused);
  }
  const again = await manager("POST", "/api/fixed-assets/depreciation", { period });
  check("second run for the same month refused", again.status === 409, `status ${again.status} ${again.body?.message || ""}`);
  const lock = await admin("PUT", `/api/fixed-assets/${a1.id}`, { useful_life_months: 36 });
  check("asset overrides locked once depreciation is posted", lock.status === 409, `status ${lock.status}`);

  // ── E. disposal ─────────────────────────────────────────────────────────
  const next = `${y + Math.floor(m / 12)}-${String((m % 12) + 1).padStart(2, "0")}`;
  const dDay = `${next}-10`;
  const ndim = new Date(Date.UTC(Number(next.slice(0, 4)), Number(next.slice(5)), 0)).getUTCDate();
  const monthCharge = r2(5000 * (10 / ndim));
  const acc = r2(expected + monthCharge);
  const nbv = r2(120000 - acc);
  const gl = r2(100000 - nbv);
  const disp = await manager("POST", "/api/voucher/fixedAssetDisposal", {
    master: { tran_code: 15, dated: dDay, rmk1: { value: "SALE", label: "Sale" }, pycd: customer.acno, rmk: "feature test" },
    lines: [{ party_name: a1.asset_no, rate: 100000 }],
  });
  const dRow = await prisma.fixedAssetDisposal.findFirst({ where: { asset_id: a1.id, reversed_at: null } });
  const dLines = dRow?.jv_tran_id ? await jvLines(dRow.jv_tran_id) : [];
  const dJv = dRow?.jv_tran_id ? await prisma.transactionsMaster.findUnique({ where: { tran_id: dRow.jv_tran_id } }) : null;
  check(`disposal: accumulated ${acc} (incl. ${monthCharge} for ${next}), NBV ${nbv}, proceeds 100,000 → ${gl < 0 ? "loss" : "gain"} ${Math.abs(gl)}`,
    disp.status === 201 && dRow && r2(dRow.accumulated) === acc && r2(dRow.nbv) === nbv && r2(dRow.gain_loss) === gl,
    `status ${disp.status} ${disp.body?.message || ""}; got acc ${dRow?.accumulated} nbv ${dRow?.nbv} g/l ${dRow?.gain_loss}`);
  const glAcno = (await prisma.faCategoryDefault.findUnique({ where: { ic_id: printer.ic_id } }))?.gainloss_acno
    ?? (await prisma.accountSetting.findUnique({ where: { key: "fa_disposal_gain_loss" } }))?.acno;
  check("disposal journal: FA_DISPOSAL, balanced, Dr customer 100,000, loss / gain on the gain-loss account",
    dJv?.rmk4 === "FA_DISPOSAL" && balanced(dLines) && dLines.some((l) => l.acno === customer.acno && l.damt === 100000) &&
      dLines.some((l) => l.acno === glAcno && r2(gl < 0 ? l.damt : l.camt) === Math.abs(gl)),
    `JV ${dRow?.jv_tran_id}`);
  const disp2 = await manager("POST", "/api/voucher/fixedAssetDisposal", {
    master: { tran_code: 15, dated: dDay, rmk1: "SALE", pycd: customer.acno }, lines: [{ party_name: a1.asset_no, rate: 1 }],
  });
  check("an asset already disposed of cannot be disposed again", disp2.status === 422, `status ${disp2.status}`);
  const dEdit = await admin("DELETE", "/api/voucher/fixedAssetDisposal", { tran_id: disp.body?.voucherId });
  check("disposal voucher cannot be deleted (reverse instead)", dEdit.status === 422, `status ${dEdit.status}`);

  // switches: disposal posting OFF → recorded only
  await set({ "fixedAssets.disposalPosting": false });
  const d3 = await manager("POST", "/api/voucher/fixedAssetDisposal", {
    master: { tran_code: 15, dated: dDay, rmk1: "SCRAP" }, lines: [{ party_name: a2.asset_no, rate: 0 }],
  });
  const d3Row = await prisma.fixedAssetDisposal.findFirst({ where: { asset_id: a2.id, reversed_at: null } });
  check("disposalPosting OFF: scrap recorded, no journal", d3.status === 201 && d3Row && d3Row.jv_tran_id == null, `status ${d3.status} ${d3.body?.message || ""}`);
  await set({ "fixedAssets.disposalPosting": true });
  if (d3.body?.voucherId) await manager("POST", `/api/fixed-assets/disposals/${d3.body.voucherId}/reverse`, { reason: "feature test" });

  // relocation ON
  const rl = await admin("POST", "/api/voucher/fixedAssetRelocation", { master: { tran_code: 16, dated: dDay, rmk: "feature test" }, lines: [{ party_name: a2.asset_no, narration4: "2", narration5: "1007" }] });
  const moved = await prisma.fixedAsset.findUnique({ where: { id: a2.id } });
  const mv = await prisma.fixedAssetMovement.findFirst({ where: { asset_id: a2.id, kind: "RELOCATION" } });
  check("relocation ON: holder moved, history kept", rl.status === 201 && moved.department_id === 2 && moved.employee_id === 1007 && mv?.from_department_id === 9, `status ${rl.status} ${rl.body?.message || ""}`);

  // put the demo disposal back
  if (demoDisposal) {
    const v = await prisma.transactionsMaster.findUnique({ where: { tran_id: demoDisposal.tran_id } });
    const asset = await prisma.fixedAsset.findUnique({ where: { id: demoDisposal.asset_id } });
    const redo = await manager("POST", "/api/voucher/fixedAssetDisposal", {
      master: { tran_code: 15, dated: v.dated.toISOString().slice(0, 10), rmk1: "SALE", pycd: demoDisposal.party_acno, rmk: v.rmk },
      lines: [{ party_name: asset.asset_no, rate: demoDisposal.proceeds }],
    });
    const redone = await prisma.fixedAssetDisposal.findFirst({ where: { asset_id: asset.id, reversed_at: null } });
    check("demo disposal posted again: same gain / loss as before", redo.status === 201 && r2(redone?.gain_loss) === r2(demoDisposal.gain_loss), `${redone?.gain_loss} vs ${demoDisposal.gain_loss}`);
  }

  // ── F. reports ──────────────────────────────────────────────────────────
  const reg = await admin("GET", `/api/reports/fixedAssetRegister?dateTo=${dDay}&status=all&limit=1000`);
  const regRow = reg.body?.allData?.find((r) => r.asset_number === a1.asset_no);
  check("Register report: the test asset, disposed, with cost / accumulated and its GRN drill", reg.status === 200 && regRow?.status === "Disposed" && regRow.cost === 120000 && r2(regRow.accumulated) === acc && regRow.tran_code === 14 && regRow.disposal_tran_id === disp.body?.voucherId, JSON.stringify(regRow)?.slice(0, 160));
  const mov = await admin("GET", `/api/reports/fixedAssetMovement?dateFrom=${period}-01&dateTo=${dDay}&asset=${a1.asset_no}&limit=1000`);
  const kinds = (mov.body?.allData || []).map((r) => r.kind_code);
  check("Movement report: addition, depreciation and disposal of the test asset, each with a voucher", mov.status === 200 && ["ADDITION", "DEPRECIATION", "DISPOSAL"].every((k) => kinds.includes(k)) && mov.body.allData.every((r) => r.tran_id && r.tran_code), kinds.join(","));
  const sch = await admin("GET", `/api/reports/fixedAssetSchedule?asset=${a2.asset_no}&status=all&limit=1000`);
  const srows = sch.body?.allData || [];
  check("Schedule report: posted month + projection to end of life (NBV down to salvage)", sch.status === 200 && srows.some((r) => r.status === "Posted" && r.tran_code === 3) && srows.some((r) => r.status === "Projected") && srows.at(-1)?.closing_nbv <= r2(srows.at(-1)?.closing_nbv) + 0.01, `${srows.length} rows, last ${srows.at(-1)?.month} ${srows.at(-1)?.closing_nbv}`);
  const dr = await admin("GET", `/api/reports/fixedAssetDisposals?dateFrom=${dDay}&dateTo=${dDay}&limit=1000`);
  const drRow = dr.body?.allData?.find((r) => r.asset_number === a1.asset_no);
  check("Disposal gain / loss report: the test disposal with NBV, proceeds and loss", dr.status === 200 && r2(drRow?.gain_loss) === gl && r2(drRow?.nbv) === nbv && drRow?.tran_code === 15 && drRow?.jv_tran_id, JSON.stringify(drRow)?.slice(0, 160));

  // ── G. registered GRN locked ────────────────────────────────────────────
  const ge = await admin("PUT", "/api/voucher/fixedAssetsGrn", { master: { tran_id: g1.body.voucherId, tran_code: 14, dated: day16, pycd: vendor.acno }, lines: [{ itcd: printer.itcd, qty: 1, rate: 1 }] });
  check("a GRN whose assets are registered cannot be edited", ge.status === 422, `status ${ge.status} ${ge.body?.message?.slice(0, 80) || ""}`);
}
