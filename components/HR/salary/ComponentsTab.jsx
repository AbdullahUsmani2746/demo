"use client";

// components/HR/salary/ComponentsTab.jsx — allowances and deductions.
import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Plus, Pencil, Trash2, Power, Loader2, CirclePlus, CircleMinus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { COMPONENT_CALCS, fmtMoney } from "@/lib/hr/salary/calc";
import { api, BRAND_BTN, NativeSelect } from "@/components/HR/shared";
import { Card, Chip, CodeChip, DIALOG, DIALOG_FOOTER } from "@/components/HR/payroll/ui";

const BLANK = { code: "", name: "", kind: "EARNING", calc: "FIXED", default_value: 0, prorate: true, taxable: true, gl_acno: "", sort: 0, is_active: true };

export default function ComponentsTab({ meta }) {
  const qc = useQueryClient();
  const canManage = meta.rights.salaryManage;
  const [form, setForm] = useState(null);
  const [busy, setBusy] = useState(null);
  const [deleting, setDeleting] = useState(null); // the component to delete, after a confirm
  const { data, isLoading } = useQuery({ queryKey: ["hr-pay-components"], queryFn: () => api("/api/hr/salary/components") });
  const run = async (key, fn) => {
    setBusy(key);
    try {
      const r = await fn();
      toast.success(r.message);
      ["hr-pay-components", "hr-salaries"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
      return true;
    } catch (e) {
      toast.error(e.message);
      return false;
    } finally {
      setBusy(null);
    }
  };
  const save = async () => {
    if (await run("form", () => (form.id ? api(`/api/hr/salary/components/${form.id}`, { method: "PUT", body: form }) : api("/api/hr/salary/components", { method: "POST", body: form })))) setForm(null);
  };
  const set = (k) => (v) => setForm((f) => ({ ...f, [k]: v }));
  const comps = data?.components ?? [];

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 rounded-xl border border-border bg-background p-3 sm:flex-row sm:items-center sm:justify-between sm:px-4">
        <p className="text-xs text-muted-foreground sm:text-sm">Allowances and deductions used in salaries. EOBI, income tax, overtime and loan instalments are worked out by payroll — they are not set up here.</p>
        {canManage && <Button className={cn(BRAND_BTN, "w-full shrink-0 sm:w-auto")} onClick={() => setForm({ ...BLANK })}><Plus className="h-4 w-4 mr-1.5" />New component</Button>}
      </div>
      {isLoading ? (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{[...Array(6)].map((_, i) => <Skeleton key={i} className="h-40 rounded-xl" />)}</div>
      ) : (
        [["EARNING", "Allowances", CirclePlus, "Add to gross pay"], ["DEDUCTION", "Deductions", CircleMinus, "Come off gross pay"]].map(([kind, title, Icon, description]) => {
          const list = comps.filter((c) => c.kind === kind);
          return (
            <Card key={kind} title={`${title} · ${list.length}`} icon={Icon} description={description} bodyClassName="p-3 sm:p-4">
              {!list.length && <p className="rounded-xl border border-dashed border-border px-4 py-6 text-center text-sm text-muted-foreground">None set up yet.</p>}
              <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                {list.map((c) => (
                  <div key={c.id} className={cn("flex flex-col rounded-xl border bg-background p-4 transition-colors hover:border-primary/30", c.is_active ? "border-border" : "border-dashed border-border opacity-70")}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="truncate font-semibold text-foreground">{c.name}</p>
                        <p className="mt-0.5 flex flex-wrap items-center gap-1.5"><CodeChip>{c.code}</CodeChip>{!c.is_active && <Chip tone="muted" dot={false} className="px-2 text-[10px]">Not in use</Chip>}</p>
                      </div>
                      <Chip tone="info" dot={false} className="shrink-0">{c.calc === "PERCENT_BASIC" ? "% of basic" : "Fixed"}</Chip>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-1.5 text-[11px]">
                      <Badge on={c.prorate}>{c.prorate ? "By days worked" : "Full every month"}</Badge>
                      {kind === "EARNING" && <Badge on={c.taxable}>{c.taxable ? "Taxable" : "Tax-free"}</Badge>}
                      <Badge on>{c.used} salar{c.used === 1 ? "y" : "ies"}</Badge>
                      {c.default_value > 0 && <Badge on>default {c.calc === "PERCENT_BASIC" ? `${c.default_value}%` : fmtMoney(c.default_value)}</Badge>}
                    </div>
                    <p className="mb-3 mt-2 break-words text-xs text-muted-foreground">Account: {c.gl_acno ? `${c.gl_acno}${c.gl_name ? ` · ${c.gl_name}` : ""}` : "default (Account Settings)"}</p>
                    {canManage && (
                      <div className="mt-auto flex justify-end gap-1 border-t border-border/60 pt-2">
                        <Button size="icon" variant="ghost" className="h-9 w-9 text-primary/70 hover:bg-primary/10 hover:text-primary" onClick={() => setForm({ ...c, gl_acno: c.gl_acno ?? "" })} aria-label={`Edit ${c.name}`} title="Edit">
                          <Pencil className="h-4 w-4" />
                        </Button>
                        <Button
                          size="icon"
                          variant="ghost"
                          className="h-9 w-9"
                          disabled={busy === `p${c.id}`}
                          onClick={() => run(`p${c.id}`, () => api(`/api/hr/salary/components/${c.id}`, { method: "PUT", body: { ...c, is_active: !c.is_active } }))}
                          aria-label={c.is_active ? `Stop using ${c.name}` : `Use ${c.name} again`}
                          title={c.is_active ? "In use — click to stop" : "Not in use — click to use"}
                        >
                          <Power className={cn("h-4 w-4", c.is_active ? "text-[#2f5139]" : "text-muted-foreground")} />
                        </Button>
                        {!c.used && (
                          <Button size="icon" variant="ghost" className="h-9 w-9 text-muted-foreground hover:bg-destructive/10 hover:text-destructive" disabled={busy === `d${c.id}`} onClick={() => setDeleting(c)} aria-label={`Delete ${c.name}`} title="Delete">
                            <Trash2 className="h-4 w-4" />
                          </Button>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </Card>
          );
        })
      )}

      <Dialog open={Boolean(form)} onOpenChange={(o) => !o && setForm(null)}>
        <DialogContent className={cn(DIALOG, "sm:max-w-lg")}>
          {form && (
            <>
              <DialogHeader className="pr-8 text-left">
                <DialogTitle>{form.id ? `Edit ${form.name}` : "New pay component"}</DialogTitle>
                <DialogDescription>{form.used ? "Used in salaries — type and calculation are fixed." : "An allowance adds to gross pay; a deduction comes off it."}</DialogDescription>
              </DialogHeader>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <F label="Code"><Input value={form.code} onChange={(e) => set("code")(e.target.value.toUpperCase().slice(0, 20))} className="font-mono" /></F>
                <F label="Name"><Input value={form.name} onChange={(e) => set("name")(e.target.value)} /></F>
                <F label="Type">
                  <NativeSelect value={form.kind} disabled={Boolean(form.used)} onChange={(e) => set("kind")(e.target.value)} className="w-full">
                    <option value="EARNING">Allowance</option>
                    <option value="DEDUCTION">Deduction</option>
                  </NativeSelect>
                </F>
                <F label="Calculated as">
                  <NativeSelect value={form.calc} disabled={Boolean(form.used)} onChange={(e) => set("calc")(e.target.value)} className="w-full">
                    {COMPONENT_CALCS.map((c) => <option key={c.key} value={c.key}>{c.label}</option>)}
                  </NativeSelect>
                </F>
                <F label={form.calc === "PERCENT_BASIC" ? "Default %" : "Default amount"}><Input type="number" min={0} value={form.default_value} onChange={(e) => set("default_value")(e.target.value)} /></F>
                <F label="Ledger account (payroll JV)"><Input type="number" value={form.gl_acno} onChange={(e) => set("gl_acno")(e.target.value)} placeholder="default" /></F>
              </div>
              <div className="space-y-2">
                <T label="Paid by days worked" hint="Cut for absent / unpaid days" checked={form.prorate} onChange={set("prorate")} />
                {form.kind === "EARNING" && <T label="Taxable" hint="Part of taxable income" checked={form.taxable} onChange={set("taxable")} />}
                <T label="In use" checked={form.is_active} onChange={set("is_active")} />
              </div>
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
            <AlertDialogDescription>It is removed for good. Only a component no salary uses can be deleted — switch it off instead to keep its history.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel disabled={busy === `d${deleting?.id}`}>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              disabled={busy === `d${deleting?.id}`}
              onClick={async (e) => {
                e.preventDefault();
                const c = deleting;
                await run(`d${c.id}`, () => api(`/api/hr/salary/components/${c.id}`, { method: "DELETE" }));
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

const Badge = ({ on, children }) => <span className={cn("rounded px-1.5 py-0.5", on ? "bg-primary/[0.06] text-foreground/90" : "bg-background text-muted-foreground ring-1 ring-inset ring-border")}>{children}</span>;
const F = ({ label, children }) => <div className="space-y-1.5"><Label className="text-xs text-muted-foreground">{label}</Label>{children}</div>;
function T({ label, hint, checked, onChange }) {
  return (
    <label className="flex min-h-[44px] cursor-pointer items-center justify-between gap-3 rounded-lg border border-border px-3 py-2">
      <span className="text-sm text-foreground/90">{label}{hint && <span className="block text-[11px] text-muted-foreground">{hint}</span>}</span>
      <Switch checked={checked} onCheckedChange={onChange} />
    </label>
  );
}
