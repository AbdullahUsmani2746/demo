// scripts/demo/features/costing.mjs — checks for the costing switches ported from
// Accounting (prisma/sql/2026-11-21_accounting_costing.sql), run from
// scripts/demo/test-features.mjs (which owns login, set() and the final reset):
//   costing.reconciliation   Stock ↔ GL reconciliation + item cost trace: 404 off, data on, permission-gated
//   costing.semiFinishedCC   start month saved only while on; cleared again
//   costing.method           Stock Activity With Rate rows carry the CC split of the chosen method
export async function runCostingPort({ admin, viewer, set, check, prisma }) {
  const now = new Date();
  const month = now.getMonth() + 1;
  const year = now.getFullYear();
  const pad = (v) => String(v).padStart(2, "0");
  const dateFrom = `${year}-${pad(month)}-01`;
  const dateTo = `${year}-${pad(month)}-${pad(new Date(year, month, 0).getDate())}`;
  const rowsOf = (b) => (Array.isArray(b) ? b : Array.isArray(b?.data) ? b.data : []);

  // ── costing.reconciliation ────────────────────────────────────────────
  {
    const item = await prisma.item.findFirst({ select: { itcd: true }, orderBy: { itcd: "asc" } });
    await set({ "costing.reconciliation": false });
    const off1 = await admin("GET", `/api/costing/stock-reconciliation?month=${month}&year=${year}`);
    const off2 = await admin("GET", `/api/costing/item-reconciliation?itcd=${item?.itcd}&month=${month}&year=${year}`);
    check("costing.reconciliation OFF: both screens refused (404)", off1.status === 404 && off2.status === 404, `${off1.status} ${off2.status}`);

    await set({ "costing.reconciliation": true });
    const on1 = await admin("GET", `/api/costing/stock-reconciliation?month=${month}&year=${year}`);
    check("costing.reconciliation ON: Stock ↔ GL reconciliation returns accounts", on1.status === 200 && Array.isArray(on1.body?.accounts), `${on1.status} ${on1.body?.error || ""}`);
    const on2 = await admin("GET", `/api/costing/item-reconciliation?itcd=${item?.itcd}&month=${month}&year=${year}&fresh=1`);
    check("costing.reconciliation ON: item cost trace returns the item", on2.status === 200 && !!on2.body?.item, `${on2.status} ${on2.body?.error || ""}`);
    const bad = await admin("GET", `/api/costing/stock-reconciliation?month=13&year=${year}`);
    check("costing.reconciliation: month 13 refused", bad.status === 400, String(bad.status));
    if (viewer) {
      const v = await viewer("GET", `/api/costing/stock-reconciliation?month=${month}&year=${year}`);
      check("costing.reconciliation: a role without costing.reconcile is refused", v.status === 403, String(v.status));
    }
    await set({ "costing.reconciliation": false });
  }

  // ── costing.semiFinishedCC ────────────────────────────────────────────
  {
    const saved = await prisma.settings.findUnique({ where: { key: "costingSemiCcFrom" }, select: { value: true } });
    const locked = await prisma.costingPeriod.findFirst({ where: { is_locked: true }, orderBy: [{ year: "desc" }, { month: "desc" }], select: { month: true, year: true } });
    // a month after the last locked one (or this month)
    const idx = locked ? locked.year * 12 + locked.month : year * 12 + month - 1;
    const target = { month: (idx % 12) + 1, year: Math.floor(idx / 12) };

    await set({ "costing.semiFinishedCC": false });
    const off = await admin("POST", "/api/costing/semi-cc", { action: "enable", ...target });
    check("costing.semiFinishedCC OFF: start month cannot be saved (409)", off.status === 409, `${off.status} ${off.body?.error || ""}`);

    await set({ "costing.semiFinishedCC": true });
    const on = await admin("POST", "/api/costing/semi-cc", { action: "enable", ...target });
    const got = await admin("GET", "/api/costing/semi-cc");
    check("costing.semiFinishedCC ON: start month saved and read back",
      on.status === 200 && got.body?.enabled === true && got.body?.from?.month === target.month,
      `${on.status} ${on.body?.error || ""} ${JSON.stringify(got.body)}`);
    if (locked) {
      const across = await admin("POST", "/api/costing/semi-cc", { action: "enable", month: locked.month, year: locked.year });
      check("costing.semiFinishedCC: start cannot move onto a locked month (422)", across.status === 422, String(across.status));
    }
    const clr = await admin("POST", "/api/costing/semi-cc", { action: "disable" });
    check("costing.semiFinishedCC: start month cleared", clr.status === 200 && clr.body?.from === null, `${clr.status} ${clr.body?.error || ""}`);
    await set({ "costing.semiFinishedCC": false });
    // restore what the demo had
    if (saved) await prisma.settings.update({ where: { key: "costingSemiCcFrom" }, data: { value: saved.value } });
  }

  // ── costing.method ────────────────────────────────────────────────────
  {
    const q = `/api/reports/stockActivityWithRate?dateFrom=${dateFrom}&dateTo=${dateTo}&limit=5000`;
    await set({ "costing.method": "average" });
    const a = rowsOf((await admin("GET", q)).body);
    check("costing.method average: rows flag carries_cc, no input CC",
      a.length > 0 && a.every((r) => typeof r.carries_cc === "boolean" && !Number(r.cc_input_cost)),
      `${a.length} rows`);
    await set({ "costing.method": "blendedCC" });
    const b = rowsOf((await admin("GET", q)).body);
    const total = (rows) => rows.reduce((s, r) => s + Number(r.closing_value || 0), 0);
    check("costing.method blendedCC: report runs, stock value unchanged by the CC split",
      b.length === a.length && Math.abs(total(a) - total(b)) < 0.01,
      `${a.length}/${b.length} rows, ${total(a)} vs ${total(b)}`);
    const cogm = await admin("GET", `/api/reports/costOfGoodsManufactured?month=${month}&year=${year}`);
    check("costing.method blendedCC: COGM report answers", cogm.status === 200, String(cogm.status));
    await set({ "costing.method": "average" });
  }
}
