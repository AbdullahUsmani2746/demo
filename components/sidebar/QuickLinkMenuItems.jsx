"use client";
// components/sidebar/QuickLinkMenuItems.jsx — the personal pages (My HR, My
// Dashboards, BI Designer, My Follow-ups, Audit Trail; Approvals for people
// who only follow their own requests) as items of a user menu. Used by the
// header avatar menu (site-header.jsx) and the sidebar footer (nav-user.jsx).
// Who sees which: useQuickLinks.js. Renders nothing (no separator) when the
// person has none.
import Link from "next/link";
import { DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator } from "@/components/ui/dropdown-menu";
import { useQuickLinks } from "@/components/sidebar/useQuickLinks";

const TONE = {
  alert: "bg-[#800000] text-white",
  warn: "bg-amber-500 text-white",
  muted: "bg-muted text-muted-foreground",
};

export default function QuickLinkMenuItems() {
  const { links } = useQuickLinks();
  const shown = links.filter((l) => l.inMenu);
  if (!shown.length) return null;
  return (
    <>
      <DropdownMenuLabel className="pb-1 pt-1.5 text-[10.5px] font-bold uppercase tracking-wider text-muted-foreground">Your pages</DropdownMenuLabel>
      {shown.map((l) => {
        const Icon = l.icon;
        return (
          <DropdownMenuItem key={l.id} asChild className="min-h-10 cursor-pointer">
            <Link href={l.url}>
              <Icon className="mr-2 h-4 w-4" />
              <span className="flex-1 truncate">{l.title}</span>
              {l.badge ? (
                <span className={`ml-2 rounded-full px-1.5 text-[10px] font-bold leading-4 tabular-nums ${TONE[l.badgeTone] || TONE.muted}`}>{l.badge}</span>
              ) : null}
            </Link>
          </DropdownMenuItem>
        );
      })}
      <DropdownMenuSeparator />
    </>
  );
}
