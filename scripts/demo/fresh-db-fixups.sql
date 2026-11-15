-- scripts/demo/fresh-db-fixups.sql
-- ============================================================
-- Objects the live SMS database has that `prisma db push` + prisma/sql/*.sql
-- do not create on a brand-new database. Run once on a fresh (demo) database,
-- after prisma/sql. Re-runnable.
--
-- 1. Sale-order numbers: OrderMaster.order_no defaults to
--    nextval('ordermaster_order_no_seq') on the live server, and
--    /api/orders/next-order-no previews that exact (lower-case) name.
--    db push names it "OrderMaster_order_no_seq" — rename it.
-- 2. purchase_order_seq: previewed for purchase orders (category 4).
-- ============================================================

DO $$
BEGIN
  IF to_regclass('public."OrderMaster_order_no_seq"') IS NOT NULL
     AND to_regclass('public.ordermaster_order_no_seq') IS NULL THEN
    ALTER SEQUENCE public."OrderMaster_order_no_seq" RENAME TO ordermaster_order_no_seq;
  END IF;
END $$;

CREATE SEQUENCE IF NOT EXISTS purchase_order_seq START WITH 100 INCREMENT BY 1 NO MAXVALUE;
