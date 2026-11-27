// lib/hr/letters/service.js — issuing HR letters (server side).
//
//   employeeLetterVars(employeeId, dated) → the {placeholders} from the employee
//   letterTemplates() / saveLetterTemplates(input) → the wording (Settings
//       hr.letter_templates over the standard texts, lib/hr/letters/catalog.js)
//   previewLetter({ employeeId, kind, dated, details }) → { subject, body, vars }
//   issueLetter({ … , subject?, body?, session }) → the stored letter
//
// A letter is rendered once, when issued, and stored with its text (hr_letters),
// so changing a template never changes a letter already given. HR may adjust
// the rendered text before issuing it. Rights and scope are checked by the
// routes (app/api/hr/letters/*): hr.letters.issue / hr.letters.templates, and
// the employee must be in the person's HR scope.
import prisma from "@/lib/prisma";
import { getCompany } from "@/lib/company";
import { employeeName } from "@/lib/hr/access";
import { salaryOn, totalsOf } from "@/lib/hr/salary/service";
import { dayKeyOfDb, todayKey } from "@/lib/hr/time";
import { amountInWords } from "@/components/HR/printDoc";
import {
  LETTER_KINDS,
  LETTER_TEMPLATES_KEY,
  cleanTemplates,
  mergeTemplates,
  renderTemplate,
} from "@/lib/hr/letters/catalog";

export class LetterError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

const isDay = (v) => /^\d{4}-\d{2}-\d{2}$/.test(String(v || ""));
const fmtDay = (key) => {
  if (!isDay(key)) return key || "";
  const [y, m, d] = key.split("-").map(Number);
  return new Date(y, m - 1, d).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" });
};
const money = (n) => (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-PK", { maximumFractionDigits: 2 });

// ── Wording ─────────────────────────────────────────────────────────────────
export async function letterTemplates() {
  const row = await prisma.settings.findUnique({ where: { key: LETTER_TEMPLATES_KEY }, select: { value: true } });
  let stored = null;
  try {
    stored = row?.value ? JSON.parse(row.value) : null;
  } catch {
    stored = null;
  }
  return mergeTemplates(stored);
}

export async function saveLetterTemplates(input) {
  const clean = cleanTemplates(input);
  const merged = mergeTemplates({ ...(await letterTemplates()), ...clean });
  await prisma.settings.upsert({
    where: { key: LETTER_TEMPLATES_KEY },
    update: { value: JSON.stringify(merged), last_updated: new Date() },
    create: { key: LETTER_TEMPLATES_KEY, value: JSON.stringify(merged), description: "HR: wording of the HR letters (employee Documents → Letters → Letter texts)" },
  });
  return merged;
}

// ── The employee's side of the placeholders ─────────────────────────────────
export async function employeeLetterVars(employeeId, dated = todayKey()) {
  const e = await prisma.employee.findUnique({
    where: { id: Number(employeeId) },
    include: {
      Designation: { select: { desg_name: true } },
      department: { select: { dept_name: true } },
      workLocation: { select: { location_name: true } },
      manager: { select: { manager: true } },
    },
  });
  if (!e) throw new LetterError("Employee not found.", 404);
  const [salaries, company] = await Promise.all([salaryOn([e.id], dated), getCompany()]);
  const gross = totalsOf(salaries.get(e.id))?.gross ?? null;
  return {
    employee: e,
    vars: {
      employee_name: employeeName(e),
      employee_no: String(e.id),
      father_name: e.fatherName || "",
      cnic: e.cnicNumber || "",
      address: e.residentialAddress || "",
      designation: e.Designation?.desg_name || "",
      department: e.department?.dept_name || "",
      work_location: e.workLocation?.location_name || "",
      joining_date: fmtDay(dayKeyOfDb(e.hireDate)),
      manager_name: e.manager?.manager || "the head of your department",
      salary: gross != null ? money(gross) : "",
      salary_words: gross != null ? amountInWords(gross) : "",
      company: company?.name || "the company",
      date: fmtDay(dated),
    },
    // raw values the Issue-letter form starts from (fields with fromEmployee)
    defaults: { joining_date: dayKeyOfDb(e.hireDate), salary_amount: gross },
  };
}

/** The form's details → checked values + their {placeholders} (dates written out, money formatted). */
function detailsVars(kind, details) {
  const def = LETTER_KINDS[kind];
  if (!def) throw new LetterError("Unknown letter.");
  const clean = {};
  const vars = {};
  for (const f of def.fields) {
    let v = details?.[f.key];
    if (v === undefined || v === null || String(v).trim() === "") {
      if (f.required) throw new LetterError(`${def.label}: fill in “${f.label}”.`);
      clean[f.key] = null;
      vars[f.key] = "";
      continue;
    }
    if (f.type === "date") {
      if (!isDay(v)) throw new LetterError(`${def.label}: “${f.label}” is not a date.`);
      clean[f.key] = v;
      vars[f.key] = fmtDay(v);
    } else if (f.type === "number") {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0) throw new LetterError(`${def.label}: “${f.label}” must be a number.`);
      clean[f.key] = n;
      vars[f.key] = f.key === "salary" ? money(n) : String(n);
      if (f.key === "salary") vars.salary_words = amountInWords(n);
    } else if (f.type === "choice") {
      if (!f.options.includes(String(v))) throw new LetterError(`${def.label}: pick “${f.label}”.`);
      clean[f.key] = String(v);
      vars[f.key] = String(v);
    } else {
      clean[f.key] = String(v).trim().slice(0, f.type === "textarea" ? 4000 : 300);
      vars[f.key] = clean[f.key];
    }
  }
  return { clean, vars };
}

/** Next reference no. of a kind: <PREFIX>/<year>/<n> (APT, PRB, CNF, WRN, TRM). */
const PREFIX = { APPOINTMENT: "APT", PROBATION: "PRB", CONFIRMATION: "CNF", WARNING: "WRN", TERMINATION: "TRM" };
async function nextRef(db, kind, dated) {
  const year = dated.slice(0, 4);
  const n = await db.hrLetter.count({ where: { kind, ref_no: { startsWith: `${PREFIX[kind]}/${year}/` } } });
  return `${PREFIX[kind]}/${year}/${String(n + 1).padStart(3, "0")}`;
}

/** The letter as it would be issued (nothing saved). */
export async function previewLetter({ employeeId, kind, dated, details }) {
  if (!LETTER_KINDS[kind]) throw new LetterError("Unknown letter.");
  const day = isDay(dated) ? dated : todayKey();
  const [{ vars: emp }, templates] = await Promise.all([employeeLetterVars(employeeId, day), letterTemplates()]);
  const { clean, vars: det } = detailsVars(kind, details);
  const vars = { ...emp, ...det, ref: "(given when issued)" };
  const t = templates[kind];
  return { kind, dated: day, details: clean, subject: renderTemplate(t.subject, vars), body: renderTemplate(t.body, vars), vars };
}

/** Issue (store) a letter. `subject` / `body`, when sent, are HR's edited text. */
export async function issueLetter({ employeeId, kind, dated, details, subject, body, session }) {
  const p = await previewLetter({ employeeId, kind, dated, details });
  const finalSubject = String(subject ?? p.subject).trim().slice(0, 200);
  const finalBody = String(body ?? p.body).replace(/\r\n/g, "\n").trim().slice(0, 20000);
  if (!finalSubject || !finalBody) throw new LetterError("The letter has no text.");
  return prisma.$transaction(async (tx) => {
    const ref = await nextRef(tx, kind, p.dated);
    return tx.hrLetter.create({
      data: {
        employee_id: Number(employeeId),
        kind,
        dated: new Date(`${p.dated}T00:00:00.000Z`),
        ref_no: ref,
        details: p.details,
        subject: finalSubject.replace("(given when issued)", ref),
        body: finalBody.replace("(given when issued)", ref),
        issued_by: session.user.id,
      },
    });
  });
}

/** A stored letter in the shape the screens use. */
export function letterRow(l, nameOf = new Map()) {
  return {
    id: l.id,
    employee_id: l.employee_id,
    kind: l.kind,
    kind_label: LETTER_KINDS[l.kind]?.label ?? l.kind,
    dated: dayKeyOfDb(l.dated),
    ref_no: l.ref_no,
    details: l.details,
    subject: l.subject,
    body: l.body,
    signed_url: l.signed_url,
    signed_at: l.signed_at,
    issued_by: nameOf.get(l.issued_by) ?? l.issued_by,
    created_at: l.created_at,
  };
}
