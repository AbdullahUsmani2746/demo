// Client-safe company-name helpers (no Prisma import). Server code can import
// these from lib/company.js, which re-exports them.

// Neutral fallback when no Company row is configured.
export const DEFAULT_COMPANY_NAME = "Company";
// The logo shipped in public/ — used only when Company.logo is empty.
export const DEFAULT_COMPANY_LOGO = "/logo/logo.jpeg";

/** First word of the company name, e.g. "ACME FOODS (PVT) LTD" → "ACME". */
export function companyShortName(name) {
  const first = String(name || "").trim().split(/\s+/)[0];
  return first || DEFAULT_COMPANY_NAME;
}

/** Drop "Pvt Ltd" / "(Private) Limited" etc. for unofficial prints. */
export function stripPvtLtd(name) {
  return String(name || "")
    .replace(/[\s,]*\(?\s*(pvt|private)\.?\s*\)?\s*\.?\s*(ltd|limited)\.?/gi, "")
    .trim();
}

