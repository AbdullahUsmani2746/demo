"use client";

// HR → Shifts & holidays: shifts and their rules, who works which shift,
// holidays, and the attendance-correction rule.
import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Clock, CalendarClock, PartyPopper, ShieldCheck, CalendarCheck, Layers } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { HR_MAIN, HR_PAGE, HR_TABS_LIST, HR_TABS_SCROLL, HR_TABS_TRIGGER, NoAccess, PageHeader, PageLoading, useHrMeta } from "@/components/HR/shared";
import ShiftsTab from "@/components/HR/shifts/ShiftsTab";
import AssignTab from "@/components/HR/shifts/AssignTab";
import { HolidaysTab, RulesTab } from "@/components/HR/shifts/HolidaysTab";

const TABS = ["shifts", "assign", "holidays", "rules"];

function ShiftsPage() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { data: meta, isLoading, error } = useHrMeta();
  const tab = TABS.includes(sp.get("tab")) ? sp.get("tab") : "shifts";
  const setTab = (t) => {
    const p = new URLSearchParams(sp);
    p.set("tab", t);
    router.replace(`${pathname}?${p}`, { scroll: false });
  };

  if (isLoading) return <PageLoading label="Loading shifts…" />;
  if (error || !meta) return <NoAccess />;

  return (
    <div className={HR_PAGE}>
      <PageHeader
        icon={Clock}
        title="Shifts & Holidays"
        subtitle="Working hours and their rules, who works when, and the days off"
        actions={
          <Button variant="outline" size="sm" className="h-9 bg-background" asChild>
            <Link href="/accounting/hr/attendance"><CalendarCheck className="h-4 w-4 mr-1.5" />Attendance</Link>
          </Button>
        }
      />
      <main className={HR_MAIN}>
        <Tabs value={tab} onValueChange={setTab} className="space-y-4 sm:space-y-5">
          <div className={HR_TABS_SCROLL}>
            <TabsList className={HR_TABS_LIST}>
              <TabsTrigger value="shifts" className={HR_TABS_TRIGGER}><Layers className="h-4 w-4" />Shifts</TabsTrigger>
              <TabsTrigger value="assign" className={HR_TABS_TRIGGER}><CalendarClock className="h-4 w-4" />Assign employees</TabsTrigger>
              <TabsTrigger value="holidays" className={HR_TABS_TRIGGER}><PartyPopper className="h-4 w-4" />Holidays</TabsTrigger>
              <TabsTrigger value="rules" className={HR_TABS_TRIGGER}><ShieldCheck className="h-4 w-4" />Rules</TabsTrigger>
            </TabsList>
          </div>
          <TabsContent value="shifts" className="mt-0"><ShiftsTab meta={meta} /></TabsContent>
          <TabsContent value="assign" className="mt-0"><AssignTab meta={meta} /></TabsContent>
          <TabsContent value="holidays" className="mt-0"><HolidaysTab meta={meta} /></TabsContent>
          <TabsContent value="rules" className="mt-0"><RulesTab meta={meta} /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <ShiftsPage />
    </Suspense>
  );
}
