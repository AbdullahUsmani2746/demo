"use client";
// Official / Unofficial print chooser modal. Use askOfficialPrint() from
// lib/officialPrint.js — it loads this file in the browser only.

import { useEffect } from "react";
import { createRoot } from "react-dom/client";
import { BadgeCheck, FileText, Printer, X } from "lucide-react";
import { PRINT_CANCELLED } from "@/lib/officialPrint";

function OfficialPrintModal({ onPick }) {
  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onPick(null);
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onPick]);

  const Option = ({ value, icon: Icon, title, text, tone }) => (
    <button
      type="button"
      onClick={() => onPick(value)}
      className={`group flex w-full items-start gap-3 rounded-xl border-2 p-4 text-left transition hover:shadow-md focus:outline-none focus:ring-2 ${tone}`}
    >
      <span className="mt-0.5 rounded-lg bg-white/80 p-2 shadow-sm">
        <Icon className="h-5 w-5" />
      </span>
      <span>
        <span className="block text-base font-bold">{title}</span>
        <span className="block text-sm opacity-80">{text}</span>
      </span>
    </button>
  );

  return (
    <div
      className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm"
      onMouseDown={(e) => e.target === e.currentTarget && onPick(null)}
    >
      <div role="dialog" aria-modal="true" className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl dark:bg-zinc-900">
        <div className="mb-5 flex items-start justify-between">
          <div className="flex items-center gap-3">
            <span className="rounded-xl bg-blue-100 p-2.5 text-blue-700 dark:bg-blue-900/40 dark:text-blue-300">
              <Printer className="h-5 w-5" />
            </span>
            <div>
              <h2 className="text-lg font-bold text-zinc-900 dark:text-zinc-100">Print Type</h2>
              <p className="text-sm text-zinc-500">How should this document print?</p>
            </div>
          </div>
          <button type="button" onClick={() => onPick(null)} className="rounded-md p-1 text-zinc-400 hover:bg-zinc-100 hover:text-zinc-700 dark:hover:bg-zinc-800">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="space-y-3">
          <Option
            value={true}
            icon={BadgeCheck}
            title="Official"
            text="Full company name (Pvt Ltd) with tax details."
            tone="border-emerald-200 bg-emerald-50 text-emerald-900 hover:border-emerald-400 focus:ring-emerald-300 dark:border-emerald-800 dark:bg-emerald-950/40 dark:text-emerald-100"
          />
          <Option
            value={false}
            icon={FileText}
            title="Unofficial"
            text="Company name without Pvt Ltd, no tax details."
            tone="border-amber-200 bg-amber-50 text-amber-900 hover:border-amber-400 focus:ring-amber-300 dark:border-amber-800 dark:bg-amber-950/40 dark:text-amber-100"
          />
        </div>
      </div>
    </div>
  );
}

/** Mount the modal on its own root; resolves true / false, rejects on cancel. */
export function openOfficialPrintModal() {
  return new Promise((resolve, reject) => {
    const host = document.createElement("div");
    document.body.appendChild(host);
    const root = createRoot(host);
    const onPick = (value) => {
      root.unmount();
      host.remove();
      if (value === null) reject(new Error(PRINT_CANCELLED));
      else resolve(value);
    };
    root.render(<OfficialPrintModal onPick={onPick} />);
  });
}
