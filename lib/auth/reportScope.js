// lib/auth/reportScope.js
//
// Row-level scoping for the report engine.
//
// The 60+ report functions read their filters directly (`Number(filters.customer)`,
// `parseInt(filters.godown)`), so a scope cannot be pushed down into their
// queries from one place. It is therefore enforced one level up, at the filter
// boundary: before a report runs, every filter that corresponds to a scoped
// dimension is narrowed to what the user is allowed to see, and a report that
// offers no such filter is refused outright rather than run unscoped.
//
// That refusal is the point. Silently returning every customer's figures to a
// user who is restricted to three of them would be the worse failure, and
// quietly passing "12,44,91" to a report that does `Number(filters.customer)`
// would produce NaN and an equally silent wrong answer.
//
// None of this engages until an administrator creates a DataScope row for the
// user: no row means unrestricted (see scopeFor), so adding the tables changes
// nothing for anyone already using the system.
import { ForbiddenError, hasFullAccess } from "@/lib/auth/permissions";
import { allScopes, isUnrestricted, narrowFilter } from "@/lib/auth/scope";
import { SCOPE_DIMENSIONS, dimensionByKey } from "@/lib/auth/scopeDimensions";

/**
 * Filter names that carry each dimension. Reports name the same concept
 * several ways, so each dimension lists every spelling in use.
 */
export const DIMENSION_FILTERS = Object.fromEntries(
  SCOPE_DIMENSIONS.map((d) => [d.key, d.reports?.filters ?? [d.key]]),
);

/** A 400 the caller turns into a "pick a value" message. */
export class ScopeChoiceRequired extends Error {
  constructor(message, options, filter = null) {
    super(message);
    this.name = "ScopeChoiceRequired";
    this.status = 400;
    this.options = options;
    // Which report filter to set — the report screen picks the first option
    // for the user instead of showing an error.
    this.filter = filter;
  }
}

const label = (dimension) =>
  (dimensionByKey(dimension)?.label ?? dimension).replace(/s$/, "").toLowerCase();

/**
 * Narrow `filters` in place to the session's data scope.
 *
 * @param {object}   args.session     NextAuth session
 * @param {string}   args.reportType  key into REPORT_CONFIG, for messages
 * @param {object}   args.config      that report's config entry
 * @param {object}   args.filters     parsed filters, mutated and returned
 * @returns {Promise<object>} the same filters object
 * @throws  {ForbiddenError}       report cannot be scoped, or nothing permitted
 * @throws  {ScopeChoiceRequired}  scope permits several values but the report
 *                                 takes only one — the user must choose
 */
export async function applyReportScope({ session, reportType, config, filters }) {
  if (hasFullAccess(session)) return filters;

  const scopes = await allScopes(session);
  const restricted = Object.entries(scopes).filter(([, s]) => !isUnrestricted(s));
  if (restricted.length === 0) return filters;

  const declared = config.filters ?? [];

  for (const [dimension, scope] of restricted) {
    const only = dimensionByKey(dimension)?.reports?.reportTypes;
    if (only && !only.includes(reportType)) continue;
    const names = DIMENSION_FILTERS[dimension] ?? [dimension];
    const matches = declared.filter((f) => names.includes(f.name));

    if (matches.length === 0) {
      // Not "strict" (godown): the report is not about that dimension — a
      // godown limit says nothing about a ledger — so it runs as is.
      if (dimensionByKey(dimension)?.reports?.strict === false) continue;
      // No way to limit this report to the user's rows, so it does not run.
      throw new ForbiddenError(
        `You are limited to specific ${label(dimension)}s, and the ` +
          `${config.title || reportType} report cannot be restricted that way. ` +
          `Ask an administrator for access to the full report.`,
      );
    }

    if (scope.values.length === 0) {
      throw new ForbiddenError(
        `No ${label(dimension)} has been assigned to you, so this report has ` +
          `nothing to show. Ask an administrator to assign your ` +
          `${label(dimension)}s.`,
      );
    }

    for (const filter of matches) {
      const allowed = narrowFilter(scope, filters[filter.name]);
      if (allowed === undefined) continue;

      if (allowed.length === 0) {
        throw new ForbiddenError(
          `That ${label(dimension)} is outside the data you are allowed to see.`,
        );
      }

      if (allowed.length === 1) {
        filters[filter.name] = allowed[0];
      } else if (filter.multiple) {
        filters[filter.name] = allowed.join(",");
      } else {
        // Passing a list to a report that parses a single number would yield
        // NaN and a silently wrong report, so ask rather than guess.
        throw new ScopeChoiceRequired(
          `Choose one ${label(dimension)} — this report shows one at a time.`,
          allowed,
          filter.name,
        );
      }
    }
  }

  return filters;
}
