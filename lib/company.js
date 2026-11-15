// Server-side access to this installation's own company profile (the single
// Company row edited under Settings → Company). Use this instead of hard-coding
// a company name/address in titles, PDFs or report headers.
//
// Client code should use the company context (context/CompanyContext.js)
// instead — this module imports Prisma and is server-only.
import prisma from "@/lib/prisma";

import {
  DEFAULT_COMPANY_NAME,
  DEFAULT_COMPANY_LOGO,
  companyShortName,
} from "@/lib/companyName";

export { DEFAULT_COMPANY_NAME, DEFAULT_COMPANY_LOGO, companyShortName };

const TTL_MS = 60 * 1000;
let cached = null;
let cachedAt = 0;

/**
 * The company profile, cached in-process for a minute.
 * Returns { id, name, company, logo, addr1, addr2, city, phone, fax, email,
 * address[] } — `name` and `company` are the same value. Never throws: on any
 * error (or no row) it returns a neutral profile.
 */
export async function getCompany({ fresh = false } = {}) {
  if (!fresh && cached && Date.now() - cachedAt < TTL_MS) return cached;
  let row = null;
  try {
    row = await prisma.company.findFirst({
      orderBy: { id: "asc" },
      select: {
        id: true,
        company: true,
        logo: true,
        addr1: true,
        addr2: true,
        city: true,
        phone: true,
        fax: true,
        email: true,
      },
    });
  } catch (error) {
    // Once per process: a build without database access calls this for every
    // prerendered page, and the full stack each time buries the build log.
    if (!globalThis.__getCompanyFailLogged) {
      globalThis.__getCompanyFailLogged = true;
      console.error("getCompany failed (using the neutral company profile):", error?.message ?? error);
    }
    // Do not cache a failure — try again on the next call.
    return neutralCompany();
  }
  const profile = row ? toProfile(row) : neutralCompany();
  cached = profile;
  cachedAt = Date.now();
  return profile;
}

function toProfile(row) {
  const name = row.company || DEFAULT_COMPANY_NAME;
  const address = [];
  if (row.addr1) address.push(row.addr1);
  if (row.addr2) address.push(row.addr2);
  if (row.city) address.push(row.city);
  if (row.phone) address.push(`Phone: ${row.phone}`);
  return {
    id: row.id,
    name,
    company: name,
    logo: row.logo || DEFAULT_COMPANY_LOGO,
    addr1: row.addr1 || "",
    addr2: row.addr2 || "",
    city: row.city || "",
    phone: row.phone || "",
    fax: row.fax || "",
    email: row.email || "",
    address,
  };
}

function neutralCompany() {
  return {
    id: null,
    name: DEFAULT_COMPANY_NAME,
    company: DEFAULT_COMPANY_NAME,
    logo: DEFAULT_COMPANY_LOGO,
    addr1: "",
    addr2: "",
    city: "",
    phone: "",
    fax: "",
    email: "",
    address: [],
  };
}

/** Drop the cached profile (call after the Company row is updated). */
export function clearCompanyCache() {
  cached = null;
  cachedAt = 0;
}
