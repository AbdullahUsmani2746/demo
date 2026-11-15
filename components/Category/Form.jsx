"use client";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import React, { useState, useEffect, useCallback, useRef, useMemo } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { toast, Toaster } from "sonner";
import axios from "axios";
import AsyncCreatableSelect from "react-select/async-creatable";
import AsyncSelect from "react-select/async";
import Select from "react-select";
import { debounce } from "lodash";
import {
  PlusCircle,
  Trash2,
  Save,
  X,
  AlertCircle,
  Search,
  User,
  Calendar,
  Clock,
  DollarSign,
  IndianRupee,
  FileText,
  Zap,
  CreditCard,
  Building,
  Printer,
  Download,
  RefreshCw,
  CheckCircle2,
  Copy,
  ChevronDown,
  RotateCcw,
  Layers,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import useKeyboardShortcuts from "@/hooks/useKeyboardShortcuts";
import KeyboardHint from "@/components/ui/KeyboardHint";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { shouldLockField, VOUCHER_CONFIG, serviceLineAmounts, soLineFree } from "./constants";
import { effectiveLineType, freeLine } from "@/lib/orders/lineTypes";
import { orderTypeFlags, zeroRatesOn, ratesEditableOn, withoutGodownOn, withoutGodownConfigured, WITHOUT_GODOWN_DISPATCH } from "@/lib/orders/saleOrderApprovalRules";
import TransferConfirmation from "./TransferConfirmation";
import DocumentServicesPanel from "./DocumentServicesPanel";
import { useFeatures } from "@/hooks/useFeatures";
import { useProductionSetup } from "@/hooks/useProductionSetup";
import { useFulfilmentCheck, FulfilmentSummaryBar, FulfilmentLineStrip } from "./FulfilmentCheckPanel";
import { lineFieldsFor, hasFeatureFields } from "@/lib/features/apply";
import { groupMasterFields, masterVisualOrder } from "./formLayout";
import AccountPosition from "./AccountPosition";

// An account picker (party, cash / bank, ledger account) — gets the
// AccountPosition line under it.
const isAccountField = (field) =>
  ["pycd", "party_code", "acno"].includes(field?.formName || field?.name) ||
  /accounts/i.test(String(field?.options || ""));
import { useSession } from "next-auth/react";
import { generateGRNPDF } from "../Template/Grn";
import { generateDispatchNotePDF } from "../Template/Dispatch";
import { createPortal } from "react-dom";
import { generatePurchaseOrderPDF } from "../Template/PurchaseOrderNew";
import { generateSalesTaxInvoicePDF } from "../Template/SalesTaxInvoice";
import { generateRequisitionNotePDF } from "../Template/RequistNote";
import { useCurrency } from "@/context/CurrencyContext";
import { useCompany } from "@/context/CompanyContext";
import { generateSalesOrderPDF } from "../Template/SalesOrder";
import { generateTransferPDF } from "../Template/TransferNote";
import { generateVoucherPDF } from "../Template/Payment";
import { useFormCookies } from "@/hooks/useFormCookies";
import { generateDeliveryNotePDF } from "../Template/DeliveryNote";
import AttachmentDropzone from "@/components/Attachments/AttachmentDropzone";
import LineAttachmentButton from "@/components/Attachments/LineAttachmentButton";
// Sale Order line → Production Plan cells (Features: saleOrder.planFromOrder)
import SaleOrderPlanCell from "./SaleOrderPlanCell";

// Last qty / rate change on a saved line (line field `showLineEdit`): read-only
// note from OrderDetail.edited_by / edited_at / prev_qty / prev_rate.
function LineEditNote({ line }) {
  if (!line?.edited_at) return null;
  const fmt = (n) => Number(n || 0).toLocaleString(undefined, { maximumFractionDigits: 2 });
  const changes = [];
  if (line.prev_qty != null && Number(line.prev_qty) !== Number(line.qty)) {
    changes.push(`Qty ${fmt(line.prev_qty)} → ${fmt(line.qty)}`);
  }
  if (line.prev_rate != null && Number(line.prev_rate) !== Number(line.rate)) {
    changes.push(`Rate ${fmt(line.prev_rate)} → ${fmt(line.rate)}`);
  }
  const isAdded = line.prev_qty == null && line.prev_rate == null;
  const when = new Date(line.edited_at).toLocaleString("en-GB", {
    day: "2-digit", month: "short", year: "numeric",
    hour: "2-digit", minute: "2-digit", hour12: true,
  });
  return (
    <div className="mt-1 text-[11px] font-medium leading-snug text-blue-700">
      {isAdded ? "Added" : "Edited"} by {line.edited_by_name || "unknown"} · {when}
      {changes.length > 0 && ` (${changes.join(", ")})`}
    </div>
  );
}

// ── Save Success Dialog ────────────────────────────────────────────────────────
// Shows a centered modal after a successful save with the document numbers.

// ✅ MODIFIED: SaveSuccessDialog - Attachments count dikhao
const SaveSuccessDialog = ({ result, onClose }) => {
  const okRef = useRef(null);

  // Enter / Escape = OK. Captured at window level and stopped there so the
  // form's own shortcuts (Enter → next field, Ctrl+S, …) behind the overlay
  // don't fire while the dialog is up.
  useEffect(() => {
    if (!result) return;
    okRef.current?.focus();
    const onKey = (e) => {
      if (e.key === "Enter" || e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        onClose();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [result, onClose]);

  if (!result) return null;
  const { vrNo, grnNo, dispatchNo, tranId, isUpdate, typeName, order_no, attachments,dated,party_code } = result;

  const rows = [
    vrNo && { label: "Voucher No", value: vrNo },
    grnNo && { label: "GRN No", value: grnNo },
    dispatchNo && { label: "Dispatch No", value: dispatchNo },
    tranId && { label: "Transaction ID", value: tranId },
    dated && { label: "Date", value: dated instanceof Date ? dated.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }) : dated },
    order_no && { label: "Order No", value: order_no },
    party_code && { label: "Customer", value: typeof party_code === "object" ? party_code.label : party_code },

    attachments && { label: "📎 Attachments", value: `${attachments.count} file(s) uploaded` }, // ✅ NEW
  ].filter(Boolean);
  return createPortal(
    <AnimatePresence>
      <motion.div
        key="save-success-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.85, opacity: 0, y: 30 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.85, opacity: 0, y: 30 }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Green header */}
          <div className="bg-primary px-6 py-5 text-white text-center">
            <div className="flex justify-center mb-3">
              <div className="bg-white/20 rounded-full p-3">
                <CheckCircle2 className="h-8 w-8 text-white" />
              </div>
            </div>
            <h2 className="text-lg font-bold">
              {isUpdate ? "Updated Successfully" : "Saved Successfully"}
            </h2>
            {typeName && (
              <p className="text-primary text-sm mt-0.5">{typeName}</p>
            )}
          </div>

          {/* Document numbers */}
          {rows.length > 0 && (
            <div className="px-6 py-5 space-y-3">
              {rows.map(({ label, value }) => (
                <div key={label} className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl px-4 py-3">
                  <span className="text-sm text-slate-500 font-medium">{label}</span>
                  <div className="flex items-center gap-2">
                    <span className="text-base font-bold text-slate-800 tracking-wide font-mono">{value}</span>
                    <button
                      onClick={() => { navigator.clipboard?.writeText(String(value)); toast.success(`${label} copied`); }}
                      className="text-slate-400 hover:text-slate-600 transition-colors"
                      title="Copy"
                    >
                      <Copy className="h-3.5 w-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}

          {/* Close button — Enter / Esc also trigger it */}
          <div className="px-6 pb-5">
            <button
              ref={okRef}
              autoFocus
              onClick={onClose}
              className="w-full bg-primary hover:bg-primary text-white font-semibold rounded-xl py-2.5 transition-colors focus:outline-none focus:ring-2 focus:ring-primary/40 focus:ring-offset-2"
            >
              OK <span className="ml-1 text-xs font-normal opacity-70">(Enter)</span>
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
};

// ── Variance Error Modal ──────────────────────────────────────────────────────
const VarianceErrorModal = ({ data, onClose }) => {
  if (!data || data.length === 0) return null;

  const hasAvailability = data.some(item => item.isAvailabilityError);
  const title = hasAvailability ? "Stock & Variance Warning" : "Variance Limit Exceeded";
  const subtitle = hasAvailability
    ? "Insufficient stock or variance validation issues were detected."
    : "Dispatch quantity exceeds the allowed +10% variance threshold.";

  return createPortal(
    <AnimatePresence>
      <motion.div
        key="variance-error-overlay"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/50 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.9, opacity: 0, y: 30 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.9, opacity: 0, y: 30 }}
          transition={{ type: "spring", stiffness: 400, damping: 28 }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-lg overflow-hidden flex flex-col max-h-[85vh]"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Red/Warning Header */}
          <div className="bg-[#800000] px-6 py-5 text-white text-center relative font-sans">
            <button
              onClick={onClose}
              className="absolute right-4 top-4 text-white/80 hover:text-white transition-colors"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="flex justify-center mb-3">
              <div className="bg-white/20 rounded-full p-3 animate-pulse">
                <AlertCircle className="h-8 w-8 text-white" />
              </div>
            </div>
            <h2 className="text-xl font-bold">{title}</h2>
            <p className="text-red-100 text-sm mt-1">{subtitle}</p>
          </div>

          {/* Details list */}
          <div className="px-6 py-5 overflow-y-auto space-y-4 font-sans">
            {data.map((item, index) => {
              const badgeText = item.isAvailabilityError
                ? (item.available === 0 ? "No Stock" : `${item.exceedBy} KG Short`)
                : `+${item.exceedBy} KG Over`;

              return (
                <div key={index} className="border border-red-100 rounded-xl p-4 bg-red-50/30 space-y-3">
                  <div className="flex justify-between items-start border-b border-red-100 pb-2">
                    <div>
                      <h3 className="font-semibold text-red-900 text-sm">{item.itemName}</h3>
                      <p className="text-xs text-red-700 mt-0.5">Item Code: {item.itemId}</p>
                    </div>
                    <span className="bg-red-100 text-red-800 text-xs font-bold px-2 py-0.5 rounded-full">
                      {badgeText}
                    </span>
                  </div>

                  {item.isAvailabilityError ? (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Available Qty:</span>
                        <span className="font-medium text-gray-800">{Number(item.available).toFixed(2)} KG</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Requested Qty:</span>
                        <span className="font-semibold text-red-600">{Number(item.currentQty).toFixed(2)} KG</span>
                      </div>
                      {item.exceedBy !== undefined && Number(item.exceedBy) > 0 && (
                        <>
                          <div className="col-span-2 border-t border-dashed border-red-200/60 my-1"></div>
                          <div className="flex justify-between col-span-2 text-sm">
                            <span className="text-gray-600 font-medium">Exceeds Available By:</span>
                            <span className="font-bold text-red-600">{Number(item.exceedBy).toFixed(2)} KG</span>
                          </div>
                        </>
                      )}
                    </div>
                  ) : (
                    <div className="grid grid-cols-2 gap-x-4 gap-y-2 text-xs">
                      <div className="flex justify-between">
                        <span className="text-gray-500">Ordered Qty:</span>
                        <span className="font-medium text-gray-800">{Number(item.orderedQty).toFixed(2)} KG</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Max Allowed (+10%):</span>
                        <span className="font-medium text-gray-800">{Number(item.maxAllowed).toFixed(2)} KG</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Already Dispatched:</span>
                        <span className="font-medium text-gray-800">{Number(item.alreadyDispatched).toFixed(2)} KG</span>
                      </div>
                      <div className="flex justify-between">
                        <span className="text-gray-500">Current Qty:</span>
                        <span className="font-semibold text-red-600">{Number(item.currentQty).toFixed(2)} KG</span>
                      </div>
                      <div className="col-span-2 border-t border-dashed border-red-200/60 my-1"></div>
                      <div className="flex justify-between col-span-2 text-sm">
                        <span className="text-gray-600 font-medium">Total Dispatch Will Be:</span>
                        <span className="font-bold text-red-600">{Number(item.totalWillBe).toFixed(2)} KG</span>
                      </div>
                    </div>
                  )}

                  <p className="text-xs text-red-600 bg-red-50 border border-red-100 p-2.5 rounded-lg leading-relaxed">
                    {item.message}
                  </p>
                </div>
              );
            })}
          </div>

          {/* Close button */}
          <div className="px-6 pb-5 pt-2 border-t border-gray-100 font-sans">
            <button
              onClick={onClose}
              className="w-full bg-[#800000] hover:bg-[#660000] text-white font-semibold rounded-xl py-2.5 transition-colors shadow-sm focus:outline-none focus:ring-2 focus:ring-[#800000] focus:ring-offset-2"
            >
              OK, I Understand
            </button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
};


// ✅ ADD THE VISIBILITY FUNCTION HERE (right after imports)
const shouldShowField = (fieldConfig, formData, currentSection = "master") => {
  // If no visibility conditions, always show
  if (!fieldConfig.visibility) return true;

  const { dependsOn, condition, value } = fieldConfig.visibility;

  if (!dependsOn || !condition) return true;

  // Get the current value of the dependent field
  let dependentValue;

  if (currentSection === "master") {
    dependentValue = formData[dependsOn];
  } else {
    dependentValue = formData[dependsOn];
  }

  // Handle object values (like select options)
  const actualValue =
    typeof dependentValue === "object" ? dependentValue?.value : dependentValue;

  // Check conditions
  switch (condition) {
    case "equals":
      return actualValue === value;
    case "notEquals":
      return actualValue !== value;
    case "includes":
      return Array.isArray(value)
        ? value.includes(actualValue)
        : actualValue === value;
    case "greaterThan":
      return Number(actualValue) > Number(value);
    case "lessThan":
      return Number(actualValue) < Number(value);
    case "truthy":
      return Boolean(actualValue);
    case "falsy":
      return !Boolean(actualValue);
    case "in":
      return Array.isArray(value) && value.includes(actualValue);
    case "notIn":
      return Array.isArray(value) && !value.includes(actualValue);
    case "false":
      return false;
    default:
      return true;
  }
};

// nameKeys may name a nested value ("acno.acname"); a plain key reads as before.
// Produce-on-dispatch (voucherConfig.lineBom) helpers.
// An item id as a string, whether the value is a select option or a raw id.
const bomItcdOf = (v) => String(v?.value ?? v ?? "");
const bomRound = (n) => Math.round((Number(n) || 0) * 10000) / 10000;
const bomFmt = (n) =>
  (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 4 });

// Compact react-select styling for the inline selects in the BOM panel and the
// Service Invoice "Linked GRNs / Dispatches" field — same palette as the
// form's normalSelect, just denser.
const compactSelectStyles = (minHeight = 32) => ({
  control: (base, { isFocused }) => ({
    ...base,
    minHeight: `${minHeight}px`,
    fontSize: "0.8125rem",
    borderColor: isFocused ? "#3b82f6" : base.borderColor,
    boxShadow: isFocused ? "0 0 0 2px rgba(59,130,246,0.25)" : "none",
  }),
  valueContainer: (base) => ({ ...base, padding: "0 8px" }),
  dropdownIndicator: (base) => ({ ...base, padding: "4px 6px" }),
  clearIndicator: (base) => ({ ...base, padding: "4px" }),
  menu: (base) => ({
    ...base,
    fontSize: "0.8125rem",
    boxShadow: "0 4px 10px rgba(0, 0, 0, 0.1)",
    border: "1px solid #e2e8f0",
  }),
  option: (base, { isFocused, isSelected, isDisabled }) => ({
    ...base,
    backgroundColor: isSelected ? "#dbeafe" : isFocused ? "#eff6ff" : "white",
    color: isDisabled ? "#9ca3af" : isSelected ? "#1d4ed8" : "#111827",
    cursor: isDisabled ? "not-allowed" : "pointer",
    padding: "6px 10px",
  }),
  placeholder: (base) => ({ ...base, color: "#9ca3af" }),
  menuPortal: (base) => ({ ...base, zIndex: 100000000 }),
});

const getByPath = (obj, path) =>
  String(path).split(".").reduce((acc, k) => (acc == null ? undefined : acc[k]), obj);

// ✅ UPDATE ICON_MAP - Make it a function that accepts currency
const getIconMap = (currencySymbol) => ({
  date: Calendar,
  time: Clock,
  number: FileText,
  text: FileText,
  textarea: FileText,
  select: Building,
  acname: User,
  ccname: Building,
  currency: currencySymbol,
  invoice_no: FileText,
  narration: FileText,
  narration1: FileText,
  narration2: FileText,
  check_no: CreditCard,
  check_date: Calendar,
  pycd: Building,
  rmk: FileText,
  rmk1: FileText,
  rmk2: FileText,
  rmk3: FileText,
  rmk4: FileText,
  rmk5: FileText,
  tran_no: FileText,
  tran_id: FileText,
  st_inv_no: FileText,
  godown: Building,
  delv_n: FileText,
  prd_cat: FileText,
  com_inv_no: FileText,
  product: FileText,
  item: FileText,
  no_of_pack: FileText,
  qty_per_pack: FileText,
  qty: FileText,
  rate: currencySymbol, // ✅ Dynamic currency symbol
  gross_amount: currencySymbol, // ✅ Dynamic currency symbol
  st_rate: currencySymbol, // ✅ Dynamic currency symbol
  st_amount: currencySymbol, // ✅ Dynamic currency symbol
  additional_tax: currencySymbol, // ✅ Dynamic currency symbol
  amount: currencySymbol, // ✅ Dynamic currency symbol
});

// Print Preview Modal Component
const PrintPreviewModal = ({
  isOpen,
  onClose,
  printData,
  type,
  session,
  currency,
  company,
}) => {
  const [pdfUrl, setPdfUrl] = useState("");
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (isOpen && printData) {
      generatePrintPreview(session, currency, company);
    }
  }, [isOpen, printData]);

  const generatePrintPreview = async (session, currency, company) => {
    setLoading(true);
    try {

      console.log(printData, "=====================");
      console.log(type, "=====================");

      let doc;
      let pdfBlob;

      // Check voucher type and generate appropriate PDF
      if (type === "grn" || type === "grnEdit") {
        doc = await generateGRNPDF(
          printData.voucherId,
          session,
          currency,
          company
        );
        pdfBlob = doc.output("blob");
      } 
      else if (type === "dispatch" || type === "dispatchEdit") {
        doc = await generateDeliveryNotePDF(
          printData.voucherId,
          session,
          currency,
          company
        );
        pdfBlob = doc.output("blob");
      } else if (type === "sale") {
        const res = await axios.get(
          `/api/voucher/sale?id=${printData.voucherId}`
        );
        const voucherData = Array.isArray(res.data.data) ? res.data.data[0] : res.data.data;

        doc = await generateSalesTaxInvoicePDF({
          voucher: voucherData,
          session,
          currencyData: currency,
          companyData: company
        });
        pdfBlob = doc.output("blob");
      } else if (type === "purchaseOrder") {
        const res = await axios.get(
          `/api/orders/purchaseOrder?orderNo=${printData.voucherId}&order_catagory=4`
        );
        let orderData = res.data.data[0];

        doc = await generatePurchaseOrderPDF(
          { data: [orderData] },
          session,
          currency,
          company
        );
        pdfBlob = doc.output("blob");
      } else if (type === "saleOrder") {
        const res = await axios.get(
          `/api/orders/saleOrder?orderNo=${printData.voucherId}&order_catagory=6`
        );
        let orderData = res.data.data[0];

        doc = await generateSalesOrderPDF(
          { data: [orderData] },
          session,
          currency,
          company
        );
        pdfBlob = doc.output("blob");
      } else if (type === "requisition") {
        const res = await axios.get(
          `/api/material/requisition/${printData.voucherId}`
        );
        let data = res.data;

        doc = await generateRequisitionNotePDF(
          data,
          session,
          currency,
          company
        );
        pdfBlob = doc.output("blob");
      }

      else if (type === "transfer") {
        const res = await axios.get(
          `/api/voucher/transfer`
        );

        // Array se specific transfer find karein
        const allTransfers = res.data.data || [];
        const specificTransfer = allTransfers.find(
          item => item.tran_id === Number(printData.voucherId)
        );

        if (!specificTransfer) {
          toast.error("Transfer not found in list");
          return;
        }

        doc = await generateTransferPDF(
          specificTransfer,
          session,
          currency,
          company
        );
        pdfBlob = doc.output("blob");
      }
      else if (type === "journal" || type === "receipt" || type === "payment" || type === "bank_receipt" || type === "bank_payment") {
        const res = await axios.get(
          `/api/voucher/getById?id=${printData.voucherId}`
        );
        const voucherData = res.data.data;

        doc = await generateVoucherPDF(
          voucherData,
          company,
          currency
        );
        pdfBlob = doc.output("blob");
      }

      else {
        // Fallback to API-based PDF generation for other types
        const response = await axios.post(
          "/api/voucher/generate-pdf",
          {
            voucherId: printData.voucherId,
            type: type,
            currency: currency,
            company: company,
          },
          {
            responseType: "blob",
          }
        );
        pdfBlob = new Blob([response.data], { type: "application/pdf" });
      }

      // Create URL for preview
      const url = URL.createObjectURL(pdfBlob);
      setPdfUrl(url);
    } catch (error) {
      console.error("Failed to generate PDF:", error);
      toast.error("Failed to generate print preview");
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    const printWindow = window.open(pdfUrl);
    printWindow.onload = () => {
      printWindow.print();
    };
  };

  const handleDownload = () => {
    const link = document.createElement("a");
    link.href = pdfUrl;
    link.setAttribute("download", `voucher-${printData.voucherId}.pdf`);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ type: "spring", duration: 0.5 }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="bg-primary px-6 py-4 text-white flex justify-between items-center">
            <h2 className="text-xl font-bold">Print Preview</h2>
            <div className="flex gap-2">
              <Button
                onClick={handlePrint}
                disabled={loading || !pdfUrl}
                className="bg-white text-primary hover:bg-gray-100"
              >
                <Printer className="h-4 w-4 mr-2" />
                Print
              </Button>
              <Button
                onClick={handleDownload}
                disabled={loading || !pdfUrl}
                variant="outline"
                className="border-white bg-primary text-white hover:bg-primary"
              >
                <Download className="h-4 w-4 mr-2" />
                Download
              </Button>
              <Button
                variant="ghost"
                size="icon"
                onClick={onClose}
                className="text-white hover:bg-white/20"
              >
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>

          {/* PDF Preview */}
          <div className="flex-1 p-4 bg-gray-100">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2 text-primary" />
                  <p>Generating PDF...</p>
                </div>
              </div>
            ) : pdfUrl ? (
              <iframe
                src={pdfUrl}
                className="w-full h-full border rounded-lg bg-white"
                title="Print Preview"
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-gray-500">Failed to load PDF</p>
              </div>
            )}
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
};

/* ══════════════════════════════════════════════════════════════════════
   AMOUNT FORMATTING — 1,000 rather than 1000

   Every numeric box on a voucher (damt, camt, amount, qty, rate...) shows
   thousand separators as it is typed.

   A native <input type="number"> CANNOT do this: browsers reject any
   character that is not part of a number, so a comma is simply refused and
   the value comes back empty. The only way to group the digits is to render
   a TEXT input, format the string ourselves, and hand a clean number back to
   the form.

   That is what the three helpers below and the draft state in FormInput do:
     · the form and the payload still see a NUMBER — nothing downstream
       (calculate, validate, prepareFormData) changes
     · the user sees grouped digits
     · the caret stays where they put it, instead of jumping to the end
       every time a comma is inserted
   ══════════════════════════════════════════════════════════════════════ */

/* Numeric fields that are IDENTIFIERS rather than amounts. Invoice 1000 is
   "invoice 1000", never "invoice 1,000", and the same goes for every document
   number below — several are declared `type: "number"` in constants.js, so
   without this list they would pick up separators along with the money.
   A one-off field can also opt out with `noGrouping: true` in its config. */
const UNGROUPED_NUMERIC_FIELDS = new Set([
  "invoice_no",
  "vr_no",
  "order_no",
  "so_no",
  "po_no",
  "grn_no",
  "dispatch_no",
  "req_no",
  "check_no",
  "tran_id",
  "tran_no",
  "batch_no",
  "acno",
  "itcd",
  "ccno",
  "year",
]);

const shouldGroup = (fieldName, fieldConfig) =>
  !UNGROUPED_NUMERIC_FIELDS.has(fieldName) && !fieldConfig?.noGrouping;

// Strip the grouping back out. Everything that is not a digit, a dot or a
// leading minus goes.
const stripGrouping = (text) => {
  const s = String(text ?? "");
  const negative = s.trim().startsWith("-");
  const cleaned = s.replace(/[^0-9.]/g, "");
  // Keep only the FIRST dot — "1.2.3" is a typo, not a number.
  const [head, ...tail] = cleaned.split(".");
  const body = tail.length ? `${head}.${tail.join("")}` : head;
  return negative ? `-${body}` : body;
};

// "1234567.5" -> "1,234,567.5". The decimal part is left exactly as typed so
// a half-finished "1,000." or a trailing "1,000.50" is not rewritten under
// the user's fingers.
const groupDigits = (raw) => {
  const s = stripGrouping(raw);
  if (s === "" || s === "-") return s;
  const negative = s.startsWith("-");
  const unsigned = negative ? s.slice(1) : s;
  const [int, dec] = unsigned.split(".");
  const grouped = int.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const out = dec === undefined ? grouped : `${grouped}.${dec}`;
  return negative ? `-${out}` : out;
};

// How many significant characters (digits and the dot) sit left of the caret.
// Commas are ignored, so the caret can be put back in the same logical place
// after the string is regrouped and its length changes.
const significantBefore = (text, caret) =>
  String(text ?? "").slice(0, caret).replace(/[^0-9.]/g, "").length;

// The inverse: the string offset that sits after `count` significant chars.
const offsetAfter = (text, count) => {
  let seen = 0;
  for (let i = 0; i < text.length; i += 1) {
    if (/[0-9.]/.test(text[i])) seen += 1;
    if (seen >= count) return i + 1;
  }
  return text.length;
};

// Enhanced FormInput Component with Locking Support
const FormInput = ({
  icon: Icon,
  error,
  label,
  required,
  className = "",
  readOnly,
  locked,
  type,
  value,
  onChange,
  name,
  master = false,
  onKeyDown,
  onFocus,
  onBlur,
  uppercase = false,
  step = "any", // Add step prop with default "any"
  grouped = true, // set false on a field that must not be comma-grouped
  ...props
}) => {
  const isActuallyReadOnly = readOnly || locked;
  const isAmount = type === "number" && grouped;

  // While the box is being typed in, `draft` is what is on screen. It holds
  // the half-finished states a number cannot — "1,000." mid-decimal, or "-"
  // before the digits arrive — while the form above still receives 1000.
  // Cleared on blur so the field re-syncs to the canonical value.
  const [draft, setDraft] = useState(null);
  const inputRef = useRef(null);
  const caretRef = useRef(null);

  // Put the caret back after React re-renders with the regrouped string,
  // otherwise inserting a comma shunts it to the end of the field.
  useEffect(() => {
    if (caretRef.current == null || !inputRef.current) return;
    const pos = caretRef.current;
    caretRef.current = null;
    try {
      inputRef.current.setSelectionRange(pos, pos);
    } catch {
      /* not a text input — nothing to restore */
    }
  });

  const handleChange = (e) => {
    if (isActuallyReadOnly) return;

    let newValue = e.target.value;

    if (isAmount) {
      const typed = newValue;
      const caret = e.target.selectionStart ?? typed.length;
      const formatted = groupDigits(typed);

      // Same logical position, new string length.
      caretRef.current = offsetAfter(
        formatted,
        significantBefore(typed, caret),
      );
      setDraft(formatted);

      const clean = stripGrouping(typed);
      // "", "-" and "12." are all mid-typing states with no number in them
      // yet; send "" rather than NaN so nothing downstream has to guess.
      const parsed = parseFloat(clean);
      newValue = clean === "" || Number.isNaN(parsed) ? "" : parsed;
    } else if (type === "number") {
      // Allow empty string, otherwise parse as float
      newValue = newValue === "" ? "" : parseFloat(newValue);
    }

    if (uppercase && typeof newValue === "string") {
      newValue = newValue.toUpperCase();
    }



    onChange?.({ ...e, target: { ...e.target, value: newValue } });
  };

  return (
    <div className="space-y-1">
      {master && (
        <label className="mb-1 block text-[12.5px] font-semibold text-foreground/80">
          {label} {required && <span className="text-red-500">*</span>}
          {locked && (
            <span className="ml-2 text-xs text-orange-600 bg-orange-100 px-2 py-1 rounded">
              🔒 Locked
            </span>
          )}
        </label>
      )}

      <div className="relative">
        {typeof Icon === "string" ? (
          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">
            {Icon}
          </span>
        ) : Icon ? (
          <Icon className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
        ) : null}

        <Input
          className={`h-[38px] rounded-lg border-[#d6d7dd] text-sm focus-visible:border-primary focus-visible:ring-[3px] focus-visible:ring-primary/15 focus-visible:ring-offset-0 ${typeof Icon === "string" ? "pl-11" : Icon ? "pl-8" : "pl-3"
            } ${error ? "border-red-500 focus-visible:ring-red-500/20" : ""} ${isActuallyReadOnly
              ? "cursor-not-allowed border-[#e4e4e8] bg-muted/60"
              : ""
            } ${locked ? "bg-orange-50 border-orange-200" : ""} ${uppercase ? "uppercase" : ""
            } ${className}`}
          placeholder={label}
          name={`${name}`}
          disabled={isActuallyReadOnly}
          ref={isAmount ? inputRef : undefined}
          /* An amount is a TEXT box so the commas survive — see the note above
             FormInput. inputMode keeps the numeric keypad on a phone, and the
             browser's own spinner and number validation are traded away for
             grouping; the form validates these fields itself anyway. */
          type={isAmount ? "text" : type}
          inputMode={isAmount ? "decimal" : undefined}
          value={
            isAmount
              ? draft !== null
                ? draft
                : value === null || value === undefined || value === ""
                  ? ""
                  : groupDigits(value)
              : value === null || value === undefined
                ? ""
                : value
          }
          onChange={handleChange}
          onFocus={(e) => {
            // Start the draft from what is on screen, so the first keystroke
            // does not reformat the whole field out from under the caret.
            if (isAmount) setDraft(e.target.value);
            onFocus?.(e);
          }}
          onBlur={(e) => {
            // Drop back to the canonical value: "1,000." tidies to "1,000".
            if (isAmount) setDraft(null);
            onBlur?.(e);
          }}
          onKeyDown={onKeyDown}
          step={isAmount ? undefined : step} // Add step attribute
          {...props}
        />

        {error && !locked && (
          <AlertCircle className="absolute right-3 top-1/2 -translate-y-1/2 h-4 w-4 text-red-500" />
        )}
      </div>

      {error && !locked && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
};

// Reusable AsyncCreatableSelectCom Component
const AsyncCreatableSelectCom = ({
  value,
  onValueChange,
  placeholder,
  label,
  name,
  required,
  error,
  apiEndpoint,
  createEndpoint,
  locked, // ✅ NEW: Locked prop
  valueKey = "id",
  nameKey = "name",
  modalFields,
  onRequestCreate, // ✅ opens the AddEntityModal when modalFields are defined
  onNewCreated,
  isSmallList = false,
  onKeyDown,
  masterData, // ✅ ADD THIS PROP
  lineData, // ✅ ADD THIS PROP FOR LINE FIELDS
  fieldConfig, // ✅ ADD THIS PROP
}) => {
  const [inputValue, setInputValue] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [selectedOption, setSelectedOption] = useState(null);

  // Initialize selected option based on passed value
  useEffect(() => {
    const actualValue =
      typeof value === "object" && value?.value ? value.value : value;

    // If nameKeys are defined, the pre-built label from initFormData only has one field —
    // force a re-fetch so the combined label is built correctly.
    const needsRebuild =
      fieldConfig?.nameKeys &&
      Array.isArray(fieldConfig.nameKeys) &&
      fieldConfig.nameKeys.length > 0;

    const isAlreadyFormatted =
      typeof value === "object" &&
      value?.value &&
      value?.label &&
      String(value.label) !== String(value.value) &&
      String(value.label).includes(" - ");

    if (
      typeof value === "object" &&
      value?.value &&
      value?.label &&
      (!needsRebuild || isAlreadyFormatted)
    ) {
      setSelectedOption(value);
    } else if (
      actualValue &&
      typeof actualValue !== "object" &&
      fieldConfig?.extraOptions?.some((o) => String(o.value) === String(actualValue))
    ) {
      // Fixed option added in front of the API list (e.g. "No Godown")
      setSelectedOption(fieldConfig.extraOptions.find((o) => String(o.value) === String(actualValue)));
    } else if (actualValue && typeof actualValue !== "object") {
      const fetchLabel = async () => {
        setIsLoading(true);
        try {
          const url =
            typeof apiEndpoint === "function" ? apiEndpoint(masterData, lineData) : apiEndpoint;
          const response = await axios.get(
            `${url}${url.includes("?") ? "&" : "?"
            }${valueKey}=${encodeURIComponent(actualValue)}`
          );

          let data = response.data.data || response.data || [];

          // Fallback: if restrictive filters (like macno=27) caused exact lookup to return empty,
          // retry fetching the account directly without restrictive query params.
          if (
            Array.isArray(data) &&
            data.length === 0 &&
            typeof url === "string" &&
            url.includes("/api/accounts/acno")
          ) {
            try {
              const fallbackRes = await axios.get(
                `/api/accounts/acno?${valueKey}=${encodeURIComponent(actualValue)}`
              );
              const fallbackData = fallbackRes.data.data || fallbackRes.data || [];
              if (Array.isArray(fallbackData) && fallbackData.length > 0) {
                data = fallbackData;
              } else if (!Array.isArray(fallbackData) && fallbackData[valueKey]) {
                data = fallbackData;
              }
            } catch (fallbackErr) {
              console.warn("Fallback fetchLabel failed:", fallbackErr);
            }
          }

          const buildLabel = (item) => {
            let labelParts = [];
            if (fieldConfig?.nameKeys && Array.isArray(fieldConfig.nameKeys)) {
              fieldConfig.nameKeys.forEach((key) => {
                const v = getByPath(item, key);
                if (v != null && v !== "") {
                  labelParts.push(String(v));
                }
              });
            } else if (fieldConfig?.nameKey) {
              if (fieldConfig?.nameKey2 && Array.isArray(fieldConfig.nameKey2)) {
                fieldConfig.nameKey2.forEach((key) => {
                  if (item[key] != null && item[key] !== "") labelParts.push(String(item[key]));
                });
              }
              if (item[fieldConfig.nameKey] != null && item[fieldConfig.nameKey] !== "") {
                labelParts.push(String(item[fieldConfig.nameKey]));
              }
            } else {
              const fallback = item[nameKey] || item.title || item[valueKey];
              if (fallback != null) labelParts.push(String(fallback));
            }
            if (labelParts.length === 0) labelParts.push(String(item[valueKey]));
            const separator = fieldConfig?.separator || " - ";
            return labelParts.join(separator);
          };

          const isOffAccount = (item) =>
            item?.isActive === false || item?.mainAccount?.isActive === false;

          if (Array.isArray(data) && data.length > 0) {
            setSelectedOption({
              value: String(data[0][valueKey]),
              label: buildLabel(data[0]),
              isOffAccount: isOffAccount(data[0]),
            });
          } else if (!Array.isArray(data) && data[valueKey]) {
            setSelectedOption({
              value: String(data[valueKey]),
              label: buildLabel(data),
              isOffAccount: isOffAccount(data),
            });
          } else {
            setSelectedOption({
              value: String(actualValue),
              label: String(actualValue),
            });
          }
        } catch (err) {
          console.error("Error fetching label:", err);
          setSelectedOption({
            value: String(actualValue),
            label: String(actualValue),
          });
        } finally {
          setIsLoading(false);
        }
      };
      fetchLabel();
    } else {
      setSelectedOption(null);
    }
  }, [value, apiEndpoint, valueKey, nameKey]);

  // Load options dynamically with debounce
  const loadOptions = useCallback(
    debounce((inputValue, callback) => {
      if (locked) {
        callback([]);
        return;
      }
      setIsLoading(true);

      // ✅ FIX: Handle dynamic API endpoints properly
      let actualEndpoint = apiEndpoint;

      // If apiEndpoint is a function, call it with the necessary data
      if (typeof apiEndpoint === "function") {
        try {
          actualEndpoint = apiEndpoint(masterData, lineData);
          // ✅ ADD: Check if endpoint is valid
          if (!actualEndpoint || actualEndpoint === "" || actualEndpoint === null) {
            callback([]);
            setIsLoading(false);
            return;
          }
        } catch (error) {
          console.error("Error executing dynamic endpoint:", error);
          actualEndpoint = ""; // Fallback to empty
        }
      }

      // If we still don't have a valid endpoint, return empty
      if (!actualEndpoint) {
        callback([]);
        setIsLoading(false);
        return;
      }

      const url = actualEndpoint;

      axios
        .get(
          `${url}${url.includes("?") ? "&" : "?"}${inputValue ? `search=${encodeURIComponent(inputValue)}` : ""
          }`
        )
        .then((response) => {
          const data = response.data.data || response.data || [];
          const options = (Array.isArray(data) ? data : [data]).map((item) => {

            let labelParts = [];


            if (fieldConfig?.nameKeys && Array.isArray(fieldConfig.nameKeys)) {

              fieldConfig.nameKeys.forEach(key => {
                const v = getByPath(item, key);
                if (v != null && v !== '') {
                  labelParts.push(String(v));
                }
              });
            }

            else if (fieldConfig?.nameKey) {

              if (fieldConfig?.nameKey2 && Array.isArray(fieldConfig.nameKey2)) {
                fieldConfig.nameKey2.forEach(key => {
                  if (item[key] != null && item[key] !== '') {
                    labelParts.push(String(item[key]));
                  }
                });
              }


              if (item[fieldConfig.nameKey] != null && item[fieldConfig.nameKey] !== '') {
                labelParts.push(String(item[fieldConfig.nameKey]));
              }
            }


            if (labelParts.length === 0) {
              labelParts.push(String(item[valueKey]));
            }


            const separator = fieldConfig?.separator || ' - ';
            const label = labelParts.join(separator);

            return {
              value: String(item[valueKey]),
              label: label
            };
          });

          // field.extraOptions: fixed choices shown above the API list
          // (e.g. "No Godown" on the Sale Order), filtered by what is typed.
          const extras = (fieldConfig?.extraOptions || []).filter(
            (o) => !inputValue || String(o.label).toLowerCase().includes(String(inputValue).toLowerCase()),
          );
          callback([...extras, ...options]);
        })
        .catch((err) => {
          console.error("Error loading options:", err);
          callback([]);
        })
        .finally(() => {
          setIsLoading(false);
        });
    }, 300),
    [apiEndpoint, valueKey, nameKey, locked, masterData, lineData, fieldConfig]
  );

  // Handle creating a new option

  const handleCreate = async (inputValue) => {
    if (locked) return null; // ✅ Prevent creation if locked

    // A field that declares modalFields cannot be created from the typed text
    // alone — the record needs the other required columns (an account needs
    // macno, not just acname). Hand off to the AddEntityModal instead of
    // POSTing a half-built row.
    if (modalFields?.length && onRequestCreate) {
      onRequestCreate(inputValue);
      return null;
    }

    setIsLoading(true);
    try {
      // field.createData(text, masterData, lineData): the body to POST when the
      // new record needs more than its name (Sub Account → the line's A/c).
      const newData = fieldConfig?.createData
        ? fieldConfig.createData(inputValue, masterData, lineData)
        : { [nameKey]: inputValue };
      const response = await axios.post(createEndpoint, newData);
      const newOption = {
        value: String(response.data[valueKey]),
        label: String(
          response.data[nameKey] ||
          response.data.title ||
          response.data[valueKey]
        ),
      };
      setSelectedOption(newOption);
      onValueChange(newOption);
      if (onNewCreated) onNewCreated(newOption);
      return newOption;
    } catch (err) {
      toast.error(`Failed to create new option: ${err.message}`);
      return null;
    } finally {
      setIsLoading(false);
    }
  };

  // Custom styles
  const customStyles = {
    control: (base, state) => ({
      ...base,
      cursor: locked ? "not-allowed" : "pointer",
      minHeight: "38px",
      // Header fields fill their grid cell; line-table cells keep a minimum.
      minWidth: String(name || "").startsWith("master-") ? 0 : "200px",
      fontSize: "0.875rem",
      borderRadius: "8px",
      borderColor: error ? "#ef4444" : state.isFocused && !locked ? "#800000" : "#d6d7dd",
      backgroundColor: locked ? "#f7f7f8" : "white",
      "&:hover": {
        borderColor: locked ? "#d6d7dd" : error ? "#ef4444" : state.isFocused ? "#800000" : "#a3a4ad",
      },
      boxShadow: state.isFocused && !locked ? "0 0 0 3px rgba(128,0,0,0.14)" : "none",
      opacity: locked ? 0.7 : 1,
    }),
    menu: (base) => ({
      ...base,
      zIndex: 100000000000000000000000000000,
      cursor: "pointer",
      borderRadius: "8px",
      boxShadow: "0 8px 24px rgba(20, 20, 30, 0.12)",
      border: "1px solid #e4e4e8",
    }),
    option: (base, { isFocused, isSelected }) => ({
      ...base,
      backgroundColor: isSelected ? "#ececef" : isFocused ? "#f4f4f6" : "white",
      color: "#1b1c20",
      fontWeight: isSelected ? 600 : 400,
      cursor: "pointer",
      padding: "8px 12px",
      zIndex: 1000,
      "&:active": {
        backgroundColor: "#e4e4e8",
      }
    }),
    placeholder: (base) => ({
      ...base,
      color: "#9ca3af",
    }),
    menuPortal: (base) => ({
      ...base,
      zIndex: 100000000,
      cursor: "pointer",
      minWidth: "250px",
      maxHeight: isSmallList ? "200px" : "300px",
    }),
    menuList: (base) => ({
      ...base,
      zIndex: 1000000000000,
      cursor: "pointer",
      maxHeight: isSmallList ? "200px" : "300px",
      overflowY: "auto",
      scrollbarWidth: "thin",
      scrollbarColor: "#cbd5e1 transparent",
      "&::-webkit-scrollbar": {
        width: "6px",
      },
      "&::-webkit-scrollbar-thumb": {
        backgroundColor: "#cbd5e1",
        borderRadius: "3px",
        border: "3px solid transparent",
        backgroundClip: "content-box",
        cursor: "pointer",
      },
      "&::-webkit-scrollbar-thumb:hover": {
        backgroundColor: "#94a3b8",
        cursor: "pointer",
      },
      "&::-webkit-scrollbar-track": {
        backgroundColor: "transparent",
        cursor: "pointer",
      },
    }),
  };

  return (
    <div className="space-y-1 z-10">
      {label && (
        <label className="mb-1 block text-[12.5px] font-semibold text-foreground/80">
          {label} {required && <span className="text-red-500">*</span>}
          {locked && (
            <span className="ml-2 text-xs text-orange-600 bg-orange-100 px-2 py-1 rounded">
              🔒 Locked
            </span>
          )}
          {selectedOption?.isOffAccount && (
            <span className="ml-2 text-xs text-red-600 bg-red-100 px-2 py-1 rounded">
              ⚠ Off Account
            </span>
          )}
        </label>
      )}
      <div data-focus={name}>
        <AsyncCreatableSelect
          key={
            typeof apiEndpoint === "function"
              ? apiEndpoint(masterData, lineData)
              : undefined
          }
          value={selectedOption}
          data-focus={name}
          onChange={(newValue) => {
            if (locked) return; // ✅ Prevent changes if locked
            setSelectedOption(newValue);
            onValueChange(newValue);
          }}
          onInputChange={(input) => {
            if (locked) return input; // ✅ Only allow input changes if not locked
            // field.upperCase: what is typed shows (and is created) in CAPS
            const v = fieldConfig?.upperCase ? input.toUpperCase() : input;
            setInputValue(v);
            return v;
          }}
          loadOptions={loadOptions}
          defaultOptions
          onCreateOption={locked ? undefined : handleCreate} // ✅ Disable creation if locked
          isClearable={!locked} // ✅ Disable clear if locked
          isSearchable={!locked} // ✅ Disable search if locked
          isDisabled={locked} // ✅ Disable entire component if locked
          cacheOptions={typeof apiEndpoint === "function" ? false : true}
          placeholder={locked ? "Locked" : (fieldConfig?.getPlaceholder ? fieldConfig.getPlaceholder(masterData) : placeholder)} formatCreateLabel={
            locked ? () => "Locked" : (input) => `Add new "${input}"`
          }
          isLoading={isLoading}
          styles={customStyles}
          classNamePrefix="react-select"
          menuPortalTarget={typeof window !== "undefined" ? document.body : null}
          onKeyDown={onKeyDown}
        />
      </div>
      {error && !locked && <p className="text-xs text-red-500 mt-1">{error}</p>}
    </div>
  );
};

// Non-blocking notices the server attaches to a successful save — e.g. short
// stock while Settings → Stock checking is on Warn for that document
// (lib/stock/checkStock.js, packing: lib/dispatch/packingConsumption.js).
function showServerWarnings(data) {
  for (const w of data?.warnings ?? []) toast.warning(w, { duration: 12000 });
  // Sale Order lines planned on save (Features: saleOrder.planFromOrder)
  if (data?.plan?.message) {
    (data.plan.ok ? toast.success : toast.error)(`Production plan: ${data.plan.message}`, { duration: 9000 });
  }
  // Sale Order sent for approval — say why (Bad Debt customer, No Godown, …)
  if (data?.approvalReasons?.length) {
    toast.warning(
      `Sent for approval: ${data.approvalReasons.join(", ")}. It cannot be dispatched until approved.`,
      { duration: 12000 },
    );
  }
}

// Main VoucherForm Component
// Fulfilment check panel per voucher type (Settings → Features "dispatch.fulfilmentPanel")
const FULFILMENT_PANEL = {
  dispatch: { mode: "dispatch" },
  dispatchEdit: { mode: "dispatch" },
  transfer: { mode: "transfer", progressType: "requisition" },
  transferEdit: { mode: "transfer", progressType: "requisition" },
  fgTransfer: { mode: "transfer", progressType: "requisitionFGTransfer" },
};

export default function VoucherForm({
  type,
  onClose,
  mode,
  editMode = false,
  existingData = null,
  onSuccess,
  originalData,
  isClone = false,
}) {

  const { data: session } = useSession();

  const { currency } = useCurrency();
  const { company } = useCompany();

  const ICON_MAP = getIconMap(currency?.symbol || "-");

  // Settings → Features: flows this company has switched on / off (lib/features/catalog.js)
  const features = useFeatures();
  // Line / master fields marked `feature: "<key>"` (e.g. Sub Account, Manual DC No) exist only
  // while that feature is on — unless the saved document already uses them (`featureKeep`);
  // `requiredBy` makes a field required while a feature has a value (lib/features/apply.js).
  const voucherConfig = useMemo(() => {
    const cfg = VOUCHER_CONFIG[type] || {};
    if (![cfg.lineFields, cfg.deductionFields, cfg.masterFields].some(hasFeatureFields)) return cfg;
    const saved = editMode ? existingData : null;
    return {
      ...cfg,
      masterFields: lineFieldsFor(cfg.masterFields, features.values, saved),
      lineFields: lineFieldsFor(cfg.lineFields, features.values, saved),
      deductionFields: lineFieldsFor(cfg.deductionFields, features.values, saved),
    };
    // existingData is read once per document (voucherId), not per new object reference
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [type, features.values, editMode, existingData?.voucherId, existingData?.master?.order_no]);
  const validationTimersRef = useRef({});
  const [transferConfirmOpen, setTransferConfirmOpen] = useState(false);
  const [masterData, setMasterData] = useState({});
  const [mainLines, setMainLines] = useState([{}]);
  const [deductionLines, setDeductionLines] = useState([{}]);
  const [selectedRows, setSelectedRows] = useState([]);
  const [totals, setTotals] = useState({});
  const [stockLevels, setStockLevels] = useState({});
  // Fulfilment check (Settings → Features "dispatch.fulfilmentPanel"): parent
  // document balance and stock per item on dispatch / transfer lines. A saved
  // voucher being edited backs out its own qty.
  const fulfilment = useFulfilmentCheck({
    config: features.on("dispatch.fulfilmentPanel") && FULFILMENT_PANEL[type]
      ? { ...FULFILMENT_PANEL[type], tolerance: Number(features.value("dispatch.overDispatchTolerance")) / 100 }
      : null,
    masterData,
    lines: mainLines,
    isEdit: mode === "edit" || !!editMode,
  });
  const fulfilmentStrip = (isMain, line, idx, colSpan) => {
    if (!isMain || !fulfilment.enabled) return null;
    const itcd = line?.itcd?.value ?? line?.itcd;
    if (!fulfilment.byItem?.get(Number(itcd))) return null;
    return (
      <tr key={`fulfil-${idx}`} className="border-b border-border/60 bg-muted/30">
        <td colSpan={colSpan} className="px-2 pb-2 pt-0.5">
          <FulfilmentLineStrip check={fulfilment} itcd={itcd} />
        </td>
      </tr>
    );
  };
  const [optionsData, setOptionsData] = useState({});
  const [errors, setErrors] = useState({ validation: {} });
  const [varianceModalData, setVarianceModalData] = useState(null);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalType, setModalType] = useState(null);
  const [modalField, setModalField] = useState({});
  const [lastEditedFields, setLastEditedFields] = useState({});
  const [currentFocus, setCurrentFocus] = useState({
    section: "master",
    index: 0,
    field: 0,
  });

  // Draft slot for a child doc opened from a source row — keyed by the source
  // document (SO no for dispatch, PO no for GRN, requisition for transfers).
  const sourceDraftScope =
    mode === "create"
      ? existingData?.master?.so_no ??
        existingData?.master?.po_no ??
        existingData?.master?.req_no ??
        null
      : null;

  // Source-mapped seed (master + lines) so "Discard Draft" can fall back to it
  // instead of an empty form.
  const sourceSeedRef = useRef(null);

  // ✅ INITIALIZE FORM COOKIES HOOK
  const { loadFromStorage, clearFromStorage, finalizeDraft, markInitialized } = useFormCookies(
    type,
    masterData,
    mainLines,
    deductionLines,
    mode,
    existingData?.voucherId,
    editMode,        // prevents saving in edit mode
    !!originalData,  // prevents saving in return/copy mode
    sourceDraftScope
  );

  // ✅ NEXT ORDER NUMBER PREVIEW
  // Fetches last_no+1 from the DB sequence for display only.
  // Runs on new-form mode when previewNumber is configured in VOUCHER_CONFIG.
  // The DB trigger assigns the real order_no on INSERT — this is read-only display.
  useEffect(() => {
    const previewCfg = voucherConfig?.previewNumber;
    if (!previewCfg || editMode || mode !== "create") return;

    const fetchPreview = async () => {
      try {
        const params = new URLSearchParams({ category: previewCfg.category });
        if (previewCfg.regionParam) {
          const regionVal = masterData[previewCfg.regionParam];
          if (!regionVal) return; // wait until region is selected
          params.set("region", typeof regionVal === "object" ? regionVal.value : regionVal);
        }
        const res = await axios.get(`${previewCfg.api}?${params.toString()}`);
        if (res.data?.nextOrderNo != null) {
          setMasterData((prev) => ({
            ...prev,
            [previewCfg.fieldName]: res.data.nextOrderNo,
          }));
        }
      } catch {
        // non-critical: preview fetch failure doesn't block form use
      }
    };

    fetchPreview();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    voucherConfig?.previewNumber?.dependsOn
      ? masterData[voucherConfig?.previewNumber?.dependsOn]
      : null,
    editMode,
    mode,
  ]);

  // NEXT GRN NO / DISPATCH NO PREVIEW — `nextNumber` in VOUCHER_CONFIG.
  // Read-only display: the DB trigger assigns the real number on INSERT and
  // ignores what the form sends. Keyed on `mode` alone (not editMode): Create
  // Dispatch opens from the Sale Orders list as editMode + mode "create".
  // The number is kept in its own state and re-applied whenever the field is
  // empty: Create Dispatch loads the Sale Order asynchronously and replaces
  // masterData wholesale when it arrives, which used to wipe the preview.
  const [nextDocNo, setNextDocNo] = useState(null);
  useEffect(() => {
    const cfg = voucherConfig?.nextNumber;
    setNextDocNo(null);
    if (!cfg || mode !== "create") return;
    let cancelled = false;
    axios
      .get(`/api/voucher/next-number?type=${cfg.type}`)
      .then((res) => {
        if (!cancelled && res.data?.nextNo != null) setNextDocNo(res.data.nextNo);
      })
      .catch(() => {
        // non-critical: a failed preview never blocks the form
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, type]);

  const nextNumberField = voucherConfig?.nextNumber?.fieldName;
  useEffect(() => {
    if (!nextNumberField || mode !== "create" || nextDocNo == null) return;
    const current = masterData[nextNumberField];
    if (current === undefined || current === null || current === "") {
      setMasterData((prev) => ({ ...prev, [nextNumberField]: nextDocNo }));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nextDocNo, nextNumberField, mode, masterData[nextNumberField]]);

  // ✅ REACT QUERY KE LIYE MUTATION BANAO
  // One id per document being created. Every retry of the same save (double
  // click, Save pressed again after a dropped connection) sends the same id,
  // and the server answers it with the FIRST save instead of a second
  // document — lib/voucher/saveGuard.js. A fresh id after each success.
  const requestIdRef = useRef(null);
  const newRequestId = () =>
    (typeof crypto !== "undefined" && crypto.randomUUID
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`);
  const requestIdFor = (formData) => {
    if (mode !== "create") return formData;
    if (!requestIdRef.current) requestIdRef.current = newRequestId();
    // Approval rules (Permissions → Approvals) may hold this document. The
    // form's own state goes along so "Edit" in Approvals → My requests can
    // re-open it exactly; approvalRequest in the URL = re-saving such a request.
    const approvalRequestId =
      typeof window !== "undefined" ? new URLSearchParams(window.location.search).get("approvalRequest") : null;
    return {
      ...formData,
      clientRequestId: requestIdRef.current,
      __ui: { masterData, mainLines, deductionLines },
      ...(approvalRequestId ? { approvalRequestId: Number(approvalRequestId) } : {}),
    };
  };

  // The server held the document for approval instead of posting it.
  const heldForApproval = (data) => {
    toast.success(data?.message || "Sent for approval — nothing is posted until it is approved.", { duration: 9000 });
    requestIdRef.current = null;
    finalizeDraft();
    setHasDraft(false);
    if (typeof window !== "undefined" && new URLSearchParams(window.location.search).get("approvalRequest")) {
      const u = new URL(window.location.href);
      u.searchParams.delete("approvalRequest");
      window.history.replaceState(null, "", u);
    }
    if (typeof onSuccess === "function") onSuccess();
  };

  const saveMutation = useMutation({
    mutationFn: async (formData) => {
      const endpoint =
        mode !== "create" && existingData?.voucherId ? `${apiMap[type]}` : apiMap[type];
      if (!endpoint) throw new Error(`Unknown voucher type: ${type}`);


      const method = mode !== "create" ? "put" : "post";
      const response = await axios[method](endpoint, requestIdFor(formData));
      showServerWarnings(response.data);
      return response.data;
    },
    // onSuccess: (data) => {
    //   // ✅ CLEAR STORAGE ON SUCCESSFUL SAVE
    //   clearFromStorage();
    //   setSaveResult({
    //     vrNo: data.vrNo || masterData.vr_no || null,
    //     grnNo: data.grnNo || masterData.grn_no || null,
    //     dispatchNo: data.dispatchNo || masterData.dispatch_no || null,
    //     tranId: data.voucherId || null,
    //     order_no: data.order_no || masterData.order_no || null,
    //     isUpdate: mode !== "create",
    //     typeName: VOUCHER_CONFIG[type]?.label || type,
    //   });
    //   if (typeof onSuccess === "function") onSuccess();
    // },
    onSuccess: async (data) => {
  if (data?.pendingApproval) {
    heldForApproval(data);
    return;
  }

  // Attachments upload when picked (AttachmentDropzone) and are saved with
  // the voucher as URLs — master.attachments and each line's attachments.

  // The next document gets its own request id.
  requestIdRef.current = null;

  // ✅ CLEAR STORAGE ON SUCCESSFUL SAVE — and stop persisting this slot
  finalizeDraft();
  setHasDraft(false);

  setSaveResult({
    vrNo: data.vrNo || masterData.vr_no || null,
    grnNo: data.grnNo || masterData.grn_no || null,
    dispatchNo: data.dispatchNo || masterData.dispatch_no || null,
    tranId: data.voucherId || null,
    order_no: data.order_no || masterData.order_no || null,
    dated: masterData.dated || null,
    party_code: masterData.party_code || null,
    isUpdate: mode !== "create",
    typeName: VOUCHER_CONFIG[type]?.label || type,
  });

  if (typeof onSuccess === "function") onSuccess();
},
    onError: (error) => {
      const serverErr = error.response?.data?.error || error.response?.data?.message;
      toast.error(
        serverErr ||
        error.message ||
        `Failed to ${mode !== "create" ? "update" : "save"}`
      );
    },
  });

  // Save success dialog state
  const [saveResult, setSaveResult] = useState(null);

  // ✅ LOADING STATE UPDATE KARO
  const [loading, setLoading] = useState({ submit: false, vrNo: false });
  const [hasDraft, setHasDraft] = useState(false);
  const loadingState = {
    submit: saveMutation.isPending || loading.submit,
    vrNo: loading.vrNo,
  };

  useEffect(() => {

  }, [modalOpen]);

  // Unlock save button when mutation completes
  useEffect(() => {
    if (!saveMutation.isPending) {
      isSavingRef.current = false;
      setLoading((prev) => ({ ...prev, submit: false }));
    }
  }, [saveMutation.isPending]);

  // Print preview states
  const [printPreviewOpen, setPrintPreviewOpen] = useState(false);
  const [printData, setPrintData] = useState(null);

  const formRef = useRef(null);
  const focusableElementsRef = useRef([]);
  const isSavingRef = useRef(false); // Lock to prevent multiple saves
  // ✅ Prevents initFormData from re-running when only the `existingData` object
  // reference changes (e.g. Modal passes a new {} on every parent re-render).
  // Only re-inits when the MEANINGFUL context changes: type, editMode, or voucherId.
  const initContextRef = useRef(null);
  // ✅ Tracks which mainLines indices have already been checked for a source-mapped
  // packing material, so items with no default packing material (packing_material_code
  // stays falsy forever) aren't re-fetched on every mainLines change — that caused an
  // infinite render loop (React error #185).
  const processedPackingIndicesRef = useRef(new Set());

  const apiMap = {
    payment: "/api/voucher/payment",
    receipt: "/api/voucher/receipt",
    journal: "/api/voucher/journal",
    purchase: "/api/voucher/purchase",
    sale: "/api/voucher/sale",
    purchaseReturn: "/api/voucher/purchaseReturn",
    grnReturn: "/api/voucher/purchaseReturn",
    saleReturn: "/api/voucher/saleReturn",
    dispatchReturn: "/api/voucher/saleReturn",
    transfer: "/api/voucher/transfer",
    fgTransfer: "/api/voucher/transfer",
    purchaseOrder: "/api/orders/purchaseOrder",
    purchaseOrderEdit: "/api/orders/purchaseOrder",
    saleOrder: "/api/orders/saleOrder",
    grn: "/api/voucher/grn",
    grnEdit: "/api/voucher/grn",
    exbond: "/api/voucher/grn",
    exbondEdit: "/api/voucher/grn",
    fixedAssetsGrn: "/api/voucher/fixedAssetsGrn",
    fixedAssetRelocation: "/api/voucher/fixedAssetRelocation",
    fixedAssetDisposal: "/api/voucher/fixedAssetDisposal",
    dispatch: "/api/voucher/dispatch",
    dispatchEdit: "/api/voucher/dispatch",
    materialIssue: "/api/voucher/materialIssue",
    materialIssueLanded: "/api/voucher/materialIssueLanded",
    materialInput: "/api/voucher/materialInput",
    requisition: "/api/material/requisition",
    requisitionTransfer: "/api/material/requisition",
    requisitionFGTransfer: "/api/material/requisition",
    serviceOrder: "/api/orders/serviceOrder",
    serviceEntry: "/api/voucher/serviceEntry",
    serviceInvoice: "/api/voucher/serviceInvoice",
    letterOfCredit: "/api/lc",
    dispatchTransfer: "/api/material/requisition",
    productionPlan: "/api/material/requisition",
    inBond: "/api/inbond",
    credit: "/api/voucher/credit",
    debit: "/api/voucher/debit",
  };
  const [documentStatus, setDocumentStatus] = useState(null);

  // ✅ ADD THIS: Process source-mapped lines automatically
  useEffect(() => {
    const processSourceMappedLines = async () => {
      // Only process lines with itcd, no packing_material_code, and not already attempted
      const indicesToProcess = mainLines
        .map((line, i) => i)
        .filter((i) => {
          const line = mainLines[i];
          return (
            line.itcd &&
            !line.packing_material_code &&
            !processedPackingIndicesRef.current.has(i)
          );
        });

      if (indicesToProcess.length > 0) {

        const processedLines = [...mainLines];
        let hasChanges = false;

        for (const i of indicesToProcess) {
          const line = processedLines[i];
          const processedLine = await processLineAfterSourceMapping(line, i);
          // Mark as attempted regardless of outcome so items with no default
          // packing material don't get re-fetched on every future mainLines change.
          processedPackingIndicesRef.current.add(i);

          if (processedLine.packing_material_code) {
            processedLines[i] = processedLine;
            hasChanges = true;

          }
        }

        if (hasChanges) {

          setMainLines(processedLines);
        }
      }
    };

    processSourceMappedLines();
  }, [mainLines]);

  // Fetch document status for locking logic
  useEffect(() => {
    const fetchDocumentStatus = async () => {
      if (editMode && existingData && voucherConfig.getDocumentStatus) {
        try {
          const status = await voucherConfig.getDocumentStatus(existingData);
          setDocumentStatus(status);
        } catch (error) {
          console.error("Error fetching document status:", error);
        }
      }
    };

    fetchDocumentStatus();
  }, [editMode, existingData, voucherConfig]);

  // Returns true when a detail row has no meaningful user-entered data
  const isLineEmpty = (line) => {
    if (!line) return true;
    return !Object.values(line).some((v) => {
      if (v === null || v === undefined || v === "" || v === false || v === 0) return false;
      if (typeof v === "object" && v !== null) {
        const val = v?.value;
        return val !== null && val !== undefined && val !== "" && Number(val) !== 0;
      }
      return true;
    });
  };

  // Add new line with keyboard shortcut
  const handleAddLineShortcut = (e, isMain) => {
    addLine(isMain);
    // Focus the first typeable cell of the new (still empty) row
    const lines = isMain ? mainLines : deductionLines;
    const section = isMain ? "main" : "deduction";
    setCurrentFocus({
      section,
      index: lines.length,
      field: Math.max(0, firstFocusable(section, lines.length)),
      tick: Date.now(),
    });
  };

  // ── Keyboard navigation ──────────────────────────────────────────────────
  // One predicate decides whether a field can take focus on a given row. It
  // mirrors what renderInputField / renderMasterFields actually render, so
  // Enter/Tab never land on something the user can't type into: a hidden
  // field, a readOnly one (including per-row predicates such as Qty (LTR) on a
  // KG line), a calculated one, or a UI-locked one.
  // The master as a readOnly predicate sees it. (Dispatches are quantity
  // only — rates are set on the Invoicing screens.)
  const predicateMaster = () => ({ ...masterData });

  const dataForRow = (section, lineIndex) => {
    if (section === "master") return masterData;
    const lines = section === "main" ? mainLines : deductionLines;
    return lines[lineIndex] || {};
  };

  const fieldsFor = (section) =>
    section === "master"
      ? voucherConfig.masterFields || []
      : section === "main"
        ? voucherConfig.lineFields || []
        : voucherConfig.deductionFields || [];

  // `pending`: values being picked right now (Enter on an open select) that are
  // not in state yet — so a field `disabled` until that pick is not skipped.
  // Only the `disabled` check sees it; readOnly / visibility are unchanged.
  const isFieldFocusable = (field, section, lineIndex, pending = null) => {
    if (!field || field.name === "tran_code") return false;
    if (field.type === "file" || field.type === "file-upload") return false;

    const row = dataForRow(section, lineIndex);
    const formData = section === "master" ? masterData : { ...masterData, ...row };
    if (!shouldShowField(field, formData, section === "master" ? "master" : "line")) return false;

    const readOnly =
      typeof field.readOnly === "function"
        ? field.readOnly({ ...row }, predicateMaster())
        : field.readOnly;
    if (readOnly === true) return false;

    // Derived field (amount, st_amount, …) — rendered disabled unless manual entry is allowed
    if (field.calculate && field.dependencies && !field.allowManualEntry) return false;

    if (section !== "master") {
      const disabled =
        typeof field.disabled === "function"
          ? field.disabled(pending ? { ...formData, ...pending } : formData, editMode)
          : field.disabled;
      if (disabled === true) return false;
      if (shouldLockField(field, formData, editMode, documentStatus)) return false;
    }

    return true;
  };

  const firstFocusable = (section, lineIndex, from = 0, pending = null) => {
    const fields = fieldsFor(section);
    for (let i = from; i < fields.length; i++) {
      if (isFieldFocusable(fields[i], section, lineIndex, pending)) return i;
    }
    return -1;
  };

  const lastFocusable = (section, lineIndex, from = null) => {
    const fields = fieldsFor(section);
    for (let i = from ?? fields.length - 1; i >= 0; i--) {
      if (isFieldFocusable(fields[i], section, lineIndex)) return i;
    }
    return -1;
  };

  // The header shows its fields in groups (formLayout.js), so Enter / Tab walk
  // them in that on-screen order, not config order. Returns a masterFields
  // index, or -1. `pos` is a position in masterOrder; `dir` +1 / -1.
  const masterOrder = useMemo(
    () => masterVisualOrder(voucherConfig.masterFields || [], voucherConfig.masterGroups),
    [voucherConfig.masterFields],
  );
  const masterFrom = (pos, dir) => {
    const fields = voucherConfig.masterFields || [];
    for (let p = pos; p >= 0 && p < masterOrder.length; p += dir) {
      if (isFieldFocusable(fields[masterOrder[p]], "master", 0)) return masterOrder[p];
    }
    return -1;
  };

  // `tick` forces the auto-focus effect to re-run even when the target is the
  // same cell as last time (e.g. a react-select refocused itself after a pick).
  const focusField = (section, index, field) =>
    setCurrentFocus({ section, index, field, tick: Date.now() });

  const handleKeyNavigation = (
    e,
    section,
    lineIndex,
    fieldIndex,
    totalFields,
    isLastInSection = false,
    fields,
    isMain
  ) => {

    // -------------------------------
    // BACKSPACE → DELETE LINE
    // -------------------------------
    if (
      e.key === "Backspace" &&
      (fieldIndex === 0 || fieldIndex === 1) &&
      !e.target.value &&
      (
        (section === "main" && mainLines.length > 1 && lineIndex === mainLines.length - 1) ||
        (section === "deduction" && deductionLines.length > 1 && lineIndex === deductionLines.length - 1)
      )
    ) {
      e.preventDefault();

      if (section === "main") {
        const target = mainLines.length - 2;
        setMainLines((prev) => prev.slice(0, -1));
        focusField("main", target, Math.max(0, lastFocusable("main", target)));
      }

      if (section === "deduction") {
        const target = deductionLines.length - 2;
        setDeductionLines((prev) => prev.slice(0, -1));
        focusField("deduction", target, Math.max(0, lastFocusable("deduction", target)));
      }

      return;
    }

    // -------------------------------
    // CTRL + ENTER → Add new line in current section
    // -------------------------------
    if (
      e.key === "Enter" &&
      (e.ctrlKey || e.metaKey) &&
      (section === "main" || section === "deduction")
    ) {
      e.preventDefault();
      handleAddLineShortcut(e, section === "main");
      return;
    }

    // -------------------------------
    // ENTER / TAB → Forward Navigation
    // -------------------------------
    if (e.key === "Enter" || (e.key === "Tab" && !e.shiftKey)) {
      if (e.key === "Tab") e.preventDefault();

      // Enter on a select whose menu is open picks an option, but that value
      // is not in state yet. Count it as filled, so a next field that is
      // disabled until it is set (e.g. Item after Sale Order No) is not skipped.
      const curField = fieldsFor(section)?.[fieldIndex];
      const picking =
        e.key === "Enter" &&
        section !== "master" &&
        curField?.name &&
        e.target?.getAttribute?.("aria-expanded") === "true";
      const pending = picking ? { [curField.name]: "__picking__" } : null;

      // Next focusable cell on the same row
      const next =
        section === "master"
          ? masterFrom(masterOrder.indexOf(fieldIndex) + 1, 1)
          : firstFocusable(section, lineIndex, fieldIndex + 1, pending);
      if (next !== -1) {
        focusField(section, lineIndex, next);
        return;
      }

      // -------------------------------
      // MASTER → first line
      // -------------------------------
      if (section === "master") {
        focusField("main", 0, Math.max(0, firstFocusable("main", 0)));
        return;
      }

      // -------------------------------
      // MAIN → next row / deductions / new row
      // -------------------------------
      if (section === "main") {
        if (lineIndex < mainLines.length - 1) {
          focusField("main", lineIndex + 1, Math.max(0, firstFocusable("main", lineIndex + 1)));
          return;
        }
        if (voucherConfig?.hasDeductionBlock) {
          focusField("deduction", 0, Math.max(0, firstFocusable("deduction", 0)));
          return;
        }
        handleAddLineShortcut(e, true);
        return;
      }

      // -------------------------------
      // DEDUCTION → next row / new row
      // -------------------------------
      if (section === "deduction") {
        if (lineIndex < deductionLines.length - 1) {
          focusField("deduction", lineIndex + 1, Math.max(0, firstFocusable("deduction", lineIndex + 1)));
          return;
        }
        handleAddLineShortcut(e, false);
        return;
      }

      return;
    }

    // -------------------------------
    // SHIFT + TAB → Backward Navigation
    // -------------------------------
    if (e.key === "Tab" && e.shiftKey) {
      e.preventDefault();

      // Previous focusable cell on the same row
      const prev =
        section === "master"
          ? masterFrom(masterOrder.indexOf(fieldIndex) - 1, -1)
          : fieldIndex > 0 ? lastFocusable(section, lineIndex, fieldIndex - 1) : -1;
      if (prev !== -1) {
        focusField(section, lineIndex, prev);
        return;
      }

      if (section === "deduction") {
        if (lineIndex > 0) {
          focusField("deduction", lineIndex - 1, Math.max(0, lastFocusable("deduction", lineIndex - 1)));
        } else {
          const last = mainLines.length - 1;
          focusField("main", last, Math.max(0, lastFocusable("main", last)));
        }
        return;
      }

      if (section === "main") {
        if (lineIndex > 0) {
          focusField("main", lineIndex - 1, Math.max(0, lastFocusable("main", lineIndex - 1)));
        } else {
          focusField("master", 0, Math.max(0, masterFrom(masterOrder.length - 1, -1)));
        }
        return;
      }
    }

    // CTRL+S and CTRL+P used to be handled here as well as in the global
    // listener, so each one fired twice. They are now owned by the form-wide
    // shortcut map below — see "Keyboard shortcuts".
  };

  // The form-wide shortcuts live further down, after every handler they call
  // has been defined — search for "Keyboard shortcuts".

  // Auto-focus on current focused element
  useEffect(() => {
    const focusElement = () => {
      const { section, index, field } = currentFocus;


      let selector = "";

      if (section === "master") {
        const fieldConfig = voucherConfig.masterFields?.[field];
        if (fieldConfig) {
          const fieldName = fieldConfig.formName || fieldConfig.name;
          selector = `[name="${section}-${fieldName}"], [data-focus="${section}-${fieldName}"]`;

        }
      } else {

        const fieldConfig =
          section === "main"
            ? voucherConfig.lineFields?.[field]
            : voucherConfig.deductionFields?.[field];





        if (fieldConfig) {
          const fieldName = fieldConfig.formName || fieldConfig.name;
          //selector = `[name="${section}-${index}-${fieldName}"]`;
          selector = `[name="${section}-${index}-${fieldName}"], [data-focus="${section}-${index}-${fieldName}"]`;

        }
      }

      if (selector) {


        let element = document.querySelector(selector);
        // react-select's `name` prop renders only a hidden <input>, which can't
        // take focus — climb to its container and focus the real input.
        if (element?.tagName === "INPUT" && element.type === "hidden") {
          element = element.closest("[data-focus]") || element.parentElement;
        }
        if (element) {
          const target =
            element.tagName === "INPUT" || element.tagName === "TEXTAREA"
              ? element
              : element.querySelector('input:not([type="hidden"])') || element;
          // Still disabled — e.g. Item waits for the Sale Order just picked,
          // whose value lands after its async onChange. Caller retries.
          if (target.disabled) return "disabled";
          target.focus?.();
        }
      }
      return "done";
    };

    // Retry briefly only while the target is still disabled, then give up.
    let attempts = 0;
    let timer = null;
    const tryFocus = () => {
      if (focusElement() === "disabled" && attempts++ < 10) timer = setTimeout(tryFocus, 50);
    };
    tryFocus();
    return () => clearTimeout(timer);
  }, [currentFocus]);



  // ✅ ADD THIS FUNCTION: Process lines after source mapping
  const processLineAfterSourceMapping = async (line, index) => {


    const fieldConfigs = voucherConfig.lineFields || [];
    let updatedLine = { ...line };

    // Process itcd field specifically for packing material
    const itcdFieldConfig = fieldConfigs.find((f) => f.name === "itcd");
    if (itcdFieldConfig?.onChange && updatedLine.itcd) {
      try {


        const updates = await itcdFieldConfig.onChange(
          updatedLine.itcd,
          updatedLine,
          [updatedLine],
          masterData
        );

        if (updates) {

          updatedLine = { ...updatedLine, ...updates };
        }
      } catch (error) {
        console.error(`Error in itcd onChange:`, error);
      }
    }

    return updatedLine;
  };

  useEffect(() => {
    return () =>
      Object.values(validationTimersRef.current).forEach(clearTimeout);
  }, []);

  // Line info shown under a line select (field.lineInfo — e.g. Sale Order:
  // live stock in godown 3 / 9 under the Product). Loaded once per item when
  // it appears on a line (new pick, edit load, restored draft) and kept out of
  // the lines, so it is never saved. Vouchers without lineInfo skip this.
  const lineInfoField = (voucherConfig?.lineFields || []).find((f) => f.lineInfo);
  const [lineInfoMap, setLineInfoMap] = useState({});
  const lineInfoAskedRef = useRef(new Set());
  useEffect(() => {
    const cfg = lineInfoField?.lineInfo;
    if (!cfg) return;
    const keys = [...new Set(mainLines.map((l) => cfg.key(l)).filter(Boolean))]
      .filter((k) => !lineInfoAskedRef.current.has(k));
    if (!keys.length) return;
    keys.forEach((k) => lineInfoAskedRef.current.add(k));
    cfg
      .load(keys)
      .then((res) => setLineInfoMap((prev) => ({ ...prev, ...res })))
      .catch(() => keys.forEach((k) => lineInfoAskedRef.current.delete(k)));
  }, [mainLines, lineInfoField]);

  // Remove WHT-related useEffect - WHT functionality removed

  // const fetchOrderItemDetails = async (itemCode, isMain, index, lines) => {
  //   try {
  //     const orderNo =
  //       type === "purchase" || type === "grn"
  //         ? masterData.po_no
  //         : masterData.so_no;
  //     const orderType =
  //       type === "purchase" || type === "grn" ? "purchase" : "sale";
  //     const response = await axios.get(
  //       `/api/orders/getQty?orderNo=${orderNo}&item=${itemCode}&type=${orderType}`
  //     );
  //     const orderItemData = response.data;
  //     if (orderItemData.success && orderItemData.item) {
  //       const item = orderItemData.item;
  //       lines[index] = {
  //         ...lines[index],
  //         itcd: itemCode,
  //         rate: item.rate || 0,
  //         po_qty: item.available_qty || item.original_qty,
  //       };
  //       if (isMain) setMainLines([...lines]);
  //       else setDeductionLines([...lines]);
  //       if (item.available_qty <= 0) {
  //         setErrors((prev) => ({
  //           ...prev,
  //           validation: {
  //             ...prev.validation,
  //             [`${
  //               isMain ? "main" : "deduction"
  //             }-${index}-itcd`]: `No remaining quantity available for this item in ${orderType} order`,
  //           },
  //         }));
  //       }
  //     }
  //   } catch (error) {
  //     setErrors((prev) => ({
  //       ...prev,
  //       validation: {
  //         ...prev.validation,
  //         [`${isMain ? "main" : "deduction"}-${index}-itcd`]:
  //           "Error loading order details",
  //       },
  //     }));
  //   }
  // };

  const fetchStockLevels = useCallback(async (productIds, masterData) => {
    if (masterData.godown == null && masterData.issued_by == null) {
      toast.error("Please select Godown or Issued For to check stock levels.");
      return;
    }

    if (masterData.req_catagory?.value === "PURCHASE") {
      return; // Skip stock check for PURCHASE category
    }
    try {

      const response = await axios.post("/api/voucher/check-stock", {
        productIds,
        godown:
          Number(masterData.godown?.value) ||
          Number(masterData.issued_by?.value),
      });
      setStockLevels((prev) => ({ ...prev, ...response.data }));
    } catch (error) {
      toast.error(`Failed to fetch stock levels: ${error.message}`);
    }
  }, []);

  // ── Godown default vs the user's data scope ───────────────────────────────
  // Configs pre-fill a godown (usually FACTORY). For a user / department
  // limited to other godowns (Admin → Permissions), that default would only be
  // refused on save — so on a NEW document it is swapped for the first godown
  // they may use. /api/setup/godowns already returns only those.
  const allowedGodownsRef = useRef(null);
  const godownDefaultFields = useMemo(
    () =>
      (voucherConfig.masterFields || []).filter(
        (f) =>
          f.type === "select" &&
          typeof f.apiEndpoint === "string" &&
          f.apiEndpoint.startsWith("/api/setup/godowns") &&
          f.defaultValue,
      ),
    [voucherConfig],
  );
  const [allowedGodowns, setAllowedGodowns] = useState(null);
  useEffect(() => {
    if (editMode || godownDefaultFields.length === 0 || allowedGodownsRef.current) return;
    allowedGodownsRef.current = "loading";
    axios
      .get("/api/setup/godowns")
      .then(({ data }) => setAllowedGodowns(Array.isArray(data?.data) ? data.data : []))
      .catch(() => setAllowedGodowns([]));
  }, [editMode, godownDefaultFields.length]);
  useEffect(() => {
    if (editMode || !allowedGodowns?.length) return;
    const ids = new Set(allowedGodowns.map((g) => String(g.id)));
    const first = allowedGodowns[0];
    setMasterData((prev) => {
      let next = prev;
      for (const f of godownDefaultFields) {
        const key = f.formName || f.name;
        const cur = String(prev?.[key]?.value ?? prev?.[key] ?? "");
        const def = String(f.defaultValue?.value ?? f.defaultValue ?? "");
        // Only the untouched config default is replaced, never a user's pick.
        if (cur && cur === def && !ids.has(cur)) {
          next = { ...next, [key]: { value: String(first.id), label: first.godown } };
        }
      }
      return next;
    });
  }, [allowedGodowns, editMode, godownDefaultFields, masterData?.godown, masterData?.godown2]);
  // A field with `defaultGodown: "<Production setup key>"` (e.g. the plan's
  // Required By / Required From) starts at the company's godown from Settings →
  // Production setup, not a fixed id. Only an untouched default is replaced;
  // the label comes from the godown list.
  const { setup: productionSetup, isSuccess: productionSetupReady } = useProductionSetup();
  useEffect(() => {
    if (editMode || !allowedGodowns?.length) return;
    const fields = godownDefaultFields.filter((f) => f.defaultGodown);
    if (!fields.length) return;
    const byId = new Map(allowedGodowns.map((g) => [String(g.id), g]));
    setMasterData((prev) => {
      let next = prev;
      for (const f of fields) {
        const key = f.formName || f.name;
        const cur = String(prev?.[key]?.value ?? prev?.[key] ?? "");
        const def = String(f.defaultValue?.value ?? f.defaultValue ?? "");
        if (cur && cur !== def) continue; // the user's pick (or already set from the setup)
        const want = productionSetupReady ? String(productionSetup?.[f.defaultGodown] ?? def) : def;
        const g = byId.get(want);
        if (!g) continue;
        const label = `${g.id} - ${g.godown}`;
        if (cur === want && prev?.[key]?.label === label) continue;
        next = { ...next, [key]: { value: want, label } };
      }
      return next;
    });
  }, [allowedGodowns, editMode, godownDefaultFields, productionSetup, productionSetupReady]);

  // Main initialization useEffect
  useEffect(() => {
    // Build a key from the MEANINGFUL context so we skip re-runs that happen
    // only because `existingData` got a new object reference (e.g. Modal passes
    // `existingData={}` on every parent re-render, not just when it actually changes).
    // Create-from-source (SO → Dispatch, PO → GRN): the row's data arrives async
    // from Table.handleEditClick. Don't seed anything until it's here — seeding
    // from null/stale data would start the draft slot of the wrong document.
    if (editMode && mode === "create" && !existingData?.master) return;

    const initKey = `${type}|${editMode ? "edit" : "new"}|${existingData?.voucherId ?? "none"}|${sourceDraftScope ?? ""}|${!!originalData}|${!!isClone}`;
    if (initContextRef.current === initKey) return; // same context → skip
    initContextRef.current = initKey;

    const initFormData = async () => {
      // Fresh voucher context — forget which line indices were already checked.
      processedPackingIndicesRef.current = new Set();
      const today = new Date().toISOString().split("T")[0];
      const now = new Date().toTimeString().split(" ")[0];

      const defaultMasterData =
        voucherConfig.masterFields?.reduce(
          (acc, field) => {
            const fieldKey = field.formName || field.name;
            let defaultValue = "";

            // Auto-populate username from NextAuth session
            if (field.user && session?.user) {
              defaultValue = session.user.name || session.user.email || "";
            }
            // Handle date fields
            else if (field.type === "date" && field.name === "dated") {
              defaultValue = today;
            }
            // Handle time fields
            else if (field.type === "time") {
              defaultValue = now;
            }
            // Handle select fields with default values
            else if (field.type === "select" && field.defaultValue) {
              // Apply default value from config
              defaultValue = field.defaultValue;
            }
            // Handle select fields without default
            else if (field.type === "select") {
              defaultValue = null;
            }
            // Handle number fields
            else if (field.type === "number") {
              defaultValue = field.defaultValue || 0;
            }
            // Handle checkbox fields
            else if (field.type === "checkbox") {
              defaultValue = field.defaultValue || false;
            }
            // Handle all other fields
            else {
              defaultValue = field.defaultValue || "";
            }

            return {
              ...acc,
              [fieldKey]: defaultValue,
            };
          },
          { tran_code: voucherConfig.tran_code }
        ) || {};

      if ((editMode || isClone) && existingData) {

        // "create" = child doc opened from a source row (SO → Dispatch, PO → GRN).
        // The source-mapped master only carries what the source provides, so
        // seed it with the config defaults (godown, category, ...) like a fresh form.
        const isCreateFromSource = mode === "create";
        const baseMaster = isCreateFromSource
          ? { ...defaultMasterData, ...existingData.master }
          : { ...existingData.master };

        // A source mapping may hand us a ready-made {value,label} select object
        // (dispatch godown constant); a real edit row carries the raw id + godownDetails.
        const rawGodown = existingData.master?.godown ?? (isCreateFromSource ? defaultMasterData.godown : null);
        const godownSelect =
          rawGodown && typeof rawGodown === "object" && "value" in rawGodown
            ? rawGodown
            : {
              value: String(rawGodown || ""),
              label: String(existingData.master?.godownDetails?.godown || ""),
            };

        const mappedMaster =
          type !== "purchaseOrder" &&
            type !== "purchaseOrderEdit" &&
            type !== "saleOrder" &&
            type !== "serviceOrder"
            ? {
              ...baseMaster,
              user_id: session?.user?.id || session?.user?.email || "",
              pycd: {
                value: String(existingData.master?.pycd || ""),
                label: String(existingData.master?.acno?.acname || ""),
              },
              godown: godownSelect,
              dated:
                formatDateToYYYYMMDD(existingData.master?.dated) || today,
              time: formatTimeToHHMMSS(existingData.master?.time) || now,
              // vr_no: String(existingData.master?.vr_no || ""),
              check_no: String(existingData.master?.check_no || ""),
              check_date:
                formatDateToYYYYMMDD(existingData.master?.check_date) || "",
              // GRN: the vendor's bill date (date input wants YYYY-MM-DD).
              bill_date: formatDateToYYYYMMDD(existingData.master?.bill_date) || "",
              bond_limit:
                formatDateToYYYYMMDD(existingData.master?.bond_limit) || "",
              rmk: String(existingData.master?.rmk || ""),
              invoice_no: isClone
                ? ""
                : String(existingData.master?.invoice_no || "").trim(),
              // Editing a saved document: what it was saved with, so a
              // per-vendor bill-no check does not flag the document itself.
              ...(editMode && !isClone && mode !== "create"
                ? {
                  __orig_invoice_no: existingData.master?.invoice_no ?? null,
                  __orig_pycd: existingData.master?.pycd ?? null,
                }
                : {}),
              rmk2: String(existingData.master?.rmk2 || ""),
              tran_code:
                Number(existingData.master?.tran_code) ||
                voucherConfig.tran_code,
              attachments: existingData.master?.attachments || [],
              // LC-specific date fields
              lc_date: formatDateToYYYYMMDD(existingData.master?.lc_date) || "",
              lc_exp_date: formatDateToYYYYMMDD(existingData.master?.lc_exp_date) || "",
              etd: formatDateToYYYYMMDD(existingData.master?.etd) || "",
              eta: formatDateToYYYYMMDD(existingData.master?.eta) || "",
              bl_date: formatDateToYYYYMMDD(existingData.master?.bl_date) || "",
              doc_arr_date: formatDateToYYYYMMDD(existingData.master?.doc_arr_date) || "",
              doc_rtd_due_date: formatDateToYYYYMMDD(existingData.master?.doc_rtd_due_date) || "",
              doc_rtd_date: formatDateToYYYYMMDD(existingData.master?.doc_rtd_date) || "",
              per_inv_date: formatDateToYYYYMMDD(existingData.master?.per_inv_date) || "",
              mny_ship_date: formatDateToYYYYMMDD(existingData.master?.mny_ship_date) || "",
            }
            : {
              ...baseMaster,
              dated:
                formatDateToYYYYMMDD(existingData.master?.dated) || today,
              due_date:
                formatDateToYYYYMMDD(existingData.master?.due_date) || today,
              party_code: {
                value: String(existingData.master?.party_code || ""),
                label: String(existingData.master?.acno?.acname || ""),
              },
              godown: godownSelect,
            };

        // A clone is a NEW document: it never carries the source's numbers
        // (the next GRN / dispatch no is previewed again) nor anything the
        // config lists in cloneOmit (e.g. a legacy document no).
        if (isClone) {
          for (const k of [
            "invoice_no",
            "invoice_series",
            "grn_no",
            "dispatch_no",
            "vr_no",
            "tran_id",
            ...(voucherConfig.cloneOmit || []),
          ]) {
            if (k in mappedMaster) mappedMaster[k] = k === "invoice_no" ? "" : null;
          }
          // …nor the source's files.
          mappedMaster.attachments = [];
        }

        let mappedLines =
          type !== "purchaseOrder" &&
            type !== "purchaseOrderEdit" &&
            type !== "saleOrder" &&
            type !== "serviceOrder"
            ? existingData.lines?.map((line) => ({
              ...line,
              acno: {
                value: String(line.acno || ""),
                label: String(line.acnoDetails?.acname || ""),
              },
              itcd: {
                value: String(line.itcd || ""),
                label: line.itemDetails
                  ? line.itemDetails.code
                    ? `${line.itemDetails.code} - ${line.itemDetails.item || ""}`
                    : String(line.itemDetails.item || "")
                  : String(line.itcd || ""),
              },
              ccno: {
                value: String(line.ccno || ""),
                label: String(line.costCenter?.ccname || ""),
              },
              no_of_pack: Number(line.no_of_pack) || 0,
              qty_per_pack: Number(line.qty_per_pack) || 0,
              qty: Number(line.qty) || 0,
              rate: Number(line.rate) || 0,
              gross_amount: Number(line.gross_amount) || 0,
              st_rate: Number(line.st_rate) || 0,
              st_amount: Number(line.st_amount) || 0,
              additional_tax: Number(line.additional_tax) || 0,
              camt: Number(line.camt) || 0,
            })) || [{}]
            : existingData.lines?.map((line) => ({
              ...line,
              itcd: {
                value: String(line.itcd || ""),
                label: String(line.items?.item || ""),
              },
              mm: line.itcd
            })) || [{}];

        // Service Invoice: the service picker shows its name, qty falls back
        // to 1 (as the server prices it) and the calculated columns are
        // rebuilt from qty × rate, so a saved invoice — e.g. an imported one
        // line, qty 1, rate = amount — reloads and re-saves at the same amount.
        if (type === "serviceInvoice") {
          mappedLines = mappedLines.map((line) => {
            if (!line || !line.service_id) return line;
            const amounts = serviceLineAmounts(line);
            const sid = line.service_id?.value ?? line.service_id;
            return {
              ...line,
              service_id: {
                value: String(sid),
                label: String(line.service_id?.label || line.serviceDetails?.service_name || sid),
              },
              qty: amounts.qty,
              gross_amount: amounts.gross,
              st_amount: amounts.tax,
              line_total: amounts.total,
            };
          });
        }

        if (isClone) {
          mappedLines = mappedLines.map((line) => (line ? { ...line, attachments: [] } : line));
        }

        const deductionLines = existingData.deductions?.map((line) => ({
          ...line,
          acno: {
            value: String(line.acno || ""),
            label: String(line.acnoDetails?.acname || ""),
          },
          itcd: {
            value: String(line.itcd || ""),
            label: String(line.itemDetails?.item || ""),
          },
          ccno: {
            value: String(line.ccno || ""),
            label: String(line.costCenter?.ccname || ""),
          },
          no_of_pack: Number(line.no_of_pack) || 0,
          qty_per_pack: Number(line.qty_per_pack) || 0,
          qty: Number(line.qty) || 0,
          rate: Number(line.rate) || 0,
          gross_amount: Number(line.gross_amount) || 0,
          st_rate: Number(line.st_rate) || 0,
          st_amount: Number(line.st_amount) || 0,
          additional_tax: Number(line.additional_tax) || 0,
          camt: Number(line.camt) || 0,
        })) || [{}];

        if (type === "purchaseOrder" && existingData.master?.tran_id) {
          try {
            const reqFieldConfig = voucherConfig.masterFields.find(
              (f) => f.name === "tran_id"
            );
            if (reqFieldConfig?.onChange) {
              const updates = await reqFieldConfig.onChange(
                existingData.master.tran_id,
                mappedMaster
              );
              if (updates.lines) {
                const formattedLines = updates.lines.map((line) => ({
                  ...line,
                  itcd:
                    line.itcd && typeof line.itcd === "object"
                      ? line.itcd
                      : { value: line.itcd || "", label: line.itcd || "" },
                }));
                mappedLines = formattedLines.length > 0 ? formattedLines : [{}];
              }
            }
          } catch (error) {
            console.error(
              "Error re-populating lines from requisition in edit mode:",
              error
            );
            toast.error("Failed to load requisition details for edit");
          }
        }

        const seedLines = mappedLines.length > 0 ? mappedLines : [{}];
        const seedDeductions =
          existingData.deductions?.length > 0 ? deductionLines : [{}];

        // Create-from-source: restore this source doc's draft if the user left
        // one behind (keyed per SO/PO — see useFormCookies), else seed from source.
        if (isCreateFromSource && sourceDraftScope != null) {
          sourceSeedRef.current = {
            masterData: mappedMaster,
            mainLines: seedLines,
            deductionLines: seedDeductions,
          };

          const savedFormData = loadFromStorage();
          if (savedFormData.hasRestoredData) {
            // Always use today's date even when restoring a draft
            setMasterData({ ...savedFormData.masterData, dated: today });
            setMainLines(savedFormData.mainLines);
            setDeductionLines(savedFormData.deductionLines);
            setHasDraft(true);
            toast.info(`Unsaved draft for #${sourceDraftScope} has been restored.`);
          } else {
            setMasterData(mappedMaster);
            setMainLines(seedLines);
            setDeductionLines(seedDeductions);
            setHasDraft(false);
          }
          // Auto-save starts only now — after real data is in state.
          markInitialized();
        } else {
          setMasterData(mappedMaster);
          setMainLines(seedLines);
          setDeductionLines(seedDeductions);
        }
      } else if (originalData && typeof voucherConfig.fromOriginal === "function") {
        // e.g. Sale Return from a dispatch row: master + lines built by the
        // config (constants.js saleReturnFromDispatch).
        try {
          const built = (await voucherConfig.fromOriginal(originalData)) || {};
          setMasterData({
            ...defaultMasterData,
            ...(built.master || {}),
            dated: formatDateToYYYYMMDD(new Date()),
            time: formatTimeToHHMMSS(new Date()),
          });
          setMainLines(built.lines?.length ? built.lines : [{}]);
        } catch (error) {
          console.error("Error preparing the return:", error);
          toast.error("Could not load the source document");
          setMasterData(defaultMasterData);
          setMainLines([{}]);
        }
      } else if (originalData) {
        const acnoObj = originalData.acno || {};
        const acName = acnoObj.acname || "";
        const acId = acnoObj.acno || originalData.pycd || "";

        const mappedMaster = {
          ...defaultMasterData,
          // Account / vendor / customer
          acno: {
            value: String(acId),
            label: acName,
          },
          pycd: {
            value: String(originalData.pycd || ""),
            label: acName,
          },
          godown: {
            value: String(originalData.godown || ""),
            label: String(originalData.godownDetails?.godown || originalData.godown || ""),
          },
          // Reference fields (copy from original so the return is linked)
          po_no: originalData.po_no || null,
          grn_no: originalData.grn_no || null,
          so_no: originalData.so_no || null,
          dispatch_no: originalData.dispatch_no || null,
          // New date/time for the return doc
          dated: formatDateToYYYYMMDD(new Date()),
          time: formatTimeToHHMMSS(new Date()),
          rmk: (type === "purchaseReturn" || type === "grnReturn")
            ? `Return for GRN# ${originalData.grn_no || ""}`
            : `Return for Dispatch# ${originalData.dispatch_no || ""}`,
          invoice_no: null,
        };

        const mappedLines = originalData.transactions
          ?.filter((t) => t.sub_tran_id === 1)
          .map((line) => ({
            itcd: {
              value: String(line.itcd || ""),
              label: String(
                line.itemDetails?.item ||
                line.itemDetails?.code ||
                line.itcd ||
                ""
              ),
            },
            no_of_pack: Number(line.no_of_pack) || 0,
            qty_per_pack: Number(line.qty_per_pack) || 0,
            qty: 0,           // Return qty starts at 0; user enters amount
            rate: Number(line.rate) || 0,
            gross_amount: 0,
            st_rate: Number(line.st_rate) || 0,
            st_amount: 0,
            additional_tax: Number(line.additional_tax) || 0,
            camt: 0,
            stock: Number(line.stock) || 0,
            original_qty: Number(line.qty) || 0,
          })) || [{}];

        setMasterData(mappedMaster);
        setMainLines(mappedLines.length > 0 ? mappedLines : [{}]);
      } else {
        // ✅ TRY TO RESTORE FROM STORAGE FIRST (for new forms)
        // loadFromStorage() is a pure read — it does NOT trigger the auto-save effect
        const savedFormData = loadFromStorage();

        if (savedFormData.hasRestoredData) {
          // Always use today's date even when restoring a draft
          setMasterData({ ...savedFormData.masterData, dated: today });
          setMainLines(savedFormData.mainLines);
          setDeductionLines(savedFormData.deductionLines);
          setHasDraft(true);
          toast.info("Previous unsaved data has been restored.");
        } else {
          setMasterData(defaultMasterData);
          setMainLines([{ ...(voucherConfig.newLineDefaults || {}) }]);
          setDeductionLines([{}]);
        }

        // ✅ Allow auto-save to begin from this point onward.
        // Must be called AFTER setMasterData/setMainLines so the first
        // real save captures actual data, not the empty initial state.
        markInitialized();
      }
    };

    initFormData();
  }, [voucherConfig, editMode, existingData, originalData, type]);

  // ── Produce-on-dispatch (voucherConfig.lineBom) ──────────────────────────
  // Each finished-good line carries the BOM it is made from, scaled to the
  // line qty: line.materials = [{ itcd: {value,label}, qty, unit, godown }].
  // The user may change it for this dispatch only — the master BOM is never
  // touched. Each material is issued from its own `godown` ({value,label}) or,
  // when blank, from the header's master.godown2 ("Issue Materials From") —
  // e.g. the main material from DESPATCH and a scrap item from PLANT. The
  // finished good is produced into the dispatch godown
  // (lib/dispatch/bomProduction.js: one Material Issue per issue godown).
  //   line.bomItcd / line.bomQty — the item and qty `materials` were built for
  //   line.materialsEdited       — changed by hand: a qty change rescales the
  //                                rows instead of reloading the BOM
  //                                ("Reset to BOM" clears it)
  // Everything below is a no-op for every other voucher type.
  // Off on Settings → Features (dispatch.produceOnDispatch): a NEW dispatch only takes
  // finished goods in stock — no materials panel; the server ignores line.materials too.
  // Editing a saved dispatch keeps the materials it was saved with.
  const lineBom = !!voucherConfig.lineBom && (features.on("dispatch.produceOnDispatch") || (editMode && mode !== "create"));
  const issueGodownId = lineBom
    ? String(masterData.godown2?.value ?? masterData.godown2 ?? "")
    : "";
  // The godown one material row is issued from (its own, else the header's).
  const matGodownOf = (m) => String(m?.godown?.value ?? m?.godown ?? "") || issueGodownId;
  const [bomStock, setBomStock] = useState({}); // `${godown}|${itcd}` → stock
  const [bomUnits, setBomUnits] = useState({}); // itcd → unit
  const [bomCollapsed, setBomCollapsed] = useState({}); // line index → folded
  const [editBom, setEditBom] = useState(null); // saved dispatch: { issueGodown, byLine }
  const [editBomApplied, setEditBomApplied] = useState(false);
  const bomTimersRef = useRef({});
  const bomPendingRef = useRef({});
  const bomStockReqRef = useRef(new Set());
  const bomUnitReqRef = useRef(new Set());

  // The saved dispatch being edited (not a create-from-Sale-Order).
  const editTranId =
    lineBom && editMode && mode !== "create"
      ? Number(existingData?.voucherId || existingData?.master?.tran_id) || null
      : null;

  // Edit: the materials this dispatch was saved with, per line.
  useEffect(() => {
    if (!editTranId) return;
    let cancelled = false;
    setEditBom(null);
    setEditBomApplied(false);
    axios
      .get("/api/dispatch/bom", { params: { tran_id: editTranId } })
      .then((res) => {
        if (cancelled) return;
        setEditBom({
          issueGodown: res.data?.issueGodown ?? null,
          byLine: res.data?.byLine || {},
        });
      })
      .catch((err) => {
        console.error("Error loading dispatch materials:", err);
        // Left unloaded on purpose: validateForm refuses the save, so a
        // failed load can never wipe the saved production.
        if (!cancelled) toast.error("Could not load this dispatch's materials (BOM). Close and reopen it before saving.");
      });
    return () => {
      cancelled = true;
    };
  }, [editTranId]);

  // …attached to the loaded lines once they are in state. Lines are put in
  // save order (Transactions.id) because materials are linked by line number.
  useEffect(() => {
    if (!editBom || editBomApplied) return;
    if (!mainLines.some((l) => bomItcdOf(l?.itcd))) return;
    const ordered = mainLines.every((l) => Number.isFinite(Number(l?.id)))
      ? [...mainLines].sort((a, b) => Number(a.id) - Number(b.id))
      : mainLines;
    // The header's "Issue Materials From" this edit will show.
    let header = bomItcdOf(masterData.godown2);
    const savedIssue = masterData.godown2;
    if (savedIssue != null && savedIssue !== "" && typeof savedIssue !== "object") {
      // Saved row carries the raw id — show it as "id - name" like the picker.
      const name = existingData?.master?.godown2Details?.godown;
      setMasterData((prev) => ({
        ...prev,
        godown2: { value: String(savedIssue), label: name ? `${savedIssue} - ${name}` : String(savedIssue) },
      }));
    } else if (editBom.issueGodown != null && !header) {
      header = String(editBom.issueGodown);
      const name = Object.values(editBom.byLine).flat().find((m) => String(m.godown) === header)?.godownName;
      setMasterData((prev) => ({
        ...prev,
        godown2: { value: header, label: name ? `${header} - ${name}` : header },
      }));
    }
    setMainLines(
      ordered.map((l, i) => ({
        ...l,
        // A row issued from the header's godown keeps godown blank (it
        // follows the header); a row from another godown keeps its own.
        materials: (editBom.byLine[String(i + 1)] || []).map((m) => ({
          itcd: { value: String(m.itcd), label: m.item || String(m.itcd) },
          qty: Number(m.qty) || 0,
          godown:
            m.godown != null && String(m.godown) !== header
              ? { value: String(m.godown), label: m.godownName ? `${m.godown} - ${m.godownName}` : String(m.godown) }
              : null,
        })),
        bomItcd: bomItcdOf(l?.itcd),
        bomQty: Number(l?.qty) || 0,
        materialsEdited: true,
      })),
    );
    setEditBomApplied(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editBom, editBomApplied, mainLines]);

  // Edit: what this dispatch already issued of a material from a godown —
  // given back to "available" in that godown.
  const bomSavedQty = (godown, itcd) => {
    if (!editBom || !godown) return 0;
    let total = 0;
    Object.values(editBom.byLine).forEach((rows) =>
      (rows || []).forEach((m) => {
        if (String(m.itcd) === String(itcd) && String(m.godown ?? editBom.issueGodown ?? "") === String(godown)) {
          total += Number(m.qty) || 0;
        }
      }),
    );
    return total;
  };

  // Load / rescale each line's materials when its item or qty changes.
  useEffect(() => {
    if (!lineBom) return;
    if (editTranId && !editBomApplied) return; // wait for the saved materials

    mainLines.forEach((line, idx) => {
      const itcd = bomItcdOf(line?.itcd);
      const qty = Number(line?.qty) || 0;

      if (!itcd) {
        // Item cleared → nothing to produce on this line.
        if (line?.bomItcd || line?.materials?.length) {
          setMainLines((prev) =>
            prev.map((l, i) =>
              i === idx && !bomItcdOf(l?.itcd)
                ? { ...l, materials: [], bomItcd: null, bomQty: 0, materialsEdited: false, bomMissing: false }
                : l,
            ),
          );
        }
        return;
      }

      const itemChanged = String(line.bomItcd ?? "") !== itcd;
      if (!itemChanged && (Number(line.bomQty) || 0) === qty) return;

      if (!itemChanged && line.materialsEdited) {
        // Hand-edited rows follow the qty proportionally.
        setMainLines((prev) =>
          prev.map((l, i) => {
            if (i !== idx || bomItcdOf(l?.itcd) !== itcd || !l.materialsEdited) return l;
            const from = Number(l.bomQty) || 0;
            const to = Number(l.qty) || 0;
            if (from === to) return l;
            const factor = from > 0 ? to / from : null;
            return {
              ...l,
              bomQty: to,
              materials:
                factor === null
                  ? l.materials
                  : (l.materials || []).map((m) => ({ ...m, qty: bomRound((Number(m.qty) || 0) * factor) })),
            };
          }),
        );
        return;
      }

      // Fresh BOM for (item, qty) — debounced, latest request wins.
      const key = `${itcd}|${qty}|${issueGodownId}`;
      if (bomPendingRef.current[idx] === key) return;
      bomPendingRef.current[idx] = key;
      clearTimeout(bomTimersRef.current[idx]);
      bomTimersRef.current[idx] = setTimeout(async () => {
        try {
          const res = await axios.get("/api/dispatch/bom", {
            params: { itcd, qty, ...(issueGodownId ? { godown: issueGodownId } : {}) },
          });
          const rows = res.data?.materials || [];
          if (issueGodownId) {
            setBomStock((prev) => {
              const next = { ...prev };
              rows.forEach((m) => {
                if (m.available != null) next[`${issueGodownId}|${m.itcd}`] = Number(m.available) || 0;
              });
              return next;
            });
          }
          setMainLines((prev) =>
            prev.map((l, i) => {
              if (i !== idx) return l;
              // Stale: the line moved on while this was loading.
              if (bomItcdOf(l?.itcd) !== itcd || (Number(l?.qty) || 0) !== qty) return l;
              if (String(l.bomItcd ?? "") === itcd && l.materialsEdited) return l;
              return {
                ...l,
                materials: rows.map((m) => ({
                  itcd: { value: String(m.itcd), label: m.item || String(m.itcd) },
                  qty: Number(m.qty) || 0,
                  unit: m.unit || "",
                })),
                bomItcd: itcd,
                bomQty: qty,
                materialsEdited: false,
                bomMissing: !res.data?.bom_id,
              };
            }),
          );
        } catch (err) {
          console.error("Error loading BOM:", err);
          toast.error(`Could not load the BOM for line ${idx + 1}`);
        } finally {
          if (bomPendingRef.current[idx] === key) delete bomPendingRef.current[idx];
        }
      }, 400);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineBom, mainLines, issueGodownId, editTranId, editBomApplied]);

  useEffect(
    () => () => Object.values(bomTimersRef.current).forEach((t) => clearTimeout(t)),
    [],
  );

  // Stock of every material in the godown it is issued from (and units for
  // rows that came without one) — refreshed when a godown changes.
  useEffect(() => {
    if (!lineBom) return;
    const pairs = new Map(); // godown → Set(itcd)
    const unitless = new Set();
    mainLines.forEach((l) =>
      (l?.materials || []).forEach((m) => {
        const id = bomItcdOf(m?.itcd);
        if (!id) return;
        const g = matGodownOf(m);
        if (g) {
          if (!pairs.has(g)) pairs.set(g, new Set());
          pairs.get(g).add(id);
        }
        if (!m.unit) unitless.add(id);
      }),
    );

    const noUnit = [...unitless].filter((id) => !(id in bomUnits) && !bomUnitReqRef.current.has(id));
    noUnit.forEach((id) => {
      bomUnitReqRef.current.add(id);
      axios
        .get(`/api/forms/items/${id}`)
        .then((res) => setBomUnits((prev) => ({ ...prev, [id]: res.data?.unit || "" })))
        .catch(() => bomUnitReqRef.current.delete(id));
    });

    pairs.forEach((ids, g) => {
      const missing = [...ids].filter((id) => {
        const k = `${g}|${id}`;
        return !(k in bomStock) && !bomStockReqRef.current.has(k);
      });
      if (!missing.length) return;
      missing.forEach((id) => bomStockReqRef.current.add(`${g}|${id}`));
      axios
        .post("/api/voucher/check-stock", {
          productIds: missing.map(Number),
          godown: Number(g),
          fromOpening: true,
        })
        .then((res) =>
          setBomStock((prev) => {
            const next = { ...prev };
            missing.forEach((id) => {
              next[`${g}|${id}`] = Number(res.data?.[id]) || 0;
            });
            return next;
          }),
        )
        .catch((err) => {
          console.error("Error checking material stock:", err);
          missing.forEach((id) => bomStockReqRef.current.delete(`${g}|${id}`));
        });
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineBom, mainLines, issueGodownId, bomStock, bomUnits]);

  // Change one line's materials by hand.
  const updateLineMaterials = (lineIndex, update) => {
    setMainLines((prev) =>
      prev.map((l, i) =>
        i === lineIndex
          ? { ...l, materials: update(Array.isArray(l.materials) ? l.materials : []), materialsEdited: true }
          : l,
      ),
    );
  };

  // "Reset to BOM": drop the hand edits and reload the item's BOM.
  const resetLineMaterials = (lineIndex) => {
    delete bomPendingRef.current[lineIndex];
    setMainLines((prev) =>
      prev.map((l, i) =>
        i === lineIndex
          ? { ...l, bomItcd: null, bomQty: 0, materialsEdited: false, bomMissing: false }
          : l,
      ),
    );
  };

  // Godowns for a material row's "Issue from" picker (open godowns, loaded once).
  const bomGodownsRef = useRef(null);
  const loadBomGodownOptions = useCallback((input, callback) => {
    const list = bomGodownsRef.current
      ? Promise.resolve(bomGodownsRef.current)
      : axios.get("/api/setup/godowns").then((res) => {
          const data = res.data?.data || res.data || [];
          bomGodownsRef.current = (Array.isArray(data) ? data : []).map((g) => ({
            value: String(g.id),
            label: `${g.id} - ${g.godown}`,
          }));
          return bomGodownsRef.current;
        });
    list
      .then((options) => {
        const q = String(input || "").toLowerCase();
        callback(q ? options.filter((o) => o.label.toLowerCase().includes(q)) : options);
      })
      .catch(() => callback([]));
  }, []);

  // Items for the material picker (same list as the other item pickers).
  const loadMaterialOptions = useCallback(
    debounce((input, callback) => {
      axios
        .get(`/api/setup/items${input ? `?search=${encodeURIComponent(input)}` : ""}`)
        .then((res) => {
          const data = res.data?.data || res.data || [];
          callback(
            (Array.isArray(data) ? data : [data]).slice(0, 100).map((item) => ({
              value: String(item.itcd),
              label: [item.code, item.item].filter((v) => v != null && v !== "").join("-") || String(item.itcd),
            })),
          );
        })
        .catch(() => callback([]));
    }, 300),
    [],
  );

  // ── Service Invoice linked documents (voucherConfig.masterLinks) ────────
  // The whole invoice may name the GRNs / dispatches the service was for:
  //   masterLinks = [{ value: tran_id, label, source_type: "GRN"|"DISPATCH" }]
  // Sent as master.links: [{ source_tran_id, source_type }]; the server
  // replaces the stored set on save. No-op for every other voucher type.
  const hasMasterLinks = !!voucherConfig.masterLinks;
  const [masterLinks, setMasterLinks] = useState([]);
  const [linkType, setLinkType] = useState("GRN"); // "GRN" | "DISPATCH"
  const [editLinksApplied, setEditLinksApplied] = useState(false);
  const linksTranId =
    hasMasterLinks && editMode && mode !== "create"
      ? Number(existingData?.voucherId || existingData?.master?.tran_id) || null
      : null;

  // ── GRN / Dispatch Services panel (voucherConfig.documentServices) ──────
  // Freight, off-loading … keyed on the document and sent as body.services;
  // the server books them as linked Service Invoices
  // (lib/service/documentServices.js). null until the panel has loaded the
  // saved ones (or when it is hidden) → nothing is sent, nothing is touched.
  // Off on Settings → Features (documents.servicesPanel): no panel, nothing sent,
  // existing linked service invoices are left as they are.
  const docServiceSource = features.on("documents.servicesPanel") ? voucherConfig.documentServices || null : null; // "GRN" | "DISPATCH"
  const docServiceTranId =
    docServiceSource && editMode && mode !== "create"
      ? Number(existingData?.voucherId || existingData?.master?.tran_id) || null
      : null;
  const [docServices, setDocServices] = useState(null);

  // ── Batch no used again (Settings → Features: documents.batchReuseWarning) ──
  // Sale Order, Features "saleOrder.focTrialWarning": while any free line (Free
  // of Cost order / Trial line) has an item this customer already had as FOC /
  // Trial, this holds the message and Save is hidden behind it (the server
  // refuses the same save). Re-checked when the items, customer or type change.
  const [focTrialBlock, setFocTrialBlock] = useState(null);
  const focBlockOn = type === "saleOrder" && features.on("saleOrder.focTrialWarning");
  const focBlockParty = focBlockOn ? masterData.party_code?.value ?? masterData.party_code ?? "" : "";
  const focBlockItcds = focBlockOn
    ? mainLines
        .filter((l) => soLineFree(masterData, l))
        .map((l) => l?.itcd?.value ?? l?.itcd)
        .filter(Boolean)
        .join(",")
    : "";
  const focBlockExclude = focBlockOn && editMode && mode !== "create" ? masterData.order_no ?? "" : "";
  useEffect(() => {
    if (!focBlockParty || !focBlockItcds) {
      setFocTrialBlock(null);
      return;
    }
    let cancelled = false;
    axios
      .get("/api/orders/saleOrder/foc-trial-check", {
        params: { party_code: focBlockParty, itcd: focBlockItcds, ...(focBlockExclude ? { exclude: focBlockExclude } : {}) },
      })
      .then(({ data }) => !cancelled && setFocTrialBlock(data?.message || null))
      .catch(() => {}); // the save is checked by the server anyway
    return () => {
      cancelled = true;
    };
  }, [focBlockParty, focBlockItcds, focBlockExclude]);

  // Create Dispatch: a line's Batch No already on another dispatch → a warning
  // toast only; nothing is blocked. Each batch warns once. (From Eastland.)
  const dispatchBatchOn = type === "dispatch" && mode === "create" && features.on("documents.batchReuseWarning");
  const dispatchBatches = dispatchBatchOn
    ? [...new Set(mainLines.map((l) => String(l?.batch_no?.value ?? l?.batch_no ?? "").trim()).filter(Boolean))].join(",")
    : "";
  const warnedDispatchBatchRef = useRef(new Set());
  useEffect(() => {
    if (!dispatchBatches) return;
    const toCheck = dispatchBatches.split(",").filter((b) => !warnedDispatchBatchRef.current.has(b));
    if (toCheck.length === 0) return;
    const controller = new AbortController();
    const timer = setTimeout(() => {
      axios
        .get("/api/dispatch/batch-check", { params: { batch_no: toCheck.join(",") }, signal: controller.signal })
        .then(({ data }) => {
          const used = data?.used || {};
          for (const b of toCheck) {
            warnedDispatchBatchRef.current.add(b);
            if (used[b]?.length) {
              toast.warning(`Batch No ${b} is already used`, {
                description: `This batch no is already on Dispatch# ${used[b].join(", ")}.`,
                duration: 8000,
              });
            }
          }
        })
        .catch(() => {}); // a failed check never matters to the save
    }, 800);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [dispatchBatches]);
  const servicesPanelRef = useRef(null);

  // One debounced search per document type.
  const linkLoaders = useMemo(() => {
    const make = (type) =>
      debounce((input, callback) => {
        axios
          .get("/api/service-invoice/links", { params: { type, search: input || "", limit: 30 } })
          .then((res) => callback(Array.isArray(res.data?.data) ? res.data.data : []))
          .catch(() => callback([]));
      }, 300);
    return { GRN: make("GRN"), DISPATCH: make("DISPATCH") };
  }, []);

  // Edit: the links this invoice was saved with — filled once. Saving is
  // blocked (validateForm) until they are in, so a save cannot wipe them.
  useEffect(() => {
    if (!linksTranId) return;
    let cancelled = false;
    setEditLinksApplied(false);
    axios
      .get("/api/service-invoice/links", { params: { tran_id: linksTranId } })
      .then((res) => {
        if (cancelled) return;
        const rows = Array.isArray(res.data?.links) ? res.data.links : [];
        setMasterLinks(
          rows
            .filter((k) => Number(k?.source_tran_id) > 0 && k?.source_type)
            .map((k) => ({
              value: Number(k.source_tran_id),
              label: k.label || `${k.source_type} ${k.source_tran_id}`,
              source_type: k.source_type,
            })),
        );
        setEditLinksApplied(true);
      })
      .catch((err) => {
        console.error("Error loading service invoice links:", err);
        if (!cancelled) toast.error("Could not load this invoice's linked GRNs / dispatches. Close and reopen it before saving.");
      });
    return () => {
      cancelled = true;
    };
  }, [linksTranId]);

  // Fetch next voucher number
  // useEffect(() => {
  //   if (
  //     !editMode &&
  //     voucherConfig.masterFields?.some(
  //       (f) => f.name === "vr_no" && f.autoGenerate
  //     )
  //   ) {
  //     const fetchVrNo = async () => {
  //       setLoading((prev) => ({ ...prev, vrNo: true }));
  //       try {
  //         const response = await axios.get(
  //           `/api/voucher/next-vr-no?tran_code=${
  //             voucherConfig.tran_code
  //           }&paymentType=${voucherConfig.paymentType || ""}`
  //         );
  //         setMasterData((prev) => ({ ...prev, vr_no: response.data.nextVrNo }));
  //       } catch (error) {
  //         toast.error(`Failed to fetch voucher number: ${error.message}`);
  //       } finally {
  //         setLoading((prev) => ({ ...prev, vrNo: false }));
  //       }
  //     };
  //     fetchVrNo();

  //     if (!editMode && type === "sale") {
  //       const fetchNextNumbers = async () => {
  //         try {
  //           const [stInvRes, deliveryRes] = await Promise.all([
  //             axios.get(
  //               `/api/voucher/next-sale-number?field=check_no&tran_code=6`
  //             ),
  //             axios.get(`/api/voucher/next-sale-number?field=rmk2&tran_code=6`),
  //           ]);
  //           setMasterData((prev) => ({
  //             ...prev,
  //             check_no: String(stInvRes.data.nextNumber) || "1",
  //             rmk2: String(deliveryRes.data.nextNumber) || "1",
  //           }));
  //         } catch (error) {
  //           setMasterData((prev) => ({ ...prev, check_no: "1", rmk2: "1" }));
  //         }
  //       };
  //       fetchNextNumbers();
  //     }
  //   }
  // }, [voucherConfig, editMode, type]);

  // Calculate totals
  useEffect(() => {
    if (!voucherConfig.totals) return;
    const calculatedTotals = Object.entries(voucherConfig.totals).reduce(
      (acc, [key, config]) => {
        const lines = key === "deductionTotal" ? deductionLines : mainLines;
        acc[key] = config.calculate(lines, acc) || 0;
        return acc;
      },
      {}
    );
    setTotals(calculatedTotals);
  }, [mainLines, deductionLines, voucherConfig]);

  const formatDateToYYYYMMDD = (isoDate) => {
    if (!isoDate) return "";
    const date = new Date(isoDate);
    if (isNaN(date.getTime())) return "";
    const day = String(date.getUTCDate()).padStart(2, "0");
    const month = String(date.getUTCMonth() + 1).padStart(2, "0");
    const year = date.getUTCFullYear();
    return `${year}-${month}-${day}`;
  };

  const formatTimeToHHMMSS = (isoDate) => {
    if (!isoDate) return "";
    const date = new Date(isoDate);
    if (isNaN(date.getTime())) return "";
    const hours = String(date.getUTCHours()).padStart(2, "0");
    const minutes = String(date.getUTCMinutes()).padStart(2, "0");
    const seconds = String(date.getUTCSeconds()).padStart(2, "0");
    return `${hours}:${minutes}:${seconds}`;
  };

  // Event Handlers
  const handleMasterChange = async (name, value) => {
    setMasterData((prev) => ({ ...prev, [name]: value }));

    if (
      ["purchaseOrder", "saleOrder", "saleOrderEdit"].includes(type) &&
      (name === "freeOfCost" || name === "trialProcess")
    ) {
      // Trial Process prices at zero exactly like Free of Cost; rates stay at
      // zero while either box is ticked. masterData here is still the value
      // from before this change, so the box being changed is read from `value`.
      const flags = {
        freeOfCost: masterData.freeOfCost === true,
        trialProcess: masterData.trialProcess === true,
        [name]: value === true,
      };
      const isFree = flags.freeOfCost || flags.trialProcess;
      setMainLines((prevLines) =>
        prevLines.map((line) => {
          const currentOriginalRate = line.original_rate !== undefined ? line.original_rate : line.rate;
          const currentOriginalStRate = line.original_st_rate !== undefined ? line.original_st_rate : line.st_rate;

          const newRate = isFree ? 0 : currentOriginalRate;
          const newStRate = isFree ? 0 : currentOriginalStRate;

          let newLine = {
            ...line,
            rate: newRate,
            original_rate: currentOriginalRate,
            st_rate: newStRate,
            original_st_rate: currentOriginalStRate,
          };

          voucherConfig.lineFields?.forEach(field => {
            if (field.calculate && field.dependencies) {
              newLine[field.formName || field.name] = calculateFieldValue(newLine, field);
            }
          });

          return newLine;
        })
      );
      if (isFree && value === true) {
        toast.info(
          `${name === "trialProcess" ? "Trial Process" : "Free of Cost"} enabled: all rates set to 0 and locked.` +
            (type === "purchaseOrder" ? "" : " This Sale Order will need approval before dispatch."),
        );
      }
    }

    // Sale Order "Order Type" dropdown (lib/orders/saleOrderApprovalRules.js):
    // Free of Cost / Trial → every rate 0 and locked; Normal / Rate Under
    // Negotiation → back to the customer's rate (typeable under Negotiation).
    if (["saleOrder", "saleOrderEdit"].includes(type) && name === "soOrderType") {
      const next = orderTypeFlags(value);
      const isFree = zeroRatesOn(next);
      // Trial lines on (Features orders.trialLineBilling): every line takes the
      // type's line type (Trial → Trial lines …); one line can then be changed in its Type column
      const lineTypesOn = features.on("orders.trialLineBilling");
      const nextLineType = effectiveLineType(next, null);
      setMainLines((prevLines) =>
        prevLines.map((line) => {
          const origRate = line.original_rate !== undefined ? line.original_rate : line.rate;
          const origSt = line.original_st_rate !== undefined ? line.original_st_rate : line.st_rate;
          const free = lineTypesOn ? freeLine(next, { line_type: nextLineType }) : isFree;
          const newLine = {
            ...line,
            ...(lineTypesOn ? { line_type: nextLineType } : {}),
            rate: free ? 0 : origRate,
            st_rate: free ? 0 : origSt,
            original_rate: origRate,
            original_st_rate: origSt,
          };
          voucherConfig.lineFields?.forEach((field) => {
            if (field.calculate && field.dependencies) {
              newLine[field.formName || field.name] = calculateFieldValue(newLine, field);
            }
          });
          return newLine;
        }),
      );
      const label = value?.label || "";
      if (value?.value && value.value !== "normal") {
        toast.info(
          `${label}: this Sale Order will need approval before dispatch.` +
            (isFree
              ? " All rates set to 0."
              : ratesEditableOn(next)
                ? " You can type the rate."
                : withoutGodownOn(next)
                  ? withoutGodownConfigured()
                    ? ` It is dispatched from godown ${WITHOUT_GODOWN_DISPATCH.label} without a stock check, and its sale goes to the No Godown Sale account.`
                    : " Not set up yet: no godown is configured for it, so it cannot be saved."
                  : ""),
        );
      }
    }

    // "No Godown" picked in the Godown dropdown
    if (
      ["saleOrder", "saleOrderEdit"].includes(type) &&
      name === "godown" &&
      String(value?.value ?? value ?? "") === "NONE"
    ) {
      toast.info("No Godown: this Sale Order will need approval before dispatch.");
    }

    const fieldConfig = voucherConfig.masterFields.find(
      (f) => (f.formName || f.name) === name
    );
    if (fieldConfig?.onChange) {
      try {
        const updates = await fieldConfig.onChange(
          value?.value || "",
          masterData
        );
        if (updates.lines && Array.isArray(updates.lines)) {
          const formattedLines = updates.lines.map((line) => ({
            ...line,
            itcd:
              line.itcd && typeof line.itcd === "object"
                ? line.itcd
                : { value: line.itcd || "", label: line.itcd || "" },
          }));
          setMainLines(formattedLines.length > 0 ? formattedLines : [{}]);
        }
        setMasterData((prev) => ({ ...prev, ...updates }));
      } catch (error) {
        toast.error(`Failed to load order details: ${error.message}`);
      }
    }
    if (fieldConfig?.validate) {

      const validationError = await fieldConfig.validate(value?.value || "", {
        ...masterData,
        [name]: value,
      });
      setErrors((prev) => ({
        ...prev,
        validation: { ...prev.validation, [name]: validationError },
      }));
    } else {
      setErrors((prev) => ({
        ...prev,
        validation: { ...prev.validation, [name]: null },
      }));
    }
  };

  const valueOf = (v) => (v && typeof v === "object" ? v.value : v);
  // Set one value on a line without the field's onChange chain (custom cells).
  const setLineFieldValue = (index, fieldName, value, isMain) => {
    const set = isMain ? setMainLines : setDeductionLines;
    set((prev) => prev.map((l, i) => (i === index ? { ...l, [fieldName]: value } : l)));
  };

  // Dispatch (Features: dispatch.requirePostedProcessOrder): the Sale Order's
  // items that are not ready — Process / Manufacturing with no posted Process
  // Order, or not marked by the Lab (/api/orders/so-nature). The form warns;
  // the voucher route refuses them.
  const dispatchReadyOn = type === "dispatch" && features.on("dispatch.requirePostedProcessOrder");
  const dispatchSoNo = dispatchReadyOn ? Number(masterData?.so_no?.value ?? masterData?.so_no) || null : null;
  const [dispatchNotReady, setDispatchNotReady] = useState({}); // itcd → reason
  useEffect(() => {
    if (!dispatchSoNo) {
      setDispatchNotReady({});
      return;
    }
    let cancelled = false;
    axios
      .get("/api/orders/so-nature", { params: { so_nos: dispatchSoNo } })
      .then(({ data }) => {
        if (cancelled) return;
        const map = {};
        for (const l of data?.data?.[dispatchSoNo]?.lines || []) {
          if (l.awaiting_lab) map[l.itcd] = `${l.item} — Awaiting Lab (Nature not marked, Plan #${l.plan_no})`;
          else if (l.in_production) map[l.itcd] = `${l.item} — ${l.nature}, Process Order not posted (Plan #${l.plan_no})`;
        }
        setDispatchNotReady(map);
        const reasons = Object.values(map);
        if (reasons.length) toast.warning(`Not ready for dispatch: ${reasons.join("; ")}`, { duration: 12000 });
      })
      .catch(() => !cancelled && setDispatchNotReady({}));
    return () => {
      cancelled = true;
    };
  }, [dispatchSoNo]);

  const handleLineChange = async (index, fieldName, value, isMain) => {
    if (dispatchReadyOn && isMain && fieldName === "itcd") {
      const reason = dispatchNotReady[value?.value ?? value];
      if (reason) toast.error(`${reason} — this line will not be saved until it is ready.`, { duration: 9000 });
    }
    // ✅ Track which field was last edited
    const lineKey = `${isMain ? 'main' : 'deduction'}-${index}`;
    setLastEditedFields(prev => ({
      ...prev,
      [lineKey]: fieldName
    }));

    const lines = isMain ? [...mainLines] : [...deductionLines];
    const fieldConfigs = isMain
      ? voucherConfig.lineFields
      : voucherConfig.deductionFields;
    const fieldConfig = fieldConfigs.find(
      (f) => (f.formName || f.name) === fieldName
    );
    if (!fieldConfig) return;

    const processedValue =
      fieldConfig.type === "number"
        ? value === ""
          ? 0
          : parseFloat(value) || 0
        : value;

    let newLine = { ...lines[index], [fieldName]: processedValue };

    // ✅ ADD THIS: Handle onChange for line fields
    if (fieldConfig?.onChange) {
      try {
        const updates = await fieldConfig.onChange(
          value?.value || "",
          newLine,
          lines,
          masterData
        );



        if (updates) {
          newLine = { ...newLine, ...updates };

          // A line onChange can raise a non-blocking warning by returning
          // `__warn`. Used by the LTR unit fields: choosing litres for an item
          // with no LTR Rate is allowed on a Sale Order but has to be visible,
          // because the dispatch against it will be refused. It is a message,
          // not a field, so it never reaches the payload.
          if (newLine.__warn) {
            toast.warning(newLine.__warn, { duration: 8000 });
          }
          delete newLine.__warn;

          // Re-calculate fields since updates (like rate, st_rate) might affect them
          fieldConfigs.forEach(field => {
            if (field.calculate && field.dependencies) {
              newLine[field.formName || field.name] = calculateFieldValue(newLine, field);
            }
          });
        }
      } catch (error) {
        console.error("Error in line onChange:", error);
      }
    }

    if (
      type === "journal" &&
      isMain &&
      (fieldName === "damt" || fieldName === "camt")
    ) {
      newLine[fieldName === "damt" ? "camt" : "damt"] = 0;
    }

    // FORCE qty update when dependencies change
    if (fieldConfig.dependencies?.includes(fieldName) && fieldName !== "qty") {
      fieldConfigs
        .filter((f) => f.dependencies?.includes(fieldName))
        .forEach((depField) => {
          const calculatedValue = calculateFieldValue(newLine, depField);
          newLine[depField.formName || depField.name] = calculatedValue;


        });
    }

    // Also handle dependencies for the current field
    fieldConfigs
      .filter((f) => f.dependencies?.includes(fieldName))
      .forEach((depField) => {
        // Skip if we already updated this field above
        if (
          !(
            fieldConfig.dependencies?.includes(fieldName) && fieldName !== "qty"
          )
        ) {
          const calculatedValue = calculateFieldValue(newLine, depField);
          newLine[depField.formName || depField.name] = calculatedValue;
        }
      });

    lines[index] = newLine;
    if (isMain) setMainLines(lines);
    else setDeductionLines(lines);

    const key = `${isMain ? "main" : "deduction"}-${index}-${fieldName}`;
    if (validationTimersRef.current[key])
      clearTimeout(validationTimersRef.current[key]);

    validationTimersRef.current[key] = setTimeout(async () => {
      const validationError = fieldConfig.validate
        ? await fieldConfig.validate(
          typeof processedValue === "object"
            ? processedValue.value
            : processedValue,
          newLine,
          lines, // ✅ ADDED: pass allLines
          masterData // ✅ ADDED: pass formData
        )
        : null;

      setErrors((prev) => ({
        ...prev,
        validation: {
          ...prev.validation,
          [key]: validationError?.__varianceModal__ ? null : validationError
        },
      }));
      delete validationTimersRef.current[key];
    }, 500);
  };
  const calculateFieldValue = (line, fieldConfig) => {
    if (!fieldConfig.calculate || !fieldConfig.dependencies)
      return line[fieldConfig.formName || fieldConfig.name] || "";

    // Numeric dependencies are coerced so the arithmetic in `calculate` is
    // safe. Anything that is not a number — a unit like "KG"/"LTR", a select
    // object — is passed through UNCHANGED; coercing it to 0 stripped the
    // value the calculation actually needed. Empty and missing values still
    // land as NaN/undefined, which the existing `|| 0` below absorbs exactly
    // as it did when they were coerced to 0.
    const dependencies = fieldConfig.dependencies.reduce((acc, dep) => {
      const raw = line[dep];
      const parsed = parseFloat(raw);
      return { ...acc, [dep]: Number.isFinite(parsed) ? parsed : raw };
    }, {});


    const calculated = fieldConfig.calculate(dependencies, line) || 0;



    return calculated;
  };

  const addLine = (isMain) => {
    const fields = isMain ? voucherConfig.lineFields : voucherConfig.deductionFields;

    // Create new line with proper default values for ALL fields
    const newLine = {};
    fields?.forEach((field) => {
      const fieldName = field.formName || field.name;

      // Set appropriate defaults based on field type
      if (field.type === "select") {
        // A select with a configured default starts on it — Unit, for one,
        // must open on KG rather than blank. Everything else still starts
        // null (not an empty object).
        newLine[fieldName] =
          field.defaultValue !== undefined ? field.defaultValue : null;
      } else if (field.type === "number") {
        // For number fields, default to 0 (or empty string if preferred)
        newLine[fieldName] = field.defaultValue || 0;
      } else if (field.type === "checkbox") {
        newLine[fieldName] = false;
      } else {
        // For text fields, default to empty string
        newLine[fieldName] = field.defaultValue || "";
      }
    });

    if (isMain) setMainLines((prev) => [...prev, newLine]);
    else setDeductionLines((prev) => [...prev, newLine]);
  };

  const cloneLine = (isMain) => {
    const currentLines = isMain ? mainLines : deductionLines;
    if (currentLines && currentLines.length > 0) {
      const lastLine = currentLines[currentLines.length - 1];
      const clonedLine = { ...lastLine };
      if (isMain) setMainLines((prev) => [...prev, clonedLine]);
      else setDeductionLines((prev) => [...prev, clonedLine]);
    } else {
      addLine(isMain);
    }
  };


  const removeLine = (index, isMain) => {
    const lines = isMain ? mainLines : deductionLines;
    if (lines.length <= 1) return;
    const newLines = lines.filter((_, i) => i !== index);
    if (isMain) {
      // Indices shift after removal — reset so the remaining/renumbered
      // lines get re-checked for packing material by the source-mapping effect.
      processedPackingIndicesRef.current = new Set();
      setMainLines(newLines);
    }
    else setDeductionLines(newLines);
    setSelectedRows((prev) =>
      prev.filter((k) => k !== `${isMain ? "main" : "deduction"}-${index}`)
    );
    setErrors((prev) => {
      const newValidation = { ...prev.validation };
      Object.keys(newValidation).forEach((key) => {
        if (key.startsWith(`${isMain ? "main" : "deduction"}-${index}`))
          delete newValidation[key];
      });
      return { ...prev, validation: newValidation };
    });
  };

  const toggleRowSelection = (index, isMain) => {
    const rowKey = `${isMain ? "main" : "deduction"}-${index}`;
    setSelectedRows((prev) =>
      prev.includes(rowKey)
        ? prev.filter((k) => k !== rowKey)
        : [...prev, rowKey]
    );
  };

  const deleteSelectedRows = (isMain) => {
    const prefix = isMain ? "main" : "deduction";
    const currentLines = isMain ? mainLines : deductionLines;
    const newLines = currentLines.filter(
      (_, i) => !selectedRows.includes(`${prefix}-${i}`)
    ) || [{}];
    if (isMain) {
      processedPackingIndicesRef.current = new Set();
      setMainLines(newLines);
    }
    else setDeductionLines(newLines);
    setSelectedRows((prev) => prev.filter((k) => !k.startsWith(prefix)));
  };

  const validateForm = async () => {
    const newErrors = {};
    const varianceItems = [];
    const stockWarnings = [];

    // Validate master fields
    for (const field of voucherConfig.masterFields || []) {
      const fieldName = field.formName || field.name;

      //Skip validation for hidden fields
      if (field.visibility && !shouldShowField(field, masterData, "master")) {
        continue;
      }
      if (field.required && !masterData[fieldName]?.toString().trim())
        newErrors[fieldName] = `${field.label} is required`;
      if (field.validate && masterData[fieldName]) {
        const validationError = await field.validate(
          masterData[fieldName],
          masterData
        );
        if (validationError) newErrors[fieldName] = validationError;
      }
    }

    // Validate line items
    if (
      !mainLines.some((line) =>
        Object.values(line).some((v) => v?.toString().trim())
      )
    ) {
      newErrors.mainLines = "At least one line item is required";
    } else {
      // ✅ FIXED: Remove duplicate nested loops - KEEP ONLY THIS BLOCK
      for (let index = 0; index < mainLines.length; index++) {
        const line = mainLines[index];

        // Skip empty lines
        if (isLineEmpty(line)) continue;

        for (const field of voucherConfig.lineFields || []) {
          const fieldName = field.formName || field.name;
          const fieldValue = line[fieldName];

          // Required field validation
          if (field.required && !fieldValue?.toString().trim()) {
            newErrors[
              `main-${index}-${fieldName}`
            ] = `${field.label} is required`;
          }

          // field.requiredWhen(line, masterData): required only for some
          // lines (Sub Account → when the line's A/c needs one)
          if (
            field.requiredWhen &&
            !(fieldValue && typeof fieldValue === "object" ? fieldValue.value : fieldValue)?.toString().trim() &&
            (await field.requiredWhen(line, masterData))
          ) {
            newErrors[`main-${index}-${fieldName}`] = `${field.label} is required`;
          }

          // Custom validation - ✅ ADDED: await the async validation
          if (
            field.validate &&
            fieldValue !== undefined &&
            fieldValue !== null
          ) {
            const validationError = await field.validate(
              typeof fieldValue === "object" ? fieldValue.value : fieldValue,
              line,
              mainLines, // ✅ ADDED: pass allLines
              masterData // ✅ ADDED: pass masterData
            );
            if (validationError) {
              // ✅ Check if this is a variance modal error (from dispatch +10% check)
              if (validationError?.__varianceModal__ && validationError.isStockWarning) {
                // Stock check policy on Warn (Settings → Stock checking):
                // shown, but the document still saves.
                stockWarnings.push(validationError);
              } else if (validationError?.__varianceModal__) {
                varianceItems.push(validationError);
                newErrors[`__variance-main-${index}-${fieldName}`] = validationError.message;
              } else {
                newErrors[`main-${index}-${fieldName}`] = validationError;
              }
            }
          }
        }
      }
      // ✅ REMOVE THE DUPLICATE BLOCK THAT STARTS HERE
    }

    // Deduction lines: only field.requiredWhen is checked here (Sub Account
    // on an account that needs one) — the rest of their checks are unchanged.
    for (let index = 0; index < deductionLines.length; index++) {
      const line = deductionLines[index];
      if (isLineEmpty(line)) continue;
      for (const field of voucherConfig.deductionFields || []) {
        if (!field.requiredWhen) continue;
        const fieldName = field.formName || field.name;
        const fieldValue = line[fieldName];
        if (
          !(fieldValue && typeof fieldValue === "object" ? fieldValue.value : fieldValue)?.toString().trim() &&
          (await field.requiredWhen(line, masterData))
        ) {
          newErrors[`deduction-${index}-${fieldName}`] = `${field.label} is required`;
        }
      }
    }

    // Produce-on-dispatch: materials need the godown they are issued from,
    // and every material row needs an item.
    if (lineBom) {
      if (editTranId && !editBomApplied) {
        newErrors.godown2 = "This dispatch's materials (BOM) have not loaded yet — wait, or close and reopen it";
      }
      // A material row without its own godown is issued from the header's.
      const needsHeaderGodown = mainLines.some(
        (line) =>
          !isLineEmpty(line) &&
          (line.materials || []).some((m) => Number(m?.qty) > 0 && !matGodownOf(m)),
      );
      if (needsHeaderGodown && !issueGodownId) {
        newErrors.godown2 = "Choose the godown materials are issued from";
      }
      mainLines.forEach((line, index) => {
        if (isLineEmpty(line)) return;
        if ((line.materials || []).some((m) => !bomItcdOf(m?.itcd) && Number(m?.qty) > 0)) {
          newErrors[`main-${index}-materials`] = `Line ${index + 1}: a material row has no item`;
          return;
        }
        // Never save materials that were built for a different item or qty:
        // the BOM reload is debounced + fetched, so a quick save could
        // otherwise produce item B from item A's materials.
        const itcd = bomItcdOf(line?.itcd);
        if (!itcd) return;
        const stale =
          String(line.bomItcd ?? "") !== itcd ||
          (!line.materialsEdited && (Number(line.bomQty) || 0) !== (Number(line.qty) || 0)) ||
          Boolean(bomPendingRef.current[index]);
        if (stale) {
          newErrors[`main-${index}-materials`] =
            `Line ${index + 1}: materials are still updating for this item / qty — wait a moment (or press "Reset to BOM") and save again`;
        }
      });
      Object.entries(newErrors)
        .filter(([k]) => k === "godown2" || k.endsWith("-materials"))
        .forEach(([, msg]) => toast.error(msg));
    }

    // Service Invoice: never save before the saved links are attached —
    // the server replaces them, so a save now would drop them.
    if (hasMasterLinks && linksTranId && !editLinksApplied) {
      newErrors["main-links"] = "This invoice's linked GRNs / dispatches have not loaded yet — wait, or close and reopen it";
      toast.error(newErrors["main-links"]);
    }

    // ✅ Show variance modal if there are variance errors
    if (varianceItems.length > 0) {
      setVarianceModalData(varianceItems);
    }
    // Short stock that only warns: one amber toast per item, the save goes on.
    if (stockWarnings.length > 0 && varianceItems.length === 0) {
      const seen = new Set();
      for (const w of stockWarnings) {
        if (seen.has(w.itemId)) continue;
        seen.add(w.itemId);
        toast.warning(`${w.itemName}: ${w.message} Saving anyway (stock check is on Warn).`, { duration: 10000 });
      }
    }

    setErrors((prev) => ({ ...prev, validation: newErrors }));

    // ✅ FIXED: Dynamic validation through constants.js (e.g., for Journal where Debit == Credit)
    if (Object.keys(newErrors).length === 0 && voucherConfig.balanceCheck) {
      const formDataForCheck = {
        master: masterData,
        lines: mainLines,
        totals: totals,
      };

      const isBalanced = voucherConfig.balanceCheck.condition(formDataForCheck);

      if (!isBalanced) {
        const errMsg = voucherConfig.balanceCheck.errorMessage(formDataForCheck);
        toast.error(errMsg);
        return false;
      }
    }

    // BLOCK if there are any validation errors
    const hasErrors = Object.keys(newErrors).length > 0;
    if (hasErrors) {

      // Find first error and focus on it
      const firstErrorKey = Object.keys(newErrors)[0];
      if (firstErrorKey) {
        const focusKey = firstErrorKey.startsWith("__variance-")
          ? firstErrorKey.replace("__variance-", "")
          : firstErrorKey;
        const element = document.querySelector(`[name="${focusKey}"]`);
        if (element) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
          element.focus();
        }
      }
    }

    return !hasErrors;
  };

  const prepareFormData = (overrideMainLines, overrideDeductionLines) => {
    const linesToUse = overrideMainLines || mainLines;
    const deductionsToUse = overrideDeductionLines || deductionLines;
    const formData = {
      master: {
        ...masterData,
        tran_code: voucherConfig.tran_code,
        ...(type === "transfer" && {
          godown2: masterData.godown2?.value || masterData.godown2,
        }),
        // Dispatch: the godown BOM materials are issued from.
        ...(lineBom && {
          godown2: masterData.godown2?.value || masterData.godown2 || null,
        }),
        pycd: masterData.pycd?.value || masterData.pycd,
        godown: masterData.godown?.value || masterData.godown,
        // PO / SO / dispatch / GRN pickers hold {value,label}; the server wants the number.
        ...Object.fromEntries(
          ["po_no", "so_no", "dispatch_no", "grn_no"]
            .filter((k) => masterData[k] && typeof masterData[k] === "object")
            .map((k) => [k, masterData[k].value ?? null]),
        ),
        // UI-only edit snapshot (see initFormData), never posted.
        __orig_invoice_no: undefined,
        __orig_pycd: undefined,
        // Service Invoice: linked GRNs / dispatches for the whole invoice.
        ...(hasMasterLinks && {
          links: masterLinks
            .map((k) => ({ source_tran_id: Number(k?.value), source_type: k?.source_type }))
            .filter(
              (k) =>
                Number.isInteger(k.source_tran_id) &&
                k.source_tran_id > 0 &&
                (k.source_type === "GRN" || k.source_type === "DISPATCH"),
            ),
        }),
      },
      lines: linesToUse
        .filter((line) => !isLineEmpty(line))
        .map((line) => ({
          ...line,
          itcd: line.itcd?.value || line.itcd,
          // batch_no is a normal select → store its value (one batch per line)
          batch_no: line.batch_no?.value ?? line.batch_no ?? null,
          // Unit picker (dispatch KG / LTR) → the plain unit string
          ...(line.unit && typeof line.unit === "object" ? { unit: line.unit.value ?? null } : {}),
        }))
        // Produce-on-dispatch: rate / GST % as numbers and the line's
        // materials as [{ itcd, qty, godown }] (empty rows dropped; godown =
        // the row's own or the header's). Lines stay in display order — the
        // server links materials to line index + 1.
        .map((line) => {
          if (!lineBom) return line;
          const { bomItcd, bomQty, materialsEdited, bomMissing, ...rest } = line;
          return {
            ...rest,
            rate: Number(line.rate) || 0,
            st_rate: Number(line.st_rate) || 0,
            materials: (Array.isArray(line.materials) ? line.materials : [])
              .map((m) => ({
                itcd: Number(bomItcdOf(m?.itcd)),
                qty: Number(m?.qty) || 0,
                godown: Number(matGodownOf(m)) || null,
              }))
              .filter((m) => Number.isInteger(m.itcd) && m.itcd > 0 && m.qty > 0),
          };
        })
        // Service Invoice: links live on the master now — drop any stale
        // line-level UI state (the server ignores it anyway).
        .map((line) => {
          if (!hasMasterLinks) return line;
          const { links, ...rest } = line;
          return rest;
        }),
      deductions: voucherConfig.hasDeductionBlock
        ? deductionsToUse
          .filter((line) => !isLineEmpty(line))
          .map((line) => ({
            ...line,
            itcd: line.itcd?.value || line.itcd,
          }))
        : [],
      // GRN / Dispatch: the Services panel (only once it has loaded).
      ...(docServiceSource && Array.isArray(docServices) && {
        services: docServices
          // A pre-filled default row (r.auto) the user gave no rate is not a service.
          .filter((r) => !(r.auto && (r.rate === "" || r.rate == null)))
          .filter((r) => r.service_id || r.pycd || Number(r.rate) > 0 || String(r.invoice_no || "").trim())
          .map((r) => ({
            tran_id: r.tran_id || null,
            service_id: r.service_id,
            pycd: r.pycd,
            invoice_no: r.invoice_no || "",
            qty: r.qty,
            rate: r.rate,
            st_rate: r.st_rate,
            additional_tax: r.additional_tax,
            narration1: r.narration1,
          })),
      }),
    };
    // if (
    //   type === "sale" ||
    //   type === "transfer" ||
    //   (type === "requisition" && masterData.req_catagory?.value !== "PURCHASE")
    // ) {
    //   const stockErrors = [];
    //   formData.lines.forEach((line, index) => {
    //     const stock = stockLevels[line.itcd] || 0;
    //     const qty = parseFloat(line.qty || 0);
    //     if (qty > stock)
    //       stockErrors.push({
    //         index,
    //         message: `Insufficient stock for item ${line.itcd}. Available: ${stock}, Requested: ${qty}`,
    //       });
    //   });
    //   if (stockErrors.length > 0) {
    //     const newValidationErrors = { ...errors.validation };
    //     stockErrors.forEach((error) => {
    //       newValidationErrors[`main-${error.index}-qty`] = error.message;
    //     });
    //     setErrors((prev) => ({ ...prev, validation: newValidationErrors }));
    //     throw new Error("Stock validation failed");
    //   }
    // }
    return formData;
  };

  const handleSubmit = async (e) => {
    e.preventDefault();

    // Prevent multiple submissions
    if (isSavingRef.current) {
      toast.error("Save is already in progress. Please wait...");
      return;
    }

    if (loading.vrNo)
      return toast.error("Please wait for operations to complete");

    // Features "saleOrder.focTrialWarning": an item already given FOC / Trial
    if (focTrialBlock) return toast.error(focTrialBlock, { duration: 10000 });

    // Features "saleOrder.duplicateItems" = refused: one line per item
    if (type === "saleOrder" && features.value("saleOrder.duplicateItems") === "refused") {
      const seen = new Map();
      const twice = new Set();
      for (const l of mainLines) {
        const it = l?.itcd?.value ?? l?.itcd;
        if (!it) continue;
        if (seen.has(String(it))) twice.add(l?.itcd?.label || l?.item_name || it);
        seen.set(String(it), true);
      }
      if (twice.size) {
        return toast.error(`An item may be on one line only — ${[...twice].join(", ")} is on more than one. Put its quantity on one line.`, { duration: 10000 });
      }
    }

    // Remove empty rows from UI before validating/saving
    const cleanedMain = mainLines.filter((line) => !isLineEmpty(line));
    const cleanedDeductions = deductionLines.filter((line) => !isLineEmpty(line));
    const finalMain = cleanedMain.length > 0 ? cleanedMain : [{}];
    const finalDeductions = cleanedDeductions.length > 0 ? cleanedDeductions : [{}];
    if (cleanedMain.length !== mainLines.length) setMainLines(finalMain);
    if (cleanedDeductions.length !== deductionLines.length) setDeductionLines(finalDeductions);

    const isValid = await validateForm();
    if (!isValid) {
      toast.error("Please correct errors");
      const firstErrorKey = Object.keys(errors.validation)[0];
      if (firstErrorKey)
        document.querySelector(`[name="${firstErrorKey}"]`)?.focus();
      return;
    }

    // Lock saving
    isSavingRef.current = true;
    setLoading((prev) => ({ ...prev, submit: true }));

    try {
      const formData = prepareFormData(finalMain, finalDeductions);
      saveMutation.mutate(formData);
    } finally {
      // Unlock after mutation completes (via useEffect)
    }
  };

  // Print Preview Handler
  const handlePrintPreview = async () => {
    // Prevent multiple submissions
    if (isSavingRef.current) {
      toast.error("Operation is already in progress. Please wait...");
      return;
    }

    const isValid = await validateForm();
    if (!isValid) {
      toast.error("Please correct errors before printing");
      return;
    }

    // Lock saving
    isSavingRef.current = true;
    setLoading((prev) => ({ ...prev, submit: true }));

    try {
      const formData = prepareFormData();

      // Save first
      const url =
        mode !== "create" && existingData?.voucherId ? `${apiMap[type]}` : apiMap[type];
      const method = mode !== "create" ? "put" : "post";
      const response = await axios[method](url, requestIdFor(formData));
      if (response.data?.pendingApproval) {
        heldForApproval(response.data);
        return;
      }
      requestIdRef.current = null;
      showServerWarnings(response.data);
      console.log(response.data,);

      let voucherId;
      if (type === "purchaseOrder" || type === "saleOrder") {
        voucherId = response.data.order_no;
      } else if (type === "requisition") {
        voucherId = response.data.tran_no;
      } else {
        voucherId = response.data.voucherId;
      }

      // Set print data for preview
      setPrintData({
        master: formData.master,
        lines: formData.lines,
        voucherId: voucherId,
        saved: true,
      });

      // ✅ CLEAR STORAGE — Print & Save also counts as a completed save
      finalizeDraft();
      setHasDraft(false);
      if (typeof onSuccess === "function") onSuccess();

      // Open print preview — this IS the save confirmation, so no SaveSuccessDialog here
      setPrintPreviewOpen(true);
    } catch (error) {
      const serverErr = error.response?.data?.error || error.response?.data?.message;
      toast.error(
        serverErr || `Failed to ${editMode ? "update" : "save"} voucher: ${error.message}`
      );
    } finally {
      isSavingRef.current = false;
      setLoading((prev) => ({ ...prev, submit: false }));
    }
  };

  // Direct Print Handler (without preview)
  const handleDirectPrint = async () => {
    const isValid = await validateForm();
    if (!isValid) {
      toast.error("Please correct errors before printing");
      return;
    }

    setLoading((prev) => ({ ...prev, submit: true }));
    try {
      const formData = prepareFormData();

      // Save first
      const url =
        editMode && existingData?.voucherId ? `${apiMap[type]}` : apiMap[type];
      const method = editMode ? "put" : "post";
      const response = await axios[method](url, requestIdFor(formData));
      if (response.data?.pendingApproval) {
        heldForApproval(response.data);
        return;
      }
      requestIdRef.current = null;
      showServerWarnings(response.data);

      setSaveResult({
        vrNo: response.data.vrNo || formData.master?.vr_no || null,
        grnNo: response.data.grnNo || formData.master?.grn_no || null,
        dispatchNo: response.data.dispatchNo || formData.master?.dispatch_no || null,
        order_no: response.data.order_no || null,
        party_code: masterData.party_code || response.data.party_code || null,
        dated: formData.master?.dated || null,
        tranId: response.data.voucherId || null,
        isUpdate: editMode,
        typeName: VOUCHER_CONFIG[type]?.label || type,
      });

      // Generate and print PDF directly
      const pdfResponse = await axios.post(
        "/api/voucher/generate-pdf",
        {
          voucherId: response.data.voucherId,
          type: type,
        },
        {
          responseType: "blob",
        }
      );

      // Create blob and open in new window for printing
      const blob = new Blob([pdfResponse.data], { type: "application/pdf" });
      const urlBlob = URL.createObjectURL(blob);
      const printWindow = window.open(urlBlob);

      // Auto-print after PDF loads
      printWindow.onload = () => {
        printWindow.print();
      };

      if (typeof onSuccess === "function") onSuccess();
    } catch (error) {
      const serverErr = error.response?.data?.error || error.response?.data?.message;
      toast.error(
        serverErr || `Failed to ${mode !== "create" ? "update" : "save"} and print: ${error.message}`
      );
    } finally {
      setLoading((prev) => ({ ...prev, submit: false }));
    }
  };
  // Print and PDF functions
  const handlePrint = async () => {
    const isValid = await validateForm();
    if (!isValid) {
      toast.error("Please correct errors before printing");
      return;
    }

    setLoading((prev) => ({ ...prev, submit: true }));
    try {
      const formData = prepareFormData();
      const url =
        mode !== "create" && existingData?.voucherId ? `${apiMap[type]}` : apiMap[type];
      const method = mode !== "create" ? "put" : "post";

      // Save first, then print
      const response = await axios[method](url, requestIdFor(formData));
      if (response.data?.pendingApproval) {
        heldForApproval(response.data);
        return;
      }
      requestIdRef.current = null;
      showServerWarnings(response.data);
      toast.success(`Voucher ${mode !== "create" ? "updated" : "saved"} successfully`);

      // Open print dialog
      window.print();

      if (typeof onSuccess === "function") onSuccess();
    } catch (error) {
      const serverErr = error.response?.data?.error || error.response?.data?.message;
      toast.error(
        serverErr || `Failed to ${mode !== "create" ? "update" : "save"} voucher: ${error.message}`
      );
    } finally {
      setLoading((prev) => ({ ...prev, submit: false }));
    }
  };

  const handleSaveAsPDF = async () => {
    const isValid = await validateForm();
    if (!isValid) {
      toast.error("Please correct errors before saving as PDF");
      return;
    }

    setLoading((prev) => ({ ...prev, submit: true }));
    try {
      const formData = prepareFormData();
      const url =
        mode !== "create" && existingData?.voucherId ? `${apiMap[type]}` : apiMap[type];
      const method = mode !== "create" ? "put" : "post";

      // Save first
      const response = await axios[method](url, requestIdFor(formData));
      if (response.data?.pendingApproval) {
        heldForApproval(response.data);
        return;
      }
      requestIdRef.current = null;
      showServerWarnings(response.data);
      toast.success(`Voucher ${mode !== "create" ? "updated" : "saved"} successfully`);

      // Generate PDF (you'll need to implement this endpoint)
      const pdfResponse = await axios.post(
        "/api/voucher/generate-pdf",
        {
          voucherId: response.data.voucherId,
          type: type,
          currency: currency,
        },
        {
          responseType: "blob",
        }
      );

      // Download PDF
      const urlBlob = window.URL.createObjectURL(new Blob([pdfResponse.data]));
      const link = document.createElement("a");
      link.href = urlBlob;
      link.setAttribute("download", `voucher-${response.data.voucherId}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();

      if (typeof onSuccess === "function") onSuccess();
    } catch (error) {
      const serverErr = error.response?.data?.error || error.response?.data?.message;
      toast.error(
        serverErr || `Failed to ${editMode ? "update" : "save"} voucher as PDF: ${error.message}`
      );
    } finally {
      setLoading((prev) => ({ ...prev, submit: false }));
    }
  };

  const confirmTransfer = async () => {
    setTransferConfirmOpen(false);
    setLoading((prev) => ({ ...prev, submit: true }));
    try {
      toast.success("Transfer completed successfully");
      onClose();
    } catch (error) {
      toast.error(`Transfer failed: ${error.message}`);
    } finally {
      setLoading((prev) => ({ ...prev, submit: false }));
    }
  };

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  // Placed here, below every handler these call, so the shortcut map can
  // reference them directly instead of through the temporal dead zone.
  // Same pattern as ProductionPlanForm.

  // Any of these being open means the user is in a nested dialog, so the
  // form's own shortcuts stand down and let that dialog have the keyboard.
  const anyNestedDialogOpen =
    modalOpen ||
    transferConfirmOpen ||
    printPreviewOpen ||
    !!saveResult ||
    !!varianceModalData;

  // Read as a function, not a captured value: isSavingRef is a ref, so it can
  // flip after the render that built these handlers.
  const isBusy = () =>
    saveMutation.isPending ||
    loading.submit ||
    loading.vrNo ||
    isSavingRef.current;

  const submitViaKeyboard = () => {
    if (isBusy()) return;
    // Commit whatever field is focused before validating
    if (document.activeElement instanceof HTMLElement) {
      document.activeElement.blur();
    }
    handleSubmit({ preventDefault: () => {} });
  };

  const addLineShortcut = (isMain) => {
    if (isBusy()) return;
    handleAddLineShortcut(null, isMain);
  };

  const cloneLineShortcut = (isMain) => {
    if (isBusy()) return;
    cloneLine(isMain);
    const lines = isMain ? mainLines : deductionLines;
    setCurrentFocus({
      section: isMain ? "main" : "deduction",
      index: lines.length,
      field: 0,
    });
  };

  const deleteSelectedShortcut = () => {
    if (selectedRows.some((k) => k.startsWith("main"))) deleteSelectedRows(true);
    else if (selectedRows.some((k) => k.startsWith("deduction")))
      deleteSelectedRows(false);
  };

  // Jump between the header and the grid without tabbing through every
  // master field. Alt+L lands on the first typeable cell of the row the
  // cursor is on (or the first row); Alt+H goes back to the first header field.
  const jumpToLines = () => {
    if (isBusy()) return;
    const row =
      currentFocus.section === "main" && currentFocus.index < mainLines.length
        ? currentFocus.index
        : 0;
    focusField("main", row, Math.max(0, firstFocusable("main", row)));
  };

  const jumpToMaster = () => {
    if (isBusy()) return;
    focusField("master", 0, Math.max(0, masterFrom(0, 1)));
  };

  useKeyboardShortcuts(
    {
      // Save works from anywhere, including while typing in a field.
      // handleSubmit has its own isSavingRef lock, so a double press is safe.
      //
      // Ctrl+Enter is deliberately NOT a save here: inside the grid it already
      // means "add a new line" (handleKeyNavigation), and claiming it globally
      // would both add a line and save on one press.
      "ctrl+s": { handler: submitViaKeyboard, allowInInput: true },
      // Add a row to either block
      "alt+m": { handler: () => addLineShortcut(true), allowInInput: true },
      "alt+c": { handler: () => cloneLineShortcut(true), allowInInput: true },
      "alt+d": {
        handler: () => {
          if (voucherConfig.hasDeductionBlock) addLineShortcut(false);
        },
        allowInInput: true,
      },
      // Remove whatever rows are ticked
      "ctrl+d": { handler: deleteSelectedShortcut, allowInInput: true },
      // Header <-> grid
      "alt+l": { handler: jumpToLines, allowInInput: true },
      "alt+h": { handler: jumpToMaster, allowInInput: true },
      // GRN / Dispatch: jump to the Services panel
      "alt+v": {
        handler: () => {
          if (docServiceSource && !isBusy()) servicesPanelRef.current?.focus();
        },
        allowInInput: true,
      },
      // Print. Ctrl+P is kept because the grid already answered it; Alt+P is
      // the same thing, named the way the production forms name it.
      "alt+p": {
        handler: () => {
          if (!isBusy()) handlePrintPreview();
        },
        allowInInput: true,
      },
      "ctrl+p": {
        handler: () => {
          if (!isBusy()) handlePrintPreview();
        },
        allowInInput: true,
      },
      "ctrl+shift+p": {
        handler: () => {
          if (!isBusy()) handleDirectPrint();
        },
        allowInInput: true,
      },
      // Escape closes the voucher — but the first Escape belongs to any open
      // react-select dropdown, so the user does not lose the whole form just
      // by dismissing an account list. The old handler closed it every time.
      escape: {
        handler: () => {
          if (document.querySelector(".react-select__menu")) return;
          if (!isBusy()) onClose();
        },
        allowInInput: true,
      },
    },
    !anyNestedDialogOpen,
  );

  const FORM_SHORTCUTS = [
    { combo: "Ctrl+S", label: mode === "edit" ? "Update voucher" : "Save voucher" },
    { combo: "Alt+M", label: "Add row to main block" },
    { combo: "Alt+C", label: "Clone last row to main block" },
    ...(voucherConfig.hasDeductionBlock
      ? [{ combo: "Alt+D", label: "Add row to deduction block" }]
      : []),
    { combo: "Ctrl+Enter", label: "Add row (from inside the grid)" },
    { combo: "Ctrl+D", label: "Delete ticked rows" },
    { combo: "Alt+L", label: "Jump to line items" },
    { combo: "Alt+H", label: "Jump back to header" },
    ...(docServiceSource
      ? [
          { combo: "Alt+V", label: "Jump to Services (freight, off-loading …)" },
          { combo: "Ctrl+Delete", label: "Remove a Services row" },
        ]
      : []),
    { combo: "Backspace", label: "Delete line (on an empty first cell)" },
    { combo: "Alt+P", label: "Print preview" },
    { combo: "Ctrl+Shift+P", label: "Print directly" },
    { combo: "Enter", label: "Next field" },
    { combo: "Tab", label: "Next field" },
    { combo: "Shift+Tab", label: "Previous field" },
    { combo: "Esc", label: "Close dropdown / close voucher" },
    { combo: "Shift+?", label: "Show this help" },
  ];

  // ✅ FIXED Render Input Field - NO conditional hooks
  // ✅ FIXED Render Input Field - NO conditional hooks
  const renderInputField = (line, fieldConfig, index, isMain) => {
    const fieldName = fieldConfig.formName || fieldConfig.name;

    // ✅ Track last edited field for this line
    const lineKey = `${isMain ? 'main' : 'deduction'}-${index}`;
    const lastEditedField = lastEditedFields[lineKey] || null;

    // ✅ Create context for smart calculation
    const calculationContext = {
      lastEditedField,
      lineIndex: index,
      isMain,
    };

    // ✅ USE LINE VALUE DIRECTLY FIRST
    const lineValue = line[fieldName];
    // ✅ Get value with context
    const calculatedValue = fieldConfig.calculate
      ? fieldConfig.calculate(line, calculationContext)
      : null;
    const value = lineValue !== undefined ? lineValue : calculatedValue;

    // ✅ CHECK IF FIELD SHOULD BE LOCKED
    let isLocked = shouldLockField(
      fieldConfig,
      { ...masterData, ...line },
      editMode,
      documentStatus
    );

    if (fieldConfig.disabled && typeof fieldConfig.disabled === "function") {
      if (fieldConfig.disabled({ ...masterData, ...line }, editMode)) {
        isLocked = true;
      }
    } else if (fieldConfig.disabled === true) {
      isLocked = true;
    }
    const Icon =
      ICON_MAP[fieldConfig.name] || ICON_MAP[fieldConfig.type] || FileText;

    // ✅ CHECK VISIBILITY - Return null if not visible
    const isVisible = shouldShowField(fieldConfig, { ...masterData, ...line }, "line");

    if (!isVisible) {
      return null;
    }

    // Sale Order → Production Plan cells (Plan Date / Plan Qty + Create)
    if (fieldConfig.type === "saleOrderPlan") {
      return (
        <SaleOrderPlanCell
          part={fieldConfig.part}
          line={line}
          masterData={masterData}
          editMode={editMode}
          locked={isLocked || mode === "view"}
          setValue={(name, v) => setLineFieldValue(index, name, v, isMain)}
        />
      );
    }

    // Production Plan line → Process Order (Features: production.labNature):
    // opens Create Process Order with this plan, Sale Order, item and qty picked
    if (fieldConfig.type === "planProcessOrder") {
      const planNo = Number(valueOf(masterData?.tran_id) ?? existingData?.master?.tran_id) || null;
      const nature = String(valueOf(line?.nature) ?? "").toUpperCase();
      const itcd = valueOf(line?.itcd);
      if (!planNo || !itcd || !["PROCESS", "MANUFACTURING"].includes(nature)) {
        return <span className="text-xs text-muted-foreground">—</span>;
      }
      const qs = new URLSearchParams({
        tab: "production",
        fromPlan: String(planNo),
        so: String(valueOf(line?.so_no) ?? ""),
        itcd: String(itcd),
        qty: String(line?.qty ?? ""),
      });
      return (
        <a
          href={`/accounting/material?${qs.toString()}`}
          target="_blank"
          rel="noreferrer"
          className="inline-flex h-9 items-center whitespace-nowrap rounded-md border border-primary/40 px-2 text-xs font-medium text-primary hover:bg-primary/5"
        >
          Process Order
        </a>
      );
    }

    // ✅ SIMPLIFIED - Move useEffect logic to parent component
    // In renderInputField function, for the itcd field
    if (fieldConfig.type === "select") {
      // ✅ Create a unique key based on customer or SO selection (for dispatch)
      const isDispatch = type === "dispatch";
      const soKey = masterData.so_no?.value || masterData.so_no || 'no-so';
      const lineSoKey = line.so_no?.value || line.so_no || 'no-so';
      const customerKey = masterData.party_code?.value || masterData.party_code || 'no-customer';
      const freeOfCostKey = (masterData.freeOfCost || masterData.trialProcess) ? 'all-items' : 'customer-items'; // ✅ NEW: Track freeOfCost
      // react-select caches its loaded options, so a select whose endpoint is
      // derived from the master (Payment/Receipt lines exclude the `pycd`
      // account) has to be remounted when that master value changes.
      const pycdKey = masterData.pycd?.value || masterData.pycd || 'no-pycd';
      const distinctKey = isDispatch ? soKey : `${customerKey}-${freeOfCostKey}-${lineSoKey}-${pycdKey}`; // ✅ Updated for saleOrder and line-level so_no

      return (
        <div key={`item-${distinctKey}-field-${fieldName}`} data-focus={name}>
          <AsyncCreatableSelectCom
            key={`item-${distinctKey}-${index}`} // ✅ FORCES RE-RENDER WHEN SO (dispatch), CUSTOMER, or freeOfCost (saleOrder) CHANGES
            value={
              value && typeof value === "object"
                ? value
                : { value: String(value || ""), label: String(value || "") }
            }
            placeholder={
              "Select product"
            }
            required={fieldConfig.required}
            error={
              errors.validation[
              `${isMain ? "main" : "deduction"}-${index}-${fieldName}`
              ]
            }
            name={`${isMain ? "main" : "deduction"}-${index}-${fieldName}`}
            locked={isLocked}
            masterData={masterData}
            lineData={line}
            fieldConfig={fieldConfig}
            apiEndpoint={fieldConfig.apiEndpoint}
            createEndpoint={fieldConfig.createEndpoint}
            valueKey={fieldConfig.valueKey}
            nameKey={fieldConfig.nameKey}
            modalFields={fieldConfig.modalFields}
            onValueChange={(newOption) =>
              handleLineChange(index, fieldName, newOption, isMain)
            }
            onNewCreated={(newOption) => {
              // Optional: refresh options if needed
            }}
            isSmallList={
              !fieldConfig.options?.includes("accounts") &&
              !fieldConfig.options?.includes("products")
            }
            onKeyDown={(e) =>
              handleKeyNavigation(
                e,
                isMain ? "main" : "deduction",
                index,
                fieldConfig.index || 0,
                (isMain
                  ? voucherConfig.lineFields
                  : voucherConfig.deductionFields
                )?.length || 0,
                1,
                isMain
                  ? voucherConfig.lineFields
                  : voucherConfig.deductionFields
              )
            }
          />
          {/* Where the line's account stands today (AccountPosition.jsx) */}
          {isMain && isAccountField(fieldConfig) && <AccountPosition acno={line[fieldName]} />}
          {/* Line info under the select (field.lineInfo), e.g. Sale Order
              live stock: "Stock G-3: 1,250 · Stock G-9: 80" — red at 0 / minus. */}
          {isMain && fieldConfig.lineInfo && (() => {
            const key = fieldConfig.lineInfo.key(line);
            if (!key) return null;
            const info = lineInfoMap[key];
            if (!info) {
              return <div className="mt-1 text-[11px] text-gray-400">Loading stock…</div>;
            }
            return (
              <div className="mt-1 flex flex-wrap gap-x-4 text-[11px] font-semibold">
                {fieldConfig.lineInfo.items(info).map((it) => (
                  <span
                    key={it.label}
                    className={Number(it.value) > 0 ? "text-emerald-700" : "text-red-600"}
                  >
                    {it.label}: {Number(it.value || 0).toLocaleString(undefined, { maximumFractionDigits: 2 })}
                  </span>
                ))}
              </div>
            );
          })()}
        </div>
      );
    }

    if (fieldConfig.type === "normalSelect") {
      let selectValue = value;
      const customStyles = {
        control: (base) => ({
          ...base,
          minHeight: "36px",
          minWidth: "200px",
          fontSize: "0.875rem",
          boxShadow: "none",
          "&:focus": {
            borderColor: "#3b82f6",
            boxShadow: "0 0 0 2px rgba(59,130,246,0.5)",
          },
        }),
        menu: (base) => ({
          ...base,
          zIndex: 1000,
          boxShadow: "0 4px 10px rgba(0, 0, 0, 0.1)",
          border: "1px solid #e2e8f0",
        }),
        option: (base, { isFocused, isSelected }) => ({
          ...base,
          backgroundColor: isSelected
            ? "#dbeafe"
            : isFocused
              ? "#eff6ff"
              : "white",
          color: isSelected ? "#1d4ed8" : "#111827",
          cursor: "pointer",
          padding: "8px 12px",
          zIndex: 1000,
        }),
        placeholder: (base) => ({
          ...base,
          color: "#9ca3af",
        }),
        menuPortal: (base) => ({
          ...base,
          zIndex: 100000000,
          cursor: "pointer",
          minWidth: "250px",
        }),
        menuList: (base) => ({
          ...base,
          zIndex: 1000000,
          cursor: "pointer",
          overflowY: "auto",
          scrollbarWidth: "thin",
          scrollbarColor: "#cbd5e1 transparent",
          "&::-webkit-scrollbar": {
            width: "6px",
          },
          "&::-webkit-scrollbar-thumb": {
            backgroundColor: "#cbd5e1",
            borderRadius: "3px",
            border: "3px solid transparent",
            backgroundClip: "content-box",
            cursor: "pointer",
          },
          "&::-webkit-scrollbar-thumb:hover": {
            backgroundColor: "#94a3b8",
            cursor: "pointer",
          },
          "&::-webkit-scrollbar-track": {
            backgroundColor: "transparent",
            cursor: "pointer",
          },
        }),
      };
      // The very first line of a voucher is created as a bare {}, so a select
      // that has a configured default (Unit → KG) has no value on it yet.
      // Show the default rather than an empty box; the payload is unaffected,
      // and the server applies the same default to a line that never set one.
      const shownValue =
        (value === undefined || value === null) &&
          fieldConfig.defaultValue !== undefined
          ? fieldConfig.defaultValue
          : value;

      if (typeof shownValue === "string" && shownValue !== "" && fieldConfig.options) {
        const matchingOption = fieldConfig.options.find(
          (opt) => opt.value === shownValue
        );
        selectValue = matchingOption || { value: shownValue, label: shownValue };
      }
      // `shownValue &&` matters: typeof null is "object", so a cleared or
      // not-yet-set select used to fall in here and throw on `.value`.
      else if (shownValue && typeof shownValue === "object" && shownValue.value) {
        selectValue = shownValue;
      } else {
        selectValue = null;
      }

      return (
        <div data-focus={`${isMain ? "main" : "deduction"}-${index}-${fieldName}`}>
        <Select
          value={selectValue}
          options={fieldConfig.options || []}
          onChange={(newOption) =>
            handleLineChange(index, fieldName, newOption, isMain)
          }
          name={`${isMain ? "main" : "deduction"}-${index}-${fieldName}`}
          placeholder={`Select ${fieldConfig.label}`}
          isClearable
          isSearchable={false}
          styles={customStyles}
          classNamePrefix="react-select"
          menuPortalTarget={
            typeof window !== "undefined" ? document.body : null
          }
          isDisabled={
            loading.submit ||
            (typeof fieldConfig.readOnly === "function"
              ? fieldConfig.readOnly({ ...line }, predicateMaster())
              : fieldConfig.readOnly) === true
          }
          onKeyDown={(e) =>
            handleKeyNavigation(
              e,
              isMain ? "main" : "deduction",
              index,
              fieldConfig.index || 0,
              (isMain
                ? voucherConfig.lineFields
                : voucherConfig.deductionFields
              )?.length || 0,
              index === (isMain ? mainLines : deductionLines).length - 1 &&
              fieldConfig.index ===
              ((isMain
                ? voucherConfig.lineFields
                : voucherConfig.deductionFields
              )?.length || 0) -
              1,
              isMain
                ? voucherConfig.lineFields
                : voucherConfig.deductionFields,
              isMain
            )
          }
        />
        </div>
      );
    }

    const inputType =
      fieldConfig.type === "number"
        ? "number"
        : fieldConfig.type === "date"
          ? "date"
          : fieldConfig.type === "time"
            ? "time"
            : "text";

    let isReadOnly = fieldConfig.calculate && fieldConfig.dependencies && !fieldConfig.allowManualEntry;


    if (
      ["purchaseOrder", "saleOrder"].includes(type) &&
      fieldConfig.name === "rate"
    ) {
      // Sale Order: soLineFree — per line while Trial lines are on (Features
      // orders.trialLineBilling: Free of Cost order or a Trial line), else the order type
      isReadOnly = isReadOnly || (type === "saleOrder" ? soLineFree(masterData, line) : masterData.freeOfCost || masterData.trialProcess);
    }

    // readOnly may be a predicate, the way `disabled` already can be, so a
    // field can lock per row — Qty (KG) is typed on a KG line but derived, and
    // therefore locked, on a LTR line. A function left unevaluated here would
    // simply be truthy and lock the field for everyone.
    let readOnly =
      typeof fieldConfig.readOnly === "function"
        ? fieldConfig.readOnly({ ...line }, predicateMaster())
        : fieldConfig.readOnly;

    const inputElement =
      fieldConfig.type === "textarea" ? (
        <Textarea
          value={value || ""}
          disabled={readOnly || isReadOnly || saveMutation.isPending || loading.submit}
          name={`${isMain ? "main" : "deduction"}-${index}-${fieldName}`}
          onChange={(e) =>
            handleLineChange(index, fieldName, e.target.value, isMain)
          }
          readOnly={readOnly || isReadOnly}
          className="h-16 text-sm rounded-md border-gray-300 focus:ring-blue-500 focus:border-blue-500"
          onKeyDown={(e) =>
            handleKeyNavigation(
              e,
              isMain ? "main" : "deduction",
              index,
              fieldConfig.index || 0,
              (isMain
                ? voucherConfig.lineFields
                : voucherConfig.deductionFields
              )?.length || 0,
              index === (isMain ? mainLines : deductionLines).length - 1 &&
              fieldConfig.index ===
              ((isMain
                ? voucherConfig.lineFields
                : voucherConfig.deductionFields
              )?.length || 0) -
              1,
              isMain
                ? voucherConfig.lineFields
                : voucherConfig.deductionFields,
              isMain

            )
          }
        />
      ) :
        fieldConfig.type === "checkbox" ? (
          <div className="flex items-center justify-center space-x-2">
            <input
              type="checkbox"
              name={`${isMain ? "main" : "deduction"}-${index}-${fieldName}`}
              checked={!!value}
              onChange={(e) =>
                handleLineChange(index, fieldName, e.target.checked, isMain)
              }
              disabled={loading.submit || readOnly || isReadOnly}
              onKeyDown={(e) =>
                handleKeyNavigation(
                  e,
                  isMain ? "main" : "deduction",
                  index,
                  fieldConfig.index || 0,
                  (isMain
                    ? voucherConfig.lineFields
                    : voucherConfig.deductionFields
                  )?.length || 0,
                  index === (isMain ? mainLines : deductionLines).length - 1 &&
                  fieldConfig.index ===
                  ((isMain
                    ? voucherConfig.lineFields
                    : voucherConfig.deductionFields
                  )?.length || 0) -
                  1,
                  isMain
                    ? voucherConfig.lineFields
                    : voucherConfig.deductionFields,
                  isMain
                )
              }
              className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
            />
            <span className="text-sm text-gray-700">{fieldConfig.labelText}</span>
          </div>
        ) : (
          <FormInput
            icon={Icon}
            label={fieldConfig.label}
            name={`${isMain ? "main" : "deduction"}-${index}-${fieldName}`}
            type={inputType}
            grouped={shouldGroup(fieldName, fieldConfig)}
            value={value || ""}
            onChange={(e) =>
              handleLineChange(index, fieldName, e.target.value, isMain)
            }
            readOnly={isReadOnly || readOnly}
            locked={isLocked}
            disabled={loading.submit || readOnly || isReadOnly}
            uppercase={fieldConfig.uppercase}
            error={
              errors.validation[
              `${isMain ? "main" : "deduction"}-${index}-${fieldName}`
              ]
            }
            onKeyDown={(e) => {
              handleKeyNavigation(
                e,
                isMain ? "main" : "deduction",
                index,
                fieldConfig.index || 0,
                (isMain
                  ? voucherConfig.lineFields
                  : voucherConfig.deductionFields
                )?.length || 0,
                index === (isMain ? mainLines : deductionLines).length - 1 &&
                fieldConfig.index ===
                ((isMain
                  ? voucherConfig.lineFields
                  : voucherConfig.deductionFields
                )?.length || 0) -
                1,
                isMain
                  ? voucherConfig.lineFields
                  : voucherConfig.deductionFields,
                isMain
              );
            }}
          />
        );

    // ✅ Universal calculation display for ALL calculated fields
    if (fieldConfig.calculate && fieldConfig.dependencies && !fieldConfig.hideCalculatedHint) {
      const calculatedValue = calculateFieldValue(line, fieldConfig);
      const currentValue = parseFloat(value) || 0;
      const isMatching = currentValue === calculatedValue;

      return (
        <div className="space-y-1">
          {inputElement}

          {/* Show calculation info for ALL calculated fields */}
          <div
            className={`text-xs ${isMatching ? "text-green-600 border border-green-500 rounded-md px-1 py-1 inline-block" : "text-orange-600 border border-orange-500 rounded-md px-1 py-1 inline-block"
              }`}
          >
            Calculated: {Math.round(calculatedValue)}
            {!isMatching && ` • Current: ${Math.round(currentValue)}`}
          </div>

          {/* Show error if any */}
          {errors.validation[
            `${isMain ? "main" : "deduction"}-${index}-${fieldName}`
          ] && (
              <p className="text-xs text-red-500 mt-1">
                {
                  errors.validation[
                  `${isMain ? "main" : "deduction"}-${index}-${fieldName}`
                  ]
                }
              </p>
            )}
        </div>
      );
    }

    // Show subtitle from another field (e.g., date_rate below rate)
    if (fieldConfig.subtitleField) {
      const subtitleValue = line[fieldConfig.subtitleField];
      return (
        <div className="space-y-1">
          {inputElement}
          {subtitleValue !== undefined && subtitleValue !== null && subtitleValue !== "" && (
            <div className="text-xs text-green-600 border border-green-500 rounded-md px-1 py-1 inline-block">
              {fieldConfig.subtitleValue(line[fieldConfig.subtitleField])}
            </div>
          )}
          {/* Show error if any */}
          {errors.validation[
            `${isMain ? "main" : "deduction"}-${index}-${fieldName}`
          ] && (
              <p className="text-xs text-red-500 mt-1">
                {
                  errors.validation[
                  `${isMain ? "main" : "deduction"}-${index}-${fieldName}`
                  ]
                }
              </p>
            )}
        </div>
      );
    }

    // For non-calculated fields
    return inputElement;
  };
  // Render master fields
  // const renderMasterFields = () => (
  //   <motion.div
  //     className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-2 p-4 bg-gray-50 rounded-lg"
  //     initial={{ opacity: 0, y: 20 }}
  //     animate={{ opacity: 1, y: 0 }}
  //     transition={{ duration: 0.3 }}
  //   >
  //     {voucherConfig.masterFields
  //       ?.filter((f) => f.name !== "tran_code")
  //       .map((field, fieldIndex) => {
  //         // ✅ ADD THIS VISIBILITY CHECK
  //         if (!shouldShowField(field, masterData, "master")) {
  //           return null;
  //         }
  //         const fieldName = field.formName || field.name;
  //         // ✅ CHECK IF MASTER FIELD SHOULD BE LOCKED
  //         const isLocked = shouldLockField(
  //           field,
  //           masterData,
  //           editMode,
  //           documentStatus
  //         );

  //         const Icon = ICON_MAP[field.name] || ICON_MAP[field.type] || FileText;
  //         return (
  //           <div key={fieldName}>
  //             {field.type === "checkbox" ? (
  //               <div className="flex items-center space-x-2">
  //                 <label className="block text-sm font-medium text-gray-700">
  //                   {field.label}{" "}
  //                   {field.required && <span className="text-red-500">*</span>}
  //                 </label>
  //                 <input
  //                   type="checkbox"
  //                   name={`master-${fieldName}`}
  //                   checked={masterData[fieldName] || false}
  //                   onChange={(e) =>
  //                     handleMasterChange(fieldName, e.target.checked)
  //                   }
  //                   disabled={saveMutation.isPending || loading.submit}
  //                   className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
  //                   onKeyDown={(e) =>
  //                     handleKeyNavigation(
  //                       e,
  //                       "master",
  //                       0,
  //                       fieldIndex,
  //                       voucherConfig.masterFields?.length || 0,
  //                       false,
  //                       voucherConfig.masterFields,
  //                       false
  //                     )
  //                   }
  //                 />
  //                 <span className="text-sm text-gray-700 whitespace-nowrap">
  //                   Enable Free of Cost
  //                 </span>
  //               </div>
  //             ) : field.type === "select" ? (
  //               <>
  //                 <label className="mb-1 block text-[12.5px] font-semibold text-foreground/80">
  //                   {field.label}{" "}
  //                   {field.required && <span className="text-red-500">*</span>}
  //                 </label>
  //                 <AsyncCreatableSelectCom
  //                   value={
  //                     masterData[fieldName] &&
  //                       typeof masterData[fieldName] === "object"
  //                       ? masterData[fieldName]
  //                       : {
  //                         value: String(masterData[fieldName] || ""),
  //                         label: String(masterData[fieldName] || ""),
  //                       }
  //                   }
  //                   placeholder={`Select ${field.label}`}
  //                   name={`master-${fieldName}`}
  //                   required={field.required}
  //                   error={errors.validation[fieldName]}
  //                   apiEndpoint={field.apiEndpoint}
  //                   createEndpoint={field.createEndpoint}
  //                   valueKey={field.valueKey}
  //                   nameKey={field.nameKey}
  //                   modalFields={field.modalFields}
  //                   locked={isLocked} // ✅ PASS LOCKED PROP
  //                   masterData={masterData} // ✅ PASS masterData
  //                   fieldConfig={field} // ✅ PASS field config
  //                   onValueChange={(newOption) =>
  //                     handleMasterChange(fieldName, newOption)
  //                   }
  //                   onNewCreated={(newOpt) => {
  //                     // Optional: refresh
  //                   }}
  //                   onKeyDown={(e) =>
  //                     handleKeyNavigation(
  //                       e,
  //                       "master",
  //                       0,
  //                       fieldIndex,
  //                       voucherConfig.masterFields?.length || 0,
  //                       false,
  //                       voucherConfig.masterFields,
  //                       false
  //                     )
  //                   }
  //                 />
  //               </>
  //             ) : field.type === "normalSelect" ? (
  //               <>
  //                 <label className="mb-1 block text-[12.5px] font-semibold text-foreground/80">
  //                   {field.label}{" "}
  //                   {field.required && <span className="text-red-500">*</span>}
  //                 </label>
  //                 {(() => {
  //                   const customStyles = {
  //                     control: (base) => ({
  //                       ...base,
  //                       zIndex: 1000,
  //                       minHeight: "36px",
  //                       minWidth: "200px",
  //                       fontSize: "0.875rem",
  //                       boxShadow: "none",
  //                       "&:focus": {
  //                         borderColor: "#3b82f6",
  //                         boxShadow: "0 0 0 2px rgba(59,130,246,0.5)",
  //                       },
  //                     }),
  //                     menu: (base) => ({
  //                       ...base,
  //                       zIndex: 1000,
  //                       boxShadow: "0 4px 10px rgba(0, 0, 0, 0.1)",
  //                       border: "1px solid #e2e8f0",
  //                     }),
  //                     option: (base, { isFocused, isSelected }) => ({
  //                       ...base,
  //                       backgroundColor: isSelected
  //                         ? "#dbeafe"
  //                         : isFocused
  //                           ? "#eff6ff"
  //                           : "white",
  //                       color: isSelected ? "#1d4ed8" : "#111827",
  //                       cursor: "pointer",
  //                       padding: "8px 12px",
  //                       zIndex: 1000,
  //                     }),
  //                     placeholder: (base) => ({
  //                       ...base,
  //                       color: "#9ca3af",
  //                     }),
  //                     menuPortal: (base) => ({
  //                       ...base,
  //                       zIndex: 100000000,
  //                       cursor: "pointer",
  //                       minWidth: "250px",
  //                     }),
  //                     menuList: (base) => ({
  //                       ...base,
  //                       zIndex: 1000000,
  //                       cursor: "pointer",
  //                       overflowY: "auto",
  //                       scrollbarWidth: "thin",
  //                       scrollbarColor: "#cbd5e1 transparent",
  //                       "&::-webkit-scrollbar": {
  //                         width: "6px",
  //                       },
  //                       "&::-webkit-scrollbar-thumb": {
  //                         backgroundColor: "#cbd5e1",
  //                         borderRadius: "3px",
  //                         border: "3px solid transparent",
  //                         backgroundClip: "content-box",
  //                         cursor: "pointer",
  //                       },
  //                       "&::-webkit-scrollbar-thumb:hover": {
  //                         backgroundColor: "#94a3b8",
  //                         cursor: "pointer",
  //                       },
  //                       "&::-webkit-scrollbar-track": {
  //                         backgroundColor: "transparent",
  //                         cursor: "pointer",
  //                       },
  //                     }),
  //                   };
  //                   let selectValue = masterData[fieldName];
  //                   if (typeof selectValue === "string" && field.options) {
  //                     const matchingOption = field.options.find(
  //                       (opt) => opt.value === selectValue
  //                     );
  //                     selectValue = matchingOption || {
  //                       value: selectValue,
  //                       label: selectValue,
  //                     };
  //                   } else if (
  //                     typeof selectValue === "object" &&
  //                     selectValue?.value
  //                   ) {
  //                     selectValue = selectValue;
  //                   } else {
  //                     selectValue = null;
  //                   }
  //                   return (
  //                     <Select
  //                       value={selectValue || field.options[0]}
  //                       name={`master-${fieldName}`}
  //                       options={field.options || []}
  //                       onChange={(newOption) =>
  //                         handleMasterChange(fieldName, newOption)
  //                       }
  //                       placeholder={`Select ${field.label}`}
  //                       isClearable
  //                       isSearchable={false}
  //                       styles={customStyles}
  //                       classNamePrefix="react-select"
  //                       menuPortalTarget={
  //                         typeof window !== "undefined" ? document.body : null
  //                       }
  //                       isDisabled={
  //                         loading.submit ||
  //                         (field.name === "vr_no" &&
  //                           field.autoGenerate &&
  //                           loading.vrNo)
  //                       }
  //                       onKeyDown={(e) =>
  //                         handleKeyNavigation(
  //                           e,
  //                           "master",
  //                           0,
  //                           fieldIndex,
  //                           voucherConfig.masterFields?.length || 0,
  //                           false,
  //                           voucherConfig.masterFields,
  //                           false
  //                         )
  //                       }
  //                     />
  //                   );
  //                 })()}
  //               </>
  //             ) : field.type === "textarea" ? (
  //               <>
  //                 <label className="mb-1 block text-[12.5px] font-semibold text-foreground/80">
  //                   {field.label}{" "}
  //                   {field.required && <span className="text-red-500">*</span>}
  //                 </label>

  //                 <Textarea
  //                   value={masterData[fieldName] || ""}
  //                   placeholder={field.label}
  //                   name={`master-${fieldName}`}
  //                   onChange={(e) =>
  //                     handleMasterChange(fieldName, e.target.value)
  //                   }
  //                   disabled={field.readOnly || saveMutation.isPending || loading.submit}
  //                   className="h-16 text-sm rounded-md border-gray-300 focus:ring-blue-500 focus:border-blue-500"
  //                   onKeyDown={(e) =>
  //                     handleKeyNavigation(
  //                       e,
  //                       "master",
  //                       0,
  //                       fieldIndex,
  //                       voucherConfig.masterFields?.length || 0,
  //                       false,
  //                       voucherConfig.masterFields,
  //                       false
  //                     )
  //                   }
  //                 />
  //               </>
  //             ) : (
  //               <FormInput
  //                 icon={Icon}
  //                 label={field.label}
  //                 type={field.type}
  //                 name={`master-${fieldName}`}
  //                 value={masterData[fieldName] || ""}
  //                 locked={isLocked} // ✅ PASS LOCKED PROP
  //                 onChange={(e) =>
  //                   handleMasterChange(fieldName, e.target.value)
  //                 }
  //                 readOnly={
  //                   field.readOnly ||
  //                   (field.name === "vr_no" && field.autoGenerate)
  //                 }
  //                 disabled={
  //                   loading.submit ||
  //                   field.readOnly ||
  //                   (field.name === "vr_no" &&
  //                     field.autoGenerate &&
  //                     loading.vrNo)
  //                 }
  //                 required={field.required}
  //                 uppercase={field.uppercase}
  //                 error={errors.validation[fieldName]}
  //                 master={true}
  //                 onKeyDown={(e) =>
  //                   handleKeyNavigation(
  //                     e,
  //                     "master",
  //                     0,
  //                     fieldIndex,
  //                     voucherConfig.masterFields?.length || 0,
  //                     false,
  //                     voucherConfig.masterFields,
  //                     false
  //                   )
  //                 }
  //               />
  //             )}
  //           </div>
  //         );
  //       })}
  //   </motion.div>
  // );

  // One header field. fieldIndex must stay aligned with
  // voucherConfig.masterFields — the auto-focus effect and
  // handleKeyNavigation index into that array.
  const renderMasterField = (field, fieldIndex) => {
          if (field.name === "tran_code") return null;
          // ✅ ADD THIS VISIBILITY CHECK
          if (!shouldShowField(field, masterData, "master")) {
            return null;
          }
          const fieldName = field.formName || field.name;
          // ✅ CHECK IF MASTER FIELD SHOULD BE LOCKED
          const isLocked = shouldLockField(
            field,
            masterData,
            editMode,
            documentStatus
          );

          const Icon = ICON_MAP[field.name] || ICON_MAP[field.type] || FileText;
          const wide =
            field.fullWidth || field.type === "textarea" || field.type === "file" || field.type === "file-upload";
          return (
            <div key={fieldName} className={wide ? "col-span-full min-w-0" : "min-w-0"}>
              {field.type === "checkbox" ? (
                // Label on top, checkbox in the input row — same layout as the
                // other master fields, so it lines up with the boxes beside it.
                <>
                <label className="mb-1 block text-[12.5px] font-semibold text-foreground/80">
                    {field.label}{" "}
                    {field.required && <span className="text-red-500">*</span>}
                  </label>
                <div className="flex items-center space-x-2 h-[38px]">
                  <input
                    type="checkbox"
                    name={`master-${fieldName}`}
                    checked={masterData[fieldName] || false}
                    onChange={(e) =>
                      handleMasterChange(fieldName, e.target.checked)
                    }
                    disabled={saveMutation.isPending || loading.submit}
                    className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                    onKeyDown={(e) =>
                      handleKeyNavigation(
                        e,
                        "master",
                        0,
                        fieldIndex,
                        voucherConfig.masterFields?.length || 0,
                        false,
                        voucherConfig.masterFields,
                        false
                      )
                    }
                  />
                  <span className="text-sm text-gray-700 whitespace-nowrap">
                    {/* Enable Free of Cost */}
                    {/* A field may name its own tick text (e.g. "Urgent") */}
                    {field.checkboxText ?? "Enable Free of Cost"}
                  </span>
                </div>
                </>
              ) : field.type === "select" ? (
                <>
                  <label className="mb-1 block text-[12.5px] font-semibold text-foreground/80">
                    {field.label}{" "}
                    {field.required && <span className="text-red-500">*</span>}
                    {/* Optional small tag beside the label, e.g. the customer's
                        Official / Unofficial book on the Sale Order (field.labelBadge). */}
                    {(() => {
                      const badge =
                        typeof field.labelBadge === "function" ? field.labelBadge(masterData) : "";
                      if (!badge) return null;
                      return (
                        <span
                          className={`float-right rounded border px-1.5 text-md font-semibold leading-5 ${
                            badge === "Unofficial"
                              ? "border-amber-300 text-amber-700"
                              : "border-emerald-300 text-emerald-700"
                          }`}
                        >
                          {badge}
                        </span>
                      );
                    })()}
                  </label>
                  <AsyncCreatableSelectCom
                    value={
                      masterData[fieldName] &&
                        typeof masterData[fieldName] === "object"
                        ? masterData[fieldName]
                        : {
                          value: String(masterData[fieldName] || ""),
                          label: String(masterData[fieldName] || ""),
                        }
                    }
                    placeholder={`Select ${field.label}`}
                    name={`master-${fieldName}`}
                    required={field.required}
                    error={errors.validation[fieldName]}
                    apiEndpoint={field.apiEndpoint}
                    createEndpoint={field.createEndpoint}
                    valueKey={field.valueKey}
                    nameKey={field.nameKey}
                    modalFields={field.modalFields}
                    onRequestCreate={(typedText) => {
                      // Seed whatever the user typed into the modal's first
                      // free-text field so they don't retype it.
                      setModalField({
                        ...field,
                        container: "master",
                        seedValue: typedText,
                      });
                      setModalType(field.options);
                      setModalOpen(true);
                    }}
                    locked={isLocked}
                    masterData={masterData}
                    fieldConfig={field}
                    onValueChange={(newOption) =>
                      handleMasterChange(fieldName, newOption)
                    }
                    onNewCreated={(newOpt) => {
                      // Optional: refresh
                    }}
                    onKeyDown={(e) =>
                      handleKeyNavigation(
                        e,
                        "master",
                        0,
                        fieldIndex,
                        voucherConfig.masterFields?.length || 0,
                        false,
                        voucherConfig.masterFields,
                        false
                      )
                    }
                  />
                  {isAccountField(field) && <AccountPosition acno={masterData[fieldName]} />}
                </>
              ) : field.type === "normalSelect" ? (
                <>
                  <label className="mb-1 block text-[12.5px] font-semibold text-foreground/80">
                    {field.label}{" "}
                    {field.required && <span className="text-red-500">*</span>}
                  </label>
                  {(() => {
                    const customStyles = {
                      control: (base) => ({
                        ...base,
                        minHeight: "36px",
                        minWidth: 0,
                        fontSize: "0.875rem",
                        boxShadow: "none",
                        "&:focus": {
                          borderColor: "#3b82f6",
                          boxShadow: "0 0 0 2px rgba(59,130,246,0.5)",
                        },
                      }),
                      menu: (base) => ({
                        ...base,
                        zIndex: 1000,
                        boxShadow: "0 4px 10px rgba(0, 0, 0, 0.1)",
                        border: "1px solid #e2e8f0",
                      }),
                      option: (base, { isFocused, isSelected }) => ({
                        ...base,
                        backgroundColor: isSelected || isFocused ? "#800000" : "white",
                        color: isSelected || isFocused ? "#ffffff" : "#111827",
                        cursor: "pointer",
                        padding: "8px 12px",
                        zIndex: 1000,
                      }),
                      placeholder: (base) => ({
                        ...base,
                        color: "#9ca3af",
                      }),
                      menuPortal: (base) => ({
                        ...base,
                        zIndex: 100000000,
                        cursor: "pointer",
                        minWidth: "250px",
                      }),
                      menuList: (base) => ({
                        ...base,
                        zIndex: 1000000,
                        cursor: "pointer",
                        overflowY: "auto",
                        scrollbarWidth: "thin",
                        scrollbarColor: "#cbd5e1 transparent",
                        "&::-webkit-scrollbar": {
                          width: "6px",
                        },
                        "&::-webkit-scrollbar-thumb": {
                          backgroundColor: "#cbd5e1",
                          borderRadius: "3px",
                          border: "3px solid transparent",
                          backgroundClip: "content-box",
                          cursor: "pointer",
                        },
                        "&::-webkit-scrollbar-thumb:hover": {
                          backgroundColor: "#94a3b8",
                          cursor: "pointer",
                        },
                        "&::-webkit-scrollbar-track": {
                          backgroundColor: "transparent",
                          cursor: "pointer",
                        },
                      }),
                    };
                    let selectValue = masterData[fieldName];
                    if (typeof selectValue === "string" && field.options) {
                      const matchingOption = field.options.find(
                        (opt) => opt.value === selectValue
                      );
                      selectValue = matchingOption || {
                        value: selectValue,
                        label: selectValue,
                      };
                    } else if (
                      typeof selectValue === "object" &&
                      selectValue?.value
                    ) {
                      selectValue = selectValue;
                    } else {
                      selectValue = null;
                    }
                    return (
                      <div data-focus={`master-${fieldName}`}>
                      <Select
                        value={selectValue || field.options[0]}
                        name={`master-${fieldName}`}
                        options={field.options || []}
                        onChange={(newOption) =>
                          handleMasterChange(fieldName, newOption)
                        }
                        placeholder={`Select ${field.label}`}
                        isClearable
                        isSearchable={false}
                        styles={customStyles}
                        classNamePrefix="react-select"
                        menuPortalTarget={
                          typeof window !== "undefined" ? document.body : null
                        }
                        isDisabled={
                          loading.submit ||
                          (field.name === "vr_no" &&
                            field.autoGenerate &&
                            loading.vrNo)
                        }
                        onKeyDown={(e) =>
                          handleKeyNavigation(
                            e,
                            "master",
                            0,
                            fieldIndex,
                            voucherConfig.masterFields?.length || 0,
                            false,
                            voucherConfig.masterFields,
                            false
                          )
                        }
                      />
                      </div>
                    );
                  })()}
                </>
              ) : field.type === "textarea" ? (
                <>
                  <label className="mb-1 block text-[12.5px] font-semibold text-foreground/80">
                    {field.label}{" "}
                    {field.required && <span className="text-red-500">*</span>}
                  </label>

                  <Textarea
                    value={masterData[fieldName] || ""}
                    placeholder={field.label}
                    name={`master-${fieldName}`}
                    onChange={(e) =>
                      handleMasterChange(fieldName, e.target.value)
                    }
                    disabled={field.readOnly || saveMutation.isPending || loading.submit}
                    className="h-16 text-sm rounded-md border-gray-300 focus:ring-blue-500 focus:border-blue-500"
                    onKeyDown={(e) =>
                      handleKeyNavigation(
                        e,
                        "master",
                        0,
                        fieldIndex,
                        voucherConfig.masterFields?.length || 0,
                        false,
                        voucherConfig.masterFields,
                        false
                      )
                    }
                  />
                </>
              ) : field.type === "file" || field.type === "file-upload" ? (
                // Files upload as soon as they are picked; the URLs are saved
                // with the voucher (master.attachments).
                <div>
                  <label className="mb-1 block text-sm font-medium text-gray-700">
                    {field.label}{" "}
                    {field.required && <span className="text-red-500">*</span>}
                    {isLocked && (
                      <span className="ml-2 rounded bg-orange-100 px-2 py-1 text-xs text-orange-600">
                        🔒 Locked
                      </span>
                    )}
                  </label>
                  <AttachmentDropzone
                    value={masterData[fieldName]}
                    onChange={(urls) => handleMasterChange(fieldName, urls)}
                    disabled={isLocked || saveMutation.isPending || loading.submit}
                    label={field.label}
                  />
                  {errors.validation[fieldName] && (
                    <p className="mt-1 text-xs text-red-500">{errors.validation[fieldName]}</p>
                  )}
                </div>
              ) : (
                <FormInput
                  icon={Icon}
                  label={field.label}
                  type={field.type}
                  grouped={shouldGroup(fieldName, field)}
                  name={`master-${fieldName}`}
                  value={masterData[fieldName] || ""}
                  locked={isLocked}
                  onChange={(e) =>
                    handleMasterChange(fieldName, e.target.value)
                  }
                  readOnly={
                    field.readOnly ||
                    (field.name === "vr_no" && field.autoGenerate)
                  }
                  disabled={
                    loading.submit ||
                    field.readOnly ||
                    (field.name === "vr_no" &&
                      field.autoGenerate &&
                      loading.vrNo)
                  }
                  required={field.required}
                  uppercase={field.uppercase}
                  error={errors.validation[fieldName]}
                  master={true}
                  onKeyDown={(e) =>
                    handleKeyNavigation(
                      e,
                      "master",
                      0,
                      fieldIndex,
                      voucherConfig.masterFields?.length || 0,
                      false,
                      voucherConfig.masterFields,
                      false
                    )
                  }
                />
              )}
            </div>
          );
  };

  // Header in labelled groups (formLayout.js): Document · Party & store ·
  // Delivery & logistics · Details side by side, Notes & files across the
  // bottom. A group with nothing visible is left out.
  const MASTER_COLS = { 1: "lg:grid-cols-1", 2: "lg:grid-cols-2", 3: "lg:grid-cols-3", 4: "lg:grid-cols-2 2xl:grid-cols-4" };
  const renderMasterFields = () => {
    const groups = groupMasterFields(voucherConfig.masterFields || [], voucherConfig.masterGroups)
      .map((g) => ({ ...g, items: g.items.filter(({ field }) => shouldShowField(field, masterData, "master")) }))
      .filter((g) => g.items.length);
    // A voucher with its own groups (masterGroups — e.g. Letter of Credit,
    // ~30 header fields): one full-width band per group, title on the left
    // (on top on a phone), fields in the same column grid in every band.
    if (voucherConfig.masterGroups?.length) {
      return (
        <div className="vf-master min-w-0 divide-y divide-border">
          {groups.map((g) => (
            <div key={g.key} className="grid min-w-0 grid-cols-1 gap-2 px-4 py-3 lg:grid-cols-[140px_minmax(0,1fr)] lg:gap-4">
              <p className="text-[11px] font-bold uppercase tracking-wider text-primary lg:pt-1">{g.label}</p>
              <div className="grid grid-cols-1 gap-x-3 gap-y-2 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                {g.items.map(({ field, index }) => renderMasterField(field, index))}
                {g.key === "notes" && renderMasterLinks()}
              </div>
            </div>
          ))}
        </div>
      );
    }
    const columns = groups.filter((g) => g.key !== "notes");
    const notes = groups.find((g) => g.key === "notes");
    const caption = (g) => (
      <p className="text-[11px] font-bold uppercase tracking-wider text-primary">{g.label}</p>
    );
    return (
      <div className="vf-master min-w-0">
        {columns.length > 0 && (
          <div className={`grid grid-cols-1 ${MASTER_COLS[Math.min(columns.length, 4)]}`}>
            {columns.map((g) => (
              <div
                key={g.key}
                className="flex min-w-0 flex-col gap-3 border-b border-border p-4 last:border-b-0 lg:border-b-0 lg:border-r lg:last:border-r-0"
              >
                {caption(g)}
                <div className="grid grid-cols-[repeat(auto-fill,minmax(min(100%,190px),1fr))] gap-3">
                  {g.items.map(({ field, index }) => renderMasterField(field, index))}
                </div>
              </div>
            ))}
          </div>
        )}
        {(notes || hasMasterLinks) && (
          <div className="flex flex-col gap-3 border-t border-border p-4">
            {notes && caption(notes)}
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {notes?.items.map(({ field, index }) => renderMasterField(field, index))}
              {renderMasterLinks()}
            </div>
          </div>
        )}
      </div>
    );
  };

  // Render table
  // Produce-on-dispatch: the line's materials, as a nested panel under it.
  const withBomRow = (isMain, line, idx, colSpan, row) =>
    isMain && lineBom ? (
      <React.Fragment key={`main-${idx}`}>
        {row}
        {renderBomRow(line, idx, colSpan)}
      </React.Fragment>
    ) : (
      row
    );

  // Service Invoice: the GRNs / dispatches this invoice is for — one list
  // for the whole invoice, rendered as a full-width row of the header grid.
  const renderMasterLinks = () => {
    if (!hasMasterLinks) return null;
    const loadingLinks = !!linksTranId && !editLinksApplied;
    const busy = saveMutation.isPending || loading.submit || loadingLinks;
    const isLinked = (opt) =>
      masterLinks.some(
        (r) => r.source_type === (opt.source_type || linkType) && Number(r.value) === Number(opt.value),
      );
    const addLink = (opt) => {
      if (!opt || isLinked(opt)) return;
      setMasterLinks((prev) => [
        ...prev,
        { value: Number(opt.value), label: opt.label, source_type: opt.source_type || linkType },
      ]);
    };
    const removeLink = (k) =>
      setMasterLinks((prev) =>
        prev.filter((r) => !(r.source_type === k.source_type && Number(r.value) === Number(k.value))),
      );

    return (
      <div className="col-span-full">
        <div className="mb-1 flex items-center gap-2">
          <label htmlFor="master-links-search" className="block text-sm font-medium text-gray-700">
            Linked GRNs / Dispatches
          </label>
          {masterLinks.length > 0 && (
            <span className="rounded-full bg-muted px-2 py-0.5 text-[11px] font-medium tabular-nums text-muted-foreground">
              {masterLinks.length}
            </span>
          )}
        </div>
        <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-2 sm:flex-row sm:items-start">
          <div className="flex min-w-0 shrink-0 items-center gap-2">
            <div
              role="tablist"
              aria-label="Document type"
              className="inline-flex h-8 shrink-0 items-center rounded-md bg-muted p-0.5 text-xs"
            >
              {[
                ["GRN", "GRN"],
                ["DISPATCH", "Dispatch"],
              ].map(([val, text]) => (
                <button
                  key={val}
                  type="button"
                  role="tab"
                  aria-selected={linkType === val}
                  disabled={busy}
                  onClick={() => setLinkType(val)}
                  className={`h-7 rounded px-3 font-medium transition-colors disabled:opacity-50 ${
                    linkType === val
                      ? "bg-background text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  {text}
                </button>
              ))}
            </div>
            <div className="w-full min-w-0 sm:w-72">
              <AsyncSelect
                key={linkType}
                inputId="master-links-search"
                value={null}
                loadOptions={linkLoaders[linkType]}
                defaultOptions
                cacheOptions
                isDisabled={busy}
                placeholder={`Search ${linkType === "GRN" ? "GRN" : "dispatch"} no / party…`}
                onChange={addLink}
                isOptionDisabled={isLinked}
                formatOptionLabel={(opt, { context }) =>
                  context === "menu" ? (
                    <div className="flex items-center justify-between gap-3">
                      <span className="truncate">{opt.label}</span>
                      {opt.dated && (
                        <span className="shrink-0 text-[11px] text-gray-400">
                          {String(opt.dated).slice(0, 10)}
                        </span>
                      )}
                    </div>
                  ) : (
                    opt.label
                  )
                }
                menuPortalTarget={typeof window !== "undefined" ? document.body : null}
                styles={compactSelectStyles(32)}
              />
            </div>
          </div>
          <div className="flex min-h-8 min-w-0 flex-1 flex-wrap items-center gap-1.5 sm:border-l sm:border-border sm:pl-2">
            {loadingLinks ? (
              <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                <RefreshCw className="h-3 w-3 animate-spin" />
                Loading linked documents…
              </span>
            ) : masterLinks.length === 0 ? (
              <span className="text-xs text-muted-foreground">
                No documents linked — pick a {linkType === "GRN" ? "GRN" : "dispatch"} to add it.
              </span>
            ) : (
              masterLinks.map((k) => (
                <span
                  key={`${k.source_type}-${k.value}`}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-border bg-muted/50 py-0.5 pl-1 pr-1.5 text-xs text-foreground"
                >
                  <span
                    className={`rounded-full px-1.5 py-px text-[10px] font-semibold uppercase tracking-wide ${
                      k.source_type === "GRN"
                        ? "bg-sky-500/15 text-sky-700 dark:text-sky-300"
                        : "bg-violet-500/15 text-violet-700 dark:text-violet-300"
                    }`}
                  >
                    {k.source_type === "GRN" ? "GRN" : "Dispatch"}
                  </span>
                  <span className="truncate">{k.label || `${k.source_type} ${k.value}`}</span>
                  <button
                    type="button"
                    disabled={busy}
                    onClick={() => removeLink(k)}
                    className="rounded-full p-0.5 text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive disabled:opacity-50"
                    title="Remove link"
                    aria-label={`Remove ${k.label || k.value}`}
                  >
                    <X className="h-3 w-3" />
                  </button>
                </span>
              ))
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderBomRow = (line, idx, colSpan) => {
    const itcd = bomItcdOf(line?.itcd);
    if (!itcd) return null;

    const materials = Array.isArray(line.materials) ? line.materials : [];
    const loadingBom = String(line.bomItcd ?? "") !== itcd;
    const open = !bomCollapsed[idx];
    const busy = saveMutation.isPending || loading.submit;
    const godownLabel = issueGodownId
      ? masterData.godown2?.label || issueGodownId
      : null;

    // What the whole dispatch needs of each material from each godown vs
    // that godown's stock (`${godown}|${itcd}`).
    const need = {};
    mainLines.forEach((l) =>
      (l?.materials || []).forEach((m) => {
        const id = bomItcdOf(m?.itcd);
        const g = matGodownOf(m);
        if (id && g) need[`${g}|${id}`] = (need[`${g}|${id}`] || 0) + (Number(m?.qty) || 0);
      }),
    );
    const availableOf = (g, id) => {
      const k = `${g}|${id}`;
      return g && id && k in bomStock ? bomStock[k] + bomSavedQty(g, id) : null;
    };
    const isShort = (g, id) => {
      const a = availableOf(g, id);
      return a != null && (need[`${g}|${id}`] || 0) > a + 1e-6;
    };
    const ownGodowns = materials.filter((m) => {
      const g = String(m?.godown?.value ?? m?.godown ?? "");
      return g && g !== issueGodownId;
    }).length;
    const producing = materials.some((m) => bomItcdOf(m?.itcd) && Number(m?.qty) > 0);
    const shortCount = materials.filter((m) => isShort(matGodownOf(m), bomItcdOf(m?.itcd))).length;
    const totalQty = materials.reduce((s, m) => s + (Number(m?.qty) || 0), 0);
    const showEmpty = !loadingBom && materials.length === 0;

    const setRow = (mi, patch) =>
      updateLineMaterials(idx, (rows) => rows.map((r, ri) => (ri === mi ? { ...r, ...patch } : r)));
    const noEnterSubmit = (e) => {
      if (e.key === "Enter") e.preventDefault();
    };
    const toggle = () => setBomCollapsed((prev) => ({ ...prev, [idx]: open }));

    const chip =
      "inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[11px] font-medium ring-1";
    const th = "px-3 py-1.5 text-[10.5px] font-semibold uppercase tracking-wider text-muted-foreground";

    return (
      <tr key={`main-${idx}-bom`} className="border-b">
        <td colSpan={colSpan} className="px-2 pb-3 pt-0">
          {/* Indented to the item column (checkbox + # columns ≈ 5rem). */}
          <div className="relative ml-6 max-w-5xl sm:ml-[4.5rem]">
            {/* Connector from the line above into the panel. */}
            <span
              aria-hidden
              className="absolute -left-3 top-0 h-4 w-3 rounded-bl-md border-b border-l border-border"
            />
            <div className="overflow-hidden rounded-lg border border-border bg-muted/40">
              {/* Header bar */}
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 px-3 py-2">
                <button
                  type="button"
                  onClick={toggle}
                  aria-expanded={open}
                  className="group/hdr flex min-w-0 items-center gap-2 text-left"
                  title={open ? "Hide materials" : "Show materials"}
                >
                  <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-md border border-border bg-background text-muted-foreground transition-colors group-hover/hdr:text-foreground">
                    <Layers className="h-3.5 w-3.5" />
                  </span>
                  <span className="min-w-0">
                    <span className="block text-xs font-semibold leading-tight text-foreground">
                      Bill of Materials
                    </span>
                    <span className="block truncate text-[11px] leading-tight text-muted-foreground">
                      {godownLabel ? (
                        <>
                          Issued from {godownLabel}
                          {ownGodowns > 0 && ` · ${ownGodowns} from another godown`}
                        </>
                      ) : ownGodowns > 0 && ownGodowns === materials.length ? (
                        <>Each material from its own godown</>
                      ) : (
                        <span className="text-destructive">Choose “Issue Materials From” in the header</span>
                      )}
                    </span>
                  </span>
                </button>

                <div className="ml-auto flex flex-wrap items-center gap-1.5">
                  {loadingBom ? (
                    <span className={`${chip} bg-background text-muted-foreground ring-border`}>
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      Loading BOM
                    </span>
                  ) : (
                    <>
                      <span className={`${chip} bg-background tabular-nums text-muted-foreground ring-border`}>
                        {materials.length} material{materials.length === 1 ? "" : "s"}
                      </span>
                      {producing ? (
                        <span
                          className={`${chip} bg-emerald-500/10 tabular-nums text-emerald-700 ring-emerald-500/20 dark:text-emerald-300`}
                          title="Produced from these materials when the dispatch is saved"
                        >
                          Produces {bomFmt(line.qty)} KG
                        </span>
                      ) : (
                        <span
                          className={`${chip} bg-background text-muted-foreground ring-border`}
                          title="Nothing is produced: the item must already be in stock in the dispatch godown"
                        >
                          Not produced — no materials
                        </span>
                      )}
                    </>
                  )}
                  {line.materialsEdited && (
                    <span
                      className={`${chip} bg-amber-500/10 text-amber-700 ring-amber-500/25 dark:text-amber-300`}
                      title="Changed for this dispatch only — the master BOM is not touched"
                    >
                      Edited
                    </span>
                  )}
                  {shortCount > 0 && (
                    <span
                      className={`${chip} bg-red-500/10 text-red-700 ring-red-500/25 dark:text-red-300`}
                      title="Materials short in the godown they are issued from"
                    >
                      <AlertCircle className="h-3 w-3" />
                      {shortCount} short
                    </span>
                  )}
                  <button
                    type="button"
                    onClick={toggle}
                    aria-label={open ? "Collapse materials" : "Expand materials"}
                    className="ml-0.5 flex h-6 w-6 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-background hover:text-foreground"
                  >
                    <ChevronDown
                      className={`h-4 w-4 transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
                    />
                  </button>
                </div>
              </div>

              <AnimatePresence initial={false}>
                {open && (
                  <motion.div
                    key="bom-body"
                    initial={{ height: 0, opacity: 0 }}
                    animate={{ height: "auto", opacity: 1 }}
                    exit={{ height: 0, opacity: 0 }}
                    transition={{ duration: 0.2, ease: "easeOut" }}
                    style={{ overflow: "hidden" }}
                  >
                    <div className="border-t border-border bg-background">
                      {showEmpty ? (
                        <div className="flex items-center gap-3 px-4 py-4">
                          <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
                            <Layers className="h-4 w-4" />
                          </span>
                          <p className="text-xs text-muted-foreground">
                            {line.bomMissing && !line.materialsEdited
                              ? "No active BOM for this item — add materials manually or leave empty (the item must then be in stock)"
                              : "No materials on this line — add materials manually or leave empty (the item must then be in stock)"}
                          </p>
                        </div>
                      ) : (
                        <div className="overflow-x-auto">
                          <table className="w-full min-w-[800px] text-xs">
                            <thead className="bg-muted/60">
                              <tr className="border-b border-border">
                                <th className={`${th} text-left`}>Material</th>
                                <th className={`${th} w-48 text-left`}>Issue from</th>
                                <th className={`${th} w-36 text-right`}>Required qty</th>
                                <th className={`${th} w-44 text-right`}>Available</th>
                                <th className={`${th} w-16 text-left`}>Unit</th>
                                <th className="w-10" />
                              </tr>
                            </thead>
                            <tbody className="divide-y divide-border">
                              {loadingBom && materials.length === 0 && (
                                <tr>
                                  <td colSpan={6} className="px-3 py-3">
                                    <div className="h-3 w-48 animate-pulse rounded bg-muted" />
                                  </td>
                                </tr>
                              )}
                              {materials.map((m, mi) => {
                                const id = bomItcdOf(m?.itcd);
                                const g = matGodownOf(m);
                                const ownGodown = m?.godown?.value ? m.godown : null;
                                const avail = availableOf(g, id);
                                const short = isShort(g, id);
                                const unit = m?.unit || (id ? bomUnits[id] : "") || "";
                                const total = need[`${g}|${id}`] || 0;
                                const fromLabel = ownGodown?.label || godownLabel || "the issue godown";
                                const pct =
                                  avail != null && total > 0
                                    ? Math.min(100, (Math.max(0, avail) / total) * 100)
                                    : null;
                                return (
                                  <tr
                                    key={mi}
                                    className={`group/mat transition-colors ${short ? "bg-red-500/[0.04]" : "hover:bg-muted/40"}`}
                                  >
                                    <td className="px-3 py-1">
                                      <div className="min-w-[240px]">
                                        <AsyncSelect
                                          value={id ? { value: id, label: m?.itcd?.label || id } : null}
                                          loadOptions={loadMaterialOptions}
                                          defaultOptions
                                          cacheOptions
                                          isDisabled={busy}
                                          placeholder="Select material…"
                                          onChange={(opt) =>
                                            setRow(mi, {
                                              itcd: opt ? { value: String(opt.value), label: opt.label } : null,
                                              unit: "",
                                            })
                                          }
                                          menuPortalTarget={typeof window !== "undefined" ? document.body : null}
                                          styles={compactSelectStyles(30)}
                                        />
                                      </div>
                                    </td>
                                    <td className="px-3 py-1">
                                      {/* Blank = the header's "Issue Materials From". */}
                                      <div className="min-w-[170px]">
                                        <AsyncSelect
                                          value={ownGodown}
                                          loadOptions={loadBomGodownOptions}
                                          defaultOptions
                                          isClearable
                                          isDisabled={busy}
                                          placeholder={godownLabel ? `${godownLabel} (header)` : "Choose godown…"}
                                          aria-label={`Issue ${m?.itcd?.label || "material"} from`}
                                          onChange={(opt) =>
                                            setRow(mi, {
                                              godown:
                                                opt && String(opt.value) !== issueGodownId
                                                  ? { value: String(opt.value), label: opt.label }
                                                  : null,
                                            })
                                          }
                                          menuPortalTarget={typeof window !== "undefined" ? document.body : null}
                                          styles={compactSelectStyles(30)}
                                        />
                                      </div>
                                    </td>
                                    <td className="px-3 py-1 text-right">
                                      <input
                                        type="number"
                                        min="0"
                                        step="any"
                                        inputMode="decimal"
                                        name={`main-${idx}-material-${mi}-qty`}
                                        value={m?.qty ?? ""}
                                        disabled={busy}
                                        onKeyDown={noEnterSubmit}
                                        onChange={(e) => setRow(mi, { qty: e.target.value })}
                                        className={`h-[30px] w-28 rounded-md border bg-background px-2 text-right tabular-nums outline-none transition-shadow focus:ring-2 disabled:opacity-60 ${
                                          short
                                            ? "border-red-400 text-red-700 focus:ring-red-500/25 dark:text-red-300"
                                            : "border-input focus:border-blue-500 focus:ring-blue-500/25"
                                        }`}
                                      />
                                    </td>
                                    <td
                                      className="px-3 py-1 text-right tabular-nums"
                                      title={
                                        avail == null
                                          ? undefined
                                          : `This dispatch needs ${bomFmt(total)} in total from ${fromLabel}, it has ${bomFmt(avail)}`
                                      }
                                    >
                                      {avail == null ? (
                                        <span className="text-muted-foreground">—</span>
                                      ) : (
                                        <div className="flex flex-col items-end gap-1">
                                          <div className="flex items-center gap-1.5">
                                            {short ? (
                                              <span className="rounded-full bg-red-500/10 px-1.5 py-px text-[10.5px] font-semibold text-red-700 dark:text-red-300">
                                                short {bomFmt(total - avail)}
                                              </span>
                                            ) : (
                                              <CheckCircle2 className="h-3.5 w-3.5 text-emerald-600" />
                                            )}
                                            <span
                                              className={
                                                short ? "font-semibold text-red-700 dark:text-red-300" : "text-foreground"
                                              }
                                            >
                                              {bomFmt(avail)}
                                            </span>
                                          </div>
                                          {pct != null && (
                                            <div className="h-[3px] w-20 overflow-hidden rounded-full bg-muted">
                                              <div
                                                className={`h-full rounded-full ${short ? "bg-red-500/70" : "bg-emerald-500/60"}`}
                                                style={{ width: `${pct}%` }}
                                              />
                                            </div>
                                          )}
                                        </div>
                                      )}
                                    </td>
                                    <td className="px-3 py-1 text-muted-foreground">{unit || "—"}</td>
                                    <td className="px-1 py-1 text-center">
                                      <Button
                                        variant="ghost"
                                        type="button"
                                        size="icon"
                                        onClick={() =>
                                          updateLineMaterials(idx, (rows) => rows.filter((_, ri) => ri !== mi))
                                        }
                                        disabled={busy}
                                        className="h-7 w-7 text-muted-foreground opacity-0 transition-opacity hover:bg-destructive/10 hover:text-destructive focus-visible:opacity-100 group-hover/mat:opacity-100 [@media(hover:none)]:opacity-100"
                                        title="Remove material"
                                        aria-label="Remove material"
                                      >
                                        <Trash2 className="h-3.5 w-3.5" />
                                      </Button>
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}

                      {/* Footer */}
                      <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 px-2 py-1.5">
                        <div className="flex items-center gap-1">
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                            disabled={busy || loadingBom}
                            onClick={() =>
                              updateLineMaterials(idx, (rows) => [...rows, { itcd: null, qty: "", unit: "" }])
                            }
                          >
                            <PlusCircle className="mr-1 h-3.5 w-3.5" />
                            Add material
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            className="h-7 px-2 text-xs text-muted-foreground hover:text-foreground"
                            disabled={busy || loadingBom}
                            onClick={() => resetLineMaterials(idx)}
                            title="Drop the changes and reload this item's BOM for the line qty"
                          >
                            <RotateCcw className="mr-1 h-3.5 w-3.5" />
                            Reset to BOM
                          </Button>
                        </div>
                        {materials.length > 0 && (
                          <span className="pr-2 text-[11px] tabular-nums text-muted-foreground">
                            Total material qty{" "}
                            <span className="font-semibold text-foreground">{bomFmt(totalQty)}</span>
                          </span>
                        )}
                      </div>
                    </div>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
          </div>
        </td>
      </tr>
    );
  };

  const renderTable = (isMain) => {
    const fields =
      (isMain
        ? voucherConfig.lineFields
        : voucherConfig.deductionFields
      )?.filter((f) => !["tran_code", "ac_no", "ccno"].includes(f.name)) || [];
    if (!fields.length) return null;
    const lines = isMain ? mainLines : deductionLines;
    const prefix = isMain ? "main" : "deduction";
    // Per-line files (Payment / Receipt / JV): config `lineAttachments`.
    const showLineFiles = isMain && !!voucherConfig.lineAttachments;
    const visibleFields = fields.filter(field =>
      shouldShowField(field, { ...masterData, ...(lines[0] || {}) }, "line")
    );
    const title = isMain
      ? type === "payment"
        ? "Payments"
        : type === "receipt"
          ? "Receipts"
          : type === "journal"
            ? "Journal Entries"
            : type === "purchase"
              ? "Purchases"
              : "Sales"
      : "Deductions";

    return (
      <div className="mt-4 overflow-hidden rounded-xl border border-border bg-background">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-primary/15 bg-primary/5 px-4 py-3">
          <div className="flex items-center gap-2 text-[15px] font-semibold text-primary">
            {isMain ? "Lines" : "Deductions"}
            <span className="inline-flex h-[22px] min-w-[22px] items-center justify-center rounded-full bg-primary/10 px-2 text-xs font-bold tabular-nums text-primary">
              {lines.length}
            </span>
            {isMain && (
              <span className="hidden text-xs font-normal text-muted-foreground md:inline">
                Alt+L jump · Enter next cell · Ctrl+Enter new row
              </span>
            )}
          </div>
          <div className="flex gap-1">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => deleteSelectedRows(isMain)}
              disabled={
                !selectedRows.some((k) => k.startsWith(prefix)) ||
                loading.submit
              }
              className="h-8 px-2 text-muted-foreground hover:text-destructive"
              title="Delete selected rows (Ctrl+D)"
            >
              <Trash2 className="h-4 w-4" />
            </Button>
            <Button
              variant="ghost"
              type="button"
              size="sm"
              onClick={() => cloneLine(isMain)}
              disabled={saveMutation.isPending || loading.submit}
              className="h-8 px-2 text-muted-foreground hover:text-foreground"
              title="Clone last line (Alt+C)"
            >
              <Copy className="h-4 w-4" />
            </Button>
            <Button
              variant="outline"
              type="button"
              size="sm"
              onClick={() => addLine(isMain)}
              disabled={saveMutation.isPending || loading.submit}
              className="h-8 gap-1.5 border-dashed px-2.5 text-xs font-semibold"
              title={isMain ? "Add new line (Alt+M)" : "Add new line (Alt+D)"}
            >
              <PlusCircle className="h-4 w-4" />
              Add row
            </Button>
          </div>
        </div>
        {isMain && <FulfilmentSummaryBar check={fulfilment} />}
        <div className="max-h-[28rem] overflow-x-auto max-md:max-h-none">
          <table className="vf-grid w-full table-auto text-sm">
            <thead>
              <tr className="sticky top-0 z-[1] border-b-0 bg-primary text-[11px] font-bold uppercase tracking-wide text-primary-foreground [&_[role=checkbox]]:border-primary-foreground">
                <th className="p-2 w-8">
                  <input
                    type="checkbox"
                    onChange={() => {
                      const allSelected = lines.every((_, i) =>
                        selectedRows.includes(`${prefix}-${i}`)
                      );
                      if (allSelected) {
                        setSelectedRows((prev) =>
                          prev.filter((k) => !k.startsWith(prefix))
                        );
                      } else {
                        const newSelected = lines.map(
                          (_, i) => `${prefix}-${i}`
                        );
                        setSelectedRows((prev) => [
                          ...prev.filter((k) => !k.startsWith(prefix)),
                          ...newSelected,
                        ]);
                      }
                    }}
                    checked={
                      lines.length > 0 &&
                      lines.every((_, i) =>
                        selectedRows.includes(`${prefix}-${i}`)
                      )
                    }
                  />
                </th>
                <th className="p-2 w-12">#</th>
                {visibleFields.map((f, fieldIndex) => (
                  <th key={f.name} className="p-2 text-left" style={{ minWidth: f.minWidth || '120px' }}>
                    {f.label}
                    {f.required && <span className="text-red-500 ml-1">*</span>}
                  </th>
                ))}
                {showLineFiles && (
                  <th className="p-2 w-14 text-center" title="Files attached to the line">Files</th>
                )}
                <th className="p-2 w-12"></th>
              </tr>
            </thead>
            <tbody>
              <AnimatePresence>
                {lines.map((line, idx) => [withBomRow(isMain, line, idx, fields.length + 3 + (showLineFiles ? 1 : 0), (
                  <motion.tr
                    key={`${prefix}-${idx}`}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    exit={{ opacity: 0 }}
                    className={`border-b border-border/60 focus-within:bg-primary/[0.04] hover:bg-primary/[0.03] ${selectedRows.includes(`${prefix}-${idx}`)
                      ? "bg-primary/[0.07]"
                      : ""
                      }`}
                  >
                    <td className="vf-check p-2 text-center">
                      <input
                        type="checkbox"
                        checked={selectedRows.includes(`${prefix}-${idx}`)}
                        onChange={() => toggleRowSelection(idx, isMain)}
                        disabled={saveMutation.isPending || loading.submit}
                        className="accent-primary"
                        aria-label={`Select line ${idx + 1}`}
                      />
                    </td>
                    <td className="vf-index p-2 text-center text-xs font-semibold tabular-nums text-muted-foreground">{idx + 1}</td>
                    {fields.map((f, fieldIndex) => {
                      const fieldWithIndex = { ...f, index: fieldIndex };
                      return (
                        <td
                          key={f.name}
                          className={`p-1 ${/select/i.test(f.type || "") || f.type === "textarea" || f.wide ? "vf-wide" : ""}`}
                          data-label={typeof f.label === "string" ? f.label : f.name}
                        >
                          {renderInputField(line, fieldWithIndex, idx, isMain)}
                          {isMain && f.showLineEdit && <LineEditNote line={line} />}
                        </td>
                      );
                    })}
                    {showLineFiles && (
                      <td className="p-1 text-center">
                        <LineAttachmentButton
                          value={line.attachments}
                          lineLabel={
                            [line.acno?.label || line.itcd?.label, line.narration1]
                              .filter(Boolean)
                              .join(" · ") || `Line ${idx + 1}`
                          }
                          disabled={saveMutation.isPending || loading.submit}
                          onChange={(urls) =>
                            setMainLines((prev) =>
                              prev.map((l, i) => (i === idx ? { ...l, attachments: urls } : l))
                            )
                          }
                        />
                      </td>
                    )}
                    <td className="vf-remove p-2 text-center">
                      <Button
                        variant="ghost"
                        type="button"
                        size="sm"
                        onClick={() => removeLine(idx, isMain)}
                        disabled={loading.submit || lines.length === 1}
                        className="p-1 text-muted-foreground hover:text-destructive"
                        title="Remove line"
                        aria-label={`Remove line ${idx + 1}`}
                      >
                        <X className="h-4 w-4" />
                      </Button>
                    </td>
                  </motion.tr>
                )), fulfilmentStrip(isMain, line, idx, fields.length + 3 + (showLineFiles ? 1 : 0))])}
              </AnimatePresence>
            </tbody>
          </table>
        </div>
        {voucherConfig.totals && (
          <div className="flex flex-wrap justify-end gap-x-5 gap-y-1 border-t border-border bg-muted/40 px-4 py-2 text-sm">
            {Object.entries(voucherConfig.totals)
              .filter(
                ([k]) =>
                  (isMain && k !== "deductionTotal" && k !== "netTotal") ||
                  (!isMain && k === "deductionTotal")
              )
              .map(([k, config]) => (
                <div key={k} className="text-right">
                  <span className="text-muted-foreground">{config.label}:</span>
                  <span className="ml-1 font-semibold tabular-nums">
                    {totals[k]?.toLocaleString("en-US") || "0.00"}
                  </span>
                </div>
              ))}
          </div>
        )}
      </div>
    );
  };

  // Totals in the sticky action bar: every total the voucher config defines
  // (net total included — it used to be its own maroon box).
  const renderBarTotals = () => {
    const entries = Object.entries(voucherConfig.totals || {});
    if (!entries.length) return <span />;
    return (
      <div className="flex flex-wrap gap-x-6 gap-y-1">
        {entries.map(([k, config]) => (
          <div key={k} className="min-w-0">
            <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{config.label}</p>
            <p className="text-lg font-bold tabular-nums">{totals[k]?.toLocaleString("en-US") || "0"}</p>
          </div>
        ))}
      </div>
    );
  };

  // AddEntityModal
  const AddEntityModal = ({ onClose, onSave, entityType, fieldConfig }) => {
    const [entityData, setEntityData] = useState({});
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [modalErrors, setModalErrors] = useState({});

    useEffect(() => {
      const initialData =
        fieldConfig.modalFields?.reduce(
          (acc, field) => ({
            ...acc,
            [field.name]:
              field.type === "number" ? 0 : field.defaultValue || "",
          }),
          {}
        ) || {};

      // Carry the text the user typed in the select into the first free-text
      // field, so "Add new ABC Bank" opens with the name already filled in.
      const seedTarget = fieldConfig.modalFields?.find(
        (f) => !f.type || f.type === "text" || f.type === "textarea"
      );
      if (fieldConfig.seedValue && seedTarget) {
        initialData[seedTarget.name] = fieldConfig.seedValue;
      }

      setEntityData(initialData);
    }, [fieldConfig]);

    const validateModal = () => {
      const newErrors = {};
      fieldConfig.modalFields?.forEach((field) => {
        if (field.required && !entityData[field.name]?.toString().trim())
          newErrors[field.name] = `${field.label} is required`;
      });
      setModalErrors(newErrors);
      return Object.keys(newErrors).length === 0;
    };

    const handleSave = async () => {
      if (!validateModal()) return toast.error("Please fix validation errors");
      setIsSubmitting(true);
      try {
        const response = await axios.post(
          fieldConfig.createEndpoint,
          entityData
        );
        // These endpoints answer with { data: <record>, status: 201 }, so the
        // record is one level down. Without unwrapping, the caller reads
        // newEntity[valueKey] off the envelope and gets undefined.
        const created = response.data?.data ?? response.data;
        onSave(created);
        toast.success(`${fieldConfig.label} added successfully`);
        onClose();
      } catch (error) {
        // Surface the API's own message ({ error: "..." }) rather than a bare
        // "Request failed with status code 400".
        const reason =
          error?.response?.data?.error ||
          error?.response?.data?.message ||
          error.message;
        toast.error(`Failed to add ${fieldConfig.label}: ${reason}`);
      } finally {
        setIsSubmitting(false);
      }
    };

    return (
      <Dialog open onOpenChange={onClose}>
        <DialogContent className="sm:max-w-md rounded-md p-4">
          <DialogHeader className="mb-4">
            <DialogTitle className="text-lg">
              Add New {fieldConfig.label}
            </DialogTitle>
          </DialogHeader>
          <div className="grid gap-3">
            {fieldConfig.modalFields?.map((field, index) => {
              const Icon =
                ICON_MAP[field.name] || ICON_MAP[field.type] || FileText;

              return (
                <div key={index}>
                  {field.type === "select" ? (
                    <AsyncCreatableSelectCom
                      value={String(entityData[field.name] || "")}
                      placeholder={`Select ${field.label}`}
                      required={field.required}
                      error={modalErrors[field.name]}
                      apiEndpoint={field.apiEndpoint}
                      createEndpoint={field.createEndpoint}
                      valueKey={field.valueKey}
                      nameKey={field.nameKey}
                      modalFields={field.modalFields}
                      locked={isLocked}
                      masterData={masterData} // ✅ PASS masterData
                      fieldConfig={field} // ✅ PASS field config
                      onValueChange={(v) =>
                        // react-select hands back { value, label }; the API
                        // wants the scalar. Storing the object POSTed
                        // "[object Object]" and made required-checks pass on
                        // an empty selection.
                        setEntityData({
                          ...entityData,
                          [field.name]:
                            v && typeof v === "object" ? v.value : v,
                        })
                      }
                      onNewCreated={(newOpt) => { }}
                    />
                  ) : field.type === "textarea" ? (
                    <Textarea
                      value={entityData[field.name] || ""}
                      onChange={(e) =>
                        setEntityData({
                          ...entityData,
                          [field.name]: e.target.value,
                        })
                      }
                      disabled={isSubmitting}
                      className="h-20 text-sm"
                    />
                  ) : (
                    <FormInput
                      icon={Icon}
                      label={field.label}
                      type={field.type}
                      grouped={shouldGroup(field.name, field)}
                      value={entityData[field.name] || ""}
                      readOnly={readOnly}
                      onChange={(e) =>
                        setEntityData({
                          ...entityData,
                          [field.name]: e.target.value,
                        })
                      }
                      required={field.required}
                      disabled={isSubmitting}
                      error={modalErrors[field.name]}
                    />
                  )}
                </div>
              );
            })}
          </div>
          <DialogFooter className="mt-4 flex gap-2 justify-end">
            <Button
              onClick={handleSave}
              disabled={isSubmitting}
              className="bg-blue-600 hover:bg-blue-700 text-white text-sm px-4 py-2"
            >
              {" "}
              {isSubmitting ? "Saving..." : "Save"}
            </Button>
            <Button
              variant="outline"
              onClick={onClose}
              disabled={isSubmitting}
              className="border-gray-300 text-gray-700 hover:bg-gray-100 text-sm px-4 py-2"
            >
              Cancel
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    );
  };

  if (!voucherConfig || !Object.keys(voucherConfig).length)
    return (
      <div className="flex flex-col items-center justify-center min-h-screen bg-gray-50 p-4">
        <Alert variant="destructive" className="mb-4 max-w-md">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Error</AlertTitle>
          <AlertDescription>Invalid voucher type: "{type}"</AlertDescription>
        </Alert>
        <Button
          onClick={onClose}
          className="bg-blue-600 hover:bg-blue-700 text-white"
        >
          Close
        </Button>
      </div>
    );

  return (
    <div className="min-h-screen rounded-lg bg-muted/40 p-2 sm:p-3" ref={formRef}>
      <Toaster position="top-right" />
      {Object.values(errors.validation).some(Boolean) && (
        <Alert variant="destructive" className="mb-4">
          <AlertCircle className="h-4 w-4" />
          <AlertTitle>Errors</AlertTitle>
          <AlertDescription>
            {Object.values(errors.validation).filter(Boolean).join("; ")}
          </AlertDescription>
        </Alert>
      )}

      {/* Keyboard Shortcuts Help — the cheat sheet also opens with Shift+? */}
      {!anyNestedDialogOpen && (
        <div className="flex justify-end mb-2">
          <KeyboardHint shortcuts={FORM_SHORTCUTS} />
        </div>
      )}

      <form onSubmit={handleSubmit} className="max-w-full mx-auto space-y-4">
        <Card className="rounded-xl border border-border shadow-none">
          <CardHeader className="flex flex-row flex-wrap items-center justify-between gap-2 space-y-0 rounded-t-xl border-b border-primary/15 bg-primary/5 px-4 py-3">
            <CardTitle className="text-[15px] font-semibold text-primary">
              {mode === "edit" ? "Edit header" : "Header"}
            </CardTitle>
            <span className="text-xs text-muted-foreground">
              <kbd className="rounded border border-b-2 border-border bg-background px-1.5 py-0.5 font-mono text-[11px] font-semibold">Alt+H</kbd> to jump here
            </span>
          </CardHeader>
          <CardContent className="p-0">{renderMasterFields()}</CardContent>
        </Card>
        {renderTable(true)}
        {docServiceSource && (
          <DocumentServicesPanel
            ref={servicesPanelRef}
            sourceType={docServiceSource}
            tranId={docServiceTranId}
            rows={docServices}
            onRowsChange={setDocServices}
            disabled={saveMutation.isPending || loading.submit}
            docLabel={(() => {
              const field = docServiceSource === "GRN" ? "grn_no" : "dispatch_no";
              const label = docServiceSource === "GRN" ? "GRN" : "Dispatch";
              const no = masterData?.[field]?.value ?? masterData?.[field];
              return no ? `${label} ${no}` : label;
            })()}
          />
        )}
        {voucherConfig.hasDeductionBlock && renderTable(false)}
      </form>
      {/* Sticky action bar: the voucher's totals and its buttons stay in
          view however long the form gets. */}
      <div className="sticky bottom-0 z-20 mt-4 rounded-t-xl border border-b-0 border-border bg-background/95 shadow-[0_-6px_18px_rgba(20,20,30,0.06)] backdrop-blur">
        <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
          {renderBarTotals()}
          <div className="flex flex-wrap justify-end gap-2 max-sm:w-full">
          <Button
            type="button"
            variant="outline"
            onClick={onClose}
            disabled={saveMutation.isPending || loading.submit || isSavingRef.current}
            className="border-gray-300 text-primary text-sm px-4 py-2"
          >
            Cancel
          </Button>

          {/* <Button
            type="button"
            variant="outline"
            onClick={handleSaveAsPDF}
            disabled={loading.submit || loading.vrNo}
            className="border-green-300 text-green-700 text-sm px-4 py-2 flex items-center gap-2"
          >
            <Download className="h-4 w-4" />
            Save as PDF
          </Button> */}

          {/* New Print Options */}
          {voucherConfig.allowPrintSaveButton && (
            <Button
              type="button"
              variant="outline"
              onClick={handlePrintPreview}
              disabled={loading.submit || loading.vrNo || isSavingRef.current}
              className="border-primary/30 text-primary text-sm px-4 py-2 flex items-center gap-2 hover:bg-primary/5"
            >
              <Printer className="h-4 w-4" />
              {loading.submit ? "Saving..." : "Print & Save"}
            </Button>
          )}


          {/* <Button
            type="button"
            variant="outline"
            onClick={handleDirectPrint}
            disabled={loading.submit || loading.vrNo}
            className="border-purple-300 text-purple-700 text-sm px-4 py-2 flex items-center gap-2"
          >
            <Zap className="h-4 w-4" />
            Quick Print
          </Button> */}

          {hasDraft && (
            <Button
              type="button"
              variant="outline"
              onClick={() => {
                clearFromStorage();
                setHasDraft(false);
                // Source-created doc: go back to the SO/PO data, not a blank form.
                const seed = sourceSeedRef.current;
                if (seed) {
                  setMasterData(seed.masterData);
                  setMainLines(seed.mainLines);
                  setDeductionLines(seed.deductionLines);
                } else {
                  setMasterData({});
                  setMainLines([{ ...(voucherConfig.newLineDefaults || {}) }]);
                  setDeductionLines([{}]);
                }
                toast.success("Draft cleared.");
              }}
              className="border-red-300 text-red-600 hover:bg-red-50 hover:text-red-700 text-sm px-4 py-2 flex items-center gap-2"
            >
              <X className="h-4 w-4" />
              Discard Draft
            </Button>
          )}

          {focTrialBlock ? (
            <p role="alert" className="w-full basis-full text-xs font-medium text-red-600 sm:w-auto sm:basis-auto sm:max-w-md">
              {focTrialBlock}
            </p>
          ) : null}
          <Button
            type="button"
            onClick={handleSubmit}
            disabled={saveMutation.isPending || loading.submit || loading.vrNo || isSavingRef.current || !!focTrialBlock}
            title={focTrialBlock || undefined}
            className="bg-primary text-white text-sm px-4 py-2 flex items-center gap-2"
          >
            <Save className="h-4 w-4" />
            {saveMutation.isPending || loading.submit
              ? "Saving..."
              : "Save Only"}
            <kbd className="hidden rounded border border-white/30 bg-white/15 px-1.5 font-mono text-[11px] font-semibold sm:inline">Ctrl+S</kbd>
          </Button>
          </div>
        </div>
      </div>
      {modalOpen && (
        <AddEntityModal
          onClose={() => setModalOpen(false)}
          onSave={(newEntity) => {
            setOptionsData((prev) => ({
              ...prev,
              [modalType]: [...(prev[modalType] || []), newEntity],
            }));
            const fieldName = modalField.formName || modalField.name;
            const newValue = newEntity[modalField.valueKey];
            if (modalField.container === "master")
              handleMasterChange(fieldName, newValue);
            else if (modalField.lineIndex !== undefined)
              handleLineChange(
                modalField.lineIndex,
                fieldName,
                newValue,
                modalField.container === "main"
              );
            setModalOpen(false);
          }}
          entityType={modalType}
          fieldConfig={modalField}
        />
      )}
      {transferConfirmOpen && (
        <TransferConfirmation
          isOpen={transferConfirmOpen}
          onConfirm={confirmTransfer}
          onCancel={() => setTransferConfirmOpen(false)}
          fromGodown={
            optionsData.godowns?.find((g) => g.id === masterData.godown)?.godown
          }
          toGodown={
            optionsData.godowns?.find((g) => g.id === masterData.godown2)
              ?.godown
          }
          items={mainLines
            .filter((line) => line.itcd)
            .map((line) => ({
              item: optionsData.products?.find((p) => p.itcd === line.itcd)
                ?.item,
              qty: line.qty,
            }))}
        />
      )}

      {printPreviewOpen && (
        <PrintPreviewModal
          isOpen={printPreviewOpen}
          onClose={() => {
            setPrintPreviewOpen(false);
            onClose();
          }}
          printData={printData}
          type={type}
          session={session}
          currency={currency}
          company={company}
        />
      )}

      <SaveSuccessDialog
        result={saveResult}
        onClose={() => { setSaveResult(null); onClose(); }}
      />

      <VarianceErrorModal
        data={varianceModalData}
        onClose={() => setVarianceModalData(null)}
      />
    </div>
  );
}
