-- =====================================================================
-- Sales Targets month-end approval (Admin → Permissions → Approvals →
-- "Sales Targets month-end"). Only holders of salesTarget.monthEnd may run
-- (or re-run) the month-end calculation on Sales Targets; ADMIN / ACCOUNTANT
-- have it already. Give it to other people / roles on that screen.
-- Adds one permission row; changes nothing else. Safe to re-run.
-- =====================================================================
INSERT INTO "Permission" (code, module, label, sort) VALUES
  ('salesTarget.monthEnd', 'Sales', 'Run the Sales Targets month-end calculation (locks Recovery / OverDue)', 155)
ON CONFLICT (code) DO NOTHING;
