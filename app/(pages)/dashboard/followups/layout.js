// /dashboard/followups — My Follow-ups, inside the ERP frame. Under /dashboard
// (no menu entry needed): the API returns only the person's own share.
import AppShell from "@/components/sidebar/AppShell";

export const metadata = { title: "My Follow-ups — SMS" };

export default function FollowupsLayout({ children }) {
  return <AppShell>{children}</AppShell>;
}
