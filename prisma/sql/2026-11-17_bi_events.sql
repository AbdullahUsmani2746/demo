-- BI events — dated notes shown as flags on every dashboard trend chart
-- ("Price +6%", "Plant shutdown"). Added by people with bi.design in the
-- BI Designer → Events; read by every dashboard (app/api/bi/my/[id]).
-- Additive and re-runnable.
CREATE TABLE IF NOT EXISTS bi_events (
  id         SERIAL       PRIMARY KEY,
  dated      DATE         NOT NULL,
  label      VARCHAR(60)  NOT NULL,
  note       VARCHAR(300),
  created_by VARCHAR(50),
  created_at TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS bi_events_dated_idx ON bi_events (dated);
