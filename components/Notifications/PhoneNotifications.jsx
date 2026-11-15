"use client";
// Phone notifications — turn them on / off for THIS device.
//   PhoneNotificationsCard    full card on the Notifications page
//   PhoneNotificationsPrompt  one-line nudge at the foot of the bell
// What gets sent and to whom is unchanged (Admin → Notifications); this only
// adds the device. State + actions: hooks/usePushNotifications.js.
import { useEffect, useState } from "react";
import { BellOff, BellRing, Download, Loader2, Send, Share, Smartphone, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { usePushNotifications } from "@/hooks/usePushNotifications";

const BRAND_BTN = "bg-primary text-primary-foreground hover:bg-primary/90";

const TEXT = {
  loading: { title: "Checking this device…", hint: "" },
  on: {
    title: "On for this device",
    hint: "New notifications — approvals waiting for you, decisions on your requests and everything else in your bell — arrive here even when the app is closed.",
  },
  off: {
    title: "Off for this device",
    hint: "Turn on to get approvals and other notifications on this phone or computer, even when the app is closed.",
  },
  denied: {
    title: "Blocked by the browser",
    hint: "Notifications are blocked for this site. Open the browser's site settings (the lock icon next to the address), allow Notifications, then reload.",
  },
  "needs-install": {
    title: "Add to Home Screen first",
    hint: "On iPhone / iPad notifications work only from the installed app: tap Share, then “Add to Home Screen”, open the app from there and turn them on.",
  },
  insecure: {
    title: "Needs the secure address",
    hint: "Phone notifications work only when the system is opened over https. Ask your administrator for the secure link.",
  },
  unsupported: {
    title: "Not available in this browser",
    hint: "Use Chrome, Edge, Samsung Internet or Firefox on Android or a computer, or the Home Screen app on iPhone.",
  },
  "server-off": {
    title: "Not set up on the server yet",
    hint: "Your administrator needs to finish the phone-notification setup (server keys and the devices table).",
  },
};

export function PhoneNotificationsCard({ className }) {
  const push = usePushNotifications();
  const { status, busy } = push;
  const text = TEXT[status] ?? TEXT.unsupported;
  const on = status === "on";

  return (
    <section className={cn("rounded-xl border border-border bg-background p-4", className)} aria-label="Phone notifications">
      <div className="flex flex-col gap-3 md:flex-row md:items-center">
        <div className="flex min-w-0 flex-1 items-start gap-3">
          <span
            className={cn("grid h-10 w-10 shrink-0 place-items-center rounded-full", on ? "bg-primary text-primary-foreground" : "bg-primary/10 text-primary")}
          >
            {on ? <BellRing className="h-5 w-5" /> : <Smartphone className="h-5 w-5" />}
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-sm font-semibold text-foreground">Phone notifications</p>
            <p className={cn("text-xs font-medium", on ? "text-primary" : "text-muted-foreground")}>{text.title}</p>
            {text.hint && <p className="mt-0.5 text-xs leading-relaxed text-muted-foreground">{text.hint}</p>}
            {push.devices > 0 && (
              <p className="mt-1 text-[11px] text-muted-foreground">
                On for {push.devices} device{push.devices === 1 ? "" : "s"} of yours.
              </p>
            )}
          </div>
        </div>
        {/* Phone: full-width buttons under the text; wider: to the right. */}
        <div className="grid grid-cols-1 gap-2 empty:hidden min-[400px]:grid-cols-2 md:flex md:shrink-0 md:flex-wrap md:justify-end">
          {push.canInstall && (
            <Button variant="outline" size="sm" className="gap-1.5" onClick={push.install} disabled={busy}>
              <Download className="h-4 w-4" /> Install app
            </Button>
          )}
          {status === "needs-install" && (
            <span className="col-span-full inline-flex items-center justify-center gap-1 rounded-md border border-border px-2 py-1.5 text-xs text-muted-foreground">
              <Share className="h-3.5 w-3.5" /> Share → Add to Home Screen
            </span>
          )}
          {status === "off" && (
            <Button size="sm" className={cn("col-span-full gap-1.5 md:col-auto", BRAND_BTN)} onClick={push.enable} disabled={busy}>
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <BellRing className="h-4 w-4" />} Turn on
            </Button>
          )}
          {on && (
            <>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={push.test} disabled={busy}>
                {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} Send a test
              </Button>
              <Button variant="outline" size="sm" className="gap-1.5" onClick={push.disable} disabled={busy}>
                <BellOff className="h-4 w-4" /> Turn off
              </Button>
            </>
          )}
        </div>
      </div>
    </section>
  );
}

const DISMISS_KEY = "phoneNotificationsPromptDismissed";

function readDismissed() {
  try {
    return localStorage.getItem(DISMISS_KEY) === "1";
  } catch {
    return false;
  }
}

/** Shown in the bell only while push could be turned on (or installed on iPhone). */
export function PhoneNotificationsPrompt({ onNavigate }) {
  const push = usePushNotifications();
  const [dismissed, setDismissed] = useState(true);
  useEffect(() => setDismissed(readDismissed()), []);

  if (dismissed || !["off", "needs-install"].includes(push.status)) return null;

  const dismiss = () => {
    setDismissed(true);
    try {
      localStorage.setItem(DISMISS_KEY, "1");
    } catch {
      // private mode — it just shows again next time
    }
  };

  return (
    <div className="flex items-center gap-2 border-t border-border bg-primary/5 px-4 py-2">
      <Smartphone className="h-4 w-4 shrink-0 text-primary" />
      <p className="min-w-0 flex-1 text-xs text-foreground">
        {push.status === "off" ? "Get approvals and notifications on this device." : "On iPhone: Add to Home Screen to get notifications."}
      </p>
      {push.status === "off" ? (
        <Button size="sm" className={cn("h-7 px-2.5 text-xs", BRAND_BTN)} onClick={push.enable} disabled={push.busy}>
          {push.busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Turn on"}
        </Button>
      ) : (
        <a href="/accounting/notifications" onClick={onNavigate} className="text-xs font-medium text-primary hover:underline">
          How
        </a>
      )}
      <button type="button" onClick={dismiss} aria-label="Hide" className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground">
        <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
