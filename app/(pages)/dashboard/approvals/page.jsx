"use client";
// /dashboard/approvals — every approval in one inbox:
//   · documents held by approval rules (vouchers / orders — Permissions → Approvals)
//   · Sale Orders waiting for approval (Free of Cost, Trial, Rate under
//     negotiation, No Godown, bad-debt customer …) — id "so-<order_no>",
//     decided by /api/orders/saleOrder/approval through the same endpoint
//   · HR requests (attendance, leave, salary, loans, payroll)
// Boxes: Waiting for me (approvers) · My requests · Decided (history).
// Filter by type (?type=voucher|saleOrder|hr|hrLeave …) and search; ?id= opens one.
// Wide screens (xl): list left, detail right, each scrolling on its own.
// Laptops / tablets: the detail slides in from the right over the list.
// Phones: the detail opens full screen with a back arrow.
// Bulk: on "Waiting for me", tick several and Approve / Reject them together.
// Each is sent on its own to POST /api/approvals/requests/[id] (the same checks
// as one at a time); a reject needs one reason, used for all.
// Keys: J/K or ↑/↓ move, Enter opens, Esc closes, R refreshes, / searches.
import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import Link from "next/link";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import {
  Inbox, Send, History, Search, X, Loader2, CheckCircle2, XCircle, Pencil, Ban, FileText, ShieldCheck, Clock,
  AlertTriangle, ListChecks, ArrowLeft, RefreshCw, ShoppingCart, Users, CalendarCheck, Plane, Wallet, HandCoins,
  Receipt, MessageSquareQuote, GitCompareArrows, ArrowRight, ExternalLink, MousePointerClick, ArrowLeftRight,
  GitBranch, Download, Eye, Circle,
} from "lucide-react";
import { useCompany } from "@/context/CompanyContext";
import { downloadApprovedForm } from "@/components/HR/approvedFormPdf";
import { cn } from "@/lib/utils";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, BRAND_BTN, EmptyState, PageHeader } from "@/components/HR/shared";
import useKeyboardShortcuts from "@/hooks/useKeyboardShortcuts";
import { HR_APPROVAL_TYPES } from "@/lib/hr/approvalTypes";

// ── Look-ups ───────────────────────────────────────────────────────────────

const BOXES = [
  { key: "inbox", label: "Waiting for me", short: "Waiting", Icon: Inbox, approverOnly: true },
  { key: "mine", label: "My requests", short: "Mine", Icon: Send },
  { key: "history", label: "Decided", short: "Decided", Icon: History, approverOnly: true },
];

const STATUS = {
  pending: { label: "Pending", chip: "bg-amber-50 text-amber-700 ring-amber-600/20", dot: "bg-amber-500" },
  posting: { label: "Posting…", chip: "bg-sky-50 text-sky-700 ring-sky-600/20", dot: "bg-sky-500" },
  approved: { label: "Approved", chip: "bg-emerald-50 text-emerald-700 ring-emerald-600/20", dot: "bg-emerald-500" },
  rejected: { label: "Rejected", chip: "bg-red-50 text-red-700 ring-red-600/20", dot: "bg-red-500" },
  cancelled: { label: "Cancelled", chip: "bg-slate-100 text-slate-600 ring-slate-500/20", dot: "bg-slate-400" },
};

const HR_ICONS = { hrAttendance: CalendarCheck, hrOffSwap: ArrowLeftRight, hrLeave: Plane, hrSalary: Wallet, hrLoan: HandCoins, hrPayroll: Users };

// The filter a row belongs to: "voucher" (held documents), "saleOrder", or the HR type.
const typeOf = (r) => (r.kind === "saleOrder" ? "saleOrder" : r.kind === "hr" ? r.doc_type : "voucher");
const TYPES = [
  { key: "all", label: "All" },
  { key: "voucher", label: "Vouchers", Icon: Receipt },
  { key: "saleOrder", label: "Sale Orders", Icon: ShoppingCart },
  ...Object.entries(HR_APPROVAL_TYPES).map(([key, t]) => ({ key, label: t.label, Icon: HR_ICONS[key] ?? Users, hr: true })),
];
const matchesType = (r, type) => type === "all" || (type === "hr" ? r.kind === "hr" : typeOf(r) === type);
const iconOf = (r) => (r.kind === "saleOrder" ? ShoppingCart : r.kind === "hr" ? HR_ICONS[r.doc_type] ?? Users : FileText);
const requestNo = (r) => (r.kind === "saleOrder" ? `SO ${r.target_no}` : `#R-${r.id}`);

const when = (d) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
function ago(d) {
  if (!d) return "";
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return "just now";
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  if (s < 86400 * 30) return `${Math.floor(s / 86400)}d ago`;
  return new Date(d).toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
}
const errText = (e) => e?.data?.error || e?.data?.message || e?.message || "Something went wrong";

// Header labels that carry the requester's own words.
const NOTE_LABEL = /reason|remark|narration|instruction|note|purpose/i;

// ── Small pieces ───────────────────────────────────────────────────────────

function StatusChip({ status, className }) {
  const s = STATUS[status] || STATUS.pending;
  return (
    <span className={cn("inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ring-1 ring-inset", s.chip, className)}>
      <span className={cn("h-1.5 w-1.5 rounded-full", s.dot)} />
      {s.label}
    </span>
  );
}

function ReasonChips({ reasons }) {
  if (!reasons?.length) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {reasons.map((r) => (
        <span key={r} className="inline-flex items-center gap-1 rounded-md bg-[#800000]/[0.07] px-2 py-0.5 text-xs font-semibold text-[#800000] ring-1 ring-inset ring-[#800000]/20">
          <ShieldCheck className="h-3 w-3" />
          {r}
        </span>
      ))}
    </div>
  );
}

function SectionTitle({ icon: Icon, children, aside }) {
  return (
    <div className="mb-2 flex items-center justify-between gap-2">
      <h3 className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-slate-500">
        {Icon && <Icon className="h-3.5 w-3.5" />}
        {children}
      </h3>
      {aside}
    </div>
  );
}

// The decision, front and centre: who, when, and their remarks.
function DecisionBanner({ request }) {
  const { status } = request;
  if (status === "pending") return null;
  if (status === "posting") {
    return (
      <div className="flex items-start gap-3 rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-800">
        <Loader2 className="mt-0.5 h-5 w-5 shrink-0 animate-spin" /> An approver is posting this request right now.
      </div>
    );
  }
  const tone =
    status === "approved"
      ? { box: "border-emerald-200 bg-emerald-50", text: "text-emerald-800", Icon: CheckCircle2, icon: "text-emerald-600", quote: "border-emerald-300" }
      : status === "rejected"
        ? { box: "border-red-200 bg-red-50", text: "text-red-800", Icon: XCircle, icon: "text-red-600", quote: "border-red-300" }
        : { box: "border-slate-200 bg-slate-50", text: "text-slate-700", Icon: Ban, icon: "text-slate-500", quote: "border-slate-300" };
  return (
    <div className={cn("rounded-xl border p-4", tone.box)} role="status">
      <div className={cn("flex items-start gap-3", tone.text)}>
        <tone.Icon className={cn("mt-0.5 h-6 w-6 shrink-0", tone.icon)} />
        <div className="min-w-0 flex-1">
          <p className="text-base font-bold">
            {STATUS[status]?.label}
            {request.decided_by ? ` by ${request.decided_by}` : ""}
          </p>
          <p className="text-xs opacity-80">
            {when(request.decided_at)}
            {request.posted_no ? ` · posted as #${request.posted_no}` : ""}
          </p>
          {request.remarks ? (
            <blockquote className={cn("mt-3 whitespace-pre-wrap border-l-4 bg-white/70 py-2 pl-3 pr-2 text-sm font-medium text-slate-800", tone.quote)}>
              {request.remarks}
            </blockquote>
          ) : (
            <p className="mt-2 text-xs italic opacity-70">No remarks were written.</p>
          )}
        </div>
      </div>
    </div>
  );
}

// Field: before → after. A table on wide screens, stacked rows on phones.
function ChangesTable({ changes, lineChanges }) {
  const rows = [
    ...(changes || []).map((c) => ({ key: `h-${c.label}`, what: c.label, from: c.from, to: c.to })),
    ...(lineChanges || []).flatMap((l) =>
      l.fields.map((f) => ({ key: `l-${l.item}-${f.label}`, what: l.item, sub: f.label, change: l.change, from: f.from, to: f.to })),
    ),
  ];
  if (!rows.length) return null;
  const tag = { added: "bg-emerald-100 text-emerald-800", removed: "bg-red-100 text-red-800", changed: "bg-amber-100 text-amber-800" };
  return (
    <div className="overflow-hidden rounded-xl border border-slate-200">
      <div className="hidden grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto_minmax(0,1fr)] gap-x-3 bg-slate-50 px-4 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-500 sm:grid">
        <span>Field</span>
        <span>Before</span>
        <span />
        <span>After</span>
      </div>
      <ul className="divide-y divide-slate-100">
        {rows.map((r) => (
          <li key={r.key} className="grid gap-x-3 gap-y-1 px-4 py-2.5 text-sm sm:grid-cols-[minmax(0,1.3fr)_minmax(0,1fr)_auto_minmax(0,1fr)] sm:items-center">
            <div className="min-w-0">
              <span className="font-medium text-slate-800">{r.what}</span>
              {r.sub && <span className="text-slate-500"> · {r.sub}</span>}
              {r.change && <span className={cn("ml-1.5 rounded px-1.5 py-px text-[10px] font-bold uppercase", tag[r.change])}>{r.change}</span>}
            </div>
            <div className="flex min-w-0 items-center gap-2 sm:contents">
              <span className="min-w-0 break-words rounded bg-red-50 px-1.5 py-0.5 text-red-700 line-through decoration-red-300">{r.from}</span>
              <ArrowRight className="h-3.5 w-3.5 shrink-0 text-slate-400" aria-label="becomes" />
              <span className="min-w-0 break-words rounded bg-emerald-50 px-1.5 py-0.5 font-semibold text-emerald-800">{r.to}</span>
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// Lines: a table from md up, one card per line below.
function LinesTable({ lines }) {
  const { columns = [], rows = [], totals, numeric } = lines || {};
  if (!rows.length) return null;
  const isNum = (j) => (numeric ? numeric[j] : rows.every((r) => /^[-\d.,\s]+$/.test(String(r[j] ?? "")) || r[j] === "—"));
  return (
    <>
      <div className="hidden overflow-x-auto rounded-xl border border-slate-200 md:block">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 text-[11px] font-semibold uppercase tracking-wide text-slate-500">
            <tr>
              {columns.map((c, j) => (
                <th key={`${c}-${j}`} scope="col" className={cn("whitespace-nowrap px-3 py-2", isNum(j) ? "text-right" : "text-left")}>{c}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {rows.map((row, i) => (
              <tr key={i} className="hover:bg-slate-50/70">
                {row.map((v, j) => (
                  <td key={j} className={cn("px-3 py-2", isNum(j) ? "whitespace-nowrap text-right tabular-nums" : "min-w-[8rem]", j === 0 && "font-medium text-slate-800")}>{v}</td>
                ))}
              </tr>
            ))}
          </tbody>
          {totals && (
            <tfoot className="border-t-2 border-slate-200 bg-slate-50 font-semibold">
              <tr>
                {totals.map((v, j) => (
                  <td key={j} className={cn("px-3 py-2", isNum(j) ? "text-right tabular-nums" : "")}>{v}</td>
                ))}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
      <ul className="space-y-2 md:hidden">
        {rows.map((row, i) => (
          <li key={i} className="rounded-xl border border-slate-200 p-3">
            <p className="font-semibold text-slate-800">{row[0]}</p>
            <dl className="mt-1.5 grid grid-cols-2 gap-x-3 gap-y-1 text-xs">
              {row.slice(1).map((v, j) =>
                v === "—" || v === "" ? null : (
                  <div key={j} className="flex justify-between gap-2">
                    <dt className="text-slate-500">{columns[j + 1]}</dt>
                    <dd className="text-right font-medium tabular-nums text-slate-800">{v}</dd>
                  </div>
                ),
              )}
            </dl>
          </li>
        ))}
        {totals && (
          <li className="flex flex-wrap justify-between gap-2 rounded-xl bg-slate-100 px-3 py-2 text-sm font-semibold">
            {totals.map((v, j) => (v ? <span key={j}>{j === 0 ? v : `${columns[j]}: ${v}`}</span> : null))}
          </li>
        )}
      </ul>
    </>
  );
}

// ── Detail ─────────────────────────────────────────────────────────────────

function DetailSkeleton() {
  return (
    <div className="space-y-4 p-5" aria-busy="true" aria-label="Loading request">
      <Skeleton className="h-7 w-2/3" />
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-20 w-full rounded-xl" />
      <div className="grid gap-3 sm:grid-cols-2">
        {Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-10" />)}
      </div>
      <Skeleton className="h-40 w-full rounded-xl" />
    </div>
  );
}

// An HR request in an approval chain (lib/hr/chains.js): every step, who acts
// on it, what each one did — the status the owner follows.
const STEP_STATE = {
  done: { Icon: CheckCircle2, ring: "border-emerald-200 bg-emerald-50", icon: "text-emerald-600", text: "Done" },
  current: { Icon: Clock, ring: "border-amber-300 bg-amber-50", icon: "text-amber-600", text: "Now" },
  rejected: { Icon: XCircle, ring: "border-red-200 bg-red-50", icon: "text-red-600", text: "Rejected" },
  cancelled: { Icon: Ban, ring: "border-slate-200 bg-slate-50", icon: "text-slate-500", text: "Cancelled" },
  waiting: { Icon: Circle, ring: "border-slate-200 bg-white", icon: "text-slate-300", text: "Waiting" },
};
const ACTED = { approved: "Approved", rejected: "Rejected", paid: "Paid" };

function ChainProgress({ chain }) {
  return (
    <section>
      <SectionTitle icon={GitBranch}>Approval chain · {chain.name}</SectionTitle>
      <ol className="space-y-2">
        {chain.steps.map((s, i) => {
          const st = STEP_STATE[s.state] ?? STEP_STATE.waiting;
          return (
            <li key={i} className={cn("rounded-xl border px-3 py-2.5", st.ring)}>
              <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                <st.Icon className={cn("h-4 w-4 shrink-0", st.icon)} />
                <span className="text-sm font-semibold text-slate-900">
                  {i + 1}. {s.label}
                </span>
                {s.type === "pay" && <Wallet className="h-3.5 w-3.5 text-emerald-700" />}
                {s.final && <span className="rounded bg-emerald-100 px-1.5 text-[10px] font-semibold text-emerald-800">final</span>}
                <span className="ml-auto text-[11px] font-medium text-slate-500">{st.text}</span>
              </div>
              <p className="mt-0.5 break-words pl-6 text-[11px] text-slate-600">
                {s.state === "current" && s.now?.length ? `With ${s.now.join(" or ")}` : s.who.map((w) => (w.startsWith("role:") ? `everyone in ${w.slice(5)}` : w)).join(" / ")}
              </p>
              {s.acted?.map((a, j) => (
                <p key={j} className="mt-1 break-words pl-6 text-[11px] text-slate-700">
                  <span className="font-semibold">{ACTED[a.action] ?? a.action}</span> by {a.by} · {when(a.at)}
                  {a.forwarded_to?.length ? ` · forwarded to ${a.forwarded_to.join(", ")}` : ""}
                  {a.note ? <span className="text-slate-500"> — “{a.note}”</span> : null}
                </p>
              ))}
            </li>
          );
        })}
      </ol>
    </section>
  );
}

function Detail({ id, onClose, onChanged }) {
  const router = useRouter();
  const queryClient = useQueryClient();
  const [remarks, setRemarks] = useState("");
  const [nextUsers, setNextUsers] = useState([]);
  const [busy, setBusy] = useState(null);
  const remarksRef = useRef(null);
  const { company } = useCompany();
  const { data: d, error, isLoading } = useQuery({
    queryKey: ["approval", String(id)],
    queryFn: () => api(`/api/approvals/requests/${id}`),
    retry: false,
  });

  const isSo = d?.request?.kind === "saleOrder";
  const isHr = d && HR_APPROVAL_TYPES[d.request.doc_type];

  async function act(action) {
    if (busy) return;
    if (action === "reject" && !remarks.trim()) {
      toast.error("Write the reason for rejecting — the requester will see it.");
      remarksRef.current?.focus();
      return;
    }
    if (action === "cancel" && !confirm("Cancel this request? Nothing will be posted.")) return;
    setBusy(action);
    try {
      const res = await api(`/api/approvals/requests/${id}`, { method: "POST", body: { action, remarks, next_users: nextUsers } });
      toast.success(res.message || "Done");
      setRemarks("");
      setNextUsers([]);
      // Stay on it: the decision (who, when, remarks) now shows at the top.
      await queryClient.invalidateQueries({ queryKey: ["approval", String(id)] });
      onChanged();
    } catch (e) {
      toast.error(errText(e), { duration: 9000 });
    } finally {
      setBusy(null);
    }
  }

  function edit() {
    if (!d?.ui_state || !d.form_path) return toast.error("This request cannot be re-opened in the form — cancel it and enter it again.");
    try {
      localStorage.setItem(`voucherForm_${d.request.doc_type}`, JSON.stringify({ formType: d.request.doc_type, ...d.ui_state, savedAt: Date.now() }));
    } catch {
      return toast.error("Could not prepare the form (browser storage blocked).");
    }
    router.push(`${d.form_path}?approvalRequest=${id}`);
  }

  useKeyboardShortcuts(
    {
      "ctrl+enter": { handler: () => d?.canDecide && d.canApprove !== false && act("approve"), allowInInput: true },
    },
    Boolean(d?.canDecide),
  );

  const title = d
    ? d.request.title ??
      (d.request.action === "update" && d.request.target_no ? `Edit of ${d.request.form} #${d.request.target_no}` : d.request.form)
    : "Request";
  const note =
    d?.request?.note ??
    d?.header?.find((h) => NOTE_LABEL.test(h.label) && h.value && h.value !== "—")?.value ??
    null;
  const noteLabel = d?.request?.note_label ?? d?.header?.find((h) => NOTE_LABEL.test(h.label))?.label ?? "Note";
  const reasons = d?.reasons ?? (d?.request?.rule_name ? [d.request.rule_name] : []);
  const hasChanges = (d?.changes?.length ?? 0) + (d?.line_changes?.length ?? 0) > 0;
  const approveLabel = d?.approve_label ? d.approve_label : isSo || isHr ? "Approve" : d?.request?.action === "update" ? "Approve edit" : "Approve & post";
  const RowIcon = d ? iconOf(d.request) : FileText;

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex shrink-0 items-start gap-3 border-b border-slate-200 bg-white px-4 py-3 sm:px-5 sm:py-4">
        <button
          type="button"
          onClick={onClose}
          className="-ml-1 rounded-lg p-2 text-slate-600 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#800000]/40 sm:hidden"
          aria-label="Back to the list"
        >
          <ArrowLeft className="h-5 w-5" />
        </button>
        <div className="hidden h-10 w-10 shrink-0 place-items-center rounded-xl bg-[#800000]/10 text-[#800000] sm:grid">
          <RowIcon className="h-5 w-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h2 id="approval-detail-title" className="min-w-0 break-words text-base font-bold text-slate-900 sm:text-lg">{title}</h2>
            {d && <StatusChip status={d.request.status} />}
          </div>
          {d && (
            <p className="mt-0.5 text-xs text-slate-500 sm:text-sm">
              {d.request.kind === "saleOrder" ? "Entered" : "Asked"} by <span className="font-medium text-slate-700">{d.request.requested_by}</span> · {when(d.request.requested_at)}
              {d.request.kind !== "saleOrder" && <span className="font-mono text-slate-400"> · #R-{d.request.id}</span>}
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          className="hidden shrink-0 rounded-lg border border-slate-200 p-2 text-slate-500 hover:bg-slate-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#800000]/40 sm:block"
          aria-label="Close (Esc)"
        >
          <X className="h-4 w-4" />
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {error ? (
          <div className="m-5 flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
            <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> {errText(error)}
          </div>
        ) : isLoading || !d ? (
          <DetailSkeleton />
        ) : (
          <div className="space-y-5 p-4 sm:p-5">
            <DecisionBanner request={d.request} />

            {/* Why it is here */}
            <div className="rounded-xl border border-[#800000]/15 bg-[#800000]/[0.03] p-4">
              <div className="flex items-start gap-3">
                <ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-[#800000]" />
                <div className="min-w-0 space-y-1.5 text-sm">
                  {isSo ? <ReasonChips reasons={reasons} /> : <p className="font-semibold text-slate-900">{d.request.rule_name}</p>}
                  {d.request.rule_condition && !isSo && <p className="text-xs text-slate-600">Held because: {d.request.rule_condition}</p>}
                  {d.reason_figures?.length > 0 && (
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-1.5 py-1 sm:grid-cols-4">
                      {d.reason_figures.map((f) => (
                        <div key={f.label} className="min-w-0">
                          <dt className="text-[11px] uppercase tracking-wide text-slate-500">{f.label}</dt>
                          <dd className={`font-semibold tabular-nums ${f.tone === "bad" ? "text-red-700" : "text-slate-900"}`}>{f.value}</dd>
                        </div>
                      ))}
                    </dl>
                  )}
                  <p className="text-xs text-slate-500">
                    {d.request.held_note ??
                      (isHr
                        ? "Nothing changes until it is approved."
                        : d.request.action === "update"
                          ? "The saved document stays exactly as it is until this edit is approved."
                          : "Nothing is posted to stock or the ledger until it is approved.")}
                  </p>
                </div>
              </div>
            </div>

            {d.chain && <ChainProgress chain={d.chain} />}

            {d.chain?.pay_step && (
              <div className="flex flex-wrap items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900">
                <Wallet className="mt-0.5 h-4 w-4 shrink-0" />
                <span className="min-w-0 flex-1">Approved — waiting for payment. It is paid on the Advances &amp; Loans screen (a payment voucher); this step then closes by itself.</span>
                <Link href="/accounting/hr/loans" className="font-semibold text-emerald-800 underline">Open Advances &amp; Loans</Link>
              </div>
            )}

            {d.chain && (d.request.status === "approved" || d.chain.current > d.chain.final) && (
              <button
                type="button"
                onClick={() => downloadApprovedForm({ company, d }).catch((e) => toast.error(e.message))}
                className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-[#800000]/30 bg-white px-4 text-sm font-semibold text-[#800000] hover:bg-[#800000]/5"
              >
                <Download className="h-4 w-4" /> Approved form (PDF)
              </button>
            )}

            {d.request.post_error && (
              <div className="flex items-start gap-2 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> Last attempt to post failed: {d.request.post_error}
              </div>
            )}

            {note && (
              <section>
                <SectionTitle icon={MessageSquareQuote}>{noteLabel}</SectionTitle>
                <blockquote className="whitespace-pre-wrap rounded-xl border-l-4 border-[#800000]/40 bg-slate-50 px-4 py-3 text-sm text-slate-800">{note}</blockquote>
              </section>
            )}

            {(d.request.action === "update" || hasChanges) && (
              <section>
                <SectionTitle
                  icon={GitCompareArrows}
                  aside={d.edit ? <span className="text-[11px] text-slate-500">Edited {d.edit.by ? `by ${d.edit.by} ` : ""}· {when(d.edit.at)}</span> : null}
                >
                  What changed
                </SectionTitle>
                {hasChanges ? (
                  <ChangesTable changes={d.changes} lineChanges={d.line_changes} />
                ) : (
                  <p className="rounded-xl border border-dashed border-slate-200 px-4 py-3 text-sm text-slate-500">
                    No header or item changes found — the details below are what will be saved.
                  </p>
                )}
              </section>
            )}

            {d.header?.length > 0 && (
              <section>
                <SectionTitle icon={FileText}>{d.request.action === "update" && !isSo ? "Document after approval" : "Details"}</SectionTitle>
                <dl className="grid gap-x-6 gap-y-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-2">
                  {d.header.map((h) => (
                    <div key={h.label} className="min-w-0">
                      <dt className="text-[11px] font-medium uppercase tracking-wide text-slate-500">{h.label}</dt>
                      <dd className="break-words text-sm font-semibold text-slate-900">{h.value}</dd>
                    </div>
                  ))}
                </dl>
              </section>
            )}

            {d.lines?.rows?.length > 0 && (
              <section>
                <SectionTitle icon={ListChecks}>Lines ({d.lines.rows.length})</SectionTitle>
                <LinesTable lines={d.lines} />
              </section>
            )}

            {d.form_path && (
              <Link href={d.form_path} className="inline-flex items-center gap-1.5 text-sm font-medium text-[#800000] hover:underline">
                <ExternalLink className="h-4 w-4" /> Open {isSo ? "Sale Orders" : "the form"}
              </Link>
            )}
          </div>
        )}
      </div>

      {d && (d.canDecide || d.canEdit || d.decide_hint) && (
        <footer className="shrink-0 space-y-3 border-t border-slate-200 bg-slate-50 px-4 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:px-5 sm:py-4">
          {d.decide_hint && (
            <p className="flex items-start gap-1.5 text-xs text-amber-800">
              <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {d.decide_hint}
            </p>
          )}
          {d.canDecide && d.chain?.pick_next && (
            <fieldset>
              <legend className="mb-1 text-xs font-semibold text-slate-600">
                Forward to — who takes the next step ({d.chain.pick_next.label})
              </legend>
              <div className="flex flex-wrap gap-1.5">
                {d.chain.pick_next.options.map((o) => {
                  const on = nextUsers.includes(o.id);
                  return (
                    <button
                      key={o.id}
                      type="button"
                      aria-pressed={on}
                      onClick={() => setNextUsers(on ? nextUsers.filter((x) => x !== o.id) : [...nextUsers, o.id])}
                      className={cn(
                        "rounded-full border px-3 py-1.5 text-xs font-semibold",
                        on ? "border-[#800000] bg-[#800000] text-white" : "border-slate-300 bg-white text-slate-700 hover:border-[#800000]/50",
                      )}
                    >
                      {o.name}
                    </button>
                  );
                })}
              </div>
              {d.chain.pick_next.options.length > 1 && nextUsers.length === 0 && (
                <p className="mt-1 text-[11px] text-amber-700">Pick at least one before approving.</p>
              )}
            </fieldset>
          )}
          {d.canDecide && (
            <div>
              <label htmlFor="approval-remarks" className="mb-1 block text-xs font-semibold text-slate-600">
                Your remarks <span className="font-normal text-slate-400">— required to reject; the requester sees them</span>
              </label>
              <textarea
                id="approval-remarks"
                ref={remarksRef}
                value={remarks}
                onChange={(e) => setRemarks(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder={isSo ? "e.g. Approved for this customer only / Rate too low — revise" : "e.g. Checked with the manager"}
                className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm shadow-sm outline-none focus:border-[#800000]/50 focus:ring-2 focus:ring-[#800000]/20"
              />
              <p className="mt-0.5 text-right text-[10px] text-slate-400">{remarks.length}/500 · Ctrl+Enter approves</p>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-center">
            {d.canDecide && (
              <>
                <button
                  type="button"
                  onClick={() => act("approve")}
                  disabled={Boolean(busy) || d.canApprove === false}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-5 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50 disabled:opacity-50"
                >
                  {busy === "approve" ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} {approveLabel}
                </button>
                <button
                  type="button"
                  onClick={() => act("reject")}
                  disabled={Boolean(busy)}
                  aria-describedby="approval-remarks"
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-red-300 bg-white px-5 text-sm font-semibold text-red-700 hover:bg-red-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-red-500/40 disabled:opacity-50"
                >
                  {busy === "reject" ? <Loader2 className="h-4 w-4 animate-spin" /> : <XCircle className="h-4 w-4" />} Reject
                </button>
              </>
            )}
            {d.canEdit && (
              <>
                {d.canReopen ? (
                  <button type="button" onClick={edit} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold hover:bg-slate-100">
                    <Pencil className="h-4 w-4" /> Edit in form
                  </button>
                ) : (
                  <span className="w-full text-xs text-slate-500 sm:w-auto">{d.edit_hint ?? "To change this edit, edit the document again — it replaces this request."}</span>
                )}
                <button
                  type="button"
                  onClick={() => act("cancel")}
                  disabled={Boolean(busy)}
                  className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-600 hover:bg-slate-100 disabled:opacity-50"
                >
                  {busy === "cancel" ? <Loader2 className="h-4 w-4 animate-spin" /> : <Ban className="h-4 w-4" />} Cancel request
                </button>
              </>
            )}
          </div>
        </footer>
      )}
      {d && !d.canDecide && !d.canEdit && !d.decide_hint && d.edit_hint && d.request.mine && (
        <footer className="border-t border-slate-200 bg-slate-50/80 px-4 py-3 text-xs text-slate-500 sm:px-5">{d.edit_hint}</footer>
      )}
    </div>
  );
}

// ── Bulk ───────────────────────────────────────────────────────────────────

// Reject several at once: one reason, shown to every requester.
function BulkRejectDialog({ open, count, onCancel, onConfirm }) {
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (open) setReason("");
  }, [open]);
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onCancel()}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>Reject {count} request{count === 1 ? "" : "s"}</DialogTitle>
          <DialogDescription>Nothing is posted. This reason goes to every requester.</DialogDescription>
        </DialogHeader>
        <label htmlFor="bulk-reason" className="sr-only">Reason for rejecting</label>
        <textarea
          id="bulk-reason"
          autoFocus
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          rows={3}
          maxLength={500}
          placeholder="Reason for rejecting (required)"
          className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-[#800000]/50 focus:ring-2 focus:ring-[#800000]/20"
        />
        <DialogFooter className="gap-2">
          <button type="button" onClick={onCancel} className="inline-flex h-10 items-center justify-center rounded-lg border border-slate-200 px-4 text-sm font-semibold hover:bg-slate-100">Back</button>
          <button
            type="button"
            onClick={() => onConfirm(reason.trim())}
            disabled={!reason.trim()}
            className="inline-flex h-10 items-center justify-center gap-1.5 rounded-lg bg-red-600 px-4 text-sm font-semibold text-white hover:bg-red-700 disabled:opacity-40"
          >
            <XCircle className="h-4 w-4" /> Reject {count}
          </button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// What happened to each request of a bulk action.
function BulkResults({ results, running, onClose }) {
  const ok = results.filter((r) => r.ok).length;
  const failed = results.filter((r) => r.ok === false).length;
  return (
    <div className="rounded-xl border border-slate-200 bg-white shadow-sm" role="status" aria-live="polite">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-2.5">
        <div className="flex items-center gap-2 text-sm font-semibold">
          {running ? <Loader2 className="h-4 w-4 animate-spin" /> : <ListChecks className="h-4 w-4 text-[#800000]" />}
          {running ? `Working… ${ok + failed} of ${results.length}` : `Done — ${ok} succeeded, ${failed} failed`}
        </div>
        {!running && (
          <button type="button" onClick={onClose} className="rounded-lg p-1.5 hover:bg-slate-100" aria-label="Close results"><X className="h-4 w-4" /></button>
        )}
      </div>
      <ul className="max-h-56 divide-y divide-slate-100 overflow-y-auto text-sm">
        {results.map((r) => (
          <li key={r.id} className="flex flex-wrap items-start gap-2 px-4 py-2">
            {r.ok === undefined ? (
              <Loader2 className="mt-0.5 h-4 w-4 shrink-0 animate-spin text-slate-400" />
            ) : r.ok ? (
              <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" />
            ) : (
              <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-600" />
            )}
            <span className="font-mono text-xs font-bold text-[#800000]">{r.no}</span>
            <span className={cn("min-w-0 flex-1 text-xs sm:text-right", r.ok === false ? "text-red-700" : "text-slate-600")}>{r.message || ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ── List ───────────────────────────────────────────────────────────────────

function RequestRow({ r, active, selectable, checked, onToggle, onOpen, bulkRunning }) {
  const Icon = iconOf(r);
  const decided = r.status !== "pending" && r.status !== "posting";
  return (
    <li
      data-row={r.id}
      className={cn(
        "group relative flex gap-3 px-3 py-3 transition-colors sm:px-4",
        active ? "bg-[#800000]/[0.06] shadow-[inset_3px_0_0_0_#800000]" : "hover:bg-slate-50",
        checked && !active && "bg-[#800000]/[0.03]",
      )}
    >
      {selectable && (
        <div className="pt-0.5">
          {r.can_decide ? (
            <input
              type="checkbox"
              aria-label={`Select ${requestNo(r)}`}
              className="h-4 w-4 cursor-pointer rounded accent-[#800000]"
              checked={checked}
              disabled={bulkRunning}
              onChange={onToggle}
            />
          ) : (
            <span className="block h-4 w-4" />
          )}
        </div>
      )}
      <button
        type="button"
        onClick={onOpen}
        aria-current={active ? "true" : undefined}
        className="flex min-w-0 flex-1 gap-3 text-left focus-visible:outline-none after:absolute after:inset-0 after:content-[''] focus-visible:after:ring-2 focus-visible:after:ring-inset focus-visible:after:ring-[#800000]/40"
      >
        <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-slate-100 text-slate-600 group-hover:bg-white">
          <Icon className="h-4 w-4" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center justify-between gap-2">
            <span className="min-w-0 truncate text-sm font-semibold text-slate-900">
              <span className="font-mono text-[#800000]">{requestNo(r)}</span>
              <span className="text-slate-400"> · </span>
              {r.form}
              {r.action === "update" && r.kind !== "saleOrder" && <span className="font-normal text-slate-500"> · edit</span>}
              {r.action === "delete" && <span className="font-normal text-red-600"> · delete</span>}
            </span>
            <StatusChip status={r.status} className="shrink-0" />
          </span>
          <span className="mt-0.5 line-clamp-2 block text-xs text-slate-600" title={r.summary}>{r.summary}</span>
          {r.step_label && (
            <span className="mt-1 flex flex-wrap items-center gap-1 text-[11px]">
              <span className="inline-flex items-center gap-1 rounded-full bg-amber-50 px-2 py-0.5 font-semibold text-amber-800 ring-1 ring-amber-200">
                <GitBranch className="h-3 w-3" /> {r.step_label}
              </span>
              {r.waiting_for && <span className="text-slate-500">with {r.waiting_for}</span>}
              {r.following && (
                <span className="inline-flex items-center gap-0.5 text-slate-400">
                  <Eye className="h-3 w-3" /> following
                </span>
              )}
            </span>
          )}
          {r.kind === "saleOrder" ? (
            <span className="mt-1.5 block"><ReasonChips reasons={r.reasons} /></span>
          ) : r.rule_name && r.kind !== "hr" ? (
            <span className="mt-1 block truncate text-[11px] text-slate-500">Rule: {r.rule_name}</span>
          ) : null}
          {decided && r.remarks && (
            <span
              className={cn(
                "mt-1.5 line-clamp-2 block rounded-md px-2 py-1 text-[11px]",
                r.status === "rejected" ? "bg-red-50 text-red-700" : r.status === "approved" ? "bg-emerald-50 text-emerald-800" : "bg-slate-100 text-slate-600",
              )}
            >
              “{r.remarks}”
            </span>
          )}
          <span className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-slate-500">
            <span className="font-medium text-slate-600">{r.requested_by_name}{r.mine ? " (you)" : ""}</span>
            <span className="inline-flex items-center gap-0.5"><Clock className="h-3 w-3" />{ago(r.requested_at)}</span>
            {decided && r.decided_by_name && <span>· {STATUS[r.status]?.label.toLowerCase()} by {r.decided_by_name} {ago(r.decided_at)}</span>}
          </span>
        </span>
      </button>
    </li>
  );
}

function ListSkeleton() {
  return (
    <ul className="divide-y divide-slate-100" aria-busy="true" aria-label="Loading requests">
      {Array.from({ length: 6 }).map((_, i) => (
        <li key={i} className="flex gap-3 px-4 py-3">
          <Skeleton className="h-9 w-9 rounded-lg" />
          <div className="flex-1 space-y-2">
            <Skeleton className="h-4 w-2/3" />
            <Skeleton className="h-3 w-full" />
            <Skeleton className="h-3 w-1/2" />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────

function ApprovalsPage() {
  const search = useSearchParams();
  const router = useRouter();
  const pathname = usePathname();
  const queryClient = useQueryClient();
  const searchRef = useRef(null);

  const [box, setBox] = useState(() => search.get("box") || null);
  const [type, setType] = useState(() => search.get("type") || "all");
  const [q, setQ] = useState("");
  const [openId, setOpenId] = useState(() => search.get("id") || null);
  const [selected, setSelected] = useState(() => new Set());
  const [rejecting, setRejecting] = useState(false);
  const [bulk, setBulk] = useState(null); // { results: [{ id, no, ok?, message }], running }

  // The box decides who sees what: start on "Waiting for me" for approvers.
  const probe = useQuery({
    queryKey: ["approvals", "inbox"],
    queryFn: () => api("/api/approvals/requests?box=inbox"),
    refetchInterval: 60_000,
  });
  const isApprover = probe.data?.isApprover;
  const current = box ?? (probe.data ? (isApprover ? "inbox" : "mine") : null);
  const list = useQuery({
    queryKey: ["approvals", current],
    queryFn: () => api(`/api/approvals/requests?box=${current}`),
    enabled: Boolean(current) && current !== "inbox",
    refetchInterval: 60_000,
  });
  const data = current === "inbox" ? probe.data : list.data;
  const loading = current === "inbox" ? probe.isLoading : list.isLoading || !current;
  const fetching = probe.isFetching || list.isFetching;
  const counts = probe.data?.counts ?? data?.counts;

  // Keep the URL in step, so a link / refresh lands on the same view.
  useEffect(() => {
    if (!current) return;
    const p = new URLSearchParams();
    if (box) p.set("box", box);
    if (type !== "all") p.set("type", type);
    if (openId) p.set("id", openId);
    const next = `${pathname}${p.toString() ? `?${p}` : ""}`;
    router.replace(next, { scroll: false });
  }, [box, type, openId, pathname, router, current]);

  const refresh = useCallback(() => {
    queryClient.invalidateQueries({ queryKey: ["approvals"] });
  }, [queryClient]);

  const choose = (b) => {
    setBox(b);
    setSelected(new Set());
  };

  const all = useMemo(() => data?.data ?? [], [data]);
  // Type chips: the ones with rows in this box, plus whichever is chosen.
  const typeCounts = useMemo(() => {
    const m = new Map();
    for (const r of all) m.set(typeOf(r), (m.get(typeOf(r)) || 0) + 1);
    return m;
  }, [all]);
  const chips = TYPES.filter((t) => t.key === "all" || t.key === type || typeCounts.get(t.key));
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return all.filter(
      (r) =>
        matchesType(r, type) &&
        (!term ||
          `${r.id} ${requestNo(r)} ${r.form} ${r.summary} ${r.rule_name} ${r.requested_by_name} ${r.decided_by_name ?? ""} ${r.remarks ?? ""} ${(r.reasons || []).join(" ")}`
            .toLowerCase()
            .includes(term)),
    );
  }, [all, q, type]);

  // Bulk selection — only on "Waiting for me", only rows this person may decide.
  const selectable = current === "inbox";
  const decidable = useMemo(() => rows.filter((r) => r.can_decide), [rows]);
  const chosen = decidable.filter((r) => selected.has(r.id));
  const approvable = chosen.filter((r) => r.can_approve);
  const allChosen = decidable.length > 0 && chosen.length === decidable.length;
  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  const toggleAll = () => setSelected(allChosen ? new Set() : new Set(decidable.map((r) => r.id)));

  // One request at a time, through the same endpoint as the detail panel, so
  // every check (approver, still pending, not your own, posting as the
  // requester) applies.
  async function runBulk(action, remarks = "") {
    const pick = action === "approve" ? approvable : chosen;
    const list = pick.map((r) => ({ id: r.id, no: requestNo(r) }));
    if (!list.length) return;
    if (action === "approve") {
      const skipped = chosen.length - approvable.length;
      const msg = `Approve ${list.length} request${list.length === 1 ? "" : "s"}?${skipped ? `\n${skipped} selected need another approver's reason too and are skipped.` : ""}`;
      if (!confirm(msg)) return;
    }
    setRejecting(false);
    const results = list.map((r) => ({ ...r }));
    setBulk({ results: [...results], running: true });
    for (let i = 0; i < results.length; i++) {
      try {
        const res = await api(`/api/approvals/requests/${results[i].id}`, { method: "POST", body: { action, remarks } });
        results[i] = { ...results[i], ok: true, message: res?.message || "Done" };
      } catch (e) {
        results[i] = { ...results[i], ok: false, message: errText(e) };
      }
      setBulk({ results: [...results], running: i < results.length - 1 });
    }
    const failed = results.filter((r) => !r.ok).length;
    if (failed) toast.error(`${failed} of ${results.length} could not be ${action === "approve" ? "approved" : "rejected"} — see the list.`, { duration: 9000 });
    else toast.success(`${results.length} request${results.length === 1 ? "" : "s"} ${action === "approve" ? "approved" : "rejected"}.`);
    // Keep the failed ones ticked so they can be retried.
    setSelected(new Set(results.filter((r) => !r.ok).map((r) => r.id)));
    refresh();
    if (openId) queryClient.invalidateQueries({ queryKey: ["approval", String(openId)] });
  }
  const bulkRunning = Boolean(bulk?.running);

  // Keyboard: move through the list, open, close, refresh, search.
  const move = (delta) => {
    if (!rows.length) return;
    const i = rows.findIndex((r) => String(r.id) === String(openId));
    const next = rows[Math.min(Math.max(i < 0 ? 0 : i + delta, 0), rows.length - 1)];
    setOpenId(String(next.id));
    document.querySelector(`[data-row="${next.id}"]`)?.scrollIntoView({ block: "nearest" });
  };
  useKeyboardShortcuts(
    {
      j: () => move(1),
      arrowdown: () => move(1),
      k: () => move(-1),
      arrowup: () => move(-1),
      escape: () => setOpenId(null),
      r: refresh,
      "/": () => searchRef.current?.focus(),
    },
    !rejecting,
  );

  const boxes = BOXES.filter((b) => !b.approverOnly || isApprover);
  const emptyText = {
    inbox: { title: "All caught up", hint: "Nothing is waiting for your approval." },
    mine: { title: "No requests yet", hint: "Documents you save that need approval show up here, with their decision." },
    history: { title: "Nothing decided yet", hint: "Requests you and the other approvers decide are kept here." },
  }[current] ?? { title: "Nothing here" };

  // Drawer below xl: Esc closes it, and the page behind does not scroll.
  useEffect(() => {
    if (!openId) return;
    const onKey = (e) => e.key === "Escape" && setOpenId(null);
    document.addEventListener("keydown", onKey);
    const narrow = window.matchMedia("(max-width: 1279px)").matches;
    const prev = document.body.style.overflow;
    if (narrow) document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [openId]);

  return (
    <div className="min-h-full bg-slate-50/60">
      <PageHeader
        icon={Inbox}
        title="Approvals"
        subtitle="Held vouchers, Sale Orders and HR requests — approve or reject with remarks; nothing goes through until approved."
        actions={
          <button
            type="button"
            onClick={refresh}
            className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-50"
            aria-label="Refresh (R)"
          >
            <RefreshCw className={cn("h-4 w-4", fetching && "animate-spin")} /> Refresh
          </button>
        }
      />

      <div className="mx-auto w-full max-w-[1600px] space-y-4 px-4 py-4 sm:px-6 sm:py-5">
        {/* Boxes */}
        <div className="flex flex-col gap-3 md:flex-row md:items-center">
          <div role="tablist" aria-label="Approval boxes" className="grid auto-cols-fr grid-flow-col gap-1 rounded-xl border border-slate-200 bg-white p-1 shadow-sm md:inline-grid">
            {(probe.isLoading ? BOXES.slice(0, 2) : boxes).map(({ key, label, short, Icon }) => {
              const n = key === "inbox" ? counts?.inbox : key === "mine" ? counts?.mine : null;
              const on = current === key;
              return (
                <button
                  key={key}
                  type="button"
                  role="tab"
                  aria-selected={on}
                  onClick={() => choose(key)}
                  className={cn(
                    "inline-flex items-center justify-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#800000]/40 sm:px-4",
                    on ? `${BRAND_BTN} shadow-sm` : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" />
                  <span className="sm:hidden">{short}</span>
                  <span className="hidden sm:inline">{label}</span>
                  {n > 0 && (
                    <span className={cn("rounded-full px-1.5 text-[11px] font-bold leading-5", on ? "bg-white/25" : "bg-[#800000] text-white")}>{n}</span>
                  )}
                </button>
              );
            })}
          </div>
          <div className="relative md:ml-auto md:w-80">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <label htmlFor="approval-search" className="sr-only">Search requests</label>
            <input
              id="approval-search"
              ref={searchRef}
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search number, customer, person, remarks…  ( / )"
              className="h-10 w-full rounded-lg border border-slate-200 bg-white pl-9 pr-9 text-sm shadow-sm outline-none focus:border-[#800000]/50 focus:ring-2 focus:ring-[#800000]/20"
            />
            {q && (
              <button type="button" onClick={() => setQ("")} className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-slate-400 hover:text-slate-700" aria-label="Clear search">
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {/* Type filter — scrolls sideways on phones */}
        <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0" role="group" aria-label="Filter by type">
          <div className="flex w-max gap-1.5 sm:w-auto sm:flex-wrap">
            {chips.map(({ key, label, Icon }) => {
              const on = type === key;
              const n = key === "all" ? all.length : typeCounts.get(key) || 0;
              return (
                <button
                  key={key}
                  type="button"
                  aria-pressed={on}
                  onClick={() => {
                    setType(key);
                    setSelected(new Set());
                  }}
                  className={cn(
                    "inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-full border px-3 text-xs font-semibold transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#800000]/40",
                    on ? "border-[#800000] bg-[#800000] text-white" : "border-slate-200 bg-white text-slate-600 hover:border-slate-300 hover:text-slate-900",
                  )}
                >
                  {Icon && <Icon className="h-3.5 w-3.5" />}
                  {label}
                  <span className={cn("rounded-full px-1.5 text-[10px]", on ? "bg-white/20" : "bg-slate-100 text-slate-500")}>{n}</span>
                </button>
              );
            })}
          </div>
        </div>

        {/* Bulk bar */}
        {selectable && chosen.length > 0 && (
          <div className="flex flex-wrap items-center gap-2 rounded-xl border border-[#800000]/25 bg-[#800000]/[0.04] px-4 py-2.5">
            <span className="text-sm font-semibold">{chosen.length} selected</span>
            <button type="button" onClick={() => setSelected(new Set())} disabled={bulkRunning} className="text-xs text-slate-500 underline-offset-2 hover:underline disabled:opacity-50">Clear</button>
            <div className="flex w-full gap-2 sm:ml-auto sm:w-auto [&>button]:flex-1 sm:[&>button]:flex-none">
              <button
                type="button"
                onClick={() => runBulk("approve")}
                disabled={bulkRunning || !approvable.length}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg bg-emerald-600 px-4 text-sm font-semibold text-white shadow-sm hover:bg-emerald-700 disabled:opacity-50"
              >
                {bulkRunning ? <Loader2 className="h-4 w-4 animate-spin" /> : <CheckCircle2 className="h-4 w-4" />} Approve {approvable.length}
              </button>
              <button
                type="button"
                onClick={() => setRejecting(true)}
                disabled={bulkRunning}
                className="inline-flex h-9 items-center justify-center gap-1.5 rounded-lg border border-red-300 bg-white px-4 text-sm font-semibold text-red-700 hover:bg-red-50 disabled:opacity-50"
              >
                <XCircle className="h-4 w-4" /> Reject {chosen.length}
              </button>
            </div>
          </div>
        )}
        {bulk && <BulkResults results={bulk.results} running={bulk.running} onClose={() => setBulk(null)} />}

        {/* List | detail */}
        <div className="grid gap-4 xl:h-[calc(100vh-15.5rem)] xl:min-h-[520px] xl:grid-cols-[minmax(360px,420px)_minmax(0,1fr)]">
          <section className="flex min-w-0 flex-col overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm xl:min-h-0" aria-label="Requests">
            {selectable && decidable.length > 0 && (
              <div className="flex items-center gap-3 border-b border-slate-100 bg-slate-50/70 px-3 py-2 text-xs text-slate-500 sm:px-4">
                <input
                  type="checkbox"
                  aria-label="Select all I can decide"
                  className="h-4 w-4 cursor-pointer rounded accent-[#800000]"
                  checked={allChosen}
                  disabled={bulkRunning}
                  onChange={toggleAll}
                />
                <span>Select all ({decidable.length})</span>
                <span className="ml-auto hidden md:inline">J / K to move · Enter to open</span>
              </div>
            )}
            {loading ? (
              <ListSkeleton />
            ) : probe.error || list.error ? (
              <EmptyState icon={AlertTriangle} title="Could not load the requests" hint={errText(probe.error || list.error)} />
            ) : rows.length === 0 ? (
              <EmptyState
                icon={current === "inbox" && !q && type === "all" ? CheckCircle2 : Inbox}
                title={q || type !== "all" ? "No requests match" : emptyText.title}
                hint={q || type !== "all" ? "Try another type or clear the search." : emptyText.hint}
              />
            ) : (
              <ul className="divide-y divide-slate-100 xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
                {rows.map((r) => (
                  <RequestRow
                    key={r.id}
                    r={r}
                    active={String(r.id) === String(openId)}
                    selectable={selectable}
                    checked={selected.has(r.id)}
                    bulkRunning={bulkRunning}
                    onToggle={() => toggle(r.id)}
                    onOpen={() => setOpenId(String(r.id))}
                  />
                ))}
              </ul>
            )}
          </section>

          {/* One detail panel: beside the list on wide screens (xl); below that a
              drawer from the right over a dimmed page; full screen on phones. */}
          {openId && (
            <div
              className="fixed inset-0 z-[60] bg-slate-900/40 backdrop-blur-[2px] xl:hidden"
              aria-hidden="true"
              onClick={() => setOpenId(null)}
            />
          )}
          <section
            aria-labelledby={openId ? "approval-detail-title" : undefined}
            aria-label={openId ? undefined : "Request details"}
            role={openId ? "dialog" : undefined}
            className={cn(
              "min-w-0 bg-white",
              openId
                ? "fixed inset-0 z-[61] flex flex-col shadow-2xl sm:inset-y-0 sm:left-auto sm:right-0 sm:w-[min(720px,92vw)] sm:border-l sm:border-slate-200"
                : "hidden",
              "xl:static xl:z-auto xl:flex xl:h-full xl:w-auto xl:min-h-0 xl:flex-col xl:overflow-hidden xl:rounded-xl xl:border xl:border-slate-200 xl:shadow-sm",
            )}
          >
            {openId ? (
              <Detail key={openId} id={openId} onClose={() => setOpenId(null)} onChanged={refresh} />
            ) : (
              <EmptyState icon={MousePointerClick} title="Pick a request" hint="Its details, what changed, and the approve / reject panel open here." />
            )}
          </section>
        </div>
      </div>

      <BulkRejectDialog open={rejecting} count={chosen.length} onCancel={() => setRejecting(false)} onConfirm={(reason) => runBulk("reject", reason)} />
    </div>
  );
}

export default function ApprovalsRoute() {
  return (
    <Suspense fallback={null}>
      <ApprovalsPage />
    </Suspense>
  );
}
