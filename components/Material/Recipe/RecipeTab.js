"use client";
import React, { useState, useEffect, useCallback } from "react";
import { Download } from "lucide-react"; // Add this with other icon imports
import excel from "exceljs";
import {
  Plus,
  Edit,
  //Trash2,
  Search,
  ArrowUpDown,
  ChevronLeft,
  ChevronRight,
  AlertCircle,
  Save,
  GripVertical,
  Clock,
  Package,
  Settings,
  Loader2,
  Eye,
  Calculator,
  ScrollText,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { useCompany } from "@/context/CompanyContext";
import Select from "react-select";
import { useRecipes } from "@/hooks/useRecipe";
import { useBOM } from "@/hooks/useBOM";
import { useMachineInstructions } from "@/hooks/useMachineInstruction";
import axios from "axios";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { selectStyles } from "@/components/shared/EntityFormPanel";
import {
  LabHeader,
  LabCard,
  LabEmpty,
  Chip,
  CODE_CHIP,
  TH,
  TH_ROW,
  TD,
  NUM,
  TOTAL_ROW,
  DIALOG,
  DIALOG_HEAD,
  DIALOG_BODY,
  DIALOG_FOOT,
} from "@/components/Material/shared/LabUI";

// DndKit imports for drag and drop
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { DecimationAlgorithm } from "chart.js";

// Shared field look for this screen.
const FIELD_LABEL = "mb-1.5 block text-[12.5px] font-medium text-foreground";
const FIELD_INPUT =
  "h-10 w-full rounded-lg border border-input bg-background px-3 text-sm text-foreground focus:border-primary focus:outline-none focus:ring-2 focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted";
const FIELD_READONLY =
  "h-10 w-full cursor-not-allowed rounded-lg border border-input bg-muted px-3 text-sm font-medium text-foreground";
const FIELD_ERROR = "mt-1 flex items-center gap-1 text-[11.5px] text-destructive";

// Recipe step grid: drag handle (edit only) · # · item · description · % / instruction.
const STEP_COLS_EDIT = "md:grid-cols-[20px_44px_170px_minmax(0,1fr)_180px]";
const STEP_COLS_VIEW = "md:grid-cols-[44px_170px_minmax(0,1fr)_180px]";

const fmtPct = (n) => Number((Number(n) || 0).toFixed(3)).toLocaleString();

/**
 * Promise-based confirm on a Radix AlertDialog (replaces window.confirm).
 * `const ok = await confirm({ title, message })` — true on Continue, false on Cancel / Esc.
 */
const useConfirmDialog = () => {
  const [queue, setQueue] = useState([]);
  const current = queue[0];

  const confirm = useCallback(
    (opts) =>
      new Promise((resolve) => setQueue((q) => [...q, { ...opts, resolve }])),
    [],
  );

  const settle = (ok) => {
    if (!current) return;
    current.resolve(ok);
    setQueue((q) => (q[0] === current ? q.slice(1) : q));
  };

  const dialog = (
    <AlertDialog
      open={!!current}
      onOpenChange={(open) => {
        if (!open) settle(false);
      }}
    >
      <AlertDialogContent className="w-[calc(100vw-1.5rem)] max-w-md rounded-xl">
        <AlertDialogHeader>
          <AlertDialogTitle>{current?.title || "Are you sure?"}</AlertDialogTitle>
          {current?.message && (
            <AlertDialogDescription>{current.message}</AlertDialogDescription>
          )}
        </AlertDialogHeader>
        <AlertDialogFooter className="gap-2">
          <AlertDialogCancel onClick={() => settle(false)}>Cancel</AlertDialogCancel>
          <AlertDialogAction
            onClick={() => settle(true)}
            className={current?.destructive ? "bg-destructive text-destructive-foreground hover:bg-destructive/90" : undefined}
          >
            {current?.confirmLabel || "Continue"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );

  return [confirm, dialog];
};

const exportRecipeViewToExcel = async (recipe) => {
  if (!recipe) return false;

  try {
    // Dynamic import of exceljs for better formatting
    const ExcelJS = (await import("exceljs")).default;
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet(
      `Recipe_${recipe.finished_id || recipe.receipe_id}`,
    );

    // ========== 1. HEADER SECTION ==========
    // Title
    const titleRow = worksheet.addRow(["MANUFACTURING RECIPE PROCESS"]);
    worksheet.mergeCells("A1:G1");
    titleRow.font = {
      name: "Arial",
      size: 18,
      bold: true,
      color: { argb: "FFFFFFFF" },
    };
    titleRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "2C3E50" },
    };
    titleRow.alignment = { horizontal: "center", vertical: "middle" };
    titleRow.height = 35;

    // Export date
    const dateRow = worksheet.addRow([
      `Export Generated: ${new Date().toLocaleString()}`,
    ]);
    worksheet.mergeCells("A2:G2");
    dateRow.font = {
      name: "Calibri",
      size: 10,
      italic: true,
      color: { argb: "666666" },
    };
    dateRow.alignment = { horizontal: "center" };
    dateRow.height = 20;

    worksheet.addRow([]); // Empty row

    // ========== 2. RECIPE INFORMATION ==========
    const infoTitleRow = worksheet.addRow(["RECIPE INFORMATION"]);
    worksheet.mergeCells("A4:G4");
    infoTitleRow.font = {
      name: "Arial",
      size: 14,
      bold: true,
      color: { argb: "2C3E50" },
    };
    infoTitleRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "E8F4FC" },
    };
    infoTitleRow.alignment = { horizontal: "center", vertical: "middle" };
    infoTitleRow.height = 25;

    // Recipe details table
    const infoData = [
      ["Product ID:", recipe.finished_id || "N/A", "", "", "", "", ""],
      ["Recipe ID:", recipe.receipe_id || "N/A", "", "", "", "", ""],
      ["Product Name:", recipe.item?.item || "N/A", "", "", "", "", ""],
      ["Status:", recipe.status || "N/A", "", "", "", "", ""],
      ["Total Time:", `${recipe.time_min || 0} minutes`, "", "", "", "", ""],
      [
        "Created Date:",
        new Date(recipe.dated).toLocaleDateString(),
        "",
        "",
        "",
        "",
        "",
      ],
      ["BOM ID:", recipe.bom_id || "N/A", "", "", "", "", ""],
      ["Machine ID:", recipe.machine_id || "N/A", "", "", "", "", ""],
    ];

    infoData.forEach((rowData, index) => {
      const row = worksheet.addRow(rowData);
      row.getCell(1).font = {
        name: "Calibri",
        size: 11,
        bold: true,
        color: { argb: "2C3E50" },
      };
      row.getCell(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "F8F9FA" },
      };
      row.getCell(2).font = { name: "Calibri", size: 11 };

      if (index === 0) row.height = 22;
    });

    worksheet.addRow([]); // Empty row

    // ========== 3. PROCESS OVERVIEW ==========
    const totalSteps = recipe.receipeDetails?.length || 0;
    const materialSteps =
      recipe.receipeDetails?.filter((d) => d.type === "product" || d.qty > 0)
        .length || 0;
    const instructionSteps =
      recipe.receipeDetails?.filter(
        (d) => d.type === "instruction" || d.qty === null || d.qty === 0,
      ).length || 0;

    const overviewTitleRow = worksheet.addRow(["PROCESS OVERVIEW"]);
    worksheet.mergeCells("A13:G13");
    overviewTitleRow.font = {
      name: "Arial",
      size: 14,
      bold: true,
      color: { argb: "2C3E50" },
    };
    overviewTitleRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "E8F4FC" },
    };
    overviewTitleRow.alignment = { horizontal: "center", vertical: "middle" };
    overviewTitleRow.height = 25;

    const overviewData = [
      ["Total Steps:", totalSteps, "", "", "", "", ""],
      ["Material Steps:", materialSteps, "", "", "", "", ""],
      ["Instruction Steps:", instructionSteps, "", "", "", "", ""],
    ];

    overviewData.forEach((rowData, index) => {
      const row = worksheet.addRow(rowData);
      row.getCell(1).font = {
        name: "Calibri",
        size: 11,
        bold: true,
        color: { argb: "2C3E50" },
      };
      row.getCell(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "F8F9FA" },
      };
      row.getCell(2).font = {
        name: "Calibri",
        size: 11,
        bold: true,
        color: { argb: "27AE60" },
      };
      row.height = 22;
    });

    worksheet.addRows([[], []]); // Two empty rows

    // ========== 4. PROCESS SEQUENCE TABLE ==========
    const sequenceTitleRow = worksheet.addRow([
      "PROCESS SEQUENCE - MANUFACTURING STEPS",
    ]);
    worksheet.mergeCells("A18:G18");
    sequenceTitleRow.font = {
      name: "Arial",
      size: 14,
      bold: true,
      color: { argb: "2C3E50" },
    };
    sequenceTitleRow.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "E8F4FC" },
    };
    sequenceTitleRow.alignment = { horizontal: "center", vertical: "middle" };
    sequenceTitleRow.height = 25;

    worksheet.addRow([]); // Spacer

    // Column headers
    const headers = [
      "STEP",
      "TYPE",
      "ITEM ID",
      "DESCRIPTION",
      "QUANTITY",
      "PERCENTAGE (%)",
      "INSTRUCTIONS / DETAILS",
    ];
    const headerRow = worksheet.addRow(headers);

    // Style header row
    headerRow.eachCell((cell, colNumber) => {
      cell.font = {
        name: "Calibri",
        size: 12,
        bold: true,
        color: { argb: "FFFFFF" },
      };
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "3498DB" },
      };
      cell.alignment = {
        horizontal: "center",
        vertical: "middle",
        wrapText: true,
      };
      cell.border = {
        top: { style: "thin", color: { argb: "1A5276" } },
        bottom: { style: "thin", color: { argb: "1A5276" } },
        left: { style: "thin", color: { argb: "1A5276" } },
        right: { style: "thin", color: { argb: "1A5276" } },
      };
    });
    headerRow.height = 28;

    // ========== 5. PROCESS STEPS DATA ==========
    if (recipe.receipeDetails && recipe.receipeDetails.length > 0) {
      recipe.receipeDetails.forEach((step, index) => {
        const isMaterial =
          step.type === "product" || (step.qty > 0 && step.qty !== null);
        const stepType = isMaterial ? "MATERIAL" : "INSTRUCTION";
        const quantity = isMaterial ? step.qty || 0 : "";
        const percentage = isMaterial
          ? step.product_percentage || step.percentage || 0
          : "";
        const instructions = !isMaterial
          ? step.instructions || step.product_desc || "Machine operation"
          : step.instructions || "Material consumption";

        const rowData = [
          index + 1,
          stepType,
          step.product_id || step.id || step.material_id || `STEP_${index + 1}`,
          step.product_desc ||
            step.description ||
            step.name ||
            "No description",
          quantity,
          percentage,
          instructions,
        ];

        const row = worksheet.addRow(rowData);
        const isEven = index % 2 === 0;

        // Style each cell in the row
        row.eachCell((cell, colNumber) => {
          cell.font = { name: "Calibri", size: 10 };
          cell.fill = {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: isEven ? "FFFFFF" : "F8F9FA" },
          };
          cell.border = {
            bottom: { style: "thin", color: { argb: "E0E0E0" } },
            right: { style: "thin", color: { argb: "E0E0E0" } },
          };
          cell.alignment = { vertical: "middle", wrapText: true };
        });

        // Special styling for Step number (col 1)
        row.getCell(1).font = {
          name: "Calibri",
          size: 11,
          bold: true,
          color: { argb: "FFFFFF" },
        };
        row.getCell(1).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "9B59B6" },
        }; // Purple
        row.getCell(1).alignment = { horizontal: "center", vertical: "middle" };

        // Special styling for Type (col 2)
        row.getCell(2).font = {
          name: "Calibri",
          size: 10,
          bold: true,
          color: { argb: "FFFFFF" },
        };
        row.getCell(2).fill = {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: isMaterial ? "3498DB" : "27AE60" }, // Blue for material, Green for instruction
        };
        row.getCell(2).alignment = { horizontal: "center", vertical: "middle" };

        row.height = 24;
      });
    } else {
      const noDataRow = worksheet.addRow(["No process steps configured"]);
      worksheet.mergeCells("A21:G21");
      noDataRow.getCell(1).font = {
        name: "Calibri",
        size: 12,
        italic: true,
        color: { argb: "95A5A6" },
      };
      noDataRow.getCell(1).alignment = { horizontal: "center" };
      noDataRow.height = 25;
    }

    // ========== 6. SUMMARY SECTION ==========
    const lastDataRow = worksheet.lastRow.number;
    const summaryStartRow = lastDataRow + 2;

    const summaryTitleRow = worksheet.getRow(summaryStartRow);
    summaryTitleRow.getCell(1).value = "PROCESS SUMMARY";
    worksheet.mergeCells(`A${summaryStartRow}:G${summaryStartRow}`);
    summaryTitleRow.getCell(1).font = {
      name: "Arial",
      size: 14,
      bold: true,
      color: { argb: "2C3E50" },
    };
    summaryTitleRow.getCell(1).fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "E8F4FC" },
    };
    summaryTitleRow.getCell(1).alignment = {
      horizontal: "center",
      vertical: "middle",
    };
    summaryTitleRow.height = 25;

    // Summary data
    const summaryData = [
      ["Total Steps:", totalSteps],
      ["Materials:", materialSteps],
      ["Instructions:", instructionSteps],
      ["Total Time:", `${recipe.time_min || 0} minutes`],
    ];

    summaryData.forEach(([label, value], index) => {
      const rowNum = summaryStartRow + 1 + index;
      const row = worksheet.getRow(rowNum);
      row.getCell(1).value = label;
      row.getCell(2).value = value;

      row.getCell(1).font = {
        name: "Calibri",
        size: 11,
        bold: true,
        color: { argb: "2C3E50" },
      };
      row.getCell(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "F8F9FA" },
      };
      row.getCell(2).font = {
        name: "Calibri",
        size: 11,
        bold: true,
        color: { argb: "27AE60" },
      };
      row.height = 22;
    });

    // ========== 7. FOOTER ==========
    const footerStartRow = summaryStartRow + summaryData.length + 2;

    const endRow = worksheet.getRow(footerStartRow);
    endRow.getCell(1).value = "END OF PROCESS";
    worksheet.mergeCells(`A${footerStartRow}:G${footerStartRow}`);
    endRow.getCell(1).font = {
      name: "Calibri",
      size: 12,
      bold: true,
      color: { argb: "7F8C8D" },
    };
    endRow.getCell(1).alignment = { horizontal: "center" };
    endRow.height = 22;

    const generatedRow = worksheet.getRow(footerStartRow + 1);
    generatedRow.getCell(1).value = "Generated by Manufacturing System";
    worksheet.mergeCells(`A${footerStartRow + 1}:G${footerStartRow + 1}`);
    generatedRow.getCell(1).font = {
      name: "Calibri",
      size: 10,
      italic: true,
      color: { argb: "95A5A6" },
    };
    generatedRow.getCell(1).alignment = { horizontal: "center" };
    generatedRow.height = 20;

    // ========== 8. SET COLUMN WIDTHS ==========
    worksheet.columns = [
      { width: 10 }, // STEP
      { width: 12 }, // TYPE
      { width: 18 }, // ITEM ID
      { width: 35 }, // DESCRIPTION
      { width: 12 }, // QUANTITY
      { width: 15 }, // PERCENTAGE
      { width: 45 }, // INSTRUCTIONS
    ];

    // ========== 9. SAVE THE FILE ==========
    const buffer = await workbook.xlsx.writeBuffer();
    const blob = new Blob([buffer], {
      type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    });
    const url = window.URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Recipe_${recipe.finished_id || recipe.receipe_id}_Process_${new Date().toISOString().split("T")[0]}.xlsx`;
    document.body.appendChild(a);
    a.click();
    window.URL.revokeObjectURL(url);
    document.body.removeChild(a);

    return true;
  } catch (error) {
    console.error("Recipe export error:", error);
    return false;
  }
};
// SortableRecipeDetail Component — one step row of the recipe sequence.
// Phones: a wrapped row (handle · # · item · % on top, description below);
// md and up: a grid aligned with the maroon header.
const SortableRecipeDetail = ({
  detail,
  index,
  onRemove,
  isViewMode = false,
}) => {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id: detail.sno });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.5 : 1,
  };

  // Normalize data for display
  const normalizedDetail = {
    type: detail.type || (detail.instructions ? "instruction" : "product"),
    product_id: detail.product_id || detail.material_id || detail.id || "",
    product_desc:
      detail.product_desc || detail.description || detail.name || "",
    qty: detail.qty || detail.quantity || 0,
    product_percentage: detail.product_percentage || detail.percentage || 0,
    instructions: detail.instructions || "",
    sno: detail.sno,
  };

  const isProduct = normalizedDetail.type === "product";

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={cn(
        "flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border bg-background px-3 py-2.5 text-sm last:border-b-0 md:grid md:gap-3",
        isViewMode ? STEP_COLS_VIEW : STEP_COLS_EDIT,
        isDragging && "relative z-10 shadow-lg ring-2 ring-primary/40",
      )}
    >
      {/* Drag Handle - Hidden in view mode */}
      {!isViewMode && (
        <button
          type="button"
          {...attributes}
          {...listeners}
          className="flex-shrink-0 cursor-grab touch-none text-muted-foreground transition-colors hover:text-foreground active:cursor-grabbing"
          title="Drag to reorder"
          aria-label={`Reorder step ${normalizedDetail.sno}`}
        >
          <GripVertical size={16} />
        </button>
      )}

      {/* Step Number */}
      <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full bg-primary text-[11px] font-bold text-primary-foreground">
        {normalizedDetail.sno}
      </span>

      {/* Item */}
      <div className="min-w-0">
        {normalizedDetail.product_id ? (
          <span className={cn(CODE_CHIP, "inline-block max-w-full truncate align-middle")}>
            {normalizedDetail.product_id}
          </span>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </div>

      {/* Description — own line on phones */}
      <div className="order-last min-w-0 basis-full md:order-none md:basis-auto">
        <p className="truncate font-medium text-foreground" title={normalizedDetail.product_desc}>
          {normalizedDetail.product_desc || <span className="text-muted-foreground">No description</span>}
        </p>
      </div>

      {/* % for materials, instruction text for steps */}
      <div className="ml-auto min-w-0 text-right md:ml-0">
        {isProduct ? (
          <span className="font-semibold tabular-nums text-foreground">
            {normalizedDetail.product_percentage}%
          </span>
        ) : normalizedDetail.instructions ? (
          <span className="block truncate text-[12.5px] text-muted-foreground" title={normalizedDetail.instructions}>
            {normalizedDetail.instructions}
          </span>
        ) : (
          <Chip tone="muted">Instruction</Chip>
        )}
      </div>

      {/* Remove Button - Hidden in view mode */}
      {/* {!isViewMode && (
        <button
          onClick={() => onRemove(index)}
          className="flex-shrink-0 p-1 text-red-500 rounded transition-all duration-200"
          title="Remove step"
        >
          <Trash2 size={14} />
        </button>
      )} */}
    </div>
  );
};

// Recipe Form Component with Loading State
const RecipeForm = ({
  formData,
  setFormData,
  activeBomOptions,
  machineOptions,
  validationErrors,
  setValidationErrors = () => {},
  bomError = null,
  isEditing = false,
  loading = false,
  isViewMode = false, // ADD VIEW MODE PROP
}) => {
  const [confirm, confirmDialog] = useConfirmDialog();
  const [addMode, setAddMode] = useState("material"); // "material" or "instruction"
  const [manualInput, setManualInput] = useState({
    description: "",
    type: "material", // "material" or "instruction"
    qty: 0,
    percentage: 0,
    instructions: "",
  });

  const [showManualAdd, setShowManualAdd] = useState(false);
  const [apiChecks, setApiChecks] = useState({});
  const [lastBomId, setLastBomId] = useState("");
  const [lastMachineId, setLastMachineId] = useState("");

  // DndKit sensors
  const sensors = useSensors(
    useSensor(PointerSensor),
    useSensor(KeyboardSensor, {
      coordinateGetter: sortableKeyboardCoordinates,
    }),
  );
  // Separate functions for BOM and Machine population
  const populateBOMDetails = useCallback(
    async (bomId) => {
      if (!isViewMode && bomId && bomId !== lastBomId) {
        try {
          

          // Check if user has any manual entries - if yes, ask for confirmation
          const hasBOMEntries = formData.receipeDetails.some(
            (detail) =>
              detail.type === "product" &&
              !detail.product_id.startsWith("MANUAL_"),
          );

          if (
            hasBOMEntries &&
            !(await confirm({
              title: "Add materials from this BOM?",
              message: "Auto-populating BOM will add materials. Continue?",
            }))
          ) {
            return;
          }

          // Get BOM details
          const bomResponse = await axios.get(
            `/api/manufacturing/bom/${bomId}`,
          );
          const bomData = bomResponse.data;

          

          let stepNumber = formData.receipeDetails.length + 1;

          // Add BOM materials as product steps
          if (bomData.materials && bomData.materials.length > 0) {
            const bomDetails = bomData.materials.map((mat) => ({
              product_id: mat.id,
              product_desc: mat.name || `Material ${mat.id}`,
              type: "product",
              qty: 1,
              product_percentage: mat.percentage || 0,
              instructions: "",
              sno: stepNumber++,
            }));

            setFormData((prev) => ({
              ...prev,
              finished_id: bomData.finishedId,
              alternate_id: bomData.alternate_id,
              code: bomData.code,
              receipeDetails: [...prev.receipeDetails, ...bomDetails],
            }));
          }

          // Update last used ID to prevent duplicate fetching
          setLastBomId(bomId);

          
        } catch (error) {
          console.error("❌ Error populating BOM details:", error);
        }
      }
    },
    [lastBomId, setFormData, isViewMode, formData.receipeDetails],
  );

  const populateMachineDetails = useCallback(
    async (machineId) => {
      if (!isViewMode && machineId && machineId !== lastMachineId) {
        try {
          

          // Check if user has any manual entries - if yes, ask for confirmation
          const hasMachineEntries = formData.receipeDetails.some(
            (detail) =>
              detail.type === "instruction" &&
              !detail.product_id.startsWith("INST_"),
          );

          if (
            hasMachineEntries &&
            !(await confirm({
              title: "Add instructions from this machine?",
              message: "Auto-populating machine will add instructions. Continue?",
            }))
          ) {
            return;
          }

          // Get machine details
          const machineResponse = await axios.get(
            `/api/manufacturing/machine-instruction/${machineId}`,
          );
          const machineData = machineResponse.data;

          

          let stepNumber = formData.receipeDetails.length + 1;

          // Add machine instructions
          if (machineData.details && machineData.details.length > 0) {
            const machineDetails = machineData.details.map((det) => ({
              product_id: det.machineId || det.id,
              product_desc: det.name || det.part || `Instruction ${det.id}`,
              type: "instruction",
              qty: 0,
              product_percentage: 0,
              instructions: det.instructions || "",
              sno: stepNumber++,
            }));

            setFormData((prev) => ({
              ...prev,
              time_min: machineData.timeMin || prev.time_min || 0,
              receipeDetails: [...prev.receipeDetails, ...machineDetails],
            }));
          }

          // Update last used ID to prevent duplicate fetching
          setLastMachineId(machineId);

          
        } catch (error) {
          console.error("❌ Error populating machine details:", error);
        }
      }
    },
    [lastMachineId, setFormData, isViewMode, formData.receipeDetails],
  );
  // Add manual material/instruction
  const addManualItem = () => {
    if (!manualInput.description.trim()) {
      setValidationErrors([...validationErrors, "Description is required"]);
      return;
    }

    const newStep = {
      sno: formData.receipeDetails.length + 1,
      type: manualInput.type,
      product_id:
        manualInput.type === "material"
          ? `MANUAL_${Date.now()}`
          : `INST_${Date.now()}`,
      product_desc: manualInput.description,
      qty: manualInput.type === "material" ? manualInput.qty : 0,
      product_percentage:
        manualInput.type === "material" ? manualInput.percentage : 0,
      instructions:
        manualInput.type === "instruction" ? manualInput.instructions : "",
    };

    setFormData((prev) => ({
      ...prev,
      receipeDetails: [...prev.receipeDetails, newStep],
    }));

    // Reset form
    setManualInput({
      description: "",
      type: "material",
      qty: 0,
      percentage: 0,
      instructions: "",
    });
    setShowManualAdd(false);
  };

  // Fetch instructions from selected machine
  const fetchInstructions = async () => {
    if (!formData.machine_id) {
      setValidationErrors([
        ...validationErrors,
        "Please select a machine first",
      ]);
      return;
    }

    // Check if already fetched
    if (formData.machine_id === lastMachineId) {
      if (
        !(await confirm({
          title: "Fetch instructions again?",
          message: "Instructions already fetched. Fetch again?",
        }))
      ) {
        return;
      }
    }

    try {
      // Clear previous machine instructions (if any)
      const filteredDetails = formData.receipeDetails.filter(
        (detail) =>
          !(
            detail.type === "instruction" &&
            !detail.product_id.startsWith("INST_")
          ),
      );

      const response = await axios.get(
        `/api/manufacturing/machine-instruction/${formData.machine_id}`,
      );
      const machineData = response.data;

      if (machineData.details && machineData.details.length > 0) {
        const instructionSteps = machineData.details.map((inst, index) => ({
          sno: filteredDetails.length + index + 1,
          type: "instruction",
          product_id: inst.machineId || inst.id || `MACH_${index}`,
          product_desc:
            inst.instructions ||
            inst.description ||
            `Machine Instruction ${index + 1}`,
          instructions: inst.instructions || "",
          qty: 0,
          product_percentage: 0,
        }));

        setFormData((prev) => ({
          ...prev,
          receipeDetails: [...filteredDetails, ...instructionSteps],
          time_min: machineData.timeMin || prev.time_min || 0,
        }));

        // Update last used ID
        setLastMachineId(formData.machine_id);
      }
    } catch (error) {
      console.error("Error fetching instructions:", error);
      setValidationErrors([
        ...validationErrors,
        "Failed to fetch machine instructions",
      ]);
    }
  };

  // Use useEffect with proper dependencies for BOM
  useEffect(() => {
    if (!isEditing && !isViewMode && formData.bom_id) {
      populateBOMDetails(formData.bom_id);
    }
  }, [formData.bom_id, populateBOMDetails, isEditing, isViewMode]);

  // Use useEffect with proper dependencies for Machine
  useEffect(() => {
    if (!isEditing && !isViewMode && formData.machine_id) {
      populateMachineDetails(formData.machine_id);
    }
  }, [formData.machine_id, populateMachineDetails, isEditing, isViewMode]);
  // Handle BOM change
  // Handle BOM change
  const handleBomChange = (selected) => {
    if (isViewMode) return;

    const bomId = selected ? selected.value : "";
    setFormData((prev) => ({
      ...prev,
      bom_id: bomId,
      finished_id: "", // Reset finished_id when BOM changes
    }));

    // Reset last BOM ID to allow new BOM to populate
    setLastBomId("");
  };

  // Handle Machine change
  // Handle Machine change
  const handleMachineChange = (selected) => {
    if (isViewMode) return;

    const machineId = selected ? selected.value : "";
    setFormData((prev) => ({
      ...prev,
      machine_id: machineId,
    }));

    // Reset last Machine ID to allow new machine to populate
    setLastMachineId("");
  };

  // Handle drag end for reordering
  const handleDragEnd = (event) => {
    if (isViewMode) return; // Prevent drag in view mode

    const { active, over } = event;

    if (active.id !== over?.id) {
      setFormData((prev) => {
        const oldIndex = prev.receipeDetails.findIndex(
          (detail) => detail.sno === active.id,
        );
        const newIndex = prev.receipeDetails.findIndex(
          (detail) => detail.sno === over.id,
        );

        const reorderedDetails = arrayMove(
          prev.receipeDetails,
          oldIndex,
          newIndex,
        );

        // Update step numbers after reordering
        const updatedDetails = reorderedDetails.map((detail, index) => ({
          ...detail,
          sno: index + 1,
        }));

        return {
          ...prev,
          receipeDetails: updatedDetails,
        };
      });
    }
  };

  const totalSteps = formData.receipeDetails.length;
  const productSteps = formData.receipeDetails.filter(
    (det) => det.type === "product",
  ).length;
  const instructionSteps = formData.receipeDetails.filter(
    (det) => det.type === "instruction",
  ).length;

  // Total % of the material steps (display only).
  const totalPercentage = formData.receipeDetails
    .filter((det) => det.type === "product")
    .reduce(
      (sum, det) =>
        sum + (parseFloat(det.product_percentage || det.percentage) || 0),
      0,
    );

  // Put each validation message next to the field it is about.
  const errorsMatching = (re) => validationErrors.filter((e) => re.test(e));
  const bomErrors = errorsMatching(/BOM|Product ID/i);
  const machineErrors = errorsMatching(/machine/i);
  const dateErrors = errorsMatching(/Date is required/i);
  const statusErrors = errorsMatching(/active recipe/i);
  const stepErrors = errorsMatching(/at least one step/i);
  const manualErrors = errorsMatching(/Description is required/i);

  const FieldErrors = ({ errors }) =>
    errors.length > 0 ? (
      <>
        {errors.map((e) => (
          <p key={e} className={FIELD_ERROR}>
            <AlertCircle size={12} className="flex-shrink-0" />
            {e}
          </p>
        ))}
      </>
    ) : null;

  const removeStep = (index) => {
    if (loading) return;
    const newDetails = formData.receipeDetails.filter((_, i) => i !== index);
    const renumberedDetails = newDetails.map((detail, idx) => ({
      ...detail,
      sno: idx + 1,
    }));
    setFormData((prev) => ({
      ...prev,
      receipeDetails: renumberedDetails,
    }));
  };

  const stepCols = isViewMode ? STEP_COLS_VIEW : STEP_COLS_EDIT;

  return (
    <div className="space-y-4">
      {confirmDialog}

      {/* Validation Errors — summary; each one is also shown at its field */}
      {validationErrors.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3"
        >
          <div className="flex items-center gap-2 text-destructive">
            <AlertCircle size={16} />
            <span className="text-sm font-semibold">
              Please fix {validationErrors.length === 1 ? "this" : `these ${validationErrors.length}`} before saving
            </span>
          </div>
          <ul className="mt-1.5 list-inside list-disc space-y-0.5 text-[13px] text-destructive/90">
            {validationErrors.map((error, index) => (
              <li key={index}>{error}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Recipe Configuration Section */}
      <LabCard
        title="Recipe details"
        subtitle={
          isViewMode
            ? "Product, linked BOM and machine"
            : "BOM and Machine selection are optional — you can add steps manually."
        }
        icon={Settings}
        bodyClassName="p-4"
      >
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {/* Product ID */}
          <div className="min-w-0">
            <label className={FIELD_LABEL}>Product ID (from BOM)</label>
            <input
              type="text"
              value={formData.finished_id || ""}
              readOnly
              placeholder="Auto-filled from BOM"
              className={FIELD_READONLY}
            />
          </div>

          {/* Master Sample + Ink Code in one line */}
          <div className="min-w-0">
            <label className={FIELD_LABEL}>Master Sample / Ink Code</label>
            <div className="grid grid-cols-2 gap-2">
              <input
                type="text"
                value={formData.alternate_id || ""}
                readOnly
                placeholder="Master Sample"
                aria-label="Master Sample"
                className={FIELD_READONLY}
              />
              <input
                type="text"
                value={formData.code || ""}
                readOnly
                placeholder="Ink Code"
                aria-label="Ink Code"
                className={FIELD_READONLY}
              />
            </div>
          </div>

          {/* Date */}
          <div className="min-w-0">
            <label htmlFor="recipe-dated" className={FIELD_LABEL}>
              Date <span className="text-destructive">*</span>
            </label>
            <input
              id="recipe-dated"
              type="date"
              value={formData.dated}
              onChange={(e) =>
                !isViewMode &&
                setFormData({ ...formData, dated: e.target.value })
              }
              disabled={loading || isViewMode}
              className={cn(FIELD_INPUT, dateErrors.length && "border-destructive")}
            />
            <FieldErrors errors={dateErrors} />
          </div>

          {/* BOM */}
          <div className="min-w-0">
            <label className={FIELD_LABEL}>
              Linked BOM ID <span className="text-destructive">*</span>
            </label>
            <Select
              value={
                activeBomOptions.find((opt) => opt.value === formData.bom_id) ||
                null
              }
              onChange={handleBomChange}
              options={activeBomOptions}
              isSearchable
              isClearable
              placeholder="Select BOM"
              classNamePrefix="react-select"
              isDisabled={loading || isViewMode}
              styles={selectStyles(bomErrors.length > 0)}
              menuPosition="fixed"
            />
            {bomError && !isViewMode && (
              <p className={FIELD_ERROR}>
                <AlertCircle size={12} className="flex-shrink-0" />
                Could not load BOMs: {bomError}
              </p>
            )}
            <FieldErrors errors={bomErrors} />
          </div>

          {/* Machine */}
          <div className="min-w-0">
            <label className={FIELD_LABEL}>Machine ID</label>
            <Select
              value={
                machineOptions.find((opt) => opt.value === formData.machine_id) ||
                null
              }
              onChange={handleMachineChange}
              options={machineOptions}
              isSearchable
              isClearable
              placeholder="Select Machine"
              classNamePrefix="react-select"
              isDisabled={loading || isViewMode}
              styles={selectStyles(machineErrors.length > 0)}
              menuPosition="fixed"
            />
            <FieldErrors errors={machineErrors} />
          </div>

          {/* Status */}
          <div className="min-w-0">
            <label className={FIELD_LABEL}>Status</label>
            <div
              role="radiogroup"
              aria-label="Status"
              className="grid h-10 grid-cols-2 gap-1 rounded-lg border border-input bg-muted/40 p-1"
            >
              {["Active", "Inactive"].map((s) => {
                const on = formData.status === s;
                return (
                  <button
                    key={s}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    disabled={isViewMode}
                    onClick={() =>
                      !isViewMode && setFormData({ ...formData, status: s })
                    }
                    className={cn(
                      "rounded-md text-[13px] font-medium transition-colors disabled:cursor-default",
                      on
                        ? s === "Active"
                          ? "bg-background text-[#2f5139] shadow-sm dark:text-emerald-300"
                          : "bg-background text-destructive shadow-sm"
                        : "text-muted-foreground hover:text-foreground",
                    )}
                  >
                    {s}
                  </button>
                );
              })}
            </div>
            <FieldErrors errors={statusErrors} />
          </div>
        </div>
      </LabCard>

      {/* Recipe Steps */}
      <LabCard
        title="Recipe sequence"
        subtitle={
          isViewMode
            ? `${productSteps} materials · ${instructionSteps} instructions`
            : `${productSteps} materials · ${instructionSteps} instructions${
                totalSteps > 0 ? " · drag the handle to reorder" : ""
              }`
        }
        icon={Package}
        actions={
          !isViewMode && (
            <>
              {formData.bom_id && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => populateBOMDetails(formData.bom_id)}
                  disabled={loading || formData.bom_id === lastBomId}
                >
                  <Package />
                  {formData.bom_id === lastBomId ? "BOM fetched" : "Fetch BOM"}
                </Button>
              )}
              {formData.machine_id && (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={fetchInstructions}
                  disabled={loading || formData.machine_id === lastMachineId}
                >
                  <Settings />
                  {formData.machine_id === lastMachineId
                    ? "Machine fetched"
                    : "Fetch machine"}
                </Button>
              )}
            </>
          )
        }
      >
        {stepErrors.length > 0 && (
          <div className="px-4 pt-3">
            <FieldErrors errors={stepErrors} />
          </div>
        )}

        {loading ? (
          <div className="space-y-2 p-4">
            {[0, 1, 2, 3].map((i) => (
              <Skeleton key={i} className="h-9 w-full" />
            ))}
          </div>
        ) : formData.receipeDetails.length > 0 ? (
          <>
            {/* Maroon header (md and up) */}
            <div
              className={cn(
                "hidden gap-3 px-3 py-2.5 text-[12px] font-semibold uppercase tracking-wide md:grid",
                TH_ROW,
                stepCols,
              )}
            >
              {!isViewMode && <span aria-hidden />}
              <span>#</span>
              <span>Item</span>
              <span>Description</span>
              <span className="text-right">% / Instruction</span>
            </div>

            {isViewMode ? (
              <div>
                {formData.receipeDetails.map((detail, index) => (
                  <SortableRecipeDetail
                    key={detail.sno}
                    detail={detail}
                    index={index}
                    onRemove={() => {}}
                    isViewMode={true}
                  />
                ))}
              </div>
            ) : (
              <DndContext
                sensors={sensors}
                collisionDetection={closestCenter}
                onDragEnd={handleDragEnd}
              >
                <SortableContext
                  items={formData.receipeDetails.map((detail) => detail.sno)}
                  strategy={verticalListSortingStrategy}
                >
                  <div>
                    {formData.receipeDetails.map((detail, index) => (
                      <SortableRecipeDetail
                        key={detail.sno}
                        detail={detail}
                        index={index}
                        onRemove={removeStep}
                      />
                    ))}
                  </div>
                </SortableContext>
              </DndContext>
            )}

            {/* Totals */}
            <div
              className={cn(
                "flex flex-wrap items-center gap-x-4 gap-y-1 px-3 py-2.5 text-sm md:grid md:gap-3",
                TOTAL_ROW,
                stepCols,
              )}
            >
              {!isViewMode && <span aria-hidden className="hidden md:block" />}
              <span className="tabular-nums md:text-center">{totalSteps}</span>
              <span>Total</span>
              <span className="flex items-center gap-1.5 font-medium text-muted-foreground">
                <Clock size={14} className="text-primary" />
                <span className="tabular-nums text-foreground">{formData.time_min}m</span>
                estimated time
              </span>
              <span className={cn(NUM, "ml-auto md:ml-0")}>
                {fmtPct(totalPercentage)}%
              </span>
            </div>
          </>
        ) : (
          <LabEmpty
            icon={Package}
            title={`No recipe steps ${isViewMode ? "found" : "yet"}`}
            hint={
              isViewMode
                ? "No recipe steps available for viewing."
                : "Add a step below, or fetch them from the selected BOM / machine."
            }
          />
        )}

        {/* Add line */}
        {!isViewMode && (
          <div className="border-t border-border bg-muted/30 px-3 py-3">
            {!showManualAdd ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setShowManualAdd(true)}
                disabled={loading}
                className="text-primary hover:bg-primary/10 hover:text-primary"
              >
                <Plus />
                Add step
              </Button>
            ) : (
              <div className="space-y-3">
                <div className="flex flex-wrap items-center gap-2">
                  <div
                    role="radiogroup"
                    aria-label="Step type"
                    className="inline-flex rounded-lg border border-input bg-background p-0.5"
                  >
                    {[
                      ["material", "Material"],
                      ["instruction", "Instruction"],
                    ].map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        role="radio"
                        aria-checked={manualInput.type === value}
                        onClick={() =>
                          setManualInput({ ...manualInput, type: value })
                        }
                        className={cn(
                          "rounded-md px-3 py-1 text-[13px] font-medium transition-colors",
                          manualInput.type === value
                            ? "bg-primary text-primary-foreground"
                            : "text-muted-foreground hover:text-foreground",
                        )}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    className="ml-auto"
                    onClick={() => setShowManualAdd(false)}
                  >
                    <X />
                    Cancel
                  </Button>
                </div>

                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
                  <div className="min-w-0 sm:col-span-2">
                    <label htmlFor="recipe-manual-desc" className={FIELD_LABEL}>
                      {manualInput.type === "material"
                        ? "Material description"
                        : "Instruction"}
                    </label>
                    <input
                      id="recipe-manual-desc"
                      type="text"
                      value={manualInput.description}
                      onChange={(e) =>
                        setManualInput({
                          ...manualInput,
                          description: e.target.value,
                        })
                      }
                      placeholder={
                        manualInput.type === "material"
                          ? "Enter material name..."
                          : "Enter instruction text..."
                      }
                      className={cn(FIELD_INPUT, manualErrors.length && "border-destructive")}
                    />
                    <FieldErrors errors={manualErrors} />
                  </div>

                  {manualInput.type === "material" ? (
                    <>
                      <div className="min-w-0">
                        <label htmlFor="recipe-manual-qty" className={FIELD_LABEL}>
                          Quantity
                        </label>
                        <input
                          id="recipe-manual-qty"
                          type="number"
                          value={manualInput.qty}
                          onChange={(e) =>
                            setManualInput({
                              ...manualInput,
                              qty: parseFloat(e.target.value) || 0,
                            })
                          }
                          min="0"
                          step="0.01"
                          className={cn(FIELD_INPUT, "text-right tabular-nums")}
                        />
                      </div>
                      <div className="min-w-0">
                        <label htmlFor="recipe-manual-pct" className={FIELD_LABEL}>
                          Percentage (%)
                        </label>
                        <input
                          id="recipe-manual-pct"
                          type="number"
                          value={manualInput.percentage}
                          onChange={(e) =>
                            setManualInput({
                              ...manualInput,
                              percentage: parseFloat(e.target.value) || 0,
                            })
                          }
                          min="0"
                          max="100"
                          step="0.1"
                          className={cn(FIELD_INPUT, "text-right tabular-nums")}
                        />
                      </div>
                    </>
                  ) : (
                    <div className="min-w-0 sm:col-span-2">
                      <label htmlFor="recipe-manual-inst" className={FIELD_LABEL}>
                        Detailed instructions (optional)
                      </label>
                      <textarea
                        id="recipe-manual-inst"
                        value={manualInput.instructions}
                        onChange={(e) =>
                          setManualInput({
                            ...manualInput,
                            instructions: e.target.value,
                          })
                        }
                        placeholder="Add more details..."
                        rows="2"
                        className={cn(FIELD_INPUT, "h-auto py-2")}
                      />
                    </div>
                  )}
                </div>

                <div className="flex justify-end">
                  <Button
                    type="button"
                    size="sm"
                    onClick={addManualItem}
                    disabled={!manualInput.description.trim()}
                  >
                    <Plus />
                    Add{" "}
                    {manualInput.type === "material" ? "material" : "instruction"}
                  </Button>
                </div>
              </div>
            )}
          </div>
        )}
      </LabCard>
    </div>
  );
};

// Main RecipeTab Component with Active Recipe Validation
const RecipeTab = () => {
  const [showModal, setShowModal] = useState(false);
  const [modalMode, setModalMode] = useState("create"); // 'create', 'edit', 'view'
  const [editingItem, setEditingItem] = useState(null);
  const [validationErrors, setValidationErrors] = useState([]);
  const [isCreating, setIsCreating] = useState(false);
  const [isUpdating, setIsUpdating] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [isFetchingMachine, setIsFetchingMachine] = useState(false);
  const [hasActiveRecipeConflict, setHasActiveRecipeConflict] = useState(false);
  const [calcModal, setCalcModal] = useState({ show: false, item: null, qty: 1 });
  const { company } = useCompany();
  const [confirm, confirmDialog] = useConfirmDialog();

  // ── SEARCH-FIRST UI STATE ──────────────────────────────────────────────────
  const [hasSearched, setHasSearched] = useState(false);
  const [localSearch, setLocalSearch] = useState("");
  // ──────────────────────────────────────────────────────────────────────────

  //bom States
  const [bomOptions, setBomOptions] = useState([]);
  const [bomLoading, setBomLoading] = useState(false);
  const [bomError, setBomError] = useState(null);

  // Recipe state
  const [searchRecipe, setSearchRecipe] = useState("");
  const [filterRecipe, setFilterRecipe] = useState("");
  const [recipePage, setRecipePage] = useState(1);
  const [recipeLimit, setRecipeLimit] = useState(10);
  const [recipeSortBy, setRecipeSortBy] = useState("receipe_id");
  const [recipeSortOrder, setRecipeSortOrder] = useState("desc");

  const {
    recipes = [],
    loading: recipeLoading = false,
    error: recipeError,
    createRecipe: createRecipeAPI,
    updateRecipe: updateRecipeAPI,
    deleteRecipe: deleteRecipeAPI,
    total: recipeTotal = 0,
    totalPages: recipeTotalPages = 1,
    fetchRecipes,
  } = useRecipes({
    searchTerm: searchRecipe,
    filterStatus: filterRecipe,
    page: recipePage,
    limit: recipeLimit,
    sortBy: recipeSortBy,
    sortOrder: "desc",
  });

  // ── DEBOUNCE: localSearch → searchRecipe + hasSearched ────────────────────
  useEffect(() => {
    const timer = setTimeout(() => {
      if (localSearch !== searchRecipe) {
        setSearchRecipe(localSearch);
        setRecipePage(1);
        setHasSearched(localSearch.trim() !== "");
      }
    }, 500);
    return () => clearTimeout(timer);
  }, [localSearch]);
  // ──────────────────────────────────────────────────────────────────────────

  const fetchBomOptions = async () => {
    setBomLoading(true);
    setBomError(null);
    try {
      const { data } = await axios.get("/api/manufacturing/bom/select", {
        params: {
          filterStatus: "Active", // Only active BOMs for recipes
        },
      });
      setBomOptions(data.data || []);
    } catch (error) {
      console.error("Error fetching BOM options:", error);
      setBomError(error.response?.data?.error || error.message);
      setBomOptions([]);
    } finally {
      setBomLoading(false);
    }
  };

  const { machineInstructions = [] } = useMachineInstructions({}) || {};

  const [recipeForm, setRecipeForm] = useState({
    receipe_id: 0,
    finished_id: "",
    machine_id: "",
    bom_id: "",
    time_min: 0,
    status: "Active",
    dated: new Date().toISOString().split("T")[0],
    receipeDetails: [],
  });

  useEffect(() => {
    fetchRecipes();
  }, [
    searchRecipe,
    filterRecipe,
    recipePage,
    recipeLimit,
    recipeSortBy,
    recipeSortOrder,
  ]);

  // CHECK FOR ACTIVE RECIPE CONFLICT
  const checkActiveRecipeConflict = useCallback(
    (finished_id, currentRecipeId = null) => {
      if (!finished_id) return false;

      const activeRecipes = recipes.filter(
        (recipe) =>
          recipe.finished_id === finished_id &&
          recipe.status === "Active" &&
          recipe.receipe_id !== currentRecipeId, // Exclude current recipe when editing
      );

      return activeRecipes.length > 0;
    },
    [recipes],
  );

  const showNotification = (message, type = "success") => {
    if (type === "error") toast.error(message);
    else toast.success(message);
  };

  // Recipe CRUD Operations with Active Recipe Validation
  const createRecipe = async () => {
    setValidationErrors([]);

    // Check for active recipe conflict
    if (
      recipeForm.status === "Active" &&
      checkActiveRecipeConflict(recipeForm.finished_id)
    ) {
      setValidationErrors([
        "An active recipe already exists for this product. Only one active recipe is allowed per product.",
      ]);
      setHasActiveRecipeConflict(true);
      return;
    }

    // Basic validation
    const errors = [];
    if (!recipeForm.finished_id)
      errors.push("Please select a BOM to auto-fill product ID");
    if (!recipeForm.bom_id) errors.push("BOM selection is required");
    // if (!recipeForm.machine_id) errors.push("Machine selection is required");
    if (recipeForm.receipeDetails.length === 0)
      errors.push("Recipe must have at least one step");
    if (!recipeForm.dated) errors.push("Date is required");

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setIsCreating(true);
    const result = await createRecipeAPI(recipeForm);
    setIsCreating(false);

    if (result.success) {
      closeModal();
      showNotification("Recipe created successfully!");
    } else {
      showNotification(result.error || "Failed to create recipe", "error");
    }
  };

  const updateRecipe = async () => {
    setValidationErrors([]);

    // Check for active recipe conflict
    if (
      recipeForm.status === "Active" &&
      checkActiveRecipeConflict(recipeForm.finished_id, editingItem.receipe_id)
    ) {
      setValidationErrors([
        "An active recipe already exists for this product. Only one active recipe is allowed per product.",
      ]);
      setHasActiveRecipeConflict(true);
      return;
    }

    // Basic validation
    const errors = [];
    if (!recipeForm.finished_id) errors.push("Product ID is required");
    if (!recipeForm.bom_id) errors.push("BOM selection is required");
    // if (!recipeForm.machine_id) errors.push("Machine selection is required");
    if (recipeForm.receipeDetails.length === 0)
      errors.push("Recipe must have at least one step");
    if (!recipeForm.dated) errors.push("Date is required");

    if (errors.length > 0) {
      setValidationErrors(errors);
      return;
    }

    setIsUpdating(true);
    const result = await updateRecipeAPI(editingItem.receipe_id, recipeForm);
    setIsUpdating(false);

    if (result.success) {
      closeModal();
      showNotification("Recipe updated successfully!");
    } else {
      showNotification(result.error || "Failed to update recipe", "error");
    }
  };

  const deleteRecipe = async (id) => {
    if (
      await confirm({
        title: "Delete this recipe?",
        message: "Are you sure you want to delete this recipe?",
        confirmLabel: "Delete",
        destructive: true,
      })
    ) {
      setIsDeleting(id);
      const result = await deleteRecipeAPI(id);
      setIsDeleting(false);

      if (result.success) {
        showNotification("Recipe deleted successfully!");
      } else {
        showNotification(result.error || "Failed to delete recipe", "error");
      }
    }
  };

  // MODIFIED: Open modal with different modes
  const openModal = (mode, item = null) => {
    setModalMode(mode);
    setEditingItem(item);
    setValidationErrors([]);
    setHasActiveRecipeConflict(false);

    if (mode !== "view") {
      fetchBomOptions();
    }

    if (item) {
      

      // First set the basic form data
      setRecipeForm({
        receipe_id: item.receipe_id || 0,
        code: item.item?.code,
        alternate_id: item.item?.alternate_id,
        finished_id: item.finished_id || "",
        machine_id: item.machine_id || "",
        bom_id: item.bom_id || "",
        time_min: item.time_min || 0,
        status: item.status || "Active",
        dated: item.dated
          ? new Date(item.dated).toISOString().split("T")[0]
          : new Date().toISOString().split("T")[0],
        receipeDetails: [],
      });

      // THEN fetch machine instructions to get the instruction text
      fetchMachineInstructionsForRecipe(item, mode);
    } else {
      setRecipeForm({
        receipe_id: 0,
        finished_id: "",
        machine_id: "",
        bom_id: "",
        time_min: 0,
        status: "Active",
        dated: new Date().toISOString().split("T")[0],
        receipeDetails: [],
      });
      setShowModal(true);
    }
  };

  // MODIFIED: Fetch machine instructions for recipe with mode
  const fetchMachineInstructionsForRecipe = async (recipe, mode) => {
    try {
      setIsFetchingMachine(true);
      
      

      if (!recipe.machine_id) {
        
        formatRecipeDetails(recipe, [], mode);
        return;
      }

      

      // Fetch machine instructions from API
      const response = await axios.get(
        `/api/manufacturing/machine-instruction/${recipe.machine_id}`,
      );
      const machineData = response.data;

      

      // Format recipe details with the fetched instruction text
      formatRecipeDetails(recipe, machineData.details || [], mode);
    } catch (error) {
      console.error("❌ Error fetching machine instructions:", error);
      // If API fails, still format without instruction text
      formatRecipeDetails(recipe, [], mode);
    } finally {
      setIsFetchingMachine(false);
    }
  };

  // MODIFIED: Helper function to format recipe details with instruction text and mode
  const formatRecipeDetails = (recipe, machineInstructions, mode) => {
    const formattedDetails = Array.isArray(recipe.receipeDetails)
      ? recipe.receipeDetails.map((detail, index) => {
          // Detect if this is an instruction (no quantity/percentage + machine-like ID)
          const hasNoQuantity = !detail.qty && detail.qty !== 0;
          const hasNoPercentage =
            !detail.product_percentage && detail.product_percentage !== 0;
          const isMachineLike =
          detail.product_id === null ||
            detail.product_id  &&
            (detail.product_id.toString().startsWith("50") ||
              detail.product_id.toString().startsWith("60") ||
              detail.product_desc?.includes("Machine") ||
              detail.product_desc?.includes("machine"))
              ;

          if ((hasNoQuantity && hasNoPercentage) || isMachineLike) {
            // THIS IS AN INSTRUCTION - Find matching instruction text
            let instructionText = "";

            if (machineInstructions.length > 0) {
              // Try to find matching instruction by product_id or index
              // const matchingInstruction = machineInstructions.find(
              //   (inst) =>
              //     inst.machineId === detail.product_id ||
              //     inst.id === detail.product_id,
              // );

              // if (matchingInstruction) {
              //   instructionText =
              //     matchingInstruction.instructions ||
              //     matchingInstruction.description ||
              //     `${detail.product_desc}`;
              // } else {
                // Fallback: use by index or generic text
                instructionText =
                  machineInstructions[index]?.instructions ||
                  `${detail.product_desc}`;
              // }
            } else {
              // No machine instructions found, use generic text
              instructionText = `${detail.product_desc}`;
            }

            return {
              sno: index + 1,
              type: "instruction",
              product_id: detail.product_id ,
              product_desc: instructionText || "Machine Instruction",
              instructions: "",
              qty: 0,
              product_percentage: 0,
            };
          } else {
            // THIS IS A MATERIAL
            return {
              sno: index + 1,
              type: "product",
              product_id: detail.product_id || "",
              product_desc: detail.product_desc || "",
              qty: detail.qty || detail.quantity || 0,
              product_percentage:
                detail.product_percentage || detail.percentage || 0,
              instructions: "",
            };
          }
        })
      : [];

    

    // Update the form with the complete data
    setRecipeForm((prev) => ({
      ...prev,
      receipeDetails: formattedDetails,
    }));

    // Now show the modal
    setShowModal(true);
  };

  const closeModal = () => {
    setShowModal(false);
    setModalMode("create");
    setEditingItem(null);
    setValidationErrors([]);
    setHasActiveRecipeConflict(false);
    setIsCreating(false);
    setIsUpdating(false);
  };

  const handleRecipeSort = (field) => {
    if (recipeSortBy === field) {
      setRecipeSortOrder(recipeSortOrder === "asc" ? "desc" : "asc");
    } else {
      setRecipeSortBy(field);
      setRecipeSortOrder("asc");
    }
  };


  // const activeBomOptions = bomItems
  //   .filter((b) => b.instructions === "A")
  //   .map((bom) => ({
  //     value: bom.id,
  //     label: `${bom.id} - ${bom.item?.item || bom.finished_id} (${bom.bomDetails?.length || 0} materials)`,
  //   }));

  const machineOptions = machineInstructions.map((machine) => ({
    value: machine.rec_id,
    label: `${machine.rec_id} - ${machine.machine_id} - ${
      machine.item?.item || machine.machine_id
    } (${machine.machineDetails?.length || 0} instructions)`,
  }));

  // Calculate loading state for form
  const formLoading =
    isCreating || isUpdating || isFetchingMachine || bomLoading;

  const totalPages = Math.max(1, Math.ceil(recipeTotal / recipeLimit));
  const firstShown = recipeTotal === 0 ? 0 : (recipePage - 1) * recipeLimit + 1;
  const lastShown = Math.min(recipePage * recipeLimit, recipeTotal);

  const SortHead = ({ field, children, className }) => (
    <th className={cn(TH, className)}>
      <button
        type="button"
        onClick={() => handleRecipeSort(field)}
        className="inline-flex items-center gap-1.5 uppercase hover:opacity-80"
      >
        {children}
        <ArrowUpDown size={13} className="opacity-70" />
      </button>
    </th>
  );

  const IconAction = ({ icon: Icon, label, onClick }) => (
    <button
      type="button"
      onClick={onClick}
      title={label}
      aria-label={label}
      className="inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-primary/10 hover:text-primary"
    >
      <Icon size={16} />
    </button>
  );

  const clearFilters = () => {
    setLocalSearch("");
    setSearchRecipe("");
    setRecipePage(1);
    setHasSearched(false);
  };

  const isFormView = modalMode === "view";

  return (
    <div className="space-y-4">
      {confirmDialog}

      {/* Header */}
      <LabHeader
        icon={ScrollText}
        title="Recipes"
        badge={recipeTotal || null}
        subtitle="Production processes: materials and machine instructions in sequence"
        actions={
          <Button onClick={() => openModal("create")}>
            <Plus />
            New Recipe
          </Button>
        }
      />

      <LabCard>
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-3 sm:px-4">
          <div className="relative min-w-0 flex-1 basis-full sm:basis-64 sm:max-w-md">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground"
              size={16}
            />
            <Input
              type="search"
              value={localSearch}
              onChange={(e) => setLocalSearch(e.target.value)}
              placeholder="Search recipes by MM no., name or code…"
              aria-label="Search recipes"
              className="h-9 pl-9"
            />
          </div>
          <select
            value={filterRecipe}
            onChange={(e) => setFilterRecipe(e.target.value)}
            aria-label="Status"
            className={cn(FIELD_INPUT, "h-9 w-auto flex-1 sm:flex-none")}
          >
            <option value="">All status</option>
            <option value="Active">Active</option>
            <option value="Inactive">Inactive</option>
          </select>

          <select
            value={recipeLimit}
            onChange={(e) => {
              setRecipeLimit(Number(e.target.value));
              setRecipePage(1);
            }}
            aria-label="Rows per page"
            className={cn(FIELD_INPUT, "h-9 w-auto flex-1 sm:flex-none")}
          >
            <option value={10}>10 per page</option>
            <option value={25}>25 per page</option>
            <option value={50}>50 per page</option>
            <option value={100}>100 per page</option>
          </select>

          {(localSearch || searchRecipe) && (
            <Button variant="ghost" size="sm" onClick={clearFilters}>
              <X />
              Clear
            </Button>
          )}
        </div>

        {recipeError && (
          <p className="flex items-center gap-2 border-b border-destructive/20 bg-destructive/5 px-4 py-2 text-[13px] text-destructive">
            <AlertCircle size={14} className="flex-shrink-0" />
            {String(recipeError)}
          </p>
        )}

        {/* Table — rows become cards under md (vl-grid) */}
        <div className="md:max-h-[calc(100vh-300px)] md:overflow-auto">
          <table className="vl-grid w-full text-sm">
            <thead>
              <tr>
                <SortHead field="finished_id">Material</SortHead>
                <SortHead field="dated">Date</SortHead>
                <SortHead field="status">Status</SortHead>
                <th className={cn(TH, "text-right")}>Steps</th>
                <th className={cn(TH, "text-right")}>Time</th>
                <th className={cn(TH, "text-right")}>Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {recipeLoading ? (
                [0, 1, 2, 3, 4, 5].map((i) => (
                  <tr key={i}>
                    <td colSpan={6} className={TD}>
                      <Skeleton className="h-9 w-full" />
                    </td>
                  </tr>
                ))
              ) : recipes.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <LabEmpty
                      icon={ScrollText}
                      title={searchRecipe || filterRecipe ? "No recipes match" : "No recipes yet"}
                      hint={
                        searchRecipe || filterRecipe
                          ? "Try a different search or status."
                          : "Create your first recipe to get started."
                      }
                      action={
                        searchRecipe || filterRecipe ? (
                          <Button variant="outline" size="sm" onClick={() => { clearFilters(); setFilterRecipe(""); }}>
                            Clear filters
                          </Button>
                        ) : (
                          <Button size="sm" onClick={() => openModal("create")}>
                            <Plus />
                            New Recipe
                          </Button>
                        )
                      }
                    />
                  </td>
                </tr>
              ) : (
                recipes.map((recipe, index) => (
                  <tr key={index} className="transition-colors hover:bg-muted/40">
                    <td data-label="Material" className={cn(TD, "col-span-2 max-w-[360px]")}>
                      <p className="truncate font-semibold text-foreground" title={recipe.item?.item}>
                        {recipe.item?.item || "N/A"}
                      </p>
                      <div className="mt-1 flex flex-wrap items-center gap-1.5">
                        <span className={CODE_CHIP}>{recipe.finished_id}</span>
                        {recipe.item?.code && (
                          <span className="text-[12px] text-muted-foreground">
                            Ink {recipe.item.code}
                          </span>
                        )}
                      </div>
                    </td>
                    <td data-label="Date" className={cn(TD, "whitespace-nowrap tabular-nums")}>
                      {new Date(recipe.dated).toLocaleDateString("en-US", {
                        year: "numeric",
                        month: "short",
                        day: "numeric",
                      })}
                    </td>
                    <td data-label="Status" className={TD}>
                      <Chip tone={recipe.status === "Active" ? "ok" : recipe.status === "Inactive" ? "bad" : "muted"}>
                        {recipe.status}
                      </Chip>
                    </td>
                    <td data-label="Steps" className={cn(TD, NUM)}>
                      {recipe.receipeDetails?.length || 0}
                    </td>
                    <td data-label="Time" className={cn(TD, NUM, "whitespace-nowrap")}>
                      {recipe.time_min || 0}m
                    </td>
                    <td className={cn(TD, "vl-actions whitespace-nowrap text-right")}>
                      <div className="inline-flex items-center gap-0.5">
                        <IconAction
                          icon={Calculator}
                          label="Quick view & calculation"
                          onClick={() => setCalcModal({ show: true, item: recipe, qty: 1 })}
                        />
                        <IconAction
                          icon={Download}
                          label="Export recipe to Excel"
                          onClick={(e) => {
                            e.stopPropagation();
                            exportRecipeViewToExcel(recipe);
                          }}
                        />
                        <IconAction
                          icon={Eye}
                          label="View recipe"
                          onClick={() => openModal("view", recipe)}
                        />
                        <IconAction
                          icon={Edit}
                          label="Edit recipe"
                          onClick={() => openModal("edit", recipe)}
                        />
                        {/* DELETE BUTTON — disabled; deleteRecipe() asks through the confirm dialog */}
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {!recipeLoading && recipeTotal > 0 && (
          <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-2.5 text-[13px] sm:px-4">
            <span className="text-muted-foreground">
              Showing <span className="tabular-nums text-foreground">{firstShown}–{lastShown}</span> of{" "}
              <span className="tabular-nums text-foreground">{recipeTotal}</span> recipes
            </span>
            {recipeTotal > recipeLimit && (
              <div className="flex items-center gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRecipePage(Math.max(1, recipePage - 1))}
                  disabled={recipePage === 1}
                >
                  <ChevronLeft />
                  Prev
                </Button>
                <span className="tabular-nums text-muted-foreground">
                  {recipePage} / {totalPages}
                </span>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setRecipePage(Math.min(totalPages, recipePage + 1))}
                  disabled={recipePage >= totalPages}
                >
                  Next
                  <ChevronRight />
                </Button>
              </div>
            )}
          </div>
        )}
      </LabCard>

      {/* Recipe form — create / edit / view */}
      <Dialog
        open={showModal}
        onOpenChange={(open) => {
          if (!open && !formLoading) closeModal();
        }}
      >
        <DialogContent
          className={cn(DIALOG, "max-w-6xl")}
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => {
            if (!isFormView) e.preventDefault();
          }}
        >
          <div className={DIALOG_HEAD}>
            <DialogTitle className="pr-8 text-lg font-semibold text-primary">
              {modalMode === "create" && "New Recipe"}
              {modalMode === "edit" && "Edit Recipe"}
              {modalMode === "view" && "Recipe Details"}
            </DialogTitle>
            <DialogDescription className="mt-0.5 flex flex-wrap items-center gap-2 text-[12.5px]">
              {recipeForm.finished_id ? (
                <>
                  <span className={CODE_CHIP}>{recipeForm.finished_id}</span>
                  {editingItem?.item?.item && <span className="truncate">{editingItem.item.item}</span>}
                </>
              ) : (
                "Pick a BOM to fill the product, then build the step sequence."
              )}
            </DialogDescription>
          </div>

          <div className={DIALOG_BODY}>
            <RecipeForm
              formData={recipeForm}
              setFormData={setRecipeForm}
              activeBomOptions={bomOptions} // Pass the direct state
              machineOptions={machineOptions}
              validationErrors={validationErrors}
              setValidationErrors={setValidationErrors}
              bomError={bomError}
              isEditing={modalMode === "edit"}
              loading={formLoading}
              isViewMode={modalMode === "view"} // PASS VIEW MODE PROP
            />
          </div>

          {/* Footer with conditional buttons */}
          <div className={DIALOG_FOOT}>
            <Button variant="outline" onClick={closeModal} disabled={formLoading}>
              {isFormView ? "Close" : "Cancel"}
            </Button>

            {!isFormView && (
              <Button
                onClick={editingItem ? updateRecipe : createRecipe}
                disabled={formLoading || hasActiveRecipeConflict}
              >
                {formLoading ? (
                  <>
                    <Loader2 className="animate-spin" />
                    {isCreating ? "Creating..." : isUpdating ? "Updating..." : "Loading..."}
                  </>
                ) : (
                  <>
                    <Save />
                    {editingItem ? "Update Recipe" : "Create Recipe"}
                  </>
                )}
              </Button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {/* Recipe Quick View — scale the formulation to a target quantity */}
      <Dialog
        open={calcModal.show}
        onOpenChange={(open) => {
          if (!open) setCalcModal({ ...calcModal, show: false });
        }}
      >
        <DialogContent className={cn(DIALOG, "max-w-4xl")}>
          <div className={DIALOG_HEAD}>
            <DialogTitle className="flex items-center gap-2 pr-8 text-lg font-semibold text-primary">
              <Calculator size={18} />
              Recipe view
            </DialogTitle>
            <DialogDescription className="mt-0.5 truncate text-[12.5px]">
              {calcModal.item?.item?.item || "Quantities per material for a target batch"}
            </DialogDescription>
          </div>

          <div className={cn(DIALOG_BODY, "space-y-4")}>
            {/* Inputs and basic info */}
            <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,240px)_minmax(0,1fr)]">
              <div>
                <label htmlFor="recipe-calc-qty" className={FIELD_LABEL}>
                  Target quantity
                </label>
                <div className="relative">
                  <input
                    id="recipe-calc-qty"
                    type="number"
                    value={calcModal.qty}
                    onChange={(e) => setCalcModal({ ...calcModal, qty: parseFloat(e.target.value) || 0 })}
                    className={cn(FIELD_INPUT, "h-12 pr-12 text-right text-xl font-semibold tabular-nums")}
                    autoFocus
                  />
                  <span className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3 text-sm font-semibold text-muted-foreground">
                    KG
                  </span>
                </div>
              </div>

              <dl className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                {[
                  ["Material code", calcModal.item?.finished_id, true],
                  ["Ink code", calcModal.item?.item?.code || ""],
                  ["Master sample", calcModal.item?.item?.alternate_id || ""],
                  ["Date", new Date().toLocaleDateString("en-GB")],
                ].map(([label, value, code]) => (
                  <div key={label} className="min-w-0 rounded-lg border border-border bg-muted/30 px-3 py-2">
                    <dt className="text-[11px] font-medium text-muted-foreground">{label}</dt>
                    <dd className="mt-0.5 truncate text-sm font-semibold text-foreground">
                      {code && value ? <span className={CODE_CHIP}>{value}</span> : value || "—"}
                    </dd>
                  </div>
                ))}
                <div className="col-span-2 min-w-0 rounded-lg border border-border bg-muted/30 px-3 py-2 sm:col-span-4">
                  <dt className="text-[11px] font-medium text-muted-foreground">Material description</dt>
                  <dd className="mt-0.5 line-clamp-2 text-sm font-semibold text-foreground">
                    {calcModal.item?.item?.item || "—"}
                  </dd>
                </div>
              </dl>
            </div>

            {/* Requirement table */}
            <div className="overflow-x-auto rounded-xl border border-border">
              <table className="w-full min-w-[520px] text-sm">
                <thead>
                  <tr>
                    <th className={cn(TH, "w-14 text-center")}>#</th>
                    <th className={cn(TH, "w-36")}>Item ID</th>
                    <th className={TH}>Description / Instructions</th>
                    <th className={cn(TH, "w-32 text-right")}>Qty (KG)</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border bg-background">
                  {calcModal.item?.receipeDetails?.map((step, idx) => {
                    const isProduct = step.type === "product" || (step.qty > 0 && step.qty !== null);
                    const percentage = step.product_percentage || step.percentage || 0;
                    const calculatedQty = (parseFloat(percentage) / 100 * calcModal.qty).toFixed(3);

                    return (
                      <tr key={idx} className="hover:bg-muted/40">
                        <td className={cn(TD, "text-center tabular-nums text-muted-foreground")}>{step.sno || idx + 1}</td>
                        <td className={TD}>
                          {step.product_id || step.material_id ? (
                            <span className={CODE_CHIP}>{step.product_id || step.material_id}</span>
                          ) : (
                            ""
                          )}
                        </td>
                        <td className={TD}>
                          <div className="font-medium text-foreground">{step.product_desc || step.description || ""}</div>
                          {step.instructions && (
                            <div className="mt-0.5 text-xs italic text-muted-foreground">{step.instructions}</div>
                          )}
                        </td>
                        <td className={cn(TD, NUM, "font-semibold")}>
                          {isProduct ? `${calculatedQty}` : <span className="text-muted-foreground">-</span>}
                        </td>
                      </tr>
                    );
                  })}
                  {(!calcModal.item?.receipeDetails || calcModal.item.receipeDetails.length === 0) && (
                    <tr>
                      <td colSpan={4} className="px-4 py-8 text-center text-muted-foreground">
                        No steps found in this recipe.
                      </td>
                    </tr>
                  )}
                </tbody>
                {calcModal.qty > 0 && (
                  <tfoot>
                    <tr className={TOTAL_ROW}>
                      <td colSpan={3} className={cn(TD, "text-right")}>Total formulation qty</td>
                      <td className={cn(TD, NUM, "text-primary")}>{calcModal.qty.toFixed(2)} KG</td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          </div>

          <div className={DIALOG_FOOT}>
            <Button variant="outline" onClick={() => setCalcModal({ ...calcModal, show: false })}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default RecipeTab;
