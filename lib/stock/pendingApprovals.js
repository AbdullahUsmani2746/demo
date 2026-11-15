// lib/stock/pendingApprovals.js
// ============================================================
// Stock held by vouchers waiting on /dashboard/approvals.
//
// A voucher held by an approval rule (ApprovalRequest, status "pending") is
// not posted, so it is not in Transactions — but its stock is spoken for.
// 100 in the godown and a 50-qty Material Issue waiting for approval →
// 50 available. Every stock CHECK subtracts the pending OUT qty, and the
// stock reports show it in its own columns / rows:
//
//   GET  available = posted stock − pending OUT
//   (pending IN is shown, never counted as available: it may be rejected)
//
// Moves (same tran_codes as the stock formula):
//   IN : 4, 8, 10, 12 into master.godown, 11 into master.godown2
//   OUT: 5, 6, 7, 9 from master.godown,   11 from master.godown
// An EDIT request counts only what it adds on top of the posted voucher
// (posted qty is already in stock): pending − posted, per item and godown,
// when positive. A reduction frees nothing until it is approved.
//
// Only "pending" requests: once approved the request is "posting", then the
// voucher itself is in Transactions — counted once, never twice.
// ============================================================
import prisma from "@/lib/prisma";

const PENDING = "pending"; // REQUEST_STATUS.PENDING (lib/approvals/rules.js)
const IN_CODES = new Set([4, 8, 10, 12]);
const OUT_CODES = new Set([5, 6, 7, 9]);
const STOCK_CODES = [4, 5, 6, 7, 8, 9, 10, 11, 12];

const val = (v) => (v && typeof v === "object" ? v.value : v);
const int = (v) => {
  const n = parseInt(val(v), 10);
  return Number.isFinite(n) ? n : null;
};
const num = (v) => {
  const n = parseFloat(val(v));
  return Number.isFinite(n) ? n : 0;
};

/** { godown, itcd, inQty, outQty } moves of one voucher's stock lines. */
function movesOf(tranCode, master, lines) {
  const moves = [];
  const add = (godown, itcd, inQty, outQty) => {
    if (godown == null || itcd == null || (!inQty && !outQty)) return;
    // A negative qty moves the other way (e.g. an Issue of −2 brings stock
    // back) — pending stock coming back is IN, never freed-up OUT
    const net = inQty - outQty;
    moves.push({ godown, itcd, inQty: Math.max(0, net), outQty: Math.max(0, -net) });
  };
  for (const line of lines || []) {
    if (line?.sub_tran_id != null && Number(line.sub_tran_id) === 3) continue;
    const itcd = int(line?.itcd);
    const qty = num(line?.qty);
    if (itcd == null || !qty) continue;
    const godown = int(line?.godown) ?? int(master?.godown);
    if (IN_CODES.has(tranCode)) add(godown, itcd, qty, 0);
    else if (OUT_CODES.has(tranCode)) add(godown, itcd, 0, qty);
    else if (tranCode === 11) {
      add(int(master?.godown), itcd, 0, qty);
      add(int(master?.godown2), itcd, qty, 0);
    }
  }
  return moves;
}

// Sum moves per godown + item
function byKey(moves) {
  const map = new Map();
  for (const m of moves) {
    const key = `${m.godown}:${m.itcd}`;
    const e = map.get(key) || { godown: m.godown, itcd: m.itcd, inQty: 0, outQty: 0 };
    e.inQty += m.inQty;
    e.outQty += m.outQty;
    map.set(key, e);
  }
  return map;
}

/**
 * Every pending voucher's stock moves.
 * @param {{ itcds?: number[], godown?: number|null, excludeRequestIds?: number[], db?: object }} [opts]
 *   excludeRequestIds: the request being re-opened by its requester, so its
 *   own qty is not held against itself.
 * @returns {Promise<Array<{ requestId, ref, docType, tranCode, action, targetId,
 *   dated, requestedBy, requestedAt, godown, itcd, inQty, outQty }>>}
 */
export async function getPendingStockMoves({ itcds = null, godown = null, excludeRequestIds = [], db = prisma } = {}) {
  const exclude = (excludeRequestIds || []).map(Number).filter(Number.isFinite);
  const requests = await db.approvalRequest.findMany({
    where: {
      status: PENDING,
      kind: "voucher",
      tran_code: { in: STOCK_CODES },
      ...(exclude.length ? { id: { notIn: exclude } } : {}),
    },
    select: {
      id: true, doc_type: true, tran_code: true, action: true, target_id: true,
      payload: true, requested_by: true, requested_at: true,
    },
    orderBy: { id: "asc" },
  });
  if (!requests.length) return [];

  // Posted lines of the vouchers an edit request is for
  const targetIds = requests
    .filter((r) => r.action === "update" && int(r.target_id) != null)
    .map((r) => int(r.target_id));
  const posted = new Map();
  if (targetIds.length) {
    const masters = await db.transactionsMaster.findMany({
      where: { tran_id: { in: targetIds } },
      select: {
        tran_id: true, tran_code: true, godown: true, godown2: true,
        transactions: { select: { itcd: true, qty: true, godown: true, sub_tran_id: true } },
      },
    });
    for (const m of masters) posted.set(m.tran_id, byKey(movesOf(m.tran_code, m, m.transactions)));
  }

  const itemSet = itcds ? new Set(itcds.map(Number)) : null;
  const g = godown == null || godown === "" ? null : int(godown);
  const out = [];
  for (const r of requests) {
    const payload = r.payload || {};
    const master = payload.master || {};
    const tranCode = int(master.tran_code) ?? r.tran_code;
    let moves = [...byKey(movesOf(tranCode, master, payload.lines)).values()];

    if (r.action === "update") {
      const was = posted.get(int(r.target_id)) || new Map();
      moves = moves.map((m) => {
        const p = was.get(`${m.godown}:${m.itcd}`);
        return {
          ...m,
          inQty: Math.max(0, m.inQty - (p?.inQty || 0)),
          outQty: Math.max(0, m.outQty - (p?.outQty || 0)),
        };
      });
    }

    const dated = master.dated ? new Date(master.dated) : null;
    for (const m of moves) {
      if (!m.inQty && !m.outQty) continue;
      if (itemSet && !itemSet.has(m.itcd)) continue;
      if (g != null && m.godown !== g) continue;
      out.push({
        requestId: r.id,
        ref: `R-${r.id}`,
        docType: r.doc_type,
        tranCode,
        action: r.action,
        targetId: r.target_id,
        dated: dated && !isNaN(dated.getTime()) ? dated : r.requested_at,
        requestedBy: r.requested_by,
        requestedAt: r.requested_at,
        ...m,
      });
    }
  }
  return out;
}

/**
 * Pending qty per item: { in, out } — of one godown, or all godowns
 * (godown null: a pending transfer moves stock between godowns, so it is
 * left out of the all-godowns figure, as in the stock formula).
 * @returns {Promise<Map<number, { in: number, out: number }>>}
 */
export async function getPendingByItem(itcds, godown = null, opts = {}) {
  const moves = await getPendingStockMoves({ ...opts, itcds, godown });
  const all = godown == null || godown === "";
  const map = new Map();
  for (const m of moves) {
    if (all && m.tranCode === 11) continue;
    const e = map.get(m.itcd) || { in: 0, out: 0 };
    e.in += m.inQty;
    e.out += m.outQty;
    map.set(m.itcd, e);
  }
  return map;
}

/** Pending OUT qty per item in one godown (Map itcd → qty). */
export async function getPendingOutQty(itcds, godown, opts = {}) {
  const map = await getPendingByItem(itcds, godown, opts);
  return new Map([...map].map(([itcd, e]) => [itcd, e.out]));
}

/**
 * The approval request a form is re-opening (…?approvalRequest=73 on the
 * page that called the API), so its own qty is not held against itself.
 */
export function reopenedRequestIds(req, body = null) {
  const ids = [];
  const fromBody = int(body?.excludeRequestId ?? body?.approvalRequestId);
  if (fromBody != null) ids.push(fromBody);
  try {
    const url = new URL(req.url);
    const own = int(url.searchParams.get("excludeRequestId"));
    if (own != null) ids.push(own);
    const referer = req.headers.get("referer");
    if (referer) {
      const r = int(new URL(referer).searchParams.get("approvalRequest"));
      if (r != null) ids.push(r);
    }
  } catch {
    // no / bad referer — nothing to exclude
  }
  return ids;
}
