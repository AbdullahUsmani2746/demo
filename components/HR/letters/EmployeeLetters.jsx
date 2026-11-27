"use client";
// components/HR/letters/EmployeeLetters.jsx — HR letters on the employee's
// Documents: every letter issued (appointment, probation, confirmation,
// warning, termination), print it on the letterhead, upload the signed copy;
// "Issue letter" fills the details, shows the text to adjust, then issues it;
// "Letter texts" changes the wording (right hr.letters.templates).
// Server: app/api/hr/letters/*, lib/hr/letters/*.
import { useEffect, useMemo, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FilePlus2, FileSignature, Loader2, Pencil, Printer, Trash2, Upload, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, BRAND_BTN } from "@/components/HR/shared";
import { esc, letterhead, printDocument } from "@/components/HR/printDoc";
import { EMPLOYEE_PLACEHOLDERS, LETTER_KINDS, LETTER_KIND_KEYS } from "@/lib/hr/letters/catalog";
import { cn } from "@/lib/utils";

const today = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};
const fmtDay = (key) => {
  if (!key) return "";
  const [y, m, d] = String(key).slice(0, 10).split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
};
const KIND_TONE = {
  APPOINTMENT: "bg-emerald-50 text-emerald-700 ring-emerald-600/20",
  PROBATION: "bg-sky-50 text-sky-700 ring-sky-600/20",
  CONFIRMATION: "bg-violet-50 text-violet-700 ring-violet-600/20",
  WARNING: "bg-amber-50 text-amber-800 ring-amber-600/25",
  TERMINATION: "bg-red-50 text-red-700 ring-red-600/20",
};

/** The letter on the company letterhead, ready to print / save as PDF. */
function printLetter(company, employee, letter, lh = null) {
  const paras = String(letter.body || "")
    .split(/\n{2,}/)
    .map((p) => `<p>${esc(p).replace(/\n/g, "<br>")}</p>`)
    .join("");
  const accept =
    letter.kind === "APPOINTMENT"
      ? `<div class="sign2"><p><b>Acceptance</b></p><p>I have read and accept the above terms and conditions.</p><div class="line">Signature</div><div class="line">Name: ${esc(employee?.name || "")}</div><div class="line">Date</div></div>`
      : `<div class="sign2"><p>Received by:</p><div class="line">Signature</div><div class="line">Name: ${esc(employee?.name || "")}</div><div class="line">Date</div></div>`;
  printDocument({
    title: `${letter.ref_no} — ${letter.kind_label}`,
    // On the uploaded letterhead (lib/hr/letters/letterhead.js) its own header
    // replaces the plain one.
    letterhead: lh,
    body: `${lh?.url ? "" : letterhead(company)}
      <style>
        .meta{display:flex;justify-content:space-between;margin:4px 0 14px}
        .to p{margin:0} .subj{margin:14px 0;font-weight:bold;text-decoration:underline;text-align:center}
        .body p{margin:0 0 10px;text-align:justify;white-space:normal}
        .sign{margin-top:36px} .sign2{margin-top:36px;border-top:1px dashed #999;padding-top:10px}
        .line{margin-top:22px;border-top:1px solid #333;width:240px;padding-top:2px;font-size:11px;color:#444}
      </style>
      <div class="meta"><span>Ref: <b>${esc(letter.ref_no)}</b></span><span>Date: <b>${esc(fmtDay(letter.dated))}</b></span></div>
      <div class="to">
        <p><b>${esc(employee?.name || "")}</b>${employee?.id ? ` (Emp No. ${esc(employee.id)})` : ""}</p>
        ${employee?.designation ? `<p>${esc(employee.designation)}${employee?.department ? `, ${esc(employee.department)}` : ""}</p>` : ""}
      </div>
      <div class="subj">${esc(letter.subject)}</div>
      <div class="body">${paras}</div>
      <div class="sign"><p>For ${esc(company?.name || "")}</p><div class="line">Authorised signatory</div></div>
      ${accept}`,
  });
}

export default function EmployeeLetters({ employee }) {
  const qc = useQueryClient();
  const key = ["hr-letters", employee?.id];
  const { data, isLoading, error } = useQuery({
    queryKey: key,
    queryFn: () => api(`/api/hr/letters?employee_id=${employee.id}`),
    enabled: Boolean(employee?.id),
    retry: false,
  });
  const [issueOpen, setIssueOpen] = useState(false);
  const [textsOpen, setTextsOpen] = useState(false);
  const [busyId, setBusyId] = useState(null);

  // The addressee as the server knows them (name, designation, department).
  const who = useMemo(
    () => data?.employee ?? { id: employee?.id, name: [employee?.firstName, employee?.middleName, employee?.surname].filter(Boolean).join(" ") },
    [data?.employee, employee],
  );

  const refresh = () => qc.invalidateQueries({ queryKey: key });

  const upload = async (letter, file) => {
    if (!file) return;
    setBusyId(letter.id);
    try {
      const fd = new FormData();
      fd.append("file", file);
      const res = await fetch(`/api/hr/letters/${letter.id}`, { method: "POST", body: fd });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "Upload failed");
      toast.success(out.message);
      refresh();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusyId(null);
    }
  };

  const withdraw = async (letter) => {
    if (!window.confirm(`Withdraw ${letter.ref_no}? It is removed from the record.`)) return;
    setBusyId(letter.id);
    try {
      const out = await api(`/api/hr/letters/${letter.id}`, { method: "DELETE" });
      toast.success(out.message);
      refresh();
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusyId(null);
    }
  };

  if (error?.status === 403) return null; // no letter rights — the section is not shown
  const can = data?.can || {};
  const letters = data?.letters || [];

  return (
    <div className="space-y-3 rounded-xl border bg-card p-4 md:col-span-2">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <Label className="flex items-center gap-1.5 text-sm font-bold">
          <FileSignature className="h-4 w-4" />
          Letters
        </Label>
        <div className="flex flex-wrap gap-2">
          {can.templates && (
            <Button type="button" size="sm" variant="outline" onClick={() => setTextsOpen(true)}>
              <Pencil className="mr-1.5 h-4 w-4" />
              Letter texts
            </Button>
          )}
          {can.issue && (
            <Button type="button" size="sm" className={BRAND_BTN} onClick={() => setIssueOpen(true)}>
              <FilePlus2 className="mr-1.5 h-4 w-4" />
              Issue letter
            </Button>
          )}
        </div>
      </div>

      {isLoading ? (
        <p className="text-sm text-muted-foreground">Loading letters…</p>
      ) : letters.length === 0 ? (
        <p className="text-sm text-muted-foreground">No letters issued yet — appointment, probation, confirmation, warning and termination letters appear here.</p>
      ) : (
        <ul className="divide-y rounded-md border">
          {letters.map((l) => (
            <li key={l.id} className="flex flex-col gap-2 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <span className={cn("inline-flex rounded-md px-2 py-0.5 text-[11px] font-semibold ring-1 ring-inset", KIND_TONE[l.kind])}>{l.kind_label}</span>
                  <span className="font-mono text-xs font-bold">{l.ref_no}</span>
                  <span className="text-xs text-muted-foreground">{fmtDay(l.dated)}</span>
                </div>
                <p className="mt-0.5 truncate text-sm">{l.subject}</p>
                <p className="text-[11px] text-muted-foreground">
                  Issued by {l.issued_by}
                  {l.signed_url ? " · signed copy on record" : " · signed copy not uploaded yet"}
                </p>
              </div>
              <div className="flex flex-wrap items-center gap-1.5">
                <Button type="button" size="sm" variant="outline" className="h-8" onClick={() => { try { printLetter(data.company, who, l, data.letterhead); } catch (e) { toast.error(e.message); } }}>
                  <Printer className="mr-1 h-3.5 w-3.5" />
                  Print
                </Button>
                {l.signed_url && (
                  <a href={l.signed_url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center rounded-md border px-2.5 text-sm text-primary hover:bg-accent">
                    <ExternalLink className="mr-1 h-3.5 w-3.5" />
                    Signed copy
                  </a>
                )}
                {can.issue && (
                  <label className={cn("inline-flex h-8 cursor-pointer items-center rounded-md border border-dashed px-2.5 text-sm hover:bg-accent", busyId === l.id && "pointer-events-none opacity-60")}>
                    {busyId === l.id ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : <Upload className="mr-1 h-3.5 w-3.5" />}
                    {l.signed_url ? "Replace signed" : "Upload signed"}
                    <input type="file" accept="application/pdf,image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => { upload(l, e.target.files?.[0]); e.target.value = ""; }} />
                  </label>
                )}
                {can.issue && !l.signed_url && (
                  <Button type="button" size="sm" variant="ghost" className="h-8 text-destructive" disabled={busyId === l.id} onClick={() => withdraw(l)} aria-label={`Withdraw ${l.ref_no}`}>
                    <Trash2 className="h-3.5 w-3.5" />
                  </Button>
                )}
              </div>
            </li>
          ))}
        </ul>
      )}

      {issueOpen && (
        <IssueLetterDialog
          employee={who}
          defaults={data?.defaults || {}}
          onClose={() => setIssueOpen(false)}
          onIssued={(letter) => {
            setIssueOpen(false);
            refresh();
            try {
              printLetter(data?.company, who, letter, data?.letterhead);
            } catch (e) {
              toast.error(e.message);
            }
          }}
        />
      )}
      {textsOpen && <LetterTextsDialog onClose={() => setTextsOpen(false)} />}
    </div>
  );
}

// ── Issue a letter: details → the text (adjustable) → issue & print ─────────
function IssueLetterDialog({ employee, defaults, onClose, onIssued }) {
  const [kind, setKind] = useState("APPOINTMENT");
  const [dated, setDated] = useState(today());
  const [details, setDetails] = useState({});
  const [preview, setPreview] = useState(null); // { subject, body }
  const def = LETTER_KINDS[kind];

  // A new kind starts from its defaults (and the employee's own values).
  useEffect(() => {
    const d = {};
    for (const f of def.fields) {
      if (f.fromEmployee && defaults[f.fromEmployee] != null) d[f.key] = defaults[f.fromEmployee];
      else if (f.default !== undefined) d[f.key] = f.default;
      else d[f.key] = "";
    }
    setDetails(d);
    setPreview(null);
  }, [kind]); // eslint-disable-line react-hooks/exhaustive-deps

  const previewM = useMutation({
    mutationFn: () => api("/api/hr/letters", { method: "POST", body: { action: "preview", employee_id: employee.id, kind, dated, details } }),
    onSuccess: (p) => setPreview({ subject: p.subject, body: p.body }),
    onError: (e) => toast.error(e.message),
  });
  const issueM = useMutation({
    mutationFn: () =>
      api("/api/hr/letters", { method: "POST", body: { action: "issue", employee_id: employee.id, kind, dated, details, subject: preview.subject, body: preview.body } }),
    onSuccess: (out) => {
      toast.success(out.message);
      onIssued(out.letter);
    },
    onError: (e) => toast.error(e.message),
  });

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-2xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Issue a letter — {employee.name}</DialogTitle>
          <DialogDescription>Fill in the details, check the text, then issue it. It is kept on the employee&apos;s record and opens for printing.</DialogDescription>
        </DialogHeader>

        {!preview ? (
          <div className="space-y-3">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1">
                <Label>Letter</Label>
                <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={kind} onChange={(e) => setKind(e.target.value)}>
                  {LETTER_KIND_KEYS.map((k) => (
                    <option key={k} value={k}>{LETTER_KINDS[k].label}</option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Date of the letter</Label>
                <Input type="date" value={dated} onChange={(e) => setDated(e.target.value)} />
              </div>
            </div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {def.fields.map((f) => (
                <div key={f.key} className={cn("space-y-1", f.type === "textarea" && "sm:col-span-2")}>
                  <Label>
                    {f.label}
                    {f.required && <span className="text-destructive"> *</span>}
                  </Label>
                  {f.type === "textarea" ? (
                    <Textarea rows={3} value={details[f.key] ?? ""} onChange={(e) => setDetails({ ...details, [f.key]: e.target.value })} />
                  ) : f.type === "choice" ? (
                    <select className="h-9 w-full rounded-md border bg-background px-2 text-sm" value={details[f.key] ?? ""} onChange={(e) => setDetails({ ...details, [f.key]: e.target.value })}>
                      {f.options.map((o) => (
                        <option key={o} value={o}>{o}</option>
                      ))}
                    </select>
                  ) : (
                    <Input
                      type={f.type === "date" ? "date" : f.type === "number" ? "number" : "text"}
                      value={details[f.key] ?? ""}
                      onChange={(e) => setDetails({ ...details, [f.key]: e.target.value })}
                    />
                  )}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <div className="space-y-1">
              <Label>Subject</Label>
              <Input value={preview.subject} onChange={(e) => setPreview({ ...preview, subject: e.target.value })} />
            </div>
            <div className="space-y-1">
              <Label>Text — adjust it if needed</Label>
              <Textarea rows={16} className="font-serif text-[13px] leading-relaxed" value={preview.body} onChange={(e) => setPreview({ ...preview, body: e.target.value })} />
            </div>
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-0">
          {preview ? (
            <>
              <Button type="button" variant="outline" onClick={() => setPreview(null)}>Back to details</Button>
              <Button type="button" className={BRAND_BTN} disabled={issueM.isPending} onClick={() => issueM.mutate()}>
                {issueM.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Issue &amp; print
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
              <Button type="button" className={BRAND_BTN} disabled={previewM.isPending} onClick={() => previewM.mutate()}>
                {previewM.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
                Show the letter
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

// ── The letterhead letters print on (lib/hr/letters/letterhead.js) ──────────
const MARGINS = [
  ["top", "Top (header)"],
  ["bottom", "Bottom (footer)"],
  ["left", "Left"],
  ["right", "Right"],
];

function LetterheadSettings() {
  const qc = useQueryClient();
  const { data, isLoading } = useQuery({ queryKey: ["hr-letterhead"], queryFn: () => api("/api/hr/letters/letterhead") });
  const lh = data?.letterhead ?? null;
  const [m, setM] = useState(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (lh) setM({ top: lh.top, bottom: lh.bottom, left: lh.left, right: lh.right });
  }, [lh]);
  const done = (out) => {
    toast.success(out.message);
    qc.invalidateQueries({ queryKey: ["hr-letterhead"] });
    qc.invalidateQueries({ queryKey: ["hr-letters"] });
  };
  const run = async (fn) => {
    setBusy(true);
    try {
      done(await fn());
    } catch (e) {
      toast.error(e.message);
    } finally {
      setBusy(false);
    }
  };
  const upload = (file) =>
    file &&
    run(async () => {
      const fd = new FormData();
      fd.append("file", file);
      for (const [k, v] of Object.entries(m ?? {})) fd.append(k, String(v));
      const res = await fetch("/api/hr/letters/letterhead", { method: "POST", body: fd });
      const out = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(out.error || "Upload failed");
      return out;
    });
  const changed = lh && m && MARGINS.some(([k]) => Number(m[k]) !== Number(lh[k]));

  return (
    <div className="space-y-3 rounded-lg border border-border p-3">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="text-sm font-semibold">Letterhead</p>
          <p className="text-xs text-muted-foreground">
            A picture of the whole A4 letterhead page (PNG / JPG). Letters print on it, the text kept inside the margins below so it never runs over
            the logo or the addresses.
          </p>
        </div>
        <label className={cn("inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted", busy && "pointer-events-none opacity-60")}>
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Upload className="h-4 w-4" />}
          {lh ? "Replace" : "Upload letterhead"}
          <input type="file" accept="image/png,image/jpeg" className="sr-only" onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
        </label>
      </div>
      {isLoading ? (
        <p className="text-xs text-muted-foreground">Loading…</p>
      ) : !lh ? (
        <p className="text-xs text-muted-foreground">None yet — letters print with the company name and address at the top.</p>
      ) : (
        <div className="flex flex-col gap-3 sm:flex-row">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={lh.url} alt="Letterhead" className="w-28 shrink-0 self-start rounded border border-border shadow-sm" />
          <div className="min-w-0 flex-1 space-y-2">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {MARGINS.map(([k, label]) => (
                <div key={k} className="space-y-1">
                  <Label className="text-xs">{label}, mm</Label>
                  <Input type="number" min="0" max="120" step="1" inputMode="decimal" value={m?.[k] ?? ""} onChange={(e) => setM({ ...m, [k]: e.target.value })} className="h-8" />
                </div>
              ))}
            </div>
            <div className="flex flex-wrap gap-2">
              <Button type="button" size="sm" className={`${BRAND_BTN} h-8`} disabled={!changed || busy} onClick={() => run(() => api("/api/hr/letters/letterhead", { method: "PUT", body: m }))}>
                Save margins
              </Button>
              <Button type="button" size="sm" variant="outline" className="h-8 text-destructive" disabled={busy} onClick={() => run(() => api("/api/hr/letters/letterhead", { method: "DELETE" }))}>
                <Trash2 className="mr-1.5 h-4 w-4" /> Remove
              </Button>
            </div>
            <p className="text-[11px] text-muted-foreground">Print a letter to check — if text touches the logo or the footer, raise Top / Bottom.</p>
          </div>
        </div>
      )}
    </div>
  );
}

// ── The wording of every letter (right hr.letters.templates) ────────────────
function LetterTextsDialog({ onClose }) {
  const [kind, setKind] = useState("APPOINTMENT");
  const [texts, setTexts] = useState(null);
  const { data, isLoading } = useQuery({ queryKey: ["hr-letter-texts"], queryFn: () => api("/api/hr/letters/templates") });
  useEffect(() => {
    if (data?.templates && !texts) setTexts(data.templates);
  }, [data, texts]);
  const saveM = useMutation({
    mutationFn: () => api("/api/hr/letters/templates", { method: "PUT", body: { templates: texts } }),
    onSuccess: (out) => {
      toast.success(out.message);
      onClose();
    },
    onError: (e) => toast.error(e.message),
  });
  const t = texts?.[kind];
  const fieldKeys = LETTER_KINDS[kind].fields.map((f) => ({ key: f.key, label: f.label }));

  return (
    <Dialog open onOpenChange={(o) => !o && onClose()}>
      <DialogContent className="max-h-[92vh] max-w-3xl overflow-y-auto">
        <DialogHeader>
          <DialogTitle>Letter texts</DialogTitle>
          <DialogDescription>The letterhead and the wording of each letter. Words in {"{braces}"} are filled in when a letter is issued. Letters already issued keep their text (a new letterhead applies to every print).</DialogDescription>
        </DialogHeader>
        {isLoading || !t ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : (
          <div className="space-y-3">
            <LetterheadSettings />
            <div className="flex flex-wrap gap-1.5">
              {LETTER_KIND_KEYS.map((k) => (
                <Button key={k} type="button" size="sm" variant={k === kind ? "default" : "outline"} className={k === kind ? BRAND_BTN : ""} onClick={() => setKind(k)}>
                  {LETTER_KINDS[k].label}
                </Button>
              ))}
            </div>
            <div className="space-y-1">
              <Label>Subject</Label>
              <Input value={t.subject} onChange={(e) => setTexts({ ...texts, [kind]: { ...t, subject: e.target.value } })} />
            </div>
            <div className="space-y-1">
              <Label>Text</Label>
              <Textarea rows={16} className="font-serif text-[13px] leading-relaxed" value={t.body} onChange={(e) => setTexts({ ...texts, [kind]: { ...t, body: e.target.value } })} />
            </div>
            <div className="rounded-md bg-muted/60 p-3 text-xs">
              <p className="mb-1 font-semibold">You can use</p>
              <p className="text-muted-foreground">
                {[...EMPLOYEE_PLACEHOLDERS, ...fieldKeys].map((p, i) => (
                  <span key={p.key}>
                    {i > 0 && " · "}
                    <code className="text-foreground">{`{${p.key}}`}</code> {p.label}
                  </span>
                ))}
              </p>
            </div>
          </div>
        )}
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="button" className={BRAND_BTN} disabled={!texts || saveM.isPending} onClick={() => saveM.mutate()}>
            {saveM.isPending && <Loader2 className="mr-1.5 h-4 w-4 animate-spin" />}
            Save texts
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
