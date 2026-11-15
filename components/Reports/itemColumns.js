// components/Reports/itemColumns.js — every report that lists items shows the
// item's Code, Category and Sub Category (CLAUDE.md §10), without each report
// declaring them. The API puts item_code / item_category / item_sub_category
// on every row that names an item (lib/reports/itemInfo.js); this reads the
// rows to see which of them the report already shows and adds the rest next
// to the item's name. A column that shows the item's internal number (itcd)
// under a "Code" heading is renamed "Item ID", so "Code" always means the code.
//
// A report opts out with `itemColumns: false` in its config.
// Pure — no React — so the table and the exports get the same columns.

import { rawValue } from "./layout";

export const ITEM_FIELDS = { code: "item_code", category: "item_category", sub: "item_sub_category" };

const ADDED = [
  { key: "code", col: { field: ITEM_FIELDS.code, headerName: "Code", width: 18 } },
  { key: "category", col: { field: ITEM_FIELDS.category, headerName: "Category", width: 22 } },
  { key: "sub", col: { field: ITEM_FIELDS.sub, headerName: "Sub Category", width: 22 } },
];

const norm = (v) => String(v ?? "").trim().toLowerCase();

// Does this column show `key` of the row (≥ 80% of the sample rows)?
function shows(col, rows, key) {
  let n = 0;
  let hit = 0;
  for (const r of rows) {
    const want = r[key];
    if (want === null || want === undefined || want === "") continue;
    n += 1;
    const got = rawValue(col, r);
    if (got !== null && got !== undefined && norm(got) === norm(want)) hit += 1;
  }
  return n > 0 && hit / n >= 0.8;
}

// Does this column show the code AND the name together (≥ 80% of rows)?
function mergesCodeAndName(col, rows) {
  let n = 0;
  let hit = 0;
  for (const r of rows) {
    if (!r.item_code || !r.item_name) continue;
    n += 1;
    const got = norm(rawValue(col, r));
    const code = norm(r.item_code);
    const name = norm(r.item_name);
    if (got && got !== code && got !== name && got.includes(code) && got.includes(name)) hit += 1;
  }
  return n > 0 && hit / n >= 0.8;
}

/** Item rows of a report (the ones the API named), up to `max` for checking. */
export function itemRows(rows, max = 300) {
  const out = [];
  for (const r of rows || []) {
    if (r && r.item_itcd) out.push(r);
    if (out.length >= max) break;
  }
  return out;
}

/** Columns + the item Code / Category / Sub Category the report lacks. */
export function withItemColumns(columns, rows, config) {
  if (!Array.isArray(columns) || !columns.length || config?.itemColumns === false) return columns;
  const sample = itemRows(rows);
  if (!sample.length) return columns;

  // An itcd shown as "Code" / "Product Code" / "MM code" → "Item ID"
  let cols = columns.map((c) =>
    /\b(code|mm)\b/i.test(c.headerName || "") && shows(c, sample, "item_itcd") && !shows(c, sample, ITEM_FIELDS.code)
      ? { ...c, headerName: "Item ID" }
      : c,
  );

  // Code and name merged in one column ("F-26979 - PP GREEN") → two columns:
  // Code, then the item's name under the column's own heading.
  cols = cols.flatMap((c) =>
    mergesCodeAndName(c, sample)
      ? [
          { field: ITEM_FIELDS.code, headerName: "Code", width: 18 },
          // same key (pinned / views still find it), now the name alone
          { ...c, valueGetter: ({ row }) => row?.item_name ?? rawValue(c, row), valueFormatter: undefined, renderCell: undefined, headerName: /code/i.test(c.headerName || "") ? "Item" : c.headerName || "Item" },
        ]
      : [c],
  );

  const missing = ADDED.filter((a) => !cols.some((c) => shows(c, sample, ITEM_FIELDS[a.key])));
  if (!missing.length) return cols;

  // Placed after the item's name; else after its id / code.
  let at = cols.findIndex((c) => shows(c, sample, "item_name"));
  if (at < 0) at = cols.findIndex((c) => shows(c, sample, "item_itcd") || shows(c, sample, ITEM_FIELDS.code));
  const add = missing.map((m) => m.col);
  // the Code goes before the name, the categories after it
  const code = add.filter((c) => c.field === ITEM_FIELDS.code);
  const cats = add.filter((c) => c.field !== ITEM_FIELDS.code);
  // A report that shows no item (a customer summary of dispatches) gets none
  if (at < 0) return cols;
  cols = [...cols];
  cols.splice(at + 1, 0, ...cats);
  cols.splice(at, 0, ...code);
  return cols;
}

/**
 * Category › Sub Category row groups for a report whose rows are one per item
 * and that has no grouping of its own — null otherwise. Rows of a voucher
 * list (an item on many rows) keep their own order.
 */
export function itemRowGroups(rows) {
  const sample = itemRows(rows, 2000);
  if (sample.length < 2 || sample.length < (rows || []).length * 0.8) return null;
  if (new Set(sample.map((r) => r.item_itcd)).size < sample.length) return null;
  if (!sample.some((r) => r[ITEM_FIELDS.category])) return null;
  // Grouped on the API's own fields, so it works whatever the report calls its columns
  return [
    { field: ITEM_FIELDS.category, title: "Category", label: (r) => r[ITEM_FIELDS.category] || "No category", subtotalLabel: "Total" },
    { field: ITEM_FIELDS.sub, title: "Sub Category", label: (r) => r[ITEM_FIELDS.sub] || "No sub category", subtotalLabel: "Total" },
  ];
}
