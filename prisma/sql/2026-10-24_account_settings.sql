-- ============================================================
-- Finance → Account Settings — 2026-10-24
-- ============================================================
-- Moves every account / account group the code used to hard-code into the
-- account_settings table (definitions: lib/accounts/accountSettingDefs.js),
-- and gives item categories their own sales / purchase / return / tax
-- accounts (lib/accounts/itemAccounts.js).
--
-- Safe to re-run: CREATE/ADD ... IF NOT EXISTS, seeds ON CONFLICT DO NOTHING
-- (a value already chosen on the settings screen is never overwritten).
--
-- Apply with:
--   npx prisma db execute --file prisma/sql/2026-10-24_account_settings.sql --schema prisma/schema.prisma
-- then:
--   npx prisma generate
--
-- Do NOT use `prisma db push` (it drops the stg_* tables that are not in
-- schema.prisma).
-- ============================================================

CREATE TABLE IF NOT EXISTS account_settings (
  key        VARCHAR(60)  PRIMARY KEY,
  kind       VARCHAR(10)  NOT NULL DEFAULT 'ACCOUNT',
  section    VARCHAR(40),
  label      VARCHAR(120),
  acno       INTEGER,
  macnos     INTEGER[]    NOT NULL DEFAULT '{}',
  acnos      INTEGER[]    NOT NULL DEFAULT '{}',
  updated_by VARCHAR(120),
  updated_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS account_settings_acno_idx ON account_settings (acno);

-- ── Item categories: their own posting accounts ─────────────────────────────
ALTER TABLE "ItemCategory" ADD COLUMN IF NOT EXISTS purchase_acno        INTEGER;
ALTER TABLE "ItemCategory" ADD COLUMN IF NOT EXISTS sale_return_acno     INTEGER;
ALTER TABLE "ItemCategory" ADD COLUMN IF NOT EXISTS purchase_return_acno INTEGER;
ALTER TABLE "ItemCategory" ADD COLUMN IF NOT EXISTS sales_tax_acno       INTEGER;
ALTER TABLE "ItemCategory" ADD COLUMN IF NOT EXISTS purchase_tax_acno    INTEGER;

-- New categories used to get stock 4 / sale 14 / POS 15 by default. In this
-- chart 4 is a vendor (LOTTE CHEMICAL) and 14 / 15 do not exist. An empty
-- column now means "use the Account Settings default".
ALTER TABLE "ItemCategory" ALTER COLUMN stock_acno DROP DEFAULT;
ALTER TABLE "ItemCategory" ALTER COLUMN sale_acno  DROP DEFAULT;
ALTER TABLE "ItemCategory" ALTER COLUMN pos_acno   DROP DEFAULT;

-- Category accounts that point at accounts which do not exist (818, 744, 1809
-- were carried over from another company's chart) are cleared, so those
-- categories fall back to the defaults instead of posting to nothing.
DO $$
DECLARE col TEXT; n INTEGER;
BEGIN
  FOREACH col IN ARRAY ARRAY['stock_acno','sale_acno','pos_acno','cogs_acno','cogm_acno']
  LOOP
    EXECUTE format(
      'UPDATE "ItemCategory" c SET %1$I = NULL
        WHERE c.%1$I IS NOT NULL AND NOT EXISTS (SELECT 1 FROM acno a WHERE a.acno = c.%1$I)', col);
    GET DIAGNOSTICS n = ROW_COUNT;
    IF n > 0 THEN RAISE NOTICE 'ItemCategory.%: cleared % non-existent account(s)', col, n; END IF;
  END LOOP;
END $$;

-- ── Seeds (only accounts / main accounts that exist are written) ───────────
INSERT INTO account_settings (key, kind, section, label, acno, updated_by)
SELECT s.key, 'ACCOUNT', s.section, s.label, a.acno, 'seed 2026-10-24'
FROM (VALUES
  ('sales',            'ITEMS',   'Sales',                                 860),
  ('purchase',         'ITEMS',   'Purchases',                             253),
  ('sales_return',     'ITEMS',   'Sales Return',                          2404),
  ('purchase_return',  'ITEMS',   'Purchase Return',                       2405),
  ('stock',            'ITEMS',   'Stock (Issue / Production / Transfer)', 2556),
  ('sales_tax_output', 'TAXES',   'Sales Tax on Sales (Output Tax)',       2350),
  ('sales_tax_input',  'TAXES',   'Sales Tax on Purchases (Input Tax)',    2349),
  ('freight_inward',   'FREIGHT', 'Transportation Inward',                 2557),
  ('freight_outward',  'FREIGHT', 'Transportation Outward',                2327),
  ('conversion_cost',  'COSTING', 'Conversion Cost (COGM credit)',         2567),
  ('cogs',             'COSTING', 'Cost of Goods Sold',                    2564),
  ('pos_sales',        'POS',     'POS Sales (default)',                   860)
) AS s(key, section, label, acno)
JOIN acno a ON a.acno = s.acno
ON CONFLICT (key) DO NOTHING;

-- Optional accounts with no obvious match in this chart: created empty so the
-- screen lists them; the journals that need them skip that line until set.
INSERT INTO account_settings (key, kind, section, label, updated_by) VALUES
  ('stock_lost', 'ACCOUNT', 'COSTING', 'Stock Lost (cleaning issuances)', 'seed 2026-10-24'),
  ('qc_cost',    'ACCOUNT', 'COSTING', 'QC / Lab Sample Cost',            'seed 2026-10-24')
ON CONFLICT (key) DO NOTHING;

INSERT INTO account_settings (key, kind, section, label, macnos, updated_by)
SELECT s.key, 'GROUP', s.section, s.label,
       COALESCE((SELECT array_agg(m.macno ORDER BY ord)
                 FROM unnest(s.macnos) WITH ORDINALITY AS u(macno, ord)
                 JOIN "MACNO" m ON m.macno = u.macno), '{}'),
       'seed 2026-10-24'
FROM (VALUES
  ('customers',            'PARTIES', 'Customers',                    ARRAY[2, 6]),
  ('vendors',              'PARTIES', 'Vendors',                      ARRAY[4, 5, 54, 77, 78, 90]),
  ('transporters',         'PARTIES', 'Transporters',                 ARRAY[52, 79]),
  ('cash_bank',            'PARTIES', 'Cash & Bank',                  ARRAY[32]),
  ('fixed_asset_vendors',  'PARTIES', 'Fixed Asset Vendors',          ARRAY[4, 5]),
  ('lc_accounts',          'IMPORTS', 'LC / Import Accounts',         ARRAY[24]),
  ('beneficiaries',        'IMPORTS', 'LC Beneficiaries',             ARRAY[]::INTEGER[]),
  ('conversion_overheads', 'COSTING', 'Conversion Overhead Accounts', ARRAY[51])
) AS s(key, section, label, macnos)
ON CONFLICT (key) DO NOTHING;

INSERT INTO account_settings (key, kind, section, label, acnos, updated_by)
SELECT 'blocked_voucher_accounts', 'LIST', 'VOUCHERS', 'Accounts not allowed on manual vouchers',
       COALESCE((SELECT array_agg(acno) FROM acno WHERE acno IN (860)), '{}'), 'seed 2026-10-24'
ON CONFLICT (key) DO NOTHING;
