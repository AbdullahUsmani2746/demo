-- =====================================================================
-- TRANSACTIONS_MASTER.process_order_id — the process order
-- (productionPlanMaster.id) an issue (7) / production (8) voucher belongs to.
-- Read through lib/manufacturing/processOrderRef.js (falls back to rmk5, where
-- process orders were linked until now, never on automatic "AUTO_…" vouchers).
-- Additive, re-runnable. No data is changed.
-- =====================================================================
ALTER TABLE "TRANSACTIONS_MASTER" ADD COLUMN IF NOT EXISTS process_order_id INTEGER;
CREATE INDEX IF NOT EXISTS "TRANSACTIONS_MASTER_process_order_id_idx" ON "TRANSACTIONS_MASTER" (process_order_id);
