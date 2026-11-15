// lib/bi/dashFilters.js
// ============================================================
// The filters EVERY dashboard gets, on top of the ones a designer adds to a
// dashboard's layout. Each narrows only the questions whose dataset has that
// field — "Series" narrows Sales / Purchases / Stock … and leaves Receipts
// alone.
//
//   kind "segment" — a row of buttons (one value or all), e.g. Book
//   kind "multi"   — a searchable multi-select whose choices are the field's
//                    values across the dashboard's datasets
//
// To ADD one: a field key that datasets carry (lib/bi/datasets.js) + a row
// here. To switch one OFF / ON for everybody: "Dashboard filters" on My
// Dashboards (BI designers, bi.design) — stored in Settings key
// biDashboardFilters as { "<field>": true | false }. A filter not stored
// there has its `defaultOn` (Book on, as it always was; the others off, so a
// company that changes nothing sees the same dashboards as before).
// ============================================================
import prisma from "@/lib/prisma";

export const DASH_FILTERS_KEY = "biDashboardFilters";

export const DASH_FILTERS = [
  {
    field: "book",
    label: "Book",
    kind: "segment",
    allLabel: "All books",
    options: ["On books", "Off books"],
    description: "On books / Off books — customers / accounts and their documents",
    defaultOn: true,
  },
  {
    field: "item_category",
    label: "Item Category",
    kind: "multi",
    description: "The item's category (Finished, Raw Material, Packing …)",
    defaultOn: false,
  },
  {
    field: "series",
    label: "Series",
    kind: "multi",
    description: "The item's Series (Items setup)",
    defaultOn: false,
  },
];

/** Stored switches { field: boolean } ({} when none / unreadable). */
export async function dashFilterSwitches() {
  try {
    const row = await prisma.settings.findUnique({ where: { key: DASH_FILTERS_KEY }, select: { value: true } });
    const parsed = row?.value ? JSON.parse(row.value) : {};
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

const isOn = (f, stored) => (typeof stored[f.field] === "boolean" ? stored[f.field] : f.defaultOn);

/** The built-in filters switched on, in display order. */
export async function enabledDashFilters() {
  const stored = await dashFilterSwitches();
  return DASH_FILTERS.filter((f) => isOn(f, stored));
}

/** Every built-in filter with its on / off state — for the switch. */
export async function dashFilterSettings() {
  const stored = await dashFilterSwitches();
  return DASH_FILTERS.map(({ defaultOn, ...f }) => ({ ...f, enabled: isOn({ ...f, defaultOn }, stored) }));
}

/** What a dashboard sends to the screen about the built-in filters switched on. */
export const publicDashFilters = (list) =>
  list.map(({ field, label, kind, options, allLabel, description }) => ({ field, label, kind, options, allLabel, description }));

/** Save the on / off state ({ field: boolean }); unknown fields are ignored. */
export async function saveDashFilterSwitches(changes, by) {
  const current = await dashFilterSwitches();
  for (const f of DASH_FILTERS) {
    if (typeof changes?.[f.field] === "boolean") current[f.field] = changes[f.field];
  }
  const value = JSON.stringify(current);
  const description = `Built-in dashboard filters${by ? ` — changed by ${by}` : ""}`.slice(0, 190);
  await prisma.settings.upsert({
    where: { key: DASH_FILTERS_KEY },
    update: { value, description },
    create: { key: DASH_FILTERS_KEY, value, description },
  });
  return dashFilterSettings();
}
