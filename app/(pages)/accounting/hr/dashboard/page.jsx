"use client";

// HR → Dashboard: headcount, today's attendance, late marks, leave, loans,
// payroll trend and what is coming up — each block by the person's rights.
import Link from "next/link";
import { BarChart3, CalendarCheck, Inbox, LayoutDashboard, Plane, Wallet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HR_MAIN, HR_PAGE, NoAccess, PageHeader, PageLoading, useHrMeta } from "@/components/HR/shared";
import HrDashboard from "@/components/HR/dashboard/HrDashboard";

export default function Page() {
  const { data: meta, isLoading, error } = useHrMeta();
  if (isLoading) return <PageLoading label="Loading the HR dashboard…" />;
  const r = meta?.rights;
  const team = r && (r.view || r.leaveView || r.salaryView || r.loanView || r.payrollView);
  if (error || !team) return <NoAccess />;
  const links = [
    r.view && ["/accounting/hr/attendance", "Attendance", CalendarCheck],
    r.leaveView && ["/accounting/hr/leave", "Leave", Plane],
    r.payrollView && ["/accounting/hr/payroll", "Payroll", Wallet],
    ["/accounting/reports?category=hr", "Reports", BarChart3],
    ["/dashboard/approvals", "Approvals", Inbox],
  ].filter(Boolean);
  return (
    <div className={HR_PAGE}>
      <PageHeader
        icon={LayoutDashboard}
        title="HR Dashboard"
        subtitle="Your people today, this month and what is coming up"
        actions={links.map(([href, label, Icon]) => (
          <Button key={href} variant="outline" size="sm" className="h-9 bg-background" asChild>
            <Link href={href}><Icon className="mr-1.5 h-4 w-4" />{label}</Link>
          </Button>
        ))}
      />
      <main className={HR_MAIN}>
        <HrDashboard />
      </main>
    </div>
  );
}
