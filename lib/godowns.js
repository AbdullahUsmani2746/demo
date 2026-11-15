// lib/godowns.js
// ============================================================
// Closed godowns (Godown.is_active = false).
//
// Closing a godown in Setup → Godowns hides it from every entry-form dropdown
// (app/api/setup/[entity]/route.js) — but a form already open, a stale tab or
// a direct API call could still send one. Every route that writes a godown
// onto a document checks here too.
//
// On an EDIT pass the godowns the document already had as `allow`: a document
// posted before the godown closed can still be corrected, it just cannot be
// moved INTO a closed godown.
// ============================================================
import prisma from "@/lib/prisma";

const toIds = (values) =>
  [...new Set(
    [].concat(values ?? [])
      .map((v) => Number(v?.value ?? v))
      .filter((n) => Number.isInteger(n) && n > 0),
  )];

/**
 * Error message naming any closed godown in `godownIds`, or null if all open.
 * @param {Array<number|string|{value}>|number} godownIds
 * @param {{ allow?: Array<number>, db?: object }} [opts]
 */
export async function closedGodownError(godownIds, { allow = [], db = prisma } = {}) {
  const allowed = new Set(toIds(allow));
  const ids = toIds(godownIds).filter((id) => !allowed.has(id));
  if (ids.length === 0) return null;

  const closed = await db.godown.findMany({
    where: { id: { in: ids }, is_active: false },
    select: { id: true, godown: true },
    orderBy: { id: "asc" },
  });
  if (closed.length === 0) return null;

  const names = closed.map((g) => `${g.godown} (${g.id})`).join(", ");
  return closed.length === 1
    ? `Godown ${names} is closed and cannot be used. Choose another godown.`
    : `Godowns ${names} are closed and cannot be used. Choose other godowns.`;
}
