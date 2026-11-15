"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Lock, Unlock, Loader2, CalendarRange, History, AlertTriangle, FileText } from "lucide-react";
import { toast } from "sonner";
import { documentsSummary } from "@/lib/periodLockCatalog";
import { CHIP } from "@/components/Material/shared/LabUI";
import {
  BRAND, WARN_BTN, Chip, Pill, Panel, FormCard, Segmented, EmptyState, ListSkeleton, DocumentPicker,
  datePresets, dayStr, fmtSpan, fmtStamp, daysBetween, who, plural, sendJson,
} from "./shared";

export default function RangeTab({ ranges, loading, canManage, busyKey, setBusyKey, ask, reload }) {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [codes, setCodes] = useState([]);
  const [reason, setReason] = useState("");
  const [filter, setFilter] = useState("active");

  const active = useMemo(() => ranges.filter((r) => r.is_active), [ranges]);
  const visible = filter === "active" ? active
    : filter === "unlocked" ? ranges.filter((r) => !r.is_active) : ranges;

  const valid = dateFrom && dateTo && dateFrom <= dateTo;
  const days = valid ? daysBetween(dateFrom, dateTo) : 0;
  const overlaps = useMemo(
    () => (valid ? active.filter((r) => dayStr(r.date_from) <= dateTo && dayStr(r.date_to) >= dateFrom) : []),
    [valid, active, dateFrom, dateTo],
  );
  const busy = busyKey !== null;

  const submit = (e) => {
    e.preventDefault();
    if (!valid) { toast.error("Pick a valid From and To date"); return; }
    ask({
      title: `Lock ${fmtSpan(dateFrom, dateTo)}?`,
      body: [
        `${plural(days, "day")} will be locked for: ${documentsSummary(codes)}.`,
        "Nobody can post, edit or delete those documents in this range unless you grant them an exception.",
        "Opening stock is not affected.",
      ],
      action: "Lock range",
      run: async () => {
        setBusyKey("new-range");
        try {
          const d = await sendJson("/api/period-lock", "POST", {
            date_from: dateFrom, date_to: dateTo, tran_codes: codes, reason,
          });
          toast.success(`Locked ${fmtSpan(d.date_from, d.date_to)}`);
          setDateFrom(""); setDateTo(""); setReason(""); setCodes([]); setFilter("active");
          reload();
        } catch (err) { toast.error(err.message); } finally { setBusyKey(null); }
      },
    });
  };

  const toggle = (r) => {
    const lock = !r.is_active;
    const span = fmtSpan(r.date_from, r.date_to);
    ask({
      title: `${lock ? "Lock" : "Unlock"} ${span}?`,
      body: lock
        ? [`${documentsSummary(r.tran_codes)} in this range will be locked again.`]
        : [`${documentsSummary(r.tran_codes)} dated ${span} can be changed again by everyone (unless the month is closed).`,
           "To let only one person in, keep it locked and grant an exception instead."],
      action: lock ? "Lock again" : "Unlock",
      tone: lock ? "brand" : "warn",
      run: async () => {
        setBusyKey(`r-${r.id}`);
        try {
          await sendJson(`/api/period-lock/${r.id}`, "PATCH", { action: lock ? "lock" : "unlock" });
          toast.success(`${span} ${lock ? "locked" : "unlocked"}`);
          reload();
        } catch (err) { toast.error(err.message); } finally { setBusyKey(null); }
      },
    });
  };

  return (
    <div className={`grid grid-cols-1 gap-5 items-start ${canManage ? "lg:grid-cols-[400px_1fr]" : ""}`}>
      {canManage && (
        <FormCard onSubmit={submit} icon={Lock} title="Lock a date range" subtitle="Both dates are included." footer={(
          <Button type="submit" className={`w-full h-10 ${BRAND}`} disabled={busy || !valid}>
            {busyKey === "new-range" ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" /> : <Lock className="h-4 w-4 mr-1.5" />}
            Lock range
          </Button>
        )}>
          <div className="flex flex-wrap gap-1.5">
            {datePresets().map((p) => (
              <Chip key={p.label} on={dateFrom === p.from && dateTo === p.to}
                onClick={() => { setDateFrom(p.from); setDateTo(p.to); }}>
                {p.label}
              </Chip>
            ))}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <Label htmlFor="range-from" className="text-xs">From</Label>
              <Input id="range-from" type="date" value={dateFrom} className="h-10"
                onChange={(e) => { setDateFrom(e.target.value); if (dateTo && e.target.value > dateTo) setDateTo(e.target.value); }} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="range-to" className="text-xs">To</Label>
              <Input id="range-to" type="date" value={dateTo} min={dateFrom || undefined} className="h-10"
                onChange={(e) => setDateTo(e.target.value)} />
            </div>
          </div>

          <div className="space-y-1.5">
            <Label className="text-xs">Documents to lock</Label>
            <DocumentPicker value={codes} onChange={setCodes} />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="range-reason" className="text-xs">Reason <span className="text-muted-foreground/80 font-normal">(optional)</span></Label>
            <Input id="range-reason" value={reason} maxLength={255} className="h-10"
              onChange={(e) => setReason(e.target.value)} placeholder="e.g. Stock count in progress" />
          </div>

          {valid && (
            <div className="rounded-lg border border-primary/20 bg-primary/5 px-3 py-2.5 text-sm space-y-1">
              <p className="text-foreground">
                <span className="font-semibold">{fmtSpan(dateFrom, dateTo)}</span>
                <span className="text-muted-foreground"> · {plural(days, "day")}</span>
              </p>
              <p className="text-xs text-muted-foreground">{documentsSummary(codes)}</p>
              {overlaps.length > 0 && (
                <p className="flex items-start gap-1.5 text-amber-700 dark:text-amber-400 text-xs">
                  <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                  Overlaps {plural(overlaps.length, "active lock")}: {overlaps.map((o) => fmtSpan(o.date_from, o.date_to)).join(", ")}
                </p>
              )}
            </div>
          )}
        </FormCard>
      )}

      <Panel
        title="Date range locks" icon={History}
        actions={<Segmented value={filter} onChange={setFilter}
          options={[["active", `Active (${active.length})`], ["unlocked", "Unlocked"], ["all", "All"]]} />}
      >
        {loading && !ranges.length ? <ListSkeleton /> : visible.length === 0 ? (
          <EmptyState icon={CalendarRange}
            title={filter === "active" ? "No active date locks" : "Nothing here yet"}
            hint={canManage ? "Pick a range to lock it." : "Locked ranges will appear here."} />
        ) : (
          <ul className="divide-y divide-border">
            {visible.map((r) => (
              <li key={r.id} className={`px-4 py-3.5 flex flex-col sm:flex-row sm:items-center gap-3 ${r.is_active ? "" : "bg-muted/30"}`}>
                <div className="flex items-start gap-3 min-w-0 flex-1">
                  <div className={`mt-0.5 rounded-lg p-2 shrink-0 ${r.is_active ? CHIP.bad : CHIP.muted}`}>
                    {r.is_active ? <Lock className="h-4 w-4" /> : <Unlock className="h-4 w-4" />}
                  </div>
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className={`font-semibold ${r.is_active ? "text-foreground" : "text-muted-foreground"}`}>{fmtSpan(r.date_from, r.date_to)}</span>
                      <span className="text-xs text-muted-foreground">{plural(daysBetween(r.date_from, r.date_to), "day")}</span>
                      <Pill kind={r.is_active ? "locked" : "unlocked"} />
                    </div>
                    <p className="text-xs text-muted-foreground mt-1 flex items-start gap-1">
                      <FileText className="h-3.5 w-3.5 mt-px shrink-0 text-muted-foreground/80" />
                      <span className="break-words">{documentsSummary(r.tran_codes)}</span>
                    </p>
                    {r.reason && <p className="text-sm text-muted-foreground mt-0.5 break-words">{r.reason}</p>}
                    <p className="text-xs text-muted-foreground/80 mt-1">
                      Locked by {who(r.locked_by)} · {fmtStamp(r.locked_at)}
                      {!r.is_active && r.unlocked_at && (
                        <span className="block sm:inline"><span className="hidden sm:inline"> · </span>Unlocked by {who(r.unlocked_by)} · {fmtStamp(r.unlocked_at)}</span>
                      )}
                    </p>
                  </div>
                </div>
                {canManage && (
                  <Button size="sm" variant="outline" disabled={busy} onClick={() => toggle(r)}
                    className={`h-9 w-full sm:w-auto shrink-0 ${r.is_active ? WARN_BTN : ""}`}>
                    {busyKey === `r-${r.id}` ? <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
                      : r.is_active ? <Unlock className="h-4 w-4 mr-1.5" /> : <Lock className="h-4 w-4 mr-1.5" />}
                    {r.is_active ? "Unlock" : "Lock again"}
                  </Button>
                )}
              </li>
            ))}
          </ul>
        )}
      </Panel>
    </div>
  );
}
