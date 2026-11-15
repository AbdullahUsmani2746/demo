// Helpers shared by the Odoo-style app launcher and module pages.
// The menu tree itself comes from /api/buildMenu (the same tree the sidebar
// renders), so nothing here duplicates menu data — this only decides how a
// menu node is *presented* as a tile.

import * as Icons from "lucide-react";

// menus.icon holds a lucide export name (nav-main.jsx does Icons[item.icon]),
// but rows are inconsistent — some are kebab-case, some are empty. Normalise
// before giving up and falling back to the keyword guess.
// Names stored in menus.icon that no lucide export matches. Verified against
// the live table — everything else there resolves directly or via the
// case/separator normalisation below.
const ICON_ALIASES = {
  FileInvoice: "ReceiptText",
  FileSpreadSheet: "FileSpreadsheet", // lucide spells it with a lowercase "s"
  FileCertificate: "FileBadge",
};

function iconFromName(name) {
  if (!name) return null;
  if (Icons[name]) return Icons[name];

  const aliased = ICON_ALIASES[name];
  if (aliased && Icons[aliased]) return Icons[aliased];

  const pascal = String(name)
    .split(/[-_\s]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join("");

  return Icons[pascal] || null;
}

// Keyword → icon, matched against the menu title. Ordered: the first keyword
// found in the title wins, so put more specific words before generic ones.
const TITLE_ICONS = [
  [["sale", "selling", "customer order"], "ShoppingCart"],
  [["lab", "quality", "qc", "test"], "FlaskConical"],
  [["store", "inventory", "stock", "godown", "warehouse"], "Package"],
  // "produciton" is a live typo in nav-data.js — match it rather than leave
  // that tile generic.
  [["production", "produciton", "manufactur", "process order", "bom", "recipe"], "Factory"],
  [["despatch", "dispatch", "delivery", "gate pass", "shipment"], "Truck"],
  [["finance", "account", "voucher", "ledger", "payment", "receipt"], "Landmark"],
  [["import", "customs", "bond", "letter of credit"], "Globe"],
  [["hr", "employee", "payroll", "attendance", "leave"], "Users"],
  [["user", "staff", "role", "permission"], "UserCog"],
  [["asset", "fixed asset", "depreciation"], "Building2"],
  [["management", "manager", "executive"], "Briefcase"],
  [["supply chain", "procure", "purchase", "vendor", "supplier"], "ShoppingBag"],
  [["report", "analysis", "statement"], "FileBarChart"],
  [["dashboard", "graph", "chart", "kpi"], "LayoutDashboard"],
  [["setup", "setting", "config", "master"], "Settings2"],
  [["print", "sticker", "tag", "label", "barcode"], "Printer"],
  [["scan", "machine"], "ScanLine"],
  [["notification", "alert"], "Bell"],
  [["invoice", "billing"], "ReceiptText"],
  [["subsidary", "subsidiary", "customer", "party", "contact"], "BookUser"],
  [["order", "requisition", "demand"], "ClipboardList"],
  [["return", "knockoff", "reversal"], "RotateCcw"],
  [["transfer", "issue", "movement"], "ArrowLeftRight"],
  [["pos", "counter", "point of sale"], "Store"],
  [["menu", "navigation"], "Menu"],
  [["outstanding", "ageing", "aging", "balance"], "Scale"],
  // Titles the live menus table still left generic.
  [["grn", "goods receipt"], "PackageCheck"],
  [["transaction"], "ArrowLeftRight"],
  [["settlement", "knock off"], "Handshake"],
  [["issuance"], "PackageMinus"],
  [["profit", "loss"], "TrendingUp"],
  [["catagory", "category"], "FolderTree"],
  // After the "production" rule above, so PRODUCTION does not match here.
  [["product"], "Boxes"],
];

// Short keys need a word boundary or they fire on innocent substrings —
// "pos" inside "deposit", "hr" inside "shrinkage".
function keywordMatches(title, keyword) {
  if (keyword.length > 3) return title.includes(keyword);
  return new RegExp(`\\b${keyword}\\b`).test(title);
}

function iconFromTitle(title = "") {
  const needle = title.toLowerCase();
  for (const [keywords, iconName] of TITLE_ICONS) {
    if (keywords.some((kw) => keywordMatches(needle, kw))) return Icons[iconName] || null;
  }
  return null;
}

export function resolveMenuIcon(menu) {
  const icon = menu?.icon;

  // nav-data.js passes the lucide component itself rather than its name.
  const isComponent =
    typeof icon === "function" || (icon && typeof icon === "object" && icon.$$typeof);

  const given = isComponent ? icon : iconFromName(icon);

  // SquareTerminal is the placeholder both nav-data.js and older menu rows use
  // as a default, so treat it as "unset" — a guess from the title beats a wall
  // of identical icons. An explicitly chosen icon always wins.
  if (given && given !== Icons.SquareTerminal) return given;

  return iconFromTitle(menu?.title) || Icons.SquareTerminal;
}

// Colours are generated, not assigned. Every title hashes to its own hue, so a
// new module gets a distinct colour the moment it is added — nothing to pick,
// nothing to keep in sync with the menus table.
//
// These are inline style values rather than Tailwind classes on purpose: class
// names cannot be built dynamically (Tailwind only ships classes it can see in
// source), which is exactly what made half the tiles render white before.

// FNV-1a: small, fast, and spreads similar strings ("SALES" vs "SALES ORDER")
// far apart, unlike a plain character sum.
function hashString(text) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

// Golden-angle stepping spreads consecutive hashes around the wheel instead of
// clustering them, so neighbouring tiles rarely land on similar hues.
const GOLDEN_ANGLE = 137.508;

export function hueForTitle(title = "") {
  return Math.round((hashString(title) * GOLDEN_ANGLE) % 360);
}

// Even spacing beats randomness. Hashing alone clusters — of MANAGEMENT's 16
// children, four hashed within 7° of each other and two were identical, which
// is what "the colours all look the same" actually looks like. Spreading N
// tiles evenly around the wheel guarantees the largest possible gap between
// any two neighbours (360/N apart).
//
// The offset keeps the first tile off pure red, which reads as an error state.
const HUE_OFFSET = 24;

export function hueForPosition(index, total) {
  if (!total || total < 1) return HUE_OFFSET;
  return Math.round((HUE_OFFSET + (index * 360) / total) % 360);
}

// For grids: position-based, so every tile on screen is visibly distinct.
export function accentForPosition(index, total) {
  return accentForHue(hueForPosition(index, total));
}

// For one-off chips (search results, recents) where there is no list to spread
// across: hash the title so the colour is at least stable for that item.
export function accentForTitle(title = "") {
  return accentForHue(hueForTitle(title));
}

export function accentForHue(hue) {
  const deep = (hue + 18) % 360;

  return {
    hue,
    // Gradient chip with a white glyph — legible at any hue.
    iconStyle: {
      backgroundImage: `linear-gradient(135deg, hsl(${hue}, 72%, 56%), hsl(${deep}, 68%, 42%))`,
    },
    // Tinted chip for small icons; the text colour rides the same hue.
    softStyle: {
      backgroundColor: `hsla(${hue}, 70%, 50%, 0.14)`,
      color: `hsl(${hue}, 68%, 42%)`,
    },
    // Solid fill for section bars and the hover wash.
    barStyle: { backgroundColor: `hsl(${hue}, 70%, 50%)` },
  };
}

const isNavigable = (node) => Boolean(node?.url) && node.url !== "#";

// Every reachable page under `nodes`, carrying the breadcrumb of titles above
// it — used by the launcher search so a user can jump straight to a leaf.
export function flattenLeaves(nodes, trail = []) {
  const out = [];
  for (const node of nodes || []) {
    const nextTrail = [...trail, node.title];
    if (isNavigable(node)) {
      out.push({ ...node, trail });
    }
    if (node.items?.length) {
      out.push(...flattenLeaves(node.items, nextTrail));
    }
  }
  return out;
}

// The sub level: each root's children promoted to tiles of their own, keeping
// the parent's title so a tile still says where it came from. Roots with no
// children stay as themselves rather than disappearing.
export function subLevelTiles(roots) {
  const tiles = [];
  for (const root of roots || []) {
    if (root.items?.length) {
      for (const child of root.items) {
        tiles.push({ ...child, parentTitle: root.title, parentId: root.id });
      }
    } else {
      tiles.push({ ...root, parentTitle: null, parentId: null });
    }
  }
  return tiles;
}

export function findMenuById(nodes, id) {
  for (const node of nodes || []) {
    if (String(node.id) === String(id)) return node;
    const found = findMenuById(node.items, id);
    if (found) return found;
  }
  return null;
}

// A module page shows its children as sections. Children that have their own
// children become titled sections; direct links are collected into one
// leading section so nothing is lost.
export function toSections(module) {
  const sections = [];
  const loose = [];

  for (const child of module?.items || []) {
    if (child.items?.length) {
      sections.push({ id: child.id, title: child.title, node: child, items: child.items });
    } else {
      loose.push(child);
    }
  }

  if (loose.length) {
    sections.unshift({ id: `${module?.id}-direct`, title: null, node: null, items: loose });
  }
  return sections;
}

export { isNavigable };

// ── Recently opened ─────────────────────────────────────────────────────────
// Small enough not to warrant a store: the launcher is the only writer and
// the only reader, and a stale entry is harmless.
const RECENTS_KEY = "app_menu_recents";
const RECENTS_LIMIT = 6;

export function readRecents() {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(RECENTS_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed.slice(0, RECENTS_LIMIT) : [];
  } catch {
    return [];
  }
}

export function pushRecent(entry) {
  if (typeof window === "undefined" || !entry?.url || entry.url === "#") return;
  try {
    const next = [
      { title: entry.title, url: entry.url, icon: entry.icon ?? null, group: entry.group ?? null },
      ...readRecents().filter((r) => r.url !== entry.url),
    ].slice(0, RECENTS_LIMIT);
    window.localStorage.setItem(RECENTS_KEY, JSON.stringify(next));
  } catch {
    // Private mode / quota — recents are a convenience, never a hard failure.
  }
}
