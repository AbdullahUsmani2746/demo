// lib/accounts/partyMacnos.js — SERVER ONLY (pulls Prisma).
// ============================================================
// Customers, vendors and cash / bank accounts are the accounts under the main
// accounts (macno) chosen in Finance → Account Settings (groups "customers",
// "vendors", "cash_bank" — lib/accounts/accountSettingDefs.js). Nothing here
// is hard-coded: every getter reads the settings (cached 60s).
//
// Client code must not import this file. Pickers pass the group name instead
// (lib/accounts/groupParams.js) and /api/accounts/acno resolves it:
//   /api/accounts/acno?group=customers
// ============================================================
import { getAccountGroup, getAccountGroups } from "@/lib/accounts/accountSettings";

/** Main accounts whose accounts are customers (may be empty when unset). */
export const getCustomerMacnos = () => getAccountGroup("customers");

/** Main accounts whose accounts are vendors (may be empty when unset). */
export const getVendorMacnos = () => getAccountGroup("vendors");

/** Customers and vendors, for pickers that accept either side. */
export const getPartyMacnos = () => getAccountGroups(["customers", "vendors"]);

/** Cash and bank main accounts — the "Paid From" / "Received In" side. */
export const getCashBankMacnos = () => getAccountGroup("cash_bank");

export async function isCustomerMacno(macno) {
  return (await getCustomerMacnos()).includes(Number(macno));
}

export async function isVendorMacno(macno) {
  return (await getVendorMacnos()).includes(Number(macno));
}
