// lib/features/apply.js
// ============================================================
// Settings → Features applied to config-driven screens. Client-safe (no Prisma).
//
//   hiddenFeatureScreens(values)        page urls of toggles that are off
//                                       (catalog `screens`) — the sidebar drops them
//   applyReportFeatures(config, values) a REPORT_CONFIG entry without the filters,
//                                       filter options and columns whose `feature`
//                                       key is off (getColumns results included)
//   lineFieldsFor(fields, values, saved) voucher line / master fields without
//                                       those whose `feature` key is off
//
// `feature: "<key>"` on a filter / option / column / line field means "only
// while that toggle is on". The server enforces the same key on its own.
// Voucher fields may also carry
//   featureKeep(saved)   → true keeps a switched-off field for a document that
//                          already uses it (`saved` = the stored document, e.g.
//                          a Sale Order with a LTR line keeps its Unit column)
//   requiredBy: { key, value = true } → the field is required while the
//                          feature has that value (e.g. Batch No, Sale Order No)
// ============================================================
import { FEATURES } from "@/lib/features/catalog";

const isOn = (values, key) => !key || values?.[key] === true;

/** Urls of screens belonging to toggles that are switched off. */
export function hiddenFeatureScreens(values) {
  return FEATURES.filter((f) => f.type === "toggle" && f.screens?.length && values?.[f.key] !== true).flatMap(
    (f) => f.screens,
  );
}

/** Is `url` (or a page under it) one of the hidden screens? */
export function isHiddenScreen(url, hidden) {
  const u = String(url || "").split("?")[0];
  return hidden.some((p) => u === p || u.startsWith(`${p}/`));
}

const keepOn = (list, values) => (Array.isArray(list) ? list.filter((x) => isOn(values, x?.feature)) : list);

export function lineFieldsFor(fields, values, saved = null) {
  if (!Array.isArray(fields)) return fields;
  return fields
    .filter((f) => isOn(values, f?.feature) || (saved && typeof f?.featureKeep === "function" && f.featureKeep(saved)))
    .map((f) => {
      if (!f?.requiredBy) return f;
      const { key, value = true } = f.requiredBy;
      return values?.[key] === value ? { ...f, required: true } : f;
    });
}

/** Does any of these voucher fields depend on a feature? */
export const hasFeatureFields = (fields) =>
  Array.isArray(fields) && fields.some((f) => f?.feature || f?.requiredBy);

/** A report config with feature-gated filters / options / columns removed. */
export function applyReportFeatures(config, values) {
  if (!config) return config;
  const gated = (config.filters || []).some((f) => f?.feature || f?.options?.some?.((o) => o?.feature))
    || (config.columns || []).some((c) => c?.feature)
    || typeof config.getColumns === "function";
  if (!gated) return config;
  const out = { ...config };
  if (Array.isArray(config.filters)) {
    out.filters = keepOn(config.filters, values).map((f) =>
      Array.isArray(f.options) && f.options.some((o) => o?.feature) ? { ...f, options: keepOn(f.options, values) } : f,
    );
  }
  if (Array.isArray(config.columns)) out.columns = keepOn(config.columns, values);
  if (typeof config.getColumns === "function") {
    const base = config.getColumns;
    // A config method may read `this.columns` — call it on the copy (already filtered).
    out.getColumns = (...args) => keepOn(base.apply(out, args), values);
  }
  return out;
}
