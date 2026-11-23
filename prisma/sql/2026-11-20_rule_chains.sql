-- ============================================================
-- Approval chains on ANY approval rule (owner, 20 Nov 2026): a rule on any
-- form (Payment, Receipt, JV, GRN, Dispatch, invoices, Purchase / Sale /
-- Service Orders … every form in lib/approvals/rules.js approvableForms)
-- may have STEPS — the held entry goes from step to step and is posted only
-- when the last step approves. Set on Admin → Permissions → Approvals →
-- Approval rules ("Approve in steps"). Engine: lib/approvals/docChains.js.
--
--   ApprovalRule.steps     [{ id, label, users, roles, manager, pickNext }]
--                          empty = the old single approval (approver_users / roles)
--   ApprovalRule.watchers  user ids told at every step
--   ApprovalRequest.chain  the rule's steps copied when the entry is held,
--                          so editing a rule changes NEW entries only
--
-- Additive and re-runnable.
-- ============================================================
ALTER TABLE "ApprovalRule"    ADD COLUMN IF NOT EXISTS steps    JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "ApprovalRule"    ADD COLUMN IF NOT EXISTS watchers JSONB NOT NULL DEFAULT '[]'::jsonb;
ALTER TABLE "ApprovalRequest" ADD COLUMN IF NOT EXISTS chain    JSONB;
