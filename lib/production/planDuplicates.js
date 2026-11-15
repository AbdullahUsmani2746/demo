import prisma from "@/lib/prisma";

// Production Plan (ReqMaster DISPATCH) checks on a Sale Order item.
//
// • Manual Create / Edit Production Plan (app/api/material/requisition):
//   planQtyError — a Sale Order item may be split over plans (half today, half
//   tomorrow) but its total plan qty, over every plan, may not pass the Sale Order
//   item's qty; and an item already dispatched on the Sale Order (OrderDetail.status
//   2) is not planned.
// • Sale Order line's plan button / auto plan (lib/orders/soPlan.js):
//   planDuplicateError — the item is planned once (not when any plan already
//   has it) — plus dispatchedPlanError.
//
// Edit of an older plan is not blocked by what it already held: only a line
// that is new or whose qty went up is checked.
//
// Used while Features → Sale Order → "Plan production from the Sale Order line"
// (saleOrder.planFromOrder) is on — the callers check the switch.

const PLAN_CATEGORY = "DISPATCH";
const EPS = 0.0001;

const valOf = (v) => (v && typeof v === "object" ? v.value : v);
const intOf = (v) => {
  const n = Number(valOf(v));
  return Number.isInteger(n) && n > 0 ? n : null;
};
const keyOf = (so, itcd) => `${so}|${itcd}`;
const pairOf = (k) => k.split("|").map(Number);
const fmtQty = (n) => Number(n || 0).toLocaleString("en-US", { maximumFractionDigits: 2 });

// "SO 10489 — 0136EHR - REDUCTION MEDIUM" for each key
async function pairNamer(keys, db) {
  const itcds = [...new Set(keys.map((k) => pairOf(k)[1]))];
  const items = itcds.length
    ? await db.item.findMany({ where: { itcd: { in: itcds } }, select: { itcd: true, code: true, item: true } })
    : [];
  return (k) => {
    const [so, itcd] = pairOf(k);
    const it = items.find((i) => i.itcd === itcd);
    return `SO ${so} — ${it ? [it.code, it.item].filter(Boolean).join(" - ") : itcd}`;
  };
}

// The Sale Order lines of these pairs: ordered qty (KG) and whether every
// line of the item is dispatched / closed (status 2).
async function soLinesOf(keys, db) {
  const rows = await db.orderDetail.findMany({
    where: { OR: keys.map((k) => { const [order_no, itcd] = pairOf(k); return { order_no, itcd }; }) },
    select: { order_no: true, itcd: true, qty: true, status: true },
  });
  const by = new Map();
  for (const r of rows) {
    const k = keyOf(r.order_no, r.itcd);
    const o = by.get(k) || { ordered: 0, lines: 0, done: 0 };
    o.ordered += Number(r.qty) || 0;
    o.lines += 1;
    if (Number(r.status) === 2) o.done += 1;
    by.set(k, o);
  }
  return by;
}

// Pairs whose Sale Order item is already dispatched (every line status 2).
// lines: [{ so_no, itcd }]. Returns an error message, or null.
export async function dispatchedPlanError({ lines, db = prisma }) {
  const keys = [
    ...new Set(
      (lines || [])
        .map((l) => [intOf(l?.so_no), intOf(l?.itcd)])
        .filter(([so, itcd]) => so && itcd)
        .map(([so, itcd]) => keyOf(so, itcd)),
    ),
  ];
  if (!keys.length) return null;
  const so = await soLinesOf(keys, db);
  const done = keys.filter((k) => { const o = so.get(k); return o && o.lines > 0 && o.done === o.lines; });
  if (!done.length) return null;
  const name = await pairNamer(done, db);
  return `Already dispatched on the Sale Order — not planned: ${done.map(name).join(", ")}.`;
}

// Manual Production Plan (create / edit).
// lines: form lines [{ so_no, itcd, qty }]; tranId: the plan being edited
// (null on create); existingDetails: that plan's saved lines (edit).
// Returns an error message, or null.
export async function planQtyError({ lines, tranId = null, existingDetails = [], db = prisma }) {
  const here = new Map();
  for (const l of lines || []) {
    const so = intOf(l?.so_no);
    const itcd = intOf(l?.itcd);
    if (!so || !itcd) continue; // lines without a Sale Order are not checked
    const k = keyOf(so, itcd);
    here.set(k, (here.get(k) || 0) + (Number(l?.qty) || 0));
  }
  if (!here.size) return null;

  const before = new Map();
  for (const d of existingDetails || []) {
    const so = intOf(d?.so_no);
    const itcd = intOf(d?.itcd);
    if (!so || !itcd) continue;
    const k = keyOf(so, itcd);
    before.set(k, (before.get(k) || 0) + (Number(d?.qty) || 0));
  }

  // Only a line new to this plan, or whose qty went up, is checked
  const grown = [...here.keys()].filter((k) => !before.has(k) || here.get(k) > before.get(k) + EPS);
  if (!grown.length) return null;

  const so = await soLinesOf(grown, db);

  // Already dispatched on the Sale Order
  const dispatched = grown.filter((k) => { const o = so.get(k); return o && o.lines > 0 && o.done === o.lines; });

  // Total over every plan > Sale Order qty (an item not on that Sale Order is not capped)
  const capped = grown.filter((k) => so.has(k) && !dispatched.includes(k));
  const other = new Map();
  if (capped.length) {
    const rows = await db.reqDetail.findMany({
      where: {
        OR: capped.map((k) => { const [so_no, itcd] = pairOf(k); return { so_no, itcd }; }),
        master: { req_catagory: PLAN_CATEGORY },
        ...(tranId ? { tran_id: { not: Number(tranId) } } : {}),
      },
      select: { so_no: true, itcd: true, qty: true, tran_id: true },
    });
    for (const r of rows) {
      const k = keyOf(r.so_no, r.itcd);
      const o = other.get(k) || { qty: 0, plans: new Set() };
      o.qty += Number(r.qty) || 0;
      o.plans.add(r.tran_id);
      other.set(k, o);
    }
  }
  const over = capped.filter((k) => (other.get(k)?.qty || 0) + here.get(k) > so.get(k).ordered + EPS);

  if (!dispatched.length && !over.length) return null;

  const name = await pairNamer([...dispatched, ...over], db);
  const parts = [];
  if (dispatched.length) parts.push(`Already dispatched on the Sale Order — not planned: ${dispatched.map(name).join(", ")}`);
  if (over.length) {
    parts.push(
      `More than the Sale Order qty: ${over
        .map((k) => {
          const ordered = so.get(k).ordered;
          const o = other.get(k);
          const planned = o?.qty || 0;
          const left = Math.max(0, ordered - planned);
          return (
            `${name(k)} — Sale Order qty ${fmtQty(ordered)}` +
            (planned ? `, already planned ${fmtQty(planned)} (Plan #${[...o.plans].join(", #")})` : "") +
            `, this plan ${fmtQty(here.get(k))}, max ${fmtQty(left)}`
          );
        })
        .join("; ")}`,
    );
  }
  return `${parts.join(". ")}.`;
}

// Sale Order line → plan (auto): the SO + item is planned once — not twice
// in the request and not when any plan already has it.
// lines: [{ so_no, itcd }]. Returns an error message, or null.
export async function planDuplicateError({ lines, tranId = null, existingDetails = [], db = prisma }) {
  const count = new Map();
  for (const l of lines || []) {
    const so = intOf(l?.so_no);
    const itcd = intOf(l?.itcd);
    if (!so || !itcd) continue; // lines without a Sale Order are not checked
    const k = keyOf(so, itcd);
    count.set(k, (count.get(k) || 0) + 1);
  }
  if (!count.size) return null;

  const before = new Map();
  for (const d of existingDetails || []) {
    const so = intOf(d?.so_no);
    const itcd = intOf(d?.itcd);
    if (!so || !itcd) continue;
    const k = keyOf(so, itcd);
    before.set(k, (before.get(k) || 0) + 1);
  }

  // Twice in this plan (more often than it already was)
  const twiceHere = [...count].filter(([k, n]) => n > Math.max(1, before.get(k) || 0)).map(([k]) => k);

  // New to this plan, but another DISPATCH plan already has it
  const fresh = [...count.keys()].filter((k) => !before.has(k));
  let elsewhere = [];
  if (fresh.length) {
    const pairs = fresh.map(pairOf);
    const rows = await db.reqDetail.findMany({
      where: {
        OR: pairs.map(([so_no, itcd]) => ({ so_no, itcd })),
        master: { req_catagory: PLAN_CATEGORY },
        ...(tranId ? { tran_id: { not: Number(tranId) } } : {}),
      },
      select: { so_no: true, itcd: true, tran_id: true },
    });
    const planOf = new Map();
    for (const r of rows) {
      const k = keyOf(r.so_no, r.itcd);
      if (!planOf.has(k)) planOf.set(k, r.tran_id);
    }
    elsewhere = [...planOf];
  }

  if (!twiceHere.length && !elsewhere.length) return null;

  const name = await pairNamer([...twiceHere, ...elsewhere.map(([k]) => k)], db);
  const parts = [];
  if (twiceHere.length) parts.push(`Same item twice in this plan: ${twiceHere.map(name).join(", ")}`);
  if (elsewhere.length)
    parts.push(`Already in another Production Plan: ${elsewhere.map(([k, plan]) => `${name(k)} (Plan #${plan})`).join(", ")}`);
  return `${parts.join(". ")}. A Sale Order item is planned only once.`;
}
