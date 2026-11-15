"use client";

import { useState, useEffect, useCallback, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import {
  RefreshCw, CalendarRange, CalendarDays, ShieldCheck, ShieldAlert, Eye, KeyRound, ScrollText,
} from "lucide-react";
import { toast } from "sonner";
import { documentsSummary, LOCK_ACTIONS } from "@/lib/periodLockCatalog";
import { StatCard, ConfirmDialog, MONTHS, fmtDay, fmtSpan, fmtRelative, isoLocal, plural } from "@/components/PeriodLock/shared";
import RangeTab from "@/components/PeriodLock/RangeTab";
import MonthTab from "@/components/PeriodLock/MonthTab";
import ExceptionsTab from "@/components/PeriodLock/ExceptionsTab";
import ActivityTab from "@/components/PeriodLock/ActivityTab";
import { LabHeader, CHIP, TABS_SCROLL, TABS_LIST, TABS_TRIGGER } from "@/components/Material/shared/LabUI";

export default function PeriodLockPage() {
  const thisYear = new Date().getFullYear();

  const [tab, setTab] = useState("range");
  const [year, setYear] = useState(thisYear);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState(null);
  const [confirm, setConfirm] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch(`/api/period-lock?year=${year}`);
      const d = await res.json();
      if (res.ok) setData(d); else toast.error(d.error || "Failed to load locks");
    } catch { toast.error("Server error"); } finally { setLoading(false); }
  }, [year]);

  useEffect(() => { load(); }, [load]);

  const months = data?.months ?? [];
  const ranges = data?.ranges ?? [];
  const today = data?.today;
  const myExceptions = data?.my_exceptions ?? [];
  const canManage = data?.can_manage === true;

  const activeRanges = useMemo(() => ranges.filter((r) => r.is_active), [ranges]);
  const lockedMonths = months.filter((m) => m.is_locked).length;
  const todayLocked = !!(today?.month_locked || today?.range);
  const todayHint = today?.month_locked
    ? `${MONTHS[today.month - 1]} is closed`
    : today?.range ? `Range ${fmtSpan(today.range.date_from, today.range.date_to)}` : "New entries can be posted";

  const runConfirmed = async () => {
    if (!confirm) return;
    await confirm.run();
    setConfirm(null);
  };

  const tabProps = { busyKey, setBusyKey, ask: setConfirm };

  return (
    <div className="min-h-screen bg-muted/40">
      <main className="mx-auto max-w-[1600px] space-y-5 px-3 py-5 sm:px-6">
        <LabHeader
          icon={ShieldCheck}
          breadcrumb="Accounting"
          title="Period Lock"
          subtitle="Close days or months, and open them for specific people when needed"
          actions={
            <Button variant="outline" size="sm" className="h-9" onClick={load} disabled={loading}>
              <RefreshCw className={`mr-1.5 h-4 w-4 ${loading ? "animate-spin" : ""}`} />Refresh
            </Button>
          }
        />

        {data && !canManage && (
          <div className={`flex items-start gap-3 rounded-xl px-4 py-3 text-sm ${CHIP.warn}`}>
            <Eye className="mt-0.5 h-4 w-4 shrink-0" />
            <p><span className="font-semibold">View only.</span> Only Admin or Accountant can lock, unlock or grant access.</p>
          </div>
        )}

        {myExceptions.length > 0 && (
          <div className="space-y-1.5 rounded-xl border border-primary/20 bg-primary/5 px-4 py-3 text-sm text-foreground">
            <p className="flex items-center gap-2 font-semibold text-primary"><KeyRound className="h-4 w-4" />You have temporary access to locked dates</p>
            <ul className="space-y-1 text-muted-foreground">
              {myExceptions.map((e) => (
                <li key={e.id}>
                  <span className="font-medium text-foreground">{fmtSpan(e.date_from, e.date_to)}</span>
                  {" · "}{LOCK_ACTIONS.filter((a) => e[a.field]).map((a) => a.label).join("/")}
                  {" · "}{documentsSummary(e.tran_codes)}
                  {" · "}{e.expires_at ? `expires ${fmtRelative(e.expires_at)}` : "until revoked"}
                </li>
              ))}
            </ul>
          </div>
        )}

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <StatCard icon={todayLocked ? ShieldAlert : ShieldCheck} tone={todayLocked ? "red" : "green"}
            label={`Today · ${fmtDay(isoLocal(new Date()))}`} value={todayLocked ? "Locked" : "Open"}
            hint={todayHint} loading={loading && !data} />
          <StatCard icon={CalendarRange} tone="brand" label="Active date locks"
            value={plural(activeRanges.length, "range")}
            hint={activeRanges[0] ? `Latest: ${fmtSpan(activeRanges[0].date_from, activeRanges[0].date_to)}` : "None"}
            loading={loading && !data} />
          <StatCard icon={CalendarDays} tone="slate" label={`Months closed · ${year}`}
            value={`${lockedMonths} of 12`} hint="Closing a month rebuilds next month's opening stock"
            loading={loading && !data} />
        </section>

        <Tabs value={tab} onValueChange={setTab} className="space-y-4">
          <div className={TABS_SCROLL}>
            <TabsList className={TABS_LIST}>
              <TabsTrigger value="range" className={TABS_TRIGGER}><CalendarRange className="h-4 w-4" />Date Range</TabsTrigger>
              <TabsTrigger value="month" className={TABS_TRIGGER}><CalendarDays className="h-4 w-4" />Month Close</TabsTrigger>
              {canManage && <TabsTrigger value="exceptions" className={TABS_TRIGGER}><KeyRound className="h-4 w-4" />Exceptions</TabsTrigger>}
              {canManage && <TabsTrigger value="activity" className={TABS_TRIGGER}><ScrollText className="h-4 w-4" />Activity</TabsTrigger>}
            </TabsList>
          </div>

          <TabsContent value="range" className="mt-0">
            <RangeTab ranges={ranges} loading={loading} canManage={canManage} reload={load} {...tabProps} />
          </TabsContent>
          <TabsContent value="month" className="mt-0">
            <MonthTab months={months} year={year} setYear={setYear} loading={loading} canManage={canManage} reload={load} {...tabProps} />
          </TabsContent>
          {canManage && (
            <TabsContent value="exceptions" className="mt-0">
              <ExceptionsTab onChanged={load} {...tabProps} />
            </TabsContent>
          )}
          {canManage && (
            <TabsContent value="activity" className="mt-0">
              <ActivityTab />
            </TabsContent>
          )}
        </Tabs>
      </main>

      <ConfirmDialog confirm={confirm} busy={busyKey !== null} onCancel={() => setConfirm(null)} onConfirm={runConfirmed} />
    </div>
  );
}
