-- =====================================================================
-- Request deletion (ported from SMS 21fcb05; Settings → Features
-- "approvals.deletionRequests"). People without the delete right ask for an
-- entry to be deleted with a reason; holders of deletion.approve decide it
-- on Approvals (lib/approvals/deletions.js). Super Admin always may decide.
-- Who holds it is data: grant it on Admin → Permissions (a user or a role).
-- Adds one permission; changes nothing else. Safe to re-run.
-- =====================================================================
INSERT INTO "Permission" (code, module, label, sort) VALUES
  ('deletion.approve', 'Approvals', 'Decide deletion requests (approving deletes the entry)', 156)
ON CONFLICT (code) DO NOTHING;
