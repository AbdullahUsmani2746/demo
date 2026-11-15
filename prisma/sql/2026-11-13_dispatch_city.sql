-- Dispatch "City" — the city the vehicle is taking the goods to, typed on
-- the dispatch header next to Vehicle No. Free text, optional; only a
-- dispatch (tran_code 6) stores it (app/api/voucher/[type]/route.js).
-- Additive and re-runnable.
ALTER TABLE "TRANSACTIONS_MASTER" ADD COLUMN IF NOT EXISTS city VARCHAR(100);
