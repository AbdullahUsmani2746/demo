// lib/hr/paymentMethods.js — how an employee's salary reaches them
// (Employee → Pay & Bank → Payment method). Pure: used by the employee form,
// payroll (payslip `data.bank`), salary payment, bank files and profiles.
//
// THROUGH_PERSON: the salary is handed to another employee (e.g. a manager)
// who pays the person — recorded for the record only (Employee.paidThroughId).
// The payroll keeps who it went through, the salary payment voucher's line
// says "via <name>", and the bank files list each such person's group.
export const PAYMENT_METHODS = [
  { value: "CASH", label: "Cash" },
  { value: "DIRECT_DEPOSIT", label: "Direct deposit (bank)" },
  { value: "CHEQUE", label: "Cheque" },
  { value: "THROUGH_PERSON", label: "Through a person" },
];
export const PAYMENT_METHOD_VALUES = PAYMENT_METHODS.map((m) => m.value);
export const paymentMethodLabel = (v) => PAYMENT_METHODS.find((m) => m.value === v)?.label ?? v ?? "";

/** "Through <name>" / "Cash" … from a payslip's `data.bank` (or the same shape). */
export function paidByText(bank) {
  if (!bank) return "";
  if (bank.method === "THROUGH_PERSON") return bank.through?.name ? `Through ${bank.through.name}` : "Through a person (not chosen)";
  return [paymentMethodLabel(bank.method), bank.bank, bank.account].filter(Boolean).join(" · ");
}
