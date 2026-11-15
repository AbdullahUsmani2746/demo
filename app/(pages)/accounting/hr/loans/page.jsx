"use client";

// HR → Advances & loans: my advances / loans, and everyone's.
import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { HandCoins, UserRound, Users, Inbox } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { NoAccess, PageHeader, useHrMeta } from "@/components/HR/shared";
import { MAIN, PAGE, PageSkeleton, UnderlineTab, UnderlineTabsList } from "@/components/HR/payroll/ui";
import LoansList from "@/components/HR/loans/LoansList";

function LoansPage() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { data: meta, isLoading, error } = useHrMeta();
  if (isLoading) return <PageSkeleton />;
  const r = meta?.rights;
  const mine = Boolean(meta?.self && (r?.loanApply || r?.loanManage));
  const team = Boolean(r?.loanView);
  if (error || !meta || (!mine && !team)) return <NoAccess />;
  const tabs = [mine && "mine", team && "all"].filter(Boolean);
  const tab = tabs.includes(sp.get("tab")) ? sp.get("tab") : tabs[0];
  const setTab = (t) => {
    const p = new URLSearchParams(sp);
    p.set("tab", t);
    router.replace(`${pathname}?${p}`, { scroll: false });
  };
  return (
    <div className={PAGE}>
      <PageHeader
        icon={HandCoins}
        title="Advances & Loans"
        subtitle="Salary advances and staff loans, recovered from salary month by month"
        actions={<Button variant="outline" size="sm" className="h-9 bg-background" asChild><Link href="/dashboard/approvals"><Inbox className="h-4 w-4 mr-1.5" />Approvals</Link></Button>}
      />
      <main className={MAIN}>
        <Tabs value={tab} onValueChange={setTab} className="space-y-5">
          {tabs.length > 1 && (
            <UnderlineTabsList aria-label="Whose advances and loans">
              {mine && <UnderlineTab value="mine"><UserRound className="h-4 w-4" />Mine</UnderlineTab>}
              {team && <UnderlineTab value="all"><Users className="h-4 w-4" />Everyone</UnderlineTab>}
            </UnderlineTabsList>
          )}
          {mine && <TabsContent value="mine" className="mt-0"><LoansList meta={meta} mine /></TabsContent>}
          {team && <TabsContent value="all" className="mt-0"><LoansList meta={meta} /></TabsContent>}
        </Tabs>
      </main>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <LoansPage />
    </Suspense>
  );
}
