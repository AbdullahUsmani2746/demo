"use client";
// The signed-in person at the foot of the sidebar: name, role, and a menu
// with their personal pages (QuickLinkMenuItems — My HR, My Dashboards, BI
// Designer, …), profile / settings and Log out.
import Link from "next/link";
import { useSession } from "next-auth/react";
import { useRoles } from "@/hooks/useRoles";
import { signOutAndForgetDevice } from "@/lib/pwa/signOut";
import { ChevronsUpDown, LogOut, Settings, User } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@/components/ui/sidebar";
import QuickLinkMenuItems from "@/components/sidebar/QuickLinkMenuItems";

export const initialsOf = (name) =>
  String(name || "U")
    .split(/\s+/)
    .filter(Boolean)
    .map((n) => n[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

export const roleLabel = (role) =>
  String(role || "")
    .replace(/_/g, " ")
    .toLowerCase()
    .replace(/\b\w/g, (c) => c.toUpperCase());

/**
 * Links in the account menu, from what the person's roles open (session —
 * lib/auth/sessionGuard.js), never a role name.
 */
export function accountLinks(user) {
  const areas = user?.areas || [];
  return {
    profile: !!user?.employeeId,
    settings: !!user?.superAdmin || areas.includes("admin"),
  };
}

export function NavUser() {
  const { isMobile } = useSidebar();
  const { data: session } = useSession();
  const { roleName } = useRoles();
  const user = session?.user;
  if (!user) return null;
  const role = user.role;
  const links = accountLinks(user);

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <SidebarMenuButton size="lg" className="rounded-xl hover:bg-white/10 data-[state=open]:bg-white/10">
              <Avatar className="h-9 w-9 rounded-lg ring-1 ring-white/25">
                <AvatarImage src={user.image || undefined} alt={user.name || ""} />
                <AvatarFallback className="rounded-lg bg-white/15 text-xs font-bold text-white">{initialsOf(user.name)}</AvatarFallback>
              </Avatar>
              <div className="grid flex-1 text-left leading-tight">
                <span className="truncate text-[13.5px] font-semibold">{user.name || "User"}</span>
                <span className="truncate text-[11.5px] text-sidebar-foreground/70">{(role && roleName(role)) || user.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto h-4 w-4 opacity-70" />
            </SidebarMenuButton>
          </DropdownMenuTrigger>
          <DropdownMenuContent className="w-[--radix-dropdown-menu-trigger-width] min-w-56 rounded-xl" side={isMobile ? "bottom" : "right"} align="end" sideOffset={6}>
            <DropdownMenuLabel className="font-normal">
              <p className="text-sm font-semibold">{user.name || "User"}</p>
              <p className="truncate text-xs text-muted-foreground">{user.email}</p>
            </DropdownMenuLabel>
            <DropdownMenuSeparator />
            <QuickLinkMenuItems />
            {links.profile && (
              <DropdownMenuItem asChild>
                <Link href="/accounting/profile">
                  <User className="mr-2 h-4 w-4" />
                  Profile
                </Link>
              </DropdownMenuItem>
            )}
            {links.settings && (
              <DropdownMenuItem asChild>
                <Link href="/accounting/settings">
                  <Settings className="mr-2 h-4 w-4" />
                  Settings
                </Link>
              </DropdownMenuItem>
            )}
            <DropdownMenuItem className="text-destructive focus:text-destructive" onClick={() => signOutAndForgetDevice({ callbackUrl: "/auth/signin" })}>
              <LogOut className="mr-2 h-4 w-4" />
              Log out
            </DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}
