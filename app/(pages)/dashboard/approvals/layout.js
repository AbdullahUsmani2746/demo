// /dashboard/approvals — documents held by approval rules, inside the ERP frame.
// Under /dashboard (no menu entry needed): every list is limited to the
// person's own share by the API.
import AppShell from "@/components/sidebar/AppShell";

export const metadata = { title: "Approvals" };

export default function ApprovalsLayout({ children }) {
  return <AppShell>{children}</AppShell>;
}
