// Covers: Orders → GRN → QC → Production → Requisitions.
// (GRN / dispatch vouchers live in handlers/transaction.js.)
import { usersWithRoles } from "@/lib/auth/roles";
import { NOTIFICATION_TYPES, NOTIFICATION_EXPIRY } from "../config";
import { emit, actorName } from "../emit";
import { permissionHolderIds } from "../../approvals/holders";
import { getAuditActor } from "../../audit/context";

// Who made this change: the signed-in user of the request (setAuditActor),
// not OrderMaster.userid — that is whoever CREATED the order, so an edit by
// someone else was reported under the creator's name. Falls back to the
// creator when there is no request user (cron / internal update).
const editorOf = (data) => getAuditActor().userId || data.userid;

async function itemName(prisma, itcd) {
  if (!itcd) return "Unknown Product";
  const product = await prisma.item.findUnique({ where: { itcd }, select: { item: true } });
  return product?.item || `Product #${itcd}`;
}

async function partyName(prisma, acno) {
  if (!acno) return "N/A";
  const party = await prisma.aCNO.findUnique({ where: { acno }, select: { acname: true } });
  return party?.acname || "N/A";
}

// ============================================
// 1. ORDERS (OrderMaster, keyed by order_catagory)
// ============================================
// ── Sale Order approval (Free of Cost / Trial, status 3) ──────────────
// Mirrors lib/orders/saleOrderApproval.js. Not imported from there: that file
// pulls in the permissions module, which imports lib/prisma, which imports
// this handler — a cycle.
const SO_PENDING_APPROVAL = 3;
const SO_REJECTED = 4;
// The approve route stamps approved_at; an update seen within this window of
// that stamp is the approval itself rather than a later edit.
const JUST_APPROVED_MS = 2 * 60 * 1000;

// Everyone who may approve — granted personally OR through their role
// (Admin → Permissions → Approvals). Used to read only personal grants, so an
// approver given the right by role was never told an order was waiting.
const soApproverIds = (prisma) => permissionHolderIds(prisma, "saleOrder.approve");

// The approvers of the rules behind this order's reasons (Sale Order rules
// set to "Save, but block dispatch" — Permissions → Approvals): people + roles.
async function reasonApproverIds(prisma, data) {
  const names = String(data.approval_reasons || "").split(",").map((x) => x.trim()).filter(Boolean);
  if (!names.length) return [];
  try {
    const rules = await prisma.approvalRule.findMany({ where: { doc_type: "saleOrder", mode: "flag", name: { in: names } } });
    const users = [...new Set(rules.flatMap((r) => (Array.isArray(r.approver_users) ? r.approver_users : [])).map(String))];
    const roles = [...new Set(rules.flatMap((r) => (Array.isArray(r.approver_roles) ? r.approver_roles : [])))];
    const or = [];
    if (users.length) or.push({ id: { in: users } });
    if (roles.length) or.push(usersWithRoles(roles));
    if (!or.length) return [];
    const rows = await prisma.user.findMany({ where: { isActive: true, OR: or }, select: { id: true } });
    return rows.map((x) => x.id);
  } catch {
    return []; // rules not set up yet
  }
}

/** Who raised the order and the customer's sales person — both hear the decision. */
async function soPeople(prisma, data) {
  const acc = data.party_code
    ? await prisma.aCNO.findUnique({ where: { acno: data.party_code }, select: { salesArea: true } })
    : null;
  return [...new Set([data.userid, acc?.salesArea].filter(Boolean))];
}

// The reasons saved on the order (lib/orders/saleOrderApprovalRules.js);
// older orders without them read from their flags.
const soKind = (data) =>
  String(data.approval_reasons || "").trim() ||
  (data.trialProcess ? "Trial Process" : "Free of Cost");

// editorId: set when an EDIT sent the order (back) for approval — that user is
// named and gets the actor copy; on create it is the creator.
async function salesOrderApprovalRequired(data, prisma, editorId = null) {
  try {
    const customer = await partyName(prisma, data.party_code);
    const byWhom = editorId && editorId !== data.userid
      ? `edited by ${await actorName(prisma, editorId)}`
      : `raised by ${await actorName(prisma, data.userid)}`;
    await emit(prisma, "salesOrderApprovalRequired", {
      title: `SO #${data.order_no} needs your approval`,
      message: `${soKind(data)} Sale Order #${data.order_no} for ${customer}, ${byWhom}, is waiting for approval.`,
      type: NOTIFICATION_TYPES.WARNING,
      entity: "order",
      entityId: data.order_no,
      actorUserId: editorId || data.userid,
      actorTitle: "Sent for approval",
      actorMessage: `${soKind(data)} Sale Order #${data.order_no} cannot be dispatched until the approver approves it.`,
      actorType: NOTIFICATION_TYPES.INFO,
      extraUserIds: [...new Set([...(await soApproverIds(prisma)), ...(await reasonApproverIds(prisma, data))])],
      vars: { order_no: data.order_no, party: customer, kind: soKind(data) },
    });
  } catch (error) {
    console.error("❌ Error creating SO approval notification:", error);
  }
}

async function salesOrderApproved(data, prisma) {
  try {
    const customer = await partyName(prisma, data.party_code);
    const approver = await actorName(prisma, data.approved_by);
    await emit(prisma, "salesOrderApproved", {
      title: `SO #${data.order_no} approved`,
      message: `${soKind(data)} Sale Order #${data.order_no} for ${customer} was approved by ${approver} — ready for dispatch.`,
      type: NOTIFICATION_TYPES.SUCCESS,
      entity: "order",
      entityId: data.order_no,
      extraUserIds: await soPeople(prisma, data),
      vars: { order_no: data.order_no, party: customer, kind: soKind(data), approver, actor: approver },
    });
  } catch (error) {
    console.error("❌ Error creating SO approved notification:", error);
  }
}

async function salesOrderRejected(data, prisma) {
  try {
    const customer = await partyName(prisma, data.party_code);
    const approver = await actorName(prisma, data.approved_by);
    await emit(prisma, "salesOrderRejected", {
      title: `SO #${data.order_no} rejected`,
      message: `${soKind(data)} Sale Order #${data.order_no} for ${customer} was rejected by ${approver}: ${data.approval_remarks || "no reason given"}. Edit it to send it again.`.slice(0, 500),
      type: NOTIFICATION_TYPES.ERROR,
      entity: "order",
      entityId: data.order_no,
      extraUserIds: await soPeople(prisma, data),
      vars: {
        order_no: data.order_no, party: customer, kind: soKind(data), approver, actor: approver,
        reason: data.approval_remarks || "",
      },
    });
  } catch (error) {
    console.error("❌ Error creating SO rejected notification:", error);
  }
}

const ORDER_CATEGORY = {
  4: { code: "purchaseOrderCreated", short: "PO", label: "Purchase Order", party: "Supplier" },
  5: { code: "serviceOrderCreated", short: "Service Order", label: "Service Order", party: "Vendor" },
  6: { code: "salesOrderCreated", short: "SO", label: "Sales Order", party: "Customer" },
};

/** OrderMaster created → routes to PO / SO / service order event. */
export async function orderCreated(data, prisma) {
  const cat = ORDER_CATEGORY[data.order_catagory];
  if (!cat) return;
  if (cat.code === "salesOrderCreated") return salesOrderCreated(data, prisma);
  if (cat.code === "purchaseOrderCreated") return purchaseOrderCreated(data, prisma);

  try {
    const creator = await actorName(prisma, data.userid);
    const party = await partyName(prisma, data.party_code);
    await emit(prisma, cat.code, {
      title: `New ${cat.label}`,
      message: `${cat.short} #${data.order_no} created by ${creator} - ${cat.party}: ${party}`,
      type: NOTIFICATION_TYPES.INFO,
      entity: "order",
      entityId: data.order_no,
      actorUserId: data.userid,
      actorTitle: `${cat.label} Created ✓`,
      actorMessage: `Your ${cat.label} #${data.order_no} has been created successfully`,
      actorType: NOTIFICATION_TYPES.SUCCESS,
      vars: { order_no: data.order_no, party, actor: creator },
    });
  } catch (error) {
    console.error("❌ Error creating order notification:", error);
  }
}

/** OrderMaster updated. */
export async function orderUpdated(data, prisma) {
  const cat = ORDER_CATEGORY[data.order_catagory];
  if (!cat) return;

  if (data.order_catagory === 6) {
    // Edited back into (or still in) the approval queue.
    const justDecided =
      data.approved_at && Date.now() - new Date(data.approved_at).getTime() < JUST_APPROVED_MS;
    if (data.status === SO_PENDING_APPROVAL) {
      await salesOrderApprovalRequired(data, prisma, editorOf(data));
    } else if (justDecided && data.status === SO_REJECTED) {
      await salesOrderRejected(data, prisma);
      return;
    } else if (justDecided) {
      await salesOrderApproved(data, prisma);
      return; // the approval notice replaces the generic "modified" one
    }
  }

  try {
    const editorId = editorOf(data);
    const updater = await actorName(prisma, editorId);
    await emit(prisma, "orderUpdated", {
      title: `${cat.label} Updated`,
      message: `${cat.short} #${data.order_no} was modified by ${updater}`,
      type: NOTIFICATION_TYPES.INFO,
      entity: "order",
      entityId: data.order_no,
      actorUserId: editorId,
      vars: { order_type: cat.label, order_no: data.order_no, actor: updater },
    });
  } catch (error) {
    console.error("❌ Error creating order update notification:", error);
  }
}

export async function purchaseOrderCreated(data, prisma) {
  try {
    const creator = await actorName(prisma, data.userid);
    const supplier = await partyName(prisma, data.party_code);
    await emit(prisma, "purchaseOrderCreated", {
      title: "New Purchase Order",
      message: `PO #${data.order_no} created by ${creator} - Supplier: ${supplier}`,
      type: NOTIFICATION_TYPES.INFO,
      entity: "order",
      entityId: data.order_no,
      actorUserId: data.userid,
      actorTitle: "Purchase Order Created ✓",
      actorMessage: `Your Purchase Order #${data.order_no} has been created successfully`,
      actorType: NOTIFICATION_TYPES.SUCCESS,
      vars: { order_no: data.order_no, party: supplier, actor: creator },
    });
  } catch (error) {
    console.error("❌ Error creating PO notification:", error);
  }
}

export async function purchaseOrderApproved(data, prisma) {
  try {
    await emit(prisma, "purchaseOrderApproved", {
      title: "PO Approved - Prepare for GRN",
      message: `PO #${data.order_no} approved - Prepare receiving area for incoming materials`,
      type: NOTIFICATION_TYPES.WARNING,
      entity: "order",
      entityId: data.order_no,
      expiryDays: NOTIFICATION_EXPIRY.URGENT,
      actorUserId: data.userid,
      actorTitle: "Purchase Order Approved ✅",
      actorMessage: `Your PO #${data.order_no} has been approved and is ready for receiving`,
      actorType: NOTIFICATION_TYPES.SUCCESS,
      vars: { order_no: data.order_no },
    });
  } catch (error) {
    console.error("❌ Error creating PO approval notification:", error);
  }
}

export async function salesOrderCreated(data, prisma) {
  // A Free of Cost / Trial order is not ready for dispatch yet — the approver is
  // asked to approve it instead of the warehouse being told to prepare.
  if (data.status === SO_PENDING_APPROVAL) return salesOrderApprovalRequired(data, prisma);
  try {
    const customer = await partyName(prisma, data.party_code);
    await emit(prisma, "salesOrderCreated", {
      title: "New Sales Order",
      message: `SO #${data.order_no} from ${customer} - Prepare for dispatch`,
      type: NOTIFICATION_TYPES.INFO,
      entity: "order",
      entityId: data.order_no,
      actorUserId: data.userid,
      actorTitle: "Sales Order Created ✓",
      actorMessage: `Sales Order #${data.order_no} created successfully`,
      actorType: NOTIFICATION_TYPES.SUCCESS,
      vars: { order_no: data.order_no, party: customer },
    });
  } catch (error) {
    console.error("❌ Error creating sales order notification:", error);
  }
}

// ============================================
// 2. QUALITY CONTROL (QualityMaster)
// ============================================
export async function qualityCheckCreated(data, prisma) {
  try {
    const productName = await itemName(prisma, data.itcd);
    let qcType = "Quality Check";
    let sourceInfo = "";
    if (data.proc_ord_no) {
      qcType = "Production QC";
      sourceInfo = `Production Plan #${data.proc_ord_no}`;
    } else if (data.order_no) {
      qcType = "Purchase QC";
      sourceInfo = `Purchase Order #${data.order_no}`;
    }

    await emit(prisma, "qualityCheckCreated", {
      title: `🔬 New ${qcType} Initiated`,
      message: `QC #${data.id} started for ${productName}${data.batch_no ? ` - Batch: ${data.batch_no}` : ""}${sourceInfo ? ` (${sourceInfo})` : ""}`,
      type: NOTIFICATION_TYPES.INFO,
      entity: "quality",
      entityId: data.id,
    });
  } catch (error) {
    console.error("❌ Error creating QC notification:", error);
  }
}

export async function qualityCheckApproved(data, prisma) {
  try {
    const productName = await itemName(prisma, data.itcd);
    const nextStep = data.proc_ord_no
      ? "Production can now be POSTED to stock"
      : data.order_no
        ? "Materials approved for stock IN"
        : "";

    await emit(prisma, "qualityCheckApproved", {
      title: "✅ Quality Check APPROVED",
      message: `${productName} (Batch: ${data.batch_no}) passed QC - ${nextStep}`,
      type: NOTIFICATION_TYPES.SUCCESS,
      entity: "quality",
      entityId: data.id,
    });
  } catch (error) {
    console.error("❌ Error creating QC approval notification:", error);
  }
}

export async function qualityCheckRejected(data, prisma) {
  try {
    const productName = await itemName(prisma, data.itcd);
    const action = data.proc_ord_no
      ? "Production batch needs rework"
      : data.order_no
        ? "Contact supplier for return/replacement"
        : "Immediate action required";

    await emit(prisma, "qualityCheckRejected", {
      title: "❌ CRITICAL: Quality Check REJECTED",
      message: `${productName} (Batch: ${data.batch_no}) FAILED QC - ${action}`,
      type: NOTIFICATION_TYPES.ERROR,
      entity: "quality",
      entityId: data.id,
      expiryDays: NOTIFICATION_EXPIRY.CRITICAL,
    });
  } catch (error) {
    console.error("❌ Error creating QC rejection notification:", error);
  }
}

export async function qualityCheckRework(data, prisma) {
  try {
    const productName = await itemName(prisma, data.itcd);
    await emit(prisma, "qualityCheckRework", {
      title: "⚠️ Quality Check: REWORK REQUIRED",
      message: `${productName} (Batch: ${data.batch_no}) needs rework - Check QC report for details`,
      type: NOTIFICATION_TYPES.WARNING,
      entity: "quality",
      entityId: data.id,
      expiryDays: NOTIFICATION_EXPIRY.URGENT,
    });
  } catch (error) {
    console.error("❌ Error creating QC rework notification:", error);
  }
}

/** QualityMaster updated → routes on status. */
export async function qualityCheckUpdated(data, prisma) {
  try {
    if (data.status === "APPROVED") return await qualityCheckApproved(data, prisma);
    if (data.status === "REJECTED") return await qualityCheckRejected(data, prisma);
    if (data.status === "REWORK") return await qualityCheckRework(data, prisma);

    const productName = await itemName(prisma, data.itcd);
    await emit(prisma, "qualityCheckUpdated", {
      title: "Quality Check Updated",
      message: `QC #${data.id} - ${productName} - Status: ${data.status}`,
      type: NOTIFICATION_TYPES.INFO,
      entity: "quality",
      entityId: data.id,
    });
  } catch (error) {
    console.error("❌ Error creating QC update notification:", error);
  }
}

// ============================================
// 3. PRODUCTION (productionPlanMaster)
// ============================================
export async function productionCreated(data, prisma) {
  try {
    const productName = await itemName(prisma, data.finished_id);
    await emit(prisma, "productionCreated", {
      title: "🏭 New Production Plan Created",
      message: `Production Plan #${data.id} - ${productName} (${data.qty} units) - Batch: ${data.batch_no || "TBD"}`,
      type: NOTIFICATION_TYPES.INFO,
      entity: "production",
      entityId: data.id,
    });
  } catch (error) {
    console.error("❌ Error creating production notification:", error);
  }
}

export async function productionStarted(data, prisma) {
  try {
    const productName = await itemName(prisma, data.finished_id);
    await emit(prisma, "productionStarted", {
      title: "⚙️ Production STARTED",
      message: `Production Plan #${data.id} - ${productName} (${data.qty} units) is now IN PROGRESS`,
      type: NOTIFICATION_TYPES.WARNING,
      entity: "production",
      entityId: data.id,
      expiryDays: NOTIFICATION_EXPIRY.URGENT,
    });
  } catch (error) {
    console.error("❌ Error creating production start notification:", error);
  }
}

export async function productionCompleted(data, prisma) {
  try {
    const productName = await itemName(prisma, data.finished_id);
    await emit(prisma, "productionCompleted", {
      title: "✅ Production COMPLETED - Ready for QC",
      message: `Production Plan #${data.id} - ${productName} (${data.qty} units, Batch: ${data.batch_no}) completed, needs quality check`,
      type: NOTIFICATION_TYPES.SUCCESS,
      entity: "production",
      entityId: data.id,
      expiryDays: NOTIFICATION_EXPIRY.URGENT,
    });
  } catch (error) {
    console.error("❌ Error creating production completion notification:", error);
  }
}

export async function productionPosted(data, prisma) {
  try {
    const productName = await itemName(prisma, data.finished_id);
    await emit(prisma, "productionPosted", {
      title: "📦 Production POSTED to Stock",
      message: `Production Plan #${data.id} - ${productName} (${data.qty} units) posted - Stock IN complete, materials consumed`,
      type: NOTIFICATION_TYPES.SUCCESS,
      entity: "production",
      entityId: data.id,
    });
  } catch (error) {
    console.error("❌ Error creating production posting notification:", error);
  }
}

/** productionPlanMaster updated → routes on status. */
export async function productionUpdated(data, prisma) {
  try {
    if (data.status === "In Progress") return await productionStarted(data, prisma);
    if (data.status === "Completed") return await productionCompleted(data, prisma);
    if (data.status === "Posted") return await productionPosted(data, prisma);

    const productName = await itemName(prisma, data.finished_id);
    await emit(prisma, "productionUpdated", {
      title: "Production Plan Updated",
      message: `Production Plan #${data.id} - ${productName} - Status: ${data.status}`,
      type: NOTIFICATION_TYPES.INFO,
      entity: "production",
      entityId: data.id,
    });
  } catch (error) {
    console.error("❌ Error creating production update notification:", error);
  }
}

// ============================================
// 4. REQUISITIONS (ReqMaster)
// ============================================
const REQ_LABEL = {
  PURCHASE: "Purchase Requisition",
  TRANSFER: "Store Requisition",
  SERVICE: "Service Requisition",
  FG_TRANSFER: "FG Transfer Requisition",
  DISPATCH: "Dispatch Requisition",
};

export async function requisitionCreated(data, prisma) {
  try {
    const reqType = REQ_LABEL[data.req_catagory] || "Requisition";
    const creator = await actorName(prisma, data.userid);
    await emit(prisma, "requisitionCreated", {
      title: `New ${reqType}`,
      message: `${reqType} #${data.tran_id} created by ${creator} - Approval needed`,
      type: NOTIFICATION_TYPES.INFO,
      entity: "requisition",
      entityId: data.tran_id,
      actorUserId: data.userid,
      actorTitle: `${reqType} Created ✓`,
      actorMessage: `Your ${reqType} #${data.tran_id} has been created and sent for approval`,
      actorType: NOTIFICATION_TYPES.SUCCESS,
    });
  } catch (error) {
    console.error("❌ Error creating requisition notification:", error);
  }
}

export async function requisitionApproved(data, prisma) {
  try {
    const reqType = REQ_LABEL[data.req_catagory] || "Requisition";
    const nextStep =
      data.req_catagory === "PURCHASE"
        ? "Will be converted to Purchase Order"
        : "Materials will be transferred from store";

    await emit(prisma, "requisitionApproved", {
      title: `${reqType} Approved - Action Required`,
      message: `${reqType} #${data.tran_id} approved - ${nextStep}`,
      type: NOTIFICATION_TYPES.WARNING,
      entity: "requisition",
      entityId: data.tran_id,
      expiryDays: NOTIFICATION_EXPIRY.URGENT,
      actorUserId: data.userid,
      actorTitle: `${reqType} Approved ✅`,
      actorMessage: `Your ${reqType} #${data.tran_id} has been approved - ${nextStep}`,
      actorType: NOTIFICATION_TYPES.SUCCESS,
    });
  } catch (error) {
    console.error("❌ Error creating requisition approval notification:", error);
  }
}

/** ReqMaster updated → routes on status. */
export async function requisitionUpdated(data, prisma) {
  try {
    if (String(data.status).toLowerCase() === "approved") {
      return await requisitionApproved(data, prisma);
    }
    const reqType = REQ_LABEL[data.req_catagory] || "Requisition";
    await emit(prisma, "requisitionUpdated", {
      title: `${reqType} Updated`,
      message: `${reqType} #${data.tran_id} - Status: ${data.status}`,
      type: NOTIFICATION_TYPES.INFO,
      entity: "requisition",
      entityId: data.tran_id,
      actorUserId: data.userid,
    });
  } catch (error) {
    console.error("❌ Error creating requisition update notification:", error);
  }
}
