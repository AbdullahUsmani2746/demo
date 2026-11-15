-- =====================================================================
-- Sale Order type "Despatch Without Godown"
-- Adds only: 1 column on "OrderMaster", 1 column on "ItemCategory", and
-- (only where Sale Order flag rules are in use) 1 approval rule.
-- Drops nothing, changes no existing value; safe to re-run.
--
-- A Sale Order invoiced for the customer's paperwork without anything being
-- produced. Picked in the Sale Order "Order Type" dropdown:
--   · it waits for approval like Free of Cost / Trial;
--   · its dispatch is always from ONE fixed godown (WITHOUT_GODOWN_DISPATCH in
--     lib/orders/saleOrderApprovalRules.js) — no stock check, no packing
--     consumption, no produce-on-dispatch BOM; that godown may go negative;
--   · its sale is credited to the item category's "No Godown Sale Acno"
--     (ItemCategory.nogodown_sale_acno) instead of the normal Sale Acno;
--     empty → the dispatch / invoice is refused (422);
--   · it is invoiced on Sale Invoicing like any other dispatch.
-- Code: lib/dispatch/withoutGodown.js
--
-- NOT set by this file (SMS has neither yet — set them up by hand):
--   · the godown: create e.g. "NO PROD DESP", close it in Setup → Godowns,
--     and put its id in WITHOUT_GODOWN_DISPATCH. Until then the order type
--     is refused with a clear message.
--   · the account: create a sale account e.g. "NO GODOWN SALES" and pick it
--     as "No Godown Sale Acno" on Setup → Item Categories (FINISHED GOODS,
--     SEMI FINISHED, …). Until then such a dispatch is refused.
--
-- Run BEFORE deploying the code that uses it (owner approves the run):
--   npx prisma db execute --file prisma/sql/2026-11-08_despatch_without_godown.sql --schema prisma/schema.prisma
-- =====================================================================
BEGIN;

ALTER TABLE "OrderMaster" ADD COLUMN IF NOT EXISTS "dispatchWithoutGodown" BOOLEAN DEFAULT false;

ALTER TABLE "ItemCategory" ADD COLUMN IF NOT EXISTS "nogodown_sale_acno" INTEGER;

-- Approval. While NO Sale Order flag rule exists, the built-in reasons apply
-- (lib/orders/saleOrderApprovalRules.js) and "Despatch Without Godown" is one
-- of them — nothing to add. Once flag rules are in use (Admin → Permissions →
-- Approvals, seeded by 2026-10-25_phase3_approvals.sql) only rules count, so
-- a rule is added with the same approvers as the "No Godown" rule (none =
-- holders of saleOrder.approve). Inserting it while no rule exists would
-- switch off every built-in reason, so it is only added next to the others.
INSERT INTO "ApprovalRule"
  ("name", "doc_type", "match", "applies_on", "mode", "conditions", "approver_users", "approver_roles", "message", "is_active", "sort", "updated_at")
SELECT 'Despatch Without Godown', 'saleOrder', 'all', 'both', 'flag',
       '[{"field":"m:soOrderType","op":"eq","value":"Despatch Without Godown"}]'::jsonb,
       COALESCE((SELECT "approver_users" FROM "ApprovalRule" WHERE "doc_type" = 'saleOrder' AND "mode" = 'flag' AND "name" = 'No Godown' LIMIT 1), '[]'::jsonb),
       COALESCE((SELECT "approver_roles" FROM "ApprovalRule" WHERE "doc_type" = 'saleOrder' AND "mode" = 'flag' AND "name" = 'No Godown' LIMIT 1), '[]'::jsonb),
       NULL, true,
       COALESCE((SELECT MAX("sort") FROM "ApprovalRule" WHERE "doc_type" = 'saleOrder'), 0) + 1,
       now()
WHERE EXISTS (SELECT 1 FROM "ApprovalRule" WHERE "doc_type" = 'saleOrder' AND "mode" = 'flag')
  AND NOT EXISTS (SELECT 1 FROM "ApprovalRule" WHERE "doc_type" = 'saleOrder' AND "name" = 'Despatch Without Godown');

COMMIT;

-- Check (informational):
SELECT "id", "name", "mode", "approver_users", "approver_roles", "is_active"
FROM "ApprovalRule" WHERE "doc_type" = 'saleOrder' ORDER BY "sort";
