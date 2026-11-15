// lib/hr/leaving/approvalHandlers.js — the Approvals inbox work for the
// leaving process (doc types hrSeparation, hrSettlement; lib/hr/approvalTypes.js).
// Merged into lib/hr/approvals.js HANDLERS. Approving while the feature
// hr.leavingProcess is off is refused (the request stays pending).
import prisma from "@/lib/prisma";
import { employeeName, userIdsOfEmployee } from "@/lib/hr/access";
import { feature } from "@/lib/features/server";
import { fmtMoney } from "@/lib/hr/salary/calc";
import { approveSeparation, noticeServed, SEP_INCLUDE, SEP_STATUS, SEPARATION_KINDS } from "@/lib/hr/leaving/separation";
import { SETTLEMENT_STATUS } from "@/lib/hr/leaving/settlement";
import { dayKeyOfDb } from "@/lib/hr/time";

const gone = (what) => ({ header: [{ label: what, value: "This no longer exists." }], changes: [], lines: { columns: [], rows: [] } });
const ownError = async (employeeId, session, what) =>
  employeeId && (await userIdsOfEmployee(employeeId)).includes(session.user.id) ? `You cannot approve or reject your own ${what}.` : null;
async function featureOn() {
  if (!(await feature("hr.leavingProcess"))) throw new Error("The leaving process is switched off (Settings → Features)");
}

const hrSeparation = {
  load: (request) => prisma.hrSeparation.findUnique({ where: { id: Number(request.payload?.separation_id) || 0 }, include: SEP_INCLUDE }),
  async employeeIds(request) {
    const s = await this.load(request);
    return s ? [s.employee_id] : [];
  },
  async selfError(request, session) {
    const s = await this.load(request);
    return ownError(s?.employee_id, session, "leaving");
  },
  async apply(request, session) {
    await featureOn();
    const s = await approveSeparation(Number(request.payload?.separation_id), { actor: session.user.id });
    return `${SEPARATION_KINDS[s.kind]?.label ?? s.kind} of ${employeeName(s.employee)} — clearance next`;
  },
  async onReject(request, note, session) {
    await prisma.hrSeparation.updateMany({
      where: { id: Number(request.payload?.separation_id), status: SEP_STATUS.PENDING },
      data: { status: SEP_STATUS.REJECTED, decided_by: session.user.id, decided_at: new Date(), decision_note: note },
    });
  },
  async onCancel(request) {
    await prisma.hrSeparation.updateMany({
      where: { id: Number(request.payload?.separation_id), status: SEP_STATUS.PENDING },
      data: { status: SEP_STATUS.CANCELLED, decided_at: new Date(), decision_note: "Withdrawn by the requester" },
    });
  },
  async describe(request) {
    const s = await this.load(request);
    if (!s) return gone("Leaving");
    const nd = dayKeyOfDb(s.notice_date);
    const lwd = dayKeyOfDb(s.last_working_day);
    const served = noticeServed(nd, lwd);
    return {
      header: [
        { label: "Employee", value: `${employeeName(s.employee)} (#${s.employee_id})${s.employee.department ? ` — ${s.employee.department.dept_name}` : ""}` },
        { label: "Type", value: SEPARATION_KINDS[s.kind]?.label ?? s.kind },
        { label: "Joined", value: dayKeyOfDb(s.employee.hireDate) },
        { label: "Notice given", value: nd },
        { label: "Last working day", value: lwd },
        { label: "Notice", value: `${served} of ${s.notice_days} day(s)${served < s.notice_days ? ` — ${s.notice_days - served} short` : ""}` },
        ...(s.reason ? [{ label: "Reason", value: s.reason }] : []),
      ],
      changes: [],
      lines: { columns: ["Clearance after approval"], rows: (Array.isArray(s.clearance) ? s.clearance : []).map((c) => [c.label]) },
    };
  },
};

const hrSettlement = {
  load: (request) =>
    prisma.hrSettlement.findUnique({
      where: { id: Number(request.payload?.settlement_id) || 0 },
      include: { employee: { select: { id: true, firstName: true, middleName: true, surname: true } } },
    }),
  async employeeIds(request) {
    const s = await this.load(request);
    return s ? [s.employee_id] : [];
  },
  async selfError(request, session) {
    const s = await this.load(request);
    return ownError(s?.employee_id, session, "final settlement");
  },
  async apply(request, session) {
    await featureOn();
    const id = Number(request.payload?.settlement_id);
    const r = await prisma.hrSettlement.updateMany({
      where: { id, status: SETTLEMENT_STATUS.PENDING },
      data: { status: SETTLEMENT_STATUS.APPROVED, decided_by: session.user.id, decided_at: new Date(), decision_note: null },
    });
    if (r.count !== 1) throw new Error("This settlement is no longer waiting for approval");
    return `final settlement #S-${id} — ready to post`;
  },
  async onReject(request, note, session) {
    await prisma.hrSettlement.updateMany({
      where: { id: Number(request.payload?.settlement_id), status: SETTLEMENT_STATUS.PENDING },
      data: { status: SETTLEMENT_STATUS.DRAFT, decided_by: session.user.id, decided_at: new Date(), decision_note: note, approval_request_id: null },
    });
  },
  async onCancel(request) {
    await prisma.hrSettlement.updateMany({
      where: { id: Number(request.payload?.settlement_id), status: SETTLEMENT_STATUS.PENDING },
      data: { status: SETTLEMENT_STATUS.DRAFT, decision_note: "Withdrawn by the requester", approval_request_id: null },
    });
  },
  async describe(request) {
    const s = await this.load(request);
    if (!s) return gone("Settlement");
    const d = s.data ?? {};
    return {
      header: [
        { label: "Employee", value: `${employeeName(s.employee)} (#${s.employee_id})` },
        { label: "Leaving", value: `${d.kind_label ?? ""} — last day ${d.dor ?? dayKeyOfDb(s.dor)}` },
        { label: "Service", value: `${d.service_months ?? 0} month(s) since ${d.hired ?? "?"}` },
        { label: "Earnings", value: fmtMoney(s.total_earnings) },
        { label: "Deductions", value: fmtMoney(s.total_deductions) },
        { label: "Net payable", value: fmtMoney(s.net) },
        ...(d.warnings ?? []).map((w) => ({ label: "⚠ Check", value: w })),
      ],
      changes: [],
      lines: {
        columns: ["", "Earning", "Deduction"],
        rows: (d.lines ?? []).map((l) => [l.label, l.kind === "EARNING" ? fmtMoney(l.amount) : "", l.kind === "DEDUCTION" ? fmtMoney(l.amount) : ""]),
      },
    };
  },
};

export const LEAVING_HANDLERS = { hrSeparation, hrSettlement };
