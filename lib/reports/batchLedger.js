import prisma from "@/lib/prisma";

/**
 * Batch Ledger Report
 * Shows all IN and OUT movements for a specific batch (or all batches for an item).
 * Pulls from Transactions table joined to TransactionsMaster.
 */
export async function getBatchLedgerReport({
  itcd,
  batch_no,
  godown,
  dateFrom,
  dateTo,
} = {}) {
  if (!itcd && !batch_no) {
    return { data: [], summary: { total_in: 0, total_out: 0, net: 0 } };
  }

  const start = dateFrom ? new Date(dateFrom) : new Date("2000-01-01");
  const end   = dateTo   ? new Date(dateTo)   : new Date();
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  // tran_codes that affect stock
  const STOCK_IN  = [4, 8, 10, 12];
  const STOCK_OUT = [5, 6, 7, 9];
  const ALL_CODES = [...STOCK_IN, ...STOCK_OUT];

  const where = {
    sub_tran_id: { not: 3 },  // exclude control rows
    transactionsMaster: {
      tran_code: { in: ALL_CODES },
      dated:     { gte: start, lte: end },
      ...(godown ? { godown: parseInt(godown) } : {}),
    },
    ...(itcd     ? { itcd:     parseInt(itcd)   } : {}),
    ...(batch_no ? { batch_no: String(batch_no) } : {}),
  };

  const rows = await prisma.transactions.findMany({
    where,
    orderBy: { transactionsMaster: { dated: "asc" } },
    include: {
      transactionsMaster: {
        select: { tran_id: true, dated: true, tran_code: true, rmk1: true, vr_no: true, grn_no: true, dispatch_no: true },
      },
      itemDetails:  { select: { item: true, unit: true } },
      godownDetails: { select: { godown: true } },
    },
  });

  let running = 0;
  const data = rows.map((r) => {
    const tc   = r.transactionsMaster?.tran_code;
    const isIn = STOCK_IN.includes(tc);
    const qty  = r.qty ?? 0;

    const qty_in  = isIn ? qty : 0;
    const qty_out = isIn ? 0   : qty;
    running += qty_in - qty_out;

    return {
      dated:        r.transactionsMaster?.dated,
      tran_id:      r.transactionsMaster?.tran_id,
      tran_code:    tc,
      rmk1:         r.transactionsMaster?.rmk1 ?? null, // landed Material Issue page (voucherLink)
      vr_no:        r.transactionsMaster?.vr_no ?? r.transactionsMaster?.grn_no ?? r.transactionsMaster?.dispatch_no,
      item_name:    r.itemDetails?.item ?? "",
      unit:         r.itemDetails?.unit ?? "",
      godown_name:  r.godownDetails?.godown ?? "",
      batch_no:     r.batch_no ?? "",
      qty_in,
      qty_out,
      balance:      running,
      rate:         r.rate,
    };
  });

  const summary = {
    total_in:  data.reduce((s, r) => s + r.qty_in,  0),
    total_out: data.reduce((s, r) => s + r.qty_out, 0),
    net:       running,
  };

  return { data, summary };
}
