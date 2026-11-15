"use client";

// ============================================================
// SALE RETURN APPROVALS — Technical reasons
// ============================================================
// Sale returns whose sales person chose a Technical reason wait here for
// holders of saleReturn.approve (Permissions → Approvals), who approve or reject them.
// A rejected one goes back to the sales person, who can correct and resend.
// Rules: lib/saleReturns/remarks.js
// ============================================================

import { Fragment, useCallback, useEffect, useState } from "react";
import axios from "axios";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { format } from "date-fns";

import { Card, CardContent } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import KeyboardHint, { KeyCombo } from "@/components/ui/KeyboardHint";
import useKeyboardShortcuts from "@/hooks/useKeyboardShortcuts";
import { BadgeCheck, Briefcase, ChevronDown, ChevronRight, Clock, Loader2, ShieldCheck, Wrench, XCircle } from "lucide-react";
// import { ReasonBadge } from "./saleReturnRemarksForm";

// Reason Type column — Technical / Commercial (same colours as the
// Sale Return Remarks page).
function ReasonTypeBadge({ type }) {
  if (type === "COMMERCIAL") {
    return (
      <span className="inline-flex items-center gap-1 rounded-md bg-sky-100 px-2 py-0.5 text-xs font-bold text-sky-800 ring-1 ring-sky-300">
        <Briefcase className="h-3 w-3" />
        Commercial
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-md bg-violet-100 px-2 py-0.5 text-xs font-bold text-violet-800 ring-1 ring-violet-300">
      <Wrench className="h-3 w-3" />
      Technical
    </span>
  );
}

// Decision column — Technical: Approved / Rejected (+ by whom, when);
// Commercial: needs no approval.
function DecisionCell({ row }) {
  if (row.reason_type === "COMMERCIAL") {
    return (
      <>
        <span className="inline-flex items-center rounded-md bg-slate-100 px-2 py-0.5 text-xs font-semibold text-slate-600 ring-1 ring-slate-300">
          No approval needed
        </span>
        <div className="mt-1 text-xs text-slate-500">
          {row.entered_by || "—"} · {dateTimeFmt(row.entered_at)}
        </div>
      </>
    );
  }
  const approved = row.status === "APPROVED";
  return (
    <>
      <span
        className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs font-bold ring-1 ${
          approved ? "bg-emerald-100 text-emerald-800 ring-emerald-300" : "bg-red-100 text-red-800 ring-red-300"
        }`}
      >
        {approved ? <BadgeCheck className="h-3 w-3" /> : <XCircle className="h-3 w-3" />}
        {approved ? "Approved" : "Rejected"}
      </span>
      <div className="mt-1 text-xs text-slate-500">
        {row.decided_by || "—"} · {dateTimeFmt(row.decided_at)}
      </div>
    </>
  );
}

const qtyFmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
const amtFmt = (n) =>
  Number(n || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const dateFmt = (v) => (v ? format(new Date(v), "dd MMM yyyy") : "—");
const dateTimeFmt = (v) => (v ? format(new Date(v), "dd MMM yyyy, hh:mm a") : "—");

const TH =
  "h-11 whitespace-nowrap border-b-2 border-slate-300 bg-slate-100 px-3 text-left text-xs font-bold uppercase tracking-wide text-slate-700";
const TD = "border-b border-slate-200 px-3 py-2.5 text-sm";

// Remarks column — a saleReturn.remark holder writes and saves the remark (canRemark);
// everyone else sees it with who wrote it and when.
function RemarkCell({ row, canRemark, onSaved }) {
  const [text, setText] = useState(row.decision_remarks || "");
  const [saving, setSaving] = useState(false);
  useEffect(() => setText(row.decision_remarks || ""), [row.decision_remarks]);
  const changed = text.trim() !== (row.decision_remarks || "").trim();

  if (!canRemark) {
    return row.decision_remarks ? (
      <>
        <div className="max-w-[260px] whitespace-pre-wrap break-words text-slate-800">{row.decision_remarks}</div>
        <div className="mt-1 text-xs text-slate-500">
          {row.decided_by || "—"} · {dateTimeFmt(row.decided_at)}
        </div>
      </>
    ) : (
      <span className="text-slate-400">—</span>
    );
  }

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const res = await axios.post("/api/sale-returns/approval", {
        tran_id: row.tran_id,
        action: "remark",
        remarks: text,
      });
      toast.success(res.data?.message || "Remark saved");
      onSaved?.();
    } catch (err) {
      toast.error(err?.response?.data?.error || "Could not save the remark");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="flex min-w-[240px] items-start gap-1.5">
      <Textarea
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          // keep the page's row shortcuts out of the box; Ctrl+Enter saves
          e.stopPropagation();
          if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
            e.preventDefault();
            save();
          }
        }}
        placeholder="Your remarks…"
        rows={2}
        maxLength={500}
        className="min-h-[38px] text-sm"
      />
      <Button size="sm" className="h-8 shrink-0" disabled={!changed || saving} onClick={save}>
        {saving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : "Save"}
      </Button>
    </div>
  );
}

export default function SaleReturnApprovalsForm() {
  const queryClient = useQueryClient();
  // const [view, setView] = useState("pending");
  // No approval any more: one list of every reason (Technical + Commercial).
  const [view, setView] = useState("all");
  const [expanded, setExpanded] = useState(() => new Set());
  // { row, action: "approve" | "reject" }
  const [deciding, setDeciding] = useState(null);
  const [remarks, setRemarks] = useState("");

  const { data, isLoading, isFetching } = useQuery({
    queryKey: ["saleReturnApprovals", view],
    queryFn: async () => (await axios.get("/api/sale-returns/approval", { params: { view } })).data,
    refetchInterval: 60_000,
  });

  const rows = data?.data ?? [];
  const canApprove = Boolean(data?.canApprove);
  // saleReturn.remark holders — may write the Remarks column (lib/saleReturns/remarks.js)
  const canRemark = Boolean(data?.canRemark);

  const decide = useMutation({
    mutationFn: (body) => axios.post("/api/sale-returns/approval", body),
    onSuccess: (res) => {
      toast.success(res.data?.message || "Saved");
      setDeciding(null);
      setRemarks("");
      queryClient.invalidateQueries({ queryKey: ["saleReturnApprovals"] });
      queryClient.invalidateQueries({ queryKey: ["saleReturnRemarks"] });
    },
    onError: (err) => toast.error(err?.response?.data?.error || "Could not save the decision"),
  });

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // const colCount = view === "pending" ? 9 : 10;
  // const colCount = view === "pending" ? 10 : 11;
  const colCount = 11;

  /* ─── Keyboard: arrows move, Enter opens items, A approves, X rejects ─── */
  const [activeId, setActiveId] = useState(null);

  useEffect(() => {
    if (rows.length === 0) {
      if (activeId !== null) setActiveId(null);
    } else if (!rows.some((r) => r.tran_id === activeId)) {
      setActiveId(rows[0].tran_id);
    }
  }, [rows, activeId]);

  const activeRow = rows.find((r) => r.tran_id === activeId) ?? null;

  const moveCursor = useCallback(
    (delta) => {
      if (rows.length === 0) return;
      const i = Math.max(0, rows.findIndex((r) => r.tran_id === activeId));
      const next = rows[Math.min(Math.max(i + delta, 0), rows.length - 1)];
      setActiveId(next.tran_id);
      document
        .querySelectorAll(`[data-sr="${next.tran_id}"]`)
        .forEach((el) => el.scrollIntoView({ block: "nearest" }));
    },
    [rows, activeId],
  );

  // const canDecide = view === "pending" && canApprove;
  const canDecide = false; // approval removed

  useKeyboardShortcuts(
    {
      arrowdown: () => moveCursor(1),
      j: () => moveCursor(1),
      arrowup: () => moveCursor(-1),
      k: () => moveCursor(-1),
      home: () => moveCursor(-rows.length),
      end: () => moveCursor(rows.length),
      enter: () => activeRow && toggle(activeRow.tran_id),
      // a: () => canDecide && activeRow && setDeciding({ row: activeRow, action: "approve" }),
      // x: () => canDecide && activeRow && setDeciding({ row: activeRow, action: "reject" }),
      // 1: () => setView("pending"),
      // 2: () => setView("decided"),
      r: () => queryClient.invalidateQueries({ queryKey: ["saleReturnApprovals"] }),
    },
    !deciding,
  );

  const SHORTCUTS = [
    { combo: "↑/↓", label: "Move between sale returns (J / K too)" },
    { combo: "Home/End", label: "First / last" },
    { combo: "Enter", label: "Show / hide the items" },
    // { combo: "A", label: "Approve the selected return" },
    // { combo: "X", label: "Reject the selected return" },
    // { combo: "Ctrl+Enter", label: "Confirm" },
    // { combo: "1", label: "Waiting for approval" },
    // { combo: "2", label: "All reasons (Commercial + decided Technical)" },
    { combo: "R", label: "Refresh" },
  ];

  const confirmDecision = () => {
    if (!deciding || decide.isPending) return;
    if (deciding.action === "reject" && !remarks.trim()) {
      toast.error("Write why it is rejected");
      return;
    }
    decide.mutate({ tran_id: deciding.row.tran_id, action: deciding.action, remarks });
  };

  useKeyboardShortcuts(
    {
      "ctrl+enter": { handler: confirmDecision, allowInInput: true },
      "ctrl+s": { handler: confirmDecision, allowInInput: true },
    },
    Boolean(deciding),
    true,
  );

  const rejecting = deciding?.action === "reject";

  return (
    <div className="min-h-screen bg-muted/20">
      <div className="mx-auto w-full max-w-[1500px] space-y-5 px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary to-primary/70 shadow-sm">
              <ShieldCheck className="h-6 w-6 text-primary-foreground" />
            </div>
            <div>
              <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Sale Return Remarks</h1>
              <p className="max-w-2xl text-sm text-slate-600">
                Every reason the sales person entered on a sale return — Technical and Commercial —
              </p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {/* {!canApprove ? (
              <span className="rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-800 ring-1 ring-amber-200">
                View only — approval is done by the approvers.
              </span>
            ) : null} */}
            <KeyboardHint shortcuts={SHORTCUTS} className="hidden h-10 px-3 md:inline-flex" />
          </div>
        </div>

        <Card className="overflow-hidden border-2 border-slate-300 shadow-sm">
          <div className="flex flex-wrap items-center gap-3 border-b bg-muted/40 p-3">
            {/* <Tabs value={view} onValueChange={setView}>
              <TabsList className="h-9">
                <TabsTrigger value="pending" className="gap-1.5">
                  <Clock className="h-3.5 w-3.5" />
                  Waiting for approval
                  {view === "pending" && !isLoading ? ` (${rows.length})` : ""}
                </TabsTrigger>
                <TabsTrigger value="decided" className="gap-1.5">
                  <BadgeCheck className="h-3.5 w-3.5" />
                  All Reasons
                  {view === "decided" && !isLoading ? ` (${rows.length})` : ""}
                </TabsTrigger>
              </TabsList>
            </Tabs> */}
            <span className="text-sm font-semibold text-slate-700">
              All Reasons{!isLoading ? ` (${rows.length})` : ""}
            </span>
            {isFetching && !isLoading ? <Loader2 className="h-4 w-4 animate-spin text-slate-500" /> : null}
          </div>

          <CardContent className="p-0">
            {isLoading ? (
              <div className="space-y-2 p-4">
                {Array.from({ length: 5 }).map((_, i) => (
                  <Skeleton key={i} className="h-12 w-full" />
                ))}
              </div>
            ) : rows.length === 0 ? (
              <div className="flex flex-col items-center gap-2 px-6 py-20 text-center">
                <BadgeCheck className="h-10 w-10 text-emerald-500/70" />
                <p className="font-semibold">
                  {/* {view === "pending" ? "Nothing waiting for approval" : "No reasons entered yet"} */}
                  No reasons entered yet
                </p>
              </div>
            ) : (
              <div className="max-h-[70vh] overflow-auto">
                <table className="w-full min-w-[1150px] border-separate border-spacing-0">
                  <thead className="sticky top-0 z-10">
                    <tr>
                      <th className={`${TH} w-8`} />
                      <th className={TH}>Return #</th>
                      <th className={TH}>Date</th>
                      <th className={TH}>Customer</th>
                      <th className={TH}>Sales person</th>
                      <th className={TH}>Items</th>
                      <th className={`${TH} text-right`}>Qty (KG)</th>
                      <th className={TH}>Entered By</th>
                      {/* <th className={TH}>Technical reason</th> */}
                      <th className={TH}>Reason Type</th>
                      <th className={TH}>Reason</th>
                      <th className={TH}>Remarks</th>
                      {/* {view === "decided" ? <th className={TH}>Decision</th> : null}
                      <th className={`${TH} text-right`}>{view === "pending" ? "Action" : "Remarks"}</th> */}
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => {
                      const open = expanded.has(r.tran_id);
                      return (
                        <Fragment key={r.tran_id}>
                          <tr
                            data-sr={r.tran_id}
                            className={`cursor-pointer transition-colors ${
                              r.tran_id === activeId
                                ? "bg-primary/10 shadow-[inset_4px_0_0_0_hsl(var(--primary))]"
                                : "hover:bg-slate-50"
                            }`}
                            onClick={() => {
                              setActiveId(r.tran_id);
                              toggle(r.tran_id);
                            }}
                          >
                            <td className={TD}>
                              {open ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                            </td>
                            <td className={`${TD} font-mono font-bold`}>{r.vr_no}</td>
                            <td className={`${TD} whitespace-nowrap`}>{dateFmt(r.dated)}</td>
                            <td className={TD}>
                              <div className="max-w-[260px] truncate font-semibold" title={r.customer}>{r.customer}</div>
                              <div className="font-mono text-xs text-slate-500">{r.acno}</div>
                            </td>
                            <td className={`${TD} whitespace-nowrap`}>{r.sales_person_name || r.entered_by || "—"}</td>
                            <td className={TD}>
                              <div className="max-w-[220px] truncate" title={r.lines.map((l) => l.item).join(", ")}>
                                {r.lines[0]?.item ?? "—"}
                              </div>
                              {r.lines.length > 1 ? (
                                <div className="text-xs text-slate-500">+{r.lines.length - 1} more</div>
                              ) : null}
                            </td>
                            <td className={`${TD} text-right font-semibold tabular-nums`}>{qtyFmt(r.total_qty)}</td>
                            {/* Who entered the reason, and when (approval removed) */}
                            <td className={`${TD} whitespace-nowrap`}>
                              <div className="font-medium text-slate-800">{r.entered_by || "—"}</div>
                              <div className="text-xs text-slate-500">{dateTimeFmt(r.entered_at)}</div>
                            </td>
                            <td className={`${TD} whitespace-nowrap`}>
                              <ReasonTypeBadge type={r.reason_type} />
                            </td>
                            <td className={TD}>
                              <div className="max-w-[300px] whitespace-pre-wrap break-words text-slate-800">{r.remarks || "—"}</div>
                            </td>
                            {/* The reviewer's remark — editable for saleReturn.remark holders, read-only for others */}
                            <td className={TD} onClick={(e) => e.stopPropagation()}>
                              <RemarkCell
                                row={r}
                                // canRemark={canRemark}
                                // Remarks only on a Commercial reason
                                canRemark={canRemark && r.reason_type === "COMMERCIAL"}
                                onSaved={() => queryClient.invalidateQueries({ queryKey: ["saleReturnApprovals"] })}
                              />
                            </td>
                            {false ? (
                              <td className={`${TD} whitespace-nowrap`}>
                                <DecisionCell row={r} />
                              </td>
                            ) : null}
                            {false ? (
                            <td className={`${TD} text-right`} onClick={(e) => e.stopPropagation()}>
                              {view === "pending" ? (
                                canApprove ? (
                                  <div className="flex justify-end gap-1.5">
                                    <Button
                                      size="sm"
                                      className="h-8 gap-1 bg-emerald-600 hover:bg-emerald-700"
                                      onClick={() => setDeciding({ row: r, action: "approve" })}
                                    >
                                      <BadgeCheck className="h-3.5 w-3.5" />
                                      Approve
                                    </Button>
                                    <Button
                                      size="sm"
                                      variant="outline"
                                      className="h-8 gap-1 border-red-300 text-red-700 hover:bg-red-50"
                                      onClick={() => setDeciding({ row: r, action: "reject" })}
                                    >
                                      <XCircle className="h-3.5 w-3.5" />
                                      Reject
                                    </Button>
                                  </div>
                                ) : (
                                  <span className="text-xs font-semibold text-amber-700">Awaiting approval</span>
                                )
                              ) : (
                                <span className="text-sm text-slate-600">{r.decision_remarks || "—"}</span>
                              )}
                            </td>
                            ) : null}
                          </tr>
                          {open ? (
                            <tr>
                              <td colSpan={colCount} className="border-b-2 border-slate-300 bg-slate-50 px-6 py-4">
                                <div className="mb-2 flex flex-wrap gap-x-6 gap-y-1 text-sm">
                                  {r.invoice_no ? <span><strong>Invoice:</strong> {r.invoice_no}</span> : null}
                                  {r.entered_by ? <span><strong>Reason by:</strong> {r.entered_by} · {dateTimeFmt(r.entered_at)}</span> : null}
                                  {r.narration ? <span><strong>Narration:</strong> {r.narration}</span> : null}
                                </div>
                                <table className="w-full overflow-hidden rounded-lg border bg-white text-sm">
                                  <thead>
                                    <tr className="bg-slate-100 text-left text-xs font-bold uppercase text-slate-700">
                                      <th className="px-3 py-2">Code</th>
                                      <th className="px-3 py-2">Item</th>
                                      <th className="px-3 py-2">Unit</th>
                                      <th className="px-3 py-2 text-right">Qty (KG)</th>
                                      <th className="px-3 py-2 text-right">Rate</th>
                                      <th className="px-3 py-2 text-right">Amount</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y">
                                    {r.lines.map((l) => (
                                      <tr key={l.id}>
                                        <td className="px-3 py-2 font-mono text-xs text-slate-500">{l.code || l.itcd}</td>
                                        <td className="px-3 py-2 font-medium">{l.item}</td>
                                        <td className="px-3 py-2">{l.unit || "KG"}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{qtyFmt(l.qty)}</td>
                                        <td className="px-3 py-2 text-right tabular-nums">{l.rate ? amtFmt(l.rate) : "—"}</td>
                                        <td className="px-3 py-2 text-right font-semibold tabular-nums">{amtFmt(l.amount)}</td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </td>
                            </tr>
                          ) : null}
                        </Fragment>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Dialog
        open={Boolean(deciding)}
        onOpenChange={(o) => {
          if (!o) {
            setDeciding(null);
            setRemarks("");
          }
        }}
      >
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>
              {rejecting ? "Reject" : "Approve"} Sale Return #{deciding?.row.vr_no}?
            </DialogTitle>
            <DialogDescription>
              {deciding ? (
                <>
                  <strong>{deciding.row.customer}</strong> — {qtyFmt(deciding.row.total_qty)} KG.
                  <br />
                  Technical reason: <em>{deciding.row.remarks}</em>
                </>
              ) : null}
            </DialogDescription>
          </DialogHeader>
          <Textarea
            value={remarks}
            onChange={(e) => setRemarks(e.target.value)}
            placeholder={rejecting ? "Why is it rejected? (required)" : "Remarks (optional)"}
            rows={3}
            maxLength={500}
          />
          <DialogFooter>
            <Button variant="outline" onClick={() => setDeciding(null)}>Cancel</Button>
            <Button
              className={rejecting ? "bg-red-600 hover:bg-red-700" : "bg-emerald-600 hover:bg-emerald-700"}
              disabled={decide.isPending}
              onClick={confirmDecision}
            >
              {decide.isPending ? (
                <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />
              ) : rejecting ? (
                <XCircle className="mr-1.5 h-4 w-4" />
              ) : (
                <BadgeCheck className="mr-1.5 h-4 w-4" />
              )}
              {rejecting ? "Reject" : "Approve"}
              <span className="ml-1.5 hidden opacity-80 md:inline"><KeyCombo combo="Ctrl+Enter" /></span>
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
