// components/Invoicing/format.js — number formatting and the client-side
// preview of the server's pricing formula (lib/invoicing/core.js priceLine).

export const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

export const num = (v) => {
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};

export const fmtMoney = (n) =>
  (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export const fmtCompact = (n) => {
  const v = Number(n) || 0;
  return v.toLocaleString("en-US", {
    notation: Math.abs(v) >= 1_000_000 ? "compact" : "standard",
    maximumFractionDigits: Math.abs(v) >= 1_000_000 ? 2 : 0,
  });
};

export const fmtQty = (n) =>
  (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 3 });

export const fmtDate = (d) => {
  if (!d) return "—";
  const dt = new Date(d);
  if (Number.isNaN(dt.getTime())) return String(d);
  return dt.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" });
};

export const errorMessage = (err, fallback) =>
  err?.response?.data?.message || err?.response?.data?.error || err?.message || fallback;

export const isLitre = (line) => String(line?.unit || "").toUpperCase() === "LTR";

// ── billing unit ──
// Sale / Purchase Invoicing may bill a line per LTR (line.unit_switch):
// litres = KG ÷ density, amount = litres × rate; the KG qty (stock) never
// changes. The draft holds { unit, density } once the user touches them —
// mirrors withBillingUnit in lib/invoicing/core.js.
const blankVal = (v) => v === undefined || v === null || String(v).trim() === "";

/** The line as it will be billed with the draft's unit / density applied. */
export const billingLine = (line, draft) => {
  const d = draft?.lines?.[line.line_id];
  if (!line.unit_switch || !d || (d.unit === undefined && d.density === undefined)) return line;
  const wasLtr = isLitre(line);
  const wantLtr = d.unit !== undefined ? String(d.unit).toUpperCase() === "LTR" : wasLtr;
  if (!wantLtr) {
    if (!wasLtr) return line;
    return { ...line, unit: "KG", billable_qty: num(line.qty), priced_qty: num(line.qty), ack_qty: null, unit_changed: true };
  }
  if (wasLtr && d.density === undefined) return line;
  const density = d.density !== undefined ? d.density : line.density ?? line.item_density ?? "";
  const dn = blankVal(density) ? 0 : Number(density);
  const ltr = dn > 0 ? Math.round((num(line.qty) / dn) * 1000) / 1000 : 0;
  return {
    ...line,
    unit: "LTR",
    density,
    qty_ltr: ltr,
    billable_qty: ltr,
    priced_qty: ltr,
    ack_qty: null,
    unit_changed: true,
    density_missing: !(dn > 0),
  };
};

// ── acknowledged qty ──
// A line's BILLABLE qty is its physical qty in the billing unit (litres on a
// LTR line). The invoice is billed on the ACKNOWLEDGED qty — the server's
// ack_qty (NULL = the billable qty), or what the user typed here.
const QTY_EPSILON = 1e-6;

export const billableQty = (line) => num(line?.billable_qty ?? line?.priced_qty);

/** True when nothing usable was typed (blank input = the billable qty). */
const isBlank = (v) => v === undefined || v === null || String(v).trim() === "";

/** The qty a line is billed on, from the ack input value (blank = billable). */
export const billedQty = (line, ack) => (isBlank(ack) ? billableQty(line) : num(ack));

/** Problem with an ack input value, or null when it is fine. */
export const ackProblem = (line, ack) => {
  if (isBlank(ack)) return null;
  const n = Number(ack);
  if (!Number.isFinite(n)) return `Acknowledged qty for "${line.item}" must be a number`;
  if (n < 0) return `Acknowledged qty for "${line.item}" cannot be negative`;
  return null;
};

/** How much more than the billable qty is billed (0 when none) — stock is unchanged. */
export const overBy = (line, ack) => {
  const diff = billedQty(line, ack) - billableQty(line);
  return diff > QTY_EPSILON ? diff : 0;
};

/** How much less than the billable qty is billed (0 when none). */
export const shortBy = (line, ack) => {
  const diff = billableQty(line) - billedQty(line, ack);
  return diff > QTY_EPSILON ? diff : 0;
};

// Money of one line — the server's formula (lib/invoicing/core.js):
// gross = billed (acknowledged) qty × rate, tax = gross × (ST % + additional tax %) / 100.
export const lineMoney = (line, rate, stRate, ack) => {
  const gross = round2(billedQty(line, ack) * num(rate));
  const tax = round2((gross * (num(stRate) + num(line.additional_tax))) / 100);
  return { gross, tax, total: round2(gross + tax) };
};

/**
 * Rate / ST % / ack qty a line will be posted with: the draft if typed, else
 * the suggestion (ack: the stored acknowledgement, else the billable qty).
 */
export const effectiveLine = (line, draft) => {
  const d = draft?.lines?.[line.line_id];
  const bl = billingLine(line, draft);
  return {
    line: bl, // the line in its billing unit — use it for qty / money
    rate: d?.rate ?? line.rate ?? "",
    st_rate: d?.st_rate ?? line.st_rate ?? "",
    ack: d?.ack_qty ?? (bl.ack_qty ?? billableQty(bl)),
    edited: !!d && (d.rate !== undefined || d.st_rate !== undefined),
    ackEdited: d?.ack_qty !== undefined,
  };
};

/** Totals of a row: stored figures when invoiced, the live preview when pending. */
export const rowTotals = (row, draft) => {
  if (row.invoiced || !draft?.lines) {
    return {
      qty: num(row.totals?.qty),
      gross: num(row.totals?.gross),
      tax: num(row.totals?.tax),
      total: num(row.totals?.total),
    };
  }
  return (row.lines || []).reduce(
    (t, l) => {
      const e = effectiveLine(l, draft);
      const m = lineMoney(e.line, e.rate, e.st_rate, e.ack);
      return { qty: t.qty + num(l.qty), gross: t.gross + m.gross, tax: t.tax + m.tax, total: t.total + m.total };
    },
    { qty: 0, gross: 0, tax: 0, total: 0 },
  );
};

/**
 * Issues that still stand once the draft is applied. NO_RATE is recomputed
 * here with the server's rule (rate ≤ 0 on a line with a billed qty, except on
 * a Free of Cost order — row.free_of_cost), so a typed rate or an ack of 0
 * clears it. An ack qty typed here replaces the server's ACK_INVALID check
 * for that line; a bad one (not a number, negative, above the qty) blocks.
 */
export const liveIssues = (row, draft) => {
  if (row.invoiced) return [];
  const byId = new Map((row.lines || []).map((l) => [l.line_id, l]));
  const out = (row.issues || []).filter((i) => {
    if (i.type === "NO_RATE") return false;
    if (i.type !== "ACK_INVALID" || i.line_id == null) return true;
    const line = byId.get(i.line_id);
    return !line || !effectiveLine(line, draft).ackEdited;
  });
  for (const l of row.lines || []) {
    const e = effectiveLine(l, draft);
    const problem = e.ackEdited ? ackProblem(e.line, e.ack) : null;
    if (problem) out.push({ type: "ACK_INVALID", line_id: l.line_id, message: problem });
    if (e.line.density_missing) {
      out.push({ type: "NO_DENSITY", line_id: l.line_id, message: `Enter the density (KG per LTR) for "${l.item}"` });
    }
    if (!row.free_of_cost && num(e.rate) <= 0 && billedQty(e.line, e.ack) > 0) {
      out.push({ type: "NO_RATE", line_id: l.line_id, message: `No rate for "${l.item}" — enter one` });
    }
  }
  return out;
};

/** ready | blocked | invoiced | legacy */
export const rowStatus = (row, draft) => {
  if (row.legacy) return "legacy";
  if (row.invoiced) return "invoiced";
  return liveIssues(row, draft).length ? "blocked" : "ready";
};

/**
 * ack_qty for the generate request: the typed value (blank = null = none),
 * else the stored acknowledgement. The server validates it again.
 */
export const ackForRequest = (line, draft) => {
  const typed = draft?.lines?.[line.line_id]?.ack_qty;
  if (typed === undefined) return line.ack_qty ?? null;
  if (isBlank(typed)) return null;
  const n = Number(typed);
  return Number.isFinite(n) ? n : String(typed);
};
