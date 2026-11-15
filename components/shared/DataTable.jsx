"use client";
// The list of a setup screen: search, sortable maroon header, status chips for
// on/off fields, click a row to edit, paging. Under md every row becomes a
// card (table.vl-grid in app/globals.css).
import { useEffect, useRef, useState } from "react";
import ReactSelect from "react-select";
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight, Pencil, Search, Trash2, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { selectStyles } from "./EntityFormPanel";

const formatDate = (v) => {
  const d = new Date(v);
  return isNaN(d) ? String(v) : d.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

// What a cell shows — the same rules as before (relations, dates, yes / no).
const cellValue = (field, item) => {
  try {
    if (field.fieldType === "date" && item[field.name]) return formatDate(item[field.name]);
    if (field.relationName && field.relationName2 && item[field.relation]) {
      return [item[field.relation][field.relationName], item[field.relation][field.relationName2]].filter(Boolean).join(" ");
    }
    if (field.relationName && item[field.relation]) return item[field.relation][field.relationName] || "";
    if (field.fieldType === "checkbox") return item[field.name] === false ? field.falseLabel || "No" : field.trueLabel || "Yes";
    return item[field.name] ?? "";
  } catch {
    return "";
  }
};

const idOf = (item) => item.id || item.ccno || item.parameter_name;

const DataTable = ({
  data = [],
  fields = [],
  tableFields = [],
  onEdit = () => {},
  onDelete = () => {},
  loading = false,
  pagination = null,
  onPaginationChange = () => {},
  onSearchChange = () => {},
  onSortChange = () => {},
  searchValue = "",
  sortField = "",
  sortOrder = "asc",
  allowEdit = true,
  allowDelete = true,
}) => {
  const [localSearch, setLocalSearch] = useState(searchValue);
  const searchRef = useRef(null);
  const displayFields = tableFields?.length ? tableFields : fields;

  useEffect(() => {
    const t = setTimeout(() => {
      if (localSearch !== searchValue) onSearchChange(localSearch);
    }, 400);
    return () => clearTimeout(t);
  }, [localSearch, searchValue, onSearchChange]);

  useEffect(() => {
    const onKey = (e) => {
      // "/" focuses the search (Ctrl+K is the header's menu search).
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const sortBy = (field) => {
    if (!field.sortable) return;
    onSortChange(field.name, sortField === field.name && sortOrder === "asc" ? "desc" : "asc");
  };

  const goTo = (page) => {
    if (pagination && page >= 1 && page <= pagination.pages) onPaginationChange(page, pagination.limit);
  };
  const pages = (() => {
    if (!pagination) return [];
    const { page, pages: total } = pagination;
    let start = Math.max(1, page - 2);
    const end = Math.min(total, start + 4);
    start = Math.max(1, end - 4);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  })();

  const hasActions = allowEdit || allowDelete;
  const colCount = displayFields.length + (hasActions ? 1 : 0);
  const sizeOptions = [10, 25, 50, 100].map((n) => ({ value: n, label: `${n} / page` }));

  return (
    <div className="overflow-hidden rounded-xl border border-border bg-background">
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
        <label className="flex h-10 min-w-[220px] flex-1 items-center gap-2 rounded-lg border border-border px-3 text-muted-foreground focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 sm:max-w-md">
          <Search className="h-4 w-4 flex-shrink-0" />
          <input
            ref={searchRef}
            value={localSearch}
            onChange={(e) => setLocalSearch(e.target.value)}
            onKeyDown={(e) => e.key === "Escape" && setLocalSearch("")}
            placeholder="Search…"
            aria-label="Search"
            className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
          />
          {localSearch ? (
            <button type="button" onClick={() => setLocalSearch("")} aria-label="Clear search" className="hover:text-foreground">
              <X className="h-4 w-4" />
            </button>
          ) : (
            <kbd className="hidden rounded border border-b-2 border-border px-1.5 font-mono text-[10.5px] sm:inline">/</kbd>
          )}
        </label>
        {pagination && (
          <div className="ml-auto w-[130px]">
            <ReactSelect
              aria-label="Rows per page"
              options={sizeOptions}
              value={sizeOptions.find((o) => o.value === pagination.limit) || { value: pagination.limit, label: `${pagination.limit} / page` }}
              onChange={(o) => onPaginationChange(1, o.value)}
              isSearchable={false}
              menuPortalTarget={typeof document !== "undefined" ? document.body : null}
              styles={selectStyles(false)}
            />
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="vl-grid w-full text-sm">
          <thead>
            <tr className="bg-primary text-left">
              {displayFields.map((field) => {
                const active = sortField === field.name;
                return (
                  <th key={field.label || field.name} className="whitespace-nowrap px-3 py-2.5 text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">
                    {field.sortable ? (
                      <button type="button" onClick={() => sortBy(field)} className="inline-flex items-center gap-1 uppercase hover:opacity-80">
                        {field.label || field.name}
                        {active ? (
                          sortOrder === "asc" ? <ArrowUp className="h-3.5 w-3.5" /> : <ArrowDown className="h-3.5 w-3.5" />
                        ) : (
                          <ArrowUpDown className="h-3 w-3 opacity-50" />
                        )}
                      </button>
                    ) : (
                      field.label || field.name
                    )}
                  </th>
                );
              })}
              {hasActions && <th className="px-3 py-2.5 text-right text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground">Actions</th>}
            </tr>
          </thead>
          <tbody>
            {loading && !data.length ? (
              Array.from({ length: 6 }).map((_, i) => (
                <tr key={i} className="border-b border-border/60">
                  {Array.from({ length: colCount }).map((__, j) => (
                    <td key={j} className="px-3 py-3">
                      <Skeleton className="h-4 w-full max-w-[160px]" />
                    </td>
                  ))}
                </tr>
              ))
            ) : data.length === 0 ? (
              <tr>
                <td colSpan={colCount} className="px-3 py-14 text-center">
                  <p className="font-semibold text-foreground">{searchValue ? "Nothing matches your search" : "Nothing here yet"}</p>
                  <p className="mt-1 text-sm text-muted-foreground">{searchValue ? "Try another word." : "Add the first one with the button above."}</p>
                </td>
              </tr>
            ) : (
              data.map((item, index) => (
                <tr
                  key={idOf(item) ?? index}
                  onClick={() => allowEdit && onEdit(item)}
                  className={`border-b border-border/60 transition-colors hover:bg-primary/[0.03] ${allowEdit ? "cursor-pointer" : ""} ${loading ? "opacity-60" : ""}`}
                >
                  {displayFields.map((field, ci) => {
                    const v = cellValue(field, item);
                    const label = field.label || field.name;
                    if (field.fieldType === "checkbox") {
                      const on = item[field.name] !== false;
                      return (
                        <td key={label} data-label={label} className="px-3 py-2.5">
                          <span
                            className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                              on ? "bg-[#edf2ee] text-[#2f5139]" : "bg-muted text-muted-foreground"
                            }`}
                          >
                            <span className="h-1.5 w-1.5 rounded-full bg-current" />
                            {v}
                          </span>
                        </td>
                      );
                    }
                    return (
                      <td key={label} data-label={label} className="max-w-[280px] px-3 py-2.5">
                        {field.name === "id" ? (
                          <span className="rounded-[5px] bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums text-primary">{v}</span>
                        ) : (
                          <span className={`block truncate ${ci === 0 || (ci === 1 && displayFields[0]?.name === "id") ? "font-semibold text-foreground" : "text-foreground/90"}`} title={String(v)}>
                            {v === "" || v === null ? <span className="text-muted-foreground">—</span> : String(v)}
                          </span>
                        )}
                      </td>
                    );
                  })}
                  {hasActions && (
                    <td className="vl-actions whitespace-nowrap px-3 py-1.5 text-right" onClick={(e) => e.stopPropagation()}>
                      {allowEdit && (
                        <button
                          type="button"
                          onClick={() => onEdit(item)}
                          title="Edit"
                          aria-label="Edit"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-primary/70 hover:bg-primary/10 hover:text-primary"
                        >
                          <Pencil className="h-4 w-4" />
                        </button>
                      )}
                      {allowDelete && (
                        <button
                          type="button"
                          onClick={() => onDelete(idOf(item), item)}
                          title="Delete"
                          aria-label="Delete"
                          className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  )}
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {pagination && pagination.total > 0 && (
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
          <span>
            {(pagination.page - 1) * pagination.limit + 1}–{Math.min(pagination.page * pagination.limit, pagination.total)} of{" "}
            <b className="text-foreground">{pagination.total}</b>
          </span>
          <div className="flex items-center gap-1">
            <button
              type="button"
              onClick={() => goTo(pagination.page - 1)}
              disabled={pagination.page <= 1}
              aria-label="Previous page"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background hover:border-primary hover:text-primary disabled:opacity-40"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            {pages.map((p) => (
              <button
                key={p}
                type="button"
                onClick={() => goTo(p)}
                aria-current={p === pagination.page ? "page" : undefined}
                className={`h-8 min-w-[32px] rounded-lg border px-2 text-[13px] font-semibold ${
                  p === pagination.page ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background text-foreground hover:border-primary hover:text-primary"
                }`}
              >
                {p}
              </button>
            ))}
            <button
              type="button"
              onClick={() => goTo(pagination.page + 1)}
              disabled={pagination.page >= pagination.pages}
              aria-label="Next page"
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background hover:border-primary hover:text-primary disabled:opacity-40"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DataTable;
