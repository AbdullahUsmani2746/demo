// components/sidebar/AppShell.jsx — the ERP frame: top header, left menu
// (with its footer), and the page beside them. Shared by every section that
// should look like the ERP (accounting pages, the BI dashboards), so they all
// get the same menu, header and footer.
import { AppSidebar } from "@/components/sidebar/app-sidebar";
import { SiteHeader } from "@/components/sidebar/site-header";
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveEmployeeId } from "@/lib/menu/sessionEmployee";

export default async function AppShell({ children }) {
  const session = await getServerSession(authOptions);

  // employee_menu keys off Employee.id, but the session carries User.id.
  // Resolve the real one so the sidebar scopes to the right person.
  const employeeId = await resolveEmployeeId(session);

  return (
    <div className="[--header-height:calc(theme(spacing.14))]">
      <SidebarProvider className="flex flex-col">
        <SiteHeader employeeId={employeeId} role={session?.user?.role} />
        <div className="flex flex-1">
          <AppSidebar employeeId={employeeId} role={session?.user?.role} />
          <SidebarInset className="min-w-0">{children}</SidebarInset>
        </div>
      </SidebarProvider>
    </div>
  );
}
