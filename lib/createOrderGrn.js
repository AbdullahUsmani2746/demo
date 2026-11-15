import { checkPeriodLock } from "@/lib/periodLock";

export async function createOrderGrn(tx, { order, orderDetail, qualityMaster, userId, itcd }) {
  const existingGRN = await tx.transactionsMaster.findFirst({
    where: {
      po_no: order.order_no,
      tran_code: 4,
      transactions: {
        some: { itcd },
      },
    },
  });

  if (existingGRN) {
    return {
      grnNo: existingGRN.vr_no || existingGRN.grn_no,
      tranId: existingGRN.tran_id,
      created: false,
    };
  }

  // The GRN posts tran_code 4 dated today; abort the whole QC update if locked
  const lockError = await checkPeriodLock(new Date(), 4, { db: tx, action: "create" });
  if (lockError) throw new Error(lockError);

  const qty = orderDetail.qty || 0;
  const rate = orderDetail.rate || 0;
  const amount = qty * rate;

  const transactionMaster = await tx.transactionsMaster.create({
    data: {
      dated: new Date(),
      time: new Date(),
      tran_code: 4,
      po_no: order.order_no,
      pycd: order.party_code,
      godown: order.godown,
      user_id: userId,
      rmk: `GRN created from QC for Order #${order.order_no}`,
      rmk1: `Item: ${orderDetail.items?.item || `ITCD ${itcd}`}`,
      rmk2: `Batch: ${qualityMaster?.batch_no || ""}`,
    },
    select: {
      vr_no: true,
      grn_no: true,
      tran_id: true,
    },
  });

  await tx.transactions.create({
    data: {
      tran_id: transactionMaster.tran_id,
      itcd,
      qty,
      po_qty: qty,
      rate,
      damt: amount,
      gross_amount: amount,
      godown: order.godown,
      unit: orderDetail.unit || "",
      sub_tran_id: 1,
      narration1: `for Order #${order.order_no}`,
      narration2: orderDetail.items?.item || `Item ${itcd}`,
      narration3: `Batch: ${qualityMaster?.batch_no || ""}`,
      narration4: `Vendor: ${order.acno?.acname || ""}`,
    },
  });

  await tx.transactions.create({
    data: {
      tran_id: transactionMaster.tran_id,
      acno: order.party_code,
      camt: amount,
      sub_tran_id: 3,
      narration1: `Order #${order.order_no}`,
    },
  });

  await tx.orderDetail.updateMany({
    where: {
      order_no: order.order_no,
      itcd,
    },
    data: {
      status: 2,
    },
  });

  const pendingItems = await tx.orderDetail.count({
    where: {
      order_no: order.order_no,
      status: { not: 2 },
    },
  });

  if (pendingItems === 0) {
    await tx.orderMaster.update({
      where: { order_no: order.order_no },
      data: { status: 2 },
    });
  }

  return {
    grnNo: transactionMaster.vr_no || transactionMaster.grn_no,
    tranId: transactionMaster.tran_id,
    created: true,
  };
}
