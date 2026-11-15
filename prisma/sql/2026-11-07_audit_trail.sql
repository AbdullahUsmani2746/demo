-- =====================================================================
-- Full audit trail + notification alerts (no code per new notification)
-- Adds only: 4 columns + 2 indexes on "AuditLog", 1 table, 1 permission.
-- Drops nothing, changes no existing value; safe to re-run.
--
--   "AuditLog".doc_model / doc_id   the document a row belongs to (a voucher
--                                   line → its voucher) — lib/audit/catalog.js
--   "AuditLog".batch_id             one save = one batch
--   "AuditLog".source               user | system (cron jobs, scripts)
--   notification_alerts             "when <table> changes and <conditions>,
--                                   tell <people> <text>" — Admin →
--                                   Notifications → Alerts (lib/notifications/alerts.js)
--   audit.view                      open the Audit Trail (ADMIN / ACCOUNTANT
--                                   have it already; give it by role / person)
-- Old AuditLog rows keep NULL in the new columns; the Audit Trail screen
-- falls back to model_name / record_id for them.
-- =====================================================================
BEGIN;

ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS doc_model VARCHAR(100);
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS doc_id    VARCHAR(150);
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS batch_id  VARCHAR(40);
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS source    VARCHAR(10);
CREATE INDEX IF NOT EXISTS "AuditLog_doc_model_doc_id_idx" ON "AuditLog"(doc_model, doc_id);
CREATE INDEX IF NOT EXISTS "AuditLog_batch_id_idx" ON "AuditLog"(batch_id);

CREATE TABLE IF NOT EXISTS notification_alerts (
  id               SERIAL PRIMARY KEY,
  name             VARCHAR(150) NOT NULL,
  description      VARCHAR(500),
  is_active        BOOLEAN NOT NULL DEFAULT true,
  model_name       VARCHAR(100) NOT NULL,
  actions          TEXT[] DEFAULT ARRAY[]::TEXT[],
  conditions       JSONB NOT NULL DEFAULT '[]',
  match            VARCHAR(3) NOT NULL DEFAULT 'all',
  recipients       JSONB NOT NULL DEFAULT '{}',
  notify_actor     BOOLEAN NOT NULL DEFAULT false,
  type             VARCHAR(10) NOT NULL DEFAULT 'info',
  title_template   VARCHAR(200) NOT NULL,
  message_template VARCHAR(500) NOT NULL,
  created_by       VARCHAR(50),
  created_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_fired_at    TIMESTAMP(3),
  fire_count       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS notification_alerts_model_name_is_active_idx ON notification_alerts(model_name, is_active);

INSERT INTO "Permission" (code, module, label, sort) VALUES
  ('audit.view', 'Administration', 'Open the Audit Trail (who changed what, when — every table)', 160)
ON CONFLICT (code) DO NOTHING;

COMMIT;
