// components/bi/chartOption.js — question result → Apache ECharts option.
// One case per chart visual in lib/bi/visuals.js.
import { dimLabel, formatValue } from "./format";

// ── Chart colours — the ONE place to change them ──────────────────────────
// The series palette is derived from the theme's primary colour (the CSS
// variable below, an HSL triplet "H S% L%" in app/globals.css): the primary
// itself first, then calm, evenly spaced hues at a moderate saturation and
// lightness, so charts follow the brand without being all one colour.
export const CHART_THEME = {
  primaryVar: "--primary", // CSS variable the palette starts from
  fallbackPrimary: [215, 30, 38], // [h, s, l] — server side / variable missing (slate blue)
  size: 10, // colours in the series palette
  hueStep: 137.5, // degrees between series hues (golden angle — no near-repeats)
  saturation: [38, 58], // series saturation clamp (%) — neutral, not neon
  lightness: [36, 50], // series lightness clamp (%) — readable on white cards
  fixed: null, // or an explicit list of colours, e.g. ["#334155", "#0f766e", …], to bypass derivation
};

const clamp = (v, [lo, hi]) => Math.min(Math.max(v, lo), hi);
const hsl = (h, s, l) => `hsl(${Math.round(((h % 360) + 360) % 360)}, ${Math.round(s)}%, ${Math.round(l)}%)`;

/** The theme's primary as [h, s, l] (numbers), read from the CSS variable. */
function primaryHsl() {
  if (typeof window === "undefined" || typeof document === "undefined") return CHART_THEME.fallbackPrimary;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(CHART_THEME.primaryVar).trim();
  const m = raw.match(/^(-?[\d.]+)(?:deg)?[\s,]+([\d.]+)%[\s,]+([\d.]+)%/);
  return m ? [Number(m[1]), Number(m[2]), Number(m[3])] : CHART_THEME.fallbackPrimary;
}

/** The series colours: primary first, then derived neutral hues. */
export function chartPalette() {
  if (Array.isArray(CHART_THEME.fixed) && CHART_THEME.fixed.length) return CHART_THEME.fixed;
  const [h, s, l] = primaryHsl();
  const out = [hsl(h, s, l)];
  for (let i = 1; i < CHART_THEME.size; i++) {
    out.push(hsl(h + i * CHART_THEME.hueStep, clamp(s, CHART_THEME.saturation), clamp(l + (i % 2 ? 6 : 0), CHART_THEME.lightness)));
  }
  return out;
}

/** Light tint → primary, for heatmaps. */
function primaryRamp() {
  const [h, s, l] = primaryHsl();
  return [hsl(h, Math.min(s, 60), 96), hsl(h, s, Math.min(l + 25, 62)), hsl(h, s, l)];
}
const primaryColour = () => chartPalette()[0];

// Mid greys / a translucent grid line read on the white card and the dark one.
const MUTED = "#6b6b6b";
const MUTED2 = "#858585";
const GRIDLINE = "rgba(128, 128, 128, 0.2)";
const TEXT = "#1f1f1f";
const CARD = "#ffffff";
const GOOD = "#15803d";
const BAD = "#dc2626";
// Earlier periods on a trend: a calm grey; the latest one in the brand colour.
const PAST = "rgba(140, 130, 122, 0.42)";
const LY_LINE = "rgba(140, 130, 122, 0.85)";

const pctTxt = (a, b) => {
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y) || y === 0) return null;
  const p = ((x - y) / Math.abs(y)) * 100;
  return `${p > 0 ? "▲" : p < 0 ? "▼" : ""} ${Math.abs(p).toFixed(1)}%`;
};

/**
 * A trend over time (one date group-by, one measure): earlier bars grey and
 * the latest in the brand colour, values on the bars when there are few,
 * a dashed "Last year" line (result.compare.ly) and a tooltip with the change
 * vs the bar before and vs last year.
 */
/** The bucket an event date falls in, at the chart's grain ("2026-11-12" → "2026-11-01" by month). */
function bucketOf(day, grain) {
  const [y, m, d] = day.split("-").map(Number);
  const pad = (n) => String(n).padStart(2, "0");
  if (grain === "year") return `${y}-01-01`;
  if (grain === "quarter") return `${y}-${pad(Math.floor((m - 1) / 3) * 3 + 1)}-01`;
  if (grain === "month") return `${y}-${pad(m)}-01`;
  if (grain === "week") {
    const dt = new Date(Date.UTC(y, m - 1, d));
    dt.setUTCDate(dt.getUTCDate() - ((dt.getUTCDay() + 6) % 7));
    return dt.toISOString().slice(0, 10);
  }
  return day;
}

/** Event flags (BI Designer → Events) as vertical marks on a date axis. */
function eventMarks(raw, cats, grain, events) {
  if (!events?.length) return undefined;
  const at = new Map();
  for (const e of events) {
    const i = raw.indexOf(bucketOf(e.dated, grain));
    if (i < 0) continue;
    at.set(i, at.has(i) ? `${at.get(i)} · ${e.label}` : e.label);
  }
  if (!at.size) return undefined;
  return {
    silent: false,
    symbol: ["none", "none"],
    lineStyle: { color: "#B8860B", type: "solid", width: 1.2, opacity: 0.8 },
    label: { show: true, position: "end", formatter: (p) => p.name, color: "#8A5A00", backgroundColor: "#FBF0D9", padding: [2, 6], borderRadius: 4, fontSize: 10, fontWeight: 600 },
    data: [...at].map(([i, label]) => ({ xAxis: cats[i], name: label })),
  };
}

function timeTrend(s, result, options) {
  const d0 = s.dims[0];
  if (s.dims.length !== 1 || d0?.type !== "date") return null;
  const ly = options.compare !== false && result.compare?.ly ? result.compare.ly : null;
  const raw = s.rows.map((r) => String(r[d0.key] ?? "").slice(0, 10));
  const cats = s.rows.map((r) => dimLabel(r[d0.key], d0));
  return {
    events: eventMarks(raw, cats, d0.grain, options.events),
    lySeries: ly
      ? {
          name: "Last year",
          type: "line",
          data: raw.map((k) => (k in ly ? ly[k] : null)),
          symbol: "none",
          connectNulls: true,
          lineStyle: { type: "dashed", width: 1.5, color: LY_LINE },
          itemStyle: { color: LY_LINE },
          z: 3,
        }
      : null,
    barColor: (count) => (p) => (p.dataIndex === count - 1 ? primaryColour() : PAST),
    tooltip: (format) => ({
      trigger: "axis",
      formatter: (params) => {
        const list = Array.isArray(params) ? params : [params];
        const main = list.find((x) => x.seriesName !== "Last year") || list[0];
        const i = main?.dataIndex ?? 0;
        const cur = s.rows[i]?.[s.meas[0].key];
        const prev = i > 0 ? s.rows[i - 1]?.[s.meas[0].key] : null;
        const lyV = ly ? ly[raw[i]] : null;
        const lines = [`<b>${main?.axisValueLabel ?? main?.name ?? ""}</b>`, `${formatValue(cur, format)}`];
        const vp = prev !== null ? pctTxt(cur, prev) : null;
        const vl = lyV !== null && lyV !== undefined ? pctTxt(cur, lyV) : null;
        if (vp) lines.push(`<span style="color:#6b6b6b">vs before: ${vp}</span>`);
        if (vl) lines.push(`<span style="color:#1F5FA8">vs last year: ${vl}</span>`);
        for (const x of list) if (x !== main && x.seriesName !== "Last year") lines.push(`${x.seriesName}: ${formatValue(x.value, format)}`);
        return lines.join("<br/>");
      },
    }),
  };
}

const base = () => ({
  backgroundColor: "transparent",
  color: chartPalette(),
  textStyle: { color: MUTED, fontFamily: "Poppins, sans-serif" },
  tooltip: {
    backgroundColor: CARD,
    borderColor: "#e5e5e5",
    extraCssText: "box-shadow:0 6px 18px rgba(0,0,0,.08);border-radius:8px;",
    textStyle: { color: TEXT, fontSize: 12 },
  },
  legend: { textStyle: { color: MUTED, fontSize: 11 }, top: 0, type: "scroll" },
});

const axisStyle = {
  axisLine: { lineStyle: { color: GRIDLINE } },
  axisTick: { show: false },
  axisLabel: { color: MUTED2, fontSize: 10.5 },
  splitLine: { lineStyle: { color: GRIDLINE } },
};

function shape(result) {
  const dims = result.columns.filter((c) => c.role === "dimension");
  const meas = result.columns.filter((c) => c.role === "measure");
  return { dims, meas, rows: result.rows };
}

const uniq = (arr) => [...new Set(arr)];

/** Categories along d0; series = measures (1 dim) or d1 values (2 dims). */
function categorySeries({ dims, meas, rows }) {
  const d0 = dims[0];
  const cats = uniq(rows.map((r) => dimLabel(r[d0.key], d0)));
  if (dims.length >= 2) {
    const d1 = dims[1];
    const m = meas[0];
    const groups = uniq(rows.map((r) => dimLabel(r[d1.key], d1)));
    const series = groups.map((g) => ({
      name: g,
      format: m.format,
      data: cats.map((c) => {
        const row = rows.find((r) => dimLabel(r[d0.key], d0) === c && dimLabel(r[d1.key], d1) === g);
        return row ? row[m.key] : 0;
      }),
    }));
    return { cats, series };
  }
  return {
    cats,
    series: meas.map((m) => ({ name: m.label, format: m.format, data: rows.map((r) => r[m.key]) })),
  };
}

const valueAxis = (format) => ({ type: "value", ...axisStyle, axisLabel: { ...axisStyle.axisLabel, formatter: (v) => formatValue(v, format) } });
const tipFmt = (format) => (v) => formatValue(Array.isArray(v) ? v[v.length - 1] : v, format);

/** A dashed target line on the value axis (options.target). */
function targetLine(target, format, horizontal = false) {
  const t = Number(target);
  if (!t) return undefined;
  return {
    silent: true,
    symbol: "none",
    lineStyle: { color: BAD, type: "dashed", width: 1.5 },
    label: { color: BAD, fontSize: 10, formatter: `Target ${formatValue(t, format)}`, position: horizontal ? "end" : "insideEndTop" },
    data: [horizontal ? { xAxis: t } : { yAxis: t }],
  };
}

export function buildOption(type, result, options = {}) {
  const s = shape(result);
  const fmt0 = s.meas[0]?.format;
  const o = base();
  const grid = { left: 8, right: 12, top: 34, bottom: 8, containLabel: true };

  switch (type) {
    case "bar":
    case "barH":
    case "line":
    case "area":
    case "stacked": {
      const { cats, series } = categorySeries(s);
      const horizontal = type === "barH";
      const isLine = type === "line" || type === "area";
      const catAxis = { type: "category", data: cats, ...axisStyle, axisLabel: { ...axisStyle.axisLabel, hideOverlap: true } };
      const trend = !horizontal && type !== "stacked" && series.length === 1 ? timeTrend(s, result, options) : null;
      const fewBars = !isLine && cats.length <= 14;
      const out = {
        ...o,
        grid,
        tooltip: trend ? { ...o.tooltip, ...trend.tooltip(fmt0) } : { ...o.tooltip, trigger: "axis", valueFormatter: tipFmt(fmt0) },
        xAxis: horizontal ? valueAxis(fmt0) : catAxis,
        yAxis: horizontal ? { ...catAxis, inverse: true } : valueAxis(fmt0),
        series: series.map((x, i) => ({
          markLine: i === 0 ? (trend?.events && !options.target ? trend.events : targetLine(options.target, fmt0, horizontal)) : undefined,
          name: x.name,
          type: isLine ? "line" : "bar",
          data: x.data,
          smooth: isLine,
          symbolSize: 5,
          stack: type === "stacked" || options.stacked ? "total" : undefined,
          areaStyle: type === "area" ? { opacity: 0.18 } : undefined,
          barMaxWidth: 34,
          itemStyle: isLine
            ? undefined
            : { borderRadius: horizontal ? [0, 4, 4, 0] : [4, 4, 0, 0], ...(trend ? { color: trend.barColor(cats.length) } : {}) },
          label:
            options.showLabels || (trend && fewBars) || (horizontal && cats.length <= 12)
              ? { show: true, position: horizontal ? "right" : "top", color: MUTED, fontSize: 10, formatter: (p) => formatValue(p.value, x.format) }
              : undefined,
        })),
      };
      if (trend?.lySeries) {
        out.series.push(trend.lySeries);
        out.legend = { ...o.legend, data: [series[0].name, "Last year"] };
      }
      return out;
    }

    case "combo": {
      const d0 = s.dims[0];
      const cats = s.rows.map((r) => dimLabel(r[d0.key], d0));
      const [m0, m1] = s.meas;
      const comboTrend = timeTrend({ ...s, meas: [m0] }, result, options);
      return {
        ...o,
        grid,
        tooltip: { ...o.tooltip, trigger: "axis" },
        xAxis: { type: "category", data: cats, ...axisStyle },
        yAxis: [valueAxis(m0.format), { ...valueAxis(m1.format), splitLine: { show: false } }],
        series: [
          { name: m0.label, type: "bar", data: s.rows.map((r) => r[m0.key]), barMaxWidth: 34, markLine: comboTrend?.events && !options.target ? comboTrend.events : targetLine(options.target, m0.format),
            itemStyle: { borderRadius: [4, 4, 0, 0], ...(comboTrend ? { color: comboTrend.barColor(cats.length) } : {}) } },
          { name: m1.label, type: "line", yAxisIndex: 1, smooth: true, data: s.rows.map((r) => r[m1.key]) },
          ...(comboTrend?.lySeries ? [{ ...comboTrend.lySeries, name: `${m0.label} last year` }] : []),
        ],
      };
    }

    case "waterfall": {
      const d0 = s.dims[0];
      const m = s.meas[0];
      const cats = s.rows.map((r) => dimLabel(r[d0.key], d0));
      let run = 0;
      const helper = [];
      const up = [];
      const down = [];
      for (const r of s.rows) {
        const v = Number(r[m.key]) || 0;
        helper.push(v >= 0 ? run : run + v);
        up.push(v >= 0 ? v : "-");
        down.push(v < 0 ? -v : "-");
        run += v;
      }
      return {
        ...o,
        grid,
        tooltip: { ...o.tooltip, trigger: "axis", valueFormatter: tipFmt(m.format) },
        xAxis: { type: "category", data: cats, ...axisStyle },
        yAxis: valueAxis(m.format),
        series: [
          { type: "bar", stack: "w", data: helper, itemStyle: { color: "transparent" }, tooltip: { show: false } },
          { name: "Increase", type: "bar", stack: "w", data: up, itemStyle: { color: GOOD } },
          { name: "Decrease", type: "bar", stack: "w", data: down, itemStyle: { color: BAD } },
        ],
      };
    }

    case "pie":
    case "donut":
    case "funnel": {
      const d0 = s.dims[0];
      const m = s.meas[0];
      const data = s.rows.map((r) => ({ name: dimLabel(r[d0.key], d0), value: r[m.key] }));
      if (type === "funnel") {
        return {
          ...o,
          tooltip: { ...o.tooltip, trigger: "item", valueFormatter: tipFmt(m.format) },
          series: [{ type: "funnel", top: 30, bottom: 8, left: "8%", width: "84%", data, label: { color: "#fff" }, itemStyle: { borderColor: CARD, borderWidth: 1 } }],
        };
      }
      return {
        ...o,
        tooltip: { ...o.tooltip, trigger: "item", valueFormatter: tipFmt(m.format) },
        series: [{
          type: "pie",
          radius: type === "donut" ? ["45%", "72%"] : "70%",
          center: ["50%", "56%"],
          data,
          label: { color: MUTED, fontSize: 11 },
          itemStyle: { borderColor: CARD, borderWidth: 2 },
        }],
      };
    }

    case "treemap":
    case "sunburst": {
      const m = s.meas[0];
      const [d0, d1] = s.dims;
      let data;
      if (d1) {
        const groups = uniq(s.rows.map((r) => dimLabel(r[d0.key], d0)));
        data = groups.map((g) => ({
          name: g,
          children: s.rows
            .filter((r) => dimLabel(r[d0.key], d0) === g)
            .map((r) => ({ name: dimLabel(r[d1.key], d1), value: Math.max(Number(r[m.key]) || 0, 0) })),
        }));
      } else {
        data = s.rows.map((r) => ({ name: dimLabel(r[d0.key], d0), value: Math.max(Number(r[m.key]) || 0, 0) }));
      }
      return {
        ...o,
        tooltip: { ...o.tooltip, valueFormatter: tipFmt(m.format) },
        series: [type === "treemap"
          ? { type: "treemap", data, roam: false, breadcrumb: { show: false }, top: 8, bottom: 8, left: 4, right: 4,
              label: { color: "#fff", fontWeight: 600 }, itemStyle: { borderColor: CARD, borderWidth: 2, gapWidth: 2 },
              levels: [{ itemStyle: { borderWidth: 0, gapWidth: 3 } }, { itemStyle: { gapWidth: 1 } }] }
          : { type: "sunburst", data, radius: ["12%", "90%"], label: { color: "#fff", fontSize: 10 }, itemStyle: { borderColor: CARD, borderWidth: 1 } }],
      };
    }

    case "heatmap": {
      const [d0, d1] = s.dims;
      const m = s.meas[0];
      const xs = uniq(s.rows.map((r) => dimLabel(r[d0.key], d0)));
      const ys = uniq(s.rows.map((r) => dimLabel(r[d1.key], d1)));
      const data = s.rows.map((r) => [xs.indexOf(dimLabel(r[d0.key], d0)), ys.indexOf(dimLabel(r[d1.key], d1)), r[m.key]]);
      const max = Math.max(1, ...s.rows.map((r) => Number(r[m.key]) || 0));
      return {
        ...o,
        grid: { ...grid, bottom: 40 },
        tooltip: { ...o.tooltip, position: "top", formatter: (p) => `${xs[p.value[0]]} · ${ys[p.value[1]]}<br/><b>${formatValue(p.value[2], m.format)}</b>` },
        xAxis: { type: "category", data: xs, ...axisStyle, splitArea: { show: false } },
        yAxis: { type: "category", data: ys, ...axisStyle },
        visualMap: { min: 0, max, calculable: true, orient: "horizontal", left: "center", bottom: 0, itemHeight: 90,
          textStyle: { color: MUTED2 }, inRange: { color: primaryRamp() } },
        series: [{ type: "heatmap", data, itemStyle: { borderColor: CARD, borderWidth: 1 } }],
      };
    }

    case "scatter": {
      const d0 = s.dims[0];
      const [m0, m1] = s.meas;
      return {
        ...o,
        grid,
        tooltip: { ...o.tooltip, trigger: "item",
          formatter: (p) => `${p.name}<br/>${m0.label}: <b>${formatValue(p.value[0], m0.format)}</b><br/>${m1.label}: <b>${formatValue(p.value[1], m1.format)}</b>` },
        xAxis: { ...valueAxis(m0.format), name: m0.label, nameTextStyle: { color: MUTED2 } },
        yAxis: { ...valueAxis(m1.format), name: m1.label, nameTextStyle: { color: MUTED2 } },
        series: [{ type: "scatter", symbolSize: 10, data: s.rows.map((r) => ({ name: dimLabel(r[d0.key], d0), value: [r[m0.key], r[m1.key]] })) }],
      };
    }

    case "radar": {
      const { cats, series } = categorySeries({ ...s, dims: s.dims.slice(0, 1) });
      const max = Math.max(1, ...series.flatMap((x) => x.data.map(Number)));
      return {
        ...o,
        tooltip: { ...o.tooltip },
        radar: { indicator: cats.map((c) => ({ name: c, max })), axisName: { color: MUTED, fontSize: 10 },
          splitLine: { lineStyle: { color: GRIDLINE } }, splitArea: { show: false }, axisLine: { lineStyle: { color: GRIDLINE } } },
        series: [{ type: "radar", data: series.map((x) => ({ name: x.name, value: x.data, areaStyle: { opacity: 0.12 } })) }],
      };
    }

    case "sankey": {
      const [d0, d1] = s.dims;
      const m = s.meas[0];
      // Same label on both sides would make a cycle — mark the right side.
      const left = uniq(s.rows.map((r) => dimLabel(r[d0.key], d0)));
      const right = uniq(s.rows.map((r) => dimLabel(r[d1.key], d1))).map((n) => (left.includes(n) ? `${n} ›` : n));
      const rightName = (r) => {
        const n = dimLabel(r[d1.key], d1);
        return left.includes(n) ? `${n} ›` : n;
      };
      return {
        ...o,
        tooltip: { ...o.tooltip, trigger: "item", valueFormatter: tipFmt(m.format) },
        series: [{
          type: "sankey", top: 20, bottom: 10, left: 6, right: 90, nodeGap: 8,
          data: [...left, ...right].map((name) => ({ name })),
          links: s.rows.map((r) => ({ source: dimLabel(r[d0.key], d0), target: rightName(r), value: Math.max(Number(r[m.key]) || 0, 0) })),
          lineStyle: { color: "gradient", opacity: 0.35 },
          label: { color: MUTED, fontSize: 11 },
        }],
      };
    }

    case "gauge": {
      const m = s.meas[0];
      const value = Number(s.rows[0]?.[m.key]) || 0;
      const target = Number(options.target) || 0;
      const max = target > 0 ? target : Math.max(value * 1.25, 1);
      return {
        ...o,
        series: [{
          type: "gauge", min: 0, max, startAngle: 210, endAngle: -30, radius: "92%",
          progress: { show: true, width: 12, itemStyle: { color: value >= max ? GOOD : primaryColour() } },
          axisLine: { lineStyle: { width: 12, color: [[1, GRIDLINE]] } },
          axisTick: { show: false }, splitLine: { show: false }, axisLabel: { show: false }, pointer: { show: false },
          title: { show: true, offsetCenter: [0, "38%"], color: MUTED, fontSize: 11 },
          detail: { valueAnimation: true, offsetCenter: [0, "-4%"], color: TEXT, fontSize: 20, fontWeight: 700,
            formatter: () => formatValue(value, m.format) },
          data: [{ value, name: target > 0 ? `${Math.round((value / max) * 100)}% of ${formatValue(target, m.format)}` : m.label }],
        }],
      };
    }

    default:
      return o;
  }
}
