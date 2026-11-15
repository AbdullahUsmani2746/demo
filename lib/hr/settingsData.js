// lib/hr/settingsData.js — HR rules that are lists rather than numbers, kept
// as JSON in the Settings table (the number rules: lib/hr/access.js HR_SETTINGS).
//
//   hr.bank_file_formats         salary transfer file layouts per bank (lib/hr/payroll/bankFile.js)
//   hr.leaving.clearance_items   the clearance checklist of the leaving process
//
// Seeded by prisma/sql/2026-11-21_hr_payroll_additions.sql; a missing or
// unreadable value falls back to the defaults below. Saves are audited
// through lib/prisma.js like any other write.
import prisma from "@/lib/prisma";
import { cleanBankFormats, DEFAULT_BANK_FORMATS } from "@/lib/hr/payroll/bankFile";

export const BANK_FORMATS_KEY = "hr.bank_file_formats";
export const CLEARANCE_KEY = "hr.leaving.clearance_items";

export const DEFAULT_CLEARANCE = [
  { key: "handover", label: "Work handed over" },
  { key: "assets", label: "Company assets returned (laptop, phone, ID card)" },
  { key: "finance", label: "Finance — no dues" },
  { key: "department", label: "Department head clearance" },
  { key: "hr", label: "HR exit interview" },
];

const bad = (message) => Object.assign(new Error(message), { status: 400 });

async function readJson(key) {
  const row = await prisma.settings.findUnique({ where: { key }, select: { value: true } });
  if (!row?.value) return null;
  try {
    return JSON.parse(row.value);
  } catch {
    return null;
  }
}

async function writeJson(key, value, description) {
  await prisma.settings.upsert({
    where: { key },
    update: { value: JSON.stringify(value), last_updated: new Date() },
    create: { key, value: JSON.stringify(value), description },
  });
}

export async function getBankFormats() {
  const v = await readJson(BANK_FORMATS_KEY);
  try {
    return v ? cleanBankFormats(v) : DEFAULT_BANK_FORMATS;
  } catch {
    return DEFAULT_BANK_FORMATS;
  }
}

export async function saveBankFormats(input) {
  const clean = cleanBankFormats(input);
  await writeJson(BANK_FORMATS_KEY, clean, "HR: bank transfer file layouts (HR → Payroll → Bank files)");
  return clean;
}

/** Checklist items → [{ key, label }] (keys stable so ticked items survive a rename). */
export function cleanClearance(list) {
  if (!Array.isArray(list)) throw bad("The checklist must be a list.");
  if (list.length > 40) throw bad("At most 40 checklist items.");
  const keys = new Set();
  return list.map((x, i) => {
    const label = String(x?.label ?? "").trim().slice(0, 120);
    if (!label) throw bad(`Item ${i + 1}: describe it.`);
    let key = String(x?.key ?? "").trim().toLowerCase().replace(/[^a-z0-9_]/g, "").slice(0, 30);
    if (!key) key = label.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "").slice(0, 30) || `item${i + 1}`;
    while (keys.has(key)) key = `${key.slice(0, 27)}_${i + 1}`;
    keys.add(key);
    return { key, label };
  });
}

export async function getClearanceItems() {
  const v = await readJson(CLEARANCE_KEY);
  try {
    return v ? cleanClearance(v) : DEFAULT_CLEARANCE;
  } catch {
    return DEFAULT_CLEARANCE;
  }
}

export async function saveClearanceItems(list) {
  const clean = cleanClearance(list);
  await writeJson(CLEARANCE_KEY, clean, "HR: clearance checklist of the leaving process");
  return clean;
}
