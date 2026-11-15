"use client";
// Notifications page (/accounting/notifications) — the user's inbox.
//
//   GET    /api/notifications/all         read + unread, unexpired (latest 300)
//   PUT    /api/notifications             { notificationId } → read
//   PATCH  /api/notifications/[id]        { is_read: false } → unread
//   DELETE /api/notifications/[id]
//   PUT    /api/notifications/mark-all-read
//   GET    /api/notifications/link?id=    the page to open (on click only)
//
// There is no bulk endpoint: a bulk action sends one request per selected
// notification, ten at a time.
import React, { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { toast } from "sonner";
import {
  Bell,
  BellDot,
  CheckCheck,
  ExternalLink,
  Loader2,
  MailOpen,
  Mail,
  Search,
  ShieldAlert,
  Trash2,
  X,
  ListChecks,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Checkbox } from "@/components/ui/checkbox";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import {
  TYPE_META,
  TypeIcon,
  categoryOf,
  dayLabel,
  entityLabel,
  fullTime,
  groupBy,
  isPriorityNotification,
  relativeTime,
  typeMeta,
} from "./notificationUi";
import { LabHeader, LabEmpty, Chip, CHIP, TABS_SCROLL } from "@/components/Material/shared/LabUI";
import { PhoneNotificationsCard } from "./PhoneNotifications";

const PAGE = 30;
const BRAND_BTN = "bg-primary text-primary-foreground hover:bg-primary/90";
const SELECT_CLS =
  "h-9 min-w-0 flex-1 rounded-lg border border-border bg-background px-2.5 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 sm:flex-none";

/** Run fn over ids, ten at a time; resolves to the number that failed. */
async function inBatches(ids, fn) {
  let failed = 0;
  for (let i = 0; i < ids.length; i += 10) {
    const results = await Promise.allSettled(ids.slice(i, i + 10).map(fn));
    failed += results.filter((r) => r.status === "rejected").length;
  }
  return failed;
}

export default function NotificationsPage() {
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const queryClient = useQueryClient();
  const router = useRouter();
  const KEY = ["notifications-all", userId];

  const [tab, setTab] = useState("all");
  const [type, setType] = useState("all");
  const [category, setCategory] = useState("all");
  const [q, setQ] = useState("");
  const [shown, setShown] = useState(PAGE);
  const [selecting, setSelecting] = useState(false);
  const [selected, setSelected] = useState(() => new Set());
  const [confirmDelete, setConfirmDelete] = useState(null); // [ids]
  const [busy, setBusy] = useState(false);
  const searchRef = useRef(null);

  // "/" focuses the search (Ctrl+K is the header's menu search).
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const { data, isLoading, error } = useQuery({
    queryKey: KEY,
    queryFn: async () => (await axios.get("/api/notifications/all")).data,
    enabled: !!userId,
    refetchInterval: 30000,
  });
  const all = useMemo(() => data?.notifications || [], [data]);

  // ── derived ───────────────────────────────────────────────────────────────
  const counts = useMemo(
    () => ({
      all: all.length,
      unread: all.filter((n) => !n.is_read).length,
      priority: all.filter(isPriorityNotification).length,
    }),
    [all],
  );
  const categories = useMemo(() => {
    const m = new Map();
    for (const n of all) {
      const c = categoryOf(n);
      m.set(c, (m.get(c) || 0) + 1);
    }
    return [...m.entries()].sort((a, b) => entityLabel(a[0]).localeCompare(entityLabel(b[0])));
  }, [all]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    return all
      .filter((n) => (tab === "unread" ? !n.is_read : tab === "priority" ? isPriorityNotification(n) : true))
      .filter((n) => type === "all" || (n.type || "info") === type)
      .filter((n) => category === "all" || categoryOf(n) === category)
      .filter((n) => !s || `${n.title} ${n.message}`.toLowerCase().includes(s))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
  }, [all, tab, type, category, q]);

  useEffect(() => setShown(PAGE), [tab, type, category, q]);
  const visible = filtered.slice(0, shown);
  const groups = useMemo(() => groupBy(visible, (n) => dayLabel(n.created_at)), [visible]);
  const filtersOn = type !== "all" || category !== "all" || q.trim() !== "";

  // Selection only keeps ids that still exist.
  const selectedIds = [...selected].filter((id) => all.some((n) => n.id === id));
  const allVisibleSelected = visible.length > 0 && visible.every((n) => selected.has(n.id));
  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  const toggleVisible = () =>
    setSelected((prev) => {
      const next = new Set(prev);
      visible.forEach((n) => (allVisibleSelected ? next.delete(n.id) : next.add(n.id)));
      return next;
    });
  const stopSelecting = () => {
    setSelecting(false);
    setSelected(new Set());
  };

  // ── writes ────────────────────────────────────────────────────────────────
  const patchCache = (fn) => queryClient.setQueryData(KEY, (old) => (old ? { ...old, notifications: fn(old.notifications || []) } : old));
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["notifications-all"] });
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
  };

  const setRead = async (ids, read) => {
    const set = new Set(ids);
    patchCache((list) => list.map((n) => (set.has(n.id) ? { ...n, is_read: read } : n)));
    const failed = await inBatches(ids, (id) =>
      read ? axios.put("/api/notifications", { notificationId: id }) : axios.patch(`/api/notifications/${id}`, { is_read: false }),
    );
    if (failed) toast.error(`${failed} could not be updated`);
    refresh();
  };

  const remove = async (ids) => {
    setBusy(true);
    const set = new Set(ids);
    const failed = await inBatches(ids, (id) => axios.delete(`/api/notifications/${id}`));
    if (!failed) patchCache((list) => list.filter((n) => !set.has(n.id)));
    setBusy(false);
    setConfirmDelete(null);
    setSelected((prev) => new Set([...prev].filter((id) => !set.has(id))));
    failed ? toast.error(`${failed} could not be deleted`) : toast.success(ids.length === 1 ? "Notification deleted" : `${ids.length} notifications deleted`);
    refresh();
  };

  const markAll = useMutation({
    mutationFn: async () => (await axios.put("/api/notifications/mark-all-read")).data,
    onMutate: () => patchCache((list) => list.map((n) => ({ ...n, is_read: true }))),
    onSuccess: (d) => toast.success(d?.message || "All marked as read"),
    onError: (e) => toast.error(e.response?.data?.error || "Could not mark all as read"),
    onSettled: refresh,
  });

  const open = async (n) => {
    if (selecting) return toggle(n.id);
    if (!n.is_read) setRead([n.id], true);
    if (!n.entity || n.entity_id == null) return;
    try {
      const link = (await axios.get("/api/notifications/link", { params: { id: n.id } })).data?.link;
      if (link) router.push(link);
      else toast.info("This notification has no page to open.");
    } catch {
      // non-critical
    }
  };

  // ── render ────────────────────────────────────────────────────────────────
  const TABS = [
    { key: "all", label: "All", count: counts.all, icon: Bell },
    { key: "unread", label: "Unread", count: counts.unread, icon: BellDot },
    ...(counts.priority ? [{ key: "priority", label: "Needs approval", count: counts.priority, icon: ShieldAlert }] : []),
  ];

  return (
    <div className="min-h-screen bg-muted/40">
      <main className="mx-auto max-w-[1600px] space-y-4 px-3 py-5 sm:px-6">
        <LabHeader
          icon={Bell}
          breadcrumb="Accounting"
          title="Notifications"
          badge={counts.unread ? `${counts.unread} unread` : null}
          subtitle={`${isLoading ? "Loading…" : `${counts.unread} unread of ${counts.all}`} · kept until they expire`}
          actions={
            <>
              <Button variant="outline" className="gap-1.5" onClick={() => (selecting ? stopSelecting() : setSelecting(true))} aria-pressed={selecting}>
                {selecting ? <X className="h-4 w-4" /> : <ListChecks className="h-4 w-4" />}
                {selecting ? "Done" : "Select"}
              </Button>
              <Button className={cn("gap-1.5", BRAND_BTN)} disabled={!counts.unread || markAll.isPending} onClick={() => markAll.mutate()}>
                {markAll.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCheck className="h-4 w-4" />}
                Mark all read
              </Button>
            </>
          }
        />

        <div className="mx-auto max-w-5xl space-y-4">
          <PhoneNotificationsCard />

          {/* One card: tabs, then a wrapping filter toolbar */}
          <section className="overflow-clip rounded-xl border border-border bg-background">
            <div className={cn(TABS_SCROLL, "border-b border-border px-3 sm:px-3")}>
              <div role="tablist" aria-label="Show" className="inline-flex w-max min-w-full gap-1">
                {TABS.map((t) => (
                  <button
                    key={t.key}
                    type="button"
                    role="tab"
                    aria-selected={tab === t.key}
                    onClick={() => setTab(t.key)}
                    className={cn(
                      "relative flex items-center gap-1.5 border-b-2 px-3 pb-2.5 pt-3 text-sm font-medium transition-colors",
                      tab === t.key ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
                    )}
                  >
                    <t.icon className="h-4 w-4" />
                    {t.label}
                    <span className={cn("min-w-5 rounded-full px-1.5 text-center text-[11px] font-semibold leading-5 tabular-nums", tab === t.key ? "bg-primary text-primary-foreground" : "bg-muted text-muted-foreground")}>
                      {t.count}
                    </span>
                  </button>
                ))}
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2 p-3">
              <label className="flex h-9 min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-border px-3 text-muted-foreground focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 sm:max-w-md">
                <Search className="h-4 w-4 flex-shrink-0" />
                <input
                  ref={searchRef}
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && setQ("")}
                  placeholder="Search title or message…"
                  aria-label="Search notifications"
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
                />
                {q ? (
                  <button type="button" onClick={() => setQ("")} aria-label="Clear search" className="hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                ) : (
                  <kbd className="hidden rounded border border-b-2 border-border px-1.5 font-mono text-[10.5px] sm:inline">/</kbd>
                )}
              </label>
              <select value={type} onChange={(e) => setType(e.target.value)} aria-label="Filter by type" className={SELECT_CLS}>
                <option value="all">All types</option>
                {Object.entries(TYPE_META).map(([k, m]) => (
                  <option key={k} value={k}>{m.label}</option>
                ))}
              </select>
              <select value={category} onChange={(e) => setCategory(e.target.value)} aria-label="Filter by category" className={SELECT_CLS}>
                <option value="all">All categories</option>
                {categories.map(([c, n]) => (
                  <option key={c} value={c}>{entityLabel(c)} ({n})</option>
                ))}
              </select>
              {filtersOn && (
                <Button variant="ghost" size="sm" className="h-9 gap-1 text-muted-foreground" onClick={() => { setQ(""); setType("all"); setCategory("all"); }}>
                  <X className="h-4 w-4" /> Clear
                </Button>
              )}
            </div>
          </section>

          {/* Bulk bar */}
          {selecting && (
            <div className="sticky top-16 z-10 flex flex-wrap items-center gap-2 rounded-xl border border-primary/25 bg-background px-3 py-2 shadow-md">
              <label className="flex items-center gap-2 text-sm font-medium text-foreground">
                <Checkbox checked={allVisibleSelected} onCheckedChange={toggleVisible} aria-label="Select all shown" />
                {selectedIds.length ? `${selectedIds.length} selected` : "Select all shown"}
              </label>
              <div className="ml-auto flex flex-wrap gap-1.5">
                <Button size="sm" variant="outline" className="gap-1.5" disabled={!selectedIds.length} onClick={() => setRead(selectedIds, true)}>
                  <MailOpen className="h-4 w-4" /> <span className="max-sm:sr-only">Mark read</span>
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5" disabled={!selectedIds.length} onClick={() => setRead(selectedIds, false)}>
                  <Mail className="h-4 w-4" /> <span className="max-sm:sr-only">Mark unread</span>
                </Button>
                <Button size="sm" variant="outline" className="gap-1.5 text-destructive hover:text-destructive" disabled={!selectedIds.length} onClick={() => setConfirmDelete(selectedIds)}>
                  <Trash2 className="h-4 w-4" /> <span className="max-sm:sr-only">Delete</span>
                </Button>
              </div>
            </div>
          )}

          {/* List */}
          {error ? (
            <div className={cn("rounded-xl px-4 py-6 text-center text-sm", CHIP.bad)}>
              Could not load your notifications. {error.response?.data?.error || ""}
            </div>
          ) : isLoading || !userId ? (
            <ListSkeleton />
          ) : filtered.length === 0 ? (
            <div className="rounded-xl border border-dashed border-border bg-background">
              <LabEmpty
                icon={tab === "unread" ? CheckCheck : BellDot}
                title={filtersOn ? "Nothing matches these filters" : tab === "unread" ? "You're all caught up" : tab === "priority" ? "Nothing waiting for your approval" : "No notifications yet"}
                hint={filtersOn ? "Try another search, type or category." : "When something you follow happens, it shows up here and on the bell."}
              />
            </div>
          ) : (
            <div className="space-y-4">
              {groups.map(([label, items]) => {
                const unread = items.filter((n) => !n.is_read).length;
                return (
                  <section key={label} aria-label={label} className="overflow-clip rounded-xl border border-border bg-background">
                    <h2 className="flex items-center gap-2 border-b border-primary/15 bg-primary/5 px-4 py-2 text-[12px] font-semibold uppercase tracking-wide text-primary">
                      {label}
                      <span className="font-normal normal-case tracking-normal text-muted-foreground">
                        · {items.length}{unread ? ` · ${unread} unread` : ""}
                      </span>
                    </h2>
                    <ul className="divide-y divide-border">
                      {items.map((n) => (
                        <Row
                          key={n.id}
                          n={n}
                          selecting={selecting}
                          checked={selected.has(n.id)}
                          onToggle={() => toggle(n.id)}
                          onOpen={() => open(n)}
                          onRead={(read) => setRead([n.id], read)}
                          onDelete={() => setConfirmDelete([n.id])}
                        />
                      ))}
                    </ul>
                  </section>
                );
              })}

              <div className="flex flex-col items-center gap-2 py-2 text-sm text-muted-foreground">
                <span className="tabular-nums">
                  Showing {visible.length} of {filtered.length}
                </span>
                {visible.length < filtered.length && (
                  <Button variant="outline" onClick={() => setShown((s) => s + PAGE)}>
                    Load {Math.min(PAGE, filtered.length - visible.length)} more
                  </Button>
                )}
                {data?.notifications?.length >= 300 && visible.length >= filtered.length && (
                  <span className="text-xs">Only your latest 300 notifications are listed.</span>
                )}
              </div>
            </div>
          )}
        </div>
      </main>

      <AlertDialog open={!!confirmDelete} onOpenChange={(o) => !o && !busy && setConfirmDelete(null)}>
        <AlertDialogContent className="max-w-[calc(100vw-2rem)] rounded-xl sm:max-w-md">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-left">
              <Trash2 className="h-5 w-5 shrink-0 text-destructive" />
              Delete {confirmDelete?.length === 1 ? "this notification" : `${confirmDelete?.length || 0} notifications`}?
            </AlertDialogTitle>
            <AlertDialogDescription className="text-left">They are removed from your inbox only. This cannot be undone.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-0">
            <AlertDialogCancel disabled={busy}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              disabled={busy}
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={(e) => {
                e.preventDefault();
                remove(confirmDelete);
              }}
            >
              {busy && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />} Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Row({ n, selecting, checked, onToggle, onOpen, onRead, onDelete }) {
  const meta = typeMeta(n.type);
  const hasLink = !!n.entity && n.entity_id != null;
  return (
    <li className={cn("group relative flex gap-3 px-3 py-3 transition-colors hover:bg-muted/50 sm:px-4", !n.is_read && "bg-primary/[0.03]", checked && "bg-primary/[0.07]")}>
      {!n.is_read && <span className={cn("absolute inset-y-0 left-0 w-1", meta.bar)} aria-hidden="true" />}
      {selecting && (
        <Checkbox checked={checked} onCheckedChange={onToggle} aria-label={`Select ${n.title}`} className="mt-3 shrink-0" />
      )}
      <button type="button" onClick={onOpen} className="flex min-w-0 flex-1 gap-3 rounded-lg text-left focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30" aria-label={`${n.is_read ? "" : "Unread: "}${n.title}${hasLink ? " — open" : ""}`}>
        <TypeIcon type={n.type} />
        <span className="min-w-0 flex-1">
          <span className="flex items-start gap-2">
            <span className={cn("min-w-0 flex-1 break-words text-sm leading-snug", n.is_read ? "text-muted-foreground" : "font-semibold text-foreground")}>{n.title}</span>
            {!n.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden="true" />}
          </span>
          <span className={cn("mt-0.5 block break-words text-sm leading-relaxed", n.is_read ? "text-muted-foreground/80" : "text-muted-foreground")}>{n.message}</span>
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-1 text-xs text-muted-foreground">
            <time dateTime={n.created_at} title={fullTime(n.created_at)} className="tabular-nums">{relativeTime(n.created_at)}</time>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-medium ring-1 ring-inset", meta.chip)}>{meta.label}</span>
            <Chip tone="muted" className="font-medium">{entityLabel(categoryOf(n))}</Chip>
            {hasLink && (
              <span className="inline-flex items-center gap-0.5 font-medium text-primary">
                <ExternalLink className="h-3 w-3" /> Open
              </span>
            )}
          </span>
        </span>
      </button>
      {!selecting && (
        <div className="flex shrink-0 flex-col gap-1 sm:flex-row sm:items-start sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100 sm:group-focus-within:opacity-100">
          <button
            type="button"
            onClick={() => onRead(!n.is_read)}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary"
            aria-label={n.is_read ? "Mark as unread" : "Mark as read"}
            title={n.is_read ? "Mark as unread" : "Mark as read"}
          >
            {n.is_read ? <Mail className="h-4 w-4" /> : <MailOpen className="h-4 w-4" />}
          </button>
          <button
            type="button"
            onClick={onDelete}
            className="grid h-8 w-8 place-items-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
            aria-label="Delete notification"
            title="Delete"
          >
            <Trash2 className="h-4 w-4" />
          </button>
        </div>
      )}
    </li>
  );
}

function ListSkeleton() {
  return (
    <ul aria-busy="true" aria-label="Loading notifications" className="divide-y divide-border overflow-hidden rounded-xl border border-border bg-background">
      {Array.from({ length: 6 }, (_, i) => (
        <li key={i} className="flex gap-3 px-4 py-4">
          <Skeleton className="h-10 w-10 shrink-0 rounded-full" />
          <span className="flex-1 space-y-2">
            <Skeleton className="h-3.5 w-1/2" />
            <Skeleton className="h-3 w-5/6" />
            <Skeleton className="h-3 w-24" />
          </span>
        </li>
      ))}
    </ul>
  );
}
