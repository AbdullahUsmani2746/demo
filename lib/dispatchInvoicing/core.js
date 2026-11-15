// ============================================================
// DISPATCH INVOICING — shared domain logic
// ============================================================
// SUPERSEDED 2026-10-25 by lib/invoicing/** (Invoicing, kind "sale"), which
// prices dispatches, GRNs and both returns with user-entered rates and one
// running invoice series per kind. The E / M series split and its number
// allocator were removed from here; /api/dispatch-invoicing/** now delegates
// to lib/invoicing/core.js. What remains are pure pricing helpers kept for
// lib/dispatchInvoicing/applyPricing.js.
//
// A dispatch (tran_code=6) is posted WITHOUT any pricing: the stock lines
// carry qty/batch/packing only, rate/st_rate/amounts are 0 and no sub_tran_id=3
// auto entries exist yet.
//
// This module holds every rule the listing API (preview) and the generate API
// (commit) must agree on. Keeping them in one place means the amount and the
// invoice number the user sees before clicking are exactly what gets written.
// ============================================================

// ── Fiscal year ─────────────────────────────────────────────
// The books run 1 July to 30 June. (Invoice numbers used to restart every
// 1 July per E / M series; since 2026-10-25 Invoicing runs ONE continuous
// series per kind — lib/invoicing/core.js nextInvoiceNo.)
export const FISCAL_YEAR_START_MONTH = 7; // July

/**
 * The fiscal year a date falls in, named by the calendar year it STARTS in:
 * 1 Jul 2026 .. 30 Jun 2027 is fiscal year 2026.
 *
 * UTC getters on purpose. Prisma hands back a `timestamp` column as a Date at
 * UTC midnight, so reading it with local getters would move a 1 July document
 * into the previous fiscal year for anyone west of Greenwich.
 */
export function fiscalYearOf(date) {
  // Checked before constructing: `new Date(null)` is the epoch, not an invalid
  // date, so a dispatch with no date would come back as fiscal year 1969 and
  // sail past the caller's null guard instead of being refused.
  if (date === null || date === undefined || date === "") return null;
  const d = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(d.getTime())) return null;
  const year = d.getUTCFullYear();
  return d.getUTCMonth() + 1 >= FISCAL_YEAR_START_MONTH ? year : year - 1;
}

/** "2026-27", for showing a fiscal year to a human. */
export function fiscalYearLabel(fy) {
  return `${fy}-${String((fy + 1) % 100).padStart(2, "0")}`;
}

// ── Ledger accounts used by the auto entries ────────────────
// Not resolved here (this file is client-safe): the server resolves them with
// resolveDispatchAutoAccounts() in lib/ledger/autoEntryAccounts.js — the same
// item-category → Account Settings rules buildAutoEntries() in
// app/api/voucher/[type]/route.js uses — and passes them in.
import { isLitreUnit } from "@/lib/units/litres";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

const num = (v, fallback = 0) => {
  const parsed = Number(v);
  return Number.isFinite(parsed) ? parsed : fallback;
};

// ============================================================
// Price one dispatch line off its Sale Order detail row
// ============================================================
// Returns the priced shape plus an `issue` when the line cannot be priced.
// Issues are what mark a dispatch "blocked" in the UI — the Sale Order has to
// be corrected before an invoice can be raised.

export function priceLine(line, soDetail, { freeOfCost = false } = {}) {
  const qty = num(line.qty); // KILOGRAMS — the stock figure
  const qty_ltr = num(line.qty_ltr);
  const litreLine = isLitreUnit(line.unit);
  const additional_tax = num(line.additional_tax);
  const itemName = line.itemDetails?.item || `Item #${line.itcd}`;

  // A LTR line is priced on its litres: the Sale Order rate for it is a price
  // per litre, not per KG. A KG line prices on KG exactly as before.
  // See lib/units/litres.js.
  const pricedQty = litreLine ? qty_ltr : qty;

  const base = {
    line_id: line.id,
    itcd: line.itcd,
    itemName,
    itemCode: line.itemDetails?.code ?? null,
    unit: litreLine ? "LTR" : line.unit || line.itemDetails?.unit || "",
    batch_no: line.batch_no || "",
    no_of_pack: num(line.no_of_pack),
    qty_per_pack: num(line.qty_per_pack),
    qty,
    qty_ltr,
    // What the amount below was actually multiplied by, so the invoicing page
    // can show the customer the quantity they are being billed for.
    priced_qty: pricedQty,
    additional_tax,
  };

  if (freeOfCost) {
    return {
      ...base,
      rate: 0,
      st_rate: 0,
      gross_amount: 0,
      st_amount: 0,
      amount_with_st: 0,
      issue: null,
    };
  }

  // `soDetail` is the rate source priceDispatch() chose for this line: the
  // rate saved on the dispatch, else the Sale Order line, else the customer's
  // price list. Issue types are kept for the screens that key on them.
  if (!soDetail) {
    return {
      ...base,
      rate: 0,
      st_rate: 0,
      gross_amount: 0,
      st_amount: 0,
      amount_with_st: 0,
      issue: {
        type: "ITEM_NOT_IN_SO",
        message: `No rate for "${itemName}" — enter it on the dispatch, the Sale Order, or the customer's price list`,
      },
    };
  }

  const rate = num(soDetail.rate);
  const st_rate = num(soDetail.st_rate);

  if (rate <= 0) {
    return {
      ...base,
      rate: 0,
      st_rate,
      gross_amount: 0,
      st_amount: 0,
      amount_with_st: 0,
      issue: {
        type: "SO_RATE_MISSING",
        message: `Rate for "${itemName}" is 0 — enter it on the dispatch, the Sale Order, or the customer's price list`,
      },
    };
  }

  // A litre line whose KG never got derived means the item lost its ltr_rate
  // between dispatch and invoicing. Refuse rather than invoice a quantity that
  // does not agree with the stock movement.
  if (litreLine && qty_ltr > 0 && qty <= 0) {
    return {
      ...base,
      rate,
      st_rate,
      gross_amount: 0,
      st_amount: 0,
      amount_with_st: 0,
      issue: {
        type: "LTR_NOT_CONVERTED",
        message: `"${itemName}" is in LTR but has no KG conversion — set the item's LTR Rate, then re-post the dispatch`,
      },
    };
  }

  const gross_amount = round2(pricedQty * rate);
  const st_amount = round2((gross_amount * (st_rate + additional_tax)) / 100);

  return {
    ...base,
    rate,
    st_rate,
    gross_amount,
    st_amount,
    amount_with_st: round2(gross_amount + st_amount),
    issue: null,
  };
}

// ============================================================
// Price a whole dispatch
// ============================================================
// `master` must be a TransactionsMaster with `transactions`,
// `ordersSO.orderDetails` and `acno` included.

export function priceDispatch(master) {
  const freeOfCost = master.ordersSO?.freeOfCost === true;
  const soDetails = master.ordersSO?.orderDetails ?? [];
  const soByItem = new Map(
    soDetails.filter((d) => d.itcd != null).map((d) => [d.itcd, d]),
  );

  // A litre line whose KG never got derived has qty = 0 but litres on it.
  // Keeping it in means priceLine can name the actual problem (the item lost
  // its LTR Rate) instead of it being dropped here and reported as the far
  // vaguer "no item lines with quantity".
  const itemLines = (master.transactions ?? []).filter(
    (t) =>
      t.sub_tran_id === 1 &&
      t.itcd != null &&
      (num(t.qty) > 0 || num(t.qty_ltr) > 0),
  );

  // Customer price list (master.acno.salesItemCust, latest first).
  const priceList = new Map();
  for (const p of master.acno?.salesItemCust ?? []) {
    if (!priceList.has(p.itcd) && num(p.rate) > 0) {
      priceList.set(p.itcd, { rate: p.rate, st_rate: p.gst_rate });
    }
  }

  // Rate source per line: what the dispatch line carries (the Sale Order /
  // price-list default stamped at save, or a permitted override) → the Sale
  // Order line → the customer's price list.
  const rateSource = (line) => {
    if (num(line.rate) > 0) return { rate: line.rate, st_rate: line.st_rate };
    const so = soByItem.get(line.itcd);
    if (so && num(so.rate) > 0) return so;
    return priceList.get(line.itcd) ?? so ?? null;
  };

  const lines = itemLines.map((line) =>
    priceLine(line, rateSource(line), { freeOfCost }),
  );

  const issues = lines
    .filter((l) => l.issue)
    .map((l) => ({ ...l.issue, itcd: l.itcd, itemName: l.itemName }));

  if (itemLines.length === 0) {
    issues.unshift({
      type: "NO_LINES",
      message: "This dispatch has no item lines with quantity",
    });
  }

  const summed = lines.reduce(
    (acc, l) => ({
      qty: acc.qty + l.qty,
      qty_ltr: acc.qty_ltr + l.qty_ltr,
      gross_amount: acc.gross_amount + l.gross_amount,
      st_amount: acc.st_amount + l.st_amount,
      amount_with_st: acc.amount_with_st + l.amount_with_st,
    }),
    { qty: 0, qty_ltr: 0, gross_amount: 0, st_amount: 0, amount_with_st: 0 },
  );

  const totals = {
    qty: round2(summed.qty),         // KG — the stock total
    qty_ltr: round2(summed.qty_ltr), // litres, where any line carries them
    gross_amount: round2(summed.gross_amount),
    st_amount: round2(summed.st_amount),
    amount_with_st: round2(summed.amount_with_st),
  };

  return {
    lines,
    issues,
    freeOfCost,
    totals,
    // Free-of-cost orders legitimately price at 0 and stay invoiceable.
    canInvoice: issues.length === 0,
  };
}

// ============================================================
// Auto entries (sub_tran_id = 3)
// ============================================================
// Same shape buildAutoEntries() produces for tran_code=6: party debited with
// gross + sales tax, sales tax credited per output-tax account, and the
// transporter pair when the dispatch carries transport charges.
//
// `accounts` comes from resolveDispatchAutoAccounts(master, priced.lines)
// (lib/ledger/autoEntryAccounts.js, server only):
//   { taxEntries: [{ acno, amount }], transport: { freightAcno, transporterAcno } | null }

export function buildDispatchAutoEntries(tran_id, master, totals, accounts) {
  if (!accounts) {
    throw new Error("buildDispatchAutoEntries: resolve the accounts with resolveDispatchAutoAccounts() first");
  }
  const entries = [
    {
      tran_id,
      sub_tran_id: 3,
      narration1: "Auto Entry",
      damt: round2(totals.gross_amount + totals.st_amount),
      camt: 0,
      acno: master.pycd ?? null,
    },
  ];

  for (const { acno, amount } of accounts.taxEntries ?? []) {
    if (!round2(amount)) continue;
    entries.push({
      tran_id,
      sub_tran_id: 3,
      narration1: "ST Auto Entry",
      damt: 0,
      camt: round2(amount),
      acno,
    });
  }

  const trAmount = num(master.tr_amount);
  if (accounts.transport && trAmount) {
    entries.push(
      {
        tran_id,
        sub_tran_id: 3,
        narration1: "Transport Auto Entry",
        damt: trAmount,
        camt: 0,
        acno: accounts.transport.freightAcno,
      },
      {
        tran_id,
        sub_tran_id: 3,
        narration1: "Transport Auto Entry",
        damt: 0,
        camt: trAmount,
        acno: accounts.transport.transporterAcno,
      },
    );
  }

  return entries;
}

// ============================================================
// Invoiced dispatch — what is SAVED, and does it still agree?
// ============================================================
// priceDispatch() is a fresh calculation from today's Sale Order. For an
// invoiced dispatch the page must show what is actually on the document (that
// is what the entry screen, the ledger and the printed invoice read), and say
// when it disagrees — e.g. an edit wiped the rates, the Sale Order rate changed
// after invoicing, or the auto entries are missing / on the wrong account.
//
// `record.transactions` must carry the stored money columns (rate, st_rate,
// gross_amount, st_amount); `autoRows` are its sub_tran_id=3 rows.
// `taxAcnos` are the output-tax accounts its lines resolve to
// (expectedOutputTaxAccounts() in lib/ledger/autoEntryAccounts.js); without
// them the tax-account check is skipped.
// Returns { lines, totals, ledgerIssues } in the same shape priceDispatch uses.

const MONEY_TOLERANCE = 1; // rupees — rounding across lines

export function savedInvoicePricing(record, priced, autoRows = [], { taxAcnos = null } = {}) {
  const byId = new Map(priced.lines.map((l) => [l.line_id, l]));
  const itemLines = (record.transactions ?? []).filter(
    (t) => t.sub_tran_id === 1 && t.itcd != null && (num(t.qty) > 0 || num(t.qty_ltr) > 0),
  );

  const lines = itemLines.map((t) => {
    const p = byId.get(t.id) ?? {};
    const gross_amount = round2(t.gross_amount);
    const st_amount = round2(t.st_amount);
    return {
      ...p,
      line_id: t.id,
      rate: num(t.rate),
      st_rate: num(t.st_rate),
      gross_amount,
      st_amount,
      amount_with_st: round2(gross_amount + st_amount),
      issue: null,
      expected_rate: p.rate ?? null,
    };
  });

  const sum = (k) => round2(lines.reduce((s, l) => s + num(l[k]), 0));
  const totals = {
    qty: priced.totals.qty,
    qty_ltr: priced.totals.qty_ltr,
    gross_amount: sum("gross_amount"),
    st_amount: sum("st_amount"),
    amount_with_st: sum("amount_with_st"),
  };

  const ledgerIssues = [];
  const differs = (a, b) => Math.abs(num(a) - num(b)) > MONEY_TOLERANCE;

  if (itemLines.length === 0) {
    // Re-pricing cannot help: there is nothing to price. The dispatch has to
    // be re-entered (or its lines restored) before the invoice means anything.
    ledgerIssues.push({
      type: "NO_LINES",
      message: "This invoice has no item lines saved — re-applying rates cannot fix it; the dispatch lines must be re-entered",
    });
  }

  if (!priced.freeOfCost) {
    const zero = lines.filter((l) => l.rate <= 0 && num(l.expected_rate) > 0);
    if (zero.length) {
      ledgerIssues.push({
        type: "RATE_WIPED",
        message: `Saved rate is 0 on ${zero.length} line${zero.length === 1 ? "" : "s"} (${zero.map((l) => l.itemName).join(", ")}) — the entry has no price`,
      });
    }
    if (priced.canInvoice && differs(totals.amount_with_st, priced.totals.amount_with_st)) {
      ledgerIssues.push({
        type: "PRICE_DIFFERS",
        message: `Saved amount ${totals.amount_with_st.toFixed(2)} differs from the Sale Order price ${priced.totals.amount_with_st.toFixed(2)}`,
      });
    }
  }

  const party = autoRows.filter((r) => r.narration1 === "Auto Entry");
  const st = autoRows.filter((r) => r.narration1 === "ST Auto Entry");
  const partyDr = round2(party.reduce((s, r) => s + num(r.damt), 0));
  const stCr = round2(st.reduce((s, r) => s + num(r.camt), 0));

  if (party.length === 0 && totals.amount_with_st > 0) {
    ledgerIssues.push({
      type: "NO_LEDGER",
      message: "No ledger entries — the customer is not debited for this invoice",
    });
  } else if (differs(partyDr, totals.amount_with_st)) {
    ledgerIssues.push({
      type: "LEDGER_DIFFERS",
      message: `Customer is debited ${partyDr.toFixed(2)} but the lines total ${totals.amount_with_st.toFixed(2)}`,
    });
  }
  if (differs(stCr, totals.st_amount)) {
    ledgerIssues.push({
      type: "ST_DIFFERS",
      message: `Sales tax credited ${stCr.toFixed(2)} but the lines carry ${totals.st_amount.toFixed(2)}`,
    });
  }
  if (Array.isArray(taxAcnos) && taxAcnos.length) {
    const expected = new Set(taxAcnos.map(Number));
    const wrongSt = st.filter((r) => !expected.has(Number(r.acno)) && num(r.camt) !== 0);
    if (wrongSt.length) {
      ledgerIssues.push({
        type: "ST_ACCOUNT",
        message: `Sales tax posted to account ${[...new Set(wrongSt.map((r) => r.acno))].join(", ")} instead of ${[...expected].join(" / ")}`,
      });
    }
  }

  return { lines, totals, ledgerIssues };
}
