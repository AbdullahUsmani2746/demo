// lib/reports/pendingReport.js — Pending Report (Features: production.labNature).
// Dispatch Production Plan lines whose Nature is PROCESS / MANUFACTURING and
// whose Process Order is not posted yet (or, "Process Order Posted", those that
// are). Date From / To = the plan's date (ReqMaster.dated). Each row is a plan
// line: it drills to Create Process Order for that line and to its Sale Order.
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";

const SO_CATEGORY = 6;
const NATURES = ["MANUFACTURING", "PROCESS"];

export async function getPendingReport({ dateFrom, dateTo, nature } = {}) {
  const start = dateFrom ? new Date(dateFrom) : new Date("2000-01-01T00:00:00");
  const end = dateTo ? new Date(dateTo) : new Date();
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  const wanted = String(nature || "").trim().toUpperCase();
  const posted = wanted === "POSTED";
  const natures = NATURES.includes(wanted) ? [wanted] : NATURES;

  // A Process Order counts for this plan line when it is Posted, names the
  // plan (req_no), produces the item (main or any output) and is for this Sale
  // Order or for none.
  const rows = await prisma.$queryRaw(Prisma.sql`
    SELECT rd.id, rd.tran_id AS plan_no, om.order_no,
           COALESCE(om.created_at, om.dated) AS so_date, rm.dated AS plan_date,
           a.acname AS customer, a.sales_ares AS sales_area, rd.itcd, it.code, it.item, rd.qty,
           UPPER(TRIM(rd.nature)) AS nature
    FROM "ReqDetail" rd
    JOIN "ReqMaster" rm ON rm.tran_id = rd.tran_id
    JOIN "OrderMaster" om ON om.order_no = rd.so_no
    JOIN "acno" a ON a.acno = om.party_code
    LEFT JOIN "Item" it ON it.itcd = rd.itcd
    WHERE rm.req_catagory = 'DISPATCH'
      AND om.order_catagory = ${SO_CATEGORY}
      AND UPPER(TRIM(rd.nature)) = ANY(${natures}::text[])
      AND rm.dated >= ${start}
      AND rm.dated <= ${end}
      AND ${posted ? Prisma.sql`EXISTS` : Prisma.sql`NOT EXISTS`} (
        SELECT 1 FROM "productionPlanMaster" pp
        WHERE pp.req_no = rd.tran_id
          AND pp.status = 'Posted'
          AND (pp.sale_ord_no = om.order_no OR pp.sale_ord_no IS NULL)
          AND (pp.finished_id = rd.itcd
               OR EXISTS (SELECT 1 FROM "productionPlanOutput" o WHERE o.plan_id = pp.id AND o.finished_id = rd.itcd))
      )
    ORDER BY rd.tran_id, a.acname, rd.id
  `);

  const keys = [...new Set(rows.map((r) => r.sales_area).filter(Boolean))];
  const users = keys.length
    ? await prisma.user.findMany({
        where: { OR: [{ id: { in: keys } }, { username: { in: keys } }] },
        select: { id: true, username: true, name: true },
      })
    : [];
  const nameOf = new Map();
  for (const u of users) {
    nameOf.set(u.id, u.name || u.username || u.id);
    if (u.username) nameOf.set(u.username, u.name || u.username);
  }

  const data = rows.map((r) => ({
    plan_no: r.plan_no,
    order_no: r.order_no,
    so_no: r.order_no,
    so_date: r.so_date,
    plan_date: r.plan_date,
    customer: r.customer ?? "",
    sales_person: r.sales_area ? nameOf.get(r.sales_area) || "" : "",
    itcd: r.itcd,
    code: r.code ?? "",
    item: r.item ?? "",
    qty: Number(r.qty) || 0,
    nature: r.nature ?? "",
  }));

  return {
    data,
    summary: { total_lines: data.length, total_qty: data.reduce((s, r) => s + r.qty, 0) },
  };
}
