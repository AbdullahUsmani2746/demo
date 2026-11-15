// lib/bi/visuals.js
// ============================================================
// BI — the visual types a Question can be shown as. Pure data (no imports),
// shared by the builder (what to offer) and the renderer (how to draw).
//
//   dims    — how many "group by" fields the visual uses [min, max]
//   measures — how many measures [min, max]
//   echarts — drawn with Apache ECharts (components/bi/EChart.jsx)
//
// Adding a visual = one entry here + one case in components/bi/chartOption.js.
// ============================================================

export const VISUALS = [
  { key: "kpi", label: "KPI card", group: "Numbers", dims: [0, 0], measures: [1, 1],
    hint: "One number, with Today / 7 Days / Month / Prev Month underneath" },
  { key: "number", label: "Single number", group: "Numbers", dims: [0, 0], measures: [1, 3] },
  { key: "table", label: "Table", group: "Tables", dims: [0, 5], measures: [1, 6] },
  { key: "pivot", label: "Pivot table", group: "Tables", dims: [2, 2], measures: [1, 1],
    hint: "First group-by down the side, second across the top" },

  { key: "bar", label: "Bar", group: "Compare", dims: [1, 2], measures: [1, 4], echarts: true },
  { key: "barH", label: "Horizontal bar", group: "Compare", dims: [1, 2], measures: [1, 4], echarts: true },
  { key: "stacked", label: "Stacked bar", group: "Compare", dims: [2, 2], measures: [1, 1], echarts: true },
  { key: "combo", label: "Bar + line", group: "Compare", dims: [1, 1], measures: [2, 2], echarts: true,
    hint: "First measure as bars, second as a line on its own axis" },
  { key: "radar", label: "Radar", group: "Compare", dims: [1, 1], measures: [1, 4], echarts: true },

  { key: "line", label: "Line", group: "Trend", dims: [1, 2], measures: [1, 4], echarts: true },
  { key: "area", label: "Area", group: "Trend", dims: [1, 2], measures: [1, 4], echarts: true },
  { key: "waterfall", label: "Waterfall", group: "Trend", dims: [1, 1], measures: [1, 1], echarts: true },

  { key: "pie", label: "Pie", group: "Share", dims: [1, 1], measures: [1, 1], echarts: true },
  { key: "donut", label: "Donut", group: "Share", dims: [1, 1], measures: [1, 1], echarts: true },
  { key: "funnel", label: "Funnel", group: "Share", dims: [1, 1], measures: [1, 1], echarts: true },
  { key: "treemap", label: "Treemap", group: "Share", dims: [1, 2], measures: [1, 1], echarts: true },
  { key: "sunburst", label: "Sunburst", group: "Share", dims: [2, 2], measures: [1, 1], echarts: true },

  { key: "heatmap", label: "Heatmap", group: "Relationship", dims: [2, 2], measures: [1, 1], echarts: true },
  { key: "scatter", label: "Scatter", group: "Relationship", dims: [1, 1], measures: [2, 2], echarts: true,
    hint: "Each group-by value is a dot; measure 1 across, measure 2 up" },
  { key: "sankey", label: "Sankey (flow)", group: "Relationship", dims: [2, 2], measures: [1, 1], echarts: true },

  { key: "gauge", label: "Gauge", group: "Progress", dims: [0, 0], measures: [1, 1], echarts: true,
    hint: "Set a target in the options" },
  { key: "bullet", label: "Bar vs target", group: "Progress", dims: [1, 1], measures: [2, 2],
    hint: "One row per group: measure 1 = actual (bar), measure 2 = target (line); 'expected by today' while the period runs" },
  { key: "multiples", label: "Small charts", group: "Trend", dims: [2, 2], measures: [1, 1],
    hint: "One small chart per value of group-by 1, group-by 2 (a date) across — all on the same scale" },
  { key: "share", label: "Share bar", group: "Share", dims: [1, 1], measures: [1, 1],
    hint: "One stacked bar with its legend — e.g. receivables by age" },
];

/** Visuals that can show "Top N + Others" (options.topN). */
export const TOPN_VISUALS = ["table", "bar", "barH", "pie", "donut", "share", "bullet"];

export const visualByKey = (key) => VISUALS.find((v) => v.key === key);

// Periods: lib/bi/periods.js (also "yday" and custom ranges "custom:A:B").
export const PERIODS = [
  { key: "today", label: "Today" },
  { key: "yday", label: "Yesterday" },
  { key: "w7", label: "Last 7 Days" },
  { key: "mtd", label: "Current Month" },
  { key: "pm", label: "Previous Month" },
  { key: "ytd", label: "Year to Date" },
  { key: "m3", label: "Last 3 Months" },
  { key: "m6", label: "Last 6 Months" },
  { key: "m12", label: "Last 12 Months" },
  { key: "all", label: "All Time" },
];

/** The small figures under a KPI card. */
export const KPI_PERIODS = ["today", "w7", "mtd", "pm"];

/** Visuals that get a dashed "last year" line when grouped by date. */
export const LY_VISUALS = ["bar", "line", "area", "combo"];

export const GRAINS = [
  { key: "day", label: "Day" },
  { key: "week", label: "Week" },
  { key: "month", label: "Month" },
  { key: "quarter", label: "Quarter" },
  { key: "year", label: "Year" },
];

export const AGGS = [
  { key: "sum", label: "Sum" },
  { key: "avg", label: "Average" },
  { key: "min", label: "Min" },
  { key: "max", label: "Max" },
  { key: "count", label: "Count" },
  { key: "distinct", label: "Distinct count" },
  { key: "ratio", label: "Ratio (%)" },
];

export const FILTER_OPS = [
  { key: "eq", label: "is" },
  { key: "neq", label: "is not" },
  { key: "in", label: "is any of" },
  { key: "contains", label: "contains" },
  { key: "gt", label: ">" },
  { key: "gte", label: "≥" },
  { key: "lt", label: "<" },
  { key: "lte", label: "≤" },
  { key: "empty", label: "is empty" },
  { key: "notEmpty", label: "is not empty" },
];
