// scripts/demo/fixedAssetDocuments.mjs — the fixed-asset part of the demo
// documents (called from scripts/demo/seed-documents.mjs; can also be run on
// an existing demo database with a `call(username, method, path, body)`).
// Everything goes through the app's own API:
//   Settings → Features: the four fixed-asset switches on (the demo company uses them)
//   Fixed Assets GRNs June – August 2026 (registered + capitalisation journals)
//   depreciation runs June – October, one relocation, one disposal (a sale at a loss)
// Items / categories are found by code / name (masters: seed-masters.mjs).
const wait = (ms) => new Promise((ok) => setTimeout(ok, ms));

export const FA_DEMO_GRNS = [
  // [date, item code, qty, unit cost, department id, employee id, make]
  ["2026-06-10", "FA-MC-01", 1, 1800000, 6, 1018, "NETZSCH"],
  ["2026-06-16", "FA-IT-01", 3, 185000, 9, 1006, "DELL"],
  ["2026-07-05", "FA-VH-01", 1, 4200000, 4, 1014, "TOYOTA"],
  ["2026-07-20", "FA-FR-01", 4, 65000, 2, 1007, "INTERWOOD"],
  ["2026-08-12", "FA-MC-02", 1, 950000, 6, 1018, "BUHLER"],
  ["2026-08-12", "FA-IT-02", 2, 48000, 9, 1006, "HP"],
];
export const FA_DEMO_RUNS = ["2026-06", "2026-07", "2026-08", "2026-09", "2026-10"];

export async function seedFixedAssetDocuments({ call, log = console.log }) {
  const get = (u, p) => call(u, "GET", p);
  const post = (u, p, b) => call(u, "POST", p, b);

  await call("admin", "PUT", "/api/settings/features", {
    values: {
      "fixedAssets.autoRegisterFromGrn": true, "fixedAssets.depreciation": true,
      "fixedAssets.disposalPosting": true, "fixedAssets.relocation": true,
    },
  });
  await wait(11000); // each route caches the features 10 s

  const items = (await get("admin", "/api/setup/fixed_asset_items?limit=500")).data || [];
  const itemByCode = new Map(items.map((i) => [i.code, i]));
  const vendors = (await get("admin", "/api/accounts/acno?group=fixed_asset_vendors,vendors")).data || [];
  const vendor = vendors.find((v) => /ENGINEERING/i.test(v.acname)) || vendors[0];

  for (const [date, code, qty, rate, dept, emp, make] of FA_DEMO_GRNS) {
    const item = itemByCode.get(code);
    if (!item) throw new Error(`Fixed asset item ${code} is missing — run seed-masters.mjs`);
    const res = await post("storekeeper", "/api/voucher/fixedAssetsGrn", {
      master: { tran_code: 14, dated: date, pycd: vendor.acno, rmk3: `INV-${code}-${date.slice(5, 7)}`, rmk4: String(dept), rmk5: String(emp), rmk: "Fixed asset purchase" },
      lines: [{ itcd: item.itcd, qty, rate, narration2: make, narration4: "YEARS" }],
    });
    log(`  FA GRN ${date} ${code} ×${qty} → #${res.voucherId}, registered ${res.registration?.registered ?? 0}`);
  }

  for (const period of FA_DEMO_RUNS) {
    const res = await post("accounts.manager", "/api/fixed-assets/depreciation", { period });
    log(`  depreciation ${period}: ${res.message}`);
  }

  const assets = (await get("admin", "/api/fixed-assets/picker?status=IN_USE")).data || [];
  const laptops = assets.filter((a) => a.item === "LAPTOP CORE I7");
  if (laptops.length >= 2) {
    await post("accountant", "/api/voucher/fixedAssetRelocation", {
      master: { tran_code: 16, dated: "2026-09-15", rmk: "Laptop moved to the sales team" },
      lines: [{ party_name: laptops[0].asset_no, narration4: "3", narration5: "1011" }],
    });
    const sold = await post("accounts.manager", "/api/voucher/fixedAssetDisposal", {
      master: { tran_code: 15, dated: "2026-11-05", rmk1: "SALE", pycd: 2007, rmk: "Old laptop sold" },
      lines: [{ party_name: laptops[1].asset_no, rate: 150000 }],
    });
    log(`  disposal #${sold.voucherId}: gain/loss ${sold.disposals?.[0]?.gain_loss}`);
  }
}
