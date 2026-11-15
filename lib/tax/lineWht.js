// lib/tax/lineWht.js
// ============================================================
// Withholding tax per payment / receipt line — Settings → Features
// "tax.lineWht" (ported from Accounting, where the payment form built the
// deduction row in the browser; here the server builds it).
//
// A main line of a Payment (2) / Receipt (1) may name a Tax Law
// (Transactions.tax_law_code). On save, with the feature on:
//   rate    = the law's filer / non-filer rate by the line account's
//             ACNO.tax_filing_status (a status containing "non" = non-filer)
//   account = the law's payable account (TaxLaws.tax_acno, Setup → Tax Laws)
//   → line.wht_rate = rate, and one deduction line (sub_tran_id 2) per taxed
//     line: Payment = Cr payable (bank pays the net), Receipt = Dr the tax
//     account (bank receives the net). Those deductions carry the law's code
//     and are rebuilt on every save; hand-typed deductions are left alone.
// Off: no deduction is built; a new voucher saves no tax law; an edit keeps
// the lines' and deductions' tax laws as they were.
// ============================================================
import prisma from "@/lib/prisma";
import { feature } from "@/lib/features/server";

export const LINE_WHT_FEATURE = "tax.lineWht";
const WHT_TRAN_CODES = new Set([1, 2]);

const intOf = (v) => {
  const x = parseInt(v?.value ?? v, 10);
  return Number.isInteger(x) && x > 0 ? x : null;
};
const round2 = (x) => Math.round((Number(x) || 0) * 100) / 100;

/**
 * Adjusts `lines` / `deductions` in place. Returns an error message or null.
 * @param {{ tranCode: number, lines: object[], deductions: object[], isEdit?: boolean }} args
 */
export async function applyLineWht({ tranCode, lines, deductions, isEdit = false }) {
  if (!WHT_TRAN_CODES.has(Number(tranCode)) || !Array.isArray(lines)) return null;
  const dedList = Array.isArray(deductions) ? deductions : null;

  // Accept the form's field name too (taxlaw_code) — stored as tax_law_code.
  for (const l of lines) {
    if (l && "taxlaw_code" in l) {
      if (l.tax_law_code == null) l.tax_law_code = l.taxlaw_code;
      delete l.taxlaw_code;
    }
    if (l && "tax_law_code" in l) l.tax_law_code = intOf(l.tax_law_code);
  }
  for (const d of dedList || []) if (d && "tax_law_code" in d) d.tax_law_code = intOf(d.tax_law_code);

  if (!(await feature(LINE_WHT_FEATURE))) {
    if (!isEdit) {
      for (const l of lines) if (l) delete l.tax_law_code;
      for (const d of dedList || []) if (d) delete d.tax_law_code;
    }
    return null;
  }

  const taxed = lines.filter((l) => l?.tax_law_code);
  // Auto deductions are rebuilt from the lines below.
  if (dedList) {
    const manual = dedList.filter((d) => !d?.tax_law_code);
    dedList.splice(0, dedList.length, ...manual);
  }
  if (!taxed.length) return null;

  const lawIds = [...new Set(taxed.map((l) => l.tax_law_code))];
  const acnos = [...new Set(taxed.map((l) => intOf(l.acno)).filter(Boolean))];
  const [laws, parties] = await Promise.all([
    prisma.taxLaws.findMany({
      where: { tax_law_code: { in: lawIds } },
      select: { tax_law_code: true, section_description: true, rate_filer: true, rate_non_filer: true, tax_acno: true },
    }),
    acnos.length
      ? prisma.aCNO.findMany({ where: { acno: { in: acnos } }, select: { acno: true, tax_filing_status: true } })
      : [],
  ]);
  const lawBy = new Map(laws.map((t) => [t.tax_law_code, t]));
  const statusBy = new Map(parties.map((p) => [Number(p.acno), String(p.tax_filing_status || "")]));

  const unknown = lawIds.filter((id) => !lawBy.has(id));
  if (unknown.length) return `Tax law ${unknown.join(", ")} was not found.`;
  const noAccount = laws.filter((t) => !t.tax_acno).map((t) => t.section_description || t.tax_law_code);
  if (noAccount.length) {
    return `Tax law ${noAccount.join(", ")} has no payable account — set it on Setup → Tax Laws.`;
  }

  const built = [];
  for (const l of taxed) {
    const law = lawBy.get(l.tax_law_code);
    const nonFiler = statusBy.get(intOf(l.acno))?.toLowerCase().includes("non");
    const rate = Number(nonFiler ? law.rate_non_filer : law.rate_filer) || 0;
    l.wht_rate = rate;
    const base = Math.abs(Number(l.damt) || Number(l.camt) || 0);
    const amount = round2((base * rate) / 100);
    if (!(amount > 0)) continue;
    built.push({
      acno: { value: law.tax_acno },
      ccno: l.ccno?.value != null ? l.ccno : l.ccno != null ? { value: l.ccno } : null,
      tax_law_code: law.tax_law_code,
      wht_rate: rate,
      damt: Number(tranCode) === 1 ? amount : 0,
      camt: Number(tranCode) === 2 ? amount : 0,
      narration1: `WHT ${law.section_description || ""} @ ${rate}%`.replace(/\s+/g, " ").trim(),
    });
  }
  if (dedList) dedList.push(...built);
  return null;
}
