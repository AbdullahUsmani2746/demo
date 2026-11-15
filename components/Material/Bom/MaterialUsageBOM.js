"use client";
// Lab → Material Usage BOM: turns every BOM inside out — for each material,
// which products use it and at what share. Read-only; Excel / print export.
import React, { useState, useEffect, useMemo, useRef } from "react";
import { useMaterialUsageData } from "@/hooks/useMaterialUsageData";
import {
  Package,
  Search,
  BarChart3,
  Table,
  FileSpreadsheet,
  FileDown,
  Layers,
  Box,
  RefreshCw,
  X,
  ChevronDown,
  ChevronUp,
  Rows3,
  Rows4,
} from "lucide-react";
import Select from "react-select";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { selectStyles } from "@/components/shared/EntityFormPanel";
import {
  LabHeader,
  LabCard,
  LabStat,
  LabEmpty,
  Chip,
  CODE_CHIP,
  TH,
  TD,
  NUM,
  TOTAL_ROW,
} from "@/components/Material/shared/LabUI";

// Category → chip tone (same mapping as Grand Master BOM).
const CATEGORY_TONE = {
  Finished: "ok",
  "Semi Finished": "warn",
  "Raw Material": "brand",
  "Packaging Material": "muted",
};

const CATEGORY_FILTERS = ["Raw Material", "Semi Finished", "Finished", "Packaging Material"];

const INPUT =
  "h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15";

const MaterialUsageBOM = () => {
  const {
    bomItems,
    items: finishItems,
    loading,
    refetch,
    bomLoading,
    itemsLoading,
  } = useMaterialUsageData();

  const [selectedMaterial, setSelectedMaterial] = useState(null);
  const [viewMode, setViewMode] = useState("table");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [dense, setDense] = useState(false);
  const [expanded, setExpanded] = useState(() => new Set()); // materials showing every product
  const searchRef = useRef(null);

  // "/" focuses the search (Ctrl+K is the header's menu search).
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // Category mapping based on your data
  const CATEGORY_MAP = {
    1: "Finished",
    2: "Semi Finished",
    3: "Raw Material",
    4: "Packaging Material",
  };

  const getCategoryName = (categoryId) => {
    return CATEGORY_MAP[categoryId] || "Unknown";
  };

  // Calculate material usage - which products use each material
  const materialUsage = useMemo(() => {
    if (!bomItems || !finishItems || bomItems.length === 0) {
      return [];
    }

    const usageMap = new Map();

    // Process all BOMs to find where each material is used
    bomItems.forEach((bom) => {
      // Find product in finishItems
      const product = finishItems.find((f) => {
        const productId =
          bom.finished_id || bom.finishedId || bom.finished_product_id;
        return (
          f.itcd === productId ||
          f.item_code === productId ||
          f.id === productId
        );
      });

      // Get BOM details - handle different property names
      const bomDetails =
        bom.bomDetails ||
        bom.bom_details ||
        bom.materials ||
        bom.components ||
        [];

      if (bomDetails.length > 0 && Array.isArray(bomDetails)) {
        bomDetails.forEach((detail) => {
          // Get material ID from various possible property names
          const materialId =
            detail.material_id ||
            detail.materialId ||
            detail.component_id ||
            detail.item_id ||
            detail.id;

          if (!materialId) {
            console.warn("Skipping material with no ID:", detail);
            return;
          }

          // Find material in finishItems
          const material = finishItems.find((f) => {
            return (
              f.itcd === materialId ||
              f.item_code === materialId ||
              f.id === materialId
            );
          });

          // Get percentage from various possible property names
          const percentage =
            detail.material_percentage ||
            detail.percentage ||
            detail.qty_percentage ||
            detail.quantity_percentage ||
            0;

          // Initialize or update material usage data
          if (!usageMap.has(materialId)) {
            usageMap.set(materialId, {
              id: materialId,
              code:material?.code,
              name: material?.item || material?.item_name || materialId,
              category: getCategoryName(
                material?.ic_id || material?.category_id,
              ),
              usedInProducts: [],
              totalUsagePercentage: 0,
              productCount: 0,
            });
          }

          const materialData = usageMap.get(materialId);

          // Add product usage information
          materialData.usedInProducts.push({
            productId:
              bom.finished_id || bom.finishedId || bom.finished_product_id,
            productName:
              product?.item || product?.item_name || "Unknown Product",
            productCategory: getCategoryName(
              product?.ic_id || product?.category_id,
            ),
            percentage: percentage,
            quantity: percentage / 100,
          });

          materialData.totalUsagePercentage += percentage;
          materialData.productCount = materialData.usedInProducts.length;
        });
      }
    });

    const result = Array.from(usageMap.values()).map((item) => ({
      ...item,
      // Sort products by percentage (highest first)
      usedInProducts: item.usedInProducts.sort(
        (a, b) => b.percentage - a.percentage,
      ),
    }));

    return result;
  }, [bomItems, finishItems]);

  // Filter results based on search term and category
  const filteredUsage = useMemo(() => {
    let filtered = materialUsage;

    // If specific material is selected, show only that material
    if (selectedMaterial) {
      filtered = filtered.filter((item) => item.id === selectedMaterial.value);
    }

    // Apply search filter (ids are numbers — String() so the search never throws)
    if (searchTerm) {
      const q = searchTerm.toLowerCase();
      filtered = filtered.filter(
        (item) =>
          String(item.name).toLowerCase().includes(q) ||
          String(item.id).toLowerCase().includes(q) ||
          String(item.code ?? "").toLowerCase().includes(q) ||
          item.category.toLowerCase().includes(q) ||
          item.usedInProducts.some(
            (product) =>
              String(product.productName).toLowerCase().includes(q) ||
              String(product.productId).toLowerCase().includes(q),
          ),
      );
    }

    // Apply category filter
    if (filterCategory) {
      filtered = filtered.filter((item) => item.category === filterCategory);
    }

    return filtered;
  }, [materialUsage, selectedMaterial, searchTerm, filterCategory]);

  // Get all material options for the dropdown
  const materialOptions = useMemo(() => {
    return materialUsage.map((item) => ({
      value: item.id,
      label: `${item.code ?? item.id} - ${item.name} (${item.category})`,
    }));
  }, [materialUsage]);

  const exportToExcel = () => {
    if (filteredUsage.length === 0) {
      toast.error("No data available to export");
      return;
    }

    const data = [];
    filteredUsage.forEach((material) => {
      material.usedInProducts.forEach((product) => {
        data.push({
          "Material ID": material.id,
          "Material Name": material.name,
          "Material Category": material.category,
          "Product ID": product.productId,
          "Product Name": product.productName,
          "Product Category": product.productCategory,
          "Usage Percentage": `${product.percentage}%`,
          Quantity: product.quantity.toFixed(4),
        });
      });
    });

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Material Usage Analysis");

    XLSX.writeFile(
      wb,
      `Material_Usage_Analysis_${new Date().toISOString().split("T")[0]}.xlsx`,
    );
  };

  const exportToPDF = () => {
    if (filteredUsage.length === 0) {
      toast.error("No data available to export");
      return;
    }

    const printWindow = window.open("", "_blank");

    const content = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>Material Usage Analysis Report</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            .header { text-align: center; margin-bottom: 30px; border-bottom: 3px solid #3b82f6; padding-bottom: 20px; }
            .header h1 { color: #1e40af; margin: 0; }
            .header p { color: #666; margin: 5px 0; }
            .material-section { margin-bottom: 30px; border: 2px solid #e5e7eb; border-radius: 12px; padding: 20px; }
            .material-header { display: flex; justify-content: between; align-items: center; margin-bottom: 20px; }
            .material-name { font-size: 24px; font-weight: bold; color: #1e40af; }
            .material-info { color: #666; font-size: 14px; }
            .table { width: 100%; border-collapse: collapse; margin-top: 15px; }
            .table th, .table td { border: 1px solid #ddd; padding: 12px; text-align: left; }
            .table th { background-color: #f8fafc; font-weight: bold; }
            .percentage-bar { background-color: #3b82f6; height: 8px; border-radius: 4px; }
            @media print { body { padding: 10px; } }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Material Usage Analysis Report</h1>
            <p>Generated: ${new Date().toLocaleString()}</p>
          </div>

          ${filteredUsage
            .map(
              (material) => `
            <div class="material-section">
              <div class="material-header">
                <div>
                  <div class="material-name">${material.name}</div>
                  <div class="material-info">ID: ${material.id} | Category: ${
                    material.category
                  } | Used in ${material.productCount} products</div>
                </div>
              </div>

              <table class="table">
                <thead>
                  <tr>
                    <th>Product</th>
                    <th>Category</th>
                    <th>Usage Percentage</th>
                    <th>Quantity</th>
                  </tr>
                </thead>
                <tbody>
                  ${material.usedInProducts
                    .map(
                      (product) => `
                    <tr>
                      <td><strong>${product.productName}</strong><br><small>${
                        product.productId
                      }</small></td>
                      <td>${product.productCategory}</td>
                      <td>
                        <div style="display: flex; align-items: center; gap: 10px;">
                          <span>${product.percentage}%</span>
                          <div style="flex: 1; background: #e5e7eb; border-radius: 4px;">
                            <div class="percentage-bar" style="width: ${
                              product.percentage
                            }%"></div>
                          </div>
                        </div>
                      </td>
                      <td>${product.quantity.toFixed(4)}</td>
                    </tr>
                  `,
                    )
                    .join("")}
                </tbody>
              </table>
            </div>
          `,
            )
            .join("")}
        </body>
      </html>
    `;

    printWindow.document.write(content);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => {
      printWindow.print();
    }, 250);
  };

  const toggleExpanded = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  const header = (actions) => (
    <LabHeader
      icon={Layers}
      title="Material Usage BOM"
      subtitle="Which products use each material, and at what share"
      actions={actions}
    />
  );

  if (loading) {
    return (
      <div className="space-y-4">
        {header(null)}
        <div className="flex flex-wrap items-center gap-4 text-xs text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <RefreshCw className={cn("h-3.5 w-3.5", bomLoading && "animate-spin text-primary")} />
            BOM data {bomLoading ? "loading…" : "ready"}
          </span>
          <span className="flex items-center gap-1.5">
            <RefreshCw className={cn("h-3.5 w-3.5", itemsLoading && "animate-spin text-primary")} />
            Product data {itemsLoading ? "loading…" : "ready"}
          </span>
        </div>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          {[0, 1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-[74px] rounded-xl" />
          ))}
        </div>
        <Skeleton className="h-16 rounded-xl" />
        <div className="space-y-2 rounded-xl border border-border bg-background p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </div>
    );
  }

  // Check if data is empty after loading
  if (!loading && (bomItems.length === 0 || finishItems.length === 0)) {
    return (
      <div className="space-y-4">
        {header(null)}
        <LabCard>
          <LabEmpty
            icon={Package}
            title="No data available"
            hint={
              bomItems.length === 0 && finishItems.length === 0
                ? "Unable to load BOM and product data."
                : bomItems.length === 0
                  ? "No BOM data found. Please create some BOMs first."
                  : "No product data found. Please check your items setup."
            }
            action={
              <div className="mt-2 flex flex-col items-center gap-3">
                <Button onClick={() => refetch()}>
                  <RefreshCw /> Retry loading data
                </Button>
                <p className="text-xs text-muted-foreground tabular-nums">
                  BOMs: <span className="font-semibold text-foreground">{bomItems.length}</span>
                  <span className="mx-2">·</span>
                  Products: <span className="font-semibold text-foreground">{finishItems.length}</span>
                </p>
              </div>
            }
          />
        </LabCard>
      </div>
    );
  }

  const totalUsages = filteredUsage.reduce((sum, item) => sum + item.productCount, 0);
  const rawCount = filteredUsage.filter((item) => item.category === "Raw Material").length;
  const packCount = filteredUsage.filter((item) => item.category === "Packaging Material").length;
  const filtersOn = Boolean(selectedMaterial || searchTerm || filterCategory);
  const clearFilters = () => {
    setSelectedMaterial(null);
    setSearchTerm("");
    setFilterCategory("");
  };

  const cell = cn(TD, dense ? "py-1.5" : "py-2.5");
  // Pinned identity column (material code + name).
  const PIN = "sticky left-0 z-[1] bg-background shadow-[1px_0_0_hsl(var(--border))]";

  return (
    <div className="space-y-4">
      {header(
        <>
          <Button variant="outline" size="sm" onClick={() => refetch()} title="Refresh data">
            <RefreshCw /> Refresh
          </Button>
          <Button variant="outline" size="sm" onClick={exportToExcel}>
            <FileSpreadsheet /> Excel
          </Button>
          <Button size="sm" onClick={exportToPDF}>
            <FileDown /> PDF
          </Button>
        </>,
      )}

      {/* Summary */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <LabStat
          label="Materials found"
          value={filteredUsage.length}
          hint={`of ${materialUsage.length} · ${bomItems.length} BOMs`}
          icon={Layers}
          tone="brand"
        />
        <LabStat label="Total usages" value={totalUsages} hint="material × product pairs" icon={Box} tone="ok" />
        <LabStat label="Raw materials" value={rawCount} icon={Package} tone="brand" />
        <LabStat label="Packaging" value={packCount} icon={Package} tone="muted" />
      </div>

      <LabCard bodyClassName="flex flex-col">
        {/* Toolbar */}
        <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
          <div className="min-w-[220px] flex-[2_1_280px]">
            <Select
              aria-label="Material"
              value={selectedMaterial}
              onChange={setSelectedMaterial}
              options={materialOptions}
              isSearchable
              isClearable
              placeholder="All materials — pick one to focus…"
              styles={selectStyles(false)}
              classNamePrefix="react-select"
              menuPortalTarget={typeof document !== "undefined" ? document.body : null}
            />
          </div>
          <label className="flex h-10 min-w-[200px] flex-[1_1_220px] items-center gap-2 rounded-lg border border-input bg-background px-3 text-muted-foreground focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
            <Search className="h-4 w-4 flex-shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setSearchTerm("")}
              placeholder="Search materials or products…"
              aria-label="Search"
              className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
            />
            {searchTerm ? (
              <button type="button" onClick={() => setSearchTerm("")} aria-label="Clear search" className="hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            ) : (
              <kbd className="hidden rounded border border-b-2 border-border px-1.5 font-mono text-[10.5px] sm:inline">/</kbd>
            )}
          </label>
          <select
            aria-label="Category"
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className={cn(INPUT, "min-w-[160px] flex-[1_1_160px] sm:flex-none")}
          >
            <option value="">All categories</option>
            {CATEGORY_FILTERS.map((c) => (
              <option key={c} value={c}>
                {c}
              </option>
            ))}
          </select>

          {/* View + density */}
          <div className="flex items-center gap-2 max-sm:w-full">
            <div className="inline-flex h-10 rounded-lg border border-input p-0.5 max-sm:flex-1" role="group" aria-label="View">
              {[
                { v: "table", label: "Table", Icon: Table },
                { v: "chart", label: "Bars", Icon: BarChart3 },
              ].map(({ v, label, Icon }) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setViewMode(v)}
                  aria-pressed={viewMode === v}
                  className={cn(
                    "inline-flex flex-1 items-center justify-center gap-1.5 rounded-md px-3 text-sm font-medium transition-colors",
                    viewMode === v ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground",
                  )}
                >
                  <Icon className="h-4 w-4" /> {label}
                </button>
              ))}
            </div>
            {viewMode === "table" && (
              <Button
                variant="outline"
                size="icon"
                className="h-10 w-10 flex-shrink-0"
                onClick={() => setDense((d) => !d)}
                title={dense ? "Comfortable rows" : "Compact rows"}
                aria-label={dense ? "Comfortable rows" : "Compact rows"}
              >
                {dense ? <Rows3 /> : <Rows4 />}
              </Button>
            )}
          </div>
          {filtersOn && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
              <X /> Clear
            </Button>
          )}
        </div>

        {filteredUsage.length === 0 ? (
          <LabEmpty
            icon={Package}
            title="No materials found"
            hint="Try a different search, category or material."
            action={
              filtersOn && (
                <Button variant="outline" size="sm" onClick={clearFilters}>
                  Clear filters
                </Button>
              )
            }
          />
        ) : viewMode === "chart" ? (
          /* Bars: every product per material, share as a bar */
          <div className="max-h-[70vh] space-y-3 overflow-y-auto p-3 sm:p-4">
            {filteredUsage.map((material) => (
              <div key={material.id} className="rounded-lg border border-border">
                <div className="flex flex-wrap items-center gap-2 border-b border-border bg-muted/40 px-3 py-2">
                  <span className={CODE_CHIP}>{material.code ?? material.id}</span>
                  <span className="min-w-0 flex-1 truncate text-sm font-semibold text-foreground">{material.name}</span>
                  <Chip tone={CATEGORY_TONE[material.category] || "muted"}>{material.category}</Chip>
                  <span className="text-xs tabular-nums text-muted-foreground">{material.productCount} products</span>
                </div>
                <ul className="divide-y divide-border">
                  {material.usedInProducts.map((product, idx) => (
                    <li key={idx} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 text-xs">
                      <div className="flex min-w-0 flex-[1_1_200px] items-center gap-2">
                        <Box className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                        <span className="truncate font-medium text-foreground">{product.productName}</span>
                        <span className="flex-shrink-0 font-mono text-[11px] text-muted-foreground">{product.productId}</span>
                      </div>
                      <div className="flex flex-[1_1_160px] items-center gap-2">
                        <div className="h-1.5 flex-1 rounded-full bg-muted">
                          <div
                            className="h-1.5 rounded-full bg-primary"
                            style={{ width: `${Math.min(product.percentage, 100)}%` }}
                          />
                        </div>
                        <span className="w-14 text-right font-semibold tabular-nums text-primary">{product.percentage}%</span>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          /* Table: scrolls inside the card; material pinned left, header + totals pinned */
          <>
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full min-w-[760px] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    <th className={cn(TH, "left-0 z-20 min-w-[150px] md:min-w-[220px]")}>Material</th>
                    <th className={TH}>Category</th>
                    <th className={cn(TH, "text-right")}>Products</th>
                    <th className={cn(TH, "text-right")}>Total %</th>
                    <th className={cn(TH, "min-w-[320px]")}>Used in (highest share first)</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredUsage.map((material) => {
                    const open = expanded.has(material.id);
                    const shown = open ? material.usedInProducts : material.usedInProducts.slice(0, 3);
                    const more = material.usedInProducts.length - 3;
                    return (
                      <tr key={material.id} className="group [&>td]:border-b [&>td]:border-border">
                        <td className={cn(cell, PIN, "group-hover:bg-muted")}>
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <span className={cn(CODE_CHIP, "w-fit")}>{material.code ?? material.id}</span>
                            <span className="max-w-[140px] truncate font-semibold text-foreground md:max-w-[240px]" title={String(material.name)}>
                              {material.name}
                            </span>
                          </div>
                        </td>
                        <td className={cn(cell, "whitespace-nowrap group-hover:bg-muted/50")}>
                          <Chip tone={CATEGORY_TONE[material.category] || "muted"}>{material.category}</Chip>
                        </td>
                        <td className={cn(cell, NUM, "font-semibold group-hover:bg-muted/50")}>{material.productCount}</td>
                        <td className={cn(cell, NUM, "font-semibold text-primary group-hover:bg-muted/50")}>
                          {material.totalUsagePercentage}%
                        </td>
                        <td className={cn(cell, "group-hover:bg-muted/50")}>
                          <ul className="space-y-0.5">
                            {shown.map((product, idx) => (
                              <li key={idx} className="flex items-center gap-2 text-xs">
                                <span className="min-w-0 flex-1 truncate">
                                  <span className="font-medium text-foreground">{product.productName}</span>{" "}
                                  <span className="text-muted-foreground">({product.productCategory})</span>
                                </span>
                                <span className="flex-shrink-0 font-semibold tabular-nums text-primary">{product.percentage}%</span>
                              </li>
                            ))}
                          </ul>
                          {more > 0 && (
                            <button
                              type="button"
                              onClick={() => toggleExpanded(material.id)}
                              className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-primary hover:underline"
                            >
                              {open ? (
                                <>
                                  <ChevronUp className="h-3.5 w-3.5" /> Show less
                                </>
                              ) : (
                                <>
                                  <ChevronDown className="h-3.5 w-3.5" /> +{more} more
                                </>
                              )}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr className={TOTAL_ROW}>
                    <td className={cn(cell, "sticky bottom-0 left-0 z-20 border-t-2 border-primary bg-muted")}>
                      {filteredUsage.length} materials
                    </td>
                    <td className={cn(cell, "sticky bottom-0 z-10 border-t-2 border-primary bg-muted")} />
                    <td className={cn(cell, NUM, "sticky bottom-0 z-10 border-t-2 border-primary bg-muted")}>{totalUsages}</td>
                    <td className={cn(cell, "sticky bottom-0 z-10 border-t-2 border-primary bg-muted")} />
                    <td className={cn(cell, "sticky bottom-0 z-10 border-t-2 border-primary bg-muted text-xs font-normal text-muted-foreground")}>
                      {rawCount} raw · {packCount} packaging
                    </td>
                  </tr>
                </tfoot>
              </table>
            </div>
          </>
        )}
      </LabCard>
    </div>
  );
};

export default MaterialUsageBOM;
