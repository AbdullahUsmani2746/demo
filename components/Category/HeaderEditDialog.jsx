"use client";
// "Edit header" on an invoiced GRN / dispatch / return (Settings → Features →
// "Edit header details on invoiced documents"). Only the header fields in
// lib/vouchers/headerEdit.js; only the ones changed here are sent, so a value
// the list did not load is never cleared. PATCH /api/voucher/[type]/header.
import { useEffect, useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Loader2, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { VOUCHER_CONFIG } from "@/components/Category/constants";
import { headerEditFields } from "@/lib/vouchers/headerEdit";
import { useFeatures } from "@/hooks/useFeatures";

export default function HeaderEditDialog({ type, entry, docLabel, onClose, onSaved }) {
  const features = useFeatures();
  // A field behind its own switch (dispatch Manual DC No / City / Route) is hidden while it is off.
  const fields = headerEditFields(VOUCHER_CONFIG[type]?.tran_code).filter((f) => !f.feature || features.on(f.feature));
  const [values, setValues] = useState({});
  const [dirty, setDirty] = useState({});
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    setValues(Object.fromEntries(fields.map((f) => [f.name, entry?.[f.name] ?? ""])));
    setDirty({});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entry?.tran_id]);

  const set = (name, v) => {
    setValues((s) => ({ ...s, [name]: v }));
    setDirty((d) => ({ ...d, [name]: true }));
  };
  const changed = Object.keys(dirty).filter((k) => dirty[k]);

  async function save() {
    setBusy(true);
    try {
      const { data } = await axios.patch(`/api/voucher/${type}/header`, {
        tran_id: entry.tran_id,
        values: Object.fromEntries(changed.map((k) => [k, values[k]])),
      });
      toast.success(data.changed?.length ? "Header details saved — the invoice is unchanged." : "Nothing was different.");
      onSaved?.();
      onClose();
    } catch (e) {
      toast.error(e?.response?.data?.message || e?.response?.data?.error || "Could not save the header details");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={!!entry} onOpenChange={(o) => !o && !busy && onClose()}>
      <DialogContent className="max-h-[92vh] overflow-y-auto sm:max-w-lg" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Edit header — {docLabel}</DialogTitle>
          <DialogDescription>
            Only these details change; date, party, godown, items, quantities, rates and the invoice stay as they are.
          </DialogDescription>
        </DialogHeader>
        <div className="grid gap-3 sm:grid-cols-2">
          {fields.map((f) => (
            <div key={f.name} className={f.type === "textarea" || f.wide ? "space-y-1 sm:col-span-2" : "space-y-1"}>
              <Label htmlFor={`hdr-${f.name}`}>{f.label}</Label>
              {f.type === "textarea" ? (
                <Textarea id={`hdr-${f.name}`} rows={3} maxLength={f.max} value={values[f.name] ?? ""} onChange={(e) => set(f.name, e.target.value)} />
              ) : (
                <Input
                  id={`hdr-${f.name}`}
                  maxLength={f.max}
                  value={values[f.name] ?? ""}
                  onChange={(e) => set(f.name, f.upper ? e.target.value.toUpperCase() : e.target.value)}
                />
              )}
            </div>
          ))}
        </div>
        <DialogFooter className="gap-2 sm:gap-0">
          <Button type="button" variant="outline" onClick={onClose} disabled={busy}>Cancel</Button>
          <Button type="button" onClick={save} disabled={busy || !changed.length}>
            {busy ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Save className="mr-1.5 h-4 w-4" />}
            Save header
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
