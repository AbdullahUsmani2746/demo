// lib/orders/lineAllocation.js
// ============================================================
// Order lines that repeat an item (ported from Accounting lib/orderLineAllocation.js).
//
// A dispatch / GRN refers to its order by order number + item only, so when an
// order lists the same item on two or more lines, the item's moved quantity
// must be split over those lines — otherwise every line shows the whole total
// and is closed together. Rule: fill lines in line order (OrderDetail.id
// ascending), each up to its ordered qty; the last line takes the rest, so an
// over-dispatch stays visible on it. A line whose item appears once gets the
// item's total, exactly as before.
// ============================================================

/** Split `total` over `lineQtys` in order; sums exactly to `total`. */
export function allocateFifo(lineQtys, total) {
  const out = lineQtys.map(() => 0);
  let remaining = Number(total) || 0;
  for (let i = 0; i < lineQtys.length; i++) {
    if (i === lineQtys.length - 1) {
      out[i] = remaining;
      break;
    }
    const take = remaining > 0 ? Math.min(Math.max(Number(lineQtys[i]) || 0, 0), remaining) : 0;
    out[i] = take;
    remaining -= take;
  }
  return out;
}

/**
 * @param {Array<{ id, itcd, qty }>} details   order lines
 * @param {Map<number, number>} movedPerItem   qty moved per itcd
 * @returns {Map<lineId, number>}
 */
export function allocateOrderLines(details, movedPerItem) {
  const groups = new Map();
  for (const d of details || []) {
    if (d?.itcd == null) continue;
    const k = Number(d.itcd);
    if (!groups.has(k)) groups.set(k, []);
    groups.get(k).push(d);
  }
  const out = new Map();
  for (const [itcd, group] of groups) {
    group.sort((a, b) => Number(a.id) - Number(b.id));
    const alloc = allocateFifo(group.map((d) => d.qty || 0), movedPerItem.get(itcd) || 0);
    group.forEach((d, i) => out.set(d.id, alloc[i]));
  }
  return out;
}
