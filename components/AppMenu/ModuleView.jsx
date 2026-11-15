"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronRight, LayoutGrid, Search, X } from "lucide-react";

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
import { useMenuTree } from "@/hooks/useMenuTree";
import { useSession } from "next-auth/react";
import {
  accentForPosition,
  accentForTitle,
  findMenuById,
  flattenLeaves,
  isNavigable,
  pushRecent,
  resolveMenuIcon,
  toSections,
} from "@/lib/menu/appMenu";

function ItemCard({ item, accent, onOpen }) {
  const Icon = resolveMenuIcon(item);

  return (
    <Link
      href={item.url}
      onClick={onOpen}
      className="group flex items-center gap-3 rounded-xl border border-border/70 bg-card px-4 py-3.5 shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2"
    >
      <span
        className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg transition-transform duration-200 group-hover:scale-110"
        style={accent.softStyle}
      >
        <Icon className="h-4 w-4" strokeWidth={1.75} />
      </span>

      <span className="min-w-0 flex-1 truncate text-sm font-medium leading-tight">
        {item.title}
      </span>

      <ChevronRight className="h-4 w-4 shrink-0 -translate-x-1 text-muted-foreground opacity-0 transition-all duration-200 group-hover:translate-x-0 group-hover:opacity-100" />
    </Link>
  );
}

// Levels below a section still need somewhere to go: render them as a small
// labelled sub-group rather than dropping them.
function SectionBody({ items, accent, onOpen }) {
  const links = items.filter(isNavigable).filter((i) => !i.items?.length);
  const groups = items.filter((i) => i.items?.length);

  return (
    <div className="space-y-5">
      {links.length > 0 && (
        <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
          {links.map((item) => (
            <ItemCard key={item.id} item={item} accent={accent} onOpen={() => onOpen(item)} />
          ))}
        </div>
      )}

      {groups.map((group) => (
        <div key={group.id} className="space-y-2.5 border-l-2 border-border/60 pl-4">
          {/* A sub-group that is itself a page stays reachable as a link */}
          {isNavigable(group) ? (
            <Link
              href={group.url}
              onClick={() => onOpen(group)}
              className="inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground transition-colors hover:text-primary"
            >
              {group.title}
              <ChevronRight className="h-3 w-3" />
            </Link>
          ) : (
            <p className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              {group.title}
            </p>
          )}
          <SectionBody items={group.items} accent={accent} onOpen={onOpen} />
        </div>
      ))}
    </div>
  );
}

// Filter the whole subtree, keeping a branch only while something under it
// still matches — so an empty section disappears instead of sitting there.
function filterItems(items, query) {
  if (!query) return items;

  const out = [];
  for (const item of items || []) {
    const selfMatch = item.title.toLowerCase().includes(query);
    const children = filterItems(item.items, query);

    if (selfMatch || children.length) {
      out.push({ ...item, items: selfMatch ? item.items : children });
    }
  }
  return out;
}

export default function ModuleView({ moduleId, employeeId, role }) {
  const { data: session } = useSession();
  const all = session?.user?.navMode === "all";
  const { menus, loading } = useMenuTree(all ? null : employeeId, { all });
  const [query, setQuery] = useState("");

  const module = useMemo(() => findMenuById(menus, moduleId), [menus, moduleId]);
  const needle = query.trim().toLowerCase();

  const sections = useMemo(() => {
    if (!module) return [];
    return toSections(module)
      .map((section) => ({ ...section, items: filterItems(section.items, needle) }))
      .filter((section) => section.items.length > 0);
  }, [module, needle]);

  if (loading) {
    return (
      <div className="min-h-[calc(100svh-4rem)] bg-muted/30">
        <div className="border-b border-border/60 bg-card">
          <div className="mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
            <div className="flex items-center gap-4">
              <Skeleton className="h-14 w-14 rounded-2xl" />
              <div className="space-y-2">
                <Skeleton className="h-7 w-52" />
                <Skeleton className="h-4 w-32" />
              </div>
            </div>
          </div>
        </div>
        <div className="mx-auto w-full max-w-7xl space-y-8 px-4 py-8 sm:px-6 lg:px-8">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="space-y-3">
              <Skeleton className="h-3.5 w-40" />
              <div className="grid gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {Array.from({ length: 6 }).map((__, j) => (
                  <Skeleton key={j} className="h-[58px] rounded-xl" />
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  if (!module) {
    return (
      <div className="flex min-h-[calc(100svh-4rem)] items-center justify-center bg-muted/30 px-4">
        <div className="w-full max-w-md rounded-2xl border border-border/70 bg-card px-6 py-12 text-center shadow-sm">
          <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
            <LayoutGrid className="h-5 w-5 text-muted-foreground" />
          </div>
          <p className="mt-4 text-base font-semibold">Module not found</p>
          <p className="mt-1.5 text-sm text-muted-foreground">
            It may have been removed, or you may not have access to it.
          </p>
          <Button asChild className="mt-6">
            <Link href="/accounting/apps">Back to applications</Link>
          </Button>
        </div>
      </div>
    );
  }

  const Icon = resolveMenuIcon(module);

  // Match the colour this module had as a tile on the launcher: same position,
  // same hue. Falls back to the title hash for a deep link to a sub-module,
  // which has no position among the roots.
  const rootIndex = menus.findIndex((m) => String(m.id) === String(module.id));
  const accent =
    rootIndex === -1
      ? accentForTitle(module.title)
      : accentForPosition(rootIndex, menus.length);
  const totalPages = flattenLeaves(module.items).length;
  const allSectionCount = toSections(module).length;

  const remember = (item) =>
    pushRecent({ title: item.title, url: item.url, icon: item.icon, group: module.title });

  return (
    <div className="min-h-[calc(100svh-4rem)] bg-muted/30">
      {/* ── Module header ── */}
      <div className="relative overflow-hidden border-b border-border/60 bg-card">
        <span
          className="pointer-events-none absolute -right-16 -top-24 h-64 w-64 rounded-full opacity-[0.12] blur-3xl"
          style={accent.barStyle}
          aria-hidden="true"
        />

        <div className="relative mx-auto w-full max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
          {/* Breadcrumb */}
          <nav className="mb-4 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
            <Link href="/accounting/apps" className="transition-colors hover:text-foreground">
              Applications
            </Link>
            <ChevronRight className="h-3 w-3" />
            <span className="text-foreground">{module.title}</span>
          </nav>

          <div className="flex flex-col gap-5 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex items-center gap-4">
              <Button asChild variant="ghost" size="icon" className="h-9 w-9 shrink-0 rounded-lg">
                <Link href="/accounting/apps" aria-label="Back to applications">
                  <ArrowLeft className="h-4 w-4" />
                </Link>
              </Button>

              <span
                className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl text-white shadow-md"
                style={accent.iconStyle}
              >
                <Icon className="h-7 w-7" strokeWidth={1.75} />
              </span>

              <div className="min-w-0">
                <h1 className="truncate text-2xl font-bold tracking-tight sm:text-3xl">
                  {module.title}
                </h1>
                <p className="mt-0.5 flex flex-wrap items-center gap-2 text-sm font-medium text-muted-foreground">
                  {allSectionCount} section{allSectionCount === 1 ? "" : "s"} &middot; {totalPages} page
                  {totalPages === 1 ? "" : "s"}
                </p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {/* Filter inside this module */}
              <div className="group relative flex-1 sm:flex-none">
                <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground transition-colors group-focus-within:text-primary" />
                <input
                  value={query}
                  onChange={(e) => setQuery(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setQuery("")}
                  placeholder={`Filter in ${module.title}…`}
                  aria-label={`Filter pages in ${module.title}`}
                  className="h-10 w-full rounded-xl border border-border/70 bg-background pl-10 pr-9 text-sm font-medium shadow-sm outline-none transition-all placeholder:font-normal placeholder:text-muted-foreground focus:border-primary/50 focus:ring-4 focus:ring-primary/10 sm:w-64"
                />
                {query && (
                  <button
                    type="button"
                    onClick={() => setQuery("")}
                    aria-label="Clear filter"
                    className="absolute right-2 top-1/2 flex h-6 w-6 -translate-y-1/2 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                  >
                    <X className="h-3.5 w-3.5" />
                  </button>
                )}
              </div>

              {/* Jump straight to another module without going back */}
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" className="h-10 gap-2 rounded-xl shadow-sm">
                    <LayoutGrid className="h-4 w-4" />
                    <span className="hidden sm:inline">Switch module</span>
                    <ChevronDown className="h-3.5 w-3.5 opacity-60" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="max-h-[26rem] w-60 overflow-y-auto">
                  <DropdownMenuLabel className="text-[11px] font-bold uppercase tracking-widest text-muted-foreground">
                    Modules
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {menus.map((m, mIndex) => {
                    const MIcon = resolveMenuIcon(m);
                    const mAccent = accentForPosition(mIndex, menus.length);
                    const isCurrent = String(m.id) === String(module.id);

                    return (
                      <DropdownMenuItem key={m.id} asChild className="cursor-pointer gap-2.5 py-2">
                        <Link
                          href={m.items?.length ? `/accounting/apps/${m.id}` : m.url || "#"}
                          className="flex items-center"
                        >
                          <span
                            className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md"
                            style={mAccent.softStyle}
                          >
                            <MIcon className="h-3.5 w-3.5" strokeWidth={2} />
                          </span>
                          <span className="truncate text-sm">{m.title}</span>
                          {isCurrent && (
                            <span className="ml-auto text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Current
                            </span>
                          )}
                        </Link>
                      </DropdownMenuItem>
                    );
                  })}
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>
        </div>
      </div>

      {/* ── Sections ── */}
      <div className="mx-auto w-full max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {sections.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border bg-card/50 px-6 py-16 text-center">
            <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-2xl bg-muted">
              <Search className="h-5 w-5 text-muted-foreground" />
            </div>
            <p className="mt-4 text-sm font-semibold">
              {needle
                ? `Nothing in ${module.title} matches “${query.trim()}”`
                : "This module has no pages yet"}
            </p>
            {needle ? (
              <button
                type="button"
                onClick={() => setQuery("")}
                className="mt-4 text-xs font-semibold text-primary hover:underline"
              >
                Clear filter
              </button>
            ) : (
              isNavigable(module) && (
                <Button asChild className="mt-5">
                  <Link href={module.url}>Open {module.title}</Link>
                </Button>
              )
            )}
          </div>
        ) : (
          <div className="space-y-9">
            {sections.map((section) => (
              <section key={section.id} className="space-y-4">
                <div className="flex items-center gap-3">
                  <span className="h-4 w-1 rounded-full" style={accent.barStyle} aria-hidden="true" />
                  <h2 className="text-[11px] font-bold uppercase tracking-widest text-foreground/80">
                    {section.title || "Quick access"}
                  </h2>
                  <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] font-semibold text-muted-foreground">
                    {flattenLeaves(section.items).length}
                  </span>
                  <div className="h-px flex-1 bg-border/70" />
                </div>

                <SectionBody items={section.items} accent={accent} onOpen={remember} />
              </section>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
