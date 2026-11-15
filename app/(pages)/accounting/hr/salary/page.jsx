"use client";

// HR → Salary: everyone's salary (revisions via approval) and pay components.
import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { BadgeDollarSign, Users, Puzzle, HandCoins } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { NoAccess, PageHeader, useHrMeta } from "@/components/HR/shared";
import { MAIN, PAGE, PageSkeleton, UnderlineTab, UnderlineTabsList } from "@/components/HR/payroll/ui";
import SalariesTab from "@/components/HR/salary/SalariesTab";
import ComponentsTab from "@/components/HR/salary/ComponentsTab";

function SalaryPage() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { data: meta, isLoading, error } = useHrMeta();
  if (isLoading) return <PageSkeleton />;
  if (error || !meta?.rights?.salaryView) return <NoAccess />;
  const tab = sp.get("tab") === "components" ? "components" : "salaries";
  const setTab = (t) => {
    const p = new URLSearchParams(sp);
    p.set("tab", t);
    router.replace(`${pathname}?${p}`, { scroll: false });
  };
  return (
    <div className={PAGE}>
      <PageHeader
        icon={BadgeDollarSign}
        title="Salary"
        subtitle="Basic pay, allowances and deductions — every change kept and approved"
        actions={meta.rights.loanView && (
          <Button variant="outline" size="sm" className="h-9 bg-background" asChild><Link href="/accounting/hr/loans"><HandCoins className="h-4 w-4 mr-1.5" />Advances &amp; loans</Link></Button>
        )}
      />
      <main className={MAIN}>
        <Tabs value={tab} onValueChange={setTab} className="space-y-4 sm:space-y-5">
          <UnderlineTabsList aria-label="Salary sections">
            <UnderlineTab value="salaries"><Users className="h-4 w-4" />Salaries</UnderlineTab>
            <UnderlineTab value="components"><Puzzle className="h-4 w-4" />Pay components</UnderlineTab>
          </UnderlineTabsList>
          <TabsContent value="salaries" className="mt-0"><SalariesTab meta={meta} /></TabsContent>
          <TabsContent value="components" className="mt-0"><ComponentsTab meta={meta} /></TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <SalaryPage />
    </Suspense>
  );
}
