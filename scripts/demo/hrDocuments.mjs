// scripts/demo/hrDocuments.mjs — the HR + payroll part of the demo documents
// (called from scripts/demo/seed-documents.mjs). Everything goes through the
// app's own API, each step by the person whose job it is:
//   hr            shifts, holidays, leave entered for staff
//   hr.manager    HR rules, salaries, attendance register, leave / loan approvals,
//                 payroll prepared + submitted, the leaving and its settlement
//   cfo / ceo     payroll approved (two runs a month, so nobody approves a run
//                 that holds their own salary), leaving + settlement approved
//   accounts.manager  payroll posted (JV) and paid, advances / loans paid out,
//                 settlement posted and paid
//
// Calendar: setup on 1 June; each month's attendance, leave, loans and payroll
// run on the first working day of the next month (hrMonth). October also has a
// resignation → clearance → final settlement. November: a PF loan.
//
// The one thing the API cannot do for history: an advance / loan's first
// recovery month cannot be in the past. Those loans are applied with the
// current month and moved to their historical month afterwards
// (backdateLoan) — demo database only, as backdateProcessOrder in seed-documents.
import { AC } from "./seed-masters.mjs";

// ── deterministic randomness (separate stream from seed-documents) ─────────
let seed = 4242026;
const rand = () => {
  seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};
const int = (a, b) => Math.floor(a + rand() * (b - a + 1));
const chance = (p) => rand() < p;
const hm = (mins) => `${String(Math.floor(mins / 60) % 24).padStart(2, "0")}:${String(mins % 60).padStart(2, "0")}`;

const monthDays = (month) => {
  const [y, m] = month.split("-").map(Number);
  const n = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return Array.from({ length: n }, (_, i) => `${month}-${String(i + 1).padStart(2, "0")}`);
};
const monthEnd = (month) => monthDays(month).at(-1);
const isSunday = (day) => new Date(`${day}T00:00:00Z`).getUTCDay() === 0;

const HOLIDAYS = [
  [["2026-06-25", "2026-06-26"], "Ashura (9th & 10th Muharram)"],
  [["2026-08-14"], "Independence Day"],
  [["2026-08-26"], "Eid Milad-un-Nabi"],
  [["2026-11-09"], "Iqbal Day"],
  [["2026-12-25"], "Quaid-e-Azam Day"],
];
const HOLIDAY_SET = new Set(HOLIDAYS.flatMap(([d]) => d));

const SHIFTS = [
  { code: "OFFICE", name: "Office (9 to 5:30)", start_time: "09:00", end_time: "17:30", break_minutes: 30, grace_minutes: 15, early_grace_minutes: 10, half_day_late_minutes: 120, half_day_minutes: 240, full_day_minutes: 420, overtime_enabled: false, week_off_days: [0], color: "#1d4ed8" },
  { code: "FAC-A", name: "Factory day shift", start_time: "08:00", end_time: "17:00", break_minutes: 60, grace_minutes: 10, early_grace_minutes: 10, half_day_late_minutes: 120, half_day_minutes: 240, full_day_minutes: 450, overtime_enabled: true, overtime_after_minutes: 30, lates_per_day_cut: 3, week_off_days: [0], color: "#800000" },
  { code: "FAC-N", name: "Factory night shift", start_time: "20:00", end_time: "05:00", break_minutes: 60, grace_minutes: 10, early_grace_minutes: 10, half_day_late_minutes: 120, half_day_minutes: 240, full_day_minutes: 450, overtime_enabled: true, overtime_after_minutes: 30, week_off_days: [0], color: "#7c3aed" },
];

// Allowances by grade (basic salary): [HRA % of basic, conveyance, medical, mobile]
const allowancesFor = (basic) =>
  basic >= 300000 ? [45, 35000, 25000, 15000]
    : basic >= 150000 ? [45, 20000, 15000, 8000]
      : basic >= 80000 ? [40, 10000, 8000, 3000]
        : [40, 6000, 5000, 0];

// Leave taken (hr enters it for the person, hr.manager approves) — [month, employee name, type code, from, to, reason]
const LEAVES = [
  ["2026-06", "Shahid Iqbal", "SL", "2026-06-15", "2026-06-16", "Fever"],
  ["2026-07", "Junaid Khan", "CL", "2026-07-09", "2026-07-09", "Family function"],
  ["2026-07", "Imran Shah", "AL", "2026-07-20", "2026-07-25", "Annual leave — home town"],
  ["2026-08", "Kashif Mirza", "CL", "2026-08-18", "2026-08-19", "Personal work"],
  ["2026-09", "Danish Latif", "SL", "2026-09-08", "2026-09-10", "Medical"],
  ["2026-09", "Noman Baig", "UL", "2026-09-21", "2026-09-22", "Leave without pay"],
  ["2026-10", "Rabia Anwar", "CL", "2026-10-06", "2026-10-07", "Child unwell"],
];
// Applied by the employee themself (login "employee"), approved by hr.manager.
const SELF_LEAVES = [["2026-08", "CL", "2026-08-06", "2026-08-07", "Brother's wedding"]];

// Advances / loans: applied by the employee, approved by hr.manager, paid out by accounts.
const LOANS = [
  { month: "2026-06", login: "storekeeper", kind: "ADVANCE", amount: 40000, installment: 20000, start: "2026-07", paid: "2026-06-20", cash: AC.cash, reason: "Child's school admission" },
  { month: "2026-07", login: "production", kind: "LOAN", amount: 150000, installment: 25000, start: "2026-08", paid: "2026-07-25", cash: AC.bankHbl, reason: "Motorcycle purchase" },
];
const LEAVER = { name: "Arif Hussain", notice: "2026-09-15", last: "2026-10-15", reason: "Moving abroad for a new job" };

export function hrDocuments({ call, prisma, log = console.log }) {
  const get = (u, p) => call(u, "GET", p);
  const post = (u, p, b) => call(u, "POST", p, b);
  const approveRequest = (u, id, remarks = "Approved") => post(u, `/api/approvals/requests/${id}`, { action: "approve", remarks });
  let emps = [];
  let byName = new Map();
  const factory = new Set();
  const nightShift = new Set();
  let leaveType = new Map();
  let separationId = null;

  async function load() {
    emps = await prisma.employee.findMany({ where: { company_id: 1 }, orderBy: { id: "asc" }, select: { id: true, firstName: true, surname: true, rate: true, workLocationId: true, departmentId: true } });
    byName = new Map(emps.map((e) => [`${e.firstName} ${e.surname}`, e]));
  }

  async function setup() {
    await load();
    // HR rules for the demo company: gratuity provided monthly, PF 8.33% / 8.33% of basic.
    await call("hr.manager", "PUT", "/api/hr/settings", { gratuityProvisionMonthly: 1, gratuityMinServiceMonths: 12, pfEmployeePercent: 8.33, pfEmployerPercent: 8.33, payNoAttendanceFull: 1 });

    const shiftId = {};
    for (const s of SHIFTS) shiftId[s.code] = (await post("hr", "/api/hr/shifts", s)).shift.id;
    // Factory = work location 2 (management excluded); office = everyone else.
    for (const e of emps) if (e.workLocationId === 2 && e.departmentId !== 1) factory.add(e.id);
    for (const n of ["Kashif Mirza", "Arif Hussain"]) nightShift.add(byName.get(n).id);
    const office = emps.filter((e) => !factory.has(e.id)).map((e) => e.id);
    const day = [...factory].filter((id) => !nightShift.has(id));
    await post("hr", "/api/hr/shifts/assignments", { employeeIds: office, shift_id: shiftId.OFFICE, effective_from: "2026-01-01" });
    await post("hr", "/api/hr/shifts/assignments", { employeeIds: day, shift_id: shiftId["FAC-A"], effective_from: "2026-01-01" });
    await post("hr", "/api/hr/shifts/assignments", { employeeIds: [...nightShift], shift_id: shiftId["FAC-N"], effective_from: "2026-01-01" });

    for (const [dates, name] of HOLIDAYS) await post("hr", "/api/hr/holidays", { dates, name, is_paid: true });

    const comps = (await get("hr.manager", "/api/hr/salary/components")).components;
    const comp = Object.fromEntries(comps.map((c) => [c.code, c.id]));
    const pending = [];
    for (const e of emps) {
      const basic = Number(e.rate);
      const [hra, conv, med, mob] = allowancesFor(basic);
      const res = await post("hr.manager", "/api/hr/salary", {
        employee_id: e.id, effective_from: "2026-01-01", basic, reason: "Salary for 2026",
        lines: [
          { component_id: comp.HRA, value: hra }, { component_id: comp.CONV, value: conv },
          { component_id: comp.MED, value: med }, { component_id: comp.MOB, value: mob },
        ],
      });
      if (res.status === "pending") pending.push(res.id);
    }
    // hr.manager's own salary waits in Approvals — the CEO decides it.
    for (const id of pending) {
      const s = await prisma.hrSalaryStructure.findUnique({ where: { id }, select: { approval_request_id: true } });
      await approveRequest("ceo", s.approval_request_id);
    }
    leaveType = new Map((await get("hr", "/api/hr/leave/types")).types.map((t) => [t.code, t.id]));
    log(`  HR setup: ${SHIFTS.length} shifts, ${HOLIDAYS.length} holidays, ${emps.length} salaries (${pending.length} approved by the CEO)`);
  }

  async function leaves(month) {
    const out = new Map(); // employee id → Set of leave days
    const mark = (id, from, to) => {
      for (const d of monthDays(month)) if (d >= from && d <= to) (out.get(id) || out.set(id, new Set()).get(id)).add(d);
    };
    for (const [m, name, code, from, to, reason] of LEAVES) {
      if (m !== month) continue;
      const emp = byName.get(name);
      const r = await post("hr", "/api/hr/leave/requests", { employee_id: emp.id, leave_type_id: leaveType.get(code), from, to, reason });
      await post("hr.manager", `/api/hr/leave/requests/${r.id}`, { action: "approve", note: "OK" });
      mark(emp.id, from, to);
    }
    for (const [m, code, from, to, reason] of SELF_LEAVES) {
      if (m !== month) continue;
      const r = await post("employee", "/api/hr/leave/requests", { leave_type_id: leaveType.get(code), from, to, reason });
      await post("hr.manager", `/api/hr/leave/requests/${r.id}`, { action: "approve", note: "Enjoy" });
      mark(byName.get("Ali Hussain").id, from, to);
    }
    return out;
  }

  async function attendance(month, onLeave) {
    const leaver = byName.get(LEAVER.name).id;
    const entries = [];
    for (const id of factory) {
      for (const day of monthDays(month)) {
        if (isSunday(day) || HOLIDAY_SET.has(day) || onLeave.get(id)?.has(day)) continue;
        if (id === leaver && day > LEAVER.last) continue;
        if (chance(0.02)) { entries.push({ employee_id: id, date: day, status: "ABSENT", remarks: "Did not report" }); continue; }
        const night = nightShift.has(id);
        const start = night ? 20 * 60 : 8 * 60;
        const late = chance(0.1) ? int(12, 45) : int(-15, 8);
        const extra = chance(0.35) ? int(45, 150) : int(0, 20);
        const out = start + 9 * 60 + extra;
        entries.push({ employee_id: id, date: day, check_in: hm(start + late), check_out: hm(out), status: "AUTO" });
      }
    }
    await post("hr.manager", "/api/hr/attendance", { entries, reason: `Attendance register ${month} (factory)` });
    return entries.length;
  }

  // An advance / loan's first recovery month cannot be in the past through the API:
  // applied with the current month, moved to its historical month here (demo history only).
  async function backdateLoan(id, l) {
    const when = new Date(`${l.paid}T10:00:00+05:00`);
    await prisma.hrLoan.update({ where: { id }, data: { start_month: l.start, requested_at: new Date(when.getTime() - 3 * 86400000), decided_at: new Date(when.getTime() - 86400000) } });
  }

  async function loans(month) {
    const now = new Date().toISOString().slice(0, 7);
    for (const l of LOANS.filter((x) => x.month === month)) {
      const r = await post(l.login, "/api/hr/loans", { kind: l.kind, amount: l.amount, installment: l.installment, start_month: now, reason: l.reason });
      await post("hr.manager", `/api/hr/loans/${r.id}`, { action: "approve", note: "Within policy" });
      await post("accounts.manager", `/api/hr/loans/${r.id}`, { action: "disburse", date: l.paid, cash_acno: l.cash, reference: `${l.kind} pay-out` });
      await backdateLoan(r.id, l);
      log(`  ${l.kind.toLowerCase()} #A-${r.id} ${l.login} ${l.amount} paid ${l.paid}, recovered from ${l.start}`);
    }
  }

  async function leaving(payDay) {
    const emp = byName.get(LEAVER.name);
    const r = await post("hr.manager", "/api/hr/leaving", { employee_id: emp.id, kind: "RESIGNATION", notice_date: LEAVER.notice, last_working_day: LEAVER.last, reason: LEAVER.reason });
    separationId = r.id;
    const sep = await prisma.hrSeparation.findUnique({ where: { id: r.id }, select: { approval_request_id: true } });
    await approveRequest("cfo", sep.approval_request_id, "Resignation accepted");
    const { separation } = await get("hr.manager", `/api/hr/leaving/${r.id}`);
    for (const c of separation.clearance) await post("hr.manager", `/api/hr/leaving/${r.id}`, { action: "clearance", key: c.key, done: true, note: "Cleared" });
    await post("hr.manager", `/api/hr/leaving/${r.id}`, { action: "calculate", inputs: {} });
    await post("hr.manager", `/api/hr/leaving/${r.id}`, { action: "submit" });
    const st = await prisma.hrSettlement.findFirst({ where: { separation_id: r.id }, orderBy: { id: "desc" }, select: { id: true, approval_request_id: true, net: true } });
    await approveRequest("cfo", st.approval_request_id, "Final settlement approved");
    log(`  leaving #L-${r.id} ${LEAVER.name}: settlement #S-${st.id} net ${st.net} approved`);
    return async () => {
      await post("accounts.manager", `/api/hr/leaving/${r.id}`, { action: "post", date: monthEnd(LEAVER.last.slice(0, 7)) });
      await post("accounts.manager", `/api/hr/leaving/${r.id}`, { action: "pay", date: payDay, cash_acno: AC.bankHbl, reference: "Final settlement cheque" });
      await post("hr.manager", `/api/hr/leaving/${r.id}`, { action: "complete" });
      log(`  settlement #S-${st.id} posted and paid; ${LEAVER.name} has left`);
    };
  }

  async function payroll(month, payDay) {
    // Two runs a month: Management (approved by the CFO) and Staff (approved by the CEO) —
    // an approver never decides a payroll that holds their own salary.
    const a = await post("hr.manager", "/api/hr/payroll", { month, pay_date: monthEnd(month), title: "Management", department: 1 });
    const b = await post("hr.manager", "/api/hr/payroll", { month, pay_date: monthEnd(month), title: "Staff" });
    for (const [run, approver] of [[a, "cfo"], [b, "ceo"]]) {
      await post("hr.manager", `/api/hr/payroll/${run.id}`, { action: "submit" });
      await post(approver, `/api/hr/payroll/${run.id}`, { action: "approve", note: "Checked" });
      await post("accounts.manager", `/api/hr/payroll/${run.id}`, { action: "post" });
      await post("accounts.manager", `/api/hr/payroll/${run.id}`, { action: "pay", date: payDay, cash_acno: AC.bankHbl, reference: `Salaries ${month}` });
    }
    const runs = await prisma.hrPayrollRun.findMany({ where: { id: { in: [a.id, b.id] } }, select: { employees: true, total_net: true } });
    log(`  payroll ${month}: ${runs.reduce((s, r) => s + r.employees, 0)} payslips, net ${runs.reduce((s, r) => s + Number(r.total_net), 0).toFixed(0)}`);
  }

  /** The month's HR, on the first working day of the next month (payDay). */
  async function month(m, payDay) {
    const onLeave = await leaves(m);
    const n = await attendance(m, onLeave);
    await loans(m);
    let finishLeaving = null;
    if (m === LEAVER.last.slice(0, 7)) finishLeaving = await leaving(payDay);
    await payroll(m, payDay);
    if (finishLeaving) await finishLeaving();
    log(`  HR ${m}: ${n} attendance days, ${[...onLeave.values()].reduce((s, x) => s + x.size, 0)} leave days`);
  }

  /** November: a provident fund loan, recovered from December. */
  async function finish() {
    const r = await post("accountant", "/api/hr/loans", { kind: "PF_LOAN", amount: 60000, installment: 5000, start_month: "2026-12", reason: "House repair" });
    await post("hr.manager", `/api/hr/loans/${r.id}`, { action: "approve", note: "Within the PF limit" });
    await post("accounts.manager", `/api/hr/loans/${r.id}`, { action: "disburse", date: "2026-11-10", cash_acno: AC.bankHbl, reference: "PF loan cheque" });
    log(`  PF loan #A-${r.id} accountant 60000 paid 2026-11-10`);
  }

  return { setup, month, finish };
}
