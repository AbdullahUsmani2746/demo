"use client";
// components/Quality/qcUi.jsx — pieces shared by the Quality Assurance screens
// (Production QC, Order QC, QA Entry). Look and building blocks come from
// components/HR/shared.jsx (the standard page header, panels, chips, tables).
import { CheckCircle2, CircleDashed, XCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import { CHIP } from "@/components/HR/shared";
import { QC_STATUS } from "@/lib/quality/qc";
import generateQCCertificate from "@/utils/generateQCCertificate";
import generateNCRCertificate from "@/utils/generateNCRCertificate";

const DOT = { ok: "bg-[#2f5139]", warn: "bg-[#8a6a1f]", bad: "bg-red-600", muted: "bg-muted-foreground/60", brand: "bg-primary" };

/** QC status chip (Pending / On hold / Re-test / Passed / Failed, or "Awaiting QC" for null). */
export function QcStatusChip({ status, className }) {
  const m = status ? QC_STATUS[status] : { label: "Awaiting QC", tone: "brand" };
  const tone = m?.tone || "muted";
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold", CHIP[tone], className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", DOT[tone])} />
      {m?.label || status}
    </span>
  );
}

/** Pass / fail mark of one result. */
export function ResultMark({ check, className }) {
  if (check === "pass")
    return (
      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", CHIP.ok, className)}>
        <CheckCircle2 className="h-3.5 w-3.5" /> Pass
      </span>
    );
  if (check === "fail")
    return (
      <span className={cn("inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold", CHIP.bad, className)}>
        <XCircle className="h-3.5 w-3.5" /> Out of standard
      </span>
    );
  return (
    <span className={cn("inline-flex items-center gap-1 text-xs text-muted-foreground", className)}>
      <CircleDashed className="h-3.5 w-3.5" /> —
    </span>
  );
}

/** Input / row colouring for a result. */
export const resultTone = (check) =>
  check === "fail"
    ? "border-red-400 bg-red-50/70 text-red-900 focus-visible:ring-red-300 dark:bg-red-950/30 dark:text-red-200"
    : check === "pass"
      ? "border-[#9fb8a6] bg-[#edf2ee]/60 dark:bg-emerald-950/20"
      : "";

/** Filter tabs with counts (a row of pills that scrolls sideways on a phone). */
export function CountTabs({ tabs, value, onChange, counts = {} }) {
  return (
    <div className="-mx-3 overflow-x-auto px-3 sm:mx-0 sm:px-0" role="tablist" aria-label="Filter by status">
      <div className="flex w-max gap-1.5">
        {tabs.map((t) => {
          const active = value === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(t.key)}
              className={cn(
                "inline-flex h-9 items-center gap-2 rounded-full border px-3.5 text-[13px] font-semibold transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40",
                active ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-muted-foreground hover:border-primary/40 hover:text-foreground",
              )}
            >
              {t.label}
              <span className={cn("rounded-full px-1.5 text-[11px] tabular-nums", active ? "bg-white/20" : "bg-muted")}>{counts[t.key] ?? 0}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** Label + value cell of an info grid. */
export function Fact({ label, children, mono }) {
  return (
    <div className="min-w-0">
      <p className="text-[11px] font-bold uppercase tracking-wide text-muted-foreground">{label}</p>
      <div className={cn("mt-0.5 truncate text-sm font-medium text-foreground", mono && "font-mono tabular-nums")}>{children || <span className="text-muted-foreground">—</span>}</div>
    </div>
  );
}

export const fmtQty = (n) => (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 3 });
export const fmtDay = (d) =>
  d ? new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric", timeZone: "UTC" }) : "";

/**
 * Print the certificate of a production QC sheet (GET /api/forms/qualitycontrol/[id]):
 * a Quality Assurance Certificate, or a Non-Conformity report when it failed.
 */
export async function printProductionQc(sheet, { company, userName } = {}) {
  const m = sheet.master;
  const last = [...(sheet.attempts || [])].reverse().find((a) => a.saved) || sheet.attempts?.[0] || { rows: [] };
  const testResults = (last.rows || []).map((r) => ({ parameter: r.parameter_name, standard: r.quality_standard, result: r.quality_realized || "-" }));
  const inkCode = `${m.item_code || ""} ${m.item_name || ""}`.trim();
  const common = {
    companyName: company?.name || "Company",
    logoUrl: company?.logo || "",
    batchNumber: m.batch_no || "",
    inkCode,
    manufacturingDate: m.mfg_date,
    batchSize: m.batch_size,
    departmentName: "Quality Control",
    testResults,
    mode: "print",
  };
  if (m.status === "REJECTED") {
    const reason = [...(sheet.attempts || [])].reverse().find((a) => a.reject_reason)?.reject_reason || "Quality parameters not met";
    return generateNCRCertificate({
      ...common,
      ncrTitle: "NON CONFORMITY REPORT",
      rejectReason: reason,
      rootCause: "", correction: "", correctiveAction: "", actionForImplementation: "", preventiveActionRequired: "NO",
      responsibility: "", targetDate: "", verifiedEffectiveness: "", capaEffective: "No", plantHeadSignature: "", closingDate: "",
    });
  }
  return generateQCCertificate({
    ...common,
    title: "QUALITY ASSURANCE CERTIFICATE",
    expiryDate: m.expiry_date,
    customer: m.customer_name || "-",
    status: m.status,
    approvedBy: m.approved_by || userName || "",
    comments: m.remarks || "",
  });
}
