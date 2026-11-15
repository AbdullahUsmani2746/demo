-- =====================================================================
-- Notification text templates (Admin → Notifications)
-- The admin can replace the title / message of any notification event with
-- their own wording, using {placeholders} ({actor}, {title}, {message} and
-- the event's own values — lib/notifications/template.js, catalog.js → vars).
-- NULL / blank = the code's default text, so existing events are unchanged.
-- Safe to run more than once. Until it is run, notifications keep their
-- default texts and the admin screen shows a "run the SQL" note.
-- =====================================================================
BEGIN;

ALTER TABLE "NotificationEvent" ADD COLUMN IF NOT EXISTS "title_template"   VARCHAR(200);
ALTER TABLE "NotificationEvent" ADD COLUMN IF NOT EXISTS "message_template" VARCHAR(500);

COMMIT;
