-- Service Invoice (tran_code 21): Tanker No on the header, and the Official /
-- Unofficial parts of each line's amount.
--
--   TRANSACTIONS_MASTER.tanker_no      the tanker the service was for (free text,
--                                      optional; only a Service Invoice stores it)
--   Transactions.official_amount       what the user typed as the official part
--   Transactions.unofficial_amount     what the user typed as the unofficial part
--
-- Record only: when either part is given, the line's Amount (gross_amount /
-- damt — what posts, and what sales tax is worked on) = official + unofficial
-- and Rate = Amount ÷ Qty (lib/service/serviceInvoice.js). Nothing else reads
-- the two parts for posting.
-- Used only while Settings → Features "documents.serviceTankerOfficial" is on
-- (default off); invoices saved with them keep them on edit.
-- Additive and re-runnable.
ALTER TABLE "TRANSACTIONS_MASTER" ADD COLUMN IF NOT EXISTS tanker_no VARCHAR(50);
ALTER TABLE "Transactions" ADD COLUMN IF NOT EXISTS official_amount double precision;
ALTER TABLE "Transactions" ADD COLUMN IF NOT EXISTS unofficial_amount double precision;
