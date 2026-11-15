"use client";

// HR → Leave: my leave, applications, team calendar, balances, leave types.
import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Plane, UserRound, Inbox, CalendarDays, Scale, Tags, CalendarCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { NoAccess, PageHeader, useHrMeta } from "@/components/HR/shared";
import { MAIN, PAGE, PageSkeleton, UnderlineTab, UnderlineTabsList } from "@/components/HR/payroll/ui";
import MyLeave from "@/components/HR/leave/MyLeave";
import RequestsTab from "@/components/HR/leave/RequestsTab";
import CalendarTab from "@/components/HR/leave/CalendarTab";
import BalancesTab from "@/components/HR/leave/BalancesTab";
import TypesTab from "@/components/HR/leave/TypesTab";

function LeavePage() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { data: meta, isLoading, error } = useHrMeta();

  if (isLoading) return <PageSkeleton />;
  const r = meta?.rights;
  const mine = Boolean(meta?.self && (r?.leaveApply || r?.leaveManage));
  const team = Boolean(r?.leaveView);
  if (error || !meta || (!mine && !team)) return <NoAccess />;

  const tabs = [mine && "mine", team && "requests", team && "calendar", team && "balances", team && "types"].filter(Boolean);
  const tab = tabs.includes(sp.get("tab")) ? sp.get("tab") : tabs[0];
  const setTab = (t) => {
    const p = new URLSearchParams(sp);
    p.set("tab", t);
    router.replace(`${pathname}?${p}`, { scroll: false });
  };

  return (
    <div className={PAGE}>
      <PageHeader
        icon={Plane}
        title="Leave"
        subtitle="Apply, approve and keep track of everyone’s leave"
        actions={
          <>
            {r.view && (
              <Button variant="outline" size="sm" className="h-9 bg-background" asChild>
                <Link href="/accounting/hr/attendance"><CalendarCheck className="h-4 w-4 mr-1.5" />Attendance</Link>
              </Button>
            )}
            <Button variant="outline" size="sm" className="h-9 bg-background" asChild>
              <Link href="/dashboard/approvals"><Inbox className="h-4 w-4 mr-1.5" />Approvals</Link>
            </Button>
          </>
        }
      />
      <main className={MAIN}>
        <Tabs value={tab} onValueChange={setTab} className="space-y-4 sm:space-y-5">
          {tabs.length > 1 && (
            <UnderlineTabsList aria-label="Leave sections">
              {mine && <UnderlineTab value="mine"><UserRound className="h-4 w-4" />My leave</UnderlineTab>}
              {team && <UnderlineTab value="requests"><Inbox className="h-4 w-4" />Applications</UnderlineTab>}
              {team && <UnderlineTab value="calendar"><CalendarDays className="h-4 w-4" />Calendar</UnderlineTab>}
              {team && <UnderlineTab value="balances"><Scale className="h-4 w-4" />Balances</UnderlineTab>}
              {team && <UnderlineTab value="types"><Tags className="h-4 w-4" />Leave types</UnderlineTab>}
            </UnderlineTabsList>
          )}
          {mine && <TabsContent value="mine" className="mt-0"><MyLeave meta={meta} /></TabsContent>}
          {team && <TabsContent value="requests" className="mt-0"><RequestsTab meta={meta} /></TabsContent>}
          {team && <TabsContent value="calendar" className="mt-0"><CalendarTab meta={meta} /></TabsContent>}
          {team && <TabsContent value="balances" className="mt-0"><BalancesTab meta={meta} /></TabsContent>}
          {team && <TabsContent value="types" className="mt-0"><TypesTab meta={meta} /></TabsContent>}
        </Tabs>
      </main>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <LeavePage />
    </Suspense>
  );
}
