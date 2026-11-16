// lib/pos/posting.js
// ============================================================
// POINT OF SALE — the only writer of POS sales (tran_code 5) and POS returns
// (tran_code 12, the POS return type every stock / sales report already reads).
// Routes: app/api/pos/orders (sale), app/api/pos/returns (refund).
//
// A POS sale posts:
//   sub_tran_id 1  one line per item   Cr POS Sales (item category pos_acno → Account Settings pos_sales)
//                                      qty / rate / gross_amount, camt = net after discount,
//                                      st_rate / st_amount = its tax, godown = Settings → Point of Sale
//   sub_tran_id 2  tax                 Cr POS Sales Tax Payable (pos_tax)          when tax % > 0
//                  rounding           Cr / Dr POS Round Off (pos_round_off)       when the bill is rounded
//   sub_tran_id 3  one line per payment Dr POS Cash (pos_cash) / POS Card (pos_card) / the customer (credit)
// A POS return mirrors it (Dr sales + tax, Cr the refund account). Each return
// line keeps the sold line's id in `source_line_no`, so a line can never be
// refunded twice. The receipt's figures (tendered, change, customer name) are
// in pos_receipts / pos_payments — the books are the voucher alone.
//
// Every save: permission (route guard + finer rights here), period lock, stock
// check policy type "pos", closed godown, accounts set, one database
// transaction, written through `prisma` (audited), Entered by = the session.
// A retried save with the same clientRef returns the receipt already posted.
// ============================================================
import prisma from "@/lib/prisma";
import { can } from "@/lib/auth/permissions";
import { feature } from "@/lib/features/server";
import { checkPeriodLock } from "@/lib/periodLock";
import { resolveItemAccounts } from "@/lib/accounts/itemAccounts";
import { requireAccount, getAccount } from "@/lib/accounts/accountSettings";
import { checkStockForSave } from "@/lib/stock/checkStock";
import { closedGodownError } from "@/lib/godowns";
import { getPosSettings } from "@/lib/pos/settings";
import { computeBill, computeRefund, largestDiscountPercent, settlePayments, round2 } from "@/lib/pos/calc";

export const POS_SALE = 5;
export const POS_RETURN = 12;

export class PosError extends Error {
  constructor(message, status = 422, extra = {}) {
    super(message);
    this.status = status;
    this.statusCode = status;
    Object.assign(this, extra);
  }
}

const userIdOf = (session) => (session?.user?.id != null ? String(session.user.id) : null);

/** What this person may do at the till. */
export async function posRights(session) {
  // allShifts: every till's receipts and shifts (granted with the POS reports — the reports' drill opens receipts).
  const [sell, refund, discount, credit, dayClose, allShifts, manage] = await Promise.all(
    ["pos.sell", "pos.refund", "pos.discount", "pos.credit", "pos.dayClose", "pos.allShifts", "pos.manage"].map((c) => can(session, c)),
  );
  return { sell, refund, discount, credit, dayClose, allShifts, manage };
}

/** The cashier's open shift, or null. */
export function openShiftOf(userId, db = prisma) {
  return db.posShift.findFirst({ where: { user_id: String(userId), status: "OPEN" }, orderBy: { opened_at: "desc" } });
}

/** Next number of a voucher type, serialised so two tills never take the same one. */
async function nextNumber(tx, tranCode) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`voucher-no-${tranCode}`}))`;
  const last = await tx.transactionsMaster.findFirst({
    where: { tran_code: tranCode, vr_no: { not: null } },
    orderBy: { vr_no: "desc" },
    select: { vr_no: true },
  });
  return (last?.vr_no ?? 0) + 1;
}

const posNum = (v) => {
  const n = Number(v);
  return Number.isFinite(n) ? n : NaN;
};

async function duplicateOf(clientRef) {
  if (!clientRef) return null;
  const r = await prisma.posReceipt.findUnique({ where: { client_ref: String(clientRef).slice(0, 64) } });
  return r ? r.tran_id : null;
}

async function accountFor(method, customerAcno) {
  if (method === "CASH") return requireAccount("pos_cash");
  if (method === "CARD") return requireAccount("pos_card");
  if (method === "CREDIT") return customerAcno;
  throw new PosError(`Unknown payment method ${method}`, 400);
}

// ─────────────────────────────────────────────────────────────────────────
// SALE
// ─────────────────────────────────────────────────────────────────────────
/**
 * @param {object} session
 * @param {{ clientRef?, lines: [{ itcd, qty, rate?, discountPct?, discountAmt?, note? }],
 *           billDiscount?: { type, value }, customer?: { acno?, name?, phone? },
 *           payments: [{ method, amount, reference? }], note? }} body
 * @returns {Promise<{ tran_id: number, duplicate?: boolean, warnings: string[] }>}
 */
export async function postSale(session, body) {
  const userId = userIdOf(session);
  const dup = await duplicateOf(body?.clientRef);
  if (dup) return { tran_id: dup, duplicate: true, warnings: [] };

  const settings = await getPosSettings();
  const rights = await posRights(session);
  if (!rights.sell) throw new PosError("You may not sell at the point of sale (pos.sell).", 403);

  const shift = await openShiftOf(userId);
  if (!shift && (await feature("pos.requireShift"))) throw new PosError("Open a shift before the first sale (Shift → Open shift).");

  // ── lines ──
  const rawLines = Array.isArray(body?.lines) ? body.lines : [];
  if (!rawLines.length) throw new PosError("The bill has no items.", 400);
  const itcds = [...new Set(rawLines.map((l) => Number(l.itcd)))];
  if (itcds.some((i) => !Number.isInteger(i) || i <= 0)) throw new PosError("Every line needs an item.", 400);
  const items = await prisma.item.findMany({
    where: { itcd: { in: itcds } },
    select: { itcd: true, item: true, code: true, price: true, unit: true, discard: true },
  });
  const byId = new Map(items.map((i) => [i.itcd, i]));
  const priceChange = settings.allowPriceChange && rights.discount;

  const lines = rawLines.map((l, i) => {
    const item = byId.get(Number(l.itcd));
    if (!item) throw new PosError(`Line ${i + 1}: item ${l.itcd} does not exist.`, 400);
    if (item.discard) throw new PosError(`${item.item} is discontinued and cannot be sold.`, 400);
    const qty = posNum(l.qty);
    if (!(qty > 0)) throw new PosError(`${item.item}: quantity must be more than 0.`, 400);
    const listPrice = Number(item.price) > 0 ? Number(item.price) : null;
    const typed = posNum(l.rate);
    let rate = listPrice;
    if (priceChange && typed >= 0) rate = typed;
    else if (listPrice == null) {
      // An item with no price is priced at the till (open price).
      if (!(typed > 0)) throw new PosError(`${item.item} has no price — type its price.`, 400);
      rate = typed;
    }
    return {
      itcd: item.itcd,
      name: item.item,
      unit: item.unit,
      qty,
      rate,
      discountPct: l.discountPct,
      discountAmt: l.discountAmt,
      note: l.note ? String(l.note).slice(0, 200) : null,
    };
  });

  const bill = computeBill(lines, body?.billDiscount, settings);
  if (!(bill.total > 0)) throw new PosError("The bill total must be more than 0.", 400);
  if (bill.discount > 0) {
    if (!settings.allowDiscounts) throw new PosError("Discounts are switched off (Settings → Point of Sale).");
    if (!rights.discount) throw new PosError("You may not give discounts (pos.discount).", 403);
    const worst = largestDiscountPercent(bill);
    if (worst > settings.maxDiscountPercent + 0.001) {
      throw new PosError(`A discount of ${worst}% is more than the ${settings.maxDiscountPercent}% allowed (Settings → Point of Sale).`);
    }
  }

  // ── payments ──
  const settled = settlePayments(bill.total, body?.payments);
  if (settled.error) throw new PosError(settled.error, 400);
  const customerAcno = body?.customer?.acno != null && body.customer.acno !== "" ? Number(body.customer.acno) : null;
  let customer = null;
  if (customerAcno != null) {
    customer = await prisma.aCNO.findUnique({ where: { acno: customerAcno }, select: { acno: true, acname: true, phoneFax: true } });
    if (!customer) throw new PosError(`Customer account ${customerAcno} does not exist.`, 400);
  }
  if (settled.payments.some((p) => p.method === "CREDIT")) {
    if (!(await feature("pos.creditSales"))) throw new PosError("Credit sales are switched off (Settings → Features → Point of sale).");
    if (!rights.credit) throw new PosError("You may not sell on credit (pos.credit).", 403);
    if (!customer || customer.acno === settings.walkInAccount) throw new PosError("Pick the customer account the credit goes to.", 400);
  }

  // ── accounts (all checked before anything is written) ──
  const { lineAcno } = await resolveItemAccounts(lines, POS_SALE);
  const payLines = [];
  for (const p of settled.payments) payLines.push({ ...p, acno: await accountFor(p.method, customer?.acno) });
  const taxAcno = bill.tax !== 0 ? await requireAccount("pos_tax") : null;
  const roundAcno = bill.rounding !== 0 ? await requireAccount("pos_round_off") : null;
  const pycd = customer?.acno ?? settings.walkInAccount ?? (payLines.length === 1 && payLines[0].method === "CARD" ? payLines[0].acno : await requireAccount("pos_cash"));

  // ── period lock, godown, stock ──
  const now = new Date();
  const lockError = await checkPeriodLock(now, POS_SALE, { action: "create", userId });
  if (lockError) throw new PosError(lockError);
  const godown = settings.godown;
  const closed = await closedGodownError([godown]);
  if (closed) throw new PosError(`${closed} (Settings → Point of Sale)`);
  const { message: stockShort } = await checkStockForSave({
    type: "pos",
    godown,
    lines: lines.map((l) => ({ itcd: l.itcd, qty: l.qty })),
    where: "the POS godown",
  });

  // ── write ──
  const customerName = customer?.acname || (body?.customer?.name ? String(body.customer.name).slice(0, 150) : null);
  const tran_id = await prisma.$transaction(async (tx) => {
    const vr_no = await nextNumber(tx, POS_SALE);
    const rows = bill.lines.map((r) => ({
      sub_tran_id: 1,
      itcd: r.itcd,
      qty: r.qty,
      rate: r.rate,
      unit: r.unit ?? null,
      godown,
      acno: lineAcno[r.itcd] ?? null,
      gross_amount: r.gross,
      camt: r.net,
      damt: 0,
      st_rate: Number(settings.taxPercent) || null,
      st_amount: r.tax || null,
      narration1: `POS Sale: ${r.name}`,
      narration2: r.note,
    }));
    if (bill.tax) rows.push({ sub_tran_id: 2, acno: taxAcno, camt: bill.tax, damt: 0, narration1: `Sales tax ${settings.taxPercent}%` });
    if (bill.rounding) {
      rows.push({ sub_tran_id: 2, acno: roundAcno, camt: bill.rounding > 0 ? bill.rounding : 0, damt: bill.rounding < 0 ? -bill.rounding : 0, narration1: "Round off" });
    }
    for (const p of payLines) {
      rows.push({
        sub_tran_id: 3,
        acno: p.acno,
        damt: p.amount,
        camt: 0,
        narration1: p.method === "CASH" ? "Cash" : p.method === "CARD" ? "Card / bank" : `Credit — ${customer?.acname ?? ""}`,
        narration2: p.reference,
      });
    }
    const master = await tx.transactionsMaster.create({
      data: {
        dated: now,
        time: now,
        tran_code: POS_SALE,
        vr_no,
        invoice_no: `POS-${vr_no}`,
        godown,
        pycd,
        tr_amount: bill.total,
        rmk: body?.note ? String(body.note).slice(0, 250) : null,
        user_id: userId, // Entered by — from the session, never the body
        sync_status: "completed",
        transactions: { create: rows },
      },
      select: { tran_id: true },
    });
    await tx.posReceipt.create({
      data: {
        tran_id: master.tran_id,
        kind: "SALE",
        shift_id: shift?.id ?? null,
        customer_name: customerName,
        customer_phone: body?.customer?.phone ? String(body.customer.phone).slice(0, 40) : customer?.phoneFax?.slice(0, 40) ?? null,
        subtotal: bill.subtotal,
        discount: bill.discount,
        tax: bill.tax,
        rounding: bill.rounding,
        total: bill.total,
        tendered: settled.tendered,
        change_due: settled.change,
        note: body?.note ? String(body.note).slice(0, 500) : null,
        client_ref: body?.clientRef ? String(body.clientRef).slice(0, 64) : null,
      },
    });
    await tx.posPayment.createMany({
      data: payLines.map((p) => ({ tran_id: master.tran_id, method: p.method, acno: p.acno, amount: p.amount, reference: p.reference })),
    });
    return master.tran_id;
  });

  return { tran_id, warnings: stockShort ? [stockShort] : [] };
}

// ─────────────────────────────────────────────────────────────────────────
// RETURN
// ─────────────────────────────────────────────────────────────────────────
/** Quantity already returned per sold line id. */
export async function returnedByLine(saleTranId, db = prisma) {
  const rets = await db.posReceipt.findMany({ where: { ref_tran_id: Number(saleTranId), kind: "RETURN" }, select: { tran_id: true } });
  if (!rets.length) return {};
  const lines = await db.transactions.findMany({
    where: { tran_id: { in: rets.map((r) => r.tran_id) }, sub_tran_id: 1, source_line_no: { not: null } },
    select: { source_line_no: true, qty: true },
  });
  const out = {};
  for (const l of lines) out[l.source_line_no] = round2((out[l.source_line_no] || 0) + Number(l.qty || 0));
  return out;
}

/**
 * @param {{ clientRef?, saleTranId, lines: [{ id, qty }], refundMethod: "CASH"|"CARD"|"CREDIT", reason? }} body
 */
export async function postReturn(session, body) {
  const userId = userIdOf(session);
  const dup = await duplicateOf(body?.clientRef);
  if (dup) return { tran_id: dup, duplicate: true, warnings: [] };

  const settings = await getPosSettings();
  const rights = await posRights(session);
  if (!rights.refund) throw new PosError("You may not refund receipts (pos.refund).", 403);

  const saleId = Number(body?.saleTranId);
  const sale = Number.isInteger(saleId)
    ? await prisma.transactionsMaster.findFirst({
        where: { tran_id: saleId, tran_code: POS_SALE },
        include: { transactions: { where: { sub_tran_id: 1, itcd: { not: null } }, orderBy: { id: "asc" } } },
      })
    : null;
  if (!sale) throw new PosError("POS receipt not found.", 404);
  if (!rights.allShifts && sale.user_id !== userId) {
    throw new PosError("You may refund only your own receipts (pos.allShifts).", 403);
  }
  if (settings.returnDays > 0 && sale.dated) {
    const age = (Date.now() - new Date(sale.dated).getTime()) / 86400000;
    if (age > settings.returnDays) throw new PosError(`This receipt is older than ${settings.returnDays} days and cannot be refunded at the till.`);
  }

  const shift = await openShiftOf(userId);
  if (!shift && (await feature("pos.requireShift"))) throw new PosError("Open a shift before a refund (Shift → Open shift).");

  const want = {};
  for (const l of Array.isArray(body?.lines) ? body.lines : []) {
    const q = posNum(l.qty);
    if (q > 0) want[Number(l.id)] = q;
  }
  const already = await returnedByLine(sale.tran_id);
  for (const [id, q] of Object.entries(want)) {
    const line = sale.transactions.find((t) => t.id === Number(id));
    if (!line) throw new PosError(`Line ${id} is not on receipt ${sale.invoice_no}.`, 400);
    const left = round2(Number(line.qty || 0) - (already[line.id] || 0));
    if (q > left + 1e-9) throw new PosError(`Only ${left} of line ${line.narration1?.replace(/^POS Sale: /, "") || line.itcd} can still be returned.`, 400);
  }
  const receipt = await prisma.posReceipt.findUnique({ where: { tran_id: sale.tran_id } });
  const refund = computeRefund(sale.transactions, want, already, receipt?.rounding ?? 0);
  if (!refund.lines.length || !(refund.total > 0)) throw new PosError("Pick at least one item to return.", 400);

  // Refund account: drawer cash, card, or back to the customer's account.
  const method = String(body?.refundMethod || "CASH").toUpperCase();
  let refundAcno;
  if (method === "CREDIT") {
    const credit = await prisma.posPayment.findFirst({ where: { tran_id: sale.tran_id, method: "CREDIT" }, select: { acno: true } });
    const custAcno = credit?.acno ?? (sale.pycd !== settings.walkInAccount ? sale.pycd : null);
    const [cash, card] = await Promise.all([requireAccount("pos_cash").catch(() => null), requireAccount("pos_card").catch(() => null)]);
    if (custAcno == null || custAcno === cash || custAcno === card) throw new PosError("This receipt has no customer account to credit — refund in cash or to card.", 400);
    refundAcno = custAcno;
  } else {
    refundAcno = await accountFor(method);
  }
  const taxAcno = refund.tax !== 0 ? await requireAccount("pos_tax") : null;
  const roundAcno = refund.rounding !== 0 ? await requireAccount("pos_round_off") : null;

  const now = new Date();
  const lockError = await checkPeriodLock(now, POS_RETURN, { action: "create", userId });
  if (lockError) throw new PosError(lockError);
  const godown = sale.godown ?? settings.godown;
  const closed = await closedGodownError([godown]);
  if (closed) throw new PosError(closed);
  const reason = body?.reason ? String(body.reason).slice(0, 250) : null;

  const tran_id = await prisma.$transaction(async (tx) => {
    const vr_no = await nextNumber(tx, POS_RETURN);
    const rows = refund.lines.map((r) => ({
      sub_tran_id: 1,
      itcd: r.line.itcd,
      qty: r.qty,
      rate: r.rate,
      unit: r.line.unit ?? null,
      godown,
      acno: r.line.acno,
      gross_amount: r.net,
      damt: r.net,
      camt: 0,
      st_rate: r.line.st_rate ?? null,
      st_amount: r.tax || null,
      source_line_no: r.line.id, // the sold line it refunds (never refunded twice)
      narration1: (r.line.narration1 || "").replace(/^POS Sale:/, "POS Return:") || "POS Return",
      narration2: reason,
    }));
    if (refund.tax) rows.push({ sub_tran_id: 2, acno: taxAcno, damt: refund.tax, camt: 0, narration1: "Sales tax returned" });
    if (refund.rounding) {
      rows.push({ sub_tran_id: 2, acno: roundAcno, damt: refund.rounding > 0 ? refund.rounding : 0, camt: refund.rounding < 0 ? -refund.rounding : 0, narration1: "Round off returned" });
    }
    rows.push({ sub_tran_id: 3, acno: refundAcno, camt: refund.total, damt: 0, narration1: method === "CASH" ? "Cash refund" : method === "CARD" ? "Card refund" : "Credited to customer", narration2: reason });

    const master = await tx.transactionsMaster.create({
      data: {
        dated: now,
        time: now,
        tran_code: POS_RETURN,
        vr_no,
        invoice_no: `RET-${vr_no}`,
        godown,
        pycd: sale.pycd,
        tr_amount: refund.total,
        rmk: `Return for ${sale.invoice_no}`,
        rmk1: reason,
        user_id: userId,
        sync_status: "completed",
        transactions: { create: rows },
      },
      select: { tran_id: true },
    });
    await tx.posReceipt.create({
      data: {
        tran_id: master.tran_id,
        kind: "RETURN",
        shift_id: shift?.id ?? null,
        ref_tran_id: sale.tran_id,
        customer_name: receipt?.customer_name ?? null,
        customer_phone: receipt?.customer_phone ?? null,
        subtotal: refund.net,
        discount: 0,
        tax: refund.tax,
        rounding: refund.rounding,
        total: refund.total,
        tendered: 0,
        change_due: 0,
        note: reason,
        client_ref: body?.clientRef ? String(body.clientRef).slice(0, 64) : null,
      },
    });
    await tx.posPayment.create({ data: { tran_id: master.tran_id, method, acno: refundAcno, amount: refund.total } });
    return master.tran_id;
  });
  return { tran_id, warnings: [] };
}

// ─────────────────────────────────────────────────────────────────────────
// RECEIPT (for printing / the receipts list / returns)
// ─────────────────────────────────────────────────────────────────────────
export async function loadReceipt(tranId) {
  const master = await prisma.transactionsMaster.findFirst({
    where: { tran_id: Number(tranId), tran_code: { in: [POS_SALE, POS_RETURN] } },
    include: {
      transactions: { orderBy: [{ sub_tran_id: "asc" }, { id: "asc" }], include: { itemDetails: { select: { item: true, code: true, unit: true } } } },
      acno: { select: { acno: true, acname: true } },
      godownDetails: { select: { id: true, godown: true } },
    },
  });
  if (!master) return null;
  // A walk-in bill's party is the POS Cash / Card account — not a customer to print.
  const tillAccounts = new Set((await Promise.all([getAccount("pos_cash"), getAccount("pos_card")])).filter((a) => a != null));
  const [receipt, payments, user] = await Promise.all([
    prisma.posReceipt.findUnique({ where: { tran_id: master.tran_id } }),
    prisma.posPayment.findMany({ where: { tran_id: master.tran_id }, orderBy: { id: "asc" } }),
    master.user_id ? prisma.user.findUnique({ where: { id: master.user_id }, select: { name: true } }).catch(() => null) : null,
  ]);
  const items = master.transactions
    .filter((t) => t.sub_tran_id === 1 && t.itcd)
    .map((t) => ({
      id: t.id,
      itcd: t.itcd,
      name: t.itemDetails?.item || (t.narration1 || "").replace(/^POS (Sale|Return): /, ""),
      code: t.itemDetails?.code ?? null,
      unit: t.unit || t.itemDetails?.unit || null,
      qty: Number(t.qty || 0),
      rate: Number(t.rate || 0),
      gross: Number(t.gross_amount || 0),
      net: Number(master.tran_code === POS_SALE ? t.camt : t.damt) || 0,
      discount: master.tran_code === POS_SALE ? round2(Number(t.gross_amount || 0) - Number(t.camt || 0)) : 0,
      tax: Number(t.st_amount || 0),
      note: t.narration2 || null,
      source_line_no: t.source_line_no ?? null,
    }));
  // Old POS sales (before pos_receipts) — figures from the voucher.
  const fallbackTotal = round2(items.reduce((s, i) => s + i.net + i.tax, 0));
  const r = receipt || {
    kind: master.tran_code === POS_SALE ? "SALE" : "RETURN",
    subtotal: round2(items.reduce((s, i) => s + i.gross, 0)),
    discount: round2(items.reduce((s, i) => s + i.discount, 0)),
    tax: round2(items.reduce((s, i) => s + i.tax, 0)),
    rounding: 0,
    total: Number(master.tr_amount) || fallbackTotal,
    tendered: 0,
    change_due: 0,
  };
  const already = master.tran_code === POS_SALE ? await returnedByLine(master.tran_id) : {};
  const returns =
    master.tran_code === POS_SALE
      ? await prisma.posReceipt.findMany({ where: { ref_tran_id: master.tran_id, kind: "RETURN" }, select: { tran_id: true, total: true, created_at: true } })
      : [];
  const refOf = receipt?.ref_tran_id
    ? await prisma.transactionsMaster.findUnique({ where: { tran_id: receipt.ref_tran_id }, select: { tran_id: true, invoice_no: true } })
    : null;
  return {
    tran_id: master.tran_id,
    tran_code: master.tran_code,
    kind: r.kind,
    vr_no: master.vr_no,
    invoice_no: master.invoice_no,
    dated: master.dated,
    time: master.time,
    godown: master.godownDetails,
    user_id: master.user_id,
    entered_by: user?.name || (master.user_id ? null : "System"),
    party: master.acno && !tillAccounts.has(master.acno.acno) ? master.acno : null,
    customer_name: receipt?.customer_name ?? null,
    customer_phone: receipt?.customer_phone ?? null,
    note: receipt?.note ?? master.rmk ?? null,
    shift_id: receipt?.shift_id ?? null,
    ref: refOf,
    items: items.map((i) => ({ ...i, returned: already[i.id] || 0 })),
    subtotal: r.subtotal,
    discount: r.discount,
    tax: r.tax,
    rounding: r.rounding,
    total: r.total,
    tendered: r.tendered,
    change_due: r.change_due,
    payments: payments.map((p) => ({ method: p.method, amount: p.amount, reference: p.reference })),
    returns,
  };
}
