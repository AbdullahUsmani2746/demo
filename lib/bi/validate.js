// lib/bi/validate.js — clean what the BI Designer sends before saving.
import { BiError } from "./engine";
import { datasetByKey } from "./datasets";
import { PERIODS } from "./visuals";
import { DATASETS } from "./datasets";
import { hasFullAccess } from "@/lib/auth/permissions";

/** Field keys a dashboard filter may use: any non-date field of any dataset. */
export const filterableFields = () => {
  const map = new Map();
  for (const d of DATASETS) for (const f of d.fields) if (f.type !== "date" && !map.has(f.key)) map.set(f.key, f.label);
  return [...map].map(([key, label]) => ({ key, label }));
};

export function cleanQuestion(body) {
  const name = String(body?.name ?? "").trim();
  if (!name) throw new BiError("Give the question a name.");
  const config = body?.config;
  if (!config || !datasetByKey(config.dataset)) throw new BiError("Choose a dataset.");
  if (!Array.isArray(config.measures) || config.measures.length === 0) throw new BiError("Add at least one measure.");
  delete config.__internalDims; // only the follow-up sync may set it
  return {
    name: name.slice(0, 150),
    description: body.description ? String(body.description).slice(0, 500) : null,
    dataset: config.dataset,
    config,
  };
}

/**
 * A follow-up scenario (config.followup, lib/bi/followups.js) is synced as a
 * full-access reader and its rows are sent to its assignees / escalation
 * people — so only a full-access designer may turn one on, set escalation
 * people, or change a question that already is one. Throws 403 otherwise.
 */
const isScenario = (config) => {
  const f = config?.followup;
  if (!f) return false;
  const escalationUsers = (Array.isArray(f.escalation) ? f.escalation : []).some(
    (s) => Array.isArray(s?.users) && s.users.length > 0,
  );
  return Boolean(f.enabled) || escalationUsers;
};
export function assertFollowupAllowed(session, config, storedConfig = null) {
  if (hasFullAccess(session)) return;
  if (isScenario(config) || isScenario(storedConfig)) {
    throw new BiError(
      "Only an ADMIN or ACCOUNTANT can save a follow-up scenario (follow-up enabled or escalation people) — ask one of them, or switch Follow-up off on a new question.",
      403,
    );
  }
}

/** How a section's widgets show (components/bi/DashboardCanvas.jsx); none = the grid. */
const SECTION_KINDS = ["hero", "compact", "attention"];

/** layout = { sections: [{ id, title, kind?, items: [{ id, questionId, width 1-4 }] }] } */
export function cleanDashboard(body) {
  const name = String(body?.name ?? "").trim();
  if (!name) throw new BiError("Give the dashboard a name.");
  const sections = (Array.isArray(body?.layout?.sections) ? body.layout.sections : []).map((s, i) => ({
    id: String(s.id || `s${i}`),
    title: String(s.title ?? "").slice(0, 120),
    ...(SECTION_KINDS.includes(s.kind) ? { kind: s.kind } : {}),
    items: (Array.isArray(s.items) ? s.items : [])
      .filter((it) => Number.isFinite(Number(it.questionId)))
      .map((it, j) => ({
        id: String(it.id || `i${i}_${j}`),
        questionId: Number(it.questionId),
        width: Math.min(Math.max(Number(it.width) || 1, 1), 4),
      })),
  }));
  const allowedFilters = new Set(filterableFields().map((f) => f.key));
  const filters = (Array.isArray(body?.layout?.filters) ? body.layout.filters : [])
    .filter((f) => allowedFilters.has(f?.field))
    .slice(0, 6)
    .map((f) => ({ field: f.field, label: String(f.label || f.field).slice(0, 60) }));
  const period = PERIODS.some((p) => p.key === body?.default_period) ? body.default_period : "mtd";
  return {
    name: name.slice(0, 150),
    description: body.description ? String(body.description).slice(0, 500) : null,
    layout: { sections, filters },
    default_period: period,
    is_active: body?.is_active !== false,
  };
}
