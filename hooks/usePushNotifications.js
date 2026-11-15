"use client";
// Phone notifications on this device — state + actions for the screens
// (components/Notifications/PhoneNotifications.jsx). Browser work lives in
// lib/pwa/client.js.
//
// status:
//   loading · insecure · needs-install · unsupported · server-off · denied · off · on
import { useCallback, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  disablePush,
  enablePush,
  notificationPermission,
  onInstallAvailable,
  promptInstall,
  pushStatus,
  pushSupport,
  sendTestPush,
} from "@/lib/pwa/client";

const KEY = ["push-status"];

const ERRORS = {
  denied: "Notifications are blocked for this site. Allow them in the browser's site settings, then try again.",
  dismissed: "Notifications were not allowed.",
  "server-off": "Phone notifications are not set up on the server yet.",
  insecure: "Phone notifications need the secure (https) address of the system.",
  "needs-install": "On iPhone, add the app to the Home Screen first and open it from there.",
  unsupported: "This browser cannot receive notifications.",
};

export function usePushNotifications() {
  const queryClient = useQueryClient();
  const [support, setSupport] = useState("loading");
  const [busy, setBusy] = useState(false);
  const [canInstall, setCanInstall] = useState(false);

  useEffect(() => {
    setSupport(pushSupport());
    return onInstallAvailable(setCanInstall);
  }, []);

  const { data, isLoading } = useQuery({
    queryKey: KEY,
    queryFn: pushStatus,
    enabled: support === "ok",
    staleTime: 60_000,
  });

  let status = support;
  if (support === "ok") {
    if (isLoading || !data) status = "loading";
    else if (!data.configured) status = "server-off";
    else if (notificationPermission() === "denied") status = "denied";
    else status = data.subscribed && data.registered ? "on" : "off";
  }

  const run = useCallback(
    async (fn, success) => {
      setBusy(true);
      try {
        const result = await fn();
        if (success) toast.success(typeof success === "function" ? success(result) : success);
      } catch (err) {
        toast.error(ERRORS[err?.message] || err?.message || "Something went wrong");
      } finally {
        setBusy(false);
        queryClient.invalidateQueries({ queryKey: KEY });
      }
    },
    [queryClient],
  );

  return {
    status,
    devices: data?.devices ?? 0,
    busy,
    canInstall,
    enable: () => run(enablePush, "Phone notifications are on for this device"),
    disable: () => run(disablePush, "Phone notifications are off for this device"),
    test: () =>
      run(sendTestPush, (r) => (r.devices ? `Test sent to ${r.sent} of ${r.devices} device${r.devices === 1 ? "" : "s"}` : "No device has phone notifications on")),
    install: () => run(promptInstall),
  };
}
