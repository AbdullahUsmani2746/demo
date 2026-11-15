-- =====================================================================
-- Sale Order / Dispatch features (Settings → Features, lib/features/catalog.js)
--
-- orders.trialLineBilling — a billing part of approved trial items
-- (TRANSACTIONS_MASTER.dispatch_part > 1, lib/dispatch/trialBilling.js) keeps
-- the dispatch_no of the trial dispatch it was moved off. The number trigger
-- (first written by prisma/sql/2026-10-25_dispatch_bom.sql) gives every new
-- dispatch the next dispatch_no — except such a part. Otherwise unchanged:
-- grn_no / dispatch_no only, vr_no stays with the app. The marker comment
-- "SMS: grn_no / dispatch_no only" is kept, so 2026-10-25_dispatch_bom.sql
-- still recognises this function as its own.
--
-- The columns themselves (dispatch_part, line_type …) come from
-- prisma/sql/2026-11-19_merge_eastland_accounting.sql. No permission or menu
-- rows are needed: Approved trial items lives on Sale Invoicing and uses its
-- invoicing.sale.view / invoicing.sale.generate rights.
--
-- Re-runnable. Apply (after the owner approves this run):
--   npx prisma db execute --file prisma/sql/2026-11-19_sales_dispatch_features.sql --schema prisma/schema.prisma
-- =====================================================================

BEGIN;

ALTER TABLE "TRANSACTIONS_MASTER" ADD COLUMN IF NOT EXISTS "dispatch_part" INTEGER DEFAULT 1;

CREATE OR REPLACE FUNCTION public.auto_assign_numbers()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
-- SMS: grn_no / dispatch_no only (prisma/sql/2026-10-25_dispatch_bom.sql;
-- a trial billing part keeps its number: prisma/sql/2026-11-19_sales_dispatch_features.sql)
BEGIN
    IF NEW.tran_code = 4 THEN
        NEW.grn_no := nextval('grn_no_seq');
    END IF;
    IF NEW.tran_code = 6 AND NOT (COALESCE(NEW.dispatch_part, 1) > 1 AND NEW.dispatch_no IS NOT NULL) THEN
        NEW.dispatch_no := nextval('dispatch_no_seq');
    END IF;
    RETURN NEW;
END;
$function$;

COMMIT;
