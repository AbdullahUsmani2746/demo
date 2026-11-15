// lib/accounts/books.js — ON books / OFF books, and the "Hide off books" switch.
//
// OFF the books (the unofficial book) = an account switched off
// (acno.is_active = false) or whose main account is (MACNO.is_active = false).
// A voucher is off the books when its party (pycd) or ANY of its lines is an
// off-book account; an order when its customer is.
//
// The switch (Settings key "hideOffBooks", flipped by holders of
// offBooks.hide — the button in the header) hides all of that from the whole
// system at once, for everyone, until it is switched back:
//   · Prisma reads of the models below get an extra where (lib/prisma.js)
//   · raw SELECTs ($queryRaw / $queryRawUnsafe — reports, BI, MIS) read
//     filtered versions of the same tables (rewriteSql)
// Writes are never touched. Named background jobs (runAsSystem — knock-off,
// month-end, follow-ups) always see everything, so what they lock or match
// stays complete.
import { getAuditActor } from "@/lib/audit/context";

export const HIDE_OFF_BOOKS_KEY = "hideOffBooks";
export const HIDE_OFF_BOOKS_PERMISSION = "offBooks.hide";

// ── the switch ──────────────────────────────────────────────────────────────
const CACHE_MS = 10_000;
let cache = { at: 0, on: false, loading: null };

/** Is the switch on? Read through the BASE client (never filtered), cached 10 s. */
export async function offBooksHidden(base) {
  if (Date.now() - cache.at < CACHE_MS) return cache.on;
  if (!cache.loading) {
    cache.loading = base.settings
      .findUnique({ where: { key: HIDE_OFF_BOOKS_KEY }, select: { value: true } })
      .then((row) => {
        cache = { at: Date.now(), on: row?.value === "true", loading: null };
        return cache.on;
      })
      .catch(() => {
        cache = { at: Date.now(), on: false, loading: null };
        return false;
      });
  }
  return cache.loading;
}

/** After flipping the switch: this process uses the new value at once (others within 10 s). */
export function primeOffBooksSwitch(on) {
  cache = { at: Date.now(), on: Boolean(on), loading: null };
}

/** Named background jobs see everything; every person is filtered while the switch is on. */
export const bypassesOffBooksFilter = () => getAuditActor()?.job === true;

/** Should this query be filtered right now? */
export async function filterOffBooksNow(base) {
  if (bypassesOffBooksFilter()) return false;
  return offBooksHidden(base);
}

// ── Prisma reads ────────────────────────────────────────────────────────────
const OFF_ACNO = { OR: [{ isActive: false }, { mainAccount: { isActive: false } }] };
const ON_ACNO = { isActive: true, mainAccount: { isActive: true } };
const ON_VOUCHER = {
  AND: [
    { OR: [{ pycd: null }, { acno: { is: ON_ACNO } }] },
    { transactions: { none: { acnoDetails: { is: OFF_ACNO } } } },
  ],
};
const ON_ORDER = { acno: { is: ON_ACNO } };

/** model → the where that keeps only ON-book rows */
export const ON_BOOK_WHERE = {
  ACNO: ON_ACNO,
  TransactionsMaster: ON_VOUCHER,
  Transactions: { transactionsMaster: { is: ON_VOUCHER } },
  OrderMaster: ON_ORDER,
  OrderDetail: { orderMaster: { is: ON_ORDER } },
  CustomerMonthlyTarget: { customer: { is: ON_ACNO } },
  ChecksInHand: { customer: { is: ON_ACNO } },
};

export const FILTERED_READS = new Set([
  "findMany", "findFirst", "findFirstOrThrow", "findUnique", "findUniqueOrThrow", "count", "aggregate", "groupBy",
]);

/** args with the model's ON-book where added (AND-ed onto whatever was asked). */
export function withOnBookWhere(model, args) {
  const filter = ON_BOOK_WHERE[model];
  if (!filter) return args;
  const where = args?.where;
  if (!where) return { ...args, where: filter };
  const and = Array.isArray(where.AND) ? where.AND : where.AND ? [where.AND] : [];
  return { ...args, where: { ...where, AND: [...and, filter] } };
}

// ── raw SQL ─────────────────────────────────────────────────────────────────
// The table stays exactly where the query has it (so GROUP BY on its primary
// key keeps working); right after it, and its alias, comes a filter join:
//   FROM "TRANSACTIONS_MASTER" tm JOIN (SELECT 1) ob_1 ON tm.tran_id NOT IN (…off-book…)
// Inside a LEFT JOIN that nests (… LEFT JOIN "acno" a JOIN (SELECT 1) ob_2 ON … ON a.acno = …),
// so the outer row stays and only the off-book account drops out.
// The off-book sets are uncorrelated sub-selects (computed once per query);
// their own aliases (ob_*) cannot clash with the report's.
const OFF_ACNOS = `SELECT ob_a.acno FROM "acno" ob_a LEFT JOIN "MACNO" ob_m ON ob_m.macno = ob_a.macno WHERE ob_a.is_active = false OR ob_m.is_active = false`;
const OFF_TRANS = `SELECT ob_t.tran_id FROM "Transactions" ob_t WHERE ob_t.acno IN (${OFF_ACNOS}) UNION SELECT ob_tm.tran_id FROM "TRANSACTIONS_MASTER" ob_tm WHERE ob_tm.pycd IN (${OFF_ACNOS})`;
const OFF_ORDERS = `SELECT ob_o.order_no FROM "OrderMaster" ob_o WHERE ob_o.party_code IN (${OFF_ACNOS})`;

// table → the ON-books condition for alias `a`
const ON_BOOK_SQL = {
  acno: (a) => `${a}.acno NOT IN (${OFF_ACNOS})`,
  TRANSACTIONS_MASTER: (a) => `${a}.tran_id NOT IN (${OFF_TRANS})`,
  Transactions: (a) => `${a}.tran_id NOT IN (${OFF_TRANS})`,
  OrderMaster: (a) => `(${a}.party_code IS NULL OR ${a}.party_code NOT IN (${OFF_ACNOS}))`,
  OrderDetail: (a) => `${a}.order_no NOT IN (${OFF_ORDERS})`,
  CustomerMonthlyTarget: (a) => `${a}.acno NOT IN (${OFF_ACNOS})`,
  checks_in_hand: (a) => `${a}.acno NOT IN (${OFF_ACNOS})`,
};

// FROM / JOIN <table> [AS] [alias] — quoted mixed-case names exactly; acno also unquoted
const TABLE_RE =
  /\b(FROM|JOIN)(\s+)(?:"public"\.)?("acno"|acno|"TRANSACTIONS_MASTER"|"Transactions"|"OrderMaster"|"OrderDetail"|"CustomerMonthlyTarget"|"checks_in_hand")(?=[\s),;]|$)((?:\s+AS)?\s+("?)([A-Za-z_][A-Za-z0-9_]*)\5)?/g;
const NOT_ALIAS = new Set([
  "WHERE", "JOIN", "LEFT", "RIGHT", "INNER", "FULL", "CROSS", "NATURAL", "ON", "USING", "GROUP", "ORDER", "LIMIT",
  "OFFSET", "UNION", "EXCEPT", "INTERSECT", "HAVING", "WINDOW", "FOR", "RETURNING", "AND", "OR", "TABLESAMPLE",
  "LATERAL", "SELECT", "AS",
]);
// Statements that write are never rewritten.
const WRITES = /\b(INSERT\s+INTO|DELETE\s+FROM|UPDATE\s+"?\w+"?\s+(?:\w+\s+)?SET|FOR\s+UPDATE|FOR\s+SHARE)\b/i;

/** One chunk of SQL text with a filter join after each off-book table. */
function rewriteChunk(text, counter) {
  return text.replace(TABLE_RE, (match, kw, sp, table, aliasPart, quote, alias) => {
    const name = table.replace(/"/g, "");
    const cond = ON_BOOK_SQL[name];
    if (!cond) return match;
    const hasAlias = Boolean(alias) && (quote === '"' || !NOT_ALIAS.has(alias.toUpperCase()));
    const ref = hasAlias ? `${quote}${alias}${quote}` : `"${name}"`;
    const head = hasAlias ? match : `${kw}${sp}${table}`;
    const rest = hasAlias ? "" : aliasPart || "";
    counter.n += 1;
    return `${head} JOIN (SELECT 1) ob_${counter.n} ON ${cond(ref)}${rest}`;
  });
}

/** Rewrite the text parts of a raw SELECT; null when nothing to change. */
export function rewriteSqlStrings(strings) {
  const joined = strings.join(" ");
  if (WRITES.test(joined)) return null;
  TABLE_RE.lastIndex = 0;
  if (!TABLE_RE.test(joined)) return null;
  TABLE_RE.lastIndex = 0;
  const counter = { n: 0 };
  return strings.map((chunk) => rewriteChunk(chunk, counter));
}
