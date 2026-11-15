-- ============================================================
-- Sale Return Remarks + Technical-reason approval — 2026-10-10
-- ============================================================
-- · SALE_RETURN_REMARK: one row per Sale Return (tran_code 10) — reason
--   (TECHNICAL / COMMERCIAL), the sales person's remarks, and for TECHNICAL
--   the approval (PENDING / APPROVED / REJECTED).
-- · Permission saleReturn.approve, granted to
--     Imtiaz Ahmed (User.id 'cmt8qabrn0007ua78i5jnotcq')
--     Atif Mir     (User.id '1')
-- · Menus: SALES → SR REMARKS, MANAGEMENT → SR APPROVALS
--
-- Additive only and safe to re-run.
-- Apply with:
--   npx prisma db execute --file prisma/sql/2026-10-10_sale_return_remarks.sql --schema prisma/schema.prisma
--   npx prisma generate
--
-- Do NOT use `prisma db push`: the live database holds tables that are not
-- in schema.prisma (stg_tran_detail, stg_tran_master) and db push drops them.
-- ============================================================

CREATE TABLE IF NOT EXISTS "SALE_RETURN_REMARK" (
  "id"               SERIAL PRIMARY KEY,
  "tran_id"          INTEGER NOT NULL,
  "reason_type"      VARCHAR(20) NOT NULL,
  "remarks"          VARCHAR(1000),
  "status"           VARCHAR(20),
  "entered_by"       VARCHAR(50),
  "entered_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_by"       VARCHAR(50),
  "decided_at"       TIMESTAMP(3),
  "decision_remarks" VARCHAR(500)
);

CREATE UNIQUE INDEX IF NOT EXISTS "SALE_RETURN_REMARK_tran_id_key" ON "SALE_RETURN_REMARK" ("tran_id");
CREATE INDEX IF NOT EXISTS "SALE_RETURN_REMARK_reason_type_idx" ON "SALE_RETURN_REMARK" ("reason_type");
CREATE INDEX IF NOT EXISTS "SALE_RETURN_REMARK_status_idx" ON "SALE_RETURN_REMARK" ("status");

INSERT INTO "Permission" ("code", "module", "label", "sort")
SELECT 'saleReturn.approve', 'Sales', 'Approve sale returns with a Technical reason', 152
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE "code" = 'saleReturn.approve');

INSERT INTO "PermissionGrant" ("permissionId", "userId", "allow", "createdAt", "updatedAt")
SELECT p."id", u."id", true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "Permission" p
JOIN "User" u ON u."id" IN ('cmt8qabrn0007ua78i5jnotcq', '1')
WHERE p."code" = 'saleReturn.approve'
  AND NOT EXISTS (
    SELECT 1 FROM "PermissionGrant" g WHERE g."permissionId" = p."id" AND g."userId" = u."id"
  );

INSERT INTO "menus" ("title", "url", "icon", "parent_id", "order_no", "is_active")
SELECT 'SR REMARKS', '/accounting/forms/saleReturnRemarks', 'Undo2', p.id, 5, true
FROM "menus" p
WHERE p.title = 'SALES' AND p.parent_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM "menus" m WHERE m.url = '/accounting/forms/saleReturnRemarks');

INSERT INTO "menus" ("title", "url", "icon", "parent_id", "order_no", "is_active")
SELECT 'SR APPROVALS', '/accounting/forms/saleReturnApprovals', 'ShieldCheck', p.id, 2, true
FROM "menus" p
WHERE p.title = 'MANAGEMENT' AND p.parent_id IS NULL
  AND NOT EXISTS (SELECT 1 FROM "menus" m WHERE m.url = '/accounting/forms/saleReturnApprovals');
