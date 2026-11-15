"use client";
// components/Audit/AuditHistoryButton.jsx — "History" button for any record
// screen: opens the Audit Trail on that document's whole history (the record
// and every child line pointing at it), e.g.
//   <AuditHistoryButton model="TransactionsMaster" id={tran_id} />
import Link from "next/link";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function AuditHistoryButton({ model, id, label = "History", size = "sm", variant = "outline", className, newTab = false }) {
  if (!model || id === undefined || id === null || id === "") return null;
  const href = `/dashboard/audit-trail?${new URLSearchParams({ doc_model: model, doc_id: String(id) }).toString()}`;
  return (
    <Button asChild variant={variant} size={size} className={cn("gap-1.5", className)}>
      <Link href={href} target={newTab ? "_blank" : undefined} rel={newTab ? "noopener" : undefined} aria-label={`Change history of ${model} ${id}`} title="Who changed this, and when">
        <History className="h-4 w-4" />
        {label && <span>{label}</span>}
      </Link>
    </Button>
  );
}
