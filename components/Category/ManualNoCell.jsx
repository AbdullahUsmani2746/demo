"use client";
// The Manual DC / GRN No cell of the Dispatch, GRN and Dispatch Return lists,
// with a pencil to set just that number on a saved document — also an
// invoiced one, which stays invoiced (PATCH /api/voucher/[type]/manual-no).
// The route checks the edit right, scope and period lock; refusals show as a toast.
import { useState } from "react";
import axios from "axios";
import { toast } from "sonner";
import { Check, Pencil, X } from "lucide-react";

export default function ManualNoCell({ type, entry, label = "Manual No", onSaved }) {
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState("");
  const [busy, setBusy] = useState(false);
  const current = entry?.manual_no ? String(entry.manual_no) : "";
  const stop = (e) => e.stopPropagation();

  async function save() {
    setBusy(true);
    try {
      const { data } = await axios.patch(`/api/voucher/${type}/manual-no`, { tran_id: entry.tran_id, manual_no: value });
      toast.success(data.manual_no ? `${label} saved: ${data.manual_no}` : `${label} cleared`);
      setEditing(false);
      onSaved?.();
    } catch (e) {
      toast.error(e?.response?.data?.message || e?.response?.data?.error || `Could not save the ${label}`);
    } finally {
      setBusy(false);
    }
  }

  if (editing) {
    return (
      <div className="flex items-center gap-1" onClick={stop}>
        <input
          autoFocus
          aria-label={label}
          value={value}
          maxLength={50}
          disabled={busy}
          onChange={(e) => setValue(e.target.value.toUpperCase())}
          onKeyDown={(e) => {
            e.stopPropagation();
            if (e.key === "Enter") save();
            if (e.key === "Escape") setEditing(false);
          }}
          className="h-8 w-28 min-w-0 rounded-md border border-input bg-background px-2 text-sm uppercase outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-500/25"
        />
        <button
          type="button"
          title="Save"
          disabled={busy}
          onClick={save}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
        >
          <Check className="h-4 w-4" />
        </button>
        <button
          type="button"
          title="Cancel"
          disabled={busy}
          onClick={() => setEditing(false)}
          className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground hover:bg-muted"
        >
          <X className="h-4 w-4" />
        </button>
      </div>
    );
  }

  return (
    <span className="group inline-flex items-center gap-1">
      <span>{current || "-"}</span>
      {entry?.tran_id ? (
        <button
          type="button"
          title={`${current ? "Change" : "Add"} ${label} (only this number — the invoice stays as it is)`}
          aria-label={`${current ? "Change" : "Add"} ${label}`}
          onClick={(e) => {
            stop(e);
            setValue(current);
            setEditing(true);
          }}
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground opacity-60 hover:bg-muted hover:text-[#800000] group-hover:opacity-100"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      ) : null}
    </span>
  );
}
