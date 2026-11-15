// ============================================
// NOTIFICATION DISPATCHER
// ============================================
// Called by the Prisma extension in lib/prisma.js after every create/update.
// Maps model + action → handler (config.js) → handler builds the wording and
// raises an event via emit.js, which decides who receives it.

import { notificationEvents } from "./config";
import {
  transactionCreated,
  transactionUpdated,
  grnCreated,
  dispatchCreated,
} from "./handlers/transaction";
import { itemCreated, itemUpdated } from "./handlers/item";
import { taxChallanCreated, taxChallanUpdated } from "./handlers/finance";
import {
  userCreated,
  userUpdated,
  employeeCreated,
  employeeUpdated,
} from "./handlers/user";
import {
  orderCreated,
  orderUpdated,
  purchaseOrderCreated,
  purchaseOrderApproved,
  salesOrderCreated,
  qualityCheckCreated,
  qualityCheckApproved,
  qualityCheckRejected,
  qualityCheckRework,
  qualityCheckUpdated,
  productionCreated,
  productionStarted,
  productionCompleted,
  productionPosted,
  productionUpdated,
  requisitionCreated,
  requisitionApproved,
  requisitionUpdated,
} from "./handlers/production";
import { saleReturnRemarkSaved } from "./handlers/saleReturn";

// Event name (from config.js) → handler
const handlerMap = {
  // Vouchers
  transactionCreated,
  transactionUpdated,
  grnCreated,
  dispatchCreated,

  // Orders
  orderCreated,
  orderUpdated,
  purchaseOrderCreated,
  purchaseOrderApproved,
  salesOrderCreated,

  // Sale return remarks
  saleReturnRemarkSaved,

  // Quality
  qualityCheckCreated,
  qualityCheckApproved,
  qualityCheckRejected,
  qualityCheckRework,
  qualityCheckUpdated,

  // Production
  productionCreated,
  productionStarted,
  productionCompleted,
  productionPosted,
  productionUpdated,

  // Requisitions
  requisitionCreated,
  requisitionApproved,
  requisitionUpdated,

  // Inventory
  itemCreated,
  itemUpdated,

  // Finance
  taxChallanCreated,
  taxChallanUpdated,

  // Users & HR
  userCreated,
  userUpdated,
  employeeCreated,
  employeeUpdated,
};

export async function dispatchNotification({ model, action, result, prisma }) {
  const modelEvents = notificationEvents[model];
  if (!modelEvents) return;

  const eventName = modelEvents[action];
  if (!eventName) return;

  const handler = handlerMap[eventName];
  if (!handler) {
    console.warn(`Handler not found for event: ${eventName}`);
    return;
  }

  try {
    await handler(result, prisma);
  } catch (error) {
    // Notifications must never break the main operation.
    console.error(`Error in notification handler "${eventName}":`, error);
  }
}
