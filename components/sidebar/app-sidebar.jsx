"use client"
import * as React from "react"

import { NavMain } from "@/components/sidebar/nav-main"
import { NavUser } from "@/components/sidebar/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
} from "@/components/ui/sidebar"
import { Search, X } from "lucide-react"
import { useNavItems } from "@/components/sidebar/useNavItems"
import { useQuickLinks } from "@/components/sidebar/useQuickLinks"

// The menu tree only. Personal pages (My HR, My Dashboards, BI Designer,
// Follow-ups, Audit Trail) live in the user menu and Approvals in the header
// (useQuickLinks.js) — the "Find a menu…" box still finds them.
export function AppSidebar({
  role, employeeId, ...props
}) {
  // Which menus this person sees — shared with the search palette
  // (useNavItems.js), so the two never disagree.
  const { items } = useNavItems(role, employeeId)
  const { links } = useQuickLinks()
  // While filtering, the personal pages are searched too, as ordinary items.
  const searchable = React.useMemo(
    () => [...items, ...links.map((l) => ({ id: `quick-${l.id}`, title: l.title, url: l.url, icon: l.icon }))],
    [items, links]
  )
  const [filter, setFilter] = React.useState("")
  const filterRef = React.useRef(null)

  return (
    <Sidebar className="top-[--header-height] !h-[calc(100svh-var(--header-height))] border-r-0" {...props}>
      <SidebarHeader className="gap-0 px-3 pb-2 pt-3">
        <label className="flex h-9 items-center gap-2 rounded-lg bg-white/10 px-2.5 text-sidebar-foreground/70 ring-white/30 focus-within:bg-white/15 focus-within:ring-1">
          <Search className="h-4 w-4 flex-shrink-0" />
          <input
            ref={filterRef}
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setFilter("")}
            placeholder="Find a menu…"
            aria-label="Find a menu"
            className="min-w-0 flex-1 bg-transparent text-[13.5px] text-white outline-none placeholder:text-sidebar-foreground/60"
          />
          {filter && (
            <button type="button" onClick={() => setFilter("")} aria-label="Clear" className="hover:text-white">
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </label>
      </SidebarHeader>
      <SidebarContent className="gap-0 pb-2">
        <NavMain items={filter ? searchable : items} filter={filter} label={filter ? null : "Menu"} />
      </SidebarContent>
      <SidebarFooter className="border-t border-white/10 p-2">
        <NavUser />
      </SidebarFooter>
    </Sidebar>
  );
}
