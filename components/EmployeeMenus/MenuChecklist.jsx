"use client";
// components/EmployeeMenus/MenuChecklist.jsx — the active menu tree.
//   mode="check"  tick boxes, tri-state parents (a parent ticks / unticks its
//                 whole branch; part of it ticked = the dash). Used by
//                 "By employee".
//   mode="pick"   one menu is chosen (rows are buttons). Used by "By menu".
// Search marks matches and opens the menus above them; expand / collapse all.
import { useEffect, useMemo, useState } from "react";
import { ChevronRight, ChevronsDownUp, ChevronsUpDown, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { states as treeStates, searchTree, visibleRows, kidsOf } from "./menuTree";
import { Highlight, TriCheck, iconOf } from "./shared";
import { cn } from "@/lib/utils";

export default function MenuChecklist({
  tree,
  mode = "check",
  ticked,
  onToggle, // (id, value) in check mode
  readOnly = false,
  selectedId, // pick mode
  onPick, // pick mode
  toolbar, // extra buttons (Select all, Copy from…)
  className,
  maxHeight = "max-h-[calc(100vh-330px)]",
}) {
  const [expanded, setExpanded] = useState(() => new Set());
  const [term, setTerm] = useState("");

  // Open the top level on first load, so the tree is not a single closed row.
  useEffect(() => {
    if (tree && expanded.size === 0) setExpanded(new Set(tree.roots.filter((r) => kidsOf(tree, r).length)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tree]);

  const search = useMemo(() => (tree ? searchTree(tree, term) : null), [tree, term]);
  const rows = useMemo(() => (tree ? visibleRows(tree, expanded, search) : []), [tree, expanded, search]);
  const st = useMemo(() => (tree && mode === "check" ? treeStates(tree, ticked || new Set()) : null), [tree, ticked, mode]);

  const toggleOpen = (id) =>
    setExpanded((s) => {
      const n = new Set(s);
      if (n.has(id)) n.delete(id);
      else n.add(id);
      return n;
    });
  const expandAll = () => setExpanded(new Set([...tree.byId.keys()].filter((id) => kidsOf(tree, id).length)));
  const collapseAll = () => setExpanded(new Set());

  // ticked / total leaves under each parent, for the "3/7" hint (one pass)
  const counts = useMemo(() => {
    const out = new Map();
    if (!tree || mode !== "check") return out;
    const visit = (id) => {
      const k = kidsOf(tree, id);
      if (!k.length) return { total: 1, on: ticked?.has(id) ? 1 : 0 };
      const c = { total: 0, on: 0 };
      for (const x of k) {
        const r = visit(x);
        c.total += r.total;
        c.on += r.on;
      }
      out.set(id, c);
      return c;
    };
    tree.roots.forEach(visit);
    return out;
  }, [tree, ticked, mode]);
  const leafCount = (id) => counts.get(id) || null;

  return (
    <div className={cn("flex min-w-0 flex-col", className)}>
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <label className="flex h-9 min-w-[180px] flex-1 items-center gap-2 rounded-lg border border-border bg-background px-3 text-muted-foreground focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
          <Search className="h-4 w-4 flex-shrink-0" />
          <input
            value={term}
            onChange={(e) => setTerm(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setTerm("")}
            placeholder="Search menus or URLs…"
            aria-label="Search menus"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
          />
          {term && (
            <button type="button" onClick={() => setTerm("")} aria-label="Clear search" className="hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          )}
        </label>
        <div className="flex flex-wrap gap-1">
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={expandAll} disabled={!!search} title="Expand all">
            <ChevronsUpDown className="mr-1 h-3.5 w-3.5" /> Expand
          </Button>
          <Button variant="ghost" size="sm" className="h-8 px-2 text-xs" onClick={collapseAll} disabled={!!search} title="Collapse all">
            <ChevronsDownUp className="mr-1 h-3.5 w-3.5" /> Collapse
          </Button>
          {toolbar}
        </div>
      </div>

      {search && (
        <p className="border-b border-border bg-muted/40 px-3 py-1.5 text-[12px] text-muted-foreground">
          {search.matches.size} match{search.matches.size === 1 ? "" : "es"} — the menus above them are opened.
        </p>
      )}

      <div role="tree" aria-label="Menus" aria-multiselectable={mode === "check"} className={cn("overflow-y-auto", maxHeight)}>
        {rows.length === 0 ? (
          <div className="px-4 py-12 text-center">
            <p className="font-semibold text-foreground">{search ? "No menu matches" : "No active menus"}</p>
            <p className="mt-1 text-sm text-muted-foreground">{search ? "Try another word." : "Add or switch on menus on the Menus page."}</p>
          </div>
        ) : (
          rows.map((row) => {
            const m = tree.byId.get(row.id);
            const Icon = iconOf(m.icon);
            const s = st?.get(row.id);
            const hit = search?.matches.has(row.id);
            const picked = mode === "pick" && selectedId === row.id;
            const lc = row.kids && mode === "check" ? leafCount(row.id) : null;
            const activate = () => {
              if (mode === "pick") onPick?.(row.id);
              else if (!readOnly) onToggle?.(row.id, s !== "on");
            };
            return (
              <div
                key={row.id}
                role="treeitem"
                aria-level={row.depth + 1}
                aria-expanded={row.kids ? row.open : undefined}
                aria-selected={mode === "pick" ? picked : s === "on"}
                tabIndex={0}
                onClick={activate}
                onKeyDown={(e) => {
                  if (e.key === " " || e.key === "Enter") {
                    e.preventDefault();
                    activate();
                  } else if (e.key === "ArrowRight" && row.kids && !row.open && !search) toggleOpen(row.id);
                  else if (e.key === "ArrowLeft" && row.kids && row.open && !search) toggleOpen(row.id);
                }}
                className={cn(
                  "group flex min-h-[44px] cursor-pointer items-center gap-2 border-b border-border/60 px-2 py-1.5 outline-none transition-colors focus-visible:bg-primary/[0.05] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40",
                  picked ? "bg-primary/[0.08]" : s === "on" ? "bg-primary/[0.025] hover:bg-primary/[0.05]" : "hover:bg-primary/[0.03]",
                  readOnly && mode === "check" && "cursor-default",
                )}
              >
                <span style={{ width: row.depth * 18 }} className="relative flex-shrink-0 self-stretch" aria-hidden="true">
                  {Array.from({ length: row.depth }).map((_, i) => (
                    <span key={i} className="absolute inset-y-[-6px] w-px bg-border" style={{ left: i * 18 + 8 }} />
                  ))}
                </span>

                {row.kids ? (
                  <button
                    type="button"
                    tabIndex={-1}
                    onClick={(e) => {
                      e.stopPropagation();
                      if (!search) toggleOpen(row.id);
                    }}
                    className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"
                    aria-label={row.open ? "Close" : "Open"}
                  >
                    <ChevronRight className={cn("h-4 w-4 transition-transform", row.open && "rotate-90")} />
                  </button>
                ) : (
                  <span className="w-6 flex-shrink-0" />
                )}

                {mode === "check" && (
                  <TriCheck state={s} disabled={readOnly} label={m.title} onChange={(v) => onToggle?.(row.id, v)} />
                )}

                <span
                  className={cn(
                    "flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md",
                    picked || s === "on" || s === "mixed" ? "bg-primary/10 text-primary" : "bg-muted text-muted-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" />
                </span>

                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-2">
                    <span className={cn("truncate text-sm", row.depth === 0 ? "font-semibold" : "font-medium", hit ? "text-foreground" : "text-foreground/90")}>
                      <Highlight text={m.title} term={term} />
                    </span>
                    {lc && lc.total > 0 && (
                      <span
                        className={cn(
                          "flex-shrink-0 rounded-full px-1.5 text-[11px] font-bold tabular-nums",
                          lc.on === 0 ? "bg-muted text-muted-foreground" : "bg-primary/10 text-primary",
                        )}
                      >
                        {lc.on}/{lc.total}
                      </span>
                    )}
                    {mode === "pick" && row.kids > 0 && (
                      <span className="flex-shrink-0 rounded-full bg-muted px-1.5 text-[11px] font-bold tabular-nums text-muted-foreground">{row.kids}</span>
                    )}
                  </div>
                  {m.url && m.url !== "#" && (
                    <p className="truncate font-mono text-[11.5px] text-muted-foreground">
                      <Highlight text={m.url} term={term} />
                    </p>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
