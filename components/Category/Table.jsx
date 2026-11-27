"use client";

import React, { useEffect, useState, useCallback, useMemo, useRef } from "react";
import { motion, AnimatePresence } from "framer-motion";
import MultiValueFilter from "./MultiValueFilter";
import useKeyboardShortcuts from "@/hooks/useKeyboardShortcuts";
import KeyboardHint from "@/components/ui/KeyboardHint";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuTrigger,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
} from "@/components/ui/dropdown-menu";
import { FilePenLine, Paperclip } from "lucide-react";
import AttachmentViewer from "@/components/Attachments/AttachmentViewer";
import { attachmentCountOf } from "@/components/Attachments/attachmentUtils";
import VoucherModal from "./Modal"; // Adjust path as needed
import ServiceInvoiceView from "./ServiceInvoiceView";
import {
  VOUCHER_CONFIG,
  checkDocumentStatus,
  mapSourceToForm,
  serviceInvoiceTotal,
  isInvoicedDoc,
  docInvoiceRef,
  lineMoney,
} from "./constants";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Pagination,
  PaginationContent,
  PaginationItem,
  PaginationLink,
  PaginationNext,
  PaginationPrevious,
} from "@/components/ui/pagination";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Package,
  Eye,
  CheckCircle2,
  XCircle,
  X,
  Truck,
  Download,
  Printer,
  BarChart3,
  AlertCircle,
  Calendar,
  Tag,
  Clock,
  Hash,
  Building2,
  Scale,
  Info,
  DollarSign,
  FileText,
  User,
  RefreshCw,
  Building,
  CheckCircle,
  Edit,
  Delete,
  Grid3X3,
  List,
  ArrowUp,
  ArrowDown,
  Receipt,
  ShoppingCart,
  ArrowUpDown,
  TrendingUp,
  ChevronDown,
  FilePlus,
  Edit2,
  Save,
  Zap,
  CircleChevronRight,
  RotateCcw,
   Wrench,
  AlertTriangle,
  ShieldCheck,
  Copy,
} from "lucide-react";
import axios from "axios";
import { usePermissions } from "@/hooks/usePermissions";
import { useFeatures } from "@/hooks/useFeatures";
import { createPortal } from "react-dom";
import { generateVoucherPDF } from "@/components/Template/Payment"; // Update path as needed
import { generateUnifiedPDF } from "../Template/UnifiedReport";
import { generateSalesOrderPDF } from "../Template/SalesOrder";
import { toast } from "sonner";
import ManualNoCell from "./ManualNoCell";
import HeaderEditDialog from "./HeaderEditDialog";
import { HEADER_EDIT_FEATURE, headerEditFields } from "@/lib/vouchers/headerEdit";
import { INVOICED_EDIT_FEATURE, LEGACY_SERIES } from "@/lib/invoicing/kinds";
import { generateDispatchNotePDF } from "../Template/Dispatch";
import { generateDeliveryNotePDF } from "../Template/DeliveryNote";
import { generateRequisitionNotePDF } from "../Template/RequistNote";
import { generateGRNPDF } from "../Template/Grn";
import { useSession } from "next-auth/react";
import { generatePurchaseOrderPDF } from "../Template/PurchaseOrderNew";
import { PDFDocument } from "pdf-lib";
import { useCurrency } from "@/context/CurrencyContext";
import { useCompany } from "@/context/CompanyContext";
import { companyShortName } from "@/lib/companyName";
import { useSearchParams } from "next/navigation";
import { voucherLabel } from "@/lib/vouchers/voucherLink";

const formatDateTime12Hr = (dateVal, showTime = false) => {
  if (!dateVal) return "N/A";
  const d = new Date(dateVal);
  if (showTime && (d.getHours() !== 0 || d.getMinutes() !== 0 || d.getSeconds() !== 0)) {
    return d.toLocaleDateString("en-US", {
      year: "numeric",
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  }
  return d.toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
};
import {
  useQuery,
  useQueryClient,
  useMutation,
  useInfiniteQuery,
  keepPreviousData,
} from "@tanstack/react-query";
import { generateSalesTaxInvoicePDF } from "../Template/SalesTaxInvoice";
import { generateCommercialInvoicePDF } from "../Template/CommercialInvoice";
import { generateProductionPlan } from "../Template/ProductionPlan";
import { orderTypeOf, NO_GODOWN_OPTION } from "@/lib/orders/saleOrderApprovalRules";

// Custom debounce hook
function useDebounce(value, delay) {
  const [debouncedValue, setDebouncedValue] = useState(value);
  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);
    return () => clearTimeout(handler);
  }, [value, delay]);
  return debouncedValue;
}

// Print Preview Modal Component
const PrintPreviewModal = ({
  isOpen,
  onClose,
  pdfUrl,
  title,
  onDownload,
  currentDoc,
}) => {
  const handlePrint = () => {
    if (currentDoc) {
      currentDoc.autoPrint();
      const blobUrl = currentDoc.output("bloburl");
      window.open(blobUrl, "_blank");
    } else if (pdfUrl) {
      window.open(pdfUrl, "_blank");
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[9999] p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ type: "spring", duration: 0.5 }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="bg-[#8b0000] px-6 py-4 text-white flex justify-between items-center">
            <div>
              <h2 className="text-xl font-bold">Print Preview</h2>
              <p className="text-sm opacity-80">{title}</p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handlePrint}
                className="bg-white text-[#8b0000] hover:bg-gray-100"
              >
                <Printer className="h-4 w-4 mr-2" />
                Print
              </Button>
              <Button
                onClick={onDownload}
                variant="outline"
                className="bg-transparent border border-white text-white hover:bg-white/20 hover:text-white"
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

          {/* PDF Viewer */}
          <div className="flex-1 bg-gray-100 p-4 overflow-hidden">
            <iframe
              src={`${pdfUrl}#toolbar=0&navpanes=0`}
              className="w-full h-full rounded-lg shadow-inner bg-white"
              title="PDF Preview"
            />
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
};

// ============================================================
// Fulfillment Progress Modal
// Universal modal for SO→Dispatch, PO→GRN, Req→Transfer progress.
// Shows per-item progress bars, dispatched/received/transferred qty,
// remaining qty. For Sale Orders also shows close/reopen toggles.
// ============================================================

// Sub-component: visual progress bar with theme colours
const ProgressBar = ({ pct }) => {
  const color =
    pct >= 100
      ? "bg-green-500"
      : pct >= 60
        ? "bg-primary"
        : pct >= 30
          ? "bg-amber-400"
          : "bg-red-400";
  return (
    <div className="w-full h-1.5 bg-gray-200 rounded-full overflow-hidden">
      <div
        className={`h-full rounded-full transition-all duration-500 ${color}`}
        style={{ width: `${Math.min(100, pct)}%` }}
      />
    </div>
  );
};

// Dot for open/closed status
const StatusDot = ({ isClosed }) => (
  <span
    className={`w-2.5 h-2.5 rounded-full flex-shrink-0 mt-0.5 ${
      isClosed ? "bg-red-400" : "bg-green-500"
    }`}
  />
);

// "Entered by" — who keyed the document (entry.entered_by from the list API:
// the stored user, else the AuditLog creator — lib/audit/enteredBy.js).
const initialsOf = (name) =>
  String(name || "")
    .trim()
    .split(/[\s._@-]+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((w) => w[0].toUpperCase())
    .join("") || "?";
const EnteredByChip = ({ name }) =>
  name ? (
    <span className="inline-flex max-w-[180px] items-center gap-1.5" title={`Entered by ${name}`}>
      <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[#800000]/10 text-[9.5px] font-bold text-[#800000]">
        {initialsOf(name)}
      </span>
      <span className="truncate text-xs text-foreground">{name}</span>
    </span>
  ) : (
    <span className="text-muted-foreground">—</span>
  );
const isUserField = (field) => field?.name === "user_id" || field?.name === "userid";

const FulfillmentProgressModal =({ isOpen, onClose, type, entry, onUpdated }) => {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [toggling, setToggling] = useState({});

  // Determine the ID to use based on type
  const docId =
    type === "saleOrder" || type === "purchaseOrder"
      ? entry?.order_no
      : type === "requisition" || type === "requisitionTransfer" || type === "requisitionFGTransfer" || type === "dispatchTransfer" || type === "productionPlan"
        ? entry?.tran_id
        : entry?.tran_id; // dispatch / grn / transfer / fgTransfer all use tran_id

  useEffect(() => {
    if (!isOpen || !type || !entry || !docId) return;
    setData(null);
    setLoading(true);
    axios
      .get(`/api/orders/fulfillment-progress?type=${type}&id=${docId}`)
      .then((res) => setData(res.data))
      .catch(() => toast.error("Failed to load fulfillment data"))
      .finally(() => setLoading(false));
  }, [isOpen, type, docId]);

  // Close/reopen a SO item (only for saleOrder type)
  const toggleClose = async (item) => {
    const newStatus = item.status === 2 ? 1 : 2;
    setToggling((p) => ({ ...p, [item.detailId]: true }));
    try {
      await axios.patch("/api/orders/saleOrder/close-item", {
        detail_id: item.detailId,
        status: newStatus,
      });
      setData((prev) => ({
        ...prev,
        items: prev.items.map((i) =>
          i.detailId === item.detailId ? { ...i, status: newStatus } : i
        ),
      }));
      toast.success(
        newStatus === 2
          ? `"${item.itemName}" closed — hidden from dispatch`
          : `"${item.itemName}" reopened`
      );
      onUpdated?.();
    } catch {
      toast.error("Failed to update item status");
    } finally {
      setToggling((p) => ({ ...p, [item.detailId]: false }));
    }
  };

  if (!isOpen || !entry) return null;

  // Is this a child doc (dispatch/grn/transfer)?
  const isChildDoc = type === "dispatch" || type === "grn" || type === "transfer" || type === "fgTransfer";

  const summary = data?.summary;
  const items = data?.items || [];
  const childLabel = data?.childLabel || "Fulfilled";
  const allowClose = data?.allowClose && type === "saleOrder";

  // Skeleton rows while loading
  const SkeletonRow = () => (
    <div className="flex items-start gap-4 px-6 py-4 border-b border-gray-100">
      <div className="w-2.5 h-2.5 rounded-full bg-gray-200 mt-1 flex-shrink-0" />
      <div className="flex-1 space-y-2">
        <div className="h-4 bg-gray-200 rounded w-1/2 animate-pulse" />
        <div className="h-2 bg-gray-100 rounded w-full animate-pulse" />
        <div className="h-3 bg-gray-100 rounded w-1/3 animate-pulse" />
      </div>
    </div>
  );

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-[9999] flex items-center justify-center bg-black/60 backdrop-blur-sm p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 16 }}
          transition={{ type: "spring", damping: 22, stiffness: 300 }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl flex flex-col max-h-[88vh] overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* ── Header ── */}
          <div className="px-6 pt-5 pb-4 border-b bg-gradient-to-r from-primary/5 to-transparent">
            <div className="flex items-start justify-between gap-4">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <BarChart3 className="h-5 w-5 text-primary flex-shrink-0" />
                  <h2 className="text-base font-bold text-gray-900 leading-tight">
                    {loading
                      ? "Loading…"
                      : data?.docLabel || "Fulfillment Progress"}
                  </h2>
                </div>
                {data?.parentLabel && (
                  <p className="text-xs text-gray-500 ml-7">
                    Against&nbsp;
                    <span className="font-medium text-primary">
                      {data.parentLabel}
                    </span>
                  </p>
                )}
              </div>
              <button
                onClick={onClose}
                className="text-gray-400 hover:text-gray-600 transition-colors p-1 rounded-lg hover:bg-gray-100 flex-shrink-0"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Summary pills */}
            {summary && !loading && (
              <div className="flex flex-wrap gap-2 mt-3 ml-7">
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-gray-100 text-gray-700">
                  <Scale className="h-3 w-3" />
                  Ordered&nbsp;
                  <strong>{summary.totalOrdered}</strong>
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-primary/10 text-primary">
                  <TrendingUp className="h-3 w-3" />
                  {childLabel}&nbsp;
                  <strong>{summary.totalFulfilled}</strong>
                </span>
                <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-amber-50 text-amber-700">
                  <Clock className="h-3 w-3" />
                  Remaining&nbsp;
                  <strong>{summary.totalRemaining}</strong>
                </span>
                {summary.isComplete && (
                  <span className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full bg-green-100 text-green-700">
                    <CheckCircle className="h-3 w-3" />
                    Complete
                  </span>
                )}
              </div>
            )}
          </div>

          {/* ── Column headers ── */}
          {!loading && items.length > 0 && (
            <div className="px-6 py-2 bg-gray-50 border-b grid gap-2 text-[10px] font-semibold uppercase tracking-wider text-gray-400"
              style={{ gridTemplateColumns: isChildDoc ? "1fr 100px 100px 100px" : "1fr 80px 80px 80px" + (allowClose ? " 110px" : "") }}
            >
              <span>Item</span>
              {isChildDoc && <span className="text-right">This Doc</span>}
              <span className="text-right">Ordered</span>
              <span className="text-right">{childLabel}</span>
              <span className="text-right">Remaining</span>
              {allowClose && <span />}
            </div>
          )}

          {/* ── Item rows ── */}
          <div className="flex-1 overflow-y-auto divide-y divide-gray-100">
            {loading ? (
              <>
                <SkeletonRow />
                <SkeletonRow />
                <SkeletonRow />
              </>
            ) : items.length === 0 ? (
              <div className="flex flex-col items-center justify-center h-36 gap-2 text-gray-400">
                <Package className="h-8 w-8" />
                <p className="text-sm">No items found.</p>
              </div>
            ) : (
              items.map((item, idx) => {
                const isClosed = item.status === 2;
                const pct = item.percentage ?? 0;
                const isLoading = toggling[item.detailId];
                const isOver = pct > 100;

                // per-item fulfilled qty label
                const fulfilledQty = isChildDoc
                  ? item.totalFulfilledQty
                  : item.fulfilledQty;
                const thisDocQty = item.thisDocQty;

                return (
                  <div
                    key={item.detailId ?? item.itcd ?? idx}
                    className={`px-6 py-3.5 transition-colors ${
                      isClosed
                        ? "bg-red-50/60"
                        : isOver
                          ? "bg-orange-50/40"
                          : "hover:bg-gray-50/70"
                    }`}
                  >
                    <div
                      className="grid items-center gap-2"
                      style={{
                        gridTemplateColumns: isChildDoc
                          ? "1fr 100px 100px 100px"
                          : "1fr 80px 80px 80px" + (allowClose ? " 110px" : ""),
                      }}
                    >
                      {/* Item name + code */}
                      <div className="flex items-start gap-2.5 min-w-0">
                        <StatusDot isClosed={isClosed} />
                        <div className="min-w-0">
                          <p
                            className={`text-sm font-medium leading-tight truncate ${
                              isClosed ? "line-through text-gray-400" : "text-gray-800"
                            }`}
                          >
                            {item.itemName}
                          </p>
                          <p className="text-[11px] text-gray-400 mt-0.5">
                            {item.itemCode}
                            {item.unit ? ` · ${item.unit}` : ""}
                            {item.approvedQty != null
                              ? ` · Approved: ${item.approvedQty}`
                              : ""}
                            {item.rate ? ` · Rate: ${item.rate}` : ""}
                          </p>
                          {/* progress bar */}
                          <div className="mt-1.5 flex items-center gap-2">
                            <div className="flex-1">
                              <ProgressBar pct={pct} />
                            </div>
                            <span
                              className={`text-[10px] font-bold tabular-nums ${
                                pct >= 100
                                  ? "text-green-600"
                                  : pct >= 60
                                    ? "text-primary"
                                    : pct >= 30
                                      ? "text-amber-500"
                                      : "text-red-500"
                              }`}
                            >
                              {pct}%
                            </span>
                          </div>
                        </div>
                      </div>

                      {/* This doc qty (child only) */}
                      {isChildDoc && (
                        <div className="text-right">
                          <span className="text-sm font-semibold text-primary tabular-nums">
                            {thisDocQty ?? "—"}
                          </span>
                          <p className="text-[10px] text-gray-400">this doc</p>
                        </div>
                      )}

                      {/* Ordered */}
                      <div className="text-right">
                        <span className="text-sm tabular-nums text-gray-700">
                          {item.orderedQty ?? "—"}
                        </span>
                        <p className="text-[10px] text-gray-400">ordered</p>
                      </div>

                      {/* Fulfilled */}
                      <div className="text-right">
                        <span
                          className={`text-sm font-semibold tabular-nums ${
                            isOver ? "text-orange-500" : "text-gray-800"
                          }`}
                        >
                          {fulfilledQty ?? "—"}
                        </span>
                        <p className="text-[10px] text-gray-400">{childLabel.toLowerCase()}</p>
                      </div>

                      {/* Remaining */}
                      <div className="text-right">
                        <span
                          className={`text-sm font-medium tabular-nums ${
                            item.remainingQty === 0
                              ? "text-green-600"
                              : "text-amber-600"
                          }`}
                        >
                          {item.remainingQty ?? "—"}
                        </span>
                        <p className="text-[10px] text-gray-400">left</p>
                      </div>

                      {/* Close / Reopen toggle (SO only) */}
                      {allowClose && (
                        <div className="flex justify-end">
                          <Button
                            size="sm"
                            variant="outline"
                            className={`text-[11px] h-7 px-2.5 gap-1 ${isClosed
                              ? "border-green-300 text-green-700 hover:bg-green-50"
                              : "border-red-300 text-red-600 hover:bg-red-50"
                              }`}
                            disabled={isLoading}
                            onClick={() => toggleClose(item)}
                          >
                            {isLoading ? (
                              <RefreshCw className="h-3 w-3 animate-spin" />
                            ) : isClosed ? (
                              <CheckCircle className="h-3 w-3" />
                            ) : (
                              <XCircle className="h-3 w-3" />
                            )}
                            {isLoading
                              ? "…"
                              : isClosed
                                ? "Reopen"
                                : "Close"}
                          </Button>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {/* ── Footer ── */}
          <div className="px-6 py-3.5 border-t bg-gray-50 flex items-center justify-between gap-4">
            {allowClose && (
              <p className="text-xs text-gray-400 leading-tight">
                Closing all items hides this order from dispatch.
              </p>
            )}
            {!allowClose && summary && !loading && (
              <p className="text-xs text-gray-400">
                {summary.completedItems}/{summary.totalItems} items fully{" "}
                {childLabel.toLowerCase()}
              </p>
            )}
            <Button variant="outline" onClick={onClose} size="sm" className="ml-auto">
              Done
            </Button>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
};

// Enhanced Status Badge component with warnings
const StatusBadge = ({
  status,
  details,
  warnings = [],
  variant = "default",
}) => {
  const getStatusStyle = (status, variant) => {
    const baseStyles =
      "inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium border";

    const variantStyles = {
      success: "bg-emerald-100 text-emerald-800 border-emerald-200",
      warning: "bg-amber-100 text-amber-800 border-amber-200",
      error: "bg-red-100 text-red-800 border-red-200",
      info: "bg-blue-100 text-blue-800 border-blue-200",
      default: "bg-gray-100 text-gray-800 border-gray-200",
    };

    // Auto-detect variant based on status
    let autoVariant = variant;
    if (!autoVariant) {
      if (
        status?.toLowerCase().includes("fully") ||
        status?.toLowerCase().includes("completed")
      ) {
        autoVariant = "success";
      } else if (
        status?.toLowerCase().includes("stock issues") ||
        status?.toLowerCase().includes("error")
      ) {
        autoVariant = "error";
      } else if (
        status?.toLowerCase().includes("pending") ||
        status?.toLowerCase().includes("progress")
      ) {
        autoVariant = "warning";
      } else {
        autoVariant = "info";
      }
    }

    return `${baseStyles} ${variantStyles[autoVariant] || variantStyles.default}`;
  };

  const getStatusIcon = (status) => {
    if (
      status?.toLowerCase().includes("fully") ||
      status?.toLowerCase().includes("completed")
    ) {
      return <CheckCircle className="h-3 w-3 mr-1" />;
    } else if (
      status?.toLowerCase().includes("pending") ||
      status?.toLowerCase().includes("progress")
    ) {
      return <Clock className="h-3 w-3 mr-1" />;
    } else if (
      status?.toLowerCase().includes("stock issues") ||
      status?.toLowerCase().includes("error")
    ) {
      return <AlertCircle className="h-3 w-3 mr-1" />;
    }
    return null;
  };

  return (
    <div className="flex flex-col items-start space-y-1">
      <span className={getStatusStyle(status, variant)}>
        {getStatusIcon(status)}
        {status}
      </span>
      {details && <span className="text-xs text-gray-500">{details}</span>}
      {warnings.length > 0 && (
        <div className="text-xs text-red-500 max-w-xs">
          {warnings.map((warning, index) => (
            <div key={index}>• {warning}</div>
          ))}
        </div>
      )}
    </div>
  );
};

// DataViewModal component
const DataViewModal = ({ data, type, isOpen, onClose, allData = [], currentIndex = 0, onNavigate, actions = null }) => {
  const [isExporting, setIsExporting] = useState(false);
  const [exportType, setExportType] = useState("");

  const hasPrev = currentIndex > 0;
  const hasNext = currentIndex < allData.length - 1;

  const goTo = (newIdx) => {
    if (newIdx >= 0 && newIdx < allData.length) {
      onNavigate?.(newIdx);
    }
  };

  // Keyboard nav: left/right arrows
  useEffect(() => {
    if (!isOpen) return;
    const handler = (e) => {
      if (e.key === "ArrowLeft" && hasPrev) goTo(currentIndex - 1);
      if (e.key === "ArrowRight" && hasNext) goTo(currentIndex + 1);
      if (e.key === "Escape") onClose?.();
      // E = edit, Alt+P = print — the same actions as the footer buttons.
      if (e.ctrlKey || e.metaKey) return;
      if (!e.altKey && (e.key === "e" || e.key === "E") && actions?.edit && !actions.edit.disabled) {
        e.preventDefault();
        actions.edit.run();
      }
      if (e.altKey && (e.key === "p" || e.key === "P") && actions?.print && !actions.print.disabled) {
        e.preventDefault();
        actions.print.run();
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [isOpen, hasPrev, hasNext, currentIndex, actions]);

  const { currency } = useCurrency();
  const { company } = useCompany();
  // The sales-tax invoice export below passes the session to the PDF builder;
  // it was referenced here without ever being read, so that export threw.
  const { data: session } = useSession();
  //console.log("company: ", company)


  const callType = VOUCHER_CONFIG[type].sourceMapping?.type;

  const isReqType =
    ["dispatchTransfer", "productionPlan"].includes(
      callType || type,
    ) || !!data?.req_catagory;

  // Get config based on transaction type
  const config = VOUCHER_CONFIG[callType || type] || {};
  const hasDeductionBlock = config.hasDeductionBlock || false;
  const totalsConfig = config.totals || {};
  // GRN / GRN Return / Dispatch / Dispatch Return are quantity only: money
  // columns appear once the document is invoiced (read-only, as posted).
  const qtyOnlyDoc = !!(VOUCHER_CONFIG[type]?.qtyOnly || config.qtyOnly);
  const docInvoiced = qtyOnlyDoc && isInvoicedDoc(data);
  const hideMoney = qtyOnlyDoc && !docInvoiced;

  // Dynamic data extraction based on config
  const transactions = useMemo(() => {
    if (!data) return [];
    if (
      ["purchaseOrder", "saleOrder", "serviceOrder", "saleOrderView"].includes(callType || type)
    ) {
      return data.orderDetails || [];
    }
    if (["requisition", "requisitionTransfer", "requisitionFGTransfer", "dispatchTransfer", "productionPlan","letterOfCredit"].includes(callType || type)) {
      return data.details || [];
    }
    return data.transactions?.filter((t) => t.sub_tran_id !== 3) || [];
  }, [data, type]);

  const deductions = useMemo(() => {
    if (!data || !hasDeductionBlock) return [];
    return data.transactions?.filter((t) => t.sub_tran_id === 2) || [];
  }, [data, hasDeductionBlock]);

  // Dynamic totals calculation
  const calculatedTotals = useMemo(() => {
    if (!data) return {};
    const results = {};
    Object.entries(totalsConfig).forEach(([key, total]) => {
      if (key === "netTotal") {
        results[key] = Number(
          total.calculate(transactions, results).toString().replace(/,/g, ""),
        );
      } else if (key === "debitTotal" || key === "creditTotal") {
        results[key] = parseFloat(total.calculate(transactions)).toFixed(2);
      } else {
        results[key] = parseFloat(total.calculate(transactions)).toFixed(2);
      }
    });
    return results;
  }, [data, transactions, totalsConfig]);

  // Invoiced quantity-only document: amount / sales tax / total as posted.
  const invoicedTotals = useMemo(() => {
    if (!docInvoiced) return null;
    return (data?.transactions || [])
      .filter((t) => (t.sub_tran_id ?? 1) === 1)
      .reduce(
        (acc, t) => {
          const m = lineMoney(t);
          return { amount: acc.amount + m.amount, tax: acc.tax + m.tax, total: acc.total + m.total };
        },
        { amount: 0, tax: 0, total: 0 },
      );
  }, [data, docInvoiced]);

  // Account-type master fields other than the party (e.g. a transporter in
  // rmk2) store an account NUMBER — look its name up for display.
  const [accountNames, setAccountNames] = useState({});
  useEffect(() => {
    if (!isOpen || !data) return;
    const ids = [
      ...new Set(
        (config.masterFields || [])
          .filter(
            (f) =>
              f.type === "select" &&
              f.options === "accounts" &&
              !["pycd", "acno", "party_code"].includes(f.name),
          )
          .map((f) => data[f.name])
          .filter((v) => v != null && /^\d+$/.test(String(v)))
          .map(String),
      ),
    ];
    if (!ids.length) return;
    let cancelled = false;
    Promise.all(
      ids.map((id) =>
        axios
          .get(`/api/accounts/acno?acno=${encodeURIComponent(id)}`)
          .then((r) => {
            const d = r.data?.data ?? r.data;
            const row = Array.isArray(d) ? d[0] : d;
            return [id, row?.acname || null];
          })
          .catch(() => [id, null]),
      ),
    ).then((pairs) => {
      if (!cancelled) setAccountNames((prev) => ({ ...prev, ...Object.fromEntries(pairs) }));
    });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, data, type]);

  // Service Invoices (freight, off-loading, weighing …) billed against this
  // GRN / dispatch: tran_code 21 vouchers whose header names its number.
  const serviceRef =
    Number(data?.tran_code) === 4 && data?.grn_no != null
      ? { field: "grn_no", no: Number(data.grn_no), label: "GRN" }
      : Number(data?.tran_code) === 6 && data?.dispatch_no != null
        ? { field: "dispatch_no", no: Number(data.dispatch_no), label: "dispatch" }
        : null;
  const [linkedServices, setLinkedServices] = useState({ loading: false, rows: [], error: "" });
  useEffect(() => {
    if (!isOpen || !serviceRef || type === "serviceInvoice") {
      setLinkedServices({ loading: false, rows: [], error: "" });
      return;
    }
    let cancelled = false;
    setLinkedServices({ loading: true, rows: [], error: "" });
    axios
      .get("/api/voucher/serviceInvoice", {
        params: {
          limit: 100,
          multiFilters: JSON.stringify({ [serviceRef.field]: [serviceRef.no] }),
        },
      })
      .then((res) => {
        if (!cancelled) setLinkedServices({ loading: false, rows: res.data?.data || [], error: "" });
      })
      .catch((err) => {
        if (cancelled) return;
        setLinkedServices({
          loading: false,
          rows: [],
          error:
            err?.response?.status === 403
              ? "You do not have access to Service Invoices."
              : "Could not load service invoices.",
        });
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isOpen, serviceRef?.field, serviceRef?.no, type]);

  // Early return after all hooks
  // View A tabs: Items · Deductions · Services · Remarks — the same content
  // the modal always showed, one section at a time. Back to Items on every
  // record (← / → moves between records).
  const [viewTab, setViewTab] = useState("items");
  useEffect(() => {
    setViewTab("items");
  }, [data?.tran_id, data?.id, data?.order_no]);

  // History tab: the document's audit trail (GET /api/audit, audit.view) —
  // header and line changes, one entry per save. Loaded when the tab opens.
  const historyRef = !data
    ? null
    : ["purchaseOrder", "saleOrder", "serviceOrder", "saleOrderView"].includes(callType || type) ||
        (data.order_no && !data.tran_id)
      ? { model: "OrderMaster", id: data.order_no }
      : ["requisition", "requisitionTransfer", "requisitionFGTransfer", "dispatchTransfer", "productionPlan"].includes(
            callType || type,
          ) || data.req_catagory
        ? { model: "ReqMaster", id: data.tran_id }
        : { model: "TransactionsMaster", id: data.tran_id };
  const [history, setHistory] = useState({ key: null, loading: false, rows: [], error: null });
  const historyKey = historyRef?.id != null ? `${historyRef.model}:${historyRef.id}` : null;
  useEffect(() => {
    if (!isOpen || viewTab !== "history" || !historyKey || history.key === historyKey) return;
    let cancelled = false;
    setHistory({ key: historyKey, loading: true, rows: [], error: null });
    axios
      .get("/api/audit", { params: { doc_model: historyRef.model, doc_id: String(historyRef.id), size: 200 } })
      .then((res) => !cancelled && setHistory({ key: historyKey, loading: false, rows: res.data?.rows || [], error: null }))
      .catch((err) => {
        if (cancelled) return;
        const status = err?.response?.status;
        setHistory({
          key: historyKey,
          loading: false,
          rows: [],
          error: status === 401 || status === 403 ? "You don't have access to the audit trail." : "Could not load the history.",
        });
      });
    return () => {
      cancelled = true;
    };
  }, [isOpen, viewTab, historyKey]);

  if (!isOpen || !data) return null;

  const masterFields = config.masterFields || [];
  const lineFields = config.lineFields || [];
  const deductionFields = config.deductionFields || [];
  const tranCode = config.tran_code || data.tran_code || data.order_catagory;
  // Service Invoice: `config` above is the Service ENTRY's (its sourceMapping
  // type), so the generic body would show goods columns — it has its own.
  const isServiceInvoice = type === "serviceInvoice" || Number(data.tran_code) === 21;

  // Audit rows → one entry per save (batch): who, when, the header fields that
  // changed (old → new) and how many lines were added / changed / removed.
  const fieldLabel = (name) =>
    [...masterFields, ...lineFields].find((f) => f.name === name)?.label ||
    String(name).replace(/_/g, " ");
  const auditValue = (v) => {
    if (v == null || v === "") return "—";
    if (typeof v === "string" && /^\d{4}-\d{2}-\d{2}T/.test(v)) return formatDateTime12Hr(v);
    if (typeof v === "object") return JSON.stringify(v).slice(0, 60);
    return String(v);
  };
  const historyEvents = (rows) => {
    const groups = new Map();
    for (const r of rows) {
      const key = r.batch_id || `${String(r.dated).slice(0, 16)}|${r.user_id || ""}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(r);
    }
    return [...groups.entries()].map(([key, rs]) => {
      const head = rs.filter((r) => r.model_name === historyRef.model);
      const lines = rs.filter((r) => r.model_name !== historyRef.model);
      const action = head.some((r) => r.action === "create")
        ? "create"
        : head.some((r) => r.action === "delete")
          ? "delete"
          : "update";
      const fields = head
        .filter((r) => r.action === "update")
        .flatMap((r) => (Array.isArray(r.changes) ? r.changes : []))
        .map((c) => ({ label: fieldLabel(c.field), old: auditValue(c.old), new: auditValue(c.new) }));
      const n = (a) => lines.filter((r) => r.action === a).length;
      const lineSummary = [
        n("create") && `${n("create")} line${n("create") === 1 ? "" : "s"} ${action === "create" ? "" : "added"}`.trim(),
        n("update") && `${n("update")} line${n("update") === 1 ? "" : "s"} changed`,
        n("delete") && `${n("delete")} line${n("delete") === 1 ? "" : "s"} removed`,
      ]
        .filter(Boolean)
        .join(", ");
      return {
        key,
        action,
        user: rs[0].user_name || (rs[0].source === "system" ? "System" : "—"),
        dated: rs[0].dated,
        fields,
        lineSummary,
      };
    });
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    return new Date(dateString).toLocaleDateString("en-US", {
      year: "numeric",
      month: "long",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      hour12: true,
    });
  };

  const formatDateOnly = (dateString) => {
    return formatDateTime12Hr(dateString, ["saleOrder", "saleOrderView"].includes(callType || type));
  };

  const formatCurrency = (amount) => {
    return new Intl.NumberFormat("en-US", {
      style: "currency",
      currency: currency?.code || "-",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2, // ✅ add this
    }).format(amount || 0);
  };

  const prepareVoucherForPDF = (voucher, documentType = "sales") => {
    const customer = {
      name: voucher.acno?.acname || "Unknown",
      strn: "Not Available",
      ntn: "Not Available",
      address: voucher.godownDetails?.godown || "Not Provided",
    };

    const entries = voucher.transactions
      .filter((t) => t.sub_tran_id !== 3)
      .map((t, idx) => {
        const itemName =
          t.itemDetails?.item || t.acnoDetails?.acname || "Unknown";
        const batchNo = t.batch_no || t.chno || "-";
        const qty = t.qty ?? 0;
        const unit =
          config.tran_code === 1 || config.tran_code === 2 ? "" : "KG";
        const rate = t.rate ?? (t.damt || t.camt || 0);
        const amount =
          config.tran_code === 1 || config.tran_code === 2
            ? t.damt || t.camt || 0
            : (t.qty ?? 0) * (t.rate ?? 0);

        if (documentType === "delivery") {
          return [
            idx + 1,
            itemName,
            batchNo,
            `${t.no_of_pack}x${t.qty_per_pack}=${qty}`,
          ];
        }

        return [idx + 1, itemName, batchNo, qty, unit, rate, amount];
      });

    const totalAmount = entries.reduce(
      (acc, row) => acc + (row.at(-1) || 0),
      0,
    );

    const totalSalesTax = voucher.transactions
      .filter((t) => t.sub_tran_id !== 3)
      .reduce((acc, t) => {
        const amount =
          config.tran_code === 1 || config.tran_code === 2
            ? t.damt || t.camt || 0
            : (t.qty ?? 0) * (t.rate ?? 0);
        const taxRate = (t.st_rate ?? 0) + (t.additional_tax ?? 0);
        return acc + amount * (taxRate / 100);
      }, 0);

    const grandTotal = totalAmount + totalSalesTax;

    const totals = {
      amount: totalAmount,
      tax: { label: "SALES TAX", value: totalSalesTax },
      grandTotal: { label: "GRAND TOTAL", value: grandTotal },
    };

    const invoice = {
      number: voucher.invoice_no || `INV-${voucher.vr_no}`,
      date: voucher.dated
        ? new Date(voucher.dated).toLocaleDateString("en-GB")
        : new Date().toLocaleDateString("en-GB"),
      po: "-",
      dueDate: "30 Days",
    };

    return {
      dated: voucher.dated,
      tran_code: voucher.tran_code,
      vr_no: voucher.vr_no,
      userId: voucher.userId,
      rmk: voucher.rmk,
      rmk1: voucher.rmk1,
      transactions: voucher.transactions,
      acno: voucher.acno,
      documentType,
      customer,
      entries,
      totals,
      invoice,
    };
  };

  const handleOnExport = async (type) => {
    setIsExporting(true);
    setExportType(type);

    try {
      const res = await axios.get(`/api/voucher/getById?id=${data.tran_id}`);
      const resData = res.data.data;

      // ✅ Only Sales Tax PDF (tran_code = 6)
      // if (resData.tran_code === 6) {
      //   const doc = generateDispatchNotePDF(resData, company, currency); // <-- pass full data
      //   doc.save(`sales_tax_invoice.pdf`);
      //   return;
      // }
      if (resData.tran_code === 6 && type !== "commercialInvoice") {
        await generateSalesTaxInvoicePDF({
          voucher: resData,
          session,
          currencyData: currency,
          companyData: company,
          mode: "print"
        });
        return;
      }

      if (type === "commercialInvoice") {
        const pdfDoc = await generateCommercialInvoicePDF(resData, session, currency, company);
        pdfDoc.save(`${companyShortName(company?.name)}_COMMERCIAL_INVOICE_${resData.vr_no}.pdf`);
        return;
      }

      // ✅ All other PDFs remain same
      const mapped = prepareVoucherForPDF(resData, type);
      const doc = generateUnifiedPDF(mapped, company);
      doc.save(`${type}_invoice.pdf`);
    } catch (error) {
      console.error("Export failed:", error);
    } finally {
      setIsExporting(false);
      setExportType("");
    }
  };

  // Dynamic transaction type label
  const getTransactionTypeLabel = () => {
    switch (callType || type) {
      case "payment":
        return "Payment";
      case "receipt":
        return "Receipt";
      case "journal":
        return "Journal";
      case "purchase":
        return "Purchase";
      case "sale":
        return "Sale";
      case "purchaseReturn":
        return "Purchase Return";
      case "grnReturn":
        return "GRN Return";
      case "saleReturn":
      case "dispatchReturn":
        return "Dispatch Return";
      case "transfer":
        return "Transfer";
      case "purchaseOrder":
        return "Purchase Order";
      case "saleOrder":
        return "Sale Order";
      case "saleOrderView":
        return "Sale Order";
      case "grn":
      case "grnEdit":
        return "Goods Received Note";
      case "dispatchEdit":
        return "Dispatch";
      case "requisition":
        return "Requisition";
      case "dispatch":
        return "Dispatch";
      default:
        return "Transaction";
    }
  };

  // Dynamic line item display name
  const getLineItemName = (transaction) => {
    if (
      ["payment", "receipt", "journal"].includes(
        type,
      )
    ) {
      return (
        transaction.acnoDetails?.acname ||
        transaction.acname ||
        "Unknown Account"
      );
    }
    if (
      ["purchaseOrder", "saleOrder", "serviceOrder", "saleOrderView"].includes(callType || type)
    ) {
      return `${transaction.items?.code} - ${transaction.items?.item}` || "Unknown Item";
    }
    if (["requisition", "requisitionTransfer", "requisitionFGTransfer", "dispatchTransfer", "productionPlan","letterOfCredit"].includes(callType || type)) {
      return ` ${transaction.item?.item}` || "Unknown Item";
    }
    return `${transaction.itemDetails?.code} - ${transaction.itemDetails?.item}` || "Unknown Item";
  };

  // Dynamic amount calculation for line item
  const getLineItemAmount = (transaction) => {
    if (["payment"].includes(type)) {
      return transaction.damt || 0;
    }
    if (["receipt"].includes(type)) {
      return transaction.camt || 0;
    }
    if (type === "journal") {
      return { debit: transaction.damt || 0, credit: transaction.camt || 0 };
    }
    if (["dispatch", "requisition", "requisitionTransfer", "requisitionFGTransfer", "dispatchTransfer", "productionPlan"].includes(callType || type)) {
      return transaction.qty || 0;
    }
    if (
      ["purchaseOrder", "saleOrder", "serviceOrder"].includes(callType || type)
    ) {
      return (
        transaction.amount || (transaction.qty || 0) * (transaction.rate || 0)
      );
    }
    if (callType || type === "saleOrderView") {
      return transaction.qty || 0;
    }
    // A LTR line is priced on its litres (dispatch lines carry no amount
    // until they are invoiced, so it is rebuilt from qty × rate).
    const pricedQty =
      String(transaction.unit?.value ?? transaction.unit ?? "").toUpperCase() === "LTR"
        ? Number(transaction.qty_ltr) || 0
        : Number(transaction.qty) || 0;
    return (
      transaction.damt ||
      transaction.camt ||
      pricedQty * (transaction.rate || 0)
    );
  };

  // Dynamic unit/quantity check
  const isInventoryType = [
    "purchase",
    "sale",
    "purchaseReturn",
    "saleReturn",
    "transfer",
    "purchaseOrder",
    "saleOrder",
    "saleOrderView",
    "grn",
    "grnEdit",
    "grnReturn",
    "dispatch",
    "dispatchEdit",
    "dispatchReturn",
    "requisition",
    "requisitionTransfer",
    "requisitionFGTransfer",
    "dispatchTransfer",
    "productionPlan",
    "fgTransfer",
    "materialIssue",
    "materialInput",
    "letterOfCredit",
    "inBond"

  ].includes(callType || type);

  // Enhanced Transaction Grid View
  const TransactionGrid = ({ items }) => (
    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6">
      {items.map((item, index) => {
        const amount = getLineItemAmount(item);
        return (
          <motion.div
            key={index}
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: index * 0.05 }}
            className="bg-primary/20 rounded-xl p-6 border shadow-lg transition-all duration-300 group"
          >
            <div className="flex items-start justify-between mb-4">
              <div className="flex items-center space-x-3 flex-1 min-w-0">
                <div className="w-10 h-10 bg-primary rounded-full flex items-center justify-center flex-shrink-0 shadow-sm">
                  <span className="text-sm font-bold text-white">
                    {index + 1}
                  </span>
                </div>
                <div className="flex-1 min-w-0">
                  <h4 className="font-semibold text-gray-900 text-primary mb-1  transition-colors">
                    {getLineItemName(item)}
                  </h4>
                  {(item.batch_no || item.chno) && (
                    <div className="flex items-center space-x-1">
                      <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                        Batch: {item.batch_no || item.chno}
                      </span>
                    </div>
                  )}
                  {["payment", "receipt"].includes(callType || type) &&
                    String(item.narration5 ?? "").trim() !== "" && (
                      <div className="mt-1 flex items-center space-x-1">
                        <span className="text-xs bg-gray-100 text-gray-600 px-2 py-1 rounded-full">
                          Slip #: {String(item.narration5).trim()}
                        </span>
                      </div>
                    )}
                </div>
              </div>
            </div>

            <div className="mb-4">
              {type === "journal" ? (
                <div className="space-y-2">
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-black">Debit</span>
                    <span className="text-lg font-bold text-emerald-600">
                      {formatCurrency(amount.debit)}
                    </span>
                  </div>
                  <div className="flex justify-between items-center">
                    <span className="text-sm text-black">Credit</span>
                    <span className="text-lg font-bold text-red-600">
                      {formatCurrency(amount.credit)}
                    </span>
                  </div>
                </div>
              ) : (
                <div className="text-right">
                  <div className="text-sm text-primary mb-1">
                    {["dispatch", "requisition", "requisitionTransfer", "requisitionFGTransfer", "dispatchTransfer", "productionPlan", "saleOrderView"].includes(
                      callType || type,
                    )
                      ? "Total Qty"
                      : "Amount"}
                  </div>
                  <div className="text-2xl font-bold text-black">
                    {isInventoryType &&
                      !["dispatch", "requisition", "requisitionTransfer", "requisitionFGTransfer", "dispatchTransfer", "productionPlan", "saleOrderView"].includes(
                        callType || type,
                      )
                      ? formatCurrency(amount)
                      : amount}
                    {["dispatch", "requisition", "requisitionTransfer", "requisitionFGTransfer", "dispatchTransfer", "productionPlan"].includes(type) && (
                      <span className="text-sm text-gray-500 ml-1">KG</span>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="grid grid-cols-2 gap-4">
              {isInventoryType && (
                <div className="bg-gradient-to-r from-blue-50 to-cyan-50 rounded-lg p-3">
                  <div className="text-xs text-gray-600 mb-1 font-medium">
                    Quantity
                  </div>
                  <div className="text-sm font-semibold text-gray-900 break-words">
                    {item.no_of_pack || item.no_of_packs || 0} ×{" "}
                    {item.qty_per_pack || 0} = {item.qty || 0}
                    <span className="text-xs text-gray-600 ml-1">
                      {item.unit || "KG"}
                    </span>
                  </div>
                </div>
              )}
              {![
                "dispatch",
                "payment",
                "receipt",
                "journal",
                "requisition",
                "requisitionTransfer",
                "requisitionFGTransfer",
                "dispatchTransfer",
                "productionPlan",
                "saleOrderView",
                "transfer",
              ].includes(callType || type) && (
                  <div className="bg-gradient-to-r from-green-50 to-emerald-50 rounded-lg p-3">
                    <div className="text-xs text-gray-600 mb-1 font-medium">
                      Rate
                    </div>
                    <div className="text-sm font-semibold text-gray-900 break-words">
                      {formatCurrency(item.rate || 0)}
                    </div>
                  </div>
                )}
            </div>

            {(item.st_rate || item.additional_tax) &&
              !["dispatch", "requisition", "saleOrderView", "requisitionTransfer", "requisitionFGTransfer", "dispatchTransfer", "productionPlan"].includes(type) && (
                <div className="mt-4 bg-gradient-to-r from-amber-50 to-orange-50 rounded-lg p-3">
                  <div className="text-xs text-gray-600 mb-2 font-medium">
                    Tax Details
                  </div>
                  <div className="flex flex-wrap gap-2">
                    {item.st_rate && (
                      <span className="text-xs bg-amber-200 text-amber-800 px-2 py-1 rounded-full font-medium">
                        ST: {item.st_rate}%
                      </span>
                    )}
                    {item.additional_tax && (
                      <span className="text-xs bg-orange-200 text-orange-800 px-2 py-1 rounded-full font-medium">
                        Add Tax: {item.additional_tax}%
                      </span>
                    )}
                  </div>
                </div>
              )}
          </motion.div>
        );
      })}
    </div>
  );

  // Line table (View A): code chip + name, numbers right-aligned, a total
  // row; under md each line is a card (table.vv-grid in app/globals.css).
  const isAccountLines = ["journal", "payment", "receipt"].includes(callType || type);
  const showRate =
    ![
      "dispatch", "payment", "receipt", "journal", "requisition", "requisitionTransfer",
      "requisitionFGTransfer", "dispatchTransfer", "productionPlan", "saleOrderView",
      "materialIssue", "materialInput", "letterOfCredit", "inBond",
    ].includes(callType || type) && !hideMoney;
  const showAmount =
    ![
      "journal", "dispatch", "saleOrderView", "requisition", "requisitionTransfer",
      "requisitionFGTransfer", "dispatchTransfer", "productionPlan", "materialIssue",
      "materialInput", "letterOfCredit", "inBond",
    ].includes(callType || type) && !hideMoney;
  const showTaxes =
    (docInvoiced ||
      lineFields.some((f) => f.name === "st_rate") ||
      lineFields.some((f) => f.name === "additional_tax")) &&
    ![
      "dispatch", "requisition", "saleOrderView", "requisitionTransfer",
      "requisitionFGTransfer", "dispatchTransfer", "productionPlan",
    ].includes(callType || type);

  const lineCode = (item) => {
    if (isAccountLines) {
      const a = item.acnoDetails?.acno ?? item.acno;
      return typeof a === "number" || typeof a === "string" ? a : null;
    }
    return item?.items?.code || item?.item?.code || item?.itemDetails?.code || item?.code || null;
  };
  const lineName = (item) => {
    if (isAccountLines) return getLineItemName(item);
    return (
      item?.items?.item ||
      item?.item?.item ||
      item?.itemDetails?.item ||
      (typeof item?.item === "string" ? item.item : null) ||
      getLineItemName(item)
    );
  };
  const lineQty = (item) =>
    Number(String(item.unit || "").toUpperCase() === "LTR" ? item.qty_ltr : item.qty) || 0;
  const lineUnit = (item) => item.unit?.label || item.unit?.value || item.unit || "KG";
  const fmtQty = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 3 });

  const TransactionList = ({ items }) => {
    const units = [...new Set(items.map((i) => String(lineUnit(i))))];
    const totals = items.reduce(
      (t, item) => {
        const amount = getLineItemAmount(item);
        t.qty += lineQty(item);
        t.packs += Number(item.no_of_pack || item.no_of_packs) || 0;
        if (type === "journal") {
          t.debit += Number(amount.debit) || 0;
          t.credit += Number(amount.credit) || 0;
        } else t.amount += Number(amount) || 0;
        return t;
      },
      { qty: 0, packs: 0, amount: 0, debit: 0, credit: 0 },
    );
    const showPacks = isInventoryType && items.some((i) => Number(i.no_of_pack || i.no_of_packs) > 0);
    // Receipt / payment "Slip #" (Transactions.narration5).
    const showSlip =
      ["payment", "receipt"].includes(callType || type) &&
      items.some((i) => String(i.narration5 ?? "").trim() !== "");
    const th ="px-2.5 py-2 text-left text-[11.5px] font-bold uppercase tracking-wider text-primary-foreground";
    const td = "px-2.5 py-2.5 align-top";
    const num = "text-right tabular-nums";

    return (
      <div className="vv-wrap overflow-x-auto rounded-xl border border-border">
        <table className="vv-grid w-full border-collapse text-sm">
          <thead className="bg-primary">
            <tr className="border-b border-border">
              <th className={`${th} w-10`}>#</th>
              {isReqType && (
                <>
                  <th className={th}>SO No</th>
                  <th className={th}>Customer</th>
                </>
              )}
              <th className={`${th} min-w-[220px]`}>{isAccountLines ? "Account" : isReqType ? "Ink" : "Item"}</th>
              {showPacks && <th className={`${th} text-right`}>Packs</th>}
              {showPacks && <th className={`${th} text-right`}>Qty / pack</th>}
              {isInventoryType && <th className={`${th} text-right`}>Qty</th>}
              {showRate && <th className={`${th} text-right`}>Rate</th>}
              {type === "journal" && (
                <>
                  <th className={`${th} text-right`}>Debit</th>
                  <th className={`${th} text-right`}>Credit</th>
                </>
              )}
              {showSlip && <th className={th}>Slip #</th>}
              {showAmount && <th className={`${th} text-right`}>Amount</th>}
              {showTaxes && <th className={th}>Taxes</th>}
            </tr>
          </thead>
          <tbody>
            {items.map((item, index) => {
              const amount = getLineItemAmount(item);
              const code = lineCode(item);
              const packs = item.no_of_pack || item.no_of_packs;
              return (
                <tr key={index} className="border-b border-border/60 last:border-b-0">
                  <td className={`${td} vv-index text-muted-foreground tabular-nums`}>{index + 1}</td>
                  {isReqType && (
                    <>
                      <td className={td} data-label="SO No">{item?.so_no || data?.so_no || "-"}</td>
                      <td className={td} data-label="Customer">{item?.acname || data?.acname || "-"}</td>
                    </>
                  )}
                  <td className={`${td} vv-name`}>
                    <div className="font-medium text-foreground">
                      {code != null && code !== "" && (
                        <span className="mr-1.5 rounded-[5px] bg-primary/10 px-1.5 py-0.5 text-xs font-semibold tabular-nums text-primary">
                          {code}
                        </span>
                      )}
                      {lineName(item)}
                    </div>
                    {(item.batch_no || item.chno) && (
                      <div className="mt-0.5 text-xs text-muted-foreground">Batch {item.batch_no || item.chno}</div>
                    )}
                    {item.narration && (
                      <div className="mt-0.5 text-xs text-muted-foreground">{item.narration}</div>
                    )}
                  </td>
                  {showPacks && <td className={`${td} ${num}`} data-label="Packs">{packs ? fmtQty(packs) : "—"}</td>}
                  {showPacks && (
                    <td className={`${td} ${num}`} data-label="Qty / pack">{item.qty_per_pack ? fmtQty(item.qty_per_pack) : "—"}</td>
                  )}
                  {isInventoryType && (
                    <td className={`${td} ${num} font-semibold`} data-label="Qty">
                      {fmtQty(lineQty(item))} <span className="text-xs font-normal text-muted-foreground">{lineUnit(item)}</span>
                    </td>
                  )}
                  {showRate && <td className={`${td} ${num}`} data-label="Rate">{formatCurrency(item.rate || 0)}</td>}
                  {type === "journal" && (
                    <>
                      <td className={`${td} ${num}`} data-label="Debit">{Number(amount.debit) ? formatCurrency(amount.debit) : "—"}</td>
                      <td className={`${td} ${num}`} data-label="Credit">{Number(amount.credit) ? formatCurrency(amount.credit) : "—"}</td>
                    </>
                  )}
                  {showSlip && (
                    <td className={td} data-label="Slip #">{String(item.narration5 ?? "").trim() || "—"}</td>
                  )}
                  {showAmount && (
                    <td className={`${td} ${num} font-semibold`} data-label="Amount">{formatCurrency(amount)}</td>
                  )}
                  {showTaxes && (
                    <td className={td} data-label="Taxes">
                      {item.st_rate || item.additional_tax ? (
                        <span className="text-xs text-muted-foreground">
                          {item.st_rate ? `ST ${item.st_rate}%` : ""}
                          {item.st_rate && item.additional_tax ? " · " : ""}
                          {item.additional_tax ? `Add ${item.additional_tax}%` : ""}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
          {items.length > 1 && (
            <tfoot className="bg-primary/5 font-bold text-primary">
              <tr className="border-t border-border">
                <td className={`${td} vv-index`} />
                {isReqType && (
                  <>
                    <td className={`${td} vv-empty`} />
                    <td className={`${td} vv-empty`} />
                  </>
                )}
                <td className={`${td} vv-name`}>Total</td>
                {showPacks && <td className={`${td} ${num}`} data-label="Packs">{fmtQty(totals.packs)}</td>}
                {showPacks && <td className={`${td} vv-empty`} />}
                {isInventoryType && (
                  <td className={`${td} ${num}`} data-label="Qty">
                    {fmtQty(totals.qty)}
                    {units.length === 1 && <span className="ml-1 text-xs font-normal text-muted-foreground">{units[0]}</span>}
                  </td>
                )}
                {showRate && <td className={`${td} vv-empty`} />}
                {type === "journal" && (
                  <>
                    <td className={`${td} ${num}`} data-label="Debit">{formatCurrency(totals.debit)}</td>
                    <td className={`${td} ${num}`} data-label="Credit">{formatCurrency(totals.credit)}</td>
                  </>
                )}
                {showSlip && <td className={`${td} vv-empty`} />}
                {showAmount && <td className={`${td} ${num}`} data-label="Amount">{formatCurrency(totals.amount)}</td>}
                {showTaxes && <td className={`${td} vv-empty`} />}
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    );
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-0 backdrop-blur-sm sm:p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: 8 }}
          transition={{ duration: 0.15 }}
          className="flex h-full w-full max-w-6xl flex-col overflow-hidden bg-background shadow-2xl sm:h-auto sm:max-h-[94vh] sm:rounded-2xl"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header: title + invoicing status, previous / next, close */}
          <div className="flex items-start justify-between gap-3 border-b border-border px-4 py-3 sm:px-6 sm:py-4">
            <div className="flex min-w-0 flex-1 items-start gap-3">
              <div className="hidden h-11 w-11 flex-shrink-0 sm:flex items-center justify-center rounded-xl bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20">
                <FileText className="h-5 w-5" />
              </div>
              <div className="min-w-0">
                <h2 className="flex flex-wrap items-center gap-2 text-lg font-bold leading-tight text-foreground sm:text-xl">
                  {isServiceInvoice ? "Service Invoice" : getTransactionTypeLabel()} #{data.vr_no || data.order_no || data.tran_id}
                  {qtyOnlyDoc &&
                    (docInvoiced ? (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#edf2ee] px-2.5 py-0.5 text-xs font-semibold text-[#2f5139] dark:bg-emerald-500/10 dark:text-emerald-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        Invoiced · {docInvoiceRef(data)}
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 rounded-full bg-[#f5f0e6] px-2.5 py-0.5 text-xs font-semibold text-[#5f4b1f] dark:bg-amber-500/10 dark:text-amber-400">
                        <span className="h-1.5 w-1.5 rounded-full bg-current" />
                        Not invoiced
                      </span>
                    ))}
                </h2>
                <p className="mt-1 flex flex-wrap items-center gap-x-2 text-[13px] text-muted-foreground">
                  <span>{formatDateOnly(data.dated)}</span>
                  {data.acno?.acname && (
                    <span>
                      · {data.acno?.acno != null && <span className="tabular-nums">{data.acno.acno} · </span>}
                      {data.acno.acname}
                    </span>
                  )}
                  <span>· ID {data.tran_id || data.id}</span>
                </p>
                {"entered_by" in data && (() => {
                  // Last edit — only when the History tab has already loaded it.
                  const lastEdit =
                    history.key === historyKey && !history.loading && !history.error
                      ? historyEvents(history.rows).find((e) => e.action === "update")
                      : null;
                  return (
                    <p className="mt-0.5 flex flex-wrap items-center gap-x-1.5 text-xs text-muted-foreground">
                      <span>
                        Entered by <span className="font-semibold text-foreground">{data.entered_by || "—"}</span>
                      </span>
                      {data.created_at && <span>· {formatDateTime12Hr(data.created_at, true)}</span>}
                      {lastEdit && (
                        <span>
                          · Edited by <span className="font-semibold text-foreground">{lastEdit.user}</span>
                          {lastEdit.dated && <> · {formatDateTime12Hr(lastEdit.dated, true)}</>}
                        </span>
                      )}
                    </p>
                  );
                })()}
              </div>
            </div>

            <div className="flex flex-shrink-0 items-center gap-1 sm:gap-1.5">
              <button
                type="button"
                onClick={() => goTo(currentIndex - 1)}
                disabled={!hasPrev}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                title="Previous record (←)"
                aria-label="Previous record"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              {allData.length > 1 && (
                <span className="px-1 text-xs font-medium tabular-nums text-muted-foreground">
                  {currentIndex + 1}<span className="hidden sm:inline"> of {allData.length}</span>
                </span>
              )}
              <button
                type="button"
                onClick={() => goTo(currentIndex + 1)}
                disabled={!hasNext}
                className="flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground hover:bg-muted disabled:cursor-not-allowed disabled:opacity-40"
                title="Next record (→)"
                aria-label="Next record"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={onClose}
                className="ml-1.5 flex h-9 w-9 items-center justify-center rounded-lg border border-border text-foreground hover:bg-muted"
                title="Close (Esc)"
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto bg-background">
            {isServiceInvoice ? (
              <ServiceInvoiceView data={data} />
            ) : (
            <>
            {/* ── Key figures ── */}
            {(Object.keys(calculatedTotals).length > 0 || isInventoryType || invoicedTotals) && (
              <div className="grid grid-cols-2 border-b border-border sm:grid-cols-3 lg:grid-cols-6">
                {Object.entries(calculatedTotals)
                  .filter(([key]) => key !== "deductionTotal")
                  .map(([key, value]) => (
                    <div key={key} className="min-w-0 border-b border-r border-border/70 px-4 py-2.5 sm:px-5 sm:py-3 lg:border-b-0">
                      <p className="truncate text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                        {totalsConfig[key]?.label || key}
                      </p>
                      <p className="mt-0.5 truncate text-lg font-bold tabular-nums text-foreground">
                        {key === "totalQty"
                          ? value + " KG"
                          : key.startsWith("totalQty")
                            ? value
                            : formatCurrency(value)}
                      </p>
                    </div>
                  ))}
                {isInventoryType && (
                  <div className="min-w-0 border-b border-r border-border/70 px-4 py-2.5 sm:px-5 sm:py-3 lg:border-b-0">
                    <p className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Lines</p>
                    <p className="mt-0.5 text-lg font-bold tabular-nums text-foreground">{transactions.length}</p>
                  </div>
                )}
                {invoicedTotals &&
                  [
                    ["Invoiced amount", invoicedTotals.amount],
                    ["Sales tax", invoicedTotals.tax],
                    ["Invoice total", invoicedTotals.total],
                  ].map(([label, value]) => (
                    <div key={label} className="min-w-0 border-b border-r border-border/70 px-4 py-2.5 sm:px-5 sm:py-3 lg:border-b-0">
                      <p className="truncate text-[11px] font-bold uppercase tracking-wider text-muted-foreground">{label}</p>
                      <p className="mt-0.5 truncate text-lg font-bold tabular-nums text-foreground">{formatCurrency(value)}</p>
                    </div>
                  ))}
              </div>
            )}

            {/* ── Details ── */}
            {masterFields.some((f) => {
              const v =
                (f.name === "pycd" ? data.acno?.acname : null) ||
                (f.name === "acno" ? data.acno?.acname : null) ||
                (f.name === "issued_by" ? data.godown2Details?.godown : null) ||
                (f.name === "issued_for" ? data.godownDetails?.godown : null) ||
                (f.name === "godown2" ? data.godown2Details?.godown : null) ||
                (f.name === "godown" ? data.godownDetails?.godown : null) ||
                data[f.name];
              return v && f.type !== "textarea";
            }) && (
                <div className="border-b border-border px-4 py-3 sm:px-6 sm:py-4">
                  <p className="mb-3 text-[11px] font-bold uppercase tracking-wider text-muted-foreground">
                    Details
                  </p>
                  <div className="grid grid-cols-2 gap-x-4 gap-y-2.5 sm:grid-cols-3 sm:gap-x-8 lg:grid-cols-4 xl:grid-cols-5">
                    {masterFields.map((field) => {
                      const value =
                        (field.name === "pycd" ? data.acno?.acname : null) ||
                        (field.name === "acno" ? data.acno?.acname : null) ||
                        (field.name === "party_code" ? data.acno?.acname : null) ||
                        (field.name === "acname" ? (data.acname || data.acno?.acname || Array.from(new Set((data.details || []).map(d => d.acname).filter(Boolean))).join(", ")) : null) ||
                        (field.name === "so_no" ? (data.so_no || Array.from(new Set((data.details || []).map(d => d.so_no).filter(Boolean))).join(", ")) : null) ||
                        (field.name === "issued_by" ? (data.godown2Details?.godown || (typeof data.issued_by === "object" ? data.issued_by?.label : null)) : null) ||
                        (field.name === "issued_for" ? (data.godownDetails?.godown || (typeof data.issued_for === "object" ? data.issued_for?.label : null)) : null) ||
                        (field.name === "godown2" ? data.godown2Details?.godown : null) ||
                        (field.name === "godown" ? data.godownDetails?.godown : null) ||
                        (field.type === "select" && field.options === "accounts" && data[field.name] != null
                          ? accountNames[String(data[field.name])]
                            ? `${data[field.name]} - ${accountNames[String(data[field.name])]}`
                            : null
                          : null) ||
                        data[field.name];
                      if (!value || field.type === "textarea") return null;
                      return (
                        <div key={field.name}>
                          <p className="truncate text-[11px] font-semibold text-muted-foreground">
                            {field.label}
                          </p>
                          <p className="truncate text-sm font-semibold text-foreground">
                            {field.type === "date" ? formatDateOnly(value) : String(value)}
                          </p>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

            {/* ── Tabs ── */}
            {(() => {
              const remarkFields = masterFields.filter((f) => f.type === "textarea" && data[f.name]);
              const tabs = [
                { key: "items", label: "Items", count: transactions.length },
                hasDeductionBlock && deductions.length > 0 && { key: "deductions", label: "Deductions", count: deductions.length },
                serviceRef && { key: "services", label: "Services", count: linkedServices.loading ? null : linkedServices.rows.length },
                remarkFields.length > 0 && { key: "remarks", label: "Remarks", count: null },
                historyKey && { key: "history", label: "History", count: history.key === historyKey && !history.loading && !history.error ? historyEvents(history.rows).length : null },
              ].filter(Boolean);
              const active = tabs.some((t) => t.key === viewTab) ? viewTab : "items";
              return (
                <>
                  <div role="tablist" aria-label="Sections" className="flex gap-1 overflow-x-auto border-b border-border px-3 sm:px-5">
                    {tabs.map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        role="tab"
                        aria-selected={active === t.key}
                        onClick={() => setViewTab(t.key)}
                        className={`-mb-px inline-flex h-11 flex-shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 text-sm font-semibold transition-colors ${
                          active === t.key
                            ? "border-primary text-primary"
                            : "border-transparent text-muted-foreground hover:text-foreground"
                        }`}
                      >
                        {t.label}
                        {t.count != null && (
                          <span className="inline-flex h-5 min-w-[20px] items-center justify-center rounded-full bg-primary/10 px-1.5 text-[11px] font-bold tabular-nums text-primary">
                            {t.count}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>

                  <div role="tabpanel" className="p-3 sm:p-5">
                    {active === "items" &&
                      (transactions.length > 0 ? (
                        <TransactionList items={transactions} />
                      ) : (
                        <div className="py-10 text-center text-sm text-muted-foreground">No items found</div>
                      ))}

                    {active === "deductions" && (
                      <>
                        <TransactionList items={deductions} />
                        <div className="mt-3 flex justify-end text-sm">
                          <span className="text-muted-foreground">
                            {totalsConfig?.deductionTotal?.label || "Total Deductions"}:
                          </span>
                          <span className="ml-1.5 font-bold tabular-nums">
                            {formatCurrency(calculatedTotals.deductionTotal || 0)}
                          </span>
                        </div>
                      </>
                    )}

                    {active === "services" && (
                      <div>
                {linkedServices.loading ? (
                  <p className="text-sm text-gray-400">Loading…</p>
                ) : linkedServices.error ? (
                  <p className="text-sm text-gray-500">{linkedServices.error}</p>
                ) : linkedServices.rows.length === 0 ? (
                  <p className="text-sm text-gray-400">
                    No service invoice is linked to this {serviceRef.label}.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {linkedServices.rows.map((si) => {
                      const services = [
                        ...new Set(
                          (si.transactions || [])
                            .filter((t) => (t.sub_tran_id ?? 1) === 1)
                            .map((t) => t.serviceDetails?.service_name)
                            .filter(Boolean),
                        ),
                      ].join(", ");
                      return (
                        <div
                          key={si.tran_id}
                          className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-border px-3.5 py-3"
                        >
                          <div className="min-w-0">
                            <p className="font-semibold text-foreground">{services || "Service"}</p>
                            <p className="mt-0.5 text-[13px] text-muted-foreground">
                              Service Invoice {si.vr_no || si.tran_id} · {formatDateOnly(si.dated)} ·{" "}
                              {si.acno?.acno != null && <span className="tabular-nums">{si.acno.acno} · </span>}
                              {si.acno?.acname || "-"} · inv {si.invoice_no || "no pending"}
                            </p>
                          </div>
                          <p className="font-bold tabular-nums text-foreground">{formatCurrency(serviceInvoiceTotal(si))}</p>
                        </div>
                      );
                    })}
                  </div>
                )}
                      </div>
                    )}

                    {active === "remarks" && (
                      <div className="space-y-2">
                        {remarkFields.map((f) => (
                          <div key={f.name} className="rounded-lg border border-border bg-muted/40 p-3">
                            <p className="text-[11px] font-semibold text-muted-foreground">{f.label}</p>
                            <p className="mt-0.5 whitespace-pre-line text-sm text-foreground">{data[f.name]}</p>
                          </div>
                        ))}
                      </div>
                    )}

                    {active === "history" &&
                      (history.loading || history.key !== historyKey ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">Loading history…</p>
                      ) : history.error ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">{history.error}</p>
                      ) : historyEvents(history.rows).length === 0 ? (
                        <p className="py-6 text-center text-sm text-muted-foreground">No changes recorded for this document.</p>
                      ) : (
                        <ol className="relative">
                          {historyEvents(history.rows).map((ev) => (
                            <li key={ev.key} className="flex gap-3 border-b border-dashed border-border py-2.5 last:border-b-0">
                              <span
                                className={`mt-1.5 h-2.5 w-2.5 flex-shrink-0 rounded-full ${
                                  ev.action === "delete" ? "bg-destructive/70" : ev.action === "create" ? "bg-[#2f5139]" : "bg-muted-foreground"
                                }`}
                              />
                              <div className="min-w-0 flex-1">
                                <p className="text-sm text-foreground">
                                  <span className="font-semibold">
                                    {ev.action === "create" ? "Created" : ev.action === "delete" ? "Deleted" : "Edited"}
                                  </span>{" "}
                                  by {ev.user}
                                  {ev.lineSummary && <span className="text-muted-foreground"> · {ev.lineSummary}</span>}
                                </p>
                                {ev.fields.length > 0 && (
                                  <ul className="mt-1 space-y-0.5 text-[13px] text-muted-foreground">
                                    {ev.fields.slice(0, 6).map((c, i) => (
                                      <li key={i} className="break-words">
                                        <span className="font-medium text-foreground/80">{c.label}</span>:{" "}
                                        <span className="line-through decoration-muted-foreground/50">{c.old}</span> → {c.new}
                                      </li>
                                    ))}
                                    {ev.fields.length > 6 && <li>+ {ev.fields.length - 6} more</li>}
                                  </ul>
                                )}
                                <p className="mt-0.5 text-xs text-muted-foreground">{formatDateTime12Hr(ev.dated, true)}</p>
                              </div>
                            </li>
                          ))}
                        </ol>
                      ))}
                  </div>
                </>
              );
            })()}
            </>
            )}
          </div>

          {/* Footer: Return on the left; Close · Export · Print · Edit on the right */}
          <div className="sticky bottom-0 z-10 border-t border-border bg-muted/40 px-4 py-3 sm:px-6">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                {actions?.ret && (
                  <Button variant="outline" size="sm" className="h-9 bg-background" onClick={actions.ret.run}>
                    <RotateCcw className="mr-1.5 h-4 w-4" />
                    {actions.ret.label}
                  </Button>
                )}
                <span className="hidden text-xs text-muted-foreground lg:inline">
                  ← → previous / next · Esc close
                </span>
              </div>
              <div className="flex flex-1 flex-wrap items-center justify-end gap-2 sm:flex-none">
                <Button
                  variant="outline"
                  size="sm"
                  className="hidden h-9 bg-background sm:inline-flex"
                  onClick={onClose}
                  disabled={isExporting}
                >
                  Close
                </Button>
                {(tranCode === 4 ||
                  tranCode === 6 ||
                  tranCode === 9 ||
                  tranCode === 10) && (
                    <DropdownMenu>
                      <DropdownMenuTrigger asChild>
                        <Button variant="outline" size="sm" disabled={isExporting} className="h-9 bg-background">
                          {isExporting ? (
                            <>
                              <RefreshCw className="mr-1.5 h-4 w-4 animate-spin" />
                              Exporting…
                            </>
                          ) : (
                            <>
                              <Download className="mr-1.5 h-4 w-4" />
                              Export
                              <ChevronDown className="ml-1 h-4 w-4" />
                            </>
                          )}
                        </Button>
                      </DropdownMenuTrigger>
                      <DropdownMenuContent>
                        <DropdownMenuItem onClick={() => handleOnExport("sales")}>
                          <Receipt className="h-4 w-4 mr-2" />
                          Sales Invoice
                        </DropdownMenuItem>
                        {tranCode === 6 && (
                          <DropdownMenuItem
                            onClick={() => handleOnExport("commercialInvoice")}
                          >
                            <Printer className="h-4 w-4 mr-2" />
                            Commercial
                          </DropdownMenuItem>
                        )}
                        <DropdownMenuItem
                          onClick={() => handleOnExport("delivery")}
                        >
                          <Package className="h-4 w-4 mr-2" />
                          Delivery Note
                        </DropdownMenuItem>
                        <DropdownMenuItem
                          onClick={() => handleOnExport("commission")}
                        >
                          <DollarSign className="h-4 w-4 mr-2" />
                          Commission Invoice
                        </DropdownMenuItem>
                      </DropdownMenuContent>
                    </DropdownMenu>
                  )}
                {actions?.print && (
                  <Button
                    variant="outline"
                    size="sm"
                    className="h-9 bg-background"
                    onClick={actions.print.run}
                    disabled={actions.print.disabled}
                    title="Print (Alt+P)"
                  >
                    <Printer className="mr-1.5 h-4 w-4" />
                    Print
                    <kbd className="ml-1.5 hidden rounded border border-b-2 border-border bg-background px-1 font-mono text-[10.5px] font-semibold text-muted-foreground sm:inline">
                      Alt+P
                    </kbd>
                  </Button>
                )}
                {actions?.edit && (
                  <Button
                    size="sm"
                    className="h-9 bg-primary px-4 text-primary-foreground hover:bg-primary/90"
                    onClick={actions.edit.run}
                    disabled={actions.edit.disabled}
                    title={actions.edit.title}
                  >
                    <Edit className="mr-1.5 h-4 w-4" />
                    Edit
                    <kbd className="ml-1.5 hidden rounded border border-white/40 px-1 font-mono text-[10.5px] font-semibold text-white/90 sm:inline">
                      E
                    </kbd>
                  </Button>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
};

// Pending Invoice Management Modal
const PendingInvoiceModal = ({ isOpen, onClose, onSuccess, type }) => {
  const [loading, setLoading] = useState(true);
  const [pendingData, setPendingData] = useState([]);
  const [bulkGenerating, setBulkGenerating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [nextInvoiceNo, setNextInvoiceNo] = useState(1);
  const [selectedRows, setSelectedRows] = useState([]);
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");
  const [fixingRates, setFixingRates] = useState(false);
  const [fixingRowId, setFixingRowId] = useState(null);
  const [expandedRows, setExpandedRows] = useState({});

  const toggleExpand = (tran_id) =>
    setExpandedRows((prev) => ({ ...prev, [tran_id]: !prev[tran_id] }));

  const sortedPendingData = useMemo(() => {
    let filtered = [...pendingData];
    if (startDate) {
      const start = new Date(startDate);
      start.setHours(0, 0, 0, 0);
      filtered = filtered.filter((d) => new Date(d.dated) >= start);
    }
    if (endDate) {
      const end = new Date(endDate);
      end.setHours(23, 59, 59, 999);
      filtered = filtered.filter((d) => new Date(d.dated) <= end);
    }
    return filtered.sort((a, b) => a.dispatch_no - b.dispatch_no);
  }, [pendingData, startDate, endDate]);

  const fetchPending = useCallback(async () => {
    setLoading(true);
    try {
      const [response, nextRes] = await Promise.all([
        axios.get("/api/voucher/sale-pending", {
          params: {
            tran_code: 6,
            startDate: startDate || undefined,
            endDate: endDate || undefined,
          },
        }),
        axios.get("/api/voucher/next-invoice-no?tran_code=6"),
      ]);
      setPendingData(response.data.data || []);
      setNextInvoiceNo(nextRes.data.nextInvoiceNo || 1);
    } catch (err) {
      toast.error("Failed to load pending sales.");
    } finally {
      setLoading(false);
    }
  }, [startDate, endDate]);

  const handleFixRates = async (tran_ids) => {
    if (!tran_ids || tran_ids.length === 0) return;
    setFixingRates(true);
    try {
      const { data } = await axios.post("/api/voucher/fix-dispatch-rates", { tran_ids });
      if (data.fixedCount > 0) {
        toast.success(`Fixed rates on ${data.fixedCount} dispatch(es).`);
      } else {
        toast.warning("No rates could be fixed. Check that Sale Orders have rates set.");
      }
      await fetchPending();
    } catch {
      toast.error("Failed to fix rates. Please try again.");
    } finally {
      setFixingRates(false);
    }
  };

  const handleFixSingleRate = async (tran_id) => {
    setFixingRowId(tran_id);
    try {
      const { data } = await axios.post("/api/voucher/fix-dispatch-rates", { tran_ids: [tran_id] });
      if (data.fixedCount > 0) {
        toast.success("Rate fixed successfully.");
      } else {
        toast.warning("Could not fix rate — no matching SO rate found.");
      }
      await fetchPending();
    } catch {
      toast.error("Failed to fix rate.");
    } finally {
      setFixingRowId(null);
    }
  };

  useEffect(() => {
    if (isOpen) fetchPending();
  }, [isOpen, fetchPending]);

  const handleAutoGenerate = async (rows = selectedRows) => {
    if (!rows || rows.length === 0)
      return toast.warning("Select rows to generate.");

    // Ensure we have row objects with tran_id. If rows is selectedRows, it contains IDs.
    const rowsToProcess =
      rows === pendingData
        ? sortedPendingData
        : sortedPendingData.filter((d) =>
          rows.some((row) => (row.tran_id || row) === d.tran_id),
        );

    const startingNo = Number(nextInvoiceNo);
    if (isNaN(startingNo)) return toast.error("Invalid Start From number");

    setBulkGenerating(true);
    try {
      const updates = rowsToProcess.map((row, idx) => ({
        tran_id: row.tran_id,
        invoice_no: (startingNo + idx).toString(),
      }));
      await axios.post("/api/voucher/bulk-update-invoice", { updates });
      toast.success(`${rows.length} invoice(s) generated!`);

      setNextInvoiceNo((prev) => Number(prev) + rowsToProcess.length);
      fetchPending();
      setSelectedRows([]);
      onSuccess();
    } catch (err) {
      toast.error("Failed to generate invoices.");
    } finally {
      setBulkGenerating(false);
    }
  };

  const handleSave = async () => {
    const updatedRows = pendingData.filter(
      (d) => d.invoice_no && d.invoice_no.trim() !== "",
    );
    if (updatedRows.length === 0) return toast.warning("No updates to save.");

    setSaving(true);
    try {
      await axios.post("/api/voucher/bulk-update-invoice", {
        updates: updatedRows.map((d) => ({
          tran_id: d.tran_id,
          invoice_no: d.invoice_no,
        })),
      });
      toast.success("Invoices updated successfully!");
      onClose();
      onSuccess();
    } catch (err) {
      toast.error("Failed to update invoices.");
    } finally {
      setSaving(false);
    }
  };

  const toggleRowSelection = (tran_id) => {
    setSelectedRows((prev) =>
      prev.includes(tran_id)
        ? prev.filter((id) => id !== tran_id)
        : [...prev, tran_id],
    );
  };

  const handleBulkAssignLocal = () => {
    if (selectedRows.length === 0) return;

    const startNo = Number(nextInvoiceNo);
    if (isNaN(startNo)) return toast.error("Invalid Start From number");

    // Get the selected rows in the visual order (sortedPendingData)
    const selectedInOrder = sortedPendingData.filter((d) =>
      selectedRows.includes(d.tran_id),
    );

    setPendingData((prev) => {
      const newPending = [...prev];
      selectedInOrder.forEach((row, idx) => {
        const targetIdx = newPending.findIndex((d) => d.tran_id === row.tran_id);
        if (targetIdx !== -1) {
          newPending[targetIdx] = {
            ...newPending[targetIdx],
            invoice_no: (startNo + idx).toString(),
          };
        }
      });
      return newPending;
    });

    setNextInvoiceNo(startNo + selectedInOrder.length);
    setSelectedRows([]);
    toast.success(`Assigned numbers to ${selectedInOrder.length} rows.`);
  };

  if (!isOpen) return null;

  const readyCount = pendingData.filter(
    (d) => d.invoice_no && d.invoice_no.trim() !== "",
  ).length;

  const rateIssueRows = pendingData.filter((d) => d.hasRateIssue);
  const fixableRows = pendingData.filter((d) => d.isFixable);
  const rateIssueCount = rateIssueRows.length;

  const allSelected = pendingData.length > 0 && selectedRows.length === pendingData.length;

  const toggleSelectAll = () => {
    if (allSelected) {
      setSelectedRows([]);
    } else {
      setSelectedRows(pendingData.map((d) => d.tran_id));
    }
  };

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-50 p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.96, opacity: 0, y: 16 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.96, opacity: 0, y: 16 }}
          transition={{ type: "spring", duration: 0.4, bounce: 0.15 }}
          className="bg-white rounded-xl shadow-2xl w-full max-w-6xl max-h-[90vh] overflow-hidden flex flex-col border border-border"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="bg-primary px-7 py-5 text-primary-foreground">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-5">
                <div className="p-3 bg-white/15 rounded-xl">
                  <Receipt className="h-6 w-6" />
                </div>
                <div className="flex items-center gap-6">
                  <div>
                    <h2 className="text-xl font-bold tracking-tight">
                      Pending Invoices
                    </h2>
                    <p className="text-[12px] text-primary-foreground/70 font-medium">
                      {pendingData.length} sale{pendingData.length !== 1 ? "s" : ""} pending
                    </p>
                  </div>

                  <div className="h-10 w-px bg-white/15"></div>

                  <div className="flex items-center gap-2.5 px-4 py-1.5 bg-white/10 rounded-xl border border-white/20">
                    <label className="text-[10px] font-bold text-white uppercase tracking-widest">
                      Start From
                    </label>
                    <Input
                      type="number"
                      value={nextInvoiceNo}
                      onChange={(e) => setNextInvoiceNo(Number(e.target.value))}
                      className="w-24 h-7 text-base border-none bg-transparent p-0 focus-visible:ring-0 text-white font-bold tabular-nums"
                    />
                  </div>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <Button
                  variant="ghost"
                  size="icon"
                  onClick={onClose}
                  className="text-primary-foreground/60 hover:text-primary-foreground hover:bg-white/15 rounded-xl h-10 w-10"
                >
                  <X className="h-5 w-5" />
                </Button>
              </div>
            </div>
          </div>

          {/* Toolbar */}
          <div className="px-7 py-5 bg-muted/40 border-b border-border">
            <div className="flex flex-wrap items-center justify-between gap-4">
              <div className="flex items-center gap-4">
                <Button
                  onClick={() => handleAutoGenerate(pendingData)}
                  disabled={bulkGenerating || pendingData.length === 0 || allSelected}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
                >
                  {bulkGenerating ? (
                    <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                  ) : (
                    <Zap className="h-4 w-4 mr-2" />
                  )}
                  Auto-Assign and Save All
                </Button>

                <div className="h-8 w-px bg-border"></div>

                <div className="h-8 w-px bg-border/60 mx-1"></div>

                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-black text-muted-foreground uppercase tracking-widest whitespace-nowrap">
                    From Date
                  </label>
                  <Input
                    type="date"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-[160px] h-9 text-xs bg-white rounded-lg border-border/80 px-2"
                  />
                </div>

                <div className="flex items-center gap-2">
                  <label className="text-[11px] font-black text-muted-foreground uppercase tracking-widest whitespace-nowrap">
                    To Date
                  </label>
                  <Input
                    type="date"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-[160px] h-9 text-xs bg-white rounded-lg border-border/80 px-2"
                  />
                </div>

                {selectedRows.length > 0 && (
                  <div className="flex items-center gap-2">
                    <span className="inline-flex items-center gap-1.5 text-xs font-medium bg-primary/10 text-primary px-3 py-1.5 rounded-full">
                      <CheckCircle className="h-3.5 w-3.5" />
                      {selectedRows.length} selected
                    </span>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleBulkAssignLocal}
                      className="h-8 px-3 text-xs border-primary/20 text-primary hover:bg-primary hover:text-primary-foreground rounded-lg transition-all"
                    >
                      <Zap className="h-3 w-3 mr-1" /> Assign Selected Invoice
                    </Button>
                  </div>
                )}
              </div>

              <Button
                onClick={handleSave}
                disabled={saving || readyCount === 0}
                className="bg-primary hover:bg-primary/90 text-primary-foreground shadow-sm"
              >
                {saving ? (
                  <RefreshCw className="h-4 w-4 animate-spin mr-2" />
                ) : (
                  <Save className="h-4 w-4 mr-2" />
                )}
                Save {readyCount > 0 ? `(${readyCount})` : ""}
              </Button>
            </div>
          </div>
          {/* Rate Issues Banner */}
          {!loading && rateIssueCount > 0 && (
            <div className="mx-5 mt-4 flex items-center gap-4 bg-gradient-to-r from-amber-50 to-orange-50 border border-amber-200 rounded-xl px-5 py-4 shadow-sm">
              <div className="p-2.5 bg-amber-100 rounded-xl flex-shrink-0">
                <AlertTriangle className="h-5 w-5 text-amber-600" />
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-bold text-amber-900">
                  {rateIssueCount} dispatch{rateIssueCount !== 1 ? "es have" : " has"} line errors
                </p>
                <p className="text-xs text-amber-700 mt-0.5 leading-relaxed">
                  Issues detected: rate = 0, rate mismatch vs SO, or product not in Sale Order. Click a row's issue badge to see per-line detail.{fixableRows.length > 0 && <> <span className="font-semibold">Fix All Rates</span> auto-corrects the fixable ones.</>}
                </p>
              </div>
              <Button
                onClick={() => handleFixRates(fixableRows.map((d) => d.tran_id))}
                disabled={fixingRates || fixableRows.length === 0}
                className="flex-shrink-0 bg-amber-500 hover:bg-amber-600 active:bg-amber-700 text-white px-5 py-2.5 rounded-xl text-sm font-semibold flex items-center gap-2 shadow-md transition-all disabled:opacity-50"
              >
                {fixingRates ? (
                  <>
                    <RefreshCw className="h-4 w-4 animate-spin" />
                    Fixing…
                  </>
                ) : (
                  <>
                    <Wrench className="h-4 w-4" />
                    Fix All Rates
                  </>
                )}
              </Button>
            </div>
          )}

           {/* Content */}
          <div className="flex-1 overflow-y-auto">
            {loading ? (
              <div className="p-7 space-y-4">
                {[...Array(6)].map((_, i) => (
                  <Skeleton key={i} className="h-14 w-full rounded-xl" />
                ))}
              </div>
            ) : pendingData.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-24 px-8">
                <div className="p-5 bg-green-50 rounded-full mb-5">
                  <CheckCircle className="h-14 w-14 text-green-500" />
                </div>
                <h3 className="text-lg font-semibold text-foreground mb-2">
                  All Caught Up!
                </h3>
                <p className="text-sm text-muted-foreground text-center max-w-sm leading-relaxed">
                  Every sale already has an invoice number assigned. Nothing to do here.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto px-4 pt-4 pb-2">
                <Table className="border border-border/60 rounded-xl overflow-hidden">
                  <TableHeader>
                    <TableRow className="bg-primary hover:bg-muted/60 border-b-2 border-border/40 group transition-colors">
                      <TableHead className="w-[52px] pl-4 py-3.5">
                        <Checkbox
                          checked={allSelected}
                          onCheckedChange={toggleSelectAll}
                        />
                      </TableHead>
                      <TableHead className="text-[11px] uppercase tracking-widest text-white group-hover:text-primary transition-colors font-semibold py-3.5">
                        Dispatch / SO No.
                      </TableHead>
                      <TableHead className="text-[11px] uppercase tracking-widest text-white group-hover:text-primary transition-colors text-center font-semibold min-w-[220px] py-3.5">
                        Customer Name
                      </TableHead>
                      <TableHead className="text-[11px] uppercase tracking-widest text-white group-hover:text-primary transition-colors font-semibold py-3.5">
                        Sale Date
                      </TableHead>
                      <TableHead className="text-[11px] uppercase tracking-widest text-white group-hover:text-primary transition-colors text-center font-semibold min-w-[70] py-3.5">
                        Amount
                      </TableHead>
                      <TableHead className="text-[11px] uppercase tracking-widest text-white group-hover:text-primary transition-colors text-center font-semibold py-3.5 min-w-[110px]">
                        Rate Status
                      </TableHead>
                      <TableHead className="text-[11px] uppercase tracking-widest text-white group-hover:text-primary transition-colors text-center font-semibold min-w-[40px] py-3.5">
                        Invoice No.
                      </TableHead>
                      <TableHead className="text-[11px] uppercase tracking-widest text-white group-hover:text-primary transition-colors font-semibold text-center w-[150px] py-3.5 pr-4">
                        Quick Actions
                      </TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {sortedPendingData.map((entry) => {
                      const isExpanded = !!expandedRows[entry.tran_id];
                      const errors = entry.lineErrors || [];
                      const rateZeroCount = errors.filter((e) => e.errorType === "RATE_ZERO").length;
                      const mismatchCount = errors.filter((e) => e.errorType === "RATE_MISMATCH").length;
                      const notInSOCount = errors.filter((e) => e.errorType === "ITEM_NOT_IN_SO").length;
                      const stRateMismatchCount = errors.filter((e) => e.errorType === "ST_RATE_MISMATCH").length;

                      return (
                        <React.Fragment key={entry.tran_id}>
                          <TableRow
                            className={`transition-all duration-150 ${
                              selectedRows.includes(entry.tran_id)
                                ? "bg-primary/5 hover:bg-primary/8"
                                : entry.hasRateIssue
                                ? "bg-amber-50/40 hover:bg-amber-50/60"
                                : "hover:bg-muted/30"
                            } ${
                              entry.invoice_no
                                ? "border-l-[3px] border-l-green-500"
                                : entry.hasRateIssue
                                ? "border-l-[3px] border-l-amber-400"
                                : "border-l-[3px] border-l-transparent"
                            }`}
                      >
                        <TableCell className="pl-4 py-3.5">
                          <Checkbox
                            checked={selectedRows.includes(entry.tran_id)}
                              onCheckedChange={() => toggleRowSelection(entry.tran_id)}
                          />
                        </TableCell>
                        <TableCell className="py-3.5">
                          <div className="flex flex-col gap-0.5">
                            <span className="inline-flex items-center gap-1.5 font-semibold text-sm">
                              <Hash className="h-3.5 w-3.5 text-muted-foreground/70" />
                              {entry.dispatch_no}
                            </span>
                            {entry.so_no && (
                              <span className="inline-flex items-center gap-1.5 text-[11px] text-muted-foreground">
                                <FileText className="h-3 w-3 flex-shrink-0" />
                                SO&nbsp;#{entry.so_no}
                              </span>
                            )}
                          </div>
                        </TableCell>
                        <TableCell className="py-3.5">
                          <span className="flex items-center gap-2.5 text-sm">
                            <div className="h-7 w-7 rounded-full bg-primary/8 flex items-center justify-center flex-shrink-0">
                              <User className="h-3.5 w-3.5 text-primary/70" />
                            </div>
                            <span className="truncate font-medium">{entry.acno?.acname || "—"}</span>
                          </span>
                        </TableCell>
                        <TableCell className="py-3.5">
                          <span className="flex items-center gap-2 text-sm text-muted-foreground">
                            <Calendar className="h-3.5 w-3.5" />
                            {formatDateTime12Hr(entry.dated, ["saleOrder", "saleOrderView"].includes(type))}
                          </span>
                        </TableCell>
                        <TableCell className="text-center py-3.5">
                            <span className={`font-semibold text-sm tabular-nums ${entry.hasRateIssue ? "text-amber-600" : ""}`}>
                                {(
                                  entry.transactions?.reduce((sum, t) => sum + (t.camt || 0), 0) || 0
                                ).toLocaleString()}
                          </span>
                        </TableCell>
                            {/* Rate Status — clickable to expand detail */}
                            <TableCell className="py-3.5 text-center">
                              {entry.hasRateIssue ? (
                                <button
                                  onClick={() => toggleExpand(entry.tran_id)}
                                  className="inline-flex items-center gap-1.5 text-[11px] font-bold bg-amber-100 text-amber-800 border border-amber-300 px-2.5 py-1 rounded-full hover:bg-amber-200 active:bg-amber-300 transition-colors cursor-pointer whitespace-nowrap"
                                >
                                  <AlertTriangle className="h-3 w-3 flex-shrink-0" />
                                  {errors.length} issue{errors.length !== 1 ? "s" : ""}
                                  <ChevronDown className={`h-3 w-3 transition-transform duration-200 ${isExpanded ? "rotate-180" : ""}`} />
                                </button>
                              ) : (
                                <span className="inline-flex items-center gap-1.5 text-[11px] font-bold bg-green-100 text-green-700 border border-green-300 px-2.5 py-1 rounded-full whitespace-nowrap">
                                  <ShieldCheck className="h-3 w-3" />
                                  OK
                                </span>
                              )}
                            </TableCell>

                        <TableCell className="py-3.5">
                          <Input
                            placeholder="e.g. INV-001"
                            value={entry.invoice_no || ""}
                             onChange={(e) =>
                                  setPendingData((prev) =>
                                    prev.map((d) =>
                                      d.tran_id === entry.tran_id ? { ...d, invoice_no: e.target.value } : d
                                    )
                                  )
                                }
                            className="h-9 text-sm bg-white border-border/80 rounded-lg focus-visible:ring-primary/30 focus-visible:border-primary/40"
                          />
                        </TableCell>

                        <TableCell className="py-3.5 pr-4">
                          <div className="flex items-center justify-center gap-1.5">
                            <Button
                              variant="outline"
                              size="sm"
                              className="h-8 px-3 text-xs border-primary/20 text-primary hover:bg-primary hover:text-primary-foreground rounded-lg transition-all"
                              onClick={() => {
                                const valToAssign = Number(nextInvoiceNo);
                                  if (isNaN(valToAssign)) return toast.error("Invalid Start From number");
                                    setPendingData((prev) =>
                                      prev.map((d) =>
                                        d.tran_id === entry.tran_id ? { ...d, invoice_no: valToAssign.toString() } : d
                                      )
                                );
                                setNextInvoiceNo(valToAssign + 1);
                              }}
                            >
                              <Zap className="h-3 w-3 mr-1" /> Assign
                            </Button>
                             {entry.isFixable && (
                                  <Button
                                    variant="outline"
                                    size="sm"
                                    disabled={fixingRowId === entry.tran_id || fixingRates}
                                    onClick={() => handleFixSingleRate(entry.tran_id)}
                                    className="h-8 px-3 text-xs border-amber-300 text-amber-700 hover:bg-amber-500 hover:text-white hover:border-amber-500 rounded-lg transition-all font-semibold"
                                    title="Fix rates from Sale Order"
                                  >
                                    {fixingRowId === entry.tran_id ? (
                                      <RefreshCw className="h-3 w-3 animate-spin" />
                                    ) : (
                                      <><Wrench className="h-3 w-3 mr-1" />Fix</>
                                    )}
                                  </Button>
                                )}
                            {entry.invoice_no && (
                              <Button
                                variant="ghost"
                                size="sm"
                                className="h-8 w-8 p-0 text-muted-foreground hover:text-destructive hover:bg-destructive/10 rounded-lg"
                                onClick={() =>
                                      setPendingData((prev) =>
                                        prev.map((d) =>
                                          d.tran_id === entry.tran_id ? { ...d, invoice_no: "" } : d
                                        )
                                      )
                                    }
                              >
                                <X className="h-3.5 w-3.5" />
                              </Button>
                            )}
                          </div>
                        </TableCell>
                      </TableRow>

                        {/* Expandable per-line error detail */}
                          {isExpanded && errors.length > 0 && (
                            <TableRow key={`${entry.tran_id}-detail`}>
                              <TableCell colSpan={8} className="p-0 border-0">
                                <div className="border-b border-amber-200 bg-gradient-to-br from-amber-50/80 to-orange-50/60">
                                  <div className="px-8 py-4">
                                    {/* Header row with counts */}
                                    <div className="flex items-center gap-4 mb-3">
                                      <div className="flex items-center gap-1.5">
                                        <AlertTriangle className="h-3.5 w-3.5 text-amber-600" />
                                        <span className="text-xs font-bold text-amber-900 uppercase tracking-wider">
                                          {errors.length} Line Issue{errors.length !== 1 ? "s" : ""} — Dispatch #{entry.dispatch_no}{entry.so_no ? ` · SO #${entry.so_no}` : ""}
                                        </span>
                                      </div>
                                      <div className="flex items-center gap-2">
                                        {rateZeroCount > 0 && (
                                          <span className="text-[10px] font-bold bg-red-100 text-red-700 border border-red-200 px-2 py-0.5 rounded-full">
                                            {rateZeroCount} Rate = 0
                                          </span>
                                        )}
                                        {mismatchCount > 0 && (
                                          <span className="text-[10px] font-bold bg-orange-100 text-orange-700 border border-orange-200 px-2 py-0.5 rounded-full">
                                            {mismatchCount} Mismatch
                                          </span>
                                        )}
                                        {notInSOCount > 0 && (
                                          <span className="text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full">
                                            {notInSOCount} Not in SO
                                          </span>
                                        )}
                                        {stRateMismatchCount > 0 && (
                                          <span className="text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full">
                                            {stRateMismatchCount} ST% Mismatch
                                          </span>
                                        )}
                                      </div>
                                    </div>

                                    {/* Per-line mini table */}
                                    <div className="rounded-xl border border-amber-200/80 overflow-hidden shadow-sm">
                                      <table className="w-full text-xs">
                                        <thead>
                                          <tr className="bg-amber-100/70 border-b border-amber-200/80">
                                            <th className="text-left px-4 py-2.5 font-bold text-amber-900 uppercase tracking-widest">Product</th>
                                            <th className="text-center px-4 py-2.5 font-bold text-amber-900 uppercase tracking-widest">Qty</th>
                                            <th className="text-center px-4 py-2.5 font-bold text-amber-900 uppercase tracking-widest">Dispatch Rate</th>
                                            <th className="text-center px-4 py-2.5 font-bold text-amber-900 uppercase tracking-widest">SO Rate</th>
                                            <th className="text-center px-4 py-2.5 font-bold text-amber-900 uppercase tracking-widest">ST%</th>
                                            <th className="text-center px-4 py-2.5 font-bold text-amber-900 uppercase tracking-widest">SO ST%</th>
                                            <th className="text-left px-4 py-2.5 font-bold text-amber-900 uppercase tracking-widest">Issue</th>
                                          </tr>
                                        </thead>
                                        <tbody>
                                          {errors.map((err, i) => (
                                            <tr
                                              key={err.line_id}
                                              className={`border-b border-amber-100 last:border-0 ${err.errorType === "RATE_ZERO"
                                                  ? "bg-red-50/60"
                                                  : err.errorType === "RATE_MISMATCH"
                                                  ? "bg-orange-50/60"
                                                  : err.errorType === "ST_RATE_MISMATCH"
                                                  ? "bg-blue-50/60"
                                                  : "bg-purple-50/60"
                                              }`}
                                            >
                                              <td className="px-4 py-3 font-semibold text-foreground/80">
                                                {err.itemName}
                                              </td>
                                              <td className="px-4 py-3 text-center tabular-nums text-foreground/70">
                                                {err.qty}
                                              </td>                                                                                         <td className={`px-4 py-3 text-center tabular-nums font-bold ${err.errorType === "RATE_ZERO"
                                                  ? "text-red-600"
                                                  : err.errorType === "RATE_MISMATCH"
                                                  ? "text-orange-600"
                                                  : "text-foreground/70"
                                              }`}>
                                                {err.rate?.toLocaleString() ?? "0"}
                                              </td>
                                              <td className="px-4 py-3 text-center tabular-nums font-bold text-green-700">
                                                {err.soRate != null ? err.soRate.toLocaleString() : <span className="text-muted-foreground font-normal">—</span>}
                                              </td>
                                              <td className={`px-4 py-3 text-center tabular-nums font-bold ${err.errorType === "ST_RATE_MISMATCH" ? "text-blue-600" : "text-foreground/70"}`}>
                                                {err.stRate != null ? `${err.stRate}%` : "—"}
                                              </td>
                                              <td className="px-4 py-3 text-center tabular-nums font-bold text-green-700">
                                                {err.soStRate != null ? `${err.soStRate}%` : <span className="text-muted-foreground font-normal">—</span>}
                                              </td>
                                              <td className="px-4 py-3">
                                                {err.errorType === "RATE_ZERO" && (
                                                  <div className="flex flex-col gap-0.5">
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-red-100 text-red-700 border border-red-200 px-2 py-0.5 rounded-full w-fit">
                                                      <X className="h-2.5 w-2.5" /> Rate = 0
                                                    </span>
                                                    {err.soRate > 0 && (
                                                      <span className="text-[10px] text-green-700 font-medium ml-0.5">→ will fix to {err.soRate}</span>
                                                    )}
                                                  </div>
                                                )}
                                                {err.errorType === "RATE_MISMATCH" && (
                                                  <div className="flex flex-col gap-0.5">
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-orange-100 text-orange-700 border border-orange-200 px-2 py-0.5 rounded-full w-fit">
                                                      <AlertTriangle className="h-2.5 w-2.5" /> Rate Mismatch
                                                    </span>
                                                    <span className="text-[10px] text-green-700 font-medium ml-0.5">→ will fix to {err.soRate}</span>
                                                  </div>
                                                )}
                                                {err.errorType === "ST_RATE_MISMATCH" && (
                                                  <div className="flex flex-col gap-0.5">
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-blue-100 text-blue-700 border border-blue-200 px-2 py-0.5 rounded-full w-fit">
                                                      <AlertTriangle className="h-2.5 w-2.5" /> ST% Mismatch
                                                    </span>
                                                    <span className="text-[10px] text-green-700 font-medium ml-0.5">→ will fix to {err.soStRate}%</span>
                                                  </div>
                                                )}
                                                {err.errorType === "ITEM_NOT_IN_SO" && (
                                                  <div className="flex flex-col gap-0.5">
                                                    <span className="inline-flex items-center gap-1 text-[10px] font-bold bg-purple-100 text-purple-700 border border-purple-200 px-2 py-0.5 rounded-full w-fit">
                                                      <AlertCircle className="h-2.5 w-2.5" /> Not in Sale Order
                                                    </span>
                                                    <span className="text-[10px] text-muted-foreground ml-0.5">Needs manual correction</span>
                                                  </div>
                                                )}
                                              </td>
                                            </tr>
                                          ))}
                                        </tbody>
                                      </table>
                                    </div>
                                  </div>
                                </div>
                              </TableCell>
                            </TableRow>
                          )}
                        </React.Fragment>
                      );
                    })}
                  </TableBody>
                </Table>
              </div>
            )}
          </div>

          {/* Footer Summary */}
          {!loading && pendingData.length > 0 && (
            <div className="px-7 py-4 bg-muted/30 border-t border-border flex items-center justify-between text-xs text-muted-foreground">
              <div className="flex items-center gap-5">
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-foreground/50 inline-block"></span>
                  <span className="font-medium text-foreground/70">{pendingData.length}</span> total
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-green-500 inline-block"></span>
                  <span className="font-medium text-foreground/70">{readyCount}</span> assigned
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-amber-500 inline-block"></span>
                  <span className="font-medium text-foreground/70">{pendingData.length - readyCount}</span> remaining
                </span>
                {rateIssueCount > 0 && (
                  <span className="flex items-center gap-1.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-500 inline-block"></span>
                    <span className="font-bold text-orange-600">{rateIssueCount}</span>
                    <span className="text-orange-600 font-medium">rate issues</span>
                  </span>
                )}
              </div>
              <span className="flex items-center gap-2 text-muted-foreground/80">
                <span className="w-3 h-0.5 bg-green-500 inline-block rounded-full"></span>
                Invoice assigned
              </span>
            </div>
          )}
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
};

// Bulk Print Preview Modal Component
const BulkPrintPreviewModal = ({
  isOpen,
  onClose,
  printData,
  printType,
  documentType,
  currency,
  company,
}) => {






  const [currentDocIndex, setCurrentDocIndex] = useState(0);
  const [pdfUrls, setPdfUrls] = useState([]);
  const [loading, setLoading] = useState(true);

  const currentDoc = printData[currentDocIndex];

  useEffect(() => {



    if (isOpen && printData && printData.length > 0) {

      generateAllPDFs();
    } else {


    }
  }, [isOpen, printData]);

  const generateAllPDFs = async () => {
    setLoading(true);
    try {
      const urls = [];

      for (const item of printData) {
        try {
          const { data, type: dataType } = item;
          let pdfDoc;


          // Get transaction code
          const tranCode = data.tran_code || data.order_catagory;


          // Generate PDF based on transaction type and print type
          switch (tranCode) {
            // Financial Vouchers - Payment, Receipt, Journal
            case 1: // Receipt
            case 2: // Payment
            case 3: // Journal.
              try {


                // Check if data has required structure
                if (!data || !data.transactions) {
                  console.error("Invalid voucher data structure:", data);
                  throw new Error("Invalid voucher data structure");
                }

                // Ensure data is properly formatted for PDF generation
                const formattedData = {
                  ...data,
                  // Ensure required fields are present
                  vr_no: data.vr_no || "N/A",
                  dated: data.dated || new Date().toISOString(),
                  transactions: data.transactions || [],
                };

                pdfDoc = await generateVoucherPDF(
                  formattedData,
                  company,
                  currency,
                );

              } catch (pdfError) {
                console.error("Voucher PDF generation failed:", pdfError);

                // Fallback: Create a simple PDF
                // pdfDoc = await generateSimpleVoucherPDF(data);
              }
              break;

            // Purchase Operations
            case 4: // Purchase Order
              if (printType === "purchase") {
                pdfDoc = await generatePurchaseOrderPDF({
                  data: [data],
                  company,
                  currency,
                });
              } else {
                pdfDoc = await generateVoucherPDF(data, company, currency);
              }
              break;

            // Sale Operations
            case 6: // Sale Order / Sale / Dispatch
              if (printType === "commercialInvoice" && documentType === "dispatchEdit") {
                pdfDoc = await generateDeliveryNotePDF(data, null, currency, company);
              } else if (documentType === "dispatchEdit") {
                pdfDoc = await generateDeliveryNotePDF(data, null, currency, company, "preview");
              } else if (printType === "sales") {
                pdfDoc = await generateSalesTaxInvoicePDF({
                  voucher: data,
                  companyData: company,
                  currencyData: currency
                });
              } else if (printType === "delivery") {
                const mappedData = prepareVoucherForPDF(data, "delivery");
                pdfDoc = generateUnifiedPDF(mappedData, company);
              } else if (printType === "commission") {
                const mappedData = prepareVoucherForPDF(data, "commission");
                pdfDoc = generateUnifiedPDF(mappedData, company);
              } else if (documentType === "sale" || documentType === "saleTax") {
                pdfDoc = await generateSalesTaxInvoicePDF({
                  voucher: data,
                  companyData: company,
                  currencyData: currency
                });
              } else {
                pdfDoc = await generateSalesOrderPDF({
                  data: [data],
                  company,
                  currency,
                });
              }
              break;

            // Return Operations
            case 9: // Purchase Return
            case 10: // Sale Return
              pdfDoc = await generateVoucherPDF(data, company, currency);
              break;

            // Inventory Operations
            case 1000: // GRN/Dispatch
              pdfDoc = await generateVoucherPDF(data, company, currency);
              break;

            // Default case - try voucher PDF
            default:
              pdfDoc = await generateVoucherPDF(data, company, currency);
              break;
          }

          if (pdfDoc) {
            // Convert to blob and create URL
            const pdfBlob = await pdfDoc.output("blob");
            const url = URL.createObjectURL(pdfBlob);
            urls.push(url);

          } else {
            urls.push(null);
          }
        } catch (error) {
          console.error(`Failed to generate PDF for document:`, error);
          urls.push(null);
        }
      }

      setPdfUrls(urls);
    } catch (error) {
      console.error("Failed to generate PDFs:", error);
      toast.error("Failed to generate print previews");
    } finally {
      setLoading(false);
    }
  };

  const handlePrintAll = async () => {
    const validUrls = pdfUrls.filter(Boolean);
    if (validUrls.length === 0) {
      toast.error("No documents available to print");
      return;
    }

    try {
      toast.loading("Merging documents...");

      // Fetch all PDF bytes
      const pdfBytesArray = await Promise.all(
        validUrls.map((url) => fetch(url).then((r) => r.arrayBuffer()))
      );

      // Merge into one PDF using pdf-lib
      const mergedPdf = await PDFDocument.create();
      for (const bytes of pdfBytesArray) {
        const srcDoc = await PDFDocument.load(bytes);
        const copiedPages = await mergedPdf.copyPages(srcDoc, srcDoc.getPageIndices());
        copiedPages.forEach((page) => mergedPdf.addPage(page));
      }

      const mergedBytes = await mergedPdf.save();
      const blob = new Blob([mergedBytes], { type: "application/pdf" });
      const mergedUrl = URL.createObjectURL(blob);

      toast.dismiss();

      // Open single window and print
      const printWindow = window.open(mergedUrl, "_blank");
      if (!printWindow) {
        toast.error("Popup blocked. Please allow popups and try again.");
        URL.revokeObjectURL(mergedUrl);
        return;
      }

      printWindow.onload = () => {
        printWindow.focus();
        printWindow.print();
        printWindow.onafterprint = () => {
          printWindow.close();
          URL.revokeObjectURL(mergedUrl);
        };
      };

      toast.success(`Printing ${validUrls.length} document(s) as one PDF`);
    } catch (error) {
      toast.dismiss();
      console.error("Print all failed:", error);
      toast.error("Failed to merge documents for printing");
    }
  };

  const handleDownloadAll = async () => {
    let downloadCount = 0;
    for (let i = 0; i < pdfUrls.length; i++) {
      if (pdfUrls[i]) {
        const link = document.createElement("a");
        link.href = pdfUrls[i];
        const docName =
          printData[i]?.vr_no || printData[i]?.order_no || `document-${i + 1}`;
        link.setAttribute("download", `${printType}-${docName}.pdf`);
        document.body.appendChild(link);
        link.click();
        link.remove();
        downloadCount++;

        // Small delay between downloads
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
    }
    toast.success(`Downloaded ${downloadCount} documents`);
  };

  const handlePrintCurrent = () => {
    if (pdfUrls[currentDocIndex]) {
      const printWindow = window.open(pdfUrls[currentDocIndex]);
      printWindow.onload = () => {
        printWindow.print();
      };
    }
  };

  const handleDownloadCurrent = () => {
    if (pdfUrls[currentDocIndex]) {
      const link = document.createElement("a");
      link.href = pdfUrls[currentDocIndex];
      const docName =
        currentDoc?.vr_no ||
        currentDoc?.order_no ||
        `document-${currentDocIndex + 1}`;
      link.setAttribute("download", `${printType}-${docName}.pdf`);
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
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
          className="bg-white rounded-2xl shadow-2xl w-full max-w-7xl h-[95vh] flex flex-col"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="bg-primary px-6 py-4 text-white flex justify-between items-center">
            <div>
              <h2 className="text-xl font-bold">Bulk Print Preview</h2>
              <p className="text-sm opacity-90">
                Document {currentDocIndex + 1} of {printData.length}
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handlePrintCurrent}
                disabled={loading || !pdfUrls[currentDocIndex]}
                className="bg-white text-primary hover:bg-gray-100"
              >
                <Printer className="h-4 w-4 mr-2" />
                Print Current
              </Button>
              <Button
                onClick={handleDownloadCurrent}
                disabled={loading || !pdfUrls[currentDocIndex]}
                variant="outline"
                className="border-white text-white hover:bg-white/20"
              >
                <Download className="h-4 w-4 mr-2" />
                Download Current
              </Button>
              <Button
                onClick={handlePrintAll}
                disabled={loading || pdfUrls.length === 0}
                className="bg-green-600 hover:bg-green-700 text-white"
              >
                <Printer className="h-4 w-4 mr-2" />
                Print All ({printData.length})
              </Button>
              <Button
                onClick={handleDownloadAll}
                disabled={loading || pdfUrls.length === 0}
                variant="outline"
                className="border-blue-300 text-blue-700 hover:bg-blue-50"
              >
                <Download className="h-4 w-4 mr-2" />
                Download All
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

          {/* Navigation */}
          <div className="bg-gray-100 px-6 py-3 flex justify-between items-center">
            <Button
              onClick={() =>
                setCurrentDocIndex((prev) => Math.max(0, prev - 1))
              }
              disabled={currentDocIndex === 0}
              variant="outline"
            >
              <ChevronLeft className="h-4 w-4 mr-2" />
              Previous
            </Button>

            <div className="flex items-center gap-4">
              <span className="font-medium">
                {currentDocIndex + 1} / {printData.length}
              </span>
              <div className="flex gap-1">
                {printData.map((_, index) => (
                  <button
                    key={index}
                    onClick={() => setCurrentDocIndex(index)}
                    className={`w-3 h-3 rounded-full ${index === currentDocIndex ? "bg-primary" : "bg-gray-400"
                      }`}
                  />
                ))}
              </div>
            </div>

            <Button
              onClick={() =>
                setCurrentDocIndex((prev) =>
                  Math.min(printData.length - 1, prev + 1),
                )
              }
              disabled={currentDocIndex === printData.length - 1}
              variant="outline"
            >
              Next
              <ChevronRight className="h-4 w-4 ml-2" />
            </Button>
          </div>

          {/* PDF Preview */}
          <div className="flex-1 p-4 bg-gray-100">
            {loading ? (
              <div className="flex items-center justify-center h-full">
                <div className="text-center">
                  <RefreshCw className="h-8 w-8 animate-spin mx-auto mb-2 text-primary" />
                  <p>
                    Generating PDFs... ({currentDocIndex + 1}/{printData.length}
                    )
                  </p>
                </div>
              </div>
            ) : pdfUrls[currentDocIndex] ? (
              <iframe
                src={pdfUrls[currentDocIndex]}
                className="w-full h-full border rounded-lg bg-white"
                title={`Print Preview ${currentDocIndex + 1}`}
              />
            ) : (
              <div className="flex items-center justify-center h-full">
                <p className="text-gray-500">Failed to load PDF</p>
              </div>
            )}
          </div>

          {/* Document Info */}
          <div className="bg-white border-t px-6 py-3">
            <div className="flex justify-between items-center text-sm">
              <div>
                <span className="font-medium">Document ID: </span>
                <span>
                  {currentDoc?.vr_no || currentDoc?.order_no || "N/A"}
                </span>
              </div>
              <div>
                <span className="font-medium">Type: </span>
                <span>{printType}</span>
              </div>
              <div>
                <span className="font-medium">Date: </span>
                <span>
                  {currentDoc?.dated
                    ? formatDateTime12Hr(currentDoc.dated, ["saleOrder", "saleOrderView"].includes(type))
                    : "N/A"}
                </span>
              </div>
            </div>
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body,
  );
};

// A Sale Order line opened for edit/clone comes from the DB, so the item
// onChange that puts ltr_rate / item_name on the line never ran. Without them
// the LTR ⇄ KG conversion reads undefined and wrongly says "no LTR Rate set".
// Lift them off the included item so the line looks like one made in Create.
// A dispatch opened for edit has the same gap: its lines come from
// "Transactions" with the item under `itemDetails`, and without ltr_rate the
// Qty (KG) of a LTR line cannot be recomputed when the packs change.
// Sale Order "Order Type" dropdown is not a column — it is read back from the
// saved flags (Free of Cost / Trial / Rate Under Negotiation) when an order
// is opened for edit or clone. lib/orders/saleOrderApprovalRules.js
const SO_ORDER_TYPE_FORMS = new Set(["saleOrder", "saleOrderView", "saleOrderEdit"]);
const withSoOrderType = (enhancedData, rowData, type) => {
  if (!SO_ORDER_TYPE_FORMS.has(type) || !enhancedData?.master) return;
  enhancedData.master.soOrderType = orderTypeOf(rowData);
  for (const k of ["freeOfCost", "trialProcess", "rateUnderNegotiation", "dispatchWithoutGodown", "noGodown"]) {
    if (enhancedData.master[k] === undefined) enhancedData.master[k] = rowData?.[k] === true;
  }
  // Saved without a godown → show "No Godown" in the Godown dropdown
  if (rowData?.noGodown === true) enhancedData.master.godown = NO_GODOWN_OPTION;
  // Urgency Level select (OrderMaster.urgency_level) back on edit / clone
  // if (enhancedData.master.urgency_level === undefined) {
  //   enhancedData.master.urgency_level = rowData?.urgency_level ?? null;
  // }
  // Now an "Urgent" tick: ticked when the order was saved as Urgent
  // (or "High" from the earlier dropdown).
  // enhancedData.master.urgency_level = ["Urgent", "High"].includes(rowData?.urgency_level);
  // OrderMaster.urgency_level is Boolean
  enhancedData.master.urgency_level = rowData?.urgency_level === true;
};

const LTR_HYDRATE_TYPES = new Set(["saleOrder", "dispatch", "dispatchEdit", "saleReturn"]);
// The GRN screen (grnEdit is the same screen under its old URL).
const GRN_TYPES = new Set(["grn", "grnEdit"]);
const withLtrFields = (line, type) =>
  LTR_HYDRATE_TYPES.has(type)
    ? {
        ...line,
        // Old rows saved before units existed carry no unit: they are KG.
        unit: line.unit || "KG",
        ltr_rate:
          line.ltr_rate ?? line.items?.ltr_rate ?? line.itemDetails?.ltr_rate ?? null,
        item_name: line.item_name || line.items?.item || line.itemDetails?.item || "",
      }
    : line;

// Main table component with Bulk Printing
export default function VoucherTable({
  type = "voucher",
  refreshTrigger = 0,
  category = "",
  onSuccess,
}) {
  const { data: session } = useSession();
  const { currency } = useCurrency();
  const { company } = useCompany();

  const features = useFeatures();
  // A list column marked `feature: "<key>"` shows only while that switch is on.
  const TABLE_FIELDS = (VOUCHER_CONFIG[type]?.tableFields || []).filter((f) => !f?.feature || features.on(f.feature));
  // A type whose config already lists a "Created By" (user_id / userid) field
  // shows entered_by there instead of getting a second column.
  const hasUserField = TABLE_FIELDS.some(isUserField);

  // React Query Client
  const queryClient = useQueryClient();
  // Manual DC / GRN No set from the list (PATCH /api/voucher/[type]/manual-no):
  // GRN, Dispatch Return, and Dispatch while "dispatch.extraFields" is on.
  const tranCodeOfType = VOUCHER_CONFIG[type]?.tran_code;
  const manualNoEditable =
    [4, 10].includes(tranCodeOfType) || (tranCodeOfType === 6 && features.on("dispatch.extraFields"));

  // States
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(10);
  const [search, setSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [sortBy, setSortBy] = useState("dated");
  const [sortDir, setSortDir] = useState("desc");
  const [selectedRow, setSelectedRow] = useState(null);
  const [selectedRowIndex, setSelectedRowIndex] = useState(0);
  const [viewModalOpen, setViewModalOpen] = useState(false);
  const [isEditModal, setIsEditModal] = useState(false);
  const [mode, setMode] = useState("edit");
  const [isDownloadingPDF, setIsDownloadingPDF] = useState(false);

  // Unsaved child-doc drafts (SO → Dispatch, PO → GRN) live in localStorage under
  // `voucherForm_<type>__src_<order_no>` (see useFormCookies). Read during render;
  // closing the create modal flips isEditModal, which re-renders the badges.
  const hasSourceDraft = (orderNo) => {
    if (typeof window === "undefined" || orderNo == null) return false;
    try {
      return !!localStorage.getItem(`voucherForm_${type}__src_${orderNo}`);
    } catch {
      return false;
    }
  };

  // Print Preview States
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewPdfUrl, setPreviewPdfUrl] = useState("");
  const [previewTitle, setPreviewTitle] = useState("");
  const [currentDoc, setCurrentDoc] = useState(null);
  const [currentFileName, setCurrentFileName] = useState("");
  // Row whose attachments are open in the viewer.
  const [attachmentEntry, setAttachmentEntry] = useState(null);
  // "Edit header" on an invoiced document (Settings → Features, lib/vouchers/headerEdit.js).
  const [headerEntry, setHeaderEntry] = useState(null);
  const showAttachmentModal = !!attachmentEntry;
  // Vouchers whose form takes files: their rows can add files from here too.
  const takesAttachments = (VOUCHER_CONFIG[type]?.masterFields || []).some(
    (f) => f.type === "file" || f.type === "file-upload"
  );

  const [pendingModalOpen, setPendingModalOpen] = useState(false);
  const [enhancedData, setEnhancedData] = useState([]);
  const [documentStatus, setDocumentStatus] = useState({});
  const [statusLoading, setStatusLoading] = useState({});
  const [dateFilter, setDateFilter] = useState({
    startDate: "",
    endDate: "",
  });
  const [dateRange, setDateRange] = useState("all");

  // Bulk printing states
  const [selectedRows, setSelectedRows] = useState([]);
  const [bulkPrinting, setBulkPrinting] = useState(false);
  const [bulkPrintPreviewOpen, setBulkPrintPreviewOpen] = useState(false);
  const [bulkPrintData, setBulkPrintData] = useState([]);
  const [bulkPrintType, setBulkPrintType] = useState("");
  const [multiFilters, setMultiFilters] = useState({});

  // ✅ Fulfillment progress modal state (universal — SO, PO, Req, Dispatch, GRN, Transfer)
  const [fulfillmentModalOpen, setFulfillmentModalOpen] = useState(false);
  const [fulfillmentModalEntry, setFulfillmentModalEntry] = useState(null);

  // ✅ Return modal state (triggered from GRN/Dispatch table rows)
  const [isReturnModal, setIsReturnModal] = useState(false);
  const [returnOriginalData, setReturnOriginalData] = useState(null);

  const debouncedSearch = useDebounce(search, 500);

   // ?search=<no> in the URL (a notification click-through) pre-fills the
  // search box, so the list opens on that record. Only acts when the param is
  // present — without it nothing changes — and the user can edit/clear it.
  const urlParams = useSearchParams();
  const urlSearch = urlParams?.get("search");
  useEffect(() => {
    if (urlSearch == null || urlSearch === "") return;
    setSearch(urlSearch);
    setPage(1);
  }, [urlSearch]);

  // ?view=<tran_id> (a report's drill trail — voucherHref() in
  // lib/vouchers/voucherLink.js) opens that voucher's view window straight
  // away. It is fetched by id through this list's own API (same permission,
  // data scope and books filter), so it need not be on the current page or in
  // the date range. Orders are fetched by order_no. Edit / print stay governed
  // as for a list row: the same checkDocumentStatus, and Edit is off until it
  // has answered.
  const urlView = urlParams?.get("view");
  const [linkedView, setLinkedView] = useState(null); // { id, status }

  // Closing drops `view` from the URL without a reload or a history entry,
  // so Back still returns to the report that linked here.
  const clearViewParam = useCallback(() => {
    const url = new URL(window.location.href);
    if (!url.searchParams.has("view")) return;
    url.searchParams.delete("view");
    window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);

  useEffect(() => {
    if (urlView == null || urlView === "") return;
    const cfg = VOUCHER_CONFIG[type] || {};
    const name = voucherLabel(cfg.tran_code) || cfg.label || "Voucher";
    const id = Number(urlView);
    const isOrder = [400, 500, 600].includes(cfg.tran_code);
    if (!Number.isInteger(id) || id <= 0 || cfg.tran_code === 1000) {
      toast.error(`Can't open ${name} "${urlView}" from a link.`);
      clearViewParam();
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const api = cfg.differApi || `${isOrder ? "/api/orders/" : "/api/voucher/"}${type}`;
        const res = await axios.get(api, {
          params: isOrder
            ? { orderNo: id, page: 1, limit: 1 }
            : { id, page: 1, limit: 1 },
        });
        const row = res.data?.data?.[0];
        if (cancelled) return;
        if (!row) {
          toast.error(`${name} #${id} was not found, or you don't have access to it.`);
          clearViewParam();
          return;
        }
        const rowId = row.tran_id || row.id || row.order_no;
        setLinkedView({ id: rowId, status: { status: "Checking…", allowEdit: false } });
        setSelectedRow(row);
        setSelectedRowIndex(0);
        setViewModalOpen(true);
        checkDocumentStatus(row, type)
          .catch(() => ({ status: "Error", allowEdit: false, details: "Failed to load status" }))
          .then((status) => {
            if (!cancelled) setLinkedView((lv) => (lv?.id === rowId ? { id: rowId, status } : lv));
          });
      } catch (err) {
        if (cancelled) return;
        console.error("Open voucher from link failed:", err);
        const code = err?.response?.status;
        toast.error(
          code === 401 || code === 403
            ? `You don't have permission to view this ${name}.`
            : err?.response?.data?.message || `Could not open ${name} #${id}.`,
        );
        clearViewParam();
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [urlView, type, clearViewParam]);

  // However the window closes (Esc, X, Edit, Return …), leave link mode.
  useEffect(() => {
    if (viewModalOpen || !linkedView) return;
    setLinkedView(null);
    clearViewParam();
  }, [viewModalOpen, linkedView, clearViewParam]);

  // Build a stable string key for multiFilters so React Query refetches when they change
  const multiFiltersKey = useMemo(() => {
    const active = Object.entries(multiFilters).filter(
      ([, vals]) => vals && vals.length > 0,
    );
    return active.length > 0 ? JSON.stringify(Object.fromEntries(active)) : "";
  }, [multiFilters]);

  // Fetch data with React Query
  const fetchData = async ({ queryKey }) => {
    const [
      _,
      type,
      page,
      limit,
      search,
      filterStatus,
      sortBy,
      sortDir,
      startDate,
      endDate,
      refreshTrigger,
      multiFiltersStr,
    ] = queryKey;

    const api =
      VOUCHER_CONFIG[type].tran_code === 400 ||
        VOUCHER_CONFIG[type].tran_code === 600
        ? "/api/orders/"
        : VOUCHER_CONFIG[type].differApi
          ? VOUCHER_CONFIG[type].differApi
          : VOUCHER_CONFIG[type].tran_code === 1000
            ? "/api/material/"
            : "/api/voucher/";

    const params = {
      page,
      limit,
      search,
      filterStatus: filterStatus !== "all" ? filterStatus : undefined,
      sortBy,
      sortDir,
      ...(startDate && { startDate }),
      ...(endDate && { endDate }),
      ...(type === "sale" && { invoice_no_null: true }),
      ...(multiFiltersStr && { multiFilters: multiFiltersStr }),
    };

    const apiInsert = VOUCHER_CONFIG[type].differApi
      ? VOUCHER_CONFIG[type].differApi
      : `${api}${type}`;

    const response = await axios.get(apiInsert, { params });
    return response.data;
  };

  // React Query for main data
  const {
    data: queryData,
    isLoading,
    isError,
    error,
    isFetching,
    isPlaceholderData,
    refetch,
  } = useQuery({
    queryKey: [
      "vouchers",
      type,
      page,
      limit,
      debouncedSearch,
      filterStatus,
      sortBy,
      sortDir,
      dateFilter.startDate,
      dateFilter.endDate,
      refreshTrigger,
      multiFiltersKey,
    ],
    queryFn: fetchData,
    placeholderData: keepPreviousData,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 10, // 10 minutes
    retry: 3,
    retryDelay: 1000,
  });

  // Extract data from query result
  const data = useMemo(() => queryData?.data || [], [queryData]);
  const totalPages = queryData?.totalPages || 1;
  const totalData = queryData?.total || 0;
  const totalPendingInvoice = queryData?.totalNullInvoices || 0;

  // Data is already filtered server-side via multiFilters param
  const filteredData = data;
  // "Entered by" column: only for lists whose API sends entered_by (vouchers, orders).
  const showEnteredBy = !hasUserField && data.some((e) => e && "entered_by" in e);

  // Delete is a right few hold; everyone else gets "Request deletion" — a
  // reason, sent to Approvals (lib/approvals/deletions.js).
  // Settings → Features "approvals.deletionRequests": off = the plain Delete
  // button for everyone (the server refuses it without the right).
  const { can: canPerm, loading: permLoading } = usePermissions();
  const deletionRequestsOn = features.on("approvals.deletionRequests");
  const mayDeleteNow = !deletionRequestsOn || canPerm(`${type}.delete`);
  // Settings → Features "documents.invoicedEdit": the normal Edit opens on an
  // invoiced row (the save invoices it again — lib/invoicing/reinvoice.js);
  // imported old-system invoices stay locked. Delete still needs Reverse in Invoicing.
  const invoicedEditOn = features.on(INVOICED_EDIT_FEATURE);
  const editLockedFor = (entry) =>
    !!VOUCHER_CONFIG[type]?.invoiceLock && isInvoicedDoc(entry) && (!invoicedEditOn || entry?.invoice_series === LEGACY_SERIES);
  // "Edit header" on an invoiced row (Settings → Features documents.headerEdit)
  // — not needed while the whole document can be edited.
  const headerEditable =
    !invoicedEditOn && features.on(HEADER_EDIT_FEATURE) && headerEditFields(VOUCHER_CONFIG[type]?.tran_code).length > 0 && canPerm(`${type}.update`);
  const requestDeleteMutation = useMutation({
    mutationFn: async ({ rowData, reason }) => {
      const isOrder = ["purchaseOrder", "purchaseOrderEdit", "saleOrder", "serviceOrder"].includes(type);
      const { data } = await axios.post("/api/approvals/delete-requests", {
        type,
        id: isOrder ? rowData.order_no : rowData.tran_id,
        reason,
      });
      return data;
    },
    onSuccess: (data) => toast.success(data?.message || "Deletion requested — it waits on Approvals."),
    onError: (error) => toast.error(error?.response?.data?.error || "Could not send the deletion request"),
  });

  // Mutation for deleting a voucher
  const deleteMutation = useMutation({
    mutationFn: async (rowData) => {
      const api =
        type !== "purchaseOrder" &&
          type !== "purchaseOrderEdit" &&
          type !== "saleOrder" &&
          type !== "serviceOrder"
          ? "/api/voucher/"
          : "/api/orders/";

      const endpoint = `${api}${type}`;

      const payload =
        type !== "purchaseOrder" &&
          type !== "purchaseOrderEdit" &&
          type !== "saleOrder" &&
          type !== "serviceOrder"
          ? { tran_id: rowData.tran_id }
          : { order_no: rowData.order_no };

      const response = await axios.delete(endpoint, { data: payload });
      return response.data;
    },
    onSuccess: () => {
      // Invalidate and refetch
      queryClient.invalidateQueries({ queryKey: ["vouchers", type] });
      toast.success("Voucher deleted successfully");
    },
    onError: (error) => {
      console.error("Delete error:", error);
      toast.error("Failed to delete voucher");
    },
  });

  // Mutation for updating invoice numbers
  const updateInvoiceMutation = useMutation({
    mutationFn: async (updates) => {
      const response = await axios.post("/api/voucher/bulk-update-invoice", {
        updates,
      });
      return response.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["vouchers", type] });
      toast.success("Invoices updated successfully");
    },
    onError: (error) => {
      console.error("Update invoice error:", error);
      toast.error("Failed to update invoices");
    },
  });

  // Check document status when data changes
  useEffect(() => {
    const checkAllStatuses = async () => {

      const statusMap = {};
      const loadingMap = {};

      // Set all to loading initially
      data.forEach((item) => {
        const id = item.tran_id || item.id || item.order_no;
        loadingMap[id] = true;
      });
      setStatusLoading(loadingMap);

      // Check status for each document
      for (const item of data) {
        const id = item.tran_id || item.id || item.order_no;
        try {
          const statusInfo = await checkDocumentStatus(item, type);

          statusMap[id] = statusInfo;
        } catch (error) {
          console.error(`Failed to check status for ${id}:`, error);
          statusMap[id] = {
            status: "Error",
            allowEdit: false,
            details: "Failed to load status",
          };
        }
        // Update loading state for this item
        setStatusLoading((prev) => ({ ...prev, [id]: false }));
      }

      setDocumentStatus(statusMap);

    };

    if (data.length > 0 && !isLoading) {
      checkAllStatuses();
    }
  }, [data, isLoading, type]);

  // Prepare voucher data for PDF
  const prepareVoucherForPDF = (voucher, documentType = "sales") => {
    const customer = {
      name: voucher.acno?.acname || "Unknown",
      strn: "Not Available",
      ntn: "Not Available",
      address: voucher.godownDetails?.godown || "Not Provided",
    };

    const entries =
      voucher.transactions
        ?.filter((t) => t.sub_tran_id !== 3)
        .map((t, idx) => {
          const itemName =
            t.itemDetails?.item || t.acnoDetails?.acname || "Unknown";
          const batchNo = t.chno || "-";
          const qty = t.qty ?? 0;
          const unit =
            voucher.tran_code === 1 || voucher.tran_code === 2 ? "" : "KG";
          const rate = t.rate ?? (t.damt || t.camt || 0);
          const amount =
            voucher.tran_code === 1 || voucher.tran_code === 2
              ? t.damt || t.camt || 0
              : (t.qty ?? 0) * (t.rate ?? 0);

          if (documentType === "delivery") {
            return [
              idx + 1,
              itemName,
              batchNo,
              `${t.no_of_pack}x${t.qty_per_pack}=${qty}`,
            ];
          }

          return [idx + 1, itemName, batchNo, qty, unit, rate, amount];
        }) || [];

    const totalAmount = entries.reduce(
      (acc, row) => acc + (row.at(-1) || 0),
      0,
    );

    const totalSalesTax =
      voucher.transactions
        ?.filter((t) => t.sub_tran_id !== 3)
        .reduce((acc, t) => {
          const amount =
            voucher.tran_code === 1 || voucher.tran_code === 2
              ? t.damt || t.camt || 0
              : (t.qty ?? 0) * (t.rate ?? 0);
          const taxRate = (t.st_rate ?? 0) + (t.additional_tax ?? 0);
          return acc + amount * (taxRate / 100);
        }, 0) || 0;

    const grandTotal = totalAmount + totalSalesTax;

    const totals = {
      amount: totalAmount,
      tax: { label: "SALES TAX", value: totalSalesTax },
      grandTotal: { label: "GRAND TOTAL", value: grandTotal },
    };

    const invoice = {
      number: voucher.invoice_no || `INV-${voucher.vr_no}`,
      date: voucher.dated
        ? new Date(voucher.dated).toLocaleDateString("en-GB")
        : new Date().toLocaleDateString("en-GB"),
      po: "-",
      dueDate: "30 Days",
    };

    return {
      dated: voucher.dated,
      tran_code: voucher.tran_code,
      vr_no: voucher.vr_no,
      userId: voucher.userId,
      rmk: voucher.rmk,
      rmk1: voucher.rmk1,
      transactions: voucher.transactions,
      acno: voucher.acno,
      documentType,
      customer,
      entries,
      totals,
      invoice,
    };
  };

  // Handle bulk print
  const handleBulkPrint = async (printType, rows = []) => {
    const rowsToUse = rows.length > 0 ? rows : selectedRows;
    console.log("Selected Rows: ", rowsToUse);
    if (rowsToUse.length === 0) {
      toast.warning("Please select at least one record to print");
      return;
    }

    setBulkPrinting(true);
    try {
      const promises = rowsToUse.map(async (id) => {
        try {
          let apiUrl = "";

          if (type === "requisition") {
            apiUrl = `/api/material/requisition/${id}`;
          }

          // Determine API based on table type
          if (["purchaseOrder", "saleOrder", "serviceOrder"].includes(type)) {
            apiUrl = `/api/orders/getById?id=${id}`;
          } else if (type === "grn" || type === "dispatch") {
            apiUrl = `/api/material/getById?id=${id}`;
          } else {
            // dispatchEdit and other vouchers
            apiUrl = `/api/voucher/getById?id=${id}`;
          }

          const response = await axios.get(apiUrl);
          return {
            data: response.data.data,
            id: id,
          };
        } catch (error) {
          console.error(`Failed to fetch data for ID ${id}:`, error);
          return null;
        }
      });

      const results = await Promise.all(promises);
      const validData = results.filter((item) => item !== null);

      if (validData.length === 0) {
        toast.error("No valid data found for printing");
        return;
      }

      // Generate PDFs for all selected documents
      for (const item of validData) {
        const { data } = item;

        let pdfDoc;
        let fileName = "";

        // Determine document type and generate appropriate PDF
        const tranCode = data.tran_code || data.order_catagory;

        if (tranCode === 1000 || type === "requisition" || type === "requisitionTransfer" || type === "requisitionFGTransfer" || type === "dispatchTransfer" || type === "productionPlan") {
          pdfDoc = await generateRequisitionNotePDF(data, session, company, currency);
          fileName = `Requisition_${data.tran_id}.pdf`;
        }

        switch (tranCode) {
          // Financial Vouchers
          case 1: // Receipt
            pdfDoc = await generateVoucherPDF(data, company, currency);
            fileName = `Receipt_${data.vr_no}.pdf`;
            break;
          case 2: // Payment
            pdfDoc = await generateVoucherPDF(data, company, currency);
            fileName = `Payment_${data.vr_no}.pdf`;
            break;
          case 3: // Journal
            pdfDoc = await generateVoucherPDF(data, company, currency);
            fileName = `Journal_${data.vr_no}.pdf`;
            break;

          // Purchase Operations
          case 4: // Purchase Order
            if (printType === "purchase") {
              pdfDoc = await generatePurchaseOrderPDF({
                data: [data],
                company,
                currency,
              });
              fileName = `PurchaseOrder_${data.order_no}.pdf`;
            } else {
              pdfDoc = await generateVoucherPDF(data, company, currency);
              fileName = `Purchase_${data.vr_no}.pdf`;
            }
            break;

          // Sale Operations
          case 6: // Sale Order / Sale / Dispatch
            if (printType === "sales") {
              pdfDoc = await generateSalesTaxInvoicePDF({
                voucher: data,
                companyData: company,
                currencyData: currency
              });
              fileName = `${companyShortName(company?.name)}_SALES_TAX_INVOIVCE_${data.vr_no}.pdf`;
            } else if (printType === "commercialInvoice" && type === "dispatchEdit") {
              pdfDoc = await generateDeliveryNotePDF(data, session, currency, company);
              fileName = `${companyShortName(company?.name)}_DELIVERY_NOTE_${data.dispatch_no || data.vr_no}.pdf`;
            } else if (type === "dispatchEdit") {
              pdfDoc = await generateDeliveryNotePDF(data, session, currency, company);
              fileName = `${companyShortName(company?.name)}_DELIVERY_NOTE_${data.dispatch_no || data.vr_no}.pdf`;
            } else if (printType === "commercialInvoice") {
              pdfDoc = await generateCommercialInvoicePDF(data, session, currency, company);
              fileName = `${companyShortName(company?.name)}_COMMERCIAL_INVOICE_${data.vr_no}.pdf`;
            } else if (printType === "delivery") {
              const mappedData = prepareVoucherForPDF(data, "delivery");
              pdfDoc = generateUnifiedPDF(mappedData, company);
              fileName = `DeliveryNote_${data.vr_no}.pdf`;
            } else if (printType === "commission") {
              const mappedData = prepareVoucherForPDF(data, "commission");
              pdfDoc = generateUnifiedPDF(mappedData, company);
              fileName = `Commission_${data.vr_no}.pdf`;
            } else if (type === "sale" || type === "saleTax") {
              pdfDoc = await generateSalesTaxInvoicePDF({
                voucher: data,
                companyData: company,
                currencyData: currency
              });
              fileName = `${companyShortName(company?.name)}_SALES_TAX_INVOIVCE_${data.vr_no}.pdf`;
            } else {
              pdfDoc = await generateSalesOrderPDF({
                data: [data],
                company,
                currency,
              });
              fileName = `SalesOrder_${data.order_no}.pdf`;
            }
            break;

          // Return Operations
          case 9: // Purchase Return
            pdfDoc = await generateVoucherPDF(data, company, currency);
            fileName = `PurchaseReturn_${data.vr_no}.pdf`;
            break;
          case 10: // Sale Return
            pdfDoc = await generateVoucherPDF(data, company, currency);
            fileName = `SaleReturn_${data.vr_no}.pdf`;
            break;

          // Inventory Operations
          case 1000: // GRN/Dispatch
            pdfDoc = await generateVoucherPDF(data, company, currency);
            fileName = `GRN_${data.vr_no}.pdf`;
            break;

          // Default case - try to generate voucher PDF
          default:
            pdfDoc = await generateVoucherPDF(data, company, currency);
            fileName = `Document_${data.vr_no || data.order_no}.pdf`;
            break;
        }

        if (pdfDoc) {
          // Download PDF
          pdfDoc.save(fileName);

          // Small delay between downloads to avoid browser issues
          await new Promise((resolve) => setTimeout(resolve, 300));
        }
      }

      toast.success(`Successfully downloaded ${validData.length} documents`);
    } catch (error) {
      console.error("Bulk print failed:", error);
      toast.error("Failed to download documents");
    } finally {
      setBulkPrinting(false);
    }
  };

  const handleBulkPrintPreview = async (printType) => {
    console.log("print prevew")
    console.log("Selected Rows: ", selectedRows)
    if (selectedRows.length === 0) {
      toast.warning("Please select at least one record to print");
      return;
    }

    setBulkPrinting(true);
    try {
      const promises = selectedRows.map(async (id) => {
        try {
          let apiUrl = "";

          // Determine API based on table type
          if (["purchaseOrder", "saleOrder", "serviceOrder"].includes(type)) {
            apiUrl = `/api/orders/getById?id=${id}`;
          } else if (type === "grn" || type === "dispatch") {
            apiUrl = `/api/material/getById?id=${id}`;
          } else {
            // dispatchEdit and other vouchers
            apiUrl = `/api/voucher/getById?id=${id}`;
          }


          const response = await axios.get(apiUrl);


          return {
            data: response.data.data,
            id: id,
          };
        } catch (error) {
          console.error(`❌ Failed to fetch data for ID ${id}:`, error);
          return null;
        }
      });

      const results = await Promise.all(promises);
      const validData = results.filter((item) => item !== null);



      if (validData.length === 0) {
        toast.error("No valid data found for printing");
        return;
      }


      setBulkPrintData(validData);
      setBulkPrintType(printType);

      // Force a state update and then open modal
      setTimeout(() => {
        setBulkPrintPreviewOpen(true);

      }, 100);



    } catch (error) {
      console.error("❌ Bulk print preview failed:", error);
      toast.error("Failed to prepare bulk print preview");
    } finally {
      setBulkPrinting(false);

    }
  };

  // Universal PDF Generator
  const generateUniversalPDF = async (data, printType = "document") => {
    const tranCode = data.tran_code || data.order_catagory;

    try {
      if (data.req_catagory) {
        return generateRequisitionNotePDF(data);
      }
      switch (tranCode) {
        case 1: // Receipt
          return await generateVoucherPDF(data, company, currency);
        case 2: // Payment
          return await generateVoucherPDF(data, company, currency);
        case 3: // Journal
          return await generateVoucherPDF(data, company, currency);
        case 4: // Purchase Order
          if (printType === "purchase") {
            return await generatePurchaseOrderPDF({
              data: [data],
              company,
              currency,
            });
          }
          return await generateVoucherPDF(data, company, currency);
        case 6: // Sale / Dispatch
          if (printType === "commercialInvoice" && type === "dispatchEdit") {
            return await generateDeliveryNotePDF(data, session, currency, company);
          } else if (type === "dispatchEdit") {
            return await generateDeliveryNotePDF(data, session, currency, company, "preview");
          } else if (printType === "sales" || (printType === "preview" && type === "sale")) {
            return await generateSalesTaxInvoicePDF({
              voucher: data,
              session,
              currencyData: currency,
              companyData: company
            });
          } else if (printType === "delivery") {
            const mappedData = prepareVoucherForPDF(data, "delivery");
            return generateUnifiedPDF(mappedData, company);
          } else if (printType === "commission") {
            const mappedData = prepareVoucherForPDF(data, "commission");
            return generateUnifiedPDF(mappedData, company);
          }
          return await generateSalesOrderPDF({
            data: [data],
            company,
            currency,
          });
        case 9: // Purchase Return
        case 10: // Sale Return
        case 1000: // GRN/Dispatch
          return await generateVoucherPDF(data, company, currency);
        default:
          return await generateVoucherPDF(data, company, currency);
      }
    } catch (error) {
      console.error(`PDF generation failed for document:`, error);
      throw error;
    }
  };

  // Universal Bulk Print Options
  const getBulkPrintOptions = () => {
    const currentType = type;

    // Common options for all types
    const commonOptions = [
      { value: "preview", label: "Preview", icon: Eye },
      { value: "download", label: "Print", icon: Printer },
      { value: "commercialInvoice", label: "Commercial", icon: Printer },
    ];

    // Type-specific options
    const typeSpecificOptions = {
      // Sale related
      sale: [
        // { value: "sales", label: "Sales Invoice", icon: Receipt },
        // { value: "delivery", label: "Delivery Note", icon: Package },
        // { value: "commission", label: "Commission Invoice", icon: DollarSign },
      ],
      saleOrder: [
        { value: "sales", label: "Sales Order", icon: Receipt },
        { value: "delivery", label: "Delivery Note", icon: Package },
      ],

      // Purchase related
      purchase: [
        { value: "purchase", label: "Purchase Invoice", icon: Receipt },
        { value: "delivery", label: "GRN Note", icon: Package },
      ],
      purchaseOrder: [
        { value: "purchase", label: "Purchase Order", icon: Receipt },
        { value: "delivery", label: "GRN Note", icon: Package },
      ],

      // Financial vouchers
      payment: [{ value: "voucher", label: "Payment Voucher", icon: Receipt }],
      receipt: [{ value: "voucher", label: "Receipt Voucher", icon: Receipt }],
      journal: [{ value: "voucher", label: "Journal Voucher", icon: Receipt }],

      // Returns
      purchaseReturn: [
        { value: "return", label: "Purchase Return", icon: Receipt },
        { value: "delivery", label: "Return Note", icon: Package },
      ],
      saleReturn: [
        { value: "return", label: "Sale Return", icon: Receipt },
        { value: "delivery", label: "Return Note", icon: Package },
      ],

      // Inventory
      grn: [{ value: "grn", label: "GRN Document", icon: Package }],
      dispatch: [{ value: "dispatch", label: "Dispatch Note", icon: Package }],

      // Default for unknown types
      default: [{ value: "document", label: "Document", icon: FileText }],
    };

    // Get options for current type or use default
    const specificOptions =
      typeSpecificOptions[currentType] || typeSpecificOptions.default;

    return [...commonOptions, ...specificOptions];
  };

  const downloadVoucherPDF = async (
    tranId,
    tran_code,
    orderId,
    req_catagory,
    order_catagory,
    orderData = null,
  ) => {
    setIsDownloadingPDF(true);
    try {
      if (order_catagory === 6) {
        const res = await axios.get(
          `/api/orders/saleOrder?orderNo=${orderId}&order_catagory=6`,
        );
        orderData = res.data.data[0];
        const doc = await generateSalesOrderPDF(
          { data: [orderData] },
          session,
          currency,
          company,
          "preview",
        );
        const blobUrl = doc.output("bloburl");
        setPreviewPdfUrl(blobUrl);
        setPreviewTitle(`Sales Order - ${orderData.order_no}`);
        setCurrentDoc(doc);
        setCurrentFileName(`SalesOrder_${orderData.order_no}.pdf`);
        setIsPreviewOpen(true);
      } else if (order_catagory === 4) {
        const res = await axios.get(
          `/api/orders/purchaseOrder?orderNo=${orderId}&order_catagory=4`,
        );
        orderData = res.data.data[0];

        const doc = await generatePurchaseOrderPDF(
          { data: [orderData] },
          session,
          currency,
          company,
          "preview",
        );
        const blobUrl = doc.output("bloburl");
        setPreviewPdfUrl(blobUrl);
        setPreviewTitle(`Purchase Order - ${orderData.order_no}`);
        setCurrentDoc(doc);
        setCurrentFileName(`PurchaseOrder_${orderData.order_no}.pdf`);
        setIsPreviewOpen(true);
      } else if (req_catagory) {
        const res = await axios.get(`/api/material/requisition/${tranId}`);
        const data = res.data;
        
        let doc;
        let fileName;
        let title;
        if (type === "productionPlan" || type === "dispatchTransfer") {
          doc = await generateProductionPlan(
            data,
            session,
            company,
            currency,
            "preview",
          );
          fileName = `ProductionPlan_${tranId}.pdf`;
          title = `Production Plan - ${tranId}`;
        } else {
          doc = await generateRequisitionNotePDF(
            data,
            session,
            company,
            currency,
            "preview",
          );
          fileName = `RequisitionNote_${tranId}.pdf`;
          title = `Material Requisition - ${tranId}`;
        }

        const blobUrl = doc.output("bloburl");
        setPreviewPdfUrl(blobUrl);
        setPreviewTitle(title);
        setCurrentDoc(doc);
        setCurrentFileName(fileName);
        setIsPreviewOpen(true);
        // const doc = await generateRequisitionNotePDF(
        //   data,
        //   session,
        //   company,
        //   currency,
        //   "preview",
        // );

        // const blobUrl = doc.output("bloburl");
        // setPreviewPdfUrl(blobUrl);
        // setPreviewTitle(`Material Requisition - ${tranId}`);
        // setCurrentDoc(doc);
        // setCurrentFileName(`RequisitionNote_${tranId}.pdf`);
        // setIsPreviewOpen(true);
      } else if (GRN_TYPES.has(type) && Number(tran_code) === 4) {
        if (!tranId) throw new Error("Transaction ID required");
        const doc = await generateGRNPDF(tranId, session, currency, company);
        setPreviewPdfUrl(doc.output("bloburl"));
        setPreviewTitle(`Goods Receipt Note - ${tranId}`);
        setCurrentDoc(doc);
        setCurrentFileName(`GRN_${tranId}.pdf`);
        setIsPreviewOpen(true);
      } else {
        if (!tranId) throw new Error("Transaction ID required");

        const res = await axios.get(`/api/voucher/getById?id=${tranId}`);
        const data = res.data.data;

        if (data && "tran_no" in data) {
          delete data.tran_no;
        }

        // ✅ Check tran_code or type before generating PDF
        let doc;
        let fileName = "Document.pdf";
        let title = "Report";

        if (data.tran_code === 6 || type === "dispatch") {
          doc = await generateDeliveryNotePDF(
            data.tran_id || tranId,
            session,
            currency,
            company,
            "preview",
          );
          fileName = `${companyShortName(company?.name)}_DELIVERY_NOTE_${data.vr_no || tranId}.pdf`;
          title = `${companyShortName(company?.name)} Delivery Note - ${data.vr_no || tranId}`;
        } else if (type === "requisition" || type === "requisitionTransfer" || type === "requisitionFGTransfer" || type === "dispatchTransfer" || type === "productionPlan") {
          doc = await generateRequisitionNotePDF(
            data,
            session,
            company,
            currency,
            "preview",
          );
          fileName = `RequisitionNote_${data.tran_id || tranId}.pdf`;
          title = `Material Requisition - ${data.tran_id || tranId}`;
        } else {
          doc = await generateVoucherPDF(data, company, currency, "preview");
          const name =
            data.tran_code === 2
              ? "PaymentVoucher"
              : data.tran_code === 1
                ? "ReceiptVoucher"
                : "JournalVoucher";
          fileName = `${name}_${data.vr_no}.pdf`;
          title = `${name} - ${data.vr_no}`;
        }

        const blobUrl = doc.output("bloburl");
        setPreviewPdfUrl(blobUrl);
        setPreviewTitle(title);
        setCurrentDoc(doc);
        setCurrentFileName(fileName);
        setIsPreviewOpen(true);
      }
    } catch (err) {
      console.error(err);
    } finally {
      setIsDownloadingPDF(false);
    }
  };

  const handleDownloadFromPreview = () => {
    if (currentDoc && currentFileName) {
      currentDoc.save(currentFileName);
    }
  };

  const handlePendingSuccess = useCallback(() => {
    refetch();
  }, [refetch]);

  const formatCellContent = useCallback((value, field) => {
    if (value == null) return "-";
    switch (field.type) {
      case "date":
        return formatDateTime12Hr(value, ["saleOrder", "saleOrderView"].includes(type));
      case "currency":
        return `$${Number(value).toLocaleString("en-US", {
          minimumFractionDigits: 2,
        })}`;
      case "status":
        return <StatusBadge status={value} />;
      default:
        return value.toString();
    }
  }, []);

  const handleRowClick = (rowData, rowIndex) => {
    setSelectedRow(rowData);
    setSelectedRowIndex(rowIndex ?? 0);
    setViewModalOpen(true);
  };

  const handleDeleteClick = async (rowData) => {
    if (!mayDeleteNow) {
      const reason = window.prompt("Why should this entry be deleted? (The approver will see this reason.)");
      if (reason === null) return;
      if (reason.trim().length < 5) {
        toast.error("Please give the reason for deleting it.");
        return;
      }
      requestDeleteMutation.mutate({ rowData, reason: reason.trim() });
      return;
    }
    if (!window.confirm("Delete this voucher?")) return;
    deleteMutation.mutate(rowData);
  };

  // ✅ Return handler: fetches full transaction and opens return modal
  const handleReturnClick = async (rowData) => {
    try {
      const tranId = rowData?.tran_id;
      if (!tranId) return;
      toast.info("Loading transaction for return...");
      const response = await axios.get(`/api/voucher/original-for-return?tran_id=${tranId}`);
      const txn = response.data?.data?.[0];
      if (!txn) {
        toast.error("Could not load transaction data.");
        return;
      }
      setReturnOriginalData(txn);
      setIsReturnModal(true);
    } catch (err) {
      console.error("Return fetch error:", err);
      toast.error("Failed to load transaction for return.");
    }
  };

  // Row Print / Edit / Return — used by the row icons and the view modal's footer.
  const canPrintEntry = (entry) =>
    !!VOUCHER_CONFIG[type].allowPrint &&
    ((entry.tran_code === 4 && GRN_TYPES.has(type)) ||
      entry.tran_code === 1 ||
      entry.tran_code === 2 ||
      entry.tran_code === 3 ||
      entry.tran_code === 6 ||
      entry.tran_code === 400 ||
      !!entry.req_catagory ||
      entry.order_catagory === 6 ||
      entry.order_catagory === 4);

  const printEntry = (entry) =>
    entry.tran_code === 6 && type === "sale"
      ? handleBulkPrint("sales", [entry.tran_id])
      : downloadVoucherPDF(
          entry.tran_id,
          entry.tran_code,
          entry.order_no,
          entry.req_catagory,
          entry.order_catagory,
          entry.order_catagory === 6 || entry.order_catagory === 4 ? entry : null,
        );

  const viewActionsFor = (entry) => {
    if (!entry) return null;
    const cfg = VOUCHER_CONFIG[type];
    const id = entry.tran_id || entry.id || entry.order_no;
    const statusInfo =
      documentStatus[id] ||
      (linkedView?.id === id && linkedView.status) || { status: "", allowEdit: true };
    const invoiceLocked = editLockedFor(entry);
    return {
      edit: cfg.allowEdit
        ? {
            disabled: !statusInfo.allowEdit || invoiceLocked,
            title: invoiceLocked
              ? `Invoiced (${docInvoiceRef(entry)}) — unlock it in Invoicing first`
              : !statusInfo.allowEdit
                ? `${statusInfo.status} - Cannot Edit`
                : "Edit (E)",
            run: () => {
              setViewModalOpen(false);
              handleEditClick(entry, "edit");
            },
          }
        : null,
      print: canPrintEntry(entry)
        ? {
            disabled: isDownloadingPDF,
            run: () => {
              // The sales-invoice preview opens under this modal — close it first.
              if (entry.tran_code === 6 && type === "sale") setViewModalOpen(false);
              printEntry(entry);
            },
          }
        : null,
      ret: cfg.allowReturn
        ? {
            label: `Create ${cfg.returnType === "grnReturn" ? "GRN Return" : "Dispatch Return"}`,
            run: () => {
              setViewModalOpen(false);
              handleReturnClick(entry);
            },
          }
        : null,
    };
  };

  const handleEditClick = async (rowData, mode) => {
      console.log("ROW DATA:", rowData);

    setSelectedRow(rowData);
    setMode(mode);
    // Drop the previous row's data before the modal mounts — the source fetch
    // below is async, and the Form must never see (or draft-restore) another
    // SO/PO's data while this one is still loading.
    setEnhancedData(null);
    setIsEditModal(true);
const requisitionTypes = [
  "requisition",
  "requisitionTransfer",
  "requisitionFGTransfer",
  "dispatchTransfer",
  "productionPlan"
];

const orderTypes = [
  "purchaseOrder",
  "purchaseOrderEdit",
  "saleOrder",
  "serviceOrder",
];
    let enhancedData = {
      voucherId: rowData?.tran_id || rowData?.id || "",
      master: rowData ? Object.fromEntries(Object.entries(rowData)) : {},
      lines:requisitionTypes.includes(type)
  ? rowData?.details?.map(({ ...rest }) => rest) || []
  : orderTypes.includes(type)
    ? rowData?.orderDetails?.map(({ ...rest }) => withLtrFields(rest, type)) || []
          : rowData?.lines?.length
            ? rowData.lines.map(({ ...rest }) => rest)
            : rowData?.details?.length
              ? rowData.details.map(({ ...rest }) => rest)
        : type === "inBond"
        ? rowData?.transactions?.map(({ ...rest }) => rest) || []
    : rowData?.transactions
        ?.filter((t) => t.sub_tran_id === 1)
        .map(({ ...rest }) => withLtrFields(rest, type)) || [],
      deductions:
        rowData?.transactions
          ?.filter((t) => t.sub_tran_id === 2)
          .map(({ ...rest }) => rest) || [],
    };



    const config = VOUCHER_CONFIG[type];
    if (config.sourceMapping) {


      try {
        let sourceId,
          sourceType,
          sourceApi,
          sourceCallData = null;
        if (type === "purchaseOrder" && rowData.tran_id) {
          sourceId = rowData.tran_id;
          sourceType = "requisition";
          sourceApi = `/api/material/requisition/${sourceId}`;

        } else if (type === "transfer" || type==="fgTransfer" && rowData.tran_id) {
          sourceId = rowData.tran_id;
          sourceType = "requisition";
          sourceApi = `/api/material/requisition/${sourceId}`;

        } else if (type === "grn" && rowData.order_no) {
          sourceId = rowData.order_no;
          sourceType = "purchaseOrder";
          sourceApi = `/api/orders/purchaseOrder?orderNo=${sourceId}`;
          sourceCallData = 0;
        } else if (type === "dispatch" && rowData.order_no) {
          sourceId = rowData.order_no;
          sourceType = "saleOrder";
          sourceApi = `/api/orders/saleOrder?orderNo=${sourceId}`;
          sourceCallData = 0;
        } else if (type === "saleOrder" && rowData.order_no) {
          sourceId = rowData.order_no;
          sourceType = "saleOrder";
          sourceApi = `/api/orders/saleOrder?orderNo=${sourceId}`;
          sourceCallData = 0;
        }

        if (sourceId) {

          const response = await axios.get(sourceApi);

          const sourceData =
            sourceCallData !== null
              ? response.data.data[sourceCallData]
              : response.data;

          // ✅ Map to enhance existingData
          const mapped = await mapSourceToForm(
            sourceData,
            config.sourceMapping,
            type,
          );

          enhancedData.master = {
            ...mapped.master,
            // Keep what this document saved: the qty checks give its own saved
            // lines back on edit (saved godown / SO), so they need these.
            transactions: rowData?.transactions,
            godownDetails: rowData?.godownDetails,
            ordersSO: rowData?.ordersSO,
          };
          enhancedData.lines = [...mapped.lines]; // Merge/override lines
          toast.success(`Populated from ${sourceType} #${sourceId}`);
        }

        withSoOrderType(enhancedData, rowData, type);
        setEnhancedData(enhancedData);
      } catch (error) {
        console.error("Failed to populate from source:", error);
        toast.warning(
          "Could not auto-populate from source; using existing data.",
        );
      }
    }

    withSoOrderType(enhancedData, rowData, type);
    setEnhancedData(enhancedData);
  };

  const handleCloneClick = async (rowData) => {
    setSelectedRow(rowData);
    setMode("clone");
    setIsEditModal(true);

    const requisitionTypes = [
  "requisition",
  "requisitionTransfer",
  "requisitionFGTransfer",
  "dispatchTransfer",
  "productionPlan"
];

const orderTypes = [
  "purchaseOrder",
  "purchaseOrderEdit",
  "saleOrder",
  "serviceOrder",
];

    let enhancedData = {
      voucherId: "",
      master: {
        ...Object.fromEntries(
          Object.entries(rowData).filter(
            ([k]) =>
              ![
                'tran_id', 'vr_no', 'id', 'order_no', 'attachments',
                // a clone is a new document: it gets its own numbers
                'invoice_no', 'invoice_series', 'grn_no', 'dispatch_no',
                ...(VOUCHER_CONFIG[type]?.cloneOmit || []),
              ].includes(k)
          )
        ),
        dated: new Date().toISOString().split('T')[0],
      },
      // lines:
      //   type !== "purchaseOrder" &&
      //     type !== "purchaseOrderEdit" &&
      //     type !== "saleOrder" &&
      //     type !== "serviceOrder"
      //     ? rowData?.transactions
      //       ?.filter((t) => t.sub_tran_id === 1)
      //       .map(({ tran_id, vr_no, id, order_no, ...rest }) => rest) || []
      //     : rowData?.orderDetails?.map(({ tran_id, vr_no, id, order_no, ...rest }) => rest) ||
      //     rowData?.details?.map(({ tran_id, vr_no, id, order_no, ...rest }) => rest) ||
      //     [],
      lines:requisitionTypes.includes(type)
  ? rowData?.details?.map(({ tran_id, vr_no, id, order_no, ...rest }) => rest) || []
  : orderTypes.includes(type)
    ? rowData?.orderDetails?.map(({ tran_id, vr_no, id, order_no, ...rest }) => withLtrFields(rest, type)) || []
          : rowData?.lines?.length
            ? rowData.lines.map(({ tran_id, vr_no, id, order_no, ...rest }) => rest)
            : rowData?.details?.length
              ? rowData.details.map(({ tran_id, vr_no, id, order_no, ...rest }) => rest)
        : type === "inBond"
        ? rowData?.transactions?.map(({ tran_id, vr_no, id, order_no, ...rest }) => rest) || []
    : rowData?.transactions
        ?.filter((t) => t.sub_tran_id === 1)
        .map(({ tran_id, vr_no, id, order_no, ...rest }) => withLtrFields(rest, type)) || [],
      deductions:
        rowData?.transactions
          ?.filter((t) => t.sub_tran_id === 2)
          .map(({ tran_id, vr_no, id, order_no, ...rest }) => rest) || [],
    };
    withSoOrderType(enhancedData, rowData, type);
    setEnhancedData(enhancedData);
  };

  const handleSort = (field) => {
    if (sortBy === field) {
      setSortDir(sortDir === "asc" ? "desc" : "asc");
    } else {
      setSortBy(field);
      setSortDir("desc");
    }
    setPage(1);
  };

  const handlePageChange = (newPage) => {
    if (newPage >= 1 && newPage <= totalPages) setPage(newPage);
  };

  const handleLimitChange = (value) => {
    setLimit(Number(value));
    setPage(1);
  };

  // ── Keyboard shortcuts ──────────────────────────────────────────────────
  // Same pattern as ProductionTab: the list owns these only while none of its
  // own overlays are open, so a dialog's Escape is never stolen from it.
  const searchInputRef = useRef(null);

  const focusSearch = useCallback(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, []);

  const anyOverlayOpen =
    viewModalOpen ||
    isEditModal ||
    isReturnModal ||
    isPreviewOpen ||
    pendingModalOpen ||
    showAttachmentModal ||
    bulkPrintPreviewOpen ||
    fulfillmentModalOpen;

  useKeyboardShortcuts(
    {
      "/": focusSearch,
      "alt+arrowleft": { handler: () => handlePageChange(page - 1), allowInInput: true },
      "alt+arrowright": { handler: () => handlePageChange(page + 1), allowInInput: true },
      "alt+r": { handler: () => refetch(), allowInInput: true },
      escape: {
        handler: () => {
          if (search) setSearch("");
          searchInputRef.current?.blur();
        },
        allowInInput: true,
      },
    },
    !anyOverlayOpen,
  );

  const TABLE_SHORTCUTS = [
    { combo: "Alt+N", label: VOUCHER_CONFIG[type]?.buttonText || "New voucher" },
    { combo: "/", label: "Focus search" },
    { combo: "Alt+Left", label: "Previous page" },
    { combo: "Alt+Right", label: "Next page" },
    { combo: "Alt+R", label: "Refresh the list" },
    { combo: "Esc", label: "Clear search" },
    { combo: "Shift+?", label: "Show this help" },
  ];

  const toggleRowSelection = (id) => {
    setSelectedRows((prev) =>
      prev.includes(id) ? prev.filter((rowId) => rowId !== id) : [...prev, id],
    );
  };

  const pageNumbers = useMemo(() => {
    const maxPages = 5;
    let start = Math.max(1, page - Math.floor(maxPages / 2));
    let end = Math.min(totalPages, start + maxPages - 1);
    if (end - start + 1 < maxPages) start = Math.max(1, end - maxPages + 1);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  }, [page, totalPages]);

  // Conditional render for sale type
  // Date presets (Today / This week / This month / Custom) — the toolbar's
  // buttons call this; same ranges the old drop-down set.
  const applyDateRange = (value) => {
    setDateRange(value);
    const today = new Date();
    let startDate = "";
    let endDate = "";
    switch (value) {
      case "today":
        startDate = today.toISOString().split("T")[0];
        endDate = today.toISOString().split("T")[0];
        break;
      case "week": {
        const weekStart = new Date(today);
        weekStart.setDate(today.getDate() - today.getDay());
        startDate = weekStart.toISOString().split("T")[0];
        endDate = today.toISOString().split("T")[0];
        break;
      }
      case "month": {
        const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
        startDate = monthStart.toISOString().split("T")[0];
        endDate = today.toISOString().split("T")[0];
        break;
      }
      case "custom":
        // Custom: the user picks both dates
        return;
      default:
        startDate = "";
        endDate = "";
    }
    setDateFilter({ startDate, endDate });
  };

  return (
    <div className="p-0 bg-transparent min-h-screen">
      <div className="max-w-full space-y-6">
        {/* Header with Pending Management Button */}
        {type === "sale" && (
          <div className="rounded-xl border border-border bg-white overflow-hidden">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 px-7 py-6">
              {/* Left: Title & Info */}
              <div className="flex items-start gap-4">
                <div className="p-3 bg-primary/10 rounded-xl flex-shrink-0">
                  <Receipt className="h-6 w-6 text-primary" />
                </div>
                <div>
                  <h1 className="text-lg font-semibold text-foreground tracking-tight">
                    Sale Management
                  </h1>
                  <p className="text-sm text-muted-foreground mt-1">
                    Showing sales without assigned invoice numbers
                  </p>
                </div>
              </div>

              {/* Right: Stats + Button */}
              <div className="flex items-center gap-4 flex-shrink-0">
                {/* Pending Count Badge */}
                <div className="flex items-center gap-3 bg-muted/50 rounded-xl px-4 py-2.5 border border-border/60">
                  <div className="flex flex-col items-center">
                    <span className="text-2xl font-bold text-primary leading-none tabular-nums">
                      {totalPendingInvoice || 0}
                    </span>
                    <span className="text-[10px] uppercase tracking-widest text-muted-foreground font-medium mt-1">
                      Pending
                    </span>
                  </div>
                  <div className="w-px h-8 bg-border/80"></div>
                  <div className="flex flex-col items-center">
                    <Clock className="h-4 w-4 text-amber-500 mb-0.5" />
                    <span className="text-[10px] text-muted-foreground font-medium">
                      Awaiting
                    </span>
                  </div>
                </div>

                <Button
                  onClick={() => setPendingModalOpen(true)}
                  className="bg-primary hover:bg-primary/90 text-primary-foreground px-5 py-2.5 rounded-xl shadow-sm flex items-center gap-2 h-auto"
                >
                  <FilePlus className="h-4 w-4" />
                  <span className="font-medium">Assign Invoices</span>
                </Button>
              </div>
            </div>
          </div>
        )}

        {isError && (
          <Alert variant="destructive">
            <AlertCircle className="h-4 w-4" />
            <AlertTitle>Error</AlertTitle>
            <AlertDescription>
              {error?.message || "Failed to load data"}
            </AlertDescription>
          </Alert>
        )}

        {/* List card: toolbar, bulk bar, table, paging */}
        {TABLE_FIELDS.length > 0 && (
        <div className="overflow-hidden rounded-xl border border-border bg-background">
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            {/* Search */}
            <div className="relative min-w-[220px] flex-1 sm:max-w-sm">
              <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                ref={searchInputRef}
                placeholder="Search…"
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                className="h-10 rounded-lg bg-background pl-9 pr-16 text-foreground"
              />
              {isFetching ? (
                <RefreshCw className="absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 animate-spin text-muted-foreground" />
              ) : (
                <kbd className="pointer-events-none absolute right-2.5 top-1/2 hidden -translate-y-1/2 rounded border border-b-2 border-border bg-background px-1.5 font-mono text-[11px] font-semibold text-muted-foreground sm:inline">
                  /
                </kbd>
              )}
            </div>

            {/* Date presets */}
            <div role="group" aria-label="Date range" className="inline-flex flex-wrap gap-0.5 rounded-lg bg-muted p-1">
              {[
                ["all", "All dates"],
                ["today", "Today"],
                ["week", "This week"],
                ["month", "This month"],
                ["custom", "Custom…"],
              ].map(([value, label]) => (
                <button
                  key={value}
                  type="button"
                  onClick={() => applyDateRange(value)}
                  aria-pressed={dateRange === value}
                  className={`h-8 rounded-md px-3 text-[13px] font-semibold transition-colors ${
                    dateRange === value
                      ? "bg-primary text-primary-foreground shadow-sm"
                      : "text-muted-foreground hover:text-primary"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>

            {/* Custom dates */}
            {dateRange === "custom" && (
              <div className="flex items-center gap-2">
                <Input
                  type="date"
                  aria-label="From date"
                  value={dateFilter.startDate}
                  onChange={(e) =>
                    setDateFilter((prev) => ({ ...prev, startDate: e.target.value }))
                  }
                  className="h-10 w-auto"
                />
                <span className="text-sm text-muted-foreground">to</span>
                <Input
                  type="date"
                  aria-label="To date"
                  value={dateFilter.endDate}
                  onChange={(e) =>
                    setDateFilter((prev) => ({ ...prev, endDate: e.target.value }))
                  }
                  className="h-10 w-auto"
                />
              </div>
            )}

            {(dateFilter.startDate || dateFilter.endDate) && (
              <Button
                variant="ghost"
                size="sm"
                onClick={() => {
                  setDateFilter({ startDate: "", endDate: "" });
                  setDateRange("all");
                }}
                className="h-9 text-muted-foreground"
              >
                <X className="mr-1 h-4 w-4" />
                Clear dates
              </Button>
            )}

            <div className="ml-auto flex items-center gap-2">
              {/* Select the page — the only way to pick rows where the
                  table has no tick column (allowCheck off) */}
              {!VOUCHER_CONFIG[type].allowCheck && (
                <label className="flex cursor-pointer items-center gap-2 text-sm text-muted-foreground">
                  <Checkbox
                    checked={selectedRows.length === data.length && data.length > 0}
                    onCheckedChange={(checked) => {
                      if (checked) {
                        setSelectedRows(data.map((item) => item.tran_id || item.id));
                      } else {
                        setSelectedRows([]);
                      }
                    }}
                  />
                  Select page
                </label>
              )}
              {/* Cheat sheet — also opens with Shift+? */}
              {!anyOverlayOpen && <KeyboardHint shortcuts={TABLE_SHORTCUTS} />}
            </div>
          </div>

          {/* Bulk bar — shown while rows are ticked */}
          {selectedRows.length > 0 && (
            <div className="flex flex-wrap items-center gap-3 border-b border-primary/15 bg-primary/5 px-4 py-2 text-sm font-semibold text-primary">
              {selectedRows.length} selected
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button variant="outline" size="sm" disabled={bulkPrinting} className="h-8 bg-background">
                    {bulkPrinting ? (
                      <RefreshCw className="mr-2 h-4 w-4 animate-spin" />
                    ) : (
                      <Printer className="mr-2 h-4 w-4" />
                    )}
                    Bulk Print ({selectedRows.length})
                    <ChevronDown className="ml-2 h-4 w-4" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent className="w-64">
                  <DropdownMenuLabel className="text-xs font-semibold">
                    Print Options - {selectedRows.length} Selected
                  </DropdownMenuLabel>
                  <DropdownMenuSeparator />
                  {getBulkPrintOptions().map((option) => (
                    <DropdownMenuItem
                      key={option.label}
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        if (option.value === "preview") {
                          handleBulkPrintPreview("document");
                        } else if (option.value === "download") {
                          handleBulkPrint("document");
                        } else {
                          handleBulkPrint(option.value);
                        }
                      }}
                      className="flex items-center space-x-2"
                    >
                      <option.icon className="h-4 w-4" />
                      <span>{option.label}</span>
                    </DropdownMenuItem>
                  ))}
                </DropdownMenuContent>
              </DropdownMenu>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setSelectedRows([])}
                className="ml-auto h-8 text-muted-foreground"
              >
                <X className="mr-1 h-4 w-4" />
                Clear selection
              </Button>
            </div>
          )}

          <div className="overflow-x-auto">
            <Table className="vl-grid">
              <TableHeader>
                <TableRow className="border-b-0 bg-primary hover:bg-primary [&_[role=checkbox]]:border-primary-foreground">
                  {VOUCHER_CONFIG[type].allowCheck && (
                    <TableHead className="w-12 px-4 py-2 text-center">
                      <Checkbox
                        checked={
                          selectedRows.length === data.length && data.length > 0
                        }
                        onCheckedChange={(checked) => {
                          if (checked) {
                            setSelectedRows(
                              data.map((item) => item.tran_id || item.id),
                            );
                          } else {
                            setSelectedRows([]);
                          }
                        }}
                      />
                    </TableHead>
                  )}
                  {TABLE_FIELDS.map((field, idx) => {
                    const isSortable = ["dated", "vr_no"].includes(field.name);
                    return (
                      <TableHead
                        key={idx}
                        onClick={
                          isSortable ? () => handleSort(field.name) : undefined
                        }
                        className={`h-10 px-3 py-2 text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground select-none ${isSortable ? "cursor-pointer hover:text-primary-foreground/80" : ""
                          }`}
                      >
                        <div className="flex items-center gap-1 flex-wrap">
                          {field.label}
                          {sortBy === field.name &&
                            (sortDir === "asc" ? (
                              <ArrowUp className="h-3 w-3 ml-1 inline" />
                            ) : (
                              <ArrowDown className="h-3 w-3 ml-1 inline" />
                            ))}
                          {field.multiFilter && (
                            <MultiValueFilter
                              label={field.label}
                              values={multiFilters[field.name] || []}
                              onChange={(vals) => {
                                setMultiFilters((prev) => ({
                                  ...prev,
                                  [field.name]: vals,
                                }));
                                setPage(1);
                              }}
                            />
                          )}
                        </div>
                      </TableHead>
                    );
                  })}
                  {showEnteredBy && (
                    <TableHead className="h-10 px-3 py-2 text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground whitespace-nowrap">
                      Entered by
                    </TableHead>
                  )}
                  <TableHead className="h-10 px-3 py-2 text-right text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">
                    Actions
                  </TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {isLoading ? (
                  [...Array(limit)].map((_, idx) => (
                    <TableRow key={idx}>
                      <TableCell className="px-3 py-1 text-center">
                        <Skeleton className="h-4 w-4 mx-auto" />
                      </TableCell>
                      {TABLE_FIELDS.map((_, fIdx) => (
                        <TableCell key={fIdx} className="px-3 py-1">
                          <Skeleton className="h-4 w-full" />
                        </TableCell>
                      ))}
                      <TableCell className="px-3 py-1 text-center">
                        <Skeleton className="h-8 w-20 mx-auto" />
                      </TableCell>
                    </TableRow>
                  ))
                ) : data.length === 0 ? (
                  <TableRow>
                    <TableCell
                      colSpan={TABLE_FIELDS.length + 2 + (showEnteredBy ? 1 : 0)}
                      className="text-center py-8 text-gray-500"
                    >
                      No vouchers found
                    </TableCell>
                  </TableRow>
                ) : (
                  filteredData.map((entry, idx) => {
                    const id = entry.tran_id || entry.id || entry.order_no;
                    const statusInfo = documentStatus[id] || {
                      status: "Checking...",
                      allowEdit: true,
                    };
                    const isLoading = statusLoading[id];
                    // Quantity-only documents are locked once invoiced: the
                    // server refuses delete until Invoicing unlocks them, and
                    // edit too unless "Edit invoiced documents directly" is on.
                    const invoiceLocked =
                      !!VOUCHER_CONFIG[type]?.invoiceLock && isInvoicedDoc(entry);
                    const editLocked = editLockedFor(entry);
                    return (
                      <TableRow
                        key={idx}
                        className={`border-b border-border/70 hover:bg-primary/[0.04] ${selectedRows.includes(entry.tran_id || entry.id) ? "bg-primary/[0.07]" : ""} ${!statusInfo.allowEdit ? "opacity-75" : ""
                          }`}
                      // onClick={() =>
                      //   statusInfo.allowEdit && handleRowClick(entry)
                      // }
                      >
                        {VOUCHER_CONFIG[type].allowCheck && (
                          <TableCell
                            className="vl-check px-4 py-2 text-center"
                            onClick={(e) => e.stopPropagation()}
                          >
                            <Checkbox
                              checked={selectedRows.includes(
                                entry.tran_id || entry.id,
                              )}
                              onCheckedChange={(checked) => {
                                if (checked) {
                                  setSelectedRows((prev) => [
                                    ...prev,
                                    entry.tran_id || entry.id,
                                  ]);
                                } else {
                                  setSelectedRows((prev) =>
                                    prev.filter(
                                      (id) =>
                                        id !== (entry.tran_id || entry.id),
                                    ),
                                  );
                                }
                              }}
                            />
                          </TableCell>
                        )}
                        {TABLE_FIELDS.map((field, fIdx) => (
                          <TableCell
                            key={fIdx}
                            data-label={typeof field.label === "string" ? field.label : field.name}
                            className={`px-3 py-2.5 text-sm ${field.multiline ? "whitespace-pre-line" : ""}`}
                          >
                            {typeof field.render === "function" ? (
                              field.render(entry)
                            ) : field.name === "manual_no" && manualNoEditable ? (
                              // Paper DC / GRN no: settable on its own, even when invoiced.
                              <ManualNoCell
                                type={type}
                                entry={entry}
                                label={typeof field.label === "string" ? field.label : "Manual No"}
                                onSaved={() => queryClient.invalidateQueries({ queryKey: ["vouchers", type] })}
                              />
                            ) : isUserField(field) && "entered_by" in entry ? (
                              <EnteredByChip name={entry.entered_by} />
                            ) : field.name === "status" ? (
                              isLoading ? (
                                <div className="flex items-center space-x-2">
                                  <RefreshCw className="h-3 w-3 animate-spin" />
                                  <span>Checking...</span>
                                </div>
                              ) : (
                                <StatusBadge
                                  status={statusInfo.status}
                                  details={statusInfo.details}
                                />
                              )
                            ) : field.options ? (
                              entry[field.value1]?.[field.value2] || "-"
                            ) : field.isTotal ? (
                              entry.transactions
                                ?.filter(
                                  (tran) =>
                                    tran.sub_tran_id === 3 &&
                                    tran.narration1?.trim() === "Auto Entry"
                                )
                                ?.reduce(
                                  (sum, tran) =>
                                    sum +
                                    ((tran.damt > 0 && tran.damt) ||
                                      (tran.camt > 0 && tran.camt) ||
                                      0),
                                  0,
                                )
                                ?.toLocaleString()
                            ) : field.isInnerTotal ? (
                              entry[field.key]
                                ?.reduce(
                                  (sum, tran) =>
                                    sum +
                                    ((tran[field.name] > 0 &&
                                      tran[field.name]) ||
                                      0),
                                  0,
                                )
                                ?.toLocaleString()
                            ) : (
                              formatCellContent(entry[field.name], field)
                            )}
                          </TableCell>
                        ))}
                        {showEnteredBy && (
                          <TableCell data-label="Entered by" className="px-3 py-2.5 text-sm">
                            <EnteredByChip name={entry.entered_by} />
                          </TableCell>
                        )}
                        <TableCell className="vl-actions whitespace-nowrap px-2 py-1 text-right">
                          {VOUCHER_CONFIG[type].allowView && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-primary/70 hover:text-primary hover:bg-primary/10"
                              title="View"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleRowClick(entry, idx);
                              }}
                            >
                              <Eye className="h-4 w-4" />
                            </Button>
                          )}
                          {(() => {
                            const fileCount = attachmentCountOf(entry);
                            if (!fileCount && !takesAttachments) return null;
                            return (
                              <Button
                                variant="ghost"
                                size="icon"
                                className={`relative ${fileCount
                                  ? "text-primary hover:bg-primary/10"
                                  : "text-gray-400 hover:text-gray-700"
                                  }`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  setAttachmentEntry(entry);
                                }}
                                title={fileCount
                                  ? `${fileCount} attachment${fileCount === 1 ? "" : "s"}`
                                  : "Add attachments"}
                              >
                                <Paperclip className="h-4 w-4" />
                                {fileCount > 0 && (
                                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] font-bold leading-none text-primary-foreground ring-2 ring-white">
                                    {fileCount}
                                  </span>
                                )}
                              </Button>
                            );
                          })()}
                          {/* Edit Button - DISABLED based on status */}
                          {VOUCHER_CONFIG[type].allowEdit && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-primary/70 hover:text-primary hover:bg-primary/10"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleEditClick(entry, "edit");
                              }}
                              disabled={!statusInfo.allowEdit || editLocked}
                              title={
                                editLocked
                                  ? `Invoiced (${docInvoiceRef(entry)}) — unlock it in Invoicing first`
                                  : !statusInfo.allowEdit
                                    ? `${statusInfo.status} - Cannot Edit`
                                    : invoiceLocked
                                      ? `Edit — invoice ${docInvoiceRef(entry)} is priced again on save`
                                      : "Edit"
                              }
                            >
                              <Edit className="h-4 w-4" />
                            </Button>
                          )}
                          {/* Invoiced: only the header details (feature switch) */}
                          {invoiceLocked && headerEditable && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-primary/70 hover:text-primary hover:bg-primary/10"
                              onClick={(e) => {
                                e.stopPropagation();
                                setHeaderEntry(entry);
                              }}
                              title="Edit header details (the invoice stays as it is)"
                            >
                              <FilePenLine className="h-4 w-4" />
                            </Button>
                          )}
                           {/* Clone Button — not where a numbered document must stay unique (allowClone: false) */}
                            {VOUCHER_CONFIG[type].allowClone !== false && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-primary/70 hover:text-primary hover:bg-primary/10"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleCloneClick(entry);
                              }}
                              title="Clone Voucher"
                            >
                              <Copy className="h-4 w-4" />
                            </Button>
                            )}
                          {/* Create Button - Visible ONLY in Report Category for configured types */}
                          {VOUCHER_CONFIG[type].allowCreate && (() => {
                            // SO/PO rows carry order_no; requisition rows carry tran_id (→ req_no)
                            const hasDraft = hasSourceDraft(entry.order_no ?? entry.tran_id);
                            return (
                              <Button
                                variant="ghost"
                                size="icon"
                                className={`relative ${hasDraft ? "text-amber-600 hover:text-amber-700 hover:bg-amber-50" : "text-muted-foreground hover:text-foreground hover:bg-muted"}`}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  handleEditClick(entry, "create");
                                }}
                                title={hasDraft ? "Proceed / Create — unsaved draft will be restored" : "Proceed / Create"}
                              >
                                <CircleChevronRight className="h-4 w-4" />
                                {hasDraft && (
                                  <span className="absolute -top-0.5 -right-0.5 h-2.5 w-2.5 rounded-full bg-amber-500 ring-2 ring-white" />
                                )}
                              </Button>
                            );
                          })()}
                          {/* Return Button — GRN Return / Dispatch Return */}
                          {VOUCHER_CONFIG[type].allowReturn && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-primary/70 hover:text-primary hover:bg-primary/10"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleReturnClick(entry);
                              }}
                              title={`Create ${VOUCHER_CONFIG[type].returnType === "grnReturn" ? "GRN Return" : "Dispatch Return"}`}
                            >
                              <RotateCcw className="h-4 w-4" />
                            </Button>
                          )}
                          {canPrintEntry(entry) && (
                              <Button
                                variant="ghost"
                                size="icon"
                                className="text-primary/70 hover:text-primary hover:bg-primary/10"
                                title="Print"
                                disabled={isDownloadingPDF}
                                onClick={(e) => {
                                  e.stopPropagation();
                                  printEntry(entry);
                                }}
                              >
                                <Printer className="h-4 w-4" />
                              </Button>
                            )}
                          {VOUCHER_CONFIG[type].allowDelete && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                handleDeleteClick(entry);
                              }}
                              disabled={deleteMutation.isPending || requestDeleteMutation.isPending || invoiceLocked || (deletionRequestsOn && permLoading)}
                              title={invoiceLocked ? "Invoiced — unlock it in Invoicing first" : mayDeleteNow ? "Delete" : "Request deletion (with a reason — goes to Approvals)"}
                            >
                              {deleteMutation.isPending || requestDeleteMutation.isPending ? (
                                <RefreshCw className="h-4 w-4 animate-spin" />
                              ) : (
                                <Delete className="h-4 w-4" />
                              )}
                            </Button>
                          )}
                          {/* ✅ Fulfillment Progress — SO, PO, Req, Dispatch, GRN, Transfer */}
                          {(type === "saleOrder" ||
                            type === "purchaseOrder" ||
                            type === "requisition" ||
                            type === "transfer" ||
                            type === "fgTransfer" ||
                            type === "requisitionTransfer" ||
                            type === "requisitionFGTransfer" ||
                            type === "dispatch" ||
                            type === "grn") && (
                            <Button
                              variant="ghost"
                              size="icon"
                              className="text-primary/70 hover:text-primary hover:bg-primary/10"
                              title={
                                type === "saleOrder"
                                  ? "Dispatch Progress & Manage Items"
                                  : type === "purchaseOrder"
                                    ? "GRN Receipt Progress"
                                    : type === "requisition" || type === "requisitionTransfer" || type === "requisitionFGTransfer" || type === "dispatchTransfer" || "productionPlan" || type === "transfer" || type === "fgTransfer"
                                      ? "Transfer Progress"
                                      : type === "dispatch"
                                        ? "View Dispatch Progress"
                                        : type === "grn"
                                          ? "View GRN Progress"
                                          : "View Transfer Progress"
                              }
                              onClick={(e) => {
                                e.stopPropagation();
                                setFulfillmentModalEntry(entry);
                                setFulfillmentModalOpen(true);
                              }}
                            >
                              <BarChart3 className="h-4 w-4" />
                            </Button>
                          )}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>

          {/* Paging */}
          {!isLoading && data.length > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border px-4 py-3 text-sm text-muted-foreground">
              <div className="flex flex-wrap items-center gap-2">
                <span>
                  Showing {(page - 1) * limit + 1}–{Math.min(page * limit, totalData)} of{" "}
                  <span className="font-semibold tabular-nums text-foreground">{totalData}</span>
                </span>
                <Select value={limit.toString()} onValueChange={handleLimitChange}>
                  <SelectTrigger className="h-8 w-[110px]" aria-label="Rows per page">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {[10, 25, 50, 100].map((val) => (
                      <SelectItem key={val} value={val.toString()}>
                        {val} per page
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Pagination className="mx-0 w-auto">
                <PaginationContent>
                  <PaginationItem>
                    <PaginationPrevious
                      onClick={() => handlePageChange(page - 1)}
                      disabled={page === 1}
                    />
                  </PaginationItem>
                  {pageNumbers.map((num) => (
                    <PaginationItem key={num}>
                      <PaginationLink
                        onClick={() => handlePageChange(num)}
                        isActive={num === page}
                      >
                        {num}
                      </PaginationLink>
                    </PaginationItem>
                  ))}
                  <PaginationItem>
                    <PaginationNext
                      onClick={() => handlePageChange(page + 1)}
                      disabled={page === totalPages}
                    />
                  </PaginationItem>
                </PaginationContent>
              </Pagination>
            </div>
          )}
        </div>
        )}

        <PendingInvoiceModal
          isOpen={pendingModalOpen}
          onClose={() => setPendingModalOpen(false)}
          onSuccess={handlePendingSuccess}
          type={type}
        />

        <DataViewModal
          data={selectedRow}
          type={type}
          isOpen={viewModalOpen}
          onClose={() => setViewModalOpen(false)}
          // Opened from a link: just that voucher, no prev / next.
          allData={linkedView ? [selectedRow] : data}
          currentIndex={linkedView ? 0 : selectedRowIndex}
          onNavigate={(newIdx) => {
            setSelectedRow(data[newIdx]);
            setSelectedRowIndex(newIdx);
          }}
          actions={viewModalOpen ? viewActionsFor(selectedRow) : null}
        />
        {isEditModal && (
          <VoucherModal
            type={type}
            category={category}
            editModes={isEditModal}
            mode={mode}
            onSuccess={onSuccess}
            onCloseEdit={() => setIsEditModal(false)}
            existingData={enhancedData}
          />
        )}
        {/* Return Modal — GRN Return / Dispatch Return */}
        {isReturnModal && returnOriginalData && (
          <VoucherModal
            type={VOUCHER_CONFIG[type].returnType}
            category={category}
            initialOriginalData={returnOriginalData}
            onSuccess={() => {
              setIsReturnModal(false);
              setReturnOriginalData(null);
              onSuccess?.();
            }}
            onCloseEdit={() => {
              setIsReturnModal(false);
              setReturnOriginalData(null);
            }}
          />
        )}
        {bulkPrintPreviewOpen && bulkPrintData.length > 0 && (
          <BulkPrintPreviewModal
            isOpen={bulkPrintPreviewOpen}
            onClose={() => {

              setBulkPrintPreviewOpen(false);
            }}
            printData={bulkPrintData}
            printType={bulkPrintType}
            documentType={type}
            currency={currency}
            company={company}
          />
        )}
        <AnimatePresence>
          <PrintPreviewModal
            isOpen={isPreviewOpen}
            onClose={() => setIsPreviewOpen(false)}
            pdfUrl={previewPdfUrl}
            title={previewTitle}
            onDownload={handleDownloadFromPreview}
          />
        </AnimatePresence>

        {/* ✅ Universal Fulfillment Progress Modal */}
        <FulfillmentProgressModal
          isOpen={fulfillmentModalOpen}
          onClose={() => {
            setFulfillmentModalOpen(false);
            setFulfillmentModalEntry(null);
          }}
          type={type}
          entry={fulfillmentModalEntry}
          onUpdated={() =>
            queryClient.invalidateQueries({ queryKey: ["vouchers", type] })
          }
        />

        <AttachmentViewer
          open={showAttachmentModal}
          onOpenChange={(open) => !open && setAttachmentEntry(null)}
          voucherId={attachmentEntry?.tran_id}
          title={`${VOUCHER_CONFIG[type]?.label || "Voucher"} ${attachmentEntry?.vr_no ?? attachmentEntry?.tran_id ?? ""} — Attachments`}
          subtitle={attachmentEntry?.acno?.acname || undefined}
          editable={takesAttachments}
          onChange={() => queryClient.invalidateQueries({ queryKey: ["vouchers", type] })}
        />

        {headerEntry && (
          <HeaderEditDialog
            type={type}
            entry={headerEntry}
            docLabel={`${VOUCHER_CONFIG[type]?.label || "Document"} ${headerEntry.grn_no ?? headerEntry.dispatch_no ?? headerEntry.vr_no ?? headerEntry.tran_id ?? ""}`}
            onClose={() => setHeaderEntry(null)}
            onSaved={() => queryClient.invalidateQueries({ queryKey: ["vouchers", type] })}
          />
        )}
      </div>
    </div>
  );
}
