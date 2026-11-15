// lib/productionGodown.js
//
// Which godown a production posting writes to (server side).
//
// Rule: the finished product's item category decides the godown, as set on
// Settings → Production setup (lib/production/setupConfig.js):
//   a finished goods category  ->  the finished goods godown
//   anything else              ->  the production godown
import { getProductionSetup, godownForCategory } from "@/lib/production/setup";

/**
 * Resolves the godown for a production posting from its finished product.
 *
 * @param {object} client  prisma client, or the tx client inside $transaction
 * @param {number|string} finishedId  Item.itcd of the finished product
 * @param {object} [setup]  the production setup, when the caller already holds it
 * @returns {Promise<number>} godown id — the production godown when the item
 *          or its category cannot be resolved, so a posting never fails just
 *          because a category is missing.
 */
export async function resolveProductionGodown(client, finishedId, setup) {
  const s = setup || (await getProductionSetup());
  const itcd = parseInt(finishedId);
  if (isNaN(itcd)) return s.productionGodown;

  const item = await client.item.findUnique({
    where: { itcd },
    select: { ic_id: true },
  });

  return godownForCategory(s, item?.ic_id);
}

export default resolveProductionGodown;
