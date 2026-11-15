"use client";

import { useEffect, useMemo, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Save, PlusCircle, CalendarCheck2, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import { DateField } from "@/components/ui/date-field";
import {
  Chip,
  DIALOG,
  DIALOG_HEAD,
  DIALOG_BODY,
  DIALOG_FOOT,
} from "@/components/Material/shared/LabUI";
import BankCombobox from "./BankCombobox";
import CustomerCombobox from "./CustomerCombobox";
import TransferBankCombobox from "./TransferBankCombobox";
import { CHECK_STATUS, normalizeBank } from "@/lib/accounts/checksInHand";
import { formatDMY, toISODate, todayISO } from "@/lib/date-format";
import { formatAmountInput, parseAmountInput } from "@/lib/number-format";

// The API only ever stores dates, so send/receive plain yyyy-MM-dd (the user
// still reads and types DD-MM-YYYY — DateField does that translation) and
// never let a timezone shift the day.
const toDateInput = (value) => toISODate(value);

const emptyForm = () => ({
  acno: "",
  customerName: "",
  chqRcvDate: todayISO(),
  dated: todayISO(),
  bank: "",
  chqNo: "",
  chqDate: "",
  amount: "",
  chqBrBy: "",
  rmk: "",
  depAcno: "",
});

/**
 * Add / edit a cheque.
 *
 * Deliberately does NOT expose Status or Deposit Date as editable fields:
 * a new cheque is always PENDING, and clearing it is a one-click action on
 * the list (which is what stamps the deposit date). Keeping the two flows
 * apart is what makes "just change the status" honest — nobody can
 * accidentally mark a cheque cleared while fixing a typo in the bank name.
 */
export default function CheckEntryDialog({ open, onOpenChange, cheque }) {
  const isEdit = Boolean(cheque?.id);
  const queryClient = useQueryClient();
  const [form, setForm] = useState(emptyForm);
  const [keepOpen, setKeepOpen] = useState(false);

  useEffect(() => {
    if (!open) return;
    if (isEdit) {
      setForm({
        acno: cheque.acno ?? "",
        customerName: cheque.customerName ?? "",
        chqRcvDate: toDateInput(cheque.chqRcvDate),
        dated: toDateInput(cheque.dated) || todayISO(),
        bank: cheque.bank ?? "",
        chqNo: cheque.chqNo ?? "",
        chqDate: toDateInput(cheque.chqDate),
        amount: cheque.amount != null ? String(cheque.amount) : "",
        chqBrBy: cheque.chqBrBy ?? "",
        rmk: cheque.rmk ?? "",
        depAcno: cheque.depAcno ?? "",
      });
    } else {
      setForm(emptyForm());
    }
  }, [open, isEdit, cheque]);

  const set = (patch) => setForm((f) => ({ ...f, ...patch }));

  const errors = useMemo(() => {
    const e = {};
    if (!form.acno) e.acno = "Pick a customer";
    if (!normalizeBank(form.bank)) e.bank = "Bank is required";
    if (!form.chqNo.trim()) e.chqNo = "Cheque no. is required";
    if (!form.chqDate) e.chqDate = "Cheque date is required";
    const amt = Number(form.amount);
    if (!form.amount || !Number.isFinite(amt) || amt <= 0) e.amount = "Enter an amount";
    return e;
  }, [form]);

  const isValid = Object.keys(errors).length === 0;

  const save = useMutation({
    mutationFn: async () => {
      const payload = {
        acno: Number(form.acno),
        chqRcvDate: form.chqRcvDate || null,
        dated: form.dated || todayISO(),
        bank: form.bank,
        chqNo: form.chqNo,
        chqDate: form.chqDate,
        amount: Number(form.amount),
        chqBrBy: form.chqBrBy || null,
        rmk: form.rmk || null,
        depAcno: form.depAcno === "" ? null : Number(form.depAcno),
      };
      const res = isEdit
        ? await axios.put(`/api/accounts/checks-in-hand/${cheque.id}`, payload)
        : await axios.post("/api/accounts/checks-in-hand", payload);
      return res.data?.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["checks-in-hand"] });
      toast.success(isEdit ? "Cheque updated" : "Cheque saved");
      if (isEdit || !keepOpen) {
        onOpenChange(false);
        return;
      }
      // "Save & add another": keep the customer, bank and dates, clear the
      // cheque-specific fields — a run of cheques from one customer is the
      // normal case at this desk.
      setForm((f) => ({ ...f, chqNo: "", chqDate: "", amount: "", rmk: "" }));
    },
    onError: (err) => {
      toast.error(err?.response?.data?.error || "Could not save the cheque");
    },
  });

  const submit = (again) => {
    if (!isValid) {
      toast.error(Object.values(errors)[0]);
      return;
    }
    setKeepOpen(Boolean(again));
    save.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className={cn(DIALOG, "sm:max-w-[760px]")}>
        <DialogHeader className={cn(DIALOG_HEAD, "shrink-0 pr-12 text-left sm:pr-14")}>
          <DialogTitle className="flex flex-wrap items-center gap-2 text-primary">
            {isEdit ? "Edit Cheque" : "New Cheque In Hand"}
            {isEdit && (
              <Chip tone={cheque.status === CHECK_STATUS.CLEARED ? "ok" : "warn"}>
                {cheque.status === CHECK_STATUS.CLEARED ? "Cleared" : "Pending"}
              </Chip>
            )}
          </DialogTitle>
          <DialogDescription>
            {isEdit
              ? "Correct the cheque details. Flip the status switch on the list to mark it deposited."
              : "Recorded as Pending. Flip the status switch on the list once it is deposited."}
          </DialogDescription>
        </DialogHeader>

        <div className={cn(DIALOG_BODY, "grid content-start gap-6")}>
          {/* -- Party -------------------------------------------------- */}
          <section className="grid gap-2">
            <SectionLabel>Customer</SectionLabel>
            <Label htmlFor="cih-customer" className="sr-only">
              Customer
            </Label>
            <CustomerCombobox
              id="cih-customer"
              value={form.acno}
              onChange={(acno, customer) =>
                set({ acno, customerName: customer?.acname ?? "" })
              }
            />
          </section>

          {/* -- Cheque ------------------------------------------------- */}
          <section className="grid gap-3">
            <SectionLabel>Cheque details</SectionLabel>
            <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
              <div className="grid gap-1.5">
                <Label htmlFor="cih-bank">
                  Bank Drawn <span className="text-destructive">*</span>
                </Label>
                <BankCombobox
                  id="cih-bank"
                  value={form.bank}
                  onChange={(bank) => set({ bank })}
                />
                <p className="text-[11px] leading-snug text-muted-foreground">
                  The customer&apos;s own bank, printed on the cheque. Type a new
                  one once &mdash; it is saved in caps and offered next time.
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="cih-chqno">
                  Cheque No. <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="cih-chqno"
                  value={form.chqNo}
                  maxLength={25}
                  autoComplete="off"
                  placeholder="e.g. 42528859"
                  className="h-10 uppercase font-mono tracking-wide"
                  onChange={(e) => set({ chqNo: e.target.value.toUpperCase() })}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="cih-chqdate">
                  Cheque Date <span className="text-destructive">*</span>
                </Label>
                <DateField
                  id="cih-chqdate"
                  value={form.chqDate}
                  onChange={(chqDate) => set({ chqDate })}
                  inputClassName="h-10"
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="cih-amount">
                  Amount <span className="text-destructive">*</span>
                </Label>
                {/* Text, not number: `type="number"` rejects the commas.
                    State keeps the raw digits, the field shows them grouped. */}
                <Input
                  id="cih-amount"
                  type="text"
                  inputMode="decimal"
                  autoComplete="off"
                  value={formatAmountInput(form.amount)}
                  placeholder="0.00"
                  className="h-10 text-right tabular-nums"
                  onChange={(e) => set({ amount: parseAmountInput(e.target.value) })}
                />
                <p className="min-h-[15px] text-right text-[11px] tabular-nums text-muted-foreground">
                  {Number(form.amount) > 0
                    ? Number(form.amount).toLocaleString("en-PK", {
                        minimumFractionDigits: 2,
                        maximumFractionDigits: 2,
                      })
                    : ""}
                </p>
              </div>
            </div>
          </section>

          {/* -- Transfer / handling ------------------------------------ */}
          <section className="grid gap-3">
            <SectionLabel>Transfer &amp; handling</SectionLabel>
            <div className="grid grid-cols-1 gap-x-4 gap-y-4 sm:grid-cols-2">
              <div className="grid gap-1.5 sm:col-span-2">
                <Label htmlFor="cih-depbank">Transfer To Bank</Label>
                <TransferBankCombobox
                  id="cih-depbank"
                  value={form.depAcno}
                  onChange={(depAcno) => set({ depAcno })}
                />
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Our own bank account the cheque is transferred / deposited
                  into. Optional &mdash; leave it blank while the cheque is still
                  in hand.
                </p>
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="cih-rcvdate">Received On</Label>
                <DateField
                  id="cih-rcvdate"
                  clearable
                  value={form.chqRcvDate}
                  onChange={(chqRcvDate) => set({ chqRcvDate })}
                  inputClassName="h-10"
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="cih-dated">Entry Date</Label>
                <DateField
                  id="cih-dated"
                  value={form.dated}
                  onChange={(dated) => set({ dated })}
                  inputClassName="h-10"
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="cih-broughtby">Brought By</Label>
                <Input
                  id="cih-broughtby"
                  value={form.chqBrBy}
                  maxLength={50}
                  autoComplete="off"
                  placeholder="Person / courier"
                  className="h-10 uppercase"
                  onChange={(e) => set({ chqBrBy: e.target.value.toUpperCase() })}
                />
              </div>

              <div className="grid gap-1.5">
                <Label htmlFor="cih-rmk">Remarks</Label>
                <Input
                  id="cih-rmk"
                  value={form.rmk}
                  maxLength={50}
                  autoComplete="off"
                  placeholder="e.g. FUND TRANSFER"
                  className="h-10 uppercase"
                  onChange={(e) => set({ rmk: e.target.value.toUpperCase() })}
                />
              </div>
            </div>
          </section>

          {!isEdit && (
            <div className="flex items-start gap-2 rounded-lg border border-primary/15 bg-primary/5 px-3 py-2.5 text-[12px] leading-snug text-foreground">
              <Info className="mt-[1px] h-4 w-4 shrink-0 text-primary" />
              <span>
                Saved as <strong>PENDING</strong> with no deposit date. Flip the
                switch on the list when it is deposited &mdash; the deposit date
                is stamped for you.
              </span>
            </div>
          )}

          {isEdit && cheque?.depDate && (
            <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 px-3 py-2.5 text-[12px] text-foreground">
              <CalendarCheck2 className="h-4 w-4 shrink-0 text-primary" />
              <span>
                Deposited on <strong>{formatDMY(cheque.depDate)}</strong>
                {cheque.depBankName ? (
                  <>
                    {" "}
                    into <strong>{cheque.depBankName}</strong>
                  </>
                ) : null}
              </span>
            </div>
          )}
        </div>

        <DialogFooter className={cn(DIALOG_FOOT, "shrink-0 sm:space-x-0")}>
          <Button
            type="button"
            variant="ghost"
            onClick={() => onOpenChange(false)}
            disabled={save.isPending}
          >
            Cancel
          </Button>

          {!isEdit && (
            <Button
              type="button"
              variant="outline"
              onClick={() => submit(true)}
              disabled={!isValid || save.isPending}
            >
              {save.isPending && keepOpen ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <PlusCircle className="h-4 w-4" />
              )}
              Save &amp; add another
            </Button>
          )}

          <Button
            type="button"
            onClick={() => submit(false)}
            disabled={!isValid || save.isPending}
          >
            {save.isPending && !keepOpen ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Save className="h-4 w-4" />
            )}
            {isEdit ? "Save changes" : "Save cheque"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SectionLabel({ children }) {
  return (
    <span className="text-[11px] font-semibold uppercase tracking-wide text-primary">
      {children}
    </span>
  );
}
