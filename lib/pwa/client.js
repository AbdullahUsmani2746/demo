"use client";
// Browser side of the installed app + phone notifications.
//   service worker   public/sw.js (registered once by components/pwa/PwaRegister.jsx)
//   devices API      /api/push (app/api/push/route.js)
//   sending          lib/notifications/push.js
// Screens use hooks/usePushNotifications.js; sign-out goes through
// lib/pwa/signOut.js so the phone stops receiving the old user's notifications.

const SW_URL = "/sw.js";

let registration = null;

/** Register the service worker (once per page load). */
export function registerServiceWorker() {
  if (typeof window === "undefined" || !("serviceWorker" in navigator)) return Promise.resolve(null);
  if (!registration) {
    registration = navigator.serviceWorker.register(SW_URL, { scope: "/" }).catch((err) => {
      console.warn("[pwa] service worker not registered:", err?.message);
      registration = null;
      return null;
    });
  }
  return registration;
}

async function readyRegistration() {
  await registerServiceWorker();
  if (!("serviceWorker" in navigator)) return null;
  return navigator.serviceWorker.ready;
}

// ─── What this browser can do ────────────────────────────────────────────────
export function isIos() {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
}

export function isStandalone() {
  if (typeof window === "undefined") return false;
  return window.matchMedia?.("(display-mode: standalone)").matches || window.navigator.standalone === true;
}

/**
 * "ok"             push can be turned on here
 * "insecure"       the site is not on https (push needs it)
 * "needs-install"  iPhone / iPad: works only from the Home Screen app
 * "unsupported"    this browser has no Web Push
 */
export function pushSupport() {
  if (typeof window === "undefined") return "unsupported";
  if (!window.isSecureContext) return "insecure";
  if (isIos() && !isStandalone()) return "needs-install";
  if (!("serviceWorker" in navigator) || !("PushManager" in window) || !("Notification" in window)) return "unsupported";
  return "ok";
}

export function notificationPermission() {
  return typeof Notification === "undefined" ? "default" : Notification.permission;
}

/** A short name for this device, shown nowhere sensitive ("Android · Chrome"). */
export function deviceLabel() {
  if (typeof navigator === "undefined") return null;
  const ua = navigator.userAgent;
  const os = /android/i.test(ua) ? "Android" : isIos() ? (/ipad/i.test(ua) ? "iPad" : "iPhone") : /windows/i.test(ua) ? "Windows" : /mac os/i.test(ua) ? "Mac" : /linux/i.test(ua) ? "Linux" : "Device";
  const browser = /edg\//i.test(ua) ? "Edge" : /opr\//i.test(ua) ? "Opera" : /samsungbrowser/i.test(ua) ? "Samsung Internet" : /firefox|fxios/i.test(ua) ? "Firefox" : /chrome|crios/i.test(ua) ? "Chrome" : /safari/i.test(ua) ? "Safari" : "Browser";
  return `${os} · ${browser}${isStandalone() ? " (app)" : ""}`;
}

// ─── Subscription ────────────────────────────────────────────────────────────
function keyToBytes(base64) {
  const padded = (base64 + "=".repeat((4 - (base64.length % 4)) % 4)).replace(/-/g, "+").replace(/_/g, "/");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

function sameKey(subscription, publicKey) {
  const current = subscription?.options?.applicationServerKey;
  if (!current) return true; // browser does not expose it — assume fine
  const a = new Uint8Array(current);
  const b = keyToBytes(publicKey);
  return a.length === b.length && a.every((v, i) => v === b[i]);
}

export async function currentSubscription() {
  if (pushSupport() !== "ok") return null;
  const reg = await readyRegistration();
  return reg ? reg.pushManager.getSubscription() : null;
}

async function api(method, body) {
  const res = await fetch("/api/push", {
    method,
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

/** Server state for this device: { configured, publicKey, registered, devices }. */
export async function pushStatus() {
  const sub = await currentSubscription();
  const qs = sub ? `?endpoint=${encodeURIComponent(sub.endpoint)}` : "";
  const res = await fetch(`/api/push${qs}`, { credentials: "same-origin" });
  if (!res.ok) throw new Error(`Request failed (${res.status})`);
  return { ...(await res.json()), subscribed: Boolean(sub) };
}

/** Ask permission, subscribe this browser and register it for the signed-in user. */
export async function enablePush() {
  const support = pushSupport();
  if (support !== "ok") throw new Error(support);

  const permission = await Notification.requestPermission();
  if (permission !== "granted") throw new Error(permission === "denied" ? "denied" : "dismissed");

  const { publicKey } = await api("GET");
  if (!publicKey) throw new Error("server-off");

  const reg = await readyRegistration();
  let sub = await reg.pushManager.getSubscription();
  if (sub && !sameKey(sub, publicKey)) {
    await sub.unsubscribe(); // the server's keys changed — make a new one
    sub = null;
  }
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(publicKey) });

  await api("POST", { subscription: sub.toJSON(), device: deviceLabel() });
  return sub;
}

/** Stop phone notifications on this browser. */
export async function disablePush() {
  const sub = await currentSubscription();
  if (!sub) return;
  await api("DELETE", { endpoint: sub.endpoint }).catch(() => {});
  await sub.unsubscribe().catch(() => {});
}

/** Send a test to all of this user's devices. */
export async function sendTestPush() {
  const res = await fetch("/api/push/test", { method: "POST", credentials: "same-origin" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `Request failed (${res.status})`);
  return data;
}

// ─── App icon badge (installed app) ──────────────────────────────────────────
export function setAppBadge(count) {
  if (typeof navigator === "undefined" || !("setAppBadge" in navigator)) return;
  const p = count > 0 ? navigator.setAppBadge(count) : navigator.clearAppBadge();
  p?.catch?.(() => {});
}

// ─── "Install app" prompt (Android / desktop Chrome, Edge) ───────────────────
let deferredInstall = null;
const installListeners = new Set();

function notifyInstall() {
  for (const fn of installListeners) fn(Boolean(deferredInstall));
}

/** Called once by PwaRegister: keep the browser's install prompt for a button. */
export function captureInstallPrompt() {
  if (typeof window === "undefined") return () => {};
  const onPrompt = (e) => {
    e.preventDefault();
    deferredInstall = e;
    notifyInstall();
  };
  const onInstalled = () => {
    deferredInstall = null;
    notifyInstall();
  };
  window.addEventListener("beforeinstallprompt", onPrompt);
  window.addEventListener("appinstalled", onInstalled);
  return () => {
    window.removeEventListener("beforeinstallprompt", onPrompt);
    window.removeEventListener("appinstalled", onInstalled);
  };
}

export function onInstallAvailable(fn) {
  installListeners.add(fn);
  fn(Boolean(deferredInstall));
  return () => installListeners.delete(fn);
}

export async function promptInstall() {
  if (!deferredInstall) return false;
  const e = deferredInstall;
  deferredInstall = null;
  notifyInstall();
  await e.prompt();
  const choice = await e.userChoice.catch(() => null);
  return choice?.outcome === "accepted";
}
