-- ============================================================
-- Sale Order CEO approval (Free of Cost / Trial Process) — 2026-10-06
-- ============================================================
-- · OrderMaster: trialProcess flag + who/when/remarks of the approval
-- · Permission saleOrder.approve, granted to Atif Mir (User.id '1')
-- · Menu MANAGEMENT → SO APPROVALS (Atif Mir's employee has MANAGEMENT)
--
-- Additive only and safe to re-run.
-- Apply with:
--   npx prisma db execute --file prisma/sql/2026-10-06_sale_order_approval.sql --schema prisma/schema.prisma
--
-- Do NOT use `prisma db push`: the live database holds tables that are not
-- in schema.prisma (stg_tran_detail, stg_tran_master) and db push drops them.
-- ============================================================

ALTER TABLE "OrderMaster" ADD COLUMN IF NOT EXISTS "trialProcess" BOOLEAN DEFAULT false;
ALTER TABLE "OrderMaster" ADD COLUMN IF NOT EXISTS "approved_by" VARCHAR(50);
ALTER TABLE "OrderMaster" ADD COLUMN IF NOT EXISTS "approved_at" TIMESTAMP(3);
ALTER TABLE "OrderMaster" ADD COLUMN IF NOT EXISTS "approval_remarks" VARCHAR(500);

INSERT INTO "Permission" ("code", "module", "label", "sort")
SELECT 'saleOrder.approve', 'Sales', 'Approve Free of Cost / Trial Process sale orders (CEO)', 151
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE "code" = 'saleOrder.approve');

INSERT INTO "PermissionGrant" ("permissionId", "userId", "allow", "createdAt", "updatedAt")
SELECT p."id", '1', true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Permission" p
WHERE p."code" = 'saleOrder.approve'
  AND EXISTS (SELECT 1 FROM "User" u WHERE u."id" = '1')
  AND NOT EXISTS (
    SELECT 1 FROM "PermissionGrant" g WHERE g."permissionId" = p."id" AND g."userId" = '1'
  );

INSERT INTO "menus" ("title", "url", "icon", "parent_id", "order_no", "is_active")
SELECT 'SO APPROVALS', '/accounting/forms/saleOrderApprovals', 'ShieldCheck', p.id, 1, true
FROM "menus" p
WHERE p.title = 'MANAGEMENT' AND p.parent_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM "menus" m WHERE m.url = '/accounting/forms/saleOrderApprovals');
