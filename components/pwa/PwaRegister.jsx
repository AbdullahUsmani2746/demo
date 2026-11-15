"use client";
// Mounted once in app/layout.js: registers the service worker (public/sw.js)
// and keeps the browser's "Install app" prompt for the Install button
// (components/Notifications/PhoneNotifications.jsx).
import { useEffect } from "react";
import { captureInstallPrompt, registerServiceWorker } from "@/lib/pwa/client";

export default function PwaRegister() {
  useEffect(() => {
    registerServiceWorker();
    return captureInstallPrompt();
  }, []);
  return null;
}
