-- Manual document number — the number the user writes on their own paper
-- book, recorded next to the system number:
--   Dispatch (tran_code 6)  → "Manual DC No"
--   GRN      (tran_code 4)  → "Manual GRN No"   (the vendor's own DC / challan
--                              stays in rmk3 "Vendor DC / Challan No")
-- Free text, optional, not unique (paper books restart / repeat).
-- Additive and re-runnable.
ALTER TABLE "TRANSACTIONS_MASTER" ADD COLUMN IF NOT EXISTS manual_no VARCHAR(50);

CREATE INDEX IF NOT EXISTS "TRANSACTIONS_MASTER_manual_no_idx"
  ON "TRANSACTIONS_MASTER" (manual_no)
  WHERE manual_no IS NOT NULL;
