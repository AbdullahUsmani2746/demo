// Handles notifications for all voucher types (TransactionsMaster).
// Each tran_code raises its own event (see TRAN_CODE_EVENT) so the admin can
// route receipts to accounts and GRNs to the warehouse independently.
import { TRANSACTION_TYPES, NOTIFICATION_TYPES, NOTIFICATION_EXPIRY } from "../config";
import { TRAN_CODE_EVENT } from "../catalog";
import { emit, actorName } from "../emit";

function voucherTypeName(tranCode) {
  return TRANSACTION_TYPES[tranCode] || `Transaction Code ${tranCode}`;
}

/**
 * TransactionsMaster created.
 * GRN (4) and Dispatch (6) get their richer, item-aware wording; every other
 * voucher gets the generic "created by" notice under its own event code.
 */
export async function transactionCreated(data, prisma) {
  try {
    if (data.tran_code === 4) return await grnCreated(data, prisma);
    if (data.tran_code === 6) return await dispatchCreated(data, prisma);

    const eventCode = TRAN_CODE_EVENT[data.tran_code] || "transactionCreated";
    const voucherType = voucherTypeName(data.tran_code);
    const creator = await actorName(prisma, data.user_id);

    await emit(prisma, eventCode, {
      title: `New ${voucherType}`,
      message: `${voucherType} #${data.vr_no} created by ${creator}`,
      type: NOTIFICATION_TYPES.INFO,
      entity: "transaction",
      entityId: data.tran_id,
      // Users limited to other godowns (Admin → Permissions) are not told.
      godowns: [data.godown, data.godown2],
      actorUserId: data.user_id,
      actorTitle: "Voucher Created Successfully",
      actorMessage: `${voucherType} #${data.vr_no} has been created`,
      actorType: NOTIFICATION_TYPES.SUCCESS,
      vars: { voucher_type: voucherType, vr_no: data.vr_no, actor: creator },
    });

    // Sale Return: also tell the customer's own sales person to enter the reason
    if (data.tran_code === 10) await saleReturnReasonNeeded(data, prisma);
  } catch (error) {
    console.error("Error creating transaction notification:", error);
  }
}

/**
 * New Sale Return → the customer's sales person (ACNO.salesArea, a User.id or
 * username), only them, asking for the reason on Sale Return Remarks.
 */
async function saleReturnReasonNeeded(data, prisma) {
  try {
    if (data.pycd == null) return;
    const customer = await prisma.aCNO.findUnique({
      where: { acno: Number(data.pycd) },
      select: { acname: true, salesArea: true },
    });
    if (!customer?.salesArea) return;
    const salesPerson = await prisma.user.findFirst({
      where: { OR: [{ id: customer.salesArea }, { username: customer.salesArea }] },
      select: { id: true },
    });
    if (!salesPerson) return;

    await emit(prisma, "saleReturnReasonNeeded", {
      title: `Sale Return #${data.vr_no} — enter the reason`,
      message: `Sale Return #${data.vr_no} for ${customer.acname || data.pycd} was made. Please enter its reason (Technical / Commercial) on Sale Return Remarks.`,
      type: NOTIFICATION_TYPES.WARNING,
      // "saleReturn" links to the Sale Return Remarks page, searched to it
      entity: "saleReturn",
      entityId: data.tran_id,
      // Users limited to other godowns (Admin → Permissions) are not told.
      godowns: [data.godown, data.godown2],
      extraUserIds: [salesPerson.id],
      vars: { vr_no: data.vr_no, customer: customer.acname || data.pycd },
    });
  } catch (error) {
    console.error("Error creating sale return reason notification:", error);
  }
}

/** TransactionsMaster updated. */
export async function transactionUpdated(data, prisma) {
  try {
    const voucherType = voucherTypeName(data.tran_code);
    const updater = await actorName(prisma, data.user_id);

    await emit(prisma, "transactionUpdated", {
      title: `${voucherType} Updated`,
      message: `${voucherType} #${data.vr_no} was modified by ${updater}`,
      type: NOTIFICATION_TYPES.WARNING,
      entity: "transaction",
      entityId: data.tran_id,
      // Users limited to other godowns (Admin → Permissions) are not told.
      godowns: [data.godown, data.godown2],
      actorUserId: data.user_id,
      actorTitle: "Voucher Updated",
      actorMessage: `${voucherType} #${data.vr_no} has been modified`,
      actorType: NOTIFICATION_TYPES.INFO,
      vars: { voucher_type: voucherType, vr_no: data.vr_no, actor: updater },
    });
  } catch (error) {
    console.error("Error creating transaction update notification:", error);
  }
}

/** GRN (tran_code 4): materials received, pending QC. */
export async function grnCreated(data, prisma) {
  try {
    const itemCount = await prisma.transactions.count({
      where: { tran_id: data.tran_id, sub_tran_id: 1 },
    });

    await emit(prisma, "grnCreated", {
      title: "Materials Received",
      message: `GRN #${data.vr_no} - ${itemCount} items received, pending QC approval`,
      type: NOTIFICATION_TYPES.WARNING,
      entity: "transaction",
      entityId: data.tran_id,
      // Users limited to other godowns (Admin → Permissions) are not told.
      godowns: [data.godown, data.godown2],
      expiryDays: NOTIFICATION_EXPIRY.URGENT,
      actorUserId: data.user_id,
      actorTitle: "GRN Created Successfully ✓",
      actorMessage: `GRN #${data.vr_no} created with ${itemCount} items`,
      actorType: NOTIFICATION_TYPES.SUCCESS,
      vars: { vr_no: data.vr_no, items: itemCount },
    });
  } catch (error) {
    console.error("❌ Error creating GRN notification:", error);
  }
}

/** Dispatch (tran_code 6): stock out against a sale order. */
export async function dispatchCreated(data, prisma) {
  try {
    const ref = data.dispatch_no ? `Dispatch #${data.dispatch_no}` : `Voucher #${data.vr_no}`;
    const so = data.so_no ? ` against SO #${data.so_no}` : "";

    await emit(prisma, "dispatchCreated", {
      title: "📤 Stock OUT - Dispatched",
      message: `${ref}${so} dispatched - Stock OUT complete`,
      type: NOTIFICATION_TYPES.SUCCESS,
      entity: "transaction",
      entityId: data.tran_id,
      // Users limited to other godowns (Admin → Permissions) are not told.
      godowns: [data.godown, data.godown2],
      actorUserId: data.user_id,
      actorTitle: "Dispatch Created Successfully ✓",
      actorMessage: `${ref}${so} has been created`,
      vars: { ref, so_no: data.so_no ?? "" },
    });
  } catch (error) {
    console.error("❌ Error creating dispatch notification:", error);
  }
}
