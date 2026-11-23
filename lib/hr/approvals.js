// lib/hr/approvals.js — HR requests in the Approvals inbox.
//
// An HR request is an ApprovalRequest with kind "hr" and doc_type one of
// lib/hr/approvalTypes.js. It has no approval rule: whoever holds the type's
// permission decides it, and is notified when one arrives. The inbox and the
// request page (/dashboard/approvals, app/api/approvals/requests) call
// canDecideHr / describeHrRequest / decideHrRequest for these.
//
// Approving runs the type's apply() — the same save the screen would have done
// — as a claim (pending → posting → approved), so two approvers clicking at
// once post it only once, and a failure leaves it pending with the reason.
//
// Leave and advance / loan requests may follow an APPROVAL CHAIN instead
// (lib/hr/chains.js): step by step, each step's people decide, the final step
// runs apply(), a "pay" step is done by the pay-out (completePayStep). The
// chain is copied into payload.chain when the request is filed.
import prisma from "@/lib/prisma";
import { can, hasFullAccess } from "@/lib/auth/permissions";
import { isSuperAdmin } from "@/lib/auth/roles";
import { subjectForUser } from "@/lib/auth/roleCatalog";
import { emit } from "@/lib/notifications/emit";
import { NOTIFICATION_TYPES } from "@/lib/notifications/config";
import { permissionHolderIds } from "@/lib/approvals/holders";
import { REQUEST_STATUS, notifyRequester } from "@/lib/approvals/rules";
import { HR_APPROVAL_TYPES, HR_KIND } from "@/lib/hr/approvalTypes";
import { normalizeEntries, saveEntries } from "@/lib/hr/attendance/save";
import { STATUS_META } from "@/lib/hr/attendance/rules";
import { dbDay, dayKeyOfDb, eachDay, hmOf } from "@/lib/hr/time";
import { employeeName, employeeScopeWhere, sessionEmployeeId, userIdsOfEmployee } from "@/lib/hr/access";
import { applyApproved, countedDays } from "@/lib/hr/leave/requests";
import { approveSwaps } from "@/lib/hr/attendance/swaps";
import { balancesFor, leaveYearStart } from "@/lib/hr/leave/balance";
import { fmtDays, leaveYearOf } from "@/lib/hr/leave/policy";
import { loadContext } from "@/lib/hr/attendance/sheet";
import { activateStructure, salaryOn, STRUCTURE_INCLUDE, totalsOf } from "@/lib/hr/salary/service";
import { fmtMoney } from "@/lib/hr/salary/calc";
import { activate as activateLoan, policyFlags, thisMonth } from "@/lib/hr/loans/service";
import { isPfKind, isRefundable, LOAN_KINDS, ownLoanAcno, schedule } from "@/lib/hr/loans/schedule";
import { assertPfLoansOn } from "@/lib/hr/loans/pf";
import { monthLabel } from "@/lib/hr/payroll/post";
import { chainSnapshot, finalIndex, resolveStepUsers } from "@/lib/hr/chains";
import { LEAVING_HANDLERS } from "@/lib/hr/leaving/approvalHandlers";

/** May this session approve / reject requests of this HR type? */
export async function canDecideHr(session, docType) {
  const t = HR_APPROVAL_TYPES[docType];
  if (!t || !session?.user?.id) return false;
  if (hasFullAccess(session)) return true;
  return can(session, t.permission);
}

/** HR types this session decides — for the inbox query. */
export async function hrTypesDecidableBy(session) {
  const out = [];
  for (const docType of Object.keys(HR_APPROVAL_TYPES)) if (await canDecideHr(session, docType)) out.push(docType);
  return out;
}

/** Pending / posting HR requests of a type (for "already waiting" checks). */
export const openHrRequests = (docType) =>
  prisma.approvalRequest.findMany({
    where: { kind: HR_KIND, doc_type: docType, status: { in: [REQUEST_STATUS.PENDING, REQUEST_STATUS.POSTING] } },
    select: { id: true, requested_by: true, payload: true },
  });

/**
 * File an HR request and tell its approvers. With `chain` (from
 * chainForNewRequest) it starts at the chain's first step; `employeeId` is
 * the employee it is about.
 */
export async function createHrRequest({ docType, payload, summary, session, chain = null, employeeId = null }) {
  const t = HR_APPROVAL_TYPES[docType];
  const snap = chain ? chainSnapshot(chain) : null;
  const request = await prisma.approvalRequest.create({
    data: {
      kind: HR_KIND,
      doc_type: docType,
      action: "create",
      rule_name: snap ? `${t.label} — ${snap.name}` : t.label,
      payload: snap ? { ...payload, chain: snap, employee_id: employeeId } : payload,
      summary: String(summary).slice(0, 500),
      requested_by: session.user.id,
      ...(snap
        ? {
            chain_id: snap.id,
            chain_step: 0,
            step_users: await resolveStepUsers(snap.steps[0], employeeId),
            watchers: snap.watchers,
          }
        : {}),
    },
  });
  if (snap) {
    await announceStep(request, session.user.id);
    await tellProgress(request, `filed — now with ${await stepWho(request)} (${snap.steps[0].label})`, session.user.id, { skip: request.step_users });
    return request;
  }
  try {
    const who = session.user.name || session.user.email || "Someone";
    await emit(prisma, "approvalRequested", {
      title: `Approval needed: ${t.label} #R-${request.id}`,
      message: `${who} — ${request.summary}`.slice(0, 500),
      type: NOTIFICATION_TYPES.WARNING,
      entity: "approvalRequest",
      entityId: request.id,
      extraUserIds: await approversFor(request, (await permissionHolderIds(prisma, t.permission)).filter((id) => id !== session.user.id)),
      vars: { requester: who, actor: who, type: t.label, summary: request.summary, id: `R-${request.id}`, rule: t.label },
    });
  } catch (e) {
    console.error("[hr approvals] notify approvers failed:", e);
  }
  return request;
}

/** Of these permission holders, the ones whose employees the request is about. */
async function approversFor(request, userIds) {
  const ids = [...new Set(((await HANDLERS[request.doc_type]?.employeeIds?.(request)) ?? []).filter(Number.isInteger))];
  if (!ids.length || !userIds.length) return userIds;
  const users = await prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, role: true, email: true } });
  const out = [];
  for (const u of users) {
    const scope = await employeeScopeWhere(await subjectForUser(u));
    if (!Object.keys(scope).length || (await prisma.employee.count({ where: { AND: [{ id: { in: ids } }, scope] } })) === ids.length) out.push(u.id);
  }
  return out;
}

// ── Per-type work ───────────────────────────────────────────────────────────
const statusLabel = (s) => (s === "AUTO" ? "Auto (from times)" : STATUS_META[s]?.label ?? s);

const HANDLERS = {
  hrAttendance: {
    employeeIds: (request) => (Array.isArray(request.payload?.entries) ? request.payload.entries : []).map((e) => Number(e.employee_id)),
    // Nobody approves a change to their own attendance (e.g. their own "forgot to punch").
    async selfError(request, session) {
      const me = await sessionEmployeeId(session);
      const entries = Array.isArray(request.payload?.entries) ? request.payload.entries : [];
      return me && entries.some((e) => Number(e.employee_id) === me) ? "You cannot approve or reject a change to your own attendance." : null;
    },
    async apply(request) {
      const entries = normalizeEntries(request.payload?.entries);
      const { saved, cleared } = await saveEntries({ entries, actor: request.requested_by });
      return `${saved + cleared} day(s)`;
    },
    async describe(request) {
      const entries = Array.isArray(request.payload?.entries) ? request.payload.entries : [];
      const ids = [...new Set(entries.map((e) => Number(e.employee_id)))];
      const dates = [...new Set(entries.map((e) => e.date))];
      const [emps, rows] = await Promise.all([
        prisma.employee.findMany({ where: { id: { in: ids } }, select: { id: true, firstName: true, middleName: true, surname: true } }),
        prisma.hrAttendance.findMany({ where: { employee_id: { in: ids }, date: { in: dates.map(dbDay) } } }),
      ]);
      const name = new Map(emps.map((e) => [e.id, employeeName(e)]));
      const row = new Map(rows.map((r) => [`${r.employee_id}|${dayKeyOfDb(r.date)}`, r]));
      const now = (r) =>
        r ? `${STATUS_META[r.status]?.label ?? r.status}${r.check_in ? ` · ${hmOf(r.check_in)}–${hmOf(r.check_out) ?? "?"}` : ""}` : "Nothing recorded";
      return {
        header: [
          { label: "Days", value: String(entries.length) },
          { label: "Employees", value: String(ids.length) },
          ...(request.payload?.reason ? [{ label: "Reason", value: request.payload.reason }] : []),
        ],
        changes: [],
        lines: {
          columns: ["Employee", "Date", "Recorded now", "Asked: status", "In", "Out", "Remarks"],
          rows: entries.map((e) => [
            `${name.get(Number(e.employee_id)) ?? "?"} (${e.employee_id})`,
            e.date,
            now(row.get(`${e.employee_id}|${e.date}`)),
            statusLabel(e.status),
            e.check_in || "—",
            e.check_out || "—",
            e.remarks || "—",
          ]),
        },
      };
    },
  },
};

HANDLERS.hrLeave = {
  async employeeIds(request) {
    const lr = await this.load(request);
    return lr ? [lr.employee_id] : [];
  },
  async load(request) {
    const id = Number(request.payload?.leave_request_id);
    if (!Number.isInteger(id)) return null;
    return prisma.hrLeaveRequest.findUnique({
      where: { id },
      include: { leaveType: true, employee: { select: { id: true, firstName: true, middleName: true, surname: true } } },
    });
  },
  // Nobody approves their own leave, even a manager who applied for themselves.
  async selfError(request, session) {
    const lr = await this.load(request);
    if (!lr) return null;
    return (await userIdsOfEmployee(lr.employee_id)).includes(session.user.id) ? "You cannot approve or reject your own leave." : null;
  },
  async apply(request, session) {
    const id = Number(request.payload?.leave_request_id);
    const { days, type } = await applyApproved(id, { actor: session.user.id });
    return `${fmtDays(days)} day(s) ${type.name}`;
  },
  async onReject(request, note, session) {
    await prisma.hrLeaveRequest.updateMany({
      where: { id: Number(request.payload?.leave_request_id), status: "pending" },
      data: { status: "rejected", decided_by: session.user.id, decided_at: new Date(), decision_note: note },
    });
  },
  async onCancel(request) {
    await prisma.hrLeaveRequest.updateMany({
      where: { id: Number(request.payload?.leave_request_id), status: "pending" },
      data: { status: "cancelled", decided_at: new Date(), decision_note: "Cancelled by the requester" },
    });
  },
  async describe(request) {
    const lr = await this.load(request);
    if (!lr) return { header: [{ label: "Leave", value: "This leave request no longer exists." }], changes: [], lines: { columns: [], rows: [] } };
    const from = dayKeyOfDb(lr.from_date);
    const to = dayKeyOfDb(lr.to_date);
    const sm = await leaveYearStart();
    const [ctx, bal] = await Promise.all([
      loadContext({ employeeWhere: { id: lr.employee_id }, from, to }),
      balancesFor({ employeeIds: [lr.employee_id], year: leaveYearOf(from, sm), startMonth: sm, typeIds: [lr.leave_type_id], excludeRequestId: lr.id }),
    ]);
    const counted = new Set(countedDays(ctx, lr.employee_id, from, to, lr.leaveType));
    const b = bal.rows.get(`${lr.employee_id}|${lr.leave_type_id}`);
    const left = b ? b.available : 0;
    return {
      header: [
        { label: "Employee", value: `${employeeName(lr.employee)} (#${lr.employee_id})` },
        { label: "Leave", value: `${lr.leaveType.name}${lr.leaveType.is_paid ? "" : " (unpaid)"}` },
        { label: "Dates", value: `${from}${to !== from ? ` → ${to}` : ""}${lr.half_day ? " (half day)" : ""}` },
        { label: "Days", value: fmtDays(lr.days) },
        { label: "Balance before", value: lr.leaveType.allow_negative ? "No limit" : `${fmtDays(left)} day(s)` },
        { label: "Balance after", value: lr.leaveType.allow_negative ? "No limit" : `${fmtDays(left - lr.days)} day(s)` },
        ...(lr.reason ? [{ label: "Reason", value: lr.reason }] : []),
      ],
      changes: [],
      lines: {
        columns: ["Date", "Counts as"],
        rows: eachDay(from, to).map((d) => {
          const holiday = ctx.holidayOn.get(d);
          if (counted.has(d)) return [d, lr.half_day ? "Half day of leave" : "Leave"];
          return [d, holiday ? `Holiday (${holiday.name}) — not counted` : "Week off — not counted"];
        }),
      },
    };
  },
};

HANDLERS.hrOffSwap = {
  swapIds: (request) => (Array.isArray(request.payload?.swap_ids) ? request.payload.swap_ids.map(Number).filter(Number.isInteger) : []),
  load(request) {
    return prisma.hrOffSwap.findMany({
      where: { id: { in: this.swapIds(request) } },
      include: { employee: { select: { id: true, firstName: true, middleName: true, surname: true } } },
      orderBy: { id: "asc" },
    });
  },
  async employeeIds(request) {
    return (await this.load(request)).map((s) => s.employee_id);
  },
  // Nobody approves a swap of their own off day.
  async selfError(request, session) {
    const me = await sessionEmployeeId(session);
    return me && (await this.load(request)).some((s) => s.employee_id === me) ? "You cannot approve or reject a swap of your own off day." : null;
  },
  async apply(request, session) {
    const n = await approveSwaps(this.swapIds(request), { actor: session.user.id });
    return `${n} off-day swap(s)`;
  },
  async onReject(request, note, session) {
    await prisma.hrOffSwap.updateMany({
      where: { id: { in: this.swapIds(request) }, status: "pending" },
      data: { status: "rejected", decided_by: session.user.id, decided_at: new Date(), decision_note: note },
    });
  },
  async onCancel(request) {
    await prisma.hrOffSwap.updateMany({
      where: { id: { in: this.swapIds(request) }, status: "pending" },
      data: { status: "cancelled", decided_at: new Date(), decision_note: "Cancelled by the requester" },
    });
  },
  async describe(request) {
    const swaps = await this.load(request);
    if (!swaps.length) return { header: [{ label: "Swap", value: "This swap no longer exists." }], changes: [], lines: { columns: [], rows: [] } };
    const w = dayKeyOfDb(swaps[0].work_date);
    const o = dayKeyOfDb(swaps[0].off_date);
    const dayName = (d) => new Date(`${d}T00:00:00Z`).toLocaleDateString("en-GB", { weekday: "long", timeZone: "UTC" });
    return {
      header: [
        { label: "Works on", value: `${w} (${dayName(w)}) — counted as a normal working day` },
        { label: "Off on", value: `${o} (${dayName(o)}) — paid like a week-off` },
        { label: "Employees", value: String(swaps.length) },
        ...(swaps[0].reason ? [{ label: "Reason", value: swaps[0].reason }] : []),
      ],
      changes: [],
      lines: {
        columns: ["Employee", "Works on", "Off on"],
        rows: swaps.map((s) => [`${employeeName(s.employee)} (#${s.employee_id})`, w, o]),
      },
    };
  },
};

const ownEmployeeError = async (employeeId, session, what) =>
  employeeId && (await userIdsOfEmployee(employeeId)).includes(session.user.id) ? `You cannot approve or reject your own ${what}.` : null;

HANDLERS.hrSalary = {
  async employeeIds(request) {
    const s = await this.load(request);
    return s ? [s.employee_id] : [];
  },
  load: (request) =>
    prisma.hrSalaryStructure.findUnique({
      where: { id: Number(request.payload?.structure_id) || 0 },
      include: { ...STRUCTURE_INCLUDE, employee: { select: { id: true, firstName: true, middleName: true, surname: true } } },
    }),
  async selfError(request, session) {
    const s = await this.load(request);
    return ownEmployeeError(s?.employee_id, session, "salary");
  },
  async apply(request, session) {
    const s = await activateStructure(Number(request.payload?.structure_id), { actor: session.user.id });
    return `salary from ${dayKeyOfDb(s.effective_from)}`;
  },
  async onReject(request, note, session) {
    await prisma.hrSalaryStructure.updateMany({
      where: { id: Number(request.payload?.structure_id), status: "pending" },
      data: { status: "rejected", decided_by: session.user.id, decided_at: new Date(), decision_note: note },
    });
  },
  async onCancel(request) {
    await prisma.hrSalaryStructure.updateMany({
      where: { id: Number(request.payload?.structure_id), status: "pending" },
      data: { status: "cancelled", decided_at: new Date(), decision_note: "Cancelled by the requester" },
    });
  },
  async describe(request) {
    const s = await this.load(request);
    if (!s) return { header: [{ label: "Salary", value: "This revision no longer exists." }], changes: [], lines: { columns: [], rows: [] } };
    const from = dayKeyOfDb(s.effective_from);
    const current = (await salaryOn([s.employee_id], from)).get(s.employee_id);
    const cur = current && current.id !== s.id ? totalsOf(current) : null;
    const next = totalsOf(s);
    const amountOf = (t, compId) => [...(t?.earnings ?? []), ...(t?.deductions ?? [])].find((r) => r.component.id === compId)?.amount ?? 0;
    const comps = new Map();
    for (const r of [...(cur?.earnings ?? []), ...(cur?.deductions ?? []), ...next.earnings, ...next.deductions]) comps.set(r.component.id, r.component);
    const rows = [["Basic", cur ? fmtMoney(cur.basic) : "—", fmtMoney(next.basic), cur ? fmtMoney(next.basic - cur.basic) : "—"]];
    for (const c of comps.values()) {
      const was = amountOf(cur, c.id);
      const now = amountOf(next, c.id);
      rows.push([`${c.kind === "DEDUCTION" ? "− " : "+ "}${c.name}`, cur ? fmtMoney(was) : "—", fmtMoney(now), cur ? fmtMoney(now - was) : "—"]);
    }
    rows.push(["Gross", cur ? fmtMoney(cur.gross) : "—", fmtMoney(next.gross), cur ? fmtMoney(next.gross - cur.gross) : "—"]);
    rows.push(["Net (before payroll items)", cur ? fmtMoney(cur.net) : "—", fmtMoney(next.net), cur ? fmtMoney(next.net - cur.net) : "—"]);
    const pct = cur?.gross ? ` (${(((next.gross - cur.gross) / cur.gross) * 100).toFixed(1)}%)` : "";
    return {
      header: [
        { label: "Employee", value: `${employeeName(s.employee)} (#${s.employee_id})` },
        { label: "Effective from", value: from },
        { label: "Gross", value: `${cur ? `${fmtMoney(cur.gross)} → ` : ""}${fmtMoney(next.gross)}${pct}` },
        ...(s.reason ? [{ label: "Reason", value: s.reason }] : []),
      ],
      changes: [],
      lines: { columns: ["", "Now", "Revised", "Change"], rows },
    };
  },
};

HANDLERS.hrLoan = {
  async employeeIds(request) {
    const l = await prisma.hrLoan.findUnique({ where: { id: Number(request.payload?.loan_id) || 0 }, select: { employee_id: true } });
    return l ? [l.employee_id] : [];
  },
  load: (request) =>
    prisma.hrLoan.findUnique({
      where: { id: Number(request.payload?.loan_id) || 0 },
      include: {
        recoveries: true,
        employee: {
          select: {
            id: true, firstName: true, middleName: true, surname: true, advanceAcno: true, loanAcno: true,
            cnicNumber: true, hireDate: true, Designation: { select: { desg_name: true } }, department: { select: { dept_name: true } },
          },
        },
      },
    }),
  async selfError(request, session) {
    const l = await this.load(request);
    return ownEmployeeError(l?.employee_id, session, "advance / loan");
  },
  async apply(request, session) {
    const l = await activateLoan(Number(request.payload?.loan_id), { actor: session.user.id });
    return `${LOAN_KINDS[l.kind].short} ${fmtMoney(l.amount)}`;
  },
  async onReject(request, note, session) {
    const id = Number(request.payload?.loan_id);
    const r = await prisma.hrLoan.updateMany({
      where: { id, status: "pending" },
      data: { status: "rejected", decided_by: session.user.id, decided_at: new Date(), decision_note: note },
    });
    if (r.count) await prisma.hrLoanEvent.create({ data: { loan_id: id, action: "rejected", detail: note, created_by: session.user.id } });
  },
  async onCancel(request) {
    const id = Number(request.payload?.loan_id);
    const r = await prisma.hrLoan.updateMany({ where: { id, status: "pending" }, data: { status: "cancelled", decided_at: new Date(), decision_note: "Cancelled by the requester" } });
    if (r.count) await prisma.hrLoanEvent.create({ data: { loan_id: id, action: "cancelled", detail: "by the requester (Approvals)", created_by: request.requested_by } });
  },
  async describe(request) {
    const l = await this.load(request);
    if (!l) return { header: [{ label: "Loan", value: "This application no longer exists." }], changes: [], lines: { columns: [], rows: [] } };
    const { flags, gross } = await policyFlags({ employee_id: l.employee_id, kind: l.kind, amount: l.amount, excludeLoanId: l.id });
    const plan = schedule({ ...l, status: "active" }, l.recoveries, thisMonth());
    const acno = ownLoanAcno(l.kind, l.employee);
    const refundable = isRefundable(l.kind);
    return {
      header: [
        { label: "Employee", value: `${employeeName(l.employee)} (#${l.employee_id})` },
        { label: "Type", value: LOAN_KINDS[l.kind].label },
        { label: "Amount", value: fmtMoney(l.amount) },
        refundable
          ? { label: "Monthly instalment", value: `${fmtMoney(l.installment)} × ${plan.length} month(s), from ${l.start_month}` }
          : { label: "Paid back", value: "No — a withdrawal reduces the provident fund for good" },
        { label: "Gross salary", value: gross ? fmtMoney(gross) : "Not set" },
        {
          label: "Ledger account",
          value: isPfKind(l.kind) ? "Provident Fund Payable (Account Settings → Payroll)" : acno ? String(acno) : "Not set on the employee — payroll uses the default",
        },
        ...(l.reason ? [{ label: "Reason", value: l.reason }] : []),
        ...flags.map((f) => ({ label: "⚠ Check", value: f })),
      ],
      changes: [],
      lines: refundable
        ? { columns: ["Month", "Instalment", "Left after"], rows: plan.map((r) => [r.month, fmtMoney(r.planned ?? r.recovered), fmtMoney(r.balance)]) }
        : { columns: [], rows: [] },
      // The company's own application letter (components/HR/approvedFormPdf.js).
      form: {
        kind: l.kind,
        employee_name: employeeName(l.employee),
        employee_code: String(l.employee_id),
        designation: l.employee.Designation?.desg_name || "",
        department: l.employee.department?.dept_name || "",
        joined: l.employee.hireDate,
        cnic: l.employee.cnicNumber || "",
        salary: gross || null,
        amount: l.amount,
        purpose: l.reason || "",
        months: plan.length,
        installment: l.installment,
        start_month: l.start_month,
      },
    };
  },
};

// Provident fund loans / withdrawals (feature hr.pfLoans): the same HrLoan
// flow, decided by PF loan approvers (hr.pfloan.approve); refused while off.
HANDLERS.hrPfLoan = {
  ...HANDLERS.hrLoan,
  async apply(request, session) {
    const l = await prisma.hrLoan.findUnique({ where: { id: Number(request.payload?.loan_id) || 0 }, select: { kind: true } });
    await assertPfLoansOn(l?.kind ?? "PF_LOAN");
    return HANDLERS.hrLoan.apply(request, session);
  },
};

HANDLERS.hrPayroll = {
  async employeeIds(request) {
    const rows = await prisma.hrPayslip.findMany({ where: { run_id: Number(request.payload?.run_id) || 0 }, select: { employee_id: true } });
    return rows.map((r) => r.employee_id);
  },
  load: (request) =>
    prisma.hrPayrollRun.findUnique({
      where: { id: Number(request.payload?.run_id) || 0 },
      include: { payslips: { include: { employee: { select: { id: true, firstName: true, middleName: true, surname: true } } }, orderBy: { employee_id: "asc" } } },
    }),
  // An approver whose own salary is in the run may not approve it (Super Admin excepted).
  async selfError(request, session) {
    if (isSuperAdmin(session)) return null;
    const me = await sessionEmployeeId(session);
    if (!me) return null;
    const mine = await prisma.hrPayslip.count({ where: { run_id: Number(request.payload?.run_id) || 0, employee_id: me } });
    return mine ? "Your own salary is in this payroll — another approver must decide it." : null;
  },
  async apply(request, session) {
    const id = Number(request.payload?.run_id);
    const r = await prisma.hrPayrollRun.updateMany({
      where: { id, status: "PENDING" },
      data: { status: "APPROVED", decided_by: session.user.id, decided_at: new Date(), decision_note: null },
    });
    if (r.count !== 1) throw new Error("This payroll is no longer waiting for approval.");
    const run = await prisma.hrPayrollRun.findUnique({ where: { id }, select: { month: true } });
    return `payroll ${monthLabel(run.month)} — ready to post`;
  },
  async onReject(request, note, session) {
    await prisma.hrPayrollRun.updateMany({
      where: { id: Number(request.payload?.run_id), status: "PENDING" },
      data: { status: "DRAFT", decided_by: session.user.id, decided_at: new Date(), decision_note: note, approval_request_id: null },
    });
  },
  async onCancel(request) {
    await prisma.hrPayrollRun.updateMany({
      where: { id: Number(request.payload?.run_id), status: "PENDING" },
      data: { status: "DRAFT", decision_note: "Withdrawn by the requester", approval_request_id: null },
    });
  },
  async describe(request) {
    const run = await this.load(request);
    if (!run) return { header: [{ label: "Payroll", value: "This payroll no longer exists." }], changes: [], lines: { columns: [], rows: [] } };
    const warned = run.payslips.filter((p) => p.warnings.length);
    return {
      header: [
        { label: "Month", value: `${monthLabel(run.month)} (#P-${run.id})` },
        { label: "Employees", value: String(run.employees) },
        { label: "Earnings", value: fmtMoney(run.total_earnings) },
        { label: "Deductions", value: fmtMoney(run.total_deductions) },
        { label: "Net pay", value: fmtMoney(run.total_net) },
        { label: "Employer EOBI", value: fmtMoney(run.total_employer) },
        { label: "Pay date (journal)", value: dayKeyOfDb(run.pay_date) },
        ...(warned.length ? [{ label: "⚠ Check", value: `${warned.length} payslip(s) have warnings — see the payroll screen` }] : []),
        ...(run.notes ? [{ label: "Notes", value: run.notes }] : []),
      ],
      changes: [],
      lines: {
        columns: ["Employee", "Paid days", "Earnings", "Deductions", "Net", "Warnings"],
        rows: run.payslips.map((p) => [
          `${employeeName(p.employee)} (#${p.employee_id})`,
          String(p.paid_days),
          fmtMoney(p.total_earnings),
          fmtMoney(p.total_deductions),
          fmtMoney(p.net),
          p.warnings.join(" · ") || "—",
        ]),
      },
    };
  },
};

// Leaving process and final settlement (feature hr.leavingProcess).
Object.assign(HANDLERS, LEAVING_HANDLERS);

export const describeHrRequest = (request) => HANDLERS[request.doc_type].describe(request);

// ── Approval chains ─────────────────────────────────────────────────────────
const strIds = (v) => [...new Set((Array.isArray(v) ? v : []).map(String).filter(Boolean))];

/** The chain a request follows (its copy in payload.chain), or null. */
export const chainOf = (request) =>
  request?.chain_id != null && Array.isArray(request?.payload?.chain?.steps) ? request.payload.chain : null;

/** The step the request is on now, or null. */
export const currentStep = (request) => chainOf(request)?.steps?.[request.chain_step] ?? null;

async function employeeIdOf(request) {
  const own = Number(request.payload?.employee_id);
  if (Number.isInteger(own) && own > 0) return own;
  const ids = (await HANDLERS[request.doc_type]?.employeeIds?.(request)) ?? [];
  return ids[0] ?? null;
}

async function namesOf(userIds) {
  const list = strIds(userIds);
  if (!list.length) return new Map();
  const users = await prisma.user.findMany({ where: { id: { in: list } }, select: { id: true, name: true, email: true } });
  return new Map(users.map((u) => [u.id, u.name || u.email || u.id]));
}

/** "Tatheer Saleem" / "Saifullah or Naveed Ahmed" — who acts on the current step. */
async function stepWho(request) {
  const names = await namesOf(request.step_users);
  const list = strIds(request.step_users).map((id) => names.get(id) || id);
  return list.length ? list.join(" or ") : "a Super Admin (nobody is set on this step)";
}

const titleOf = (request) => `${HR_APPROVAL_TYPES[request.doc_type]?.label ?? "Request"} #R-${request.id}`;

/** Tell the people of the current step it is waiting for them. */
async function announceStep(request, actorId) {
  const step = currentStep(request);
  if (!step) return;
  const to = strIds(request.step_users).filter((id) => id !== actorId);
  if (!to.length) return;
  const chain = chainOf(request);
  try {
    if (step.type === "pay") {
      await emit(prisma, "hrRequestProgress", {
        title: `Ready to pay: ${titleOf(request)}`,
        message: `${request.summary} — approved; pay it out on Advances & Loans.`.slice(0, 500),
        type: NOTIFICATION_TYPES.WARNING,
        entity: "approvalRequest",
        entityId: request.id,
        onlyUserIds: to,
        extraUserIds: to,
        vars: { type: HR_APPROVAL_TYPES[request.doc_type]?.label, id: `R-${request.id}`, step: step.label, status: "Ready to pay", summary: request.summary },
      });
      return;
    }
    await emit(prisma, "approvalRequested", {
      title: `Approval needed: ${titleOf(request)} — ${step.label}`,
      message: `${request.summary} (step ${request.chain_step + 1} of ${chain.steps.length})`.slice(0, 500),
      type: NOTIFICATION_TYPES.WARNING,
      entity: "approvalRequest",
      entityId: request.id,
      onlyUserIds: to,
      extraUserIds: to,
      vars: { requester: "", actor: "", type: HR_APPROVAL_TYPES[request.doc_type]?.label, summary: request.summary, id: `R-${request.id}`, rule: `${chain.name} — ${step.label}` },
    });
  } catch (e) {
    console.error("[hr chains] announce step failed:", e);
  }
}

/** Tell the watchers, the requester and the employee how the request moved. */
async function tellProgress(request, text, actorId, { type = NOTIFICATION_TYPES.INFO, skip = [] } = {}) {
  try {
    const employeeId = await employeeIdOf(request);
    const to = strIds([
      ...(request.watchers ?? []),
      request.requested_by,
      ...(employeeId ? await userIdsOfEmployee(employeeId) : []),
    ]).filter((id) => id !== actorId && !skip.includes(id));
    if (!to.length) return;
    await emit(prisma, "hrRequestProgress", {
      title: `${titleOf(request)}: ${text}`.slice(0, 200),
      message: request.summary.slice(0, 500),
      type,
      entity: "approvalRequest",
      entityId: request.id,
      onlyUserIds: to,
      extraUserIds: to,
      vars: { type: HR_APPROVAL_TYPES[request.doc_type]?.label, id: `R-${request.id}`, step: currentStep(request)?.label ?? "", status: text, summary: request.summary },
    });
  } catch (e) {
    console.error("[hr chains] progress notice failed:", e);
  }
}

/** May this session approve / reject this HR request now? */
export async function mayDecideHr(session, request) {
  if (!chainOf(request)) return canDecideHr(session, request.doc_type);
  const step = currentStep(request);
  if (!step || step.type !== "approve") return false;
  return isSuperAdmin(session) || strIds(request.step_users).includes(session.user.id);
}

/** May this session open this HR request? */
export async function mayViewHr(session, request) {
  const me = session.user.id;
  if (request.requested_by === me) return true;
  if (!chainOf(request)) return canDecideHr(session, request.doc_type);
  if (isSuperAdmin(session)) return true;
  if ([...(request.step_users ?? []), ...(request.watchers ?? []), ...(request.chain_actors ?? [])].includes(me)) return true;
  const employeeId = await employeeIdOf(request);
  return Boolean(employeeId && (await userIdsOfEmployee(employeeId)).includes(me));
}

/** The chain as the request page shows it: each step, who, done / now / waiting. */
export async function chainView(request) {
  const chain = chainOf(request);
  if (!chain) return null;
  const log = Array.isArray(request.chain_log) ? request.chain_log : [];
  const open = request.status === REQUEST_STATUS.PENDING || request.status === REQUEST_STATUS.POSTING;
  const cur = request.chain_step ?? 0;
  const employeeId = await employeeIdOf(request);
  const step = chain.steps[cur];
  const nextStep = chain.steps[cur + 1];
  const pickFrom = open && step?.type === "approve" && step.pickNext && nextStep ? await resolveStepUsers(nextStep, employeeId) : [];
  const names = await namesOf([
    ...chain.steps.flatMap((s) => s.users ?? []),
    ...(request.step_users ?? []),
    ...log.flatMap((l) => [l.by, ...(l.forwarded_to ?? [])]),
    ...pickFrom,
  ]);
  const nm = (id) => names.get(id) || id;
  return {
    name: chain.name,
    current: cur,
    final: finalIndex(chain.steps),
    steps: chain.steps.map((s, i) => {
      const acted = log.filter((l) => l.step === i);
      let state = "waiting";
      if (request.status === REQUEST_STATUS.APPROVED || i < cur) state = "done";
      else if (i === cur && open) state = "current";
      else if (i === cur && request.status === REQUEST_STATUS.REJECTED) state = "rejected";
      else if (i === cur && request.status === REQUEST_STATUS.CANCELLED) state = "cancelled";
      return {
        label: s.label,
        type: s.type,
        final: i === finalIndex(chain.steps),
        who: [...(s.users ?? []).map(nm), ...(s.roles ?? []).map((r) => `role:${r}`), ...(s.manager ? ["Reporting manager"] : [])],
        now: i === cur && open ? strIds(request.step_users).map(nm) : [],
        state,
        acted: acted.map((l) => ({
          action: l.action,
          by: l.by_name || nm(l.by),
          at: l.at,
          note: l.note || null,
          forwarded_to: (l.forwarded_to ?? []).map(nm),
        })),
      };
    }),
    pick_next: pickFrom.length ? { label: nextStep.label, options: pickFrom.map((id) => ({ id, name: nm(id) })) } : null,
    pay_step: open && step?.type === "pay",
  };
}

/** Approve / reject the current step of a chained request. */
async function decideChainStep({ request, action, note, session, nextUsers }) {
  const chain = chainOf(request);
  const idx = request.chain_step ?? 0;
  const step = chain.steps[idx];
  if (!step) return { status: 409, body: { error: "This request has no step left to decide." } };
  if (step.type === "pay") return { status: 409, body: { error: "This step is done by paying it out on the Advances & Loans screen." } };
  // Nobody decides their own request (Super Admin excepted); the chain itself
  // says who decides, so the HR data scope is not checked here.
  const h = HANDLERS[request.doc_type];
  const own = h?.selfError && !isSuperAdmin(session) ? await h.selfError(request, session) : null;
  if (own) return { status: 403, body: { error: own } };

  const me = session.user.id;
  const byName = session.user.name || session.user.email || me;
  const at = new Date();
  const log = Array.isArray(request.chain_log) ? request.chain_log : [];
  const actors = strIds([...(request.chain_actors ?? []), me]);
  const entry = { step: idx, label: step.label, by: me, by_name: byName, at: at.toISOString(), note: note || null };

  if (action === "reject") {
    if (idx > finalIndex(chain.steps)) {
      return { status: 409, body: { error: "It is already approved — to stop it, cancel the advance / loan on its own screen." } };
    }
    if (!note) return { status: 400, body: { error: "Give the reason for rejecting — the requester will see it." } };
    const r = await prisma.approvalRequest.updateMany({
      where: { id: request.id, status: REQUEST_STATUS.PENDING, chain_step: idx },
      data: {
        status: REQUEST_STATUS.REJECTED, decided_by: me, decided_at: at, remarks: note,
        chain_log: [...log, { ...entry, action: "rejected" }], chain_actors: actors, step_users: [],
      },
    });
    if (r.count !== 1) return { status: 409, body: { error: "This request has moved on or is being decided by someone else — refresh." } };
    await h.onReject?.(request, note, session);
    const done = await prisma.approvalRequest.findUnique({ where: { id: request.id } });
    await notifyRequester(done, "rejected", "error");
    await tellProgress(done, `rejected at "${step.label}" by ${byName}`, me, { type: NOTIFICATION_TYPES.ERROR });
    return { status: 200, body: { success: true, message: "Rejected — nothing was changed; the requester has been told why." } };
  }

  // Who takes the next step: everyone on it, or the one(s) picked here.
  const nextIdx = idx + 1 < chain.steps.length ? idx + 1 : null;
  const employeeId = await employeeIdOf(request);
  let next = nextIdx != null ? await resolveStepUsers(chain.steps[nextIdx], employeeId) : [];
  let forwarded = null;
  if (nextIdx != null && step.pickNext) {
    const picked = strIds(nextUsers).filter((id) => next.includes(id));
    if (!picked.length && next.length > 1) {
      return { status: 400, body: { error: `Choose who takes the next step (${chain.steps[nextIdx].label}).` } };
    }
    if (picked.length) next = picked;
    forwarded = next;
  }
  const newLog = [...log, { ...entry, action: "approved", ...(forwarded ? { forwarded_to: forwarded } : {}) }];
  const finished = nextIdx == null;
  const moveOn = finished
    ? { status: REQUEST_STATUS.APPROVED, decided_by: me, decided_at: at, remarks: note, step_users: [] }
    : { chain_step: nextIdx, step_users: next, decided_by: me, remarks: note };

  let posted = null;
  if (idx === finalIndex(chain.steps)) {
    // The final approval: claim it, then apply (leave booked, loan active).
    const claimed = await prisma.approvalRequest.updateMany({
      where: { id: request.id, status: REQUEST_STATUS.PENDING, chain_step: idx },
      data: { status: REQUEST_STATUS.POSTING, decided_by: me },
    });
    if (claimed.count !== 1) return { status: 409, body: { error: "This request has moved on or is being decided by someone else — refresh." } };
    try {
      posted = await h.apply(request, session);
    } catch (e) {
      await prisma.approvalRequest.update({
        where: { id: request.id },
        data: { status: REQUEST_STATUS.PENDING, decided_by: null, post_error: String(e.message || e).slice(0, 500) },
      });
      return { status: 422, body: { error: `Approved, but it could not be applied: ${e.message}. Fix the cause and approve again.` } };
    }
    await prisma.approvalRequest.update({
      where: { id: request.id },
      data: { ...moveOn, ...(finished ? {} : { status: REQUEST_STATUS.PENDING }), posted_no: posted, post_error: null, chain_log: newLog, chain_actors: actors },
    });
  } else {
    const r = await prisma.approvalRequest.updateMany({
      where: { id: request.id, status: REQUEST_STATUS.PENDING, chain_step: idx },
      data: { ...moveOn, chain_log: newLog, chain_actors: actors },
    });
    if (r.count !== 1) return { status: 409, body: { error: "This request has moved on or is being decided by someone else — refresh." } };
  }

  const fresh = await prisma.approvalRequest.findUnique({ where: { id: request.id } });
  if (finished) {
    await notifyRequester(fresh, "approved", "success");
    await tellProgress(fresh, `fully approved (last step "${step.label}" by ${byName})`, me, { type: NOTIFICATION_TYPES.SUCCESS });
    return { status: 200, body: { success: true, message: `Approved — ${posted ? `${posted} updated` : "every step is done"}.` } };
  }
  await announceStep(fresh, me);
  const nextStep = chain.steps[nextIdx];
  const who = await stepWho(fresh);
  const text =
    posted && nextStep.type === "pay"
      ? `approved — payment pending (${who})`
      : `${step.label} approved by ${byName} — now with ${who} (${nextStep.label})`;
  await tellProgress(fresh, text, me, { type: posted ? NOTIFICATION_TYPES.SUCCESS : NOTIFICATION_TYPES.INFO, skip: fresh.step_users });
  return {
    status: 200,
    body: { success: true, message: `${posted ? `Approved — ${posted} updated. ` : "Approved. "}Now with ${who} (${nextStep.label}).` },
  };
}

/**
 * The advance / loan behind this request was paid out (payment voucher):
 * finish its "pay" step. Called after the pay-out; never fails it.
 */
export async function completePayStep(requestId, session, detail) {
  try {
    if (!requestId) return;
    const request = await prisma.approvalRequest.findUnique({ where: { id: Number(requestId) } });
    if (!request || request.status !== REQUEST_STATUS.PENDING || currentStep(request)?.type !== "pay") return;
    const chain = chainOf(request);
    const idx = request.chain_step;
    const me = session.user.id;
    const byName = session.user.name || session.user.email || me;
    const nextIdx = idx + 1 < chain.steps.length ? idx + 1 : null;
    const next = nextIdx != null ? await resolveStepUsers(chain.steps[nextIdx], await employeeIdOf(request)) : [];
    const at = new Date();
    const r = await prisma.approvalRequest.updateMany({
      where: { id: request.id, status: REQUEST_STATUS.PENDING, chain_step: idx },
      data: {
        ...(nextIdx == null
          ? { status: REQUEST_STATUS.APPROVED, decided_by: me, decided_at: at, step_users: [] }
          : { chain_step: nextIdx, step_users: next }),
        chain_log: [...(request.chain_log ?? []), { step: idx, label: chain.steps[idx].label, action: "paid", by: me, by_name: byName, at: at.toISOString(), note: detail || null }],
        chain_actors: strIds([...(request.chain_actors ?? []), me]),
      },
    });
    if (r.count !== 1) return;
    const fresh = await prisma.approvalRequest.findUnique({ where: { id: request.id } });
    if (nextIdx == null) await notifyRequester(fresh, "paid", "success");
    else await announceStep(fresh, me);
    await tellProgress(fresh, `paid by ${byName}${detail ? ` — ${detail}` : ""}`, me, { type: NOTIFICATION_TYPES.SUCCESS });
  } catch (e) {
    console.error("[hr chains] pay step failed:", e);
  }
}

/**
 * A reason this session may not decide this request, or null:
 *   · it is their own (own leave, own salary, a payroll with their own pay …)
 *   · it is about employees outside the ones they work with — a plant
 *     supervisor decides for the plant, a team leader for their team only
 *     (lib/hr/access.js → employeeScopeWhere)
 */
export async function hrSelfError(request, session) {
  const h = HANDLERS[request.doc_type];
  // A Super Admin may decide their own request (owner's decision, as for
  // documents — lib/approvals/rules.js selfDecisionError).
  const own = h?.selfError && !isSuperAdmin(session) ? await h.selfError(request, session) : null;
  if (own) return own;
  const ids = [...new Set(((await h?.employeeIds?.(request)) ?? []).filter(Number.isInteger))];
  if (!ids.length) return null;
  const scope = await employeeScopeWhere(session);
  if (!Object.keys(scope).length) return null;
  const inside = await prisma.employee.count({ where: { AND: [{ id: { in: ids } }, scope] } });
  return inside === ids.length ? null : "This is about employees outside your departments, locations or team — someone responsible for them must decide it.";
}

/** The requester cancelled it in the inbox — let the HR document know. */
export async function hrRequestCancelled(request) {
  try {
    await HANDLERS[request.doc_type]?.onCancel?.(request);
  } catch (e) {
    console.error("[hr approvals] cancel hook failed:", e);
  }
}

/**
 * Approve or reject an HR request. Returns { status, body } for the route.
 * The caller has checked it is pending and that the session may decide it.
 */
export async function decideHrRequest({ request, action, note, session, nextUsers = [] }) {
  if (chainOf(request)) return decideChainStep({ request, action, note, session, nextUsers });
  const own = await hrSelfError(request, session);
  if (own) return { status: 403, body: { error: own } };
  if (action === "reject") {
    if (!note) return { status: 400, body: { error: "Give the reason for rejecting — the requester will see it." } };
    const r = await prisma.approvalRequest.updateMany({
      where: { id: request.id, status: REQUEST_STATUS.PENDING },
      data: { status: REQUEST_STATUS.REJECTED, decided_by: session.user.id, decided_at: new Date(), remarks: note },
    });
    if (r.count !== 1) return { status: 409, body: { error: "This request is already being decided by someone else." } };
    await HANDLERS[request.doc_type].onReject?.(request, note, session);
    await notifyRequester(await prisma.approvalRequest.findUnique({ where: { id: request.id } }), "rejected", "error");
    return { status: 200, body: { success: true, message: "Rejected — nothing was changed; the requester has been told why." } };
  }

  const claimed = await prisma.approvalRequest.updateMany({
    where: { id: request.id, status: REQUEST_STATUS.PENDING },
    data: { status: REQUEST_STATUS.POSTING, decided_by: session.user.id },
  });
  if (claimed.count !== 1) return { status: 409, body: { error: "This request is already being decided by someone else." } };
  try {
    const posted = await HANDLERS[request.doc_type].apply(request, session);
    const done = await prisma.approvalRequest.update({
      where: { id: request.id },
      data: { status: REQUEST_STATUS.APPROVED, decided_at: new Date(), remarks: note, posted_no: posted, post_error: null },
    });
    await notifyRequester(done, "approved", "success");
    return { status: 200, body: { success: true, message: `Approved — ${posted} updated.` } };
  } catch (e) {
    await prisma.approvalRequest.update({
      where: { id: request.id },
      data: { status: REQUEST_STATUS.PENDING, decided_by: null, post_error: String(e.message || e).slice(0, 500) },
    });
    return { status: 422, body: { error: `Approved, but it could not be applied: ${e.message}. Fix the cause and approve again.` } };
  }
}
