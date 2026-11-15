// components/EmployeeMenus/menuTree.js — the pure tree logic behind
// Settings → Employee menus (no React, so it is unit-testable).
//
// How ticks map to employee_menu rows (kept compatible with
// app/api/buildMenu/route.js, which builds the sidebar):
//   • buildMenu takes an employee's rows, adds every ACTIVE descendant of each
//     (walking down only through active menus), then adds the ancestors of
//     what it has so entries sit under their module.
//   • So one row on a parent = the whole branch. The screen therefore stores
//     the smallest covering set: a fully-ticked menu is stored as ONE row and
//     nothing under it; a partly-ticked parent is NOT stored (buildMenu adds it
//     back as an ancestor) and its ticked children are stored instead.
//   • The tree here is the active menus only, with the same parent links
//     buildMenu walks — a menu whose parent is switched off is a root here,
//     exactly as buildMenu would treat it. Result: the sidebar shows exactly
//     the ticked menus (minus blocks / full-menu roles, which apply on top).

const num = (v) => Number(v);

/** Build the tree from active menu rows [{ id, title, url, icon, parent_id, order_no }]. */
export function buildTree(menus) {
  const byId = new Map();
  for (const m of menus || []) byId.set(num(m.id), { ...m, id: num(m.id) });
  const parent = new Map();
  const children = new Map();
  for (const m of byId.values()) {
    const p = m.parent_id != null && byId.has(num(m.parent_id)) && num(m.parent_id) !== m.id ? num(m.parent_id) : null;
    parent.set(m.id, p);
    if (!children.has(p)) children.set(p, []);
    children.get(p).push(m.id);
  }
  const order = (a, b) => {
    const A = byId.get(a);
    const B = byId.get(b);
    return (A.order_no ?? 0) - (B.order_no ?? 0) || String(A.title || "").localeCompare(String(B.title || "")) || a - b;
  };
  for (const list of children.values()) list.sort(order);
  // Guard against a parent loop (A → B → A): such nodes never reach a root;
  // hang them at the top so they are still visible.
  const reached = new Set();
  const walk = (pid) => {
    for (const id of children.get(pid) || []) {
      if (reached.has(id)) continue;
      reached.add(id);
      walk(id);
    }
  };
  walk(null);
  const roots = [...(children.get(null) || [])];
  for (const id of byId.keys()) {
    if (!reached.has(id)) {
      const p = parent.get(id);
      if (p != null && children.has(p)) children.set(p, children.get(p).filter((x) => x !== id));
      parent.set(id, null);
      roots.push(id);
      reached.add(id);
      walk(id);
    }
  }
  return { byId, parent, children, roots };
}

export const kidsOf = (tree, id) => tree.children.get(id) || [];

/** Every node under id (not id itself), depth first. */
export function descendants(tree, id) {
  const out = [];
  const seen = new Set([id]);
  const stack = [...kidsOf(tree, id)].reverse();
  while (stack.length) {
    const n = stack.pop();
    if (seen.has(n)) continue;
    seen.add(n);
    out.push(n);
    const k = kidsOf(tree, n);
    for (let i = k.length - 1; i >= 0; i--) stack.push(k[i]);
  }
  return out;
}

export function ancestors(tree, id) {
  const out = [];
  const seen = new Set([id]);
  for (let p = tree.parent.get(id); p != null && !seen.has(p); p = tree.parent.get(p)) {
    seen.add(p);
    out.push(p);
  }
  return out;
}

export const leaves = (tree) => [...tree.byId.keys()].filter((id) => kidsOf(tree, id).length === 0);

/** Recompute every parent from its children: on only when all children are on. */
export function normalize(tree, ticked) {
  const out = new Set();
  const visit = (id) => {
    const k = kidsOf(tree, id);
    if (k.length === 0) {
      if (ticked.has(id)) out.add(id);
      return ticked.has(id);
    }
    let all = true;
    for (const c of k) if (!visit(c)) all = false;
    if (all) out.add(id);
    return all;
  };
  for (const r of tree.roots) visit(r);
  return out;
}

/** The ticked set an employee's direct rows give: each row and everything under it. */
export function expandAssigned(tree, directIds) {
  const t = new Set();
  for (const raw of directIds || []) {
    const id = num(raw);
    if (!tree.byId.has(id)) continue; // a switched-off menu: not on the tree
    t.add(id);
    for (const d of descendants(tree, id)) t.add(d);
  }
  return normalize(tree, t);
}

/** "on" | "off" | "mixed" for every node. */
export function states(tree, ticked) {
  const s = new Map();
  const visit = (id) => {
    const k = kidsOf(tree, id);
    if (k.length === 0) {
      const v = ticked.has(id) ? "on" : "off";
      s.set(id, v);
      return v;
    }
    let on = 0;
    let off = 0;
    for (const c of k) {
      const v = visit(c);
      if (v === "on") on++;
      else if (v === "off") off++;
    }
    const v = on === k.length ? "on" : off === k.length ? "off" : "mixed";
    s.set(id, v);
    return v;
  };
  for (const r of tree.roots) visit(r);
  return s;
}

/** Tick / untick a node and its whole branch; parents follow. */
export function toggle(tree, ticked, id, value) {
  const t = new Set(ticked);
  for (const n of [id, ...descendants(tree, id)]) {
    if (value) t.add(n);
    else t.delete(n);
  }
  return normalize(tree, t);
}

/** Smallest set of rows that gives exactly the ticked menus through buildMenu. */
export function coverRows(tree, ticked) {
  const st = states(tree, ticked);
  const out = [];
  const visit = (id) => {
    const v = st.get(id);
    if (v === "on") out.push(id);
    else if (v === "mixed") kidsOf(tree, id).forEach(visit);
  };
  tree.roots.forEach(visit);
  return out.sort((a, b) => a - b);
}

/** Leaves that differ between two ticked sets — the "N changes" count. */
export function changedLeaves(tree, a, b) {
  return leaves(tree).filter((id) => a.has(id) !== b.has(id));
}

/** Rows to add / remove to go from `before` to `after` (id lists). */
export function diffIds(before, after) {
  const B = new Set((before || []).map(num));
  const A = new Set((after || []).map(num));
  return {
    added: [...A].filter((x) => !B.has(x)).sort((x, y) => x - y),
    removed: [...B].filter((x) => !A.has(x)).sort((x, y) => x - y),
  };
}

/** Search: matching nodes, plus their ancestors (shown and opened). */
export function searchTree(tree, term) {
  const q = String(term || "").trim().toLowerCase();
  if (!q) return null;
  const matches = new Set();
  const visible = new Set();
  const open = new Set();
  for (const m of tree.byId.values()) {
    if (String(m.title || "").toLowerCase().includes(q) || String(m.url || "").toLowerCase().includes(q)) {
      matches.add(m.id);
      visible.add(m.id);
      for (const a of ancestors(tree, m.id)) {
        visible.add(a);
        open.add(a);
      }
    }
  }
  return { q, matches, visible, open };
}

/** The rows to draw: depth-first, respecting open nodes (or the search). */
export function visibleRows(tree, expanded, search) {
  const rows = [];
  const visit = (id, depth) => {
    if (search && !search.visible.has(id)) return;
    const k = kidsOf(tree, id);
    const open = search ? search.open.has(id) : expanded.has(id);
    rows.push({ id, depth, kids: k.length, open });
    if (open) k.forEach((c) => visit(c, depth + 1));
  };
  tree.roots.forEach((r) => visit(r, 0));
  return rows;
}

/** Titles of the menus above `id`, top first ("ACCOUNTS DESK › VOUCHERS"). */
export function path(tree, id) {
  return [...ancestors(tree, id)].reverse().map((a) => tree.byId.get(a)?.title).filter(Boolean);
}
