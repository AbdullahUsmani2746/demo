"use client";

// Material Management — the item master list (/accounting/forms/items).
// Search (debounced, "/" focuses it), category filter, sort, paging, Excel /
// PDF export, add / view / edit. A person limited to some item categories
// (Admin → Permissions → Data scope → Item categories) sees every item but
// can edit only those of their categories — /api/forms/items enforces it.
import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { useQuery } from "@tanstack/react-query";
import { format } from "date-fns";
import {
  ChevronDown, ChevronLeft, ChevronRight, ChevronUp, ChevronsUpDown, Eye, File,
  FileSpreadsheet, Layers, Lock, Package, Pencil, Plus, Search, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { fetchItems, fetchCategories } from "@/lib/api";
import { LabCard, LabEmpty, LabHeader, Chip, CODE_CHIP, TH, TD } from "@/components/Material/shared/LabUI";
import { cn } from "@/lib/utils";

const FIELDS = [
  { name: "itcd", label: "MM No", sortable: true },
  { name: "item", label: "Description", sortable: true },
  { name: "unit", label: "Unit", sortable: true },
  { name: "category", label: "Category", sortable: false },
  { name: "import_type", label: "Import", sortable: false },
];
const PAGE_SIZES = [10, 25, 50, 100];

const importChip = (t) => {
  const v = String(t || "").toLowerCase();
  if (v.startsWith("import")) return <Chip tone="warn">Imported</Chip>;
  if (v === "local") return <Chip tone="ok">Local</Chip>;
  return <span className="text-xs text-muted-foreground">—</span>;
};

const isTyping = (el) => el && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.tagName === "SELECT" || el.isContentEditable);

export default function ItemList() {
  const router = useRouter();
  const { data: session } = useSession();
  const searchRef = useRef(null);

  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [showCategories, setShowCategories] = useState(false);
  const [sortField, setSortField] = useState("");
  const [sortOrder, setSortOrder] = useState("asc");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(25);
  const [isExporting, setIsExporting] = useState(false);

  // Debounced search.
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== search) {
        setSearch(searchInput.trim());
        setPage(1);
      }
    }, 400);
    return () => clearTimeout(t);
  }, [searchInput, search]);

  const { data: categories = [] } = useQuery({
    queryKey: ["categories"],
    queryFn: fetchCategories,
    staleTime: 5 * 60 * 1000,
  });

  // Categories this person may add / edit items in (null = all).
  const { data: manageable } = useQuery({
    queryKey: ["itemManageCategories"],
    queryFn: async () => (await fetch("/api/forms/items/categories")).json(),
    staleTime: 5 * 60 * 1000,
  });
  const canEditCategory = useMemo(() => {
    if (!manageable?.limited) return () => true;
    const ids = new Set((manageable.categories || []).map((c) => Number(c.id)));
    return (ic) => ids.has(Number(ic));
  }, [manageable]);
  const canAdd = !manageable?.limited || (manageable.categories || []).length > 0;

  const { data: itemsData, isLoading, isFetching } = useQuery({
    queryKey: ["items", page, limit, search, sortField, sortOrder, selectedCategories],
    queryFn: () =>
      fetchItems({
        page,
        limit,
        ...(search && { search }),
        ...(sortField && { sortField, sortOrder }),
        ...(selectedCategories.length > 0 && { categories: selectedCategories.join(",") }),
      }),
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev,
  });

  const items = itemsData?.items || [];
  const total = itemsData?.pagination?.total ?? items.length;
  const pages = itemsData?.pagination?.pages ?? 1;

  const categoryName = useMemo(() => {
    const byId = new Map(categories.map((c) => [Number(c.id), c.ic_name]));
    return (id) => byId.get(Number(id)) || "—";
  }, [categories]);

  // "/" focuses the search, N adds an item (not while typing).
  useEffect(() => {
    const onKey = (e) => {
      if (e.ctrlKey || e.metaKey || e.altKey || isTyping(document.activeElement)) return;
      if (e.key === "/") {
        e.preventDefault();
        searchRef.current?.focus();
      } else if ((e.key === "n" || e.key === "N") && canAdd) {
        e.preventDefault();
        router.push("/accounting/forms/items/new");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [router, canAdd]);

  const toggleCategory = (id) => {
    setSelectedCategories((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setPage(1);
  };

  const onSort = (field) => {
    if (!field.sortable) return;
    setSortOrder(sortField === field.name && sortOrder === "asc" ? "desc" : "asc");
    setSortField(field.name);
    setPage(1);
  };

  const clearAll = () => {
    setSelectedCategories([]);
    setSearchInput("");
    setSearch("");
    setSortField("");
    setSortOrder("asc");
    setPage(1);
  };

  const hasFilters = selectedCategories.length > 0 || !!search || !!sortField;

  // ── Export (everything matching the filters) ──────────────────────────────
  const fetchAllForExport = async () => {
    const qs = new URLSearchParams({ export: "true" });
    if (search) qs.set("search", search);
    if (sortField) {
      qs.set("sortField", sortField);
      qs.set("sortOrder", sortOrder);
    }
    if (selectedCategories.length) qs.set("category", selectedCategories.join(","));
    const res = await fetch(`/api/forms/items?${qs}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return (await res.json()).items || [];
  };

  const exportExcel = async (rows) => {
    const m = await import("xlsx-js-style");
    const XLSX = m.utils ? m : m.default;
    const headers = ["No", "MM Code", "MM No", "Item Description", "Category", "Unit"];
    const data = rows.map((it, i) => [i + 1, it.code || "", it.itcd || "", it.item || "", categoryName(it.ic_id), it.unit || ""]);
    const ws = XLSX.utils.aoa_to_sheet([headers, ...data]);
    const head = {
      font: { bold: true, color: { rgb: "FFFFFF" } },
      fill: { fgColor: { rgb: "800000" } },
      alignment: { horizontal: "center", vertical: "center" },
    };
    headers.forEach((_, c) => {
      const cell = ws[XLSX.utils.encode_cell({ r: 0, c })];
      if (cell) cell.s = head;
    });
    ws["!cols"] = [{ wch: 6 }, { wch: 20 }, { wch: 10 }, { wch: 44 }, { wch: 22 }, { wch: 10 }];
    ws["!freeze"] = { xSplit: 0, ySplit: 1 };
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Items");
    XLSX.writeFile(wb, `Items_List_${format(new Date(), "yyyy-MM-dd_HHmm")}.xlsx`);
  };

  const exportPdf = async (rows) => {
    const { jsPDF } = await import("jspdf");
    const { default: autoTable } = await import("jspdf-autotable");
    const doc = new jsPDF({ orientation: "portrait", unit: "mm", format: "a4" });
    const w = doc.internal.pageSize.width;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("MATERIAL LIST", w / 2, 12, { align: "center" });
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text(format(new Date(), "EEEE MMMM dd yyyy h:mm a"), 10, 20);
    doc.text(`Printed by: ${session?.user?.name || ""}`, w - 10, 20, { align: "right" });
    autoTable(doc, {
      head: [["No", "MM Code", "MM No", "Item Description", "Category", "Unit"]],
      body: rows.map((it, i) => [i + 1, it.code || "", it.itcd ?? "", it.item || "", categoryName(it.ic_id), it.unit || ""]),
      startY: 25,
      margin: { left: 10, right: 10 },
      styles: { fontSize: 8, cellPadding: 1.5, lineWidth: 0.1, lineColor: [200, 200, 200] },
      headStyles: { fillColor: [128, 0, 0], textColor: [255, 255, 255], fontStyle: "bold", halign: "center" },
      columnStyles: { 0: { halign: "center", cellWidth: 12 }, 1: { cellWidth: 30 }, 2: { halign: "center", cellWidth: 18 }, 4: { cellWidth: 32 }, 5: { halign: "center", cellWidth: 16 } },
      alternateRowStyles: { fillColor: [250, 247, 247] },
      didDrawPage: (d) => {
        doc.setFontSize(8);
        doc.text(`Page ${d.pageNumber}`, w - 10, doc.internal.pageSize.height - 5, { align: "right" });
      },
    });
    doc.save(`Material_List_${format(new Date(), "yyyy-MM-dd_HHmm")}.pdf`);
  };

  const onExport = async (kind) => {
    if (!total) return;
    setIsExporting(true);
    try {
      const rows = await fetchAllForExport();
      if (kind === "excel") await exportExcel(rows);
      else await exportPdf(rows);
    } catch (e) {
      console.error("Export error:", e);
      alert("Failed to export. Please try again.");
    } finally {
      setIsExporting(false);
    }
  };

  // ── Pieces ────────────────────────────────────────────────────────────────
  const sortIcon = (f) => {
    if (!f.sortable) return null;
    if (sortField !== f.name) return <ChevronsUpDown className="h-3.5 w-3.5 opacity-60" />;
    return sortOrder === "asc" ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />;
  };

  const actions = (it) => {
    const editable = canEditCategory(it.ic_id);
    return (
      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          onClick={() => router.push(`/accounting/forms/items/${it.itcd}/view`)}
          className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground hover:bg-primary/10 hover:text-primary"
          title="View"
          aria-label={`View ${it.item}`}
        >
          <Eye className="h-4 w-4" />
        </button>
        {editable ? (
          <button
            type="button"
            onClick={() => router.push(`/accounting/forms/items/${it.itcd}`)}
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-primary hover:bg-primary/10"
            title="Edit"
            aria-label={`Edit ${it.item}`}
          >
            <Pencil className="h-4 w-4" />
          </button>
        ) : (
          <span
            className="inline-flex h-9 w-9 items-center justify-center rounded-lg text-muted-foreground/60"
            title="Another team manages this category"
          >
            <Lock className="h-4 w-4" />
          </span>
        )}
      </div>
    );
  };

  const from = total ? (page - 1) * limit + 1 : 0;
  const to = Math.min(page * limit, total);

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto max-w-[1600px] space-y-4 px-3 py-5 sm:px-6">
        <LabHeader
          icon={Package}
          breadcrumb="Setup"
          title="Material Management"
          subtitle="Item master — materials, finished goods and stores items"
          badge={total || null}
          actions={
            <>
              <Button variant="outline" onClick={() => onExport("excel")} disabled={isExporting || !total} className="gap-2">
                <FileSpreadsheet className="h-4 w-4" /> Excel
              </Button>
              <Button variant="outline" onClick={() => onExport("pdf")} disabled={isExporting || !total} className="gap-2">
                <File className="h-4 w-4" /> PDF
              </Button>
              {canAdd && (
                <Button onClick={() => router.push("/accounting/forms/items/new")} className="gap-2" title="Add item (N)">
                  <Plus className="h-4 w-4" /> Add item
                </Button>
              )}
            </>
          }
        />

        {manageable?.limited && (
          <div className="rounded-xl border border-border bg-[#f5f0e6] px-4 py-2.5 text-[13px] text-[#5f4b1f]">
            You can add and edit items of{" "}
            <b>{(manageable.categories || []).map((c) => c.ic_name).join(", ") || "no category"}</b>. Items of other
            categories are shown read-only.
          </div>
        )}

        <LabCard bodyClassName="p-0">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-3 sm:px-4">
            <div className="relative min-w-0 flex-1 basis-60">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                ref={searchRef}
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => e.key === "Escape" && setSearchInput("")}
                placeholder="Search by MM no, description, code or unit…"
                className="h-10 w-full rounded-lg border border-border bg-background pl-9 pr-16 text-sm outline-none focus:border-primary focus:ring-2 focus:ring-primary/15"
              />
              {searchInput ? (
                <button
                  type="button"
                  onClick={() => setSearchInput("")}
                  className="absolute right-2 top-1/2 inline-flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded text-muted-foreground hover:bg-muted"
                  aria-label="Clear search"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : (
                <kbd className="absolute right-2 top-1/2 hidden -translate-y-1/2 rounded border border-border bg-muted px-1.5 text-[11px] text-muted-foreground sm:block">/</kbd>
              )}
            </div>
            <Button
              variant="outline"
              onClick={() => setShowCategories((v) => !v)}
              className={cn("h-10 gap-2", selectedCategories.length > 0 && "border-primary bg-primary/10 text-primary")}
            >
              <Layers className="h-4 w-4" /> Categories
              {selectedCategories.length > 0 && (
                <span className="rounded-full bg-primary px-1.5 text-[11px] font-semibold text-primary-foreground">{selectedCategories.length}</span>
              )}
            </Button>
            <label className="flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm text-muted-foreground">
              Rows
              <select
                value={limit}
                onChange={(e) => {
                  setLimit(Number(e.target.value));
                  setPage(1);
                }}
                className="bg-transparent font-medium text-foreground outline-none"
              >
                {PAGE_SIZES.map((n) => (
                  <option key={n} value={n}>{n}</option>
                ))}
              </select>
            </label>
          </div>

          {/* Category filter */}
          {showCategories && (
            <div className="border-b border-border bg-primary/[0.03] px-3 py-3 sm:px-4">
              <div className="mb-2 flex items-center justify-between">
                <p className="text-[11px] font-bold uppercase tracking-wider text-primary">Filter by category</p>
                {selectedCategories.length > 0 && (
                  <button type="button" onClick={() => { setSelectedCategories([]); setPage(1); }} className="text-xs font-medium text-primary hover:underline">
                    Clear
                  </button>
                )}
              </div>
              <div className="flex flex-wrap gap-2">
                {categories.map((c) => {
                  const on = selectedCategories.includes(c.id);
                  return (
                    <button
                      key={c.id}
                      type="button"
                      onClick={() => toggleCategory(c.id)}
                      className={cn(
                        "inline-flex h-9 items-center gap-1.5 rounded-full border px-3 text-[13px] font-medium transition-colors",
                        on ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background hover:border-primary/40 hover:bg-primary/5",
                      )}
                    >
                      {c.ic_name}
                      {manageable?.limited && !canEditCategory(c.id) && <Lock className="h-3 w-3 opacity-60" />}
                    </button>
                  );
                })}
                {categories.length === 0 && <p className="text-sm text-muted-foreground">No categories set up.</p>}
              </div>
            </div>
          )}

          {/* Active filters */}
          {hasFilters && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border px-3 py-2 sm:px-4">
              {search && (
                <Chip tone="brand">
                  Search: “{search}”
                  <button type="button" onClick={() => setSearchInput("")} aria-label="Remove search"><X className="h-3 w-3" /></button>
                </Chip>
              )}
              {selectedCategories.map((id) => (
                <Chip key={id} tone="brand">
                  {categoryName(id)}
                  <button type="button" onClick={() => toggleCategory(id)} aria-label="Remove category"><X className="h-3 w-3" /></button>
                </Chip>
              ))}
              {sortField && (
                <Chip tone="muted">
                  Sorted by {FIELDS.find((f) => f.name === sortField)?.label} ({sortOrder})
                  <button type="button" onClick={() => setSortField("")} aria-label="Remove sort"><X className="h-3 w-3" /></button>
                </Chip>
              )}
              <button type="button" onClick={clearAll} className="text-xs font-medium text-primary hover:underline">
                Clear all
              </button>
            </div>
          )}

          {/* Computer: table */}
          <div className={cn("hidden overflow-x-auto md:block", isFetching && !isLoading && "opacity-70")}>
            <table className="w-full text-sm">
              <thead>
                <tr>
                  {FIELDS.map((f) => (
                    <th key={f.name} className={cn(TH, f.sortable && "cursor-pointer select-none")} onClick={() => onSort(f)}>
                      <span className="inline-flex items-center gap-1">{f.label}{sortIcon(f)}</span>
                    </th>
                  ))}
                  <th className={cn(TH, "text-right")}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {isLoading
                  ? Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i} className="border-b border-border">
                        {Array.from({ length: FIELDS.length + 1 }).map((__, j) => (
                          <td key={j} className={TD}><div className="h-4 animate-pulse rounded bg-muted" /></td>
                        ))}
                      </tr>
                    ))
                  : items.map((it) => (
                      <tr key={it.itcd} className="border-b border-border hover:bg-primary/[0.03]">
                        <td className={TD}><span className={CODE_CHIP}>{it.itcd}</span></td>
                        <td className={cn(TD, "max-w-[460px]")}>
                          <div className="truncate font-medium text-foreground" title={it.item}>{it.item}</div>
                          {it.code && <div className="truncate text-xs text-muted-foreground">{it.code}</div>}
                        </td>
                        <td className={TD}>{it.unit || "—"}</td>
                        <td className={TD}><Chip tone={canEditCategory(it.ic_id) ? "brand" : "muted"}>{categoryName(it.ic_id)}</Chip></td>
                        <td className={TD}>{importChip(it.import_type)}</td>
                        <td className={cn(TD, "py-1")}>{actions(it)}</td>
                      </tr>
                    ))}
              </tbody>
            </table>
          </div>

          {/* Phone: cards */}
          <div className="divide-y divide-border md:hidden">
            {isLoading
              ? Array.from({ length: 5 }).map((_, i) => (
                  <div key={i} className="space-y-2 px-3 py-3">
                    <div className="h-4 w-2/3 animate-pulse rounded bg-muted" />
                    <div className="h-3 w-1/3 animate-pulse rounded bg-muted" />
                  </div>
                ))
              : items.map((it) => (
                  <div key={it.itcd} className="flex items-start gap-3 px-3 py-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <span className={CODE_CHIP}>{it.itcd}</span>
                        <span className="text-xs text-muted-foreground">{it.unit}</span>
                      </div>
                      <div className="mt-1 font-medium text-foreground">{it.item}</div>
                      {it.code && <div className="text-xs text-muted-foreground">{it.code}</div>}
                      <div className="mt-1.5 flex flex-wrap gap-1.5">
                        <Chip tone={canEditCategory(it.ic_id) ? "brand" : "muted"}>{categoryName(it.ic_id)}</Chip>
                        {importChip(it.import_type)}
                      </div>
                    </div>
                    {actions(it)}
                  </div>
                ))}
          </div>

          {!isLoading && items.length === 0 && (
            <LabEmpty
              icon={Package}
              title={hasFilters ? "No items match" : "No items yet"}
              hint={hasFilters ? "Try another search or clear the filters." : "Add your first item to see it here."}
              action={
                hasFilters ? (
                  <Button variant="outline" onClick={clearAll}>Clear filters</Button>
                ) : canAdd ? (
                  <Button onClick={() => router.push("/accounting/forms/items/new")} className="gap-2"><Plus className="h-4 w-4" /> Add item</Button>
                ) : null
              }
            />
          )}

          {/* Paging */}
          {total > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border px-3 py-3 text-sm sm:px-4">
              <span className="text-muted-foreground">
                {from}–{to} of <b className="text-foreground">{total}</b>
              </span>
              <div className="flex items-center gap-1">
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setPage((p) => Math.max(1, p - 1))} disabled={page <= 1} aria-label="Previous page">
                  <ChevronLeft className="h-4 w-4" />
                </Button>
                <span className="min-w-[72px] text-center tabular-nums">{page} / {Math.max(1, pages)}</span>
                <Button variant="outline" size="icon" className="h-9 w-9" onClick={() => setPage((p) => Math.min(pages, p + 1))} disabled={page >= pages} aria-label="Next page">
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </LabCard>
      </div>
    </div>
  );
}
