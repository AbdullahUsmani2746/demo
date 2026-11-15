// lib/hr/salary/components.js — validating the pay-component form.
import { SalaryError } from "@/lib/hr/salary/service";

export function componentData(b) {
  const code = String(b?.code ?? "").trim().toUpperCase();
  const name = String(b?.name ?? "").trim();
  if (!/^[A-Z0-9_-]{1,20}$/.test(code)) throw new SalaryError("Code: 1–20 letters, digits, - or _.");
  if (!name || name.length > 100) throw new SalaryError("Name is required (100 characters at most).");
  const kind = b.kind === "DEDUCTION" ? "DEDUCTION" : "EARNING";
  const calc = b.calc === "PERCENT_BASIC" ? "PERCENT_BASIC" : "FIXED";
  const dv = Number(b.default_value ?? 0);
  if (!Number.isFinite(dv) || dv < 0 || (calc === "PERCENT_BASIC" && dv > 1000)) throw new SalaryError("Default: an amount, or a % of basic up to 1000.");
  const gl = b.gl_acno === "" || b.gl_acno == null ? null : Number(b.gl_acno);
  if (gl !== null && (!Number.isInteger(gl) || gl <= 0)) throw new SalaryError("Account: an account number, or blank for the default.");
  const sort = Number(b.sort ?? 0);
  return {
    code,
    name,
    kind,
    calc,
    default_value: dv,
    prorate: Boolean(b.prorate),
    taxable: kind === "EARNING" ? Boolean(b.taxable) : false,
    gl_acno: gl,
    sort: Number.isInteger(sort) && sort >= 0 ? sort : 0,
    is_active: b.is_active !== false,
  };
}
