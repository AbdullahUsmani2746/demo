// lib/reports/itemInfo.js — the item's Code, Category and Sub Category on
// every report row that names an item (CLAUDE.md §10). Called once by
// /api/reports/[reportType] after the report is built: one batched lookup for
// the whole report, no report has to select these itself.
//
// A row names its item by id — itcd, item_id, material_id, finished_id, or a
// numeric product_code / itemCode — or, on a product view whose row carries
// its one voucher line, by transactions[0].itcd; else by its item code text.
// An id is taken only when the row's own item name (if any) agrees, so a
// number that happens to be an itcd but means something else is left alone.
//
// Lines nested in a row (orderDetails, transactions …) get the same.
// Adds (never overwrites): item_code, item_name, item_category,
// item_sub_category (= the Ink Series, Item.mc_id), item_itcd.
// components/Reports/itemColumns.js shows whichever the report lacks.

const ID_KEYS = ["itcd", "item_id", "itemId", "material_id", "materialId", "finished_id", "finishedId", "product_id", "product_code", "itemCode"];
const CODE_KEYS = ["item_code", "code", "inkcode", "ink_code"];
const NAME_KEYS = ["item_name", "itemName", "item", "productName", "product_name", "product", "material_name", "materialName", "finishedItem", "material_description"];

const asId = (v) => {
  const n = typeof v === "string" && /^\d+$/.test(v.trim()) ? Number(v) : v;
  return Number.isInteger(n) && n > 0 ? n : null;
};
const norm = (v) => String(v ?? "").trim().toLowerCase();

const ownId = (row) => {
  for (const k of ID_KEYS) {
    const id = asId(row?.[k]);
    if (id) return id;
  }
  return null;
};

function idsOf(row) {
  const out = [];
  for (const k of ID_KEYS) {
    const id = asId(row[k]);
    if (id) out.push(id);
  }
  // the item an itemDetails / item relation carries
  for (const k of ["itemDetails", "item", "items"]) if (row[k] && typeof row[k] === "object" && !Array.isArray(row[k]) && asId(row[k].itcd)) out.push(asId(row[k].itcd));
  // a product row carrying its lines, all of one item
  const lines = Array.isArray(row.transactions) ? row.transactions.map(ownId).filter(Boolean) : [];
  if (lines.length && lines.every((id) => id === lines[0])) out.push(lines[0]);
  return out;
}

// The row's item code text. A code of digits only ("301") is taken only when
// the row also names its item, so the name can confirm it.
const codeOf = (row) => {
  for (const k of CODE_KEYS) {
    const v = typeof row[k] === "number" ? String(row[k]) : row[k];
    if (typeof v !== "string" || !v.trim()) continue;
    if (/^\d+$/.test(v.trim()) && !nameOf(row)) continue;
    return v.trim();
  }
  return null;
};

// The row's own item name, when it has one that is plainly a name
const nameOf = (row) => {
  for (const k of NAME_KEYS) if (typeof row[k] === "string" && row[k].trim() && row[k] !== "-") return row[k];
  return null;
};

// The report's rows + the lines nested in them (an order's / voucher's lines,
// opened in the row's "Show lines" sheet): any array of objects with an itcd.
function targetsOf(rows) {
  const out = [];
  for (const r of rows) {
    if (!r || typeof r !== "object") continue;
    out.push(r);
    for (const v of Object.values(r)) {
      if (Array.isArray(v) && v.length && v[0] && typeof v[0] === "object" && ID_KEYS.some((k) => k in v[0])) out.push(...v);
    }
  }
  return out;
}

// The row's name is this item's (or "code - name" / "name (code)")
const sameItem = (name, it) => norm(name) === norm(it.item) || norm(name).includes(norm(it.item));

export async function attachItemInfo(db, reportRows) {
  if (!Array.isArray(reportRows) || !reportRows.length) return reportRows;
  const rows = targetsOf(reportRows);
  const ids = new Set();
  const codes = new Set();
  for (const r of rows) {
    if (!r || typeof r !== "object" || r.item_category !== undefined) continue;
    const list = idsOf(r);
    list.forEach((id) => ids.add(id));
    if (!list.length) {
      const c = codeOf(r);
      if (c) codes.add(c);
    }
  }
  if (!ids.size && !codes.size) return rows;

  const select = { itcd: true, code: true, item: true, itemCategories: { select: { ic_name: true } }, mainCategory: { select: { mc_name: true } } };
  let byId = new Map();
  const byCode = new Map();
  try {
    const [a, b] = await Promise.all([
      ids.size ? db.item.findMany({ where: { itcd: { in: [...ids] } }, select }) : [],
      codes.size ? db.item.findMany({ where: { code: { in: [...codes] } }, select }) : [],
    ]);
    byId = new Map(a.map((i) => [i.itcd, i]));
    // a code shared by two items names neither
    for (const i of b) byCode.set(norm(i.code), byCode.has(norm(i.code)) ? null : i);
  } catch (e) {
    console.error("attachItemInfo:", e.message);
    return reportRows;
  }

  for (const r of rows) {
    if (!r || typeof r !== "object" || r.item_category !== undefined) continue;
    const name = nameOf(r);
    let it = null;
    for (const id of idsOf(r)) {
      const cand = byId.get(id);
      if (!cand) continue;
      if (name && !sameItem(name, cand)) continue;
      it = cand;
      break;
    }
    if (!it) {
      const c = codeOf(r);
      const cand = c ? byCode.get(norm(c)) : null;
      if (cand && (!name || sameItem(name, cand))) it = cand;
    }
    if (!it) continue;
    r.item_itcd = it.itcd;
    r.item_code = it.code ?? "";
    r.item_name = r.item_name ?? it.item ?? "";
    r.item_category = it.itemCategories?.ic_name ?? "";
    r.item_sub_category = it.mainCategory?.mc_name ?? "";
  }
  return reportRows;
}
