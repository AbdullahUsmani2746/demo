"use client";

// HR → Attendance: daily register, monthly sheet, off-day swaps, machines, file import.
import { Suspense, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarCheck, CalendarDays, Grid3x3, Cpu, FileSpreadsheet, Inbox, Clock, ArrowLeftRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HR_MAIN, HR_PAGE, HR_TABS_LIST, HR_TABS_SCROLL, HR_TABS_TRIGGER, NoAccess, PageHeader, PageLoading, useHrMeta } from "@/components/HR/shared";
import DailyRegister from "@/components/HR/attendance/DailyRegister";
import MonthlySheet from "@/components/HR/attendance/MonthlySheet";
import Machines from "@/components/HR/attendance/Machines";
import ImportPanel from "@/components/HR/attendance/ImportPanel";
import OffSwaps from "@/components/HR/attendance/OffSwaps";

const TABS = ["daily", "month", "swaps", "machines", "import"];

function AttendancePage() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { data: meta, isLoading, error } = useHrMeta();

  const tab = TABS.includes(sp.get("tab")) ? sp.get("tab") : "daily";
  const setTab = (t) => {
    const p = new URLSearchParams(sp);
    p.set("tab", t);
    router.replace(`${pathname}?${p}`, { scroll: false });
  };
  const [date, setDate] = useState(null);
  const [month, setMonth] = useState(null);
  const [focus, setFocus] = useState(null);

  if (isLoading) return <PageLoading label="Loading attendance…" />;
  if (error || !meta?.rights?.view) return <NoAccess />;

  const day = date ?? meta.today;
  const mon = month ?? meta.today.slice(0, 7);
  const canImport = meta.rights.import;
  // Machines & punches: for those who run the machines (import / devices), not every viewer.
  const seesMachines = meta.rights.import || meta.rights.devices;

  return (
    <div className={HR_PAGE}>
      <PageHeader
        icon={CalendarCheck}
        title="Attendance"
        subtitle="Mark the day, review the month, and bring in punches from the machines"
        actions={
          <>
            <Button variant="outline" size="sm" className="h-9 bg-background" asChild>
              <Link href="/accounting/hr/shifts"><Clock className="h-4 w-4 mr-1.5" />Shifts &amp; holidays</Link>
            </Button>
            <Button variant="outline" size="sm" className="h-9 bg-background" asChild>
              <Link href="/dashboard/approvals"><Inbox className="h-4 w-4 mr-1.5" />Approvals</Link>
            </Button>
          </>
        }
      />
      <main className={HR_MAIN}>
        <Tabs value={tab} onValueChange={setTab} className="space-y-4 sm:space-y-5">
          <div className={HR_TABS_SCROLL}>
            <TabsList className={HR_TABS_LIST}>
              <TabsTrigger value="daily" className={HR_TABS_TRIGGER}><CalendarDays className="h-4 w-4" />Daily register</TabsTrigger>
              <TabsTrigger value="month" className={HR_TABS_TRIGGER}><Grid3x3 className="h-4 w-4" />Monthly sheet</TabsTrigger>
              <TabsTrigger value="swaps" className={HR_TABS_TRIGGER}><ArrowLeftRight className="h-4 w-4" />Off-day swaps</TabsTrigger>
              {seesMachines && <TabsTrigger value="machines" className={HR_TABS_TRIGGER}><Cpu className="h-4 w-4" />Machines &amp; punches</TabsTrigger>}
              {canImport && <TabsTrigger value="import" className={HR_TABS_TRIGGER}><FileSpreadsheet className="h-4 w-4" />Import file</TabsTrigger>}
            </TabsList>
          </div>
          <TabsContent value="daily" className="mt-0">
            <DailyRegister meta={meta} date={day} setDate={setDate} focus={focus} />
          </TabsContent>
          <TabsContent value="month" className="mt-0">
            <MonthlySheet
              meta={meta}
              month={mon}
              setMonth={setMonth}
              openDay={(d, employeeId) => {
                setDate(d);
                setFocus({ id: employeeId, at: Date.now() });
                setTab("daily");
              }}
            />
          </TabsContent>
          <TabsContent value="swaps" className="mt-0">
            <OffSwaps meta={meta} />
          </TabsContent>
          {seesMachines && (
            <TabsContent value="machines" className="mt-0">
              <Machines meta={meta} date={day} />
            </TabsContent>
          )}
          {canImport && (
            <TabsContent value="import" className="mt-0">
              <ImportPanel />
            </TabsContent>
          )}
        </Tabs>
      </main>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <AttendancePage />
    </Suspense>
  );
}
