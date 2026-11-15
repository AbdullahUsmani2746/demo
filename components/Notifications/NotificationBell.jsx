"use client";
// Header bell — unread badge + a dropdown with the latest notifications.
//
// Polling is unchanged: GET /api/notifications (unread only) every second.
// Read notifications (GET /api/notifications?read=1) are fetched only while the
// dropdown is open on the "Latest" tab, so the poll stays as light as before.
// Click → mark read (PUT /api/notifications) + open its page (GET
// /api/notifications/link, resolved on click only).
import React, { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { motion, AnimatePresence } from "framer-motion";
import { toast } from "sonner";
import { Bell, BellRing, CheckCheck, ChevronRight, ClipboardCheck, Loader2, ShieldAlert } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  TypeIcon,
  categoryOf,
  entityLabel,
  fullTime,
  groupBy,
  isPriorityNotification,
  relativeTime,
  todayOrEarlier,
} from "./notificationUi";
import { PhoneNotificationsPrompt } from "./PhoneNotifications";
import { setAppBadge } from "@/lib/pwa/client";

const SHOWN = 10;

function beep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.frequency.value = 800;
    osc.type = "sine";
    gain.gain.setValueAtTime(0.3, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.01, ctx.currentTime + 0.5);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.5);
  } catch {
    // no audio — fine
  }
}

export function NotificationBell() {
  const [isOpen, setIsOpen] = useState(false);
  const [tab, setTab] = useState("latest");
  const [shake, setShake] = useState(false);
  const { data: session } = useSession();
  const userId = session?.user?.id;
  const queryClient = useQueryClient();
  const router = useRouter();
  const rootRef = useRef(null);

  // ── data ──────────────────────────────────────────────────────────────────
  const { data, isLoading, isSuccess } = useQuery({
    queryKey: ["notifications", userId],
    queryFn: async () => (await axios.get("/api/notifications")).data,
    enabled: !!userId,
    refetchInterval: 1000, // unchanged: unread only, every second
  });
  const unread = useMemo(() => data?.notifications || [], [data]);
  const unreadCount = data?.unread ?? unread.length; // true total (the list stops at 50)

  const { data: readData, isLoading: readLoading } = useQuery({
    queryKey: ["notifications", "read", userId],
    queryFn: async () => (await axios.get("/api/notifications", { params: { read: 1 } })).data,
    enabled: !!userId && isOpen && tab === "latest",
  });

  // Follow-up tab: this person's due follow-ups (a sales person their own,
  // approvers every item of their scenarios — lib/bi/followupList.js). Shown
  // only to people who have follow-ups; asked for while the panel is open.
  const { data: followupData, isLoading: followupLoading } = useQuery({
    queryKey: ["notifications", "followups", userId],
    queryFn: async () => (await axios.get("/api/notifications/followups")).data,
    enabled: !!userId && isOpen,
  });
  const showFollowups = Boolean(followupData?.enabled);
  const followupList = followupData?.items || [];

  const priority = useMemo(() => unread.filter(isPriorityNotification), [unread]);
  const list = useMemo(() => {
    const base = tab === "unread" ? unread : [...unread, ...(readData?.notifications || [])];
    return base
      .filter((n) => !isPriorityNotification(n))
      .sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
      .slice(0, SHOWN);
  }, [tab, unread, readData]);
  const groups = useMemo(() => groupBy(list, todayOrEarlier), [list]);
  const listLoading = isLoading || (tab === "latest" && readLoading && !readData);

  // Installed app: the unread count on the app icon (public/sw.js sets it on push).
  useEffect(() => {
    if (isSuccess) setAppBadge(unreadCount);
  }, [isSuccess, unreadCount]);

  // ── new-notification cue: shake + beep + toast (as before) ────────────────
  const firstLoad = useRef(true);
  const prevNewest = useRef(null);
  const prevCount = useRef(0);
  useEffect(() => {
    if (!isSuccess) return;
    const newest = unread[0]?.id ?? null;
    if (firstLoad.current) {
      firstLoad.current = false;
      prevNewest.current = newest;
      prevCount.current = unreadCount;
      return;
    }
    if ((newest !== null && newest !== prevNewest.current) || unreadCount > prevCount.current) {
      setShake(true);
      beep();
      setTimeout(() => setShake(false), 1200);
      const n = unread[0];
      if (n) {
        const opts = { description: n.message, duration: 10000 };
        const fn = { success: toast.success, error: toast.error, warning: toast.warning }[n.type] || toast.info;
        fn(n.title, opts);
      }
    }
    prevNewest.current = newest;
    prevCount.current = unreadCount;
  }, [isSuccess, unread, unreadCount]);

  // ── actions ───────────────────────────────────────────────────────────────
  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["notifications"] });
    queryClient.invalidateQueries({ queryKey: ["notifications-all"] });
  };
  const markRead = useMutation({
    mutationFn: async (id) => axios.put("/api/notifications", { notificationId: id }),
    onSettled: refresh,
  });
  const markAll = useMutation({
    mutationFn: async () => axios.put("/api/notifications/mark-all-read"),
    onSuccess: () => toast.success("All notifications marked as read"),
    onError: (e) => toast.error(e.response?.data?.error || "Could not mark notifications as read"),
    onSettled: refresh,
  });

  const open = async (n) => {
    if (!n.is_read) markRead.mutate(n.id);
    if (!n.entity || n.entity_id == null) return;
    try {
      const link = (await axios.get("/api/notifications/link", { params: { id: n.id } })).data?.link;
      if (link) {
        setIsOpen(false);
        router.push(link);
      }
    } catch {
      // non-critical: it was still marked as read
    }
  };

  // Close on outside click / Escape.
  useEffect(() => {
    if (!isOpen) return;
    const onDown = (e) => rootRef.current && !rootRef.current.contains(e.target) && setIsOpen(false);
    const onKey = (e) => e.key === "Escape" && setIsOpen(false);
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [isOpen]);

  const badge = unreadCount > 99 ? "99+" : String(unreadCount);

  return (
    <div className="relative" ref={rootRef}>
      <motion.button
        type="button"
        whileTap={{ scale: 0.92 }}
        animate={shake ? { rotate: [0, -20, 20, -14, 14, -6, 6, 0], transition: { duration: 0.7 } } : {}}
        onClick={() => setIsOpen((o) => !o)}
        aria-label={unreadCount ? `Notifications, ${unreadCount} unread` : "Notifications"}
        aria-haspopup="dialog"
        aria-expanded={isOpen}
        className={cn(
          // Sits on the maroon header: always a light button.
          "relative grid h-10 w-10 place-items-center rounded-xl border border-white/40 bg-white shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70",
          unreadCount ? "text-[#800000]" : "text-slate-600",
        )}
      >
        {unreadCount ? <BellRing className="h-5 w-5" /> : <Bell className="h-5 w-5" />}
        {unreadCount > 0 && (
          <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-[#800000] px-1 text-[10px] font-bold leading-none text-white tabular-nums">
            {badge}
          </span>
        )}
        {shake && <span className="absolute inset-0 animate-ping rounded-xl bg-[#800000]/20" aria-hidden="true" />}
      </motion.button>

      <AnimatePresence>
        {isOpen && (
          <motion.div
            role="dialog"
            aria-label="Latest notifications"
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -8 }}
            transition={{ duration: 0.14 }}
            className="fixed inset-x-2 top-16 z-50 flex max-h-[calc(100vh-5rem)] flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-2xl sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-[400px] sm:max-h-[min(640px,calc(100vh-6rem))]"
          >
            {/* Header */}
            <div className="flex items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
              <div className="min-w-0">
                <h3 className="font-semibold text-slate-900">Notifications</h3>
                <p className="text-xs text-slate-500">{unreadCount ? `${badge} unread` : "You're all caught up"}</p>
              </div>
              {unreadCount > 0 && (
                <button
                  type="button"
                  onClick={() => markAll.mutate()}
                  disabled={markAll.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-xs font-medium text-[#800000] hover:bg-[#800000]/5 disabled:opacity-50"
                >
                  {markAll.isPending ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <CheckCheck className="h-3.5 w-3.5" />}
                  Mark all read
                </button>
              )}
            </div>

            {/* Tabs */}
            <div role="tablist" aria-label="Show" className="flex gap-1 border-b border-slate-100 px-3 py-2">
              {[
                { key: "latest", label: "Latest" },
                { key: "unread", label: "Unread", count: unreadCount - priority.length },
                ...(showFollowups ? [{ key: "followup", label: "Follow-up", count: followupList.length }] : []),
              ].map((t) => (
                <button
                  key={t.key}
                  type="button"
                  role="tab"
                  aria-selected={tab === t.key}
                  onClick={() => setTab(t.key)}
                  className={cn(
                    "inline-flex items-center gap-1.5 rounded-lg px-3 py-1 text-xs font-semibold transition-colors",
                    tab === t.key ? "bg-[#800000] text-white" : "text-slate-600 hover:bg-slate-100",
                  )}
                >
                  {t.label}
                  {t.count > 0 && (
                    <span className={cn("rounded-full px-1.5 text-[10px] leading-4", tab === t.key ? "bg-white/25" : "bg-slate-200 text-slate-700")}>
                      {t.count > 99 ? "99+" : t.count}
                    </span>
                  )}
                </button>
              ))}
            </div>

            <div className="flex-1 overflow-y-auto overscroll-contain">
              {/* Approvals waiting on this user stay pinned on top. */}
              {priority.length > 0 && (
                <section aria-label="Waiting for your approval" className="border-b border-rose-100 bg-rose-50/50">
                  <div className="flex items-center gap-1.5 px-4 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-rose-700">
                    <ShieldAlert className="h-3.5 w-3.5" /> Waiting for your approval · {priority.length}
                  </div>
                  <ul>
                    {priority.slice(0, 3).map((n) => (
                      <BellItem key={n.id} n={n} onOpen={open} />
                    ))}
                  </ul>
                </section>
              )}

              {tab === "followup" ? (
                followupLoading ? (
                  <BellSkeleton />
                ) : followupList.length === 0 ? (
                  <p className="px-6 py-10 text-center text-sm text-slate-500">Nothing due — all follow-ups are logged</p>
                ) : (
                  <ul>
                    {followupList.map((f) => (
                      <li key={f.id}>
                        <button
                          type="button"
                          onClick={() => {
                            setIsOpen(false);
                            router.push(`/dashboard/followups?open=${f.id}`);
                          }}
                          className={`flex w-full gap-3 px-4 py-2.5 text-left ${f.escalated ? "bg-rose-50/70 hover:bg-rose-100/70" : "bg-amber-50/60 hover:bg-amber-100/70"}`}
                        >
                          <ClipboardCheck className={`mt-0.5 h-5 w-5 shrink-0 ${f.escalated ? "text-rose-600" : "text-amber-600"}`} />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold text-slate-800" title={f.label}>{f.label}</span>
                            <span className="block truncate text-xs text-slate-600">
                              {f.scenario}
                              {followupData?.isManager ? ` · ${f.owner}` : ""}
                            </span>
                            <span className="mt-0.5 block text-[11px] text-slate-500">
                              {f.overdue_days > 0 ? `${f.overdue_days} day${f.overdue_days === 1 ? "" : "s"} late` : "Due today"}
                              {f.last_note ? ` · last: "${f.last_note}"${f.last_note_by ? ` (${f.last_note_by})` : ""}` : " · no response yet"}
                            </span>
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : listLoading ? (
                <BellSkeleton />
              ) : list.length === 0 ? (
                <div className="flex flex-col items-center px-6 py-10 text-center">
                  <span className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-slate-100 ring-8 ring-slate-50">
                    <Bell className="h-5 w-5 text-slate-400" />
                  </span>
                  <p className="text-sm font-semibold text-slate-800">{tab === "unread" ? "No unread notifications" : "No notifications yet"}</p>
                  <p className="mt-1 text-xs text-slate-500">New ones appear here as they happen.</p>
                </div>
              ) : (
                groups.map(([label, items]) => (
                  <section key={label} aria-label={label}>
                    <div className="sticky top-0 z-[1] bg-white/95 px-4 pb-1 pt-2.5 text-[11px] font-semibold uppercase tracking-wide text-slate-400 backdrop-blur">
                      {label}
                    </div>
                    <ul>
                      {items.map((n) => (
                        <BellItem key={n.id} n={n} onOpen={open} />
                      ))}
                    </ul>
                  </section>
                ))
              )}
            </div>

            <PhoneNotificationsPrompt onNavigate={() => setIsOpen(false)} />

            <Link
              href="/accounting/notifications"
              onClick={() => setIsOpen(false)}
              className="flex items-center justify-center gap-1 border-t border-slate-100 bg-slate-50 px-4 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-100 hover:text-slate-900"
            >
              Open all notifications <ChevronRight className="h-4 w-4" />
            </Link>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

function BellItem({ n, onOpen }) {
  return (
    <li>
      <button
        type="button"
        onClick={() => onOpen(n)}
        className={cn(
          "flex w-full gap-3 px-4 py-2.5 text-left transition-colors hover:bg-slate-50 focus:outline-none focus-visible:bg-slate-100",
          !n.is_read && "bg-[#800000]/[0.03]",
        )}
        aria-label={`${n.is_read ? "" : "Unread: "}${n.title}`}
      >
        <TypeIcon type={n.type} size="sm" />
        <span className="min-w-0 flex-1">
          <span className={cn("block text-sm leading-snug", n.is_read ? "text-slate-700" : "font-semibold text-slate-900")}>{n.title}</span>
          <span className="mt-0.5 line-clamp-2 block text-xs leading-relaxed text-slate-500">{n.message}</span>
          <span className="mt-1 flex items-center gap-1.5 text-[11px] text-slate-400">
            <time dateTime={n.created_at} title={fullTime(n.created_at)}>{relativeTime(n.created_at)}</time>
            <span aria-hidden="true">·</span>
            <span>{entityLabel(categoryOf(n))}</span>
          </span>
        </span>
        {!n.is_read && <span className="mt-1.5 h-2 w-2 shrink-0 rounded-full bg-[#800000]" aria-hidden="true" />}
      </button>
    </li>
  );
}

function BellSkeleton() {
  return (
    <ul aria-busy="true" aria-label="Loading">
      {[0, 1, 2, 3].map((i) => (
        <li key={i} className="flex gap-3 px-4 py-3">
          <span className="h-8 w-8 shrink-0 animate-pulse rounded-full bg-slate-100" />
          <span className="flex-1 space-y-2">
            <span className="block h-3 w-2/3 animate-pulse rounded bg-slate-100" />
            <span className="block h-3 w-full animate-pulse rounded bg-slate-100" />
          </span>
        </li>
      ))}
    </ul>
  );
}

export default NotificationBell;
