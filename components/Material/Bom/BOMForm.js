"use client";
import React, { useState, useEffect, useMemo, useRef, useCallback } from "react";
import {
  X,
  AlertCircle,
  Check,
  Plus,
  Package,
  Settings,
  BarChart3,
  Loader2,
  Copy,
  CheckCheck,
} from "lucide-react";
import Select from "react-select";
import useKeyboardShortcuts from "@/hooks/useKeyboardShortcuts";
import KeyboardHint, { KeyCombo } from "@/components/ui/KeyboardHint";
import { selectStyles } from "@/components/shared/EntityFormPanel";
import { LabCard, Chip, CHIP, CODE_CHIP, TH, TD, NUM, TOTAL_ROW } from "../shared/LabUI";

const BOMForm = ({
  formData,
  setFormData,
  finishItems = [], // ← ADD DEFAULT
  bomItems,
  onSaveDisabled,
  isEditing,
  isViewMode = false,
  isCloning = false, // ← ADD THIS LINE
  sourceBomId = null,
}) => {
  
  const [materialInput, setMaterialInput] = useState({
    material_id: "",
    material_desc: "",
    material_code: "",
    material_category: "",
    material_percentage: 0,
  });

  // Refs drive the mouse-free add loop:
  // material select -> percentage -> Enter -> back to material select
  const materialSelectRef = useRef(null);
  const percentageInputRef = useRef(null);

  const focusMaterialSelect = useCallback(() => {
    materialSelectRef.current?.focus();
  }, []);

  const [existingBOM, setExistingBOM] = useState(null);
  const [showDuplicateWarning, setShowDuplicateWarning] = useState(false);
  const [validationErrors, setValidationErrors] = useState({});
  const [loading, setLoading] = useState(false);
  const [apiChecks, setApiChecks] = useState({});
  const [hasCircularReference, setHasCircularReference] = useState(false);
  const [copiedRow, setCopiedRow] = useState(null);
  const [copiedAll, setCopiedAll] = useState(false);
  const [productSearchInput, setProductSearchInput] = useState("");
  const [materialSearchInput, setMaterialSearchInput] = useState("");

  const handleProductInputChange = (inputValue, { action }) => {
    if (action === "input-change") {
      setProductSearchInput(inputValue);
    } else if (action === "menu-close" || action === "input-blur") {
      setProductSearchInput("");
    }
  };

  const handleMaterialInputChange = (inputValue, { action }) => {
    if (action === "input-change") {
      setMaterialSearchInput(inputValue);
    } else if (action === "menu-close" || action === "input-blur") {
      setMaterialSearchInput("");
    }
  };

  // Renders an option as: [CODE]  Item name            #itcd
  // Collapses to "CODE — name" once selected.
  const renderItemOption = (option, { context }) => {
    if (!option) return null;
    const raw = option.item || {};
    const code = raw.code || "";
    const name = raw.item || option.label || "";

    if (context === "value") {
      return (
        <span className="flex items-center gap-1.5 min-w-0">
          {code && (
            <span className="font-mono font-bold text-primary flex-shrink-0">
              {code}
            </span>
          )}
          <span className="truncate">{name}</span>
        </span>
      );
    }

    return (
      <div className="flex items-center gap-2 min-w-0">
        <span className="flex-shrink-0 font-mono text-[11px] font-bold px-1.5 py-0.5 rounded bg-primary/10 text-primary border border-primary/20">
          {code || "—"}
        </span>
        <span className="flex-1 truncate font-medium">{name}</span>
        <span className="flex-shrink-0 text-[10px] text-muted-foreground font-mono">
          #{raw.itcd ?? option.value}
        </span>
      </div>
    );
  };

  const filterAndSortItemOptions = (options, inputValue) => {
    if (!inputValue || !inputValue.trim()) return options;

    const query = inputValue.trim().toLowerCase();

    const getRank = (opt) => {
      const rawItem = opt.item || {};
      const code = String(rawItem.code || "").trim().toLowerCase();
      const itcd = String(rawItem.itcd || opt.value || "").trim().toLowerCase();
      const name = String(rawItem.item || "").trim().toLowerCase();
      const label = String(opt.label || "").trim().toLowerCase();

      // 1. Exact match on item code or itcd
      if (code === query || itcd === query) return 1;

      // 2. Item code or itcd starts with query
      if (code.startsWith(query) || itcd.startsWith(query)) return 2;

      // 3. Code contains standalone token/word matching query (e.g. E-256)
      const codeTokens = code.split(/[\s\-_\/]+/);
      if (codeTokens.some((t) => t === query)) return 3;
      if (codeTokens.some((t) => t.startsWith(query))) return 4;

      // 4. Item name starts with query
      if (name.startsWith(query)) return 5;

      // 5. Label starts with query
      if (label.startsWith(query)) return 6;

      // 6. Substring match anywhere
      if (
        code.includes(query) ||
        itcd.includes(query) ||
        name.includes(query) ||
        label.includes(query)
      ) {
        return 7;
      }

      return 999;
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

  // API Validation Service
  const bomValidationAPI = {
    // Comprehensive check for material addition
    validateMaterial: async (finishedId, materialId) => {
      try {
        const response = await fetch(
          `/api/manufacturing/bom/validation?checkType=comprehensive&finishedId=${finishedId}&materialId=${materialId}`,
        );
        if (!response.ok) throw new Error("Validation failed");
        return await response.json();
      } catch (error) {
        console.error("Validation API error:", error);
        throw error;
      }
    },

    // Check product status
    checkProductStatus: async (finishedId) => {
      try {
        const response = await fetch(
          `/api/manufacturing/bom/validation?checkType=productStatus&finishedId=${finishedId}`,
        );
        if (!response.ok) throw new Error("Validation failed");
        return await response.json();
      } catch (error) {
        console.error("Product status check error:", error);
        throw error;
      }
    },

    // Final validation before save
    finalValidation: async (bomData) => {
      const response = await fetch(
        "/api/manufacturing/bom/validation?checkType=finalValidation",
        {
          method: "GET",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(bomData),
        },
      );
      return await response.json();
    },
  };

  // Helper function to copy text as fallback for non-HTTPS environments
  const copyToClipboard = async (text) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      return await navigator.clipboard.writeText(text);
    } else {
      // Fallback for HTTP/non-secure contexts
      const textArea = document.createElement("textarea");
      textArea.value = text;
      textArea.style.position = "fixed";
      textArea.style.left = "-999999px";
      textArea.style.top = "-999999px";
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();
      return new Promise((resolve, reject) => {
        if (document.execCommand('copy')) {
          resolve();
        } else {
          reject(new Error('Fallback copy failed'));
        }
        document.body.removeChild(textArea);
      });
    }
  };

  // Copy all table data to clipboard in table format
  const copyAllData = async () => {
    if (formData.bomDetails.length === 0) return;

    // Create header row
    const header = "Material ID\tCode\tDescription\tCategory\tPercentage";

    // Create data rows
    const rows = formData.bomDetails
      .map((material) => {
        const r = describeMaterial(material.material_id);
        return [
          material.material_id,
          material.material_code || r.code,
          material.material_desc || r.desc,
          material.material_category || r.category,
          material.material_percentage,
        ].join("\t");
      })
      .join("\n");

    const tableText = `${header}\n${rows}`;

    try {
      await copyToClipboard(tableText);
      setCopiedAll(true);
      setTimeout(() => setCopiedAll(false), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  // Copy row data to clipboard in table format
  const copyRowData = async (material, index) => {
    // Format as tab-separated for easy paste in Excel/Sheets
    const r = describeMaterial(material.material_id);
    const rowText = [
      material.material_id,
      material.material_code || r.code,
      material.material_desc || r.desc,
      material.material_category || r.category,
      `${material.material_percentage}%`,
    ].join("\t");

    try {
      await copyToClipboard(rowText);
      setCopiedRow(index);
      setTimeout(() => setCopiedRow(null), 2000);
    } catch (err) {
      console.error("Failed to copy:", err);
    }
  };

  const editPercentage = (index, newPercentage) => {
    if (isViewMode) return;

    const numValue = parseFloat(newPercentage) || 0;

    // Determine max percentage based on product category
    const selectedProduct = finishItems.find(
      (item) => item.itcd === formData.finished_id,
    );
    const maxPercentage = selectedProduct?.ic_id === 1 ? 110 : 100; 

    // Validate percentage
    if (numValue < 0 || numValue > maxPercentage) return;

    // Calculate current total excluding the item being edited and empty rows
    const currentTotalWithoutItem = formData.bomDetails.reduce(
      (sum, mat, i) => {
        return i !== index && mat.material_id !== ""
          ? sum + (parseFloat(mat.material_percentage) || 0)
          : sum;
      },
      0,
    );

    // Check if new total would exceed max
    const newTotal = currentTotalWithoutItem + numValue;
    if (newTotal > maxPercentage) {
      setValidationErrors({
        percentage: `Total percentage cannot exceed ${maxPercentage}% (would be ${newTotal.toFixed(
          1,
        )}%)`,
      });
      return;
    }

    // Update the material percentage
    const updatedBomDetails = [...formData.bomDetails];
    updatedBomDetails[index] = {
      ...updatedBomDetails[index],
      material_percentage: numValue,
    };

    setFormData({
      ...formData,
      bomDetails: updatedBomDetails,
    });

    setValidationErrors({});
  };

  // Handle edit mode properly
  useEffect(() => {
    if ((isEditing || isViewMode) && formData.finished_id) {
      // When in edit or view mode, ensure the category is correctly set based on the selected product
      const selectedProduct = finishItems.find(
        (item) => item.itcd === formData.finished_id,
      );
      if (selectedProduct) {
        const correctCategory =
          selectedProduct.ic_id === 1 ? "Finished" : "Semi Finished";

        // Only update if category is different
        if (formData.category !== correctCategory) {
          setFormData((prev) => ({
            ...prev,
            category: correctCategory,
          }));
        }
      }
    }
  }, [
    isEditing,
    isViewMode,
    formData.finished_id,
    finishItems,
    formData.category,
    setFormData,
  ]);

  // SCENARIO 1: Check product status when product is selected
  useEffect(() => {
    const checkProductStatus = async () => {
      if (formData.finished_id && !isViewMode) {
        try {
          setLoading(true);
          const result = await bomValidationAPI.checkProductStatus(
            formData.finished_id,
          );

          if (result.hasActiveBOM) {
            setExistingBOM(result.bom);
            setShowDuplicateWarning(true);
            if (!isEditing) {
              onSaveDisabled?.(true);
            }
          } else {
            setExistingBOM(null);
            setShowDuplicateWarning(false);
            onSaveDisabled?.(false);
          }
        } catch (error) {
          console.error("Error checking product status:", error);
        } finally {
          setLoading(false);
        }
      }
    };

    checkProductStatus();
  }, [formData.finished_id, isEditing, isViewMode]);

  // Handle category change
  const handleCategoryChange = (category) => {
    if (isViewMode) return; // Prevent changes in view mode

    setFormData({
      ...formData,
      category,
      finished_id: "",
      bomDetails: [],
    });
    setValidationErrors({});
    setApiChecks({});
    onSaveDisabled?.(false);
  };

  const handleProductChange = async (selected) => {
    if (isViewMode) return;

    const finished_id = selected ? selected.value : "";

    // Determine category based on selected product
    const selectedProduct = finishItems.find(
      (item) => item.itcd === finished_id,
    );
    const category = selectedProduct
      ? selectedProduct.ic_id === 1
        ? "Finished"
        : "Semi Finished"
      : formData.category;

    // If cloning and changing product, keep the existing materials but update the product
    if (isCloning && finished_id && finished_id !== formData.finished_id) {
      setFormData((prev) => ({
        ...prev,
        finished_id,
        category,
        // Keep existing bomDetails from the cloned BOM
      }));
    } else {
      // Normal behavior for non-cloning or when clearing selection
      setFormData({
        ...formData,
        finished_id,
        category,
        bomDetails:
          finished_id !== formData.finished_id ? [] : formData.bomDetails,
      });
    }

    setValidationErrors({});
    setApiChecks({});
    onSaveDisabled?.(false);
  };

  // Handle status change
  const handleStatusChange = (status) => {
    if (isViewMode) return; // Prevent changes in view mode

    setFormData({
      ...formData,
      instructions: status,
    });
  };

  const addMaterial = async () => {
    if (isViewMode) return;

    
    

    // Clear previous errors
    setValidationErrors({});
    setApiChecks({});
    setHasCircularReference(false);

    // Determine max percentage based on product category
    const selectedProduct = finishItems.find(
      (item) => item.itcd === formData.finished_id,
    );
    const maxPercentage = selectedProduct?.ic_id === 1 ? 110 : 100;

    // Basic validation (same as before)
    if (
      !materialInput.material_id ||
      !materialInput.material_desc ||
      materialInput.material_percentage <= 0
    ) {
      setValidationErrors({ general: "Please fill all material fields" });
      return;
    }

    if (!formData.finished_id) {
      setValidationErrors({ general: "Please select the product" });
      return;
    }

    // Check if material is master product
    if (String(materialInput.material_id) === String(formData.finished_id)) {
      setValidationErrors({
        master: "Master product cannot be added as a material",
      });
      return;
    }

    // Check percentage - use dynamic max
    const currentTotal = formData.bomDetails
      .filter(mat => mat.material_id !== "") // Exclude empty rows
      .reduce(
        (sum, mat) => sum + (parseFloat(mat.material_percentage) || 0),
        0,
      );
    const newTotal = currentTotal + materialInput.material_percentage;
    if (newTotal > maxPercentage) {
      setValidationErrors({
        percentage: `Total percentage cannot exceed ${maxPercentage}% (current: ${currentTotal}%)`,
      });
      return;
    }

    setLoading(true);

    try {
      // USE OPTIMIZED VALIDATION API
      const response = await fetch(
        `/api/manufacturing/bom/validation?checkType=comprehensive&finishedId=${formData.finished_id}&materialId=${materialInput.material_id}`,
      );

      if (!response.ok) throw new Error("Validation failed");

      const validationResult = await response.json();

      
      setApiChecks(validationResult);

      // Check validation results
      const errors = {};

      if (validationResult.hasActiveBOM && !isEditing) {
        errors.activeBOM = "An active BOM already exists for this product";
      }

      if (validationResult.hasCircularReference) {
        errors.circular =
          "This material creates a circular reference in BOM hierarchy";
        setHasCircularReference(true);
      }

      if (validationResult.isMasterProduct) {
        errors.master = "Master product cannot be added as a material";
      }

      // If any critical errors, stop here
      if (Object.keys(errors).length > 0) {
        setValidationErrors(errors);
        setLoading(false);
        return;
      }

      // SCENARIO 6: Material has BOM (warning only)
      if (validationResult.materialHasBOM) {
        setValidationErrors({
          warning:
            "This material has its own BOM. Ensure no circular references.",
        });
      }

      // All checks passed - add material AND auto-add empty row
      setFormData({
        ...formData,
        bomDetails: [
          ...formData.bomDetails,
          { ...materialInput },
        ],
      });

      setMaterialInput({
        material_id: "",
        material_desc: "",
        material_code: "",
        material_category: "",
        material_percentage: 0,
      });

      // Cursor returns to the material picker so the next item can be typed
      // immediately — no mouse needed between rows.
      setTimeout(focusMaterialSelect, 0);
    } catch (error) {
      console.error("❌ Error during material validation:", error);
      setValidationErrors({ general: "Validation failed. Please try again." });
    } finally {
      setLoading(false);
    }
  };

  // Remove material
  const removeMaterial = (index) => {
    if (isViewMode) return; // Prevent changes in view mode

    setFormData({
      ...formData,
      bomDetails: formData.bomDetails.filter((_, i) => i !== index),
    });
    setValidationErrors({});
    setApiChecks({});
    setHasCircularReference(false);
    onSaveDisabled?.(false);
  };

  // Calculate total percentage (excluding empty rows)
  const totalPercentage = formData.bomDetails
    .filter(mat => mat.material_id !== "")
    .reduce(
      (sum, mat) => sum + (parseFloat(mat.material_percentage) || 0),
      0,
    );

  // Handle percentage input - dynamic max
  const handlePercentageChange = (value) => {
    if (isViewMode) return; // Prevent changes in view mode

    const selectedProduct = finishItems.find(
      (item) => item.itcd === formData.finished_id,
    );
    const maxPercentage = selectedProduct?.ic_id === 1 ? 110 : 100;

    const numValue = parseFloat(value) || 0;
    if (numValue > maxPercentage) {
      setMaterialInput({
        ...materialInput,
        material_percentage: maxPercentage,
      });
    } else if (numValue < 0) {
      setMaterialInput({
        ...materialInput,
        material_percentage: 0,
      });
    } else {
      setMaterialInput({
        ...materialInput,
        material_percentage: numValue,
      });
    }
    setValidationErrors((prev) => ({ ...prev, percentage: "" }));
  };

  // Get filtered options
  // const filteredFinishOptions = finishItems
  //   .filter((item) => {
  //     if (formData.category === "Finished") {
  //       return item.ic_id === 1;
  //     } else if (formData.category === "Semi Finished") {
  //       return item.ic_id === 2;
  //     }
  //     return true;
  //   })
  //   .map((item) => ({
  //     value: item.itcd,
  //     label: `${item.itcd} - ${item.item}`,
  //   }));

  const filteredFinishOptions = finishItems.map((item) => ({
  value: item.itcd,
  label: `${item.code} - ${item.itcd} - ${item.item} (${item.ic_id === 1 ? "Finished" : "Semi-Finished"})`,
  item: item,
}));
 

  // Fast itcd -> item lookup, used to resolve code/description/category for rows
  // that were saved before the code column existed.
  const itemsByItcd = useMemo(() => {
    const map = new Map();
    (finishItems || []).forEach((item) => {
      map.set(String(item.itcd), item);
    });
    return map;
  }, [finishItems]);

  const describeMaterial = useCallback(
    (materialId) => {
      const item = itemsByItcd.get(String(materialId));
      return {
        code: item?.code || "",
        desc: item?.item || "",
        category: item?.itemCategories?.ic_name || "",
      };
    },
    [itemsByItcd],
  );

  // Backfill rows loaded from the API: older BOMs stored the itcd in
  // material_desc (the old label-splitting bug) and had no code at all.
  // Normalising here keeps what is shown identical to what gets saved.
  useEffect(() => {
    if (!formData.bomDetails?.length || itemsByItcd.size === 0) return;

    let changed = false;
    const normalised = formData.bomDetails.map((row) => {
      if (!row.material_id) return row;
      const { code, desc, category } = describeMaterial(row.material_id);
      if (!code && !desc && !category) return row;

      const next = { ...row };
      // Missing code, or a description that is really just the id
      if (!next.material_code && code) {
        next.material_code = code;
        changed = true;
      }
      if (
        desc &&
        (!next.material_desc ||
          String(next.material_desc).trim() === String(row.material_id).trim())
      ) {
        next.material_desc = desc;
        changed = true;
      }
      if (!next.material_category && category) {
        next.material_category = category;
        changed = true;
      }
      return next;
    });

    if (changed) {
      setFormData((prev) => ({ ...prev, bomDetails: normalised }));
    }
  }, [formData.bomDetails, itemsByItcd, describeMaterial, setFormData]);

  // Get material options — only finished product excluded, same material can be added multiple times
  const getMaterialOptions = () => {
    return finishItems
      .filter((item) => String(item.itcd) !== String(formData.finished_id))
      .map((item) => ({
        value: item.itcd,
        label: `${item.code} - ${item.itcd} - ${item.item}`,
        item: item,
      }));
  };

  // Handle cloning functionality
  const handleCloning = async (sourceBomId) => {
    if (!sourceBomId) return;

    try {
      setLoading(true);

      // Fetch the source BOM data
      const response = await fetch(`/api/manufacturing/bom/${sourceBomId}`);
      if (!response.ok) throw new Error("Failed to fetch source BOM");

      const sourceBom = await response.json();

      // Set form data with cloned values but clear the ID and change product
      setFormData({
        ...sourceBom,
        id: "", // Clear the ID to create new record
        finished_id: "", // Clear finished product so user can select new one
        bom_name: `${sourceBom.bom_name} - Copy`, // Modify name to indicate clone
        instructions: "B", // Default to inactive for safety
        bomDetails: sourceBom.materials.map((detail) => ({
          material_id: detail.id,
          material_desc: detail.name || "",
          material_percentage: detail.percentage,
          material_category: detail.category || "",
          id: "", // Clear individual detail IDs
        })),
      });

      // Show success message
      
    } catch (error) {
      console.error("Error cloning BOM:", error);
      setValidationErrors({
        general: "Failed to clone BOM. Please try again.",
      });
    } finally {
      setLoading(false);
    }
  };

  // Add this useEffect to handle initial cloning setup
  useEffect(() => {
    if (isCloning && formData.finished_id) {
      // When in cloning mode with a selected product, show appropriate message
      

      // Re-validate all materials against the new product
      validateAllMaterials();
    }
  }, [isCloning, formData.finished_id]);

  // Validate all materials when product changes in cloning mode
  const validateAllMaterials = async () => {
    if (
      !isCloning ||
      !formData.finished_id ||
      formData.bomDetails.length === 0
    ) {
      return;
    }

    try {
      setLoading(true);

      // Check for circular references with new product
      const validationPromises = formData.bomDetails.map((material) =>
        bomValidationAPI.validateMaterial(
          formData.finished_id,
          material.material_id,
        ),
      );

      const results = await Promise.all(validationPromises);

      // Check if any material creates circular reference
      const hasCircularRef = results.some(
        (result) => result.hasCircularReference,
      );
      setHasCircularReference(hasCircularRef);

      if (hasCircularRef) {
        setValidationErrors({
          circular:
            "One or more materials create circular references with the new product",
        });
        onSaveDisabled?.(true);
      } else {
        setValidationErrors({});
        onSaveDisabled?.(false);
      }
    } catch (error) {
      console.error("Error validating cloned materials:", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (isCloning && sourceBomId) {
      handleCloning(sourceBomId);
    }
  }, [isCloning, sourceBomId]);

  // ── Keyboard shortcuts ─────────────────────────────────────────────────
  const canAddMaterial =
    !isViewMode &&
    !!materialInput.material_id &&
    materialInput.material_percentage > 0 &&
    !loading;

  useKeyboardShortcuts(
    {
      // Jump to the material picker from anywhere in the form
      "alt+m": { handler: focusMaterialSelect, allowInInput: true },
      // Add the row currently staged in the inputs
      "alt+a": {
        handler: () => {
          if (canAddMaterial) addMaterial();
        },
        allowInInput: true,
      },
      // Jump to the percentage box
      "alt+p": {
        handler: () => {
          percentageInputRef.current?.focus();
          percentageInputRef.current?.select();
        },
        allowInInput: true,
      },
    },
    !isViewMode,
  );

  const BOM_SHORTCUTS = [
    { combo: "Alt+M", label: "Focus material search" },
    { combo: "Enter", label: "Confirm material, then add the row" },
    { combo: "Alt+P", label: "Focus percentage" },
    { combo: "Alt+A", label: "Add material row" },
    { combo: "Ctrl+S", label: "Save BOM" },
    { combo: "Esc", label: "Close dropdown / close dialog" },
    { combo: "Shift+?", label: "Show this help" },
  ];

  // Blocking messages, summarised at the top of the form. "warning" is
  // advisory and shows on its own.
  const errorList = isViewMode
    ? []
    : Object.entries(validationErrors).filter(
        ([key, msg]) => key !== "warning" && msg,
      );
  const materialError = validationErrors.general || validationErrors.master;
  const percentageError = validationErrors.percentage;
  const totalComplete = totalPercentage === 100;

  // react-select inside the dialog: shared field look, codes rendered by
  // renderItemOption, menu fixed so the scrolling dialog body cannot clip it.
  const itemSelectStyles = (hasError) => {
    const base = selectStyles(hasError);
    return {
      ...base,
      control: (b, state) => ({
        ...base.control(b, state),
        backgroundColor: state.isDisabled
          ? "hsl(var(--muted))"
          : "hsl(var(--background))",
        opacity: state.isDisabled ? 0.7 : 1,
      }),
      singleValue: (b) => ({ ...b, color: "hsl(var(--foreground))" }),
      input: (b) => ({ ...b, color: "hsl(var(--foreground))" }),
      menu: (b) => ({
        ...base.menu(b),
        border: "1px solid hsl(var(--border))",
        zIndex: 60,
      }),
    };
  };

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Everything that blocks adding / saving, in one place */}
      {errorList.length > 0 && (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3"
        >
          <p className="flex items-center gap-2 text-sm font-semibold text-destructive">
            <AlertCircle className="h-4 w-4 flex-shrink-0" />
            {errorList.length === 1
              ? "Please fix this before continuing"
              : `Please fix these ${errorList.length} things before continuing`}
          </p>
          <ul className="mt-1 list-disc space-y-0.5 pl-9 text-[13px] text-destructive">
            {errorList.map(([key, msg]) => (
              <li key={key}>{msg}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Active / inactive BOM already on this product */}
      {!isViewMode && showDuplicateWarning && existingBOM && (
        <div
          className={`flex items-start gap-2.5 rounded-xl border px-4 py-3 ${
            existingBOM.instructions === "A"
              ? "border-destructive/30 bg-destructive/5"
              : `border-transparent ${CHIP.warn}`
          }`}
        >
          <AlertCircle
            className={`mt-0.5 h-4 w-4 flex-shrink-0 ${
              existingBOM.instructions === "A" ? "text-destructive" : ""
            }`}
          />
          <div className="min-w-0">
            <p
              className={`text-sm font-semibold ${
                existingBOM.instructions === "A" ? "text-destructive" : ""
              }`}
            >
              {existingBOM.instructions === "A"
                ? "Active BOM Exists"
                : "Inactive BOM Found"}
            </p>
            <p
              className={`text-[13px] ${
                existingBOM.instructions === "A"
                  ? "text-destructive/80"
                  : "opacity-90"
              }`}
            >
              {existingBOM.instructions === "A"
                ? "An active BOM already exists for this product."
                : `An inactive BOM exists. You can create a new active version.`}
            </p>
          </div>
        </div>
      )}

      {/* Product Setup and Add Material side by side on wide screens */}
      <div
        className={`grid grid-cols-1 gap-4 ${isViewMode ? "" : "xl:grid-cols-3"}`}
      >
        {/* Product Setup */}
        <LabCard
          title="Product"
          subtitle={
            isCloning
              ? formData.finished_id
                ? `Cloning to product #${formData.finished_id} — ${formData.bomDetails.length} materials loaded`
                : "Cloning — select the product this copy is for"
              : "The product this bill of materials makes"
          }
          icon={Settings}
          actions={
            formData.finished_id ? (
              <Chip tone="brand">{formData.category}</Chip>
            ) : null
          }
          className="xl:col-span-2"
          bodyClassName="grid grid-cols-1 gap-4 p-4 md:grid-cols-3"
        >
          <div className="min-w-0 md:col-span-2">
            <label
              htmlFor="bom_product"
              className="mb-1.5 block text-[13px] font-medium text-foreground"
            >
              Product <span className="text-destructive">*</span>
            </label>
            <Select
              inputId="bom_product"
              value={
                filteredFinishOptions.find(
                  (opt) => opt.value === formData.finished_id,
                ) || null
              }
              onChange={handleProductChange}
              options={filterAndSortItemOptions(filteredFinishOptions, productSearchInput)}
              onInputChange={handleProductInputChange}
              formatOptionLabel={renderItemOption}
              filterOption={() => true}
              isSearchable
              isClearable
              placeholder="Search by code, name or ID…"
              aria-label="Search product by code"
              classNamePrefix="react-select"
              isDisabled={isViewMode}
              menuPosition="fixed"
              styles={itemSelectStyles(false)}
            />
          </div>

          {/* Status */}
          <div className="min-w-0">
            <p className="mb-1.5 block text-[13px] font-medium text-foreground">
              BOM Status <span className="text-destructive">*</span>
            </p>
            <div
              role="radiogroup"
              aria-label="BOM status"
              className="grid h-10 grid-cols-2 rounded-lg border border-input bg-muted/40 p-1"
            >
              {[
                { value: "A", label: "Active", tone: CHIP.ok },
                { value: "B", label: "Inactive", tone: CHIP.bad },
              ].map((opt) => {
                const on = formData.instructions === opt.value;
                return (
                  <button
                    key={opt.value}
                    type="button"
                    role="radio"
                    aria-checked={on}
                    onClick={() => handleStatusChange(opt.value)}
                    disabled={isViewMode}
                    className={`flex items-center justify-center gap-1.5 rounded-md text-[13px] font-semibold transition-colors disabled:cursor-not-allowed ${
                      on
                        ? `${opt.tone} shadow-sm`
                        : "text-muted-foreground hover:text-foreground"
                    } ${isViewMode && !on ? "opacity-50" : ""}`}
                  >
                    {on && <Check className="h-3.5 w-3.5" />}
                    {opt.label}
                  </button>
                );
              })}
            </div>
          </div>
        </LabCard>

        {/* Add Material */}
        {!isViewMode && (
          <LabCard
            title="Add material"
            icon={Plus}
            actions={<KeyboardHint shortcuts={BOM_SHORTCUTS} />}
            bodyClassName="space-y-3 p-4"
          >
            {/* Warning (non-blocking) */}
            {validationErrors.warning && (
              <p
                className={`flex items-start gap-2 rounded-lg px-3 py-2 text-[12.5px] ${CHIP.warn}`}
              >
                <AlertCircle className="mt-0.5 h-3.5 w-3.5 flex-shrink-0" />
                {validationErrors.warning}
              </p>
            )}

            <div className="min-w-0">
              <label
                htmlFor="bom_material"
                className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-foreground"
              >
                Material
                <span className="hidden opacity-70 sm:inline">
                  <KeyCombo combo="Alt+M" />
                </span>
              </label>
              <Select
                inputId="bom_material"
                value={
                  getMaterialOptions().find(
                    (opt) => opt.value === materialInput.material_id,
                  ) || null
                }
                ref={materialSelectRef}
                onChange={(selected) => {
                  // Read the fields off the item itself. Splitting the
                  // label used to yield the itcd, not the description.
                  setMaterialInput({
                    ...materialInput,
                    material_id: selected ? selected.value : "",
                    material_desc: selected?.item?.item || "",
                    material_code: selected?.item?.code || "",
                    material_category:
                      selected?.item?.itemCategories?.ic_name || "",
                  });
                  setValidationErrors({});
                  // Hand the cursor straight to the percentage field
                  if (selected) {
                    setTimeout(() => {
                      percentageInputRef.current?.focus();
                      percentageInputRef.current?.select();
                    }, 0);
                  }
                }}
                options={filterAndSortItemOptions(getMaterialOptions(), materialSearchInput)}
                onInputChange={handleMaterialInputChange}
                formatOptionLabel={renderItemOption}
                filterOption={() => true}
                isSearchable
                isClearable
                openMenuOnFocus
                placeholder="Search by code, name or ID…"
                aria-label="Search material by code"
                classNamePrefix="react-select"
                menuPosition="fixed"
                styles={itemSelectStyles(!!materialError)}
              />
              {materialError && (
                <p className="mt-1 text-[12px] text-destructive">
                  {materialError}
                </p>
              )}
            </div>

            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <label
                  htmlFor="bom_material_pct"
                  className="mb-1.5 flex items-center gap-2 text-[13px] font-medium text-foreground"
                >
                  Percentage
                  <span className="hidden opacity-70 sm:inline">
                    <KeyCombo combo="Enter" />
                  </span>
                </label>
                <div className="relative">
                  <input
                    id="bom_material_pct"
                    ref={percentageInputRef}
                    type="number"
                    inputMode="decimal"
                    aria-label="Material percentage"
                    aria-invalid={!!percentageError}
                    value={materialInput.material_percentage}
                    onChange={(e) =>
                      handlePercentageChange(e.target.value)
                    }
                    onFocus={(e) => e.target.select()}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") {
                        e.preventDefault();
                        if (canAddMaterial) addMaterial();
                      } else if (e.key === "Escape") {
                        e.preventDefault();
                        e.stopPropagation();
                        focusMaterialSelect();
                      }
                    }}
                    placeholder="0.0"
                    min="0"
                    max="100"
                    step="0.1"
                    className={`h-10 w-full rounded-lg border bg-background pl-3 pr-8 text-right text-sm font-medium tabular-nums text-foreground outline-none transition-shadow focus:border-primary focus:ring-[3px] focus:ring-primary/15 ${
                      percentageError ? "border-destructive" : "border-input"
                    }`}
                  />
                  <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                    %
                  </span>
                </div>
              </div>

              <button
                type="button"
                onClick={addMaterial}
                disabled={!canAddMaterial}
                title="Add material (Alt + A, or Enter in the percentage box)"
                className="inline-flex h-10 items-center gap-1.5 whitespace-nowrap rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground shadow-sm transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
              >
                {loading ? (
                  <Loader2 className="h-4 w-4 animate-spin" />
                ) : (
                  <Plus className="h-4 w-4" />
                )}
                {loading ? "Adding..." : "Add"}
              </button>
            </div>
            {percentageError && (
              <p className="text-[12px] text-destructive">{percentageError}</p>
            )}
          </LabCard>
        )}
      </div>

      {/* Material Composition */}
      <LabCard
        title="Material composition"
        subtitle={`${formData.bomDetails.length} material${
          formData.bomDetails.length !== 1 ? "s" : ""
        } · ${totalPercentage.toFixed(1)}% total`}
        icon={BarChart3}
        actions={
          formData.bomDetails.length > 0 ? (
            <button
              type="button"
              onClick={copyAllData}
              className={`inline-flex h-8 items-center gap-1.5 rounded-lg border px-3 text-xs font-medium transition-colors ${
                copiedAll
                  ? `border-transparent ${CHIP.ok}`
                  : "border-primary/30 bg-background text-primary hover:bg-primary/10"
              }`}
              title="Copy all table data"
            >
              {copiedAll ? (
                <>
                  <CheckCheck className="h-3.5 w-3.5" />
                  Copied!
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Copy All
                </>
              )}
            </button>
          ) : null
        }
        className="flex min-h-0 flex-1 flex-col"
        bodyClassName="flex min-h-0 flex-1 flex-col"
      >
        {formData.bomDetails.length > 0 ? (
          <>
            {/* Desktop / tablet: table. Scrolls sideways rather than
                squashing the description column. */}
            <div className="hidden min-h-0 flex-1 overflow-auto md:block">
              <table className="w-full min-w-[720px] text-sm">
                <thead>
                  <tr>
                    <th scope="col" className={`${TH} w-24 select-text`}>
                      Material ID
                    </th>
                    <th scope="col" className={`${TH} w-32 select-text`}>
                      Code
                    </th>
                    <th scope="col" className={`${TH} select-text`}>
                      Description
                    </th>
                    <th scope="col" className={`${TH} w-36 select-text`}>
                      Category
                    </th>
                    <th scope="col" className={`${TH} w-32 text-right select-text`}>
                      Percentage
                    </th>
                    <th scope="col" className={`${TH} w-24 text-right`}>
                      <span className="sr-only">Actions</span>
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {formData.bomDetails.map((material, index) => {
                    const resolved = describeMaterial(material.material_id);
                    const code = material.material_code || resolved.code;
                    const desc = material.material_desc || resolved.desc;
                    const category =
                      material.material_category || resolved.category;

                    return (
                      <tr
                        key={index}
                        className="transition-colors hover:bg-primary/[0.03]"
                      >
                        <td
                          className={`${TD} ${NUM} cursor-text text-xs font-semibold text-muted-foreground`}
                          style={{ userSelect: "text" }}
                        >
                          {material.material_id}
                        </td>
                        <td className={`${TD} cursor-text`} style={{ userSelect: "text" }}>
                          <span className={CODE_CHIP}>{code || "—"}</span>
                        </td>
                        <td
                          className={`${TD} cursor-text font-medium text-foreground`}
                          style={{ userSelect: "text" }}
                        >
                          {desc || "—"}
                        </td>
                        <td
                          className={`${TD} cursor-text text-[13px] text-muted-foreground`}
                          style={{ userSelect: "text" }}
                        >
                          {category || "—"}
                        </td>
                        <td className={`${TD} py-1.5`}>
                          <div className="relative">
                            <input
                              type="number"
                              inputMode="decimal"
                              aria-label={`Percentage for ${desc || material.material_id}`}
                              value={material.material_percentage}
                              onChange={(e) =>
                                editPercentage(index, e.target.value)
                              }
                              onFocus={(e) => e.target.select()}
                              min="0"
                              max="100"
                              step="0.1"
                              disabled={isViewMode}
                              className="h-9 w-full select-text rounded-md border border-input bg-background pl-2 pr-6 text-right text-[13px] font-medium tabular-nums text-foreground outline-none transition-shadow focus:border-primary focus:ring-[3px] focus:ring-primary/15 disabled:cursor-not-allowed disabled:bg-muted/50 disabled:opacity-80"
                            />
                            <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[11px] font-medium text-muted-foreground">
                              %
                            </span>
                          </div>
                        </td>
                        <td className={`${TD} py-1.5 text-right`}>
                          <div className="flex items-center justify-end gap-0.5">
                            <button
                              type="button"
                              onClick={() => copyRowData(material, index)}
                              className={`inline-flex h-8 w-8 items-center justify-center rounded-lg transition-colors ${
                                copiedRow === index
                                  ? CHIP.ok
                                  : "text-primary/70 hover:bg-primary/10 hover:text-primary"
                              }`}
                              title="Copy row data"
                              aria-label="Copy row data"
                            >
                              {copiedRow === index ? (
                                <CheckCheck className="h-4 w-4" />
                              ) : (
                                <Copy className="h-4 w-4" />
                              )}
                            </button>
                            {!isViewMode && (
                              <button
                                type="button"
                                onClick={() => removeMaterial(index)}
                                className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-destructive/10 hover:text-destructive"
                                title="Remove material"
                                aria-label={`Remove ${desc || material.material_id}`}
                              >
                                <X className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {/* Add line: hands the cursor to the material picker above */}
                  {!isViewMode && (
                    <tr>
                      <td colSpan={6} className="px-3 py-1.5">
                        <button
                          type="button"
                          onClick={focusMaterialSelect}
                          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2 text-[13px] font-medium text-primary hover:bg-primary/10"
                        >
                          <Plus className="h-4 w-4" />
                          Add line
                          <span className="opacity-70">
                            <KeyCombo combo="Alt+M" />
                          </span>
                        </button>
                      </td>
                    </tr>
                  )}
                </tbody>
                <tfoot>
                  <tr className={TOTAL_ROW}>
                    <td colSpan={4} className={`${TD} text-right text-[13px]`}>
                      Total composition · {formData.bomDetails.length} material
                      {formData.bomDetails.length !== 1 ? "s" : ""}
                    </td>
                    <td className={`${TD} ${NUM} text-base text-primary`}>
                      {totalPercentage.toFixed(1)}%
                    </td>
                    <td className={`${TD} text-right`}>
                      <Chip tone={totalComplete ? "ok" : "warn"}>
                        {totalComplete ? "Complete" : "In progress"}
                      </Chip>
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>

            {/* Mobile: stacked cards with large tap targets */}
            <div className="space-y-2 p-3 md:hidden">
              {formData.bomDetails.map((material, index) => {
                const resolved = describeMaterial(material.material_id);
                const code = material.material_code || resolved.code;
                const desc = material.material_desc || resolved.desc;
                const category =
                  material.material_category || resolved.category;

                return (
                  <div
                    key={index}
                    className="space-y-3 rounded-xl border border-border bg-background p-3"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={CODE_CHIP}>{code || "—"}</span>
                          <span className="text-xs font-semibold tabular-nums text-muted-foreground">
                            #{material.material_id}
                          </span>
                        </div>
                        <p className="mt-1 break-words text-sm font-medium text-foreground">
                          {desc || "—"}
                        </p>
                        {category && (
                          <p className="text-xs text-muted-foreground">
                            {category}
                          </p>
                        )}
                      </div>

                      <div className="flex flex-shrink-0 items-center gap-1">
                        <button
                          type="button"
                          onClick={() => copyRowData(material, index)}
                          className={`inline-flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
                            copiedRow === index
                              ? CHIP.ok
                              : "text-primary hover:bg-primary/10"
                          }`}
                          aria-label="Copy row data"
                        >
                          {copiedRow === index ? (
                            <CheckCheck className="h-[18px] w-[18px]" />
                          ) : (
                            <Copy className="h-[18px] w-[18px]" />
                          )}
                        </button>
                        {!isViewMode && (
                          <button
                            type="button"
                            onClick={() => removeMaterial(index)}
                            className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-destructive transition-colors hover:bg-destructive/10"
                            aria-label={`Remove ${desc || material.material_id}`}
                          >
                            <X className="h-[18px] w-[18px]" />
                          </button>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      <label className="flex-shrink-0 text-xs font-medium text-muted-foreground">
                        Percentage
                      </label>
                      <div className="relative flex-1">
                        <input
                          type="number"
                          inputMode="decimal"
                          aria-label={`Percentage for ${desc || material.material_id}`}
                          value={material.material_percentage}
                          onChange={(e) => editPercentage(index, e.target.value)}
                          onFocus={(e) => e.target.select()}
                          min="0"
                          max="100"
                          step="0.1"
                          disabled={isViewMode}
                          className="h-11 w-full rounded-lg border border-input bg-background pl-3 pr-8 text-right text-sm font-medium tabular-nums text-foreground outline-none transition-shadow focus:border-primary focus:ring-[3px] focus:ring-primary/15 disabled:bg-muted/50 disabled:opacity-80"
                        />
                        <span className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 text-xs font-medium text-muted-foreground">
                          %
                        </span>
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Total, as a shaded card */}
              <div className="flex items-center justify-between gap-3 rounded-xl border-2 border-primary/30 bg-muted/50 px-3 py-2.5">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-foreground">
                    Total composition
                  </p>
                  <p className="text-[11.5px] text-muted-foreground">
                    {formData.bomDetails.length} material
                    {formData.bomDetails.length !== 1 ? "s" : ""} configured
                  </p>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-lg font-bold tabular-nums text-primary">
                    {totalPercentage.toFixed(1)}%
                  </span>
                  <Chip tone={totalComplete ? "ok" : "warn"}>
                    {totalComplete ? "Complete" : "In progress"}
                  </Chip>
                </div>
              </div>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center gap-2 px-4 py-10 text-center">
            <span className="flex h-11 w-11 items-center justify-center rounded-full bg-primary/10">
              <Package className="h-5 w-5 text-primary" />
            </span>
            <p className="font-semibold text-foreground">
              No materials {isViewMode ? "found" : "added yet"}
            </p>
            <p className="max-w-xs text-sm text-muted-foreground">
              {isViewMode
                ? "This BOM does not contain any materials."
                : "Pick a material and its percentage above to build the bill of materials."}
            </p>
          </div>
        )}
      </LabCard>
    </div>
  );
};

export default BOMForm;
