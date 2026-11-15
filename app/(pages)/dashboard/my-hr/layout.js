// /dashboard/my-hr — the employee's own HR, inside the ERP frame. Under
// /dashboard (no menu entry needed): every API behind it returns only the
// signed-in employee's own data.
import AppShell from "@/components/sidebar/AppShell";

export const metadata = { title: "My HR" };

export default function MyHrLayout({ children }) {
  return <AppShell>{children}</AppShell>;
}
