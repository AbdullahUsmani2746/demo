// Wide-report layout (CLAUDE.md rule 15): turns a report's `columns` plus its
// optional `layout` entry in components/Reports/config.js into one model the
// viewer, the row panel, the phone cards and the exports all read. Pure
// functions only — no React, no DOM — so the same rules hold on screen and on
// paper.
//
//   layout: {                      // or (filters) => ({ ... })
//     pinned:     ["code", "name"],                       // identity, kept on the left
//     groups:     [{ id, label, fields: [...], foldTo }], // header band over related columns
//     views:      [{ id, label, fields }],                 // fields omitted = every column
//     defaultView: "qty",
//     rowGroupBy: "category" | ["a", "b"] | [{ field, label(row), contiguous, subtotalLabel }],
//     unitSwitch: { label, options: [{ id, label, fields }], default },
//     card:       { title, subtitle, figures: [field | { label, value(row), type }] },
//     voucher:    (row) => ({ tran_id, tran_code }),      // when the row names its voucher differently
//     groupRows:  { ... },                                 // grouped documents / sections — see below
//   }
//
// groupRows — reports whose API returns a `row_type` stream (document header,
// its lines, a total; sections; hierarchies) are read as it comes, WITHOUT
// changing the API. Reference entry: `payment` (voucher header › lines).
//
//   groupRows: {
//     levels: [                       // outermost first; a level opens on its header row or,
//       {                             // with `key`, whenever a detail row's key changes
//         header:  "voucher_header" | [...],  // row type(s) that open the group (becomes the group row)
//         total:   "voucher_total"  | [...],  // row type(s) that close it (dropped — recomputed —
//                                             //   unless keepTotal)
//         key:     "field" | (row) => k,      // header-less level: group by this on the detail rows
//         label:   (headerOrFirstRow, node) => "…",  // group row text (default: row.label / key)
//         headerFields: ["tran_id", "dated"],  // header values shown in their own columns on the group row
//         inherit: ["dated", "vr_no"],         // copy into lines where blank (flat view, search, sort)
//         keepTotal: true,                     // subtotal = the server's total row (not a plain sum)
//         totalFrom: "header",                 // …or the header row's own figures
//         subtotal: false,                     // no subtotal row for this level
//         title:   "Voucher",                  // name in "Group rows by …"
//       },
//     ],
//     detail:  "detail_row" | [...],  // leaf rows (omitted = every row not named elsewhere)
//     extra:   { rate_line: "line", cogm_line: "total" } | [...],  // shown where they stand, never summed
//     drop:    [...],                 // ignored row types
//     grandTotal: "sum" (default, Σ leaves) | "groups" (Σ top-level subtotals) | false | "<row_type>" (server row kept)
//   }
//
// The engine builds the groups (fold / unfold, expand / collapse all, count,
// subtotals per showTotal / totalRatio / totalType column), keeps the server's
// order of groups and lines (a sort header sorts lines inside their group
// only), matches search on the header OR the lines (a matching header keeps
// all its lines), opens the voucher from the group row when the header has
// tran_id + tran_code, and hands the same items to cards and exports.
//
// Without a layout the defaults below still apply: the first identity column
// is pinned (the first two when the second is a name), all-empty numeric
// columns hide, the totals row stays pinned, rows open the detail panel and
// phones get cards.

import { cleanDisplay } from "@/lib/reports/displayPrefs";

export const NUMERIC_TYPES =new Set(["number", "currency", "percent", "percentage", "integer", "float"]);

export const isNumericCol = (col) => NUMERIC_TYPES.has(col?.type);
export const isAmountCol = (col) => col?.type === "currency";
export const isPercentCol = (col) => col?.type === "percent" || col?.type === "percentage";

// A column's key: its field, or the AG-Grid style colId a few configs use.
// Duplicates get a suffix so React keys and Sets stay unique.
export function keyColumns(columns = []) {
  const seen = new Set();
  return columns.map((col, i) => {
    let key = col.field ?? col.colId ?? `col${i}`;
    if (seen.has(key)) key = `${key}#${i}`;
    seen.add(key);
    return { ...col, key };
  });
}

// The value a column shows for a row. valueGetters in config.js are written
// both ways — ({ row }) and AG-Grid's ({ data }) — so both are passed.
export function rawValue(col, row) {
  if (!row) return undefined;
  if (col.valueGetter) {
    try {
      return col.valueGetter({ row, data: row, value: col.field ? row[col.field] : undefined, colDef: col });
    } catch {
      return undefined;
    }
  }
  return col.field ? row[col.field] : undefined;
}

export function numValue(col, row) {
  const v = Number(rawValue(col, row));
  return Number.isFinite(v) ? v : 0;
}

// ── the user's Display settings (lib/reports/displayPrefs.js) ──────────────
// One per browser tab: hooks/useReportDisplay.js sets it, and every formatter
// below (table, cards, row panel, record lines, KPI strip, Excel / PDF) reads it.
let DISPLAY = cleanDisplay({});
export const setReportDisplay = (d) => {
  DISPLAY = cleanDisplay(d);
};
export const getReportDisplay = () => DISPLAY;

// Amount scales of "Show amounts as": [divisor, suffix, fixed decimals].
export const AMOUNT_SCALES = {
  full: [1, "", null],
  k: [1e3, "k", 1],
  lakh: [1e5, " L", 2],
  crore: [1e7, " Cr", 2],
};

const nfCache = new Map();
const nf = (min, max) => {
  const locale = DISPLAY.grouping === "lakh" ? "en-IN" : "en-US";
  const k = `${locale}:${min}:${max}`;
  if (!nfCache.has(k)) nfCache.set(k, new Intl.NumberFormat(locale, { minimumFractionDigits: min, maximumFractionDigits: max }));
  return nfCache.get(k);
};
const signed = (n, text) => (n < 0 ? (DISPLAY.brackets ? `(${text})` : `-${text}`) : text);

/** An amount in the user's grouping / scale / decimals / negatives style. */
export function formatAmount(n, scale = DISPLAY.scale) {
  const [div, suffix, fixed] = AMOUNT_SCALES[scale] || AMOUNT_SCALES.full;
  const d = fixed ?? (DISPLAY.decimals ? 2 : 0);
  return signed(n, `${nf(d, d).format(Math.abs(n) / div)}${suffix}`);
}

// Which "Make bold" group a number column belongs to.
const RATE_LIKE = /rate|price|cost\s*per|unit\s*cost|avg|average/i;
export function numberKind(col) {
  if (!isNumericCol(col) || isPercentCol(col)) return null;
  if (RATE_LIKE.test(`${col.field || ""} ${col.headerName || ""}`)) return "rate";
  return isAmountCol(col) ? "amount" : "qty";
}

const parseDate = (v) => {
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v !== "string" && typeof v !== "number") return null;
  if (typeof v === "string") {
    const dmy = /^(\d{2})-(\d{2})-(\d{4})$/.exec(v);
    if (dmy) return new Date(+dmy[3], +dmy[2] - 1, +dmy[1]);
  }
  const d = new Date(v);
  return isNaN(d) ? null : d;
};
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
export const formatDateValue = (v) => {
  const d = parseDate(v);
  if (!d) return v == null ? "" : String(v);
  const dd = String(d.getDate()).padStart(2, "0");
  if (DISPLAY.dateFmt === "numeric") return `${dd}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  return `${dd} ${MONTHS[d.getMonth()]} ${d.getFullYear()}`;
};
export const dateSortValue = (v) => parseDate(v)?.getTime() ?? -Infinity;

// Text for a cell. amounts: "full" | "k" | "lakh" | "crore" (amount columns
// only; default = the user's "Show amounts as"). Grouping (12,34,567 or
// 1,234,567), decimals and negatives follow the user's Display settings.
// Zero numbers come back as "" so the caller can draw a muted dash.
export function formatValue(col, v, { amounts = DISPLAY.scale } = {}) {
  if (isNumericCol(col)) {
    if (v === null || v === undefined || v === "") return "";
    const n = Number(v);
    if (!Number.isFinite(n)) return String(v);
    if (n === 0) return "";
    if (isPercentCol(col)) return `${signed(n, nf(2, 2).format(Math.abs(n)))}%`;
    if (isAmountCol(col)) return formatAmount(n, amounts);
    if (col.type === "integer") return signed(n, nf(0, 0).format(Math.abs(n)));
    return signed(n, nf(0, 3).format(Math.abs(n)));
  }
  if (col.type === "date") return formatDateValue(v);
  if (v === null || v === undefined) return "";
  if (Array.isArray(v)) return v.join(", ");
  if (typeof v === "object") return "";
  return String(v);
}

export const cellText = (col, row, opts) => formatValue(col, rawValue(col, row), opts);

const NAME_LIKE = /name|item|product|customer|account|vendor|party|description|employee|supplier|title|ac\s?name|acname/i;
const looksLikeName = (col) => NAME_LIKE.test(`${col.field || ""} ${col.headerName || ""}`);

const asArray = (v) => (v === undefined || v === null ? [] : Array.isArray(v) ? v : [v]);

// Resolve the report's layout entry against the columns it has right now.
// `legacyGrouping` is the older config.rowGrouping, already checked for its
// activateWhen — it becomes a contiguous row group with the same labels.
export function resolveLayout({ config, filters, columns, legacyGrouping, itemGroups }) {
  // `wideLayout` is for reports whose `layout` is still the "nested" export
  // switch (dispatch, dispatchReturn, salesOrderBalance).
  let spec = config?.wideLayout ?? config?.layout;
  if (typeof spec === "function") {
    try {
      spec = spec(filters || {});
    } catch (e) {
      console.error("layout(filters) failed:", e);
      spec = null;
    }
  }
  // layout: "nested" is the older export-only switch, not a wide layout.
  if (!spec || typeof spec !== "object") spec = {};

  const keyed = keyColumns(columns);
  const keys = new Set(keyed.map((c) => c.key));
  const byKey = new Map(keyed.map((c) => [c.key, c]));
  const known = (f) => keys.has(f);

  // Pinned identity columns
  let pinned = asArray(spec.pinned).filter(known);
  if (!pinned.length) {
    const marked = keyed.filter((c) => c.pinned === "left").map((c) => c.key);
    if (marked.length) pinned = marked.slice(0, 3);
  }
  if (!pinned.length && keyed.length > 1) {
    const [a, b] = keyed;
    if (a && !isNumericCol(a)) {
      pinned = [a.key];
      if (b && !isNumericCol(b) && looksLikeName(b)) pinned.push(b.key);
    }
  }
  // The item's Code (added by itemColumns.js) shows in every view: pinned
  // first, ahead of the name; the internal Item ID gives way to it.
  if (known("item_code")) {
    pinned = ["item_code", ...pinned.filter((k) => k !== "item_code" && byKey.get(k)?.headerName !== "Item ID")];
  }
  const pinnedSet = new Set(pinned);

  // Column groups (header band). Without a layout, groupHeader runs become groups.
  let groups = asArray(spec.groups)
    .map((g, i) => ({
      id: String(g.id ?? `g${i}`),
      label: g.label ?? String(g.id ?? ""),
      fields: asArray(g.fields).filter((f) => known(f) && !pinnedSet.has(f)),
      foldTo: g.foldTo,
    }))
    .filter((g) => g.fields.length);
  if (!groups.length && keyed.some((c) => c.groupHeader)) {
    keyed.forEach((c) => {
      if (!c.groupHeader || pinnedSet.has(c.key)) return;
      const last = groups[groups.length - 1];
      if (last && last.label === c.groupHeader) last.fields.push(c.key);
      else groups.push({ id: `gh${groups.length}`, label: c.groupHeader, fields: [c.key] });
    });
  }
  const groupOf = new Map();
  groups.forEach((g) => g.fields.forEach((f) => groupOf.set(f, g)));

  // Views — ready-made column sets. fields omitted / null = every column.
  const views = asArray(spec.views).map((v, i) => ({
    id: String(v.id ?? `v${i}`),
    label: v.label ?? String(v.id ?? `View ${i + 1}`),
    fields: v.fields ? new Set(asArray(v.fields)) : null,
  }));
  const defaultView = views.find((v) => v.id === spec.defaultView)?.id ?? views[0]?.id ?? null;

  // Row groups
  let rowGroupBy = asArray(spec.rowGroupBy)
    .map((g) => (typeof g === "string" ? { field: g } : g))
    .filter((g) => g && g.field);
  if (!rowGroupBy.length && legacyGrouping?.by) {
    const fields = legacyGrouping.labelFields || [legacyGrouping.by];
    const sep = legacyGrouping.labelSeparator ?? " — ";
    rowGroupBy = [
      {
        field: legacyGrouping.by,
        contiguous: true,
        keepColumn: true,
        subtotalLabel: legacyGrouping.subtotalLabel || "Total",
        labelOfRows: (rows) =>
          fields
            .map((f) => rows.find((r) => r[f] !== null && r[f] !== undefined && r[f] !== "")?.[f])
            .filter((v) => v !== null && v !== undefined && v !== "")
            .join(sep),
      },
    ];
  }
  // A report of one row per item with no grouping of its own: Category ›
  // Sub Category (components/Reports/itemColumns.js itemRowGroups).
  if (!rowGroupBy.length && !spec.groupRows && Array.isArray(itemGroups) && itemGroups.length) rowGroupBy = itemGroups;
  rowGroupBy = rowGroupBy.map((g) => ({
    ...g,
    title: g.title || byKey.get(g.field)?.headerName || g.field,
  }));
  // Grouped documents / sections from a row_type stream (wins over rowGroupBy).
  const groupRows = normalizeGroupRows(spec.groupRows);

  // Unit switch (paired KG / LTR style columns)
  let unitSwitch = null;
  if (spec.unitSwitch?.options?.length) {
    const options = spec.unitSwitch.options.map((o) => ({ id: String(o.id), label: o.label ?? String(o.id), fields: asArray(o.fields) }));
    unitSwitch = {
      label: spec.unitSwitch.label || "Unit",
      options,
      default: options.find((o) => o.id === spec.unitSwitch.default)?.id ?? options[0].id,
    };
  }

  // Phone card
  const textCols = keyed.filter((c) => !isNumericCol(c));
  const card = {
    title: spec.card?.title ?? pinned[pinned.length - 1] ?? textCols[0]?.key ?? null,
    subtitle: spec.card?.subtitle ?? (pinned.length > 1 ? pinned[0] : null),
    figures: asArray(spec.card?.figures).slice(0, 4),
  };

  return {
    hasLayout: !!((config?.wideLayout ?? config?.layout) && typeof (config?.wideLayout ?? config?.layout) !== "string"),
    columns: keyed,
    byKey,
    pinned,
    pinnedSet,
    groups,
    groupOf,
    views,
    defaultView,
    rowGroupBy: groupRows ? [] : rowGroupBy,
    groupRows,
    unitSwitch,
    card,
    voucher: typeof spec.voucher === "function" ? spec.voucher : null,
  };
}

// ── groupRows: row_type streams → groups ─────────────────────────────────────
const asSet = (v) => new Set(asArray(v));

export function normalizeGroupRows(spec) {
  if (!spec || typeof spec !== "object") return null;
  const levels = asArray(spec.levels).map((l, i) => ({
    ...l,
    index: i,
    headers: asSet(l.header),
    totals: asSet(l.total),
    keyOf: typeof l.key === "function" ? l.key : l.key ? (row) => row?.[l.key] : null,
    headerFields: l.headerFields ? new Set(asArray(l.headerFields)) : null,
    inherit: asArray(l.inherit),
    title: l.title || (typeof l.key === "string" ? l.key : asArray(l.header)[0]) || `Level ${i + 1}`,
  }));
  let extra = new Map();
  if (Array.isArray(spec.extra)) spec.extra.forEach((t) => extra.set(t, "line"));
  else if (spec.extra && typeof spec.extra === "object") extra = new Map(Object.entries(spec.extra));
  return {
    levels,
    detail: spec.detail ? asSet(spec.detail) : null,
    extra,
    drop: asSet(spec.drop),
    grandTotal: spec.grandTotal === undefined ? "sum" : spec.grandTotal,
  };
}

// Walk the stream once into a tree. Nodes: { id, level, key, header, total,
// children: [node | { row } | { row, extra }], leaves: [row] }.
export function buildGroupTree(gr, rows = []) {
  const root = { id: "", level: -1, children: [], leaves: [] };
  const stack = []; // open nodes, outermost first
  let grandRow = null;
  const all = [];
  const top = () => stack[stack.length - 1] || root;
  const closeFrom = (L) => {
    while (stack.length && stack[stack.length - 1].level >= L) stack.pop();
  };
  const open = (L, key, header) => {
    closeFrom(L);
    const parent = top();
    const node = { id: `${parent.id}/${parent.children.length}`, level: L, key, header, total: null, children: [], leaves: [], parent };
    parent.children.push({ node });
    stack.push(node);
    return node;
  };
  const headerLevel = (t) => gr.levels.findIndex((l) => l.headers.has(t));
  const totalLevel = (t) => gr.levels.findIndex((l) => l.totals.has(t));

  for (const raw of rows) {
    if (!raw || typeof raw !== "object") continue;
    const t = raw.row_type;
    if (gr.drop.has(t)) continue;
    if (typeof gr.grandTotal === "string" && gr.grandTotal !== "sum" && gr.grandTotal !== "groups" && t === gr.grandTotal) {
      grandRow = raw;
      continue;
    }
    const hl = t !== undefined ? headerLevel(t) : -1;
    if (hl >= 0) {
      const lvl = gr.levels[hl];
      open(hl, lvl.keyOf ? lvl.keyOf(raw) : undefined, raw);
      all.push(raw);
      continue;
    }
    const tl = t !== undefined ? totalLevel(t) : -1;
    if (tl >= 0) {
      const node = stack.find((n) => n.level === tl);
      if (node) {
        node.total = raw;
        closeFrom(tl);
      }
      continue;
    }
    if (gr.extra.has(t)) {
      top().children.push({ row: raw, extra: gr.extra.get(t) });
      all.push(raw);
      continue;
    }
    if (gr.detail && !gr.detail.has(t)) continue;
    // Header-less levels open / change on the line's key.
    gr.levels.forEach((lvl, L) => {
      if (!lvl.keyOf || lvl.headers.size) return;
      const k = lvl.keyOf(raw) ?? "";
      const cur = stack.find((n) => n.level === L);
      if (!cur || cur.key !== k) open(L, k, null);
    });
    // Lines inherit blank fields from their group's header (or first line).
    let row = raw;
    stack.forEach((n) => {
      const lvl = gr.levels[n.level];
      if (!lvl.inherit.length) return;
      const src = n.header || n.first;
      if (!src) return;
      lvl.inherit.forEach((f) => {
        if ((row[f] === undefined || row[f] === null || row[f] === "") && src[f] !== undefined && src[f] !== "") {
          if (row === raw) row = { ...raw };
          row[f] = src[f];
        }
      });
    });
    stack.forEach((n) => {
      if (!n.first) n.first = row;
      n.leaves.push(row);
    });
    root.leaves.push(row);
    top().children.push({ row });
    all.push(row);
  }
  return { root, grandRow, all, leaves: root.leaves };
}

const leafCount = (node) => node.leaves.length;

// Figures of a server row (total row / header) for the totalling columns.
export function totalsFromRow(model, row) {
  const out = {};
  if (!row) return out;
  model.columns.forEach((col) => {
    if (!col.showTotal && !col.totalRatio) return;
    const v = rawValue(col, row);
    if (v !== undefined && v !== null && v !== "" && Number.isFinite(Number(v))) out[col.key] = Number(v);
    else if (col.totalRatio) {
      const num = model.byKey.get(col.totalRatio.num);
      const den = model.byKey.get(col.totalRatio.den);
      const d = den ? numValue(den, row) : 0;
      out[col.key] = d ? ((num ? numValue(num, row) : 0) / d) * (Number(col.totalRatio.scale) || 1) : 0;
    }
  });
  return out;
}

const sumTotals = (model, list) => {
  const out = {};
  model.columns.forEach((col) => {
    if (!col.showTotal || col.totalRatio || col.totalType === "last") return;
    out[col.key] = list.reduce((a, t) => a + (Number(t[col.key]) || 0), 0);
  });
  // ratios over the summed parts
  model.columns.forEach((col) => {
    if (!col.totalRatio) return;
    const d = out[col.totalRatio.den];
    out[col.key] = d ? ((out[col.totalRatio.num] || 0) / d) * (Number(col.totalRatio.scale) || 1) : 0;
  });
  return out;
};

export const groupLabel = (gr, node) => {
  const lvl = gr.levels[node.level];
  const src = node.header || node.first || {};
  if (lvl?.label) {
    try {
      return String(lvl.label(src, node) ?? "");
    } catch {
      return "";
    }
  }
  return String(src.label ?? node.key ?? "");
};

// A node's subtotal: the server's figures (keepTotal / totalFrom) or a sum.
function nodeTotals(model, gr, node) {
  const lvl = gr.levels[node.level];
  if (lvl.totalFrom === "header" && node.header) return totalsFromRow(model, node.header);
  if (lvl.keepTotal && node.total) return totalsFromRow(model, node.total);
  return computeTotals(model, node.leaves);
}

// Search over the tree: a matching header keeps the whole group; otherwise
// only matching lines stay, and a group with none goes. Extra lines hide
// while searching.
function filterNode(model, gr, node, term) {
  if (!term) return node;
  const head = node.header;
  if (node.level >= 0 && ((head && rowMatches(model, head, term)) || groupLabel(gr, node).toLowerCase().includes(term))) return node;
  const children = [];
  const leaves = [];
  node.children.forEach((c) => {
    if (c.node) {
      const n = filterNode(model, gr, c.node, term);
      if (n && n.leaves.length) {
        children.push({ node: n });
        leaves.push(...n.leaves);
      }
    } else if (!c.extra && rowMatches(model, c.row, term)) {
      children.push(c);
      leaves.push(c.row);
    }
  });
  return { ...node, children, leaves };
}

// Every group id in the tree (Expand / Collapse all).
export function groupTreeIds(tree) {
  const ids = [];
  const walk = (node) =>
    node.children.forEach((c) => {
      if (c.node) {
        ids.push(c.node.id);
        walk(c.node);
      }
    });
  walk(tree.root);
  return ids;
}

// Display items for a groupRows report — the same item shapes buildItems
// gives (group / row / sub), plus `row` + `fields` on a group whose header
// shows in the columns, `extra` on build-up lines and `fromServer` on a kept
// subtotal. grouped=false → the lines flat (extras at the end).
export function buildGroupedItems(model, tree, { search = "", collapsed = new Set(), sortRows = (r) => r, withTotals = true, grouped = true } = {}) {
  const gr = model.groupRows;
  const root = filterNode(model, gr, tree.root, search);
  const items = [];
  const topTotals = [];

  if (!grouped) {
    sortRows(root.leaves).forEach((row) => items.push({ type: "row", row, depth: 0 }));
    if (!search) {
      const extras = (node) =>
        node.children.forEach((c) => (c.node ? extras(c.node) : c.extra && items.push({ type: "row", row: c.row, depth: 0, extra: c.extra })));
      extras(root);
    }
  } else {
    const walk = (node, depth) => {
      let run = [];
      const flush = () => {
        if (!run.length) return;
        sortRows(run).forEach((row) => items.push({ type: "row", row, depth }));
        run = [];
      };
      node.children.forEach((c) => {
        if (c.node) {
          flush();
          const n = c.node;
          const lvl = gr.levels[n.level];
          const label = groupLabel(gr, n) || (lvl.title ? `No ${lvl.title}` : "");
          const isCollapsed = collapsed.has(n.id);
          items.push({
            type: "group",
            id: n.id,
            label,
            count: leafCount(n),
            depth,
            collapsed: isCollapsed,
            row: n.header || null,
            fields: n.header && lvl.headerFields ? lvl.headerFields : null,
          });
          if (!isCollapsed) walk(n, depth + 1);
          const totals = nodeTotals(model, gr, n);
          if (node === root) topTotals.push(totals);
          if (withTotals && lvl.subtotal !== false && (leafCount(n) > 0 || (lvl.keepTotal && n.total))) {
            const sl = typeof lvl.subtotalLabel === "function" ? lvl.subtotalLabel(n.header || n.first || {}, n) : `${lvl.subtotalLabel || "Total"} ${label}`.trim();
            items.push({
              type: "sub",
              id: `${n.id}/sub`,
              label: sl,
              totals,
              rows: n.leaves,
              depth,
              fromServer: !!((lvl.keepTotal && n.total) || (lvl.totalFrom === "header" && n.header)),
            });
          }
        } else if (c.extra) {
          flush();
          items.push({ type: "row", row: c.row, depth, extra: c.extra });
        } else {
          run.push(c.row);
        }
      });
      flush();
    };
    walk(root, 0);
  }

  let totals = {};
  const g = gr.grandTotal;
  if (g === false) totals = null;
  else if (g === "groups") {
    if (!grouped) root.children.forEach((c) => c.node && topTotals.push(nodeTotals(model, gr, c.node)));
    totals = sumTotals(model, topTotals);
  } else if (typeof g === "string" && g !== "sum") totals = search ? computeTotals(model, root.leaves) : totalsFromRow(model, tree.grandRow);
  else totals = computeTotals(model, root.leaves);

  return { items, leaves: root.leaves, totals };
}

// Numeric columns with no figure in any row — hidden while "Hide groups /
// columns with no figures" is on. Pinned columns are never empty-hidden.
export function emptyColumnKeys(model, rows) {
  const out = new Set();
  model.columns.forEach((col) => {
    if (!isNumericCol(col) || model.pinnedSet.has(col.key)) return;
    if (!rows.some((r) => numValue(col, r) !== 0)) out.add(col.key);
  });
  return out;
}

// Grand total / subtotal of a set of rows. A column totals when it says so:
//   showTotal: true            → sum   (totalType: "last" → last non-empty value)
//   totalRatio: { num, den }   → Σ num / Σ den (weighted rate), num/den are column keys
//                                (scale: 100 → a percentage, e.g. margin % on cost)
export function computeTotals(model, rows) {
  const out = {};
  const sums = new Map();
  const sumOf = (key) => {
    if (sums.has(key)) return sums.get(key);
    const col = model.byKey.get(key);
    const s = col ? rows.reduce((a, r) => a + numValue(col, r), 0) : 0;
    sums.set(key, s);
    return s;
  };
  model.columns.forEach((col) => {
    if (col.totalRatio) {
      const den = sumOf(col.totalRatio.den);
      out[col.key] = den ? (sumOf(col.totalRatio.num) / den) * (Number(col.totalRatio.scale) || 1) : 0;
    } else if (col.showTotal) {
      if (col.totalType === "last") {
        let v = 0;
        for (let i = rows.length - 1; i >= 0; i--) {
          const x = rawValue(col, rows[i]);
          if (x !== null && x !== undefined && x !== "") { v = Number(x) || 0; break; }
        }
        out[col.key] = v;
      } else {
        out[col.key] = sumOf(col.key);
      }
    }
  });
  return out;
}
export const hasTotals = (model) => model.columns.some((c) => c.showTotal || c.totalRatio);

// A card figure → { key, label, col, get(row) }.
export function cardFigures(model, visibleCols) {
  const figs = model.card.figures.length
    ? model.card.figures
    : visibleCols.filter((c) => isNumericCol(c) && !model.pinnedSet.has(c.key)).slice(0, 4).map((c) => c.key);
  return figs
    .map((f, i) => {
      if (typeof f === "string") {
        const col = model.byKey.get(f);
        return col ? { key: f, label: col.headerName, col, get: (row) => rawValue(col, row) } : null;
      }
      if (f && typeof f.value === "function") {
        const col = { key: `fig${i}`, headerName: f.label, type: f.type || "number" };
        return { key: col.key, label: f.label, col, get: (row) => f.value(row) };
      }
      return null;
    })
    .filter(Boolean);
}

export const fieldText = (model, f, row) => {
  if (!f) return "";
  if (typeof f === "function") return String(f(row) ?? "");
  const col = model.byKey.get(f);
  return col ? cellText(col, row) : String(row?.[f] ?? "");
};

// Build the display list: group rows, data rows and subtotal rows.
//   levels    : model.rowGroupBy (empty = flat)
//   collapsed : Set of group paths that are folded to their subtotal
//   sortRows  : (rows) => rows   — applied inside each group
export function buildItems(model, rows, { levels = [], collapsed = new Set(), sortRows = (r) => r, withTotals = true }) {
  const items = [];
  const walk = (list, depth, path) => {
    if (depth >= levels.length) {
      sortRows(list).forEach((row) => items.push({ type: "row", row, depth }));
      return;
    }
    const lvl = levels[depth];
    const groups = [];
    if (lvl.contiguous) {
      list.forEach((row) => {
        const k = row[lvl.field] ?? "";
        const last = groups[groups.length - 1];
        if (last && last.key === k) last.rows.push(row);
        else groups.push({ key: k, rows: [row] });
      });
    } else {
      const map = new Map();
      list.forEach((row) => {
        const k = row[lvl.field] ?? "";
        if (!map.has(k)) { map.set(k, { key: k, rows: [] }); groups.push(map.get(k)); }
        map.get(k).rows.push(row);
      });
      groups.sort((a, b) => String(a.key).localeCompare(String(b.key), undefined, { numeric: true }));
    }
    groups.forEach((g, gi) => {
      const id = `${path}/${gi}:${g.key}`;
      const label = lvl.labelOfRows
        ? lvl.labelOfRows(g.rows)
        : lvl.label
          ? String(lvl.label(g.rows[0]) ?? "")
          : g.key === "" ? `No ${lvl.title}` : String(g.key);
      const isCollapsed = collapsed.has(id);
      items.push({ type: "group", id, label: label || `No ${lvl.title}`, count: g.rows.length, depth, collapsed: isCollapsed });
      if (!isCollapsed) walk(g.rows, depth + 1, id);
      if (withTotals) {
        items.push({
          type: "sub",
          id: `${id}/sub`,
          label: `${lvl.subtotalLabel || "Subtotal"} ${label}`.trim(),
          totals: computeTotals(model, g.rows),
          rows: g.rows,
          depth,
        });
      }
    });
  };
  walk(rows, 0, "");
  return items;
}

// Width in px for a column: header and a sample of values, clamped. Used for
// the pinned offsets and a fixed table layout, so rows never jump while the
// window of rendered rows moves.
// The header name always fits on one line (padding + sort mark + the ▾ menu
// button) up to the column's cap; a longer name wraps to a second line.
export function estimateWidth(col, rows, opts) {
  const header = String(col.headerName || "").length;
  let longest = 0;
  const step = Math.max(1, Math.floor(rows.length / 250));
  for (let i = 0; i < rows.length; i += step) {
    const t = cellText(col, rows[i], opts);
    if (t.length > longest) longest = t.length;
  }
  const content = Math.round(longest * 7.4 + 22);
  const head = Math.round(header * 7.6 + 50);
  if (isNumericCol(col)) return Math.max(Math.min(Math.max(content, 76), 170), Math.min(head, 190));
  if (col.type === "date") return Math.max(Math.min(Math.max(content, 96), 130), Math.min(head, 170));
  return Math.max(Math.min(Math.max(content, 72), 300), Math.min(head, 260));
}

// "Ctrl" style text match over the identity and text columns of a row.
export function rowMatches(model, row, term) {
  if (!term) return true;
  for (const col of model.columns) {
    if (isNumericCol(col) && !model.pinnedSet.has(col.key)) continue;
    const t = cellText(col, row);
    if (t && t.toLowerCase().includes(term)) return true;
  }
  return false;
}

// The voucher behind a row, if the row names one. rmk1 / service_id / order_no
// ride along: voucherHref uses them to pick the right page for codes 7, 20
// and orders (lib/vouchers/voucherLink.js).
export function voucherOf(model, row) {
  if (!row) return null;
  let v = null;
  if (model.voucher) {
    try {
      v = model.voucher(row);
    } catch {
      v = null;
    }
  } else if (row.tran_code && (row.tran_id || row.order_no)) {
    v = { tran_id: row.tran_id ?? row.order_no, tran_code: row.tran_code };
    if (row.rmk1 !== undefined) v.rmk1 = row.rmk1;
    if (row.service_id !== undefined) v.service_id = row.service_id;
    if (row.order_no !== undefined) v.order_no = row.order_no;
  }
  return v && v.tran_code && (v.tran_id || v.order_no) ? v : null;
}
