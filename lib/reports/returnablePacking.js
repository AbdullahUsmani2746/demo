// lib/reports/returnablePacking.js
// ============================================================
// RETURNABLE PACKING — who holds whose drums.
//
// Read from the document lines (lib/packing/returnable.js):
//
//   Customer side — our packing with the customer
//     + Dispatch (6)          line ticked returnable: no_of_pack of its packing
//     − Dispatch Return (10)  line ticked returnable: no_of_pack of its packing
//     − GRN (4) without PO    empty packing line (the drum itself, returnable)
//     − GRN (4) with a dispatch reference (the old method), packs of its items
//   Vendor side — the vendor's packing with us
//     + GRN (4)               line ticked returnable: no_of_pack of its packing
//     − GRN Return (9)        line ticked returnable, or an empty packing line
//
// Empty drums are not matched to a dispatch / GRN: they come off the party's
// balance as a whole, oldest first (FIFO) — which is also how the age of the
// oldest drums still out is worked out.
//
// filters: dateFrom, dateTo, view (balance | movements), side (all |
// customer | vendor), party, item (packing material), godown, showSettled.
// Every movement row carries tran_id + tran_code (opens its voucher).
// Packing materials = the item categories ticked "Packing material" in
// Settings → Production setup. Ported from SMS; Settings → Features
// "documents.returnablePacking" decides which documents carry packing — the
// report reads whatever the documents hold.
// ============================================================
import prisma from "@/lib/prisma";
import { getProductionSetup, isPackingCategory } from "@/lib/production/setup";

const DOC_LABEL = { 4: "GRN", 6: "Dispatch", 9: "GRN Return", 10: "Dispatch Return" };
const SIDE_LABEL = { customer: "Customer", vendor: "Vendor" };
const round3 = (n) => Math.round((Number(n) || 0) * 1000) / 1000;
const intOf = (v) => {
  const n = Number(v?.value ?? v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const DAY = 24 * 60 * 60 * 1000;

const LINE_SELECT = {
  id: true,
  itcd: true,
  packing_material_code: true,
  returnable: true,
  no_of_pack: true,
  qty: true,
  itemDetails: { select: { ic_id: true, item: true, code: true } },
  packingDetails: { select: { item: true, code: true } },
  transactionsMaster: {
    select: {
      tran_id: true,
      tran_code: true,
      dated: true,
      pycd: true,
      po_no: true,
      dispatch_no: true,
      grn_no: true,
      vr_no: true,
      manual_no: true,
      godown: true,
      acno: { select: { acname: true } },
      godownDetails: { select: { godown: true } },
    },
  },
};

/** One line → a packing movement, or null when it moves no returnable packing. */
function movementOf(line, { legacy = false, setup } = {}) {
  const m = line.transactionsMaster;
  if (!m) return null;
  const tc = Number(m.tran_code);
  const hasPacking = line.packing_material_code != null;
  const emptyPacking =
    !hasPacking && line.returnable === true && isPackingCategory(setup, line.itemDetails?.ic_id);
  const packs = Number(line.no_of_pack) || 0;
  const count = packs > 0 ? packs : Number(line.qty) || 0;

  let side = null;
  let sign = 0;
  let qty = 0;
  let packItcd = null;
  let packName = "";
  let packCode = "";
  let how = "";
  if (legacy) {
    // Old method: a GRN naming the dispatch the drums went out on.
    side = "customer";
    sign = -1;
    qty = packs;
    packItcd = line.itcd;
    packName = line.itemDetails?.item;
    packCode = line.itemDetails?.code;
    how = "Empty drums back (GRN, old method)";
  } else if (hasPacking && line.returnable === true && packs > 0) {
    packItcd = line.packing_material_code;
    packName = line.packingDetails?.item;
    packCode = line.packingDetails?.code;
    qty = packs;
    if (tc === 6) [side, sign, how] = ["customer", 1, "Sent with goods"];
    else if (tc === 10) [side, sign, how] = ["customer", -1, "Back with returned goods"];
    else if (tc === 4) [side, sign, how] = ["vendor", 1, "Received with goods"];
    else if (tc === 9) [side, sign, how] = ["vendor", -1, "Sent back with returned goods"];
  } else if (emptyPacking && count > 0) {
    packItcd = line.itcd;
    packName = line.itemDetails?.item;
    packCode = line.itemDetails?.code;
    qty = count;
    if (tc === 4 && m.po_no == null) [side, sign, how] = ["customer", -1, "Empty drums back"];
    else if (tc === 9) [side, sign, how] = ["vendor", -1, "Empty drums sent back"];
  }
  if (!side || !(qty > 0) || packItcd == null) return null;

  return {
    side,
    sign,
    qty: round3(qty),
    pack_itcd: packItcd,
    pack_code: packCode || "",
    pack_name: packName || `Item #${packItcd}`,
    pycd: m.pycd ?? null,
    party: m.acno?.acname || (m.pycd != null ? `#${m.pycd}` : "—"),
    dated: m.dated,
    tran_id: m.tran_id,
    tran_code: tc,
    doc_type: DOC_LABEL[tc] || `Tran ${tc}`,
    doc_no: m.dispatch_no ?? m.grn_no ?? m.vr_no ?? m.tran_id,
    manual_no: m.manual_no || "",
    godown: m.godownDetails?.godown || "",
    how,
  };
}

/** The period's last moment (dateTo, end of day) — CLAUDE.md date rule. */
const endOf = (v) => {
  const d = v ? new Date(v) : new Date();
  d.setHours(23, 59, 59, 999);
  return d;
};
/** The period's first moment (dateFrom, start of day), or null. */
const startOf = (v) => {
  if (!v) return null;
  const d = new Date(v);
  d.setHours(0, 0, 0, 0);
  return d;
};

async function loadMovements(filters) {
  const setup = await getProductionSetup();
  const dateTo = endOf(filters.dateTo);
  const godown = intOf(filters.godown);
  const masterWhere = {
    tran_code: { in: [4, 6, 9, 10] },
    dated: { lte: dateTo },
    ...(godown ? { godown } : {}),
  };
  const mainLine = { OR: [{ sub_tran_id: 1 }, { sub_tran_id: null }] };

  const [lines, legacy] = await Promise.all([
    prisma.transactions.findMany({
      where: { AND: [mainLine, { returnable: true }, { transactionsMaster: masterWhere }] },
      select: LINE_SELECT,
    }),
    prisma.transactions.findMany({
      where: {
        AND: [
          mainLine,
          { no_of_pack: { gt: 0 } },
          { OR: [{ returnable: false }, { returnable: null }] },
          { transactionsMaster: { ...masterWhere, tran_code: 4, ref_dispatch_no: { not: null } } },
        ],
      },
      select: LINE_SELECT,
    }),
  ]);

  const side = ["customer", "vendor"].includes(filters.side) ? filters.side : null;
  const party = intOf(filters.party);
  const item = intOf(filters.item);
  return [...lines.map((l) => movementOf(l, { setup })), ...legacy.map((l) => movementOf(l, { legacy: true, setup }))]
    .filter(Boolean)
    .filter((mv) => (!side || mv.side === side) && (!party || mv.pycd === party) && (!item || mv.pack_itcd === item))
    .sort((a, b) => new Date(a.dated) - new Date(b.dated) || a.tran_id - b.tran_id);
}

const keyOf = (mv) => `${mv.side}|${mv.pycd}|${mv.pack_itcd}`;

/** Balance view: one row per side × party × packing material. */
function balanceRows(movements, filters) {
  const from = startOf(filters.dateFrom);
  const to = endOf(filters.dateTo);
  const map = new Map();
  for (const mv of movements) {
    const k = keyOf(mv);
    if (!map.has(k)) {
      map.set(k, {
        side: SIDE_LABEL[mv.side],
        side_key: mv.side,
        pycd: mv.pycd,
        party: mv.party,
        pack_itcd: mv.pack_itcd,
        pack_code: mv.pack_code,
        pack_name: mv.pack_name,
        opening: 0,
        added: 0,
        returned: 0,
        balance: 0,
        ins: [],
        outTotal: 0,
      });
    }
    const r = map.get(k);
    const before = from && new Date(mv.dated) < from;
    if (before) r.opening += mv.sign * mv.qty;
    else if (mv.sign > 0) r.added += mv.qty;
    else r.returned += mv.qty;
    if (mv.sign > 0) r.ins.push({ dated: mv.dated, qty: mv.qty });
    else r.outTotal += mv.qty;
  }

  const rows = [];
  for (const r of map.values()) {
    r.balance = round3(r.opening + r.added - r.returned);
    // Oldest still out: returns used up oldest first (FIFO).
    let left = r.outTotal;
    let oldest = null;
    for (const e of r.ins) {
      if (left >= e.qty - 0.0005) {
        left -= e.qty;
        continue;
      }
      oldest = e.dated;
      break;
    }
    const { ins, outTotal, ...row } = r;
    rows.push({
      ...row,
      opening: round3(r.opening),
      added: round3(r.added),
      returned: round3(r.returned),
      with_whom: r.side_key === "customer" ? "With the customer" : "With us",
      oldest_out: r.balance > 0 && oldest ? oldest : null,
      days_out: r.balance > 0 && oldest ? Math.max(0, Math.floor((to - new Date(oldest)) / DAY)) : null,
    });
  }
  const showSettled = String(filters.showSettled) === "true";
  return rows
    .filter((r) => showSettled || Math.abs(r.balance) > 0.0005 || r.added || r.returned)
    .sort((a, b) => a.side.localeCompare(b.side) || a.party.localeCompare(b.party) || a.pack_name.localeCompare(b.pack_name));
}

/** Movements view: one row per document line, with a running balance per party × packing. */
function movementRows(movements, filters) {
  const from = startOf(filters.dateFrom);
  const running = new Map();
  const rows = [];
  for (const mv of movements) {
    const k = keyOf(mv);
    const bal = round3((running.get(k) || 0) + mv.sign * mv.qty);
    running.set(k, bal);
    if (from && new Date(mv.dated) < from) continue;
    rows.push({
      dated: mv.dated,
      doc_type: mv.doc_type,
      doc_no: mv.doc_no,
      manual_no: mv.manual_no,
      side: SIDE_LABEL[mv.side],
      pycd: mv.pycd,
      party: mv.party,
      pack_itcd: mv.pack_itcd,
      pack_code: mv.pack_code,
      pack_name: mv.pack_name,
      how: mv.how,
      godown: mv.godown,
      added: mv.sign > 0 ? mv.qty : null,
      returned: mv.sign < 0 ? mv.qty : null,
      balance: bal,
      tran_id: mv.tran_id,
      tran_code: mv.tran_code,
    });
  }
  return rows;
}

export async function getReturnablePackingReport(filters = {}) {
  const movements = await loadMovements(filters);
  return filters.view === "movements" ? movementRows(movements, filters) : balanceRows(movements, filters);
}

export function returnablePackingSummary(rows, filters = {}) {
  if (filters.view === "movements") {
    return {
      total_rows: rows.length,
      total_added: round3(rows.reduce((s, r) => s + (r.added || 0), 0)),
      total_returned: round3(rows.reduce((s, r) => s + (r.returned || 0), 0)),
    };
  }
  const sum = (side) => round3(rows.filter((r) => r.side_key === side).reduce((s, r) => s + r.balance, 0));
  return {
    with_customers: sum("customer"),
    with_us: sum("vendor"),
    parties_owing: new Set(rows.filter((r) => r.side_key === "customer" && r.balance > 0).map((r) => r.pycd)).size,
    oldest_days: rows.reduce((m, r) => Math.max(m, r.days_out ?? 0), 0),
  };
}
