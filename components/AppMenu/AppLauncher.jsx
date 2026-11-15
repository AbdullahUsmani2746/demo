"use client";
import { useSession } from "next-auth/react";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  ArrowRight,
  Check,
  Clock3,
  CornerDownLeft,
  Layers,
  LayoutGrid,
  Search,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { toast } from "sonner";

import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { usePermissions } from "@/hooks/usePermissions";
import { useMenuTree } from "@/hooks/useMenuTree";
import { useAppMenuSettings } from "@/hooks/useAppMenuSettings";
import {
  accentForPosition,
  accentForTitle,
  flattenLeaves,
  pushRecent,
  readRecents,
  resolveMenuIcon,
  subLevelTiles,
} from "@/lib/menu/appMenu";
import {
  APP_MENU_SETTINGS_PERMISSION,
  LEVEL,
  ORDER_SOURCE,
  THRESHOLD_MAX,
  THRESHOLD_MIN,
  effectiveLevel,
} from "@/lib/menu/appMenuSettings";

function highlight(text, query) {
  if (!query) return text;
  const index = text.toLowerCase().indexOf(query.toLowerCase());
  if (index === -1) return text;

  return (
    <>
      {text.slice(0, index)}
      <mark className="rounded bg-primary/15 px-0.5 text-foreground">
        {text.slice(index, index + query.length)}
      </mark>
      {text.slice(index + query.length)}
    </>
  );
}

function ModuleTile({ module, accent, onOpen }) {
  const Icon = resolveMenuIcon(module);
  const pageCount = flattenLeaves(module.items).length;

  // A tile with children opens its own section page; one that is only a link
  // goes straight to the page.
  const href = module.items?.length
    ? `/accounting/apps/${module.id}`
    : module.url || "#";

  // Some modules are configured with neither a url nor any children — show
  // them inert rather than as a live tile that does nothing when clicked.
  if (href === "#") {
    return (
      <div
        className="flex cursor-not-allowed flex-col items-center gap-3.5 rounded-2xl border border-dashed border-border/70 bg-card/50 px-4 py-6 text-center"
        title={`${module.title} has no pages configured`}
      >
        <span className="flex h-14 w-14 items-center justify-center rounded-2xl bg-muted text-muted-foreground">
          <Icon className="h-7 w-7" strokeWidth={1.75} />
        </span>
        <span className="space-y-1">
          <span className="block text-[13px] font-semibold leading-snug tracking-tight text-muted-foreground">
            {module.title}
          </span>
          <span className="block text-[11px] font-medium text-muted-foreground/70">No pages</span>
        </span>
      </div>
    );
  }

  return (
    <Link
      href={href}
      onClick={() => onOpen(module)}
      className="group relative flex flex-col items-center gap-3.5 overflow-hidden rounded-xl border border-border bg-background px-4 py-5 text-center transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    >
      {/* Colour wash that fades in on hover */}
      <span
        className="pointer-events-none absolute inset-x-0 -top-16 h-32 opacity-0 blur-2xl transition-opacity duration-300 group-hover:opacity-20"
        style={accent.barStyle}
        aria-hidden="true"
      />

      {/* bg-primary is the floor: the gradient paints background-image over it,
          so even if that utility ever goes missing the white icon stays legible */}
      <span
        className="relative flex h-14 w-14 items-center justify-center rounded-2xl text-white shadow-md transition-transform duration-300 group-hover:scale-110"
        style={accent.iconStyle}
      >
        <Icon className="h-7 w-7" strokeWidth={1.75} />
      </span>

      <span className="relative space-y-1">
        {module.parentTitle && (
          <span className="block truncate text-[10px] font-semibold uppercase tracking-wider text-muted-foreground/70">
            {module.parentTitle}
          </span>
        )}
        <span className="block text-[13px] font-semibold leading-snug tracking-tight text-foreground">
          {module.title}
        </span>
        <span className="block text-[11px] font-medium text-muted-foreground">
          {pageCount > 0 ? `${pageCount} page${pageCount === 1 ? "" : "s"}` : "Open"}
        </span>
      </span>

      <ArrowRight className="absolute right-3 top-3 h-4 w-4 -translate-x-1 text-muted-foreground opacity-0 transition-all duration-300 group-hover:translate-x-0 group-hover:opacity-100" />
    </Link>
  );
}

function ResultRow({ leaf, query, active, onOpen, onHover }) {
  const Icon = resolveMenuIcon(leaf);
  const accent = accentForTitle(leaf.trail[0] || leaf.title);

  return (
    <Link
      href={leaf.url}
      onMouseEnter={onHover}
      onClick={onOpen}
      className={`group flex items-center gap-3 rounded-xl border px-4 py-3 transition-all duration-200 ${
        active
          ? "border-primary/40 bg-primary/5 shadow-sm"
          : "border-border/70 bg-card hover:border-border hover:bg-muted/40"
      }`}
    >
      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg" style={accent.softStyle}>
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </span>

      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-medium leading-tight">
          {highlight(leaf.title, query)}
        </span>
        {leaf.trail.length > 0 && (
          <span className="mt-0.5 block truncate text-[11px] font-medium text-muted-foreground">
            {leaf.trail.join("  ›  ")}
          </span>
        )}
      </span>

      <CornerDownLeft
        className={`h-3.5 w-3.5 shrink-0 text-muted-foreground transition-opacity ${
          active ? "opacity-100" : "opacity-0 group-hover:opacity-60"
        }`}
      />
    </Link>
  );
}

function ViewSettings({ settings, level, saving, onChange }) {
  const option = (label, hint, isActive, value, field) => (
    <DropdownMenuItem
      key={`${field}-${value}`}
      className="cursor-pointer gap-2 py-2"
      onSelect={(e) => {
        e.preventDefault();
        if (!isActive) onChange({ [field]: value });
      }}
      disabled={saving}
    >
      <Check className={`h-4 w-4 shrink-0 ${isActive ? "opacity-100" : "opacity-0"}`} />
      <span className="flex flex-col">
        <span className="text-sm">{label}</span>
        <span className="text-[11px] text-muted-foreground">{hint}</span>
      </span>
    </DropdownMenuItem>
  );

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button variant="outline" className="h-10 gap-2 bg-background">
          <SlidersHorizontal className="h-4 w-4" />
          <span className="hidden sm:inline">View</span>
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-72">
        <DropdownMenuLabel className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Tile depth
        </DropdownMenuLabel>
        {option(
          `Automatic${settings.level === LEVEL.AUTO ? ` — showing ${level === LEVEL.SUB ? "sub level" : "modules"}` : ""}`,
          `Sub level when you have fewer than ${settings.autoThreshold} module${settings.autoThreshold === 1 ? "" : "s"}`,
          settings.level === LEVEL.AUTO,
          LEVEL.AUTO,
          "level"
        )}
        {option("Modules (level 0)", "SALES, LAB, STORES …", settings.level === LEVEL.MODULE, LEVEL.MODULE, "level")}
        {option("Sub level", "One level deeper, e.g. SALES › CUSTOMER", settings.level === LEVEL.SUB, LEVEL.SUB, "level")}

        <DropdownMenuSeparator />
        <DropdownMenuLabel className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
          Module order
        </DropdownMenuLabel>
        {option(
          "Built-in list",
          "SALES, LAB, STORES, PRODUCTION …",
          settings.orderSource === ORDER_SOURCE.LIST,
          ORDER_SOURCE.LIST,
          "orderSource"
        )}
        {option(
          "Menu order_no",
          "Uses the order_no you set in Setup → Menu",
          settings.orderSource === ORDER_SOURCE.ORDER_NO,
          ORDER_SOURCE.ORDER_NO,
          "orderSource"
        )}

        <DropdownMenuSeparator />
        <div
          className="px-2 py-2"
          // The input lives inside the menu, so stop keystrokes from being
          // treated as menu type-ahead and closing it.
          onKeyDown={(e) => e.stopPropagation()}
        >
          <label
            htmlFor="app-menu-threshold"
            className="block text-[11px] font-semibold text-muted-foreground"
          >
            Use sub level below
          </label>
          <div className="mt-1.5 flex items-center gap-2">
            <input
              id="app-menu-threshold"
              type="number"
              min={THRESHOLD_MIN}
              max={THRESHOLD_MAX}
              defaultValue={settings.autoThreshold}
              disabled={saving}
              onBlur={(e) => {
                const next = Number.parseInt(e.target.value, 10);
                if (!Number.isNaN(next) && next !== settings.autoThreshold) {
                  onChange({ autoThreshold: next });
                }
              }}
              className="h-8 w-16 rounded-lg border border-border/70 bg-background px-2 text-sm outline-none focus:border-primary/50 focus:ring-2 focus:ring-primary/10"
            />
            <span className="text-[11px] text-muted-foreground">modules</span>
          </div>
        </div>

        <DropdownMenuSeparator />
        <p className="px-2 py-1.5 text-[11px] leading-relaxed text-muted-foreground">
          Saved in Settings, applies to everyone.
        </p>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

export default function AppLauncher({ employeeId, role }) {
  const { settings, update, saving } = useAppMenuSettings();
  const { data: session } = useSession();
  const all = session?.user?.navMode === "all";
  const { menus, loading } = useMenuTree(all ? null : employeeId, { all });
  const { can } = usePermissions();
  const router = useRouter();
  const inputRef = useRef(null);

  const [query, setQuery] = useState("");
  const [activeIndex, setActiveIndex] = useState(0);
  const [recents, setRecents] = useState([]);

  useEffect(() => setRecents(readRecents()), []);

  // AUTO resolves against how many modules this user actually has, so someone
  // assigned a single menu gets its children as tiles instead of one icon.
  const level = effectiveLevel(settings.level, menus.length, settings.autoThreshold);

  const tiles = useMemo(
    () => (level === LEVEL.SUB ? subLevelTiles(menus) : menus),
    [menus, level]
  );

  // Search always covers every page on screen, whatever the tile depth.
  const allLeaves = useMemo(() => flattenLeaves(menus), [menus]);

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    return allLeaves
      .filter(
        (leaf) =>
          leaf.title.toLowerCase().includes(q) ||
          leaf.trail.join(" ").toLowerCase().includes(q)
      )
      .slice(0, 40);
  }, [allLeaves, query]);

  const searching = query.trim().length > 0;

  useEffect(() => setActiveIndex(0), [query]);

  // "/" focuses this search (Ctrl+K is the header's menu search).
  useEffect(() => {
    const onKeyDown = (e) => {
      const typingElsewhere =
        e.target instanceof HTMLElement &&
        ["INPUT", "TEXTAREA", "SELECT"].includes(e.target.tagName);

      if (e.key === "/" && !typingElsewhere) {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, []);

  const remember = (node, group) =>
    pushRecent({ title: node.title, url: node.url, icon: node.icon, group });

  const onSearchKeyDown = (e) => {
    if (!results.length) return;

    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (i + 1) % results.length);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (i - 1 + results.length) % results.length);
    } else if (e.key === "Enter") {
      e.preventDefault();
      const leaf = results[activeIndex];
      if (leaf) {
        remember(leaf, leaf.trail[0]);
        router.push(leaf.url);
      }
    } else if (e.key === "Escape") {
      setQuery("");
    }
  };

  const onSettingChange = async (patch) => {
    const result = await update(patch);
    if (!result.ok) toast.error(result.error);
  };

  const canEditSettings = can(APP_MENU_SETTINGS_PERMISSION);
  const totalPages = allLeaves.length;

  return (
    <div className="min-h-[calc(100svh-var(--header-height))] bg-muted/40">
      <div className="mx-auto w-full max-w-[1400px] px-3 py-5 sm:px-6">
        {/* ── Header ── */}
        <div className="mb-6 flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20">
              <LayoutGrid className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] text-muted-foreground">
                Workspace · <kbd className="rounded border border-b-2 border-border bg-background px-1 font-mono text-[10.5px]">Alt+G</kbd> from anywhere
              </p>
              <h1 className="flex flex-wrap items-center gap-2.5 text-2xl font-bold tracking-tight text-foreground">
                Applications
                {!loading && (
                  <>
                    <span className="inline-flex h-6 items-center rounded-full bg-primary/10 px-2.5 text-xs font-bold tabular-nums text-primary">
                      {tiles.length} {level === LEVEL.SUB ? "section" : "module"}
                      {tiles.length === 1 ? "" : "s"}
                    </span>
                    <span className="inline-flex h-6 items-center rounded-full bg-muted px-2.5 text-xs font-semibold tabular-nums text-muted-foreground">
                      {totalPages} page{totalPages === 1 ? "" : "s"}
                    </span>
                  </>
                )}
              </h1>
            </div>
          </div>

          <div className="flex w-full items-start gap-2 lg:w-auto">
            {/* ── Search ── */}
            <div className="w-full lg:w-96">
              <div className="group relative">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={onSearchKeyDown}
                  placeholder="Search every page…"
                  aria-label="Search every page"
                  className="h-10 w-full rounded-lg border border-border bg-background pl-10 pr-14 text-sm font-medium outline-none transition-colors placeholder:font-normal placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
                />
                {searching ? (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear search"
                    className="absolute right-3 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-4 w-4" />
                  </button>
                ) : (
                  <kbd className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 rounded border border-b-2 border-border bg-background px-1.5 font-mono text-[10.5px] font-semibold text-muted-foreground">
                    /
                  </kbd>
                )}
              </div>
              {searching && (
                <p className="mt-2 pl-1 text-[11px] font-medium text-muted-foreground">
                  {results.length} result{results.length === 1 ? "" : "s"} &middot; &uarr; &darr; to move &middot; Enter to open
                </p>
              )}
            </div>

            {canEditSettings && (
              <ViewSettings
                settings={settings}
                level={level}
                saving={saving}
                onChange={onSettingChange}
              />
            )}
          </div>
        </div>

        {/* ── Body ── */}
        {loading ? (
          <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
            {Array.from({ length: 12 }).map((_, i) => (
              <Skeleton key={i} className="h-[148px] rounded-2xl" />
            ))}
          </div>
        ) : searching ? (
          results.length === 0 ? (
            <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
                <Search className="h-5 w-5 text-muted-foreground" />
              </div>
              <p className="mt-4 text-sm font-semibold">
                No page matches &ldquo;{query.trim()}&rdquo;
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Try a shorter word &mdash; &ldquo;invoice&rdquo;, &ldquo;stock&rdquo;, &ldquo;voucher&rdquo;.
              </p>
            </div>
          ) : (
            <div className="grid gap-2 lg:grid-cols-2">
              {results.map((leaf, index) => (
                <ResultRow
                  key={`${leaf.id}-${leaf.url}`}
                  leaf={leaf}
                  query={query.trim()}
                  active={index === activeIndex}
                  onHover={() => setActiveIndex(index)}
                  onOpen={() => remember(leaf, leaf.trail[0])}
                />
              ))}
            </div>
          )
        ) : tiles.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
              <LayoutGrid className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="mt-4 text-sm font-semibold">No modules assigned to you</p>
            <p className="mx-auto mt-1.5 max-w-sm text-xs leading-relaxed text-muted-foreground">
              This page shows only the menus linked to your employee record. Ask an
              administrator to assign them under Setup &rarr; Employee Menu.
            </p>
          </div>
        ) : (
          <div className="space-y-8">
            {recents.length > 0 && (
              <section>
                <div className="mb-3 flex items-center gap-2">
                  <Clock3 className="h-3.5 w-3.5 text-primary" />
                  <h2 className="text-[11px] font-bold uppercase tracking-wider text-primary">
                    Recently opened
                  </h2>
                </div>
                <div className="flex flex-wrap gap-2">
                  {recents.map((recent) => {
                    const Icon = resolveMenuIcon(recent);
                    const accent = accentForTitle(recent.group || recent.title);
                    return (
                      <Link
                        key={recent.url}
                        href={recent.url}
                        className="group inline-flex items-center gap-2 rounded-full border border-border/70 bg-card py-1.5 pl-1.5 pr-4 text-xs font-medium shadow-sm transition-all hover:-translate-y-0.5 hover:shadow-md"
                      >
                        <span className="flex h-6 w-6 items-center justify-center rounded-full" style={accent.softStyle}>
                          <Icon className="h-3.5 w-3.5" strokeWidth={2} />
                        </span>
                        <span className="max-w-[180px] truncate">{recent.title}</span>
                      </Link>
                    );
                  })}
                </div>
              </section>
            )}

            <section>
              <div className="mb-4 flex items-center gap-3">
                {level === LEVEL.SUB && <Layers className="h-3.5 w-3.5 text-muted-foreground" />}
                <h2 className="text-[11px] font-bold uppercase tracking-wider text-primary">
                  {level === LEVEL.SUB ? "All sections" : "All modules"}
                </h2>
                <div className="h-px flex-1 bg-border/70" />
                <span className="rounded-full bg-primary/10 px-2.5 py-0.5 text-[11px] font-bold text-primary">
                  {tiles.length}
                </span>
              </div>

              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6">
                {tiles.map((tile, index) => (
                  <ModuleTile
                    key={`${tile.parentId ?? "root"}-${tile.id}`}
                    module={tile}
                    accent={accentForPosition(index, tiles.length)}
                    onOpen={(m) => {
                      // Only leaf-style tiles are worth remembering; a module
                      // page is one click from here anyway.
                      if (!m.items?.length) remember(m, m.parentTitle);
                    }}
                  />
                ))}
              </div>
            </section>
          </div>
        )}
      </div>
    </div>
  );
}
