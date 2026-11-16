import { checkPeriodLock } from "@/lib/periodLock";

// The GRN (tran_code 4) of one approved receipt QC (QualityMaster with
// order_no). One GRN per receipt: the quantity is what the store received on
// that receipt (QualityMaster.batch_size), not the whole ordered quantity, and
// a second partial receipt of the same item gets its own GRN. The order line is
// closed once the GRNs of the item cover the ordered quantity.
export async function createOrderGrn(tx, { order, orderDetail, qualityMaster, userId, itcd }) {
  if (qualityMaster?.grn_no && qualityMaster?.grn_status === "CREATED") {
    const existing = await tx.transactionsMaster.findFirst({
      where: { tran_code: 4, po_no: order.order_no, OR: [{ grn_no: Number(qualityMaster.grn_no) }, { vr_no: Number(qualityMaster.grn_no) }] },
      select: { tran_id: true, vr_no: true, grn_no: true },
    });
    if (existing) return { grnNo: existing.grn_no ?? existing.vr_no, tranId: existing.tran_id, created: false };
  }

  // The GRN posts tran_code 4 dated today; abort the whole QC update if locked
  const lockError = await checkPeriodLock(new Date(), 4, { db: tx, action: "create" });
  if (lockError) throw new Error(lockError);

  const qty = Number(qualityMaster?.batch_size) || 0;
  if (qty <= 0) throw new Error("The receipt has no received quantity — a GRN cannot be made.");
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
      po_qty: orderDetail.qty || 0,
      rate,
      damt: amount,
      gross_amount: amount,
      godown: order.godown,
      unit: orderDetail.unit || "",
      batch_no: qualityMaster?.batch_no != null ? String(qualityMaster.batch_no) : null,
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

  // Close the order line once its GRNs cover the ordered quantity.
  const received = await tx.transactions.aggregate({
    where: { itcd, sub_tran_id: 1, transactionsMaster: { tran_code: 4, po_no: order.order_no } },
    _sum: { qty: true },
  });
  if ((received._sum.qty || 0) >= (Number(orderDetail.qty) || 0) - 1e-9) {
    await tx.orderDetail.updateMany({ where: { order_no: order.order_no, itcd }, data: { status: 2 } });
    const pendingItems = await tx.orderDetail.count({ where: { order_no: order.order_no, status: { not: 2 } } });
    if (pendingItems === 0) {
      await tx.orderMaster.update({ where: { order_no: order.order_no }, data: { status: 2 } });
    }
  }

  return {
    grnNo: transactionMaster.vr_no || transactionMaster.grn_no,
    tranId: transactionMaster.tran_id,
    created: true,
  };
}
