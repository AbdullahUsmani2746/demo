"use client";

// Setup screens: the generic DynamicEntity for every entity, except Employees,
// which has its own screen (profile sheet, HR details).
//
// NOTICES: an entity that now has a better screen keeps its generic page
// (menus may still point at it, and the menu-based page check needs that URL)
// but shows a banner linking to the new one.
import Link from "next/link";
import { useParams } from "next/navigation";
import { ArrowUpRight, Info } from "lucide-react";
import DynamicEntity from "@/components/Setups/DynamicEntity";
import EmployeeSetup from "@/components/Employees/EmployeeSetup";

const NOTICES = {
  employee_menus: {
    href: "/accounting/employee-menus",
    title: "There is a better screen for this",
    text: "Employee menus shows each employee's menus as one tree with tick boxes — or, the other way round, who has a menu.",
    action: "Open Employee menus",
  },
};

function Notice({ notice }) {
  return (
    <div className="mx-3 mt-4 flex flex-col gap-3 rounded-xl border border-primary/20 bg-primary/5 p-4 sm:mx-6 sm:flex-row sm:items-center">
      <Info className="hidden h-5 w-5 flex-shrink-0 text-primary sm:block" />
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-primary">{notice.title}</p>
        <p className="text-[13px] text-muted-foreground">{notice.text}</p>
      </div>
      <Link
        href={notice.href}
        className="inline-flex h-9 flex-shrink-0 items-center justify-center gap-1.5 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground hover:bg-primary/90"
      >
        {notice.action}
        <ArrowUpRight className="h-4 w-4" />
      </Link>
    </div>
  );
}

export default function Page() {
  const { entity } = useParams();
  if (entity === "employees") return <EmployeeSetup />;
  const notice = NOTICES[entity];
  return (
    <div>
      {notice && <Notice notice={notice} />}
      <DynamicEntity />
    </div>
  );
}
