// lib/productionGodown.js
//
// Single source of truth for which godown a production posting writes to.
//
// Rule: the finished product's item category decides the godown —
//   ic_id === 1  ->  godown 3
//   anything else ->  godown 2

export const GODOWN_FOR_CATEGORY_1 = 3;
export const GODOWN_DEFAULT = 2;
export const GODOWN_RULE_CATEGORY_ID = 1;

/**
 * Maps an item category id to its godown.
 * Kept separate so callers that already hold the item can skip the query.
 */
export const godownForCategory = (icId) =>
  Number(icId) === GODOWN_RULE_CATEGORY_ID
    ? GODOWN_FOR_CATEGORY_1
    : GODOWN_DEFAULT;

/**
 * Resolves the godown for a production posting from its finished product.
 *
 * @param {object} client  prisma client, or the tx client inside $transaction
 * @param {number|string} finishedId  Item.itcd of the finished product
 * @returns {Promise<number>} godown id — falls back to GODOWN_DEFAULT when the
 *          item or its category cannot be resolved, so a posting never fails
 *          just because a category is missing.
 */
export async function resolveProductionGodown(client, finishedId) {
  const itcd = parseInt(finishedId);
  if (isNaN(itcd)) return GODOWN_DEFAULT;

  const item = await client.item.findUnique({
    where: { itcd },
    select: { ic_id: true },
  });

  return godownForCategory(item?.ic_id);
}

export default resolveProductionGodown;
