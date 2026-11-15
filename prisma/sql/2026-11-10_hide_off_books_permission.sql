-- =====================================================================
-- "Hide off books" switch (the header button — lib/accounts/books.js).
-- Only holders of offBooks.hide see the button; ADMIN / ACCOUNTANT have it
-- already. Give it to others on Admin → Permissions.
-- The switch itself is a Settings row (key "hideOffBooks"), written by the
-- button — nothing to create here. Adds one permission row. Safe to re-run.
-- =====================================================================
INSERT INTO "Permission" (code, module, label, sort) VALUES
  ('offBooks.hide', 'Administration', 'Hide all OFF books from the whole system (the header switch) — for everyone, until shown again', 165)
ON CONFLICT (code) DO NOTHING;
