-- ============================================================
-- Acknowledged qty — 2026-10-27
-- ============================================================
-- Invoicing (lib/invoicing/core.js) bills a GRN / dispatch / return line on its
-- ACKNOWLEDGED quantity, which the user may set below the physical quantity
-- (e.g. GRN 1.0, acknowledged 0.8 → invoice 0.8 × rate).
--
--   "Transactions".ack_qty  double precision, nullable
--     Unit = the line's BILLING unit: litres on a unit='LTR' line (like
--     qty_ltr), kilograms / the item unit otherwise (like qty).
--     NULL = not acknowledged separately = the billable qty (qty, or qty_ltr
--     on a LTR line). Stored only when it differs from that.
--     Stock calculations never read it: qty / qty_ltr stay the physical movement.
--     Saving / editing the document from its entry screen recreates its lines,
--     which leaves ack_qty NULL again.
--
-- Additive and idempotent (a re-run changes nothing). Apply with:
--   npx prisma db execute --file prisma/sql/2026-10-27_ack_qty.sql --schema prisma/schema.prisma
-- then:
--   npx prisma generate
-- Do NOT use `prisma db push`.
-- ============================================================

ALTER TABLE "Transactions" ADD COLUMN IF NOT EXISTS ack_qty double precision;

COMMENT ON COLUMN "Transactions".ack_qty IS
  'Acknowledged qty in the line''s billing unit (litres on LTR lines). NULL = billable qty (qty / qty_ltr). Invoicing prices on it; stock never reads it.';
