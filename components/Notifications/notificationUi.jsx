"use client";
// components/Notifications/notificationUi.jsx — look and wording shared by the
// header bell, the notifications page and the alert builder's preview:
// type colours/icons, relative times, Today / Earlier grouping, categories.

import { AlertTriangle, CheckCircle2, Info, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";

// Theme-aware tones (light + dark), the same family as LabUI CHIP: info is the
// brand maroon, success green, warning amber, error red.
export const TYPE_META = {
  info: { label: "Info", icon: Info, chip: "bg-primary/10 text-primary ring-primary/20", icon_bg: "bg-primary/10 text-primary", bar: "bg-primary" },
  success: { label: "Success", icon: CheckCircle2, chip: "bg-[#edf2ee] text-[#2f5139] ring-[#2f5139]/20 dark:bg-emerald-950/40 dark:text-emerald-300 dark:ring-emerald-800/50", icon_bg: "bg-[#edf2ee] text-[#2f5139] dark:bg-emerald-950/40 dark:text-emerald-300", bar: "bg-[#2f5139] dark:bg-emerald-500" },
  warning: { label: "Warning", icon: AlertTriangle, chip: "bg-amber-50 text-amber-800 ring-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:ring-amber-800/50", icon_bg: "bg-amber-100 text-amber-700 dark:bg-amber-950/40 dark:text-amber-300", bar: "bg-amber-500" },
  error: { label: "Error", icon: XCircle, chip: "bg-red-50 text-red-800 ring-red-200 dark:bg-red-950/40 dark:text-red-300 dark:ring-red-800/50", icon_bg: "bg-red-100 text-red-700 dark:bg-red-950/40 dark:text-red-300", bar: "bg-red-600" },
};
export const typeMeta = (type) => TYPE_META[type] || TYPE_META.info;

/** Round icon for a notification type. */
export function TypeIcon({ type, className, size = "md" }) {
  const meta = typeMeta(type);
  const Icon = meta.icon;
  return (
    <span
      aria-hidden="true"
      className={cn(
        "grid shrink-0 place-items-center rounded-full",
        size === "sm" ? "h-8 w-8" : "h-10 w-10",
        meta.icon_bg,
        className,
      )}
    >
      <Icon className={size === "sm" ? "h-4 w-4" : "h-5 w-5"} />
    </span>
  );
}

// Where a notification points (Notification.entity); unknown ones are humanised.
const ENTITY_LABELS = {
  transaction: "Vouchers",
  order: "Orders",
  production: "Production",
  quality: "Quality",
  inventory: "Inventory",
  requisition: "Requisitions",
  item: "Items",
  saleReturn: "Sale returns",
  approvalRequest: "Approvals",
  finance: "Finance",
  alert: "Alerts",
};
export function entityLabel(entity) {
  if (!entity) return "General";
  if (ENTITY_LABELS[entity]) return ENTITY_LABELS[entity];
  return String(entity).replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").replace(/^./, (c) => c.toUpperCase());
}
/** Category of a notification: its entity, or "Alerts" for an admin-defined alert. */
export const categoryOf = (n) => (n?.entity && n.entity !== "alert" ? n.entity : String(n?.event_code || "").startsWith("alert:") ? "alert" : n?.entity || "general");

// Priority = an approval that waits on THIS user (Free of Cost / Trial Sale
// Order, Technical Sale Return). Only the approver's copy — titled "… needs
// your approval" — is priority, not the "Sent for approval" copy.
const PRIORITY_EVENTS = new Set(["salesOrderApprovalRequired", "saleReturnApprovalRequired"]);
export const isPriorityNotification = (n) =>
  !n?.is_read && PRIORITY_EVENTS.has(n?.event_code) && /needs your approval/i.test(n?.title || "");

export function relativeTime(value, now = Date.now()) {
  if (!value) return "";
  const d = new Date(value);
  const s = Math.floor((now - d.getTime()) / 1000);
  if (s < 45) return "just now";
  if (s < 3600) return `${Math.max(1, Math.floor(s / 60))}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 7 * 86400) return `${Math.floor(s / 86400)}d ago`;
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: d.getFullYear() === new Date(now).getFullYear() ? undefined : "numeric" });
}

export function fullTime(value) {
  if (!value) return "";
  return new Date(value).toLocaleString("en-GB", { weekday: "short", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const startOfDay = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();

/** "Today" · "Yesterday" · "Mon 27 Oct" · "27 Oct 2025". */
export function dayLabel(value, now = new Date()) {
  const d = new Date(value);
  const diff = Math.round((startOfDay(now) - startOfDay(d)) / 86400000);
  if (diff <= 0) return "Today";
  if (diff === 1) return "Yesterday";
  if (diff < 7) return d.toLocaleDateString("en-GB", { weekday: "long" });
  return d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: d.getFullYear() === now.getFullYear() ? undefined : "numeric" });
}

/** [[label, items]] in order, items already sorted newest first. */
export function groupBy(items, labelOf) {
  const map = new Map();
  for (const n of items) {
    const key = labelOf(n);
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(n);
  }
  return [...map.entries()];
}

/** Today / Earlier — the bell's two groups. */
export const todayOrEarlier = (n) => (dayLabel(n.created_at) === "Today" ? "Today" : "Earlier");
