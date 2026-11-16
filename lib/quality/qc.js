// lib/quality/qc.js — Quality Control rules shared by the QC screens and routes.
// Client-safe (no Prisma).
//
//   QC_STATUS          the five QualityMaster statuses with the words the screens use
//                      (DRAFT = Pending, HOLD = On hold, REWORK = Re-test,
//                      APPROVED = Passed, REJECTED = Failed)
//   nextStatuses       which decisions a production QC may take from its status
//   checkResult        a realized value against its standard → "pass" | "fail" | null
//   sheetVerdict       the rows of one attempt → { filled, total, failed, verdict }
//
// A standard is free text on Item → Quality parameters. checkResult only gives a
// verdict for standards it can read without guessing: a range ("50-60",
// "50 to 60"), a limit (">= 30", "≤ 5", "min 30", "max 5"), a tolerance
// ("30 ± 2", "30 +/- 2") or a word compared word for word ("Smooth" = "smooth").
// Anything else (a single target number, a sentence) gets no verdict — the
// checker decides, the screen does not colour it.

export const QC_STATUS = {
  DRAFT: { label: "Pending", tone: "muted", hint: "Results not decided yet" },
  HOLD: { label: "On hold", tone: "warn", hint: "Waiting — reason recorded" },
  REWORK: { label: "Re-test", tone: "warn", hint: "Sent back for rework; the next attempt is tested" },
  APPROVED: { label: "Passed", tone: "ok", hint: "Approved — batch number given" },
  REJECTED: { label: "Failed", tone: "bad", hint: "Rejected — reason recorded" },
};

export const QC_STATUS_ORDER = ["DRAFT", "HOLD", "REWORK", "APPROVED", "REJECTED"];

/** Decisions that need a reason. */
export const NEEDS_REASON = new Set(["REJECTED", "HOLD", "REWORK"]);

/**
 * Production QC: the decisions open from a status. Passed is final (a batch
 * number was given and the order may be posted); a failed batch may only be
 * sent for re-test.
 */
export function nextStatuses(status) {
  switch (status || "DRAFT") {
    case "APPROVED":
      return [];
    case "REJECTED":
      return ["REWORK"];
    default:
      return ["APPROVED", "HOLD", "REWORK", "REJECTED"].filter((s) => s !== status || s === "REWORK");
  }
}

/** Status label for a raw QualityMaster status (unknown → the raw text). */
export const statusLabel = (s) => QC_STATUS[s]?.label || s || "Pending";

const NUM = "(-?\\d+(?:\\.\\d+)?)";
const num = (s) => {
  const m = String(s ?? "").replace(/,/g, "").match(/-?\d+(?:\.\d+)?/);
  return m ? Number(m[0]) : null;
};
const clean = (s) => String(s ?? "").trim();

/**
 * Read a standard into a rule: { min, max, minExcl, maxExcl } or { text }, or null.
 * @param {string} standard
 */
export function parseStandard(standard) {
  const s = clean(standard).replace(/,/g, "");
  if (!s) return null;
  let m;
  // 30 ± 2 · 30 +/- 2 · 30 +- 2
  if ((m = s.match(new RegExp(`^${NUM}\\s*(?:±|\\+/-|\\+-)\\s*${NUM}`)))) {
    const c = Number(m[1]);
    const t = Math.abs(Number(m[2]));
    return { min: c - t, max: c + t };
  }
  // 50-60 · 50 – 60 · 50 to 60 · 50~60 (a leading minus sign stays a sign)
  if ((m = s.match(new RegExp(`^${NUM}\\s*(?:-|–|—|~|to)\\s*${NUM}`, "i")))) {
    const a = Number(m[1]);
    const b = Number(m[2]);
    return { min: Math.min(a, b), max: Math.max(a, b) };
  }
  // >= 30 · ≥ 30 · min 30 · minimum 30 · not less than 30
  if ((m = s.match(new RegExp(`^(?:>=|≥|=>|min(?:imum)?\\.?|not less than|nlt)\\s*:?\\s*${NUM}`, "i")))) return { min: Number(m[1]) };
  if ((m = s.match(new RegExp(`^>\\s*${NUM}`)))) return { min: Number(m[1]), minExcl: true };
  // <= 5 · ≤ 5 · max 5 · maximum 5 · not more than 5
  if ((m = s.match(new RegExp(`^(?:<=|≤|=<|max(?:imum)?\\.?|not more than|nmt)\\s*:?\\s*${NUM}`, "i")))) return { max: Number(m[1]) };
  if ((m = s.match(new RegExp(`^<\\s*${NUM}`)))) return { max: Number(m[1]), maxExcl: true };
  // 30 min · 5 max
  if ((m = s.match(new RegExp(`^${NUM}\\s*(?:min(?:imum)?|\\+|and above)\\b`, "i")))) return { min: Number(m[1]) };
  if ((m = s.match(new RegExp(`^${NUM}\\s*(?:max(?:imum)?|and below)\\b`, "i")))) return { max: Number(m[1]) };
  // A word (no digits): compared word for word.
  if (!/\d/.test(s) && s.split(/\s+/).length <= 3) return { text: s.toLowerCase() };
  return null;
}

/**
 * A realized value against its standard.
 * @returns {"pass"|"fail"|null} null = empty, or a standard the system cannot judge
 */
export function checkResult(standard, realized) {
  const r = clean(realized);
  if (!r) return null;
  const rule = parseStandard(standard);
  if (!rule) return null;
  if (rule.text) return r.toLowerCase() === rule.text ? "pass" : null;
  const v = num(r);
  if (v === null) return "fail";
  if (rule.min !== undefined && (rule.minExcl ? v <= rule.min : v < rule.min)) return "fail";
  if (rule.max !== undefined && (rule.maxExcl ? v >= rule.max : v > rule.max)) return "fail";
  return "pass";
}

/**
 * One attempt's rows → how far it is and whether anything is out of standard.
 * @param {{quality_standard:string, quality_realized:string}[]} rows
 */
export function sheetVerdict(rows = []) {
  const total = rows.length;
  let filled = 0;
  let failed = 0;
  let passed = 0;
  for (const r of rows) {
    if (clean(r.quality_realized)) filled++;
    const c = checkResult(r.quality_standard, r.quality_realized);
    if (c === "fail") failed++;
    if (c === "pass") passed++;
  }
  const verdict = failed ? "fail" : total && filled === total ? "pass" : "open";
  return { total, filled, failed, passed, verdict };
}

/** "YYYY-MM-DD" from a Date / string, or "". */
export const isoDay = (d) => {
  if (!d) return "";
  const x = d instanceof Date ? d : new Date(d);
  return Number.isNaN(x.getTime()) ? "" : x.toISOString().slice(0, 10);
};
