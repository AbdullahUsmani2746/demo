// scripts/demo/features/hrSmsPort.mjs — HR features ported from SMS (Nov 2026),
// run from scripts/demo/test-features.mjs (which owns login, set() and the final feature reset).
// Written with the port but NOT yet run (needs the app running on the demo database).
//   hr.letters                    letters API refused off / answers on
//   hr.payrollAccountsByCategory  Direct / Indirect rows hidden + refused off / listed on
//   hr.paidThroughPerson          choosing "Through a person" refused off
//   hr.extraDepartments           "also works in" counts for the department filter only on
//   chain step `when`             pure: a large-amount step applies only above its amount / over the limit
import { stepApplies, cleanWhen } from "../../../lib/hr/chainWhen.js";

export async function runHrSmsPort({ admin, set, check, prisma }) {
  // ── HR letters ──────────────────────────────────────────────────────────
  await set({ "hr.letters": false });
  check("hr.letters off: GET /api/hr/letters/templates refused", (await admin("GET", "/api/hr/letters/templates")).status === 403);
  await set({ "hr.letters": true });
  const t = await admin("GET", "/api/hr/letters/templates");
  check("hr.letters on: standard texts returned", t.status === 200 && Boolean(t.body?.templates?.APPOINTMENT?.body));

  // ── Payroll accounts by Direct / Indirect ──────────────────────────────
  await set({ "hr.payrollAccountsByCategory": false });
  const offAcc = await admin("GET", "/api/settings/accounts");
  check("payroll by category off: no Direct / Indirect rows", offAcc.status === 200 && !offAcc.body.settings.some((s) => s.variantOf));
  const offPut = await admin("PUT", "/api/settings/accounts", { settings: [{ key: "payroll_salary_expense_direct", acno: null }] });
  check("payroll by category off: saving a Direct row refused", offPut.status === 400, JSON.stringify(offPut.body));
  await set({ "hr.payrollAccountsByCategory": true });
  const onAcc = await admin("GET", "/api/settings/accounts");
  check("payroll by category on: Direct / Indirect rows listed under their default",
    onAcc.status === 200 && onAcc.body.settings.some((s) => s.key === "payroll_salary_expense_direct" && s.variantOf === "payroll_salary_expense"));

  // ── Through a person ────────────────────────────────────────────────────
  const [emp, other] = await prisma.employee.findMany({ where: { status: "ACTIVE", NOT: { paymentMethod: "THROUGH_PERSON" } }, orderBy: { id: "asc" }, take: 2 });
  if (emp && other) {
    await set({ "hr.paidThroughPerson": false });
    const g = await admin("GET", `/api/employees/${emp.id}`);
    const body = { ...(g.body?.employee ?? g.body ?? {}), paymentMethod: "THROUGH_PERSON", paidThroughId: other.id };
    const r = await admin("PUT", `/api/employees/${emp.id}`, body);
    check("through a person off: choosing it refused", r.status === 400 && /switched off/i.test(r.body?.error ?? ""), `${r.status} ${JSON.stringify(r.body).slice(0, 160)}`);
  }

  // ── Also works in other departments ─────────────────────────────────────
  const depts = await prisma.department.findMany({ select: { id: true }, orderBy: { id: "asc" }, take: 2 });
  const e = await prisma.employee.findFirst({ where: { status: "ACTIVE", departmentId: depts[0]?.id }, orderBy: { id: "asc" } });
  if (e && depts[1]) {
    const row = await prisma.employeeDepartment.upsert({
      where: { employee_id_department_id: { employee_id: e.id, department_id: depts[1].id } },
      update: {},
      create: { employee_id: e.id, department_id: depts[1].id },
    });
    const listed = async () => {
      const r = await admin("GET", `/api/employees?departmentId=${depts[1].id}&search=${e.id}&limit=200`);
      return (r.body?.employees ?? r.body?.data ?? []).some((x) => x.id === e.id);
    };
    await set({ "hr.extraDepartments": false });
    check("extra departments off: main department only", (await listed()) === false);
    await set({ "hr.extraDepartments": true });
    check("extra departments on: listed under the extra department", (await listed()) === true);
    await prisma.employeeDepartment.delete({ where: { id: row.id } });
  }

  // ── Chain step needed only for large amounts (pure) ────────────────────
  const ceo = { label: "CEO", when: cleanWhen({ minAmount: 100000, overLimit: true }) };
  check("chain when: 150,000 needs the CEO step", stepApplies(ceo, { amount: 150000, overLimit: false }));
  check("chain when: 50,000 within the limit skips it", !stepApplies(ceo, { amount: 50000, overLimit: false }));
  check("chain when: 50,000 over the HR limit needs it", stepApplies(ceo, { amount: 50000, overLimit: true }));
  check("chain when: a step without a condition always applies", stepApplies({ label: "HR" }, { amount: 1 }));

  await set({ "hr.letters": false, "hr.payrollAccountsByCategory": false, "hr.paidThroughPerson": false, "hr.extraDepartments": false });
}
