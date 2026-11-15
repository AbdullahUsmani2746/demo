// /api/hr/leaving/[id] — one leaving and its final settlement (feature hr.leavingProcess).
//   GET → { separation, settlement, company, can }
//   POST { action, ... }
//     clearance { key, done, note }                 hr.leaving.manage (approved)
//     terms { last_working_day?, waive_notice? }    hr.leaving.manage (approved, settlement a draft)
//     complete                                      hr.leaving.manage → Employee.dor + INACTIVE
//     calculate { inputs }                          hr.settlement.manage → DRAFT settlement
//     submit                                        hr.settlement.manage → Approvals (hrSettlement)
//     delete_draft                                  hr.settlement.manage
//     post { date }                                 hr.settlement.post → journal (HR_SETTLEMENT)
//     pay { date, cash_acno, reference }            hr.settlement.post → Payment voucher (HR_SETTLEMENT_PAY)
//     reverse_payment { date, note }                hr.settlement.post → reversal journal
//     reverse { date, note }                        hr.settlement.post → reversal journal
// Every action stays inside the person's HR scope; the employee only reads their own.
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { assertEmployeesInScope, hrRights, HR_PERMS, sessionEmployeeId } from "@/lib/hr/access";
import { ForbiddenError } from "@/lib/auth/permissions";
import { hrRoute, intParam, jsonBody, requireFeature } from "@/lib/hr/route";
import { getCompany } from "@/lib/company";
import { voucherLabel, TRAN } from "@/lib/hr/vouchers";
import { completeSeparation, LeavingError, SEP_INCLUDE, separationLite, setClearance, setTerms } from "@/lib/hr/leaving/separation";
import {
  calculateSettlement, deleteSettlementDraft, paySettlement, postSettlement, reverseSettlement, reverseSettlementPayment, SETTLEMENT_STATUS, submitSettlement,
} from "@/lib/hr/leaving/settlement";
import { dayKeyOfDb, todayKey } from "@/lib/hr/time";

const ALL = [HR_PERMS.leavingApply, HR_PERMS.leavingManage, HR_PERMS.leavingApprove, HR_PERMS.settlementManage, HR_PERMS.settlementApprove, HR_PERMS.settlementPost];

async function load(id, session) {
  const sep = await prisma.hrSeparation.findUnique({ where: { id }, include: SEP_INCLUDE });
  if (!sep) throw new LeavingError("Leaving request not found.", 404);
  const rights = await hrRights(session);
  if (rights.leavingView) await assertEmployeesInScope(session, [sep.employee_id]);
  else if ((await sessionEmployeeId(session)) !== sep.employee_id) throw new ForbiddenError("This is not your leaving request.");
  return { sep, rights };
}

const isPaid = (s) => Boolean(s?.pay_tran_id && !s.pay_reversal_tran_id);

const settlementLite = (s) =>
  s && {
    id: s.id,
    status: s.status,
    inputs: s.inputs,
    data: s.data,
    total_earnings: s.total_earnings,
    total_deductions: s.total_deductions,
    net: s.net,
    jv_tran_id: s.jv_tran_id,
    jv_label: s.jv_tran_id ? voucherLabel(TRAN.JOURNAL, s.jv_tran_id) : null,
    pay_tran_id: isPaid(s) ? s.pay_tran_id : null,
    pay_label: isPaid(s) ? voucherLabel(TRAN.PAYMENT, s.pay_tran_id) : null,
    paid_on: isPaid(s) ? dayKeyOfDb(s.paid_on) : null,
    decision_note: s.decision_note,
    posted_at: s.posted_at,
  };

export const GET = hrRoute(ALL, async (req, { params, session }) => {
  await requireFeature("hr.leavingProcess");
  const id = intParam((await params).id);
  const { sep, rights } = await load(id, session);
  const [settlement, company] = await Promise.all([
    prisma.hrSettlement.findFirst({ where: { separation_id: id, status: { not: SETTLEMENT_STATUS.REVERSED } }, orderBy: { id: "desc" } }),
    getCompany().catch(() => null),
  ]);
  const st = settlement?.status;
  const sepOpen = ["approved", "completed"].includes(sep.status);
  return NextResponse.json({
    separation: separationLite(sep),
    // The employee sees their settlement once it is posted.
    settlement: rights.settlementView || st === SETTLEMENT_STATUS.POSTED ? settlementLite(settlement) : null,
    company: company ? { name: company.name, address: (company.address ?? []).filter(Boolean).join(", ") || null } : null,
    today: todayKey(),
    can: {
      clearance: Boolean(rights.leavingManage && sep.status === "approved"),
      terms: Boolean(rights.leavingManage && sep.status === "approved" && (!st || st === SETTLEMENT_STATUS.DRAFT)),
      complete: Boolean(rights.leavingManage && sep.status === "approved"),
      calculate: Boolean(rights.settlementManage && sepOpen && (!st || st === SETTLEMENT_STATUS.DRAFT)),
      submit: Boolean(rights.settlementManage && st === SETTLEMENT_STATUS.DRAFT),
      post: Boolean(rights.settlementPost && st === SETTLEMENT_STATUS.APPROVED),
      pay: Boolean(rights.settlementPost && st === SETTLEMENT_STATUS.POSTED && !isPaid(settlement) && settlement.net > 0),
      reversePayment: Boolean(rights.settlementPost && st === SETTLEMENT_STATUS.POSTED && isPaid(settlement)),
      reverse: Boolean(rights.settlementPost && st === SETTLEMENT_STATUS.POSTED && !isPaid(settlement)),
    },
  });
});

const SETTLEMENT_ACTIONS = ["calculate", "submit", "delete_draft", "post", "pay", "reverse", "reverse_payment"];

export const POST = hrRoute([HR_PERMS.leavingManage, HR_PERMS.settlementManage, HR_PERMS.settlementPost], async (req, { params, session }) => {
  await requireFeature("hr.leavingProcess");
  const id = intParam((await params).id);
  const { sep, rights } = await load(id, session);
  const b = await jsonBody(req);
  const actor = session.user.id;
  const need = (ok, code) => {
    if (!ok) throw new ForbiddenError("You may not do this on a leaving.", code);
  };
  const current = () => prisma.hrSettlement.findFirst({ where: { separation_id: id, status: { not: SETTLEMENT_STATUS.REVERSED } }, orderBy: { id: "desc" } });
  const mustHave = async () => {
    const s = await current();
    if (!s) throw new LeavingError("Work out the settlement first.", 409);
    return s;
  };
  // Nobody works on their own final settlement.
  if (SETTLEMENT_ACTIONS.includes(b.action) && (await sessionEmployeeId(session)) === sep.employee_id) {
    throw new ForbiddenError("You cannot work on your own final settlement.");
  }
  switch (b.action) {
    case "clearance":
      need(rights.leavingManage, HR_PERMS.leavingManage);
      await setClearance(id, { key: String(b.key ?? ""), done: Boolean(b.done), note: b.note, actor });
      return NextResponse.json({ message: b.done ? "Cleared." : "Marked as not cleared." });
    case "terms": {
      need(rights.leavingManage, HR_PERMS.leavingManage);
      await setTerms(id, { last_working_day: b.last_working_day, waive_notice: b.waive_notice });
      const s = await current();
      if (s?.status === SETTLEMENT_STATUS.DRAFT && rights.settlementManage) await calculateSettlement(id, { inputs: s.inputs, actor });
      return NextResponse.json({ message: "Saved." });
    }
    case "complete":
      need(rights.leavingManage, HR_PERMS.leavingManage);
      await completeSeparation(id, { actor });
      return NextResponse.json({ message: "Leaving completed — the employee's leaving date and status are set." });
    case "calculate": {
      need(rights.settlementManage, HR_PERMS.settlementManage);
      const s = await calculateSettlement(id, { inputs: b.inputs ?? {}, actor });
      return NextResponse.json({ message: `Settlement #S-${s.id} worked out — net ${s.net.toLocaleString()}.` });
    }
    case "submit": {
      need(rights.settlementManage, HR_PERMS.settlementManage);
      const r = await submitSettlement((await mustHave()).id, { session });
      return NextResponse.json({ message: `Sent for approval (#R-${r.id}).` });
    }
    case "delete_draft":
      need(rights.settlementManage, HR_PERMS.settlementManage);
      await deleteSettlementDraft((await mustHave()).id);
      return NextResponse.json({ message: "Draft settlement deleted." });
    case "post": {
      need(rights.settlementPost, HR_PERMS.settlementPost);
      const v = await postSettlement((await mustHave()).id, { date: b.date, actor });
      return NextResponse.json({ message: `Posted — ${voucherLabel(TRAN.JOURNAL, v.tran_id)}.` });
    }
    case "pay": {
      need(rights.settlementPost, HR_PERMS.settlementPost);
      const v = await paySettlement((await mustHave()).id, { date: b.date, cashAcno: b.cash_acno, reference: b.reference, session });
      return NextResponse.json({ message: `Paid from ${v.account} — ${voucherLabel(TRAN.PAYMENT, v.tran_id)}.` });
    }
    case "reverse_payment": {
      need(rights.settlementPost, HR_PERMS.settlementPost);
      const v = await reverseSettlementPayment((await mustHave()).id, { date: b.date, reason: String(b.note ?? "").trim(), actor });
      return NextResponse.json({ message: `Payment reversed — ${voucherLabel(TRAN.JOURNAL, v.tran_id)}.` });
    }
    case "reverse":
      need(rights.settlementPost, HR_PERMS.settlementPost);
      await reverseSettlement((await mustHave()).id, { date: b.date, reason: String(b.note ?? "").trim(), actor });
      return NextResponse.json({ message: "Settlement reversed — a mirror journal was posted; work it out again if needed." });
    default:
      throw new LeavingError("Unknown action.");
  }
});
