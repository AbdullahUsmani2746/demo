-- Income tax per employee: SLAB (default — deducted by the tax slabs, as
-- before) or NONE (never deducted, e.g. an exempt employee). Set on
-- HR → Salary → Income tax; read by payroll (lib/hr/payroll/compute.js).
-- Additive and re-runnable; every existing employee stays on SLAB.
ALTER TABLE "Employee" ADD COLUMN IF NOT EXISTS income_tax_mode VARCHAR(10) NOT NULL DEFAULT 'SLAB';
