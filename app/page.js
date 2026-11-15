import { AppSidebar } from "@/components/sidebar/app-sidebar"
import { SiteHeader } from "@/components/sidebar/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { getServerSession } from "next-auth"
import { authOptions } from "@/lib/auth"
import { resolveEmployeeId } from "@/lib/menu/sessionEmployee"

// "/" is in the middleware matcher and open to every authenticated user, so an
// EMPLOYEE lands here. It used to render <AppSidebar /> with no props at all:
// role was undefined, which fell through the sidebar's role ladder to the full
// static nav-data tree — every module in the product, regardless of what that
// employee had been assigned in employee_menu. Pass the real session through,
// exactly as app/(pages)/accounting/layout.js does.
export default async function Home({ children }) {
  const session = await getServerSession(authOptions)

  // employee_menu keys off Employee.id, but the session carries User.id.
  const employeeId = await resolveEmployeeId(session)

  return (
    <div className="[--header-height:calc(theme(spacing.14))]">
      <SidebarProvider className="flex flex-col">
        <SiteHeader employeeId={employeeId} role={session?.user?.role} />
        <div className="flex flex-1">
          <AppSidebar employeeId={employeeId} role={session?.user?.role} />
          <SidebarInset>{children}</SidebarInset>
        </div>
      </SidebarProvider>
    </div>
  )
}
