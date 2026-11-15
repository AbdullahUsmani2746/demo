// /dashboard/audit-trail — the Audit Trail, inside the ERP frame. Under
// /dashboard (open to every signed-in user); /api/audit itself requires
// audit.view, and the page shows a "no access" card otherwise.
import AppShell from "@/components/sidebar/AppShell";

export const metadata = { title: "Audit Trail" };

export default function AuditTrailLayout({ children }) {
  return <AppShell>{children}</AppShell>;
}
