-- 2026-10-29 — line-level attachments.
-- Transactions.attachments: files attached to one voucher line (public URLs),
-- next to the document's own TRANSACTIONS_MASTER.attachments.
-- Matches prisma/schema.prisma (`attachments String[] @default([])`).
-- Must run before deploying the code that reads the column.

ALTER TABLE "Transactions"
  ADD COLUMN IF NOT EXISTS "attachments" TEXT[] DEFAULT ARRAY[]::TEXT[];
