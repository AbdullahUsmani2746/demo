"use client";

// HR → Payroll: runs, income-tax slabs, payroll rules, my payslips.
import { Suspense } from "react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { Wallet, ListChecks, Receipt, SlidersHorizontal, FileText, Inbox, Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { NoAccess, PageHeader, useHrMeta } from "@/components/HR/shared";
import { MAIN, PAGE, PageSkeleton, UnderlineTab, UnderlineTabsList } from "@/components/HR/payroll/ui";
import RunsTab from "@/components/HR/payroll/RunsTab";
import { PayrollRulesTab, TaxTab } from "@/components/HR/payroll/TaxAndRules";
import MyPayslips from "@/components/HR/payroll/MyPayslips";

function PayrollPage() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { data: meta, isLoading, error } = useHrMeta();
  if (isLoading) return <PageSkeleton />;
  const r = meta?.rights;
  const team = Boolean(r?.payrollView);
  const mine = Boolean(meta?.self && r?.payslipOwn);
  if (error || !meta || (!team && !mine)) return <NoAccess />;
  const tabs = [team && "runs", team && "tax", team && "rules", mine && "mine"].filter(Boolean);
  const tab = tabs.includes(sp.get("tab")) ? sp.get("tab") : tabs[0];
  const setTab = (t) => {
    const p = new URLSearchParams(sp);
    p.set("tab", t);
    router.replace(`${pathname}?${p}`, { scroll: false });
  };
  return (
    <div className={PAGE}>
      <PageHeader
        icon={Wallet}
        title="Payroll"
        subtitle="Monthly salaries from attendance, leave, loans, EOBI and income tax — approved, then posted as a journal voucher"
        actions={team && (
          <>
            <Button variant="outline" size="sm" className="h-9 bg-background" asChild><Link href="/accounting/settings/accounts"><Settings className="h-4 w-4 mr-1.5" />Payroll accounts</Link></Button>
            <Button variant="outline" size="sm" className="h-9 bg-background" asChild><Link href="/dashboard/approvals"><Inbox className="h-4 w-4 mr-1.5" />Approvals</Link></Button>
          </>
        )}
      />
      <main className={MAIN}>
        <Tabs value={tab} onValueChange={setTab} className="space-y-5">
          {tabs.length > 1 && (
            <UnderlineTabsList aria-label="Payroll sections">
              {team && <UnderlineTab value="runs"><ListChecks className="h-4 w-4" />Payroll runs</UnderlineTab>}
              {team && <UnderlineTab value="tax"><Receipt className="h-4 w-4" />Income tax</UnderlineTab>}
              {team && <UnderlineTab value="rules"><SlidersHorizontal className="h-4 w-4" />Rules</UnderlineTab>}
              {mine && <UnderlineTab value="mine"><FileText className="h-4 w-4" />My payslips</UnderlineTab>}
            </UnderlineTabsList>
          )}
          {team && <TabsContent value="runs" className="mt-0"><RunsTab meta={meta} /></TabsContent>}
          {team && <TabsContent value="tax" className="mt-0"><TaxTab meta={meta} /></TabsContent>}
          {team && <TabsContent value="rules" className="mt-0"><PayrollRulesTab meta={meta} /></TabsContent>}
          {mine && <TabsContent value="mine" className="mt-0"><MyPayslips /></TabsContent>}
        </Tabs>
      </main>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <PayrollPage />
    </Suspense>
  );
}
