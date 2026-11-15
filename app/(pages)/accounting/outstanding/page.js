"use client";

import { useState, useEffect } from "react";
import {
  CASH_BANK_GROUP_PARAM,
  CUSTOMER_GROUP_PARAM,
  VENDOR_GROUP_PARAM,
} from "@/lib/accounts/groupParams";
import ReactSelect from "react-select";
import { useFifoAllocation } from "@/hooks/useFifoAllocation";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { Skeleton } from "@/components/ui/skeleton";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  Calendar as CalendarIcon,
  Receipt,
  User,
  Building2,
  DollarSign,
  Save,
  CheckCircle,
  Search,
  Calculator,
  ChevronRight,
  AlertCircle,
  AlertTriangle,
  CreditCard,
  FileText,
  ArrowDownCircle,
  ArrowUpCircle,
  ExternalLink,
  Loader2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { format } from "date-fns";
import { cn } from "@/lib/utils";
import axios from "axios";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { TooltipProvider } from "@/components/ui/tooltip";
import { Progress } from "@/components/ui/progress";
import { selectStyles } from "@/components/shared/EntityFormPanel";
import { voucherHref } from "@/lib/vouchers/voucherLink";
import {
  LabHeader,
  LabCard,
  LabStat,
  LabEmpty,
  Chip,
  CODE_CHIP,
  TH_ROW,
  TH,
  TD,
  NUM,
  TOTAL_ROW,
  DIALOG,
  DIALOG_HEAD,
  DIALOG_BODY,
  DIALOG_FOOT,
} from "@/components/Material/shared/LabUI";

// ============================================================
// Party-type configuration
// A single screen drives two mirrored flows:
//   customer -> settle Sale Invoices (receivables) via a Receipt (tran_code 1)
//   vendor   -> settle Purchase Invoices (payables) via a Payment (tran_code 2)
// ============================================================
const PARTY_CONFIG = {
  customer: {
    label: "Customer",
    partyLabel: "Customer",
    partyGroupParam: CUSTOMER_GROUP_PARAM,
    bankLabel: "Received In",
    amountLabel: "Received Amount",
    actionVerb: "Receipt",
    actionTitle: "Generate Receipt",
    endpoint: "/api/voucher/receipt",
    tranCode: 1,
    // The customer is credited (camt) to reduce the receivable.
    side: "camt",
    icon: ArrowDownCircle,
  },
  vendor: {
    label: "Vendor",
    partyLabel: "Vendor",
    partyGroupParam: VENDOR_GROUP_PARAM,
    bankLabel: "Paid From",
    amountLabel: "Paid Amount",
    actionVerb: "Payment",
    actionTitle: "Generate Payment",
    endpoint: "/api/voucher/payment",
    tranCode: 2,
    // The vendor is debited (damt) to reduce the payable.
    side: "damt",
    icon: ArrowUpCircle,
  },
};

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

// ReactSelect wrapper (fixes hydration; shared maroon select look)
const Select = (props) => {
  const [isMounted, setIsMounted] = useState(false);
  useEffect(() => setIsMounted(true), []);
  if (!isMounted) {
    return <div className="h-10 animate-pulse rounded-lg bg-muted" />;
  }
  return (
    <ReactSelect
      {...props}
      className="react-select-container"
      classNamePrefix="react-select"
      menuPortalTarget={document.body}
      styles={selectStyles(false)}
    />
  );
};

export default function AutoFifoSettlement() {
  const queryClient = useQueryClient();
  const router = useRouter();

  // Flow selection
  const [partyType, setPartyType] = useState("customer");
  const config = PARTY_CONFIG[partyType];

  // Form state
  const [voucherDate, setVoucherDate] = useState(new Date());
  const [party, setParty] = useState(null);
  const [bankCash, setBankCash] = useState(null);
  const [amount, setAmount] = useState("");
  const [narration, setNarration] = useState("");

  // Dialogs
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [successOpen, setSuccessOpen] = useState(false);
  const [generatedVoucher, setGeneratedVoucher] = useState(null);

  // FIFO allocation engine (shared with the Knock-Off Review page)
  const {
    outstandingInvoices,
    dataLoaded,
    loadInvoices: loadInvoicesFromRows,
    handleToggle,
    handleManualAmount,
    reset: resetAllocation,
    selectedInvoices,
    totalAllocated,
    totalOutstanding,
    enteredAmount,
    unallocated,
    exceedsOutstanding,
    utilization,
  } = useFifoAllocation(amount);

  // ── Account lists ─────────────────────────────────────────
  // Bank / Cash accounts (where money is received-in / paid-from)
  // Every cash and bank account (the "Cash & Bank" group of Finance → Account Settings)
  const { data: bankCashData } = useQuery({
    queryKey: ["bankCashAccounts"],
    queryFn: async () => {
      const res = await axios.get(
        `/api/accounts/acno?${CASH_BANK_GROUP_PARAM}`
      );
      return res.data?.data || [];
    },
    onError: () => toast.error("Failed to load bank/cash accounts"),
    staleTime: 5 * 60 * 1000,
  });

  // Party accounts depend on the selected flow (customer vs vendor)
  const { data: partyData } = useQuery({
    queryKey: ["partyAccounts", config.partyGroupParam],
    queryFn: async () => {
      const res = await axios.get(
        `/api/accounts/acno?${config.partyGroupParam}`,
      );
      return res.data?.data || [];
    },
    onError: () => toast.error(`Failed to load ${config.partyLabel} accounts`),
    staleTime: 5 * 60 * 1000,
  });

  const toOptions = (list) =>
    (list || []).map((a) => ({
      value: a.acno,
      label: `${a.acname}${a.code ? ` (${a.code})` : ""}`,
      ...a,
    }));

  const bankCashOptions = toOptions(bankCashData);
  const partyOptions = toOptions(partyData);

  // ── Load outstanding invoices ─────────────────────────────
  const loadMutation = useMutation({
    mutationFn: async () => {
      const res = await axios.get(
        `/api/voucher/outstanding?type=${partyType}&account=${party.value}`,
      );
      return res.data?.data || [];
    },
    onSuccess: (rows) => {
      const count = loadInvoicesFromRows(rows);
      toast.success(`Loaded ${count} outstanding invoices.`);
    },
    onError: (err) => {
      console.error("Failed to load outstanding invoices:", err);
      toast.error("Failed to load outstanding invoices");
    },
  });

  const loadInvoices = () => {
    if (!party) {
      toast.warning(`Please select a ${config.partyLabel} first.`);
      return;
    }
    loadMutation.mutate();
  };

  // ── Reset on flow / party change ──────────────────────────
  const switchPartyType = (type) => {
    if (type === partyType) return;
    setPartyType(type);
    setParty(null);
    setBankCash(null);
    resetAllocation();
  };

  // ── Posting ───────────────────────────────────────────────
  const postMutation = useMutation({
    mutationFn: async () => {
      const master = {
        tran_code: config.tranCode,
        dated: voucherDate,
        time: new Date(),
        pycd: Number(bankCash.value),
        rmk:
          narration ||
          `${config.actionVerb} against invoices: ${selectedInvoices
            .map((i) => i.invoiceNo)
            .join(", ")}`,
        // user_id ("Entered by") is set by the voucher route from the session.
      };
      const lines = selectedInvoices.map((inv) => ({
        acno: { value: Number(party.value) },
        damt: config.side === "damt" ? round2(inv.amountAdjusted) : 0,
        camt: config.side === "camt" ? round2(inv.amountAdjusted) : 0,
        narration1: `${config.actionVerb} against Invoice ${inv.invoiceNo}`,
        invoice_no: inv.invoiceNo,
        sub_tran_id: 1,
      }));
      const res = await axios.post(config.endpoint, { master, lines });
      return res.data;
    },
    onSuccess: (result) => {
      setConfirmOpen(false);
      setGeneratedVoucher({
        voucherId: result?.voucherId || null,
        vrNo: result?.vrNo || result?.data?.vrNo || result?.voucherId || null,
        invoiceCount: selectedInvoices.length,
        totalAmount: totalAllocated,
        actionVerb: config.actionVerb,
        tranCode: config.tranCode,
        partyName: party?.label,
      });
      setSuccessOpen(true);
      toast.success(`${config.actionVerb} voucher created successfully!`, {
        description: `Settled ${selectedInvoices.length} invoice(s)`,
      });

      // Reset for the next entry
      setAmount("");
      setNarration("");
      resetAllocation();
      queryClient.invalidateQueries({ queryKey: ["partyAccounts"] });
    },
    onError: (err) => {
      console.error(`Error creating ${config.actionVerb} voucher:`, err);
      toast.error(
        `Failed to create ${config.actionVerb} voucher: ` +
        (err?.response?.data?.message || err.message || ""),
      );
    },
  });

  const handleGenerate = () => {
    if (!party) return toast.error(`Please select a ${config.partyLabel}.`);
    if (!bankCash) return toast.error(`Please select the ${config.bankLabel} account.`);
    if (!voucherDate) return toast.error("Please select a date.");
    if (enteredAmount <= 0) return toast.error("Please enter an amount.");
    if (selectedInvoices.length === 0)
      return toast.warning("No invoices are allocated. Enter an amount or select invoices.");
    if (exceedsOutstanding) {
      return toast.error(
        `Amount ${formatCurrency(enteredAmount)} exceeds total outstanding ${formatCurrency(totalOutstanding)}. Lower the amount.`,
      );
    }
    setConfirmOpen(true);
  };

  // ── Utils ─────────────────────────────────────────────────
  function formatCurrency(value) {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: "PKR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(Number(value || 0));
  }

  const FlowIcon = config.icon;
  const generatedHref = generatedVoucher
    ? voucherHref({ tran_code: generatedVoucher.tranCode, tran_id: generatedVoucher.voucherId })
    : null;

  return (
    <TooltipProvider>
      <div className="min-h-screen bg-muted/40">
        <div className="mx-auto max-w-[1600px] space-y-4 px-3 py-5 sm:px-6">
          {/* Header + Customer / Vendor switch */}
          <LabHeader
            icon={Calculator}
            breadcrumb="Accounting"
            title="Auto FIFO Settlement"
            subtitle="Customer receipts & vendor payments — auto-allocated oldest first"
            actions={
              <div
                role="tablist"
                aria-label="Party type"
                className="flex w-full items-center gap-1 rounded-lg border border-border bg-background p-1 sm:w-auto"
              >
                {Object.entries(PARTY_CONFIG).map(([key, cfg]) => {
                  const Icon = cfg.icon;
                  const active = partyType === key;
                  return (
                    <button
                      key={key}
                      type="button"
                      role="tab"
                      aria-selected={active}
                      onClick={() => switchPartyType(key)}
                      className={cn(
                        "flex flex-1 items-center justify-center gap-2 rounded-md px-4 py-2 text-sm font-semibold transition-colors sm:flex-none",
                        active
                          ? "bg-primary text-primary-foreground shadow-sm"
                          : "text-muted-foreground hover:bg-muted hover:text-foreground",
                      )}
                    >
                      <Icon className="h-4 w-4" />
                      {cfg.label}
                    </button>
                  );
                })}
              </div>
            }
          />

          {/* Quick stats */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <LabStat label={config.amountLabel} value={formatCurrency(enteredAmount)} icon={DollarSign} tone="brand" />
            <div className="rounded-xl border border-border bg-background px-4 py-3">
              <p className="text-[12px] text-muted-foreground">Allocated (FIFO)</p>
              <p className="text-xl font-semibold tabular-nums text-foreground">{formatCurrency(totalAllocated)}</p>
              <Progress value={utilization} className="mt-2 h-1.5" />
            </div>
            <LabStat label="Invoices Selected" value={selectedInvoices.length} icon={FileText} tone="muted" />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-12">
            {/* Left — configuration */}
            <div className="lg:col-span-4">
              <div className="space-y-4 lg:sticky lg:top-6">
                <LabCard title={`${config.actionVerb} Configuration`} icon={CreditCard} bodyClassName="space-y-4 p-4">
                  {/* Party */}
                  <div className="space-y-1.5">
                    <Label className="flex items-center text-sm font-semibold text-foreground">
                      {partyType === "vendor" ? (
                        <Building2 className="mr-2 h-4 w-4 text-primary" />
                      ) : (
                        <User className="mr-2 h-4 w-4 text-primary" />
                      )}
                      {config.partyLabel}
                      <span className="ml-1 text-destructive">*</span>
                    </Label>
                    <Select
                      value={party}
                      onChange={(val) => {
                        setParty(val);
                        resetAllocation();
                      }}
                      options={partyOptions}
                      placeholder={`Select ${config.partyLabel.toLowerCase()}...`}
                      isClearable
                    />
                  </div>

                  {/* Bank / Cash */}
                  <div className="space-y-1.5">
                    <Label className="text-sm font-semibold text-foreground">
                      {config.bankLabel} (Bank / Cash)
                      <span className="ml-1 text-destructive">*</span>
                    </Label>
                    <Select
                      value={bankCash}
                      onChange={setBankCash}
                      options={bankCashOptions}
                      placeholder="Select bank / cash account..."
                      isClearable
                    />
                  </div>

                  {/* Date + Amount */}
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-1 xl:grid-cols-2">
                    <div className="space-y-1.5">
                      <Label className="text-sm font-semibold text-foreground">Date</Label>
                      <Popover>
                        <PopoverTrigger asChild>
                          <Button
                            variant="outline"
                            className={cn(
                              "h-10 w-full justify-start text-left font-normal",
                              !voucherDate && "text-muted-foreground",
                            )}
                          >
                            <CalendarIcon className="mr-2 h-4 w-4 text-muted-foreground" />
                            {voucherDate ? format(voucherDate, "MMM dd, yyyy") : "Select date"}
                          </Button>
                        </PopoverTrigger>
                        <PopoverContent className="w-auto p-0" align="start">
                          <Calendar
                            mode="single"
                            selected={voucherDate}
                            onSelect={setVoucherDate}
                            initialFocus
                            className="rounded-md border"
                          />
                        </PopoverContent>
                      </Popover>
                    </div>

                    <div className="space-y-1.5">
                      <Label className="text-sm font-semibold text-foreground">{config.amountLabel}</Label>
                      <div className="relative">
                        <DollarSign className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                        <Input
                          type="number"
                          placeholder="0.00"
                          value={amount}
                          onChange={(e) => setAmount(e.target.value)}
                          className="h-10 pl-10 text-right tabular-nums"
                        />
                      </div>
                    </div>
                  </div>

                  {/* Narration */}
                  <div className="space-y-1.5">
                    <Label className="text-sm font-semibold text-foreground">Narration</Label>
                    <Input
                      placeholder="Optional notes..."
                      value={narration}
                      onChange={(e) => setNarration(e.target.value)}
                      className="h-10"
                    />
                  </div>

                  <Button
                    onClick={loadInvoices}
                    disabled={!party || loadMutation.isPending}
                    className="h-11 w-full text-sm font-semibold"
                  >
                    {loadMutation.isPending ? (
                      <>
                        <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                        Loading...
                      </>
                    ) : (
                      <>
                        <Search className="mr-2 h-4 w-4" />
                        Fetch Outstanding Invoices
                        <ChevronRight className="ml-1 h-4 w-4" />
                      </>
                    )}
                  </Button>

                  {dataLoaded && (
                    <div
                      className={cn(
                        "rounded-lg border p-3",
                        exceedsOutstanding
                          ? "border-destructive/30 bg-destructive/10"
                          : "border-border bg-muted/40",
                      )}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div>
                          <p
                            className={cn(
                              "text-sm font-semibold",
                              exceedsOutstanding ? "text-destructive" : "text-foreground",
                            )}
                          >
                            Total Outstanding
                          </p>
                          <p className="text-xs tabular-nums text-muted-foreground">
                            {outstandingInvoices.length} invoice(s) · {formatCurrency(totalOutstanding)}
                          </p>
                        </div>
                        {exceedsOutstanding ? (
                          <AlertTriangle className="h-5 w-5 text-destructive" />
                        ) : (
                          <CheckCircle className="h-5 w-5 text-primary" />
                        )}
                      </div>
                      {exceedsOutstanding && (
                        <p className="mt-2 text-xs text-destructive">
                          Entered amount exceeds total outstanding. Lower it to continue.
                        </p>
                      )}
                    </div>
                  )}
                </LabCard>
              </div>
            </div>

            {/* Right — invoices */}
            <div className="min-w-0 lg:col-span-8">
              {dataLoaded ? (
                <div className="space-y-4">
                  {/* Summary tiles */}
                  <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
                    <SummaryCard label="Total Outstanding" value={formatCurrency(totalOutstanding)} sub={`${outstandingInvoices.length} invoices`} />
                    <SummaryCard label="Allocated (FIFO)" value={formatCurrency(totalAllocated)} sub={`${selectedInvoices.length} selected`} />
                    <SummaryCard
                      label={unallocated >= 0 ? "Unallocated" : "Over-allocated"}
                      value={formatCurrency(Math.abs(unallocated))}
                      sub={unallocated >= 0 ? "Left from amount" : "Exceeds amount"}
                      danger={unallocated < 0}
                    />
                    <SummaryCard label="Utilization" value={`${utilization.toFixed(1)}%`} sub="Amount used" />
                  </div>

                  <LabCard
                    title={`Outstanding ${partyType === "vendor" ? "Purchase" : "Sale"} Invoices`}
                    subtitle={`${outstandingInvoices.length} invoices · ${formatCurrency(enteredAmount)} ${config.amountLabel.toLowerCase()} auto-allocated oldest first`}
                    icon={Receipt}
                  >
                    {outstandingInvoices.length === 0 ? (
                      <LabEmpty
                        icon={Receipt}
                        title="No Outstanding Invoices"
                        hint={`All invoices are settled for this ${config.partyLabel.toLowerCase()}.`}
                      />
                    ) : (
                      <div className="md:max-h-[520px] md:overflow-auto">
                        <table className="vl-grid w-full text-sm md:min-w-[720px]">
                          <thead>
                            <tr className={TH_ROW}>
                              <th className={cn(TH, "w-10")}>
                                <span className="sr-only">Select</span>
                              </th>
                              <th className={TH}>Date</th>
                              <th className={TH}>Invoice #</th>
                              <th className={cn(TH, "text-center")}>Age</th>
                              <th className={cn(TH, "text-right")}>Due Amount</th>
                              <th className={cn(TH, "text-right")}>Allocated</th>
                              <th className={cn(TH, "text-right")}>Balance After</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-border">
                            {outstandingInvoices.map((inv) => (
                              <tr
                                key={inv.id}
                                className={cn("transition-colors", inv.selected ? "bg-primary/5" : "hover:bg-muted/50")}
                              >
                                <td className={cn(TD, "vl-check")}>
                                  <label className="flex items-center gap-2">
                                    <Checkbox
                                      checked={inv.selected}
                                      onCheckedChange={(checked) => handleToggle(inv.id, checked)}
                                      aria-label={`Select invoice ${inv.invoiceNo}`}
                                    />
                                    <span className="text-xs font-semibold text-muted-foreground md:hidden">
                                      {inv.selected ? "Selected" : "Select"}
                                    </span>
                                  </label>
                                </td>
                                <td data-label="Date" className={cn(TD, "whitespace-nowrap tabular-nums")}>
                                  {format(inv.invoiceDate, "MMM dd, yyyy")}
                                </td>
                                <td data-label="Invoice #" className={TD}>
                                  <span className={CODE_CHIP}>{inv.invoiceNo}</span>
                                  {inv.alreadyPaid > 0 && (
                                    <div className="mt-0.5 text-xs tabular-nums text-muted-foreground">
                                      Paid: {formatCurrency(inv.alreadyPaid)}
                                    </div>
                                  )}
                                </td>
                                <td data-label="Age" className={cn(TD, "md:text-center")}>
                                  <Chip
                                    tone={inv.daysOutstanding > 60 ? "bad" : inv.daysOutstanding > 30 ? "warn" : "ok"}
                                    className="tabular-nums"
                                  >
                                    {inv.daysOutstanding}d
                                  </Chip>
                                </td>
                                <td data-label="Due amount" className={cn(TD, NUM, "font-semibold text-foreground")}>
                                  {formatCurrency(inv.amountReceivable)}
                                </td>
                                <td data-label="Allocated" className={cn(TD, "md:text-right")}>
                                  <Input
                                    type="number"
                                    value={inv.amountAdjusted || ""}
                                    onChange={(e) => handleManualAmount(inv.id, e.target.value)}
                                    className={cn(
                                      "h-9 w-full text-right tabular-nums md:ml-auto md:w-32",
                                      inv.selected && inv.amountAdjusted > 0 &&
                                      "border-primary/40 bg-primary/5 font-semibold",
                                    )}
                                    placeholder="0"
                                    aria-label={`Allocated to ${inv.invoiceNo}`}
                                  />
                                </td>
                                <td data-label="Balance after" className={cn(TD, NUM, "font-semibold text-foreground")}>
                                  {formatCurrency(inv.balanceAfter)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                          <tfoot className="max-md:block">
                            <tr className={cn(TOTAL_ROW, "max-md:grid max-md:grid-cols-2 max-md:gap-2 max-md:px-3.5 max-md:py-2.5")}>
                              <td colSpan={4} className={cn(TD, "max-md:col-span-2 max-md:p-0")}>
                                Total · {outstandingInvoices.length} invoices
                              </td>
                              <td className={cn(TD, NUM, "max-md:p-0 max-md:text-left")}>
                                <span className="text-[10.5px] font-bold uppercase text-muted-foreground md:hidden">Due </span>
                                {formatCurrency(totalOutstanding)}
                              </td>
                              <td className={cn(TD, NUM, "max-md:p-0 max-md:text-left")}>
                                <span className="text-[10.5px] font-bold uppercase text-muted-foreground md:hidden">Allocated </span>
                                {formatCurrency(totalAllocated)}
                              </td>
                              <td className="max-md:hidden" />
                            </tr>
                          </tfoot>
                        </table>
                      </div>
                    )}
                  </LabCard>

                  {/* Sticky action bar — always in reach while scrolling the invoices */}
                  <div className="sticky bottom-0 z-20 -mx-3 flex flex-wrap items-center gap-3 border-t border-border bg-background/95 px-3 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:mx-0 sm:rounded-xl sm:border sm:px-4">
                    <div className="min-w-0 flex-1 text-sm">
                      <p className="font-semibold text-foreground">
                        {selectedInvoices.length} invoice{selectedInvoices.length === 1 ? "" : "s"} selected
                      </p>
                      <p className="tabular-nums text-muted-foreground">
                        {formatCurrency(totalAllocated)} of {formatCurrency(enteredAmount)}
                      </p>
                    </div>
                    <Button
                      onClick={handleGenerate}
                      disabled={postMutation.isPending || selectedInvoices.length === 0 || exceedsOutstanding}
                      className="h-10 max-sm:w-full"
                    >
                      {exceedsOutstanding ? (
                        <>
                          <AlertTriangle className="mr-2 h-4 w-4" />
                          Amount Too High
                        </>
                      ) : selectedInvoices.length === 0 ? (
                        <>
                          <AlertCircle className="mr-2 h-4 w-4" />
                          Enter an Amount
                        </>
                      ) : (
                        <>
                          <Save className="mr-2 h-4 w-4" />
                          {config.actionTitle}
                          <ChevronRight className="ml-1 h-4 w-4" />
                        </>
                      )}
                    </Button>
                  </div>
                </div>
              ) : (
                <section className="rounded-xl border border-border bg-background">
                  {loadMutation.isPending ? (
                    <div className="space-y-2 p-4">
                      {Array.from({ length: 6 }).map((_, i) => (
                        <Skeleton key={i} className="h-10 w-full" />
                      ))}
                    </div>
                  ) : (
                    <LabEmpty
                      icon={FlowIcon}
                      title={`${partyType === "vendor" ? "Vendor Payment" : "Customer Receipt"} — FIFO`}
                      hint={`Select a ${config.partyLabel.toLowerCase()}, enter the ${config.amountLabel.toLowerCase()}, and load invoices. The system auto-allocates the amount to the oldest outstanding invoices first, then asks you to confirm.`}
                    />
                  )}
                </section>
              )}
            </div>
          </div>
        </div>

        {/* Confirmation dialog */}
        <Dialog open={confirmOpen} onOpenChange={setConfirmOpen}>
          <DialogContent className={cn(DIALOG, "sm:max-w-[640px]")}>
            <DialogHeader className={cn(DIALOG_HEAD, "pr-12 text-left")}>
              <DialogTitle className="flex items-center gap-2 text-primary">
                <FlowIcon className="h-5 w-5" />
                Confirm {config.actionVerb}
              </DialogTitle>
              <DialogDescription>Review the FIFO allocation before posting</DialogDescription>
            </DialogHeader>

            <div className={cn(DIALOG_BODY, "space-y-4")}>
              <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2">
                <InfoRow label={config.partyLabel} value={party?.label} />
                <InfoRow label={config.bankLabel} value={bankCash?.label} />
                <InfoRow label="Date" value={voucherDate ? format(voucherDate, "MMM dd, yyyy") : "-"} />
                <InfoRow label={config.amountLabel} value={formatCurrency(enteredAmount)} />
              </div>

              <div className="overflow-hidden rounded-lg border border-border">
                <table className="w-full text-sm">
                  <thead>
                    <tr className={TH_ROW}>
                      <th className={TH}>Invoice #</th>
                      <th className={cn(TH, "text-right")}>Due</th>
                      <th className={cn(TH, "text-right")}>Settling</th>
                      <th className={cn(TH, "text-right")}>Balance</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {selectedInvoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="px-3 py-2">
                          <span className={CODE_CHIP}>{inv.invoiceNo}</span>
                        </td>
                        <td className={cn("px-3 py-2", NUM)}>{formatCurrency(inv.amountReceivable)}</td>
                        <td className={cn("px-3 py-2 font-semibold text-primary", NUM)}>
                          {formatCurrency(inv.amountAdjusted)}
                        </td>
                        <td className={cn("px-3 py-2", NUM)}>{formatCurrency(inv.balanceAfter)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-primary/20 bg-primary/5 p-3">
                <span className="text-sm font-medium text-foreground">
                  Total {config.actionVerb} ({selectedInvoices.length} invoices)
                </span>
                <span className="text-lg font-bold tabular-nums text-primary">
                  {formatCurrency(totalAllocated)}
                </span>
              </div>

              {unallocated > 0.01 && (
                <p className="flex items-center gap-1 text-xs text-muted-foreground">
                  <AlertCircle className="h-3.5 w-3.5 text-primary" />
                  {formatCurrency(unallocated)} of the entered amount is unallocated and will NOT be posted.
                </p>
              )}
            </div>

            <div className={DIALOG_FOOT}>
              <Button
                variant="outline"
                className="max-sm:flex-1"
                onClick={() => setConfirmOpen(false)}
                disabled={postMutation.isPending}
              >
                Cancel
              </Button>
              <Button
                className="max-sm:flex-1"
                onClick={() => postMutation.mutate()}
                disabled={postMutation.isPending}
              >
                {postMutation.isPending ? (
                  <>
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                    Posting...
                  </>
                ) : (
                  <>
                    <CheckCircle className="mr-2 h-4 w-4" />
                    Confirm & Post
                  </>
                )}
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* Success dialog */}
        <Dialog open={successOpen} onOpenChange={setSuccessOpen}>
          <DialogContent className={cn(DIALOG, "sm:max-w-[520px]")}>
            <DialogHeader className={cn(DIALOG_HEAD, "pr-12 text-left")}>
              <DialogTitle className="flex items-center gap-2 text-primary">
                <CheckCircle className="h-5 w-5" />
                {generatedVoucher?.actionVerb} Posted Successfully
              </DialogTitle>
              <DialogDescription>The voucher has been created</DialogDescription>
            </DialogHeader>
            <div className={cn(DIALOG_BODY, "space-y-3")}>
              {generatedVoucher && (
                <>
                  <div className="rounded-lg border border-border bg-muted/40 p-4">
                    <p className="text-sm text-muted-foreground">Voucher Reference</p>
                    <p className="font-mono text-2xl font-bold text-foreground">
                      {generatedVoucher.vrNo || "—"}
                    </p>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="rounded-lg border border-border bg-muted/40 p-4">
                      <p className="text-sm text-muted-foreground">Invoices Settled</p>
                      <p className="text-xl font-bold tabular-nums">{generatedVoucher.invoiceCount}</p>
                    </div>
                    <div className="rounded-lg border border-border bg-muted/40 p-4">
                      <p className="text-sm text-muted-foreground">Total Amount</p>
                      <p className="text-xl font-bold tabular-nums text-primary">
                        {formatCurrency(generatedVoucher.totalAmount)}
                      </p>
                    </div>
                  </div>
                </>
              )}
            </div>
            <div className={DIALOG_FOOT}>
              {generatedHref && (
                <Button variant="outline" className="max-sm:flex-1" onClick={() => router.push(generatedHref)}>
                  <ExternalLink className="mr-2 h-4 w-4" />
                  Open voucher
                </Button>
              )}
              <Button className="max-sm:flex-1" onClick={() => setSuccessOpen(false)}>
                <Receipt className="mr-2 h-4 w-4" />
                Create Another
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </TooltipProvider>
  );
}

function SummaryCard({ label, value, sub, danger }) {
  return (
    <div
      className={cn(
        "rounded-xl border px-4 py-3",
        danger ? "border-destructive/30 bg-destructive/10" : "border-border bg-background",
      )}
    >
      <p className={cn("text-[12px]", danger ? "text-destructive" : "text-muted-foreground")}>{label}</p>
      <p className={cn("truncate text-lg font-semibold tabular-nums", danger ? "text-destructive" : "text-foreground")}>
        {value}
      </p>
      {sub && <p className="text-[11.5px] text-muted-foreground">{sub}</p>}
    </div>
  );
}

function InfoRow({ label, value }) {
  return (
    <div className="min-w-0 rounded-lg border border-border bg-muted/40 p-3">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="truncate font-semibold text-foreground">{value || "—"}</p>
    </div>
  );
}
