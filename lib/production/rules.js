// lib/production/rules.js
// ============================================================
// The BOM / process order rules that Settings → Features chooses between
// (lib/features/catalog.js, group "bom" / "production"). Client-safe and pure,
// so the API routes and the forms apply exactly the same rule:
//
//   bom.percentRule            bomPercentCap() / bomPercentError()
//   production.yieldEditWindow yieldEditOpen() / yieldEditClosedMessage()
// ============================================================

// ── BOM material percentages ────────────────────────────────────────────
// "sms"      (default — the rule SMS has always had)
//            typing: a finished good's materials up to 110 %, anything else 100 %
//            saving a new BOM: 100 % (finished ± 0.03, others ± 0.01)
//            saving an edited BOM: finished 99–111 %, others 100 % ± 0.01
// "exact100" every BOM totals 100 % (± 0.01), typing capped at 100 %
// "none"     no total is checked (each line still needs a positive %)
const TOL = 0.01;

/** Highest total (and line) % the form lets one type. */
export function bomPercentCap(rule, { finished }) {
  if (rule === "none") return Infinity;
  if (rule === "exact100") return 100;
  return finished ? 110 : 100;
}

/** Message when a BOM's total % may not be saved, or null. */
export function bomPercentError(rule, total, { finished, editing }) {
  const t = Number(total) || 0;
  const shown = t.toFixed(2);
  if (rule === "none") return null;
  if (rule === "exact100" || !finished) {
    return Math.abs(t - 100) > TOL ? `Material percentages must add up to exactly 100% — current total is ${shown}%` : null;
  }
  // "sms", finished good
  if (editing) {
    return t < 99 || t > 111 ? `Material percentages of a finished good must total 100–110% — current total is ${shown}%` : null;
  }
  return Math.abs(t - 100) > 0.03 ? `Material percentages must total 100% — current total is ${shown}%` : null;
}

// ── actual yield of a posted process order ──────────────────────────────
export const YIELD_EDIT_HOURS = { "24h": 24, "72h": 72, never: 0, always: Infinity };

/** May the actual yield of an order posted at `sentAt` still change? */
export function yieldEditOpen(window, sentAt, now = Date.now()) {
  const hours = YIELD_EDIT_HOURS[window] ?? 24;
  if (hours === Infinity) return true;
  if (hours === 0) return false;
  if (!sentAt) return true;
  return now - new Date(sentAt).getTime() <= hours * 60 * 60 * 1000;
}

export function yieldEditClosedMessage(window) {
  if (window === "never") return "Actual yield cannot be edited once the order is posted.";
  const hours = YIELD_EDIT_HOURS[window] ?? 24;
  return `Actual yield cannot be edited after ${hours} hours of posting.`;
}
