// lib/accounts/groupParams.js — client-safe.
// Query-string fragments for /api/accounts/acno (and /api/accounts/cities,
// /api/accounts/macno) naming an account group from Finance → Account
// Settings. The server resolves the group to its main accounts, so no screen
// carries a macno number. An unconfigured group lists nothing.
export const CUSTOMER_GROUP_PARAM = "group=customers";
export const VENDOR_GROUP_PARAM = "group=vendors";
export const PARTY_GROUP_PARAM = "group=customers,vendors";
export const CASH_BANK_GROUP_PARAM = "group=cash_bank";
export const TRANSPORTER_GROUP_PARAM = "group=transporters";
// Services on GRN / Dispatch are billed by vendors or transporters (freight).
export const SERVICE_VENDOR_GROUP_PARAM = "group=vendors,transporters";
export const LC_GROUP_PARAM = "group=lc_accounts";
export const BENEFICIARY_GROUP_PARAM = "group=beneficiaries";
