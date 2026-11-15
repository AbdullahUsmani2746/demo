// lib/reports/isoTimeline.js — Sale Order To Invoice Time Tracking (report key
// "isoTimeline", kept from the Eastland port). Features → Sale Order → "Plan
// production from the Sale Order line" (saleOrder.planFromOrder).
//
// One row per Sale Order item line; where the item is on dispatch Production
// Plan lines (ReqMaster DISPATCH → ReqDetail) one row per plan line.
//
//   Sale Order             OrderMaster.created_at (dated for older orders)
//   Approval               OrderMaster.approved_at ("Under Approval" at status 3)
//   Production Plan        ReqDetail.updated_at, else created_at / the plan's created_at
//   Lab Input              ReqDetail.nature_at (Features: production.labNature)
//   Process Order Posting  the first posted Process Order of this plan + item
//                          (+ this Sale Order, or none) — sent_to_production_date
//   Dispatch               the first dispatch of this Sale Order + item — with a
//                          plan, the one whose line carries that Plan No
//   Invoice Generation     that dispatch's TransactionsMaster.invoiced_at
//   Total                  Invoice Generation − Sale Order
//
// Times are returned as ISO strings (formatted by the report engine in the
// viewer's own settings — no fixed timezone here). Each row carries the
// dispatch's tran_id / tran_code (6) for the voucher drill and order_no for
// the Sale Order.
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { scopedSalesPersons, parseSalesPersonList, NO_SALES_PERSON } from "@/lib/auth/salesScope";

const SO_CATEGORY = 6;

const iso = (d) => {
  if (!d) return null;
  const t = new Date(d);
  return isNaN(t.getTime()) ? null : t.toISOString();
};

// "2d 3h 15m" between two times; "" if either is missing or reversed.
function duration(from, to) {
  if (!from || !to) return "";
  const toMinute = (d) => Math.floor(new Date(d).getTime() / 60000);
  const mins = toMinute(to) - toMinute(from);
  if (!(mins >= 0)) return "";
  const d = Math.floor(mins / 1440);
  const h = Math.floor((mins % 1440) / 60);
  const m = mins % 60;
  return [d && `${d}d`, (d || h) && `${h}h`, `${m}m`].filter(Boolean).join(" ");
}

// Which customers this report may show, as ACNO.salesArea values (user id or
// username) — the sales scope rule (lib/auth/salesScope.js). null = no limit.
async function salesAreasFor(session, salePerson) {
  const ids = session ? await scopedSalesPersons(session, salePerson) : parseSalesPersonList(salePerson);
  if (!ids) return null;
  const users = await prisma.user.findMany({
    where: { OR: [{ id: { in: ids } }, { username: { in: ids } }] },
    select: { id: true, username: true },
  });
  const areas = users.flatMap((u) => [u.id, u.username].filter(Boolean));
  return areas.length ? areas : [NO_SALES_PERSON];
}

async function salesPersonNames(rows) {
  const keys = [...new Set(rows.map((r) => r.sales_area).filter(Boolean))];
  const users = keys.length
    ? await prisma.user.findMany({
        where: { OR: [{ id: { in: keys } }, { username: { in: keys } }] },
        select: { id: true, username: true, name: true },
      })
    : [];
  const map = new Map();
  for (const u of users) {
    const name = u.name || u.username || u.id;
    map.set(u.id, name);
    if (u.username) map.set(u.username, name);
  }
  return map;
}

const dayStart = (v) => {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d)) return null;
  d.setHours(0, 0, 0, 0);
  return d;
};
const dayEnd = (v) => {
  if (!v) return null;
  const d = new Date(v);
  if (isNaN(d)) return null;
  d.setHours(23, 59, 59, 999);
  return d;
};

export async function getIsoTimelineReport({
  dateFrom, dateTo, so_no, customer, sale_person, process_status, plan_status, lab_status,
  dispatch_status, invoice_status, plan_no, nature, soDateFrom, soDateTo, session = null,
} = {}) {
  const planNo = parseInt(plan_no) || null;
  const start = dayStart(dateFrom) || new Date("2000-01-01T00:00:00");
  const end = dayEnd(dateTo) || dayEnd(new Date());
  const soFrom = dayStart(soDateFrom);
  const soTo = dayEnd(soDateTo);
  const salesAreas = await salesAreasFor(session, sale_person);

  const rows = await prisma.$queryRaw(timelineSql({ start, end, so_no, customer, salesAreas, planNo, soFrom, soTo }));
  if (!rows.length) return { data: [], summary: emptySummary() };
  const names = await salesPersonNames(rows);

  const built = rows.map((r) => {
    const hasPlan = r.plan_no != null;
    const pick = (p) =>
      r[`${p}_tran_id`] == null
        ? null
        : { tran_id: r[`${p}_tran_id`], dispatch_no: r[`${p}_dispatch_no`], at: r[`${p}_at`], invoice_no: r[`${p}_invoice_no`], invoiced_at: r[`${p}_invoiced_at`] };
    // With a plan: the dispatch whose line names this Plan No; a dispatch with
    // no Plan No counts unless this item has a dispatch naming one of its plans.
    const dispatch = hasPlan ? pick("dp") ?? (r.matched_by_plan ? null : pick("ds")) : pick("ds");
    const soAt = r.created_at || r.dated;
    const invoicedAt = dispatch?.invoiced_at || null;
    return {
      order_no: r.order_no,
      so_no: r.order_no,
      customer: r.acname ?? "",
      sales_person: r.sales_area ? names.get(r.sales_area) || "" : "",
      is_urgent: r.urgency_level === true,
      code: r.item_code ?? "",
      item: r.item_name ?? "",
      plan_no: hasPlan ? r.plan_no : null,
      nature: hasPlan ? r.nature ?? "" : "",
      so_at: iso(soAt),
      approval_at: r.under_approval ? "Under Approval" : iso(r.approved_at) ?? "",
      plan_at: hasPlan ? iso(r.plan_updated_at || r.plan_created_at || r.m_created_at || r.m_dated) : null,
      lab_at: hasPlan ? iso(r.nature_at) : null,
      process_at: hasPlan ? iso(r.posted_at) : null,
      process_order_no: hasPlan ? r.posted_po ?? null : null,
      dispatch_no: dispatch?.dispatch_no ?? "",
      dispatch_at: iso(dispatch?.at),
      invoice_no: dispatch?.invoice_no ?? "",
      invoice_at: iso(invoicedAt),
      total: duration(soAt, invoicedAt),
      // Voucher drill: the dispatch (CLAUDE.md rule 15)
      tran_id: dispatch?.tran_id ?? null,
      tran_code: dispatch ? 6 : null,
      _ts: soAt ? new Date(soAt).getTime() : 0,
    };
  });

  const stage = (status, field) => (list) =>
    status === "empty" ? list.filter((r) => !r[field]) : status === "filled" || status === "posted" ? list.filter((r) => !!r[field]) : list;
  let out = planNo ? built.filter((r) => Number(r.plan_no) === planNo) : built;
  for (const f of [
    stage(process_status, "process_at"),
    stage(plan_status, "plan_at"),
    stage(lab_status, "lab_at"),
    stage(dispatch_status, "dispatch_at"),
    stage(invoice_status, "invoice_at"),
  ]) out = f(out);
  const wanted = String(nature || "").trim().toUpperCase();
  if (wanted) out = out.filter((r) => String(r.nature || "").trim().toUpperCase() === wanted);

  out.sort((a, b) => b._ts - a._ts || b.order_no - a.order_no || (a.plan_no || 0) - (b.plan_no || 0));
  const summary = {
    total_lines: out.length,
    total_orders: new Set(out.map((r) => r.order_no)).size,
    planned: out.filter((r) => r.plan_no != null).length,
    dispatched: out.filter((r) => r.dispatch_at).length,
    invoiced: out.filter((r) => r.invoice_at).length,
  };
  return { data: out.map(({ _ts, ...r }) => r), summary };
}

/** The report's one query. */
function timelineSql({ start, end, so_no, customer, salesAreas, planNo, soFrom, soTo }) {
  return Prisma.sql`
    WITH so AS (
      SELECT om.order_no, om.dated, om.created_at, om.urgency_level, a.acname, a.sales_ares AS sales_area,
             CASE WHEN om.status <> 4 THEN om.approved_at END AS approved_at,
             (om.status = 3) AS under_approval
      FROM "OrderMaster" om
      JOIN "acno" a ON a.acno = om.party_code
      WHERE om.order_catagory = ${SO_CATEGORY}
        ${soFrom || soTo ? Prisma.empty : Prisma.sql`AND om.dated >= ${start} AND om.dated <= ${end}`}
        ${soFrom ? Prisma.sql`AND COALESCE(om.created_at, om.dated) >= ${soFrom}` : Prisma.empty}
        ${soTo ? Prisma.sql`AND COALESCE(om.created_at, om.dated) <= ${soTo}` : Prisma.empty}
        ${so_no ? Prisma.sql`AND om.order_no = ${parseInt(so_no)}` : Prisma.empty}
        ${customer ? Prisma.sql`AND om.party_code = ${parseInt(customer)}` : Prisma.empty}
        ${salesAreas ? Prisma.sql`AND a.sales_ares = ANY(${salesAreas}::text[])` : Prisma.empty}
        ${planNo ? Prisma.sql`AND om.order_no IN (SELECT rd0.so_no FROM "ReqDetail" rd0 WHERE rd0.tran_id = ${planNo})` : Prisma.empty}
    ),
    lines AS (
      SELECT DISTINCT ON (od.order_no, od.itcd) od.order_no, od.itcd, od.id
      FROM "OrderDetail" od
      JOIN so ON so.order_no = od.order_no
      WHERE od.itcd IS NOT NULL
      ORDER BY od.order_no, od.itcd, od.id
    ),
    plans AS (
      SELECT rd.id, rd.tran_id, rd.itcd, rd.so_no, rd.nature, rd.nature_at, rd.created_at, rd.updated_at,
             rm.created_at AS m_created_at, rm.dated AS m_dated
      FROM "ReqDetail" rd
      JOIN "ReqMaster" rm ON rm.tran_id = rd.tran_id
      WHERE rm.req_catagory = 'DISPATCH'
        AND rd.so_no IN (SELECT order_no FROM so)
    ),
    -- Posted Process Orders of those plans, one row per item they produce
    -- (multi-output orders count for every output)
    po_items AS (
      SELECT pp.id, pp.req_no, pp.sale_ord_no, x.finished_id,
             COALESCE(pp.sent_to_production_date, pp.dated) AS posted_at
      FROM "productionPlanMaster" pp
      CROSS JOIN LATERAL (
        SELECT pp.finished_id
        UNION
        SELECT o.finished_id FROM "productionPlanOutput" o WHERE o.plan_id = pp.id
      ) x
      WHERE pp.status = 'Posted'
        AND x.finished_id IS NOT NULL
        AND pp.req_no IN (SELECT tran_id FROM plans)
    ),
    posted AS (
      SELECT DISTINCT ON (req_no, finished_id, sale_ord_no) req_no, finished_id, sale_ord_no, posted_at, id
      FROM po_items
      ORDER BY req_no, finished_id, sale_ord_no, posted_at, id
    ),
    disp AS (
      SELECT t.plan_no, t.itcd, tm.so_no, tm.tran_id, tm.dispatch_no, tm.invoice_no,
             tm.invoiced_at, COALESCE(tm.created_at, tm.dated) AS at
      FROM "TRANSACTIONS_MASTER" tm
      JOIN "Transactions" t ON t.tran_id = tm.tran_id
      WHERE tm.tran_code = 6
        AND t.sub_tran_id = 1
        AND tm.so_no IN (SELECT order_no FROM so)
    ),
    disp_plan AS (
      SELECT DISTINCT ON (plan_no, itcd, so_no) * FROM disp WHERE plan_no IS NOT NULL
      ORDER BY plan_no, itcd, so_no, at, tran_id
    ),
    disp_so AS (
      SELECT DISTINCT ON (so_no, itcd) * FROM disp
      ORDER BY so_no, itcd, at, tran_id
    ),
    matched AS (
      SELECT DISTINCT d.so_no, d.itcd
      FROM disp d
      JOIN plans p ON p.tran_id = d.plan_no AND p.itcd = d.itcd AND p.so_no = d.so_no
    )
    SELECT
      so.order_no, so.dated, so.created_at, so.urgency_level, so.acname, so.sales_area, so.approved_at, so.under_approval,
      l.itcd, it.code AS item_code, it.item AS item_name,
      p.tran_id AS plan_no, p.nature, p.nature_at, p.created_at AS plan_created_at,
      p.updated_at AS plan_updated_at, p.m_created_at, p.m_dated,
      COALESCE(po.posted_at, pn.posted_at) AS posted_at,
      COALESCE(po.id, pn.id) AS posted_po,
      (mt.so_no IS NOT NULL) AS matched_by_plan,
      dp.tran_id AS dp_tran_id, dp.dispatch_no AS dp_dispatch_no, dp.at AS dp_at, dp.invoice_no AS dp_invoice_no, dp.invoiced_at AS dp_invoiced_at,
      ds.tran_id AS ds_tran_id, ds.dispatch_no AS ds_dispatch_no, ds.at AS ds_at, ds.invoice_no AS ds_invoice_no, ds.invoiced_at AS ds_invoiced_at
    FROM lines l
    JOIN so ON so.order_no = l.order_no
    LEFT JOIN "Item" it ON it.itcd = l.itcd
    LEFT JOIN plans p ON p.so_no = l.order_no AND p.itcd = l.itcd
    LEFT JOIN posted po ON po.req_no = p.tran_id AND po.finished_id = l.itcd AND po.sale_ord_no = l.order_no
    LEFT JOIN posted pn ON pn.req_no = p.tran_id AND pn.finished_id = l.itcd AND pn.sale_ord_no IS NULL
    LEFT JOIN disp_plan dp ON dp.plan_no = p.tran_id AND dp.itcd = l.itcd AND dp.so_no = l.order_no
    LEFT JOIN disp_so ds ON ds.so_no = l.order_no AND ds.itcd = l.itcd
    LEFT JOIN matched mt ON mt.so_no = l.order_no AND mt.itcd = l.itcd
    ORDER BY so.order_no, l.id, p.id
  `;
}

function emptySummary() {
  return { total_lines: 0, total_orders: 0, planned: 0, dispatched: 0, invoiced: 0 };
}
