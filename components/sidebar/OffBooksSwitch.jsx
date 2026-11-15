"use client";
// components/sidebar/OffBooksSwitch.jsx — the "Hide off books" switch
// (lib/accounts/books.js, /api/settings/off-books).
//   OffBooksButton  in the header, only for holders of offBooks.hide — amber
//                   "Off books hidden" while the switch is on. Nobody else sees
//                   any sign of it (no banner).
// State is checked every 30 s and when the tab comes back.
import { createContext, useCallback, useContext, useEffect, useState } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";

const OffBooksContext = createContext(null);

export function OffBooksProvider({ children }) {
  const [state, setState] = useState(null);
  const load = useCallback(() => {
    fetch("/api/settings/off-books")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setState(d))
      .catch(() => {});
  }, []);
  useEffect(() => {
    load();
    const t = setInterval(load, 30_000);
    const onFocus = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onFocus);
    return () => {
      clearInterval(t);
      document.removeEventListener("visibilitychange", onFocus);
    };
  }, [load]);
  return <OffBooksContext.Provider value={{ state, setState }}>{children}</OffBooksContext.Provider>;
}

const when = (d) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }) : "";

export function OffBooksButton() {
  const ctx = useContext(OffBooksContext);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const s = ctx?.state;
  if (!s?.canToggle) return null;
  const hidden = s.hidden;

  async function flip() {
    setBusy(true);
    try {
      const res = await fetch("/api/settings/off-books", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ hidden: !hidden }),
      });
      const d = await res.json();
      if (!res.ok) throw new Error(d.error || d.message || "Could not change it");
      toast.success(d.message);
      ctx.setState(d);
      setConfirming(false);
      // Every list on screen was loaded under the old setting
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <button
        type="button"
        onClick={() => setConfirming(true)}
        title={
          hidden
            ? `Off books are hidden${s.changedBy ? ` (${s.changedBy}${s.changedAt ? `, ${when(s.changedAt)}` : ""})` : ""} — click to show them again`
            : "Hide all off books from the system"
        }
        className={`inline-flex h-10 items-center gap-1.5 rounded-xl border px-2.5 text-xs font-semibold shadow-sm transition sm:px-3 ${
          hidden
            ? "border-amber-300 bg-amber-400 text-amber-950 hover:bg-amber-300"
            : "border-white/40 bg-white text-slate-700 hover:bg-slate-50"
        }`}
      >
        {hidden ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        <span className="hidden md:inline">{hidden ? "Off books hidden" : "Hide off books"}</span>
      </button>

      <Dialog open={confirming} onOpenChange={(o) => !busy && setConfirming(o)}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>{hidden ? "Show off books again?" : "Hide all off books?"}</DialogTitle>
            <DialogDescription>
              {hidden
                ? "Every screen, report and dashboard goes back to showing both books, for everyone."
                : "For EVERYONE, at once and without any notice on their screens: off-book customers and accounts, and every voucher, order, invoice and receipt that touches them, disappear from every screen, report and BI dashboard until someone shows them again. Nothing is deleted. Background jobs (knock-off, month-end) keep working on both books."}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setConfirming(false)} disabled={busy}>
              Cancel
            </Button>
            <Button
              onClick={flip}
              disabled={busy}
              className={hidden ? "" : "bg-amber-500 text-amber-950 hover:bg-amber-400"}
            >
              {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : hidden ? <Eye className="mr-1.5 h-4 w-4" /> : <EyeOff className="mr-1.5 h-4 w-4" />}
              {hidden ? "Show off books" : "Hide off books"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
