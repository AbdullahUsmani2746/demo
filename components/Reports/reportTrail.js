// Drill trail (CLAUDE.md rule 15): Stock → Stock Ledger for that item → the
// voucher, and Back returns to the same place. Each step's filters live in its
// own URL; the trail itself (labels + URLs of the steps above this one) lives
// in sessionStorage. A report opened from a drill carries `_trail=<depth>` in
// its URL, so its breadcrumb survives a refresh and the browser's own
// Back / Forward; a report opened from the menu has no `_trail` and no
// breadcrumb. `_v` keeps the wide table's view.

export const TRAIL_PARAM = "_trail";
export const VIEW_PARAM = "_v";
export const RESERVED_PARAMS = [TRAIL_PARAM, VIEW_PARAM];

const TRAIL_KEY = "ebizz.reportTrail.v1";
const SCROLL_KEY = "ebizz.reportScroll.v1";

const readJSON = (key, fallback) => {
  try {
    const raw = window.sessionStorage.getItem(key);
    return raw ? JSON.parse(raw) : fallback;
  } catch {
    return fallback;
  }
};
const writeJSON = (key, value) => {
  try {
    window.sessionStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full or blocked — the trail is a convenience, the URLs still work
  }
};

export const readTrail = () => {
  const t = readJSON(TRAIL_KEY, []);
  return Array.isArray(t) ? t : [];
};

export const trailDepthOf = (searchParams) => {
  const n = parseInt(searchParams?.get?.(TRAIL_PARAM) ?? "", 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
};

// Filters → query string, the same shape handleFilterChange writes.
const toParamValue = (val) => {
  if (val instanceof Date) return isNaN(val) ? "" : val.toISOString();
  if (Array.isArray(val)) return val.join(",");
  if (val && typeof val === "object" && "value" in val) return String(val.value ?? "");
  return String(val);
};
export function buildReportHref(pathname, filters = {}, { view, depth } = {}) {
  const p = new URLSearchParams();
  Object.entries(filters).forEach(([k, v]) => {
    if (v === null || v === undefined || v === "" || v === false) return;
    const s = toParamValue(v);
    if (s !== "") p.append(k, s);
  });
  if (view) p.set(VIEW_PARAM, view);
  if (depth) p.set(TRAIL_PARAM, String(depth));
  const qs = p.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}

// Copy _trail / _v from the address bar into a query being rebuilt from the
// filters, so a filter change does not drop the breadcrumb or the view.
export function keepReservedParams(params) {
  try {
    const cur = new URLSearchParams(window.location.search);
    RESERVED_PARAMS.forEach((k) => {
      const v = cur.get(k);
      if (v !== null && !params.has(k)) params.set(k, v);
    });
  } catch {
    // no window (server render) — nothing to keep
  }
  return params;
}

export function withTrailParam(href, depth) {
  const [path, query = ""] = String(href).split("?");
  const p = new URLSearchParams(query);
  if (depth) p.set(TRAIL_PARAM, String(depth));
  else p.delete(TRAIL_PARAM);
  const qs = p.toString();
  return qs ? `${path}?${qs}` : path;
}

// The page at `depth` drills on: keep the steps above it, add itself.
export function pushTrailStep(depth, step) {
  const steps = readTrail().slice(0, depth);
  steps.push({ label: step.label, sub: step.sub || "", href: step.href });
  writeJSON(TRAIL_KEY, steps);
  return steps;
}

export const trailStepsFor = (depth) => readTrail().slice(0, depth);

// Scroll position of a report, keyed by its URL, so Back lands on the same row.
export function saveScroll(href, pos) {
  const all = readJSON(SCROLL_KEY, {});
  all[href] = { ...pos, at: Date.now() };
  // keep the store small
  const entries = Object.entries(all).sort((a, b) => (b[1].at || 0) - (a[1].at || 0)).slice(0, 20);
  writeJSON(SCROLL_KEY, Object.fromEntries(entries));
}
export function takeScroll(href) {
  const all = readJSON(SCROLL_KEY, {});
  const pos = all[href];
  if (!pos) return null;
  delete all[href];
  writeJSON(SCROLL_KEY, all);
  return pos;
}
export const currentLocationKey = () => {
  try {
    return `${window.location.pathname}${window.location.search}`;
  } catch {
    return "";
  }
};
