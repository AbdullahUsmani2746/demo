import prisma from "@/lib/prisma";
import { can } from "@/lib/auth/permissions";
import { permissionHolderIds } from "@/lib/approvals/holders";
import { getCustomerMacnos } from "@/lib/accounts/partyMacnos";
import { seesAllSales, visibleSalesPersons } from "@/lib/auth/salesScope";

/* ══════════════════════════════════════════════════════════════════════
   SALE RETURN REMARKS — why a Sale Return (tran_code 10) happened

   The customer's sales person picks a reason on every sale return:
     · COMMERCIAL — they write the reason; that is the end of it.
     · TECHNICAL  — they write the reason and it waits for approval by a
                    holder of saleReturn.approve (granted on Permissions →
                    Approvals), who approves or rejects it.
   Remarks can be changed until a Technical reason is approved; changing a
   rejected one sends it back for approval.

   Memo only — the sale return itself, stock and the ledger are untouched.

   WHO SEES WHAT — same rule as the Sales Loan Register:
     · a sales person sees returns of their own customers only
       (ACNO.salesArea = their User.id)
     · a team lead (salesTeam.viewTeam) also sees their team's returns
     · salesTeam.viewAll, ADMIN and ACCOUNTANT see everyone's.
   Approvers see every return on the approvals page.
   ══════════════════════════════════════════════════════════════════════ */

export const SALE_RETURN_CODE = 10;
export const SR_APPROVE_PERMISSION = "saleReturn.approve";

export const REASON = {
  TECHNICAL: "TECHNICAL",
  COMMERCIAL: "COMMERCIAL",
};

export const SR_STATUS = {
  PENDING: "PENDING",
  APPROVED: "APPROVED",
  REJECTED: "REJECTED",
};

// Without a date filter the list shows the most recent returns only.
const DEFAULT_TAKE = 500;

export const canApproveSaleReturns = (session) => can(session, SR_APPROVE_PERMISSION);

// Who may write the review remark on a sale return reason (Sale Return
// Remarks page, "Remarks" column): holders of saleReturn.remark, granted on
// Permissions → Approvals (it used to be a hard-coded user id).
export const SR_REMARK_PERMISSION = "saleReturn.remark";
export const canRemarkSaleReturns = (session) => can(session, SR_REMARK_PERMISSION);

export const seesAllSaleReturns = seesAllSales;

/**
 * Customer account numbers this session may see, or null for "all".
 * A sales person with no customers gets an empty list (sees nothing).
 */
export async function scopedCustomerAcnos(session, { approverSeesAll = false } = {}) {
  if (await seesAllSaleReturns(session)) return null;
  if (approverSeesAll && (await canApproveSaleReturns(session))) return null;
  const visible = await visibleSalesPersons(session);
  const customers = await prisma.aCNO.findMany({
    where: { salesArea: { in: visible ?? [] }, macno: { in: await getCustomerMacnos() } },
    select: { acno: true },
  });
  return customers.map((c) => c.acno);
}

/** True when this session may enter remarks on the sale return. */
export async function saleReturnInScope(session, tranId) {
  const id = Number(tranId);
  if (!Number.isFinite(id)) return null;
  const sr = await prisma.transactionsMaster.findFirst({
    where: { tran_id: id, tran_code: SALE_RETURN_CODE },
    select: { tran_id: true, pycd: true, vr_no: true },
  });
  if (!sr) return null;
  const acnos = await scopedCustomerAcnos(session);
  if (acnos !== null && !acnos.includes(sr.pycd)) return null;
  return sr;
}

/** Everyone holding the approve right, personally or by role (for notifications). */
export const approverUserIds = () => permissionHolderIds(prisma, SR_APPROVE_PERMISSION);

export function parseDate(value) {
  if (!value) return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Sale returns with their lines, customer, sales person and remark.
 * @param acnos     customer scope from scopedCustomerAcnos (null = all)
 * @param tranIds   limit to these sale returns (approvals page)
 */
export async function loadSaleReturns({ acnos = null, tranIds = null, dateFrom = null, dateTo = null }) {
  const where = { tran_code: SALE_RETURN_CODE };
  if (acnos !== null) where.pycd = { in: acnos };
  if (tranIds !== null) where.tran_id = { in: tranIds };
  if (dateFrom || dateTo) {
    where.dated = { ...(dateFrom ? { gte: dateFrom } : {}), ...(dateTo ? { lte: dateTo } : {}) };
  }

  const masters = await prisma.transactionsMaster.findMany({
    where,
    orderBy: [{ dated: "desc" }, { tran_id: "desc" }],
    take: dateFrom || dateTo || tranIds ? undefined : DEFAULT_TAKE,
    select: {
      tran_id: true,
      vr_no: true,
      dated: true,
      pycd: true,
      invoice_no: true,
      rmk: true,
      user_id: true,
      acno: { select: { acno: true, acname: true, salesArea: true } },
      transactions: {
        where: { sub_tran_id: 1, itcd: { not: null } },
        select: {
          id: true,
          itcd: true,
          qty: true,
          qty_ltr: true,
          unit: true,
          rate: true,
          damt: true,
          itemDetails: { select: { code: true, item: true } },
        },
      },
    },
  });

  const ids = masters.map((m) => m.tran_id);
  const remarks = ids.length
    ? await prisma.saleReturnRemark.findMany({ where: { tran_id: { in: ids } } })
    : [];
  const remarkBy = new Map(remarks.map((r) => [r.tran_id, r]));

  const userIds = new Set();
  for (const m of masters) {
    if (m.acno?.salesArea) userIds.add(m.acno.salesArea);
    if (m.user_id) userIds.add(m.user_id);
  }
  for (const r of remarks) {
    if (r.entered_by) userIds.add(r.entered_by);
    if (r.decided_by) userIds.add(r.decided_by);
  }
  const users = userIds.size
    ? await prisma.user.findMany({ where: { id: { in: [...userIds] } }, select: { id: true, name: true } })
    : [];
  const nameOf = new Map(users.map((u) => [u.id, u.name]));
  const name = (id) => (id ? nameOf.get(id) ?? id : null);

  return masters.map((m) => {
    const r = remarkBy.get(m.tran_id) ?? null;
    const lines = m.transactions.map((t) => ({
      id: t.id,
      itcd: t.itcd,
      code: t.itemDetails?.code ?? null,
      item: t.itemDetails?.item ?? `Item ${t.itcd}`,
      qty: Number(t.qty) || 0,
      qty_ltr: t.qty_ltr,
      unit: t.unit,
      rate: t.rate,
      amount: Number(t.damt) || 0,
    }));
    return {
      tran_id: m.tran_id,
      vr_no: m.vr_no ?? m.tran_id,
      dated: m.dated,
      invoice_no: m.invoice_no,
      narration: m.rmk,
      acno: m.pycd,
      customer: m.acno?.acname ?? `Customer ${m.pycd}`,
      sales_person: m.acno?.salesArea ?? null,
      sales_person_name: name(m.acno?.salesArea),
      created_by: name(m.user_id),
      total_qty: lines.reduce((s, l) => s + l.qty, 0),
      total_amount: lines.reduce((s, l) => s + l.amount, 0),
      lines,
      reason_type: r?.reason_type ?? null,
      remarks: r?.remarks ?? null,
      status: r?.status ?? null,
      entered_by: name(r?.entered_by),
      entered_at: r?.entered_at ?? null,
      decided_by: name(r?.decided_by),
      decided_at: r?.decided_at ?? null,
      decision_remarks: r?.decision_remarks ?? null,
      // A Technical reason that is approved is final.
      locked: r?.reason_type === REASON.TECHNICAL && r?.status === SR_STATUS.APPROVED,
    };
  });
}
