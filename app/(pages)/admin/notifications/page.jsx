"use client";
// /admin/notifications — what raises a notification, who receives it and
// what it says (custom texts with {placeholders}). The same screen is also the
// Notifications tab of /accounting/settings; both use the one component.
import { Bell } from "lucide-react";
import NotificationSettings from "@/components/Settings/NotificationSettings";
import { HR_MAIN, HR_PAGE, PageHeader } from "@/components/HR/shared";

export default function AdminNotificationsPage() {
  return (
    <div className={HR_PAGE}>
      <PageHeader icon={Bell} title="Notifications" subtitle="What raises a notification and who receives it — a role ticked, or a person set to Always (Never mutes them). Click a text to write your own wording; Alerts watch any table." />
      <main className={HR_MAIN}>
        <section className="min-w-0 rounded-xl border border-border bg-background p-3 sm:p-5">
          <NotificationSettings hideTitle />
        </section>
      </main>
    </div>
  );
}
