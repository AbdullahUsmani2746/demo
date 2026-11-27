-- =====================================================================
-- HR letters (lib/hr/letters/*): appointment, probation, confirmation,
-- warning and termination letters issued from the employee's Documents,
-- printed on the letterhead, kept on record, signed copy uploaded.
-- Feature hr.letters (Settings → Features, default OFF) — ported from SMS.
--   · table hr_letters — one row per letter issued (its text as issued)
--   · Settings hr.letter_templates — the wording; empty = the standard texts
--     in lib/hr/letters/catalog.js (HR edits them on "Letter texts")
--   · rights hr.letters.issue (issue / print / upload signed copy) and
--     hr.letters.templates (change the wording)
--     — granted to the roles that manage employees' HR records today:
--       issue     ← hr.leave.manage (HR Manager, HR Officer …)
--       templates ← hr.salary.manage (HR Manager …)
-- Additive and re-runnable.
-- =====================================================================
BEGIN;

CREATE TABLE IF NOT EXISTS hr_letters (
  id          SERIAL PRIMARY KEY,
  employee_id INTEGER NOT NULL REFERENCES "Employee"(id) ON UPDATE CASCADE ON DELETE RESTRICT,
  kind        VARCHAR(20) NOT NULL,
  dated       DATE NOT NULL,
  ref_no      VARCHAR(40) NOT NULL,
  details     JSONB NOT NULL DEFAULT '{}',
  subject     VARCHAR(200) NOT NULL,
  body        TEXT NOT NULL,
  signed_url  TEXT,
  signed_at   TIMESTAMP(3),
  signed_by   VARCHAR(50),
  issued_by   VARCHAR(50) NOT NULL,
  created_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS hr_letters_employee_id_idx ON hr_letters (employee_id);
CREATE INDEX IF NOT EXISTS hr_letters_kind_idx ON hr_letters (kind);

INSERT INTO "Permission" (code, module, label, sort) VALUES
  ('hr.letters.issue',     'HR', 'Issue HR letters (appointment, probation, confirmation, warning, termination), print them and upload the signed copy', 186),
  ('hr.letters.templates', 'HR', 'Change the wording of the HR letters', 187)
ON CONFLICT (code) DO NOTHING;

INSERT INTO "PermissionGrant" ("permissionId", "role", "allow", "createdAt", "updatedAt")
SELECT DISTINCT np.id, g.role, true, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
  FROM (VALUES ('hr.letters.issue', 'hr.leave.manage'), ('hr.letters.templates', 'hr.salary.manage')) AS m(new_code, from_code)
  JOIN "Permission" fp ON fp.code = m.from_code
  JOIN "PermissionGrant" g ON g."permissionId" = fp.id AND g.allow AND g.role IS NOT NULL AND g."userId" IS NULL
  JOIN "Permission" np ON np.code = m.new_code
ON CONFLICT ("permissionId", "role") DO NOTHING;

COMMIT;
