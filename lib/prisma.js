import { PrismaClient } from "@prisma/client";
import { dispatchNotification } from "@/lib/notifications/dispatcher";
import { recordAuditEvents } from "@/lib/audit/logger";
import { FILTERED_READS, ON_BOOK_WHERE, filterOffBooksNow, rewriteSqlStrings, withOnBookWhere } from "@/lib/accounts/books";

const globalForPrisma = globalThis;

if (!globalForPrisma.prismaBase) {
  globalForPrisma.prismaBase = new PrismaClient({
    log: process.env.NODE_ENV === "development" ? ["error", "warn"] : ["error"],
  });
}

// "User" -> "user", "TransactionsMaster" -> "transactionsMaster" — matches
// how Prisma names client accessors for a given schema model name.
const toClientAccessor = (model) => model.charAt(0).toLowerCase() + model.slice(1);
const base = () => globalForPrisma.prismaBase;

// A bulk write touching more rows than this is audited as one summary row
// (fetching every row first would make the write itself slow).
const MAX_AUDIT_ROWS = 2000;

async function fetchBeforeState(model, where) {
  try {
    return await base()[toClientAccessor(model)].findUnique({ where });
  } catch (err) {
    console.error("Audit log pre-fetch error:", err);
    return null;
  }
}

/** Rows a bulk update / delete is about to touch, or null when too many to list. */
async function fetchBeforeRows(model, where) {
  try {
    const rows = await base()[toClientAccessor(model)].findMany({ where, take: MAX_AUDIT_ROWS + 1 });
    return rows.length > MAX_AUDIT_ROWS ? null : rows;
  } catch (err) {
    console.error("Audit log pre-fetch error:", err);
    return [];
  }
}

/** A row after an updateMany's `data` (set values and increment / decrement / multiply / divide). */
function applyPatch(row, data) {
  const out = { ...row };
  for (const [k, v] of Object.entries(data ?? {})) {
    if (v && typeof v === "object" && !(v instanceof Date) && !Array.isArray(v)) {
      const cur = Number(out[k]) || 0;
      if ("set" in v) out[k] = v.set;
      else if ("increment" in v) out[k] = cur + Number(v.increment);
      else if ("decrement" in v) out[k] = cur - Number(v.decrement);
      else if ("multiply" in v) out[k] = cur * Number(v.multiply);
      else if ("divide" in v) out[k] = cur / Number(v.divide);
    } else {
      out[k] = v;
    }
  }
  return out;
}

// Notifications and the audit log are side effects of a write: they run in
// the background and the write never waits for them. Awaiting them (about 20
// round trips to the database each) kept interactive transactions open until
// they expired ("Transaction already closed … timeout 15000 ms") and slowed
// every save. Each one catches and logs its own errors.
function inBackground(label, work) {
  Promise.resolve()
    .then(work)
    .catch((err) => console.error(`${label} error:`, err));
}

const audit = (model, action, rows, summary = null) =>
  inBackground("Audit log", () => recordAuditEvents({ model, action, rows, summary, basePrisma: base() }));

// Every kind of write is audited (lib/audit/logger.js) — bulk ones too, so a
// voucher edit (header update + lines deleteMany + createMany) leaves a full
// trail. Raw SQL ($executeRaw) is not seen here.
// "Hide off books" (lib/accounts/books.js): while the switch is on, reads of
// the off-book models get an ON-books where, and raw SELECTs read filtered
// tables. Writes and named background jobs are never filtered.
async function offBooksRead(model, operation, args, query) {
  if (ON_BOOK_WHERE[model] && FILTERED_READS.has(operation) && (await filterOffBooksNow(base()))) {
    return query(withOnBookWhere(model, args));
  }
  return query(args);
}

if (!globalForPrisma.prismaGlobal) {
  globalForPrisma.prismaGlobal = globalForPrisma.prismaBase.$extends({
    query: {
      async $queryRaw({ args, query }) {
        if (args?.strings && (await filterOffBooksNow(base()))) {
          const strings = rewriteSqlStrings(args.strings);
          // Same class as the incoming query (Prisma.Sql), same values
          if (strings) return query(new args.constructor(strings, args.values));
        }
        return query(args);
      },

      async $queryRawUnsafe({ args, query }) {
        if (typeof args?.[0] === "string" && (await filterOffBooksNow(base()))) {
          const strings = rewriteSqlStrings([args[0]]);
          if (strings) return query([strings[0], ...args.slice(1)]);
        }
        return query(args);
      },

      $allModels: {
        findMany({ model, operation, args, query }) { return offBooksRead(model, operation, args, query); },
        findFirst({ model, operation, args, query }) { return offBooksRead(model, operation, args, query); },
        findFirstOrThrow({ model, operation, args, query }) { return offBooksRead(model, operation, args, query); },
        findUnique({ model, operation, args, query }) { return offBooksRead(model, operation, args, query); },
        findUniqueOrThrow({ model, operation, args, query }) { return offBooksRead(model, operation, args, query); },
        count({ model, operation, args, query }) { return offBooksRead(model, operation, args, query); },
        aggregate({ model, operation, args, query }) { return offBooksRead(model, operation, args, query); },
        groupBy({ model, operation, args, query }) { return offBooksRead(model, operation, args, query); },

        async create({ model, args, query }) {
          const result = await query(args);
          inBackground("Notification", () => dispatchNotification({ model, action: "create", result, prisma: base() }));
          audit(model, "create", [{ before: null, after: result }]);
          return result;
        },

        async createMany({ model, args, query }) {
          const result = await query(args);
          const rows = Array.isArray(args.data) ? args.data : [args.data];
          audit(model, "create", rows.map((r) => ({ before: null, after: r })), rows.length > MAX_AUDIT_ROWS ? { count: rows.length } : null);
          return result;
        },

        async createManyAndReturn({ model, args, query }) {
          const result = await query(args);
          audit(model, "create", result.map((r) => ({ before: null, after: r })), result.length > MAX_AUDIT_ROWS ? { count: result.length } : null);
          return result;
        },

        async update({ model, args, query }) {
          const before = await fetchBeforeState(model, args.where);
          const result = await query(args);
          inBackground("Notification", () => dispatchNotification({ model, action: "update", result, prisma: base() }));
          audit(model, "update", [{ before, after: result }]);
          return result;
        },

        async updateMany({ model, args, query }) {
          const before = await fetchBeforeRows(model, args.where);
          const result = await query(args);
          if (before === null) audit(model, "update", [], { count: result.count, where: args.where, data: args.data });
          else audit(model, "update", before.map((b) => ({ before: b, after: applyPatch(b, args.data) })));
          return result;
        },

        async upsert({ model, args, query }) {
          const before = await fetchBeforeState(model, args.where);
          const result = await query(args);
          audit(model, before ? "update" : "create", [{ before, after: result }]);
          return result;
        },

        async delete({ model, args, query }) {
          const before = await fetchBeforeState(model, args.where);
          const result = await query(args);
          audit(model, "delete", [{ before: before ?? result, after: null }]);
          return result;
        },

        async deleteMany({ model, args, query }) {
          const before = await fetchBeforeRows(model, args.where);
          const result = await query(args);
          if (before === null) audit(model, "delete", [], { count: result.count, where: args.where });
          else audit(model, "delete", before.map((b) => ({ before: b, after: null })));
          return result;
        },
      },
    },
  });
}

const prisma = globalForPrisma.prismaGlobal;

export default prisma;
