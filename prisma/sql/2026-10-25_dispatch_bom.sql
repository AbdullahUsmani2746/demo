-- ============================================================
-- Produce-on-dispatch — 2026-10-25
-- ============================================================
-- A dispatch line's BOM materials become an automatic Material Issue
-- (tran_code 7, rmk1 'AUTO_DISPATCH_BOM') and Production (tran_code 8,
-- rmk1 'AUTO_DISPATCH_PROD') linked by rmk4 = dispatch tran_id
-- (lib/dispatch/bomProduction.js). Each auto row records which dispatch line
-- it belongs to, so the dispatch form can rebuild every line's materials.
--
-- Dispatch rates come from the Sale Order / customer price list; changing them
-- needs the new permission below (lib/dispatch/linePricing.js).
--
-- Additive and safe to re-run. Apply with:
--   npx prisma db execute --file prisma/sql/2026-10-25_dispatch_bom.sql --schema prisma/schema.prisma
-- then:
--   npx prisma generate
-- Do NOT use `prisma db push`.
-- ============================================================

ALTER TABLE "Transactions" ADD COLUMN IF NOT EXISTS source_line_no INTEGER;

-- Finds a dispatch's auto vouchers (and its packing consumption) by link.
CREATE INDEX IF NOT EXISTS "TRANSACTIONS_MASTER_auto_link_idx"
  ON "TRANSACTIONS_MASTER" (rmk4, tran_code, rmk1)
  WHERE rmk1 IN ('AUTO_PACKING', 'AUTO_DISPATCH_BOM', 'AUTO_DISPATCH_PROD');

-- ── GRN / dispatch numbering ────────────────────────────────────────────────
-- The app relies on a BEFORE INSERT trigger to number every GRN (tran_code 4,
-- grn_no) and dispatch (tran_code 6, dispatch_no) from a sequence, and its
-- "next number" preview reads those sequences (app/api/voucher/next-number).
-- This database never had them, so GRNs / dispatches were saved unnumbered.
-- Only grn_no / dispatch_no are assigned here — vr_no stays with the app
-- (the other company's version also renumbered vr_no; see sequence.txt).
-- The number is always assigned by the database, never taken from the form,
-- so two users can never save the same number.
-- Refuse to replace a numbering function this script did not write (e.g. the
-- full version that also assigns vr_no) — that would silently stop vr_no.
DO $$
DECLARE body TEXT;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO body
  FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'auto_assign_numbers';
  IF body IS NOT NULL AND body NOT LIKE '%SMS: grn_no / dispatch_no only%' THEN
    RAISE EXCEPTION 'auto_assign_numbers() already exists with a different body — review it before running this script';
  END IF;
END $$;

CREATE SEQUENCE IF NOT EXISTS grn_no_seq START 1;
CREATE SEQUENCE IF NOT EXISTS dispatch_no_seq START 1;

-- Continue after anything already numbered (nothing is, today). Only ever
-- moves a sequence FORWARD (re-running never re-issues a number), and ignores
-- the 5,000,000+ range used by the dormant *_off series.
DO $$
DECLARE m BIGINT;
BEGIN
  SELECT COALESCE(MAX(grn_no), 0) INTO m FROM "TRANSACTIONS_MASTER"
   WHERE tran_code = 4 AND grn_no < 5000000;
  IF m + 1 > (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM grn_no_seq) THEN
    PERFORM setval('grn_no_seq', m + 1, false);
  END IF;

  SELECT COALESCE(MAX(dispatch_no), 0) INTO m FROM "TRANSACTIONS_MASTER"
   WHERE tran_code = 6 AND dispatch_no < 5000000;
  IF m + 1 > (SELECT CASE WHEN is_called THEN last_value + 1 ELSE last_value END FROM dispatch_no_seq) THEN
    PERFORM setval('dispatch_no_seq', m + 1, false);
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.auto_assign_numbers()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
-- SMS: grn_no / dispatch_no only (prisma/sql/2026-10-25_dispatch_bom.sql)
BEGIN
    IF NEW.tran_code = 4 THEN
        NEW.grn_no := nextval('grn_no_seq');
    END IF;
    IF NEW.tran_code = 6 THEN
        NEW.dispatch_no := nextval('dispatch_no_seq');
    END IF;
    RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trigger_auto_numbers ON "TRANSACTIONS_MASTER";
CREATE TRIGGER trigger_auto_numbers
  BEFORE INSERT ON "TRANSACTIONS_MASTER"
  FOR EACH ROW EXECUTE FUNCTION public.auto_assign_numbers();

INSERT INTO "Permission" (code, module, label, sort)
VALUES ('dispatch.rate.override', 'Sales',
        'Override dispatch rates (otherwise taken from the Sale Order / customer price list)', 0)
ON CONFLICT (code) DO NOTHING;
