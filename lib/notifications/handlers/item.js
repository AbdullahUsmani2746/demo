// Handles notifications for the item master.
import { NOTIFICATION_TYPES, NOTIFICATION_EXPIRY } from "../config";
import { emit } from "../emit";

async function categoryName(prisma, icId) {
  if (!icId) return "Unknown Category";
  const category = await prisma.itemCategory.findUnique({
    where: { id: icId },
    select: { ic_name: true },
  });
  return category?.ic_name || `Category #${icId}`;
}

/** Item created. */
export async function itemCreated(data, prisma) {
  try {
    const category = await categoryName(prisma, data.ic_id);
    await emit(prisma, "itemCreated", {
      title: "New Product Added",
      message: `Product "${data.item}" (Code: ${data.itcd}) added to ${category}`,
      type: NOTIFICATION_TYPES.SUCCESS,
      entity: "item",
      entityId: data.itcd,
    });
  } catch (error) {
    console.error("Error creating item notification:", error);
  }
}

/** Item updated. Stock below CRITICAL_STOCK_LEVEL escalates to an error-level alert. */
export async function itemUpdated(data, prisma) {
  try {
    const CRITICAL_STOCK_LEVEL = 10;
    const hasStock = data.stock !== undefined && data.stock !== null;
    const critical = hasStock && data.stock < CRITICAL_STOCK_LEVEL;

    await emit(prisma, "itemUpdated", {
      title: critical ? "⚠️ Critical Stock Alert" : "Product Updated",
      message: `Product "${data.item}" (${data.itcd}) updated${hasStock ? ` - Stock: ${data.stock}` : ""}`,
      type: critical ? NOTIFICATION_TYPES.ERROR : NOTIFICATION_TYPES.INFO,
      entity: "item",
      entityId: data.itcd,
      expiryDays: critical ? NOTIFICATION_EXPIRY.CRITICAL : NOTIFICATION_EXPIRY.DEFAULT,
    });
  } catch (error) {
    console.error("Error creating item update notification:", error);
  }
}
