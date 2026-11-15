"use client";

// components/HR/leaving/NewLeaving.jsx — record a leaving (hr.leaving.manage)
// or resign (hr.leaving.apply, oneself). POST /api/hr/leaving → Approvals.
import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { api, BRAND_BTN, NativeSelect } from "@/components/HR/shared";
import { DIALOG, DIALOG_FOOTER } from "@/components/HR/payroll/ui";
import EmployeePicker from "@/components/HR/EmployeePicker";

export default function NewLeaving({ open, onClose, manage, meta }) {
  const qc = useQueryClient();
  const [emp, setEmp] = useState(null);
  const [kind, setKind] = useState("RESIGNATION");
  const [noticeDate, setNoticeDate] = useState(meta.today);
  const [lwd, setLwd] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const days = kind === "RESIGNATION" ? meta.settings.noticeDaysResignation : kind === "TERMINATION" ? meta.settings.noticeDaysTermination : 0;
  const save = async () => {
    setBusy(true);
    try {
      const r = await api("/api/hr/leaving", { method: "POST", body: { employee_id: manage ? emp?.id : undefined, kind: manage ? kind : "RESIGNATION", notice_date: noticeDate, last_working_day: lwd, reason } });
      toast.success(r.message);
      qc.invalidateQueries({ queryKey: ["hr-leavings"] });
      onClose(r.id);
    } catch (e) {
      toast.error(e.message, { duration: 8000 });
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog open={open} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={`${DIALOG} sm:max-w-lg`}>
        <DialogHeader>
          <DialogTitle>{manage ? "Record a leaving" : "Resign"}</DialogTitle>
          <DialogDescription>Goes to Approvals. Notice required: {days} day(s) (HR → Payroll → Rules).</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          {manage && <div className="space-y-1"><Label className="text-xs text-muted-foreground">Employee</Label><EmployeePicker value={emp} onChange={setEmp} /></div>}
          {manage && (
            <div className="space-y-1"><Label className="text-xs text-muted-foreground">Type</Label>
              <NativeSelect value={kind} onChange={(e) => setKind(e.target.value)} className="h-9 w-full"><option value="RESIGNATION">Resignation</option><option value="TERMINATION">Termination</option><option value="RETIREMENT">Retirement</option></NativeSelect>
            </div>
          )}
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1"><Label className="text-xs text-muted-foreground">Notice given on</Label><Input type="date" value={noticeDate} max={meta.today} onChange={(e) => setNoticeDate(e.target.value)} /></div>
            <div className="space-y-1"><Label className="text-xs text-muted-foreground">Last working day</Label><Input type="date" value={lwd} min={noticeDate} onChange={(e) => setLwd(e.target.value)} /></div>
          </div>
          <div className="space-y-1"><Label className="text-xs text-muted-foreground">Reason</Label><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} /></div>
        </div>
        <DialogFooter className={DIALOG_FOOTER}>
          <Button variant="outline" onClick={() => onClose()}>Cancel</Button>
          <Button className={BRAND_BTN} onClick={save} disabled={busy || !lwd || (manage && !emp)}>{busy && <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />}Send for approval</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
