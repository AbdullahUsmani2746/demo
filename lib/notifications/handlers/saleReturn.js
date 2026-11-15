// Sale Return remarks (SaleReturnRemark) — Technical reasons go for approval.
// Mirrors lib/saleReturns/remarks.js. Not imported from there: that file pulls
// in lib/prisma, which imports this handler — a cycle.
import { NOTIFICATION_TYPES } from "../config";
import { emit, actorName } from "../emit";
import { permissionHolderIds } from "../../approvals/holders";

const TECHNICAL = "TECHNICAL";
const PENDING = "PENDING";
const APPROVED = "APPROVED";
const REJECTED = "REJECTED";
// An update seen within this window of decided_at is the decision itself.
const JUST_DECIDED_MS = 2 * 60 * 1000;

// The Sale Return reviewers — saleReturn.approve or saleReturn.remark, granted
// personally OR by role (Admin → Permissions → Approvals).
async function approverIds(prisma) {
  const [a, b] = await Promise.all([
    permissionHolderIds(prisma, "saleReturn.approve"),
    permissionHolderIds(prisma, "saleReturn.remark"),
  ]);
  return [...new Set([...a, ...b])];
}

async function returnInfo(prisma, tranId) {
  const sr = await prisma.transactionsMaster.findUnique({
    where: { tran_id: tranId },
    select: { vr_no: true, acno: { select: { acname: true } } },
  });
  return { no: sr?.vr_no ?? tranId, customer: sr?.acno?.acname ?? "N/A" };
}

const COMMERCIAL = "COMMERCIAL";

/**
 * SaleReturnRemark created or updated — no approval any more. Every reason
 * the sales person saves (Technical or Commercial) is sent to the
 * saleReturn.approve holders to read.
 * Same event code as before, so no new notification event is needed.
 */
export async function saleReturnRemarkSaved(data, prisma) {
  if (data.reason_type !== TECHNICAL && data.reason_type !== COMMERCIAL) return;
  // Only the save itself (entered_at just stamped), not any later touch.
  const justEntered =
    data.entered_at && Date.now() - new Date(data.entered_at).getTime() < JUST_DECIDED_MS;
  if (!justEntered) return;
  // The reviewer's remark just saved (decided_at stamped after the reason)
  // — that is not a new reason, so nobody is told again.
  if (data.decided_at && data.entered_at && new Date(data.decided_at) > new Date(data.entered_at)) return;

  try {
    const { no, customer } = await returnInfo(prisma, data.tran_id);
    const by = await actorName(prisma, data.entered_by);
    const kind = data.reason_type === TECHNICAL ? "Technical" : "Commercial";
    await emit(prisma, "saleReturnApprovalRequired", {
      title: `Sale Return #${no} — ${kind} reason`,
      message: `${kind} reason on Sale Return #${no} for ${customer}, entered by ${by}: ${data.remarks ?? ""}`.slice(0, 500),
      type: NOTIFICATION_TYPES.INFO,
      entity: "saleReturn",
      entityId: data.tran_id,
      actorUserId: data.entered_by,
      actorTitle: "Remarks saved",
      actorMessage: `${kind} reason on Sale Return #${no} saved.`,
      actorType: NOTIFICATION_TYPES.INFO,
      extraUserIds: await approverIds(prisma),
      vars: { vr_no: no, customer, kind, remarks: data.remarks ?? "", actor: by },
    });
  } catch (error) {
    console.error("Error creating sale return remark notification:", error);
  }
}

/* Old: Technical → approval request; approve / reject → sales person.
export async function saleReturnRemarkSavedWithApproval(data, prisma) {
  if (data.reason_type !== TECHNICAL) return; // Commercial: a note, nobody to tell

  try {
    const { no, customer } = await returnInfo(prisma, data.tran_id);

    if (data.status === PENDING && !data.decided_at) {
      const by = await actorName(prisma, data.entered_by);
      await emit(prisma, "saleReturnApprovalRequired", {
        title: `Sale Return #${no} needs your approval`,
        message: `Technical reason on Sale Return #${no} for ${customer}, entered by ${by}: ${data.remarks ?? ""}`.slice(0, 500),
        type: NOTIFICATION_TYPES.WARNING,
        entity: "saleReturn",
        entityId: data.tran_id,
        actorUserId: data.entered_by,
        actorTitle: "Sent for approval",
        actorMessage: `Technical reason on Sale Return #${no} is waiting for approval.`,
        actorType: NOTIFICATION_TYPES.INFO,
        extraUserIds: await approverIds(prisma),
      });
      return;
    }

    const justDecided =
      data.decided_at && Date.now() - new Date(data.decided_at).getTime() < JUST_DECIDED_MS;
    if (!justDecided || (data.status !== APPROVED && data.status !== REJECTED)) return;

    const approver = await actorName(prisma, data.decided_by);
    const approved = data.status === APPROVED;
    await emit(prisma, approved ? "saleReturnApproved" : "saleReturnRejected", {
      title: `Sale Return #${no} ${approved ? "approved" : "rejected"}`,
      message: approved
        ? `Technical reason on Sale Return #${no} for ${customer} was approved by ${approver}.`
        : `Technical reason on Sale Return #${no} for ${customer} was rejected by ${approver}` +
          (data.decision_remarks ? `: ${data.decision_remarks}` : "."),
      type: approved ? NOTIFICATION_TYPES.SUCCESS : NOTIFICATION_TYPES.ERROR,
      entity: "saleReturn",
      entityId: data.tran_id,
      extraUserIds: [data.entered_by].filter(Boolean),
    });
  } catch (error) {
    console.error("❌ Error creating sale return remark notification:", error);
  }
}
*/
