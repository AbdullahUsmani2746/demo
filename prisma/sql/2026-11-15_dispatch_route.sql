-- Dispatch "Route" — the route the vehicle takes, typed on the dispatch
-- header under City. Free text, optional; only a dispatch (tran_code 6)
-- stores it (app/api/voucher/[type]/route.js).
-- Additive and re-runnable.
ALTER TABLE "TRANSACTIONS_MASTER" ADD COLUMN IF NOT EXISTS route VARCHAR(150);
