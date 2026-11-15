// Shared helpers for the Checks In Hand module (entry UI + report).
// Kept in one place so the API routes and lib/reports/checksInHand.js cannot
// drift on status spelling, bank casing or the dual-book category rule.

export const CHECK_STATUS = {
  PENDING: "PENDING",
  CLEARED: "CLEARED",
};

export const CHECK_STATUSES = [CHECK_STATUS.PENDING, CHECK_STATUS.CLEARED];

// The "Transfer To Bank" picker on the cheque form lists the "Cash & Bank"
// group of Finance → Account Settings (resolved by /api/accounts/acno), so a
// deposit can only ever be booked against an account that really is a bank.
export const TRANSFER_BANK_GROUP = "cash_bank";

// Bank names are free text but must be stored canonically so the "pick a bank
// you already typed" dropdown does not fill up with MEEZAN / Meezan / meezan.
// Collapse internal whitespace too - "BANK  AL HABIB" and "BANK AL HABIB"
// should be the same entry.
export function normalizeBank(value) {
  return String(value ?? "")
    .trim()
    .replace(/\s+/g, " ")
    .toUpperCase();
}

// Same idea for the short free-text columns, which the legacy report prints
// in caps ("FUND TRANSFER", "TRANSFER FSB", ...).
export function normalizeText(value) {
  const v = String(value ?? "").trim().replace(/\s+/g, " ");
  return v ? v.toUpperCase() : null;
}

export function normalizeStatus(value) {
  const v = normalizeBank(value);
  return CHECK_STATUSES.includes(v) ? v : CHECK_STATUS.PENDING;
}

// Display labels for the two books (computed, never stored).
export const BOOK = { OFFICIAL: "Official", UNOFFICIAL: "Unofficial" };

// Dual book. The flag is switched at TWO levels and both count: a customer can
// be moved to the unofficial book on its own (ACNO.is_active = false), or its
// whole main-account group can be switched off (MACNO.is_active = false), which
// moves every account under it. Official therefore requires both to be on.
// Callers must include `mainAccount: { select: { isActive: true } }`.
export function deriveCategory(customer) {
  // Accepts the ACNO row (preferred) or a bare boolean for older callers.
  if (typeof customer === "boolean") return customer ? BOOK.OFFICIAL : BOOK.UNOFFICIAL;
  if (customer?.isActive === false) return BOOK.UNOFFICIAL;
  if (customer?.mainAccount?.isActive === false) return BOOK.UNOFFICIAL;
  return BOOK.OFFICIAL;
}

// Prisma `where` fragment selecting one side of the dual book. Because the flag
// lives at two levels, "official" is the AND of both and "unofficial" is the OR
// of their negations - not a single is_active comparison.
export function categoryWhere(category) {
  const c = String(category || "").toLowerCase();
  if (c === "active" || c === "official" || c === "e") {
    return { isActive: true, mainAccount: { isActive: true } };
  }
  if (c === "inactive" || c === "unofficial" || c === "m") {
    return { OR: [{ isActive: false }, { mainAccount: { isActive: false } }] };
  }
  return null;
}

// Date range normalisation - project rule: dateFrom at 00:00:00.000,
// dateTo at 23:59:59.999, applied before every Prisma query.
export function startOfDay(date) {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

export function endOfDay(date) {
  const d = new Date(date);
  d.setHours(23, 59, 59, 999);
  return d;
}

// Prisma Decimal -> plain number, safe for JSON responses.
export function toNumber(value) {
  if (value === null || value === undefined || value === "") return 0;
  return Number(value);
}

// Serialise one ChecksInHand row (with `customer` included) for the client.
export function serializeCheck(row) {
  return {
    id: row.id,
    acno: row.acno,
    customerName: row.customer?.acname ?? "",
    depAcno: row.depAcno ?? "",
    depBankName: row.depositBank?.acname ?? "",
    customerIsActive: row.customer?.isActive ?? true,
    category: deriveCategory(row.customer),
    chqRcvDate: row.chqRcvDate,
    dated: row.dated,
    bank: row.bank,
    chqNo: row.chqNo,
    chqDate: row.chqDate,
    amount: toNumber(row.amount),
    rmk: row.rmk ?? "",
    chqBrBy: row.chqBrBy ?? "",
    status: row.status,
    depDate: row.depDate,
    created_at: row.created_at,
    updated_at: row.updated_at,
  };
}
