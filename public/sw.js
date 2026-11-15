// Service worker — makes the app installable and shows phone notifications.
//
// Push payloads come from lib/notifications/push.js:
//   { id, title, body, url, type, tag, urgent, unread }
// Tapping a notification marks it read (PUT /api/notifications) and opens its
// page in the app window that is already open, or a new one.
//
// No offline cache on purpose: every screen shows live books and stock.
// Registered by components/pwa/PwaRegister.jsx; served with no-cache headers
// (next.config.mjs) so a new version is picked up on the next visit.

const ICON = "/pwa/icon-192.png";
const BADGE = "/pwa/badge-96.png";

self.addEventListener("install", () => self.skipWaiting());
self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

self.addEventListener("push", (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch {
    data = { title: "Notification", body: event.data ? event.data.text() : "" };
  }

  const title = data.title || "Notification";
  const options = {
    body: data.body || "",
    icon: ICON,
    badge: BADGE,
    tag: data.tag || undefined,
    renotify: Boolean(data.tag),
    requireInteraction: Boolean(data.urgent),
    timestamp: Date.now(),
    data: { url: data.url || "/accounting/notifications", id: data.id ?? null },
  };

  const badge =
    typeof data.unread === "number" && "setAppBadge" in self.navigator
      ? (data.unread > 0 ? self.navigator.setAppBadge(data.unread) : self.navigator.clearAppBadge()).catch(() => {})
      : Promise.resolve();

  event.waitUntil(Promise.all([self.registration.showNotification(title, options), badge]));
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const { url, id } = event.notification.data || {};
  const target = new URL(url || "/", self.location.origin).href;

  const markRead = id
    ? fetch("/api/notifications", {
        method: "PUT",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ notificationId: id }),
      }).catch(() => {})
    : Promise.resolve();

  const open = self.clients.matchAll({ type: "window", includeUncontrolled: true }).then((windows) => {
    const same = windows.find((w) => new URL(w.url).origin === self.location.origin);
    if (same) {
      return same.focus().then((w) => (w && "navigate" in w ? w.navigate(target) : self.clients.openWindow(target)));
    }
    return self.clients.openWindow(target);
  });

  event.waitUntil(Promise.all([markRead, open]));
});

// The browser renewed this device's push address: register the new one.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    (async () => {
      const res = await fetch("/api/push", { credentials: "same-origin" });
      if (!res.ok) return;
      const { publicKey } = await res.json();
      if (!publicKey) return;
      const subscription =
        event.newSubscription ||
        (await self.registration.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlBase64ToUint8Array(publicKey) }));
      await fetch("/api/push", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ subscription: subscription.toJSON(), replaces: event.oldSubscription?.endpoint ?? null }),
      });
    })().catch(() => {}),
  );
});

function urlBase64ToUint8Array(base64) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(padded);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}
