// lib/hr/chainWhen.js — the condition on an HR approval-chain step
// (advance / loan chains: "only when the amount is above X or over the HR
// limit", e.g. a CEO step). Pure — used by the server (lib/hr/chains.js,
// lib/hr/approvals.js) and the chain editor screen.

/** A step's condition from the admin screen, or null (= always needed). */
export function cleanWhen(w) {
  const n = Number(w?.minAmount);
  const minAmount = w?.minAmount !== "" && w?.minAmount != null && Number.isFinite(n) && n > 0 ? Math.round(n * 100) / 100 : null;
  const overLimit = Boolean(w?.overLimit);
  return minAmount != null || overLimit ? { minAmount, overLimit } : null;
}

/** "above 100,000 or over the advance / loan limit" — for screens and the inbox. */
export function describeWhen(when) {
  if (!when) return "";
  const parts = [];
  if (when.minAmount != null) parts.push(`amount above ${Number(when.minAmount).toLocaleString("en-US")}`);
  if (when.overLimit) parts.push("over the HR advance / loan limit");
  return `Only when ${parts.join(" or ")}`;
}

/** Is a step needed for this request? ctx = { amount, overLimit }. */
export function stepApplies(step, ctx = {}) {
  const w = step?.when;
  if (!w) return true;
  if (w.minAmount != null && Number(ctx.amount) > Number(w.minAmount)) return true;
  return Boolean(w.overLimit && ctx.overLimit);
}
