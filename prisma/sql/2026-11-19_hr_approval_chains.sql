-- ============================================================
-- HR approval chains (lib/hr/chains.js) — leave, salary advance and loan
-- requests go through steps set on Admin → Permissions → Approvals →
-- "HR approval chains", not through code.
--
-- hr_approval_chains   one chain = which requests (type, advance / loan,
--                      work locations, departments; empty = all) and its
--                      steps, in order:
--   steps  [{ id, label, type: "approve" | "pay", final, users: [user ids],
--             roles: [role codes], manager: bool, pickNext: bool }]
--     approve  the step's people approve (or reject) and it moves on;
--              the "final" step makes it count (leave booked, loan active)
--     pay      done when the advance / loan is paid out (payment voucher)
--     manager  the employee's reporting manager (HR → Team structure)
--     pickNext the person at this step chooses who takes the next step
--   watchers   user ids told at every step (and who see it in Approvals)
--
-- ApprovalRequest gets the request's place in its chain:
--   chain_id, chain_step (0-based), step_users (who acts now),
--   chain_log (what each step did), watchers, chain_actors (who acted).
--
-- Additive and re-runnable. No chains are seeded: each company sets its own
-- on Admin → Permissions → Approvals (with none, the old single approval).
-- ============================================================
BEGIN;

CREATE TABLE IF NOT EXISTS hr_approval_chains (
  id                SERIAL        PRIMARY KEY,
  name              VARCHAR(150)  NOT NULL,
  doc_type          VARCHAR(30)   NOT NULL,          -- hrLeave | hrLoan
  loan_kind         VARCHAR(20),                     -- hrLoan: ADVANCE | LOAN | NULL = both
  work_location_ids INTEGER[]     NOT NULL DEFAULT '{}',
  department_ids    INTEGER[]     NOT NULL DEFAULT '{}',
  steps             JSONB         NOT NULL DEFAULT '[]',
  watchers          JSONB         NOT NULL DEFAULT '[]',
  is_active         BOOLEAN       NOT NULL DEFAULT true,
  sort              INTEGER       NOT NULL DEFAULT 0,
  created_by        VARCHAR(50),
  created_at        TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        TIMESTAMP(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS hr_approval_chains_doc_type_idx ON hr_approval_chains (doc_type, is_active);

ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS chain_id     INTEGER;
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS chain_step   INTEGER;
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS step_users   TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS watchers     TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS chain_actors TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS chain_log    JSONB  NOT NULL DEFAULT '[]';
CREATE INDEX IF NOT EXISTS "ApprovalRequest_step_users_idx"   ON "ApprovalRequest" USING GIN (step_users);
CREATE INDEX IF NOT EXISTS "ApprovalRequest_watchers_idx"     ON "ApprovalRequest" USING GIN (watchers);
CREATE INDEX IF NOT EXISTS "ApprovalRequest_chain_actors_idx" ON "ApprovalRequest" USING GIN (chain_actors);

COMMIT;
