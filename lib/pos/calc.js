// lib/pos/calc.js
// ============================================================
// POS bill arithmetic — one function for the till (what the cashier sees) and
// the server (what is posted), so the two never disagree. Pure, client-safe.
//
//   line  gross    = qty × rate
//         discount = its own discount + its share of the bill discount
//         net      = gross − discount            → Cr POS Sales (per item)
//         tax      = net × tax %                 → Cr POS Sales Tax
//   bill  total    = Σ net + Σ tax, rounded to the step → difference to POS Round Off
// ============================================================

export const round2 = (n) => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

/**
 * @param {Array<{ qty, rate, discountPct?, discountAmt? }>} lines
 * @param {{ type?: "pct"|"amt", value?: number }} billDiscount
 * @param {{ taxPercent?: number, roundTo?: number }} settings
 */
export function computeBill(lines, billDiscount = {}, settings = {}) {
  const taxPct = num(settings.taxPercent);
  const step = num(settings.roundTo);

  const rows = (lines || []).map((l) => {
    const qty = num(l.qty);
    const rate = num(l.rate);
    const gross = round2(qty * rate);
    let own = l.discountAmt != null && l.discountAmt !== "" ? num(l.discountAmt) : round2((gross * num(l.discountPct)) / 100);
    own = Math.min(Math.max(round2(own), 0), Math.max(gross, 0));
    return { ...l, qty, rate, gross, lineDiscount: own, after: round2(gross - own) };
  });

  const afterSum = round2(rows.reduce((s, r) => s + r.after, 0));
  let billDisc = billDiscount?.type === "pct" ? round2((afterSum * num(billDiscount.value)) / 100) : round2(num(billDiscount?.value));
  billDisc = Math.min(Math.max(billDisc, 0), Math.max(afterSum, 0));

  // Share the bill discount by line value; the last line takes the cents left.
  let left = billDisc;
  rows.forEach((r, i) => {
    const share = i === rows.length - 1 ? left : afterSum > 0 ? round2((billDisc * r.after) / afterSum) : 0;
    const s = Math.min(share, r.after);
    left = round2(left - s);
    r.billShare = s;
    r.discount = round2(r.lineDiscount + s);
    r.net = round2(r.gross - r.discount);
    r.tax = round2((r.net * taxPct) / 100);
    r.amount = round2(r.net + r.tax);
  });

  const subtotal = round2(rows.reduce((s, r) => s + r.gross, 0));
  const discount = round2(rows.reduce((s, r) => s + r.discount, 0));
  const net = round2(rows.reduce((s, r) => s + r.net, 0));
  const tax = round2(rows.reduce((s, r) => s + r.tax, 0));
  const beforeRound = round2(net + tax);
  const total = step > 0 ? round2(Math.round(beforeRound / step) * step) : beforeRound;
  const rounding = round2(total - beforeRound);
  const qty = rows.reduce((s, r) => s + r.qty, 0);

  return { lines: rows, subtotal, lineDiscount: round2(rows.reduce((s, r) => s + r.lineDiscount, 0)), billDiscount: billDisc, discount, net, tax, rounding, total, qty };
}

/** The largest discount on any line / the bill as a % of its price (for the max-discount rule). */
export function largestDiscountPercent(bill) {
  let worst = 0;
  for (const r of bill.lines) if (r.gross > 0) worst = Math.max(worst, (r.discount / r.gross) * 100);
  return round2(worst);
}

export const PAYMENT_METHODS = [
  { value: "CASH", label: "Cash", key: "F6" },
  { value: "CARD", label: "Card / Bank", key: "F7" },
  { value: "CREDIT", label: "Credit (account)", key: "F8" },
];

/**
 * Payments against a total. Cash may be more than what is due (change is
 * given from cash only); card and credit may not exceed what is left.
 * @returns {{ error?: string, payments: Array<{method, amount, reference}>, tendered: number, change: number, paid: number }}
 */
export function settlePayments(total, payments) {
  const list = (payments || [])
    .map((p) => ({ method: String(p.method || "").toUpperCase(), amount: round2(num(p.amount)), reference: p.reference ? String(p.reference).slice(0, 80) : null }))
    .filter((p) => p.amount > 0);
  const bad = list.find((p) => !PAYMENT_METHODS.some((m) => m.value === p.method));
  if (bad) return { error: `Unknown payment method "${bad.method}"`, payments: [], tendered: 0, change: 0, paid: 0 };

  const nonCash = round2(list.filter((p) => p.method !== "CASH").reduce((s, p) => s + p.amount, 0));
  const cash = round2(list.filter((p) => p.method === "CASH").reduce((s, p) => s + p.amount, 0));
  if (nonCash > total + 0.001) return { error: "Card and credit payments are more than the bill — only cash can give change.", payments: [], tendered: 0, change: 0, paid: 0 };
  if (round2(nonCash + cash) + 0.001 < total) {
    return { error: `The bill is not fully paid: ${round2(total - nonCash - cash).toFixed(2)} still due.`, payments: [], tendered: 0, change: 0, paid: 0 };
  }
  const cashDue = round2(total - nonCash);
  const change = round2(cash - cashDue);
  // What the books get: cash = only what stays in the drawer.
  const posted = [];
  if (cashDue > 0) posted.push({ method: "CASH", amount: cashDue, reference: null });
  for (const p of list.filter((x) => x.method !== "CASH")) {
    const same = posted.find((x) => x.method === p.method && x.reference === p.reference);
    if (same) same.amount = round2(same.amount + p.amount);
    else posted.push({ ...p });
  }
  return { payments: posted, tendered: round2(cash + nonCash), change, paid: total };
}

/**
 * Refund of part of a receipt. `soldLines` are the receipt's item lines (qty,
 * net = camt, tax = st_amount); `already` maps line id → qty already returned.
 * Rounding is given back only when the whole receipt comes back.
 */
export function computeRefund(soldLines, returnQty, already = {}, rounding = 0) {
  let wholeLeft = true;
  const rows = [];
  for (const l of soldLines) {
    const sold = num(l.qty);
    const prev = num(already[l.id]);
    const left = round2(sold - prev);
    const q = Math.min(Math.max(num(returnQty[l.id]), 0), Math.max(left, 0));
    if (round2(left - q) > 0) wholeLeft = false;
    if (q <= 0) continue;
    const share = sold > 0 ? q / sold : 0;
    const net = round2(num(l.camt) * share);
    const tax = round2(num(l.st_amount) * share);
    rows.push({ line: l, qty: q, net, tax, amount: round2(net + tax), rate: q > 0 ? round2(net / q) : 0 });
  }
  const net = round2(rows.reduce((s, r) => s + r.net, 0));
  const tax = round2(rows.reduce((s, r) => s + r.tax, 0));
  const roundBack = wholeLeft && rows.length ? round2(num(rounding)) : 0;
  return { lines: rows, net, tax, rounding: roundBack, total: round2(net + tax + roundBack) };
}
