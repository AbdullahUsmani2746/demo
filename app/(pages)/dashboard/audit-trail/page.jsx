"use client";

// /dashboard/audit-trail — who created, changed or deleted what, and when.
// Filters live in the URL (?from=&to=&module=&model=&action=&user=&source=&q=),
// as do the scopes ?doc_model=&doc_id= / ?record=&model= / ?batch=.
import { Suspense } from "react";
import { Loader2 } from "lucide-react";
import AuditTrail from "@/components/Audit/AuditTrail";

export default function AuditTrailPage() {
  return (
    <Suspense
      fallback={
        <div className="flex h-[60vh] items-center justify-center text-slate-500">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          Loading…
        </div>
      }
    >
      <AuditTrail />
    </Suspense>
  );
}
