"use client";
// The sidebar menu tree. Items: { title, url, icon, items[] } — `icon` is a
// lucide component (nav-data.js) or a lucide name (menus table).
//   · the page you are on is highlighted and its groups open by themselves
//   · `filter` (the box at the top of the sidebar) keeps the matches and the
//     groups they are in, opened, with the matching words marked
import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronRight } from "lucide-react";
import * as Icons from "lucide-react";
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from "@/components/ui/collapsible";
import {
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
} from "@/components/ui/sidebar";

const iconFor = (icon) => (typeof icon === "string" ? Icons[icon] || Icons.SquareTerminal : icon || Icons.SquareTerminal);
const norm = (u) => (!u || u === "#" ? "" : String(u).split("?")[0].replace(/\/$/, ""));
const isActiveUrl = (url, path) => {
  const u = norm(url);
  return !!u && (path === u || path.startsWith(`${u}/`));
};
const containsActive = (item, path) => isActiveUrl(item.url, path) || (item.items || []).some((c) => containsActive(c, path));
const matches = (item, term) =>
  String(item.title || "").toLowerCase().includes(term) || (item.items || []).some((c) => matches(c, term));

function Marked({ text, term }) {
  const s = String(text || "");
  if (!term) return s;
  const i = s.toLowerCase().indexOf(term);
  if (i < 0) return s;
  return (
    <>
      {s.slice(0, i)}
      <mark className="rounded-sm bg-white/25 px-0.5 text-inherit">{s.slice(i, i + term.length)}</mark>
      {s.slice(i + term.length)}
    </>
  );
}

const BUTTON =
  "h-9 gap-2.5 rounded-lg text-[13.5px] text-sidebar-foreground/90 hover:bg-white/10 hover:text-white data-[active=true]:bg-white data-[active=true]:font-semibold data-[active=true]:text-primary";

function NavItem({ item, pathname, term, depth }) {
  const selfMatch = !!term && String(item.title || "").toLowerCase().includes(term);
  const kids = (item.items || []).filter((c) => !term || selfMatch || matches(c, term));
  const activeInside = containsActive(item, pathname);
  const [open, setOpen] = useState(activeInside);
  useEffect(() => {
    if (activeInside) setOpen(true);
  }, [activeInside]);

  const Icon = depth === 0 || item.icon ? iconFor(item.icon) : null;
  const isOpen = term ? true : open;

  if (kids.length) {
    return (
      <Collapsible open={isOpen} onOpenChange={setOpen} asChild>
        <SidebarMenuItem>
          <CollapsibleTrigger asChild>
            <SidebarMenuButton tooltip={item.title} className={`${BUTTON} ${activeInside && !isOpen ? "bg-white/10 font-semibold" : ""}`}>
              {Icon ? <Icon className="h-4 w-4 opacity-90" /> : <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-current opacity-50" />}
              <span className="truncate">
                <Marked text={item.title} term={term} />
              </span>
              <ChevronRight className={`ml-auto h-4 w-4 opacity-70 transition-transform duration-200 ${isOpen ? "rotate-90" : ""}`} />
            </SidebarMenuButton>
          </CollapsibleTrigger>
          <CollapsibleContent>
            <SidebarMenuSub className="mr-0 border-white/15 pr-0">
              {kids.map((c, i) => (
                <NavItem key={c.id ?? `${c.title}-${i}`} item={c} pathname={pathname} term={term} depth={depth + 1} />
              ))}
            </SidebarMenuSub>
          </CollapsibleContent>
        </SidebarMenuItem>
      </Collapsible>
    );
  }

  const href = norm(item.url) ? item.url : "#";
  return (
    <SidebarMenuItem>
      <SidebarMenuButton asChild isActive={isActiveUrl(item.url, pathname)} tooltip={item.title} className={BUTTON}>
        <Link href={href}>
          {Icon ? <Icon className="h-4 w-4 opacity-90" /> : <span className="h-1.5 w-1.5 flex-shrink-0 rounded-full bg-current opacity-50" />}
          <span className="truncate">
            <Marked text={item.title} term={term} />
          </span>
        </Link>
      </SidebarMenuButton>
    </SidebarMenuItem>
  );
}

export function NavMain({ items = [], filter = "", label }) {
  const pathname = usePathname() || "";
  const term = filter.trim().toLowerCase();
  const shown = term ? items.filter((i) => matches(i, term)) : items;
  if (!shown.length) {
    return term ? <p className="px-4 py-6 text-center text-xs text-sidebar-foreground/70">No menu matches “{filter}”.</p> : null;
  }
  return (
    <SidebarGroup className="py-1">
      {label && <SidebarGroupLabel className="text-[10.5px] font-bold uppercase tracking-wider text-sidebar-foreground/60">{label}</SidebarGroupLabel>}
      <SidebarMenu className="gap-0.5">
        {shown.map((item, i) => (
          <NavItem key={item.id ?? `${item.title}-${i}`} item={item} pathname={pathname} term={term} depth={0} />
        ))}
      </SidebarMenu>
    </SidebarGroup>
  );
}
