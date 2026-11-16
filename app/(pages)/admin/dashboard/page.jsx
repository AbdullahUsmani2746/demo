"use client";

// Admin home (/admin/dashboard): where each admin job lives. A card only
// shows the screens this person's rights open (the pages check again).
import Link from "next/link";
import { useQuery } from "@tanstack/react-query";
import { ArrowUpRight, Bell, Clock, KeyRound, ListTree, LayoutDashboard, Settings2, ShieldCheck, UserCheck, UserCog, Users } from "lucide-react";
import { usePermissions } from "@/hooks/usePermissions";
import { api, HR_MAIN, HR_PAGE, PageHeader, StatTile } from "@/components/HR/shared";

const CARDS = [
  { href: "/admin/user", icon: UserCog, title: "Logins & Roles", text: "Every login, its roles and its employee. Make logins for people who are not employees.", perm: "users.manage" },
  { href: "/accounting/setup/employees", icon: Users, title: "Employees", text: "Employees' logins and roles are given on the Employee screen — Login & Roles.", perm: ["employee.manage", "users.manage"] },
  { href: "/admin/roles", icon: KeyRound, title: "Roles", text: "The role catalogue: what each role may do, its sidebar, who holds it.", perm: ["users.manage", "permissions.manage"] },
  { href: "/admin/permissions", icon: ShieldCheck, title: "Permissions", text: "Rights per role and person, approvals, menu access, data scopes.", perm: "permissions.manage" },
  { href: "/admin/notifications", icon: Bell, title: "Notifications", text: "What raises a notification, who gets it and what it says; alerts.", perm: "notification.manage" },
  { href: "/admin/shift", icon: Clock, title: "POS shifts", text: "Cashier shifts used by the Point of Sale.", perm: "users.manage" },
  { href: "/accounting/menu", icon: ListTree, title: "Menu tree", text: "The sidebar's menus: order, titles, icons, shown or hidden.", perm: ["menus.manage", "setup.menus.manage"] },
  { href: "/accounting/employee-menus", icon: UserCheck, title: "Employee menus", text: "Which menus each employee sees.", perm: ["menus.manage", "setup.menus.manage"] },
  { href: "/accounting/settings", icon: Settings2, title: "Settings", text: "Company, features, stock checking, production setup …", perm: "settings.manage" },
];

export default function AdminHome() {
  const { can, loading } = usePermissions();
  const mayUsers = !loading && can("users.manage");
  const { data } = useQuery({ queryKey: ["admin-logins"], queryFn: () => api("/api/users"), enabled: mayUsers, retry: false });
  const users = data?.users || [];
  const cards = CARDS.filter((c) => [].concat(c.perm).some((p) => can(p)));

  return (
    <div className={HR_PAGE}>
      <PageHeader icon={LayoutDashboard} title="Admin" subtitle="Logins, roles, permissions, notifications and menus." />
      <main className={HR_MAIN + " space-y-4"}>
        {mayUsers && data && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <StatTile label="Logins" value={users.length} icon={Users} tone="brand" href="/admin/user" />
            <StatTile label="Active" value={users.filter((u) => u.isActive).length} icon={UserCheck} tone="emerald" href="/admin/user" />
            <StatTile label="Switched off" value={users.filter((u) => !u.isActive).length} icon={UserCog} href="/admin/user" />
            <StatTile label="Without employee" value={users.filter((u) => !u.employeeId).length} icon={KeyRound} tone="amber" href="/admin/user" />
          </div>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {loading
            ? null
            : cards.map(({ href, icon: Icon, title, text }) => (
                <Link
                  key={href}
                  href={href}
                  className="group flex items-start gap-3 rounded-xl border border-border bg-background p-4 transition-colors hover:border-primary/40 hover:bg-primary/[0.02] focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-5 w-5" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1 font-semibold text-foreground group-hover:text-primary">
                      {title} <ArrowUpRight className="h-3.5 w-3.5 opacity-0 transition-opacity group-hover:opacity-100" />
                    </span>
                    <span className="mt-0.5 block text-[13px] leading-snug text-muted-foreground">{text}</span>
                  </span>
                </Link>
              ))}
        </div>
      </main>
    </div>
  );
}
