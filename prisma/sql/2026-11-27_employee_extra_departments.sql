-- An employee's "also works in" departments (Employee → Job). The main
-- department stays Employee."departmentId" (payroll, salary cost, reports,
-- approval chain); these count for HR scope and HR screen department filters.
-- Feature hr.extraDepartments (Settings → Features, default OFF) — from SMS.
-- Additive and re-runnable.
CREATE TABLE IF NOT EXISTS employee_departments (
  id            SERIAL PRIMARY KEY,
  employee_id   INTEGER NOT NULL REFERENCES "Employee"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  department_id INTEGER NOT NULL REFERENCES "Department"(id) ON DELETE CASCADE ON UPDATE CASCADE,
  created_at    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS employee_departments_employee_id_department_id_key ON employee_departments (employee_id, department_id);
CREATE INDEX IF NOT EXISTS employee_departments_department_id_idx ON employee_departments (department_id);
