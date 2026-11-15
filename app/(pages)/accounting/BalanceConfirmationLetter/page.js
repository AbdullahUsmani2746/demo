"use client";
// Accounting → Balance Confirmation Letter. Left: as-of date, customers,
// region and auditor. Right: the generated letters as they print. Export PDF
// downloads them; Print prints that same PDF through a hidden iframe.

import { useState, useEffect } from "react";
import { format } from "date-fns";
import { CUSTOMER_GROUP_PARAM } from "@/lib/accounts/groupParams";
import AsyncSelect from "react-select/async";
import Select from "react-select";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import {
  AlertTriangle,
  CalendarIcon,
  FileDown,
  FileTextIcon,
  Loader2,
  Mail,
  PrinterIcon,
  RefreshCw,
  SlidersHorizontal,
  UserCheck,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { selectStyles } from "@/components/shared/EntityFormPanel";
import { Chip, LabCard, LabEmpty, LabHeader } from "@/components/Material/shared/LabUI";
import {
  BalanceConfirmationPreview,
  generateBalanceConfirmationPDF,
} from "@/components/Template/BalanceConfirmation";

const REGION_OPTIONS = [
  { value: "", label: "All Regions" },
  { value: "NORTH", label: "NORTH" },
  { value: "SOUTH", label: "SOUTH" },
];

// react-select on theme tokens (works in dark mode too).
const pickerStyles = (hasError) => {
  const s = selectStyles(hasError);
  return {
    ...s,
    control: (base, state) => ({ ...s.control(base, state), backgroundColor: "hsl(var(--background))" }),
    singleValue: (base) => ({ ...base, color: "hsl(var(--foreground))" }),
    input: (base) => ({ ...base, color: "hsl(var(--foreground))" }),
    multiValue: (base) => ({ ...base, borderRadius: 6, backgroundColor: "hsl(var(--primary) / 0.1)" }),
    multiValueLabel: (base) => ({ ...base, fontSize: 12.5, color: "hsl(var(--primary))" }),
    multiValueRemove: (base) => ({
      ...base,
      color: "hsl(var(--primary))",
      ":hover": { backgroundColor: "hsl(var(--primary) / 0.15)", color: "hsl(var(--primary))" },
    }),
  };
};

export default function BalanceConfirmationLetterPage() {
  const [asOfDate, setAsOfDate] = useState(
    new Date(new Date().getFullYear(), new Date().getMonth() + 1, 0)
  );
  const [region, setRegion] = useState(REGION_OPTIONS[0]);
  const [customers, setCustomers] = useState([]);
  const [auditorName, setAuditorName] = useState("");
  const [auditorEmail, setAuditorEmail] = useState("");
  const [letters, setLetters] = useState([]);
  const [companyData, setCompanyData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState(null);
  const [generated, setGenerated] = useState(false);

  useEffect(() => {
    fetch("/api/settings/company")
      .then((res) => res.json())
      .then((json) => {
        const raw = json?.data || json;
        setCompanyData({
          ...raw,
          name: raw?.company || raw?.name,
          website: raw?.website || "www.eastalnd.com",
        });
      })
      .catch(() => setCompanyData(null));
  }, []);

  const loadCustomers = async (inputValue) => {
    const params = new URLSearchParams(CUSTOMER_GROUP_PARAM);
    if (inputValue) params.set("search", inputValue);
    const res = await fetch(`/api/accounts/acno?${params}`);
    const json = await res.json();
    const list = json?.data || json || [];
    return list.map((c) => ({
      value: c.acno,
      label: `${c.acno} - ${c.acname}`,
    }));
  };

  const buildQueryParams = () => {
    const params = new URLSearchParams();
    params.set("asOfDate", format(asOfDate, "yyyy-MM-dd"));
    if (region?.value) params.set("region", region.value);
    params.set("customer", customers.map((c) => c.value).join(","));
    params.set("auditorName", auditorName.trim());
    params.set("auditorEmail", auditorEmail.trim());
    params.set("limit", "500");
    params.set("page", "1");
    return params;
  };

  const handleGenerate = async () => {
    if (!asOfDate) {
      setError("Please select as of date.");
      return;
    }
    if (customers.length === 0) {
      setError("Please select at least one customer.");
      return;
    }
    if (!auditorName.trim()) {
      setError("Please enter auditor name.");
      return;
    }
    if (!auditorEmail.trim()) {
      setError("Please enter auditor email.");
      return;
    }

    setLoading(true);
    setError(null);
    setGenerated(false);

    try {
      const res = await fetch(
        `/api/balanceConfirmation?${buildQueryParams()}`
      );
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to generate letters");

      setLetters(json.data || []);
      setGenerated(true);
      if ((json.data || []).length === 0) {
        setError("No letters generated. Check customer selection and region filter.");
      }
    } catch (err) {
      setError(err.message || "Failed to generate letters");
      setLetters([]);
    } finally {
      setLoading(false);
    }
  };

  const handleExportPDF = async () => {
    if (!letters.length) return;
    setExporting(true);
    try {
      generateBalanceConfirmationPDF(letters, companyData, "download");
    } finally {
      setExporting(false);
    }
  };

  const handlePrint = () => {
    if (!letters.length) return;
    const doc = generateBalanceConfirmationPDF(letters, companyData, "blob");
    if (!doc) return;
    const blobUrl = URL.createObjectURL(doc);

    // Create iframe to print the exact exported PDF
    const iframe = document.createElement("iframe");
    iframe.style.position = "fixed";
    iframe.style.right = "0";
    iframe.style.bottom = "0";
    iframe.style.width = "0";
    iframe.style.height = "0";
    iframe.style.border = "0";
    iframe.src = blobUrl;

    document.body.appendChild(iframe);

    iframe.onload = () => {
      iframe.contentWindow.focus();
      iframe.contentWindow.print();
      // Clean up after printing
      setTimeout(() => {
        document.body.removeChild(iframe);
        URL.revokeObjectURL(blobUrl);
      }, 1000);
    };
  };

  const canGenerate =
    asOfDate &&
    customers.length > 0 &&
    auditorName.trim() &&
    auditorEmail.trim();

  const hasLetters = generated && letters.length > 0;

  return (
    <div className="min-h-screen bg-muted/40 print:bg-white">
      <div className="mx-auto max-w-[1600px] px-3 py-5 sm:px-6 print:max-w-none print:p-0">
        <LabHeader
          icon={FileTextIcon}
          breadcrumb="Accounting"
          title="Balance Confirmation Letter"
          subtitle="Generate audit balance confirmation letters"
          className="mb-4 print:hidden"
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(300px,400px)_minmax(0,1fr)] print:block">
          {/* Left - setup */}
          <div className="space-y-4 print:hidden">
            <LabCard title="Letter details" icon={SlidersHorizontal} bodyClassName="space-y-4 p-4">
              <div className="space-y-1.5">
                <Label className="text-[13px]">As of Date</Label>
                <Popover>
                  <PopoverTrigger asChild>
                    <Button
                      variant="outline"
                      className={cn(
                        "h-10 w-full justify-start text-left font-normal",
                        !asOfDate && "text-muted-foreground"
                      )}
                    >
                      <CalendarIcon className="mr-2 h-4 w-4 text-primary" />
                      {asOfDate ? format(asOfDate, "PPP") : "Pick a date"}
                    </Button>
                  </PopoverTrigger>
                  <PopoverContent className="w-auto p-0" align="start">
                    <Calendar
                      mode="single"
                      selected={asOfDate}
                      onSelect={setAsOfDate}
                      initialFocus
                    />
                  </PopoverContent>
                </Popover>
              </div>

              <div className="space-y-1.5">
                <Label className="flex items-center text-[13px]">
                  Customer
                  {customers.length > 0 && (
                    <span className="ml-auto text-xs font-normal text-muted-foreground">
                      {customers.length} selected
                    </span>
                  )}
                </Label>
                <AsyncSelect
                  isMulti
                  cacheOptions
                  defaultOptions
                  loadOptions={loadCustomers}
                  value={customers}
                  onChange={setCustomers}
                  placeholder="Select customer(s)..."
                  styles={pickerStyles(false)}
                  menuPortalTarget={typeof window !== "undefined" ? document.body : null}
                />
              </div>

              <div className="space-y-1.5">
                <Label className="text-[13px]">Region</Label>
                <Select
                  value={region}
                  onChange={setRegion}
                  options={REGION_OPTIONS}
                  styles={pickerStyles(false)}
                  isClearable={false}
                  menuPortalTarget={typeof window !== "undefined" ? document.body : null}
                />
              </div>
            </LabCard>

            <LabCard title="Auditor" subtitle="Printed on every letter" icon={UserCheck} bodyClassName="space-y-4 p-4">
              <div className="space-y-1.5">
                <Label htmlFor="bcl-auditor-name" className="text-[13px]">Auditor Name</Label>
                <Input
                  id="bcl-auditor-name"
                  value={auditorName}
                  onChange={(e) => setAuditorName(e.target.value)}
                  placeholder="Enter Auditor Name"
                />
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="bcl-auditor-email" className="text-[13px]">Auditor Email</Label>
                <div className="relative">
                  <Mail className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
                  <Input
                    id="bcl-auditor-email"
                    value={auditorEmail}
                    onChange={(e) => setAuditorEmail(e.target.value)}
                    placeholder="Enter Auditor Email"
                    className="pl-9"
                  />
                </div>
              </div>
            </LabCard>

            {error && (
              <div className="flex items-start gap-2 rounded-xl border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">
                <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Right - letters as they print */}
          <section className="min-w-0 overflow-clip rounded-xl border border-border bg-background print:overflow-visible print:rounded-none print:border-0">
            <div className="flex flex-wrap items-center gap-2 border-b border-primary/15 bg-primary/5 px-4 py-3 print:hidden">
              <PrinterIcon className="h-4 w-4 flex-shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                <h2 className="text-[15px] font-semibold text-primary">Preview</h2>
                <p className="text-xs text-muted-foreground">One letter per customer · A4</p>
              </div>
              {hasLetters && <Chip tone="brand">{letters.length} {letters.length === 1 ? "letter" : "letters"}</Chip>}
            </div>

            {loading ? (
              <div className="bg-muted/50 p-3 sm:p-5 print:hidden" aria-busy="true">
                <div className="mx-auto aspect-[210/297] w-full max-w-[210mm] animate-pulse rounded-sm bg-background" />
              </div>
            ) : hasLetters ? (
              <div className="max-h-[calc(100vh-220px)] space-y-8 overflow-auto bg-muted/50 p-3 sm:p-5 print:max-h-none print:space-y-0 print:overflow-visible print:bg-white print:p-0">
                {letters.map((letter) => (
                  <div
                    key={letter.acno}
                    className="print:break-after-page mb-8 print:mb-0"
                  >
                    <BalanceConfirmationPreview
                      letter={letter}
                      companyData={companyData}
                    />
                  </div>
                ))}
              </div>
            ) : (
              <div className="print:hidden">
                <LabEmpty
                  icon={FileTextIcon}
                  title={generated ? "No letters to display." : "No letters yet"}
                  hint={
                    generated
                      ? "Check the customer selection and region filter."
                      : "Fill in the letter details and auditor, then press Generate Letters."
                  }
                />
              </div>
            )}
          </section>
        </div>

        {/* Action bar */}
        <div className="sticky bottom-0 z-10 -mx-3 mt-4 border-t border-border bg-background/95 px-3 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6 print:hidden">
          <div className="flex flex-wrap items-center gap-2 max-sm:[&>button]:flex-1">
            <p className="mr-auto hidden text-sm text-muted-foreground md:block">
              {canGenerate ? (
                <>
                  As of <span className="font-semibold text-foreground">{format(asOfDate, "d MMM yyyy")}</span> ·{" "}
                  {customers.length} customer{customers.length !== 1 ? "s" : ""}
                </>
              ) : (
                "Pick customers and enter the auditor to generate"
              )}
            </p>
            <Button onClick={handleGenerate} disabled={!canGenerate || loading}>
              {loading ? (
                <>
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <RefreshCw className="mr-2 h-4 w-4" />
                  Generate Letters
                </>
              )}
            </Button>

            {hasLetters && (
              <>
                <Button
                  variant="outline"
                  onClick={handleExportPDF}
                  disabled={exporting}
                >
                  {exporting ? (
                    <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                  ) : (
                    <FileDown className="mr-2 h-4 w-4" />
                  )}
                  Export PDF
                </Button>
                <Button variant="outline" onClick={handlePrint}>
                  <PrinterIcon className="mr-2 h-4 w-4" />
                  Print
                </Button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
