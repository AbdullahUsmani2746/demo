"use client";

// /dashboard/my-hr — My HR: the signed-in employee's own attendance, leave,
// advances and payslips. Each tab needs its own-right (hr.attendance.own,
// hr.leave.apply, hr.loan.apply, hr.payslip.own — every role by default).
import { Suspense } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { CalendarCheck, FileText, HandCoins, Link2Off, Plane, ShieldAlert, UserRound } from "lucide-react";
import { Tabs, TabsContent } from "@/components/ui/tabs";
import { PageHeader, useHrMeta } from "@/components/HR/shared";
import { MAIN, PAGE, PageSkeleton, UnderlineTab, UnderlineTabsList } from "@/components/HR/payroll/ui";
import MyAttendance from "@/components/HR/self/MyAttendance";
import MyLeave from "@/components/HR/leave/MyLeave";
import LoansList from "@/components/HR/loans/LoansList";
import MyPayslips from "@/components/HR/payroll/MyPayslips";

function MyHrPage() {
  const router = useRouter();
  const pathname = usePathname();
  const sp = useSearchParams();
  const { data: meta, isLoading, error } = useHrMeta();

  if (isLoading) return <PageSkeleton />;
  if (error || !meta?.self) {
    return (
      <Notice icon={Link2Off} title="Your login is not linked to an employee.">
        Ask HR to set your login on your employee record (HR → Employees), or to use the same e-mail on both.
      </Notice>
    );
  }
  const r = meta.rights;
  const all = [
    r.attendanceOwn && { key: "attendance", label: "Attendance", icon: CalendarCheck, body: <MyAttendance today={meta.today} /> },
    (r.leaveApply || r.leaveManage) && { key: "leave", label: "Leave", icon: Plane, body: <MyLeave meta={meta} /> },
    (r.loanApply || r.loanManage) && { key: "loans", label: "Advances & loans", icon: HandCoins, body: <LoansList meta={meta} mine /> },
    r.payslipOwn && { key: "payslips", label: "Payslips", icon: FileText, body: <MyPayslips /> },
  ].filter(Boolean);
  if (!all.length) {
    return (
      <Notice icon={ShieldAlert} title="Nothing in My HR is open to you yet.">
        Ask an administrator for the own-HR rights on Admin → Permissions.
      </Notice>
    );
  }
  const tab = all.some((t) => t.key === sp.get("tab")) ? sp.get("tab") : all[0].key;
  const setTab = (t) => {
    const p = new URLSearchParams(sp);
    p.set("tab", t);
    router.replace(`${pathname}?${p}`, { scroll: false });
  };

  return (
    <div className={PAGE}>
      <PageHeader icon={UserRound} title="My HR" subtitle={`${meta.self.name} · #${meta.self.id}`} />
      <main className={MAIN}>
        <Tabs value={tab} onValueChange={setTab} className="space-y-4 sm:space-y-5">
          {all.length > 1 && (
            <UnderlineTabsList aria-label="My HR sections">
              {all.map((t) => (
                <UnderlineTab key={t.key} value={t.key}><t.icon className="h-4 w-4" />{t.label}</UnderlineTab>
              ))}
            </UnderlineTabsList>
          )}
          {all.map((t) => <TabsContent key={t.key} value={t.key} className="mt-0">{t.body}</TabsContent>)}
        </Tabs>
      </main>
    </div>
  );
}

// A full-page message when My HR cannot open.
function Notice({ icon: Icon, title, children }) {
  return (
    <div className={PAGE}>
      <div className={MAIN}>
        <div className="mx-auto mt-10 flex max-w-lg items-start gap-3 rounded-xl border border-[#5f4b1f]/25 bg-[#f5f0e6] px-5 py-4 text-[#5f4b1f]">
          <Icon className="mt-0.5 h-5 w-5 shrink-0" />
          <div>
            <p className="font-semibold">{title}</p>
            <p className="mt-1 text-sm">{children}</p>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function Page() {
  return (
    <Suspense fallback={null}>
      <MyHrPage />
    </Suspense>
  );
}
