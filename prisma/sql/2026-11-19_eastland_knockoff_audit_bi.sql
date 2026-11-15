-- =====================================================================
-- Ported from Eastland (docs/merge/EASTLAND_vs_SMS.md):
--   * "Fix FIFO order" on Knock-Off Review (lib/ledger/refifo.js,
--     /api/invoice-knockoff/refifo) — permission knockoff.refifo, given to
--     the Accounts Manager role template like the other knockoff.* rights.
--   * Knock-off of returns naming no invoice is a Feature
--     (knockoff.matchReturns, Settings -> Features) — nothing to create here;
--     source type RETURN arrived in 2026-11-19_merge_eastland_accounting.sql.
--   * Built-in dashboard filter switches are a Settings row
--     (key "biDashboardFilters", written by /api/bi/dash-filters) — nothing
--     to create here.
-- Adds rows only. Safe to re-run.
-- =====================================================================
INSERT INTO "Permission" (code, module, label, sort) VALUES
  ('knockoff.refifo', 'Finance', 'Fix FIFO order: re-match parties whose automatic knock-offs are out of order (backup, resume, undo)', 0)
ON CONFLICT (code) DO NOTHING;

INSERT INTO "PermissionGrant" ("permissionId", role, allow, "updatedAt")
SELECT p.id, r.code, true, CURRENT_TIMESTAMP
FROM "Permission" p
JOIN app_roles r ON r.code = 'ACCOUNTS_MANAGER'
WHERE p.code = 'knockoff.refifo'
ON CONFLICT DO NOTHING;
