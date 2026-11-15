// lib/reports/distributorFiles.js
// ============================================================
// Codes printed on the distributor data files a principal company asks for
// (Customer File, IL File, PC File, PR File, Purchasing File reports — ported
// from the Accounting system). They are the principal's codes, not ours, so
// they are data: Settings row "distributorFileCodes", JSON, any key missing =
// the default below (the values the Accounting system printed).
//
//   const codes = await distributorFileCodes();
//   codes.subsidiaryCode   // "149"
// ============================================================
import prisma from "@/lib/prisma";

export const DISTRIBUTOR_FILE_CODES_KEY = "distributorFileCodes";

export const DISTRIBUTOR_FILE_DEFAULTS = {
  subsidiaryCode: "149", // the distributor's code at the principal (subsidiary / site order)
  customerStatus: "SIRF", // status printed for every customer
  partyType: "TP", // customer / supplier type ("third party")
  countryCode: "92",
  countryName: "Pakistan",
};

export async function distributorFileCodes() {
  try {
    const row = await prisma.settings.findUnique({ where: { key: DISTRIBUTOR_FILE_CODES_KEY }, select: { value: true } });
    const stored = row?.value ? JSON.parse(row.value) : {};
    return { ...DISTRIBUTOR_FILE_DEFAULTS, ...(stored && typeof stored === "object" ? stored : {}) };
  } catch {
    return { ...DISTRIBUTOR_FILE_DEFAULTS };
  }
}
