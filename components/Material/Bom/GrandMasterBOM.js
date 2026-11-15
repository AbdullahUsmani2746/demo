"use client";
// Lab → Grand Master BOM: one product exploded through every BOM level down to
// raw materials — summary, tree, flat table, and a two-product comparison.
// Read-only; Excel / print export.
import React, { useState, useEffect, useMemo, useRef } from "react";
import { useGrandMasterBOM } from "@/hooks/useGrandMasterBom"; // Import new hook
import {
  ChevronDown,
  ChevronRight,
  ChevronsDown,
  ChevronsUp,
  Box,
  Search,
  Download,
  FileSpreadsheet,
  FileDown,
  RefreshCw,
  ArrowLeftRight,
  TrendingUp,
  TrendingDown,
  Minus,
  Network,
  LayoutGrid,
  ListTree,
  Table2,
  Package,
  Layers,
  X,
  Rows3,
  Rows4,
  ArrowUp,
  ArrowDown,
  ArrowUpDown,
} from "lucide-react";
import Select from "react-select";
import * as XLSX from "xlsx";
import { toast } from "sonner";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
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
  TABS_SCROLL,
  TABS_LIST,
  TABS_TRIGGER,
} from "@/components/Material/shared/LabUI";

// Category → chip tone (same mapping as Material Usage BOM).
const CATEGORY_TONE = {
  Finished: "ok",
  "Semi Finished": "warn",
  "Raw Material": "brand",
  "Packaging Material": "muted",
};
const CATEGORY_FILTERS = ["Raw Material", "Semi Finished", "Finished", "Packaging Material"];

const VIEWS = [
  { value: "summary", label: "Summary", Icon: LayoutGrid },
  { value: "detail", label: "Tree", Icon: ListTree },
  { value: "tabular", label: "Table", Icon: Table2 },
  { value: "compare", label: "Compare", Icon: ArrowLeftRight },
];

const INPUT =
  "h-10 rounded-lg border border-input bg-background px-3 text-sm text-foreground outline-none focus:border-primary focus:ring-2 focus:ring-primary/15";
// Pinned identity column + pinned totals cells inside the scrolling tables.
const PIN = "sticky left-0 z-[1] bg-background shadow-[1px_0_0_hsl(var(--border))]";
const FOOT = "sticky bottom-0 z-10 border-t-2 border-primary bg-muted font-semibold";

const GrandMasterBOM = () => {
  // Use the new hook
  const {
    bomItems,
    items: finishItems,
    loading,
    refetch,
  } = useGrandMasterBOM(); // No params needed

  const [selectedProduct, setSelectedProduct] = useState(null);
  const [compareProduct, setCompareProduct] = useState(null); // 2nd item for Compare mode
  const [hierarchy, setHierarchy] = useState([]);
  const [expandedNodes, setExpandedNodes] = useState(new Set());
  const [viewMode, setViewMode] = useState("summary");
  const [searchTerm, setSearchTerm] = useState("");
  const [filterCategory, setFilterCategory] = useState("");
  const [tabularSort, setTabularSort] = useState({ col: "level", dir: "asc" });
  const [dense, setDense] = useState(false);
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

  // Fix buildBOMHierarchy to handle different data structure
  const buildBOMHierarchy = (
    productId,
    level = 0,
    path = [],
    parentPercentage = 100,
    parentQuantity = 100
  ) => {
    

    if (!bomItems || !finishItems) {
      
      return null;
    }

    // Find BOM - check different possible structures
    const bom = bomItems.find((b) => {
      // Try different possible property names
      return (
        b.finished_id === productId ||
        b.finishedId === productId ||
        b.finished_product_id === productId
      );
    });

    

    if (!bom) {
      
      return null;
    }

    // Find product
    const product = finishItems.find((f) => {
      return (
        f.itcd === productId || f.item_code === productId || f.id === productId
      );
    });

    

    const node = {
      id: `${productId}-${level}-${path.join("-")}`,
      productId,
      inkCode: product?.code || product?.imk_code || product?.item_code || product?.ink_code || productId,
      code: product?.code || product?.imk_code || product?.item_code || product?.ink_code || productId,
      productName: product?.item || product?.item_name || productId,
      category: getCategoryName(product?.ic_id || product?.category_id),
      level,
      percentage: parentPercentage,
      quantity: parentQuantity,
      children: [],
      path: [...path, productId],
    };

    if (path.includes(productId)) {
      return { ...node, circular: true };
    }

    // Handle different BOM detail structures
    const bomDetails =
      bom.bomDetails ||
      bom.bom_details ||
      bom.materials ||
      bom.components ||
      [];

    

    if (bomDetails && Array.isArray(bomDetails)) {
      bomDetails.forEach((detail, index) => {
        

        const childProductId =
          detail.material_id || detail.materialId || detail.component_id;

        const materialPercentage =
          detail.material_percentage ||
          detail.percentage ||
          detail.qty_percentage ||
          0;

        const childProduct = finishItems.find((f) => {
          return (
            f.itcd === childProductId ||
            f.item_code === childProductId ||
            f.id === childProductId
          );
        });

        const childBom = bomItems.find((b) => {
          return (
            b.finished_id === childProductId ||
            b.finishedId === childProductId ||
            b.finished_product_id === childProductId
          );
        });

        // Calculate cumulative percentage
        const childPercentage = parentPercentage * (materialPercentage / 100);
        const childQuantity = parentQuantity * (materialPercentage / 100);

        const childNode = {
          // Parent included so the same material under two parents gets its own expand state
          id: `${childProductId}-${level + 1}-${[...path, productId].join("-")}-${index}`,
          productId: childProductId,
          inkCode: childProduct?.code || childProduct?.imk_code || childProduct?.item_code || childProduct?.ink_code || childProductId,
          code: childProduct?.code || childProduct?.imk_code || childProduct?.item_code || childProduct?.ink_code || childProductId,
          productName:
            childProduct?.item || childProduct?.item_name || childProductId,
          category: getCategoryName(
            childProduct?.ic_id || childProduct?.category_id
          ),
          level: level + 1,
          percentage: childPercentage,
          quantity: childQuantity,
          children: [],
          path: [...path, productId, childProductId],
        };

        // Recursively build hierarchy for Semi-Finished and Finished materials
        if (
          childBom &&
          [1, 2].includes(childProduct?.ic_id || childProduct?.category_id)
        ) {
          
          const childHierarchy = buildBOMHierarchy(
            childProductId,
            level + 1,
            [...path, productId],
            childPercentage,
            childQuantity
          );
          if (childHierarchy) {
            childNode.children = childHierarchy.children || [];
          }
        }

        node.children.push(childNode);
      });
    }

    
    return node;
  };

  const generateHierarchy = () => {
    if (!selectedProduct || !bomItems || bomItems.length === 0) {
      setHierarchy([]);
      return;
    }

    // Start with 100 (representing 100%)
    const hierarchy = buildBOMHierarchy(selectedProduct.value, 0, [], 100, 100);
    setHierarchy(hierarchy ? [hierarchy] : []);
    if (hierarchy) {
      setExpandedNodes(new Set([hierarchy.id]));
    }
  };

  useEffect(() => {
    if (selectedProduct && bomItems && bomItems.length > 0) {
      generateHierarchy();
    }
  }, [selectedProduct, bomItems]);

  const toggleNode = (nodeId) => {
    const newExpanded = new Set(expandedNodes);
    if (newExpanded.has(nodeId)) {
      newExpanded.delete(nodeId);
    } else {
      newExpanded.add(nodeId);
    }
    setExpandedNodes(newExpanded);
  };

  const calculateSummary = () => {
    const summary = {
      rawMaterials: new Map(),
      semiFinished: new Map(),
      finished: new Map(),
      packagingMaterials: new Map(),
      totalComponents: 0,
    };

    if (!hierarchy || hierarchy.length === 0) return summary;

    const traverse = (node) => {
      if (!node) return;

      summary.totalComponents++;

      const key = node.productId;
      const item = {
        productId: node.productId,
        productName: node.productName,
        code: node.code,
        category: node.category,
        totalPercentage: node.percentage,
        totalQuantity: node.quantity,
        level: node.level,
      };

      switch (node.category) {
        case "Raw Material":
          if (summary.rawMaterials.has(key)) {
            const existing = summary.rawMaterials.get(key);
            existing.totalPercentage += node.percentage;
            existing.totalQuantity += node.quantity;
          } else {
            summary.rawMaterials.set(key, item);
          }
          break;
        case "Semi Finished":
          if (summary.semiFinished.has(key)) {
            const existing = summary.semiFinished.get(key);
            existing.totalPercentage += node.percentage;
            existing.totalQuantity += node.quantity;
          } else {
            summary.semiFinished.set(key, item);
          }
          break;
        case "Finished":
          if (summary.finished.has(key)) {
            const existing = summary.finished.get(key);
            existing.totalPercentage += node.percentage;
            existing.totalQuantity += node.quantity;
          } else {
            summary.finished.set(key, item);
          }
          break;
        case "Packaging Material":
          if (summary.packagingMaterials.has(key)) {
            const existing = summary.packagingMaterials.get(key);
            existing.totalPercentage += node.percentage;
            existing.totalQuantity += node.quantity;
          } else {
            summary.packagingMaterials.set(key, item);
          }
          break;
      }

      if (node.children) {
        node.children.forEach(traverse);
      }
    };

    hierarchy.forEach(traverse);

    // Calculate total percentage for raw materials and normalize to 100%
    let totalRawMaterialPercentage = 0;
    summary.rawMaterials.forEach((item) => {
      totalRawMaterialPercentage += item.totalPercentage;
    });

    // Normalize raw material percentages to total 100%
    if (totalRawMaterialPercentage > 0) {
      summary.rawMaterials.forEach((item) => {
        item.normalizedPercentage =
          (item.totalPercentage / totalRawMaterialPercentage) * 100;
      });
    }

    return summary;
  };

  // ── Compare BOMs: flatten a product to its raw materials ──────────────────
  // Recurses the full tree (via buildBOMHierarchy) and aggregates every
  // Raw Material leaf, then normalizes each material's share to 100% so two
  // products can be compared on composition. Keyed by material productId.
  const getRawMaterialsFor = (productId) => {
    const map = new Map();
    if (productId == null) return map;

    const root = buildBOMHierarchy(productId, 0, [], 100, 100);
    const traverse = (node) => {
      if (!node) return;
      if (node.category === "Raw Material") {
        const key = node.productId;
        if (map.has(key)) {
          const e = map.get(key);
          e.totalPercentage += node.percentage;
          e.totalQuantity += node.quantity;
        } else {
          map.set(key, {
            productId: node.productId,
            productName: node.productName,
            totalPercentage: node.percentage,
            totalQuantity: node.quantity,
          });
        }
      }
      (node.children || []).forEach(traverse);
    };
    traverse(root);

    // Normalize each material's percentage to a share of the total (sums to 100%)
    let total = 0;
    map.forEach((i) => (total += i.totalPercentage));
    map.forEach((i) => {
      i.normalizedPercentage = total > 0 ? (i.totalPercentage / total) * 100 : 0;
    });
    return map;
  };

  // Build the side-by-side comparison model (recomputed only in Compare mode)
  const comparison = useMemo(() => {
    if (
      viewMode !== "compare" ||
      !selectedProduct ||
      !compareProduct ||
      !bomItems ||
      bomItems.length === 0
    ) {
      return null;
    }

    const mapA = getRawMaterialsFor(selectedProduct.value);
    const mapB = getRawMaterialsFor(compareProduct.value);
    const keys = new Set([...mapA.keys(), ...mapB.keys()]);

    // One unified row per material with both sides' values + shared/unique flag
    const rows = [];
    keys.forEach((key) => {
      const a = mapA.get(key);
      const b = mapB.get(key);
      const shared = Boolean(a && b);
      const pctA = a ? a.normalizedPercentage : null;
      const pctB = b ? b.normalizedPercentage : null;
      rows.push({
        productId: key,
        productName: (a || b).productName,
        shared,
        onlyA: Boolean(a && !b),
        onlyB: Boolean(b && !a),
        pctA,
        pctB,
        qtyA: a ? a.totalQuantity : null,
        qtyB: b ? b.totalQuantity : null,
        delta: shared ? pctA - pctB : null, // A% − B%
      });
    });

    // Shared first (by combined share desc) so the two panels align; then unique
    const bucketRank = (r) => (r.shared ? 0 : 1);
    const share = (r) => (r.pctA ?? 0) + (r.pctB ?? 0);
    rows.sort((x, y) => bucketRank(x) - bucketRank(y) || share(y) - share(x));

    const panelA = rows.filter((r) => r.shared || r.onlyA);
    const panelB = rows.filter((r) => r.shared || r.onlyB);

    return {
      rows,
      panelA,
      panelB,
      sharedCount: rows.filter((r) => r.shared).length,
      onlyACount: rows.filter((r) => r.onlyA).length,
      onlyBCount: rows.filter((r) => r.onlyB).length,
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [viewMode, selectedProduct, compareProduct, bomItems, finishItems]);

  const exportComparisonExcel = () => {
    if (!comparison) return;
    const nameA = selectedProduct?.label?.split("(")[0].trim() || "A";
    const nameB = compareProduct?.label?.split("(")[0].trim() || "B";
    const data = comparison.rows.map((r) => ({
      Material: r.productName,
      "Material ID": r.productId,
      Status: r.shared ? "Shared" : r.onlyA ? "Only in A" : "Only in B",
      [`A: ${nameA} %`]: r.pctA != null ? r.pctA.toFixed(2) : "",
      [`A Qty/100`]: r.qtyA != null ? r.qtyA.toFixed(4) : "",
      [`B: ${nameB} %`]: r.pctB != null ? r.pctB.toFixed(2) : "",
      [`B Qty/100`]: r.qtyB != null ? r.qtyB.toFixed(4) : "",
      "Delta % (A-B)": r.delta != null ? r.delta.toFixed(2) : "",
    }));
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "BOM Comparison");
    XLSX.writeFile(
      wb,
      `BOM_Compare_${nameA}_vs_${nameB}`.replace(/[^a-z0-9_]/gi, "_") + ".xlsx"
    );
  };

  const exportToExcel = () => {
    if (!hierarchy || hierarchy.length === 0) {
      toast.error("Please select a product first");
      return;
    }

    const flattenHierarchy = (node, result = []) => {
      result.push({
        "Product ID": node.productId,
        "Product Name": node.productName,
        Category: node.category,
        Level: node.level,
        Percentage: node.percentage + "%",
        Quantity: node.quantity.toFixed(4),
      });

      if (node.children) {
        node.children.forEach((child) => flattenHierarchy(child, result));
      }

      return result;
    };

    const data = flattenHierarchy(hierarchy[0]);
    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "BOM Hierarchy");

    // Add summary sheet
    const summary = calculateSummary();
    const summaryData = [
      { Category: "Raw Materials", Count: summary.rawMaterials.size },
      { Category: "Semi Finished", Count: summary.semiFinished.size },
      { Category: "Finished Products", Count: summary.finished.size },
      {
        Category: "Packaging Materials",
        Count: summary.packagingMaterials.size,
      },
      { Category: "Total Components", Count: summary.totalComponents },
    ];
    const wsSummary = XLSX.utils.json_to_sheet(summaryData);
    XLSX.utils.book_append_sheet(wb, wsSummary, "Summary");

    XLSX.writeFile(
      wb,
      `BOM_${selectedProduct?.label}_${
        new Date().toISOString().split("T")[0]
      }.xlsx`
    );
  };

  const exportToPDF = () => {
    if (!hierarchy || hierarchy.length === 0) {
      toast.error("Please select a product first");
      return;
    }

    const printWindow = window.open("", "_blank");
    const summary = calculateSummary();

    const flattenHierarchy = (node, indent = 0) => {
      let html = `
        <div style="margin-left: ${
          indent * 20
        }px; margin-bottom: 10px; padding: 10px; border-left: 3px solid #3b82f6;">
          <div style="font-weight: bold; font-size: 14px;">${
            node.productName
          } (${node.productId})</div>
          <div style="color: #666; font-size: 12px; margin-top: 5px;">
            <span style="margin-right: 15px;">Category: ${node.category}</span>
            <span style="margin-right: 15px;">Percentage: ${
              node.percentage
            }%</span>
            <span style="margin-right: 15px;">Quantity: ${node.quantity.toFixed(
              4
            )}</span>
            <span>Level: ${node.level}</span>
          </div>
        </div>
      `;

      if (node.children && node.children.length > 0) {
        node.children.forEach((child) => {
          html += flattenHierarchy(child, indent + 1);
        });
      }

      return html;
    };

    const content = `
      <!DOCTYPE html>
      <html>
        <head>
          <title>BOM Report - ${selectedProduct?.label}</title>
          <style>
            body { font-family: Arial, sans-serif; padding: 20px; }
            .header { text-align: center; margin-bottom: 30px; border-bottom: 3px solid #3b82f6; padding-bottom: 20px; }
            .header h1 { color: #1e40af; margin: 0; }
            .header p { color: #666; margin: 5px 0; }
            .summary { display: grid; grid-template-columns: repeat(5, 1fr); gap: 15px; margin-bottom: 30px; }
            .summary-card { padding: 15px; border-radius: 8px; text-align: center; }
            .summary-card h3 { margin: 0; font-size: 24px; }
            .summary-card p { margin: 5px 0 0 0; color: #666; font-size: 12px; }
            .hierarchy { margin-top: 20px; }
            @media print { body { padding: 10px; } }
          </style>
        </head>
        <body>
          <div class="header">
            <h1>Grand Master BOM Report</h1>
            <p>Product: ${selectedProduct?.label}</p>
            <p>Generated: ${new Date().toLocaleString()}</p>
          </div>
          
          <div class="summary">
            <div class="summary-card" style="background: #dbeafe; border: 2px solid #3b82f6;">
              <h3>${summary.totalComponents}</h3>
              <p>Total Components</p>
            </div>
            <div class="summary-card" style="background: #fee2e2; border: 2px solid #ef4444;">
              <h3>${summary.rawMaterials.size}</h3>
              <p>Raw Materials</p>
            </div>
            <div class="summary-card" style="background: #fef3c7; border: 2px solid #f59e0b;">
              <h3>${summary.semiFinished.size}</h3>
              <p>Semi-Finished</p>
            </div>
            <div class="summary-card" style="background: #d1fae5; border: 2px solid #10b981;">
              <h3>${summary.finished.size}</h3>
              <p>Finished Products</p>
            </div>
            <div class="summary-card" style="background: #f3e8ff; border: 2px solid #8b5cf6;">
              <h3>${summary.packagingMaterials.size}</h3>
              <p>Packaging Materials</p>
            </div>
          </div>

          <h2 style="color: #1e40af; border-bottom: 2px solid #3b82f6; padding-bottom: 10px;">BOM Hierarchy</h2>
          <div class="hierarchy">
            ${flattenHierarchy(hierarchy[0])}
          </div>
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

  const summary = calculateSummary();

  const productOptions = finishItems
    ? finishItems
        .filter((item) => [1, 2].includes(item.ic_id)) // Only show Finished and Semi-Finished products
        .map((item) => ({
          value: item.itcd,
          label: `${item.code} - ${item.item} (${getCategoryName(item.ic_id)})`,
        }))
    : [];

  const header = (actions) => (
    <LabHeader
      icon={Network}
      title="Grand Master BOM"
      subtitle="Every BOM level of a product, down to its raw materials"
      actions={actions}
    />
  );

  // Loading: skeletons in the page's own shape.
  if (loading) {
    return (
      <div className="space-y-4">
        {header(null)}
        <Skeleton className="h-10 w-full max-w-md rounded-lg" />
        <Skeleton className="h-[66px] rounded-xl" />
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          {[0, 1, 2, 3, 4].map((i) => (
            <Skeleton key={i} className="h-[74px] rounded-xl" />
          ))}
        </div>
        <div className="space-y-2 rounded-xl border border-border bg-background p-4">
          {Array.from({ length: 8 }).map((_, i) => (
            <Skeleton key={i} className="h-9 w-full" />
          ))}
        </div>
      </div>
    );
  }

  // Show data loading issues
  if (!loading && (bomItems.length === 0 || finishItems.length === 0)) {
    return (
      <div className="space-y-4">
        {header(null)}
        <LabCard>
          <LabEmpty
            icon={Network}
            title="No data to explode"
            hint={
              bomItems.length === 0 && finishItems.length === 0
                ? "No BOM or product data found"
                : bomItems.length === 0
                ? "No BOM data found"
                : "No product data found"
            }
            action={
              <div className="mt-2 flex flex-col items-center gap-3">
                <Button onClick={() => refetch()}>
                  <RefreshCw /> Retry loading data
                </Button>
                <p className="text-xs tabular-nums text-muted-foreground">
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

  // ── Toolbar filters: search + category apply to every view ──────────────
  const q = searchTerm.trim().toLowerCase();
  const matchesSearch = (n) =>
    !q ||
    String(n.productId ?? "").toLowerCase().includes(q) ||
    String(n.inkCode ?? n.code ?? "").toLowerCase().includes(q) ||
    String(n.productName ?? "").toLowerCase().includes(q) ||
    String(n.category ?? "").toLowerCase().includes(q) ||
    String(n.parentName ?? "").toLowerCase().includes(q);
  const matchesCategory = (n) => !filterCategory || n.category === filterCategory;
  const filtersOn = Boolean(searchTerm || filterCategory);
  const clearFilters = () => {
    setSearchTerm("");
    setFilterCategory("");
  };

  const cell = cn(TD, dense ? "py-1.5" : "py-2.5");
  const categoryChip = (category) => (
    <Chip tone={CATEGORY_TONE[category] || "muted"} className="whitespace-nowrap">
      {category}
    </Chip>
  );
  const densityButton = (
    <Button
      variant="outline"
      size="icon"
      className="h-8 w-8"
      onClick={() => setDense((d) => !d)}
      title={dense ? "Comfortable rows" : "Compact rows"}
      aria-label={dense ? "Comfortable rows" : "Compact rows"}
    >
      {dense ? <Rows3 /> : <Rows4 />}
    </Button>
  );
  const pickProductEmpty = (
    <LabCard>
      <LabEmpty
        icon={Box}
        title="No product selected"
        hint="Pick a finished or semi-finished product above to explode its BOM."
      />
    </LabCard>
  );
  const noMatchEmpty = (
    <LabEmpty
      icon={Search}
      title="Nothing matches"
      hint="Try a different search or category."
      action={
        <Button variant="outline" size="sm" onClick={clearFilters}>
          Clear filters
        </Button>
      }
    />
  );

  // ── Tree (Detailed view) ────────────────────────────────────────────────
  const allParentIds = () => {
    const ids = [];
    const walk = (n) => {
      if (!n) return;
      if (n.children && n.children.length > 0) ids.push(n.id);
      (n.children || []).forEach(walk);
    };
    hierarchy.forEach(walk);
    return ids;
  };

  const renderTreeNode = (node) => {
    if (!node) return null;

    const isExpanded = expandedNodes.has(node.id);
    const hasChildren = node.children && node.children.length > 0;
    const hit = Boolean(q) && matchesSearch(node);
    const dim = !matchesCategory(node) || (Boolean(q) && !hit);

    return (
      <li key={node.id}>
        <div
          className={cn(
            "flex flex-wrap items-center gap-x-3 gap-y-1 border-b border-border py-2 pr-3 transition-colors [--indent:14px] sm:[--indent:26px]",
            node.level === 0 ? "bg-primary/5" : "hover:bg-muted/50",
            hit && "bg-primary/10",
            hasChildren && "cursor-pointer",
            dim && "opacity-50"
          )}
          style={{ paddingLeft: `calc(${node.level} * var(--indent) + 8px)` }}
          onClick={() => hasChildren && toggleNode(node.id)}
        >
          <div className="flex min-w-0 flex-[1_1_220px] items-center gap-2">
            {hasChildren ? (
              <button
                type="button"
                aria-label={isExpanded ? "Collapse" : "Expand"}
                aria-expanded={isExpanded}
                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded hover:bg-muted"
                onClick={(e) => {
                  e.stopPropagation();
                  toggleNode(node.id);
                }}
              >
                {isExpanded ? (
                  <ChevronDown className="h-4 w-4 text-primary" />
                ) : (
                  <ChevronRight className="h-4 w-4 text-muted-foreground" />
                )}
              </button>
            ) : (
              <span className="w-6 flex-shrink-0" />
            )}
            <span className={cn(CODE_CHIP, "flex-shrink-0")} title={`ITCD ${node.productId}`}>
              {node.code}
            </span>
            <span
              className={cn(
                "min-w-0 truncate text-sm text-foreground",
                node.level === 0 ? "font-bold" : "font-medium"
              )}
              title={String(node.productName)}
            >
              {node.productName}
            </span>
            {categoryChip(node.category)}
            {node.circular && <Chip tone="bad">Circular</Chip>}
          </div>
          <div className="ml-auto flex items-center text-xs tabular-nums">
            <span className="w-20 text-right font-semibold text-primary">{node.percentage.toFixed(1)}%</span>
            <span className="w-20 text-right font-semibold text-foreground">{node.quantity.toFixed(1)}</span>
            <span className="w-12 text-right text-muted-foreground">L{node.level}</span>
          </div>
        </div>

        {isExpanded && hasChildren && <ul>{node.children.map((child) => renderTreeNode(child))}</ul>}
      </li>
    );
  };

  const renderDetail = () => {
    if (hierarchy.length === 0) return pickProductEmpty;
    return (
      <LabCard
        title="BOM hierarchy"
        subtitle={`${summary.totalComponents} components · share % and qty per 100 of the product`}
        icon={ListTree}
        bodyClassName="flex flex-col"
        actions={
          <>
            <Button variant="outline" size="sm" onClick={() => setExpandedNodes(new Set(allParentIds()))}>
              <ChevronsDown /> Expand all
            </Button>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setExpandedNodes(new Set(hierarchy[0] ? [hierarchy[0].id] : []))}
            >
              <ChevronsUp /> Collapse
            </Button>
          </>
        }
      >
        <div className="hidden items-center border-b border-border bg-muted/50 py-2 pl-3 pr-3 text-[11.5px] font-semibold uppercase tracking-wide text-muted-foreground sm:flex">
          <span className="flex-1">Item</span>
          <span className="w-20 text-right">Share %</span>
          <span className="w-20 text-right">Qty / 100</span>
          <span className="w-12 text-right">Level</span>
        </div>
        <ul className="max-h-[70vh] overflow-y-auto">{hierarchy.map((node) => renderTreeNode(node))}</ul>
      </LabCard>
    );
  };

  // ── Summary view ────────────────────────────────────────────────────────
  const renderSummary = () => {
    if (hierarchy.length === 0) return pickProductEmpty;

    const showCat = (cat) => !filterCategory || filterCategory === cat;
    const raw = Array.from(summary.rawMaterials.values()).filter(matchesSearch);
    const rawShare = raw.reduce((sum, item) => sum + (item.normalizedPercentage || 0), 0);
    const rawQty = raw.reduce((sum, item) => sum + item.totalQuantity, 0);

    const others = [
      { cat: "Semi Finished", title: "Semi-finished", map: summary.semiFinished },
      { cat: "Finished", title: "Finished", map: summary.finished },
      { cat: "Packaging Material", title: "Packaging", map: summary.packagingMaterials },
    ].filter((o) => o.map.size > 0 && showCat(o.cat));

    return (
      <div className="space-y-4">
        {showCat("Raw Material") && (
          <LabCard
            title="Raw materials breakdown"
            subtitle="Each raw material's share of the product's raw-material composition (normalised to 100%)"
            icon={Package}
            bodyClassName="flex flex-col"
            actions={densityButton}
          >
            {raw.length === 0 ? (
              summary.rawMaterials.size === 0 ? (
                <LabEmpty icon={Package} title="No raw materials" hint="This BOM has no raw-material leaves." />
              ) : (
                noMatchEmpty
              )
            ) : (
              <div className="max-h-[65vh] overflow-auto">
                <table className="w-full min-w-[560px] border-separate border-spacing-0 text-sm">
                  <thead>
                    <tr>
                      <th className={cn(TH, "left-0 z-20 min-w-[150px] md:min-w-[260px]")}>Raw material</th>
                      <th className={cn(TH, "min-w-[200px]")}>Share of composition</th>
                      <th className={cn(TH, "text-right")}>Qty / 100</th>
                      <th className={cn(TH, "text-right")}>Level</th>
                    </tr>
                  </thead>
                  <tbody>
                    {raw.map((item) => (
                      <tr key={item.productId} className="group [&>td]:border-b [&>td]:border-border">
                        <td className={cn(cell, PIN, "group-hover:bg-muted")}>
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <span className={cn(CODE_CHIP, "w-fit")} title={`ITCD ${item.productId}`}>
                              {item.code ?? item.productId}
                            </span>
                            <span
                              className="max-w-[140px] truncate font-medium text-foreground md:max-w-[320px]"
                              title={String(item.productName)}
                            >
                              {item.productName}
                            </span>
                          </div>
                        </td>
                        <td className={cn(cell, "group-hover:bg-muted/50")}>
                          <div className="flex items-center gap-2">
                            <div className="h-1.5 flex-1 rounded-full bg-muted">
                              <div
                                className="h-1.5 rounded-full bg-primary"
                                style={{ width: `${item.normalizedPercentage || 0}%` }}
                              />
                            </div>
                            <span className="w-14 text-right font-semibold tabular-nums text-primary">
                              {item.normalizedPercentage ? item.normalizedPercentage.toFixed(1) + "%" : "0%"}
                            </span>
                          </div>
                        </td>
                        <td className={cn(cell, NUM, "group-hover:bg-muted/50")}>{item.totalQuantity.toFixed(1)}</td>
                        <td className={cn(cell, NUM, "text-muted-foreground group-hover:bg-muted/50")}>{item.level}</td>
                      </tr>
                    ))}
                  </tbody>
                  <tfoot>
                    <tr>
                      <td className={cn(cell, FOOT, "left-0 z-20")}>
                        {raw.length} raw material{raw.length === 1 ? "" : "s"}
                      </td>
                      <td className={cn(cell, FOOT, NUM, "text-primary")}>{rawShare.toFixed(1)}%</td>
                      <td className={cn(cell, FOOT, NUM)}>{rawQty.toFixed(1)}</td>
                      <td className={cn(cell, FOOT)} />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </LabCard>
        )}

        {others.length > 0 && (
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            {others.map(({ cat, title, map }) => {
              const list = Array.from(map.values()).filter(matchesSearch);
              return (
                <LabCard
                  key={cat}
                  title={`${title} (${map.size})`}
                  icon={Layers}
                  actions={categoryChip(cat)}
                >
                  {list.length === 0 ? (
                    <p className="px-4 py-6 text-center text-sm text-muted-foreground">Nothing matches the search.</p>
                  ) : (
                    <ul className="max-h-64 divide-y divide-border overflow-y-auto">
                      {list.map((item) => (
                        <li key={item.productId} className="flex items-center gap-2 px-4 py-2 text-sm">
                          <span className={cn(CODE_CHIP, "flex-shrink-0")}>{item.code ?? item.productId}</span>
                          <span className="min-w-0 flex-1 truncate text-foreground" title={String(item.productName)}>
                            {item.productName}
                          </span>
                          <span className="flex-shrink-0 text-xs tabular-nums text-muted-foreground">
                            Qty <span className="font-semibold text-foreground">{item.totalQuantity.toFixed(1)}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </LabCard>
              );
            })}
          </div>
        )}

        {!showCat("Raw Material") && others.length === 0 && (
          <LabCard>
            <LabEmpty icon={Layers} title={`No ${filterCategory.toLowerCase()} in this BOM`} />
          </LabCard>
        )}
      </div>
    );
  };

  // ── Tabular view ────────────────────────────────────────────────────────
  const renderTabular = () => {
    const flatten = (node, parent = null, rows = []) => {
      if (!node) return rows;
      const itemCode = node.inkCode || node.code || node.productId;
      rows.push({
        productId:   node.productId,
        productName: node.productName,
        inkCode:     itemCode,
        code:        itemCode,
        category:    node.category,
        level:       node.level,
        percentage:  node.percentage,
        quantity:    node.quantity,
        parentId:    parent?.productId ?? null,
        parentName:  parent?.productName ?? null,
      });
      (node.children || []).forEach((c) => flatten(c, node, rows));
      return rows;
    };

    const allRows = hierarchy.length > 0 ? flatten(hierarchy[0]) : [];

    let filtered = allRows.filter((r) => matchesSearch(r) && matchesCategory(r));

    const { col, dir } = tabularSort;
    filtered = [...filtered].sort((a, b) => {
      let va = a[col] ?? "", vb = b[col] ?? "";
      // Mixed number / text values compare as text (codes can be either)
      if (typeof va === "string" || typeof vb === "string") {
        va = String(va).toLowerCase();
        vb = String(vb).toLowerCase();
      }
      return dir === "asc" ? (va < vb ? -1 : va > vb ? 1 : 0) : (va > vb ? -1 : va < vb ? 1 : 0);
    });

    const onSort = (c) => setTabularSort((s) => ({ col: c, dir: s.col === c && s.dir === "asc" ? "desc" : "asc" }));
    const sortHead = (c, label, extra) => (
      <button
        type="button"
        onClick={() => onSort(c)}
        className={cn("inline-flex items-center gap-1 uppercase hover:opacity-80", extra)}
        aria-label={`Sort by ${label}`}
      >
        {label}
        {col === c ? (
          dir === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
        ) : (
          <ArrowUpDown className="h-3.5 w-3.5 opacity-50" />
        )}
      </button>
    );

    const exportTabular = () => {
      if (!filtered.length) return;
      const rows = filtered.map((r, i) => ({
        "#": i + 1, "Level": r.level,
        "ITCD": r.productId,
        "Ink Code": r.inkCode || r.code,
        "Product Name": r.productName,
        "Category": r.category,
        "BOM %": r.percentage.toFixed(2),
        "Qty / 100": r.quantity.toFixed(4),
        "Parent ITCD": r.parentId ?? "",
        "Parent Name": r.parentName ?? "",
      }));
      const ws = XLSX.utils.json_to_sheet(rows);
      const wb = XLSX.utils.book_new();
      XLSX.utils.book_append_sheet(wb, ws, "BOM Tabular");
      XLSX.writeFile(wb, `BOM_Tabular_${selectedProduct?.label?.replace(/[^a-z0-9]/gi,"_")}.xlsx`);
    };

    if (hierarchy.length === 0) return pickProductEmpty;

    const rawRows = allRows.filter((r) => r.category === "Raw Material").length;
    const packRows = allRows.filter((r) => r.category === "Packaging Material").length;
    // Two pinned columns on md+ (code + name); only the code on a phone.
    const CODE_W = "w-[112px] min-w-[112px] max-w-[112px]";
    const NAME_PIN = "md:sticky md:left-[112px] md:shadow-[1px_0_0_hsl(var(--border))]";
    const BAND = "sticky top-0 z-10 h-8 bg-primary px-3 py-0 text-[11px] font-semibold uppercase tracking-wide text-primary-foreground/85 whitespace-nowrap border-b border-primary-foreground/20";

    return (
      <LabCard
        title="BOM — flat table"
        subtitle={`${selectedProduct ? selectedProduct.label.split("(")[0].trim() : "Select a product"} · ${filtered.length} of ${allRows.length} rows`}
        icon={Table2}
        bodyClassName="flex flex-col"
        actions={
          <>
            {densityButton}
            <Button variant="outline" size="sm" onClick={exportTabular} disabled={!filtered.length}>
              <Download /> Export
            </Button>
          </>
        }
      >
        {filtered.length === 0 ? (
          noMatchEmpty
        ) : (
          <div className="max-h-[70vh] overflow-auto">
            <table className="w-full min-w-[860px] border-separate border-spacing-0 text-sm">
              <thead>
                {/* Column groups */}
                <tr>
                  <th colSpan={4} className={cn(BAND, "left-0 z-20 text-left")}>Item</th>
                  <th colSpan={2} className={cn(BAND, "border-l border-l-primary-foreground/25 text-center")}>
                    Per 100 of the product
                  </th>
                  <th className={cn(BAND, "border-l border-l-primary-foreground/25 text-left")}>Where used</th>
                </tr>
                <tr>
                  <th className={cn(TH, "top-8 left-0 z-30", CODE_W, "max-md:shadow-[1px_0_0_hsl(var(--border))]")}>
                    {sortHead("inkCode", "Ink Code")}
                  </th>
                  <th className={cn(TH, "top-8 min-w-[220px] md:z-30", NAME_PIN, "md:shadow-none")}>
                    {sortHead("productName", "Product Name")}
                  </th>
                  <th className={cn(TH, "top-8")}>{sortHead("level", "Level")}</th>
                  <th className={cn(TH, "top-8")}>{sortHead("category", "Category")}</th>
                  <th className={cn(TH, "top-8 border-l border-l-primary-foreground/25 text-right")}>
                    {sortHead("percentage", "BOM %", "justify-end")}
                  </th>
                  <th className={cn(TH, "top-8 text-right")}>{sortHead("quantity", "Qty / 100", "justify-end")}</th>
                  <th className={cn(TH, "top-8 border-l border-l-primary-foreground/25")}>Parent</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((row, idx) => (
                  <tr key={`${row.productId}-${idx}`} className="group [&>td]:border-b [&>td]:border-border">
                    <td className={cn(cell, CODE_W, "sticky left-0 z-[1] bg-background group-hover:bg-muted max-md:shadow-[1px_0_0_hsl(var(--border))]")}>
                      <span className={cn(CODE_CHIP, "inline-block max-w-full truncate align-middle")} title={`ITCD ${row.productId}`}>
                        {row.inkCode || row.code}
                      </span>
                    </td>
                    <td className={cn(cell, "z-[1] bg-background group-hover:bg-muted", NAME_PIN)}>
                      <span
                        className="block max-w-[320px] truncate font-medium text-foreground"
                        style={{ paddingLeft: `${row.level * 12}px` }}
                        title={String(row.productName)}
                      >
                        {row.productName}
                      </span>
                    </td>
                    <td className={cn(cell, "group-hover:bg-muted/50")}>
                      <span className="inline-flex items-center gap-1.5">
                        <span
                          className="h-1.5 rounded-full bg-primary"
                          style={{ width: `${Math.max(6, (row.level + 1) * 6)}px`, opacity: Math.max(0.35, 1 - row.level * 0.2) }}
                        />
                        <span className="text-xs font-semibold tabular-nums text-muted-foreground">L{row.level}</span>
                      </span>
                    </td>
                    <td className={cn(cell, "group-hover:bg-muted/50")}>{categoryChip(row.category)}</td>
                    <td className={cn(cell, NUM, "border-l border-border font-semibold text-primary group-hover:bg-muted/50")}>
                      {row.percentage.toFixed(2)}%
                    </td>
                    <td className={cn(cell, NUM, "font-semibold group-hover:bg-muted/50")}>{row.quantity.toFixed(4)}</td>
                    <td className={cn(cell, "border-l border-border group-hover:bg-muted/50")}>
                      {row.parentId ? (
                        <div className="flex min-w-0 flex-col">
                          <span className="font-mono text-[11px] text-muted-foreground">{row.parentId}</span>
                          <span className="max-w-[180px] truncate text-xs text-foreground" title={String(row.parentName)}>
                            {row.parentName}
                          </span>
                        </div>
                      ) : (
                        <span className="text-xs italic text-muted-foreground">root</span>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
              <tfoot>
                <tr>
                  <td className={cn(cell, FOOT, CODE_W, "left-0 z-20")}>{filtered.length} rows</td>
                  <td className={cn(cell, FOOT, "text-xs font-normal text-muted-foreground md:left-[112px] md:z-20")} colSpan={3}>
                    {allRows.length} total · {rawRows} raw materials · {packRows} packaging
                  </td>
                  <td className={cn(cell, FOOT)} colSpan={2} />
                  <td className={cn(cell, FOOT, "text-xs font-normal text-muted-foreground")}>
                    Sorted by {col} {dir}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        )}
      </LabCard>
    );
  };

  // ── Compare BOMs view ───────────────────────────────────────────────────
  const renderCompare = () => {
    if (!selectedProduct || !compareProduct) {
      return (
        <LabCard>
          <LabEmpty
            icon={ArrowLeftRight}
            title="Select two products to compare"
            hint="Pick Item A in the first selector, then Item B next to it."
          />
        </LabCard>
      );
    }
    if (!comparison) return null;

    const nameA = selectedProduct.label.split("(")[0].trim();
    const nameB = compareProduct.label.split("(")[0].trim();
    const rows = comparison.rows.filter(matchesSearch);
    const sum = (key) => rows.reduce((s, r) => s + (r[key] ?? 0), 0);
    const BAND = "sticky top-0 z-10 h-8 bg-primary px-3 py-0 text-[11px] font-semibold normal-case tracking-normal text-primary-foreground whitespace-nowrap border-b border-primary-foreground/20 border-l border-l-primary-foreground/25";
    const fmtPct = (v) => (v != null ? v.toFixed(1) + "%" : "—");
    const fmtQty = (v) => (v != null ? v.toFixed(2) : "—");

    return (
      <div className="space-y-4">
        <div className="grid grid-cols-3 gap-3">
          <LabStat label="Shared" value={comparison.sharedCount} hint="in both" />
          <LabStat label="Only in A" value={comparison.onlyACount} hint={nameA} />
          <LabStat label="Only in B" value={comparison.onlyBCount} hint={nameB} />
        </div>

        <LabCard
          title="Raw-material composition"
          subtitle="Each side normalised to 100% · shared materials first"
          icon={ArrowLeftRight}
          bodyClassName="flex flex-col"
          actions={
            <>
              {densityButton}
              <Button variant="outline" size="sm" onClick={exportComparisonExcel}>
                <Download /> Export comparison
              </Button>
            </>
          }
        >
          {rows.length === 0 ? (
            comparison.rows.length === 0 ? (
              <LabEmpty icon={Package} title="No raw materials found" />
            ) : (
              noMatchEmpty
            )
          ) : (
            <div className="max-h-[70vh] overflow-auto">
              <table className="w-full min-w-[760px] border-separate border-spacing-0 text-sm">
                <thead>
                  <tr>
                    <th rowSpan={2} className={cn(TH, "left-0 z-30 min-w-[150px] align-bottom md:min-w-[240px]")}>Material</th>
                    <th rowSpan={2} className={cn(TH, "align-bottom")}>Status</th>
                    <th colSpan={2} className={cn(BAND, "max-w-[220px] truncate text-center")} title={nameA}>
                      A · {nameA}
                    </th>
                    <th colSpan={2} className={cn(BAND, "max-w-[220px] truncate text-center")} title={nameB}>
                      B · {nameB}
                    </th>
                    <th rowSpan={2} className={cn(TH, "border-l border-l-primary-foreground/25 text-right align-bottom")}>
                      Δ share (A − B)
                    </th>
                  </tr>
                  <tr>
                    <th className={cn(TH, "top-8 border-l border-l-primary-foreground/25 text-right")}>Share</th>
                    <th className={cn(TH, "top-8 text-right")}>Qty / 100</th>
                    <th className={cn(TH, "top-8 border-l border-l-primary-foreground/25 text-right")}>Share</th>
                    <th className={cn(TH, "top-8 text-right")}>Qty / 100</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => {
                    // Delta from A's side (positive = A has more)
                    const rel = r.shared ? r.delta : null;
                    const diff = rel != null && Math.abs(rel) > 0.05;
                    return (
                      <tr key={r.productId} className="group [&>td]:border-b [&>td]:border-border">
                        <td className={cn(cell, PIN, "group-hover:bg-muted")}>
                          <div className="flex min-w-0 flex-col gap-0.5">
                            <span className="font-mono text-[11px] text-muted-foreground">{r.productId}</span>
                            <span
                              className="max-w-[140px] truncate font-medium text-foreground md:max-w-[300px]"
                              title={String(r.productName)}
                            >
                              {r.productName}
                            </span>
                          </div>
                        </td>
                        <td className={cn(cell, "group-hover:bg-muted/50")}>
                          {r.shared ? (
                            <Chip tone="ok">Shared</Chip>
                          ) : r.onlyA ? (
                            <Chip tone="brand">Only A</Chip>
                          ) : (
                            <Chip tone="warn">Only B</Chip>
                          )}
                        </td>
                        <td className={cn(cell, NUM, "border-l border-border font-semibold group-hover:bg-muted/50", r.pctA == null && "text-muted-foreground")}>
                          {fmtPct(r.pctA)}
                        </td>
                        <td className={cn(cell, NUM, "text-muted-foreground group-hover:bg-muted/50")}>{fmtQty(r.qtyA)}</td>
                        <td className={cn(cell, NUM, "border-l border-border font-semibold group-hover:bg-muted/50", r.pctB == null && "text-muted-foreground")}>
                          {fmtPct(r.pctB)}
                        </td>
                        <td className={cn(cell, NUM, "text-muted-foreground group-hover:bg-muted/50")}>{fmtQty(r.qtyB)}</td>
                        <td
                          className={cn(cell, NUM, "border-l border-border group-hover:bg-muted/50")}
                          title={r.shared ? (diff ? `${rel > 0 ? "+" : ""}${rel.toFixed(1)}% A vs B` : "Same share") : undefined}
                        >
                          {r.shared ? (
                            <span
                              className={cn(
                                "inline-flex items-center justify-end gap-1 text-xs font-semibold",
                                diff ? "text-foreground" : "text-muted-foreground"
                              )}
                            >
                              {!diff ? (
                                <Minus className="h-3.5 w-3.5" />
                              ) : rel > 0 ? (
                                <TrendingUp className="h-3.5 w-3.5 text-primary" />
                              ) : (
                                <TrendingDown className="h-3.5 w-3.5 text-primary" />
                              )}
                              {diff ? `${rel > 0 ? "+" : "−"}${Math.abs(rel).toFixed(1)}%` : "same"}
                            </span>
                          ) : (
                            <span className="text-muted-foreground">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
                <tfoot>
                  <tr>
                    <td className={cn(cell, FOOT, "left-0 z-20")}>{rows.length} materials</td>
                    <td className={cn(cell, FOOT)} />
                    <td className={cn(cell, FOOT, NUM)}>{sum("pctA").toFixed(1)}%</td>
                    <td className={cn(cell, FOOT, NUM)}>{sum("qtyA").toFixed(2)}</td>
                    <td className={cn(cell, FOOT, NUM)}>{sum("pctB").toFixed(1)}%</td>
                    <td className={cn(cell, FOOT, NUM)}>{sum("qtyB").toFixed(2)}</td>
                    <td className={cn(cell, FOOT)} />
                  </tr>
                </tfoot>
              </table>
            </div>
          )}
        </LabCard>
      </div>
    );
  };

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
        </>
      )}

      {/* Views */}
      <Tabs value={viewMode} onValueChange={setViewMode}>
        <div className={TABS_SCROLL}>
          <TabsList className={TABS_LIST}>
            {VIEWS.map(({ value, label, Icon }) => (
              <TabsTrigger key={value} value={value} className={TABS_TRIGGER}>
                <Icon className="h-4 w-4" /> {label}
              </TabsTrigger>
            ))}
          </TabsList>
        </div>
      </Tabs>

      {/* Toolbar: product(s), search, category */}
      <LabCard bodyClassName="space-y-3 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div className="min-w-[220px] flex-[2_1_300px]">
            <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
              {viewMode === "compare" && <Chip tone="brand">A</Chip>}
              Product
            </label>
            <Select
              aria-label="Product"
              value={selectedProduct}
              onChange={setSelectedProduct}
              options={productOptions}
              isSearchable
              placeholder="Search finished / semi-finished products…"
              styles={selectStyles(false)}
              classNamePrefix="react-select"
              menuPortalTarget={typeof document !== "undefined" ? document.body : null}
            />
          </div>
          {/* Second selector — Compare mode only */}
          {viewMode === "compare" && (
            <div className="min-w-[220px] flex-[2_1_300px]">
              <label className="mb-1 flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
                <Chip tone="warn">B</Chip>
                Compare with
              </label>
              <Select
                aria-label="Compare with"
                value={compareProduct}
                onChange={setCompareProduct}
                options={productOptions.filter(
                  (o) => o.value !== selectedProduct?.value
                )}
                isSearchable
                placeholder="Select second product…"
                styles={selectStyles(false)}
                classNamePrefix="react-select"
                menuPortalTarget={typeof document !== "undefined" ? document.body : null}
              />
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <label className="flex h-10 min-w-[200px] flex-[1_1_260px] items-center gap-2 rounded-lg border border-input bg-background px-3 text-muted-foreground focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 sm:max-w-md">
            <Search className="h-4 w-4 flex-shrink-0" />
            <input
              ref={searchRef}
              type="text"
              value={searchTerm}
              onChange={(e) => setSearchTerm(e.target.value)}
              onKeyDown={(e) => e.key === "Escape" && setSearchTerm("")}
              placeholder="Search code, name, category…"
              aria-label="Search in BOM"
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
          {filtersOn && (
            <Button variant="ghost" size="sm" onClick={clearFilters} className="text-muted-foreground">
              <X /> Clear
            </Button>
          )}
          <span className="ml-auto text-xs tabular-nums text-muted-foreground">
            {bomItems.length} BOMs · {finishItems.length} products
          </span>
        </div>
      </LabCard>

      {/* Statistics */}
      {hierarchy.length > 0 && viewMode !== "compare" && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
          <LabStat label="Total components" value={summary.totalComponents} icon={Network} tone="brand" />
          <LabStat label="Raw materials" value={summary.rawMaterials.size} icon={Package} tone="brand" />
          <LabStat label="Semi-finished" value={summary.semiFinished.size} icon={Layers} tone="warn" />
          <LabStat label="Finished" value={summary.finished.size} icon={Box} tone="ok" />
          <LabStat label="Packaging" value={summary.packagingMaterials.size} icon={Package} tone="muted" />
        </div>
      )}

      {viewMode === "compare"
        ? renderCompare()
        : viewMode === "tabular"
        ? renderTabular()
        : viewMode === "summary"
        ? renderSummary()
        : renderDetail()}
    </div>
  );
};

export default GrandMasterBOM;
