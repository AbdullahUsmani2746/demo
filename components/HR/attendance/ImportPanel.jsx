"use client";

// components/HR/attendance/ImportPanel.jsx — punches from an Excel / CSV file.
//
// Works with any machine's export: pick (or let it find) the column with the
// machine / employee code and either one date-time column or a date and a time
// column. Times are read as Karachi time, as the machine printed them. The
// server stores the punches (duplicates ignored) and rebuilds those days.
import { useMemo, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { FileSpreadsheet, Upload, Loader2, CheckCircle2, AlertTriangle, Download, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { api, BRAND_BTN, CHIP, NativeSelect, Panel, TH, TH_ROW } from "@/components/HR/shared";

const pad = (n) => String(n).padStart(2, "0");
const wall = (y, mo, d, h = 0, mi = 0, s = 0) => `${y}-${pad(mo)}-${pad(d)} ${pad(h)}:${pad(mi)}:${pad(s)}`;

const CODE_RE = /(ac-?no|user ?id|emp(loyee)?[ ._-]?(no|id|code)|enroll|badge|card|person ?id|^id$|^no\.?$|code)/i;
const DATETIME_RE = /(date ?time|check ?time|punch|time ?stamp|log ?time|record)/i;
const DATE_RE = /^(date|day|att(endance)? ?date)$/i;
const TIME_RE = /^(time|clock|att(endance)? ?time)$/i;

/** A cell → { y, mo, d, h, mi, s } parts, or null. dayFirst decides 03/04/2026. */
function parseDateParts(v, dayFirst, XLSX) {
  if (v instanceof Date && !Number.isNaN(v.getTime())) {
    const t = new Date(Math.round(v.getTime() / 1000) * 1000); // SheetJS can be a few ms off
    return { y: t.getFullYear(), mo: t.getMonth() + 1, d: t.getDate(), h: t.getHours(), mi: t.getMinutes(), s: t.getSeconds() };
  }
  if (typeof v === "number" && v > 0) {
    const p = XLSX.SSF.parse_date_code(v);
    return p ? { y: p.y, mo: p.m, d: p.d, h: p.H, mi: p.M, s: Math.round(p.S) } : null;
  }
  const s = String(v ?? "").trim();
  if (!s) return null;
  let m = /^(\d{4})[-/.](\d{1,2})[-/.](\d{1,2})(?:[ T](.+))?$/.exec(s);
  let y, mo, d, rest;
  if (m) [y, mo, d, rest] = [Number(m[1]), Number(m[2]), Number(m[3]), m[4]];
  else {
    m = /^(\d{1,2})[-/.](\d{1,2})[-/.](\d{2,4})(?:\s+(.+))?$/.exec(s);
    if (!m) {
      const t = parseTime(s);
      return t ? { ...t, timeOnly: true } : null;
    }
    const a = Number(m[1]);
    const b = Number(m[2]);
    y = Number(m[3]) < 100 ? 2000 + Number(m[3]) : Number(m[3]);
    [d, mo] = dayFirst ? [a, b] : [b, a];
    rest = m[4];
  }
  const t = rest ? parseTime(rest) : { h: 0, mi: 0, s: 0 };
  if (!t || mo < 1 || mo > 12 || d < 1 || d > 31) return null;
  return { y, mo, d, ...t, hasTime: Boolean(rest) };
}

function parseTime(text) {
  const m = /^(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/.exec(String(text).trim());
  if (!m) return null;
  let h = Number(m[1]);
  const ap = m[4]?.toUpperCase();
  if (ap === "PM" && h < 12) h += 12;
  if (ap === "AM" && h === 12) h = 0;
  if (h > 23 || Number(m[2]) > 59) return null;
  return { h, mi: Number(m[2]), s: Number(m[3] ?? 0) };
}

function timeOfCell(v, XLSX) {
  if (v instanceof Date) return { h: v.getHours(), mi: v.getMinutes(), s: v.getSeconds() };
  if (typeof v === "number" && v >= 0 && v < 1) {
    const secs = Math.round(v * 86400);
    return { h: Math.floor(secs / 3600), mi: Math.floor((secs % 3600) / 60), s: secs % 60 };
  }
  if (typeof v === "number") {
    const p = XLSX.SSF.parse_date_code(v);
    return p ? { h: p.H, mi: p.M, s: Math.round(p.S) } : null;
  }
  return parseTime(v);
}

export default function ImportPanel() {
  const qc = useQueryClient();
  const fileRef = useRef(null);
  const [file, setFile] = useState(null); // { name, header, rows, XLSX }
  const [cols, setCols] = useState({ code: "", datetime: "", date: "", time: "" });
  const [mode, setMode] = useState("single"); // single | split
  const [dayFirst, setDayFirst] = useState(true);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);

  const load = async (f) => {
    if (!f) return;
    setResult(null);
    try {
      const XLSX = await import("xlsx");
      const isCsv = /\.(csv|txt)$/i.test(f.name);
      // CSV keeps text as text, so 03/04/2026 is read with the day-first choice below.
      const wb = XLSX.read(await f.arrayBuffer(), { type: "array", cellDates: true, raw: isCsv });
      const ws = wb.Sheets[wb.SheetNames[0]];
      const all = XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: "" });
      const headerIdx = all.slice(0, 10).findIndex((r) => r.filter((c) => typeof c === "string" && c.trim()).length >= 2);
      if (headerIdx < 0) throw new Error("No header row found in the first 10 rows.");
      const header = all[headerIdx].map((h, i) => String(h || `Column ${i + 1}`).trim());
      const rows = all.slice(headerIdx + 1).filter((r) => r.some((c) => c !== "" && c !== null));
      const find = (re) => header.findIndex((h) => re.test(h));
      const code = find(CODE_RE);
      const dt = find(DATETIME_RE);
      const date = find(DATE_RE);
      const time = find(TIME_RE);
      setMode(dt < 0 && date >= 0 && time >= 0 ? "split" : "single");
      setCols({
        code: code >= 0 ? String(code) : "",
        datetime: dt >= 0 ? String(dt) : date >= 0 ? String(date) : "",
        date: date >= 0 ? String(date) : "",
        time: time >= 0 ? String(time) : "",
      });
      setFile({ name: f.name, header, rows, XLSX });
    } catch (e) {
      toast.error(`Could not read the file: ${e.message}`);
    } finally {
      if (fileRef.current) fileRef.current.value = "";
    }
  };

  const parsed = useMemo(() => {
    if (!file || cols.code === "") return null;
    const out = [];
    let bad = 0;
    for (const r of file.rows) {
      const code = String(r[Number(cols.code)] ?? "").trim();
      let p = null;
      if (mode === "single" && cols.datetime !== "") {
        p = parseDateParts(r[Number(cols.datetime)], dayFirst, file.XLSX);
        // A date with no time is not a punch (that column is a date column).
        if (p?.timeOnly || p?.hasTime === false) p = null;
      } else if (mode === "split" && cols.date !== "" && cols.time !== "") {
        const d = parseDateParts(r[Number(cols.date)], dayFirst, file.XLSX);
        const t = timeOfCell(r[Number(cols.time)], file.XLSX);
        p = d && !d.timeOnly && t ? { ...d, ...t } : null;
      }
      if (!code || !p) {
        bad += 1;
        continue;
      }
      out.push({ code, time: wall(p.y, p.mo, p.d, p.h, p.mi, p.s) });
    }
    return { rows: out, bad };
  }, [file, cols, mode, dayFirst]);

  const send = async () => {
    if (!parsed?.rows.length) return;
    setBusy(true);
    try {
      const r = await api("/api/hr/attendance/import", { method: "POST", body: { file_name: file.name, rows: parsed.rows } });
      setResult(r);
      toast.success(r.message);
      ["hr-att-day", "hr-att-month", "hr-unmapped", "hr-punches"].forEach((k) => qc.invalidateQueries({ queryKey: [k] }));
    } catch (e) {
      toast.error(e.message, { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };

  const template = () => {
    const csv = "Code,Date Time\n1001,2026-10-28 08:02\n1001,2026-10-28 17:06\n";
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
    a.download = "attendance-import-template.csv";
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const colSelect = (key, label) => (
    <div className="space-y-1.5">
      <Label htmlFor={`imp-${key}`} className="text-xs text-foreground/70">{label}</Label>
      <NativeSelect id={`imp-${key}`} value={cols[key]} onChange={(e) => setCols((c) => ({ ...c, [key]: e.target.value }))} className="w-full">
        <option value="">— pick column —</option>
        {file.header.map((h, i) => (
          <option key={i} value={i}>{h}</option>
        ))}
      </NativeSelect>
    </div>
  );

  return (
    <div className="space-y-5">
      <Panel
        title="Import punches from a file"
        icon={FileSpreadsheet}
        actions={<Button variant="outline" size="sm" className="h-9 w-full bg-background sm:h-8 sm:w-auto" onClick={template}><Download className="mr-1.5 h-4 w-4" />Download template</Button>}
        bodyClassName="space-y-5 p-4 sm:p-5"
      >
        {!file ? (
          <button
            type="button"
            onClick={() => fileRef.current?.click()}
            onDragOver={(e) => e.preventDefault()}
            onDrop={(e) => { e.preventDefault(); load(e.dataTransfer.files?.[0]); }}
            className="w-full rounded-xl border-2 border-dashed border-primary/25 bg-primary/[0.02] px-4 py-10 text-center transition-colors hover:border-primary/50 hover:bg-primary/5 focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/30 sm:px-6 sm:py-12"
          >
            <span className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-primary/10 ring-8 ring-primary/[0.04]">
              <Upload className="h-5 w-5 text-primary" />
            </span>
            <p className="mt-3 font-semibold text-foreground">Drop the machine&apos;s export here, or click to choose</p>
            <p className="mt-1 text-sm text-muted-foreground">Excel (.xlsx / .xls) or CSV — one row per punch, with the machine / employee code and the date-time.</p>
          </button>
        ) : (
          <>
            <div className="flex items-center gap-3 rounded-lg border border-border bg-muted/50 px-3 py-3 sm:px-4">
              <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary"><FileSpreadsheet className="h-5 w-5" /></span>
              <div className="min-w-0 flex-1">
                <p className="truncate font-semibold text-foreground">{file.name}</p>
                <p className="text-xs text-muted-foreground tabular-nums">{file.rows.length.toLocaleString()} row(s)</p>
              </div>
              <Button variant="ghost" size="icon" className="h-9 w-9 shrink-0" onClick={() => { setFile(null); setResult(null); }} aria-label="Remove file" title="Remove file"><X className="h-4 w-4" /></Button>
            </div>

            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              {colSelect("code", "Machine / employee code")}
              <div className="space-y-1.5">
                <Label htmlFor="imp-mode" className="text-xs text-foreground/70">Date and time are in</Label>
                <NativeSelect id="imp-mode" value={mode} onChange={(e) => setMode(e.target.value)} className="w-full">
                  <option value="single">One column</option>
                  <option value="split">Two columns (date, time)</option>
                </NativeSelect>
              </div>
              {mode === "single" ? colSelect("datetime", "Date-time column") : (
                <>
                  {colSelect("date", "Date column")}
                  {colSelect("time", "Time column")}
                </>
              )}
              <div className="space-y-1.5">
                <Label htmlFor="imp-dayfirst" className="text-xs text-foreground/70">Dates like 03/04/2026 are</Label>
                <NativeSelect id="imp-dayfirst" value={dayFirst ? "d" : "m"} onChange={(e) => setDayFirst(e.target.value === "d")} className="w-full">
                  <option value="d">Day / month (3 April)</option>
                  <option value="m">Month / day (4 March)</option>
                </NativeSelect>
              </div>
            </div>

            {parsed && (
              <div className="space-y-3">
                <div className="flex flex-wrap gap-2 text-sm">
                  <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold tabular-nums", CHIP.ok)}><CheckCircle2 className="h-4 w-4" />{parsed.rows.length.toLocaleString()} punch(es) read</span>
                  {parsed.bad > 0 && <span className={cn("inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-semibold tabular-nums", CHIP.warn)}><AlertTriangle className="h-4 w-4" />{parsed.bad.toLocaleString()} row(s) skipped (no code or unreadable date)</span>}
                </div>
                <div className="overflow-hidden rounded-lg border border-border">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm">
                      <thead>
                        <tr className={TH_ROW}><th className={cn(TH, "sm:px-4")}>Code</th><th className={cn(TH, "sm:px-4")}>Punch (Karachi time)</th></tr>
                      </thead>
                      <tbody className="divide-y divide-border/60 font-mono tabular-nums">
                        {parsed.rows.slice(0, 8).map((r, i) => (
                          <tr key={i}><td className="px-3 py-1.5 sm:px-4"><span className="rounded bg-primary/10 px-1.5 font-bold text-primary">{r.code}</span></td><td className="px-3 py-1.5 whitespace-nowrap sm:px-4">{r.time}</td></tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  {parsed.rows.length > 8 && <p className="border-t border-border/60 px-4 py-1.5 text-xs text-muted-foreground">…and {(parsed.rows.length - 8).toLocaleString()} more</p>}
                </div>
                <div className="flex justify-end">
                  <Button className={cn(BRAND_BTN, "h-10 w-full sm:h-9 sm:w-auto")} onClick={send} disabled={busy || !parsed.rows.length}>
                    {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Upload className="mr-1.5 h-4 w-4" />}Import {parsed.rows.length.toLocaleString()} punch(es)
                  </Button>
                </div>
              </div>
            )}
          </>
        )}
        <input ref={fileRef} type="file" accept=".xlsx,.xls,.csv,.txt" className="hidden" onChange={(e) => load(e.target.files?.[0])} />
      </Panel>

      {result && (
        <div className={cn("flex items-start gap-3 rounded-xl border px-4 py-4 text-sm sm:px-5", result.unmapped ? cn("border-[#e6dcc6]", CHIP.warn) : cn("border-[#cfdcd2]", CHIP.ok))}>
          {result.unmapped ? <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" /> : <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0" />}
          <div>
          <p className="font-semibold">{result.message}</p>
          {result.unmapped > 0 && <p className="mt-1">Link the unknown machine ids on the <b>Machines</b> tab — their days are built as soon as they are linked.</p>}
          </div>
        </div>
      )}
    </div>
  );
}
