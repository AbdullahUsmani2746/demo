-- ============================================================
-- Phase 3 — approvals, menu blocks, department scope, sales visibility
-- 2026-10-25 (ported from the Eastland ERP, adapted for SMS)
-- ============================================================
-- One file, in this order:
--   1. DepartmentScope   — data-scope rules per department (Admin → Permissions
--                          → Department). lib/auth/scope.js, lib/auth/scopeDimensions.js
--   2. ApprovalRule /    — configurable approvals on any voucher / order form
--      ApprovalRequest     (Admin → Permissions → Approvals → "Approval rules").
--                          A matching save is HELD as a request; nothing is posted
--                          until an approver approves it on /dashboard/approvals.
--                          lib/approvals/*, app/api/approvals/*
--   3. MenuBlock          — take a menu away from a person or a role
--                          (Admin → Permissions → Menu access). lib/menu/blocks.js
--   4. Permission codes   — salesTeam.viewAll, salesTeam.viewTeam,
--                          saleOrder.approve, saleReturn.approve, saleReturn.remark.
--                          Catalogue rows only — NO user grants. Who approves /
--                          who sees all sales is chosen on Admin → Permissions
--                          (tabs "Approvals" and "Sales visibility").
--   5. Sale Order flag rules — the six built-in reasons a Sale Order waits for
--                          approval before dispatch (Free of Cost, Trial Process,
--                          Rate Under Negotiation, No Godown, Customer Bad Debt,
--                          Customer Bad Payment) as editable rules with mode
--                          'flag'. Seeded ACTIVE with NO approvers: the behaviour
--                          is exactly the built-in one (holders of
--                          saleOrder.approve approve every reason); pick
--                          per-reason approvers in the UI. Added only when no
--                          Sale Order flag rule exists yet.
--
-- Additive only and idempotent (IF NOT EXISTS / ON CONFLICT DO NOTHING /
-- WHERE NOT EXISTS) — safe to re-run. Matches the models already in
-- prisma/schema.prisma (ApprovalRule, ApprovalRequest, MenuBlock,
-- DepartmentScope).
--
-- Apply with:
--   npx prisma db execute --file prisma/sql/2026-10-25_phase3_approvals.sql --schema prisma/schema.prisma
-- then (dev server stopped):
--   npx prisma generate
-- and, to refresh permission labels / sort order from the code catalogue:
--   node --env-file=.env scripts/seed-permissions.mjs --apply
--
-- Do NOT use `prisma db push`: the live database holds tables that are not in
-- schema.prisma and db push drops them.
-- ============================================================

-- ── 1. Department data scope ─────────────────────────────────
-- One row per (department, dimension), e.g. STORE → godown LIST {3,9}. Applies
-- to every user of the department who has no personal DataScope row for it.
CREATE TABLE IF NOT EXISTS "DepartmentScope" (
  "id"           TEXT         NOT NULL,
  "departmentId" INTEGER      NOT NULL,
  "dimension"    VARCHAR(30)  NOT NULL,
  "mode"         VARCHAR(10)  NOT NULL,                    -- ALL | LIST
  "values"       TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  "updatedAt"    TIMESTAMP(3) NOT NULL,
  CONSTRAINT "DepartmentScope_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "DepartmentScope_departmentId_fkey" FOREIGN KEY ("departmentId")
    REFERENCES "Department"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX IF NOT EXISTS "DepartmentScope_departmentId_dimension_key"
  ON "DepartmentScope"("departmentId", "dimension");
CREATE INDEX IF NOT EXISTS "DepartmentScope_departmentId_idx"
  ON "DepartmentScope"("departmentId");

-- ── 2. Approval rules and held requests ──────────────────────
CREATE TABLE IF NOT EXISTS "ApprovalRule" (
  "id"              SERIAL        PRIMARY KEY,
  "name"            VARCHAR(150)  NOT NULL,
  "doc_type"        VARCHAR(60)   NOT NULL,                -- VOUCHER_CONFIG key, e.g. materialIssue
  "match"           VARCHAR(10)   NOT NULL DEFAULT 'all',  -- all | any (of the conditions)
  "applies_on"      VARCHAR(10)   NOT NULL DEFAULT 'create', -- create | update | both
  "mode"            VARCHAR(10)   NOT NULL DEFAULT 'hold', -- hold | flag (save, block dispatch)
  "conditions"      JSONB         NOT NULL DEFAULT '[]',   -- [{ field, op, value }]
  "approver_users"  JSONB         NOT NULL DEFAULT '[]',   -- [User.id]
  "approver_roles"  JSONB         NOT NULL DEFAULT '[]',   -- [Role]
  "message"         VARCHAR(300),                          -- shown to the requester
  "is_active"       BOOLEAN       NOT NULL DEFAULT true,
  "sort"            INTEGER       NOT NULL DEFAULT 0,
  "created_by"      VARCHAR(50),
  "created_at"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Columns added after the first version (no-ops on a fresh table).
ALTER TABLE "ApprovalRule" ADD COLUMN IF NOT EXISTS "applies_on" VARCHAR(10) NOT NULL DEFAULT 'create';
ALTER TABLE "ApprovalRule" ADD COLUMN IF NOT EXISTS "mode"       VARCHAR(10) NOT NULL DEFAULT 'hold';
CREATE INDEX IF NOT EXISTS "ApprovalRule_doc_type_idx" ON "ApprovalRule"("doc_type");

CREATE TABLE IF NOT EXISTS "ApprovalRequest" (
  "id"              SERIAL        PRIMARY KEY,
  "rule_id"         INTEGER       REFERENCES "ApprovalRule"("id") ON DELETE SET NULL,
  "rule_name"       VARCHAR(150),
  "doc_type"        VARCHAR(60)   NOT NULL,
  "tran_code"       INTEGER,
  "kind"            VARCHAR(10)   NOT NULL DEFAULT 'voucher', -- voucher | order (which route posts it)
  "action"          VARCHAR(10)   NOT NULL DEFAULT 'create',  -- create | update
  "target_id"       VARCHAR(60),                              -- the document an edit is for
  "status"          VARCHAR(20)   NOT NULL DEFAULT 'pending', -- pending | approved | rejected | cancelled
  "payload"         JSONB         NOT NULL,                    -- the body the save received
  "ui_state"        JSONB,                                     -- the form's own state, to re-open it
  "summary"         VARCHAR(500),
  "requested_by"    VARCHAR(50)   NOT NULL,
  "requested_at"    TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "decided_by"      VARCHAR(50),
  "decided_at"      TIMESTAMP(3),
  "remarks"         VARCHAR(500),
  "posted_tran_id"  INTEGER,
  "posted_no"       VARCHAR(60),
  "post_error"      VARCHAR(500),
  "updated_at"      TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS "kind"      VARCHAR(10) NOT NULL DEFAULT 'voucher';
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS "action"    VARCHAR(10) NOT NULL DEFAULT 'create';
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS "target_id" VARCHAR(60);
CREATE INDEX IF NOT EXISTS "ApprovalRequest_status_idx"       ON "ApprovalRequest"("status");
CREATE INDEX IF NOT EXISTS "ApprovalRequest_requested_by_idx" ON "ApprovalRequest"("requested_by");
CREATE INDEX IF NOT EXISTS "ApprovalRequest_rule_id_idx"      ON "ApprovalRequest"("rule_id");
CREATE INDEX IF NOT EXISTS "ApprovalRequest_target_idx"       ON "ApprovalRequest"("kind", "target_id", "status");

-- ── 3. Menu blocks ───────────────────────────────────────────
-- A block takes a menu (and everything under it) away from a person or a
-- role, even ACCOUNTANT / MANAGER. ADMIN is never blocked.
CREATE TABLE IF NOT EXISTS "MenuBlock" (
  "id"          SERIAL        PRIMARY KEY,
  "menu_id"     INTEGER       NOT NULL REFERENCES "menus"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "user_id"     VARCHAR(50),
  "role"        VARCHAR(30),
  "created_by"  VARCHAR(50),
  "created_at"  TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "MenuBlock_menu_id_user_id_key" ON "MenuBlock"("menu_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "MenuBlock_menu_id_role_key"    ON "MenuBlock"("menu_id", "role");
CREATE INDEX IF NOT EXISTS "MenuBlock_user_id_idx" ON "MenuBlock"("user_id");
CREATE INDEX IF NOT EXISTS "MenuBlock_role_idx"    ON "MenuBlock"("role");

-- ── 4. Permission codes (catalogue rows only, no grants) ─────
-- Same codes / labels as scripts/seed-permissions.mjs. Existing rows are left
-- as they are (the seed script refreshes labels and sort order).
INSERT INTO "Permission" ("code", "module", "label", "sort")
VALUES
  ('salesTeam.viewAll',  'Sales', 'See every sales person''s customers (reports, MIS, targets, loans)', 100),
  ('salesTeam.viewTeam', 'Sales', 'See own customers plus chosen sales persons'' customers', 101),
  ('saleOrder.approve',  'Sales', 'Approve Sale Orders held for approval (Free of Cost / Trial / No Godown …)', 102),
  ('saleReturn.approve', 'Sales', 'Approve sale returns with a Technical reason', 103),
  ('saleReturn.remark',  'Sales', 'Write review remarks on sale return reasons', 104)
ON CONFLICT ("code") DO NOTHING;

-- ── 5. Sale Order approval reasons as flag rules ─────────────
-- No approvers on purpose: until someone is picked per reason on Admin →
-- Permissions → Approvals, holders of saleOrder.approve approve them all, as
-- before. Only added when no Sale Order flag rule exists yet.
INSERT INTO "ApprovalRule"
  ("name", "doc_type", "match", "applies_on", "mode", "conditions", "approver_users", "approver_roles", "message", "is_active", "sort", "updated_at")
SELECT v.name, 'saleOrder', 'all', 'both', 'flag', v.conditions::jsonb, '[]'::jsonb, '[]'::jsonb, NULL, true, v.sort, now()
FROM (VALUES
  ('Free of Cost',           '[{"field":"m:soOrderType","op":"eq","value":"Free of Cost"}]', 1),
  ('Trial Process',          '[{"field":"m:soOrderType","op":"eq","value":"Trial Process"}]', 2),
  ('Rate Under Negotiation', '[{"field":"m:soOrderType","op":"eq","value":"Rate Under Negotiation"}]', 3),
  ('No Godown',              '[{"field":"m:godown","op":"eq","value":"No Godown"}]', 4),
  ('Customer Bad Debt',      '[{"field":"@customerStatus","op":"contains","value":"BAD"},{"field":"@customerStatus","op":"contains","value":"DEBT"}]', 5),
  ('Customer Bad Payment',   '[{"field":"@customerStatus","op":"contains","value":"BAD"},{"field":"@customerStatus","op":"contains","value":"PAYMENT"}]', 6)
) AS v(name, conditions, sort)
WHERE NOT EXISTS (SELECT 1 FROM "ApprovalRule" WHERE "doc_type" = 'saleOrder' AND "mode" = 'flag');

-- Check (informational):
SELECT "id", "name", "mode", "applies_on", "approver_users", "is_active"
FROM "ApprovalRule" WHERE "doc_type" = 'saleOrder' ORDER BY "sort";
