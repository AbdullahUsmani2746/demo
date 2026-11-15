import prisma from "@/lib/prisma";

// Stock movement tran_codes
const IN_CODES  = [4, 8, 10, 12]; // GRN, Production, Sale Return, Misc IN
const OUT_CODES = [5, 6, 7, 9];   // POS, Dispatch, Material Issue, Purchase Return

/**
 * Batch Balance Report — computed directly from Transactions.batch_no.
 * Shows current quantity per batch per item (per godown), with valuation.
 * Filters: itcd, godown, batch_no, showEmpty.
 */
export async function getBatchBalanceReport({
  itcd,
  godown,
  batch_no,
  showEmpty = false,
} = {}) {
  const lines = await prisma.transactions.findMany({
    where: {
      batch_no:    { not: null },
      sub_tran_id: { not: 3 },
      ...(itcd     ? { itcd: parseInt(itcd) } : {}),
      ...(batch_no ? { batch_no: String(batch_no) } : {}),
      transactionsMaster: {
        tran_code: { in: [...IN_CODES, ...OUT_CODES] },
        ...(godown ? { godown: parseInt(godown) } : {}),
      },
    },
    select: {
      itcd:     true,
      batch_no: true,
      qty:      true,
      rate:     true,
      itemDetails:  { select: { item: true, unit: true } },
      transactionsMaster: { select: { tran_code: true, dated: true, godown: true, godownDetails: { select: { godown: true } } } },
    },
  });

  // Aggregate per (itcd, godown, batch_no)
  const map = new Map();
  for (const l of lines) {
    const tc   = l.transactionsMaster?.tran_code;
    const gId  = l.transactionsMaster?.godown ?? null;
    const key  = `${l.itcd}|${gId}|${l.batch_no}`;
    const q    = l.qty || 0;

    if (!map.has(key)) {
      map.set(key, {
        itcd:        l.itcd,
        item_name:   l.itemDetails?.item || "",
        unit:        l.itemDetails?.unit || "",
        godown_id:   gId,
        godown_name: l.transactionsMaster?.godownDetails?.godown || "—",
        batch_no:    l.batch_no,
        qty_in:      0,
        qty_out:     0,
        balance:     0,
        rate:        l.rate ?? null,
        first_grn_at: l.transactionsMaster?.dated || null,
      });
    }
    const row = map.get(key);
    if (IN_CODES.includes(tc))  { row.qty_in  += q; row.balance += q; }
    if (OUT_CODES.includes(tc)) { row.qty_out += q; row.balance -= q; }
    if (l.rate) row.rate = l.rate;
  }

  let data = Array.from(map.values()).map((r) => ({
    ...r,
    balance: Number(r.balance.toFixed(4)),
    value:   r.rate != null ? Number((r.balance * r.rate).toFixed(2)) : null,
  }));

  if (!showEmpty) data = data.filter((r) => r.balance > 0.0001);
  data.sort((a, b) => (a.itcd - b.itcd) || new Date(a.first_grn_at || 0) - new Date(b.first_grn_at || 0));

  const summary = {
    total_batches: data.length,
    total_balance: Number(data.reduce((s, r) => s + (r.balance || 0), 0).toFixed(4)),
    total_value:   Number(data.reduce((s, r) => s + (r.value  || 0), 0).toFixed(2)),
  };

  return { data, summary };
}
