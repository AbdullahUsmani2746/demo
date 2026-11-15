-- ============================================================
-- Sub Accounts on voucher lines + RMC input rates — 2026-11-19
-- (ported from Eastland; Settings → Features "vouchers.subAccounts" and
-- "reports.rmcInputRates", both off by default).
--
-- Tables / columns came with 2026-11-19_merge_eastland_accounting.sql
-- ("subAccount", "RmcInputRate", "Transactions".sub_account). This file adds:
--   1. Account Settings group "sub_account_groups" — main accounts whose
--      accounts must name a Sub Account (lib/accounts/accountSettingDefs.js).
--      Seeded once from the chart itself: every main account under a top
--      group (MBSCD) whose name starts with EXPENSE — what Eastland required.
--      A value already chosen on the settings screen is never overwritten.
--   2. Grants for the new permission codes (scripts/seed-permissions.mjs adds
--      the codes): subAccount.manage to the roles that may create journal
--      vouchers, rmcRates.manage to the roles that maintain costing.
--
-- Re-runnable: ON CONFLICT DO NOTHING / WHERE NOT EXISTS.
-- Run scripts/seed-permissions.mjs --apply first (so the codes exist).
-- ============================================================

-- 1. Account Settings: accounts that need a Sub Account
INSERT INTO account_settings (key, kind, section, label, macnos, updated_by)
SELECT 'sub_account_groups', 'GROUP', 'VOUCHERS', 'Accounts that need a Sub Account',
       COALESCE((
         SELECT array_agg(ma.macno ORDER BY ma.macno)
         FROM "MACNO" ma
         JOIN "BSCD" b ON b.bscd = ma.bscd
         JOIN "MBSCD" m ON m.mbscd = b.mbscd
         WHERE m."mbscdDetail" ~* '^\s*EXPENSE'
       ), '{}'),
       'seed 2026-11-19'
ON CONFLICT (key) DO NOTHING;

-- 2. Permission grants — copied from the roles that hold a similar right.
INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "createdAt", "updatedAt")
SELECT DISTINCT np.id, g.role, true, now(), now()
FROM (VALUES
  ('subAccount.manage', 'journal.create'),
  ('subAccount.manage', 'account.manage'),
  ('rmcRates.manage',   'costing.manage'),
  ('rmcRates.manage',   'bom.manage')
) AS m(new_code, like_code)
JOIN "Permission" np ON np.code = m.new_code
JOIN "Permission" lp ON lp.code = m.like_code
JOIN "PermissionGrant" g ON g."permissionId" = lp.id AND g.role IS NOT NULL AND g.allow = true
WHERE NOT EXISTS (
  SELECT 1 FROM "PermissionGrant" x WHERE x."permissionId" = np.id AND x.role = g.role
);
