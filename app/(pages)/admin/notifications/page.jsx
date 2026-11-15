"use client";
// /admin/notifications — what raises a notification, who receives it and
// what it says (custom texts with {placeholders}). The same screen is also the
// Notifications tab of /accounting/settings; both use the one component.
import NotificationSettings from "@/components/Settings/NotificationSettings";

export default function AdminNotificationsPage() {
  return (
    <div className="mx-auto w-full max-w-[1400px]">
      <NotificationSettings />
    </div>
  );
}
