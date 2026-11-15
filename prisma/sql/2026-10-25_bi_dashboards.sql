-- ============================================================
-- BI — questions, dashboards, assignments, dataset access, follow-ups — 2026-10-25
-- (SMS port of Eastland 2026-10-21_bi_dashboards.sql + 2026-10-24_bi_followups.sql)
-- ============================================================
-- · BiQuestion            saved question (dataset + measures + visual, JSON)
-- · BiDashboard           a page of questions (layout JSON)
-- · BiDashboardAssignment who sees a dashboard (department / role / user)
-- · BiDatasetAccess       which datasets a department may use (none = all)
-- · BiFollowup            one row per flagged item of a follow-up question
--                         (open / done / cleared) — lib/bi/followups.js
-- · BiFollowupNote        the history: every "followed up — result — remarks"
-- · Permission bi.design  build questions & dashboards (ADMIN / ACCOUNTANT
--                         pass every check anyway)
--
-- Follow-ups: a BI question can turn its highlighted rows
-- (visual.options.rowRules) into follow-ups (config.followup) with an owner
-- (the customer's sales person, or named people), reminders, escalation and a
-- log. Results: approved · not_suitable · more_time (due again on next_date) ·
-- other. Logged on /dashboard/followups or from the dashboard row.
--
-- NO menu rows here. Add them with scripts/build-menus-sql.mjs:
--   BI DESIGNER   (MANAGEMENT) → /accounting/bi-designer
--   MY DASHBOARDS              → /dashboard/insights
--   MY FOLLOW-UPS              → /dashboard/followups
--
-- Code: lib/bi/*, app/api/bi/*, app/api/followups/*, components/bi/*,
--       components/followups/*
--
-- Additive only and safe to re-run (IF NOT EXISTS / WHERE NOT EXISTS).
-- Apply with:
--   npx prisma db execute --file prisma/sql/2026-10-25_bi_dashboards.sql --schema prisma/schema.prisma
-- then (dev server stopped):
--   npx prisma generate
-- Do NOT use `prisma db push`.
-- ============================================================

-- ── Questions ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "BiQuestion" (
  "id"          SERIAL       PRIMARY KEY,
  "name"        VARCHAR(150) NOT NULL,
  "description" VARCHAR(500),
  "dataset"     VARCHAR(50)  NOT NULL,
  "config"      JSONB        NOT NULL,
  "created_by"  VARCHAR(50),
  "created_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "BiQuestion_dataset_idx" ON "BiQuestion"("dataset");

-- ── Dashboards ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "BiDashboard" (
  "id"             SERIAL       PRIMARY KEY,
  "name"           VARCHAR(150) NOT NULL,
  "description"    VARCHAR(500),
  "layout"         JSONB        NOT NULL,
  "default_period" VARCHAR(20)  NOT NULL DEFAULT 'mtd',
  "is_active"      BOOLEAN      NOT NULL DEFAULT true,
  "created_by"     VARCHAR(50),
  "created_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "BiDashboardAssignment" (
  "id"            SERIAL      PRIMARY KEY,
  "dashboard_id"  INTEGER     NOT NULL REFERENCES "BiDashboard"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "department_id" INTEGER     REFERENCES "Department"("id") ON DELETE CASCADE,
  "role"          VARCHAR(30),
  "user_id"       VARCHAR(50),
  "is_landing"    BOOLEAN     NOT NULL DEFAULT false
);
CREATE INDEX IF NOT EXISTS "BiDashboardAssignment_dashboard_id_idx"  ON "BiDashboardAssignment"("dashboard_id");
CREATE INDEX IF NOT EXISTS "BiDashboardAssignment_department_id_idx" ON "BiDashboardAssignment"("department_id");
CREATE INDEX IF NOT EXISTS "BiDashboardAssignment_user_id_idx"       ON "BiDashboardAssignment"("user_id");

CREATE TABLE IF NOT EXISTS "BiDatasetAccess" (
  "id"            SERIAL      PRIMARY KEY,
  "department_id" INTEGER     NOT NULL REFERENCES "Department"("id") ON DELETE CASCADE,
  "dataset"       VARCHAR(50) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "BiDatasetAccess_department_id_dataset_key"
  ON "BiDatasetAccess"("department_id", "dataset");

-- ── Follow-ups ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS "BiFollowup" (
  "id"            SERIAL       PRIMARY KEY,
  "question_id"   INTEGER      NOT NULL REFERENCES "BiQuestion"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "item_key"      VARCHAR(150) NOT NULL,
  "item_label"    VARCHAR(400),
  "flag_label"    VARCHAR(80),
  "owner_id"      VARCHAR(50),
  "party_id"      INTEGER,                                 -- the customer (blocking new FOC / Trial orders)
  "status"        VARCHAR(20)  NOT NULL DEFAULT 'open',   -- open | done | cleared
  "result"        VARCHAR(20),                             -- approved | not_suitable | more_time | other
  "next_date"     TIMESTAMP(3),                            -- "Needs more time": due again on this date
  "remarks"       VARCHAR(1000),
  "due_since"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "level"         INTEGER      NOT NULL DEFAULT 0,         -- escalation steps already sent
  "done_at"       TIMESTAMP(3),
  "done_by"       VARCHAR(50),
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Columns added after the first Eastland version (no-ops on a fresh table).
ALTER TABLE "BiFollowup" ADD COLUMN IF NOT EXISTS "party_id"  INTEGER;
ALTER TABLE "BiFollowup" ADD COLUMN IF NOT EXISTS "next_date" TIMESTAMP(3);
CREATE UNIQUE INDEX IF NOT EXISTS "BiFollowup_question_id_item_key_key" ON "BiFollowup"("question_id", "item_key");
CREATE INDEX IF NOT EXISTS "BiFollowup_owner_id_status_idx" ON "BiFollowup"("owner_id", "status");
CREATE INDEX IF NOT EXISTS "BiFollowup_status_idx"          ON "BiFollowup"("status");
CREATE INDEX IF NOT EXISTS "BiFollowup_party_id_status_idx" ON "BiFollowup"("party_id", "status");

CREATE TABLE IF NOT EXISTS "BiFollowupNote" (
  "id"           SERIAL        PRIMARY KEY,
  "followup_id"  INTEGER       NOT NULL REFERENCES "BiFollowup"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "user_id"      VARCHAR(50),
  "result"       VARCHAR(20),
  "remarks"      VARCHAR(1000),
  "created_at"   TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "BiFollowupNote_followup_id_idx" ON "BiFollowupNote"("followup_id");

-- ── Permission ───────────────────────────────────────────────────────────
-- Right to build questions / dashboards and assign them. ADMIN and ACCOUNTANT
-- pass every check anyway; grant it to selected people in Admin → Permissions.
INSERT INTO "Permission" ("code", "module", "label", "sort")
SELECT 'bi.design', 'Administration', 'BI Designer — build questions and dashboards, assign them', 900
WHERE NOT EXISTS (SELECT 1 FROM "Permission" WHERE "code" = 'bi.design');
