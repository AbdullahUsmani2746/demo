// Download an .xlsx workbook from plain row objects — one sheet per entry.
// Loaded on demand so the reconciliation pages don't ship xlsx up front.
//   sheets: [[sheetName, rows[]], ...]
export async function downloadXlsx(filename, sheets) {
  const XLSX = await import("xlsx");
  const wb = XLSX.utils.book_new();
  for (const [name, rows] of sheets) {
    const ws = XLSX.utils.json_to_sheet(rows.length ? rows : [{ Note: "Nothing to show" }]);
    // Column widths from the longest value, capped
    const keys = Object.keys(rows[0] || { Note: "" });
    ws["!cols"] = keys.map((k) => ({
      wch: Math.min(60, Math.max(k.length, ...rows.slice(0, 500).map((r) => String(r[k] ?? "").length)) + 2),
    }));
    XLSX.utils.book_append_sheet(wb, ws, name.slice(0, 31));
  }
  XLSX.writeFile(wb, filename);
}

const r2 = (v) => Math.round((Number(v) || 0) * 100) / 100;
const r4 = (v) => Math.round((Number(v) || 0) * 10000) / 10000;
export { r2, r4 };
