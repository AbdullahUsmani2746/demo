// /dashboard/insights — the BI dashboards, inside the ERP frame (menu,
// header, footer) like every other page.
import "@/components/bi/bi.css";
import "@/components/bi/bi-redesign.css";
import AppShell from "@/components/sidebar/AppShell";

export const metadata = { title: "Dashboards — SMS" };

export default function InsightsLayout({ children }) {
  return <AppShell>{children}</AppShell>;
}
