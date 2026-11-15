"use client";
// Accounting → Menus: the sidebar's menu tree.
//
//   Left   the tree — drag a row (or its handle) above / below another row to
//          reorder, onto the middle of a row to make it a sub-menu. Keyboard:
//          ↑ ↓ move, → ← open / close, Enter edit, Alt+↑ ↓ move the menu,
//          Alt+→ make it a sub-menu of the one above, Alt+← move it out.
//   Right  the editor — title, URL, icon (picked from the icons the sidebar
//          can draw), parent, shown / hidden.
//
// Order changes are saved at once through POST /api/menu/reorder (one
// request, audited); a menu's own fields through /api/setup/menus. Menus are
// hidden, not deleted — people's menu access (employee_menu) points at them.
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import * as Icons from "lucide-react";
import {
  ArrowDown,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  ChevronRight,
  Eye,
  EyeOff,
  GripVertical,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

const EMPTY_FORM = { title: "", url: "", icon: "", parent_id: null, is_active: true };

// The icon names the sidebar can draw (components/sidebar/nav-main.jsx looks
// the name up on lucide-react and falls back to SquareTerminal).
const ICON_NAMES = Object.keys(Icons)
  .filter(
    (k) =>
      /^[A-Z][A-Za-z0-9]+$/.test(k) &&
      !k.endsWith("Icon") &&
      !k.startsWith("Lucide") &&
      k !== "Icon" &&
      Icons[k] &&
      (typeof Icons[k] === "object" || typeof Icons[k] === "function"),
  )
  .sort();
const iconOf = (name) => (name && Icons[name]) || Icons.SquareTerminal;
const knownIcon = (name) => !name || ICON_NAMES.includes(name);

const byOrder = (a, b) => (a.order_no ?? 0) - (b.order_no ?? 0) || a.id - b.id;

function Kbd({ children }) {
  return (
    <kbd className="rounded border border-b-2 border-border bg-background px-1.5 py-0.5 font-mono text-[10.5px] font-semibold text-muted-foreground">
      {children}
    </kbd>
  );
}

export default function MenuManagementPage() {
  const [menus, setMenus] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [expanded, setExpanded] = useState(() => new Set());
  const [search, setSearch] = useState("");
  const [show, setShow] = useState("all"); // all | active | hidden
  const [focusedId, setFocusedId] = useState(null);

  // editor: { mode: "edit", id } | { mode: "new" } | null
  const [editor, setEditor] = useState(null);
  const [form, setForm] = useState(EMPTY_FORM);
  const [formError, setFormError] = useState(null);
  const [saving, setSaving] = useState(false);
  const [reordering, setReordering] = useState(false);

  const [dragId, setDragId] = useState(null);
  const [drop, setDrop] = useState(null); // { id, pos: before | after | inside }
  const searchRef = useRef(null);
  const titleRef = useRef(null);
  const rowRefs = useRef(new Map());

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await axios.get("/api/setup/menus");
      setMenus(Array.isArray(res.data?.data) ? res.data.data : []);
      setLoadError(null);
    } catch (err) {
      setLoadError(err?.response?.data?.error || err.message || "Could not load the menus");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  // ── Tree helpers ────────────────────────────────────────────────────
  const byId = useMemo(() => new Map(menus.map((m) => [m.id, m])), [menus]);
  // A menu whose parent no longer exists is shown at the top level.
  const parentOf = useCallback(
    (m) => (m && m.parent_id != null && byId.has(m.parent_id) ? m.parent_id : null),
    [byId],
  );
  const childrenMap = useMemo(() => {
    const map = new Map();
    for (const m of menus) {
      const p = parentOf(m);
      if (!map.has(p)) map.set(p, []);
      map.get(p).push(m);
    }
    for (const list of map.values()) list.sort(byOrder);
    return map;
  }, [menus, parentOf]);
  const childrenOf = useCallback((pid) => childrenMap.get(pid ?? null) || [], [childrenMap]);

  const depthOf = useCallback(
    (id) => {
      let d = 0;
      const seen = new Set();
      for (let p = parentOf(byId.get(id)); p != null && !seen.has(p); p = parentOf(byId.get(p))) {
        seen.add(p);
        d += 1;
      }
      return d;
    },
    [byId, parentOf],
  );
  const descendantsOf = useCallback(
    (id) => {
      const out = new Set();
      const walk = (pid) => {
        for (const c of childrenOf(pid)) {
          if (out.has(c.id)) continue;
          out.add(c.id);
          walk(c.id);
        }
      };
      walk(id);
      return out;
    },
    [childrenOf],
  );
  const pathOf = useCallback(
    (id) => {
      const names = [];
      const seen = new Set();
      for (let m = byId.get(id); m && !seen.has(m.id); m = byId.get(parentOf(m))) {
        seen.add(m.id);
        names.unshift(m.title);
      }
      return names.join(" › ");
    },
    [byId, parentOf],
  );

  // ── Visible rows (search / filter keep the matches and their parents) ─
  const term = search.trim().toLowerCase();
  const filtering = !!term || show !== "all";
  const visibleSet = useMemo(() => {
    if (!filtering) return null;
    const keep = new Set();
    for (const m of menus) {
      const textOk = !term || `${m.title} ${m.url || ""} ${m.icon || ""}`.toLowerCase().includes(term);
      const showOk = show === "all" || (show === "active" ? m.is_active : !m.is_active);
      if (!textOk || !showOk) continue;
      const seen = new Set();
      for (let x = m; x && !seen.has(x.id); x = byId.get(parentOf(x))) {
        seen.add(x.id);
        keep.add(x.id);
      }
    }
    return keep;
  }, [filtering, menus, term, show, byId, parentOf]);

  const rows = useMemo(() => {
    const out = [];
    const walk = (pid, depth, seen) => {
      for (const m of childrenOf(pid)) {
        if (seen.has(m.id)) continue;
        if (visibleSet && !visibleSet.has(m.id)) continue;
        const kids = childrenOf(m.id);
        const open = filtering ? true : expanded.has(m.id);
        out.push({ menu: m, depth, kids: kids.length, open });
        if (kids.length && open) walk(m.id, depth + 1, new Set([...seen, m.id]));
      }
    };
    walk(null, 0, new Set());
    return out;
  }, [childrenOf, visibleSet, filtering, expanded]);

  const stats = useMemo(() => {
    let depth = 0;
    for (const m of menus) depth = Math.max(depth, depthOf(m.id) + 1);
    return {
      total: menus.length,
      hidden: menus.filter((m) => !m.is_active).length,
      top: childrenOf(null).length,
      depth,
    };
  }, [menus, depthOf, childrenOf]);

  const toggle = (id, open) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      const want = open ?? !next.has(id);
      if (want) next.add(id);
      else next.delete(id);
      return next;
    });
  const expandAll = () => setExpanded(new Set(menus.filter((m) => childrenOf(m.id).length).map((m) => m.id)));
  const collapseAll = () => setExpanded(new Set());

  // ── Saving an order change ──────────────────────────────────────────
  // `next` = { [parentId|"root"]: [ids in order] } for every parent whose
  // children changed. Optimistic; rolled back if the server refuses.
  const saveOrder = async (lists, message) => {
    const prev = menus;
    const patch = new Map();
    for (const [key, ids] of Object.entries(lists)) {
      const pid = key === "root" ? null : Number(key);
      ids.forEach((id, i) => {
        const m = byId.get(id);
        if (!m) return;
        if (parentOf(m) !== pid || m.order_no !== i + 1 || m.parent_id !== pid) {
          patch.set(id, { id, parent_id: pid, order_no: i + 1 });
        }
      });
    }
    if (!patch.size) return;
    setMenus((cur) => cur.map((m) => (patch.has(m.id) ? { ...m, ...patch.get(m.id) } : m)));
    setReordering(true);
    try {
      await axios.post("/api/menu/reorder", { items: [...patch.values()] });
      toast.success(message || "Order saved");
    } catch (err) {
      setMenus(prev);
      toast.error(err?.response?.data?.error || "Could not save the new order");
    } finally {
      setReordering(false);
    }
  };

  const keyOf = (pid) => (pid == null ? "root" : String(pid));

  // Put `id` before / after / inside `targetId`.
  const moveTo = (id, targetId, pos) => {
    const m = byId.get(id);
    const t = byId.get(targetId);
    if (!m || !t || id === targetId) return;
    if (descendantsOf(id).has(targetId)) {
      toast.error("A menu cannot go under one of its own sub-menus");
      return;
    }
    const oldParent = parentOf(m);
    const newParent = pos === "inside" ? t.id : parentOf(t);
    const siblings = childrenOf(newParent).map((x) => x.id).filter((x) => x !== id);
    let at = siblings.length;
    if (pos !== "inside") at = siblings.indexOf(t.id) + (pos === "after" ? 1 : 0);
    siblings.splice(at, 0, id);
    const lists = { [keyOf(newParent)]: siblings };
    if (oldParent !== newParent) {
      lists[keyOf(oldParent)] = childrenOf(oldParent).map((x) => x.id).filter((x) => x !== id);
    }
    if (pos === "inside") toggle(t.id, true);
    saveOrder(lists, pos === "inside" ? `Moved under ${t.title}` : "Order saved");
  };

  const moveBy = (id, delta) => {
    const m = byId.get(id);
    if (!m) return;
    const sib = childrenOf(parentOf(m)).map((x) => x.id);
    const i = sib.indexOf(id);
    const j = i + delta;
    if (i < 0 || j < 0 || j >= sib.length) return;
    [sib[i], sib[j]] = [sib[j], sib[i]];
    saveOrder({ [keyOf(parentOf(m))]: sib });
  };

  // Alt+→ : becomes the last sub-menu of the menu above it.
  const indent = (id) => {
    const m = byId.get(id);
    if (!m) return;
    const sib = childrenOf(parentOf(m));
    const i = sib.findIndex((x) => x.id === id);
    if (i <= 0) return;
    moveTo(id, sib[i - 1].id, "inside");
  };
  // Alt+← : moves out, right after its parent.
  const outdent = (id) => {
    const m = byId.get(id);
    const p = m && parentOf(m);
    if (p == null) return;
    moveTo(id, p, "after");
  };

  // ── Drag and drop ───────────────────────────────────────────────────
  const dropPos = (e) => {
    const r = e.currentTarget.getBoundingClientRect();
    const y = (e.clientY - r.top) / r.height;
    return y < 0.28 ? "before" : y > 0.72 ? "after" : "inside";
  };
  const onDragStart = (e, id) => {
    if (filtering || reordering) {
      e.preventDefault();
      if (filtering) toast.info("Clear the search and filter to drag menus");
      return;
    }
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(id)); // Firefox needs data to start a drag
    setDragId(id);
  };
  const onDragOver = (e, id) => {
    if (dragId == null || id === dragId || descendantsOf(dragId).has(id)) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const pos = dropPos(e);
    if (drop?.id !== id || drop?.pos !== pos) setDrop({ id, pos });
  };
  const onDrop = (e, id) => {
    e.preventDefault();
    const src = dragId;
    const pos = drop?.id === id ? drop.pos : dropPos(e);
    setDragId(null);
    setDrop(null);
    if (src != null && src !== id) moveTo(src, id, pos);
  };
  const onDragEnd = () => {
    setDragId(null);
    setDrop(null);
  };

  // ── Editor ──────────────────────────────────────────────────────────
  const openEdit = (m) => {
    setEditor({ mode: "edit", id: m.id });
    setForm({
      title: m.title || "",
      url: m.url || "",
      icon: m.icon || "",
      parent_id: parentOf(m),
      is_active: !!m.is_active,
    });
    setFormError(null);
    setFocusedId(m.id);
  };
  const openNew = (parentId = null) => {
    setEditor({ mode: "new" });
    setForm({ ...EMPTY_FORM, parent_id: parentId });
    setFormError(null);
    if (parentId != null) toggle(parentId, true);
    setTimeout(() => titleRef.current?.focus(), 50);
  };
  const closeEditor = () => {
    setEditor(null);
    setFormError(null);
  };

  const editing = editor?.mode === "edit" ? byId.get(editor.id) : null;
  const dirty =
    editor?.mode === "new"
      ? !!(form.title || form.url || form.icon)
      : !!editing &&
        (form.title !== (editing.title || "") ||
          form.url !== (editing.url || "") ||
          form.icon !== (editing.icon || "") ||
          form.parent_id !== parentOf(editing) ||
          form.is_active !== !!editing.is_active);

  const urlClash = useMemo(() => {
    const u = form.url.trim();
    if (!u) return null;
    return menus.find((m) => m.url === u && m.id !== editor?.id) || null;
  }, [form.url, menus, editor]);

  const parentChoices = useMemo(() => {
    const banned = editor?.mode === "edit" ? new Set([editor.id, ...descendantsOf(editor.id)]) : new Set();
    const out = [];
    const walk = (pid, depth) => {
      for (const m of childrenOf(pid)) {
        if (banned.has(m.id)) continue;
        out.push({ id: m.id, label: `${"   ".repeat(depth)}${m.title}` });
        walk(m.id, depth + 1);
      }
    };
    walk(null, 0);
    return out;
  }, [editor, childrenOf, descendantsOf]);

  const save = async () => {
    const title = form.title.trim();
    if (!title) {
      setFormError("Give the menu a title");
      titleRef.current?.focus();
      return;
    }
    const url = form.url.trim();
    if (url && !url.startsWith("/") && !/^https?:\/\//i.test(url)) {
      setFormError("A URL starts with / (e.g. /accounting/setup/menus)");
      return;
    }
    setSaving(true);
    setFormError(null);
    try {
      if (editor?.mode === "new") {
        const order = childrenOf(form.parent_id).reduce((mx, m) => Math.max(mx, m.order_no ?? 0), 0) + 1;
        const res = await axios.post("/api/setup/menus", {
          title,
          url,
          icon: form.icon.trim(),
          parent_id: form.parent_id,
          order_no: order,
          is_active: form.is_active,
        });
        toast.success(`"${title}" added`);
        await load();
        const created = res.data?.data || res.data;
        if (created?.id) {
          setFocusedId(created.id);
          openEdit(created);
        } else closeEditor();
      } else if (editing) {
        const moved = form.parent_id !== parentOf(editing);
        const order = moved
          ? childrenOf(form.parent_id).reduce((mx, m) => Math.max(mx, m.order_no ?? 0), 0) + 1
          : editing.order_no;
        // The setup route writes every field, so send them all.
        await axios.put(`/api/setup/menus/${editing.id}`, {
          title,
          url,
          icon: form.icon.trim(),
          parent_id: form.parent_id,
          order_no: order,
          is_active: form.is_active,
        });
        toast.success("Menu saved");
        if (form.parent_id != null) toggle(form.parent_id, true);
        await load();
      }
    } catch (err) {
      setFormError(err?.response?.data?.error || "Could not save the menu");
    } finally {
      setSaving(false);
    }
  };

  const setActive = async (m, active) => {
    setMenus((cur) => cur.map((x) => (x.id === m.id ? { ...x, is_active: active } : x)));
    try {
      await axios.put(`/api/setup/menus/${m.id}`, {
        title: m.title,
        url: m.url || "",
        icon: m.icon || "",
        parent_id: parentOf(m),
        order_no: m.order_no,
        is_active: active,
      });
      toast.success(active ? `"${m.title}" shown` : `"${m.title}" hidden`);
      if (editor?.mode === "edit" && editor.id === m.id) setForm((f) => ({ ...f, is_active: active }));
    } catch (err) {
      setMenus((cur) => cur.map((x) => (x.id === m.id ? { ...x, is_active: m.is_active } : x)));
      toast.error(err?.response?.data?.error || "Could not change the menu");
    }
  };

  // ── Keyboard ────────────────────────────────────────────────────────
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s" && editor) {
        e.preventDefault();
        save();
        return;
      }
      // "/" focuses the search (Ctrl+K is the header's menu search).
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (e.key === "Escape" && editor && !typing) {
        closeEditor();
        return;
      }
      if (typing || e.ctrlKey || e.metaKey) return;
      if (e.key === "n" || e.key === "N") {
        e.preventDefault();
        openNew(null);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const focusRow = (id) => {
    setFocusedId(id);
    rowRefs.current.get(id)?.focus();
  };
  const onRowKey = (e, row, index) => {
    const id = row.menu.id;
    if (e.altKey) {
      const act = { ArrowUp: () => moveBy(id, -1), ArrowDown: () => moveBy(id, 1), ArrowRight: () => indent(id), ArrowLeft: () => outdent(id) }[e.key];
      if (act) {
        e.preventDefault();
        if (filtering) toast.info("Clear the search and filter to move menus");
        else act();
      }
      return;
    }
    if (e.key === "ArrowDown" && rows[index + 1]) {
      e.preventDefault();
      focusRow(rows[index + 1].menu.id);
    } else if (e.key === "ArrowUp" && rows[index - 1]) {
      e.preventDefault();
      focusRow(rows[index - 1].menu.id);
    } else if (e.key === "ArrowRight" && row.kids) {
      e.preventDefault();
      if (!row.open) toggle(id, true);
      else if (rows[index + 1]) focusRow(rows[index + 1].menu.id);
    } else if (e.key === "ArrowLeft") {
      e.preventDefault();
      if (row.kids && row.open && !filtering) toggle(id, false);
      else if (parentOf(row.menu) != null) focusRow(parentOf(row.menu));
    } else if (e.key === "Enter") {
      e.preventDefault();
      openEdit(row.menu);
    }
  };

  // ── Render ──────────────────────────────────────────────────────────
  if (loading && !menus.length) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading menus…
      </div>
    );
  }
  if (loadError && !menus.length) {
    return (
      <div className="flex min-h-[60vh] flex-col items-center justify-center gap-3 p-4 text-center">
        <p className="font-semibold text-foreground">Could not load the menus</p>
        <p className="text-sm text-muted-foreground">{loadError}</p>
        <Button onClick={load}>Try again</Button>
      </div>
    );
  }

  const PreviewIcon = iconOf(form.icon.trim());
  const sameParentPos = (() => {
    if (!editing) return null;
    const sib = childrenOf(parentOf(editing));
    return { at: sib.findIndex((x) => x.id === editing.id) + 1, of: sib.length };
  })();

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto max-w-[1400px] px-3 py-5 sm:px-6">
        {/* Header */}
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="mb-1 text-[12.5px] text-muted-foreground">Accounting · Setup</p>
            <h1 className="flex flex-wrap items-center gap-2.5 text-2xl font-bold tracking-tight text-foreground">
              Menus
              <span className="inline-flex h-6 items-center rounded-full bg-primary/10 px-2.5 text-xs font-bold tabular-nums text-primary">
                {stats.total}
              </span>
              {stats.hidden > 0 && (
                <span className="inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-xs font-semibold tabular-nums text-muted-foreground">
                  {stats.hidden} hidden
                </span>
              )}
            </h1>
            <p className="mt-1 text-[13px] text-muted-foreground">
              {stats.top} top-level · up to {stats.depth} level{stats.depth === 1 ? "" : "s"} deep · drag to reorder, drop on a
              menu to nest it
            </p>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <Button variant="outline" className="h-10 gap-2 bg-background" onClick={load} disabled={loading}>
              <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
              Refresh
            </Button>
            <Button className="h-10 flex-1 gap-2 sm:flex-none" onClick={() => openNew(null)}>
              <Plus className="h-4 w-4" />
              New menu
              <kbd className="ml-1 hidden rounded border border-white/40 px-1 font-mono text-[10.5px] sm:inline">N</kbd>
            </Button>
          </div>
        </div>

        <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_400px]">
          {/* Tree */}
          <div className="overflow-hidden rounded-xl border border-border bg-background">
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
              <label className="flex h-9 min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3 text-muted-foreground focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
                <Search className="h-4 w-4 flex-shrink-0" />
                <input
                  ref={searchRef}
                  value={search}
                  onChange={(e) => setSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setSearch("")}
                  placeholder="Search title, URL or icon…"
                  aria-label="Search menus"
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
                />
                {search ? (
                  <button type="button" onClick={() => setSearch("")} aria-label="Clear search" className="hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                ) : (
                  <span className="hidden sm:inline">
                    <Kbd>/</Kbd>
                  </span>
                )}
              </label>
              <div className="flex rounded-lg border border-border bg-muted/50 p-0.5" role="group" aria-label="Show">
                {[
                  ["all", "All"],
                  ["active", "Shown"],
                  ["hidden", "Hidden"],
                ].map(([v, l]) => (
                  <button
                    key={v}
                    type="button"
                    aria-pressed={show === v}
                    onClick={() => setShow(v)}
                    className={`h-8 rounded-md px-3 text-[13px] font-semibold transition-colors ${
                      show === v ? "bg-primary text-primary-foreground shadow-sm" : "text-muted-foreground hover:text-primary"
                    }`}
                  >
                    {l}
                  </button>
                ))}
              </div>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={expandAll} disabled={filtering}>
                  Expand all
                </Button>
                <Button variant="ghost" size="sm" className="h-8 text-xs" onClick={collapseAll} disabled={filtering}>
                  Collapse all
                </Button>
              </div>
            </div>

            {/* column caption */}
            <div className="flex items-center gap-2 bg-primary px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-primary-foreground">
              <span className="flex-1">Menu</span>
              <span className="hidden w-[38%] md:block">URL</span>
              <span className="w-[120px] text-right">{reordering ? "Saving…" : ""}</span>
            </div>

            <div role="tree" aria-label="Menus" className="max-h-[calc(100vh-260px)] overflow-y-auto max-lg:max-h-none">
              {rows.length === 0 ? (
                <div className="px-4 py-14 text-center">
                  <p className="font-semibold text-foreground">{filtering ? "No menu matches" : "No menus yet"}</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {filtering ? "Try another word, or show all menus." : "Add the first one with New menu."}
                  </p>
                </div>
              ) : (
                rows.map((row, index) => {
                  const m = row.menu;
                  const Icon = iconOf(m.icon);
                  const selected = editor?.mode === "edit" && editor.id === m.id;
                  const target = drop?.id === m.id ? drop.pos : null;
                  const isDragged = dragId === m.id;
                  return (
                    <div
                      key={m.id}
                      ref={(el) => (el ? rowRefs.current.set(m.id, el) : rowRefs.current.delete(m.id))}
                      role="treeitem"
                      aria-level={row.depth + 1}
                      aria-expanded={row.kids ? row.open : undefined}
                      aria-selected={selected}
                      tabIndex={focusedId === m.id || (focusedId == null && index === 0) ? 0 : -1}
                      draggable={!filtering}
                      onDragStart={(e) => onDragStart(e, m.id)}
                      onDragOver={(e) => onDragOver(e, m.id)}
                      onDragLeave={(e) => {
                        if (!e.currentTarget.contains(e.relatedTarget) && drop?.id === m.id) setDrop(null);
                      }}
                      onDrop={(e) => onDrop(e, m.id)}
                      onDragEnd={onDragEnd}
                      onFocus={() => setFocusedId(m.id)}
                      onKeyDown={(e) => onRowKey(e, row, index)}
                      onClick={() => openEdit(m)}
                      className={`group relative flex min-h-[48px] cursor-pointer items-center gap-2 border-b border-border/60 px-2 py-1.5 outline-none transition-colors focus-visible:bg-primary/[0.05] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40 ${
                        selected ? "bg-primary/[0.07]" : "hover:bg-primary/[0.03]"
                      } ${isDragged ? "opacity-40" : ""} ${target === "inside" ? "bg-primary/10 ring-2 ring-inset ring-primary" : ""} ${
                        !m.is_active ? "text-muted-foreground" : ""
                      }`}
                    >
                      {target === "before" && <span className="pointer-events-none absolute inset-x-2 top-0 h-0.5 rounded bg-primary" />}
                      {target === "after" && <span className="pointer-events-none absolute inset-x-2 bottom-0 h-0.5 rounded bg-primary" />}

                      <span
                        className={`flex h-7 w-5 flex-shrink-0 items-center justify-center text-muted-foreground/60 ${
                          filtering ? "invisible" : "cursor-grab group-hover:text-muted-foreground active:cursor-grabbing"
                        }`}
                        title="Drag to move"
                        aria-hidden="true"
                      >
                        <GripVertical className="h-4 w-4" />
                      </span>

                      <span style={{ width: row.depth * 20 }} className="relative flex-shrink-0 self-stretch" aria-hidden="true">
                        {Array.from({ length: row.depth }).map((_, i) => (
                          <span key={i} className="absolute inset-y-[-6px] w-px bg-border" style={{ left: i * 20 + 9 }} />
                        ))}
                      </span>

                      {row.kids ? (
                        <button
                          type="button"
                          tabIndex={-1}
                          onClick={(e) => {
                            e.stopPropagation();
                            if (!filtering) toggle(m.id);
                          }}
                          className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                          aria-label={row.open ? "Close" : "Open"}
                        >
                          <ChevronRight className={`h-4 w-4 transition-transform ${row.open ? "rotate-90" : ""}`} />
                        </button>
                      ) : (
                        <span className="w-6 flex-shrink-0" />
                      )}

                      <span
                        className={`flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md ${
                          m.is_active ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground"
                        }`}
                      >
                        <Icon className="h-4 w-4" />
                      </span>

                      <div className="min-w-0 flex-1">
                        <div className="flex min-w-0 items-center gap-2">
                          <span className={`truncate text-sm font-semibold ${m.is_active ? "text-foreground" : "line-through decoration-muted-foreground/40"}`}>
                            {m.title}
                          </span>
                          {row.kids > 0 && (
                            <span className="flex-shrink-0 rounded-full bg-muted px-1.5 text-[11px] font-bold tabular-nums text-muted-foreground">
                              {row.kids}
                            </span>
                          )}
                          {!m.is_active && (
                            <span className="flex-shrink-0 rounded-full bg-muted px-2 py-px text-[11px] font-semibold text-muted-foreground">
                              Hidden
                            </span>
                          )}
                        </div>
                        <p className="truncate font-mono text-[11.5px] text-muted-foreground md:hidden">{m.url || "—"}</p>
                      </div>

                      <span className="hidden w-[38%] truncate font-mono text-xs text-muted-foreground md:block">{m.url || "—"}</span>

                      <div className="flex w-[120px] flex-shrink-0 items-center justify-end gap-0.5 opacity-100 lg:opacity-0 lg:group-hover:opacity-100 lg:group-focus-within:opacity-100">
                        {!filtering && (
                          <>
                            <button
                              type="button"
                              tabIndex={-1}
                              title="Move up (Alt+↑)"
                              onClick={(e) => {
                                e.stopPropagation();
                                moveBy(m.id, -1);
                              }}
                              className="hidden h-7 w-7 items-center justify-center rounded text-primary/70 hover:bg-primary/10 hover:text-primary sm:flex"
                            >
                              <ArrowUp className="h-3.5 w-3.5" />
                            </button>
                            <button
                              type="button"
                              tabIndex={-1}
                              title="Move down (Alt+↓)"
                              onClick={(e) => {
                                e.stopPropagation();
                                moveBy(m.id, 1);
                              }}
                              className="hidden h-7 w-7 items-center justify-center rounded text-primary/70 hover:bg-primary/10 hover:text-primary sm:flex"
                            >
                              <ArrowDown className="h-3.5 w-3.5" />
                            </button>
                          </>
                        )}
                        <button
                          type="button"
                          tabIndex={-1}
                          title="Add a sub-menu"
                          onClick={(e) => {
                            e.stopPropagation();
                            openNew(m.id);
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded text-primary/70 hover:bg-primary/10 hover:text-primary"
                        >
                          <Plus className="h-3.5 w-3.5" />
                        </button>
                        <button
                          type="button"
                          tabIndex={-1}
                          title={m.is_active ? "Hide from the sidebar" : "Show in the sidebar"}
                          onClick={(e) => {
                            e.stopPropagation();
                            setActive(m, !m.is_active);
                          }}
                          className="flex h-7 w-7 items-center justify-center rounded text-primary/70 hover:bg-primary/10 hover:text-primary"
                        >
                          {m.is_active ? <EyeOff className="h-3.5 w-3.5" /> : <Eye className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                    </div>
                  );
                })
              )}
            </div>

            <div className="hidden flex-wrap items-center gap-x-4 gap-y-1 border-t border-border bg-muted/40 px-3 py-2 text-xs text-muted-foreground md:flex">
              <span>
                <Kbd>↑</Kbd> <Kbd>↓</Kbd> move
              </span>
              <span>
                <Kbd>→</Kbd> <Kbd>←</Kbd> open / close
              </span>
              <span>
                <Kbd>Enter</Kbd> edit
              </span>
              <span>
                <Kbd>Alt ↑↓</Kbd> reorder
              </span>
              <span>
                <Kbd>Alt →</Kbd> nest under the one above · <Kbd>Alt ←</Kbd> move out
              </span>
            </div>
          </div>

          {/* Editor — a side panel on desktop, a bottom sheet on a phone */}
          <div
            className={`${editor ? "max-lg:fixed max-lg:inset-0 max-lg:z-50 max-lg:flex max-lg:items-end max-lg:bg-black/40" : "max-lg:hidden"} lg:sticky lg:top-4`}
            onClick={(e) => e.target === e.currentTarget && closeEditor()}
          >
            <div className="w-full overflow-hidden rounded-xl border border-border bg-background max-lg:max-h-[90vh] max-lg:overflow-y-auto max-lg:rounded-b-none">
              {!editor ? (
                <div className="px-6 py-14 text-center">
                  <p className="font-semibold text-foreground">Pick a menu to edit</p>
                  <p className="mt-1 text-sm text-muted-foreground">
                    Or press <Kbd>N</Kbd> for a new one.
                  </p>
                </div>
              ) : (
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    save();
                  }}
                >
                  <div className="flex items-start justify-between gap-3 border-b border-primary/15 bg-primary/5 px-4 py-3">
                    <div className="min-w-0">
                      <p className="text-[15px] font-semibold text-primary">
                        {editor.mode === "new" ? "New menu" : "Edit menu"}
                        {dirty && <span className="ml-2 text-xs font-normal text-muted-foreground">· unsaved</span>}
                      </p>
                      <p className="truncate text-xs text-muted-foreground">
                        {editor.mode === "edit" && editing
                          ? `${pathOf(editing.id)} · position ${sameParentPos.at} of ${sameParentPos.of}`
                          : form.parent_id != null
                            ? `Under ${pathOf(form.parent_id)}`
                            : "Top level"}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={closeEditor}
                      className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
                      aria-label="Close"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  </div>

                  <div className="space-y-4 p-4">
                    {/* live preview of the sidebar row */}
                    <div className="flex items-center gap-2.5 rounded-lg bg-primary px-3 py-2.5 text-primary-foreground">
                      <PreviewIcon className="h-4 w-4 flex-shrink-0" />
                      <span className="truncate text-sm font-medium">{form.title || "Menu title"}</span>
                      {!form.is_active && <span className="ml-auto text-[11px] opacity-80">hidden</span>}
                    </div>

                    <div>
                      <label htmlFor="menu-title" className="mb-1 block text-[12.5px] font-semibold text-foreground/80">
                        Title <span className="text-primary">*</span>
                      </label>
                      <Input
                        id="menu-title"
                        ref={titleRef}
                        value={form.title}
                        onChange={(e) => setForm({ ...form, title: e.target.value })}
                        placeholder="e.g. Sale Invoice"
                        className="h-10"
                      />
                    </div>

                    <div>
                      <label htmlFor="menu-url" className="mb-1 block text-[12.5px] font-semibold text-foreground/80">
                        URL
                      </label>
                      <Input
                        id="menu-url"
                        value={form.url}
                        onChange={(e) => setForm({ ...form, url: e.target.value })}
                        placeholder="/accounting/… — leave empty for a group"
                        className="h-10 font-mono text-[13px]"
                      />
                      {urlClash && (
                        <p className="mt-1 rounded-md bg-[#f5f0e6] px-2 py-1 text-xs text-[#5f4b1f]">
                          “{urlClash.title}” already opens this URL ({pathOf(urlClash.id)}).
                        </p>
                      )}
                    </div>

                    <div>
                      <label className="mb-1 block text-[12.5px] font-semibold text-foreground/80">Icon</label>
                      <IconPicker value={form.icon} onChange={(icon) => setForm({ ...form, icon })} />
                      {!knownIcon(form.icon.trim()) && (
                        <p className="mt-1 text-xs text-[#5f4b1f]">
                          “{form.icon}” isn’t an icon the sidebar knows — it will show the default one.
                        </p>
                      )}
                    </div>

                    <div>
                      <label htmlFor="menu-parent" className="mb-1 block text-[12.5px] font-semibold text-foreground/80">
                        Inside
                      </label>
                      <select
                        id="menu-parent"
                        value={form.parent_id ?? ""}
                        onChange={(e) => setForm({ ...form, parent_id: e.target.value === "" ? null : Number(e.target.value) })}
                        className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
                      >
                        <option value="">— Top level —</option>
                        {parentChoices.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.label}
                          </option>
                        ))}
                      </select>
                      <p className="mt-1 text-xs text-muted-foreground">A moved menu goes to the end of its new group.</p>
                    </div>

                    <label className="flex items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
                      <span>
                        <span className="block text-sm font-semibold text-foreground">Show in the sidebar</span>
                        <span className="block text-xs text-muted-foreground">Hidden menus stay here and keep people’s access.</span>
                      </span>
                      <Switch checked={form.is_active} onCheckedChange={(v) => setForm({ ...form, is_active: v })} />
                    </label>

                    {editor.mode === "edit" && editing && !filtering && (
                      <div>
                        <p className="mb-1 text-[12.5px] font-semibold text-foreground/80">Move</p>
                        <div className="grid grid-cols-4 gap-2">
                          {[
                            [ArrowUp, "Up", () => moveBy(editing.id, -1)],
                            [ArrowDown, "Down", () => moveBy(editing.id, 1)],
                            [ArrowRight, "In", () => indent(editing.id)],
                            [ArrowLeft, "Out", () => outdent(editing.id)],
                          ].map(([I, l, fn]) => (
                            <Button key={l} type="button" variant="outline" size="sm" className="h-9 gap-1.5" onClick={fn} disabled={reordering || dirty}>
                              <I className="h-3.5 w-3.5" />
                              {l}
                            </Button>
                          ))}
                        </div>
                        {dirty && <p className="mt-1 text-xs text-muted-foreground">Save your changes first.</p>}
                      </div>
                    )}

                    {formError && (
                      <p className="rounded-md bg-destructive/10 px-3 py-2 text-sm font-medium text-destructive">{formError}</p>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/40 px-4 py-3">
                    {editor.mode === "edit" && editing ? (
                      <Button type="button" variant="ghost" size="sm" className="h-9 gap-1.5 text-primary" onClick={() => openNew(editing.id)}>
                        <Plus className="h-4 w-4" />
                        Sub-menu
                      </Button>
                    ) : (
                      <span />
                    )}
                    <div className="flex gap-2">
                      <Button type="button" variant="outline" className="h-9 bg-background" onClick={closeEditor}>
                        Cancel
                      </Button>
                      <Button type="submit" className="h-9 gap-2" disabled={saving || (editor.mode === "edit" && !dirty)}>
                        {saving && <Loader2 className="h-4 w-4 animate-spin" />}
                        {editor.mode === "new" ? "Add menu" : "Save"}
                        <kbd className="hidden rounded border border-white/40 px-1 font-mono text-[10.5px] sm:inline">Ctrl+S</kbd>
                      </Button>
                    </div>
                  </div>
                </form>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

// Icon picker: search the icons the sidebar can draw.
function IconPicker({ value, onChange }) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");
  const Current = iconOf(value);
  const matches = useMemo(() => {
    const t = q.trim().toLowerCase();
    return (t ? ICON_NAMES.filter((n) => n.toLowerCase().includes(t)) : ICON_NAMES).slice(0, 96);
  }, [q]);
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex h-10 w-full items-center gap-2.5 rounded-md border border-input bg-background px-3 text-left text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
        >
          <span className="flex h-7 w-7 items-center justify-center rounded-md bg-primary/10 text-primary">
            <Current className="h-4 w-4" />
          </span>
          <span className={value ? "font-medium" : "text-muted-foreground"}>{value || "Choose an icon"}</span>
          {value && (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear icon"
              onClick={(e) => {
                e.stopPropagation();
                onChange("");
              }}
              className="ml-auto rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-[340px] p-2" align="start">
        <Input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search icons — e.g. file, users, box" className="mb-2 h-9" />
        <div className="grid max-h-64 grid-cols-8 gap-1 overflow-y-auto">
          {matches.map((name) => {
            const I = Icons[name];
            return (
              <button
                key={name}
                type="button"
                title={name}
                onClick={() => {
                  onChange(name);
                  setOpen(false);
                }}
                className={`flex h-9 w-9 items-center justify-center rounded-md hover:bg-primary/10 hover:text-primary ${
                  value === name ? "bg-primary text-primary-foreground hover:bg-primary hover:text-primary-foreground" : "text-foreground/80"
                }`}
              >
                <I className="h-4 w-4" />
              </button>
            );
          })}
        </div>
        {matches.length === 0 && <p className="py-6 text-center text-sm text-muted-foreground">No icon matches “{q}”.</p>}
        <p className="mt-2 text-[11px] text-muted-foreground">Showing up to 96 — type to narrow down.</p>
      </PopoverContent>
    </Popover>
  );
}
