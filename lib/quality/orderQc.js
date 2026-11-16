// lib/quality/orderQc.js — Quality Control of goods received against a purchase order.
// SERVER ONLY. One receipt = one QualityMaster row with order_no (made by the
// store on QA Entry, /api/store/qa-entry). QC tests it, then Passes it (a GRN
// for the received quantity is posted — lib/createOrderGrn.js) or Fails it.
// Every route reads / writes a receipt through here, by its QualityMaster id.
import prisma from "@/lib/prisma";
import { buildOrderQcBarcode, buildQaBarcode } from "@/lib/orderQualityBarcode.js";
import { createOrderGrn } from "@/lib/createOrderGrn.js";
import { isBatchDuplicate } from "@/lib/generateBatchNo";
import { checkResult, isoDay, sheetVerdict, statusLabel } from "@/lib/quality/qc";
import { QcError } from "@/lib/quality/productionQc";

export { QcError };

const STATUS_IN = { draft: "DRAFT", approve: "APPROVED", approved: "APPROVED", reject: "REJECTED", rejected: "REJECTED" };
/** Accepts the old lower-case words (approve / reject / draft) and the enum. */
export const orderStatusOf = (s) => STATUS_IN[String(s || "").toLowerCase()] || (["DRAFT", "APPROVED", "REJECTED"].includes(s) ? s : null);

const isAttempt = (n) => Number.isInteger(n) && n > 0 && n < 1000;
const currentAttemptOf = (realized) => Math.max(1, ...realized.map((r) => r.attempt_no).filter(isAttempt));

/** Find the receipt: by QualityMaster id, else the latest one of order + item. */
export async function findReceipt({ qcId, orderNo, itcd }, db = prisma) {
  if (Number(qcId)) {
    return db.qualityMaster.findFirst({ where: { id: Number(qcId), order_no: { not: null } } });
  }
  if (Number(orderNo) && Number(itcd)) {
    return db.qualityMaster.findFirst({ where: { order_no: Number(orderNo), itcd: Number(itcd) }, orderBy: { id: "desc" } });
  }
  return null;
}

export async function loadOrderQc(qcId, db = prisma) {
  const qc = await db.qualityMaster.findFirst({
    where: { id: Number(qcId), order_no: { not: null } },
    include: {
      item: { select: { itcd: true, code: true, item: true } },
      orderMaster: { select: { order_no: true, dated: true, status: true, godown: true, acno: { select: { acname: true } } } },
      details: { orderBy: [{ attempt_no: "desc" }, { id: "desc" }], select: { attempt_no: true, parameter_name: true, reject_reason: true, attempt_date: true } },
      detailDetails: { orderBy: { id: "desc" }, select: { attempt_no: true, parameter_name: true, quality_realized: true, detail: { select: { parameter_name: true } } } },
    },
  });
  if (!qc) return null;

  const [params, line, receipts, grn] = await Promise.all([
    db.item_Quality.findMany({ where: { itcd: qc.itcd }, orderBy: { parameter_name: "asc" } }),
    db.orderDetail.findFirst({ where: { order_no: qc.order_no, itcd: qc.itcd }, select: { qty: true, unit: true, rate: true } }),
    db.qualityMaster.findMany({
      where: { order_no: qc.order_no },
      orderBy: { id: "asc" },
      select: { id: true, itcd: true, batch_size: true, status: true, item: { select: { item: true, code: true } } },
    }),
    qc.grn_no
      ? db.transactionsMaster.findFirst({ where: { tran_code: 4, po_no: qc.order_no, OR: [{ grn_no: Number(qc.grn_no) }, { vr_no: Number(qc.grn_no) }] }, select: { tran_id: true, vr_no: true, grn_no: true, dated: true } })
      : null,
  ]);

  const current = currentAttemptOf(qc.detailDetails);
  const valueOf = new Map();
  for (const r of qc.detailDetails) {
    if (r.attempt_no !== current) continue;
    const name = r.parameter_name || r.detail?.parameter_name;
    if (name && !valueOf.has(name)) valueOf.set(name, r.quality_realized ?? "");
  }
  const rows = params.map((p) => {
    const realized = valueOf.get(p.parameter_name) ?? "";
    return { parameter_name: p.parameter_name, quality_standard: p.quality_standard || "", quality_realized: realized, check: checkResult(p.quality_standard, realized) };
  });
  const decision = qc.details.find((d) => d.attempt_no === 0 && d.parameter_name === "qa_decision");
  const storeNote = qc.details.find((d) => d.parameter_name === "store_receiving_entry");
  const tested = qc.details.find((d) => isAttempt(d.attempt_no) && d.parameter_name !== "store_receiving_entry");

  return {
    master: {
      qc_id: qc.id,
      order_no: qc.order_no,
      order_date: isoDay(qc.orderMaster?.dated),
      vendor_name: qc.orderMaster?.acno?.acname || "",
      itcd: qc.itcd,
      item_code: qc.item?.code || "",
      item_name: qc.item?.item || "",
      received_qty: qc.batch_size ?? 0,
      ordered_qty: line?.qty ?? 0,
      unit: line?.unit || "",
      rate: line?.rate ?? 0,
      status: qc.status,
      status_label: statusLabel(qc.status),
      batch_no: qc.batch_no ?? null,
      mfg_date: isoDay(qc.mfg_date),
      expiry_date: isoDay(qc.expiry_date),
      remarks: qc.remarks || "",
      approved_by: qc.approved_by || "",
      reject_reason: decision?.reject_reason || null,
      received_on: isoDay(storeNote?.attempt_date),
      tested_on: isoDay(tested?.attempt_date),
      qa_barcode: qc.qa_barcode || "",
      qc_barcode: qc.qc_barcode || "",
      grn_status: qc.grn_status || "PENDING",
      grn_no: grn?.grn_no ?? grn?.vr_no ?? qc.grn_no ?? null,
      grn_tran_id: grn?.tran_id ?? null,
    },
    parameters: params.map((p) => ({ parameter_name: p.parameter_name, quality_standard: p.quality_standard || "" })),
    attempt_no: current,
    rows,
    ...sheetVerdict(rows),
    editable: qc.status === "DRAFT",
    receipts: receipts.map((r) => ({ id: r.id, itcd: r.itcd, item_name: r.item?.item || "", item_code: r.item?.code || "", qty: r.batch_size ?? 0, status: r.status })),
  };
}

const dayOrNull = (v) => {
  if (!v) return null;
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) throw new QcError("A date is not valid.");
  return d;
};

function batchOf(v) {
  const s = String(v ?? "").trim();
  if (!s) return null;
  if (!/^\d{1,9}$/.test(s)) throw new QcError("Batch number must be a whole number (up to 9 digits).");
  return Number(s);
}

/** Save results, batch, dates and remarks of a receipt that is still Pending. */
export async function saveOrderResults(qcId, body) {
  const qc = await prisma.qualityMaster.findFirst({ where: { id: Number(qcId), order_no: { not: null } } });
  if (!qc) throw new QcError("QC record not found.", 404);
  if (qc.status !== "DRAFT") throw new QcError(`QC is ${statusLabel(qc.status)} — it can no longer be changed.`, 409);

  const data = {};
  if (body.batch_no !== undefined) {
    const b = batchOf(body.batch_no);
    if (b && (await isBatchDuplicate(b, qc.itcd, qc.id))) throw new QcError(`Batch ${b} is already used for this item.`);
    data.batch_no = b;
  }
  if (body.mfg_date !== undefined) data.mfg_date = dayOrNull(body.mfg_date);
  if (body.expiry_date !== undefined) data.expiry_date = dayOrNull(body.expiry_date);
  const mfg = data.mfg_date !== undefined ? data.mfg_date : qc.mfg_date;
  const exp = data.expiry_date !== undefined ? data.expiry_date : qc.expiry_date;
  if (mfg && exp && exp <= mfg) throw new QcError("Expiry date must be after the manufacturing date.");
  if (body.remarks !== undefined) data.remarks = String(body.remarks || "").trim().slice(0, 255) || null;

  const params = await prisma.item_Quality.findMany({ where: { itcd: qc.itcd } });
  const stdOf = new Map(params.map((p) => [p.parameter_name, p.quality_standard || ""]));
  const sent = (Array.isArray(body.parameters) ? body.parameters : []).filter((p) => p && stdOf.has(p.parameter_name));

  await prisma.$transaction(async (tx) => {
    if (Object.keys(data).length) await tx.qualityMaster.update({ where: { id: qc.id }, data });
    if (!sent.length) return;
    const realized = await tx.qualityDetailDetail.findMany({ where: { master_id: qc.id }, select: { id: true, attempt_no: true, parameter_name: true, detail_id: true } });
    const attempt = currentAttemptOf(realized);
    const details = await tx.qualityDetail.findMany({ where: { master_id: qc.id, attempt_no: attempt }, select: { id: true, parameter_name: true } });
    const now = new Date();
    for (const p of sent) {
      const name = p.parameter_name;
      const value = String(p.quality_realized ?? "").trim().slice(0, 50);
      let d = details.find((x) => x.parameter_name === name);
      if (d) await tx.qualityDetail.update({ where: { id: d.id }, data: { attempt_date: now, quality_standard: stdOf.get(name) } });
      else {
        d = await tx.qualityDetail.create({
          data: { master_id: qc.id, order_no: qc.order_no, itcd: qc.itcd, attempt_no: attempt, attempt_date: now, parameter_name: name, quality_standard: stdOf.get(name) },
        });
      }
      const r = realized.find((x) => x.attempt_no === attempt && x.parameter_name === name);
      if (r) await tx.qualityDetailDetail.update({ where: { id: r.id }, data: { quality_realized: value, detail_id: r.detail_id ?? d.id } });
      else {
        await tx.qualityDetailDetail.create({
          data: { master_id: qc.id, order_no: qc.order_no, itcd: qc.itcd, attempt_no: attempt, detail_id: d.id, parameter_name: name, quality_realized: value },
        });
      }
    }
  });
}

/**
 * Pass or fail a receipt (only while Pending — a passed receipt has its GRN).
 * Passed: batch number required, every parameter filled, a result outside its
 * standard needs confirmFail; the GRN for the received quantity is posted in
 * the same transaction. Failed: reason required.
 */
export async function decideOrderQc(qcId, body, session) {
  const target = orderStatusOf(body.status);
  if (!target || target === "DRAFT") throw new QcError("The decision must be Passed or Failed.");
  const reason = String(body.reason ?? body.reject_reason ?? "").trim().slice(0, 255);
  if (target === "REJECTED" && !reason) throw new QcError("A reason is required to fail the receipt.");

  if (body.batch_no !== undefined && String(body.batch_no).trim()) await saveOrderResults(qcId, { batch_no: body.batch_no });
  const sheet = await loadOrderQc(qcId);
  if (!sheet) throw new QcError("QC record not found.", 404);
  if (sheet.master.status !== "DRAFT") throw new QcError(`QC is ${sheet.master.status_label} — the decision is final.`, 409);
  if (target === "APPROVED") {
    if (!sheet.master.batch_no) throw new QcError("Enter the batch number before passing the receipt.", 422);
    if (sheet.total && sheet.filled < sheet.total) throw new QcError(`Enter every result before passing (${sheet.filled} of ${sheet.total} entered).`, 422);
    if (sheet.failed && !body.confirmFail) {
      const out = sheet.rows.filter((r) => r.check === "fail").map((r) => `${r.parameter_name} ${r.quality_realized} (standard ${r.quality_standard})`);
      throw new QcError(`Out of standard: ${out.join("; ")}. Confirm to pass it anyway.`, 409, { needsConfirm: true, failed: out });
    }
  }

  const userId = session?.user?.id || null;
  return prisma.$transaction(async (tx) => {
    const qc = await tx.qualityMaster.findUnique({ where: { id: sheet.master.qc_id } });
    if (qc.status !== "DRAFT") throw new QcError("Someone else decided this receipt meanwhile — reload it.", 409);
    const updated = await tx.qualityMaster.update({
      where: { id: qc.id },
      data: {
        status: target,
        approved_by: target === "APPROVED" ? session?.user?.name || session?.user?.email || null : null,
        qa_barcode: qc.qa_barcode || buildQaBarcode({ orderNo: qc.order_no, itcd: qc.itcd, id: qc.id }),
        qc_barcode: qc.qc_barcode || buildOrderQcBarcode({ orderNo: qc.order_no, itcd: qc.itcd, id: qc.id }),
        grn_status: target === "APPROVED" ? "APPROVED_PENDING_GRN" : "PENDING",
      },
    });
    const decision = await tx.qualityDetail.findFirst({ where: { master_id: qc.id, attempt_no: 0, parameter_name: "qa_decision" } });
    if (decision) await tx.qualityDetail.update({ where: { id: decision.id }, data: { reject_reason: target === "REJECTED" ? reason : null, attempt_date: new Date() } });
    else {
      await tx.qualityDetail.create({
        data: { master_id: qc.id, order_no: qc.order_no, itcd: qc.itcd, attempt_no: 0, attempt_date: new Date(), parameter_name: "qa_decision", quality_standard: "N/A", reject_reason: target === "REJECTED" ? reason : null },
      });
    }
    let grn = null;
    if (target === "APPROVED") {
      const order = await tx.orderMaster.findUnique({
        where: { order_no: qc.order_no },
        include: { orderDetails: { where: { itcd: qc.itcd }, include: { items: true } }, acno: true },
      });
      if (!order?.orderDetails?.[0]) throw new QcError("The purchase order line of this receipt was not found.", 422);
      grn = await createOrderGrn(tx, { order, orderDetail: order.orderDetails[0], qualityMaster: updated, userId, itcd: qc.itcd });
      await tx.qualityMaster.update({ where: { id: qc.id }, data: { grn_status: "CREATED", grn_no: grn.grnNo ? Number(grn.grnNo) : null } });
    }
    return { status: target, grnNo: grn?.grnNo ?? null, grnTranId: grn?.tranId ?? null };
  });
}
