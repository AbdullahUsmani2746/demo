// Settings that control how the Applications page lays out its tiles.
// Stored as plain rows in the existing Settings key/value table, so this needs
// no schema change. The generic /api/settings route rewrites every value into
// "macno=..." form, which is why these go through /api/settings/app-menu.

// Which menus a person sees is their roles' "Sidebar" setting (Admin → Roles,
// session.user.navMode: "all" = the whole menus table, "assigned" = their
// Employee menus) — the sidebar, search palette and Applications page all use it.

export const APP_MENU_LEVEL_KEY = "app_menu_level";
export const APP_MENU_THRESHOLD_KEY = "app_menu_auto_threshold";
export const APP_MENU_ORDER_SOURCE_KEY = "app_menu_order_source";

export const ORDER_SOURCE = {
  // Order top-level modules by the built-in MENU_ORDER list.
  LIST: "list",
  // Order them by menus.order_no, edited in Setup → Menu. Not the default:
  // the live table has HR OPERATIONS at order_no 1 and everything else at 0,
  // so switching blind would drop 12 modules into alphabetical order. Set the
  // order_no values first, then choose this.
  ORDER_NO: "order_no",
};

export const LEVEL = {
  // Tiles are the top-level modules (SALES, LAB, ...).
  MODULE: "module",
  // Tiles are one level deeper (SALES > CUSTOMER, SALES > MATERIAL, ...).
  SUB: "sub",
  // Sub-level when the user has few modules, module level otherwise — so an
  // employee assigned one or two menus gets a useful grid instead of one or
  // two lonely icons.
  AUTO: "auto",
};

// Below this many top-level modules, AUTO drops to the sub level. This is only
// the fallback — the live value is the app_menu_auto_threshold row in Settings,
// changeable from the Applications page without touching code.
export const DEFAULT_AUTO_SUB_THRESHOLD = 3;

export const THRESHOLD_MIN = 1;
export const THRESHOLD_MAX = 50;

export const DEFAULT_APP_MENU_SETTINGS = {
  level: LEVEL.AUTO,
  autoThreshold: DEFAULT_AUTO_SUB_THRESHOLD,
  orderSource: ORDER_SOURCE.LIST,
};

const isOneOf = (value, allowed) => Object.values(allowed).includes(value);

// Settings arrive as strings from the database, so coerce and clamp rather
// than trusting the stored value.
export function normalizeThreshold(value) {
  const parsed = Number.parseInt(value, 10);
  if (Number.isNaN(parsed)) return DEFAULT_AUTO_SUB_THRESHOLD;
  return Math.min(THRESHOLD_MAX, Math.max(THRESHOLD_MIN, parsed));
}

export function normalizeAppMenuSettings(raw) {
  return {
    level: isOneOf(raw?.level, LEVEL) ? raw.level : DEFAULT_APP_MENU_SETTINGS.level,
    autoThreshold: normalizeThreshold(raw?.autoThreshold),
    orderSource: isOneOf(raw?.orderSource, ORDER_SOURCE)
      ? raw.orderSource
      : DEFAULT_APP_MENU_SETTINGS.orderSource,
  };
}

// Resolves AUTO against the number of modules actually on screen.
export function effectiveLevel(level, moduleCount, threshold = DEFAULT_AUTO_SUB_THRESHOLD) {
  if (level !== LEVEL.AUTO) return level;
  return moduleCount < normalizeThreshold(threshold) ? LEVEL.SUB : LEVEL.MODULE;
}

// Changing this setting (it affects everyone) needs this permission.
export const APP_MENU_SETTINGS_PERMISSION = "settings.manage";
