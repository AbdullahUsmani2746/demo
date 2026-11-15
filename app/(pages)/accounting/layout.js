// app/accounting/layout.tsx
import { AppSidebar } from "@/components/sidebar/app-sidebar"
import { SiteHeader } from "@/components/sidebar/site-header"
import { SidebarInset, SidebarProvider } from "@/components/ui/sidebar"
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { resolveEmployeeId } from "@/lib/menu/sessionEmployee";
import { getCompany, companyShortName, DEFAULT_COMPANY_NAME } from "@/lib/company";

export async function generateMetadata() {
  // Title = short company name ("SMS"), description = full name, both from the
  // Company table. Neutral fallback if it is unset or the DB is unreachable.
  try {
    const company = await getCompany();
    return {
      title: companyShortName(company.name),
      description: company.name,
    };
  } catch {
    return { title: DEFAULT_COMPANY_NAME, description: DEFAULT_COMPANY_NAME };
  }
}
  

export default async function AccountsLayout({ children }) {
  const session = await getServerSession(authOptions);

  // employee_menu keys off Employee.id, but the session carries User.id.
  // Resolve the real one so the sidebar scopes to the right person.
  const employeeId = await resolveEmployeeId(session);

  return (
    <div className="[--header-height:calc(theme(spacing.14))]">
      <SidebarProvider className="flex flex-col">
        <SiteHeader 
          employeeId={employeeId} 
          role={session?.user?.role}
        />
        <div className="flex flex-1">
          <AppSidebar 
            employeeId={employeeId} 
            role={session?.user?.role}
          />
          <SidebarInset>
            {children}
          </SidebarInset>
        </div>
      </SidebarProvider>
    </div>
  );
}