"use client";

import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Lock, Unlock, Loader2, ChevronLeft, ChevronRight, Info, CalendarDays } from "lucide-react";
import { toast } from "sonner";
import { CHIP } from "@/components/Material/shared/LabUI";
import { BRAND, WARN_BTN, MONTHS, Pill, Panel, fmtStamp, who, sendJson } from "./shared";

export default function MonthTab({ months, year, setYear, loading, canManage, busyKey, setBusyKey, ask, reload }) {
  const now = new Date();
  const thisYear = now.getFullYear();
  const thisMonth = now.getMonth() + 1;
  const busy = busyKey !== null;

  const toggle = (m) => {
    const lock = !m.is_locked;
    const label = `${MONTHS[m.month - 1]} ${m.year}`;
    const next = `${MONTHS[m.month % 12]} ${m.month === 12 ? m.year + 1 : m.year}`;
    ask({
      title: `${lock ? "Lock" : "Unlock"} ${label}?`,
      body: lock
        ? [
            `No documents dated in ${label} can be posted, edited or deleted — except by users holding an exception that includes closed months.`,
            `${next}'s opening stock will be regenerated from ${label}'s closing.`,
            ...(m.year === thisYear && m.month === thisMonth
              ? [`${label} has not ended yet — to close only part of it, use a Date Range lock instead.`]
              : []),
          ]
        : [
            `Every document dated in ${label} can be changed again by everyone.`,
            `To let only one person fix something, keep it locked and grant an exception instead.`,
            `Lock it again when you are done so ${next}'s opening stock is rebuilt.`,
          ],
      action: lock ? "Lock month" : "Unlock month",
      tone: lock ? "brand" : "warn",
      run: async () => {
        setBusyKey(`m-${m.month}`);
        try {
          const d = await sendJson("/api/costing/lock-period", "POST", {
            month: m.month, year: m.year, action: lock ? "lock" : "unlock",
          });
          if (!lock) toast.success(`${label} unlocked`);
          else if (d.opening_stock?.error) {
            toast.warning(`${label} locked, but opening stock generation failed`, { description: d.opening_stock.error });
          } else {
            toast.success(`${label} locked`, { description: "Next month's opening stock has been updated." });
          }
          reload();
        } catch (err) { toast.error(err.message); } finally { setBusyKey(null); }
      },
    });
  };

  const closed = months.filter((m) => m.is_locked).length;

  return (
    <Panel>
      <div className="flex flex-col gap-3 border-b border-primary/15 bg-primary/5 px-4 py-3 sm:flex-row sm:items-center">
        <div className="min-w-0">
          <h2 className="flex items-center gap-2 text-[15px] font-semibold text-primary">
            <CalendarDays className="h-4 w-4" />Month close
          </h2>
          <p className="mt-0.5 flex items-start gap-1 text-xs text-muted-foreground">
            <Info className="mt-px h-3.5 w-3.5 shrink-0" />
            Lock a month only after it has ended — it also rebuilds the next month&apos;s opening stock.
          </p>
        </div>
        <div className="flex items-center gap-1 self-start sm:ml-auto sm:self-auto">
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setYear((y) => y - 1)} disabled={loading} aria-label="Previous year">
            <ChevronLeft className="h-4 w-4" />
          </Button>
          <span className="w-16 text-center font-semibold tabular-nums text-foreground">{year}</span>
          <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setYear((y) => y + 1)} disabled={loading || year >= thisYear} aria-label="Next year">
            <ChevronRight className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Legend + count */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border px-4 py-2.5 text-xs text-muted-foreground">
        <Pill kind="locked" /> <span>closed — nobody can post, edit or delete</span>
        <span className="mx-1 hidden text-border sm:inline">|</span>
        <Pill kind="open" /> <span>open</span>
        <span className="ml-auto font-medium tabular-nums text-foreground">{closed} of 12 closed</span>
      </div>

      <div className="grid grid-cols-2 gap-3 p-4 md:grid-cols-3 xl:grid-cols-4">
        {loading && !months.length
          ? Array.from({ length: 12 }, (_, i) => <Skeleton key={i} className="h-32 rounded-xl" />)
          : months.map((m) => {
              const isCurrent = m.year === thisYear && m.month === thisMonth;
              const isFuture = m.year > thisYear || (m.year === thisYear && m.month > thisMonth);
              return (
                <div key={m.month}
                  className={`relative flex min-w-0 flex-col gap-2 overflow-hidden rounded-xl border p-3 transition-shadow sm:p-4 ${
                    m.is_locked ? "border-primary/30 bg-primary/[0.04]"
                      : isFuture ? "border-dashed border-border bg-muted/30" : "border-border bg-background hover:shadow-sm"
                  } ${isCurrent ? "ring-2 ring-primary/30" : ""}`}>
                  {/* Left edge: maroon when closed, green when open */}
                  {!isFuture && (
                    <span aria-hidden="true" className={`absolute inset-y-0 left-0 w-1 ${m.is_locked ? "bg-primary" : "bg-[#2f5139] dark:bg-emerald-500/60"}`} />
                  )}
                  <div className="flex items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className={`truncate font-semibold ${isFuture ? "text-muted-foreground" : "text-foreground"}`}>{MONTHS[m.month - 1]}</p>
                      <p className="text-xs text-muted-foreground">{isCurrent ? "Current month" : isFuture ? "Not started" : m.year}</p>
                    </div>
                    {!isFuture && (
                      <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${m.is_locked ? "bg-primary text-primary-foreground" : CHIP.ok}`}
                        title={m.is_locked ? "Closed" : "Open"}>
                        {m.is_locked ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                      </span>
                    )}
                  </div>
                  {!isFuture && <div><Pill kind={m.is_locked ? "locked" : "open"} /></div>}
                  <p className="min-h-[1rem] truncate text-xs text-muted-foreground">
                    {m.is_locked && m.locked_at ? `${who(m.locked_by)} · ${fmtStamp(m.locked_at)}` : ""}
                  </p>
                  {canManage && !isFuture && (
                    <Button size="sm" variant={m.is_locked ? "outline" : "default"} disabled={busy} onClick={() => toggle(m)}
                      className={`mt-auto h-9 w-full ${m.is_locked ? WARN_BTN : BRAND}`}>
                      {busyKey === `m-${m.month}` ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
                        : m.is_locked ? <Unlock className="mr-1.5 h-4 w-4" /> : <Lock className="mr-1.5 h-4 w-4" />}
                      {m.is_locked ? "Unlock" : "Lock month"}
                    </Button>
                  )}
                </div>
              );
            })}
      </div>
    </Panel>
  );
}
