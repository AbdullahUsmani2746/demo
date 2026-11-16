// lib/quality/productionQc.js — production Quality Control on a process order.
// SERVER ONLY. The one place that reads and writes a process order's QC
// (QualityMaster with proc_ord_no + QualityDetail / QualityDetailDetail);
// used by app/api/forms/qualitycontrol/[id]/route.js and Send to Production.
//
// Attempts: results are saved into the current attempt. A Re-test decision
// writes its reason on the attempt that was tested, and the next results go
// into a new attempt (attempt 1, 2, 3 …). A parameter's realized value is tied
// to its QualityDetail row by detail_id, never by position.
//
// Decisions (lib/quality/qc.js nextStatuses): Passed gives the batch number
// (once) and is final; Failed may only go back to Re-test; reasons are required
// for Failed / On hold / Re-test; Passed needs every parameter of the current
// attempt filled, and a result outside its standard needs `confirmFail`.
// The process order's status follows the decision as it always did
// (Completed / QC_REJECTED / ON_HOLD / IN_REWORK) — except a posted or
// cancelled order, whose status QC never changes.
import prisma from "@/lib/prisma";
import { buildQualityControlBarcode } from "@/lib/qualityControlBarcode.js";
import { checkResult, isoDay, NEEDS_REASON, nextStatuses, sheetVerdict, statusLabel } from "@/lib/quality/qc";

export class QcError extends Error {
  constructor(message, status = 400, extra = {}) {
    super(message);
    this.status = status;
    this.extra = extra;
  }
}

const PLAN_STATUS_FOR = { APPROVED: "Completed", REJECTED: "QC_REJECTED", HOLD: "ON_HOLD", REWORK: "IN_REWORK" };
const FROZEN_PLAN = new Set(["Posted", "Cancelled"]);
// Legacy status rows (attempt_no = itcd × 1000) are not attempts.
const isAttempt = (n) => Number.isInteger(n) && n > 0 && n < 1000;

const addOneYear = (d) => {
  const x = new Date(d);
  x.setFullYear(x.getFullYear() + 1);
  return x;
};
const dayOrNull = (v) => {
  if (!v) return null;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
};

/** Attempt numbers with rows, the current attempt and where a decision reason goes. */
function attemptsOf(details, status) {
  const nos = [...new Set(details.map((d) => d.attempt_no).filter(isAttempt))].sort((a, b) => a - b);
  const max = nos.length ? nos[nos.length - 1] : 0;
  const maxHasReason = details.some((d) => d.attempt_no === max && d.reject_reason);
  const current = max === 0 ? 1 : status === "REWORK" && maxHasReason ? max + 1 : max;
  return { nos, max, current };
}

async function loadPlan(db, procOrdNo) {
  return db.productionPlanMaster.findUnique({
    where: { id: procOrdNo },
    select: {
      id: true, finished_id: true, qty: true, dated: true, status: true, batch_no: true, sale_ord_no: true,
      customer_name: true, type: true, transaction_id: true, sent_to_production_date: true,
      item: { select: { itcd: true, code: true, item: true, ic_id: true } },
      qualityMaster: true,
    },
  });
}

/** The QC sheet of a process order, as every QC screen shows it. null = no such process order. */
export async function loadProductionQc(procOrdNo, db = prisma) {
  const plan = await loadPlan(db, procOrdNo);
  if (!plan) return null;
  const qc = plan.qualityMaster;
  const status = qc?.status || "DRAFT";

  const [params, details, scans, order] = await Promise.all([
    plan.finished_id
      ? db.item_Quality.findMany({ where: { itcd: plan.finished_id }, orderBy: { parameter_name: "asc" } })
      : [],
    db.qualityDetail.findMany({
      where: { proc_ord_no: procOrdNo },
      include: { realizedValues: { orderBy: { id: "desc" } } },
      orderBy: [{ attempt_no: "asc" }, { parameter_name: "asc" }],
    }),
    db.processScanLog.findMany({ where: { proc_ord_no: procOrdNo }, orderBy: { scanned_at: "asc" } }),
    plan.sale_ord_no
      ? db.orderMaster.findUnique({ where: { order_no: plan.sale_ord_no }, select: { acno: { select: { acname: true } } } })
      : null,
  ]);

  const { nos, current } = attemptsOf(details, status);
  const attemptNos = nos.includes(current) ? nos : [...nos, current];
  const stdOf = new Map(params.map((p) => [p.parameter_name, p.quality_standard || ""]));

  const attempts = attemptNos.map((no) => {
    const rows = details.filter((d) => d.attempt_no === no);
    const byName = new Map(rows.map((d) => [d.parameter_name, d]));
    // The item's parameters first, then any parameter recorded on this attempt
    // that was removed from the item since (history is kept, not hidden).
    const names = [...params.map((p) => p.parameter_name), ...rows.map((d) => d.parameter_name).filter((n) => !stdOf.has(n) && n !== "qa_decision")];
    const sheet = names.map((name) => {
      const d = byName.get(name);
      const standard = d?.quality_standard || stdOf.get(name) || "";
      const realized = d?.realizedValues?.[0]?.quality_realized ?? "";
      return { parameter_name: name, quality_standard: standard, quality_realized: realized, check: checkResult(standard, realized) };
    });
    const reason = rows.find((d) => d.reject_reason)?.reject_reason || null;
    const dated = rows.reduce((m, d) => (d.attempt_date && (!m || d.attempt_date > m) ? d.attempt_date : m), null);
    return { attempt_no: no, attempt_date: isoDay(dated), reject_reason: reason, saved: rows.length > 0, rows: sheet, ...sheetVerdict(sheet) };
  });

  return {
    master: {
      qc_id: qc?.id ?? null,
      qc_barcode: qc?.qc_barcode ?? "",
      proc_ord_no: plan.id,
      plan_date: isoDay(plan.dated),
      plan_status: plan.status || "",
      plan_type: plan.type || "",
      posted: plan.status === "Posted",
      itcd: plan.finished_id,
      item_code: plan.item?.code || "",
      item_name: plan.item?.item || "",
      ic_id: plan.item?.ic_id ?? null,
      status,
      status_label: statusLabel(status),
      batch_no: qc?.batch_no ?? null,
      batch_size: qc?.batch_size ?? plan.qty ?? 0,
      mfg_date: isoDay(qc?.mfg_date),
      expiry_date: isoDay(qc?.expiry_date),
      approved_by: qc?.approved_by || "",
      remarks: qc?.remarks || "",
      sale_ord_no: plan.sale_ord_no ?? null,
      customer_name: order?.acno?.acname || plan.customer_name || "",
    },
    parameters: params.map((p) => ({ parameter_name: p.parameter_name, quality_standard: p.quality_standard || "" })),
    attempts,
    current_attempt: current,
    allowed: plan.status === "Cancelled" ? [] : nextStatuses(status),
    editable: ["DRAFT", "HOLD", "REWORK"].includes(status) && plan.status !== "Cancelled",
    scans: scans.map((s) => ({ stage: s.stage, scanned_at: s.scanned_at, scanned_by: s.scanned_by, is_late: s.is_late, remarks: s.remarks })),
  };
}

/** Make sure the QualityMaster row (and its barcode) exists. */
async function ensureMaster(tx, plan, data = {}) {
  const now = new Date();
  let qc = plan.qualityMaster;
  if (!qc) {
    qc = await tx.qualityMaster.create({
      data: {
        proc_ord_no: plan.id,
        itcd: plan.finished_id,
        batch_size: plan.qty ?? 0,
        status: "DRAFT",
        mfg_date: data.mfg_date || now,
        expiry_date: data.expiry_date || addOneYear(data.mfg_date || now),
      },
    });
  }
  if (!qc.qc_barcode) {
    qc = await tx.qualityMaster.update({
      where: { id: qc.id },
      data: { qc_barcode: buildQualityControlBarcode({ id: qc.id, procOrdNo: plan.id }) },
    });
  }
  return qc;
}

function checkDates(mfg, exp) {
  if (mfg === undefined) throw new QcError("Manufacturing date is not a valid date.");
  if (exp === undefined) throw new QcError("Expiry date is not a valid date.");
  if (mfg && exp && exp <= mfg) throw new QcError("Expiry date must be after the manufacturing date.");
}

/**
 * Save the current attempt's results (and dates / remarks).
 * @param {number} procOrdNo
 * @param {{ parameters?: {parameter_name:string, quality_realized:string}[], mfg_date?, expiry_date?, remarks? }} body
 */
export async function saveProductionResults(procOrdNo, body) {
  const plan = await loadPlan(prisma, procOrdNo);
  if (!plan) throw new QcError("Process order not found.", 404);
  if (!plan.finished_id) throw new QcError("This process order has no finished item.");
  if (plan.status === "Cancelled") throw new QcError("This process order is cancelled.");
  const status = plan.qualityMaster?.status || "DRAFT";
  if (!["DRAFT", "HOLD", "REWORK"].includes(status)) {
    throw new QcError(`QC is ${statusLabel(status)} — results can no longer be changed.`, 409);
  }

  const mfg = dayOrNull(body.mfg_date);
  const exp = dayOrNull(body.expiry_date);
  checkDates(mfg ?? (plan.qualityMaster?.mfg_date || null), exp ?? (plan.qualityMaster?.expiry_date || null));

  const params = await prisma.item_Quality.findMany({ where: { itcd: plan.finished_id } });
  const stdOf = new Map(params.map((p) => [p.parameter_name, p.quality_standard || ""]));
  const sent = new Map(
    (Array.isArray(body.parameters) ? body.parameters : [])
      .filter((p) => p && stdOf.has(p.parameter_name))
      .map((p) => [p.parameter_name, String(p.quality_realized ?? "").trim().slice(0, 50)]),
  );
  const remarks = body.remarks === undefined ? undefined : String(body.remarks || "").trim().slice(0, 255) || null;

  return prisma.$transaction(async (tx) => {
    const qc = await ensureMaster(tx, plan, { mfg_date: mfg, expiry_date: exp });
    const masterData = {};
    if (mfg) masterData.mfg_date = mfg;
    if (exp) masterData.expiry_date = exp;
    if (remarks !== undefined) masterData.remarks = remarks;
    if (Object.keys(masterData).length) await tx.qualityMaster.update({ where: { id: qc.id }, data: masterData });

    if (!sent.size) return { attempt_no: null };
    const details = await tx.qualityDetail.findMany({ where: { proc_ord_no: procOrdNo }, select: { id: true, attempt_no: true, parameter_name: true, reject_reason: true } });
    const { current } = attemptsOf(details, status);
    const now = new Date();
    for (const [name, value] of sent) {
      let d = details.find((x) => x.attempt_no === current && x.parameter_name === name);
      if (d) {
        await tx.qualityDetail.update({ where: { id: d.id }, data: { attempt_date: now, quality_standard: stdOf.get(name), master_id: qc.id, itcd: plan.finished_id } });
      } else {
        d = await tx.qualityDetail.create({
          data: { master_id: qc.id, proc_ord_no: procOrdNo, itcd: plan.finished_id, parameter_name: name, quality_standard: stdOf.get(name), attempt_no: current, attempt_date: now },
        });
      }
      const realized = await tx.qualityDetailDetail.findFirst({ where: { detail_id: d.id }, orderBy: { id: "desc" }, select: { id: true, quality_realized: true } });
      if (realized) {
        if (realized.quality_realized !== value) await tx.qualityDetailDetail.update({ where: { id: realized.id }, data: { quality_realized: value, parameter_name: name } });
      } else {
        await tx.qualityDetailDetail.create({
          data: { master_id: qc.id, proc_ord_no: procOrdNo, itcd: plan.finished_id, attempt_no: current, detail_id: d.id, parameter_name: name, quality_realized: value },
        });
      }
    }
    return { attempt_no: current };
  });
}

/** Next number of the shared batch series (YY + 7 digits), inside the transaction. */
async function nextBatchNo(tx) {
  await tx.$executeRaw`SELECT pg_advisory_xact_lock(4231001)`;
  const start = Number(new Date().getFullYear().toString().slice(-2)) * 10000000;
  const last = await tx.qualityMaster.findFirst({
    where: { batch_no: { gte: start, lt: start + 10000000 } },
    orderBy: { batch_no: "desc" },
    select: { batch_no: true },
  });
  return last?.batch_no ? last.batch_no + 1 : start + 1;
}

/**
 * Take a QC decision.
 * @param {number} procOrdNo
 * @param {{ status: string, reason?: string, confirmFail?: boolean }} body
 * @param {object} session
 */
export async function decideProductionQc(procOrdNo, body, session) {
  const target = String(body.status || "").toUpperCase();
  const reason = String(body.reason ?? body.reject_reason ?? "").trim().slice(0, 255);

  return prisma.$transaction(async (tx) => {
    // One decision at a time per process order.
    await tx.$queryRaw`SELECT id FROM "productionPlanMaster" WHERE id = ${procOrdNo} FOR UPDATE`;
    const plan = await loadPlan(tx, procOrdNo);
    if (!plan) throw new QcError("Process order not found.", 404);
    if (!plan.finished_id) throw new QcError("This process order has no finished item.");
    if (plan.status === "Cancelled") throw new QcError("This process order is cancelled.");
    const status = plan.qualityMaster?.status || "DRAFT";
    const allowed = nextStatuses(status);
    if (!allowed.includes(target)) {
      throw new QcError(
        allowed.length
          ? `QC is ${statusLabel(status)} — it can be ${allowed.map(statusLabel).join(" / ")} next, not ${statusLabel(target)}.`
          : `QC is ${statusLabel(status)} — the decision is final.`,
        409,
      );
    }
    if (NEEDS_REASON.has(target) && !reason) throw new QcError(`A reason is required to mark QC ${statusLabel(target)}.`);

    const sheet = await loadProductionQc(procOrdNo, tx);
    const cur = sheet.attempts.find((a) => a.attempt_no === sheet.current_attempt);
    if (target === "APPROVED") {
      if (cur && cur.total && cur.filled < cur.total) {
        throw new QcError(`Enter every result of attempt ${cur.attempt_no} before passing (${cur.filled} of ${cur.total} entered).`, 422);
      }
      if (cur?.failed && !body.confirmFail) {
        const out = cur.rows.filter((r) => r.check === "fail").map((r) => `${r.parameter_name} ${r.quality_realized} (standard ${r.quality_standard})`);
        throw new QcError(`Out of standard: ${out.join("; ")}. Confirm to pass it anyway.`, 409, { needsConfirm: true, failed: out });
      }
    }

    const qc = await ensureMaster(tx, plan);
    const data = { status: target };
    let batchNo = qc.batch_no;
    if (target === "APPROVED") {
      if (!batchNo) batchNo = await nextBatchNo(tx);
      const mfg = qc.mfg_date || new Date();
      Object.assign(data, {
        batch_no: batchNo,
        mfg_date: mfg,
        expiry_date: qc.expiry_date || addOneYear(mfg),
        approved_by: session?.user?.name || session?.user?.email || null,
      });
    } else {
      data.approved_by = null;
    }
    await tx.qualityMaster.update({ where: { id: qc.id }, data });

    // The reason goes on the attempt that was tested: the current one when it
    // has results, else the last one with results, else a fresh decision row.
    if (reason) {
      const details = await tx.qualityDetail.findMany({ where: { proc_ord_no: procOrdNo }, select: { id: true, attempt_no: true } });
      const withRows = new Set(details.map((d) => d.attempt_no).filter(isAttempt));
      const no = withRows.has(sheet.current_attempt) ? sheet.current_attempt : withRows.size ? Math.max(...withRows) : null;
      if (no) {
        await tx.qualityDetail.updateMany({ where: { proc_ord_no: procOrdNo, attempt_no: no }, data: { reject_reason: reason, master_id: qc.id } });
      } else {
        await tx.qualityDetail.create({
          data: {
            master_id: qc.id, proc_ord_no: procOrdNo, itcd: plan.finished_id, attempt_no: sheet.current_attempt,
            parameter_name: "qa_decision", quality_standard: "N/A", reject_reason: reason, attempt_date: new Date(),
          },
        });
      }
    }

    const planData = {};
    if (!FROZEN_PLAN.has(plan.status) && PLAN_STATUS_FOR[target]) planData.status = PLAN_STATUS_FOR[target];
    if (target === "APPROVED" && !FROZEN_PLAN.has(plan.status)) planData.batch_no = String(batchNo);
    if (Object.keys(planData).length) await tx.productionPlanMaster.update({ where: { id: procOrdNo }, data: planData });

    return { status: target, batch_no: batchNo ?? null };
  });
}

/**
 * Send to Production gate. Failed / On hold / Re-test QC always stops it (the
 * screen never offered Send for those); with the feature
 * production.qcBeforeSend on, a finished-goods order also needs QC Passed.
 * @returns {Promise<string|null>} why it may not be sent, or null
 */
export async function qcSendError(plan, { requirePass = false, isFinished = () => true } = {}) {
  const qc = plan.qualityMaster ?? (await prisma.qualityMaster.findUnique({ where: { proc_ord_no: plan.id }, select: { status: true } }));
  const status = qc?.status || null;
  if (["REJECTED", "HOLD", "REWORK"].includes(status)) {
    return `Process order #${plan.id} cannot be sent to production: its QC is ${statusLabel(status)}.`;
  }
  if (requirePass && status !== "APPROVED" && isFinished(plan.item?.ic_id)) {
    return `Process order #${plan.id} cannot be sent to production until QC has passed it (QC: ${status ? statusLabel(status) : "not started"}).`;
  }
  return null;
}
