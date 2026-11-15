-- =====================================================================
-- Fixed Assets — register, depreciation, relocation, disposal
-- (lib/fixedAssets/*, app/api/fixed-assets/*, CLAUDE.md rules 1, 3, 8)
--
--   1. Tables (prisma/schema.prisma "Fixed Assets" block)
--        fa_category_defaults            per fixed-asset category: method, life,
--                                        rate, salvage %, the four accounts
--        fixed_assets                    one row per asset unit (asset_no)
--        fixed_asset_movements           holder history
--        fixed_asset_depreciation_runs   one monthly run = one system journal
--        fixed_asset_depreciation_lines  the run per asset
--        fixed_asset_disposals           disposal worked out + its journal
--      A month can hold only ONE posted run (partial unique index).
--      An asset can have only ONE live (not reversed) disposal.
--   2. Account Settings, section FIXED_ASSETS (lib/accounts/accountSettingDefs.js):
--      company defaults used when a category has no account of its own.
--      Seeded empty — set them on Finance → Account Settings.
--   3. System vouchers (lib/vouchers/systemVouchers.js) — markers added to the
--      read-only trigger list of prisma/sql/2026-11-04_hr_accounting.sql:
--        FA_CAPITALISATION         Dr asset cost / Cr vendor (Fixed Assets GRN)
--        FA_DEPRECIATION           monthly depreciation journal
--        FA_DEPRECIATION_REVERSAL  its mirror
--        FA_DISPOSAL               disposal gain / loss journal
--        FA_DISPOSAL_REVERSAL      its mirror
--      The list is MERGED with whatever the function holds now, so markers
--      other modules added are kept.
--   4. Permissions + role grants
--        fixedAsset.manage            maintain the register (exists already)
--        fixedAsset.depreciation.run  preview / post / reverse depreciation runs
--        fixedAsset.dispose           reverse a disposal
--        fixedAssetRelocation.* / fixedAssetDisposal.*   (voucher rights)
--        report.fixedAsset*.view      the four reports
--      ACCOUNTS_MANAGER runs depreciation and reverses disposals;
--      ACCOUNTANT keeps the register and keys relocations / disposals;
--      management (CEO, CFO, COO, DIRECTOR, MANAGER) views the reports.
--
-- Additive and re-runnable. Apply (after the owner approves this run):
--   npx prisma db execute --file prisma/sql/2026-11-20_fixed_assets.sql --schema prisma/schema.prisma
-- =====================================================================
BEGIN;

-- 1 ── tables ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS fa_category_defaults (
  ic_id              INTEGER PRIMARY KEY,
  method             VARCHAR(4),
  useful_life_months INTEGER,
  rb_rate            DOUBLE PRECISION,
  salvage_pct        DOUBLE PRECISION,
  cost_acno          INTEGER,
  accdep_acno        INTEGER,
  depexp_acno        INTEGER,
  gainloss_acno      INTEGER,
  updated_by         VARCHAR(120),
  updated_at         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS fixed_assets (
  id                     SERIAL PRIMARY KEY,
  asset_no               INTEGER NOT NULL,
  itcd                   INTEGER NOT NULL,
  ic_id                  INTEGER,
  grn_tran_id            INTEGER,
  grn_line_id            INTEGER,
  vendor_acno            INTEGER,
  description            VARCHAR(250),
  cost                   DOUBLE PRECISION NOT NULL DEFAULT 0,
  in_service_date        DATE NOT NULL,
  method                 VARCHAR(4),
  useful_life_months     INTEGER,
  rb_rate                DOUBLE PRECISION,
  salvage_value          DOUBLE PRECISION,
  opening_accumulated    DOUBLE PRECISION NOT NULL DEFAULT 0,
  department_id          INTEGER,
  employee_id            INTEGER,
  location_id            INTEGER,
  status                 VARCHAR(10) NOT NULL DEFAULT 'IN_USE',
  disposed_on            DATE,
  capitalisation_tran_id INTEGER,
  remarks                VARCHAR(500),
  created_by             VARCHAR(120),
  created_at             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS fixed_assets_asset_no_key ON fixed_assets (asset_no);
CREATE UNIQUE INDEX IF NOT EXISTS fixed_assets_grn_line_id_key ON fixed_assets (grn_line_id);
CREATE INDEX IF NOT EXISTS fixed_assets_itcd_idx ON fixed_assets (itcd);
CREATE INDEX IF NOT EXISTS fixed_assets_ic_id_idx ON fixed_assets (ic_id);
CREATE INDEX IF NOT EXISTS fixed_assets_grn_tran_id_idx ON fixed_assets (grn_tran_id);
CREATE INDEX IF NOT EXISTS fixed_assets_status_idx ON fixed_assets (status);

CREATE TABLE IF NOT EXISTS fixed_asset_movements (
  id                 SERIAL PRIMARY KEY,
  asset_id           INTEGER NOT NULL REFERENCES fixed_assets(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  kind               VARCHAR(20) NOT NULL,
  dated              DATE NOT NULL,
  tran_id            INTEGER,
  from_department_id INTEGER,
  from_employee_id   INTEGER,
  from_location_id   INTEGER,
  to_department_id   INTEGER,
  to_employee_id     INTEGER,
  to_location_id     INTEGER,
  remarks            VARCHAR(500),
  created_by         VARCHAR(120),
  created_at         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS fixed_asset_movements_asset_id_idx ON fixed_asset_movements (asset_id);
CREATE INDEX IF NOT EXISTS fixed_asset_movements_tran_id_idx ON fixed_asset_movements (tran_id);
CREATE INDEX IF NOT EXISTS fixed_asset_movements_dated_idx ON fixed_asset_movements (dated);

CREATE TABLE IF NOT EXISTS fixed_asset_depreciation_runs (
  id               SERIAL PRIMARY KEY,
  period           VARCHAR(7) NOT NULL,
  status           VARCHAR(10) NOT NULL DEFAULT 'POSTED',
  posting_date     DATE NOT NULL,
  jv_tran_id       INTEGER,
  reversal_tran_id INTEGER,
  total            DOUBLE PRECISION NOT NULL DEFAULT 0,
  asset_count      INTEGER NOT NULL DEFAULT 0,
  rules            JSONB,
  posted_by        VARCHAR(120),
  posted_at        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reversed_by      VARCHAR(120),
  reversed_at      TIMESTAMP(3),
  reverse_reason   VARCHAR(500)
);
CREATE INDEX IF NOT EXISTS fixed_asset_depreciation_runs_period_idx ON fixed_asset_depreciation_runs (period);
CREATE INDEX IF NOT EXISTS fixed_asset_depreciation_runs_status_idx ON fixed_asset_depreciation_runs (status);
-- A month is depreciated once: at most one POSTED run per period.
CREATE UNIQUE INDEX IF NOT EXISTS fixed_asset_depreciation_runs_one_posted
  ON fixed_asset_depreciation_runs (period) WHERE status = 'POSTED';

CREATE TABLE IF NOT EXISTS fixed_asset_depreciation_lines (
  id          SERIAL PRIMARY KEY,
  run_id      INTEGER NOT NULL REFERENCES fixed_asset_depreciation_runs(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  asset_id    INTEGER NOT NULL REFERENCES fixed_assets(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  period      VARCHAR(7) NOT NULL,
  factor      DOUBLE PRECISION NOT NULL DEFAULT 1,
  opening_nbv DOUBLE PRECISION NOT NULL,
  amount      DOUBLE PRECISION NOT NULL,
  closing_nbv DOUBLE PRECISION NOT NULL,
  ic_id       INTEGER,
  depexp_acno INTEGER,
  accdep_acno INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS fixed_asset_depreciation_lines_run_id_asset_id_key ON fixed_asset_depreciation_lines (run_id, asset_id);
CREATE INDEX IF NOT EXISTS fixed_asset_depreciation_lines_asset_id_idx ON fixed_asset_depreciation_lines (asset_id);
CREATE INDEX IF NOT EXISTS fixed_asset_depreciation_lines_period_idx ON fixed_asset_depreciation_lines (period);

CREATE TABLE IF NOT EXISTS fixed_asset_disposals (
  id               SERIAL PRIMARY KEY,
  asset_id         INTEGER NOT NULL REFERENCES fixed_assets(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  tran_id          INTEGER NOT NULL,
  dated            DATE NOT NULL,
  kind             VARCHAR(6) NOT NULL,
  party_acno       INTEGER,
  proceeds         DOUBLE PRECISION NOT NULL DEFAULT 0,
  cost             DOUBLE PRECISION NOT NULL,
  accumulated      DOUBLE PRECISION NOT NULL,
  month_charge     DOUBLE PRECISION NOT NULL DEFAULT 0,
  nbv              DOUBLE PRECISION NOT NULL,
  gain_loss        DOUBLE PRECISION NOT NULL,
  jv_tran_id       INTEGER,
  reversal_tran_id INTEGER,
  reversed_by      VARCHAR(120),
  reversed_at      TIMESTAMP(3),
  reverse_reason   VARCHAR(500),
  created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS fixed_asset_disposals_asset_id_idx ON fixed_asset_disposals (asset_id);
CREATE INDEX IF NOT EXISTS fixed_asset_disposals_tran_id_idx ON fixed_asset_disposals (tran_id);
CREATE INDEX IF NOT EXISTS fixed_asset_disposals_dated_idx ON fixed_asset_disposals (dated);
-- An asset is disposed of once (until that disposal is reversed).
CREATE UNIQUE INDEX IF NOT EXISTS fixed_asset_disposals_one_live
  ON fixed_asset_disposals (asset_id) WHERE reversed_at IS NULL;

-- 2 ── Account Settings defaults (empty until set on the screen) ──────────
INSERT INTO account_settings (key, kind, section, label, acno, updated_at) VALUES
  ('fa_cost',                     'ACCOUNT', 'FIXED_ASSETS', 'Fixed Asset Cost (default)', NULL, CURRENT_TIMESTAMP),
  ('fa_accumulated_depreciation', 'ACCOUNT', 'FIXED_ASSETS', 'Accumulated Depreciation (default)', NULL, CURRENT_TIMESTAMP),
  ('fa_depreciation_expense',     'ACCOUNT', 'FIXED_ASSETS', 'Depreciation Expense (default)', NULL, CURRENT_TIMESTAMP),
  ('fa_disposal_gain_loss',       'ACCOUNT', 'FIXED_ASSETS', 'Gain / Loss on Disposal of Fixed Assets (default)', NULL, CURRENT_TIMESTAMP)
ON CONFLICT (key) DO NOTHING;

-- 3 ── system vouchers: merge the FA markers into the read-only list ──────
-- Keep in step with SYSTEM_VOUCHER_MARKERS in lib/vouchers/systemVouchers.js.
DO $$
DECLARE
  cur    TEXT[] := ARRAY[]::TEXT[];
  merged TEXT[];
BEGIN
  BEGIN
    SELECT system_voucher_markers() INTO cur;
  EXCEPTION WHEN undefined_function THEN
    RAISE EXCEPTION 'Run prisma/sql/2026-11-04_hr_accounting.sql first (it installs the system voucher trigger).';
  END;
  SELECT ARRAY(
    SELECT DISTINCT m FROM unnest(cur || ARRAY['FA_CAPITALISATION', 'FA_DEPRECIATION', 'FA_DEPRECIATION_REVERSAL', 'FA_DISPOSAL', 'FA_DISPOSAL_REVERSAL']::TEXT[]) AS m
    ORDER BY m
  ) INTO merged;
  EXECUTE format(
    'CREATE OR REPLACE FUNCTION system_voucher_markers() RETURNS TEXT[] LANGUAGE sql IMMUTABLE AS $f$ SELECT %L::TEXT[] $f$',
    merged
  );
END $$;

-- 4 ── permissions and grants ────────────────────────────────────────────
INSERT INTO "Permission" (code, module, label, sort) VALUES
  ('fixedAsset.manage', 'Fixed Assets', 'Maintain fixed-asset records', 100),
  ('fixedAsset.depreciation.run', 'Fixed Assets', 'Preview, post and reverse monthly depreciation runs (posts system journals)', 101),
  ('fixedAsset.dispose', 'Fixed Assets', 'Reverse a fixed asset disposal (posts the reversal journal)', 102),
  ('fixedAssetRelocation.view', 'Fixed Assets', 'View Fixed Asset Relocation', 1900),
  ('fixedAssetRelocation.create', 'Fixed Assets', 'Create Fixed Asset Relocation', 1901),
  ('fixedAssetRelocation.update', 'Fixed Assets', 'Edit Fixed Asset Relocation', 1902),
  ('fixedAssetRelocation.delete', 'Fixed Assets', 'Delete Fixed Asset Relocation', 1903),
  ('fixedAssetRelocation.print', 'Fixed Assets', 'Print / export Fixed Asset Relocation', 1904),
  ('fixedAssetDisposal.view', 'Fixed Assets', 'View Fixed Asset Disposal', 1910),
  ('fixedAssetDisposal.create', 'Fixed Assets', 'Create Fixed Asset Disposal', 1911),
  ('fixedAssetDisposal.update', 'Fixed Assets', 'Edit Fixed Asset Disposal', 1912),
  ('fixedAssetDisposal.delete', 'Fixed Assets', 'Delete Fixed Asset Disposal', 1913),
  ('fixedAssetDisposal.print', 'Fixed Assets', 'Print / export Fixed Asset Disposal', 1914),
  ('report.fixedAssetRegister.view', 'Reports · Fixed Assets', 'View Fixed Asset Register report', 5900),
  ('report.fixedAssetMovement.view', 'Reports · Fixed Assets', 'View Fixed Asset Movement report', 5901),
  ('report.fixedAssetSchedule.view', 'Reports · Fixed Assets', 'View Depreciation Schedule report', 5902),
  ('report.fixedAssetDisposals.view', 'Reports · Fixed Assets', 'View Disposal Gain / Loss report', 5903)
ON CONFLICT (code) DO NOTHING;

INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "createdAt", "updatedAt")
SELECT p.id, g.role, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (VALUES
    ('ACCOUNTS_MANAGER', 'fixedAsset.manage'),
    ('ACCOUNTS_MANAGER', 'fixedAsset.depreciation.run'),
    ('ACCOUNTS_MANAGER', 'fixedAsset.dispose'),
    ('ACCOUNTS_MANAGER', 'fixedAssetsGrn.view'),
    ('ACCOUNTS_MANAGER', 'fixedAssetRelocation.view'),
    ('ACCOUNTS_MANAGER', 'fixedAssetRelocation.create'),
    ('ACCOUNTS_MANAGER', 'fixedAssetRelocation.print'),
    ('ACCOUNTS_MANAGER', 'fixedAssetDisposal.view'),
    ('ACCOUNTS_MANAGER', 'fixedAssetDisposal.create'),
    ('ACCOUNTS_MANAGER', 'fixedAssetDisposal.print'),
    ('ACCOUNTS_MANAGER', 'report.fixedAssetRegister.view'),
    ('ACCOUNTS_MANAGER', 'report.fixedAssetMovement.view'),
    ('ACCOUNTS_MANAGER', 'report.fixedAssetSchedule.view'),
    ('ACCOUNTS_MANAGER', 'report.fixedAssetDisposals.view'),
    ('ACCOUNTANT', 'fixedAsset.manage'),
    ('ACCOUNTANT', 'fixedAssetRelocation.view'),
    ('ACCOUNTANT', 'fixedAssetRelocation.create'),
    ('ACCOUNTANT', 'fixedAssetRelocation.print'),
    ('ACCOUNTANT', 'fixedAssetDisposal.view'),
    ('ACCOUNTANT', 'fixedAssetDisposal.create'),
    ('ACCOUNTANT', 'fixedAssetDisposal.print'),
    ('ACCOUNTANT', 'report.fixedAssetRegister.view'),
    ('ACCOUNTANT', 'report.fixedAssetMovement.view'),
    ('ACCOUNTANT', 'report.fixedAssetSchedule.view'),
    ('ACCOUNTANT', 'report.fixedAssetDisposals.view'),
    ('CEO', 'report.fixedAssetRegister.view'),
    ('CEO', 'report.fixedAssetMovement.view'),
    ('CEO', 'report.fixedAssetSchedule.view'),
    ('CEO', 'report.fixedAssetDisposals.view'),
    ('CFO', 'report.fixedAssetRegister.view'),
    ('CFO', 'report.fixedAssetMovement.view'),
    ('CFO', 'report.fixedAssetSchedule.view'),
    ('CFO', 'report.fixedAssetDisposals.view'),
    ('COO', 'report.fixedAssetRegister.view'),
    ('COO', 'report.fixedAssetMovement.view'),
    ('COO', 'report.fixedAssetSchedule.view'),
    ('COO', 'report.fixedAssetDisposals.view'),
    ('DIRECTOR', 'report.fixedAssetRegister.view'),
    ('DIRECTOR', 'report.fixedAssetMovement.view'),
    ('DIRECTOR', 'report.fixedAssetSchedule.view'),
    ('DIRECTOR', 'report.fixedAssetDisposals.view'),
    ('MANAGER', 'report.fixedAssetRegister.view'),
    ('MANAGER', 'report.fixedAssetMovement.view'),
    ('MANAGER', 'report.fixedAssetSchedule.view'),
    ('MANAGER', 'report.fixedAssetDisposals.view')
  ) AS g(role, code)
  JOIN "Permission" p ON p.code = g.code
 WHERE EXISTS (SELECT 1 FROM app_roles r WHERE r.code = g.role)
ON CONFLICT ("permissionId", "role") DO NOTHING;

COMMIT;
