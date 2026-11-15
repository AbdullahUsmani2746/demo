// components/BOMTabOptimized.js
"use client";
import React, { useState, useMemo, useCallback, useEffect, useRef } from "react";
import {
  Plus,
  Edit,
  Copy,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Save,
  Loader2,
  Eye,
  FileText,
  GripVertical,
  Layers,
  X,
} from "lucide-react";
import { toast } from "sonner";
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useQuery } from "@tanstack/react-query";
import SearchableSelect from "@/components/ui/searchable-select";
import { useBOM } from "@/hooks/useBOM";
import { useDebounce } from "@/hooks/useDebounce";
import BOMForm from "./BOMForm";
import { useSession } from "next-auth/react";
import { generateBOMPDF } from "@/components/Template/Bom";
import { generateBOMCalculationPDF } from "@/components/Template/BOMView";
import { useCompany } from "@/context/CompanyContext";
import useKeyboardShortcuts from "@/hooks/useKeyboardShortcuts";
import KeyboardHint, { KeyCombo } from "@/components/ui/KeyboardHint";
import { Skeleton } from "@/components/ui/skeleton";
import {
  LabHeader,
  LabCard,
  LabEmpty,
  Chip,
  CODE_CHIP,
  TH,
  TD,
  NUM,
  TOTAL_ROW,
  DIALOG,
  DIALOG_HEAD,
  DIALOG_BODY,
  DIALOG_FOOT,
} from "../shared/LabUI";

// Local look for this tab (on top of LabUI).
const ICON_BTN =
  "inline-flex h-8 w-8 items-center justify-center rounded-lg text-primary/70 transition-colors hover:bg-primary/10 hover:text-primary";
const SELECT =
  "h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none transition-shadow focus:border-primary focus:ring-[3px] focus:ring-primary/15";
const PAGER_BTN =
  "inline-flex h-9 items-center gap-1 rounded-lg border border-input bg-background px-3 text-sm text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50";
const FIELD =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-foreground outline-none transition-shadow focus:border-primary focus:ring-[3px] focus:ring-primary/15";
const FIELD_LABEL = "mb-1 block text-[12px] font-semibold text-muted-foreground";
const INFO_TILE = "min-w-0 rounded-lg border border-border bg-background px-3 py-1.5";
const INFO_LABEL = "block text-[10.5px] font-semibold uppercase tracking-wide text-muted-foreground";
// Total row of the BOM View table: stays at the bottom while the rows scroll.
const STICKY_FOOT =
  "sticky bottom-0 z-10 bg-muted px-3 py-2 shadow-[inset_0_2px_0_hsl(var(--primary))]";

// BOM View order — same as the BOM PDF (Template/BOMView.jsx): codes with
// letters first (A→Z, e.g. ENC13, ENC33, V-12734), then all-digit codes
// (1907, 1908, 2603). Display only — used on a copy, never on the data.
const isNumericBomCode = (c) => /^\d+$/.test(String(c ?? "").trim());
const byBomCode = (a, b) => {
  const ca = String(a?.material_code ?? "").trim();
  const cb = String(b?.material_code ?? "").trim();
  const na = isNumericBomCode(ca);
  const nb = isNumericBomCode(cb);
  if (na !== nb) return na ? 1 : -1;
  return ca.localeCompare(cb, undefined, { numeric: true, sensitivity: "base" });
};

// Stable id of a BOM View row for drag-and-drop.
const bomRowId = (detail, idx) => String(detail?.id ?? `${detail?.material_id}-${idx}`);

// One draggable row of the BOM View table (@dnd-kit, same as RecipeTab).
// Only the grip handle starts a drag, so the S.No box stays typeable.
const SortableBomRow = ({ id, children }) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    setActivatorNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });

  const style = {
    // Translate (not Transform) so the row is not stretched while dragging.
    transform: CSS.Translate.toString(transform),
    transition,
    position: "relative",
    zIndex: isDragging ? 10 : undefined,
  };

  return (
    <tr
      ref={setNodeRef}
      style={style}
      className={`transition-colors ${
        isDragging ? "bg-primary/10 shadow-lg" : "hover:bg-muted/30"
      }`}
    >
      {children({ ref: setActivatorNodeRef, ...attributes, ...listeners })}
    </tr>
  );
};

const BOMTab = () => {
  const { data: session } = useSession();
  const { company } = useCompany();

  const [filters, setFilters] = useState({
    search: "",
    filterStatus: "",
    page: 1,
    limit: 10,
    sortBy: "id",
    sortOrder: "desc",
  });

  const [localSearch, setLocalSearch] = useState(""); // local input value
  const [hasSearched, setHasSearched] = useState(false); // KEY: table visibility control

  const debouncedSearch = useDebounce(filters.search, 500);

  const [modalState, setModalState] = useState({
    showModal: false,
    modalType: "",
    modalMode: "create",
    editingItem: null,
    selectedBomToClone: null,
  });

  const [calcModal, setCalcModal] = useState({
    show: false,
    item: null,
    qty: "", // opens empty; the BOM's saved Target Qty fills it if there is one
    customerAcno: "",
    customerName: "",
    printType: "",
    soNo: "", // optional Sale Order the batch is for — printed on the PDF
    note: "", // free-text note printed above Comments — not saved
    rows: [], // bom_details in the order the user arranged them (S.No box) — the PDF prints this order
  });

  // BOM View: the BOM's saved Target Qty and Remarks (BomMaster.target_qty /
  // remarks, app/api/manufacturing/bom/[id]/view) fill the boxes when it opens.
  // A failed load just leaves them empty.
  const [bomViewSaving, setBomViewSaving] = useState(false);
  useEffect(() => {
    const id = calcModal.show ? calcModal.item?.id : null;
    if (!id) return;
    let cancelled = false;
    fetch(`/api/manufacturing/bom/${id}/view`)
      .then((res) => (res.ok ? res.json() : null))
      .then((saved) => {
        if (cancelled || !saved) return;
        // Saved S.No → rows in that order; lines with no S.No keep the code
        // order after them.
        const snoOf = new Map(
          (saved.order || [])
            .filter((o) => o.sno != null)
            .map((o) => [Number(o.material_id), Number(o.sno)]),
        );
        setCalcModal((prev) => {
          if (prev.item?.id !== id) return prev;
          const rows = snoOf.size
            ? prev.rows
                .map((r, i) => ({ r, i, s: snoOf.get(Number(r?.material_id)) }))
                .sort((a, b) =>
                  a.s != null && b.s != null ? a.s - b.s : a.s != null ? -1 : b.s != null ? 1 : a.i - b.i,
                )
                .map((x) => x.r)
            : prev.rows;
          return {
            ...prev,
            rows,
            qty: prev.qty === "" && saved.target_qty != null ? Number(saved.target_qty) : prev.qty,
            note: prev.note === "" && saved.remarks ? saved.remarks : prev.note,
          };
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [calcModal.show, calcModal.item?.id]);

  const saveBomView = async () => {
    const id = calcModal.item?.id;
    if (!id || bomViewSaving) return;
    setBomViewSaving(true);
    try {
      const res = await fetch(`/api/manufacturing/bom/${id}/view`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          remarks: calcModal.note,
          target_qty: calcModal.qty === "" ? null : Number(calcModal.qty),
          // Row order as arranged on screen → BomDetail.sno
          order: calcModal.rows.map((r, i) => ({ material_id: r?.material_id, sno: i + 1 })),
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || "Could not save");
      showNotification("Remarks, Target Qty and S.No order saved");
    } catch (error) {
      showNotification(error.message || "Could not save", "error");
    } finally {
      setBomViewSaving(false);
    }
  };

  const moveRow = (from, to) => {
    if (from === to) return;
    setCalcModal((prev) => {
      const rows = [...prev.rows];
      const [moved] = rows.splice(from, 1);
      rows.splice(to, 0, moved);
      return { ...prev, rows };
    });
  };

  // Drag-and-drop of BOM View rows. A small move threshold keeps a click on
  // the handle from starting a drag by accident.
  const bomRowSensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );

  const handleBomRowDragEnd = ({ active, over }) => {
    if (!over || active.id === over.id) return;
    const ids = calcModal.rows.map(bomRowId);
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from !== -1 && to !== -1) moveRow(from, to);
  };

  // Customers for the "print this BOM for…" picker. Only fetched once the
  // view dialog has been opened at least once.
  const { data: customers = [], isLoading: customersLoading } = useQuery({
    queryKey: ["customersDropdown"],
    queryFn: async () => {
      const response = await fetch("/api/forms/customers?limit=1000");
      if (!response.ok) throw new Error("Failed to fetch customers");
      const res = await response.json();
      return res.customers ?? [];
    },
    staleTime: 5 * 60 * 1000,
    enabled: calcModal.show,
  });

  const customerOptions = useMemo(
    () =>
      customers.map((c) => ({
        value: String(c.acno),
        label: `${c.acname} (${c.acno})`,
        name: c.acname,
      })),
    [customers],
  );

  // Open Sale Orders of the chosen customer, from the existing orders API
  // (multiFilters narrows to the customer, activeOnly drops fully closed ones).
  const { data: saleOrders = [], isLoading: saleOrdersLoading } = useQuery({
    queryKey: ["bomViewSaleOrders", calcModal.customerAcno],
    queryFn: async () => {
      const params = new URLSearchParams({
        multiFilters: JSON.stringify({ party_code: [Number(calcModal.customerAcno)] }),
        activeOnly: "true", // also leaves out orders waiting for CEO approval
        limit: "200",
      });
      const res = await fetch(`/api/orders/saleOrder?${params}`);
      if (!res.ok) throw new Error("Failed to fetch sale orders");
      return (await res.json()).data ?? [];
    },
    enabled: calcModal.show && Boolean(calcModal.customerAcno),
    staleTime: 60 * 1000,
  });

  // Orders carrying this BOM's finished item are listed first.
  const saleOrderOptions = useMemo(() => {
    const itcd = Number(calcModal.item?.finished_id);
    return saleOrders
      .map((o) => {
        const line = o.orderDetails?.find((d) => d.itcd === itcd);
        return {
          value: String(o.order_no),
          hasItem: Boolean(line),
          label: `SO ${o.order_no} · ${new Date(o.dated).toLocaleDateString("en-GB", {
            day: "2-digit",
            month: "short",
            year: "numeric",
          })}${
            o.sale_po ? ` · PO ${o.sale_po}` : ""
          }${line ? ` · has this item (${Number(line.qty || 0).toFixed(2)} KG)` : ""}`,
        };
      })
      .sort((a, b) => Number(b.hasItem) - Number(a.hasItem) || Number(b.value) - Number(a.value));
  }, [saleOrders, calcModal.item?.finished_id]);

  // Current stock (KG, all godowns) of the finished item and every material.
  const stockItcds = useMemo(() => {
    const item = calcModal.item;
    if (!item) return [];
    return [
      ...new Set(
        [item.finished_id, ...(item.bom_details ?? []).map((d) => d?.material_id)]
          .map(Number)
          .filter(Number.isFinite),
      ),
    ];
  }, [calcModal.item]);

  // Latest Monthly Opening Stock + movements since that month, in ONE call
  // (app/api/material/bom-stock). Items not returned read 0.
  const { data: stockMap = {}, isLoading: stockLoading } = useQuery({
    queryKey: ["bomViewStock", stockItcds],
    queryFn: async () => {
      const res = await fetch(`/api/material/bom-stock?items=${stockItcds.join(",")}`);
      if (!res.ok) throw new Error("Failed to fetch stock");
      const byItcd = (await res.json()).data ?? {};
      return Object.fromEntries(stockItcds.map((itcd) => [itcd, Number(byItcd[itcd]) || 0]));
    },
    enabled: calcModal.show && stockItcds.length > 0,
    staleTime: 30 * 1000,
  });

  const stockOf = (itcd) => {
    if (stockLoading) return "…";
    const v = stockMap[Number(itcd)];
    return v === undefined ? "—" : v.toFixed(3);
  };

  const [bomFormData, setBomFormData] = useState({
    finished_id: "",
    category: "Finished",
    instructions: "A",
    bomDetails: [],
  });
  const [sourceBomId, setSourceBomId] = useState(null);
  const [saveDisabled, setSaveDisabled] = useState(false);
  const [existingBOM, setExistingBOM] = useState(null);

  // The list loads straight away (paged); the search box narrows it.
  const {
    bomItems,
    loading,
    total,
    totalPages,
    createBOM,
    updateBOM,
    isCreating,
    isUpdating,
    items,
  } = useBOM({
    ...filters,
    search: debouncedSearch,
  });

  const tableData = useMemo(() => bomItems, [bomItems]);

  // Sync localSearch -> filters.search + hasSearched
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localSearch !== filters.search) {
        setFilters((prev) => ({ ...prev, search: localSearch, page: 1 }));
        if (localSearch.trim() !== "") {
          setHasSearched(true);
        } else {
          setHasSearched(false);
        }
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [localSearch, filters.search]);

  const checkExistingBOM = useCallback(
    async (finishedId) => {
      if (!finishedId) {
        setExistingBOM(null);
        setSaveDisabled(false);
        return;
      }
      try {
        const response = await fetch(
          `/api/manufacturing/bom/validation?checkType=productStatus&finishedId=${finishedId}`,
        );
        if (response.ok) {
          const result = await response.json();
          if (result.hasActiveBOM) {
            setExistingBOM(result.bom);
            if (
              modalState.modalMode === "create" &&
              !modalState.selectedBomToClone
            ) {
              setSaveDisabled(true);
            }
          } else {
            setExistingBOM(null);
            setSaveDisabled(false);
          }
        }
      } catch (error) {
        console.error("Error checking existing BOM:", error);
        setSaveDisabled(false);
      }
    },
    [modalState.modalMode, modalState.selectedBomToClone],
  );

  useEffect(() => {
    if (bomFormData.finished_id && modalState.showModal) {
      checkExistingBOM(bomFormData.finished_id);
    }
  }, [bomFormData.finished_id, modalState.showModal, checkExistingBOM]);

  // Same messages as before, shown as sonner toasts (Toaster in app/layout.js).
  const showNotification = useCallback((message, type = "success") => {
    if (type === "error") toast.error(message);
    else toast.success(message);
  }, []);

  const handleGeneratePDF = useCallback(
    async (item) => {
      try {
        const bomData = {
          bomNo: String(item.id || "N/A"),
          user: "N/A",
          bomDate: new Date(item.dated).toLocaleDateString("en-GB"),
          productNo: String(item.finished_id || "N/A"),
          jobNo: String(item.finished_id || "N/A"),
          productName: String(item.product_name || "N/A"),
          productCategory: String(
            item.product_ic_id === 1 ? "Finished" : "Semi Finished",
          ),
          items:
            item.bom_details?.map((detail) => ({
              mm: String(detail.material_id || "N/A"),
              code: String(detail.material_id || "N/A"),
              desc: String(detail.material_desc || detail.item?.item || "N/A"),
              category: String(detail.material_category || "N/A"),
              pct: Number(detail.material_percentage || 0),
            })) || [],
        };

        const doc = generateBOMPDF([bomData], session, company);

        const pdfBlob = doc.output("blob");
        const pdfUrl = URL.createObjectURL(pdfBlob);

        const printWindow = window.open(pdfUrl, "_blank");

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
    [session, company, showNotification],
  );

  const handleSearch = useCallback((value) => {
    setLocalSearch(value);
  }, []);

  const handleFilterChange = useCallback((filterStatus) => {
    setFilters((prev) => ({ ...prev, filterStatus, page: 1 }));
  }, []);

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
    }));
  }, []);

  const openModal = useCallback((mode, type, item = null) => {
    setModalState((prev) => ({
      ...prev,
      modalMode: mode,
      modalType: type,
      editingItem: item,
      selectedBomToClone: null,
      showModal: true,
    }));
    setSourceBomId(null);
    setExistingBOM(null);
    setSaveDisabled(false);

    if (item) {
      const category = item.product_ic_id === 1 ? "Finished" : "Semi Finished";
      setBomFormData({
        finished_id: item.finished_id,
        category: category,
        instructions: item.instructions === "A" ? "A" : "B",
        bomDetails:
          item.bom_details?.map((detail) => ({
            material_id: detail.material_id,
            material_desc: detail.material_desc || detail.item?.item || "",
            material_code: detail.material_code || detail.item?.code || "",
            material_percentage: detail.material_percentage,
            material_category: detail.material_category || "",
          })) || [],
      });
    } else {
      setBomFormData({
        finished_id: "",
        category: "Finished",
        instructions: "A",
        bomDetails: [],
      });
    }
  }, []);

  const handleCloneBOM = useCallback(
    (item) => {
      setModalState((prev) => ({
        ...prev,
        modalMode: "create",
        modalType: "bom",
        editingItem: null,
        selectedBomToClone: item,
        showModal: true,
      }));
      setSourceBomId(item.id);
      setExistingBOM(null);
      setSaveDisabled(false);
      setBomFormData({
        finished_id: "",
        category: item.product_ic_id === 1 ? "Finished" : "Semi Finished",
        instructions: "A",
        bomDetails:
          item.bom_details?.map((detail) => ({
            material_id: detail.material_id,
            material_desc: detail.item?.item || detail.material_desc || "",
            material_code: detail.material_code || detail.item?.code || "",
            material_percentage: detail.material_percentage,
            material_category: detail.material_category || "",
          })) || [],
      });
      showNotification(
        `"${item.product_name}" BOM selected for cloning! Please select your base product.`,
        "success",
      );
    },
    [showNotification],
  );

  const closeModal = useCallback(() => {
    setModalState({
      showModal: false,
      modalType: "",
      modalMode: "create",
      editingItem: null,
      selectedBomToClone: null,
    });
    setBomFormData({
      finished_id: "",
      category: "Finished",
      instructions: "A",
      bomDetails: [],
    });
    setSourceBomId(null);
    setExistingBOM(null);
    setSaveDisabled(false);
  }, []);

  const handleCreateBOM = useCallback(async () => {
    if (!bomFormData.finished_id || bomFormData.bomDetails.length === 0) {
      showNotification(
        "Please fill all required fields and add at least one material",
        "error",
      );
      return;
    }
    const totalPercentage = bomFormData.bomDetails.reduce(
      (sum, mat) => sum + (parseFloat(mat.material_percentage) || 0),
      0,
    );
    const tolerance = 0.01; // 0.01% tolerance for floating point issues
    // Finished BOM: 1% leeway either side of 100–110% (i.e. 99–111%)
    // const finishedTolerance = 1;
    // Finished BOM (create): total must be 100%, give or take 0.03%
    // (99.97–100.03). The old 100–110% range is gone.
    const finishedTolerance = 0.03;

    // Validate percentages: Finished allows 100-110%, others require exactly 100%
    if (bomFormData.category === "Finished") {
      if (
        // totalPercentage < 100 - tolerance ||
        // totalPercentage > 110 + tolerance
        // totalPercentage < 100 - finishedTolerance ||
        // totalPercentage > 110 + finishedTolerance
        Math.abs(totalPercentage - 100) > finishedTolerance
      ) {
        // showNotification("Material percentages must add up correctly", "error");
        showNotification(
          `Material percentages must total 100% — current total is ${totalPercentage.toFixed(2)}%`,
          "error",
        );
        return;
      }
    } else {
      if (Math.abs(totalPercentage - 100) > tolerance) {
        showNotification(
          "Material percentages must add up to exactly 100%",
          "error",
        );
        return;
      }
    }
    if (
      existingBOM &&
      existingBOM.instructions === "A" &&
      !modalState.selectedBomToClone
    ) {
      showNotification(
        "An active BOM already exists for this product. Cannot create new BOM.",
        "error",
      );
      return;
    }
    try {
      const result = await createBOM(bomFormData);
      if (result.data) {
        closeModal();
        showNotification("BOM created successfully!");
      } else {
        showNotification(result.error || "Failed to create BOM", "error");
      }
    } catch (error) {
      showNotification("Failed to create BOM", "error");
    }
  }, [
    bomFormData,
    createBOM,
    closeModal,
    showNotification,
    existingBOM,
    modalState.selectedBomToClone,
  ]);

  const handleUpdateBOM = useCallback(async () => {
    if (!bomFormData.finished_id || bomFormData.bomDetails.length === 0) {
      showNotification(
        "Please fill all required fields and add at least one material",
        "error",
      );
      return;
    }
    const totalPercentage = bomFormData.bomDetails.reduce(
      (sum, mat) => sum + (parseFloat(mat.material_percentage) || 0),
      0,
    );

    const tolerance = 0.01; // 0.01% tolerance for floating point issues
    // Finished BOM: 1% leeway either side of 100–110% (i.e. 99–111%)
    const finishedTolerance = 1;


    // Validate percentages: Finished allows 100-110%, others require exactly 100%
    if (
      bomFormData.category === "Finished" ||
      (existingBOM && existingBOM.item?.ic_id === 1)
    ) {
      if (
        // totalPercentage < 100 - tolerance ||
        // totalPercentage > 110 + tolerance
        totalPercentage < 100 - finishedTolerance ||
        totalPercentage > 110 + finishedTolerance
      ) {
        showNotification("Material percentages must add up correctly", "error");
        return;
      }
    } else {
      if (Math.abs(totalPercentage - 100) > tolerance) {
        showNotification(
          "Material percentages must add up to exactly 100%",
          "error",
        );
        return;
      }
    }
    try {
      const result = await updateBOM({
        id: modalState.editingItem.id,
        data: bomFormData,
      });
      if (result.data) {
        closeModal();
        showNotification("BOM updated successfully!");
      } else {
        showNotification(result.error || "Failed to update BOM", "error");
      }
    } catch (error) {
      showNotification("Failed to update BOM", "error");
    }
  }, [
    bomFormData,
    modalState.editingItem,
    updateBOM,
    closeModal,
    showNotification,
    existingBOM, // read by the Finished check above — was missing (stale value)
  ]);

  const openBomView = useCallback(
    (item) =>
      setCalcModal({
        show: true,
        item,
        qty: "",
        customerAcno: "",
        customerName: "",
        printType: "",
        soNo: "",
        note: "",
        rows: [...(item.bom_details || [])].sort(byBomCode),
      }),
    [],
  );

  // One BOM in the list. Under md the row becomes a card (table.vl-grid).
  const BomTableRow = useCallback(
    ({ item }) => (
      <tr className="border-b border-border/60 transition-colors hover:bg-primary/[0.03]">
        <td data-label="Product" className={`${TD} col-span-2 max-w-[420px]`}>
          <p className="truncate font-semibold text-foreground" title={item.product_name}>
            {item.product_name}
          </p>
          <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
            <span className={CODE_CHIP}>{item.finished_id}</span>
            {item.product_code && (
              <span className="font-mono text-[12px] text-muted-foreground">
                {item.product_code}
              </span>
            )}
          </div>
        </td>
        <td data-label="Date Created" className={`${TD} whitespace-nowrap text-foreground/90`}>
          {new Date(item.dated).toLocaleDateString("en-US", {
            year: "numeric",
            month: "short",
            day: "numeric",
          })}
        </td>
        <td data-label="Status" className={TD}>
          <Chip tone={item.instructions === "A" ? "ok" : "bad"}>
            <span className="h-1.5 w-1.5 rounded-full bg-current" />
            {item.instructions === "A" ? "Active" : "Inactive"}
          </Chip>
        </td>
        <td data-label="Materials" className={`${TD} ${NUM} md:pr-6`}>
          {item.material_count}
        </td>
        <td data-label="Recipes" className={`${TD} ${NUM} md:pr-6`}>
          {item.recipe_count > 0 ? (
            item.recipe_count
          ) : (
            <span className="text-muted-foreground">None</span>
          )}
        </td>
        <td className="vl-actions whitespace-nowrap px-3 py-1.5 text-right">
          <div className="flex items-center justify-end gap-0.5 max-md:justify-start">
            <button
              type="button"
              onClick={() => openBomView(item)}
              className={ICON_BTN}
              title="Quick View & Calculation"
              aria-label="Quick View & Calculation"
            >
              <Eye className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => handleCloneBOM(item)}
              className={ICON_BTN}
              title="Clone BOM"
              aria-label="Clone BOM"
            >
              <Copy className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => openModal("edit", "bom", item)}
              className={ICON_BTN}
              title="Edit"
              aria-label="Edit"
            >
              <Edit className="h-4 w-4" />
            </button>
          </div>
        </td>
      </tr>
    ),
    [openModal, handleCloneBOM, openBomView],
  );

  const shouldDisableSave = useMemo(() => {
    if (isCreating || isUpdating) return true;
    if (modalState.modalMode === "view") return true;
    if (
      modalState.modalMode === "create" &&
      !modalState.selectedBomToClone &&
      existingBOM &&
      existingBOM.instructions === "A"
    ) {
      return true;
    }
    return saveDisabled;
  }, [
    isCreating,
    isUpdating,
    modalState.modalMode,
    modalState.selectedBomToClone,
    existingBOM,
    saveDisabled,
  ]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  const searchInputRef = useRef(null);

  const focusSearch = useCallback(() => {
    searchInputRef.current?.focus();
    searchInputRef.current?.select();
  }, []);

  const saveFromKeyboard = useCallback(() => {
    if (shouldDisableSave) return;
    if (modalState.editingItem) handleUpdateBOM();
    else handleCreateBOM();
  }, [
    shouldDisableSave,
    modalState.editingItem,
    handleUpdateBOM,
    handleCreateBOM,
  ]);

  // List-level keys — off while the dialog owns the keyboard
  useKeyboardShortcuts(
    {
      "/": focusSearch,
      "alt+n": {
        handler: () => openModal("create", "bom"),
        allowInInput: true,
      },
    },
    !modalState.showModal && !calcModal.show,
  );

  // Dialog-level keys
  useKeyboardShortcuts(
    {
      "ctrl+s": { handler: saveFromKeyboard, allowInInput: true },
      escape: {
        handler: () => {
          // The first Escape belongs to any open dropdown so the user does
          // not lose a half-filled BOM.
          if (document.querySelector(".react-select__menu")) return;
          if (!isCreating && !isUpdating) closeModal();
        },
        allowInInput: true,
      },
    },
    modalState.showModal,
  );

  const LIST_SHORTCUTS = [
    { combo: "Alt+N", label: "New BOM" },
    { combo: "/", label: "Focus search" },
    { combo: "Shift+?", label: "Show this help" },
  ];

  // Print the BOM View — rows in the order the user arranged on screen.
  const printBomView = () => {
    const doc = generateBOMCalculationPDF(
      // rows = the order the user arranged on screen
      { ...calcModal.item, bom_details: calcModal.rows, keepOrder: true },
      Number(calcModal.qty) || 0,
      session,
      company,
      calcModal.customerName,
      calcModal.printType,
      calcModal.soNo,
      calcModal.note
    );
    const pdfBlob = doc.output("blob");
    const pdfUrl = URL.createObjectURL(pdfBlob);
    const printWindow = window.open(pdfUrl, "_blank");

    if (printWindow) {
      printWindow.onload = () => {
        printWindow.focus();
        printWindow.print();
      };
    }

    setTimeout(() => {
      URL.revokeObjectURL(pdfUrl);
    }, 10000);
  };

  // Sortable column header (server-side sort through useBOM).
  const SortHeader = ({ field, children, className = "" }) => {
    const active = filters.sortBy === field;
    return (
      <th className={`${TH} ${className}`}>
        <button
          type="button"
          onClick={() => handleSort(field)}
          className="inline-flex items-center gap-1 uppercase hover:opacity-80"
        >
          {children}
          {active ? (
            filters.sortOrder === "asc" ? (
              <ArrowUp className="h-3.5 w-3.5" />
            ) : (
              <ArrowDown className="h-3.5 w-3.5" />
            )
          ) : (
            <ArrowUpDown className="h-3 w-3 opacity-50" />
          )}
        </button>
      </th>
    );
  };

  const formTitle = modalState.selectedBomToClone
    ? "Clone Bill of Materials"
    : modalState.modalMode === "create"
      ? "Create Bill of Materials"
      : modalState.modalMode === "edit"
        ? "Edit Bill of Materials"
        : "View Bill of Materials";

  const calcRequiredOf = (detail) =>
    (parseFloat(detail.material_percentage) / 100) * calcModal.qty;
  const calcTotalPct = calcModal.rows.reduce(
    (sum, d) => sum + (parseFloat(d?.material_percentage) || 0),
    0,
  );

  return (
    <div className="space-y-4">
      <LabHeader
        icon={Layers}
        title="Bill of Materials"
        subtitle="Manage your product specifications and material requirements"
        badge={!loading ? total : null}
        actions={
          <>
            {/* Hidden while a dialog is open so its own cheat sheet owns "?" */}
            {!modalState.showModal && !calcModal.show && (
              <KeyboardHint shortcuts={LIST_SHORTCUTS} />
            )}
            <button
              type="button"
              onClick={() => openModal("create", "bom")}
              title="New BOM (Alt + N)"
              className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90"
            >
              <Plus className="h-4 w-4" />
              New BOM
              <span className="hidden opacity-70 lg:inline">
                <KeyCombo combo="Alt+N" />
              </span>
            </button>
          </>
        }
      />

      <LabCard>
        {/* Toolbar: search + filters, wraps on a phone */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="relative min-w-[200px] flex-1 sm:max-w-md">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
            <input
              ref={searchInputRef}
              type="text"
              value={localSearch}
              onChange={(e) => handleSearch(e.target.value)}
              placeholder="Search BOMs by product code or name..."
              aria-label="Search BOMs by product code or name"
              className="h-10 w-full rounded-lg border border-input bg-background pl-9 pr-10 text-sm text-foreground outline-none transition-shadow placeholder:text-muted-foreground focus:border-primary focus:ring-[3px] focus:ring-primary/15"
            />
            <span className="pointer-events-none absolute right-2 top-1/2 hidden -translate-y-1/2 opacity-60 sm:inline">
              <KeyCombo combo="/" />
            </span>
          </div>
          <select
            value={filters.filterStatus}
            onChange={(e) => handleFilterChange(e.target.value)}
            aria-label="Status"
            className={SELECT}
          >
            <option value="">All Status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>
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
            className={SELECT}
          >
            <option value={10}>10 per page</option>
            <option value={25}>25 per page</option>
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
          </select>

          {/* Clear search - back to the start view */}
          {localSearch && (
            <button
              type="button"
              onClick={() => {
                setLocalSearch("");
                setFilters((prev) => ({ ...prev, search: "", page: 1 }));
                setHasSearched(false);
              }}
              className="inline-flex h-10 items-center gap-1.5 rounded-lg border border-input bg-background px-3 text-sm text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
            >
              <X className="h-4 w-4" />
              Clear
            </button>
          )}
        </div>

        {/* Table — rows become cards under md */}
        <div className="max-h-[70vh] overflow-auto">
          <table className="vl-grid w-full text-sm">
            <thead>
              <tr>
                <SortHeader field="finished_id">Product</SortHeader>
                <SortHeader field="dated">Date Created</SortHeader>
                <SortHeader field="instructions">Status</SortHeader>
                <th className={`${TH} text-right`}>Materials</th>
                <th className={`${TH} text-right`}>Recipes</th>
                <th className={`${TH} text-right`}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                Array.from({ length: 6 }).map((_, i) => (
                  <tr key={i} className="border-b border-border/60">
                    {Array.from({ length: 6 }).map((__, j) => (
                      <td key={j} className="px-3 py-3">
                        <Skeleton className="h-4 w-full max-w-[160px]" />
                      </td>
                    ))}
                  </tr>
                ))
              ) : tableData.length === 0 ? (
                <tr>
                  <td colSpan="6">
                    <LabEmpty
                      icon={AlertCircle}
                      title={filters.search || filters.filterStatus ? "No BOMs match" : "No BOMs yet"}
                      hint={filters.search || filters.filterStatus ? "Try a different search term or status." : "Start a new BOM with New BOM (Alt+N)."}
                    />
                  </td>
                </tr>
              ) : (
                tableData.map((item) => <BomTableRow key={item.id} item={item} />)
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {filters.limit < 1000 && totalPages > 1 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2.5">
            <span className="text-sm text-muted-foreground">
              Page <span className="font-semibold text-foreground">{filters.page}</span> of{" "}
              {totalPages}
              <span className="ml-1.5 text-xs">({total} BOMs)</span>
            </span>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() =>
                  setFilters((prev) => ({
                    ...prev,
                    page: Math.max(1, prev.page - 1),
                  }))
                }
                disabled={filters.page === 1}
                className={PAGER_BTN}
              >
                <ChevronLeft className="h-4 w-4" /> Previous
              </button>
              <button
                type="button"
                onClick={() =>
                  setFilters((prev) => ({ ...prev, page: prev.page + 1 }))
                }
                disabled={filters.page >= totalPages}
                className={PAGER_BTN}
              >
                Next <ChevronRight className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}
      </LabCard>

      {/* BOM Form Modal */}
      {modalState.showModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 backdrop-blur-[2px] sm:p-4"
          role="dialog"
          aria-modal="true"
          aria-label="Bill of materials"
        >
          <div className={`${DIALOG} max-w-7xl border border-border bg-background shadow-xl`}>
            <div className={`${DIALOG_HEAD} flex flex-shrink-0 items-center justify-between gap-3`}>
              <div className="min-w-0">
                <h2 className="truncate text-base font-semibold text-primary sm:text-lg">
                  {formTitle}
                </h2>
                <p className="truncate text-xs text-muted-foreground">
                  Product, status and the materials that make it — percentages must total 100%.
                </p>
              </div>
              <button
                type="button"
                onClick={closeModal}
                disabled={isCreating || isUpdating}
                title="Close (Esc)"
                aria-label="Close"
                className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary disabled:cursor-not-allowed disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>
            <div className={DIALOG_BODY}>
              <BOMForm
                formData={bomFormData}
                setFormData={setBomFormData}
                bomItems={bomItems}
                finishItems={items || []}
                isEditing={modalState.modalMode === "edit"}
                isViewMode={modalState.modalMode === "view"}
                isCloning={!!modalState.selectedBomToClone}
                sourceBomId={sourceBomId}
                onSaveDisabled={setSaveDisabled}
              />
            </div>
            <div className={`${DIALOG_FOOT} flex-shrink-0 max-sm:[&>*]:flex-1`}>
              <button
                type="button"
                onClick={closeModal}
                disabled={isCreating || isUpdating}
                title="Close (Esc)"
                className="inline-flex h-10 items-center justify-center rounded-lg border border-input bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
              >
                {modalState.modalMode === "view" ? "Close" : "Cancel"}
              </button>
              {modalState.modalMode !== "view" && (
                <button
                  type="button"
                  onClick={
                    modalState.editingItem ? handleUpdateBOM : handleCreateBOM
                  }
                  disabled={shouldDisableSave}
                  title={`${modalState.editingItem ? "Update" : "Create"} BOM (Ctrl + S)`}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
                >
                  {isCreating || isUpdating ? (
                    <>
                      <Loader2 className="h-4 w-4 animate-spin" />
                      {isCreating ? "Creating..." : "Updating..."}
                    </>
                  ) : (
                    <>
                      <Save className="h-4 w-4" />
                      {modalState.editingItem ? "Update BOM" : "Create BOM"}
                      <span className="hidden opacity-80 md:inline">
                        <KeyCombo combo="Ctrl+S" />
                      </span>
                    </>
                  )}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {/* BOM Calculation Quick View Modal */}
      {calcModal.show && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-2 backdrop-blur-[2px] sm:p-3"
          role="dialog"
          aria-modal="true"
          aria-label="Bill of material view"
        >
          {/* Fixed-height card: header, details and buttons stay put; on wide
              screens only the materials table scrolls, on a phone the body does. */}
          <div className={`${DIALOG} h-[94vh] max-w-[1220px] border border-border bg-background shadow-2xl`}>
            <div className={`${DIALOG_HEAD} flex shrink-0 items-center justify-between gap-3`}>
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <Eye className="h-4 w-4" />
                </span>
                <div className="min-w-0">
                  <h2 className="truncate text-base font-semibold text-primary sm:text-lg">
                    Bill of Material View
                  </h2>
                  <p className="truncate text-xs text-muted-foreground">
                    {calcModal.item?.product_name}
                  </p>
                </div>
              </div>
              <button
                type="button"
                onClick={() => setCalcModal({ ...calcModal, show: false })}
                aria-label="Close"
                className="inline-flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 sm:p-4 lg:overflow-hidden">
              {/* Top Section: what to print for, then the product */}
              <div className="shrink-0 space-y-3 rounded-xl border border-primary/15 bg-primary/5 p-3">
                {/* Line 1: what to print for */}
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:flex lg:flex-wrap lg:items-start">
                  <div className="lg:w-40">
                    <label htmlFor="bom_view_qty" className={FIELD_LABEL}>
                      Target Qty (KG)
                    </label>
                    <div className="relative">
                      <input
                        id="bom_view_qty"
                        type="number"
                        value={calcModal.qty}
                        onChange={(e) =>
                          setCalcModal({
                            ...calcModal,
                            // Cleared box stays empty instead of jumping to 0
                            qty: e.target.value === "" ? "" : parseFloat(e.target.value) || 0,
                          })
                        }
                        className={`${FIELD} pr-10 text-right text-base font-semibold tabular-nums`}
                        autoFocus
                      />
                      <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-xs font-semibold text-muted-foreground">
                        KG
                      </span>
                    </div>
                  </div>

                  {/* Printed in the Customer Name box at the top of the PDF. */}
                  <div className="min-w-0 sm:col-span-2 lg:min-w-[240px] lg:flex-1">
                    <label htmlFor="bom_print_customer" className={FIELD_LABEL}>
                      Customer <span className="text-destructive">*</span>
                    </label>
                    <SearchableSelect
                      inputId="bom_print_customer"
                      value={calcModal.customerAcno}
                      onChange={(value, option) =>
                        setCalcModal((prev) => ({
                          ...prev,
                          customerAcno: value || "",
                          customerName: option?.name || "",
                          printType: value ? "" : prev.printType,
                          // The old customer's order cannot belong to the new one.
                          soNo: "",
                        }))
                      }
                      options={customerOptions}
                      placeholder={
                        customersLoading
                          ? "Loading customers…"
                          : "Search customer by name or code…"
                      }
                      isDisabled={customersLoading}
                      emptyMessage="No customer matches"
                    />
                    {!calcModal.customerAcno && !calcModal.printType && (
                      <p className="mt-1 text-[11.5px] text-muted-foreground">
                        Select a customer or print type to enable printing.
                      </p>
                    )}
                  </div>

                  {/* Optional — printed beside Master Sample on the PDF. */}
                  {calcModal.customerAcno && (
                    <div className="min-w-0 sm:col-span-2 lg:w-72">
                      <label htmlFor="bom_print_so" className={FIELD_LABEL}>
                        Sale Order No{" "}
                        <span className="font-normal normal-case">(optional)</span>
                      </label>
                      <SearchableSelect
                        inputId="bom_print_so"
                        value={calcModal.soNo}
                        onChange={(value) =>
                          setCalcModal((prev) => ({ ...prev, soNo: value || "" }))
                        }
                        options={saleOrderOptions}
                        placeholder={
                          saleOrdersLoading
                            ? "Loading sale orders…"
                            : saleOrderOptions.length
                              ? "Search sale order…"
                              : "No open sale order for this customer"
                        }
                        isDisabled={saleOrdersLoading}
                        emptyMessage="No sale order matches"
                      />
                    </div>
                  )}
                  <div className="lg:w-44">
                    <label htmlFor="bom_print_type" className={FIELD_LABEL}>
                      Print Type
                    </label>
                    <select
                      id="bom_print_type"
                      value={calcModal.printType}
                      onChange={(e) => setCalcModal({ ...calcModal, printType: e.target.value, customerAcno: "", customerName: "", soNo: "" })}
                      className={`${FIELD} px-2 text-[13px] font-medium`}
                    >
                      <option value="">Select Type</option>
                      <option value="STOCK">STOCK</option>
                      <option value="SEMI FINISH">SEMI FINISH</option>
                    </select>
                  </div>
                </div>

                {/* Line 2: the product, and the note printed on the PDF */}
                <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap sm:items-stretch">
                  <div className={INFO_TILE}>
                    <p className={INFO_LABEL}>Material Code</p>
                    <p className="text-sm font-semibold tabular-nums">{calcModal.item?.finished_id}</p>
                  </div>
                  <div className={INFO_TILE}>
                    <p className={INFO_LABEL}>Ink Code</p>
                    <p className="truncate font-mono text-sm font-semibold">{calcModal.item?.product_code || "—"}</p>
                  </div>
                  <div className={`${INFO_TILE} col-span-2 sm:min-w-[180px] sm:flex-1`}>
                    <p className={INFO_LABEL}>Material Description</p>
                    <p className="truncate text-sm font-semibold" title={calcModal.item?.product_name || ""}>
                      {calcModal.item?.product_name}
                    </p>
                  </div>
                  <div className={INFO_TILE}>
                    <p className={INFO_LABEL}>Date</p>
                    <p className="whitespace-nowrap text-sm font-semibold">
                      {calcModal.item?.dated
                        ? new Date(calcModal.item.dated).toLocaleDateString("en-US", {
                          year: "numeric",
                          month: "short",
                          day: "numeric",
                        })
                        : "-"}
                    </p>
                  </div>
                  <div className={INFO_TILE}>
                    <p className={INFO_LABEL}>Current Stock</p>
                    <p className="whitespace-nowrap text-sm font-semibold tabular-nums">
                      {stockOf(calcModal.item?.finished_id)} KG
                    </p>
                  </div>
                  {/* Note printed on the PDF above Comments (e.g. "22.50 =
                      25LTR / 135kg = 150LTR"). Saved with the Save button. */}
                  <div className="col-span-2 min-w-0 sm:min-w-[300px] sm:flex-1">
                    <label htmlFor="bom_view_note" className={INFO_LABEL}>
                      Remarks
                    </label>
                    <input
                      id="bom_view_note"
                      type="text"
                      value={calcModal.note}
                      onChange={(e) => setCalcModal({ ...calcModal, note: e.target.value })}
                      placeholder=""
                      className={`${FIELD} mt-0.5 h-9 text-sm`}
                    />
                  </div>
                </div>
              </div>

              {/* Requirement Table — scrolls inside its card; header and total
                  stay in view. */}
              <div className="max-h-[65vh] min-h-[240px] shrink-0 overflow-auto rounded-xl border border-border lg:max-h-none lg:min-h-0 lg:flex-1 lg:shrink">
                <table className="w-full min-w-[720px] border-collapse text-left text-sm">
                  <thead>
                    <tr>
                      <th className={`${TH} w-28`}>S.No</th>
                      <th className={`${TH} w-32`}>Code</th>
                      <th className={TH}>MM Detail</th>
                      <th className={`${TH} w-32 text-right`}>Percentage</th>
                      <th className={`${TH} w-32 text-right`}>Qty (KG)</th>
                      <th className={`${TH} w-40 text-right`}>Current Stock (KG)</th>
                    </tr>
                  </thead>
                  <DndContext
                    sensors={bomRowSensors}
                    collisionDetection={closestCenter}
                    onDragEnd={handleBomRowDragEnd}
                  >
                  <SortableContext
                    items={calcModal.rows.map(bomRowId)}
                    strategy={verticalListSortingStrategy}
                  >
                  <tbody className="divide-y divide-border bg-background">
                    {/* The S.No order is set by dragging the grip or typing in the S.No box;
                        the PDF prints the same order. */}
                    {calcModal.rows.map((detail, idx) => (
                      <SortableBomRow key={bomRowId(detail, idx)} id={bomRowId(detail, idx)}>
                        {(handleProps) => (
                        <>
                        <td className="px-3 py-1.5 text-sm font-medium text-muted-foreground">
                          <span className="flex items-center gap-1.5">
                            <button
                              type="button"
                              {...handleProps}
                              title="Drag to reorder"
                              aria-label="Drag to reorder"
                              className="cursor-grab touch-none rounded p-0.5 text-muted-foreground/70 hover:bg-primary/10 hover:text-primary focus:outline-none focus-visible:ring-2 focus-visible:ring-primary active:cursor-grabbing"
                            >
                              <GripVertical className="h-4 w-4" />
                            </button>
                            {/* Type a position (1, 2, 3…) and press Enter / leave the box
                                to move this row there. Re-keyed on every position change so
                                it always shows the current S.No. */}
                            <input
                              key={`${idx}-${detail?.id ?? detail?.material_id}`}
                              type="number"
                              min={1}
                              max={calcModal.rows.length}
                              defaultValue={idx + 1}
                              onFocus={(e) => e.target.select()}
                              data-sno={idx}
                              aria-label={`S.No of ${detail?.material_desc || detail?.material_code || "row"}`}
                              onKeyDown={(e) => {
                                if (e.key !== "Enter") return;
                                e.preventDefault();
                                // Where this row is going (same clamp as onBlur)
                                const n = parseInt(e.currentTarget.value, 10);
                                const to = Number.isFinite(n)
                                  ? Math.min(Math.max(n, 1), calcModal.rows.length) - 1
                                  : idx;
                                e.currentTarget.blur(); // applies the move (onBlur)
                                // Cursor goes to the next S.No box (2, then 3, …), skipping
                                // the row just moved there; nothing left below → stop.
                                let next = idx + 1;
                                if (next === to) next += 1;
                                if (next >= calcModal.rows.length) return;
                                setTimeout(() => {
                                  document.querySelector(`input[data-sno="${next}"]`)?.focus();
                                }, 0);
                              }}
                              onBlur={(e) => {
                                const n = parseInt(e.target.value, 10);
                                if (!Number.isFinite(n)) {
                                  e.target.value = idx + 1;
                                  return;
                                }
                                const to = Math.min(Math.max(n, 1), calcModal.rows.length) - 1;
                                if (to === idx) e.target.value = idx + 1;
                                else moveRow(idx, to);
                              }}
                              className="h-7 w-11 rounded-md border border-input bg-background px-1 text-center text-sm font-semibold tabular-nums text-foreground focus:border-primary focus:outline-none"
                            />
                          </span>
                        </td>
                        <td className="px-3 py-1.5">
                          <span className={CODE_CHIP}>{detail?.material_code || "—"}</span>
                        </td>
                        <td className="px-3 py-1.5 font-medium text-foreground">
                          {detail?.material_desc || "—"}
                        </td>
                        <td className={`px-3 py-1.5 ${NUM} text-muted-foreground`}>{`${(parseFloat(detail.material_percentage) || 0).toFixed(3)}%`}</td>
                        <td className={`px-3 py-1.5 ${NUM} font-semibold text-foreground`}>
                          {(parseFloat(detail.material_percentage) / 100 * calcModal.qty).toFixed(3)}
                        </td>
                        {/* Red when there is not enough on hand for the typed quantity. */}
                        <td
                          className={`px-3 py-1.5 ${NUM} font-medium ${
                            !stockLoading &&
                            stockMap[Number(detail?.material_id)] !== undefined &&
                            stockMap[Number(detail?.material_id)] < calcRequiredOf(detail)
                              ? "font-semibold text-destructive"
                              : "text-foreground"
                          }`}
                        >
                          {stockOf(detail?.material_id)}
                        </td>
                        </>
                        )}
                      </SortableBomRow>
                    ))}
                    {(!calcModal.item?.bom_details || calcModal.item.bom_details.length === 0) && (
                      <tr>
                        <td colSpan="6">
                          <LabEmpty icon={AlertCircle} title="No materials found in this BOM." />
                        </td>
                      </tr>
                    )}
                  </tbody>
                  </SortableContext>
                  </DndContext>
                  {calcModal.qty > 0 && (
                    <tfoot>
                      <tr className={TOTAL_ROW}>
                        <td colSpan="3" className={`${STICKY_FOOT} text-right text-[13px]`}>
                          Total Quantity:
                        </td>
                        <td className={`${STICKY_FOOT} ${NUM} text-muted-foreground`}>
                          {calcTotalPct.toFixed(3)}%
                        </td>
                        <td className={`${STICKY_FOOT} ${NUM} text-base text-primary`}>
                          {Number(calcModal.qty).toFixed(2)} KG
                        </td>
                        <td className={STICKY_FOOT} />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            </div>

            <div className={`${DIALOG_FOOT} shrink-0 max-sm:[&>*]:flex-1`}>
              {/* Saves Remarks, Target Qty and the S.No order on this BOM */}
              <button
                type="button"
                onClick={saveBomView}
                disabled={bomViewSaving}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg border border-primary/40 bg-background px-4 text-sm font-semibold text-primary transition-colors hover:bg-primary/10 disabled:cursor-not-allowed disabled:opacity-50"
              >
                {bomViewSaving ? <Loader2 className="h-4 w-4 animate-spin" /> : <Save className="h-4 w-4" />}
                Save
              </button>
              <button
                type="button"
                onClick={() => setCalcModal({ ...calcModal, show: false })}
                className="inline-flex h-10 items-center justify-center rounded-lg border border-input bg-background px-4 text-sm font-medium text-foreground transition-colors hover:bg-muted"
              >
                Close
              </button>
              <button
                type="button"
                disabled={!calcModal.customerAcno && !calcModal.printType}
                title={
                  calcModal.customerAcno || calcModal.printType
                    ? "Print this BOM"
                    : "Select a customer or print type first"
                }
                onClick={printBomView}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                <FileText className="h-4 w-4" />
                Print
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BOMTab;
