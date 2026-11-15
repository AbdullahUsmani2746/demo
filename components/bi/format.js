// components/bi/format.js — number / label formatting for BI widgets.

export function fmt(n, decimals = 0) {
  if (n === undefined || n === null || Number.isNaN(Number(n))) return "—";
  return Number(n).toLocaleString("en-US", { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
}

/** Rs. 1.25M / Rs. 340K / Rs. 950 */
export function money(n) {
  const v = Number(n) || 0;
  const a = Math.abs(v);
  if (a >= 1e6) return `Rs. ${fmt(v / 1e6, 2)}M`;
  if (a >= 1e3) return `Rs. ${fmt(v / 1e3, 1)}K`;
  return `Rs. ${fmt(v, 0)}`;
}

/** Format a measure value by its declared format. */
export function formatValue(v, format) {
  switch (format) {
    case "currency": return money(v);
    case "qty": return fmt(v, Math.abs(Number(v)) < 100 ? 2 : 0);
    case "percent": return v === null || v === undefined ? "—" : `${fmt(v, 1)}%`;
    default: return fmt(v, 0);
  }
}

/**
 * A headline figure split into number and unit, so the unit can be small:
 * money → { value: "18.4", unit: "m" } (k / m / bn), percent → "63" + "%",
 * quantities and counts → the number alone. Full value: formatFull().
 */
export function valueParts(v, format) {
  if (v === undefined || v === null || Number.isNaN(Number(v))) return { value: "—", unit: "" };
  const n = Number(v);
  const a = Math.abs(n);
  if (format === "currency") {
    if (a >= 1e9) return { value: fmt(n / 1e9, 2), unit: "bn" };
    if (a >= 1e6) return { value: fmt(n / 1e6, a >= 1e8 ? 0 : 1), unit: "m" };
    if (a >= 1e3) return { value: fmt(n / 1e3, a >= 1e5 ? 0 : 1), unit: "k" };
    return { value: fmt(n, 0), unit: "" };
  }
  if (format === "percent") return { value: fmt(n, a < 10 ? 1 : 0), unit: "%" };
  if (format === "qty") return { value: fmt(n, a < 100 ? 1 : 0), unit: "" };
  return { value: fmt(n, 0), unit: "" };
}

/** Full (non-abbreviated) value for tables. */
export function formatFull(v, format) {
  if (format === "currency") return fmt(v, 0);
  // Quantities: decimals only when there are any (525, not 525.00; 416.5).
  if (format === "qty") {
    if (v === undefined || v === null || Number.isNaN(Number(v))) return "—";
    return Number(v).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 });
  }
  if (format === "percent") return v === null || v === undefined ? "—" : `${fmt(v, 1)}%`;
  return fmt(v, 0);
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** Label for a dimension value: dates by grain, everything else as text. */
export function dimLabel(v, col) {
  if (v === null || v === undefined) return "(blank)";
  if (col?.type === "date" && typeof v === "string" && /^\d{4}-\d{2}-\d{2}/.test(v)) {
    const [y, m, d] = v.slice(0, 10).split("-").map(Number);
    switch (col.grain) {
      case "year": return String(y);
      case "quarter": return `Q${Math.floor((m - 1) / 3) + 1} ${y}`;
      case "month": return `${MONTHS[m - 1]} ${String(y).slice(2)}`;
      case "week": return `Wk ${d} ${MONTHS[m - 1]}`;
      default: return `${String(d).padStart(2, "0")} ${MONTHS[m - 1]}`;
    }
  }
  return String(v);
}

export const PERIOD_LABEL = {
  today: "Today", yday: "Yesterday", w7: "Last 7 Days", mtd: "Current Month", pm: "Previous Month",
  ytd: "Year to Date", m3: "Last 3 Months", m6: "Last 6 Months", m12: "Last 12 Months", all: "All Time",
};
