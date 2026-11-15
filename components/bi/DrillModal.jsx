"use client";
// components/bi/DrillModal.jsx — the records behind a figure, in the BI look:
// search across every column, totals of what is shown, CSV download.
import { useEffect, useMemo, useState } from "react";
import { X, Loader2, Search, Download } from "lucide-react";
import { dimLabel, formatFull } from "./format";

const cellText = (r, c) =>
  c.role === "measure"
    ? formatFull(r[c.key], c.format)
    : c.type === "date"
      ? dimLabel(r[c.key], { type: "date", grain: "day" })
      : String(r[c.key] ?? "—");

function downloadCsv(title, columns, rows) {
  const esc = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const lines = [
    columns.map((c) => esc(c.label)).join(","),
    ...rows.map((r) => columns.map((c) => esc(c.role === "measure" ? r[c.key] ?? "" : cellText(r, c))).join(",")),
  ];
  const blob = new Blob(["﻿" + lines.join("\r\n")], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = `${(title || "records").replace(/[^\w\- ]+/g, "").trim() || "records"}.csv`;
  a.click();
  URL.revokeObjectURL(a.href);
}

export default function DrillModal({ open, title, subtitle, data, loading, error, onClose }) {
  const [q, setQ] = useState("");
  useEffect(() => {
    if (!open) return;
    setQ("");
    const k = (e) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", k);
    return () => window.removeEventListener("keydown", k);
  }, [open, onClose]);

  const rows = useMemo(() => {
    const all = data?.rows ?? [];
    const term = q.trim().toLowerCase();
    if (!term) return all;
    return all.filter((r) => data.columns.some((c) => cellText(r, c).toLowerCase().includes(term)));
  }, [data, q]);

  if (!open) return null;
  const total = (key) => rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
  const all = data?.rows?.length ?? 0;

  return (
    <div className="bi-drill-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="bi bi-card bi-drill" role="dialog" aria-modal="true" aria-label={title || "Records"}>
        <div className="bi-drill-head">
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 600, color: "var(--brass)" }}>{title}</div>
            {subtitle && <div className="bi-sub" style={{ marginTop: 3 }}>{subtitle}</div>}
          </div>
          <button onClick={onClose} className="bi-btn bi-btn-icon" aria-label="Close"><X size={15} /></button>
        </div>

        {!loading && !error && all > 0 && (
          <div className="bi-table-tools" style={{ padding: "12px 16px 0", flexWrap: "wrap" }}>
            <div className="bi-search">
              <Search size={13} />
              <input autoFocus value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search these records…" aria-label="Search records" />
              {q && <button className="clr" onClick={() => setQ("")} aria-label="Clear search"><X size={13} /></button>}
            </div>
            <span className="bi-count">
              {rows.length === all ? `${all}${data.truncated ? "+ (first 500)" : ""} record(s)` : `${rows.length} of ${all}`}
            </span>
            <button className="bi-btn" style={{ height: 32 }} onClick={() => downloadCsv(title, data.columns, rows)}>
              <Download size={13} /> CSV
            </button>
          </div>
        )}

        <div style={{ padding: "10px 16px 16px", overflow: "auto", flex: 1, minHeight: 0 }}>
          {loading ? (
            <div style={{ display: "flex", justifyContent: "center", padding: 36 }}><Loader2 className="animate-spin" size={22} style={{ color: "var(--muted)" }} /></div>
          ) : error ? (
            <div className="bi-error">{error}</div>
          ) : !all ? (
            <div className="bi-empty">No records.</div>
          ) : (
            <div className="bi-table-wrap" style={{ maxHeight: "none" }}>
              <table>
                <thead>
                  <tr>{data.columns.map((c) => <th key={c.key} className={c.role === "measure" ? "num" : ""}>{c.label}</th>)}</tr>
                </thead>
                <tbody>
                  {rows.length === 0 ? (
                    <tr><td colSpan={data.columns.length} className="bi-empty">No records match “{q}”.</td></tr>
                  ) : rows.map((r, i) => (
                    <tr key={i}>
                      {data.columns.map((c) => (
                        <td key={c.key} className={c.role === "measure" ? "num" : ""}>{cellText(r, c)}</td>
                      ))}
                    </tr>
                  ))}
                  {!data.truncated && rows.length > 1 && data.columns.some((c) => c.role === "measure") && (
                    <tr className="total">
                      {data.columns.map((c, i) => (
                        <td key={c.key} className={c.role === "measure" ? "num" : ""} style={{ color: "var(--brass)", fontWeight: 600 }}>
                          {c.role === "measure" ? (c.format === "currency" || c.format === "qty" ? formatFull(total(c.key), c.format) : "") : i === 0 ? "Total" : ""}
                        </td>
                      ))}
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
