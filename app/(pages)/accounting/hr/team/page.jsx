"use client";

// HR → Team structure: who reports to whom (components/HR/team/TeamStructure.jsx).
import Link from "next/link";
import { GitBranch, ShieldCheck } from "lucide-react";
import { Button } from "@/components/ui/button";
import { HR_MAIN, HR_PAGE, NoAccess, PageHeader, PageLoading, useHrMeta } from "@/components/HR/shared";
import TeamStructure from "@/components/HR/team/TeamStructure";

export default function Page() {
  const { data: meta, isLoading, error } = useHrMeta();
  if (isLoading) return <PageLoading label="Loading the team structure…" />;
  if (error || !meta) return <NoAccess />;

  return (
    <div className={HR_PAGE}>
      <PageHeader
        icon={GitBranch}
        title="Team Structure"
        subtitle="Who reports to whom — a team leader sees and approves for their own team"
        actions={
          meta.isAdmin ? (
            <Button variant="outline" size="sm" className="h-9 bg-background" asChild>
              <Link href="/admin/permissions"><ShieldCheck className="mr-1.5 h-4 w-4" />Permissions</Link>
            </Button>
          ) : null
        }
      />
      <main className={HR_MAIN}>
        <TeamStructure meta={meta} />
      </main>
    </div>
  );
}
