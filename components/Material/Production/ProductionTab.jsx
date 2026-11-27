// components/ProductionTabOptimized.jsx
"use client";
import React, { useState, useCallback, useMemo, useRef, useEffect } from "react";
import { useSearchParams } from "next/navigation";
import {
  Plus,
  Edit,
  //Trash2,
  Search,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Eye,
  PlayCircle,
  Package,
  Factory,
  AlertTriangle,
  CheckCircle,
  FileText,
  X,
  FilterX,
} from "lucide-react";
import { useProductionPlans } from "@/hooks/useProduction";
import SearchableSelect from "@/components/ui/searchable-select";
import ProcessOrderForm from "./ProcessOrderForm";
import { planForOutput } from "./processOrderModel";
import { useDebounce } from "@/hooks/useDebounce";
import { toast } from "sonner";
import EmptyState from "./EmptyState";
import { useConfirm } from "./ConfirmDialog";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";
import {
  LabHeader,
  CHIP,
  CODE_CHIP,
  TH,
  TD,
  NUM,
  DIALOG,
  DIALOG_HEAD,
  DIALOG_BODY,
  DIALOG_FOOT,
} from "@/components/Material/shared/LabUI";
import StatusBadge from "./StatusBadge";
import TypeBadge from "./TypeBadge";
import ProductionQcScanner from "./ProductionQcScanner";
import { useSendToProduction } from "./useSendToProduction";
import { useStockValidation } from "./useStockValidation";
import SendToProductionModal from "./SendToProductionModal";
import useKeyboardShortcuts from "@/hooks/useKeyboardShortcuts";
import KeyboardHint, { KeyCombo } from "@/components/ui/KeyboardHint";
import { generateProcessOrderPDF } from "@/components/Template/ProcessOrder";
import axios from "axios";
import { useCompany } from "@/context/CompanyContext";
import { useFeatures } from "@/hooks/useFeatures";
import { useProductionSetup } from "@/hooks/useProductionSetup";
import { isFinishedCategory } from "@/lib/production/setupConfig";
import { statusLabel } from "@/lib/quality/qc";

// Constants
const PRODUCTION_TYPES = {
  NEW: "new",
  SF: "sf",
  REPROCESSING: "reprocessing",
};

const MODAL_MODES = {
  CREATE: "create",
  EDIT: "edit",
  VIEW: "view",
};

const ProductionTab = () => {
  const { company } = useCompany();
  // QC gate on Send to Production (Settings → Features "production.qcBeforeSend"; the route enforces it)
  const features = useFeatures();
  const { setup: productionSetup } = useProductionSetup();
  // State Management
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState(MODAL_MODES.CREATE);
  const [editingItem, setEditingItem] = useState(null);
  const [productionType, setProductionType] = useState(PRODUCTION_TYPES.NEW);
  const [showSendModal, setShowSendModal] = useState(false);
  const [selectedPlan, setSelectedPlan] = useState(null);
  const {
    sendToProduction,
    isSending,
    error: sendError,
  } = useSendToProduction();
  const { validateProductionPlanStock, isChecking: isStockChecking, stockErrorDetails, stockErrors: stockValidationErrors } = useStockValidation();
  const [showStockErrorModal, setShowStockErrorModal] = useState(false);

  // Filters with debounced search
  const [filters, setFilters] = useState({
    search: "",
    status: "",
    type: "",
    item: "",
    dateFrom: "",
    dateTo: "",
    page: 1,
    limit: 10,
    sortBy: "id",
    sortOrder: "desc",
  });

  const debouncedSearch = useDebounce(filters.search, 300);

  // ?search=<process order no> (a notification click-through) pre-fills the
  // search box. Only acts when the param is present.
  const urlParams = useSearchParams();
  const urlSearch = urlParams?.get("search");
  useEffect(() => {
    if (urlSearch == null || urlSearch === "") return;
    setFilters((prev) => ({ ...prev, search: urlSearch, page: 1 }));
  }, [urlSearch]);

  // API Hooks with optimized queries
  const {
    productionPlans,
    items,
    loading,
    total,
    createProductionPlan: createProductionPlanAPI,
    updateProductionPlan: updateProductionPlanAPI,
    deleteProductionPlan: deleteProductionPlanAPI,
    isCreating,
    isUpdating,
    isDeleting,
  } = useProductionPlans({
    ...filters,
    search: debouncedSearch,
  });


  // Memoized computed values
  const tableData = useMemo(() => productionPlans, [productionPlans]);

  // Notification handler (sonner: success / error / warning)
  const showNotification = useCallback((message, type = "success") => {
    (toast[type] || toast)(message);
  }, []);

  // window.confirm() replacement (Radix AlertDialog)
  const [confirm, confirmDialog, confirmOpen] = useConfirm();

  // Optimized handlers
  const handleSearch = useCallback((value) => {
    setFilters((prev) => ({ ...prev, search: value, page: 1 }));
  }, []);

  const handleFilterChange = useCallback((status) => {
    setFilters((prev) => ({ ...prev, status, page: 1 }));
  }, []);

  // Any list filter (status, type, item, order date) — not the search box
  const setFilter = useCallback((name, value) => {
    setFilters((prev) => ({ ...prev, [name]: value ?? "", page: 1 }));
  }, []);
  const activeFilters = ["status", "type", "item", "dateFrom", "dateTo"].filter((k) => filters[k]).length;
  const clearFilters = useCallback(() => {
    setFilters((prev) => ({ ...prev, status: "", type: "", item: "", dateFrom: "", dateTo: "", page: 1 }));
  }, []);

  // Production item picker: every item, code first
  const itemOptions = useMemo(
    () =>
      (items || []).map((it) => ({
        value: String(it.itcd),
        label: `${it.code || it.itcd} — ${it.item || ""}`,
      })),
    [items],
  );

  const handleSort = useCallback((field) => {
    setFilters((prev) => ({
      ...prev,
      sortBy: field,
      sortOrder:
        prev.sortBy === field
          ? prev.sortOrder === "asc"
            ? "desc"
            : "asc"
          : "asc",
      page: 1,
    }));
  }, []);

  const handleDownloadPDF = useCallback(
    async (plan) => {
      try {
        // 🔥 Fetch latest data
        const [itemsRes, instructionRes] = await Promise.all([
          axios.get("/api/forms/items", {
            params: {
              search: plan.finished_id,
            },
          }),
          axios.get("/api/manufacturing/machine-instruction", {
            params: {
              search: plan.machine_id,
            },
          }),
        ]);

        // Multi-item orders print production item 1 here; the order form
        // prints whichever item is selected (Alt+P).
        const doc = generateProcessOrderPDF(
          planForOutput(plan, 1),
          itemsRes.data.items[0],
          instructionRes.data.data[0],
          "",
          company
        );
        const pdfBlob = doc.output("blob");
        const pdfUrl = URL.createObjectURL(pdfBlob);

        const printWindow = window.open(pdfUrl, "_blank");

        // Wait for PDF to load then trigger print
        printWindow.onload = () => {
          printWindow.focus();
          printWindow.print();
        };

        setTimeout(() => URL.revokeObjectURL(pdfUrl), 10000);
      } catch (error) {
        console.error("PDF generation error:", error);
        showNotification("Failed to generate PDF", "error");
      }
    },
    [showNotification],
  );

  // Modal Management
  const openModal = useCallback((mode, item = null) => {
    setModalMode(mode);
    setEditingItem(item);
    setProductionType(item?.type || PRODUCTION_TYPES.NEW);
    setShowModal(true);
  }, []);

  // ?fromPlan=<plan no>&so=&itcd=&qty= — "Process Order" on a Production Plan
  // line / the Pending Report (Features: production.labNature): opens Create
  // Process Order with those picked (ProcessOrderForm `prefill`).
  const [planPrefill, setPlanPrefill] = useState(null);
  const urlFromPlan = urlParams?.get("fromPlan");
  useEffect(() => {
    const req_no = Number(urlFromPlan) || null;
    if (!req_no) return;
    setPlanPrefill({
      req_no,
      sale_ord_no: Number(urlParams.get("so")) || null,
      itcd: Number(urlParams.get("itcd")) || null,
      qty: Number(urlParams.get("qty")) || null,
    });
    openModal(MODAL_MODES.CREATE);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [urlFromPlan]);

  const closeModal = useCallback(() => {
    setPlanPrefill(null);
    setShowModal(false);
    setModalMode(MODAL_MODES.CREATE);
    setEditingItem(null);
    setProductionType(PRODUCTION_TYPES.NEW);
  }, []);

  // CRUD Operations
  const handleCreateProductionPlan = useCallback(
    async (formData) => {
      try {
        await createProductionPlanAPI(formData);

        closeModal();
        showNotification("Process order created successfully!", "success");
      } catch (error) {
        const errMsg = error?.response?.data?.error || error?.message || "Failed to create process order";
        showNotification(errMsg, "error");
      }
    },
    [createProductionPlanAPI, closeModal, showNotification],
  );

  const handleUpdateProductionPlan = useCallback(
    async (formData) => {
      if (!editingItem) return;

      try {
        // Just call the API - if it doesn't throw error, assume success
        await updateProductionPlanAPI({
          id: editingItem.id,
          data: formData,
        });

        // No need to check result
        closeModal();
        showNotification("Process order updated successfully!", "success");
      } catch (error) {
        console.error("Update error:", error);
        showNotification(
          error?.response?.data?.error || error.message || "Failed to update process order",
          "error",
        );
      }
    },
    [updateProductionPlanAPI, editingItem, closeModal, showNotification],
  );

  const handleDeleteProductionPlan = useCallback(
    async (id) => {
      const ok = await confirm({
        title: "Delete this process order?",
        description: "This action cannot be undone.",
        confirmLabel: "Delete",
        destructive: true,
      });
      if (!ok) return;

      try {
        await deleteProductionPlanAPI(id);

        showNotification("Process order deleted successfully!", "success");
      } catch (error) {
        const errMsg = error?.response?.data?.error || error?.message || "Failed to delete process order";
        showNotification(errMsg, "error");
      }
    },
    [deleteProductionPlanAPI, showNotification, confirm],
  );

  // Update handleSendToProduction functionss
  const handleSendToProduction = useCallback(
    async (plan) => {
      // Check if already in progress or completed
      if (plan.status === "In Progress" || plan.status === "Posted") {
        showNotification(
          `Process order ${plan.id} is already ${plan.status.toLowerCase()}`,
          "warning",
        );
        return;
      }

      // Confirm before sending
      const ok = await confirm({
        title: `Send Process Order #${plan.id} to production?`,
        description: "This will create accounting transactions.",
        confirmLabel: "Send to production",
      });
      if (!ok) return;

      try {
        const result = await sendToProduction(plan.id);

        if (result.success) {
          showNotification(
            `Process order #${plan.id} sent to production successfully!`,
            "success",
          );
          // Refresh production plans data
          // You might want to add a refresh function to your useProductionPlans hook
        } else {
          showNotification(
            result.error || "Failed to send to production",
            "error",
          );
        }
      } catch (error) {
        showNotification(
          "An error occurred while sending to production",
          "error",
        );
      }
    },
    [sendToProduction, showNotification, confirm],
  );

  // Update handleSendToProduction to show modal
  const handleOpenSendModal = useCallback((plan) => {
    setSelectedPlan(plan);
    setShowSendModal(true);
  }, []);

  // Add this function near your other handlers
  const handleConfirmSend = useCallback(
    async (planId, actualYield, adjustedItems = {}, actualYields = {}) => {
      try {
        // Stock validation for "new" type — happens at post time
        if (selectedPlan && selectedPlan.type === "new") {
          const stockValidation = await validateProductionPlanStock(
            selectedPlan.productionPlanDetail,
            "new",
          );
          if (!stockValidation.isValid) {
            setShowStockErrorModal(true);
            return;
          }
          // Stock check on Warn (Settings → Stock checking): say what is short, send anyway.
          if (stockValidation.warnings?.length) {
            showNotification(`Short stock (sending anyway): ${stockValidation.warnings.join("; ")}`, "warning");
          }
        }

        const result = await sendToProduction(planId, actualYield, adjustedItems, actualYields);

        if (result.success) {
          showNotification(
            `Process order #${planId} sent to production successfully!`,
            "success",
          );
          for (const w of result.data?.warnings ?? []) showNotification(w, "warning");
          setShowSendModal(false);
          // Optionally refresh your production plans data here
        } else {
          showNotification(
            result.error || "Failed to send to production",
            "error",
          );
        }
      } catch (error) {
        showNotification(
          "An error occurred while sending to production",
          "error",
        );
      }
    },
    [sendToProduction, showNotification, selectedPlan, validateProductionPlanStock],
  );

  const getSendButtonStatus = (plan) => {
    const qcStatus = plan.qualityMaster?.status || null;
    const qcBlocks =
      ["REJECTED", "HOLD", "REWORK"].includes(qcStatus) ||
      (features.on("production.qcBeforeSend") && qcStatus !== "APPROVED" && isFinishedCategory(productionSetup, plan.item?.ic_id));
    if ((plan.status === "Completed" || plan.status === "COMPLETED") && qcBlocks) {
      return {
        enabled: false,
        tooltip: `Waiting for QC (${qcStatus ? statusLabel(qcStatus) : "not started"})`,
        icon: AlertTriangle,
        color: "text-muted-foreground cursor-not-allowed",
      };
    }
    if (plan.status === "Scheduled") {
      return {
        enabled: false,
        tooltip: "Send to Production",
        icon: PlayCircle,
        color: "text-muted-foreground",
      };
    } else if (plan.status === "Completed" || plan.status === "COMPLETED") {
      return {
        enabled: true,
        tooltip: "Send to Production",
        icon: PlayCircle,
        color: "text-primary hover:bg-primary/10",
      };
    } else if (plan.status === "In Progress") {
      return {
        enabled: false,
        tooltip: "Already in production",
        icon: CheckCircle,
        color: "text-muted-foreground cursor-not-allowed",
      };
    } else if (plan.status === "Posted") {
      return {
        enabled: false,
        tooltip: "Production Posted",
        icon: CheckCircle,
        color: "cursor-not-allowed text-[#2f5139] dark:text-emerald-300",
      };
    } else if (plan.status === "Cancelled") {
      return {
        enabled: false,
        tooltip: "Production cancelled",
        icon: AlertTriangle,
        color: "text-destructive cursor-not-allowed",
      };
    }
    return {
      enabled: false,
      tooltip: "Cannot send to production",
      icon: AlertTriangle,
      color: "text-muted-foreground cursor-not-allowed",
    };
  };


  // ── Keyboard navigation ──────────────────────────────────────────────────
  const searchInputRef = useRef(null);
  const totalPages = Math.max(1, Math.ceil(total / filters.limit));

  const goToPage = useCallback(
    (delta) => {
      setFilters((prev) => {
        const pages = Math.max(1, Math.ceil(total / prev.limit));
        return { ...prev, page: Math.min(pages, Math.max(1, prev.page + delta)) };
      });
    },
    [total],
  );

  const focusSearch = useCallback(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, []);

  const anyOverlayOpen = showModal || showSendModal || showStockErrorModal || confirmOpen;

  useKeyboardShortcuts(
    {
      // Jump straight to the item/order search box
      "/": focusSearch,
      // Create a new process order
      "alt+n": { handler: () => openModal(MODAL_MODES.CREATE), allowInInput: true },
      // Paginate
      "alt+arrowleft": { handler: () => goToPage(-1), allowInInput: true },
      "alt+arrowright": { handler: () => goToPage(1), allowInInput: true },
      // Clear the search box
      escape: {
        handler: () => {
          if (filters.search) handleSearch("");
          searchInputRef.current?.blur();
        },
        allowInInput: true,
      },
    },
    !anyOverlayOpen,
  );

  // Escape closes the create/edit modal — but the first Escape belongs to any
  // open react-select dropdown, so the user does not lose the whole form.
  useKeyboardShortcuts(
    {
      escape: {
        handler: () => {
          const dropdownOpen = document.querySelector(".react-select__menu");
          if (dropdownOpen) return;
          if (!isCreating && !isUpdating) closeModal();
        },
        allowInInput: true,
      },
    },
    showModal,
  );

  const TAB_SHORTCUTS = [
    { combo: "Alt+N", label: "New process order" },
    { combo: "/", label: "Focus search" },
    { combo: "Alt+Left", label: "Previous page" },
    { combo: "Alt+Right", label: "Next page" },
    { combo: "Esc", label: "Clear search / close dialog" },
    { combo: "Shift+?", label: "Show this help" },
  ];



  // Row action buttons — small icon buttons in the last column (a full-width
  // row across the bottom of the card under md)
  const ICON_BTN =
    "inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors disabled:opacity-50";
  const RowActions = ({ plan, size = 16 }) => {
    const buttonStatus = getSendButtonStatus(plan);
    return (
      <div className="flex items-center justify-end gap-0.5 max-md:justify-start">
        <button
          type="button"
          onClick={() => handleDownloadPDF(plan)}
          className={cn(ICON_BTN, "text-muted-foreground hover:bg-muted hover:text-foreground")}
          title="Print Preview"
          aria-label={`Print process order ${plan.id}`}
        >
          <FileText size={size} />
        </button>
        <button
          type="button"
          onClick={() => handleOpenSendModal(plan)}
          disabled={!buttonStatus.enabled}
          className={cn(ICON_BTN, buttonStatus.color)}
          title={buttonStatus.tooltip}
          aria-label={buttonStatus.tooltip}
        >
          <buttonStatus.icon size={size} />
        </button>
        <button
          type="button"
          onClick={() => openModal(MODAL_MODES.VIEW, plan)}
          className={cn(ICON_BTN, "text-muted-foreground hover:bg-muted hover:text-foreground")}
          title="View Details"
          aria-label={`View process order ${plan.id}`}
        >
          <Eye size={size} />
        </button>
        <button
          type="button"
          onClick={() => openModal(MODAL_MODES.EDIT, plan)}
          className={cn(ICON_BTN, "text-primary/80 hover:bg-primary/10 hover:text-primary")}
          title="Edit"
          aria-label={`Edit process order ${plan.id}`}
        >
          <Edit size={size} />
        </button>
      </div>
    );
  };

  // Sortable maroon column head
  const SortHead = ({ field, label, className }) => {
    const active = filters.sortBy === field;
    return (
      <th scope="col" className={cn(TH, className)} aria-sort={active ? (filters.sortOrder === "asc" ? "ascending" : "descending") : undefined}>
        <button
          type="button"
          onClick={() => handleSort(field)}
          className="inline-flex items-center gap-1 uppercase hover:opacity-80"
        >
          {label}
          {active ? (
            filters.sortOrder === "asc" ? <ArrowUp size={13} /> : <ArrowDown size={13} />
          ) : (
            <ArrowUpDown size={12} className="opacity-50" />
          )}
        </button>
      </th>
    );
  };

  const SELECT =
    "h-10 rounded-lg border border-border bg-background px-3 text-sm text-foreground outline-none transition focus:border-primary focus:ring-2 focus:ring-primary/15";
  const COLS = 10;
  const fromRow = total ? (filters.page - 1) * filters.limit + 1 : 0;
  const toRow = Math.min(total, filters.page * filters.limit);

  // Pagination Component
  const ProductionPagination = () => (
    <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2.5 text-sm">
      <span className="text-muted-foreground">
        <span className="tabular-nums">{fromRow}–{toRow}</span> of{" "}
        <span className="font-semibold tabular-nums text-foreground">{total}</span> process orders
      </span>

      <div className="flex items-center gap-1.5">
        <button
          type="button"
          onClick={() => goToPage(-1)}
          disabled={filters.page === 1}
          title="Previous page (Alt + Left)"
          aria-label="Previous page"
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          <ChevronLeft size={15} />
          <span className="hidden sm:inline">Previous</span>
        </button>
        <span className="px-1 text-xs tabular-nums text-muted-foreground">
          {filters.page} / {totalPages}
        </span>
        <button
          type="button"
          onClick={() => goToPage(1)}
          disabled={filters.page >= totalPages}
          title="Next page (Alt + Right)"
          aria-label="Next page"
          className="inline-flex h-8 items-center gap-1 rounded-lg border border-border px-2.5 text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
        >
          <span className="hidden sm:inline">Next</span>
          <ChevronRight size={15} />
        </button>
      </div>
    </div>
  );

  return (
    <div className="space-y-4">
      <LabHeader
        icon={Factory}
        title="Process Orders"
        subtitle="Schedule and track manufacturing production activities"
        badge={total ? total : null}
        actions={
          <>
            {/* Hidden while a dialog is open so its own cheat sheet owns "?" */}
            {!anyOverlayOpen && <KeyboardHint shortcuts={TAB_SHORTCUTS} />}
            <button
              type="button"
              onClick={() => openModal(MODAL_MODES.CREATE)}
              title="New process order (Alt + N)"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition hover:opacity-90"
            >
              <Plus size={17} />
              <span>New Process Order</span>
              <span className="hidden opacity-70 lg:inline">
                <KeyCombo combo="Alt+N" />
              </span>
            </button>
          </>
        }
      />

      <ProductionQcScanner />

      {/* Process order list */}
      <div className="overflow-hidden rounded-xl border border-border bg-background">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <label className="flex h-10 min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-border px-3 text-muted-foreground focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 sm:max-w-md">
            <Search className="h-4 w-4 flex-shrink-0" />
            <input
              ref={searchInputRef}
              type="text"
              value={filters.search}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search item code, order #, batch or product…"
              aria-label="Search process orders by item code, order number, batch or product"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none placeholder:text-muted-foreground"
            />
            {filters.search ? (
              <button
                type="button"
                onClick={() => {
                  handleSearch("");
                  focusSearch();
                }}
                title="Clear search (Esc)"
                aria-label="Clear search"
                className="hover:text-foreground"
              >
                <X className="h-4 w-4" />
              </button>
            ) : (
              <kbd className="hidden rounded border border-b-2 border-border px-1.5 font-mono text-[10.5px] sm:inline">/</kbd>
            )}
          </label>

          <select
            value={filters.status}
            onChange={(e) => handleFilterChange(e.target.value)}
            aria-label="Filter by status"
            className={cn(SELECT, "min-w-[9.5rem] flex-1 sm:flex-none")}
          >
            <option value="">All statuses</option>
            <option value="Scheduled">Scheduled</option>
            <option value="In Progress">In Progress</option>
            <option value="Posted">Posted</option>
            <option value="Completed">Completed</option>
          </select>

          <select
            value={filters.type}
            onChange={(e) => setFilter("type", e.target.value)}
            aria-label="Filter by type"
            className={cn(SELECT, "min-w-[9.5rem] flex-1 sm:flex-none")}
          >
            <option value="">All types</option>
            <option value="new">New Production</option>
            <option value="sf">SF to FG</option>
            <option value="reprocessing">Reprocessing</option>
          </select>

          <div className="min-w-[14rem] flex-1 sm:max-w-xs">
            <SearchableSelect
              inputId="po-filter-item"
              value={filters.item}
              onChange={(v) => setFilter("item", v)}
              options={itemOptions}
              placeholder="Any production item"
              ariaLabel="Filter by production item"
              emptyMessage="No item matches"
            />
          </div>

          <div className="flex flex-1 items-center gap-1.5 sm:flex-none">
            <label className={cn(SELECT, "flex min-w-0 flex-1 items-center gap-1.5 sm:w-[10.5rem] sm:flex-none")}>
              <span className="text-xs text-muted-foreground">From</span>
              <input
                type="date"
                value={filters.dateFrom}
                max={filters.dateTo || undefined}
                onChange={(e) => setFilter("dateFrom", e.target.value)}
                aria-label="Order date from"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </label>
            <label className={cn(SELECT, "flex min-w-0 flex-1 items-center gap-1.5 sm:w-[10.5rem] sm:flex-none")}>
              <span className="text-xs text-muted-foreground">To</span>
              <input
                type="date"
                value={filters.dateTo}
                min={filters.dateFrom || undefined}
                onChange={(e) => setFilter("dateTo", e.target.value)}
                aria-label="Order date to"
                className="min-w-0 flex-1 bg-transparent text-sm outline-none"
              />
            </label>
          </div>

          {activeFilters > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              title="Clear the filters (search stays)"
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-border px-3 text-sm text-muted-foreground transition hover:border-primary/40 hover:text-primary"
            >
              <FilterX className="h-4 w-4" />
              Clear filters
              <span className="rounded-full bg-primary/10 px-1.5 text-[11px] font-semibold text-primary">{activeFilters}</span>
            </button>
          )}

          <select
            value={filters.limit}
            onChange={(e) =>
              setFilters((prev) => ({
                ...prev,
                limit: Number(e.target.value),
                page: 1,
              }))
            }
            aria-label="Rows per page"
            className={cn(SELECT, "flex-1 sm:ml-auto sm:flex-none")}
          >
            <option value={10}>10 / page</option>
            <option value={25}>25 / page</option>
            <option value={50}>50 / page</option>
            <option value={100}>100 / page</option>
          </select>
        </div>

        {!loading && tableData.length === 0 ? (
          filters.search || activeFilters > 0 ? (
            <EmptyState
              icon={Search}
              title="No process order matches"
              description="Try another search word or clear the filters."
            />
          ) : (
            <EmptyState
              icon={Factory}
              title="No process orders yet"
              description="Create your first process order to get started."
              action={{
                label: "Create Process Order",
                onClick: () => openModal(MODAL_MODES.CREATE),
              }}
            />
          )
        ) : (
          <>
            {/* Table; under md every row becomes a card (table.vl-grid) */}
            <div className="overflow-x-auto md:max-h-[70vh] md:overflow-y-auto">
              <table className="vl-grid w-full text-sm">
                <thead>
                  <tr>
                    <SortHead field="id" label="Process Order" />
                    <th scope="col" className={TH}>Type</th>
                    <SortHead field="finished_id" label="Item" />
                    <SortHead field="dated" label="Order Date" />
                    <SortHead field="qty" label="Quantity" className="text-right" />
                    <SortHead field="status" label="Status" />
                    <th scope="col" className={TH}>Barcode</th>
                    <th scope="col" className={TH}>Batch</th>
                    <th scope="col" className={cn(TH, "text-right")}>Lines</th>
                    <th scope="col" className={cn(TH, "text-right")}>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {loading
                    ? Array.from({ length: 6 }).map((_, i) => (
                        <tr key={i} className="border-b border-border/60">
                          {Array.from({ length: COLS }).map((__, j) => (
                            <td key={j} className="px-3 py-3">
                              <Skeleton className="h-4 w-full max-w-[140px]" />
                            </td>
                          ))}
                        </tr>
                      ))
                    : tableData.map((plan) => (
                        <tr key={plan.id} className="border-b border-border/60 transition-colors hover:bg-primary/[0.03]">
                          <td data-label="Process order" className={cn(TD, "whitespace-nowrap")}>
                            <span className={cn(CODE_CHIP, "font-semibold tabular-nums")}>#{plan.id}</span>
                          </td>
                          <td data-label="Type" className={TD}>
                            <TypeBadge type={plan.type || "new"} />
                          </td>
                          <td data-label="Item" className={cn(TD, "min-w-[12rem] max-w-[22rem] max-md:col-span-2")}>
                            <div className="flex flex-wrap items-center gap-1.5">
                              {plan.recipe?.item?.code && <span className={CODE_CHIP}>{plan.recipe.item.code}</span>}
                              <span className="font-mono text-xs text-muted-foreground">{plan.finished_id}</span>
                              {plan.outputs?.length > 1 && (
                                <span
                                  className="rounded-full bg-primary/10 px-1.5 py-0.5 text-[11px] font-semibold text-primary"
                                  title={plan.outputs.map((o) => `${o.line_no}. ${o.item_code || o.finished_id} ${o.item_name || ""} — ${o.qty} ${o.unit}`).join(" | ")}
                                >
                                  +{plan.outputs.length - 1} more
                                </span>
                              )}
                            </div>
                            <div className="truncate font-medium text-foreground" title={plan.productName || ""}>
                              {plan.productName || "N/A"}
                            </div>
                          </td>
                          <td data-label="Order date" className={cn(TD, "whitespace-nowrap tabular-nums")}>
                            {new Date(plan.dated).toLocaleDateString()}
                          </td>
                          <td data-label="Quantity" className={cn(TD, NUM, "whitespace-nowrap font-semibold")}>
                            {plan.qty}
                          </td>
                          <td data-label="Status" className={cn(TD, "whitespace-nowrap")}>
                            <StatusBadge status={plan.status} />
                          </td>
                          <td data-label="Barcode" className={cn(TD, "whitespace-nowrap font-mono text-xs")}>
                            {plan.barcode || <span className="text-muted-foreground">Pending</span>}
                          </td>
                          <td data-label="Batch" className={cn(TD, "whitespace-nowrap")}>
                            {plan.batch_no || <span className="text-muted-foreground">—</span>}
                          </td>
                          <td data-label="Lines" className={cn(TD, NUM)}>
                            {plan.productionPlanDetail?.length || 0}
                          </td>
                          <td className="vl-actions whitespace-nowrap px-3 py-1.5 text-right">
                            <RowActions plan={plan} />
                          </td>
                        </tr>
                      ))}
                </tbody>
              </table>
            </div>

            {!loading && total > filters.limit && <ProductionPagination />}
          </>
        )}
      </div>

      {/* Process order create / edit / view — full-height sheet */}
      {showModal && (
        <div
          className="fixed inset-0 z-50 !mt-0 flex items-center justify-center bg-black/50 p-1.5 sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="po-dialog-title"
        >
          <div className="flex h-[96dvh] w-full max-w-[1600px] flex-col overflow-hidden rounded-xl border border-border bg-muted shadow-xl dark:bg-background">
            <div className="flex flex-shrink-0 items-center justify-between gap-3 border-b border-primary/15 bg-background px-3 py-2 sm:px-4">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                  <Factory size={16} />
                </span>
                <div className="min-w-0">
                  <p className="text-[11.5px] leading-tight text-muted-foreground">Lab · Process Orders</p>
                  <h2 id="po-dialog-title" className="truncate text-sm font-semibold text-foreground sm:text-base">
                    {modalMode === MODAL_MODES.CREATE && "New Process Order"}
                    {modalMode === MODAL_MODES.EDIT && "Edit Process Order"}
                    {modalMode === MODAL_MODES.VIEW && "Process Order Details"}
                  </h2>
                </div>
              </div>
              <button
                type="button"
                onClick={closeModal}
                disabled={isCreating || isUpdating}
                title="Close (Esc)"
                aria-label="Close dialog"
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <X size={18} />
              </button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto p-1.5 sm:p-2 lg:overflow-hidden">
              <ProcessOrderForm
                mode={modalMode}
                editingItem={editingItem}
                productionType={productionType}
                setProductionType={setProductionType}
                onSubmit={
                  modalMode === MODAL_MODES.CREATE
                    ? handleCreateProductionPlan
                    : handleUpdateProductionPlan
                }
                onCancel={closeModal}
                isSubmitting={isCreating || isUpdating}
                prefill={modalMode === MODAL_MODES.CREATE ? planPrefill : null}
              />
            </div>
          </div>
        </div>
      )}

      <SendToProductionModal
        plan={selectedPlan}
        isOpen={showSendModal}
        onClose={() => setShowSendModal(false)}
        onConfirm={handleConfirmSend}
        isSending={isSending}
      />

      {/* Insufficient Stock Modal */}
      {showStockErrorModal && (
        <div className="fixed inset-0 z-[9999] flex items-center justify-center p-3" role="alertdialog" aria-modal="true" aria-labelledby="po-stock-title">
          <div
            className="absolute inset-0 bg-black/60"
            onClick={() => setShowStockErrorModal(false)}
          />
          <div className={cn(DIALOG, "relative z-10 max-w-lg border border-border bg-background shadow-xl")}>
            {/* Header */}
            <div className={cn(DIALOG_HEAD, "flex items-center gap-3")}>
              <span className={cn("flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg", CHIP.bad)}>
                <AlertTriangle size={18} />
              </span>
              <div className="min-w-0">
                <h2 id="po-stock-title" className="text-base font-semibold text-primary">
                  Cannot Send to Production
                </h2>
                <p className="text-xs text-muted-foreground">
                  {stockErrorDetails.length > 0
                    ? `${stockErrorDetails.length} ${stockErrorDetails.length === 1 ? 'material' : 'materials'} have insufficient stock`
                    : 'Stock validation failed — please review'}
                </p>
              </div>
            </div>

            {/* Body */}
            <div className={cn(DIALOG_BODY, "space-y-3")}>
              {stockErrorDetails.length > 0 ? (
                stockErrorDetails.map((err, i) => {
                  const pct = Math.min(100, Math.max(0, (err.availableStock / err.requiredQty) * 100));
                  return (
                    <div key={i} className="rounded-xl border border-border p-3">
                      {/* Item identity */}
                      <div className="mb-2.5 flex min-w-0 flex-wrap items-center gap-2">
                        <Package size={15} className="flex-shrink-0 text-primary" />
                        <span className={CODE_CHIP}>{err.materialId}</span>
                        <span className="min-w-0 truncate text-sm font-semibold text-foreground">{err.materialName}</span>
                      </div>

                      {/* Qty breakdown */}
                      <dl className="mb-2.5 grid grid-cols-3 gap-2 text-center">
                        <div className="rounded-lg bg-muted/60 p-2">
                          <dt className="text-[11.5px] text-muted-foreground">Required</dt>
                          <dd className="text-sm font-semibold tabular-nums">{parseFloat(err.requiredQty).toFixed(2)} <span className="text-[11px] font-medium text-muted-foreground">KG</span></dd>
                        </div>
                        <div className={cn("rounded-lg p-2", CHIP.ok)}>
                          <dt className="text-[11.5px] opacity-80">Available</dt>
                          <dd className="text-sm font-semibold tabular-nums">{parseFloat(err.availableStock).toFixed(2)} <span className="text-[11px] font-medium opacity-80">KG</span></dd>
                        </div>
                        <div className={cn("rounded-lg p-2", CHIP.bad)}>
                          <dt className="text-[11.5px] opacity-80">Shortage</dt>
                          <dd className="text-sm font-semibold tabular-nums">{parseFloat(err.shortage).toFixed(2)} <span className="text-[11px] font-medium opacity-80">KG</span></dd>
                        </div>
                      </dl>

                      {/* Availability progress bar */}
                      <div className="mb-1 flex justify-between text-[11.5px] text-muted-foreground">
                        <span>Stock availability</span>
                        <span className="font-semibold tabular-nums text-foreground">
                          {Math.min(100, Math.round((err.availableStock / err.requiredQty) * 100))}%
                        </span>
                      </div>
                      <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                        <div className="h-full rounded-full bg-primary transition-all duration-500" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  );
                })
              ) : (
                <div className="space-y-2">
                  {stockValidationErrors.map((msg, i) => (
                    <div key={i} className={cn("flex items-start gap-2 rounded-lg p-3 text-sm", CHIP.bad)}>
                      <AlertCircle size={14} className="mt-0.5 flex-shrink-0" />
                      <span>{msg}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer */}
            <div className={cn(DIALOG_FOOT, "items-center justify-between")}>
              <p className="text-xs text-muted-foreground">
                Please procure missing materials before sending to production.
              </p>
              <button
                type="button"
                onClick={() => setShowStockErrorModal(false)}
                className="inline-flex h-9 flex-shrink-0 items-center rounded-lg bg-primary px-5 text-sm font-semibold text-primary-foreground hover:opacity-90"
                autoFocus
              >
                OK, I Understand
              </button>
            </div>
          </div>
        </div>
      )}

      {confirmDialog}
    </div>
  );
};

export default ProductionTab;
