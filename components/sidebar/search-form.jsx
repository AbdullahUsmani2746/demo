"use client";
// The header search (Ctrl+K): jump to any page this person has in their menu.
// The list is the sidebar's own (useNavItems.js), so search and sidebar always
// show the same menus, plus the personal pages of useQuickLinks.js.
// Empty box → the pages opened last from here.
import * as React from "react";
import { useRouter } from "next/navigation";
import * as Icons from "lucide-react";
import { CornerDownLeft, FileText, History, Search } from "lucide-react";
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from "@/components/ui/command";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { useNavItems } from "@/components/sidebar/useNavItems";
import { useQuickLinks } from "@/components/sidebar/useQuickLinks";

const RECENT_KEY = "nav_search_recent";
const iconFor = (icon) => (typeof icon === "string" ? Icons[icon] || FileText : icon || FileText);

// Every page in the tree, with its group (top-level menu) and the path to it.
function flatten(items, trail = []) {
  const out = [];
  for (const it of items || []) {
    const here = [...trail, it.title];
    if (it.url && it.url !== "#") {
      out.push({ name: it.title, path: it.url, icon: it.icon, group: trail[0] || it.title, trail: trail.slice(1) });
    }
    if (it.items?.length) out.push(...flatten(it.items, here));
  }
  return out;
}

function Marked({ text, term }) {
  const s = String(text || "");
  const i = term ? s.toLowerCase().indexOf(term) : -1;
  if (i < 0) return s;
  return (
    <>
      {s.slice(0, i)}
      <mark className="rounded-sm bg-primary/15 px-0.5 text-inherit group-data-[selected=true]:bg-white/25">{s.slice(i, i + term.length)}</mark>
      {s.slice(i + term.length)}
    </>
  );
}

function readRecent() {
  try {
    return JSON.parse(localStorage.getItem(RECENT_KEY) || "[]");
  } catch {
    return [];
  }
}

export function SearchForm({ className = "", employeeId, role }) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [recent, setRecent] = React.useState([]);
  const router = useRouter();
  const { items, loading } = useNavItems(role, employeeId);
  // Personal pages outside the menu tree (My HR, BI Designer, Approvals, …).
  const { links } = useQuickLinks();
  const pages = React.useMemo(() => {
    const seen = new Set();
    const quick = links.map((l) => ({ name: l.title, path: l.url, icon: l.icon, group: "Your pages", trail: [] }));
    return [...flatten(items), ...quick].filter((p) => (seen.has(p.path) ? false : seen.add(p.path)));
  }, [items, links]);

  React.useEffect(() => {
    if (open) setRecent(readRecent());
    else setQuery("");
  }, [open]);

  React.useEffect(() => {
    const down = (e) => {
      if (e.key.toLowerCase() === "k" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    document.addEventListener("keydown", down);
    return () => document.removeEventListener("keydown", down);
  }, []);

  const term = query.trim().toLowerCase();
  const results = React.useMemo(() => {
    if (!term) return [];
    const words = term.split(/\s+/);
    return pages
      .map((p) => {
        const hay = `${p.name} ${p.group} ${p.trail.join(" ")}`.toLowerCase();
        if (!words.every((w) => hay.includes(w))) return null;
        const name = p.name.toLowerCase();
        const score = name === term ? 0 : name.startsWith(term) ? 1 : name.includes(term) ? 2 : 3;
        return { ...p, score };
      })
      .filter(Boolean)
      .sort((a, b) => a.score - b.score || a.name.localeCompare(b.name))
      .slice(0, 60);
  }, [pages, term]);

  const grouped = React.useMemo(() => {
    const g = new Map();
    for (const r of results) {
      if (!g.has(r.group)) g.set(r.group, []);
      g.get(r.group).push(r);
    }
    return [...g.entries()];
  }, [results]);

  // Recent pages that are still in this person's menu.
  const recentPages = React.useMemo(() => recent.map((path) => pages.find((p) => p.path === path)).filter(Boolean), [recent, pages]);

  const go = (path) => {
    try {
      const next = [path, ...readRecent().filter((p) => p !== path)].slice(0, 6);
      localStorage.setItem(RECENT_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
    setOpen(false);
    router.push(path);
  };

  const Row = ({ p }) => {
    const Icon = iconFor(p.icon);
    return (
      <CommandItem
        value={p.path}
        onSelect={() => go(p.path)}
        className="group flex cursor-pointer items-center gap-3 rounded-lg px-2.5 py-2 data-[selected=true]:bg-primary data-[selected=true]:text-primary-foreground"
      >
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary group-data-[selected=true]:bg-white/20 group-data-[selected=true]:text-white">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block truncate text-sm font-medium">
            <Marked text={p.name} term={term} />
          </span>
          <span className="block truncate text-[11.5px] text-muted-foreground group-data-[selected=true]:text-white/75">
            {[p.group, ...p.trail].filter((x) => x && x !== p.name).join(" › ") || p.path}
          </span>
        </span>
        <CornerDownLeft className="hidden h-3.5 w-3.5 opacity-0 group-data-[selected=true]:opacity-80 sm:block" />
      </CommandItem>
    );
  };

  return (
    <>
      {/* Phone: an icon */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Search menus"
        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg text-primary-foreground hover:bg-white/15 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 md:hidden"
      >
        <Search className="h-5 w-5" />
      </button>
      {/* Wider screens: a search bar */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        className={`hidden h-9 items-center gap-2 rounded-lg bg-white/10 px-3 text-left text-sm text-white/75 ring-1 ring-white/15 transition-colors hover:bg-white/15 hover:text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/50 md:flex ${className}`}
      >
        <Search className="h-4 w-4 flex-shrink-0" />
        <span className="flex-1 truncate">Search menus…</span>
        <kbd className="rounded border border-white/25 px-1.5 font-mono text-[10.5px] text-white/80">Ctrl K</kbd>
      </button>

      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="bottom-auto top-[12%] max-w-xl gap-0 overflow-hidden rounded-xl p-0 [&>button]:hidden">
          <DialogHeader className="sr-only">
            <DialogTitle>Search menus</DialogTitle>
          </DialogHeader>
          <Command shouldFilter={false} loop className="rounded-none">
            <CommandInput value={query} onValueChange={setQuery} placeholder="Search a page — e.g. payment, stock, customer…" className="h-12 text-[15px]" />
            <CommandList className="max-h-[min(60vh,440px)] p-1.5">
              {loading && !pages.length ? (
                <p className="py-10 text-center text-sm text-muted-foreground">Loading menus…</p>
              ) : !pages.length ? (
                <p className="py-10 text-center text-sm text-muted-foreground">No menus are assigned to you yet.</p>
              ) : term ? (
                <>
                  <CommandEmpty className="py-10 text-center text-sm text-muted-foreground">Nothing matches “{query}”.</CommandEmpty>
                  {grouped.map(([group, rows]) => (
                    <CommandGroup
                      key={group}
                      heading={group}
                      className="[&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-primary"
                    >
                      {rows.map((p) => (
                        <Row key={p.path} p={p} />
                      ))}
                    </CommandGroup>
                  ))}
                </>
              ) : recentPages.length ? (
                <CommandGroup
                  heading={
                    <span className="flex items-center gap-1.5">
                      <History className="h-3 w-3" /> Recent
                    </span>
                  }
                  className="[&_[cmdk-group-heading]]:text-[10.5px] [&_[cmdk-group-heading]]:font-bold [&_[cmdk-group-heading]]:uppercase [&_[cmdk-group-heading]]:tracking-wider [&_[cmdk-group-heading]]:text-primary"
                >
                  {recentPages.map((p) => (
                    <Row key={p.path} p={p} />
                  ))}
                </CommandGroup>
              ) : (
                <p className="py-10 text-center text-sm text-muted-foreground">
                  Type to search {pages.length} pages.
                </p>
              )}
            </CommandList>
            <div className="flex items-center justify-between gap-3 border-t border-border bg-muted/40 px-3 py-2 text-[11.5px] text-muted-foreground">
              <span className="flex items-center gap-3">
                <span>
                  <kbd className="rounded border bg-background px-1 font-mono">↑↓</kbd> move
                </span>
                <span>
                  <kbd className="rounded border bg-background px-1 font-mono">Enter</kbd> open
                </span>
                <span>
                  <kbd className="rounded border bg-background px-1 font-mono">Esc</kbd> close
                </span>
              </span>
              <span>{pages.length} pages</span>
            </div>
          </Command>
        </DialogContent>
      </Dialog>
    </>
  );
}
