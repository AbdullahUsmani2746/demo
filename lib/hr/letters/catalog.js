// lib/hr/letters/catalog.js — HR letters: the kinds, what each asks for and
// its standard text. Client-safe (no Prisma): the Issue-letter form, the
// Letter-texts editor and the server (lib/hr/letters/service.js) all read it.
//
// A letter's text is a template with {placeholders}. The standard texts below
// are the defaults; HR changes the wording on the employee's Documents →
// Letters → "Letter texts" (Settings key hr.letter_templates, right
// hr.letters.templates). A letter is rendered ONCE, when it is issued, and its
// text is stored with it — so editing a template never changes a letter that
// was already given (lib/hr/letters/service.js, table hr_letters).

export const LETTER_TEMPLATES_KEY = "hr.letter_templates";

// Filled from the employee (lib/hr/letters/service.js employeeLetterVars).
export const EMPLOYEE_PLACEHOLDERS = [
  { key: "employee_name", label: "Employee's full name" },
  { key: "employee_no", label: "Employee no." },
  { key: "father_name", label: "Father's name" },
  { key: "cnic", label: "CNIC" },
  { key: "address", label: "Residential address" },
  { key: "designation", label: "Designation" },
  { key: "department", label: "Department" },
  { key: "work_location", label: "Work location" },
  { key: "joining_date", label: "Date of joining" },
  { key: "manager_name", label: "Reports to" },
  { key: "salary", label: "Current gross monthly salary" },
  { key: "salary_words", label: "Salary in words" },
  { key: "company", label: "Company name" },
  { key: "date", label: "Date of the letter" },
  { key: "ref", label: "Letter reference no." },
];

// What each kind asks for when it is issued (besides the letter date).
// type: date | number | text | textarea | choice
export const LETTER_KINDS = {
  APPOINTMENT: {
    label: "Appointment letter",
    fields: [
      { key: "joining_date", label: "Date of joining", type: "date", fromEmployee: "joining_date", required: true },
      { key: "probation_months", label: "Probation (months)", type: "number", default: 3, required: true },
      { key: "salary", label: "Gross monthly salary", type: "number", fromEmployee: "salary_amount", required: true },
      { key: "working_hours", label: "Working hours", type: "text", default: "9:00 AM to 5:00 PM, Monday to Saturday" },
    ],
  },
  PROBATION: {
    label: "Probation letter",
    fields: [
      { key: "from_date", label: "Probation from", type: "date", fromEmployee: "joining_date", required: true },
      { key: "probation_months", label: "Probation (months)", type: "number", default: 3, required: true },
      { key: "review_date", label: "Review date", type: "date", required: true },
      { key: "remarks", label: "Points to improve / remarks", type: "textarea" },
    ],
  },
  CONFIRMATION: {
    label: "Confirmation letter",
    fields: [
      { key: "confirmation_date", label: "Confirmed from", type: "date", required: true },
      { key: "salary", label: "Gross monthly salary from that date", type: "number", fromEmployee: "salary_amount", required: true },
    ],
  },
  WARNING: {
    label: "Warning letter",
    fields: [
      { key: "warning_level", label: "Warning", type: "choice", options: ["First warning", "Second warning", "Final warning"], default: "First warning", required: true },
      { key: "incident_date", label: "Date of the incident", type: "date", required: true },
      { key: "reason", label: "Subject (e.g. late arrivals, absence without leave)", type: "text", required: true },
      { key: "details", label: "What happened", type: "textarea", required: true },
    ],
  },
  TERMINATION: {
    label: "Termination letter",
    fields: [
      { key: "termination_date", label: "Last working day", type: "date", required: true },
      { key: "notice_days", label: "Notice given (days)", type: "number", default: 30 },
      { key: "reason", label: "Reason", type: "textarea", required: true },
    ],
  },
};

export const LETTER_KIND_KEYS = Object.keys(LETTER_KINDS);

// ── Standard texts (the defaults until HR edits them) ───────────────────────
export const DEFAULT_LETTER_TEMPLATES = {
  APPOINTMENT: {
    subject: "LETTER OF APPOINTMENT",
    body: `Dear {employee_name},

We are pleased to offer you appointment as {designation} in the {department} department of {company}, on the following terms and conditions:

1. Date of joining: {joining_date}.
2. Place of posting: {work_location}. You will report to {manager_name}.
3. Probation: you will be on probation for {probation_months} months from the date of joining. During probation either side may end the employment by giving seven days' notice. On satisfactory completion of probation your confirmation will be issued in writing.
4. Salary: your gross monthly salary will be Rs. {salary} ({salary_words}), subject to deductions as per law and company policy.
5. Working hours: {working_hours}, or as required by the company from time to time.
6. Leave, benefits and other conditions of service will be as per company policy, as amended from time to time.
7. After confirmation, either side may end the employment by giving one month's notice or one month's salary in lieu of notice.
8. You will keep all company information confidential, during and after your employment.

Please sign the duplicate copy of this letter as your acceptance of these terms.

We welcome you to {company} and wish you a successful career with us.`,
  },
  PROBATION: {
    subject: "PROBATION PERIOD",
    body: `Dear {employee_name},

This is to inform you that you are on probation as {designation} in the {department} department for {probation_months} months from {from_date}.

During this period your performance, conduct, punctuality and attendance will be reviewed. Your review is due on {review_date}, after which the management will decide on your confirmation or an extension of the probation period.

{remarks}

We wish you success in your role.`,
  },
  CONFIRMATION: {
    subject: "CONFIRMATION OF SERVICES",
    body: `Dear {employee_name},

We are pleased to inform you that, on satisfactory completion of your probation period, your services as {designation} in the {department} department are hereby confirmed with effect from {confirmation_date}.

Your gross monthly salary from that date will be Rs. {salary} ({salary_words}). All other terms and conditions of your employment remain unchanged.

We appreciate your contribution and look forward to your continued commitment to {company}.`,
  },
  WARNING: {
    subject: "{warning_level} — {reason}",
    body: `Dear {employee_name},

It has been brought to the management's notice that on {incident_date}:

{details}

This conduct is against the rules and policies of {company} and is not acceptable. This letter is issued to you as a {warning_level}.

You are advised to improve your conduct immediately. Any repetition may result in stricter disciplinary action, which may include termination of your services.

A copy of this letter is being placed in your personal file.`,
  },
  TERMINATION: {
    subject: "TERMINATION OF SERVICES",
    body: `Dear {employee_name},

This is to inform you that your services as {designation} in the {department} department of {company} are terminated, and your last working day will be {termination_date}.

Reason: {reason}

You are required to hand over all company property, documents and work in your possession, and to complete your clearance with the HR department. Your final settlement of dues will be processed after the clearance, as per company policy.

We wish you well for the future.`,
  },
};

/** {placeholder} → value; unknown or empty placeholders become "". */
export function renderTemplate(text, vars) {
  return String(text ?? "")
    .replace(/\{([a-z_]+)\}/g, (_, k) => (vars?.[k] == null ? "" : String(vars[k])))
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Stored templates over the defaults: { KIND: { subject, body } } — every kind present. */
export function mergeTemplates(stored) {
  const out = {};
  for (const k of LETTER_KIND_KEYS) {
    const s = stored?.[k] || {};
    out[k] = {
      subject: typeof s.subject === "string" && s.subject.trim() ? s.subject : DEFAULT_LETTER_TEMPLATES[k].subject,
      body: typeof s.body === "string" && s.body.trim() ? s.body : DEFAULT_LETTER_TEMPLATES[k].body,
    };
  }
  return out;
}

/** Templates as typed on the editor → clean { KIND: { subject, body } }. */
export function cleanTemplates(input) {
  const bad = (m) => Object.assign(new Error(m), { status: 400 });
  if (!input || typeof input !== "object") throw bad("Send the letter texts.");
  const out = {};
  for (const k of LETTER_KIND_KEYS) {
    const t = input[k];
    if (!t) continue;
    const subject = String(t.subject ?? "").trim().slice(0, 200);
    const body = String(t.body ?? "").replace(/\r\n/g, "\n").trim().slice(0, 12000);
    if (!subject) throw bad(`${LETTER_KINDS[k].label}: write its subject.`);
    if (!body) throw bad(`${LETTER_KINDS[k].label}: write its text.`);
    out[k] = { subject, body };
  }
  return out;
}
