"use client";

// components/HR/leave/TypesTab.jsx — leave types and their policy.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Power, Loader2, Tags } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { cn } from "@/lib/utils";
import { fmtDays } from "@/lib/hr/leave/policy";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { api, BRAND_BTN, EmptyState, NativeSelect } from "@/components/HR/shared";
import { Card, Chip, DIALOG, DIALOG_FOOTER } from "@/components/HR/payroll/ui";

const BLANK = {
  code: "", name: "", is_paid: true, annual_days: 10, accrual: "YEARLY", prorate_joiners: true, min_service_days: 0,
  max_carry_forward: 0, allow_negative: false, allow_half_day: true, count_off_days: false, comp_off: false, comp_off_valid_days: 30, max_days_per_request: "",
  gender: "", color: "#0284c7", sort: 0, is_active: true,
};

const COLORS = ["#0284c7", "#16a34a", "#7c3aed", "#db2777", "#ea580c", "#64748b", "#800000", "#0f766e"];

function policyLines(t) {
  const out = [];
  if (t.comp_off) {
    out.push(`Earned by working a week-off / holiday — take within ${t.comp_off_valid_days} days`);
    out.push(t.allow_half_day ? "Half days allowed" : "Full days only");
    return out;
  }
  out.push(t.allow_negative ? "No balance limit" : `${fmtDays(t.annual_days)} day(s) a year${t.accrual === "MONTHLY" ? `, earned monthly (${fmtDays(t.annual_days / 12)}/month)` : ", given at the start of the year"}`);
  if (t.accrual === "YEARLY" && t.prorate_joiners && !t.allow_negative) out.push("Joiners get the months left");
  if (t.min_service_days) out.push(`Usable after ${t.min_service_days} day(s) of service`);
  if (t.max_carry_forward) out.push(`Up to ${fmtDays(t.max_carry_forward)} day(s) carry forward`);
  if (t.max_days_per_request) out.push(`At most ${fmtDays(t.max_days_per_request)} day(s) per application`);
  out.push(t.allow_half_day ? "Half days allowed" : "Full days only");
  out.push(t.count_off_days ? "Week-offs / holidays inside count" : "Week-offs / holidays inside are not counted");
  if (t.gender) out.push(`${t.gender} employees only`);
  return out;
}

export default function TypesTab({ meta }) {
  const qc = useQueryClient();
  const canManage = meta.rights.leaveManage;
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(null);
  const [deleting, setDeleting] = useState(null); // the type to delete, after a confirm
  const { data, isLoading } = useQuery({ queryKey: ["hr-leave-types"], queryFn: () => api("/api/hr/leave/types") });
  const refresh = () => ["hr-leave-types", "hr-meta", "hr-leave-balances"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));

  const run = async (key, fn) => {
    setBusy(key);
    try {
      const r = await fn();
      toast.success(r.message);
      refresh();
      return true;
    } catch (e) {
      toast.error(e.message);
      return false;
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    const body = { ...form, gender: form.gender || null };
    if (await run("form", () => (form.id ? api(`/api/hr/leave/types/${form.id}`, { method: "PUT", body }) : api("/api/hr/leave/types", { method: "POST", body })))) setForm(null);
  };
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-4">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <p className="max-w-3xl text-sm text-muted-foreground">A leave type sets how many days people get, how they are earned and how they may be taken. Changes apply to every balance at once.</p>
        {canManage && <Button className={cn(BRAND_BTN, "h-10 w-full shrink-0 sm:h-9 sm:w-auto")} onClick={() => setForm({ ...BLANK })}><Plus className="h-4 w-4 mr-1.5" />New leave type</Button>}
      </div>
      {isLoading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{[...Array(3)].map((_, i) => <Skeleton key={i} className="h-56 rounded-xl" />)}</div>
      ) : !data?.types?.length ? (
        <Card><EmptyState icon={Tags} title="No leave types yet" hint="Create the kinds of leave your people can take, e.g. casual, sick and annual leave." /></Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {(data?.types ?? []).map((t) => (
            <div key={t.id} className={cn("flex flex-col overflow-hidden rounded-xl border bg-background transition-colors hover:border-primary/30", t.is_active ? "border-border" : "border-dashed border-border opacity-70")}>
              <div className="h-1.5" style={{ background: t.color }} />
              <div className="flex flex-1 flex-col gap-3 p-4 sm:p-5">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <span className="rounded-md px-1.5 py-0.5 font-mono text-xs font-bold text-white" style={{ background: t.color }}>{t.code}</span>
                    <p className="mt-1.5 font-semibold text-foreground">{t.name}</p>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-1">
                    <Chip tone={t.is_paid ? "ok" : "muted"}>{t.is_paid ? "Paid" : "Unpaid"}</Chip>
                    {!t.is_active && <Chip tone="muted" dot={false}>Off</Chip>}
                  </div>
                </div>
                <ul className="space-y-1 text-xs text-muted-foreground">{policyLines(t).map((l) => <li key={l} className="flex gap-1.5"><span className="text-muted-foreground/60">•</span>{l}</li>)}</ul>
                {canManage && (
                  <div className="mt-auto flex justify-end gap-1 border-t border-border/60 pt-3">
                    <Button size="icon" variant="ghost" className="h-9 w-9 text-primary/70 hover:bg-primary/10 hover:text-primary" onClick={() => setForm({ ...t, gender: t.gender ?? "", max_days_per_request: t.max_days_per_request ?? "" })} title="Edit" aria-label={`Edit ${t.name}`}><Pencil className="h-4 w-4" /></Button>
                    <Button size="icon" variant="ghost" className="h-9 w-9" title={t.is_active ? "Switch off" : "Switch on"} aria-label={`${t.is_active ? "Switch off" : "Switch on"} ${t.name}`} disabled={busy === `p${t.id}`}
                      onClick={() => run(`p${t.id}`, () => api(`/api/hr/leave/types/${t.id}`, { method: "PUT", body: { ...t, is_active: !t.is_active } }))}>
                      <Power className={cn("h-4 w-4", t.is_active ? "text-[#2f5139]" : "text-muted-foreground")} />
                    </Button>
                    {!t.used && (
                      <Button size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" title="Delete" aria-label={`Delete ${t.name}`} disabled={busy === `d${t.id}`}
                        onClick={() => setDeleting(t)}>
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    )}
                  </div>
                )}
              </div>
            </div>
          ))}
        </div>
      )}

      <Dialog open={Boolean(form)} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className={cn(DIALOG, "sm:max-w-2xl")}>
          {form && (
            <>
              <DialogHeader>
                <DialogTitle className="pr-8">{form.id ? `Edit ${form.name}` : "New leave type"}</DialogTitle>
                <DialogDescription>Balances are worked out from these rules every time — nothing to recalculate after a change.</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <Field label="Code"><Input value={form.code} onChange={(e) => set("code")(e.target.value.toUpperCase().slice(0, 20))} className="font-mono" placeholder="CL" /></Field>
                <Field label="Name" className="col-span-1 sm:col-span-3"><Input value={form.name} onChange={(e) => set("name")(e.target.value)} placeholder="Casual leave" /></Field>
                <Field label="Days a year"><Input type="number" step={0.5} min={0} value={form.annual_days} onChange={(e) => set("annual_days")(e.target.value)} /></Field>
                <Field label="Earned">
                  <NativeSelect value={form.accrual} onChange={(e) => set("accrual")(e.target.value)} className="w-full">
                    <option value="YEARLY">All at year start</option>
                    <option value="MONTHLY">Monthly (1/12)</option>
                  </NativeSelect>
                </Field>
                <Field label="Service needed (days)"><Input type="number" min={0} value={form.min_service_days} onChange={(e) => set("min_service_days")(e.target.value)} /></Field>
                <Field label="Carry forward (days)"><Input type="number" step={0.5} min={0} value={form.max_carry_forward} onChange={(e) => set("max_carry_forward")(e.target.value)} /></Field>
                <Field label="Most days per application"><Input type="number" step={0.5} min={0} value={form.max_days_per_request} onChange={(e) => set("max_days_per_request")(e.target.value)} placeholder="no limit" /></Field>
                <Field label="Only for">
                  <NativeSelect value={form.gender} onChange={(e) => set("gender")(e.target.value)} className="w-full">
                    <option value="">Everyone</option>
                    <option value="Female">Female</option>
                    <option value="Male">Male</option>
                  </NativeSelect>
                </Field>
                <Field label="Order"><Input type="number" min={0} value={form.sort} onChange={(e) => set("sort")(e.target.value)} /></Field>
                <Field label="Colour">
                  <div className="flex flex-wrap gap-1.5 pt-1">
                    {COLORS.map((c) => <button key={c} type="button" onClick={() => set("color")(c)} className={cn("h-7 w-7 rounded-full ring-offset-2 transition sm:h-6 sm:w-6", form.color === c && "ring-2 ring-foreground/60")} style={{ background: c }} aria-label={`Colour ${c}`} aria-pressed={form.color === c} />)}
                  </div>
                </Field>
              </div>
              <div className="grid sm:grid-cols-2 gap-2">
                <Toggle label="Paid" hint="Unpaid leave is cut from salary" checked={form.is_paid} onChange={set("is_paid")} />
                <Toggle label="No balance limit" hint="May be taken without balance (e.g. unpaid)" checked={form.allow_negative} onChange={set("allow_negative")} />
                <Toggle label="Joiners get the months left" hint="Year-start types only" checked={form.prorate_joiners} onChange={set("prorate_joiners")} />
                <Toggle label="Half days allowed" checked={form.allow_half_day} onChange={set("allow_half_day")} />
                <Toggle label="Count week-offs / holidays inside" hint="e.g. maternity — calendar days" checked={form.count_off_days} onChange={set("count_off_days")} />
                <Toggle label="In use" checked={form.is_active} onChange={set("is_active")} />
                <Toggle label="Comp-off" hint="Days come from working a week-off / holiday, not Days a year" checked={form.comp_off} onChange={set("comp_off")} />
              </div>
              {form.comp_off && (
                <Field label="Take within (days of earning it)" className="max-w-xs">
                  <Input type="number" min={1} max={365} value={form.comp_off_valid_days} onChange={(e) => set("comp_off_valid_days")(e.target.value)} />
                </Field>
              )}
              <DialogFooter className={DIALOG_FOOTER}>
                <Button variant="ghost" onClick={() => setForm(null)}>Cancel</Button>
                <Button className={BRAND_BTN} onClick={save} disabled={busy === "form"}>{busy === "form" && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Save</Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>

      <AlertDialog open={Boolean(deleting)} onOpenChange={(o) => !o && setDeleting(null)}>
        <AlertDialogContent className="w-[calc(100vw-1.5rem)] rounded-xl">
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {deleting?.name}?</AlertDialogTitle>
            <AlertDialogDescription>It is removed for good. Only a leave type nobody has used can be deleted — switch it off instead to keep its history.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === `d${deleting?.id}`}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy === `d${deleting?.id}`}
              onClick={async (e) => {
                e.preventDefault();
                const t = deleting;
                await run(`d${t.id}`, () => api(`/api/hr/leave/types/${t.id}`, { method: "DELETE" }));
                setDeleting(null);
              }}
            >
              {busy === `d${deleting?.id}` ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Field({ label, children, className }) {
  return (
    <div className={cn("space-y-1.5", className)}>
      <Label className="text-xs text-muted-foreground">{label}</Label>
      {children}
    </div>
  );
}

function Toggle({ label, hint, checked, onChange }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2.5">
      <span className="text-sm text-foreground/90">{label}{hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
