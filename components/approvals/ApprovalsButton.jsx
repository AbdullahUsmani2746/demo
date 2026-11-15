"use client";
// components/approvals/ApprovalsButton.jsx — Approvals in the top header,
// next to the notifications bell. Shown to anyone who decides anything
// (approval rules, HR approval permissions, Sale Order approval — worked out
// by GET /api/approvals/count from the same scope as the inbox). The badge is
// how many items wait for THIS person's decision; while there are any, a soft
// halo blinks round the button (not with "reduce motion"). Click → the inbox.
import Link from "next/link";
import { usePathname } from "next/navigation";
import { motion, useReducedMotion } from "framer-motion";
import { Inbox } from "lucide-react";
import { useApprovalsBadge } from "@/components/sidebar/useQuickLinks";

export default function ApprovalsButton() {
  const badge = useApprovalsBadge();
  const reduceMotion = useReducedMotion();
  const pathname = usePathname() || "";
  if (!badge?.isApprover) return null;
  const n = Number(badge.count) || 0;
  const here = pathname.startsWith("/dashboard/approvals");
  const label = n ? `Approvals, ${n} waiting for you` : "Approvals — nothing waiting";

  return (
    <Link
      href="/dashboard/approvals"
      aria-label={label}
      title={label}
      aria-current={here ? "page" : undefined}
      className={`relative grid h-10 w-10 flex-shrink-0 place-items-center rounded-xl border border-white/40 bg-white shadow-sm transition-colors hover:bg-slate-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-white/70 ${
        n ? "text-[#800000]" : "text-slate-600"
      }`}
    >
      {n > 0 && !reduceMotion && (
        <motion.span
          aria-hidden="true"
          className="pointer-events-none absolute -inset-[3px] rounded-[14px] ring-2 ring-white"
          initial={{ opacity: 0 }}
          animate={{ opacity: [0, 0.95, 0], scale: [0.96, 1.06, 1.12] }}
          transition={{ duration: 1.8, repeat: Infinity, repeatDelay: 0.6, ease: "easeOut" }}
        />
      )}
      <Inbox className="h-5 w-5" />
      {n > 0 && (
        <span className="absolute -right-1.5 -top-1.5 flex h-5 min-w-5 items-center justify-center rounded-full border-2 border-white bg-[#800000] px-1 text-[10px] font-bold leading-none tabular-nums text-white">
          {n > 99 ? "99+" : n}
        </span>
      )}
    </Link>
  );
}
