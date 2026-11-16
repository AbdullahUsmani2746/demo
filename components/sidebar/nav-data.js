import {
  SquareTerminal,
  LayoutDashboard,
  Users,
} from "lucide-react";

// The admin area's sidebar (/admin/*) — every other screen's sidebar comes
// from the menus table (hooks/useMenuTree.js, components/sidebar/useNavItems.js).
export const data = {
  // Admin area (/admin/*). Employees' logins are given on the Employee
  // screen (Login & Roles); "Logins & Roles" here lists every login.
  navAdmin: [
    {
      title: "Admin home",
      url: "/admin/dashboard",
      icon: LayoutDashboard,
    },
    {
      title: "Access",
      url: "/admin/user",
      icon: Users,
      isActive: true,
      items: [
        { title: "Logins & Roles", url: "/admin/user" },
        { title: "Roles", url: "/admin/roles" },
        { title: "Permissions", url: "/admin/permissions" },
        { title: "Notifications", url: "/admin/notifications" },
        { title: "POS shifts", url: "/admin/shift" },
      ],
    },
    {
      title: "Menus",
      url: "/accounting/menu",
      icon: SquareTerminal,
      isActive: true,
      items: [
        { title: "Menu tree", url: "/accounting/menu" },
        { title: "Employee menus", url: "/accounting/employee-menus" },
      ],
    },
  ],
}
