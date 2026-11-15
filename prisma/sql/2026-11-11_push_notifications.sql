-- =====================================================================
-- Phone notifications (Web Push) — the devices that receive them.
-- One row per phone / browser a user turned "Phone notifications" on
-- (Notifications page, or the bell). lib/notifications/push.js sends every
-- notification the bell gets to that user's devices as well; who gets which
-- notification is unchanged (Admin → Notifications).
-- Signing out on a device removes its row; rows the push service reports
-- gone are deleted on the next send.
--
-- Also needs the VAPID keys in the server environment (see CLAUDE.md):
--   VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY, VAPID_SUBJECT (mailto:… or https://…)
--
-- Re-runnable. Apply (after the owner approves this run):
--   npx prisma db execute --file prisma/sql/2026-11-11_push_notifications.sql --schema prisma/schema.prisma
-- then: npx prisma generate
-- =====================================================================

BEGIN;

CREATE TABLE IF NOT EXISTS "push_subscriptions" (
  "id"           SERIAL PRIMARY KEY,
  "user_id"      TEXT NOT NULL,
  "endpoint"     TEXT NOT NULL,
  "p256dh"       VARCHAR(200) NOT NULL,
  "auth"         VARCHAR(100) NOT NULL,
  "device"       VARCHAR(200),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_sent_at" TIMESTAMP(3),
  "failures"     INTEGER NOT NULL DEFAULT 0
);

CREATE UNIQUE INDEX IF NOT EXISTS "push_subscriptions_endpoint_key" ON "push_subscriptions" ("endpoint");
CREATE INDEX IF NOT EXISTS "push_subscriptions_user_id_idx" ON "push_subscriptions" ("user_id");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'push_subscriptions_user_id_fkey') THEN
    ALTER TABLE "push_subscriptions"
      ADD CONSTRAINT "push_subscriptions_user_id_fkey"
      FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

COMMIT;
