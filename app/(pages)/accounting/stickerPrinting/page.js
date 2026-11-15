"use client";
// Printing → Sticker Printing. Prints a batch's details onto the pre-printed
// A4 production sticker. Left: one card per sticker (batch, ITCD, weights,
// packing, colour). Right: a live preview of the selected sticker, laid out
// like the print block at the bottom of this file. Print prints one sticker.
import React, { useState, useRef, useEffect } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import axios from "axios";
import Select from "react-select";
import { Printer, Plus, Trash2, FileText, Tag, Eye, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { selectStyles } from "@/components/shared/EntityFormPanel";
import { CODE_CHIP, LabHeader } from "@/components/Material/shared/LabUI";
import { cn } from "@/lib/utils";

// react-select on theme tokens (works in dark mode too).
const pickerStyles = (hasError) => {
  const s = selectStyles(hasError);
  return {
    ...s,
    control: (base, state) => ({ ...s.control(base, state), backgroundColor: "hsl(var(--background))" }),
    singleValue: (base) => ({ ...base, color: "hsl(var(--foreground))" }),
    input: (base) => ({ ...base, color: "hsl(var(--foreground))" }),
  };
};

const NATIVE_SELECT =
  "flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring";

// Screen preview of the sheet. Positions (mm on a 297 × 210 mm page) mirror
// the print block below — keep the two in step. Labels are preview-only (they
// are already on the pre-printed stationery).
const PREVIEW_FIELDS = [
  { key: "name", label: "Product", style: { left: "15mm", top: "35mm", width: "80mm", maxHeight: "35mm", fontSize: "22pt", textAlign: "left", whiteSpace: "normal", wordWrap: "break-word", overflow: "hidden", lineHeight: "1.2" } },
  { key: "code", label: "Code", style: { left: "15mm", top: "80mm", width: "80mm", fontSize: "22pt", textAlign: "left" } },
  { key: "batch", label: "Batch no.", style: { left: "95mm", top: "70mm", width: "50mm", fontSize: "13pt", textAlign: "center" } },
  { key: "net", label: "Net wt", style: { left: "132mm", top: "70mm", width: "50mm", fontSize: "13pt", textAlign: "center" } },
  { key: "prod", label: "Date of prod.", style: { left: "95mm", top: "87mm", width: "50mm", fontSize: "13pt", textAlign: "center" } },
  { key: "useBy", label: "Use before", style: { left: "135mm", top: "88mm", width: "50mm", fontSize: "13pt", textAlign: "center" } },
  { key: "gross", label: "Gross wt", style: { left: "94mm", top: "125mm", width: "50mm", fontSize: "13pt", textAlign: "center" } },
  { key: "tare", label: "Tare wt", style: { left: "132mm", top: "125mm", width: "50mm", fontSize: "13pt", textAlign: "center" } },
];
const SHEET_W_MM = 297;
const MM_TO_PX = 96 / 25.4;

/** The selected sticker on a scaled 297 × 210 mm sheet. */
function StickerPreview({ values, colorLeftMm, colors }) {
  const boxRef = useRef(null);
  const [scale, setScale] = useState(0.4);

  useEffect(() => {
    const el = boxRef.current;
    if (!el || typeof ResizeObserver === "undefined") return;
    const ro = new ResizeObserver(([entry]) => {
      setScale(entry.contentRect.width / (SHEET_W_MM * MM_TO_PX));
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  return (
    <div ref={boxRef} className="relative w-full overflow-hidden rounded-sm shadow-md ring-1 ring-border" style={{ aspectRatio: "297 / 210", backgroundColor: "#fff" }}>
      <div
        style={{
          width: "297mm",
          height: "210mm",
          position: "absolute",
          left: 0,
          top: 0,
          transform: `scale(${scale})`,
          transformOrigin: "top left",
          fontFamily: "Arial, sans-serif",
          color: "#000",
        }}
      >
        {PREVIEW_FIELDS.map((f) => (
          <div key={f.key} style={{ position: "absolute", fontWeight: "bold", ...f.style }}>
            <span
              style={{
                position: "absolute",
                top: "-5mm",
                left: 0,
                right: 0,
                fontSize: "8pt",
                fontWeight: "normal",
                color: "rgba(0,0,0,0.4)",
                textTransform: "uppercase",
                letterSpacing: "0.05em",
              }}
            >
              {f.label}
            </span>
            {values[f.key] || " "}
          </div>
        ))}
        {/* Colour scale on the stationery, with the printed arrow under the picked colour */}
        {colors.map((c) => (
          <div
            key={c.name}
            style={{
              position: "absolute",
              left: `${c.left + 4}mm`,
              top: "152mm",
              transform: "translateX(-50%)",
              fontSize: "7pt",
              color: c.picked ? "#000" : "rgba(0,0,0,0.35)",
              fontWeight: c.picked ? "bold" : "normal",
            }}
          >
            {c.name}
          </div>
        ))}
        <div
          style={{
            position: "absolute",
            left: `${colorLeftMm}mm`,
            top: "159mm",
            fontSize: "50pt",
            fontWeight: "bold",
            textAlign: "center",
          }}
        >
          🠭
        </div>
      </div>
    </div>
  );
}

function Field({ label, htmlFor, className, children }) {
  return (
    <div className={cn("min-w-0 space-y-1.5", className)}>
      <Label htmlFor={htmlFor} className="text-[12.5px]">
        {label}
      </Label>
      {children}
    </div>
  );
}

const StickerPrintingPage = () => {
  const [searchTerm, setSearchTerm] = useState("");
  const [printingStickerId, setPrintingStickerId] = useState(null);
  // The sticker shown in the preview (the one last clicked / focused).
  const [activeId, setActiveId] = useState(1);
  const debounceTimersRef = useRef({});
  const [stickers, setStickers] = useState([
    {
      id: 1,
      selectedBatch: null,
      batchNo: "",
      itcd:"",
      productCode: "",
      productName: "",
      netWeight: "",
      dateOfProd: "",
      useBeforeDate: "",
      grossWeight: "",
      tareWeight: "",
      packing: "DRUM",
      color: "WHITE",
    },
  ]);

  const queryClient = useQueryClient();

  // ✅ Codes are hardcoded — only labels come from API
  const packingCodes = {
    DRUM: "1510",
    CAN: "1710",
    BUCKET: "2220",
    IBC: "6150",
  };

  const colorOptions = [
    "WHITE",
    "SILVER",
    "GOLD",
    "BROWN",
    "YELLOW",
    "ORANGE",
    "MAGENTA",
    "PURPLE",
    "VIOLET",
    "BLUE",
    "CYAN",
    "GREEN",
    "BLACK",
  ];

  // Fetch batches
  const { data: batchOptions = [], isLoading: batchesLoading } = useQuery({
    queryKey: ["batches", searchTerm],
    queryFn: async () => {
      const response = await axios.get("/api/manufacturing/production", {
        params: { search: searchTerm, limit: 10, onlyWithBatch: true },
      });
      const batches = response.data.data || [];
      return batches.map((batch) => ({
        value: batch.id,
        label: batch.batch_no,
        data: batch,
      }));
    },
    staleTime: 1000 * 60 * 5,
  });


  const { data: packingMaterialsRaw = [] } = useQuery({
    queryKey: ["packingMaterials"],
    queryFn: async () => {
      const response = await axios.get("/api/setup/all-packing-materials");
      return response.data?.data || response.data || [];
    },
    staleTime: 1000 * 60 * 10,
  });

  const packingOptions = Object.entries(packingCodes).map(([key, code]) => {
    const apiMatch = packingMaterialsRaw.find(
      (m) => m.item?.toUpperCase() === key,
    );
    return {
      value: key,
      label: apiMatch ? apiMatch.item : key, // API name if found, else fallback to key
      code: code,
    };
  });

  const fetchProductionData = async (batchId) => {
    if (!batchId) return null;
    try {
      const response = await axios.get(
        `/api/manufacturing/production?id=${batchId}`,
      );
      return response.data.data?.[0] || null;
    } catch (error) {
      console.error("Error fetching production data:", error);
      return null;
    }
  };

  const fetchItemCode = async (finishedId) => {
    if (!finishedId) return { itcd: finishedId, code: finishedId };
    try {
      const itemResponse = await axios.get(
        `/api/forms/products?search=${finishedId}&includeAll=true&limit=1`,
      );
      if (itemResponse.data.data && itemResponse.data.data.length > 0) {
        const product = itemResponse.data.data[0];
        return {
          itcd: product.itcd || finishedId,
          code: product.code || finishedId,
        };
      }
    } catch (err) {
      console.error("Failed to fetch item code", err);
    }
    return { itcd: finishedId, code: finishedId };
  };

  // Fetch product info from itcd (when user manually enters it) - with debounce
  const fetchProductCodeAndName = async (itcd, stickerId) => {
    // Clear previous timer for this sticker
    if (debounceTimersRef.current[stickerId]) {
      clearTimeout(debounceTimersRef.current[stickerId]);
    }

    if (!itcd || itcd.trim() === "") {
      setStickers((prevStickers) =>
        prevStickers.map((sticker) => {
          if (sticker.id === stickerId) {
            return { ...sticker, itcd: "", productCode: "", productName: "" };
          }
          return sticker;
        }),
      );
      return;
    }

    // Set debounce timer (300ms delay)
    debounceTimersRef.current[stickerId] = setTimeout(async () => {
      // Update sticker with loading state
      setStickers((prevStickers) =>
        prevStickers.map((sticker) => {
          if (sticker.id === stickerId) {
            return { ...sticker, itcd: itcd, productCode: "Loading...", productName: "Loading..." };
          }
          return sticker;
        }),
      );

      try {
        // Fetch from /api/forms/products
        const productResponse = await axios.get("/api/forms/products", {
          params: { search: itcd, includeAll: true, limit: 1 },
        });

        if (!productResponse.data.data || productResponse.data.data.length === 0) {
          setStickers((prevStickers) =>
            prevStickers.map((sticker) => {
              if (sticker.id === stickerId) {
                return { ...sticker, itcd: itcd, productCode: "Not found", productName: "Not found" };
              }
              return sticker;
            }),
          );
          return;
        }

        const product = productResponse.data.data[0];
        setStickers((prevStickers) =>
          prevStickers.map((sticker) => {
            if (sticker.id === stickerId) {
              return {
                ...sticker,
                itcd: product.itcd || itcd,
                productCode: product.code || itcd,
                productName: product.item || product.code || itcd,
              };
            }
            return sticker;
          }),
        );
      } catch (error) {
        console.error("Error fetching product:", error);
        setStickers((prevStickers) =>
          prevStickers.map((sticker) => {
            if (sticker.id === stickerId) {
              return { ...sticker, itcd: itcd, productCode: "Error", productName: "Error loading" };
            }
            return sticker;
          }),
        );
      }
    }, 300); // 2 second debounce delay
  };

  const handleBatchSelect = async (selectedOption, stickerId) => {
    setStickers((prevStickers) =>
      prevStickers.map((sticker) => {
        if (sticker.id === stickerId) {
          return {
            ...sticker,
            selectedBatch: selectedOption,
            batchNo: selectedOption?.label || "",
            itcd: "",
            productCode: "",
            productName: "Loading...",
          };
        }
        return sticker;
      }),
    );

    if (selectedOption?.value) {
      try {
        const productionData = await fetchProductionData(selectedOption.value);

        if (productionData) {
          const itemInfo = await fetchItemCode(productionData.finished_id);

          let useBeforeDate = "";
          if (productionData.dated) {
            const prodDate = new Date(productionData.dated);
            const oneYearLater = new Date(prodDate);
            oneYearLater.setFullYear(oneYearLater.getFullYear() + 1);
            oneYearLater.setDate(oneYearLater.getDate() - 1);
            useBeforeDate = oneYearLater.toISOString().split("T")[0];
          }

          setStickers((prevStickers) =>
            prevStickers.map((sticker) => {
              if (sticker.id === stickerId) {
                return {
                  ...sticker,
                  batchNo: productionData.batch_no || "",
                  itcd: itemInfo.itcd,
                  productCode: itemInfo.code,
                  productName: productionData.productName || "",
                  dateOfProd: productionData.dated?.split("T")[0] || "",
                  useBeforeDate: useBeforeDate,
                  netWeight: "",
                  grossWeight: "",
                  tareWeight: "",
                };
              }
              return sticker;
            }),
          );
        }
      } catch (error) {
        console.error("Error loading batch data:", error);
        setStickers((prevStickers) =>
          prevStickers.map((sticker) => {
            if (sticker.id === stickerId) {
              return { ...sticker, productName: "Error loading product" };
            }
            return sticker;
          }),
        );
      }
    }
  };

  const addSticker = () => {
    // Next free id (length + 1 could repeat an id after a sticker was removed).
    const newId = Math.max(0, ...stickers.map((s) => s.id)) + 1;
    const newSticker = {
      id: newId,
      selectedBatch: null,
      batchNo: "",
      itcd: "",
      productCode: "",
      productName: "",
      netWeight: "",
      dateOfProd: "",
      useBeforeDate: "",
      grossWeight: "",
      tareWeight: "",
      packing: "DRUM",
      color: "WHITE",
    };
    setStickers([...stickers, newSticker]);
    setActiveId(newId);
  };

  const removeSticker = (id) => {
    if (stickers.length > 1) {
      const rest = stickers.filter((s) => s.id !== id);
      setStickers(rest);
      if (id === activeId) setActiveId(rest[0].id);
    }
  };

  const updateSticker = (id, field, value) => {
    setStickers(
      stickers.map((s) => {
        if (s.id === id) {
          const updated = { ...s, [field]: value };
          if (field === "grossWeight" || field === "netWeight") {
            const gross =
              parseFloat(field === "grossWeight" ? value : s.grossWeight) || 0;
            const net =
              parseFloat(field === "netWeight" ? value : s.netWeight) || 0;
            updated.tareWeight = gross && net ? (gross - net).toFixed(1) : "";
          }
          return updated;
        }
        return s;
      }),
    );
  };

  const handlePrint = (stickerId) => {
    setPrintingStickerId(stickerId);
    setTimeout(() => {
      window.print();
      setPrintingStickerId(null);
    }, 100);
  };

  const formatDate = (dateString) => {
    if (!dateString) return "";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-GB");
  };

  const getColorValue = (color) => {
    switch (color.toUpperCase()) {
      case "WHITE":
        return 104;
      case "SILVER":
        return 121;
      case "GOLD":
        return 136;
      case "BROWN":
        return 146;
      case "YELLOW":
        return 163;
      case "ORANGE":
        return 176;
      case "MAGENTA":
        return 191;
      case "PURPLE":
        return 205;
      case "VIOLET":
        return 220;
      case "BLUE":
        return 232;
      case "CYAN":
        return 247;
      case "GREEN":
        return 261;
      case "BLACK":
        return 275;
      default:
        return 109;
    }
  };

  const getProductCodeWithPacking = (baseCode, packing) => {
    const packingInfo = packingOptions.find((p) => p.value === packing);
    return packingInfo ? `${baseCode}.${packingInfo.code}` : baseCode;
  };

  const activeSticker = stickers.find((s) => s.id === activeId) || stickers[0];
  const activeIndex = stickers.indexOf(activeSticker);
  const tareLabel = (sticker) =>
    Number.isInteger(+sticker.tareWeight)
      ? `${+sticker.tareWeight}`
      : (+sticker.tareWeight).toFixed(1);
  const previewValues = activeSticker
    ? {
        name: activeSticker.productName,
        code: getProductCodeWithPacking(activeSticker.productCode, activeSticker.packing),
        batch: activeSticker.batchNo,
        net: `${activeSticker.netWeight} KG`,
        prod: formatDate(activeSticker.dateOfProd),
        useBy: formatDate(activeSticker.useBeforeDate),
        gross: `${activeSticker.grossWeight} KG`,
        tare: `${tareLabel(activeSticker)} KG`,
      }
    : {};

  return (
    <div className="min-h-screen bg-muted/40">
      {/* Screen - No Print */}
      <div className="print:hidden mx-auto max-w-[1600px] px-3 py-5 sm:px-6">
        <LabHeader
          icon={Tag}
          breadcrumb="Printing"
          title="Sticker Printing"
          subtitle="Production stickers on the pre-printed A4 sheet"
          badge={`${stickers.length} ${stickers.length === 1 ? "sticker" : "stickers"}`}
          className="mb-4"
        />

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_minmax(380px,520px)]">
          {/* Left - one card per sticker */}
          <div className="min-w-0 space-y-3">
            {stickers.map((sticker, index) => {
              const isActive = sticker.id === activeSticker?.id;
              return (
                <section
                  key={sticker.id}
                  onFocusCapture={() => setActiveId(sticker.id)}
                  onClick={() => setActiveId(sticker.id)}
                  className={cn(
                    "overflow-clip rounded-xl border bg-background transition-shadow",
                    isActive ? "border-primary/50 ring-2 ring-primary/15" : "border-border",
                  )}
                >
                  <div className="flex flex-wrap items-center gap-2 border-b border-primary/15 bg-primary/5 px-4 py-2.5">
                    <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-[13px] font-semibold text-primary">
                      {index + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <h2 className="truncate text-sm font-semibold text-primary">
                        {sticker.productName && !/^(Loading\.\.\.|Not found|Error)/.test(sticker.productName)
                          ? sticker.productName
                          : `Sticker ${index + 1}`}
                      </h2>
                      <p className="truncate text-xs text-muted-foreground">
                        {sticker.batchNo ? `Batch ${sticker.batchNo}` : "No batch selected"}
                        {sticker.productCode && !/^(Loading\.\.\.|Not found|Error)$/.test(sticker.productCode) && (
                          <>
                            {" · "}
                            <span className={CODE_CHIP}>{getProductCodeWithPacking(sticker.productCode, sticker.packing)}</span>
                          </>
                        )}
                      </p>
                    </div>
                    <div className="flex items-center gap-1.5">
                      {stickers.length > 1 && (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          className="h-8 w-8 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                          onClick={(e) => {
                            e.stopPropagation();
                            removeSticker(sticker.id);
                          }}
                          aria-label={`Remove sticker ${index + 1}`}
                          title="Remove sticker"
                        >
                          <Trash2 className="h-4 w-4" />
                        </Button>
                      )}
                      <Button type="button" size="sm" onClick={() => handlePrint(sticker.id)}>
                        <Printer className="mr-1.5 h-4 w-4" />
                        Print Sticker
                      </Button>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3 p-4 sm:grid-cols-4 lg:grid-cols-6">
                    {/* Batch Selector */}
                    <Field label="Batch Selection" className="col-span-2">
                      <Select
                        options={batchOptions}
                        value={sticker.selectedBatch}
                        onChange={(option) =>
                          handleBatchSelect(option, sticker.id)
                        }
                        onInputChange={(inputValue) => {
                          if (inputValue.length >= 2 || inputValue.length === 0) {
                            setSearchTerm(inputValue);
                          }
                        }}
                        isClearable
                        placeholder="Select batch..."
                        isLoading={batchesLoading}
                        noOptionsMessage={() => "No batches found"}
                        menuPortalTarget={
                          typeof window !== "undefined" ? document.body : null
                        }
                        menuPosition="fixed"
                        styles={pickerStyles(false)}
                      />
                    </Field>

                    {/* ITCD (User Input) - API call only on Enter key */}
                    <Field label="ITCD (Item ID)" htmlFor={`itcd-${sticker.id}`} className="col-span-2">
                      <Input
                        id={`itcd-${sticker.id}`}
                        type="text"
                        placeholder="Enter ITCD, then press Enter..."
                        value={sticker.itcd}
                        onChange={(e) => {
                          // Just update UI, no API call
                          setStickers((prevStickers) =>
                            prevStickers.map((s) =>
                              s.id === sticker.id ? { ...s, itcd: e.target.value } : s
                            ),
                          );
                        }}
                        onKeyDown={(e) => {
                          // Only call API when Enter is pressed
                          if (e.key === "Enter") {
                            fetchProductCodeAndName(e.target.value, sticker.id);
                          }
                        }}
                        className="h-10"
                      />
                    </Field>

                    {/* Product Name (Auto-fetched) */}
                    <Field label="Product Name" className="col-span-2">
                      <Input
                        type="text"
                        value={sticker.productName}
                        disabled
                        className={cn(
                          "h-10 bg-muted/50 disabled:cursor-default disabled:opacity-100",
                          /^(Not found|Error)/.test(sticker.productName) && "text-destructive",
                        )}
                      />
                    </Field>

                    <Field label="Gross Wt (KG)" htmlFor={`gross-${sticker.id}`}>
                      <Input
                        id={`gross-${sticker.id}`}
                        type="number"
                        step="0.01"
                        inputMode="decimal"
                        value={sticker.grossWeight}
                        onChange={(e) =>
                          updateSticker(sticker.id, "grossWeight", e.target.value)
                        }
                        className="h-10 tabular-nums"
                      />
                    </Field>

                    <Field label="Net Wt (KG)" htmlFor={`net-${sticker.id}`}>
                      <Input
                        id={`net-${sticker.id}`}
                        type="number"
                        step="0.01"
                        inputMode="decimal"
                        value={sticker.netWeight}
                        onChange={(e) =>
                          updateSticker(sticker.id, "netWeight", e.target.value)
                        }
                        className="h-10 tabular-nums"
                      />
                    </Field>

                    {/* Tare = Gross − Net (worked out, read-only) */}
                    <Field label="Tare Wt (KG)">
                      <div className="flex h-10 items-center gap-1.5 rounded-md border border-dashed border-border bg-muted/40 px-3 text-sm tabular-nums text-foreground" title="Gross − Net">
                        <Scale className="h-3.5 w-3.5 text-muted-foreground" />
                        {sticker.tareWeight || "—"}
                      </div>
                    </Field>

                    {/* Packing dropdown — labels from API, codes hardcoded */}
                    <Field label="Packing" htmlFor={`packing-${sticker.id}`}>
                      <select
                        id={`packing-${sticker.id}`}
                        value={sticker.packing}
                        onChange={(e) =>
                          updateSticker(sticker.id, "packing", e.target.value)
                        }
                        className={NATIVE_SELECT}
                      >
                        {packingOptions.map((opt) => (
                          <option key={opt.value} value={opt.value}>
                            {opt.label}
                          </option>
                        ))}
                      </select>
                    </Field>

                    <Field label="Color" htmlFor={`color-${sticker.id}`} className="col-span-2 sm:col-span-2">
                      <select
                        id={`color-${sticker.id}`}
                        value={sticker.color}
                        onChange={(e) =>
                          updateSticker(sticker.id, "color", e.target.value)
                        }
                        className={NATIVE_SELECT}
                      >
                        {colorOptions.map((opt) => (
                          <option key={opt} value={opt}>
                            {opt}
                          </option>
                        ))}
                      </select>
                    </Field>
                  </div>
                </section>
              );
            })}
          </div>

          {/* Right - live preview of the selected sticker */}
          <div className="min-w-0">
            <section className="overflow-clip rounded-xl border border-border bg-background xl:sticky xl:top-4">
              <div className="flex flex-wrap items-center gap-2 border-b border-primary/15 bg-primary/5 px-4 py-3">
                <Eye className="h-4 w-4 flex-shrink-0 text-primary" />
                <div className="min-w-0 flex-1">
                  <h2 className="text-[15px] font-semibold text-primary">Preview</h2>
                  <p className="text-xs text-muted-foreground">
                    Sticker {activeIndex + 1} · 297 × 210 mm, values only — the rest is pre-printed
                  </p>
                </div>
              </div>
              <div className="bg-muted/50 p-3 sm:p-4">
                {activeSticker && (
                  <StickerPreview
                    values={previewValues}
                    colorLeftMm={getColorValue(activeSticker.color)}
                    colors={colorOptions.map((c) => ({
                      name: c,
                      left: getColorValue(c),
                      picked: c === activeSticker.color.toUpperCase(),
                    }))}
                  />
                )}
                <p className="mt-2 text-center text-[11.5px] text-muted-foreground">
                  Click a sticker on the left to preview it.
                </p>
              </div>
            </section>
          </div>
        </div>

        {/* Action bar */}
        <div className="sticky bottom-0 z-10 -mx-3 mt-4 border-t border-border bg-background/95 px-3 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6">
          <div className="flex flex-wrap items-center gap-2 max-sm:[&>button]:flex-1">
            <Button variant="outline" onClick={addSticker}>
              <Plus className="mr-2 h-4 w-4" />
              Add New Sticker
            </Button>
            <Button
              variant="outline"
              onClick={() => {
                setStickers([
                  {
                    id: 1,
                    selectedBatch: null,
                    batchNo: "",
                    itcd: "",
                    productCode: "",
                    productName: "",
                    netWeight: "",
                    dateOfProd: "",
                    useBeforeDate: "",
                    grossWeight: "",
                    tareWeight: "",
                    packing: "DRUM",
                    color: "WHITE",
                  },
                ]);
                setActiveId(1);
              }}
            >
              <Trash2 className="mr-2 h-4 w-4" />
              Reset All
            </Button>
            {activeSticker && (
              <Button className="sm:ml-auto" onClick={() => handlePrint(activeSticker.id)}>
                <Printer className="mr-2 h-4 w-4" />
                Print Sticker {activeIndex + 1}
              </Button>
            )}
          </div>
        </div>
      </div>

      {/* Print Content - LANDSCAPE A4 */}
      <div className="print:block hidden">
        {stickers
          .filter((s) => s.id === printingStickerId)
          .map((sticker, index) => (
            <div
              key={sticker.id}
              className="page-break"
              style={{
                width: "297mm",
                height: "210mm",
                backgroundColor: "transparent",
                pageBreakAfter: "auto",
                fontFamily: "Arial, sans-serif",
                position: "relative",
                overflow: "hidden",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  left: "15mm",
                  top: "35mm",
                  width: "80mm",
                  maxHeight: "35mm",
                  fontSize: "22pt",
                  fontWeight: "bold",
                  textAlign: "left",
                  whiteSpace: "normal",
                  wordWrap: "break-word",
                  overflow: "hidden",
                  lineHeight: "1.2",
                }}
              >
                {sticker.productName}
              </div>
              <div
                style={{
                  position: "absolute",
                  left: "15mm",
                  top: "80mm",
                  width: "80mm",
                  fontSize: "22pt",
                  fontWeight: "bold",
                  textAlign: "left",
                }}
              >
                {getProductCodeWithPacking(
                  sticker.productCode,
                  sticker.packing,
                )}
              </div>
              <div
                style={{
                  position: "absolute",
                  left: "95mm",
                  top: "70mm",
                  width: "50mm",
                  fontSize: "13pt",
                  fontWeight: "bold",
                  textAlign: "center",
                }}
              >
                {sticker.batchNo}
              </div>
              <div
                style={{
                  position: "absolute",
                  left: "132mm",
                  top: "70mm",
                  width: "50mm",
                  fontSize: "13pt",
                  fontWeight: "bold",
                  textAlign: "center",
                }}
              >
                {sticker.netWeight} KG
              </div>
              <div
                style={{
                  position: "absolute",
                  left: "95mm",
                  top: "87mm",
                  width: "50mm",
                  fontSize: "13pt",
                  fontWeight: "bold",
                  textAlign: "center",
                }}
              >
                {formatDate(sticker.dateOfProd)}
              </div>
              <div
                style={{
                  position: "absolute",
                  left: "135mm",
                  top: "88mm",
                  width: "50mm",
                  fontSize: "13pt",
                  fontWeight: "bold",
                  textAlign: "center",
                }}
              >
                {formatDate(sticker.useBeforeDate)}
              </div>
              <div
                style={{
                  position: "absolute",
                  left: "94mm",
                  top: "125mm",
                  width: "50mm",
                  fontSize: "13pt",
                  fontWeight: "bold",
                  textAlign: "center",
                }}
              >
                {sticker.grossWeight} KG
              </div>
              <div
                style={{
                  position: "absolute",
                  left: "132mm",
                  top: "125mm",
                  width: "50mm",
                  fontSize: "13pt",
                  fontWeight: "bold",
                  textAlign: "center",
                }}
              >
              {
  Number.isInteger(+sticker.tareWeight)
    ? `${+sticker.tareWeight}`
    : (+sticker.tareWeight).toFixed(1)
  } KG
              </div>
              <div
                style={{
                  position: "absolute",
                  left: `${getColorValue(sticker.color)}mm`,
                  top: "159mm",
                  fontSize: "50pt",
                  fontWeight: "bold",
                  textAlign: "center",
                }}
              >
                🠭
              </div>
            </div>
          ))}
      </div>

      <style jsx>{`
        @media print {
          @page {
            size: A4 portrait;
            margin: 0;
          }
          body {
            margin: 0;
            padding: 0;
          }
          .page-break {
            page-break-after: always;
          }
          .print\\:hidden {
            display: none !important;
          }
          .print\\:block {
            display: block !important;
          }
        }
      `}</style>

    </div>
  );
};

export default StickerPrintingPage;
