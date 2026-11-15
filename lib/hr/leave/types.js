// lib/hr/leave/types.js — validating the leave-type form.
import { LeaveError } from "@/lib/hr/leave/balance";

const num = (v, label, min, max, { int = false, half = false } = {}) => {
  const n = Number(v);
  const ok = Number.isFinite(n) && n >= min && n <= max && (!int || Number.isInteger(n)) && (!half || Number.isInteger(n * 2));
  if (!ok) throw new LeaveError(`${label}: enter ${int ? "a whole number" : half ? "a number in half days" : "a number"} from ${min} to ${max}.`);
  return n;
};

export function leaveTypeData(b) {
  const code = String(b?.code ?? "").trim().toUpperCase();
  const name = String(b?.name ?? "").trim();
  if (!/^[A-Z0-9_-]{1,20}$/.test(code)) throw new LeaveError("Code: 1–20 letters, digits, - or _.");
  if (!name || name.length > 100) throw new LeaveError("Name is required (100 characters at most).");
  const accrual = b.accrual === "MONTHLY" ? "MONTHLY" : "YEARLY";
  const gender = b.gender === "Male" || b.gender === "Female" ? b.gender : null;
  const maxPer = b.max_days_per_request === "" || b.max_days_per_request == null ? null : num(b.max_days_per_request, "Most days per application", 0.5, 366, { half: true });
  return {
    code,
    name,
    is_paid: b.is_paid !== false,
    annual_days: num(b.annual_days ?? 0, "Days a year", 0, 366, { half: true }),
    accrual,
    prorate_joiners: Boolean(b.prorate_joiners),
    min_service_days: num(b.min_service_days ?? 0, "Service needed", 0, 3650, { int: true }),
    max_carry_forward: num(b.max_carry_forward ?? 0, "Carry forward", 0, 366, { half: true }),
    allow_negative: Boolean(b.allow_negative),
    allow_half_day: Boolean(b.allow_half_day),
    count_off_days: Boolean(b.count_off_days),
    // Spent from comp-off days earned (lib/hr/leave/compOff.js), not a yearly entitlement.
    comp_off: Boolean(b.comp_off),
    comp_off_valid_days: num(b.comp_off_valid_days ?? 30, "Comp-off valid for", 1, 365, { int: true }),
    max_days_per_request: maxPer,
    gender,
    color: /^#[0-9a-fA-F]{6}$/.test(String(b.color ?? "")) ? b.color : "#0284c7",
    sort: num(b.sort ?? 0, "Order", 0, 999, { int: true }),
    is_active: b.is_active !== false,
  };
}
