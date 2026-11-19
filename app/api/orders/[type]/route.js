import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { VOUCHER_CONFIG } from "@/components/Category/constants";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { setAuditActor } from "@/lib/audit/context";
import {
  isLitreUnit,
  resolveLineQuantities,
  missingLtrRateMessage,
} from "@/lib/units/litres";
import { guardBy } from "@/lib/auth/route";
import {
  SO_STATUS,
  approvalReasons,
  reasonsText,
  orderTypeOf,
  SO_APPROVAL_FLAGS,
  flagOn,
  NO_GODOWN_OPTION,
  zeroRatesOn,
  ratesEditableOn,
  noGodownOn,
  withoutGodownOn,
  withoutGodownConfigured,
  WITHOUT_GODOWN_DISPATCH,
  WITHOUT_GODOWN_NOT_SET,
} from "@/lib/orders/saleOrderApproval";
import { getGodownStock } from "@/lib/stock/godownStock";
import { feature } from "@/lib/features/server";
import { applySaleOrderLineTypes, lineTypeOf, LINE_TYPE } from "@/lib/orders/lineTypes";
import { approvedTrialItems } from "@/lib/orders/trialBilling";
// Sale Order line → Production Plan (Features: saleOrder.planFromOrder)
import { planApprovedOrder, planFieldsOf, isPlanMarked, soPlanLinesError } from "@/lib/orders/soPlan";
import {
  duplicateItemsError,
  priceListError,
  focTrialError,
  litreUnitsError,
  customerCreditChecks,
} from "@/lib/orders/saleOrderChecks";

// Settings → Features on a Sale Order body (lib/features/catalog.js, group
// "saleOrder"): line types first (orders.trialLineBilling — Trial / Free of
// Cost lines rate 0, order flags from the lines), then what may be on the
// order. Run before the approval gate (a refused order is never held) and
// again in createOrder / updateOrder (an approved request is checked as it is
// saved). Safe to run twice. → error message or null.
async function saleOrderBodyError(body, orderNo = null) {
  if (!body?.master || !Array.isArray(body.lines)) return null;
  if (await feature("orders.trialLineBilling")) {
    const lineTypeError = applySaleOrderLineTypes(body);
    if (lineTypeError) return lineTypeError;
  }
  const party = Number(body.master.party_code?.value ?? body.master.party_code);
  return (
    (await duplicateItemsError(body.lines)) ||
    (await litreUnitsError(body.lines, orderNo)) ||
    (await priceListError(party, body.lines, orderNo)) ||
    (await focTrialError({ party, master: body.master, lines: body.lines, orderNo }))
  );
}

// Free of Cost worked out from the lines (SMS: a 0 rate makes the order Free
// of Cost). With line types on, Trial / Rate Negotiation lines are 0 on
// purpose and do not count — only Normal lines do.
function autoFreeOfCost(lines, { lineTypesOn }) {
  const counted = lineTypesOn ? lines.filter((l) => (lineTypeOf(l) ?? LINE_TYPE.NORMAL) === LINE_TYPE.NORMAL) : lines;
  if (lineTypesOn && !counted.length) return false;
  const total = counted.reduce((sum, d) => sum + (Number(d.amount) || 0), 0);
  return total === 0 || counted.some((d) => !d.rate || Number(d.rate) === 0);
}

// Sale Order Urgency Level (High / Moderate / Routine) from the form's select;
// anything else (or nothing) saves as null.
// const URGENCY_LEVELS = ["High", "Moderate", "Routine"];
// const urgencyLevelOf = (master) => {
//   const v = master?.urgency_level?.value ?? master?.urgency_level;
//   return URGENCY_LEVELS.includes(v) ? v : null;
// };
// Now an "Urgent" tick: ticked → "Urgent", unticked → null.
// const urgencyLevelOf = (master) => (master?.urgency_level === true ? "Urgent" : null);
// OrderMaster.urgency_level is Boolean: ticked → true, else false.
const urgencyLevelOf = (master) => master?.urgency_level === true;

// Sale Order lines: stock of each item in godown 3 and 9 (and the total) at
// save time — the same figures shown under the Product on the form. On an
// edit, a line whose item was already on the order keeps its first snapshot
// (`keep`: itcd → saved stock fields).
async function saleOrderStockSnapshot(itcds, keep = new Map()) {
  const fresh = [...new Set(itcds.map(Number).filter((n) => Number.isInteger(n) && n > 0))].filter((id) => !keep.has(id));
  const [g3, g9] = fresh.length
    ? await Promise.all([getGodownStock(fresh, 3), getGodownStock(fresh, 9)])
    : [new Map(), new Map()];
  return (itcd) => {
    const id = Number(itcd);
    if (keep.has(id)) return keep.get(id);
    if (!g3.has(id) && !g9.has(id)) return {};
    const s3 = g3.get(id) || 0;
    const s9 = g9.get(id) || 0;
    return { stock_g3: s3, stock_g9: s9, stock_total: s3 + s9 };
  };
}

// Approval reasons for a Sale Order: the ticked flags + the customer's status
// (Bad Debt / Bad Payment). Rules: lib/orders/saleOrderApprovalRules.js
// Why a Sale Order must wait for approval before it can be dispatched.
// Decided by the Sale Order rules on Admin → Permissions → Approvals that are
// set to "Save, but block dispatch until approved" (lib/approvals/rules.js):
// each matching rule's NAME is a reason, and its approvers may approve it.
// Order Type and No Godown are worked out here from the saved flags, so a
// rule on them reads the same on a new order and on an edit.
// Only while no such rule exists does the built-in list below apply.
async function saleOrderApprovalReasons(masterData, rawMaster = {}, lines = [], action = "create") {
  try {
    const evalMaster = {
      ...masterData,
      ...rawMaster,
      party_code: masterData.party_code,
      // every order-type flag that is on (older orders can have two)
      soOrderType: (() => {
        const on = SO_APPROVAL_FLAGS.filter((f) => f.orderType && flagOn(masterData, f.key)).map((f) => ({ value: f.key, label: f.label }));
        return on.length ? on : orderTypeOf(masterData);
      })(),
      godown: noGodownOn(masterData) || noGodownOn(rawMaster) ? NO_GODOWN_OPTION : rawMaster.godown ?? masterData.godown,
    };
    const rules = await matchingFlagRules("saleOrder", { master: evalMaster, lines }, action);
    if (rules) return rules.map((r) => r.name);
  } catch (e) {
    console.error("[approvals] sale order rules unavailable — built-in reasons used:", e?.message);
  }
  return builtInSaleOrderReasons(masterData);
}

// Approval standard (CLAUDE.md): an approver's own save is not sent to them.
// When the person saving may approve EVERY reason on the order (saleOrder.approve,
// or the approver of each flag rule behind it), the order is saved approved —
// stamped with who and when — instead of waiting at status 3.
const SELF_APPROVED_NOTE = "Saved by an approver — no separate approval needed";
async function approvedBySaver(session, soReasons) {
  if (!soReasons.length || !session?.user?.id) return false;
  return mayApprove(await approverScope(session), { approval_reasons: reasonsText(soReasons) });
}
const stampSelfApproval = (masterData, session) => {
  masterData.approved_by = session.user.id;
  masterData.approved_at = new Date();
  masterData.approval_remarks = SELF_APPROVED_NOTE;
};

async function builtInSaleOrderReasons(masterData) {
  const customer = Number.isFinite(masterData.party_code)
    ? await prisma.aCNO.findUnique({
        where: { acno: masterData.party_code },
        select: { customerStatus: true },
      })
    : null;
  return approvalReasons(masterData, { customerStatus: customer?.customerStatus });
}
import { checkPeriodLock } from "@/lib/periodLock";
import { documentLabel } from "@/lib/periodLockCatalog";
import { approvalGate, runApprovedRequest, matchingFlagRules } from "@/lib/approvals/rules";
import { approverScope, mayApprove } from "@/lib/approvals/saleOrders";
import { blockingFollowups } from "@/lib/bi/followups";

// Follow-up scenarios with "block new Free of Cost / Trial" (BI Designer →
// question → Follow-up): a customer with an open follow-up cannot get another
// FOC / Trial Sale Order until it is logged on My Follow-ups. The order being
// followed up itself may still be edited.
async function followupBlockMessage(masterData, ownOrderNo = null) {
  if (!(masterData.freeOfCost === true || masterData.trialProcess === true)) return null;
  const open = (await blockingFollowups(masterData.party_code)).filter((x) => String(x.item_key) !== String(ownOrderNo ?? ""));
  if (!open.length) return null;
  return `This customer has ${open.length} follow-up${open.length === 1 ? "" : "s"} still open (${open
    .map((x) => x.item_label || x.item_key)
    .join("; ")}). A new Free of Cost / Trial order is not allowed until it is logged on My Follow-ups.`;
}

// Approval rules (Permissions → Approvals) on Sale / Purchase / Service Orders:
// a matching new order or EDIT is held — nothing saved / the saved order left
// as it is — until an approver approves; then it is saved as its requester
// (lib/approvals/rules.js). Reached via /api/approvals/requests/[id] with the
// x-approval-post header.
const approvalHeaders = (req) => {
  const id = req.headers.get("x-approval-post");
  const raw = req.headers.get("x-approval-remarks");
  let remarks = null;
  if (raw) {
    // A malformed escape must not fail the posting — keep the raw text.
    try {
      remarks = decodeURIComponent(raw);
    } catch {
      remarks = raw;
    }
  }
  return id ? { id: Number(id), remarks } : null;
};
// An order may only be edited through its own type's route (the URL type
// decides the permission checked): a Purchase Order is not a Sale Order.
// Orders carry no data scope (lib/auth/scopeDimensions.js — "Orders are not
// limited"), so this and the 404 are the checks before the approval gate.
function orderTypeMismatchError(order, type) {
  const code = VOUCHER_CONFIG[type]?.tran_code;
  if (!order || !code) return null;
  const expected = Number(String(code)[0]);
  if (Number(order.order_catagory) === expected) return null;
  return `This document is a ${documentLabel(Number(order.order_catagory) * 100)}, not a ${documentLabel(code)}.`;
}

const bodyOf = async (req) => {
  try {
    return await req.clone().json();
  } catch {
    return null;
  }
};
import { closedGodownError } from "@/lib/godowns";
import { attachEnteredBy, ENTERED_BY_USER_SELECT, userDisplayName } from "@/lib/audit/enteredBy";

// Free of Cost / Trial Process orders carry no price at all. The client
// already zeroes the rates, but the server never trusts that.
const zeroLineRates = (lines) =>
  lines.map((l) => ({ ...l, rate: 0, st_rate: 0, amount: 0, st_amount: 0 }));

function getDatedWithCurrentTime(datedValue) {
  if (!datedValue) return new Date();
  if (typeof datedValue === "string") {
    const match = datedValue.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (match) {
      const year = parseInt(match[1], 10);
      const month = parseInt(match[2], 10) - 1;
      const day = parseInt(match[3], 10);
      const d = new Date();
      d.setFullYear(year, month, day);
      return d;
    }
  }
  const d = new Date(datedValue);
  const now = new Date();
  d.setHours(now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
  return d;
}

// GET method
export const GET = guardBy(
  async (req, { params }) => `${(await params).type}.view`,
  async (req, { params }) => {
  const { type } = await params;
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "10");
  const search = url.searchParams.get("search") || "";
  // `order_no` is accepted too: the form's select looks a saved value up by its
  // valueKey (?order_no=…), which used to be ignored and returned the latest orders.
  const orderNo = parseInt(url.searchParams.get("orderNo") || url.searchParams.get("order_no") || -1);
  // ✅ Naye date filter parameters add karein
  const startDate = url.searchParams.get("startDate");
  const endDate = url.searchParams.get("endDate");

  // Multi-value filter support (e.g. multiple invoice_no values)
  const multiFiltersParam = url.searchParams.get("multiFilters");
  let multiFilterWhere = {};
  if (multiFiltersParam) {
    try {
      const parsed = JSON.parse(multiFiltersParam);
      const conditions = Object.entries(parsed)
        .filter(([, vals]) => Array.isArray(vals) && vals.length > 0)
        .map(([field, vals]) => ({ [field]: { in: vals } }));
      if (conditions.length > 0) {
        multiFilterWhere = { AND: conditions };
      }
    } catch (e) {
      // ignore invalid JSON
    }
  }

  // ✅ Date filter logic add karein
  const dateFilter = {};
  if (startDate && endDate) {
    dateFilter.dated = {
      gte: new Date(startDate),
      lte: new Date(endDate + "T23:59:59.999Z"), // End of day
    };
  } else if (startDate) {
    dateFilter.dated = {
      gte: new Date(startDate),
    };
  } else if (endDate) {
    dateFilter.dated = {
      lte: new Date(endDate + "T23:59:59.999Z"),
    };
  }

  const skip = (page - 1) * limit;
  const status = parseInt(url.searchParams.get("status") || 1); // 0 means all
  const itemsOnly = url.searchParams.get("itemsOnly") === "true"; // ✅ NEW: Extract only items from order
  // ✅ activeOnly=true: exclude sale orders where ALL detail items are closed (status=2)
  // Used by the dispatch form so closed orders don't appear in the SO dropdown.
  const activeOnly = url.searchParams.get("activeOnly") === "true";
  // approvedOnly=true: leave out Sale Orders still waiting for approval
  // (status 3). Every picker that leads to a dispatch, invoice or production
  // passes it; activeOnly implies it. The Sale Order list itself does not, so
  // pending orders stay visible there.
  const approvedOnly =
    activeOnly || url.searchParams.get("approvedOnly") === "true";

  const config = VOUCHER_CONFIG[type]?.tran_code;

  if (!config) {
    return NextResponse.json(
      { message: "Invalid order type" },
      { status: 400 }
    );
  }

  const whereClause = {
    order_catagory: Number(config.toString()[0]),
    // ...(status > 0 && { status }),
    ...(orderNo !== -1 && { order_no: orderNo }),
    // ✅ activeOnly: exclude orders where ALL detail items are closed (status=2)
    // i.e. only include orders that have at least one active (non-closed) item
    ...(activeOnly && {
      orderDetails: {
        some: { status: { not: 2 } },
      },
    }),
    ...(approvedOnly && { status: { notIn: [SO_STATUS.PENDING_APPROVAL, SO_STATUS.REJECTED] } }),
    ...(search && {
      OR: [
        { acno: { acname: { contains: search, mode: "insensitive" } } },
        {
          order_no: {
            equals: isNaN(Number(search)) ? undefined : Number(search),
          },
        },
      ],
    }),

    ...dateFilter,
    ...multiFilterWhere,
  };

  const [orders, total] = await Promise.all([
    prisma.orderMaster.findMany({
      where: whereClause,
      skip,
      take: limit,
      orderBy: [
        { order_no: "desc" }
      ],
      include: {
        godownDetails: true,
        acno: true,
        // Name only — the whole User row would send the password hash.
        users: { select: ENTERED_BY_USER_SELECT },
        orderDetails: {
          include: {
            items: true,
          },
        },
      },
    }),
    prisma.orderMaster.count({ where: whereClause }),
  ]);

  const totalPages = Math.ceil(total / limit);

  // "Entered by": the order's user, else its AuditLog creator (one batched
  // lookup for the page) — lib/audit/enteredBy.js.
  orders.forEach((o) => { o.entered_by = userDisplayName(o.users); });
  await attachEnteredBy(orders, "OrderMaster");

  // Lines carry prev_qty / prev_rate / edited_by / edited_at (all scalars of
  // OrderDetail); add the name of whoever last changed each line's qty / rate.
  const editorIds = [
    ...new Set(orders.flatMap((o) => (o.orderDetails || []).map((d) => d.edited_by).filter(Boolean))),
  ];
  if (editorIds.length) {
    const editors = await prisma.user.findMany({
      where: { id: { in: editorIds } },
      select: ENTERED_BY_USER_SELECT,
    });
    const nameOf = new Map(editors.map((u) => [u.id, userDisplayName(u)]));
    for (const o of orders) {
      for (const d of o.orderDetails || []) {
        if (d.edited_by) d.edited_by_name = nameOf.get(d.edited_by) || null;
      }
    }
  }

  return NextResponse.json({
    data: orders,
    totalPages,
    page,
    limit,
    total,
    status: 200,
  });
  },
);

// POST  method - Create Order
// ============================================================
// LTR ⇄ KG — resolve every line before it is written
// ============================================================
// Stock is KG, so OrderDetail.qty is always KG. A line raised in litres keeps
// its litres in qty_ltr and has its KG derived from Item.ltr_rate, and it is
// priced on the litres (the rate on a LTR line is per litre).
//
// An item with no ltr_rate does NOT block a Sale Order — the order can be
// taken while the item master is still being completed. The unconvertible
// lines come back as `warnings` and the response carries them so the form can
// tell the user. The Dispatch is where this becomes a hard stop, because that
// is the document that moves stock.
//
// See lib/units/litres.js for the conversion itself.
async function applyLitreConversion(lines) {
  const itemIds = [
    ...new Set(
      lines
        .map((l) => Number(l.itcd?.value ?? l.itcd))
        .filter((n) => Number.isFinite(n)),
    ),
  ];

  const items = itemIds.length
    ? await prisma.item.findMany({
        where: { itcd: { in: itemIds } },
        select: { itcd: true, item: true, ltr_rate: true },
      })
    : [];
  const itemById = new Map(items.map((i) => [i.itcd, i]));

  const warnings = [];

  const resolved = lines.map((line) => {
    const itcd = Number(line.itcd?.value ?? line.itcd);
    const item = itemById.get(itcd);
    const ltrRate = item?.ltr_rate ?? null;

    const q = resolveLineQuantities({
      unit: line.unit,
      qty: line.qty,
      qty_ltr: line.qty_ltr,
      ltr_rate: ltrRate,
      rate: line.rate,
    });

    if (isLitreUnit(line.unit) && !q.convertible) {
      warnings.push({
        itcd,
        item: item?.item || `Item #${itcd}`,
        message: missingLtrRateMessage(item?.item),
      });
    }

    return {
      ...line,
      unit: q.unit,
      // On an unconvertible litre line qty comes back null. Null — not the
      // litre figure — because storing litres in a KG column is exactly the
      // silent error this whole change exists to stop. The order still saves.
      qty: q.qty,
      qty_ltr: q.qty_ltr,
      // Money to 2 decimals, the form's and Sale Invoicing's rule.
      amount: q.amount == null ? q.amount : round2(q.amount),
      // Sales tax follows the amount, whichever unit produced it.
      st_amount: round2((round2(q.amount) * (parseFloat(line.st_rate) || 0)) / 100),
    };
  });

  return { lines: resolved, warnings };
}

const round2 = (n) => Math.round(((Number(n) || 0) + Number.EPSILON) * 100) / 100;

export const POST = guardBy(
  async (req, { params }) => (req.headers.get("x-approval-post") ? null : `${(await params).type}.create`),
  async (req, ctx) => {
    const { type } = await ctx.params;
    const approval = approvalHeaders(req);
    if (approval) {
      return runApprovedRequest({
        requestId: approval.id,
        type,
        session: ctx.session,
        remarks: approval.remarks,
        run: (synthetic, actingSession) => createOrder(synthetic, { ...ctx, actingSession }),
      });
    }
    const body = await bodyOf(req);
    if (type === "saleOrder" && body?.master) {
      const bodyError = await saleOrderBodyError(body);
      if (bodyError) return NextResponse.json({ message: bodyError }, { status: 422 });
    }
    if (body?.master) {
      const held = await approvalGate({ type, action: "create", body, session: ctx.session });
      if (held) return held;
    }
    return createOrder(req, ctx);
  },
);

async function createOrder(req, { params, actingSession = null }) {
  try {
    const { type } = await params;
    const config = VOUCHER_CONFIG[type];
    const session = actingSession ?? await getServerSession(authOptions)
    setAuditActor(session);


    // Validate configuration
    if (!config) {
      return NextResponse.json(
        { message: "Invalid order type" },
        { status: 400 }
      );
    }

    const body = await req.json();

    // Validate request body
    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { message: "Request body must be a JSON object" },
        { status: 400 }
      );
    }

    // Settings → Features (also on an approved request's replay)
    const lineTypesOn = type === "saleOrder" && (await feature("orders.trialLineBilling"));
    if (type === "saleOrder") {
      const bodyError = await saleOrderBodyError(body);
      if (bodyError) return NextResponse.json({ message: bodyError }, { status: 422 });
    }
    // Plan Date / Plan Qty on the lines (saleOrder.planFromOrder); off → none written
    const planOn = type === "saleOrder" && (await feature("saleOrder.planFromOrder"));
    if (planOn) {
      const planError = soPlanLinesError(Array.isArray(body?.lines) ? body.lines : []);
      if (planError) return NextResponse.json({ message: planError }, { status: 422 });
    }

    const { master } = body;
    let { lines } = body;

    // Validate master and lines
    if (!master || typeof master !== "object") {
      return NextResponse.json(
        { message: "Master must be a valid object" },
        { status: 400 }
      );
    }

    if (!Array.isArray(lines)) {
      return NextResponse.json(
        { message: "Details must be a valid array" },
        { status: 400 }
      );
    }

    // Validate required fields
    if (!master.party_code) {
      return NextResponse.json(
        { message: "Party code is required" },
        { status: 400 }
      );
    }

    // Despatch Without Godown: the order always sits on its fixed godown
    // (closed in Setup, so nothing else can post to it) and is dispatched
    // from there — lib/dispatch/withoutGodown.js.
    const soWithoutGodown = type === "saleOrder" && withoutGodownOn(master);
    if (soWithoutGodown && !withoutGodownConfigured()) {
      return NextResponse.json({ message: WITHOUT_GODOWN_NOT_SET }, { status: 422 });
    }
    if (soWithoutGodown) Object.assign(master, { godown: WITHOUT_GODOWN_DISPATCH.value, noGodown: false });
    const soNoGodown = type === "saleOrder" && !soWithoutGodown && noGodownOn(master);
    if (!master.godown && !soNoGodown) {
      return NextResponse.json(
        { message: "Godown is required" },
        { status: 400 }
      );
    }

    // Debug logs (can be removed in production)




    // Period lock guard for creating orders
    const postLockError = await checkPeriodLock(master.dated, config.tran_code, { action: "create" });
    if (postLockError) {
      return NextResponse.json({ message: postLockError }, { status: 422 });
    }

    const postGodownError = soNoGodown || soWithoutGodown ? null : await closedGodownError([master.godown]);
    if (postGodownError) {
      return NextResponse.json({ message: postGodownError }, { status: 422 });
    }

    // Prepare master data
    const masterData = {
      // order_no: 0,
      additional_instructions: master.additional_instructions || null,
      freeOfCost: master.freeOfCost || null,
      region: master.region?.value || master?.region || null,
      sale_po: master.sale_po ? master.sale_po : null,
      delivery_location: master.delivery_location || null,
      payment_terms: master.payment_terms || null,
      party_code: Number(master.party_code?.value),
      delivery_terms: master.delivery_terms || null,
      order_catagory: Number(config.tran_code.toString()[0]),
      userid: session?.user?.id || "unknown", // Use email as user identifier, fallback to "unknown"
      godown: soNoGodown ? null : Number(master.godown),
      dated: type === "saleOrder" ? getDatedWithCurrentTime(master.dated) : (master.dated ? new Date(master.dated) : new Date()),
      due_date: master.due_date ? new Date(master.due_date) : null,
      req_no: master.req_no?.value
        ? parseInt(master.req_no.value)
        : master.req_no ?? null,

      status: SO_STATUS.OPEN,
    };

    const isSaleOrder = type === "saleOrder";
    if (isSaleOrder) {
      masterData.trialProcess = master.trialProcess === true;
      masterData.noGodown = soNoGodown;
      masterData.rateUnderNegotiation = ratesEditableOn(master);
      masterData.dispatchWithoutGodown = soWithoutGodown;
      masterData.urgency_level = urgencyLevelOf(master);
      // Line types on: Free of Cost / Trial lines were zeroed per line
      // (applySaleOrderLineTypes) — a Trial order's Normal lines keep their rate.
      if (zeroRatesOn(master) && !lineTypesOn) {
        lines = zeroLineRates(lines);
      }
    }

    masterData.freeOfCost =
      master.freeOfCost === true ||
      // A rate still being negotiated may be 0 for now — that is not Free of Cost.
      (!(isSaleOrder && masterData.rateUnderNegotiation) && autoFreeOfCost(lines, { lineTypesOn }));

    // Any approval reason → waits for approval (status 3).
    let soReasons = [];
    let creditWarnings = [];
    let selfApproved = false;
    if (isSaleOrder) {
      const blocked = await followupBlockMessage(masterData);
      if (blocked) return NextResponse.json({ message: blocked }, { status: 422 });
      soReasons = await saleOrderApprovalReasons(masterData, master, lines, "create");
      // Credit limit / overdue (Features saleOrder.creditLimit / overdueCheck): hold → a reason
      const credit = await customerCreditChecks(masterData.party_code, lines);
      soReasons = [...new Set([...soReasons, ...credit.holdReasons])];
      creditWarnings = credit.warnings;
      masterData.approval_reasons = soReasons.length ? reasonsText(soReasons) : null;
      if (soReasons.length) {
        selfApproved = await approvedBySaver(session, soReasons);
        if (selfApproved) stampSelfApproval(masterData, session);
        else masterData.status = SO_STATUS.PENDING_APPROVAL;
      }
    }
    // Waiting for approval (status 3) — not when the saver approved it themselves
    const held = soReasons.length > 0 && !selfApproved;

    let orderNo;

    const orderMaster = await prisma.orderMaster.create({ data: masterData });


    orderNo = orderMaster.order_no;

    // If you want to log or use the created order master, you can do so here


    // Create order master
    // const orderMaster = await prisma.orderMaster.create({ data: masterData });
    // 

    // Resolve LTR ⇄ KG before writing. Warnings do not stop the save.
    const { lines: resolvedLines, warnings: unitWarnings } =
      await applyLitreConversion(lines);

    // Sale Order: godown 3 / 9 stock snapshot per line (others: none)
    const stockOf = isSaleOrder
      ? await saleOrderStockSnapshot(resolvedLines.map((d) => d.itcd))
      : () => ({});

    // Create order details
    const orderDetailsData = resolvedLines.map((detail) => ({
      ...stockOf(detail.itcd),
      amount: detail.amount,
      no_of_packs: detail.no_of_packs,
      qty: detail.qty,
      qty_ltr: detail.qty_ltr,
      qty_per_pack: detail.qty_per_pack,
      st_amount: detail.st_amount,
      st_rate: detail.st_rate,
      rate: detail.rate,
      unit: detail.unit,
      itcd: Number(detail.itcd),
      service_id: detail.service_id?.value != null && detail.service_id?.value !== ""
        ? Number(detail.service_id.value)
        : (detail.service_id != null && detail.service_id !== ""
          ? Number(detail.service_id)
          : null),
      order_no: orderMaster.order_no,
      // Trial / Rate Negotiation per line (orders.trialLineBilling); else the column default (NORMAL)
      ...(lineTypesOn ? { line_type: lineTypeOf(detail) || LINE_TYPE.NORMAL } : {}),
      // A line marked for planning keeps its Plan Date / Qty (saleOrder.planFromOrder)
      ...(planOn ? planFieldsOf(detail) : {}),
    }));


    await prisma.orderDetail.createMany({ data: orderDetailsData });

    // Not waiting for approval → its marked lines go to their Plan Date's
    // production plan now; a held order is planned when it is approved
    // (app/api/orders/saleOrder/approval). A plan problem never undoes the order.
    const plan = planOn && !held ? await planApprovedOrder({ soNo: orderNo, session }) : null;

    // Success response
    return NextResponse.json(
      {
        message: held
          ? `${type} created — sent for approval (${reasonsText(soReasons)})`
          : selfApproved
            ? `${type} created and approved by you (${reasonsText(soReasons)})`
            : `${type} created successfully`,
        // Only reasons still waiting
        approvalReasons: held ? soReasons : [],
        plan: plan && { ok: plan.ok, message: plan.message },
        order_no: orderNo,
        party_code: String(master.party_code?.label),
        dated: new Date(master.dated),
        unitWarnings,
        // Credit limit / overdue on "warn" (shown by the form as toasts)
        warnings: creditWarnings,
        status: 201,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating order:", error);
    return NextResponse.json(
      { message: "Server error", error: error.message },
      { status: 500 }
    );
  }
}

export const PUT = guardBy(
  async (req, { params }) => (req.headers.get("x-approval-post") ? null : `${(await params).type}.update`),
  async (req, ctx) => {
    const { type } = await ctx.params;
    const approval = approvalHeaders(req);
    if (approval) {
      return runApprovedRequest({
        requestId: approval.id,
        type,
        session: ctx.session,
        remarks: approval.remarks,
        run: (synthetic, actingSession) => updateOrder(synthetic, { ...ctx, actingSession }),
      });
    }
    const body = await bodyOf(req);
    const orderNo = Number(body?.master?.order_no);
    if (orderNo) {
      const stored = await prisma.orderMaster.findUnique({
        where: { order_no: orderNo },
        select: { order_catagory: true },
      });
      if (!stored) return NextResponse.json({ message: "Order not found" }, { status: 404 });
      const mismatchError = orderTypeMismatchError(stored, type);
      if (mismatchError) return NextResponse.json({ message: mismatchError }, { status: 422 });
      if (type === "saleOrder") {
        const bodyError = await saleOrderBodyError(body, orderNo);
        if (bodyError) return NextResponse.json({ message: bodyError }, { status: 422 });
      }
      const held = await approvalGate({ type, action: "update", targetId: orderNo, targetNo: orderNo, body, session: ctx.session });
      if (held) return held;
    }
    return updateOrder(req, ctx);
  },
);

async function updateOrder(req, { params, actingSession = null }) {
  try {
    const { type } = await params;
    const config = VOUCHER_CONFIG[type];
    const session = actingSession ?? await getServerSession(authOptions);
    setAuditActor(session);

    if (!config) {
      return NextResponse.json(
        { message: "Invalid order type" },
        { status: 400 }
      );
    }

    const body = await req.json();

    if (!body || typeof body !== "object") {
      return NextResponse.json(
        { message: "Request body must be a JSON object" },
        { status: 400 }
      );
    }

    const lineTypesOn = type === "saleOrder" && (await feature("orders.trialLineBilling"));
    if (type === "saleOrder") {
      const bodyError = await saleOrderBodyError(body, body?.master?.order_no);
      if (bodyError) return NextResponse.json({ message: bodyError }, { status: 422 });
    }
    // Plan Date / Plan Qty on the lines (saleOrder.planFromOrder); off → stored ones kept, no new ones
    const planOn = type === "saleOrder" && (await feature("saleOrder.planFromOrder"));
    if (planOn) {
      const planError = soPlanLinesError(Array.isArray(body?.lines) ? body.lines : []);
      if (planError) return NextResponse.json({ message: planError }, { status: 422 });
    }

    const { master } = body;
    let { lines } = body;

    if (!master.order_no) {
      return NextResponse.json(
        { message: "order_no is required for update" },
        { status: 400 }
      );
    }

    // 🔥 Check if order exists
    const existingOrder = await prisma.orderMaster.findUnique({
      where: { order_no: Number(master.order_no) }
    });

    if (!existingOrder) {
      return NextResponse.json(
        { message: "Order not found" },
        { status: 404 }
      );
    }
    const mismatchError = orderTypeMismatchError(existingOrder, type);
    if (mismatchError) return NextResponse.json({ message: mismatchError }, { status: 422 });

    // Despatch Without Godown → its fixed godown, as on create
    const soWithoutGodown = type === "saleOrder" && withoutGodownOn(master);
    if (soWithoutGodown && !withoutGodownConfigured()) {
      return NextResponse.json({ message: WITHOUT_GODOWN_NOT_SET }, { status: 422 });
    }
    if (soWithoutGodown) Object.assign(master, { godown: WITHOUT_GODOWN_DISPATCH.value, noGodown: false });
    const soNoGodown = type === "saleOrder" && !soWithoutGodown && noGodownOn(master);

    // ================= MASTER UPDATE =================
    const masterData = {
      additional_instructions: master.additional_instructions || null,
      freeOfCost: master.freeOfCost || null,
      region: master.region?.value || master?.region || null,
      sale_po: master.sale_po || null,
      delivery_location: master.delivery_location || null,
      payment_terms: master.payment_terms || null,
      party_code: Number(master.party_code?.value),
      delivery_terms: master.delivery_terms || null,
      godown: soNoGodown ? null : Number(master.godown),
      dated: type === "saleOrder" ? getDatedWithCurrentTime(master.dated) : (master.dated ? new Date(master.dated) : new Date()),
      due_date: master.due_date ? new Date(master.due_date) : null,
      req_no: master.req_no?.value
        ? parseInt(master.req_no.value)
        : master.req_no ?? null,
    };
    // Period lock guard for updating orders
    const putLockError = await checkPeriodLock(
      [existingOrder.dated, master.dated],
      config.tran_code,
      { action: "update" },
    );
    if (putLockError) {
      return NextResponse.json({ message: putLockError }, { status: 422 });
    }

    const putGodownError = masterData.godown == null || soWithoutGodown
      ? null
      : await closedGodownError([master.godown], { allow: [existingOrder.godown] });
    if (putGodownError) {
      return NextResponse.json({ message: putGodownError }, { status: 422 });
    }




    const isSaleOrder = type === "saleOrder";
    if (isSaleOrder) {
      masterData.trialProcess = master.trialProcess === true;
      masterData.noGodown = soNoGodown;
      masterData.rateUnderNegotiation = ratesEditableOn(master);
      masterData.dispatchWithoutGodown = soWithoutGodown;
      masterData.urgency_level = urgencyLevelOf(master);
      // Line types on: Free of Cost / Trial lines were zeroed per line
      // (applySaleOrderLineTypes) — a Trial order's Normal lines keep their rate.
      if (zeroRatesOn(master) && !lineTypesOn) {
        lines = zeroLineRates(lines);
      }
    }

    masterData.freeOfCost =
      master.freeOfCost === true ||
      // A rate still being negotiated may be 0 for now — that is not Free of Cost.
      (!(isSaleOrder && masterData.rateUnderNegotiation) && autoFreeOfCost(lines, { lineTypesOn }));

    let soReasons = [];
    let creditWarnings = [];
    let selfApproved = false;
    if (isSaleOrder) {
      const blocked = await followupBlockMessage(masterData, master.order_no);
      if (blocked) return NextResponse.json({ message: blocked }, { status: 422 });
      soReasons = await saleOrderApprovalReasons(masterData, master, lines, "update");
      const credit = await customerCreditChecks(masterData.party_code, lines);
      soReasons = [...new Set([...soReasons, ...credit.holdReasons])];
      creditWarnings = credit.warnings;
      masterData.approval_reasons = soReasons.length ? reasonsText(soReasons) : null;
      if (soReasons.length) selfApproved = await approvedBySaver(session, soReasons);
      if (selfApproved) {
        // An approver's own edit: saved approved, open for dispatch
        stampSelfApproval(masterData, session);
        if (existingOrder.status === SO_STATUS.PENDING_APPROVAL || existingOrder.status === SO_STATUS.REJECTED) {
          masterData.status = SO_STATUS.OPEN;
        }
      } else if (soReasons.length) {
        // Whatever was approved before no longer describes this order, so
        // any edit sends an order with an approval reason back for approval.
        masterData.status = SO_STATUS.PENDING_APPROVAL;
        masterData.approved_by = null;
        masterData.approved_at = null;
        masterData.approval_remarks = null;
      } else if (existingOrder.status === SO_STATUS.PENDING_APPROVAL || existingOrder.status === SO_STATUS.REJECTED) {
        // No approval reason any more: it no longer needs approval (a rejected
        // order fixed this way is open again). The lines are rewritten below
        // as open, so the order is open.
        masterData.status = SO_STATUS.OPEN;
      }
    }

    await prisma.orderMaster.update({
      where: { order_no: Number(master.order_no) },
      data: masterData
    });

    // ================= DETAILS REPLACE =================

    // Sale Order: the stock snapshot each item got when first saved, so an
    // edit keeps it (read before the old lines are deleted).
    const keptStock = new Map();
    if (isSaleOrder) {
      const oldLines = await prisma.orderDetail.findMany({
        where: { order_no: Number(master.order_no), stock_total: { not: null } },
        select: { itcd: true, stock_g3: true, stock_g9: true, stock_total: true },
      });
      for (const l of oldLines) {
        if (l.itcd != null && !keptStock.has(l.itcd)) {
          keptStock.set(l.itcd, { stock_g3: l.stock_g3, stock_g9: l.stock_g9, stock_total: l.stock_total });
        }
      }
    }

    // Sale Order line edit audit: each item's qty / rate and last edit before
    // this save, so a line whose qty or rate changes is stamped with who /
    // when / the previous figures, and an unchanged line keeps its earlier
    // stamp (read before the old lines are deleted). An item may be on several
    // lines (Features saleOrder.duplicateItems = allowed): the nth line of an
    // item is compared with the nth stored line of that item, in line order.
    const oldLinesByItem = new Map(); // itcd → stored lines, oldest first
    if (isSaleOrder) {
      const oldAuditLines = await prisma.orderDetail.findMany({
        where: { order_no: Number(master.order_no) },
        select: { itcd: true, qty: true, rate: true, edited_by: true, edited_at: true, prev_qty: true, prev_rate: true, created_at: true },
        orderBy: { id: "asc" },
      });
      for (const l of oldAuditLines) {
        if (l.itcd == null) continue;
        if (!oldLinesByItem.has(l.itcd)) oldLinesByItem.set(l.itcd, []);
        oldLinesByItem.get(l.itcd).push(l);
      }
    }
    const editedAt = new Date();
    // Called once per new line, in line order (resolvedLines.map below)
    const lineAudit = (detail) => {
      if (!isSaleOrder) return {};
      const old = oldLinesByItem.get(Number(detail.itcd))?.shift();
      // A new item added on this edit: stamped, with no previous qty / rate
      if (!old) return { edited_by: session?.user?.id ?? null, edited_at: editedAt, prev_qty: null, prev_rate: null };
      const changed = (a, b) => Math.abs((Number(a) || 0) - (Number(b) || 0)) > 0.0001;
      const kept = { created_at: old.created_at ?? undefined };
      if (changed(old.qty, detail.qty) || changed(old.rate, detail.rate)) {
        return { ...kept, edited_by: session?.user?.id ?? null, edited_at: editedAt, prev_qty: old.qty, prev_rate: old.rate };
      }
      return { ...kept, edited_by: old.edited_by, edited_at: old.edited_at, prev_qty: old.prev_qty, prev_rate: old.prev_rate };
    };

    // Each item's stored line type (orders.trialLineBilling): kept as saved
    // while the feature is off, and the "before" of the trial-approved check.
    const storedLineTypes = isSaleOrder
      ? await prisma.orderDetail.findMany({
          where: { order_no: Number(master.order_no) },
          select: { itcd: true, line_type: true },
          orderBy: { id: "asc" },
        })
      : [];
    const storedTypeOf = new Map();
    for (const l of storedLineTypes) if (l.itcd != null && !storedTypeOf.has(l.itcd)) storedTypeOf.set(l.itcd, l.line_type);
    const lineTypeData = (detail) => {
      if (!isSaleOrder) return {};
      if (lineTypesOn) return { line_type: lineTypeOf(detail) || LINE_TYPE.NORMAL };
      const kept = storedTypeOf.get(Number(detail.itcd));
      return kept ? { line_type: kept } : {};
    };

    // Each item's stored Plan Date / Qty (saleOrder.planFromOrder): kept
    // through the edit — also while the feature is off (read before delete)
    const keptPlan = new Map();
    if (isSaleOrder) {
      const oldPlanLines = await prisma.orderDetail.findMany({
        where: { order_no: Number(master.order_no), OR: [{ plan_date: { not: null } }, { plan_qty: { not: null } }] },
        select: { itcd: true, plan_date: true, plan_qty: true },
      });
      for (const l of oldPlanLines) {
        if (l.itcd != null && !keptPlan.has(l.itcd)) keptPlan.set(l.itcd, { plan_date: l.plan_date, plan_qty: l.plan_qty });
      }
    }
    const planData = (detail) => {
      if (!isSaleOrder) return {};
      if (planOn && isPlanMarked(detail) && !keptPlan.has(Number(detail.itcd))) return planFieldsOf(detail);
      return keptPlan.get(Number(detail.itcd)) ?? {};
    };

    // delete old lines first
    await prisma.orderDetail.deleteMany({
      where: { order_no: Number(master.order_no) }
    });

    // Resolve LTR ⇄ KG before writing. Warnings do not stop the save.
    const { lines: resolvedLines, warnings: unitWarnings } =
      await applyLitreConversion(lines);

    // Sale Order: godown 3 / 9 stock snapshot (new items now, old ones kept)
    const stockOf = isSaleOrder
      ? await saleOrderStockSnapshot(resolvedLines.map((d) => d.itcd), keptStock)
      : () => ({});

    // insert new lines
    const orderDetailsData = resolvedLines.map((detail) => ({
      ...stockOf(detail.itcd),
      amount: detail.amount,
      no_of_packs: detail.no_of_packs,
      qty: detail.qty,
      qty_ltr: detail.qty_ltr,
      qty_per_pack: detail.qty_per_pack,
      st_amount: detail.st_amount,
      st_rate: detail.st_rate,
      rate: detail.rate,
      unit: detail.unit,
      itcd: Number(detail.itcd),
      service_id:
        detail.service_id?.value != null && detail.service_id?.value !== ""
          ? Number(detail.service_id.value)
          : detail.service_id != null && detail.service_id !== ""
            ? Number(detail.service_id)
            : null,
      order_no: Number(master.order_no),
      ...lineAudit(detail),
      ...lineTypeData(detail),
      ...planData(detail),
    }));

    await prisma.orderDetail.createMany({
      data: orderDetailsData
    });

    // Not waiting for approval → lines newly marked for planning are planned now
    const plan = planOn && !(soReasons.length && !selfApproved)
      ? await planApprovedOrder({ soNo: Number(master.order_no), session })
      : null;

    // Trial / Rate Negotiation lines turned Normal with a rate = the client
    // approved them; dispatched ones are ready to bill (lib/orders/trialBilling.js)
    const trialApproved = lineTypesOn
      ? await approvedTrialItems({ orderNo: master.order_no, before: storedLineTypes, after: resolvedLines, session })
      : { items: [], message: null };

    const savedMessage = soReasons.length && !selfApproved
      ? `${type} updated — sent for approval (${reasonsText(soReasons)})`
      : selfApproved
        ? `${type} updated and approved by you (${reasonsText(soReasons)})`
        : `${type} updated successfully`;
    return NextResponse.json({
      message: trialApproved.message ? `${savedMessage}. ${trialApproved.message}` : savedMessage,
      trialApproved: trialApproved.items,
      approvalReasons: selfApproved ? [] : soReasons,
      plan: plan && { ok: plan.ok, message: plan.message },
      order_no: Number(master.order_no),
      unitWarnings,
      warnings: [...creditWarnings, ...(trialApproved.message ? [trialApproved.message] : [])],
      status: 200,
    });

  } catch (error) {
    console.error("Error updating order:", error);
    return NextResponse.json(
      { message: "Server error", error: error.message },
      { status: 500 }
    );
  }
}

// DELETE method
export const DELETE = guardBy(
  async (req, { params }) => `${(await params).type}.delete`,
  async (req, { params }) => {
  try {
    const { type } = params;
    const config = VOUCHER_CONFIG[type];
    const session = await getServerSession(authOptions);
    setAuditActor(session);

    if (!config) {
      return NextResponse.json(
        { message: "Invalid order type" },
        { status: 400 }
      );
    }

    const { order_no } = await req.json();

    if (!order_no) {
      return NextResponse.json(
        { message: "Order number is required" },
        { status: 400 }
      );
    }

    // Check if order exists and matches type
    const existingOrder = await prisma.orderMaster.findUnique({
      where: { order_no },
    });

    if (!existingOrder) {
      return NextResponse.json({ message: "Order not found" }, { status: 404 });
    }


    if (
      existingOrder.order_catagory !== Number(config.tran_code.toString()[0])
    ) {
      return NextResponse.json(
        { message: `Order type doesn't match ${config.title}` },
        { status: 400 }
      );
    }

    // Period lock guard for deleting order
    const deleteLockError = await checkPeriodLock(existingOrder.dated, config.tran_code, { action: "delete" });
    if (deleteLockError) {
      return NextResponse.json({ message: deleteLockError }, { status: 422 });
    }

    // Delete in transaction
    await prisma.orderDetail.deleteMany({
      where: { order_no },
    });
    await prisma.orderMaster.delete({
      where: { order_no },
    });

    return NextResponse.json({
      message: `${config.title} deleted successfully`,
      status: 200,
    });
  } catch (error) {
    console.error("Error deleting order:", error);
    return NextResponse.json(
      { message: "Server error", error: error.message },
      { status: 500 }
    );
  }
  },
);
