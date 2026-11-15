"use client";
// components/sidebar/useQuickLinks.js — the personal pages that are not in the
// menu tree: My HR, My Dashboards, BI Designer, My Follow-ups, Audit Trail and
// Approvals. ONE source for where they show:
//   · header Approvals button (approvers)    components/approvals/ApprovalsButton.jsx
//   · the user menu (header avatar + sidebar footer)   QuickLinkMenuItems.jsx
//   · the header search (Ctrl+K) and the sidebar's "Find a menu…" box
// Each one shows only for the people the page itself serves — decided by the
// page's own API (rights / assignments are data, never a role list here):
//   My HR          /api/hr/self — an employee login holding an own-HR right
//   My Dashboards  /api/bi/my   — at least one dashboard assigned
//   BI Designer    /api/bi/my   — canDesign (bi.design)
//   My Follow-ups  /api/followups?count=1 — has / manages follow-ups
//   Audit Trail    /api/audit/meta?check=1 — audit.view
//   Approvals      /api/approvals/count — approver of anything (header button),
//                  or has requests of their own to follow (user menu)
// TanStack Query shares each answer between all of these (one request each).
import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { useSession } from "next-auth/react";
import { ClipboardCheck, History, Inbox, LayoutDashboard, PencilRuler, UserRound } from "lucide-react";

const getJson = (url) =>
  fetch(url, { cache: "no-store" })
    .then((r) => (r.ok ? r.json() : null))
    .catch(() => null);

const ONCE = { staleTime: 10 * 60 * 1000, refetchOnWindowFocus: false, retry: false };

/**
 * Pending approvals this person may decide → { count, isApprover, hasOwn }.
 * Polled every 45 s only while the tab is visible (TanStack pauses intervals in
 * hidden tabs), again when the window gets focus, and whenever the inbox
 * invalidates ["approvals"] after a decision.
 */
export function useApprovalsBadge() {
  const { status } = useSession();
  const q = useQuery({
    queryKey: ["approvals", "count"],
    queryFn: () => getJson("/api/approvals/count"),
    enabled: status === "authenticated",
    refetchInterval: 45 * 1000,
    refetchIntervalInBackground: false,
    refetchOnWindowFocus: true,
    staleTime: 15 * 1000,
    retry: false,
  });
  return q.data || null;
}

export function useQuickLinks() {
  const { status } = useSession();
  const enabled = status === "authenticated";
  const bi = useQuery({ queryKey: ["quickLinks", "bi"], queryFn: () => getJson("/api/bi/my"), enabled, ...ONCE });
  const hr = useQuery({ queryKey: ["quickLinks", "myHr"], queryFn: () => getJson("/api/hr/self"), enabled, ...ONCE });
  const audit = useQuery({ queryKey: ["quickLinks", "audit"], queryFn: () => getJson("/api/audit/meta?check=1"), enabled, ...ONCE });
  const followups = useQuery({
    queryKey: ["quickLinks", "followups"],
    queryFn: () => getJson("/api/followups?count=1"),
    enabled,
    staleTime: 5 * 60 * 1000,
    refetchInterval: 5 * 60 * 1000,
    retry: false,
  });
  const approvals = useApprovalsBadge();

  const links = useMemo(() => {
    // inMenu: listed in the user menu. Approvals is not, for approvers — they
    // have the header button; search finds every link either way.
    const out = [];
    if (hr.data?.employee && Object.values(hr.data.parts ?? {}).some(Boolean)) {
      out.push({ id: "my-hr", title: "My HR", url: "/dashboard/my-hr", icon: UserRound, inMenu: true });
    }
    const dashboards = bi.data?.data?.length ?? 0;
    if (dashboards > 0) {
      out.push({ id: "my-dashboards", title: "My Dashboards", url: "/dashboard/insights", icon: LayoutDashboard, inMenu: true, badge: dashboards > 1 ? dashboards : null, badgeTone: "muted" });
    }
    if (bi.data?.canDesign) {
      out.push({ id: "bi-designer", title: "BI Designer", url: "/accounting/bi-designer", icon: PencilRuler, inMenu: true });
    }
    if (followups.data?.any) {
      const overdue = followups.data.counts?.overdue ?? 0;
      out.push({ id: "followups", title: "My Follow-ups", url: "/dashboard/followups", icon: ClipboardCheck, inMenu: true, badge: overdue || null, badgeTone: "warn" });
    }
    if (approvals?.isApprover || approvals?.hasOwn) {
      out.push({ id: "approvals", title: "Approvals", url: "/dashboard/approvals", icon: Inbox, inMenu: !approvals.isApprover, badge: approvals.count || null, badgeTone: "alert" });
    }
    if (audit.data?.canAudit) {
      out.push({ id: "audit-trail", title: "Audit Trail", url: "/dashboard/audit-trail", icon: History, inMenu: true });
    }
    return out;
  }, [hr.data, bi.data, followups.data, audit.data, approvals]);
  return { links, approvals };
}
