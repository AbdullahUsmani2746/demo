// lib/invoicing/core.js
// ============================================================
// SERVER ONLY — Invoicing: price a physical document after the fact and post
// it to the ledger (see lib/invoicing/kinds.js for the four kinds).
//
//   listInvoicing     GET  /api/invoicing/[kind]
//   nextInvoiceNo     GET  /api/invoicing/[kind]/next-number
//   generateInvoices  POST /api/invoicing/[kind]/generate
//   unlockInvoice     POST /api/invoicing/[kind]/unlock
//
// INVOICE NUMBERS — one running series per kind (= per tran_code), no E/M
// split. Next number = 1 + MAX(numeric invoice_no) over that tran_code's
// documents EXCLUDING legacy history (invoice_series 'L'), skipping any number
// already used (a typed number ahead of the series, or a legacy row). The user
// may type their own number instead; it must be unique within the tran_code
// (case-insensitive, trimmed). Allocation and the uniqueness check both run
// under a per-tran_code advisory lock inside the generate transaction.
// invoice_series stays NULL for every invoice generated here.
// ============================================================
import { Prisma } from "@prisma/client";
import prisma from "@/lib/prisma";
import { isLitreUnit, kgToLitres, hasLtrRate, UNIT_LTR, UNIT_KG } from "@/lib/units/litres";
import { resolveItemAccounts } from "@/lib/accounts/itemAccounts";
import { resolveTaxAccounts, buildTaxEntriesFor } from "@/lib/ledger/autoEntryAccounts";
import { checkPeriodLock } from "@/lib/periodLock";
import { isSuperAdmin } from "@/lib/auth/roles";
import { documentScopeWhere, documentScopeError } from "@/lib/auth/documentScope";
import { packingOnlyWhere } from "@/lib/packing/returnable";
import { getProductionSetup } from "@/lib/production/setup";
import { defaultRatesFor } from "@/lib/invoicing/rates";
import {
  kindConfig,
  isInvoicedMaster,
  docNoOf,
  docLabelOf,
  LEGACY_SERIES,
} from "@/lib/invoicing/kinds";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const num = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const INT4_MAX = 2147483647;
const MAX_INVOICE_NO_LENGTH = 150;
const MAX_VENDOR_BILL_LENGTH = 60;
const BALANCE_TOLERANCE = 0.01;

export class InvoicingError extends Error {
  constructor(message, status = 422) {
    super(message);
    this.status = status;
  }
}

// ============================================================
// What a document is loaded with
// ============================================================
const ORDER_DETAILS = { select: { itcd: true, rate: true, st_rate: true, unit: true }, orderBy: { id: "asc" } };

export const INVOICING_INCLUDE = {
  acno: { select: { acno: true, acname: true, lock: true } },
  godownDetails: { select: { id: true, godown: true } },
  ordersSO: { select: { order_no: true, freeOfCost: true, dispatchWithoutGodown: true, orderDetails: ORDER_DETAILS } },
  ordersPO: { select: { order_no: true, orderDetails: ORDER_DETAILS } },
  transactions: {
    where: { sub_tran_id: 1 },
    orderBy: { id: "asc" },
    select: {
      id: true,
      sub_tran_id: true,
      itcd: true,
      acno: true,
      unit: true,
      qty: true, // KG — the stock movement
      qty_ltr: true, // litres — what a LTR line is priced on
      ack_qty: true, // acknowledged qty (billing unit) — NULL = the billable qty
      rate: true,
      st_rate: true,
      additional_tax: true,
      gross_amount: true,
      st_amount: true,
      damt: true,
      camt: true,
      attachments: true, // files on the line (/api/voucher/attachments)
      line_type: true, // dispatch line sent on Trial / Rate Negotiation — priced 0 (onTrial)
      itemDetails: { select: { item: true, code: true, unit: true, ltr_rate: true } }, // ltr_rate = density (KG per LTR)
    },
  },
};

const itemLinesOf = (master) => (master.transactions ?? []).filter((t) => t.sub_tran_id === 1 && t.itcd != null);

// A dispatch line sent on Trial / Rate Negotiation (Transactions.line_type,
// stamped at dispatch — Features "orders.trialLineBilling"): priced 0 on the
// Sale Invoice, billed later from its own dispatch part (lib/dispatch/trialBilling.js).
// The stamp is data: a dispatch typed while the feature was on keeps pricing so.
const TRIAL_PICK = { rate: 0, st_rate: 0, source: "trial" };
const onTrial = (kind, t) => kind === "sale" && (t?.line_type === "TRIAL" || t?.line_type === "RATE_NEG");
/** Every item line on trial: nothing to bill on this dispatch. */
const allOnTrial = (kind, rawLines) => rawLines.length > 0 && rawLines.every((t) => onTrial(kind, t));
const ALL_TRIAL_MESSAGE =
  "Every line is on Trial / Rate Negotiation — nothing to bill here. Items the client approves are billed from \"Approved trial items\".";

// ============================================================
// Billed quantity
// ============================================================
// A line's BILLABLE qty is its physical qty in the unit it is priced on:
// qty_ltr on a LTR line, qty (KG) otherwise. The invoice is billed on the
// ACKNOWLEDGED qty (Transactions.ack_qty, same unit) — NULL means "not
// acknowledged separately" = the billable qty. Stock never reads ack_qty.
const QTY_EPSILON = 1e-6;

/** Physical qty of a line in its billing unit (litres on a LTR line). */
export function billableQtyOf(t) {
  return isLitreUnit(t.unit) ? num(t.qty_ltr) : num(t.qty);
}

/**
 * The qty a line is billed on: `ack` when set, else the billable qty.
 * `ack` defaults to the stored t.ack_qty; pass null for "no acknowledgement".
 */
export function billedQtyOf(t, ack = t.ack_qty) {
  return ack === null || ack === undefined ? billableQtyOf(t) : num(ack);
}


/**
 * The acknowledged qty a line will be stored with.
 *   raw undefined     → the stored t.ack_qty (kept from an unlocked invoice)
 *   raw null / ""     → none (bill the billable qty)
 *   raw number/string → must be finite and ≥ 0 (may exceed the billable qty)
 * Returns null when there is none or it equals the billable qty.
 * Throws InvoicingError naming the line on a bad value.
 */
function resolveAckQty(t, raw) {
  const itemName = t.itemDetails?.item ?? `Item #${t.itcd}`;
  const where = `"${itemName}" (line ${t.id})`;
  let ack;
  if (raw === undefined) {
    ack = t.ack_qty === null || t.ack_qty === undefined ? null : Number(t.ack_qty);
  } else if (raw === null || raw === "") {
    ack = null;
  } else if (typeof raw === "number" || (typeof raw === "string" && raw.trim() !== "")) {
    ack = Number(raw);
  } else {
    throw new InvoicingError(`Acknowledged qty for ${where} must be a number`);
  }
  if (ack === null) return null;
  if (!Number.isFinite(ack)) throw new InvoicingError(`Acknowledged qty for ${where} must be a number`);
  if (ack < 0) throw new InvoicingError(`Acknowledged qty for ${where} cannot be negative`);
  // May be more than the billable qty (the customer acknowledged more, e.g.
  // 995 on a 990 KG dispatch): it only prices the invoice, stock keeps qty.
  const billable = billableQtyOf(t);
  return Math.abs(ack - billable) <= QTY_EPSILON ? null : ack;
}

// ============================================================
// Billing unit — KG or LTR, chosen on the invoice
// ============================================================
// On Sale and Purchase Invoicing (kindConfig().unitSwitch) a line may be
// billed per LTR: litres = KG ÷ density, amount = litres × rate. Stock never
// changes — `qty` stays the KG that moved; only `unit` and `qty_ltr` are
// written with the invoice. Density (KG per LTR) defaults to the item's LTR
// Rate and may be overwritten for this invoice; the one used is kept as
// qty ÷ qty_ltr, so no column of its own. A dispatch line whose Sale Order
// line is in LTR stays LTR — the customer was quoted per litre.

/** Density a line is billed with now: from its own litres, else the item's. */
function densityOf(t) {
  const qty = num(t.qty);
  const ltr = num(t.qty_ltr);
  if (isLitreUnit(t.unit) && qty > 0 && ltr > 0) return Math.round((qty / ltr) * 10000) / 10000;
  return hasLtrRate(t.itemDetails?.ltr_rate) ? Number(t.itemDetails.ltr_rate) : null;
}

/** True when the line's unit may not be changed on the invoice. */
function unitLocked(t, master, kind) {
  if (!kindConfig(kind)?.unitSwitch) return true;
  if (kind !== "sale") return false;
  const soLine = (master.ordersSO?.orderDetails ?? []).find((d) => d.itcd === t.itcd);
  return isLitreUnit(soLine?.unit);
}

/**
 * The line as it will be billed: the requested unit / density applied.
 * `unit` undefined = as stored. Throws InvoicingError on a bad request.
 */
function withBillingUnit(t, master, kind, unit, density) {
  if (unit === undefined || unit === null || unit === "") return t;
  const itemName = t.itemDetails?.item ?? `Item #${t.itcd}`;
  const wantLtr = isLitreUnit(unit);
  const isLtr = isLitreUnit(t.unit);
  if (unitLocked(t, master, kind)) {
    if (wantLtr !== isLtr) {
      throw new InvoicingError(`"${itemName}" was ordered in ${isLtr ? "LTR" : "KG"} — its unit cannot be changed on the invoice`);
    }
    return t;
  }
  if (!wantLtr) return isLtr ? { ...t, unit: UNIT_KG } : t;
  const blank = density === undefined || density === null || density === "";
  if (isLtr && blank) return t;
  const d = blank ? densityOf(t) : Number(density);
  if (!hasLtrRate(d)) {
    throw new InvoicingError(`Enter the density (KG per LTR) for "${itemName}" — or set the item's LTR Rate in Item Setup`);
  }
  const qty_ltr = kgToLitres(t.qty, d);
  if (isLtr && Math.abs(qty_ltr - num(t.qty_ltr)) < 0.0005) return t;
  return { ...t, unit: UNIT_LTR, qty_ltr };
}

// ============================================================
// Pricing one line
// ============================================================
/**
 * Line in the API shape. `pick` = { rate, st_rate, source }.
 * saved=true reads the stored amounts (an invoiced document).
 * ackQty = the acknowledged qty to bill on (default: the stored one; null =
 * the billable qty).
 *   priced_qty / billable_qty  physical qty in the billing unit
 *   ack_qty                    acknowledged qty, null when not set separately
 *   billed_qty                 what gross is computed on (ack_qty ?? billable)
 */
function priceLine(t, pick, { saved = false, lineSide = "camt", ackQty = t.ack_qty } = {}) {
  const litre = isLitreUnit(t.unit);
  const qty = num(t.qty);
  const qty_ltr = num(t.qty_ltr);
  const priced_qty = litre ? qty_ltr : qty;
  const ack_qty = ackQty === null || ackQty === undefined ? null : num(ackQty);
  const billed_qty = billedQtyOf(t, ack_qty);
  const additional_tax = num(t.additional_tax);
  const rate = num(pick.rate);
  const st_rate = num(pick.st_rate);

  let gross_amount;
  let st_amount;
  if (saved) {
    // A value-only legacy line keeps its amount in damt/camt, not gross_amount.
    gross_amount = round2(num(t.gross_amount) || num(t[lineSide]));
    st_amount = round2(t.st_amount);
  } else {
    gross_amount = round2(billed_qty * rate);
    st_amount = round2((gross_amount * (st_rate + additional_tax)) / 100);
  }

  return {
    line_id: t.id,
    itcd: t.itcd,
    item: t.itemDetails?.item ?? `Item #${t.itcd}`,
    item_code: t.itemDetails?.code ?? null,
    unit: litre ? "LTR" : t.unit || t.itemDetails?.unit || "",
    qty,
    qty_ltr,
    density: densityOf(t),
    item_density: hasLtrRate(t.itemDetails?.ltr_rate) ? Number(t.itemDetails.ltr_rate) : null,
    priced_qty,
    billable_qty: priced_qty,
    ack_qty,
    billed_qty,
    rate,
    st_rate,
    additional_tax,
    gross_amount,
    st_amount,
    total: round2(gross_amount + st_amount),
    rate_source: pick.source,
    attachments: t.attachments ?? [],
  };
}

function totalsOf(lines) {
  const sum = (k) => round2(lines.reduce((s, l) => s + num(l[k]), 0));
  return { qty: sum("qty"), gross: sum("gross_amount"), tax: sum("st_amount"), total: sum("total") };
}

/** Issues that stop a pending document from being invoiced as it stands. */
function pendingIssues(master, lines, rawLines, kind) {
  const issues = [];
  const cfg = kindConfig(kind);
  if (!master.pycd || !master.acno) {
    issues.push({ type: "NO_PARTY", message: `No ${cfg.partyLabel.toLowerCase()} on this ${cfg.docLabel.toLowerCase()}` });
  } else if (master.acno.lock === true) {
    issues.push({ type: "PARTY_LOCKED", message: `${cfg.partyLabel} account is locked — contact Finance` });
  }
  if (!rawLines.length) {
    issues.push({ type: "NO_LINES", message: `This ${cfg.docLabel.toLowerCase()} has no item lines` });
  }
  const freeOfCost = kind === "sale" && master.ordersSO?.freeOfCost === true;
  for (const t of rawLines) {
    if (isLitreUnit(t.unit) && num(t.qty_ltr) > 0 && num(t.qty) <= 0) {
      issues.push({
        type: "LTR_NOT_CONVERTED",
        message: `"${t.itemDetails?.item ?? t.itcd}" is in LTR but has no KG conversion — set the item's LTR Rate and re-save the document`,
      });
    }
    // A stored acknowledgement that no longer fits the line (should not
    // happen: re-saving the document recreates its lines with ack_qty NULL).
    // The screen's own ack value replaces it (see liveIssues in format.js).
    try {
      resolveAckQty(t, undefined);
    } catch (err) {
      issues.push({ type: "ACK_INVALID", line_id: t.id, message: err.message });
    }
  }
  if (!freeOfCost && allOnTrial(kind, rawLines)) {
    issues.push({ type: "ALL_TRIAL", message: ALL_TRIAL_MESSAGE });
  }
  if (!freeOfCost) {
    for (const l of lines) {
      if (l.trial) continue; // priced 0 on purpose
      if (l.rate <= 0 && l.billed_qty > 0) {
        issues.push({ type: "NO_RATE", line_id: l.line_id, message: `No rate for "${l.item}" — enter one` });
      }
    }
  }
  return issues;
}

// manual_dc / manual_grn = the user's paper-book numbers (TransactionsMaster.manual_no):
// a dispatch's Manual DC No, a GRN's / dispatch return's Manual GRN No. A return
// also gets its dispatch's Manual DC No (added by listInvoicing).
function refOf(master, kind) {
  const manual = String(master.manual_no ?? "").trim() || null;
  if (kind === "sale") return { so_no: master.so_no ?? null, manual_dc: manual };
  if (kind === "purchase") return { po_no: master.po_no ?? null, manual_grn: manual };
  if (kind === "sale-return") {
    return { dispatch_no: master.dispatch_no ?? null, so_no: master.so_no ?? null, manual_dc: null, manual_grn: manual };
  }
  return { grn_no: master.grn_no ?? null, po_no: master.po_no ?? null };
}

/** One row of the listing. `defaults` = Map<line_id, pick> for pending docs. */
function buildRow(master, kind, defaults) {
  const cfg = kindConfig(kind);
  const invoiced = isInvoicedMaster(master);
  const rawLines = itemLinesOf(master);
  const lines = rawLines.map((t) =>
    invoiced
      ? priceLine(t, { rate: t.rate, st_rate: t.st_rate, source: "saved" }, { saved: true, lineSide: cfg.lineSide })
      : {
          ...priceLine(t, onTrial(kind, t) ? TRIAL_PICK : defaults.get(t.id) ?? { rate: 0, st_rate: 0, source: "none" }),
          // Billing unit KG / LTR may be switched on this invoice (withBillingUnit).
          unit_switch: !unitLocked(t, master, kind),
        },
  ).map((l, i) => (onTrial(kind, rawLines[i]) ? { ...l, trial: rawLines[i].line_type } : l));
  const row = {
    tran_id: master.tran_id,
    doc_no: docNoOf(master, kind),
    doc_label: docLabelOf(master, kind),
    dated: master.dated,
    party: master.acno ? { acno: master.acno.acno, acname: master.acno.acname } : { acno: master.pycd ?? null, acname: null },
    godown: master.godownDetails ? { id: master.godownDetails.id, name: master.godownDetails.godown } : null,
    invoice_no: String(master.invoice_no ?? "").trim() || null,
    invoiced,
    legacy: master.invoice_series === LEGACY_SERIES,
    ref: refOf(master, kind),
    // A Free of Cost Sale Order: lines at rate 0 are allowed (no NO_RATE).
    free_of_cost: kind === "sale" && master.ordersSO?.freeOfCost === true,
    // A Despatch Without Godown Sale Order: credited to the No Godown Sale Acno.
    without_godown: kind === "sale" && master.ordersSO?.dispatchWithoutGodown === true,
    lines,
    // Files on the document itself (each line carries its own).
    attachments: master.attachments ?? [],
    totals: totalsOf(lines),
    issues: invoiced ? [] : pendingIssues(master, lines, rawLines, kind),
  };
  if (cfg.purchaseSide) {
    row.vendor_bill_no = master.vendor_bill_no ?? null;
    row.bill_date = master.bill_date ?? null;
  }
  return row;
}

// ============================================================
// Listing
// ============================================================
function parseDay(value, endOfDay = false) {
  if (!value) return null;
  const m = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  const d = m ? new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])) : new Date(value);
  if (Number.isNaN(d.getTime())) return null;
  if (endOfDay) d.setHours(23, 59, 59, 999);
  else d.setHours(0, 0, 0, 0);
  return d;
}

const PENDING_WHERE = {
  AND: [
    { OR: [{ invoice_no: null }, { invoice_no: "" }] },
    { OR: [{ invoice_series: null }, { NOT: { invoice_series: LEGACY_SERIES } }] },
  ],
};
const INVOICED_WHERE = {
  OR: [
    { AND: [{ invoice_no: { not: null } }, { NOT: { invoice_no: "" } }] },
    { invoice_series: LEGACY_SERIES },
  ],
};

/**
 * GET /api/invoicing/[kind]
 * params: status (pending|invoiced|all), from, to, party, search, page, limit
 */
export async function listInvoicing(kind, params, session) {
  const cfg = kindConfig(kind);
  const status = ["pending", "invoiced", "all"].includes(params.status) ? params.status : "pending";
  const page = Math.max(1, parseInt(params.page, 10) || 1);
  const limit = Math.min(200, Math.max(1, parseInt(params.limit, 10) || 50));
  const search = String(params.search ?? "").trim();

  const base = [{ tran_code: cfg.tran_code }];
  const from = parseDay(params.from);
  const to = parseDay(params.to, true);
  if (from || to) base.push({ dated: { ...(from && { gte: from }), ...(to && { lte: to }) } });

  const party = Number(params.party?.value ?? params.party);
  if (Number.isInteger(party) && party > 0 && party <= INT4_MAX) base.push({ pycd: party });

  if (search) {
    const n = Number(search);
    const numeric =
      Number.isSafeInteger(n) && n >= 0 && n <= INT4_MAX
        ? [{ tran_id: n }, { vr_no: n }, { [cfg.docNoField]: n }, { so_no: n }, { po_no: n }]
        : [];
    // A dispatch return is also found by its dispatch's Manual DC No.
    const returnDispatchNos =
      kind === "sale-return"
        ? (
            await prisma.transactionsMaster.findMany({
              where: { tran_code: 6, manual_no: { contains: search, mode: "insensitive" } },
              select: { dispatch_no: true },
              take: 500,
            })
          )
            .map((d) => d.dispatch_no)
            .filter((n) => n != null)
        : [];
    base.push({
      OR: [
        ...numeric,
        // Manual DC / GRN No (the paper book number).
        { manual_no: { contains: search, mode: "insensitive" } },
        ...(returnDispatchNos.length ? [{ dispatch_no: { in: returnDispatchNos } }] : []),
        { invoice_no: { contains: search, mode: "insensitive" } },
        ...(cfg.purchaseSide ? [{ vendor_bill_no: { contains: search, mode: "insensitive" } }] : []),
        { acno: { acname: { contains: search, mode: "insensitive" } } },
      ],
    });
  }

  // Data scope (Admin → Permissions): only documents of the user's godowns.
  base.push(...(await documentScopeWhere(session, cfg.tran_code)));

  // Empty returnable drums only (a customer's back on a GRN, a vendor's going
  // back on a GRN Return) — nothing to bill (lib/packing/returnable.js,
  // Settings → Features "documents.returnablePacking"; such documents exist
  // only from that feature, so the filter needs no switch of its own).
  if (kind === "purchase" || kind === "purchase-return") {
    const { packingCategoryIds } = await getProductionSetup();
    base.push({ NOT: packingOnlyWhere(packingCategoryIds, { grn: kind === "purchase" }) });
  }

  const statusWhere = status === "pending" ? PENDING_WHERE : status === "invoiced" ? INVOICED_WHERE : null;
  const where = { AND: statusWhere ? [...base, statusWhere] : base };

  const [total, pending, invoiced, masters, next] = await Promise.all([
    prisma.transactionsMaster.count({ where }),
    prisma.transactionsMaster.count({ where: { AND: [...base, PENDING_WHERE] } }),
    prisma.transactionsMaster.count({ where: { AND: [...base, INVOICED_WHERE] } }),
    prisma.transactionsMaster.findMany({
      where,
      include: INVOICING_INCLUDE,
      // Pending: oldest first (the queue). Invoiced / all: newest first.
      orderBy: status === "pending" ? [{ dated: "asc" }, { tran_id: "asc" }] : [{ dated: "desc" }, { tran_id: "desc" }],
      skip: (page - 1) * limit,
      take: limit,
    }),
    nextInvoiceNo(prisma, cfg.tran_code),
  ]);

  const pendingDocs = masters.filter((m) => !isInvoicedMaster(m));
  const defaults = await defaultRatesFor(kind, pendingDocs);

  const rows = masters.map((m) => buildRow(m, kind, defaults));
  if (kind === "sale-return") {
    // Each return's dispatch's Manual DC No — one lookup for the page.
    const nos = [...new Set(rows.map((r) => r.ref.dispatch_no).filter((n) => n != null))];
    const dcs = nos.length
      ? await prisma.transactionsMaster.findMany({
          where: { tran_code: 6, dispatch_no: { in: nos }, manual_no: { not: null } },
          select: { dispatch_no: true, manual_no: true },
        })
      : [];
    const byNo = new Map(dcs.map((d) => [String(d.dispatch_no), String(d.manual_no).trim() || null]));
    for (const r of rows) r.ref.manual_dc = byNo.get(String(r.ref.dispatch_no)) ?? null;
  }

  return {
    data: rows,
    total,
    page,
    limit,
    summary: { pending, invoiced },
    next_invoice_no: next,
  };
}

// ============================================================
// Invoice numbers
// ============================================================
const SERIES_LOCK_BASE = 61_000_000;
const NUMERIC_RE = "^[0-9]{1,15}$";

/** Serialises numbering + uniqueness checks per tran_code (transaction-scoped). */
export async function lockInvoiceSeries(tx, tran_code) {
  // pg_advisory_xact_lock() returns void, which $queryRaw cannot read — cast.
  await tx.$queryRaw`SELECT pg_advisory_xact_lock(${SERIES_LOCK_BASE + Number(tran_code)}::bigint)::text AS locked`;
}

/**
 * The number the next generated invoice of this tran_code would get. Preview
 * only, unless `client` is a transaction holding lockInvoiceSeries().
 */
export async function nextInvoiceNo(client, tran_code) {
  const tc = Number(tran_code);
  const rows = await client.$queryRaw`
    SELECT COALESCE(MAX(CASE WHEN btrim(invoice_no) ~ ${NUMERIC_RE} THEN btrim(invoice_no)::bigint END), 0)::text AS max_no
    FROM "TRANSACTIONS_MASTER"
    WHERE tran_code = ${tc}
      AND invoice_series IS DISTINCT FROM 'L'
  `;
  let candidate = Number(rows?.[0]?.max_no ?? 0) + 1;

  // Numbers already taken at or above the candidate — by a legacy row, or a
  // typed number with leading zeros ("0042") — are skipped.
  const taken = await client.$queryRaw`
    SELECT DISTINCT n::text AS n FROM (
      SELECT CASE WHEN btrim(invoice_no) ~ ${NUMERIC_RE} THEN btrim(invoice_no)::bigint END AS n
      FROM "TRANSACTIONS_MASTER"
      WHERE tran_code = ${tc} AND invoice_no IS NOT NULL
    ) x
    WHERE n >= ${candidate}::bigint
  `;
  const used = new Set(taken.map((r) => Number(r.n)));
  while (used.has(candidate) || (await invoiceNoConflict(client, tc, String(candidate), null))) candidate += 1;
  return String(candidate);
}

/** Another document of this tran_code already carrying `invoiceNo` (case-insensitive, trimmed). */
export async function invoiceNoConflict(client, tran_code, invoiceNo, exceptTranId) {
  const rows = await client.$queryRaw`
    SELECT tran_id, vr_no, grn_no, dispatch_no, invoice_series
    FROM "TRANSACTIONS_MASTER"
    WHERE tran_code = ${Number(tran_code)}
      AND lower(btrim(invoice_no)) = lower(btrim(${invoiceNo}))
      AND tran_id <> ${Number(exceptTranId) || 0}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

/** Another document of the same vendor (and tran_code) with this vendor bill no. */
export async function vendorBillConflict(client, tran_code, pycd, billNo, exceptTranId) {
  const rows = await client.$queryRaw`
    SELECT tran_id, vr_no, grn_no, invoice_no
    FROM "TRANSACTIONS_MASTER"
    WHERE tran_code = ${Number(tran_code)}
      AND pycd = ${Number(pycd)}
      AND lower(btrim(vendor_bill_no)) = lower(btrim(${billNo}))
      AND tran_id <> ${Number(exceptTranId) || 0}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

const describeDoc = (r, kind) =>
  docLabelOf({ ...r, tran_id: r.tran_id }, kind) + (r.invoice_series === LEGACY_SERIES ? " (imported history)" : "");

// ============================================================
// Generate
// ============================================================
function parseRate(v, label) {
  if (v === undefined || v === null || v === "") return undefined;
  const n = Number(v);
  if (!Number.isFinite(n) || n < 0) throw new InvoicingError(`${label} must be a number ≥ 0`);
  return n;
}

function parseBillDate(v) {
  if (v === undefined) return undefined;
  if (v === null || v === "") return null;
  const m = String(v).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  const d = m ? new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00.000Z`) : null;
  if (!d || Number.isNaN(d.getTime())) throw new InvoicingError("Bill date must be YYYY-MM-DD");
  return d;
}

/**
 * Validate one requested invoice against its document and price it.
 * Nothing is written. Throws InvoicingError (→ "blocked").
 */
async function prepareInvoice(kind, req, master, defaults, session) {
  const cfg = kindConfig(kind);
  const tran_id = master.tran_id;

  const scopeError = await documentScopeError(session, cfg.tran_code, master);
  if (scopeError) throw new InvoicingError(scopeError, 403);

  if (isInvoicedMaster(master)) {
    throw new InvoicingError(`Already invoiced as ${String(master.invoice_no ?? "").trim() || "(imported history)"} — unlock it first`);
  }
  if (!master.pycd || !master.acno) throw new InvoicingError(`No ${cfg.partyLabel.toLowerCase()} on this document`);
  if (master.acno.lock === true) throw new InvoicingError(`${cfg.partyLabel} account is locked — contact Finance`);

  const lockError = await checkPeriodLock(master.dated, cfg.tran_code, { action: "update" });
  if (lockError) throw new InvoicingError(lockError);

  // Invoice number: typed (checked again under the lock) or blank = automatic.
  const typedNo = String(req.invoice_no ?? "").trim();
  if (typedNo.length > MAX_INVOICE_NO_LENGTH) {
    throw new InvoicingError(`Invoice number is longer than ${MAX_INVOICE_NO_LENGTH} characters`);
  }

  // Vendor bill (purchase side only).
  let vendorBillNo;
  let billDate;
  if (cfg.purchaseSide) {
    if (req.vendor_bill_no !== undefined) {
      vendorBillNo = String(req.vendor_bill_no ?? "").trim() || null;
      if (vendorBillNo && vendorBillNo.length > MAX_VENDOR_BILL_LENGTH) {
        throw new InvoicingError(`Vendor bill no is longer than ${MAX_VENDOR_BILL_LENGTH} characters`);
      }
    }
    billDate = parseBillDate(req.bill_date);
  }

  // Lines: the request's rates over the defaults; every line_id must be ours.
  const rawLines = itemLinesOf(master);
  if (!rawLines.length) throw new InvoicingError("This document has no item lines");
  const ownIds = new Set(rawLines.map((t) => t.id));
  const given = new Map();
  for (const l of Array.isArray(req.lines) ? req.lines : []) {
    const id = Number(l?.line_id);
    if (!ownIds.has(id)) throw new InvoicingError(`Line ${l?.line_id} does not belong to this document`);
    given.set(id, {
      rate: parseRate(l.rate, "Rate"),
      st_rate: parseRate(l.st_rate, "GST %"),
      ack_qty: l.ack_qty, // validated per line below (resolveAckQty)
      unit: l.unit, // KG | LTR — billing unit (withBillingUnit)
      density: l.density,
    });
  }

  const freeOfCost = kind === "sale" && master.ordersSO?.freeOfCost === true;
  if (!freeOfCost && allOnTrial(kind, rawLines)) throw new InvoicingError(ALL_TRIAL_MESSAGE);
  const lines = [];
  for (const stored of rawLines) {
    const itemName = stored.itemDetails?.item ?? `Item #${stored.itcd}`;
    const g = given.get(stored.id) ?? {};
    const t = withBillingUnit(stored, master, kind, g.unit, g.density);
    if (isLitreUnit(t.unit) && num(t.qty_ltr) > 0 && num(t.qty) <= 0) {
      throw new InvoicingError(`"${itemName}" is in LTR but has no KG conversion — set the item's LTR Rate and re-save the document`);
    }
    const def = defaults.get(t.id) ?? { rate: 0, st_rate: 0, source: "none" };
    // A stored acknowledgement is in the old unit — dropped when it changed.
    const unitChanged = t !== stored;
    const ack = resolveAckQty(unitChanged ? { ...t, ack_qty: null } : t, g.ack_qty);
    const trial = onTrial(kind, stored);
    const pick = freeOfCost
      ? { rate: 0, st_rate: 0, source: "order" }
      : trial
        ? TRIAL_PICK // whatever the request says: the goods went out on trial
      : {
          rate: g.rate ?? def.rate,
          st_rate: g.st_rate ?? def.st_rate,
          source: g.rate !== undefined ? "entered" : def.source,
        };
    // A line nobody priced is refused; an explicit 0 from the user is allowed.
    if (!freeOfCost && !trial && g.rate === undefined && !(pick.rate > 0) && billedQtyOf(t, ack) > 0) {
      throw new InvoicingError(`No rate for "${itemName}" — enter one`);
    }
    lines.push({ ...priceLine(t, pick, { ackQty: ack }), store_unit: t.unit ?? null, store_qty_ltr: t.qty_ltr ?? null });
  }

  // Accounts BEFORE any write: line account per item (category → Account
  // Settings), tax accounts for taxed lines. 422 on a gap.
  let accounts;
  try {
    const shaped = lines.map((l) => ({ itcd: l.itcd, st_amount: l.st_amount }));
    // Despatch Without Godown → the category's No Godown Sale Acno
    // (lib/dispatch/withoutGodown.js).
    const withoutGodown = kind === "sale" && master.ordersSO?.dispatchWithoutGodown === true;
    const { lineAcno, taxAcno } = await resolveItemAccounts(shaped, cfg.tran_code, { withoutGodown });
    const tax = await resolveTaxAccounts(shaped, cfg.tran_code, { taxAcno });
    accounts = { lineAcno, tax };
  } catch (err) {
    if (err?.statusCode) throw new InvoicingError(err.message, err.statusCode);
    throw err;
  }

  return { tran_id, master, typedNo, vendorBillNo, billDate, lines, accounts, totals: totalsOf(lines) };
}

/** sub_tran_id=3 rows: party (goods + tax) and tax per account. */
function buildAutoEntries(kind, prepared) {
  const cfg = kindConfig(kind);
  const { tran_id, master, lines, accounts, totals } = prepared;
  const partyAmount = round2(totals.gross + totals.tax);
  const entries = [
    {
      tran_id,
      sub_tran_id: 3,
      narration1: "Auto Entry",
      acno: master.pycd,
      damt: cfg.partySide === "Dr" ? partyAmount : 0,
      camt: cfg.partySide === "Cr" ? partyAmount : 0,
    },
  ];
  const taxRows = buildTaxEntriesFor(
    lines.map((l) => ({ itcd: l.itcd, st_amount: l.st_amount })),
    cfg.tran_code,
    tran_id,
    accounts.tax,
  ).map((r) => ({ ...r, damt: round2(r.damt), camt: round2(r.camt) }));
  entries.push(...taxRows);

  // The tax rows must carry the whole tax the party row includes.
  const taxPosted = round2(taxRows.reduce((s, r) => s + r.damt + r.camt, 0));
  if (Math.abs(taxPosted - totals.tax) > BALANCE_TOLERANCE) {
    throw new InvoicingError(`Sales tax ${totals.tax.toFixed(2)} could not be fully assigned to a tax account (posted ${taxPosted.toFixed(2)}) — check Account Settings`);
  }
  return entries;
}

async function writeInvoice(tx, kind, prepared, invoiceNo) {
  const cfg = kindConfig(kind);
  const { tran_id, lines, accounts } = prepared;

  const values = lines.map((l) => {
    const damt = cfg.lineSide === "damt" ? l.gross_amount : 0;
    const camt = cfg.lineSide === "camt" ? l.gross_amount : 0;
    const acno = accounts.lineAcno[l.itcd] ?? null;
    return Prisma.sql`(
      ${l.line_id}::int,
      ${l.rate}::double precision,
      ${l.st_rate}::double precision,
      ${l.ack_qty}::double precision,
      ${l.store_unit}::varchar,
      ${l.store_qty_ltr}::double precision,
      ${l.gross_amount}::double precision,
      ${l.st_amount}::double precision,
      ${damt}::double precision,
      ${camt}::double precision,
      ${acno}::int
    )`;
  });

  // One UPDATE ... FROM (VALUES): the Prisma extension wraps every `update`
  // with a before-read and an audit insert, too costly per line.
  await tx.$executeRaw`
    UPDATE "Transactions" AS t
    SET rate = v.rate, st_rate = v.st_rate, ack_qty = v.ack_qty,
        unit = v.unit, qty_ltr = v.qty_ltr,
        gross_amount = v.gross_amount, st_amount = v.st_amount,
        damt = v.damt, camt = v.camt,
        acno = COALESCE(v.acno, t.acno)
    FROM (VALUES ${Prisma.join(values)})
      AS v(id, rate, st_rate, ack_qty, unit, qty_ltr, gross_amount, st_amount, damt, camt, acno)
    WHERE t.id = v.id AND t.tran_id = ${tran_id}
  `;

  await tx.transactions.deleteMany({ where: { tran_id, sub_tran_id: 3 } });
  await tx.transactions.createMany({ data: buildAutoEntries(kind, prepared) });

  // The voucher must balance: Σdamt = Σcamt over every row it holds.
  const [sums] = await tx.$queryRaw`
    SELECT COALESCE(SUM(damt), 0)::float8 AS d, COALESCE(SUM(camt), 0)::float8 AS c
    FROM "Transactions" WHERE tran_id = ${tran_id}
  `;
  if (Math.abs(num(sums?.d) - num(sums?.c)) > BALANCE_TOLERANCE) {
    throw new InvoicingError(
      `The entry does not balance (Dr ${num(sums?.d).toFixed(2)} / Cr ${num(sums?.c).toFixed(2)}) — the document carries other amounts; nothing was saved`,
    );
  }

  // invoiced_at: when the invoice was made (Sale Order To Invoice Time Tracking report)
  const data = { invoice_no: invoiceNo, invoice_series: null, invoiced_at: new Date() };
  if (cfg.purchaseSide) {
    if (prepared.vendorBillNo !== undefined) data.vendor_bill_no = prepared.vendorBillNo;
    if (prepared.billDate !== undefined) data.bill_date = prepared.billDate;
  }
  await tx.transactionsMaster.update({ where: { tran_id }, data });
}

/**
 * POST /api/invoicing/[kind]/generate
 * body { invoices: [ { tran_id, invoice_no?, lines: [ { line_id, rate, st_rate, ack_qty? } ], vendor_bill_no?, bill_date? } ] }
 * ack_qty: acknowledged qty in the line's billing unit (omitted = keep the
 * stored one, null/"" = none); ack_qty ≥ 0 (may exceed the billable qty; stock never reads it).
 * Each invoice in its own transaction, in request order (so blank numbers
 * come out consecutive). One bad row never rolls back another.
 */
export async function generateInvoices(kind, invoices, session) {
  const cfg = kindConfig(kind);
  const requests = (Array.isArray(invoices) ? invoices : []).filter((r) => r && typeof r === "object");
  const ids = [...new Set(requests.map((r) => Number(r.tran_id)).filter((n) => Number.isInteger(n) && n > 0))];

  const masters = ids.length
    ? await prisma.transactionsMaster.findMany({
        where: { tran_id: { in: ids }, tran_code: cfg.tran_code },
        include: INVOICING_INCLUDE,
      })
    : [];
  const byId = new Map(masters.map((m) => [m.tran_id, m]));
  const defaults = await defaultRatesFor(kind, masters.filter((m) => !isInvoicedMaster(m)));

  const results = [];
  const seen = new Set();
  for (const req of requests) {
    const tran_id = Number(req.tran_id);
    const master = byId.get(tran_id);
    if (!master) {
      results.push({ tran_id: req.tran_id ?? null, status: "failed", message: `${cfg.docLabel} not found` });
      continue;
    }
    if (seen.has(tran_id)) {
      results.push({ tran_id, status: "blocked", message: "Listed twice in this request" });
      continue;
    }
    seen.add(tran_id);

    let prepared;
    try {
      prepared = await prepareInvoice(kind, req, master, defaults, session);
    } catch (err) {
      if (!(err instanceof InvoicingError)) {
        console.error("invoicing prepare error:", err);
        results.push({ tran_id, status: "failed", message: err?.message || "Failed" });
      } else {
        results.push({ tran_id, status: "blocked", message: err.message });
      }
      continue;
    }

    try {
      const invoiceNo = await prisma.$transaction(
        async (tx) => {
          await lockInvoiceSeries(tx, cfg.tran_code);

          // Re-read under a row lock: another user may have invoiced it.
          const [fresh] = await tx.$queryRaw`
            SELECT invoice_no, invoice_series FROM "TRANSACTIONS_MASTER"
            WHERE tran_id = ${tran_id} FOR UPDATE
          `;
          if (isInvoicedMaster(fresh)) {
            throw new InvoicingError(`Already invoiced as ${String(fresh.invoice_no ?? "").trim() || "(imported history)"}`);
          }

          let no = prepared.typedNo;
          if (no) {
            const clash = await invoiceNoConflict(tx, cfg.tran_code, no, tran_id);
            if (clash) throw new InvoicingError(`Invoice no ${no} is already used by ${describeDoc(clash, kind)}`);
          } else {
            no = await nextInvoiceNo(tx, cfg.tran_code);
          }

          if (cfg.purchaseSide && prepared.vendorBillNo) {
            const clash = await vendorBillConflict(tx, cfg.tran_code, master.pycd, prepared.vendorBillNo, tran_id);
            if (clash) {
              throw new InvoicingError(
                `Vendor bill no ${prepared.vendorBillNo} is already entered for this vendor on ${describeDoc(clash, kind)}`,
              );
            }
          }

          await writeInvoice(tx, kind, prepared, no);
          return no;
        },
        { timeout: 30_000, maxWait: 20_000 },
      );
      results.push({ tran_id, status: "invoiced", invoice_no: invoiceNo, total: prepared.totals.total });
    } catch (err) {
      if (err instanceof InvoicingError) {
        results.push({ tran_id, status: "blocked", message: err.message });
      } else {
        console.error("invoicing generate error:", err);
        results.push({ tran_id, status: "failed", message: err?.message || "Failed" });
      }
    }
  }

  const invoicedCount = results.filter((r) => r.status === "invoiced").length;
  return { results, invoicedCount, failedCount: results.length - invoicedCount };
}

// ============================================================
// Unlock
// ============================================================
/**
 * POST /api/invoicing/[kind]/unlock — puts an invoiced document back in the
 * pending queue: line amounts zeroed (rate / st_rate / ack_qty kept), sub_tran_id=3 rows deleted,
 * invoice_no and invoice_series cleared. Quantities are untouched.
 * Legacy imported rows ('L') only for ADMIN.
 */
export async function unlockInvoice(kind, tran_id, session, { reason = null } = {}) {
  const cfg = kindConfig(kind);
  const id = Number(tran_id);
  if (!Number.isInteger(id) || id <= 0) throw new InvoicingError("A numeric tran_id is required", 400);

  const master = await prisma.transactionsMaster.findFirst({
    where: { tran_id: id, tran_code: cfg.tran_code },
    select: { tran_id: true, tran_code: true, dated: true, pycd: true, godown: true, godown2: true, invoice_no: true, invoice_series: true, rmk: true },
  });
  if (!master) throw new InvoicingError(`${cfg.docLabel} not found`, 404);

  const scopeError = await documentScopeError(session, cfg.tran_code, master);
  if (scopeError) throw new InvoicingError(scopeError, 403);

  if (!isInvoicedMaster(master)) throw new InvoicingError("This document is not invoiced");
  const legacy = master.invoice_series === LEGACY_SERIES;
  if (legacy && !isSuperAdmin(session)) {
    throw new InvoicingError("This is imported invoice history — only a Super Admin can unlock it", 403);
  }

  const lockError = await checkPeriodLock(master.dated, cfg.tran_code, { action: "update" });
  if (lockError) throw new InvoicingError(lockError);

  const invoiceNo = String(master.invoice_no ?? "").trim();
  const label = invoiceNo || "(imported)";
  const stamp = `[Invoice ${label} unlocked by ${session?.user?.name || session?.user?.email || "user"} on ${new Date()
    .toISOString()
    .slice(0, 10)}${reason ? `: ${reason}` : ""}]`;

  await prisma.$transaction(async (tx) => {
    // Row lock first, so a receipt knocked off meanwhile is seen here.
    await tx.$queryRaw`SELECT tran_id FROM "TRANSACTIONS_MASTER" WHERE tran_id = ${id} FOR UPDATE`;
    // Receipts / payments already knocked off against this invoice would be
    // left pointing at nothing. A return's number is a credit / debit note of
    // its own series (or, legacy, the original invoice's) — nothing is knocked
    // off against it, so only invoices are matched by number.
    const isReturn = [9, 10].includes(Number(cfg.tran_code));
    const knocked = await tx.invoiceKnockoff.count({
      where: {
        reversed_at: null,
        OR: [
          { invoice_tran_id: id },
          ...(invoiceNo && master.pycd && !isReturn ? [{ invoice_no: invoiceNo, invoice_party_acno: master.pycd }] : []),
        ],
      },
    });
    if (knocked > 0) {
      throw new InvoicingError(
        `Invoice ${invoiceNo} has ${knocked} knock-off allocation${knocked === 1 ? "" : "s"} against it — reverse them first`,
      );
    }
    // A return knocked off against invoices (Features: knockoff.matchReturns)
    // is the source of those allocations: they hold its control row below.
    const settles = await tx.invoiceKnockoff.count({ where: { source_tran_id: id, reversed_at: null } });
    if (settles > 0) {
      throw new InvoicingError(
        `This document is knocked off against ${settles} invoice allocation${settles === 1 ? "" : "s"} — reverse them on Knock-Off Review first`,
      );
    }
    // Reversed allocations only point at the rows being replaced; drop them.
    await tx.invoiceKnockoff.deleteMany({ where: { source_tran_id: id } });
    // rate / st_rate / ack_qty stay on the lines: they are the "saved"
    // default when the document is invoiced again.
    await tx.transactions.updateMany({
      where: { tran_id: id, sub_tran_id: 1 },
      data: { gross_amount: 0, st_amount: 0, damt: 0, camt: 0 },
    });
    await tx.transactions.deleteMany({ where: { tran_id: id, sub_tran_id: 3 } });
    await tx.transactionsMaster.update({
      where: { tran_id: id },
      data: { invoice_no: null, invoice_series: null, invoiced_at: null, rmk: master.rmk ? `${master.rmk} ${stamp}` : stamp },
    });
  });

  return { ok: true, invoice_no: invoiceNo || null };
}
