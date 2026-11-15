// ============================================
// NOTIFICATION TEXT TEMPLATES
// ============================================
// Admins can replace the wording of any event (Admin → Notifications). A
// template is plain text with {placeholders}:
//   {actor}    who did it (name)
//   {title}    the title the code would have sent
//   {message}  the message the code would have sent
//   …plus the named values an event passes to emit() as `vars` (listed per
//   event in catalog.js → vars).
// Unknown placeholders render as nothing, a blank template means "use the
// code's own wording". Pure — shared by emit.js and the admin screen preview.

export const TEMPLATE_LIMITS = { title: 200, message: 500 };

/** Placeholders every event offers, whatever its own vars are. */
export const COMMON_TEMPLATE_VARS = [
  { name: "actor", description: "Who did it" },
  { name: "title", description: "Default title from the system" },
  { name: "message", description: "Default message from the system" },
];

const PLACEHOLDER = /\{\s*([A-Za-z_][A-Za-z0-9_]*)\s*\}/g;

export const isBlankTemplate = (tpl) => tpl == null || String(tpl).trim() === "";

/** Cut to the column size so a long template can never fail the insert. */
export function clip(text, max) {
  const s = text == null ? "" : String(text);
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/**
 * Fill `tpl` from `vars`. Returns null when the template is blank or renders
 * to nothing, so the caller falls back to the default text.
 */
export function renderTemplate(tpl, vars = {}, max = TEMPLATE_LIMITS.message) {
  if (isBlankTemplate(tpl)) return null;
  const out = String(tpl)
    .replace(PLACEHOLDER, (_, name) => {
      const v = vars?.[name];
      return v == null ? "" : String(v);
    })
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  return out ? clip(out, max) : null;
}

/** Placeholder names used in a template — the screen flags unknown ones. */
export function templateVarNames(tpl) {
  if (isBlankTemplate(tpl)) return [];
  return [...new Set([...String(tpl).matchAll(PLACEHOLDER)].map((m) => m[1]))];
}
