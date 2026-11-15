"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useCompany } from "@/context/CompanyContext";
import { useCurrency } from "@/context/CurrencyContext";
import axios from "axios";
import { toast } from "sonner";
import jsPDF from "jspdf";
import {
  Building2,
  ChevronLeft,
  ChevronRight,
  Edit3,
  Eye,
  File,
  FileSpreadsheet,
  FileText,
  Phone,
  Plus,
  Search,
  ShoppingCart,
  SlidersHorizontal,
  Tag,
  User,
  Users,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import * as XLSX from "xlsx-js-style";
import { format } from "date-fns";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import ReactSelect from "react-select";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ChevronDown } from "lucide-react";
import { Kbd, KeyCombo } from "@/components/ui/KeyboardHint";
import useKeyboardShortcuts from "@/hooks/useKeyboardShortcuts";
import { selectStyles } from "@/components/shared/EntityFormPanel";

// ---- Shared look (system design language: maroon tokens, no washes) ----
const CodeChip = ({ children }) => (
  <span className="rounded-[5px] bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums text-primary">
    {children}
  </span>
);

const STATUS_TONE = {
  ok: "bg-[#edf2ee] text-[#2f5139]",
  warn: "bg-[#f5f0e6] text-[#5f4b1f]",
  bad: "bg-destructive/10 text-destructive",
  mute: "bg-muted text-muted-foreground",
};
const StatusChip = ({ tone = "mute", children }) => (
  <span
    className={`inline-flex h-[22px] items-center gap-1.5 whitespace-nowrap rounded-full px-2 text-xs font-semibold ${STATUS_TONE[tone] || STATUS_TONE.mute}`}
  >
    <span className="h-1.5 w-1.5 rounded-full bg-current" />
    {children}
  </span>
);

// Customer Status (free text with suggestions) → chip tone. Display only.
const customerStatusTone = (status) => {
  const s = String(status || "").trim().toUpperCase();
  if (!s || s === "ACTIVE") return "ok";
  if (s === "DEVELOPMENT") return "warn";
  if (["BAD-DEBT", "BAD-PAYMENT", "PAYMENT ISSUE"].includes(s)) return "bad";
  return "mute";
};

// A form / profile section: card with a maroon header bar.
const SectionCard = ({ id, title, hint, action, children, className = "", bodyClassName = "p-4" }) => (
  <section
    id={id}
    className={`scroll-mt-3 overflow-hidden rounded-xl border border-border bg-background ${className}`}
  >
    <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b border-primary/15 bg-primary/5 px-4 py-3">
      <h3 className="text-[15px] font-semibold text-primary">{title}</h3>
      {(hint || action) && (
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          {hint && <span>{hint}</span>}
          {action}
        </div>
      )}
    </div>
    <div className={bodyClassName}>{children}</div>
  </section>
);

const FieldLabel = ({ children, required = false, htmlFor }) => (
  <label htmlFor={htmlFor} className="mb-1 block text-[12.5px] font-semibold text-foreground/80">
    {children}
    {required && <span className="text-primary"> *</span>}
  </label>
);

// Table look: maroon header, light row rules, hover tint.
const TH_CLS =
  "whitespace-nowrap px-3 py-2.5 text-left text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground";
const TR_CLS = "border-b border-border/60 transition-colors hover:bg-primary/[0.03]";
const TD_CLS = "px-3 py-2.5 align-middle";
const ICON_BTN_CLS =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg text-primary/70 transition-colors hover:bg-primary/10 hover:text-primary";
// Two-or-three-way choice as one row of buttons (same values as the old selects).
const Segmented = ({ options, value, onChange, ariaLabel }) => (
  <div
    role="radiogroup"
    aria-label={ariaLabel}
    className="flex h-10 w-full gap-1 rounded-lg border border-input bg-background p-1"
  >
    {options.map((opt) => {
      const on = value === opt.value;
      return (
        <button
          key={String(opt.value)}
          type="button"
          role="radio"
          aria-checked={on}
          onClick={() => onChange(opt.value)}
          className={`flex-1 whitespace-nowrap rounded-md px-3 text-[13px] font-semibold transition-colors ${
            on
              ? "bg-primary text-primary-foreground shadow-sm"
              : "text-muted-foreground hover:bg-primary/5 hover:text-primary"
          }`}
        >
          {opt.label}
        </button>
      );
    })}
  </div>
);

const INPUT_CLS = "h-10";
const READONLY_CLS = "h-10 cursor-not-allowed bg-muted text-muted-foreground";

// uppercase: turn what is typed into capitals as it is typed.
// id: lets the page's "/" shortcut focus it. Enter applies the search at once.
const SearchBox = ({ id, value, onChange, placeholder, className = "", uppercase = false }) => {
  const [localValue, setLocalValue] = useState(value);

  // Sync with parent value when it changes externally
  useEffect(() => {
    setLocalValue(value);
  }, [value]);

  // Debounce the onChange callback
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localValue !== value) {
        onChange(localValue);
      }
    }, 400); // wait for a pause in typing

    return () => clearTimeout(timer);
  }, [localValue]);

  return (
    <label
      className={`flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 text-muted-foreground focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 ${className}`}
    >
      <Search className="h-4 w-4 flex-shrink-0" />
      <input
        id={id}
        value={localValue}
        onChange={(e) =>
          setLocalValue(uppercase ? e.target.value.toUpperCase() : e.target.value)
        }
        onKeyDown={(e) => {
          if (e.key === "Enter" && localValue !== value) onChange(localValue);
          if (e.key === "Escape" && localValue) {
            e.stopPropagation();
            setLocalValue("");
          }
        }}
        placeholder={placeholder}
        aria-label={placeholder || "Search"}
        className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
      />
      {localValue ? (
        <button
          type="button"
          onClick={() => setLocalValue("")}
          aria-label="Clear search"
          className="hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      ) : (
        <kbd className="hidden rounded border border-b-2 border-border px-1.5 font-mono text-[10.5px] sm:inline">
          /
        </kbd>
      )}
    </label>
  );
};

// One customer-list filter. Values are stored in capitals and the API matches
// them exactly, so it applies on Enter or when the box is left, not per key.
const FilterInput = ({ id, label, value, onApply, placeholder }) => {
  const [local, setLocal] = useState(value);
  useEffect(() => setLocal(value), [value]);
  const apply = () => local.trim() !== value && onApply(local.trim());

  return (
    <div className="min-w-0">
      <label htmlFor={id} className="mb-1 block text-[11.5px] font-semibold text-foreground/70">
        {label}
      </label>
      <input
        id={id}
        value={local}
        onChange={(e) => setLocal(e.target.value.toUpperCase())}
        onBlur={apply}
        onKeyDown={(e) => {
          if (e.key === "Enter") apply();
          if (e.key === "Escape" && local) {
            e.stopPropagation();
            setLocal("");
            onApply("");
          }
        }}
        placeholder={placeholder}
        className="h-10 w-full rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none placeholder:text-muted-foreground focus:border-primary focus:ring-2 focus:ring-primary/15"
      />
    </div>
  );
};

const filterAndSortItemOptions = (options, inputValue) => {
  if (!inputValue || !inputValue.trim()) return options;

  const query = inputValue.trim().toLowerCase();

  const getRank = (opt) => {
    const code = String(opt.code || "").trim().toLowerCase();
    const itcd = String(opt.itcd || opt.value || "").trim().toLowerCase();
    const label = String(opt.label || "").trim().toLowerCase();
    const item = String(opt.item || "").trim().toLowerCase();

    // 1. Exact match on item code (highest priority)
    if (code === query) return 1;

    // 2. Code starts with query
    if (code.startsWith(query)) return 2;

    // 3. Exact match on system ITCD
    if (itcd === query) return 3;

    // 4. ITCD starts with query
    if (itcd.startsWith(query)) return 4;

    // 5. Code token/word matches query exactly (e.g. E-256)
    const codeTokens = code.split(/[\s\-_\/]+/);
    if (codeTokens.some((t) => t === query)) return 5;
    if (codeTokens.some((t) => t.startsWith(query))) return 6;

    // 6. Label or item name starts with query
    if (label.startsWith(query) || item.startsWith(query)) return 7;

    // 7. Substring match anywhere in code, itcd, label, or item
    if (
      code.includes(query) ||
      itcd.includes(query) ||
      label.includes(query) ||
      item.includes(query)
    ) {
      return 8;
    }

    return 999; // No match
  };

  const matches = [];
  for (const opt of options) {
    const rank = getRank(opt);
    if (rank < 999) {
      matches.push({ opt, rank });
    }
  }

  matches.sort((a, b) => a.rank - b.rank);
  return matches.map((m) => m.opt);
};

const ModalForm = ({
  modalTab = "customers",
  formData,
  modalType,
  handleInputChange,
  handleSelectChange,
  macnoOptions,
  taxLawCodes,
  taxCodesLoading,
  itemOptions,
  salesPersons,
  salesError,
  setSalesError,
  currency,
  excelData,
  setExcelData,
  excelValidation,
  setExcelValidation,
  handleExcelFileUpload,
  updateExcelRow,
  removeExcelRow,
  handleImportExcelData,
  isValidating,
  isImporting,
  downloadDemoExcel,
  // Contacts Excel props
  contactsExcelData,
  setContactsExcelData,
  contactsExcelValidation,
  setContactsExcelValidation,
  handleContactsExcelFileUpload,
  updateContactsExcelRow,
  removeContactsExcelRow,
  handleImportContactsExcelData,
  isValidatingContacts,
  isImportingContacts,
  downloadContactsDemoExcel,
  // Sales Excel props
  salesExcelData,
  setSalesExcelData,
  salesExcelValidation,
  setSalesExcelValidation,
  handleSalesExcelFileUpload,
  updateSalesExcelRow,
  removeSalesExcelRow,
  handleImportSalesExcelData,
  isValidatingSales,
  isImportingSales,
  downloadSalesDemoExcel,
  selectedCustomer,
  excelError,
  excelSuccess,
  setExcelError,
  setExcelSuccess,
  contactsExcelError,
  contactsExcelSuccess,
  setContactsExcelError,
  setContactsExcelSuccess,
  salesExcelError,
  salesExcelSuccess,
  setSalesExcelError,
  setSalesExcelSuccess,
}) => {
  const [itemSearchInput, setItemSearchInput] = useState("");

  if (modalTab === "customers") {
    // Typed in capitals, exactly as before.
    const upper = (name) => (e) =>
      handleInputChange({
        target: {
          name,
          value: e.target.value.toUpperCase(),
        },
      });

    const sections = [
      { id: "cust-sec-basic", label: "Basic" },
      { id: "cust-sec-contact", label: "Contact" },
      { id: "cust-sec-address", label: "Address" },
      { id: "cust-sec-credit", label: "Credit & bank" },
      { id: "cust-sec-tax", label: "Tax" },
      { id: "cust-sec-sales", label: "Sales & recon" },
    ];
    const jumpTo = (id) =>
      document.getElementById(id)?.scrollIntoView({ behavior: "smooth", block: "start" });

    const macnoSelectOptions = macnoOptions || [];
    const salesPersonOptions = (salesPersons || []).map((sp) => ({
      value: sp.id,
      label: sp.name,
    }));
    const grid = "grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2";

    return (
      <div className="lg:grid lg:grid-cols-[170px_minmax(0,1fr)] lg:gap-5">
        {/* Section list — jump to a section (wide screens) */}
        <nav aria-label="Sections" className="hidden lg:block">
          <div className="sticky top-0 space-y-0.5">
            {sections.map((s, i) => (
              <button
                key={s.id}
                type="button"
                onClick={() => jumpTo(s.id)}
                className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-semibold text-foreground/80 transition-colors hover:bg-primary/5 hover:text-primary"
              >
                <span className="flex h-5 w-5 items-center justify-center rounded-full bg-primary/10 text-[11px] font-bold text-primary">
                  {i + 1}
                </span>
                {s.label}
              </button>
            ))}
          </div>
        </nav>

        <div className="space-y-4">
          {/* ===== BASIC ===== */}
          <SectionCard
            id="cust-sec-basic"
            title="Basic"
            hint={modalType === "add" ? "The account code is given on save" : undefined}
          >
            <div className={grid}>
              {/* Company Name - Required Field */}
              <div className="sm:col-span-2">
                <FieldLabel htmlFor="cust-acname" required>
                  Company name
                </FieldLabel>
                <Input
                  id="cust-acname"
                  name="acname"
                  value={formData.acname || ""}
                  onChange={upper("acname")}
                  placeholder="ABC CORPORATION"
                  className={INPUT_CLS}
                />
              </div>

              {/* Main Account Group - which Debtors ledger this customer belongs to.
                  Menus inside this window are not portalled to <body>: the
                  modal dialog would treat a click there as "outside". */}
              <div>
                <FieldLabel required>Account group</FieldLabel>
                <ReactSelect
                  inputId="cust-macno"
                  aria-label="Account group"
                  options={macnoSelectOptions}
                  value={
                    formData.macno
                      ? macnoSelectOptions.find(
                          (opt) => String(opt.value) === String(formData.macno)
                        ) || null
                      : null
                  }
                  onChange={(opt) => opt && handleSelectChange("macno", Number(opt.value))}
                  placeholder="Select account group"
                  classNamePrefix="react-select"
                  menuPlacement="auto"
                  // fixed: not clipped by the dialog's scroll area, still inside it for Radix
                  menuPosition="fixed"
                  styles={selectStyles(false)}
                />
              </div>

              {/* Sales Person */}
              <div>
                <FieldLabel>Sales person</FieldLabel>
                <ReactSelect
                  inputId="cust-salesArea"
                  aria-label="Sales person"
                  options={salesPersonOptions}
                  value={
                    formData.salesArea
                      ? salesPersonOptions.find(
                          (opt) => String(opt.value) === String(formData.salesArea)
                        ) || null
                      : null
                  }
                  onChange={(opt) => opt && handleSelectChange("salesArea", opt.value)}
                  placeholder="Select sales person"
                  classNamePrefix="react-select"
                  menuPlacement="auto"
                  // fixed: not clipped by the dialog's scroll area, still inside it for Radix
                  menuPosition="fixed"
                  styles={selectStyles(false)}
                />
              </div>

              <div>
                <FieldLabel htmlFor="cust-category">Category</FieldLabel>
                <Input
                  id="cust-category"
                  name="category"
                  value={formData.category || "LOCAL"}
                  onChange={upper("category")}
                  placeholder="LOCAL"
                  className={INPUT_CLS}
                />
              </div>

              <div>
                <FieldLabel>Sub category</FieldLabel>
                <Segmented
                  ariaLabel="Sub category"
                  value={formData.subCategory || ""}
                  onChange={(value) => handleSelectChange("subCategory", value)}
                  options={[
                    { value: "N", label: "North (N)" },
                    { value: "S", label: "South (S)" },
                  ]}
                />
              </div>
            </div>
          </SectionCard>

          {/* ===== CONTACT ===== */}
          <SectionCard
            id="cust-sec-contact"
            title="Contact"
            hint="More people go in Contacts after saving"
          >
            <div className={grid}>
              <div>
                <FieldLabel htmlFor="cust-contactPerson">Contact person</FieldLabel>
                <Input
                  id="cust-contactPerson"
                  name="contactPerson"
                  value={formData.contactPerson || ""}
                  onChange={handleInputChange}
                  placeholder="John Doe"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <FieldLabel htmlFor="cust-phoneFax">Phone / fax</FieldLabel>
                <Input
                  id="cust-phoneFax"
                  name="phoneFax"
                  value={formData.phoneFax || ""}
                  onChange={handleInputChange}
                  placeholder="+92 300 1234567"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <FieldLabel htmlFor="cust-email">Email</FieldLabel>
                <Input
                  id="cust-email"
                  name="email"
                  value={formData.email || ""}
                  onChange={handleInputChange}
                  placeholder="info@company.com"
                  type="email"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <FieldLabel htmlFor="cust-website">Website</FieldLabel>
                <Input
                  id="cust-website"
                  name="website"
                  value={formData.website || ""}
                  onChange={handleInputChange}
                  placeholder="www.company.com"
                  className={INPUT_CLS}
                />
              </div>
            </div>
          </SectionCard>

          {/* ===== ADDRESS ===== */}
          <SectionCard id="cust-sec-address" title="Address">
            <div className={grid}>
              <div className="sm:col-span-2">
                <FieldLabel htmlFor="cust-address">Address / shipping address</FieldLabel>
                <Input
                  id="cust-address"
                  name="address"
                  value={formData.address || ""}
                  onChange={upper("address")}
                  placeholder="123 BUSINESS STREET"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <FieldLabel htmlFor="cust-city">City</FieldLabel>
                <Input
                  id="cust-city"
                  name="city"
                  value={formData.city || ""}
                  onChange={upper("city")}
                  placeholder="KARACHI"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <FieldLabel htmlFor="cust-country">Province</FieldLabel>
                <Input
                  id="cust-country"
                  name="country"
                  value={formData.country || ""}
                  onChange={upper("country")}
                  placeholder="SINDH"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <FieldLabel htmlFor="cust-area">Area</FieldLabel>
                <Input
                  id="cust-area"
                  name="area"
                  value={formData.area || ""}
                  onChange={upper("area")}
                  placeholder="DOWNTOWN"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <FieldLabel htmlFor="cust-areaCode">Area code</FieldLabel>
                <Input
                  id="cust-areaCode"
                  name="areaCode"
                  value={formData.areaCode || ""}
                  onChange={upper("areaCode")}
                  placeholder="KHI-001"
                  className={INPUT_CLS}
                />
              </div>
              <div className="sm:col-span-2">
                <FieldLabel htmlFor="cust-customerBankAddr">
                  Bank address / invoicing address
                </FieldLabel>
                <Input
                  id="cust-customerBankAddr"
                  name="customerBankAddr"
                  value={formData.customerBankAddr || ""}
                  onChange={upper("customerBankAddr")}
                  placeholder="ADDRESS FOR INVOICES"
                  className={INPUT_CLS}
                />
              </div>
            </div>
          </SectionCard>

          {/* ===== CREDIT & BANK ===== */}
          <SectionCard
            id="cust-sec-credit"
            title="Credit & bank"
            hint="Used by sale-order approval and aging"
          >
            <div className={grid}>
              <div>
                <FieldLabel htmlFor="cust-crLimit">Credit limit</FieldLabel>
                <div className="relative">
                  <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
                    {currency?.code || "PKR"}
                  </span>
                  <Input
                    id="cust-crLimit"
                    name="crLimit"
                    value={formData.crLimit || ""}
                    onChange={handleInputChange}
                    placeholder="100000"
                    type="number"
                    className={`${INPUT_CLS} pl-12 tabular-nums`}
                  />
                </div>
              </div>
              <div>
                <FieldLabel htmlFor="cust-crDays">Credit days</FieldLabel>
                <div className="flex gap-2">
                  <Input
                    id="cust-crDays"
                    name="crDays"
                    value={formData.crDays || ""}
                    onChange={handleInputChange}
                    placeholder="30"
                    type="number"
                    aria-label="Credit days"
                    className={INPUT_CLS}
                  />
                  <Input
                    name="crDays2"
                    value={formData.crDays2 || ""}
                    onChange={handleInputChange}
                    placeholder="45"
                    type="number"
                    aria-label="Credit days 2"
                    className={INPUT_CLS}
                  />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">Credit days · Credit days 2</p>
              </div>
              <div>
                <FieldLabel htmlFor="cust-customerBank">Customer bank</FieldLabel>
                <Input
                  id="cust-customerBank"
                  name="customerBank"
                  value={formData.customerBank || ""}
                  onChange={upper("customerBank")}
                  placeholder="BANK NAME"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <FieldLabel htmlFor="cust-bankAccountNo">Bank account</FieldLabel>
                <Input
                  id="cust-bankAccountNo"
                  name="bankAccountNo"
                  value={formData.bankAccountNo || ""}
                  onChange={upper("bankAccountNo")}
                  placeholder="ACC # 0123456789"
                  className={INPUT_CLS}
                />
              </div>
            </div>
          </SectionCard>

          {/* ===== TAX ===== */}
          <SectionCard id="cust-sec-tax" title="Tax">
            <div className={grid}>
              {/* Tax Filing Status - Required */}
              <div>
                <FieldLabel required>Filing status</FieldLabel>
                <Segmented
                  ariaLabel="Filing status"
                  value={formData.tax_filing_status || ""}
                  onChange={(value) => {
                    handleSelectChange("tax_filing_status", value);
                    // Auto-set ST Rate based on filing status
                    const stRate = value === "Filer" ? 18 : 0;
                    handleSelectChange("stRate", stRate);
                  }}
                  options={[
                    { value: "Filer", label: "Filer" },
                    { value: "Non-Filer", label: "Non-Filer" },
                  ]}
                />
              </div>

              {/* ST Rate - Auto-calculated */}
              <div>
                <FieldLabel htmlFor="cust-stRate">ST rate %</FieldLabel>
                <Input
                  id="cust-stRate"
                  name="stRate"
                  value={formData.stRate || ""}
                  disabled
                  placeholder="Auto-calculated"
                  type="number"
                  className={READONLY_CLS}
                />
                <p className="mt-1 text-xs text-muted-foreground">
                  Set from the filing status (Filer 18%, Non-Filer 0%)
                </p>
              </div>

              <div>
                <FieldLabel htmlFor="cust-ntnNo">NTN number</FieldLabel>
                <Input
                  id="cust-ntnNo"
                  name="ntnNo"
                  value={formData.ntnNo || ""}
                  onChange={handleInputChange}
                  placeholder="1234567-8"
                  className={INPUT_CLS}
                />
              </div>
              <div>
                <FieldLabel htmlFor="cust-stRegNo">ST reg number</FieldLabel>
                <Input
                  id="cust-stRegNo"
                  name="stRegNo"
                  value={formData.stRegNo || ""}
                  onChange={handleInputChange}
                  placeholder="ST-123456"
                  className={INPUT_CLS}
                />
              </div>
            </div>
          </SectionCard>

          {/* ===== SALES & RECONCILIATION ===== */}
          <SectionCard
            id="cust-sec-sales"
            title="Sales & reconciliation"
            action={
              <Link
                href="/accounting/forms/salesTargets"
                className="whitespace-nowrap font-semibold text-primary hover:underline"
              >
                Manage monthly targets &rarr;
              </Link>
            }
          >
            <div className={grid}>
              {/* Customer Status */}
              <div>
                <FieldLabel htmlFor="cust-customerStatus">Customer status</FieldLabel>
                <Input
                  id="cust-customerStatus"
                  name="customerStatus"
                  list="customer-status-options"
                  value={formData.customerStatus || ""}
                  onChange={(e) =>
                    handleInputChange({
                      target: { name: "customerStatus", value: e.target.value.toUpperCase() },
                    })
                  }
                  placeholder="ACTIVE"
                  className={INPUT_CLS}
                />
                <datalist id="customer-status-options">
                  <option value="ACTIVE" />
                  <option value="DEVELOPMENT" />
                  <option value="CLOSED" />
                  <option value="BAD-DEBT" />
                  <option value="BAD-PAYMENT" />
                  <option value="PAYMENT ISSUE" />
                </datalist>
                <p className="mt-1 text-xs text-muted-foreground">
                  "BAD-DEBT" / "BAD-PAYMENT" move this customer into that category on the Sales
                  Team MIS report.
                </p>
              </div>

              {/* Official / Unofficial book - reuses isActive (the existing on/off account flag) */}
              <div>
                <FieldLabel>Official / unofficial book</FieldLabel>
                <Segmented
                  ariaLabel="Official or unofficial book"
                  value={formData.isActive !== false}
                  onChange={(checked) => handleSelectChange("isActive", checked)}
                  options={[
                    { value: true, label: "Official" },
                    { value: false, label: "Unofficial" },
                  ]}
                />
              </div>

              {/* Recon Status */}
              <div>
                <FieldLabel>Recon status</FieldLabel>
                <Segmented
                  ariaLabel="Recon status"
                  value={formData.reconStatus || ""}
                  onChange={(value) => handleSelectChange("reconStatus", value)}
                  options={[
                    { value: "DONE", label: "Done" },
                    { value: "PENDING", label: "Pending" },
                  ]}
                />
              </div>

              {/* Reconciliation Remarks */}
              <div className="sm:col-span-2">
                <FieldLabel htmlFor="cust-reconciliationRemarks">Reconciliation remarks</FieldLabel>
                <Textarea
                  id="cust-reconciliationRemarks"
                  name="reconciliationRemarks"
                  value={formData.reconciliationRemarks || ""}
                  onChange={handleInputChange}
                  placeholder="e.g. SEPTEMBER 2025 DONE"
                  className="min-h-[72px]"
                />
              </div>
            </div>
          </SectionCard>
        </div>
      </div>
    );
  }

  else if (modalTab === "party") {
    return (
      <SectionCard title="Contact details" hint="Saved under the selected customer">
        <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <FieldLabel htmlFor="contact-name" required>
              Name
            </FieldLabel>
            <div className="relative">
              <User className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="contact-name"
                name="name"
                value={formData.name || ""}
                onChange={handleInputChange}
                placeholder="Enter contact name"
                className={`${INPUT_CLS} pl-9`}
              />
            </div>
          </div>

          <div>
            <FieldLabel htmlFor="contact-designation">Designation</FieldLabel>
            <Input
              id="contact-designation"
              name="designation"
              value={formData.designation || ""}
              onChange={handleInputChange}
              placeholder="Enter designation"
              className={INPUT_CLS}
            />
          </div>

          <div>
            <FieldLabel htmlFor="contact-number" required>
              Contact number
            </FieldLabel>
            <div className="relative">
              <Phone className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                id="contact-number"
                name="contact"
                value={formData.contact || ""}
                onChange={handleInputChange}
                placeholder="+92 300 1234567"
                className={`${INPUT_CLS} pl-9`}
              />
            </div>
          </div>
        </div>
      </SectionCard>
    );
  } else if (modalTab === "sales-items") {
    return (
      <div className="space-y-4">
        {/* Error Alert - Only for Sales Items */}
        {salesError && (
          <div
            role="alert"
            className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-3"
          >
            <p className="flex-1 text-sm font-medium text-destructive">{salesError}</p>
            <button
              type="button"
              onClick={() => setSalesError(null)}
              aria-label="Dismiss"
              className="flex-shrink-0 text-destructive/70 transition-colors hover:text-destructive"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        )}

        <SectionCard title="Item rate" hint="Rate this customer is charged for the item">
          <div className="grid grid-cols-1 gap-x-4 gap-y-3.5 sm:grid-cols-2">
            {/* ---------- Item Code (React Select) ---------- */}
            <div className="sm:col-span-2">
              <FieldLabel required>Item code</FieldLabel>
              <ReactSelect
                inputId="sales-item-itcd"
                aria-label="Item code"
                options={filterAndSortItemOptions(itemOptions, itemSearchInput)}
                filterOption={() => true}
                onInputChange={(val) => setItemSearchInput(val)}
                placeholder="Select item"
                value={
                  itemOptions.find((op) => op.value === formData.itcd) || null
                }
                onChange={(selected) => {
                  setSalesError(null); // Clear error on change
                  handleInputChange({
                    target: { name: "itcd", value: selected?.value },
                  });
                }}
                className="text-sm"
                classNamePrefix="react-select"
                menuPlacement="auto"
                // fixed: not clipped by the dialog's scroll area, still inside it for Radix
                menuPosition="fixed"
                styles={selectStyles(!!salesError)}
              />
            </div>

            {/* ---------- Rate ---------- */}
            <div>
              <FieldLabel htmlFor="sales-item-rate" required>
                Rate
              </FieldLabel>
              <div className="relative">
                <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-xs font-semibold text-muted-foreground">
                  {currency?.code || "PKR"}
                </span>
                <Input
                  id="sales-item-rate"
                  name="rate"
                  value={formData.rate || ""}
                  onChange={handleInputChange}
                  placeholder="0.00"
                  type="number"
                  step="0.01"
                  className={`${INPUT_CLS} pl-12 tabular-nums`}
                />
              </div>
            </div>

            {/* ---------- GST ---------- */}
            <div>
              <FieldLabel htmlFor="sales-item-gst">GST rate (%)</FieldLabel>
              <div className="relative">
                <Input
                  id="sales-item-gst"
                  name="gst_rate"
                  value={formData.gst_rate || ""}
                  onChange={handleInputChange}
                  placeholder="0"
                  type="number"
                  step="0.01"
                  // Editable on Edit Sales Item; on Add it stays the customer's rate.
                  disabled={modalType !== "edit"}
                  className={`${modalType !== "edit" ? READONLY_CLS : INPUT_CLS} pr-9 tabular-nums`}
                />
                <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-sm text-muted-foreground">
                  %
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                {modalType !== "edit"
                  ? "Taken from the customer's ST rate"
                  : "From the customer — can be changed here"}
              </p>
            </div>
          </div>
        </SectionCard>
      </div>
    );
  } else if (modalTab === "addbyexcel") {
    return (
      <div className="space-y-6">
        {/* File Upload Section */}
        {excelData.length === 0 ? (
          <div className="space-y-4">
            <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary/[0.03] p-8 text-center transition-colors hover:border-primary">
              <div className="flex flex-col items-center gap-4">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
                  <FileSpreadsheet className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <Label htmlFor="excel-upload" className="cursor-pointer">
                    <span className="text-lg font-semibold text-primary hover:underline">
                      Click to upload Excel file
                    </span>
                    <input
                      id="excel-upload"
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={handleExcelFileUpload}
                      className="hidden"
                    />
                  </Label>
                  <p className="text-sm text-muted-foreground mt-2">
                    Supported formats: .xlsx, .xls
                  </p>
                </div>
              </div>
            </div>

            {/* Demo File Download Section */}
            <div className="rounded-xl border border-border bg-background p-5">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                    <FileText className="h-5 w-5 text-primary" />
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground mb-1">
                    Need a template?
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Download our demo Excel template to see the correct format
                    with sample data. Fill in your customer data following the
                    same structure.
                  </p>
                  <Button
                    onClick={downloadDemoExcel}
                    variant="outline"
                    className="bg-background"
                  >
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    Download Demo Template
                  </Button>
                </div>
              </div>
            </div>

            {/* Format Instructions */}
            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-primary">
                Excel Format Requirements:
              </h4>
              <ul className="text-[12.5px] text-foreground/80 space-y-1 list-disc list-inside">
                <li>First row must contain headers (column names)</li>
                <li>
                  <strong>Company Name</strong> is required for all rows
                </li>
                <li>Account Number is optional</li>
                <li>Tax Filing Status must be either "Filer" or "Non-Filer"</li>
                <li>
                  Numeric fields (Credit Days, ST Rate, etc.) should contain
                  numbers only
                </li>
                <li>Main Account Number defaults to 35 if not specified</li>
              </ul>
            </div>
          </div>
        ) : (
          <>
            {/* Summary Section */}
            <div className="rounded-xl border border-primary/15 bg-primary/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-primary">
                    Excel Data Loaded
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {excelData.length} row(s) found. Review and edit data before
                    importing.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setExcelData([]);
                    setExcelValidation({});
                  }}
                  className="bg-background"
                >
                  <X className="h-4 w-4 mr-2" />
                  Clear Data
                </Button>
              </div>
            </div>

            {/* Validation Summary */}
            {Object.keys(excelValidation).length > 0 && (
              <div className="rounded-xl border border-[#e8dcc0] bg-[#f5f0e6] p-4">
                <h3 className="font-semibold text-[#5f4b1f] mb-2">
                  Validation Results
                </h3>
                <div className="text-sm text-[#5f4b1f] space-y-1">
                  {Object.entries(excelValidation).map(
                    ([index, validation]) => (
                      <div key={index} className="flex items-start gap-2">
                        <span className="font-medium">
                          Row {parseInt(index) + 1}:
                        </span>
                        <div className="flex-1">
                          {validation.errors.length > 0 && (
                            <div className="text-destructive">
                              Errors: {validation.errors.join(", ")}
                            </div>
                          )}
                          {validation.warnings.length > 0 && (
                            <div className="text-[#8a4b0f]">
                              Warnings: {validation.warnings.join(", ")}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}

            {/* Data Table */}
            <div className="overflow-hidden rounded-xl border border-border">
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                <Table>
                  <TableHeader className="bg-primary sticky top-0 z-10">
                    <TableRow>
                      {/* <TableHead className="whitespace-nowrap text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">Row</TableHead> */}
                      <TableHead className="whitespace-nowrap text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">
                        Account No
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">
                        Company Name*
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">
                        Email
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">
                        City
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">
                        Phone/Fax
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">
                        Category
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">
                        Status
                      </TableHead>
                      <TableHead className="w-16 whitespace-nowrap text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">
                        Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {excelData.map((row, index) => {
                      const validation = excelValidation[index];
                      const hasErrors = validation?.errors?.length > 0;
                      const hasWarnings = validation?.warnings?.length > 0;

                      return (
                        <TableRow
                          key={index}
                          className={
                            hasErrors
                              ? "bg-destructive/5"
                              : hasWarnings
                                ? "bg-[#f5f0e6]/60"
                                : ""
                          }
                        >
                          {/* <TableCell className="font-medium">{index + 1}</TableCell> */}
                          <TableCell>
                            <Input
                              value={row.acno || ""}
                              onChange={(e) =>
                                updateExcelRow(
                                  index,
                                  "acno",
                                  e.target.value
                                    ? parseInt(e.target.value)
                                    : null
                                )
                              }
                              type="number"
                              className={`h-9 ${hasWarnings && row.acno
                                ? "border-[#c9a96a]"
                                : ""
                                }`}
                              placeholder="Auto"
                            />
                            {hasWarnings && row.acno && (
                              <p className="text-xs text-[#8a4b0f] mt-1">
                                Already exists
                              </p>
                            )}
                          </TableCell>
                          <TableCell>
                            <Input
                              value={row.acname || ""}
                              onChange={(e) =>
                                updateExcelRow(index, "acname", e.target.value)
                              }
                              className={`h-9 ${hasErrors && !row.acname ? "border-destructive" : ""
                                }`}
                              placeholder="Required"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={row.email || ""}
                              onChange={(e) =>
                                updateExcelRow(index, "email", e.target.value)
                              }
                              type="email"
                              className="h-9"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={row.city || ""}
                              onChange={(e) =>
                                updateExcelRow(index, "city", e.target.value)
                              }
                              className="h-9"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={row.phoneFax || ""}
                              onChange={(e) =>
                                updateExcelRow(
                                  index,
                                  "phoneFax",
                                  e.target.value
                                )
                              }
                              className="h-9"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={row.category || ""}
                              onChange={(e) =>
                                updateExcelRow(
                                  index,
                                  "category",
                                  e.target.value
                                )
                              }
                              className="h-9"
                            />
                          </TableCell>
                          <TableCell>
                            {hasErrors ? (
                              <StatusChip tone="bad">Error</StatusChip>
                            ) : hasWarnings ? (
                              <StatusChip tone="warn">Warning</StatusChip>
                            ) : (
                              <StatusChip tone="ok">Valid</StatusChip>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeExcelRow(index)}
                              className="h-8 w-8 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              title="Remove row"
                              aria-label="Remove row"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            {/* Import Button */}
            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <div className="text-sm text-muted-foreground">
                  {
                    excelData.filter((_, index) => {
                      const validation = excelValidation[index];
                      return (
                        !validation ||
                        (validation.errors.length === 0 &&
                          validation.warnings.length === 0)
                      );
                    }).length
                  }{" "}
                  of {excelData.length} rows ready to import
                </div>
                <Button
                  onClick={handleImportExcelData}
                  disabled={
                    isImporting ||
                    isValidating ||
                    excelData.some((_, index) => {
                      const validation = excelValidation[index];
                      return (
                        validation &&
                        (validation.errors.length > 0 ||
                          validation.warnings.length > 0)
                      );
                    })
                  }
                  className="h-10"
                >
                  {isImporting ? (
                    <>
                      <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin mr-2"></div>
                      Importing...
                    </>
                  ) : (
                    <>
                      <FileSpreadsheet className="h-4 w-4 mr-2" />
                      Import Data
                    </>
                  )}
                </Button>
              </div>

              {/* Error Message - Show below Import Button */}
              {excelError && (
                <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
                  <div className="flex-shrink-0">
                    <X className="h-5 w-5 text-destructive mt-0.5" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-destructive whitespace-pre-line">
                      {excelError}
                    </p>
                  </div>
                  <button
                    onClick={() => setExcelError(null)}
                    className="flex-shrink-0 text-destructive/60 hover:text-destructive transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* Success Message - Show below Import Button */}
              {excelSuccess && (
                <div className="flex items-start gap-3 rounded-lg border border-[#cfdcd2] bg-[#edf2ee] p-4">
                  <div className="flex-shrink-0">
                    <svg
                      className="h-5 w-5 text-[#2f5139] mt-0.5"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#2f5139]">
                      {excelSuccess}
                    </p>
                  </div>
                  <button
                    onClick={() => setExcelSuccess(null)}
                    className="flex-shrink-0 text-[#2f5139]/60 hover:text-[#2f5139] transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  } else if (modalTab === "addbyexcelparty") {
    return (
      <div className="space-y-6">
        {contactsExcelData.length === 0 ? (
          <div className="space-y-4">
            <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary/[0.03] p-8 text-center transition-colors hover:border-primary">
              <div className="flex flex-col items-center gap-4">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
                  <FileSpreadsheet className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <Label
                    htmlFor="contacts-excel-upload"
                    className="cursor-pointer"
                  >
                    <span className="text-lg font-semibold text-primary hover:underline">
                      Click to upload Excel file
                    </span>
                    <input
                      id="contacts-excel-upload"
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={handleContactsExcelFileUpload}
                      className="hidden"
                    />
                  </Label>
                  <p className="text-sm text-muted-foreground mt-2">
                    Supported formats: .xlsx, .xls
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-background p-5">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                    <FileText className="h-5 w-5 text-primary" />
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground mb-1">
                    Need a template?
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Download our demo Excel template to see the correct format
                    with sample data.
                  </p>
                  <Button
                    onClick={downloadContactsDemoExcel}
                    variant="outline"
                    className="bg-background"
                  >
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    Download Demo Template
                  </Button>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-primary">
                Excel Format Requirements:
              </h4>
              <ul className="text-[12.5px] text-foreground/80 space-y-1 list-disc list-inside">
                <li>First row must contain headers (column names)</li>
                <li>
                  <strong>Name</strong> is required for all rows
                </li>
                <li>
                  <strong>Contact Number</strong> is required for all rows
                </li>
                <li>Designation is optional</li>
              </ul>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-primary/15 bg-primary/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-primary">
                    Excel Data Loaded
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {contactsExcelData.length} row(s) found. Review and edit
                    data before importing.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setContactsExcelData([]);
                    setContactsExcelValidation({});
                  }}
                  className="bg-background"
                >
                  <X className="h-4 w-4 mr-2" />
                  Clear Data
                </Button>
              </div>
            </div>

            {Object.keys(contactsExcelValidation).length > 0 && (
              <div className="rounded-xl border border-[#e8dcc0] bg-[#f5f0e6] p-4">
                <h3 className="font-semibold text-[#5f4b1f] mb-2">
                  Validation Results
                </h3>
                <div className="text-sm text-[#5f4b1f] space-y-1">
                  {Object.entries(contactsExcelValidation).map(
                    ([index, validation]) => (
                      <div key={index} className="flex items-start gap-2">
                        <span className="font-medium">
                          Row {parseInt(index) + 1}:
                        </span>
                        <div className="flex-1">
                          {validation.errors.length > 0 && (
                            <div className="text-destructive">
                              Errors: {validation.errors.join(", ")}
                            </div>
                          )}
                          {validation.warnings.length > 0 && (
                            <div className="text-[#8a4b0f]">
                              Warnings: {validation.warnings.join(", ")}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}

            <div className="overflow-hidden rounded-xl border border-border">
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                <Table>
                  <TableHeader className="bg-primary sticky top-0 z-10">
                    <TableRow>
                      <TableHead className="whitespace-nowrap text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">
                        Row
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">
                        Name*
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">
                        Designation
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">
                        Contact Number*
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">
                        Status
                      </TableHead>
                      <TableHead className="w-12 whitespace-nowrap text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {contactsExcelData.map((row, index) => {
                      const validation = contactsExcelValidation[index];
                      const hasErrors = validation?.errors?.length > 0;
                      const hasWarnings = validation?.warnings?.length > 0;

                      return (
                        <TableRow
                          key={index}
                          className={
                            hasErrors
                              ? "bg-destructive/5"
                              : hasWarnings
                                ? "bg-[#f5f0e6]/60"
                                : ""
                          }
                        >
                          <TableCell className="font-medium">
                            {index + 1}
                          </TableCell>
                          <TableCell>
                            <Input
                              value={row.name || ""}
                              onChange={(e) =>
                                updateContactsExcelRow(
                                  index,
                                  "name",
                                  e.target.value
                                )
                              }
                              className={`h-9 ${hasErrors && !row.name ? "border-destructive" : ""
                                }`}
                              placeholder="Required"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={row.designation || ""}
                              onChange={(e) =>
                                updateContactsExcelRow(
                                  index,
                                  "designation",
                                  e.target.value
                                )
                              }
                              className="h-9"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={row.contact || ""}
                              onChange={(e) =>
                                updateContactsExcelRow(
                                  index,
                                  "contact",
                                  e.target.value
                                )
                              }
                              className={`h-9 ${hasErrors && !row.contact
                                ? "border-destructive"
                                : hasWarnings
                                  ? "border-[#c9a96a]"
                                  : ""
                                }`}
                              placeholder="Required"
                            />
                            {hasWarnings && (
                              <p className="text-xs text-[#8a4b0f] mt-1">
                                Already exists
                              </p>
                            )}
                          </TableCell>
                          <TableCell>
                            {hasErrors ? (
                              <StatusChip tone="bad">Error</StatusChip>
                            ) : hasWarnings ? (
                              <StatusChip tone="warn">Warning</StatusChip>
                            ) : (
                              <StatusChip tone="ok">Valid</StatusChip>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeContactsExcelRow(index)}
                              className="h-8 w-8 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              title="Remove row"
                              aria-label="Remove row"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <div className="text-sm text-muted-foreground">
                  {
                    contactsExcelData.filter((_, index) => {
                      const validation = contactsExcelValidation[index];
                      return (
                        !validation ||
                        (validation.errors.length === 0 &&
                          validation.warnings.length === 0)
                      );
                    }).length
                  }{" "}
                  of {contactsExcelData.length} rows ready to import
                </div>
                <Button
                  onClick={handleImportContactsExcelData}
                  disabled={
                    isImportingContacts ||
                    isValidatingContacts ||
                    contactsExcelData.some((_, index) => {
                      const validation = contactsExcelValidation[index];
                      return (
                        validation &&
                        (validation.errors.length > 0 ||
                          validation.warnings.length > 0)
                      );
                    })
                  }
                  className="h-10"
                >
                  {isImportingContacts ? "Importing..." : "Import Data"}
                </Button>
              </div>

              {/* Error Message - Show below Import Button */}
              {contactsExcelError && (
                <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
                  <div className="flex-shrink-0">
                    <X className="h-5 w-5 text-destructive mt-0.5" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-destructive whitespace-pre-line">
                      {contactsExcelError}
                    </p>
                  </div>
                  <button
                    onClick={() => setContactsExcelError(null)}
                    className="flex-shrink-0 text-destructive/60 hover:text-destructive transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* Success Message - Show below Import Button */}
              {contactsExcelSuccess && (
                <div className="flex items-start gap-3 rounded-lg border border-[#cfdcd2] bg-[#edf2ee] p-4">
                  <div className="flex-shrink-0">
                    <svg
                      className="h-5 w-5 text-[#2f5139] mt-0.5"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#2f5139]">
                      {contactsExcelSuccess}
                    </p>
                  </div>
                  <button
                    onClick={() => setContactsExcelSuccess(null)}
                    className="flex-shrink-0 text-[#2f5139]/60 hover:text-[#2f5139] transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  } else if (modalTab === "addbyexcelsales" || modalTab === "addbyexcelsalesmulti") {
    // Same screen for both; the multi-customer one adds a Customer Code column
    const isMultiSales = modalTab === "addbyexcelsalesmulti";
    return (
      <div className="space-y-6">
        {salesExcelData.length === 0 ? (
          <div className="space-y-4">
            <div className="rounded-xl border-2 border-dashed border-primary/30 bg-primary/[0.03] p-8 text-center transition-colors hover:border-primary">
              <div className="flex flex-col items-center gap-4">
                <div className="w-16 h-16 bg-primary/10 rounded-full flex items-center justify-center">
                  <FileSpreadsheet className="h-8 w-8 text-primary" />
                </div>
                <div>
                  <Label
                    htmlFor="sales-excel-upload"
                    className="cursor-pointer"
                  >
                    <span className="text-lg font-semibold text-primary hover:underline">
                      Click to upload Excel file
                    </span>
                    <input
                      id="sales-excel-upload"
                      type="file"
                      accept=".xlsx,.xls"
                      onChange={handleSalesExcelFileUpload}
                      className="hidden"
                    />
                  </Label>
                  <p className="text-sm text-muted-foreground mt-2">
                    Supported formats: .xlsx, .xls
                  </p>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-background p-5">
              <div className="flex items-start gap-4">
                <div className="flex-shrink-0">
                  <div className="w-10 h-10 bg-primary/10 rounded-lg flex items-center justify-center">
                    <FileText className="h-5 w-5 text-primary" />
                  </div>
                </div>
                <div className="flex-1">
                  <h3 className="font-semibold text-foreground mb-1">
                    Need a template?
                  </h3>
                  <p className="text-sm text-muted-foreground mb-4">
                    Download our demo Excel template to see the correct format
                    with sample data.
                  </p>
                  <Button
                    onClick={downloadSalesDemoExcel}
                    variant="outline"
                    className="bg-background"
                  >
                    <FileSpreadsheet className="h-4 w-4 mr-2" />
                    Download Demo Template
                  </Button>
                </div>
              </div>
            </div>

            <div className="rounded-xl border border-border bg-muted/40 p-4">
              <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-primary">
                Excel Format Requirements:
              </h4>
              <ul className="text-[12.5px] text-foreground/80 space-y-1 list-disc list-inside">
                <li>First row must contain headers (column names)</li>
                {isMultiSales && (
                  <li>
                    <strong>Customer Code</strong> (account no) is required for
                    all rows — one file can hold many customers
                  </li>
                )}
                <li>
                  <strong>Ink Code</strong> is required for all rows
                </li>
                <li>
                  <strong>Rate</strong> is required and must be a positive
                  number
                </li>
                <li>GST Rate (%) is optional and must be between 0 and 100</li>
              </ul>
            </div>
          </div>
        ) : (
          <>
            <div className="rounded-xl border border-primary/15 bg-primary/5 p-4">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="font-semibold text-primary">
                    Excel Data Loaded
                  </h3>
                  <p className="text-sm text-muted-foreground mt-1">
                    {salesExcelData.length} row(s) found. Review and edit data
                    before importing.
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setSalesExcelData([]);
                    setSalesExcelValidation({});
                  }}
                  className="bg-background"
                >
                  <X className="h-4 w-4 mr-2" />
                  Clear Data
                </Button>
              </div>
            </div>

            {Object.keys(salesExcelValidation).length > 0 && (
              <div className="rounded-xl border border-[#e8dcc0] bg-[#f5f0e6] p-4">
                <h3 className="font-semibold text-[#5f4b1f] mb-2">
                  Validation Results
                </h3>
                <div className="text-sm text-[#5f4b1f] space-y-1">
                  {Object.entries(salesExcelValidation).map(
                    ([index, validation]) => (
                      <div key={index} className="flex items-start gap-2">
                        <span className="font-medium">
                          Row {parseInt(index) + 1}:
                        </span>
                        <div className="flex-1">
                          {validation.errors.length > 0 && (
                            <div className="text-destructive">
                              Errors: {validation.errors.join(", ")}
                            </div>
                          )}
                          {validation.warnings.length > 0 && (
                            <div className="text-[#8a4b0f]">
                              Warnings: {validation.warnings.join(", ")}
                            </div>
                          )}
                        </div>
                      </div>
                    )
                  )}
                </div>
              </div>
            )}

            <div className="overflow-hidden rounded-xl border border-border">
              <div className="overflow-x-auto max-h-[500px] overflow-y-auto">
                <Table>
                  <TableHeader className="bg-primary sticky top-0 z-10">
                    <TableRow>
                      <TableHead className="whitespace-nowrap text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">
                        Row
                      </TableHead>
                      {isMultiSales && (
                        <TableHead className="whitespace-nowrap text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">
                          Customer Code*
                        </TableHead>
                      )}
                      <TableHead className="whitespace-nowrap text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">
                        Ink Code*
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">
                        Rate*
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">
                        GST Rate (%)
                      </TableHead>
                      <TableHead className="whitespace-nowrap text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">
                        Status
                      </TableHead>
                      <TableHead className="w-12 whitespace-nowrap text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">
                        <span className="sr-only">Actions</span>
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {salesExcelData.map((row, index) => {
                      const validation = salesExcelValidation[index];
                      const hasErrors = validation?.errors?.length > 0;
                      const hasWarnings = validation?.warnings?.length > 0;

                      return (
                        <TableRow
                          key={index}
                          className={
                            hasErrors
                              ? "bg-destructive/5"
                              : hasWarnings
                                ? "bg-[#f5f0e6]/60"
                                : ""
                          }
                        >
                          <TableCell className="font-medium">
                            {index + 1}
                          </TableCell>
                          {isMultiSales && (
                            <TableCell>
                              <Input
                                value={row.acno || ""}
                                onChange={(e) =>
                                  updateSalesExcelRow(
                                    index,
                                    "acno",
                                    parseInt(e.target.value) || null
                                  )
                                }
                                type="number"
                                className={`h-9 ${hasErrors && !row.customer_name
                                  ? "border-destructive"
                                  : ""
                                  }`}
                                placeholder="Required"
                              />
                              {row.customer_name && (
                                <p className="text-xs text-muted-foreground mt-1 truncate max-w-[180px]">
                                  {row.customer_name}
                                </p>
                              )}
                            </TableCell>
                          )}
                          <TableCell>
                            <Input
                              value={row.code || ""}
                              onChange={(e) =>
                                updateSalesExcelRow(
                                  index,
                                  "code",
                                  e.target.value || null
                                )
                              }
                              type="text"
                              className={`h-9 ${hasErrors && !row.code
                                ? "border-destructive"
                                : hasWarnings
                                  ? "border-[#c9a96a]"
                                  : ""
                                }`}
                              placeholder="Required"
                            />
                            {hasWarnings && (
                              <p className="text-xs text-[#8a4b0f] mt-1">
                                Already exists
                              </p>
                            )}
                          </TableCell>
                          <TableCell>
                            <Input
                              value={row.rate || ""}
                              onChange={(e) =>
                                updateSalesExcelRow(
                                  index,
                                  "rate",
                                  e.target.value
                                    ? parseFloat(e.target.value)
                                    : null
                                )
                              }
                              type="number"
                              step="0.01"
                              className={`h-9 ${hasErrors && (!row.rate || isNaN(row.rate))
                                ? "border-destructive"
                                : ""
                                }`}
                              placeholder="Required"
                            />
                          </TableCell>
                          <TableCell>
                            <Input
                              value={row.gst_rate || ""}
                              onChange={(e) =>
                                updateSalesExcelRow(
                                  index,
                                  "gst_rate",
                                  e.target.value
                                    ? parseFloat(e.target.value)
                                    : null
                                )
                              }
                              type="number"
                              step="0.01"
                              className="h-9"
                              placeholder="0"
                            />
                          </TableCell>
                          <TableCell>
                            {hasErrors ? (
                              <StatusChip tone="bad">Error</StatusChip>
                            ) : hasWarnings ? (
                              <StatusChip tone="warn">Warning</StatusChip>
                            ) : (
                              <StatusChip tone="ok">Valid</StatusChip>
                            )}
                          </TableCell>
                          <TableCell>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={() => removeSalesExcelRow(index)}
                              className="h-8 w-8 p-0 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              title="Remove row"
                              aria-label="Remove row"
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            </div>

            <div className="space-y-3">
              <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border pt-4">
                <div className="text-sm text-muted-foreground">
                  {
                    salesExcelData.filter((_, index) => {
                      const validation = salesExcelValidation[index];
                      return (
                        !validation ||
                        (validation.errors.length === 0 &&
                          validation.warnings.length === 0)
                      );
                    }).length
                  }{" "}
                  of {salesExcelData.length} rows ready to import
                </div>
                <Button
                  onClick={handleImportSalesExcelData}
                  disabled={
                    isImportingSales ||
                    isValidatingSales ||
                    salesExcelData.some((_, index) => {
                      const validation = salesExcelValidation[index];
                      return (
                        validation &&
                        (validation.errors.length > 0 ||
                          validation.warnings.length > 0)
                      );
                    })
                  }
                  className="h-10"
                >
                  {isImportingSales ? "Importing..." : "Import Data"}
                </Button>
              </div>

              {/* Error Message - Show below Import Button */}
              {salesExcelError && (
                <div className="flex items-start gap-3 rounded-lg border border-destructive/30 bg-destructive/10 p-4">
                  <div className="flex-shrink-0">
                    <X className="h-5 w-5 text-destructive mt-0.5" />
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-destructive whitespace-pre-line">
                      {salesExcelError}
                    </p>
                  </div>
                  <button
                    onClick={() => setSalesExcelError(null)}
                    className="flex-shrink-0 text-destructive/60 hover:text-destructive transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}

              {/* Success Message - Show below Import Button */}
              {salesExcelSuccess && (
                <div className="flex items-start gap-3 rounded-lg border border-[#cfdcd2] bg-[#edf2ee] p-4">
                  <div className="flex-shrink-0">
                    <svg
                      className="h-5 w-5 text-[#2f5139] mt-0.5"
                      fill="currentColor"
                      viewBox="0 0 20 20"
                    >
                      <path
                        fillRule="evenodd"
                        d="M10 18a8 8 0 100-16 8 8 0 000 16zm3.707-9.293a1 1 0 00-1.414-1.414L9 10.586 7.707 9.293a1 1 0 00-1.414 1.414l2 2a1 1 0 001.414 0l4-4z"
                        clipRule="evenodd"
                      />
                    </svg>
                  </div>
                  <div className="flex-1">
                    <p className="text-sm font-medium text-[#2f5139]">
                      {salesExcelSuccess}
                    </p>
                  </div>
                  <button
                    onClick={() => setSalesExcelSuccess(null)}
                    className="flex-shrink-0 text-[#2f5139]/60 hover:text-[#2f5139] transition-colors"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    );
  }
};

const CustomerManagementDashboard = () => {
  const [activeTab, setActiveTab] = useState("customers");
  const [currentPage, setCurrentPage] = useState(1);
  const [filters, setFilters] = useState({
    city: "",
    category: "",
    area: "",
    salesArea: "",
  });
  const [showFilters, setShowFilters] = useState(false);

  const queryClient = useQueryClient();

  const [salesError, setSalesError] = useState(null);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [modalIsOpen, setModalIsOpen] = useState(false);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [viewData, setViewData] = useState(null);
  const [modalType, setModalType] = useState("add");
  const [modalTab, setModalTab] = useState("customers");
  const [formData, setFormData] = useState({});
  const [deleteConfirm, setDeleteConfirm] = useState({
    open: false,
    id: null,
    tab: "",
  });
  // const [customersData, setCustomersData] = useState({
  //   customers: [],
  //   total: 0,
  // });
  // const [contacts, setContacts] = useState([]);
  // const [salesItems, setSalesItems] = useState([]);
  // const [taxLawCodes, setTaxLawCodes] = useState([]);
  // const [loading, setLoading] = useState({
  //   customers: false,
  //   contacts: false,
  //   sales: false,
  //   taxCodes: false,
  // });

  const [searchStates, setSearchStates] = useState({
    customers: "",
    contacts: "",
    sales: "",
  });
  // const [itemOptions, setItemOptions] = useState([]);
  const [excelData, setExcelData] = useState([]);
  const [excelValidation, setExcelValidation] = useState({});
  const [existingCustomers, setExistingCustomers] = useState(new Set());
  const [isValidating, setIsValidating] = useState(false);
  const [isImporting, setIsImporting] = useState(false);

  // Excel import state for contacts
  const [contactsExcelData, setContactsExcelData] = useState([]);
  const [contactsExcelValidation, setContactsExcelValidation] = useState({});
  const [existingContacts, setExistingContacts] = useState(new Set());
  const [isValidatingContacts, setIsValidatingContacts] = useState(false);
  const [isImportingContacts, setIsImportingContacts] = useState(false);
  const [contactsExcelError, setContactsExcelError] = useState(null);
  const [contactsExcelSuccess, setContactsExcelSuccess] = useState(null);

  // Excel import state for sales items
  const [salesExcelData, setSalesExcelData] = useState([]);
  const [salesExcelValidation, setSalesExcelValidation] = useState({});
  const [existingSalesItems, setExistingSalesItems] = useState(new Set());
  const [isValidatingSales, setIsValidatingSales] = useState(false);
  const [isImportingSales, setIsImportingSales] = useState(false);
  const [salesExcelError, setSalesExcelError] = useState(null);
  const [salesExcelSuccess, setSalesExcelSuccess] = useState(null);

  // Excel import state for customers
  const [excelError, setExcelError] = useState(null);
  const [excelSuccess, setExcelSuccess] = useState(null);

  const { company } = useCompany();
  const { currency } = useCurrency();
  const { data: session } = useSession();

  const updateSearchState = (tab, value) => {
    setSearchStates((prev) => ({ ...prev, [tab]: value }));
    setCurrentPage(1);
  };

  const { data: itemOptions = [] } = useQuery({
    queryKey: ["items"],
    queryFn: async () => {
      const res = await axios.get("/api/setup/items");
      // Convert to React Select format
      return res.data.data.map((i) => ({
        value: i.itcd,
        label: `${i.code || i.itcd} - ${i.item}`,
        code: i.code ? String(i.code) : String(i.itcd),
        itcd: String(i.itcd),
        item: i.item ? String(i.item) : "",
      }));
    },
    staleTime: 5 * 60 * 1000,
  });

  const { data: taxLawCodes = [], isLoading: taxCodesLoading } = useQuery({
    queryKey: ["taxLawCodes"],
    queryFn: async () => {
      const response = await axios.get("/api/setup/tax_laws");
      return response.data.data;
    },
    staleTime: 5 * 60 * 1000,
  });

  const {
    data: customersData = { customers: [], total: 0 },
    isLoading: customersLoading,
    refetch: refetchCustomers,
  } = useQuery({
    queryKey: ["customers", currentPage, searchStates.customers, filters],
    queryFn: async () => {
      const params = new URLSearchParams({
        page: currentPage.toString(),
        limit: "10",
        search: searchStates.customers,
        ...filters,
        // Sales person → own customers only (salesTeam.viewAll, ADMIN etc. see all)
        scope: "own",
      });
      const response = await axios.get(`/api/forms/customers?${params}`);
      return response.data;
    },
    staleTime: 60 * 5 * 1000,
    keepPreviousData: true,
  });

  // Sales persons = users assigned to customers (ACNO.sales_ares) — the same
  // list the reports and Checks in Hand use. /api/accounts/sales-persons
  // listed whoever had CREATED a sale order (the data-entry users), not the
  // sales people.
  const { data: salesPersons = [] } = useQuery({
    queryKey: ["customer-sales-persons"],
    queryFn: async () => {
      const res = await axios.get("/api/accounts/customer-sales-persons");
      return res.data.data || [];
    },
    staleTime: 10 * 60 * 1000,
  });
  // OLD:
  // const { data: salesPersons = [] } = useQuery({
  //   queryKey: ["salesPersons"],
  //   queryFn: async () => {
  //     const res = await axios.get("/api/accounts/sales-persons");
  //     return res.data.data || [];
  //   },
  //   staleTime: 10 * 60 * 1000,
  // });

  // Customer account groups (macno) from Finance → Account Settings, in
  // their configured order — the first is the default for new customers.
  const { data: customerMacnos = [] } = useQuery({
    queryKey: ["accountSettings", "customerGroups"],
    queryFn: async () => {
      const res = await axios.get("/api/settings/accounts");
      return (res.data?.groups?.customers || []).map(Number);
    },
    staleTime: 10 * 60 * 1000,
  });

  // Account Group options for the customer form - real macnames straight
  // from /api/accounts/macno, scoped to the customer groups above (it can't
  // just be "all macno under a bscd": that also holds Cash/Bank/Stock/
  // Purchase accounts). includeInactive=true because a switched-off main
  // account can still hold real customers.
  const { data: macnoOptions = [] } = useQuery({
    queryKey: ["customerMacnoOptions"],
    queryFn: async () => {
      const res = await axios.get("/api/accounts/macno", {
        params: { group: "customers", includeInactive: true },
      });
      return (res.data.data || [])
        .map((m) => ({ value: m.macno, label: `${m.macno} - ${m.macname}` }))
        .sort((a, b) => a.value - b.value);
    },
    staleTime: 10 * 60 * 1000,
  });

  const {
    data: contacts = [],
    isLoading: contactsLoading,
    isFetched: contactsFetched,
    refetch: refetchContacts,
  } = useQuery({
    queryKey: ["contacts", selectedCustomer, searchStates.contacts],
    queryFn: async () => {
      if (!selectedCustomer || activeTab !== "party") return [];
      const params = new URLSearchParams({
        acno: selectedCustomer.toString(),
        search: searchStates.contacts,
      });
      const response = await axios.get(`/api/forms/contacts?${params}`);
      return response.data;
    },
    enabled: !!selectedCustomer && activeTab === "party", // Only fetch when needed
    staleTime: 60 * 5 * 1000,
  });

  const {
    data: salesItems = [],
    isLoading: salesLoading,
    isFetched: salesFetched,
    refetch: refetchSalesItems,
  } = useQuery({
    queryKey: ["salesItems", selectedCustomer, searchStates.sales],
    queryFn: async () => {
      if (!selectedCustomer || activeTab !== "sales") return [];
      const params = new URLSearchParams({
        acno: selectedCustomer.toString(),
        search: searchStates.sales,
      });
      const response = await axios.get(`/api/forms/sales-items?${params}`);
      return response.data;
    },
    enabled: !!selectedCustomer && activeTab === "sales",
    staleTime: 60 * 5 * 1000,
  });

  // Validation helper functions
  const validateEmail = (email) => {
    if (!email) return null;
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    return emailRegex.test(email.trim());
  };

  const validatePhoneNumber = (phone) => {
    if (!phone) return null;
    // Allow various phone formats: +92 300 1234567, 0300-1234567, (0300) 1234567, etc.
    const phoneRegex =
      /^[\+]?[(]?[0-9]{1,4}[)]?[-\s\.]?[(]?[0-9]{1,4}[)]?[-\s\.]?[0-9]{1,9}$/;
    return phoneRegex.test(phone.trim());
  };

  const validateBankAccountNumber = (accountNo) => {
    if (!accountNo) return null;
    // Bank account numbers are typically 8-20 digits, may include hyphens
    const accountRegex = /^[0-9]{8,20}$|^[0-9]{4,6}-[0-9]{4,14}$/;
    return accountRegex.test(accountNo.trim().replace(/\s/g, ""));
  };

  const validateWebsite = (website) => {
    if (!website) return null;
    try {
      // Allow URLs with or without http/https
      const urlPattern =
        /^(https?:\/\/)?([\da-z\.-]+)\.([a-z\.]{2,6})([\/\w \.-]*)*\/?$/;
      return urlPattern.test(website.trim());
    } catch {
      return false;
    }
  };

  // Fetch all existing customer account numbers for validation
  const fetchAllCustomerAcnos = useCallback(async () => {
    try {
      const response = await axios.get(
        "/api/forms/customers?page=1&limit=999999"
      );
      const acnos = new Set(
        response.data.customers.map((c) => c.acno?.toString())
      );
      setExistingCustomers(acnos);
      return acnos;
    } catch (error) {
      console.error("Error fetching existing customers:", error);
      return new Set();
    }
  }, []);

  // Fetch existing emails, phone numbers, and bank account numbers for uniqueness validation
  const fetchExistingUniqueFields = useCallback(async () => {
    try {
      const response = await axios.get(
        "/api/forms/customers?page=1&limit=999999"
      );
      const customers = response.data.customers;

      const emails = new Set();
      const phoneNumbers = new Set();
      const bankAccounts = new Set();
      const ntnNumbers = new Set();
      const stRegNumbers = new Set();

      customers.forEach((c) => {
        if (c.email && c.email.trim()) {
          emails.add(c.email.trim().toLowerCase());
        }
        if (c.phoneFax && c.phoneFax.trim()) {
          phoneNumbers.add(c.phoneFax.trim());
        }
        if (c.bankAccountNo && c.bankAccountNo.trim()) {
          bankAccounts.add(c.bankAccountNo.trim().replace(/\s/g, ""));
        }
        if (c.ntnNo && c.ntnNo.trim()) {
          ntnNumbers.add(c.ntnNo.trim());
        }
        if (c.stRegNo && c.stRegNo.trim()) {
          stRegNumbers.add(c.stRegNo.trim());
        }
      });

      return { emails, phoneNumbers, bankAccounts, ntnNumbers, stRegNumbers };
    } catch (error) {
      console.error("Error fetching existing unique fields:", error);
      return {
        emails: new Set(),
        phoneNumbers: new Set(),
        bankAccounts: new Set(),
        ntnNumbers: new Set(),
        stRegNumbers: new Set(),
      };
    }
  }, []);

  // Parse Excel file
  const handleExcelFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: "array" });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

          if (jsonData.length < 2) {
            setExcelError(
              "Excel file must have at least a header row and one data row"
            );
            return;
          }

          // Get headers (first row)
          const headers = jsonData[0].map((h) =>
            String(h || "")
              .trim()
              .toLowerCase()
              .replace(/\s+/g, "")
          );

          // Map headers to field names
          const headerMap = {
            accountnumber: "acno",
            accountno: "acno",
            acno: "acno",
            mainaccountnumber: "macno",
            mainaccountno: "macno",
            macno: "macno",
            companyname: "acname",
            company: "acname",
            acname: "acname",
            email: "email",
            emailaddress: "email",
            address: "address",
            city: "city",
            country: "country",
            phone: "phoneFax",
            "phone/fax": "phoneFax",
            phonefax: "phoneFax",
            website: "website",
            category: "category",
            subcategory: "subCategory",
            "sub-category": "subCategory",
            area: "area",
            areacode: "areaCode",
            "area-code": "areaCode",
            salesarea: "salesArea",
            "sales-area": "salesArea",
            contactperson: "contactPerson",
            "contact-person": "contactPerson",
            creditdays: "crDays",
            creditdays2: "crDays2",
            "creditdays2(siz)": "crDays2",
            creditlimit: "crLimit",
            strate: "stRate",
            "st-rate": "stRate",
            customerbank: "customerBank",
            customerbankaddress: "customerBankAddr",
            "customerbankaddress(shipping)": "customerBankAddr",
            stregno: "stRegNo",
            "stregno(model)": "stRegNo",
            streg: "stReg",
            "streg(amp)": "stReg",
            ntnno: "ntnNo",
            "ntnno(voltage)": "ntnNo",
            taxlawcode: "tax_law_code",
            taxfilingstatus: "tax_filing_status",
            bankaccountno: "bankAccountNo",
            bankaccountnumber: "bankAccountNo",
          };

          // Parse data rows
          const parsedData = [];
          for (let i = 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            if (!row || row.every((cell) => !cell)) continue; // Skip empty rows

            const customer = {};
            headers.forEach((header, index) => {
              const fieldName = headerMap[header];
              if (
                fieldName &&
                row[index] !== undefined &&
                row[index] !== null
              ) {
                let value = row[index];

                // Type conversion
                if (
                  fieldName === "acno" ||
                  fieldName === "macno" ||
                  fieldName === "crDays" ||
                  fieldName === "crDays2" ||
                  fieldName === "tax_law_code"
                ) {
                  value = parseInt(value) || null;
                } else if (fieldName === "stRate" || fieldName === "crLimit") {
                  value = parseFloat(value) || null;
                } else {
                  value = String(value).trim() || null;
                }

                customer[fieldName] = value;
              }
            });

            // Default account group if not provided in the sheet: the first
            // customer group in Finance → Account Settings.
            if (!customer.macno && customerMacnos.length) {
              customer.macno = customerMacnos[0];
            }

            parsedData.push(customer);
          }

          if (parsedData.length === 0) {
            setExcelError("No valid data found in Excel file");
            return;
          }

          setExcelData(parsedData);
          setExcelError(null);

          // Validate against existing customers
          await validateExcelData(parsedData);
        } catch (error) {
          console.error("Error parsing Excel:", error);
          setExcelError("Error parsing Excel file: " + error.message);
        }
      };
      reader.readAsArrayBuffer(file);
    } catch (error) {
      console.error("Error reading file:", error);
      setExcelError("Error reading file: " + error.message);
    }
  };

  // Validate Excel data against existing customers
  const validateExcelData = async (data) => {
    setIsValidating(true);
    try {
      // Use provided data or current excelData state
      const dataToValidate = data || excelData;
      if (!dataToValidate || dataToValidate.length === 0) {
        setIsValidating(false);
        return;
      }

      const acnos = await fetchAllCustomerAcnos();
      const { emails, phoneNumbers, bankAccounts, ntnNumbers, stRegNumbers } =
        await fetchExistingUniqueFields();
      const validation = {};

      dataToValidate.forEach((row, index) => {
        const errors = [];
        const warnings = [];

        // Required field validation
        if (!row.acname || !row.acname.trim()) {
          errors.push("Company Name is required");
        }

        // Check if account number already exists
        if (row.acno) {
          const acnoStr = row.acno.toString();
          if (acnos.has(acnoStr)) {
            warnings.push(`Account Number ${row.acno} already exists`);
          }
        }

        // Email validation
        if (row.email && row.email.trim()) {
          if (!validateEmail(row.email)) {
            errors.push("Invalid email format");
          } else {
            const emailLower = row.email.trim().toLowerCase();
            if (emails.has(emailLower)) {
              warnings.push(`Email "${row.email}" already exists`);
            }
          }
        }

        // Phone number validation
        if (row.phoneFax && row.phoneFax.trim()) {
          if (!validatePhoneNumber(row.phoneFax)) {
            errors.push("Invalid phone number format");
          } else {
            const phoneTrimmed = row.phoneFax.trim();
            if (phoneNumbers.has(phoneTrimmed)) {
              warnings.push(`Phone number "${row.phoneFax}" already exists`);
            }
          }
        }

        // Bank account number validation
        if (row.bankAccountNo && row.bankAccountNo.trim()) {
          if (!validateBankAccountNumber(row.bankAccountNo)) {
            errors.push(
              "Invalid bank account number format (should be 8-20 digits or formatted like 1234-567890)"
            );
          } else {
            const accountTrimmed = row.bankAccountNo.trim().replace(/\s/g, "");
            if (bankAccounts.has(accountTrimmed)) {
              warnings.push(
                `Bank account number "${row.bankAccountNo}" already exists`
              );
            }
          }
        }

        // Website validation
        if (row.website && row.website.trim()) {
          if (!validateWebsite(row.website)) {
            errors.push("Invalid website URL format");
          }
        }

        // Validate tax filing status
        if (
          row.tax_filing_status &&
          !["Filer", "Non-Filer"].includes(row.tax_filing_status)
        ) {
          errors.push("Tax Filing Status must be 'Filer' or 'Non-Filer'");
        }

        // NTN Number validation and uniqueness
        if (row.ntnNo && row.ntnNo.trim()) {
          const ntnTrimmed = row.ntnNo.trim();
          if (ntnNumbers.has(ntnTrimmed)) {
            warnings.push(`NTN Number "${row.ntnNo}" already exists`);
          }
        }

        // ST Reg No validation and uniqueness
        if (row.stRegNo && row.stRegNo.trim()) {
          const stRegTrimmed = row.stRegNo.trim();
          if (stRegNumbers.has(stRegTrimmed)) {
            warnings.push(`ST Reg No "${row.stRegNo}" already exists`);
          }
        }

        // Validate numeric fields
        if (row.crDays && (isNaN(row.crDays) || row.crDays < 0)) {
          errors.push("Credit Days must be a positive number");
        }
        if (
          row.stRate &&
          (isNaN(row.stRate) || row.stRate < 0 || row.stRate > 100)
        ) {
          errors.push("ST Rate must be between 0 and 100");
        }

        if (errors.length > 0 || warnings.length > 0) {
          validation[index] = { errors, warnings };
        }
      });

      setExcelValidation(validation);
    } catch (error) {
      console.error("Error validating data:", error);
      setExcelError("Error validating data: " + error.message);
    } finally {
      setIsValidating(false);
    }
  };

  // Update Excel data row
  const updateExcelRow = (index, field, value) => {
    const newData = [...excelData];
    newData[index] = { ...newData[index], [field]: value };
    setExcelData(newData);

    // Re-validate all data after update
    setTimeout(() => {
      validateExcelData(newData);
    }, 300);
  };

  // Remove Excel data row
  const removeExcelRow = (index) => {
    const newData = excelData.filter((_, i) => i !== index);
    setExcelData(newData);

    // Re-validate with updated indices
    setTimeout(() => {
      validateExcelData(newData);
    }, 100);
  };

  // Generate and download demo Excel template
  const downloadDemoExcel = () => {
    const workbook = XLSX.utils.book_new();

    // Define headers with proper formatting
    const headers = [
      "Account Number",
      "Main Account Number",
      "Company Name",
      "Email Address",
      "Address",
      "City",
      "Country",
      "Phone/Fax",
      "Website",
      "Category",
      "Sub Category",
      "Area",
      "Area Code",
      "Sales Area",
      "Contact Person",
      "Credit Days",
      "Credit Days 2 (SIZ)",
      "Credit Limit",
      "ST Rate",
      "Customer Bank",
      "Customer Bank Address (Shipping)",
      "ST Reg No",
      "ST Reg Reference",
      "NTN No",
      "Tax Law Code",
      "Tax Filing Status",
      "Bank Account Number",
    ];

    // Sample data rows
    const sampleData = [
      [
        1001,
        35,
        "ABC Corporation",
        "contact@abccorp.com",
        "123 Business Street",
        "Karachi",
        "Pakistan",
        "+92 300 1234567",
        "https://www.abccorp.com",
        "Retail",
        "Electronics",
        "Downtown",
        "75500",
        "South",
        "John Doe",
        30,
        45,
        50000,
        17,
        "Bank ABC",
        "456 Shipping Lane, Karachi",
        "MOD123",
        "AMP456",
        "VOL789",
        1,
        "Filer",
        "1234567890123",
      ],
      [
        1002,
        35,
        "XYZ Industries",
        "info@xyzind.com",
        "789 Industrial Avenue",
        "Lahore",
        "Pakistan",
        "+92 300 9876543",
        "https://www.xyzind.com",
        "Manufacturing",
        "Textiles",
        "Industrial",
        "54000",
        "North",
        "Jane Smith",
        45,
        60,
        100000,
        17,
        "Bank XYZ",
        "789 Factory Road, Lahore",
        "MOD456",
        "AMP789",
        "VOL012",
        2,
        "Non-Filer",
        "9876543210987",
      ],
    ];

    // Create worksheet
    const worksheetData = [headers, ...sampleData];
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    // Set column widths
    const columnWidths = [
      { wch: 15 }, // Account Number
      { wch: 20 }, // Main Account Number
      { wch: 25 }, // Company Name
      { wch: 25 }, // Email Address
      { wch: 30 }, // Address
      { wch: 15 }, // City
      { wch: 15 }, // Country
      { wch: 15 }, // Phone/Fax
      { wch: 25 }, // Website
      { wch: 15 }, // Category
      { wch: 15 }, // Sub Category
      { wch: 15 }, // Area
      { wch: 12 }, // Area Code
      { wch: 15 }, // Sales Area
      { wch: 18 }, // Contact Person
      { wch: 12 }, // Credit Days
      { wch: 18 }, // Credit Days 2
      { wch: 15 }, // Credit Limit
      { wch: 10 }, // ST Rate
      { wch: 18 }, // Customer Bank
      { wch: 35 }, // Customer Bank Address
      { wch: 18 }, // ST Reg No
      { wch: 12 }, // ST Reg
      { wch: 15 }, // NTN No
      { wch: 15 }, // Tax Law Code
      { wch: 18 }, // Tax Filing Status
      { wch: 20 }, // Bank Account Number
    ];
    worksheet["!cols"] = columnWidths;

    // Style header row
    const headerStyle = {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "3498DB" } },
      alignment: { horizontal: "center", vertical: "center" },
    };

    const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1");
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
      if (!worksheet[cellAddress]) worksheet[cellAddress] = { v: "" };
      worksheet[cellAddress].s = headerStyle;
    }

    // Add worksheet to workbook
    XLSX.utils.book_append_sheet(workbook, worksheet, "Customer Template");

    // Generate file and download
    XLSX.writeFile(workbook, "Customer_Import_Template.xlsx");
  };

  // Import Excel data
  const handleImportExcelData = async () => {
    // Filter out rows with errors or warnings, preserving original index
    const validDataWithIndex = excelData
      .map((data, index) => ({ data, originalIndex: index }))
      .filter(({ originalIndex }) => {
        const validation = excelValidation[originalIndex];
        return (
          !validation ||
          (validation.errors.length === 0 && validation.warnings.length === 0)
        );
      });

    if (validDataWithIndex.length === 0) {
      setExcelError(
        "No valid data to import. Please fix errors and warnings first."
      );
      return;
    }

    setIsImporting(true);
    try {
      const successRows = [];
      const failedRows = [];

      // Import each customer
      for (let i = 0; i < validDataWithIndex.length; i++) {
        try {
          const customerData = { ...validDataWithIndex[i].data };

          // Convert numeric fields to proper types
          if (customerData.crDays) {
            customerData.crDays = parseInt(customerData.crDays, 10);
          }
          if (customerData.crDays2) {
            customerData.crDays2 = parseInt(customerData.crDays2, 10);
          }
          if (customerData.stRate) {
            customerData.stRate = parseFloat(customerData.stRate);
          }
          if (customerData.crLimit) {
            customerData.crLimit = parseFloat(customerData.crLimit);
          }
          if (customerData.tax_law_code) {
            customerData.tax_law_code = parseInt(customerData.tax_law_code, 10);
          }

          await axios.post("/api/forms/customers", customerData);
          const excelRowNumber = validDataWithIndex[i].originalIndex + 1;
          successRows.push(excelRowNumber);
        } catch (error) {
          const excelRowNumber = validDataWithIndex[i].originalIndex + 1;
          failedRows.push(excelRowNumber);
        }
      }

      if (failedRows.length > 0) {
        const errorMessage =
          (successRows.length > 0
            ? `Row ${successRows.join(", ")} success\n`
            : "") + `Row ${failedRows.join(", ")} import failed`;
        setExcelError(errorMessage);
        setExcelSuccess(null);
        // Keep modal open and data intact so user can see errors and fix them
        refetchCustomers(); // Refresh to show successfully imported items
      } else {
        setExcelSuccess(`Row ${successRows.join(", ")} success`);
        setExcelError(null);
        // Reset and refresh only on success
        setExcelData([]);
        setExcelValidation({});
        refetchCustomers();
        setTimeout(() => {
          setModalIsOpen(false);
        }, 2000);
      }
    } catch (error) {
      console.error("Error importing data:", error);
      setExcelError("Error importing data: " + error.message);
    } finally {
      setIsImporting(false);
    }
  };

  // Fetch existing contacts for validation
  const fetchAllContactsForValidation = useCallback(async () => {
    if (!selectedCustomer) return new Set();
    try {
      const response = await axios.get(
        `/api/forms/contacts?acno=${selectedCustomer}`
      );
      // Create a set of unique identifiers (name + contact combination)
      const contactKeys = new Set(
        response.data.map((c) => `${c.name?.toLowerCase()}_${c.contact}`)
      );
      return contactKeys;
    } catch (error) {
      console.error("Error fetching existing contacts:", error);
      return new Set();
    }
  }, [selectedCustomer]);

  // Fetch all items for validation (mapping Ink Code to Item Code)
  const fetchAllItemsForValidation = useCallback(async () => {
    try {
      const response = await axios.get("/api/forms/products?includeAll=true&limit=999999");
      return response.data.data || [];
    } catch (error) {
      console.error("Error fetching all items:", error);
      return [];
    }
  }, []);

  // Fetch existing sales items for validation
  const fetchAllSalesItemsForValidation = useCallback(async () => {
    if (!selectedCustomer) return new Set();
    try {
      const response = await axios.get(
        `/api/forms/sales-items?acno=${selectedCustomer}`
      );
      // Create a set of item codes for this customer
      const itemCodes = new Set(response.data.map((s) => s.itcd?.toString()));
      return itemCodes;
    } catch (error) {
      console.error("Error fetching existing sales items:", error);
      return new Set();
    }
  }, [selectedCustomer]);

  const fetchAllCustomersForExport = useCallback(async () => {
    try {
      const params = new URLSearchParams({
        page: "1",
        limit: "999999", // Get all records
        search: searchStates.customers,
        // Export the same customers the directory shows
        scope: "own",
      });
      const response = await axios.get(`/api/forms/customers?${params}`);
      return response.data.customers;
    } catch (error) {
      console.error("Error fetching all customers:", error);
      return [];
    }
  }, [searchStates.customers]);

  // Every customer, ignoring the directory search box — for validating the
  // Customer Code column of the multi-customer sales-items import.
  const fetchAllCustomersForValidation = useCallback(async () => {
    try {
      const params = new URLSearchParams({ page: "1", limit: "999999" });
      const response = await axios.get(`/api/forms/customers?${params}`);
      return response.data.customers || [];
    } catch (error) {
      console.error("Error fetching customers for validation:", error);
      return [];
    }
  }, []);

  // ========== CONTACTS EXCEL IMPORT FUNCTIONS ==========

  // Parse Contacts Excel file
  const handleContactsExcelFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!selectedCustomer) {
      setContactsExcelError("Please select a customer first");
      return;
    }

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: "array" });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

          if (jsonData.length < 2) {
            setExcelError(
              "Excel file must have at least a header row and one data row"
            );
            return;
          }

          const headers = jsonData[0].map((h) =>
            String(h || "")
              .trim()
              .toLowerCase()
              .replace(/\s+/g, "")
          );

          const headerMap = {
            name: "name",
            designation: "designation",
            contact: "contact",
            contactnumber: "contact",
            phone: "contact",
          };

          const parsedData = [];
          for (let i = 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            if (!row || row.every((cell) => !cell)) continue;

            const contact = { acno: selectedCustomer };
            headers.forEach((header, index) => {
              const fieldName = headerMap[header];
              if (
                fieldName &&
                row[index] !== undefined &&
                row[index] !== null
              ) {
                contact[fieldName] = String(row[index]).trim() || null;
              }
            });

            parsedData.push(contact);
          }

          if (parsedData.length === 0) {
            setExcelError("No valid data found in Excel file");
            return;
          }

          setContactsExcelData(parsedData);
          setContactsExcelError(null);
          await validateContactsExcelData(parsedData);
        } catch (error) {
          console.error("Error parsing Excel:", error);
          setExcelError("Error parsing Excel file: " + error.message);
        }
      };
      reader.readAsArrayBuffer(file);
    } catch (error) {
      console.error("Error reading file:", error);
      setExcelError("Error reading file: " + error.message);
    }
  };

  // Validate Contacts Excel data
  const validateContactsExcelData = async (data) => {
    setIsValidatingContacts(true);
    try {
      const existingContactKeys = await fetchAllContactsForValidation();
      const validation = {};

      data.forEach((row, index) => {
        const errors = [];
        const warnings = [];

        if (!row.name || !row.name.trim()) {
          errors.push("Name is required");
        }

        if (!row.contact || !row.contact.trim()) {
          errors.push("Contact Number is required");
        } else {
          // Validate phone number format
          if (!validatePhoneNumber(row.contact)) {
            errors.push("Invalid phone number format");
          }
        }

        // Check if contact already exists (name + contact combination)
        if (row.name && row.contact) {
          const contactKey = `${row.name.toLowerCase()}_${row.contact}`;
          if (existingContactKeys.has(contactKey)) {
            warnings.push(
              `Contact "${row.name}" with number "${row.contact}" already exists`
            );
          }
        }

        if (errors.length > 0 || warnings.length > 0) {
          validation[index] = { errors, warnings };
        }
      });

      setContactsExcelValidation(validation);
    } catch (error) {
      console.error("Error validating data:", error);
      setContactsExcelError("Error validating data: " + error.message);
    } finally {
      setIsValidatingContacts(false);
    }
  };

  // Update Contacts Excel data row
  const updateContactsExcelRow = (index, field, value) => {
    const newData = [...contactsExcelData];
    newData[index] = { ...newData[index], [field]: value };
    setContactsExcelData(newData);

    setTimeout(() => {
      validateContactsExcelData(newData);
    }, 300);
  };

  // Remove Contacts Excel data row
  const removeContactsExcelRow = (index) => {
    const newData = contactsExcelData.filter((_, i) => i !== index);
    setContactsExcelData(newData);

    // Re-validate with updated indices
    setTimeout(() => {
      validateContactsExcelData(newData);
    }, 100);
  };

  // Generate and download Contacts demo Excel template
  const downloadContactsDemoExcel = () => {
    const workbook = XLSX.utils.book_new();

    const headers = ["Name", "Designation", "Contact Number"];

    const sampleData = [
      ["John Doe", "Manager", "+92 300 1234567"],
      ["Jane Smith", "Director", "+92 300 9876543"],
    ];

    const worksheetData = [headers, ...sampleData];
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    const columnWidths = [
      { wch: 25 }, // Name
      { wch: 20 }, // Designation
      { wch: 20 }, // Contact Number
    ];
    worksheet["!cols"] = columnWidths;

    const headerStyle = {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "3498DB" } },
      alignment: { horizontal: "center", vertical: "center" },
    };

    const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1");
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
      if (!worksheet[cellAddress]) worksheet[cellAddress] = { v: "" };
      worksheet[cellAddress].s = headerStyle;
    }

    XLSX.utils.book_append_sheet(workbook, worksheet, "Contacts Template");
    XLSX.writeFile(workbook, "Contacts_Import_Template.xlsx");
  };

  // Import Contacts Excel data
  const handleImportContactsExcelData = async () => {
    const validDataWithIndex = contactsExcelData
      .map((data, index) => ({ data, originalIndex: index }))
      .filter(({ originalIndex }) => {
        const validation = contactsExcelValidation[originalIndex];
        return (
          !validation ||
          (validation.errors.length === 0 && validation.warnings.length === 0)
        );
      });

    if (validDataWithIndex.length === 0) {
      setExcelError(
        "No valid data to import. Please fix errors and warnings first."
      );
      return;
    }

    setIsImportingContacts(true);
    try {
      const successRows = [];
      const failedRows = [];

      for (let i = 0; i < validDataWithIndex.length; i++) {
        try {
          await axios.post("/api/forms/contacts", validDataWithIndex[i].data);
          const excelRowNumber = validDataWithIndex[i].originalIndex + 1;
          successRows.push(excelRowNumber);
        } catch (error) {
          const excelRowNumber = validDataWithIndex[i].originalIndex + 1;
          failedRows.push(excelRowNumber);
        }
      }

      if (failedRows.length > 0) {
        const errorMessage =
          (successRows.length > 0
            ? `Row ${successRows.join(", ")} success\n`
            : "") + `Row ${failedRows.join(", ")} import failed`;
        setContactsExcelError(errorMessage);
        setContactsExcelSuccess(null);
        // Keep modal open and data intact so user can see errors and fix them
        refetchContacts(); // Refresh to show successfully imported items
      } else {
        setContactsExcelSuccess(`Row ${successRows.join(", ")} success`);
        setContactsExcelError(null);
        // Reset and refresh only on success
        setContactsExcelData([]);
        setContactsExcelValidation({});
        refetchContacts();
        setTimeout(() => {
          setModalIsOpen(false);
        }, 2000);
      }
    } catch (error) {
      console.error("Error importing data:", error);
      setContactsExcelError("Error importing data: " + error.message);
    } finally {
      setIsImportingContacts(false);
    }
  };

  // ========== SALES ITEMS EXCEL IMPORT FUNCTIONS ==========

  // Parse Sales Items Excel file
  const handleSalesExcelFileUpload = async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;

    // Multi-customer import (Customer Directory): each row names its customer
    // in a "Customer Code" column instead of using the selected customer.
    const isMulti = modalTab === "addbyexcelsalesmulti";

    if (!isMulti && !selectedCustomer) {
      setContactsExcelError("Please select a customer first");
      return;
    }

    try {
      const reader = new FileReader();
      reader.onload = async (e) => {
        try {
          const data = new Uint8Array(e.target.result);
          const workbook = XLSX.read(data, { type: "array" });
          const firstSheet = workbook.Sheets[workbook.SheetNames[0]];
          const jsonData = XLSX.utils.sheet_to_json(firstSheet, { header: 1 });

          if (jsonData.length < 2) {
            setExcelError(
              "Excel file must have at least a header row and one data row"
            );
            return;
          }

          const headers = jsonData[0].map((h) =>
            String(h || "")
              .trim()
              .toLowerCase()
              .replace(/\s+/g, "")
          );

          const headerMap = {
            itemcode: "itcd",
            item: "itcd",
            itcd: "itcd",
            inkcode: "code",
            code: "code",
            rate: "rate",
            gstrate: "gst_rate",
            "gstrate(%)": "gst_rate",
            gst: "gst_rate",
            // Customer column — read only in the multi-customer import
            ...(isMulti && {
              customercode: "acno",
              customer: "acno",
              acno: "acno",
              accountno: "acno",
              account: "acno",
            }),
          };

          const parsedData = [];
          for (let i = 1; i < jsonData.length; i++) {
            const row = jsonData[i];
            if (!row || row.every((cell) => !cell)) continue;

            const salesItem = isMulti ? { acno: null } : { acno: selectedCustomer };
            headers.forEach((header, index) => {
              const fieldName = headerMap[header];
              if (
                fieldName &&
                row[index] !== undefined &&
                row[index] !== null
              ) {
                let value = row[index];

                if (fieldName === "itcd" || fieldName === "acno") {
                  value = parseInt(value) || null;
                } else if (fieldName === "rate" || fieldName === "gst_rate") {
                  value = parseFloat(value) || null;
                } else {
                  value = String(value).trim() || null;
                }

                salesItem[fieldName] = value;
              }
            });

            if (!salesItem.dated) {
              salesItem.dated = new Date().toISOString();
            }

            parsedData.push(salesItem);
          }

          if (parsedData.length === 0) {
            setExcelError("No valid data found in Excel file");
            return;
          }

          setSalesExcelData(parsedData);
          setSalesExcelError(null);
          await validateSalesExcelData(parsedData);
        } catch (error) {
          console.error("Error parsing Excel:", error);
          setExcelError("Error parsing Excel file: " + error.message);
        }
      };
      reader.readAsArrayBuffer(file);
    } catch (error) {
      console.error("Error reading file:", error);
      setExcelError("Error reading file: " + error.message);
    }
  };

  // Validate Sales Items Excel data
  const validateSalesExcelData = async (data) => {
    setIsValidatingSales(true);
    const isMulti = modalTab === "addbyexcelsalesmulti";
    try {
      const [existingItemCodes, allItems, allCustomers] = await Promise.all([
        fetchAllSalesItemsForValidation(),
        fetchAllItemsForValidation(),
        isMulti ? fetchAllCustomersForValidation() : Promise.resolve([]),
      ]);
      const validation = {};

      const itemMapByCode = new Map(
        allItems
          .filter(item => item.code)
          .map(item => [String(item.code).trim().toLowerCase(), item])
      );
      const customerMap = new Map(
        allCustomers.map((c) => [Number(c.acno), c])
      );

      data.forEach((row, index) => {
        const errors = [];
        const warnings = [];

        // Multi-customer: the row's customer must exist. Its name and default
        // GST rate are kept on the row (for the preview and the import);
        // the API reads only acno / itcd / rate / gst_rate.
        if (isMulti) {
          if (!row.acno) {
            errors.push("Customer Code is required");
            row.customer_name = "";
          } else {
            const cust = customerMap.get(Number(row.acno));
            if (!cust) {
              errors.push(`Customer Code "${row.acno}" not found`);
              row.customer_name = "";
            } else {
              row.customer_name = cust.acname || "";
              row.customer_st_rate = cust.stRate || 0;
            }
          }
        }

        if (!row.code) {
          errors.push("Ink Code is required");
        } else {
          const inkCodeStr = String(row.code).trim().toLowerCase();
          const matchedItem = itemMapByCode.get(inkCodeStr);
          
          if (!matchedItem) {
            errors.push(`Ink Code "${row.code}" not found in Item Master`);
          } else {
            row.itcd = matchedItem.itcd; // Map to itcd for backend
            
            // Existing item check removed so it upserts without warning
          }
        }

        if (!row.rate || isNaN(row.rate) || row.rate < 0) {
          errors.push("Rate is required and must be a positive number");
        }

        // Validate GST rate
        if (
          row.gst_rate &&
          (isNaN(row.gst_rate) || row.gst_rate < 0 || row.gst_rate > 100)
        ) {
          errors.push("GST Rate must be between 0 and 100");
        }

        if (errors.length > 0 || warnings.length > 0) {
          validation[index] = { errors, warnings };
        }
      });

      setSalesExcelValidation(validation);
    } catch (error) {
      console.error("Error validating data:", error);
      setSalesExcelError("Error validating data: " + error.message);
    } finally {
      setIsValidatingSales(false);
    }
  };

  // Update Sales Excel data row
  const updateSalesExcelRow = (index, field, value) => {
    const newData = [...salesExcelData];
    newData[index] = { ...newData[index], [field]: value };
    setSalesExcelData(newData);

    setTimeout(() => {
      validateSalesExcelData(newData);
    }, 300);
  };

  // Remove Sales Excel data row
  const removeSalesExcelRow = (index) => {
    const newData = salesExcelData.filter((_, i) => i !== index);
    setSalesExcelData(newData);

    // Re-validate with updated indices
    setTimeout(() => {
      validateSalesExcelData(newData);
    }, 100);
  };

  // Generate and download Sales Items demo Excel template
  const downloadSalesDemoExcel = () => {
    const workbook = XLSX.utils.book_new();
    // Multi-customer template = the same columns plus Customer Code in front
    const isMulti = modalTab === "addbyexcelsalesmulti";

    const headers = isMulti
      ? ["Customer Code", "Ink Code", "Rate", "GST Rate (%)"]
      : ["Ink Code", "Rate", "GST Rate (%)"];

    const sampleData = isMulti
      ? [
          [1053, "INK001", 1500.0, 17],
          [1053, "INK002", 2500.0, 17],
          [2147, "INK001", 1450.0, 17],
        ]
      : [
          ["INK001", 1500.0, 17],
          ["INK002", 2500.0, 17],
        ];

    const worksheetData = [headers, ...sampleData];
    const worksheet = XLSX.utils.aoa_to_sheet(worksheetData);

    const columnWidths = [
      ...(isMulti ? [{ wch: 18 }] : []), // Customer Code
      { wch: 20 }, // Ink Code
      { wch: 15 }, // Rate
      { wch: 15 }, // GST Rate
    ];
    worksheet["!cols"] = columnWidths;

    const headerStyle = {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "3498DB" } },
      alignment: { horizontal: "center", vertical: "center" },
    };

    const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1");
    for (let col = range.s.c; col <= range.e.c; col++) {
      const cellAddress = XLSX.utils.encode_cell({ r: 0, c: col });
      if (!worksheet[cellAddress]) worksheet[cellAddress] = { v: "" };
      worksheet[cellAddress].s = headerStyle;
    }

    XLSX.utils.book_append_sheet(workbook, worksheet, "Sales Items Template");
    XLSX.writeFile(
      workbook,
      isMulti
        ? "Sales_Items_Multi_Customer_Template.xlsx"
        : "Sales_Items_Import_Template.xlsx"
    );
  };

  // Import Sales Items Excel data
  const handleImportSalesExcelData = async () => {
    const validDataWithIndex = salesExcelData
      .map((data, index) => ({ data, originalIndex: index }))
      .filter(({ originalIndex }) => {
        const validation = salesExcelValidation[originalIndex];
        return (
          !validation ||
          (validation.errors.length === 0 && validation.warnings.length === 0)
        );
      });

    if (validDataWithIndex.length === 0) {
      setExcelError(
        "No valid data to import. Please fix errors and warnings first."
      );
      return;
    }

    setIsImportingSales(true);
    try {
      const successRows = [];
      const failedRows = [];

      // Get selected customer's stRate to use as default gst_rate
      const selectedCustData = customersData.customers.find(
        (c) => c.acno === selectedCustomer
      );
      const defaultGstRate = selectedCustData?.stRate || 0;

      for (let i = 0; i < validDataWithIndex.length; i++) {
        try {
          const itemData = { ...validDataWithIndex[i].data };
          // If gst_rate is not provided, use the customer's st_rate — in the
          // multi-customer import, that row's own customer.
          if (!itemData.gst_rate) {
            itemData.gst_rate =
              modalTab === "addbyexcelsalesmulti"
                ? itemData.customer_st_rate || 0
                : defaultGstRate;
          }
          // Preview-only fields, not for the API
          delete itemData.customer_name;
          delete itemData.customer_st_rate;
          await axios.post(
            "/api/forms/sales-items",
            itemData
          );
          const excelRowNumber = validDataWithIndex[i].originalIndex + 1;
          successRows.push(excelRowNumber);
        } catch (error) {
          const excelRowNumber = validDataWithIndex[i].originalIndex + 1;
          failedRows.push(excelRowNumber);
        }
      }

      // Green toast (top-right), white text — the global Toaster's default
      // success style is a pale green, so it is overridden here.
      const successToastStyle = {
        style: { background: "#16a34a", color: "#ffffff", border: "none" },
      };

      if (failedRows.length > 0) {
        if (successRows.length > 0) {
          toast.success(
            `${successRows.length} Sales Item(s) Save Successfully`,
            successToastStyle
          );
        }
        const errorMessage =
          (successRows.length > 0
            ? `Row ${successRows.join(", ")} success\n`
            : "") + `Row ${failedRows.join(", ")} import failed`;
        setSalesExcelError(errorMessage);
        setSalesExcelSuccess(null);
        // Keep modal open and data intact so user can see errors and fix them
        refetchSalesItems(); // Refresh to show successfully imported items
      } else {
        toast.success(
          `${successRows.length} Sales Item(s) Saved Successfully`,
          successToastStyle
        );
        setSalesExcelSuccess(`Row ${successRows.join(", ")} success`);
        setSalesExcelError(null);
        // Reset and refresh only on success
        setSalesExcelData([]);
        setSalesExcelValidation({});
        refetchSalesItems();
        setTimeout(() => {
          setModalIsOpen(false);
        }, 2000);
      }
    } catch (error) {
      console.error("Error importing data:", error);
      setSalesExcelError("Error importing data: " + error.message);
    } finally {
      setIsImportingSales(false);
    }
  };

  // Excel Export Function for Customer Management
  const exportToExcel = async () => {
    // Fetch all customers for export
    const allCustomers = await fetchAllCustomersForExport();

    if (allCustomers.length === 0) {
      toast.info("No customers to export");
      return;
    }

    const workbook = XLSX.utils.book_new();

    const formatCellValue = (value) => {
      if (
        value === null ||
        value === undefined ||
        value === "" ||
        value === 0 ||
        value === "0" ||
        value === "N/A"
      ) {
        return "";
      }
      return value;
    };

    const calculateColumnWidth = (data, columnKey) => {
      const headerLength = columnKey.length;
      const maxContentLength = Math.max(
        ...data.map((row) =>
          row[columnKey] ? row[columnKey].toString().length : 0
        )
      );

      if (
        columnKey.toLowerCase().includes("company") ||
        columnKey.toLowerCase().includes("name") ||
        columnKey.toLowerCase().includes("address")
      ) {
        return Math.min(Math.max(headerLength, maxContentLength, 25), 40);
      }
      return Math.min(Math.max(headerLength, maxContentLength, 12), 25);
    };

    // Use allCustomers instead of customersData.customers
    const customerData = allCustomers.map((customer) => ({
      "Account No": customer.acno,
      "Company Name": customer.acname,
      Address: formatCellValue(customer.address),
      City: formatCellValue(customer.city),
      Country: formatCellValue(customer.country),
      "Phone/Fax": formatCellValue(customer.phoneFax),
      Category: formatCellValue(customer.category),
      "Tax Status": formatCellValue(customer.tax_filing_status),
      Status: customer.status || "Active",
    }));

    // Rest of the excel code remains the same...
    // Just update the total count reference from customersData.total to allCustomers.length

    const worksheet = XLSX.utils.json_to_sheet(customerData, {
      origin: "A4",
    });

    const companyName = company?.name || "N/A";
    const reportDate = new Date().toLocaleDateString("en-US", {
      weekday: "long",
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });

    XLSX.utils.sheet_add_aoa(worksheet, [[companyName]], { origin: "A1" });
    XLSX.utils.sheet_add_aoa(worksheet, [["Customer Master Report"]], {
      origin: "A2",
    });
    XLSX.utils.sheet_add_aoa(worksheet, [[reportDate, "", "", "Page 1 of 1"]], {
      origin: "A3",
    });

    worksheet["!merges"] = [
      {
        s: { r: 0, c: 0 },
        e: { r: 0, c: Object.keys(customerData[0] || {}).length - 1 },
      },
      {
        s: { r: 1, c: 0 },
        e: { r: 1, c: Object.keys(customerData[0] || {}).length - 1 },
      },
      {
        s: { r: 2, c: 0 },
        e: { r: 2, c: Object.keys(customerData[0] || {}).length - 3 },
      },
      {
        s: { r: 2, c: Object.keys(customerData[0] || {}).length - 1 },
        e: { r: 2, c: Object.keys(customerData[0] || {}).length - 1 },
      },
    ];

    ["A1", "A2", "A3"].forEach((cellRef, idx) => {
      if (!worksheet[cellRef]) {
        const headerValues = [
          companyName,
          "Customer Master Report",
          reportDate,
        ];
        worksheet[cellRef] = { v: headerValues[idx] || "", t: "s" };
      }

      if (idx === 0) {
        worksheet[cellRef].s = {
          font: {
            bold: true,
            sz: 20,
            color: { rgb: "FFFFFF" },
            name: "Calibri",
          },
          fill: {
            patternType: "solid",
            fgColor: { rgb: "2C3E50" },
            bgColor: { rgb: "2C3E50" },
          },
          alignment: {
            horizontal: "center",
            vertical: "center",
            wrapText: true,
          },
        };
        if (!worksheet["!rows"]) worksheet["!rows"] = [];
        worksheet["!rows"][0] = { hpt: 40 };
      } else if (idx === 1) {
        worksheet[cellRef].s = {
          font: {
            bold: true,
            sz: 16,
            color: { rgb: "FFFFFF" },
            name: "Calibri",
          },
          fill: {
            patternType: "solid",
            fgColor: { rgb: "3498DB" },
            bgColor: { rgb: "3498DB" },
          },
          alignment: {
            horizontal: "center",
            vertical: "center",
            wrapText: true,
          },
        };
        worksheet["!rows"][1] = { hpt: 30 };
      } else {
        worksheet[cellRef].s = {
          font: {
            italic: true,
            sz: 10,
            color: { rgb: "2C3E50" },
            name: "Calibri",
          },
          fill: {
            patternType: "solid",
            fgColor: { rgb: "ECF0F1" },
            bgColor: { rgb: "ECF0F1" },
          },
          alignment: { horizontal: "left", vertical: "center" },
        };
        worksheet["!rows"][2] = { hpt: 25 };
      }
    });

    const pageInfoCell = XLSX.utils.encode_cell({
      r: 2,
      c: Object.keys(customerData[0] || {}).length - 1,
    });
    if (worksheet[pageInfoCell]) {
      worksheet[pageInfoCell].s = {
        font: {
          italic: true,
          sz: 10,
          color: { rgb: "2C3E50" },
          name: "Calibri",
        },
        fill: {
          patternType: "solid",
          fgColor: { rgb: "ECF0F1" },
          bgColor: { rgb: "ECF0F1" },
        },
        alignment: { horizontal: "right", vertical: "center" },
      };
    }

    const wscols = Object.keys(customerData[0] || {}).map((key) => ({
      wch: calculateColumnWidth(customerData, key),
    }));
    worksheet["!cols"] = wscols;

    const wsrows = [];
    for (let i = 0; i <= customerData.length + 3; i++) {
      wsrows.push({ hpt: i < 3 ? (i === 0 ? 40 : i === 1 ? 30 : 25) : 30 });
    }
    worksheet["!rows"] = wsrows;

    const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1");
    for (let row = 0; row <= range.e.r; row++) {
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cell = XLSX.utils.encode_cell({ r: row, c: col });
        if (!worksheet[cell]) worksheet[cell] = { v: "" };

        const borderStyle = { style: "thin", color: { rgb: "BDC3C7" } };

        if (row === 3) {
          worksheet[cell].s = {
            fill: { fgColor: { rgb: "34495E" } },
            font: { bold: true, color: { rgb: "FFFFFF" }, size: 11 },
            alignment: {
              horizontal: "center",
              vertical: "center",
              wrapText: true,
            },
            border: {
              top: borderStyle,
              bottom: borderStyle,
              left: borderStyle,
              right: borderStyle,
            },
          };
        } else if (row > 3) {
          worksheet[cell].s = {
            fill: { fgColor: { rgb: row % 2 === 0 ? "F8F9FA" : "FFFFFF" } },
            font: { size: 10, color: { rgb: "000000" } },
            alignment: {
              horizontal: "left",
              vertical: "center",
              wrapText: true,
            },
            border: {
              top: borderStyle,
              bottom: borderStyle,
              left: borderStyle,
              right: borderStyle,
            },
          };

          const columnKey = Object.keys(customerData[0] || {})[col];
          if (
            columnKey.toLowerCase().includes("no") ||
            columnKey.toLowerCase().includes("days") ||
            columnKey.toLowerCase().includes("rate") ||
            columnKey.toLowerCase().includes("limit") ||
            columnKey.toLowerCase().includes("code")
          ) {
            worksheet[cell].s.alignment = {
              horizontal: "center",
              vertical: "center",
            };
          }
        }
      }
    }

    XLSX.utils.book_append_sheet(workbook, worksheet, "Customers");
    workbook.Props = workbook.Props || {};
    workbook.Props.ActiveTab = 0;

    const timestamp = new Date().toISOString().split("T")[0].replace(/-/g, "");
    XLSX.writeFile(workbook, `Customer_Master_${timestamp}.xlsx`);
  };

  // Contacts Excel Export
  const exportContactsToExcel = () => {
    if (!selectedCustomer || contacts.length === 0) {
      toast.info("No contacts to export");
      return;
    }

    const workbook = XLSX.utils.book_new();

    const formatCellValue = (value) => {
      if (
        value === null ||
        value === undefined ||
        value === "" ||
        value === 0 ||
        value === "N/A"
      ) {
        return "";
      }
      return value;
    };

    // Get customer info
    const customer = customersData.customers.find(
      (c) => c.acno === selectedCustomer
    );

    const contactData = contacts.map((contact) => ({
      ID: contact.id,
      Name: contact.name || "",
      Designation: formatCellValue(contact.designation),
      "Contact Number": contact.contact || "",
      "Customer Account": selectedCustomer,
    }));

    const worksheet = XLSX.utils.json_to_sheet(contactData, {
      origin: "A4",
    });

    // Company Header
    XLSX.utils.sheet_add_aoa(worksheet, [[company?.name]], {
      origin: "A1",
    });

    // Report Title with Customer Info
    const title = `Contacts Report - ${customer?.acname || "Customer"}`;
    XLSX.utils.sheet_add_aoa(worksheet, [[title]], {
      origin: "A2",
    });

    // Date and Customer Info
    const reportDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    XLSX.utils.sheet_add_aoa(
      worksheet,
      [
        [
          `Generated by: ${session?.user?.name || "System"} on ${format(new Date(), "d-MMM-yyyy")}`,
          "",
          "",
          `Account #: ${selectedCustomer}`,
        ],
      ],
      {
        origin: "A3",
      }
    );

    // Merge cells
    worksheet["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: 6 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: 6 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 2 } },
      { s: { r: 2, c: 3 }, e: { r: 2, c: 6 } },
    ];

    // Apply styling
    ["A1", "A2", "A3"].forEach((cellRef, idx) => {
      if (!worksheet[cellRef]) return;

      if (idx === 0) {
        worksheet[cellRef].s = {
          font: { bold: true, sz: 18, color: { rgb: "FFFFFF" } },
          fill: { patternType: "solid", fgColor: { rgb: "2C3E50" } },
          alignment: { horizontal: "center", vertical: "center" },
        };
      } else if (idx === 1) {
        worksheet[cellRef].s = {
          font: { bold: true, sz: 14, color: { rgb: "FFFFFF" } },
          fill: { patternType: "solid", fgColor: { rgb: "27AE60" } },
          alignment: { horizontal: "center", vertical: "center" },
        };
      } else {
        worksheet[cellRef].s = {
          font: { italic: true, sz: 10, color: { rgb: "2C3E50" } },
          fill: { patternType: "solid", fgColor: { rgb: "ECF0F1" } },
          alignment: { horizontal: "left", vertical: "center" },
        };
      }
    });

    // Set column widths
    const wscols = [
      { wch: 10 }, // ID
      { wch: 30 }, // Name
      { wch: 25 }, // Designation
      { wch: 20 }, // Contact
      { wch: 20 }, // Customer Account
    ];
    worksheet["!cols"] = wscols;

    // Add borders and styling to data rows
    const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1");
    for (let row = 0; row <= range.e.r; row++) {
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cell = XLSX.utils.encode_cell({ r: row, c: col });
        if (!worksheet[cell]) worksheet[cell] = { v: "" };

        const borderStyle = { style: "thin", color: { rgb: "BDC3C7" } };

        if (row === 3) {
          worksheet[cell].s = {
            fill: { fgColor: { rgb: "34495E" } },
            font: { bold: true, color: { rgb: "FFFFFF" }, size: 11 },
            alignment: { horizontal: "center", vertical: "center" },
            border: {
              top: borderStyle,
              bottom: borderStyle,
              left: borderStyle,
              right: borderStyle,
            },
          };
        } else if (row > 3) {
          worksheet[cell].s = {
            fill: { fgColor: { rgb: row % 2 === 0 ? "F8F9FA" : "FFFFFF" } },
            font: { size: 10, color: { rgb: "000000" } },
            alignment: { horizontal: "left", vertical: "center" },
            border: {
              top: borderStyle,
              bottom: borderStyle,
              left: borderStyle,
              right: borderStyle,
            },
          };
        }
      }
    }

    XLSX.utils.book_append_sheet(workbook, worksheet, "Contacts");
    const timestamp = new Date().toISOString().split("T")[0].replace(/-/g, "");
    XLSX.writeFile(workbook, `Contacts_${selectedCustomer}_${timestamp}.xlsx`);
  };

  // Sales Items Excel Export
  const exportSalesToExcel = () => {
    if (!selectedCustomer || salesItems.length === 0) {
      toast.info("No sales items to export");
      return;
    }

    const workbook = XLSX.utils.book_new();

    const formatCellValue = (value) => {
      if (
        value === null ||
        value === undefined ||
        value === "" ||
        value === 0 ||
        value === "N/A"
      ) {
        return "";
      }
      return value;
    };

    // Get customer info
    const customer = customersData.customers.find(
      (c) => c.acno === selectedCustomer
    );

    const salesData = salesItems.map((item) => ({
      ID: item.id,
      // "Item Code": item.itcd || "",
      "Ink Code/Series": item.code || item.item?.code || "",
      "Item Name": item.item?.item || "",
      Rate: item.rate
        ? /* `${currency?.code}` + */ item.rate.toFixed(2)
        : /* `${currency?.code} ` + */ "0.00",
      "GST Rate": item.gst_rate ? `${item.gst_rate}%` : "0%",
      Date: new Date(item.dated).toLocaleDateString(),
      Description: formatCellValue(item.description),
      "Customer Account": selectedCustomer,
    }));

    const worksheet = XLSX.utils.json_to_sheet(salesData, {
      origin: "A4",
    });

    // Company Header
    XLSX.utils.sheet_add_aoa(worksheet, [[company?.name]], {
      origin: "A1",
    });

    // Report Title
    const title = `Sales Items Report - ${customer?.acname || "Customer"}`;
    XLSX.utils.sheet_add_aoa(worksheet, [[title]], {
      origin: "A2",
    });

    // Date and Info
    const reportDate = new Date().toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
    XLSX.utils.sheet_add_aoa(
      worksheet,
      [
        [
          `Generated by: ${session?.user?.name || "System"}`,
          "",
          "",
          "",
          "",
          `Account #: ${selectedCustomer}`,
          `Total Items: ${salesItems.length}`,
        ],
      ],
      {
        origin: "A3",
      }
    );

    // Merge cells
    const cols = Object.keys(salesData[0] || {}).length;
    worksheet["!merges"] = [
      { s: { r: 0, c: 0 }, e: { r: 0, c: cols - 1 } },
      { s: { r: 1, c: 0 }, e: { r: 1, c: cols - 1 } },
      { s: { r: 2, c: 0 }, e: { r: 2, c: 4 } },
      { s: { r: 2, c: 5 }, e: { r: 2, c: cols - 1 } },
    ];

    // Apply styling
    ["A1", "A2", "A3"].forEach((cellRef, idx) => {
      if (!worksheet[cellRef]) return;

      if (idx === 0) {
        worksheet[cellRef].s = {
          font: { bold: true, sz: 18, color: { rgb: "FFFFFF" } },
          fill: { patternType: "solid", fgColor: { rgb: "2C3E50" } },
          alignment: { horizontal: "center", vertical: "center" },
        };
      } else if (idx === 1) {
        worksheet[cellRef].s = {
          font: { bold: true, sz: 14, color: { rgb: "FFFFFF" } },
          fill: { patternType: "solid", fgColor: { rgb: "8E44AD" } }, // Purple for sales
          alignment: { horizontal: "center", vertical: "center" },
        };
      } else {
        worksheet[cellRef].s = {
          font: { italic: true, sz: 10, color: { rgb: "2C3E50" } },
          fill: { patternType: "solid", fgColor: { rgb: "ECF0F1" } },
          alignment: { horizontal: "left", vertical: "center" },
        };
      }
    });

    // Set column widths
    const wscols = [
      { wch: 5 }, // ID
      { wch: 15 }, // Item Code
      { wch: 20 }, // Ink Code
      { wch: 50 }, // Item Name
      { wch: 15 }, // Rate
      { wch: 12 }, // GST Rate
      { wch: 15 }, // Date
      { wch: 25 }, // Description
      { wch: 20 }, // Customer Account
    ];
    worksheet["!cols"] = wscols;

    // Add borders and styling
    const range = XLSX.utils.decode_range(worksheet["!ref"] || "A1");
    for (let row = 0; row <= range.e.r; row++) {
      for (let col = range.s.c; col <= range.e.c; col++) {
        const cell = XLSX.utils.encode_cell({ r: row, c: col });
        if (!worksheet[cell]) worksheet[cell] = { v: "" };

        const borderStyle = { style: "thin", color: { rgb: "BDC3C7" } };

        if (row === 3) {
          worksheet[cell].s = {
            fill: { fgColor: { rgb: "34495E" } },
            font: { bold: true, color: { rgb: "FFFFFF" }, size: 11 },
            alignment: { horizontal: "center", vertical: "center" },
            border: {
              top: borderStyle,
              bottom: borderStyle,
              left: borderStyle,
              right: borderStyle,
            },
          };
        } else if (row > 3) {
          worksheet[cell].s = {
            fill: { fgColor: { rgb: row % 2 === 0 ? "F8F9FA" : "FFFFFF" } },
            font: { size: 10, color: { rgb: "000000" } },
            alignment: {
              horizontal: col === 3 || col === 4 ? "center" : "left",
              vertical: "center",
            },
            border: {
              top: borderStyle,
              bottom: borderStyle,
              left: borderStyle,
              right: borderStyle,
            },
          };
        }
      }
    }

    XLSX.utils.book_append_sheet(workbook, worksheet, "Sales Items");
    const timestamp = new Date().toISOString().split("T")[0].replace(/-/g, "");
    XLSX.writeFile(
      workbook,
      `Sales_Items_${selectedCustomer}_${timestamp}.xlsx`
    );
  };

  const exportToPDF = async () => {
    try {
      const { jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");

      // Fetch all customers for export
      const allCustomers = await fetchAllCustomersForExport();

      if (allCustomers.length === 0) {
        toast.info("No customers to export");
        return;
      }

      const doc = new jsPDF({
        orientation: "landscape",
        unit: "mm",
        format: "a4",
      });

      const pageWidth = doc.internal.pageSize.width;
      const pageHeight = doc.internal.pageSize.height;
      const margin = 10;
      let currentY = margin;

      // Company Header
      doc.setFillColor(44, 62, 80);
      doc.rect(0, currentY, pageWidth, 15, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(255, 255, 255);
      doc.text(company?.name || "Company Name", pageWidth / 2, currentY + 9, {
        align: "center",
      });
      currentY += 17;

      // Report Title
      doc.setFillColor(52, 152, 219);
      doc.rect(0, currentY, pageWidth, 12, "F");
      doc.setFontSize(14);
      doc.setTextColor(255, 255, 255);
      doc.text("Customer Master Report", pageWidth / 2, currentY + 8, {
        align: "center",
      });
      currentY += 14;

      // Report Info Row


      doc.setFillColor(236, 240, 241);
      doc.rect(0, currentY, pageWidth, 8, "F");
      doc.setFont("helvetica", "italic");
      doc.setFontSize(9);
      doc.setTextColor(44, 62, 80);
      doc.text(reportDate, margin + 2, currentY + 5);
      doc.text(
        `Generated by: ${session?.user?.name || "System"}`,
        margin + 150,
        currentY + 12,
        { align: "center" }
      );
      doc.text(
        `Total: ${allCustomers.length} customers`,
        pageWidth - margin - 2,
        currentY + 5,
        { align: "right" }
      );
      currentY += 15;

      // Table Data
      const tableData = allCustomers.map((c) => [
        c.acno?.toString() || "",
        c.acname || "",
        c.city || "",
        c.address || "",
        c.category || "",
        c.tax_filing_status || "",
        c.area || "",
      ]);

      // AutoTable with proper initialization
      autoTable(doc, {
        startY: currentY,
        head: [
          [
            "Account No",
            "Company Name",
            "City",
            "Address",
            "Category",
            "Tax Status",
            "Area",
          ],
        ],
        body: tableData,
        theme: "grid",
        headStyles: {
          fillColor: [52, 73, 94],
          textColor: [255, 255, 255],
          fontSize: 10,
          fontStyle: "bold",
          halign: "center",
        },
        bodyStyles: {
          fontSize: 9,
          textColor: [0, 0, 0],
          cellPadding: 3,
        },
        alternateRowStyles: {
          fillColor: [248, 249, 250],
        },
        columnStyles: {
          0: { cellWidth: 28, halign: "center" },
          1: { cellWidth: 60 },
          2: { cellWidth: 30 },
          3: { cellWidth: 55 },
          4: { cellWidth: 30 },
          5: { cellWidth: 30, halign: "center" },
          6: { cellWidth: 30 },
        },
        margin: { left: margin, right: margin },
        didDrawPage: function (data) {
          doc.setFont("helvetica", "italic");
          doc.setFontSize(9);
          doc.setTextColor(100, 100, 100);
          doc.text(
            `Page ${data.pageNumber} | Total Customers: ${allCustomers.length}`,
            margin,
            pageHeight - 5
          );
        },
      });

      const timestamp = new Date()
        .toISOString()
        .split("T")[0]
        .replace(/-/g, "");
      doc.save(`Customer_Master_${timestamp}.pdf`);
    } catch (error) {
      console.error("PDF Export Error:", error);
      toast.error("Failed to generate PDF. Please try again.");
    }
  };

  // ✅ Contacts PDF Export - Fixed with better design
  const exportContactsToPDF = async () => {
    if (!selectedCustomer || contacts.length === 0) {
      toast.info("No contacts to export");
      return;
    }

    try {
      const { jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");

      const customer = customersData.customers.find(
        (c) => c.acno === selectedCustomer
      );
      const doc = new jsPDF();

      const pageWidth = doc.internal.pageSize.width;
      const pageHeight = doc.internal.pageSize.height;
      const margin = 14;
      let currentY = margin;

      // Company Header
      doc.setFillColor(44, 62, 80);
      doc.rect(0, currentY, pageWidth, 15, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(255, 255, 255);
      doc.text(company?.name || "Company Name", pageWidth / 2, currentY + 10, {
        align: "center",
      });
      currentY += 18;

      // Report Title
      doc.setFillColor(46, 204, 113);
      doc.rect(0, currentY, pageWidth, 12, "F");
      doc.setFontSize(14);
      doc.setTextColor(255, 255, 255);

      doc.text("Contacts Report", pageWidth / 2, currentY + 8, {
        align: "center",
      });
      currentY += 15;

      // Customer Info Box
      doc.setFillColor(236, 240, 241);
      doc.rect(margin, currentY, pageWidth - margin * 2, 20, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(44, 62, 80);
      doc.text(
        `Customer: ${customer?.acname || "N/A"}`,
        margin + 3,
        currentY + 7
      );

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(`Account No: ${selectedCustomer}`, margin + 3, currentY + 13);

      const reportDate = new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      doc.text(
        `Generated by: ${session?.user?.name || "System"} on ${format(new Date(), "d-MMM-yyyy")}`,
        pageWidth - margin - 3,
        currentY + 7,
        { align: "right" }
      );
      doc.text(
        `Total Contacts: ${contacts.length}`,
        pageWidth - margin - 3,
        currentY + 13,
        { align: "right" }
      );

      doc.text(
        `Printed By: ${session?.user?.name}`,
        pageWidth - margin - 3,
        currentY + 18,
        { align: "right" }
      );

      currentY += 25;

      // Contacts Table
      const tableData = contacts.map((contact) => [
        contact.id.toString(),
        contact.name || "",
        contact.designation || "N/A",
        contact.contact || "",
        selectedCustomer.toString(),
      ]);

      autoTable(doc, {
        startY: currentY,
        head: [
          ["ID", "Name", "Designation", "Contact Number", "Customer Account"],
        ],
        body: tableData,
        theme: "grid",
        headStyles: {
          fillColor: [46, 204, 113],
          textColor: [255, 255, 255],
          fontSize: 10,
          fontStyle: "bold",
          halign: "center",
        },
        bodyStyles: {
          fontSize: 9,
          textColor: [0, 0, 0],
          cellPadding: 3,
        },
        alternateRowStyles: {
          fillColor: [245, 245, 245],
        },
        columnStyles: {
          0: { cellWidth: 20, halign: "center" },
          1: { cellWidth: 45 },
          2: { cellWidth: 40 },
          3: { cellWidth: 40 },
          4: { cellWidth: 35, halign: "center" },
        },
      });

      // Footer
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(
        `Generated by Customer Management System`,
        pageWidth / 2,
        pageHeight - 10,
        { align: "center" }
      );

      const timestamp = new Date()
        .toISOString()
        .split("T")[0]
        .replace(/-/g, "");
      doc.save(`Contacts_${selectedCustomer}_${timestamp}.pdf`);
    } catch (error) {
      console.error("PDF Export Error:", error);
      toast.error("Failed to generate PDF. Please try again.");
    }
  };

  // ✅ Sales Items PDF Export - Fixed with better design
  const exportSalesToPDF = async () => {
    if (!selectedCustomer || salesItems.length === 0) {
      toast.info("No sales items to export");
      return;
    }

    try {
      const { jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");

      const customer = customersData.customers.find(
        (c) => c.acno === selectedCustomer
      );
      const doc = new jsPDF();

      const pageWidth = doc.internal.pageSize.width;
      const pageHeight = doc.internal.pageSize.height;
      const margin = 14;
      let currentY = margin;

      // Company Header
      doc.setFillColor(44, 62, 80);
      doc.rect(0, currentY, pageWidth, 15, "F");
      doc.setFont("helvetica", "bold");
      doc.setFontSize(16);
      doc.setTextColor(255, 255, 255);
      doc.text(company?.name || "Company Name", pageWidth / 2, currentY + 10, {
        align: "center",
      });
      currentY += 18;

      // Report Title
      doc.setFillColor(155, 89, 182);
      doc.rect(0, currentY, pageWidth, 12, "F");
      doc.setFontSize(14);
      doc.setTextColor(255, 255, 255);
      doc.text("Sales Items Report", pageWidth / 2, currentY + 8, {
        align: "center",
      });
      currentY += 15;

      // Customer Info Box
      doc.setFillColor(236, 240, 241);
      doc.rect(margin, currentY, pageWidth - margin * 2, 20, "F");

      doc.setFont("helvetica", "bold");
      doc.setFontSize(11);
      doc.setTextColor(44, 62, 80);
      doc.text(
        `Customer: ${customer?.acname || "N/A"}`,
        margin + 3,
        currentY + 7
      );

      doc.setFont("helvetica", "normal");
      doc.setFontSize(10);
      doc.text(`Account No: ${selectedCustomer}`, margin + 3, currentY + 13);

      const reportDate = new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      doc.text(
        `Generated by: ${session?.user?.name || "System"} on ${format(new Date(), "d-MMM-yyyy")}`,
        pageWidth - margin - 3,
        currentY + 7,
        { align: "right" }
      );
      doc.text(
        `Total Items: ${salesItems.length}`,
        pageWidth - margin - 3,
        currentY + 13,
        { align: "right" }
      );

      doc.text(
        `Printed By: ${session?.user?.name}`,
        pageWidth - margin - 3,
        currentY + 18,
        { align: "right" }
      );

      currentY += 25;

      // Sales Items Table
      const tableData = salesItems.map((item) => [
        item.item?.code.toString() || "",
        item.itcd?.toString() || "",
        item.item?.item || "N/A",
        /* `${currency?.code} ` + */ (item.rate?.toFixed(2) || "0.00"),
        `${item.gst_rate || "0"}%`,
        new Date(item.dated).toLocaleDateString(),
      ]);

      autoTable(doc, {
        startY: currentY,
        head: [["Ink Code", "MM", "Description", "Rate", "GST", "Date"]],
        body: tableData,
        theme: "grid",
        headStyles: {
          fillColor: [155, 89, 182],
          textColor: [255, 255, 255],
          fontSize: 10,
          fontStyle: "bold",
          halign: "center",
        },
        bodyStyles: {
          fontSize: 9,
          textColor: [0, 0, 0],
          cellPadding: 3,
        },
        alternateRowStyles: {
          fillColor: [245, 245, 245],
        },
        columnStyles: {
          0: { cellWidth: 35, halign: "center" },
          1: { cellWidth: 18, halign: "center" },
          2: { cellWidth: 65 },
          3: { cellWidth: 25, halign: "right" },
          4: { cellWidth: 18, halign: "center" },
          5: { cellWidth: 30, halign: "center" },
        },
      });

      // Footer
      doc.setFont("helvetica", "italic");
      doc.setFontSize(8);
      doc.setTextColor(100, 100, 100);
      doc.text(
        `Generated by Customer Management System`,
        pageWidth / 2,
        pageHeight - 10,
        { align: "center" }
      );

      const timestamp = new Date()
        .toISOString()
        .split("T")[0]
        .replace(/-/g, "");
      doc.save(`Sales_Items_${selectedCustomer}_${timestamp}.pdf`);
    } catch (error) {
      console.error("PDF Export Error:", error);
      toast.error("Failed to generate PDF. Please try again.");
    }
  };

  // ADD THIS MUTATION:
  const saveMutation = useMutation({
    mutationFn: async (data) => {
      const dataToSend = { ...data };

      // macno is user-selected (Account Group dropdown) for customers, not a fixed value
      if (modalTab === "customers") {
        if (dataToSend.macno) {
          dataToSend.macno = Number(dataToSend.macno);
        }

        // Convert numeric strings to numbers for customers
        if (dataToSend.crDays) {
          dataToSend.crDays = parseInt(dataToSend.crDays, 10);
        }
        if (dataToSend.crDays2) {
          dataToSend.crDays2 = parseInt(dataToSend.crDays2, 10);
        }
        if (dataToSend.stRate) {
          dataToSend.stRate = parseFloat(dataToSend.stRate);
        }
        if (dataToSend.crLimit) {
          dataToSend.crLimit = parseFloat(dataToSend.crLimit);
        }
        if (dataToSend.tax_law_code) {
          dataToSend.tax_law_code = parseInt(dataToSend.tax_law_code, 10);
        }
      }

      if (modalTab === "party" || modalTab === "sales-items") {
        dataToSend.acno = selectedCustomer;
      }
      if (modalTab === "sales-items") {
        if (!dataToSend.dated) {
          dataToSend.dated = new Date().toISOString();
        }
        // Convert rate to float for sales items
        if (dataToSend.rate) {
          dataToSend.rate = parseFloat(dataToSend.rate);
        }
        if (dataToSend.gst_rate) {
          dataToSend.gst_rate = parseFloat(dataToSend.gst_rate);
        }
      }

      if (modalType === "add") {
        return axios.post(`/api/forms/${modalTab}`, dataToSend);
      } else {
        return axios.put(`/api/forms/${modalTab}`, dataToSend);
      }
    },
    onSuccess: () => {
      // Invalidate relevant queries
      if (modalTab === "customers") {
        queryClient.invalidateQueries({ queryKey: ["customers"] });
        toast.success(
          modalType === "add" ? "New customer added successfully" : "Customer updated successfully",
        );
      } else if (modalTab === "party") {
        queryClient.invalidateQueries({ queryKey: ["contacts"] });
      } else if (modalTab === "sales-items") {
        queryClient.invalidateQueries({ queryKey: ["salesItems"] });
      }

      setModalIsOpen(false);
      setFormData({});
      setSalesError(null);
    },
    onError: (error) => {
      console.error("Error submitting form:", error);
      if (modalTab === "sales-items") {
        const errorMessage =
          error.response?.data?.error ||
          error.response?.data?.message ||
          "An error occurred while saving.";
        setSalesError(errorMessage);
      }
    },
  });

  // UPDATE handleSubmit function:
  const handleSubmit = async (e) => {
    e.preventDefault();
    // Add New Customer: Filing Status is required.
    if (
      modalTab === "customers" &&
      modalType === "add" &&
      !String(formData.tax_filing_status ?? "").trim()
    ) {
      toast.error("Filing Status is required — select Filer or Non-Filer.");
      return;
    }
    saveMutation.mutate(formData);
  };

  // Keyboard: "/" jumps to this tab's search box (Ctrl+K belongs to the
  // header search); Ctrl+S saves the open add / edit form, like its Save button.
  const isFormTab = ["customers", "party", "sales-items"].includes(modalTab);
  useKeyboardShortcuts({
    "/": () => {
      if (modalIsOpen || viewModalOpen) return;
      document.getElementById(`customer-search-${activeTab}`)?.focus();
    },
  });
  useKeyboardShortcuts(
    {
      "ctrl+s": {
        handler: () => {
          if (saveMutation.isPending) return;
          handleSubmit({ preventDefault() {} });
        },
        allowInInput: true,
      },
    },
    modalIsOpen && isFormTab
  );

  // Where the viewed customer stands today (read-only, same source as the
  // account picker on vouchers). Shown in the View window only.
  const viewAcno = Number(viewData?.acno);
  const { data: viewPosition, isLoading: viewPositionLoading } = useQuery({
    queryKey: ["accountPosition", viewAcno],
    queryFn: () =>
      axios
        .get("/api/accounts/position", { params: { acno: viewAcno } })
        .then((r) => r.data?.position ?? null),
    enabled:
      viewModalOpen && viewData?.type === "customer" && Number.isInteger(viewAcno) && viewAcno > 0,
    staleTime: 60_000,
  });

  // ADD THIS MUTATION:
  const deleteMutation = useMutation({
    mutationFn: async ({ id, tab }) => {
      const key = tab === "customers" ? "acno" : "id";
      return axios.delete(`/api/forms/${tab}`, {
        data: { [key]: id },
      });
    },
    onSuccess: (_, variables) => {
      // Invalidate relevant queries
      if (variables.tab === "customers") {
        queryClient.invalidateQueries({ queryKey: ["customers"] });
      } else if (variables.tab === "contacts") {
        queryClient.invalidateQueries({ queryKey: ["contacts"] });
      } else if (variables.tab === "sales-items") {
        queryClient.invalidateQueries({ queryKey: ["salesItems"] });
      }

      setDeleteConfirm({ open: false, id: null, tab: "" });
    },
    onError: (error) => {
      console.error("Error deleting record:", error);
    },
  });

  // UPDATE handleDelete function:
  const handleDelete = async () => {
    deleteMutation.mutate({
      id: deleteConfirm.id,
      tab: deleteConfirm.tab,
    });
  };

  const handleInputChange = (e) => {
    const { name, value } = e.target;
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleSelectChange = (name, value) => {
    setFormData((prev) => ({ ...prev, [name]: value }));
  };

  const handleFilterChange = (name, value) => {
    setFilters((prev) => ({ ...prev, [name]: value }));
    setCurrentPage(1);
  };

  const openModal = (type, tab, data) => {
    setModalType(type);
    setModalTab(tab);
    // For new customers, macno is chosen by the user (Account Group dropdown);
    // category still defaults to LOCAL
    const formDataToSet = { ...(data || {}) };
    if (type === "add" && tab === "customers" && !formDataToSet.category) {
      formDataToSet.category = "LOCAL";
    }
    setFormData(formDataToSet);
    setModalIsOpen(true);
    // Reset Excel data if not opening Excel import
    if (tab !== "addbyexcel") {
      setExcelData([]);
      setExcelValidation({});
      setExcelError(null);
      setExcelSuccess(null);
    }
    if (tab !== "addbyexcelparty") {
      setContactsExcelData([]);
      setContactsExcelValidation({});
      setContactsExcelError(null);
      setContactsExcelSuccess(null);
    }
    // Always start an Excel import empty — also when switching between the
    // single- and multi-customer sales imports, whose rows differ.
    if (tab !== "addbyexcelsales" || modalTab !== "addbyexcelsales") {
      setSalesExcelData([]);
      setSalesExcelValidation({});
      setSalesExcelError(null);
      setSalesExcelSuccess(null);
    }
  };

  const openViewModal = (data, type) => {
    setViewData({ ...data, type });
    setViewModalOpen(true);
  };

  const activeFilterCount = Object.values(filters).filter(Boolean).length;
  const salesPersonFilterOptions = (salesPersons || []).map((sp) => ({
    value: sp.id,
    label: sp.name,
  }));

  const clearFilters = () => {
    setFilters({ city: "", category: "", area: "", salesArea: "" });
    setCurrentPage(1);
  };

  const ActionButton = ({
    onClick,
    variant = "ghost",
    size = "sm",
    icon: Icon,
    children,
    className = "",
  }) => (
    <Button
      variant={variant}
      size={size}
      onClick={onClick}
      className={`h-9 px-3 transition-all duration-200 ${className}`}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );

  const ViewModal = () => {
    if (!viewData) return null;

    if (viewData.type === "customer") {
      const { type: _viewType, ...viewedCustomer } = viewData;
      const acno = viewData.acno;
      const fmt = (n) =>
        n == null || n === "" || isNaN(Number(n))
          ? "—"
          : Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 });
      const initials =
        String(viewData.acname || "")
          .split(/\s+/)
          .filter(Boolean)
          .slice(0, 2)
          .map((w) => w[0])
          .join("") || "?";
      const salesPersonName =
        salesPersons.find((sp) => String(sp.id) === String(viewData.salesArea))?.name ||
        viewData.salesArea;
      const accountGroup =
        macnoOptions.find((o) => Number(o.value) === Number(viewData.macno))?.label ||
        viewData.macno;
      const filer = viewData.tax_filing_status;

      // Where the customer stands today (GET /api/accounts/position).
      const pos = viewPosition;
      const posPending = viewPositionLoading;
      const crLimitNum = Number(pos?.crLimit ?? viewData.crLimit) || 0;
      const usedPct =
        pos && crLimitNum > 0
          ? Math.max(0, Math.min(100, Math.round((Number(pos.balance) / crLimitNum) * 100)))
          : null;
      const figures = [
        {
          label: "Balance",
          value: posPending ? "…" : pos ? fmt(Math.abs(pos.balance)) : "—",
          sub: pos ? (Number(pos.balance) >= 0 ? "Dr · as of today" : "Cr · as of today") : "As of today",
        },
        {
          label: "Overdue",
          value: posPending ? "…" : pos ? fmt(pos.overdue) : "—",
          sub: pos?.open?.oldestDays ? `Oldest open invoice ${pos.open.oldestDays} days` : "Past credit days",
          warn: Number(pos?.overdue) > 0,
        },
        {
          label: "Credit left",
          value: posPending ? "…" : pos?.creditLeft != null ? fmt(pos.creditLeft) : "—",
          sub: crLimitNum > 0 ? `Limit ${fmt(crLimitNum)}` : "No credit limit set",
          bar: usedPct,
          warn: pos?.creditLeft != null && Number(pos.creditLeft) < 0,
        },
        {
          label: "Credit days",
          value: `${viewData.crDays || 0} / ${viewData.crDays2 || 0}`,
          sub: "Normal / extended",
        },
        {
          label: "Open invoices",
          value: posPending ? "…" : pos?.open ? String(pos.open.count ?? 0) : "—",
          sub: pos?.open ? `Amount ${fmt(pos.open.amount)}` : "Unpaid sale invoices",
        },
      ];

      const KV = ({ label, value, wide = false }) => (
        <div className={wide ? "sm:col-span-2" : ""}>
          <div className="text-[11.5px] font-semibold text-muted-foreground">{label}</div>
          <div className="mt-0.5 break-words text-sm font-medium text-foreground">
            {value === null || value === undefined || value === "" ? (
              <span className="text-muted-foreground">—</span>
            ) : (
              value
            )}
          </div>
        </div>
      );
      const SecLabel = ({ children, first = false }) => (
        <div
          className={`mb-3 text-[11px] font-bold uppercase tracking-wider text-primary ${
            first ? "" : "mt-5 border-t border-border/70 pt-4"
          }`}
        >
          {children}
        </div>
      );
      const kvGrid = "grid grid-cols-1 gap-x-6 gap-y-3 sm:grid-cols-2";

      const showContacts = selectedCustomer === acno && contactsFetched;
      const showRates = selectedCustomer === acno && salesFetched;
      const goTo = (tab) => {
        setSelectedCustomer(acno);
        setActiveTab(tab);
        setViewModalOpen(false);
      };

      return (
        <Dialog open={viewModalOpen} onOpenChange={setViewModalOpen}>
          <DialogContent className="flex h-[100dvh] max-h-[100dvh] w-full max-w-none flex-col gap-0 overflow-hidden p-0 sm:h-auto sm:max-h-[92vh] sm:max-w-5xl sm:rounded-xl">
            {/* Profile header */}
            <DialogHeader className="space-y-0 border-b border-border px-4 py-4 pr-14 text-left sm:px-5">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="flex min-w-0 items-start gap-3">
                  <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-primary/10 text-sm font-bold text-primary">
                    {initials}
                  </div>
                  <div className="min-w-0">
                    <DialogTitle className="flex flex-wrap items-center gap-2 text-xl font-bold leading-tight tracking-tight">
                      <span className="break-words">{viewData.acname}</span>
                      <CodeChip>{acno}</CodeChip>
                    </DialogTitle>
                    <div className="mt-1.5 flex flex-wrap items-center gap-1.5">
                      {viewData.customerStatus && (
                        <StatusChip tone={customerStatusTone(viewData.customerStatus)}>
                          {viewData.customerStatus}
                        </StatusChip>
                      )}
                      <StatusChip tone={filer === "Filer" ? "ok" : filer ? "warn" : "mute"}>
                        {filer || "Filing status not set"}
                      </StatusChip>
                      <StatusChip tone="mute">
                        {viewData.isActive !== false ? "Official book" : "Unofficial book"}
                      </StatusChip>
                      {Number(pos?.overdue) > 0 && (
                        <StatusChip tone="warn">{fmt(pos.overdue)} overdue</StatusChip>
                      )}
                    </div>
                    <div className="mt-1.5 text-[12.5px] text-muted-foreground">
                      {[
                        accountGroup && `Group ${accountGroup}`,
                        [viewData.category, subCategoryLabel(viewData.subCategory)]
                          .filter(Boolean)
                          .join(" / "),
                        salesPersonName && `Sales person ${salesPersonName}`,
                        [viewData.city, viewData.area].filter(Boolean).join(", "),
                      ]
                        .filter(Boolean)
                        .join(" · ")}
                    </div>
                  </div>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button variant="outline" size="sm" onClick={() => goTo("party")} className="h-9 bg-background">
                    <Users className="mr-1.5 h-4 w-4" />
                    Contacts
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => goTo("sales")} className="h-9 bg-background">
                    <ShoppingCart className="mr-1.5 h-4 w-4" />
                    Item rates
                  </Button>
                  <Button
                    size="sm"
                    onClick={() => {
                      setViewModalOpen(false);
                      openModal("edit", "customers", viewedCustomer);
                    }}
                    className="h-9"
                  >
                    <Edit3 className="mr-1.5 h-4 w-4" />
                    Edit
                  </Button>
                </div>
              </div>
            </DialogHeader>

            <div className="flex-1 space-y-4 overflow-y-auto bg-muted/40 px-4 py-4 sm:px-5">
              {/* Key figures */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
                {figures.map((f) => (
                  <div key={f.label} className="min-w-0 rounded-xl border border-border bg-background px-3.5 py-3">
                    <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                      {f.label}
                    </div>
                    <div
                      className={`mt-1 truncate text-lg font-bold tabular-nums ${
                        f.warn ? "text-[#8a4b0f]" : "text-foreground"
                      }`}
                    >
                      {f.value}
                    </div>
                    {f.bar != null && (
                      <div className="mt-1.5 h-1.5 overflow-hidden rounded-full bg-muted">
                        <span
                          className={`block h-full rounded-full ${f.bar >= 90 ? "bg-destructive" : "bg-primary/70"}`}
                          style={{ width: `${f.bar}%` }}
                        />
                      </div>
                    )}
                    <div className="mt-0.5 truncate text-[12px] text-muted-foreground">{f.sub}</div>
                  </div>
                ))}
              </div>
              {!posPending && !pos && (
                <p className="text-[12.5px] text-muted-foreground">
                  Balance and overdue figures are not available for this account.
                </p>
              )}

              <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(0,1fr)_320px]">
                {/* Details */}
                <SectionCard title="Details">
                  <SecLabel first>Contact</SecLabel>
                  <div className={kvGrid}>
                    <KV label="Contact person" value={viewData.contactPerson} />
                    <KV label="Phone / fax" value={viewData.phoneFax} />
                    <KV label="Email" value={viewData.email} />
                    <KV label="Website" value={viewData.website} />
                  </div>

                  <SecLabel>Address</SecLabel>
                  <div className={kvGrid}>
                    <KV label="Address / shipping address" value={viewData.address} wide />
                    <KV label="City" value={viewData.city} />
                    <KV label="Province" value={viewData.country} />
                    <KV label="Area" value={viewData.area} />
                    <KV label="Area code" value={viewData.areaCode} />
                    <KV label="Bank address / invoicing address" value={viewData.customerBankAddr} wide />
                  </div>

                  <SecLabel>Credit &amp; bank</SecLabel>
                  <div className={kvGrid}>
                    <KV label="Credit limit" value={fmt(viewData.crLimit || 0)} />
                    <KV
                      label="Credit days"
                      value={`${viewData.crDays || 0} · extended ${viewData.crDays2 || 0}`}
                    />
                    <KV label="Customer bank" value={viewData.customerBank} />
                    <KV label="Bank account no" value={viewData.bankAccountNo} />
                    <KV label="Account group" value={accountGroup} />
                    <KV
                      label="Category"
                      value={[viewData.category, subCategoryLabel(viewData.subCategory)]
                        .filter(Boolean)
                        .join(" / ")}
                    />
                  </div>

                  <SecLabel>Tax</SecLabel>
                  <div className={kvGrid}>
                    <KV label="Filing status" value={filer} />
                    <KV label="ST rate" value={`${viewData.stRate || 0}%`} />
                    <KV label="NTN" value={viewData.ntnNo} />
                    <KV label="ST registration no" value={viewData.stRegNo} />
                  </div>

                  <SecLabel>Sales &amp; reconciliation</SecLabel>
                  <div className={kvGrid}>
                    <KV label="Sales person" value={salesPersonName} />
                    <KV label="Customer status" value={viewData.customerStatus} />
                    <KV label="Book" value={viewData.isActive !== false ? "Official" : "Unofficial"} />
                    <KV
                      label="Recon status"
                      value={
                        viewData.reconStatus === "DONE"
                          ? "Done"
                          : viewData.reconStatus === "PENDING"
                            ? "Pending"
                            : viewData.reconStatus
                      }
                    />
                    <KV label="Reconciliation remarks" value={viewData.reconciliationRemarks} wide />
                  </div>
                </SectionCard>

                {/* Side: contacts and item rates already loaded for this customer */}
                <div className="space-y-4">
                  <SectionCard
                    title="Contacts"
                    action={
                      <button
                        type="button"
                        onClick={() => goTo("party")}
                        className="font-semibold text-primary hover:underline"
                      >
                        Open
                      </button>
                    }
                    bodyClassName="p-0"
                  >
                    {showContacts && contacts.length > 0 ? (
                      <ul className="divide-y divide-border/70">
                        {contacts.slice(0, 6).map((c) => (
                          <li key={c.id} className="flex items-center gap-3 px-4 py-2.5">
                            <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary/10 text-xs font-bold text-primary">
                              {String(c.name || "?").slice(0, 1)}
                            </span>
                            <div className="min-w-0">
                              <div className="truncate text-sm font-semibold">{c.name}</div>
                              <div className="truncate text-[12px] text-muted-foreground">
                                {[c.designation, c.contact].filter(Boolean).join(" · ")}
                              </div>
                            </div>
                          </li>
                        ))}
                        {contacts.length > 6 && (
                          <li className="px-4 py-2 text-[12.5px] text-muted-foreground">
                            +{contacts.length - 6} more on the Contacts tab
                          </li>
                        )}
                      </ul>
                    ) : (
                      <p className="px-4 py-4 text-[12.5px] text-muted-foreground">
                        {showContacts
                          ? "No contacts for this customer yet."
                          : "Open the Contacts tab to see and add this customer's contacts."}
                      </p>
                    )}
                  </SectionCard>

                  <SectionCard
                    title="Item rates"
                    action={
                      <button
                        type="button"
                        onClick={() => goTo("sales")}
                        className="font-semibold text-primary hover:underline"
                      >
                        Open
                      </button>
                    }
                    bodyClassName="p-0"
                  >
                    {showRates && salesItems.length > 0 ? (
                      <ul className="divide-y divide-border/70">
                        {salesItems.slice(0, 6).map((it) => (
                          <li key={it.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
                            <div className="flex min-w-0 items-center gap-2">
                              {it.item?.code && <CodeChip>{it.item.code}</CodeChip>}
                              <span className="truncate text-sm">{it.item?.item}</span>
                            </div>
                            <span className="flex-shrink-0 text-sm font-semibold tabular-nums">
                              {it.rate?.toFixed(2)}
                            </span>
                          </li>
                        ))}
                        {salesItems.length > 6 && (
                          <li className="px-4 py-2 text-[12.5px] text-muted-foreground">
                            +{salesItems.length - 6} more on the Item rates tab
                          </li>
                        )}
                      </ul>
                    ) : (
                      <p className="px-4 py-4 text-[12.5px] text-muted-foreground">
                        {showRates
                          ? "No item rates for this customer yet."
                          : "Open the Item rates tab to see and add this customer's rates."}
                      </p>
                    )}
                  </SectionCard>

                  <p className="px-1 text-[12px] text-muted-foreground">
                    Balance, overdue and credit left use the same rules as the Customer Aging and
                    Account Ledger reports.
                  </p>
                </div>
              </div>
            </div>
          </DialogContent>
        </Dialog>
      );
    }

    return null;
  };

  // Loading / empty row shared by the three lists.
  const ListMessageRow = ({ colSpan, loading, icon: Icon, title, hint }) => (
    <tr>
      <td colSpan={colSpan} className="px-3 py-14 text-center">
        {loading ? (
          <div className="flex flex-col items-center gap-3">
            <div className="h-8 w-8 animate-spin rounded-full border-[3px] border-muted border-t-primary" />
            <span className="text-sm font-medium text-muted-foreground">{title}</span>
          </div>
        ) : (
          <div className="flex flex-col items-center gap-2">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-primary/10">
              <Icon className="h-6 w-6 text-primary" />
            </div>
            <p className="font-semibold text-foreground">{title}</p>
            {hint && <p className="text-sm text-muted-foreground">{hint}</p>}
          </div>
        )}
      </td>
    </tr>
  );

  // Excel / PDF export pair used on every tab's toolbar.
  const ExportButtons = ({ onExcel, onPdf, disabled = false }) => (
    <>
      <Button variant="outline" onClick={onExcel} disabled={disabled} className="h-10 bg-background">
        <FileSpreadsheet className="mr-2 h-4 w-4 text-primary" />
        Excel
      </Button>
      <Button variant="outline" onClick={onPdf} disabled={disabled} className="h-10 bg-background">
        <File className="mr-2 h-4 w-4 text-primary" />
        PDF
      </Button>
    </>
  );

  const subCategoryLabel = (v) => (v === "N" ? "North" : v === "S" ? "South" : v || "");

  const CustomerTable = () => {
    const totalPages = Math.max(1, Math.ceil(customersData.total / 10));
    // Up to five page buttons around the current page.
    let firstPage = Math.max(1, currentPage - 2);
    const lastPage = Math.min(totalPages, firstPage + 4);
    firstPage = Math.max(1, lastPage - 4);
    const pageButtons = Array.from(
      { length: lastPage - firstPage + 1 },
      (_, i) => firstPage + i
    );

    return (
      <div>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3 sm:px-4">
          <SearchBox
            id="customer-search-customers"
            value={searchStates.customers}
            onChange={(value) => updateSearchState("customers", value)}
            // Typed in capitals; the API search is case-insensitive anyway
            uppercase
            placeholder="Search name, city or code…"
            className="min-w-[220px] flex-1 sm:max-w-md"
          />
          <Button
            variant="outline"
            onClick={() => setShowFilters((v) => !v)}
            aria-expanded={showFilters}
            aria-controls="customer-filters"
            className={`h-10 bg-background ${showFilters || activeFilterCount ? "border-primary/40 text-primary" : ""}`}
          >
            <SlidersHorizontal className="mr-2 h-4 w-4" />
            Filters
            {activeFilterCount > 0 && (
              <span className="ml-1.5 rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground">
                {activeFilterCount}
              </span>
            )}
          </Button>
          {activeFilterCount > 0 && (
            <Button variant="outline" onClick={clearFilters} className="h-10 bg-background">
              <X className="mr-1 h-4 w-4" />
              Clear filters
            </Button>
          )}
          <div className="flex flex-wrap gap-2 sm:ml-auto">
            <ExportButtons onExcel={exportToExcel} onPdf={exportToPDF} />
          </div>
        </div>

        {showFilters && (
          <div
            id="customer-filters"
            className="grid grid-cols-1 gap-3 border-b border-border bg-primary/[0.03] p-3 sm:grid-cols-2 sm:px-4 lg:grid-cols-4"
          >
            <div className="min-w-0">
              <label htmlFor="filter-salesArea" className="mb-1 block text-[11.5px] font-semibold text-foreground/70">
                Sales person
              </label>
              <ReactSelect
                inputId="filter-salesArea"
                options={salesPersonFilterOptions}
                value={
                  salesPersonFilterOptions.find((o) => String(o.value) === String(filters.salesArea)) || null
                }
                onChange={(opt) => handleFilterChange("salesArea", opt ? String(opt.value) : "")}
                isClearable
                placeholder="Any sales person"
                menuPortalTarget={typeof document !== "undefined" ? document.body : null}
                menuPosition="fixed"
                styles={{ ...selectStyles(false), menuPortal: (base) => ({ ...base, zIndex: 60 }) }}
              />
            </div>
            <FilterInput
              id="filter-category"
              label="Category"
              value={filters.category}
              onApply={(v) => handleFilterChange("category", v)}
              placeholder="e.g. LOCAL"
            />
            <FilterInput
              id="filter-city"
              label="City"
              value={filters.city}
              onApply={(v) => handleFilterChange("city", v)}
              placeholder="e.g. KARACHI"
            />
            <FilterInput
              id="filter-area"
              label="Area"
              value={filters.area}
              onApply={(v) => handleFilterChange("area", v)}
              placeholder="e.g. DOWNTOWN"
            />
            <p className="text-[11.5px] text-muted-foreground sm:col-span-2 lg:col-span-4">
              Category, city and area must match exactly; press Enter to apply.
            </p>
          </div>
        )}

        <div className="overflow-x-auto">
          <table className="vl-grid w-full text-sm">
            <thead>
              <tr className="bg-primary">
                <th className={TH_CLS}>Customer</th>
                <th className={TH_CLS}>Contact</th>
                <th className={TH_CLS}>Category</th>
                <th className={TH_CLS}>Tax</th>
                <th className={TH_CLS}>Status</th>
                <th className={`${TH_CLS} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {customersLoading ? (
                <ListMessageRow colSpan={6} loading title="Loading customers…" />
              ) : customersData.customers.length === 0 ? (
                <ListMessageRow
                  colSpan={6}
                  icon={Building2}
                  title={searchStates.customers ? "Nothing matches your search" : "No customers yet"}
                  hint={
                    searchStates.customers
                      ? "Try another name, city or code."
                      : "Add the first one with New customer."
                  }
                />
              ) : (
                customersData.customers.map((customer) => {
                  const contactLine = [customer.phoneFax, customer.email]
                    .filter(Boolean)
                    .join(" · ");
                  const filer = customer.tax_filing_status;
                  return (
                    <tr
                      key={customer.acno}
                      onClick={() => openViewModal(customer, "customer")}
                      className={`${TR_CLS} group cursor-pointer`}
                    >
                      <td className={`${TD_CLS} min-w-[240px] max-md:col-span-2`}>
                        <div className="flex items-start gap-2">
                          <span className="mt-px flex-shrink-0">
                            <CodeChip>{customer.acno}</CodeChip>
                          </span>
                          <div className="min-w-0">
                            <div className="truncate font-semibold text-foreground" title={customer.acname}>
                              {customer.acname}
                            </div>
                            <div className="mt-0.5 truncate text-[12.5px] text-muted-foreground">
                              {[customer.city, customer.area].filter(Boolean).join(" · ") || "No city / area"}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td data-label="Contact" className={`${TD_CLS} max-w-[240px]`}>
                        <div className="truncate text-foreground/90">
                          {customer.contactPerson || <span className="text-muted-foreground">—</span>}
                        </div>
                        {contactLine && (
                          <div className="mt-0.5 truncate text-[12.5px] text-muted-foreground" title={contactLine}>
                            {contactLine}
                          </div>
                        )}
                      </td>
                      <td data-label="Category" className={TD_CLS}>
                        <div className="font-medium text-foreground/90">{customer.category || "—"}</div>
                        {customer.subCategory && (
                          <div className="mt-0.5 text-[12.5px] text-muted-foreground">
                            {subCategoryLabel(customer.subCategory)}
                          </div>
                        )}
                      </td>
                      <td data-label="Tax" className={TD_CLS}>
                        <StatusChip tone={filer === "Filer" ? "ok" : filer ? "warn" : "mute"}>
                          {filer || "Not set"}
                        </StatusChip>
                        {customer.stRate != null && customer.stRate !== "" && (
                          <div className="mt-1 text-[12px] tabular-nums text-muted-foreground">
                            ST {customer.stRate}%
                          </div>
                        )}
                      </td>
                      <td data-label="Status" className={TD_CLS}>
                        <div className="flex flex-wrap gap-1">
                          {customer.customerStatus ? (
                            <StatusChip tone={customerStatusTone(customer.customerStatus)}>
                              {customer.customerStatus}
                            </StatusChip>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                          {customer.isActive === false && (
                            <StatusChip tone="mute">Unofficial</StatusChip>
                          )}
                        </div>
                      </td>
                      <td
                        className={`${TD_CLS} vl-actions whitespace-nowrap py-1.5 text-right`}
                        onClick={(e) => e.stopPropagation()}
                      >
                        <div className="inline-flex gap-0.5 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                          <button
                            type="button"
                            onClick={() => openViewModal(customer, "customer")}
                            className={ICON_BTN_CLS}
                            title="View details"
                            aria-label="View details"
                          >
                            <Eye className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCustomer(customer.acno);
                              setActiveTab("party");
                            }}
                            className={ICON_BTN_CLS}
                            title="Contacts"
                            aria-label="Contacts"
                          >
                            <Users className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => {
                              setSelectedCustomer(customer.acno);
                              setActiveTab("sales");
                            }}
                            className={ICON_BTN_CLS}
                            title="Item rates"
                            aria-label="Item rates"
                          >
                            <ShoppingCart className="h-4 w-4" />
                          </button>
                          <button
                            type="button"
                            onClick={() => openModal("edit", "customers", customer)}
                            className={ICON_BTN_CLS}
                            title="Edit customer"
                            aria-label="Edit customer"
                          >
                            <Edit3 className="h-4 w-4" />
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {/* Paging */}
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground sm:px-4">
          <span>
            {customersData.total === 0 ? 0 : (currentPage - 1) * 10 + 1}–
            {Math.min(currentPage * 10, customersData.total)} of{" "}
            <b className="text-foreground">{customersData.total}</b> customers
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => setCurrentPage((prev) => Math.max(prev - 1, 1))}
              disabled={currentPage === 1}
              aria-label="Previous page"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background hover:border-primary hover:text-primary disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {pageButtons.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => setCurrentPage(p)}
                aria-current={p === currentPage ? "page" : undefined}
                className={`h-8 min-w-[32px] rounded-lg border px-2 text-[13px] font-semibold ${
                  p === currentPage
                    ? "border-primary bg-primary text-primary-foreground"
                    : "border-border bg-background text-foreground hover:border-primary hover:text-primary"
                }`}
              >
                {p}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setCurrentPage((prev) => prev + 1)}
              disabled={currentPage >= Math.ceil(customersData.total / 10)}
              aria-label="Next page"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background hover:border-primary hover:text-primary disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      </div>
    );
  };

  const ContactsTable = () => (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3 sm:px-4">
        {/* Searches this customer's contacts (the contacts query reads
            searchStates.contacts). */}
        <SearchBox
          id="customer-search-party"
          value={searchStates.contacts}
          onChange={(value) => updateSearchState("contacts", value)}
          placeholder="Search contacts…"
          className="min-w-[220px] flex-1 sm:max-w-md"
        />
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <ExportButtons
            onExcel={exportContactsToExcel}
            onPdf={exportContactsToPDF}
            disabled={!selectedCustomer || contacts.length === 0}
          />
          <Button
            onClick={() => openModal("add", "party", { acno: selectedCustomer })}
            className="h-10"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Add contact
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="vl-grid w-full text-sm">
          <thead>
            <tr className="bg-primary">
              <th className={TH_CLS}>ID</th>
              <th className={TH_CLS}>Name</th>
              <th className={TH_CLS}>Designation</th>
              <th className={TH_CLS}>Contact number</th>
              <th className={`${TH_CLS} text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {contactsLoading ? (
              <ListMessageRow colSpan={5} loading title="Loading contacts…" />
            ) : contacts.length === 0 ? (
              <ListMessageRow
                colSpan={5}
                icon={Users}
                title="No contacts for this customer"
                hint="Add one with Add contact, or import a sheet from Import from Excel."
              />
            ) : (
              contacts.map((contact) => (
                <tr key={contact.id} className={`${TR_CLS} group`}>
                  <td data-label="ID" className={TD_CLS}>
                    <CodeChip>{contact.id}</CodeChip>
                  </td>
                  <td data-label="Name" className={`${TD_CLS} font-semibold text-foreground`}>
                    {contact.name}
                  </td>
                  <td data-label="Designation" className={`${TD_CLS} text-foreground/90`}>
                    {contact.designation || <span className="text-muted-foreground">—</span>}
                  </td>
                  <td data-label="Contact number" className={TD_CLS}>
                    <span className="inline-flex items-center gap-1.5 font-mono text-[13px] text-foreground/90">
                      <Phone className="h-3.5 w-3.5 text-primary/70" />
                      {contact.contact}
                    </span>
                  </td>
                  <td className={`${TD_CLS} vl-actions whitespace-nowrap py-1.5 text-right`}>
                    <div className="inline-flex gap-0.5 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={() =>
                          openModal("edit", "party", {
                            ...contact,
                            acno: selectedCustomer,
                          })
                        }
                        className={ICON_BTN_CLS}
                        title="Edit contact"
                        aria-label="Edit contact"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                      {/* Delete stays switched off (as before) */}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  const SalesTable = () => (
    <div>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3 sm:px-4">
        <SearchBox
          id="customer-search-sales"
          value={searchStates.sales}
          onChange={(value) => updateSearchState("sales", value)}
          // Typed in capitals; the API search is case-insensitive anyway
          uppercase
          placeholder="Search item rates…"
          className="min-w-[220px] flex-1 sm:max-w-md"
        />
        <div className="flex flex-wrap gap-2 sm:ml-auto">
          <ExportButtons
            onExcel={exportSalesToExcel}
            onPdf={exportSalesToPDF}
            disabled={!selectedCustomer || salesItems.length === 0}
          />
          <Button
            onClick={() => {
              const selectedCustData = customersData.customers.find(
                (c) => c.acno === selectedCustomer
              );
              openModal("add", "sales-items", {
                acno: selectedCustomer,
                gst_rate: selectedCustData?.stRate || "",
              });
            }}
            className="h-10"
          >
            <Plus className="mr-1.5 h-4 w-4" />
            Add item rate
          </Button>
        </div>
      </div>

      <div className="overflow-x-auto">
        <table className="vl-grid w-full text-sm">
          <thead>
            <tr className="bg-primary">
              <th className={TH_CLS}>ID</th>
              <th className={TH_CLS}>Item</th>
              <th className={`${TH_CLS} text-right`}>Rate</th>
              <th className={`${TH_CLS} text-right`}>GST %</th>
              <th className={TH_CLS}>Date</th>
              <th className={`${TH_CLS} text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {salesLoading ? (
              <ListMessageRow colSpan={6} loading title="Loading item rates…" />
            ) : salesItems.length === 0 ? (
              <ListMessageRow
                colSpan={6}
                icon={ShoppingCart}
                title="No item rates for this customer"
                hint="Add one with Add item rate, or import a sheet from Import from Excel."
              />
            ) : (
              salesItems.map((item) => (
                <tr key={item.id} className={`${TR_CLS} group`}>
                  <td data-label="ID" className={TD_CLS}>
                    <span className="font-mono text-xs text-muted-foreground">#{item.id}</span>
                  </td>
                  <td className={`${TD_CLS} min-w-[220px] max-md:col-span-2`}>
                    <div className="flex items-start gap-2">
                      {item.item?.code && (
                        <span className="mt-px flex-shrink-0">
                          <CodeChip>{item.item.code}</CodeChip>
                        </span>
                      )}
                      <div className="min-w-0">
                        <div className="truncate font-semibold text-foreground">{item.item?.item}</div>
                        <div className="mt-0.5 text-[12px] text-muted-foreground">Item #{item.itcd}</div>
                      </div>
                    </div>
                  </td>
                  <td data-label="Rate" className={`${TD_CLS} text-right font-semibold tabular-nums`}>
                    {item.rate?.toFixed(2)}
                  </td>
                  <td data-label="GST %" className={`${TD_CLS} text-right tabular-nums text-foreground/90`}>
                    {item.gst_rate}%
                  </td>
                  <td data-label="Date" className={`${TD_CLS} whitespace-nowrap text-muted-foreground`}>
                    {new Date(item.dated).toLocaleDateString("en-GB", {
                      day: "2-digit",
                      month: "short",
                      year: "numeric",
                    })}
                  </td>
                  <td className={`${TD_CLS} vl-actions whitespace-nowrap py-1.5 text-right`}>
                    <div className="inline-flex gap-0.5 transition-opacity md:opacity-0 md:group-hover:opacity-100 md:group-focus-within:opacity-100">
                      <button
                        type="button"
                        onClick={() =>
                          openModal("edit", "sales-items", {
                            ...item,
                            acno: selectedCustomer,
                          })
                        }
                        className={ICON_BTN_CLS}
                        title="Edit item rate"
                        aria-label="Edit item rate"
                      >
                        <Edit3 className="h-4 w-4" />
                      </button>
                      {/* Delete stays switched off (as before) */}
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );

  // The customer picked for the Contacts / Item rates tabs (only known when it
  // is on the loaded page — the same lookup the tabs always used).
  const selectedCustomerRow = customersData.customers.find(
    (c) => c.acno === selectedCustomer
  );
  const selectedCustomerName = selectedCustomerRow?.acname || "Selected customer";

  // Banner above the Contacts / Item rates lists: whose rows these are.
  const SelectedCustomerStrip = () => (
    <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border bg-primary/5 px-4 py-2.5">
      <div className="flex min-w-0 items-center gap-2 text-sm">
        <span className="text-muted-foreground">Customer</span>
        <CodeChip>{selectedCustomer}</CodeChip>
        <span className="truncate font-semibold text-foreground">{selectedCustomerName}</span>
      </div>
      <Button
        variant="outline"
        size="sm"
        onClick={() => setActiveTab("customers")}
        className="h-8 bg-background"
      >
        <ChevronLeft className="mr-1 h-4 w-4" />
        Back to customers
      </Button>
    </div>
  );

  // Shown on Contacts / Item rates while no customer is picked.
  const NoCustomerPicked = ({ icon: Icon, what }) => (
    <div className="px-4 py-16 text-center">
      <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-primary/10">
        <Icon className="h-7 w-7 text-primary" />
      </div>
      <p className="font-semibold text-foreground">No customer selected</p>
      <p className="mt-1 text-sm text-muted-foreground">
        Pick a customer on the Customers tab to see their {what}.
      </p>
    </div>
  );

  const tabTriggerCls =
    "-mb-px h-12 gap-2 rounded-none border-b-2 border-transparent bg-transparent px-3 text-sm font-semibold text-muted-foreground shadow-none data-[state=active]:border-primary data-[state=active]:bg-transparent data-[state=active]:text-primary data-[state=active]:shadow-none";
  const tabCountCls =
    "inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-muted px-1.5 text-[11.5px] font-bold text-muted-foreground";

  // Summary tiles — only figures this page has already loaded.
  const summaryTiles = [
    {
      label: "Customers",
      value: customersData.total,
      sub: "In your scope",
      onClick: () => setActiveTab("customers"),
    },
    {
      label: "Selected customer",
      value: selectedCustomer ? selectedCustomerName : "None",
      sub: selectedCustomer ? `Account ${selectedCustomer}` : "Pick one from the list",
      small: true,
    },
    {
      label: "Contacts",
      value: selectedCustomer && contactsFetched ? contacts.length : "—",
      sub: selectedCustomer ? "Of the selected customer" : "Pick a customer first",
      onClick: selectedCustomer ? () => setActiveTab("party") : undefined,
    },
    {
      label: "Item rates",
      value: selectedCustomer && salesFetched ? salesItems.length : "—",
      sub: selectedCustomer ? "Of the selected customer" : "Pick a customer first",
      onClick: selectedCustomer ? () => setActiveTab("sales") : undefined,
    },
  ];

  const isImportTab = [
    "addbyexcel",
    "addbyexcelparty",
    "addbyexcelsales",
    "addbyexcelsalesmulti",
  ].includes(modalTab);

  const modalTitle = {
    customers: modalType === "add" ? "New customer" : "Edit customer",
    party: modalType === "add" ? "New contact" : "Edit contact",
    "sales-items": modalType === "add" ? "New item rate" : "Edit item rate",
    addbyexcel: "Import customers from Excel",
    addbyexcelparty: "Import contacts from Excel",
    addbyexcelsales: "Import item rates from Excel",
    addbyexcelsalesmulti: "Import item rates — many customers",
  }[modalTab];

  const modalSubtitle =
    modalTab === "customers"
      ? modalType === "edit" && formData.acno
        ? `Account ${formData.acno}`
        : "The account code is given on save"
      : modalTab === "addbyexcelsalesmulti"
        ? "Customer code + item + rate in one sheet"
        : ["party", "sales-items", "addbyexcelparty", "addbyexcelsales"].includes(modalTab) &&
            selectedCustomer
          ? `${selectedCustomerName} · ${selectedCustomer}`
          : "";

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto max-w-[1400px] space-y-4 px-3 py-5 sm:px-6">
        {/* ===== PAGE HEADER ===== */}
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <div className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20">
              <Building2 className="h-5 w-5" />
            </div>
            <div className="min-w-0">
              <div className="text-[12.5px] text-muted-foreground">Accounting · Forms</div>
              <h1 className="flex items-center gap-2 text-2xl font-bold tracking-tight">
                Customers
                <span className="inline-flex h-6 items-center rounded-full bg-primary/10 px-2.5 text-xs font-bold text-primary">
                  {customersData.total}
                </span>
              </h1>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Every Excel bulk import in one menu; the per-customer ones need a
                customer picked first (as their old buttons did). */}
            <DropdownMenu modal={false}>
              <DropdownMenuTrigger asChild>
                <Button variant="outline" className="h-10 bg-background">
                  <FileSpreadsheet className="mr-2 h-4 w-4" />
                  Import from Excel
                  <ChevronDown className="ml-1 h-4 w-4" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-[300px] p-1.5">
                <DropdownMenuItem
                  onSelect={() => openModal("add", "addbyexcel")}
                  className="flex-col items-start gap-0.5 rounded-lg px-2.5 py-2"
                >
                  <span className="font-semibold">Customers</span>
                  <span className="text-xs text-muted-foreground">
                    New customers, one per row — checked before anything is saved
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  onSelect={() => openModal("add", "addbyexcelsalesmulti")}
                  className="flex-col items-start gap-0.5 rounded-lg px-2.5 py-2"
                >
                  <span className="font-semibold">Item rates — many customers</span>
                  <span className="text-xs text-muted-foreground">
                    Customer code + item + rate in one sheet
                  </span>
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuLabel className="px-2.5 text-[11px] font-bold uppercase tracking-wider text-primary">
                  {selectedCustomer ? `For customer ${selectedCustomer}` : "Pick a customer first"}
                </DropdownMenuLabel>
                <DropdownMenuItem
                  disabled={!selectedCustomer}
                  onSelect={() => openModal("add", "addbyexcelparty")}
                  className="flex-col items-start gap-0.5 rounded-lg px-2.5 py-2"
                >
                  <span className="font-semibold">Contacts — one customer</span>
                  <span className="text-xs text-muted-foreground">
                    Name, designation, contact number
                  </span>
                </DropdownMenuItem>
                <DropdownMenuItem
                  disabled={!selectedCustomer}
                  onSelect={() => openModal("add", "addbyexcelsales")}
                  className="flex-col items-start gap-0.5 rounded-lg px-2.5 py-2"
                >
                  <span className="font-semibold">Item rates — one customer</span>
                  <span className="text-xs text-muted-foreground">
                    Item code, rate, GST % for the selected customer
                  </span>
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
            <Button onClick={() => openModal("add", "customers")} className="h-10">
              <Plus className="mr-1.5 h-4 w-4" />
              New customer
            </Button>
          </div>
        </div>

        {/* ===== SUMMARY TILES ===== */}
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {summaryTiles.map((t) => {
            const Tag = t.onClick ? "button" : "div";
            return (
              <Tag
                key={t.label}
                type={t.onClick ? "button" : undefined}
                onClick={t.onClick}
                className={`min-w-0 rounded-xl border border-border bg-background px-4 py-3 text-left ${
                  t.onClick ? "transition-colors hover:border-primary/40" : ""
                }`}
              >
                <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                  {t.label}
                </div>
                <div
                  className={`mt-1 truncate font-bold tabular-nums text-foreground ${
                    t.small ? "text-base leading-7" : "text-[22px] leading-7"
                  }`}
                  title={String(t.value)}
                >
                  {t.value}
                </div>
                <div className="mt-0.5 truncate text-[12.5px] text-muted-foreground">{t.sub}</div>
              </Tag>
            );
          })}
        </div>

        {/* ===== TABS: Customers / Contacts / Item rates ===== */}
        <Tabs value={activeTab} onValueChange={setActiveTab} className="w-full">
          <div className="overflow-hidden rounded-xl border border-border bg-background">
            <TabsList className="flex h-auto w-full justify-start gap-1 overflow-x-auto rounded-none border-b border-border bg-transparent p-0 px-2 sm:px-4">
              <TabsTrigger value="customers" className={tabTriggerCls}>
                <Building2 className="h-4 w-4" />
                Customers
                <span className={tabCountCls}>{customersData.total}</span>
              </TabsTrigger>
              <TabsTrigger value="party" className={tabTriggerCls} disabled={!selectedCustomer}>
                <Users className="h-4 w-4" />
                Contacts
                {selectedCustomer && contactsFetched && (
                  <span className={tabCountCls}>{contacts.length}</span>
                )}
              </TabsTrigger>
              <TabsTrigger value="sales" className={tabTriggerCls} disabled={!selectedCustomer}>
                <ShoppingCart className="h-4 w-4" />
                Item rates
                {selectedCustomer && salesFetched && (
                  <span className={tabCountCls}>{salesItems.length}</span>
                )}
              </TabsTrigger>
            </TabsList>

            <TabsContent value="customers" className="mt-0">
              {CustomerTable()}
            </TabsContent>

            <TabsContent value="party" className="mt-0">
              {selectedCustomer ? (
                <>
                  <SelectedCustomerStrip />
                  {ContactsTable()}
                </>
              ) : (
                <NoCustomerPicked icon={Users} what="contacts" />
              )}
            </TabsContent>

            <TabsContent value="sales" className="mt-0">
              {selectedCustomer ? (
                <>
                  <SelectedCustomerStrip />
                  {SalesTable()}
                </>
              ) : (
                <NoCustomerPicked icon={ShoppingCart} what="item rates" />
              )}
            </TabsContent>
          </div>
        </Tabs>

        {/* ===== ADD / EDIT + EXCEL IMPORT WINDOW ===== */}
        <Dialog
          open={modalIsOpen}
          onOpenChange={(open) => {
            setModalIsOpen(open);
            if (!open) {
              setSalesError(null); // Clear error when closing
              setExcelData([]);
              setExcelValidation({});
            }
          }}
        >
          <DialogContent
            className={`flex h-[100dvh] max-h-[100dvh] w-full max-w-none flex-col gap-0 overflow-hidden p-0 sm:h-auto sm:max-h-[92vh] sm:rounded-xl ${
              modalTab === "customers" || isImportTab ? "sm:max-w-5xl" : "sm:max-w-2xl"
            }`}
          >
            <DialogHeader className="border-b border-border px-5 py-4 pr-14 text-left">
              <DialogTitle className="flex items-center gap-3">
                <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  {isImportTab ? (
                    <FileSpreadsheet className="h-[18px] w-[18px]" />
                  ) : modalType === "add" ? (
                    <Plus className="h-[18px] w-[18px]" />
                  ) : (
                    <Edit3 className="h-[18px] w-[18px]" />
                  )}
                </span>
                <span className="min-w-0">
                  <span className="block text-lg font-bold tracking-tight text-foreground">
                    {modalTitle}
                  </span>
                  {modalSubtitle && (
                    <span className="block truncate text-[12.5px] font-normal text-muted-foreground">
                      {modalSubtitle}
                    </span>
                  )}
                </span>
              </DialogTitle>
            </DialogHeader>

            <div
              id="customer-modal-body"
              className={`flex-1 overflow-y-auto px-4 py-4 sm:px-5 ${
                modalTab === "customers" ? "bg-muted/40" : ""
              }`}
            >
              <ModalForm
                modalTab={modalTab}
                formData={formData}
                modalType={modalType}
                handleInputChange={handleInputChange}
                handleSelectChange={handleSelectChange}
                salesError={salesError}
                currency={currency}
                setSalesError={setSalesError}
                itemOptions={itemOptions}
                salesPersons={salesPersons}
                macnoOptions={macnoOptions}
                taxCodesLoading={taxCodesLoading}
                // loading={loading}
                taxLawCodes={taxLawCodes}
                excelData={excelData}
                setExcelData={setExcelData}
                excelValidation={excelValidation}
                setExcelValidation={setExcelValidation}
                handleExcelFileUpload={handleExcelFileUpload}
                updateExcelRow={updateExcelRow}
                removeExcelRow={removeExcelRow}
                handleImportExcelData={handleImportExcelData}
                isValidating={isValidating}
                isImporting={isImporting}
                downloadDemoExcel={downloadDemoExcel}
                contactsExcelData={contactsExcelData}
                setContactsExcelData={setContactsExcelData}
                contactsExcelValidation={contactsExcelValidation}
                setContactsExcelValidation={setContactsExcelValidation}
                handleContactsExcelFileUpload={handleContactsExcelFileUpload}
                updateContactsExcelRow={updateContactsExcelRow}
                removeContactsExcelRow={removeContactsExcelRow}
                handleImportContactsExcelData={handleImportContactsExcelData}
                isValidatingContacts={isValidatingContacts}
                isImportingContacts={isImportingContacts}
                downloadContactsDemoExcel={downloadContactsDemoExcel}
                salesExcelData={salesExcelData}
                setSalesExcelData={setSalesExcelData}
                salesExcelValidation={salesExcelValidation}
                setSalesExcelValidation={setSalesExcelValidation}
                handleSalesExcelFileUpload={handleSalesExcelFileUpload}
                updateSalesExcelRow={updateSalesExcelRow}
                removeSalesExcelRow={removeSalesExcelRow}
                handleImportSalesExcelData={handleImportSalesExcelData}
                isValidatingSales={isValidatingSales}
                isImportingSales={isImportingSales}
                downloadSalesDemoExcel={downloadSalesDemoExcel}
                selectedCustomer={selectedCustomer}
                excelError={excelError}
                excelSuccess={excelSuccess}
                setExcelError={setExcelError}
                setExcelSuccess={setExcelSuccess}
                contactsExcelError={contactsExcelError}
                contactsExcelSuccess={contactsExcelSuccess}
                setContactsExcelError={setContactsExcelError}
                setContactsExcelSuccess={setContactsExcelSuccess}
                salesExcelError={salesExcelError}
                salesExcelSuccess={salesExcelSuccess}
                setSalesExcelError={setSalesExcelError}
                setSalesExcelSuccess={setSalesExcelSuccess}
              />
            </div>

            {/* Sticky footer — Save / Cancel for the forms, Close for the imports */}
            {!isImportTab ? (
              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-background px-4 py-3 sm:px-5">
                <span className="hidden items-center gap-1.5 text-[12.5px] text-muted-foreground sm:inline-flex">
                  <KeyCombo combo="Ctrl+S" /> saves · <Kbd>Esc</Kbd> closes
                </span>
                <div className="ml-auto flex gap-2">
                  <Button
                    variant="outline"
                    onClick={() => {
                      setModalIsOpen(false);
                      setExcelData([]);
                      setExcelValidation({});
                    }}
                    className="h-10 bg-background"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSubmit}
                    disabled={saveMutation.isPending}
                    className="h-10 min-w-[110px]"
                  >
                    {saveMutation.isPending
                      ? "Saving…"
                      : modalType === "add"
                        ? "Save"
                        : "Update"}
                  </Button>
                </div>
              </div>
            ) : (
              <div className="flex justify-end border-t border-border bg-background px-4 py-3 sm:px-5">
                <Button
                  variant="outline"
                  onClick={() => {
                    setModalIsOpen(false);
                    setExcelData([]);
                    setExcelValidation({});
                  }}
                  className="h-10 bg-background"
                >
                  Close
                </Button>
              </div>
            )}
          </DialogContent>
        </Dialog>

        {ViewModal()}
      </div>
    </div>
  );
};

export default CustomerManagementDashboard;
