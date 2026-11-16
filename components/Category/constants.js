import axios from "axios";
import { screenStockMode } from "@/lib/stock/policyClient";
import { featureNow, featureAsync } from "@/lib/features/client";
import { resolveProductionSetup } from "@/lib/production/setupConfig";
import { effectiveLineType, freeLine, LINE_TYPE, LINE_TYPE_OPTIONS } from "@/lib/orders/lineTypes";
import {
  CUSTOMER_GROUP_PARAM,
  VENDOR_GROUP_PARAM,
  CASH_BANK_GROUP_PARAM,
  TRANSPORTER_GROUP_PARAM,
  LC_GROUP_PARAM,
  BENEFICIARY_GROUP_PARAM,
} from "@/lib/accounts/groupParams";
import {
  UNIT_KG,
  UNIT_LTR,
  isLitreUnit,
  hasLtrRate,
  litresToKg,
  missingLtrRateMessage,
} from "@/lib/units/litres";
import {
  SO_ORDER_TYPE_OPTIONS,
  SO_ORDER_TYPE_NORMAL,
  SO_CHECKBOX_FLAGS,
  NO_GODOWN_OPTION,
  WITHOUT_GODOWN_DISPATCH,
  withoutGodownOn,
  withoutGodownConfigured,
  isWithoutGodownGodown,
  orderTypeFlags,
  zeroRatesOn,
  ratesEditableOn,
  reasonsOf,
} from "@/lib/orders/saleOrderApprovalRules";

// ── Accounts blocked on Receipt / Payment / Journal ───────────────────────
// Control accounts that must never be posted to by hand from a voucher —
// they are written only by the documents that own them (stock by GRN /
// dispatch / production, sales by dispatch invoicing). Picking them on a
// Receipt, Payment or JV puts the subsidiary ledger out of step with the
// control account, so they are kept out of every picker on those vouchers.
// The accounts are the "Accounts not allowed on manual vouchers" list of
// Finance → Account Settings; /api/accounts/acno resolves ?excludeList=.
// An account already saved on an existing voucher still resolves its label:
// the API skips this filter for an exact acno lookup.
const BLOCKED_VOUCHER_PARAM = "excludeList=blocked_voucher_accounts";

// ── Payment / Receipt line accounts ───────────────────────────────────────
// The lines of a Payment or Receipt are the other half of the entry, so they
// may name any account — including another cash/bank one, which is how a
// contra (Petty Cash → Bank) gets recorded. The accounts they must not name
// are the one picked in `pycd` (posting it against itself is a no-op) and the
// blocked control accounts above.
const contraAccountsEndpoint = (masterData) => {
  const raw = masterData?.pycd;
  const pycd = raw && typeof raw === "object" ? raw.value : raw;
  return pycd
    ? `/api/accounts/acno?${BLOCKED_VOUCHER_PARAM}&excludeAcno=${encodeURIComponent(pycd)}`
    : `/api/accounts/acno?${BLOCKED_VOUCHER_PARAM}`;
};

// Journal lines: any account except the blocked control accounts.
const journalAccountsEndpoint = `/api/accounts/acno?${BLOCKED_VOUCHER_PARAM}`;

// ── Sub Account (Payment / Receipt / Journal lines) ───────────────────────
// A name kept under the line's account (Finance → Sub Accounts, model
// subAccount); the name is what is saved (Transactions.sub_account). Shown
// only while Settings → Features "vouchers.subAccounts" is on; required when
// the account's main account is in Account Settings "sub_account_groups"
// (the server checks the same: lib/vouchers/subAccounts.js).
const lineAcnoOf = (line) => line?.acno?.value ?? line?.acno;
// Payment / receipt line Tax Law (Settings → Features "tax.lineWht"): the server
// sets the WHT rate by the line account's filer status and books the deduction
// on the law's payable account (lib/tax/lineWht.js).
const taxLawLineField = {
  name: "taxLaws",
  formName: "tax_law_code",
  label: "Tax Law",
  type: "select",
  feature: "tax.lineWht",
  featureKeep: (saved) => (saved?.lines || saved?.transactions || []).some?.((l) => l?.tax_law_code),
  options: "taxLaws",
  apiEndpoint: "/api/setup/tax_laws",
  nameKey: "section_description",
  valueKey: "tax_law_code",
  clearable: true,
};

const subAccountLineField = {
  name: "sub_account",
  label: "Sub Account",
  type: "select",
  feature: "vouchers.subAccounts",
  apiEndpoint: (masterData, line) => {
    const acno = lineAcnoOf(line);
    return acno ? `/api/sub-accounts?acno=${encodeURIComponent(acno)}` : null;
  },
  createEndpoint: "/api/sub-accounts",
  // a new name is saved in CAPS under the line's A/c
  createData: (text, masterData, line) => ({ acno: lineAcnoOf(line), acname: String(text).toUpperCase() }),
  upperCase: true,
  requiredWhen: async (line) => {
    const acno = lineAcnoOf(line);
    if (!acno) return false;
    try {
      const res = await axios.get("/api/sub-accounts", { params: { acno, required: 1 } });
      return res.data?.required === true;
    } catch {
      return false;
    }
  },
  nameKey: "acname",
  valueKey: "acname",
};

// ── LTR ⇄ KG line fields (Sale Order and Dispatch) ────────────────────────
// Stock is KG. A line may be transacted in litres, in which case the litres
// are what the customer ordered and what the rate prices, and the KG figure
// that moves stock is derived from the item's ltr_rate (KG per litre).
//
// The two quantity columns are kept SEPARATE in the form rather than one box
// that changes meaning, so what the user sees is what the database holds and
// an edit round-trips without translation:
//
//   Qty (LTR)  editable on a LTR line, blank on a KG line
//   Qty (KG)   editable on a KG line, derived and read-only on a LTR line
//
// See lib/units/litres.js for the conversion and why a missing ltr_rate only
// warns on a Sale Order but blocks a Dispatch.

// Form.jsx invokes `calculate` from two places with DIFFERENT arguments:
//   calculateFieldValue()  → calculate(dependencies, line)
//   the render path        → calculate(line, context)
// `dependencies` holds only the fields named in `dependencies: [...]`, so a
// calculation that reaches for anything else (ltr_rate, say) silently gets
// undefined and returns a wrong number. This merges the two shapes so a
// calculate always sees the whole line, whichever call site ran it.
const calcLine = (a, b) => {
  const looksLikeLine =
    b && typeof b === "object" && !("lastEditedField" in b);
  return {
    ...(looksLikeLine ? b : {}),
    ...(a && typeof a === "object" ? a : {}),
  };
};

// The KG figure is produced in the `onChange` of the fields that drive it
// rather than through `calculate`. `calculate` fields are forcibly recomputed
// whenever any dependency changes, which would wipe a hand-typed KG the moment
// the user touched the unit; an onChange only fires for the field the user
// actually edited.
const kgFromLine = (line) =>
  isLitreUnit(line?.unit) ? litresToKg(line?.qty_ltr, line?.ltr_rate) ?? "" : line?.qty;

// Packs are the input on a dispatch: No of Packs × Qty Per Pack. On a LTR line
// that product is LITRES (a 20-litre drum), and the KG is then derived from
// them; on a KG line it is the KG directly.
const packTotal = (line) =>
  (parseFloat(line?.no_of_pack) || 0) * (parseFloat(line?.qty_per_pack) || 0);

/** Unit picker for a sale-order line. Dispatch inherits the unit instead. */
export const createUnitField = (config = {}) => ({
  name: "unit",
  label: "Unit",
  type: "normalSelect",
  options: [
    { value: UNIT_KG, label: UNIT_KG },
    { value: UNIT_LTR, label: UNIT_LTR },
  ],
  defaultValue: UNIT_KG,
  width: "70px",
  // Switching a line to LTR whose item has no LTR Rate is ALLOWED — the order
  // can be taken while the item master is still being completed — but the user
  // is warned, because the dispatch against it will be refused until it is set.
  onChange: (value, line) => {
    const unit = value || line?.unit;
    if (!isLitreUnit(unit)) {
      // Back to KG: the litre figure no longer applies to this line.
      const next = { ...line, unit, qty_ltr: null };
      return { unit, qty_ltr: null, ...soPackFields(next) };
    }
    const next = { ...line, unit };
    return {
      unit,
      qty: kgFromLine(next),
      ...soPackFields(next),
      __warn: hasLtrRate(line?.ltr_rate)
        ? undefined
        : missingLtrRateMessage(line?.item_name),
    };
  },
  ...config,
});

// ── Finished-goods categories (Settings → Production setup) for config
// callbacks that cannot use hooks/useProductionSetup.js. Sync read: the stored
// setup once loaded (fetched on first use, refreshed every minute), the
// defaults (resolveProductionSetup) until then. ──────────────────────────
let productionSetupCache = { at: 0, setup: null, loading: false };
export function finishedCategoryIdsNow() {
  const stale = Date.now() - productionSetupCache.at > 60_000;
  if (stale && !productionSetupCache.loading && typeof window !== "undefined") {
    productionSetupCache.loading = true;
    axios
      .get("/api/settings/production-setup")
      .then((r) => { productionSetupCache = { at: Date.now(), setup: r.data?.values ?? null, loading: false }; })
      .catch(() => { productionSetupCache = { ...productionSetupCache, at: Date.now(), loading: false }; });
  }
  const ids = (productionSetupCache.setup ?? resolveProductionSetup(null)).finishedCategoryIds || [];
  return ids.length ? ids : resolveProductionSetup(null).finishedCategoryIds;
}

// A godown field's default from Settings → Production setup: the stored value
// once Form.jsx has loaded it (field.defaultGodown), the setup's default until
// then — never a fixed id here.
const setupGodownDefault = (key) => {
  const id = String(resolveProductionSetup(null)[key]);
  return { value: id, label: id };
};

// Production Plan line Nature (Settings → Features "production.labNature")
const PLAN_NATURE_OPTIONS = ["FINISHED", "PROCESS", "MANUFACTURING"].map((v) => ({ value: v, label: v }));

// ── Sale Order line Type (Settings → Features "orders.trialLineBilling") ──
// A line's rate is 0 and locked when it is free: with line types on, a Free of
// Cost order or a Trial line (lib/orders/lineTypes.js); otherwise (SMS) a Free
// of Cost / Trial Process order.
const trialLinesOn = () => featureNow("orders.trialLineBilling") === true;
export const soLineFree = (master, line) => (trialLinesOn() ? freeLine(master, line) : zeroRatesOn(master));

// To Trial: rate 0 (the customer rate is kept to come back to). Back to
// Normal / Rate Negotiation: the kept rate, or the customer's rate from Sales
// Items when the line was saved at 0. Shown only while the feature is on.
const saleOrderLineTypeField = () => ({
  name: "line_type",
  label: "Type",
  type: "normalSelect",
  options: LINE_TYPE_OPTIONS,
  defaultValue: LINE_TYPE.NORMAL,
  feature: "orders.trialLineBilling",
  width: "150px",
  // Free of Cost is the whole order — every line free, no line type
  readOnly: (line, master) => master?.freeOfCost === true,
  onChange: async (value, line, allLines, master) => {
    const line_type = value?.value ?? value ?? LINE_TYPE.NORMAL;
    const origRate = line.original_rate !== undefined ? line.original_rate : line.rate;
    const origSt = line.original_st_rate !== undefined ? line.original_st_rate : line.st_rate;
    if (line_type === LINE_TYPE.TRIAL) {
      return { line_type, rate: 0, st_rate: 0, original_rate: origRate, original_st_rate: origSt };
    }
    let rate = Number(origRate) || 0;
    let st_rate = Number(origSt) || 0;
    const itcd = line?.itcd?.value ?? line?.itcd;
    const party = master?.party_code?.value ?? master?.party_code;
    if (!(rate > 0) && itcd && party) {
      try {
        const { data } = await axios.get(`/api/forms/customers/rates?acno=${party}&itcd=${itcd}`);
        const c = data?.customers?.[0] || {};
        rate = Number(c.rate) || 0;
        st_rate = Number(c.gst_rate) || st_rate;
      } catch {
        /* keep 0 — the rate can be typed */
      }
    }
    return { line_type, rate, st_rate, original_rate: rate, original_st_rate: st_rate };
  },
});

// Settings → Features "saleOrder.litreUnits": the Unit / Qty (LTR) columns of a
// Sale Order exist while it is on — or when the saved order already has a LTR line.
const savedHasLitreLine = (saved) => (saved?.lines || []).some((l) => isLitreUnit(l?.unit));
const LITRE_FEATURE = { feature: "saleOrder.litreUnits", featureKeep: savedHasLitreLine };

// The Sale Order carries no packing grid, but OrderDetail still stores
// no_of_packs / qty_per_pack — the field this replaced set them to 1 × qty.
// Keep doing that, against whichever unit the line is transacted in, so those
// two columns hold what they always did.
const soPackFields = (line) => ({
  no_of_packs: 1,
  qty_per_pack: isLitreUnit(line?.unit)
    ? parseFloat(line?.qty_ltr) || 0
    : parseFloat(line?.qty) || 0,
});

// Sale Order: a LTR line whose item has no LTR Rate cannot be converted to
// KG, so the order is refused with this instead of "Qty (KG) is required".
const soMissingLtrRate = (line) =>
  `${line?.item_name || "This item"} has no Litre Rate set in Item Setup — ` +
  `please get it set by the Lab department.`;

/** Litres. Only meaningful on a LTR line; drives qty (KG) and the amount. */
export const createQtyLtrField = (config = {}) => ({
  name: "qty_ltr",
  label: "Qty (LTR)",
  type: "number",
  width: "120px",
  readOnly: (line) => !isLitreUnit(line?.unit),
  // Typing litres restates the KG that will move stock.
  onChange: (_value, line) => ({
    qty: kgFromLine(line),
    ...soPackFields(line),
  }),
  validate: (value, line) => {
    if (!isLitreUnit(line?.unit)) return null;
    if (!hasLtrRate(line?.ltr_rate)) return soMissingLtrRate(line);
    if (!(parseFloat(value) > 0)) return "Enter the quantity in litres";
    return null;
  },
  ...config,
});

/**
 * Kilograms — the stock figure. Typed on a KG line; derived and locked on a
 * LTR line, where it is written by the two onChanges above.
 */
export const createQtyKgField = (config = {}) => ({
  name: "qty",
  label: "Qty (KG)",
  type: "number",
  required: true,
  width: "120px",
  readOnly: (line) => isLitreUnit(line?.unit),
  onChange: (_value, line) => soPackFields(line),
  validate: (value, line) => {
    if (isLitreUnit(line?.unit)) {
      // Blank KG on a litre line means the item has no LTR Rate. Say so,
      // instead of the generic "Qty (KG) is required" (this message replaces it).
      return hasLtrRate(line?.ltr_rate) ? null : soMissingLtrRate(line);
    }
    if (!(parseFloat(value) > 0)) return "Quantity must be greater than 0";
    return null;
  },
  ...config,
});

/** amount = (litres × rate) on a LTR line, (KG × rate) on a KG line. */
export const litreAwareAmount = (line) => {
  const rate = parseFloat(line?.rate) || 0;
  const qty = isLitreUnit(line?.unit)
    ? parseFloat(line?.qty_ltr) || 0
    : parseFloat(line?.qty) || 0;
  return qty * rate;
};

// âœ… UNIVERSAL FIELD LOCKING SYSTEM FOR EDIT MODE
export const createLockableField = (config = {}) => {
  const baseConfig = {
    // Lock configuration
    lockInEdit: config.lockInEdit || false, // Set to true to lock in edit mode
    lockConditions: config.lockConditions || [], // Array of conditions to lock field

    // Existing field properties
    ...config,
  };

  return baseConfig;
};

// âœ… LOCK CONDITIONS SYSTEM
export const LOCK_CONDITIONS = {
  // Lock if document is completed/fully processed
  DOCUMENT_COMPLETED: "document_completed",
  // Lock if field has value
  HAS_VALUE: "has_value",
  // Lock based on status
  STATUS: "status",
  // Custom condition function
  CUSTOM: "custom",
};

// âœ… UNIVERSAL FIELD LOCK CHECK
export const shouldLockField = (
  fieldConfig,
  formData,
  editMode,
  documentStatus,
) => {
  if (!editMode) return false;

  const { lockInEdit, lockConditions } = fieldConfig;

  // If explicitly set to lock in edit mode
  if (lockInEdit) return true;

  // Check lock conditions
  if (lockConditions && lockConditions.length > 0) {
    return lockConditions.some((condition) => {
      switch (condition.type) {
        case LOCK_CONDITIONS.DOCUMENT_COMPLETED:
          return documentStatus?.isCompleted || false;

        case LOCK_CONDITIONS.HAS_VALUE:
          const fieldName = fieldConfig.formName || fieldConfig.name;
          const value = formData[fieldName];
          return value !== undefined && value !== null && value !== "";

        case LOCK_CONDITIONS.STATUS:
          return condition.statuses?.includes(documentStatus?.status);

        case LOCK_CONDITIONS.CUSTOM:
          return condition.check
            ? condition.check(formData, documentStatus)
            : false;

        default:
          return false;
      }
    });
  }

  return false;
};
// âœ… UNIVERSAL STATUS CHECK FOR ALL DOCUMENT TYPES
export const checkDocumentStatus = async (entry, type) => {

  try {
    switch (type) {
      // case "transfer":

      //   // Transfer Status: Check requisition completion and stock availability
      //   if (entry.tran_id) {
      //     const reqRes = await axios.get(
      //       `/api/voucher/checkTransactionQty?req_no=${entry.tran_id}`,
      //     );
      //     const summary = reqRes.data.summary || {};

      //     // Check stock for all items in the transfer
      //     let hasStockIssues = false;
      //     let stockDetails = [];

      //     if (entry.details && entry.godown) {
      //       const productIds = entry.details.map((t) => t.itcd).filter(Boolean);

      //       if (productIds.length > 0) {
      //         try {
      //           const stockRes = await axios.post("/api/voucher/check-stock", {
      //             productIds: productIds,
      //             godown: entry.godown,
      //           });

      //           entry.details.forEach((transaction) => {
      //             const currentStock =
      //               stockRes.data[transaction.itcd?.value] || 0;
      //             const requiredQty = transaction.qty || 0;

      //             if (requiredQty > currentStock) {
      //               hasStockIssues = true;
      //               stockDetails.push(
      //                 `Item ${transaction.itcd}: Needs ${requiredQty}, Has ${currentStock}`,
      //               );
      //             }
      //           });
      //         } catch (stockError) {
      //           console.error("Stock check failed:", stockError);
      //         }
      //       }
      //     }

      //     const totalOrdered =
      //       entry.details?.reduce((sum, t) => sum + (t.qty || 0), 0) || 0;
      //     const totalTransferred = summary.totalQty || 0;
      //     const isCompleted = totalTransferred >= totalOrdered;

      //     return {
      //       status: isCompleted
      //         ? "Fully Transferred"
      //         : hasStockIssues
      //           ? "Stock Issues"
      //           : "Pending",
      //       allowEdit: !isCompleted && !hasStockIssues,
      //       details: hasStockIssues
      //         ? `Stock issues detected`
      //         : `Transferred: ${totalTransferred}/${totalOrdered}`,
      //       warnings: hasStockIssues ? stockDetails : [],
      //     };
      //   }
      //   break;

      case "grn":
        // GRN Status: Check if PO is fully received (ITEM-WISE from API)
        if (entry.order_no) {
          const res = await axios.get(
            `/api/voucher/checkOrderQty?po_no=${entry.order_no}`,
          );

          const summary = res.data.summary || {};
          const qcSummary = res.data.qc_summary || {};

          // Use API data as single source of truth
          const itemWiseReceived = summary.itemWiseQty || {};
          const orderedItemWiseQty = summary.orderedItemWiseQty || {};
          const totalOrdered = summary.totalOrderedQty || 0;
          const totalReceived = summary.totalQty || 0;

          // Item-wise check: PO is fully received only when EVERY ordered item is received
          let allItemsFullyReceived = true;
          const orderedItems = Object.keys(orderedItemWiseQty);
          if (orderedItems.length === 0) allItemsFullyReceived = false;

          for (const itemId of orderedItems) {
            const orderedQty = orderedItemWiseQty[itemId] || 0;
            const receivedQty = itemWiseReceived[itemId] || 0;
            if (receivedQty < orderedQty) {
              allItemsFullyReceived = false;
            }
          }

          const overallQCStatus = qcSummary.overall_status || "NO_QC_REQUIRED";
          const isFullyReceived = allItemsFullyReceived && orderedItems.length > 0;
          const isQCApproved = overallQCStatus === "ALL_APPROVED";
          const isQCDraft = overallQCStatus === "DRAFT"; // DRAFT status

          let status = isFullyReceived ? "Fully Received" : "Pending";
          let details = `Received: ${totalReceived}/${totalOrdered} | QC: ${overallQCStatus}`;

          // Logic: Can edit GRN ONLY when:
          // 1. Order is fully received AND
          // 2. QC is APPROVED (not DRAFT/PENDING)
          const allowEdit = !isFullyReceived && isQCApproved;

          // Update status message
          if (isFullyReceived) {
            if (isQCApproved) {
              status = "Fully Received (QC Approved)";
            } else if (isQCDraft) {
              status = "Fully Received (QC Pending)";
            } else if (overallQCStatus === "ALL_REJECTED") {
              status = "Fully Received (QC Rejected)";
            } else if (overallQCStatus === "PENDING_APPROVAL") {
              status = "Fully Received (QC Pending)";
            }
          }

          return {
            status,
            allowEdit, // TRUE only when fully received AND QC approved
            details,
          };
        }
        break;
      case "dispatch":
        // Dispatch Status with +10% max variance (ITEM-WISE from API)
        if (entry.order_no) {
          const res = await axios.get(
            `/api/voucher/checkOrderQty?so_no=${entry.order_no}`,
          );

          const summary = res.data.summary || {};

          // Use API data as single source of truth
          const itemWiseDispatched = summary.itemWiseQty || {};
          const orderedItemWiseQty = summary.orderedItemWiseQty || {};
          const totalOrdered = summary.totalOrderedQty || 0;
          const totalDispatched = summary.totalQty || 0;

          // Item-wise check: dispatch complete only when EVERY ordered item is dispatched
          let allItemsFullyDispatched = true;
          let anyExceedsVariance = false;
          const orderedItems = Object.keys(orderedItemWiseQty);
          if (orderedItems.length === 0) allItemsFullyDispatched = false;

          // Band: Settings → Features "dispatch.overDispatchTolerance" (SMS 10 %)
          const pct = Number(await featureAsync("dispatch.overDispatchTolerance")) || 0;
          for (const itemId of orderedItems) {
            const orderedQty = orderedItemWiseQty[itemId] || 0;
            const dispatchedQty = itemWiseDispatched[itemId] || 0;
            const maxAllowed = orderedQty * (1 + pct / 100);
            if (dispatchedQty < maxAllowed) {
              allItemsFullyDispatched = false;
            }
            if (dispatchedQty > maxAllowed) {
              anyExceedsVariance = true;
            }
          }

          const isFullyDispatched = allItemsFullyDispatched && orderedItems.length > 0;
          const exceedsVariance = anyExceedsVariance;

          return {
            status: exceedsVariance
              ? `Over Dispatched (Exceeds ${pct}%)`
              : isFullyDispatched
                ? "Fully Dispatched"
                : "Pending",

            // ðŸ”’ Lock only when ALL items dispatched >= max allowed
            allowEdit: !isFullyDispatched,

            details: `Dispatched: ${totalDispatched}/${totalOrdered} (Max +${pct}% allowed)`,
          };
        }

        break;
      case "purchaseOrder":
        // Requisition Status: Check if fully issued
        if (entry.tran_id) {
          const res = await axios.get(
            `/api/voucher/checkOrderQty?req_no=${entry.tran_id}`,
          );

          const totalIssued = res.data.issued?.totalIssued || 0;
          const totalReceived = res.data.required?.totalReceived || 0;

          return {
            status: totalReceived >= totalIssued ? "Fully Issued" : "Pending",
            allowEdit: totalReceived <= totalIssued,
            details: `Issued: ${totalIssued} Received:  ${totalReceived}`,
          };
        }

        break;
      case "saleOrder":
        // Free of Cost / Trial order still waiting for the approver. Without this
        // it fell through to "Complete" (anything but status 1 read as done).
        if (entry.status === 4) {
          return {
            status: "Rejected",
            allowEdit: true,
            details: `Rejected${entry.approval_remarks ? `: ${entry.approval_remarks}` : ""} — edit to send for approval again`,
          };
        }
        if (entry.status === 3) {
          return {
            status: "Pending Approval",
            allowEdit: true,
            details: `${reasonsOf(entry).join(", ") || "Approval"} — awaiting approval`,
          };
        }
        if (entry.order_no) {
          const res = await axios.get(
            `/api/voucher/checkOrderQty?so_no=${entry.order_no}`,
          );

          const summary = res.data.summary || {};
          const totalOrdered =
            entry.orderDetails?.reduce((sum, t) => sum + (t.qty || 0), 0) || 0;

          const totalReceived = summary.totalQty || 0;

          // ðŸ”¹ Only MAX variance allowed (+10%)
          const maxAllowed = totalOrdered * 1.1;

          const isOverLimit = totalReceived > maxAllowed;
          const isFullyReceived = totalReceived >= maxAllowed;

          return {
            // status: isOverLimit
            //   ? "Over Received (Exceeds 10%)"
            //   : isFullyReceived
            //     ? "Complete"
            //     : "Pending",

            status: summary.status === 1 ? "Pending" : "Complete",

            // ðŸ”’ Lock ONLY when order is fully received (even if under)
            // allowEdit: !isFullyReceived,
            allowEdit: true,
            details: `Received: ${totalReceived}/${totalOrdered} (Max +10% allowed)`,
          };
        }

        break;
      case "requisition":
        // This case applies ONLY when req_catagory = "PURCHASE"
        if (entry.tran_id && entry.req_catagory === "PURCHASE") {
          const res = await axios.get(
            `/api/voucher/checkOrderQty?req_no=${entry.tran_id}`,
          );

          const totalIssued = res.data.issued?.totalIssued || 0;
          const totalRequired = res.data.required?.totalReceived || 0;

          return {
            status: totalRequired >= totalIssued ? "Fully Issued" : "Pending",
            allowEdit: totalRequired < totalIssued,
            details: `Issued: ${totalIssued} / Received: ${totalRequired}`,
          };
        }

        // If req_catagory = TRANSFER, use transaction qty logic
        if (entry.tran_id && entry.req_catagory === "TRANSFER") {
          const res = await axios.get(
            `/api/voucher/checkTransactionQty?req_no=${entry.tran_id}`,
          );

          const totalTransferred = res.data.summary?.totalQty || 0;
          const totalRequired =
            entry.details?.reduce((sum, d) => sum + (d.qty || 0), 0) || 0;

          return {
            status:
              totalTransferred >= totalRequired
                ? "Fully Transferred"
                : "Pending",
            allowEdit: totalTransferred < totalRequired,
            details: `Transferred: ${totalTransferred} / Required: ${totalRequired}`,
          };
        }

        break;
      case "requisitionTransfer":
        // This case applies ONLY when req_catagory = "PURCHASE"
        if (entry.tran_id && entry.req_catagory === "PURCHASE") {
          const res = await axios.get(
            `/api/voucher/checkOrderQty?req_no=${entry.tran_id}`,
          );

          const totalIssued = res.data.issued?.totalIssued || 0;
          const totalRequired = res.data.required?.totalReceived || 0;

          return {
            status: totalRequired >= totalIssued ? "Fully Issued" : "Pending",
            allowEdit: totalRequired < totalIssued,
            details: `Issued: ${totalIssued} / Received: ${totalRequired}`,
          };
        }

        // If req_catagory = TRANSFER, use transaction qty logic
        if (entry.tran_id && entry.req_catagory === "TRANSFER") {
          const res = await axios.get(
            `/api/voucher/checkTransactionQty?req_no=${entry.tran_id}`,
          );

          const totalTransferred = res.data.summary?.totalQty || 0;
          const totalRequired =
            entry.details?.reduce((sum, d) => sum + (d.qty || 0), 0) || 0;

          return {
            status:
              totalTransferred >= totalRequired
                ? "Fully Transferred"
                : "Pending",
            allowEdit: totalTransferred < totalRequired,
            details: `Transferred: ${totalTransferred} / Required: ${totalRequired}`,
          };
        }

        break;

      case "requisitionFGTransfer":
        // FG Transfer requisition: check tran_code=11 transfers against this req
        if (entry.tran_id && entry.req_catagory === "FG_TRANSFER") {
          const res = await axios.get(
            `/api/voucher/checkTransactionQty?req_no=${entry.tran_id}`,
          );

          const totalTransferred = res.data.summary?.totalQty || 0;
          const totalRequired =
            entry.details?.reduce((sum, d) => sum + (d.qty || 0), 0) || 0;

          return {
            status:
              totalTransferred >= totalRequired
                ? "Fully Transferred"
                : "Pending",
            allowEdit: totalTransferred < totalRequired,
            details: `Transferred: ${totalTransferred} / Required: ${totalRequired}`,
          };
        }

        break;

      case "fgTransfer":
        // FG Transfer document: same logic as transfer — check req completion
        if (entry.tran_id) {
          const reqRes = await axios.get(
            `/api/voucher/checkTransactionQty?req_no=${entry.tran_id}`,
          );
          const summary = reqRes.data.summary || {};

          const totalOrdered =
            entry.details?.reduce((sum, t) => sum + (t.qty || 0), 0) || 0;
          const totalTransferred = summary.totalQty || 0;
          const isCompleted = totalTransferred >= totalOrdered;

          return {
            status: isCompleted ? "Fully Transferred" : "Pending",
            allowEdit: !isCompleted,
            details: `Transferred: ${totalTransferred}/${totalOrdered}`,
          };
        }

        break;
      case "purchaseReturn":
        // GRN Status: Check if PO is fully received
        if (entry.po_no) {
          const res = await axios.get(
            `/api/voucher/checkReturnQty?po_no=${entry.po_no}&grn_no=${entry.grn_no}`,
          );
          const summary = res.data.summary || {};
          const totalOrdered =
            entry.transactions?.reduce((sum, t) => sum + (t.qty || 0), 0) || 0;
          const totalReceived = summary.totalQty || 0;

          return {
            status:
              totalReceived >= totalOrdered ? "Fully Returned" : "Pending",
            allowEdit: totalReceived < totalOrdered,
            details: `Returned: ${totalReceived}/${totalOrdered}`,
          };
        }
        break;
      case "saleReturn":
        // A sale return is editable like any document. (This used to compare
        // the returns against the return's OWN lines, which always matched
        // and locked every return made against a Sale Order.)
        return { status: "Active", allowEdit: true, details: "" };

      default:
        // Default status for other document types
        return {
          status: "Active",
          allowEdit: true,
          details: "",
        };
    }
  } catch (error) {
    console.error(`Error checking status for ${type}:`, error);
    return {
      status: "Unknown",
      allowEdit: true,
      details: "Status check failed",
    };
  }
};

// âœ… UNIVERSAL AVAILABLE QTY DISPLAY SYSTEM
export const createQtyFieldWithAvailable = (config = {}) => {
  const baseConfig = {
    name: "qty",
    label: "Qty",
    type: "number",
    required: true,
    dependencies: ["no_of_pack", "qty_per_pack"],
    calculate: (v) => (v.no_of_pack || 0) * (v.qty_per_pack || 0),

    // âœ… ADD THIS: Available quantity info for display
    getAvailableInfo: async (line, formData) => {
      // Default implementation - override in custom config
      if (config.getAvailableInfo) {
        return await config.getAvailableInfo(line, formData);
      }

      // Universal fallback - check common available quantity fields
      if (line.available_qty !== undefined) {
        return {
          available: line.available_qty,
          label: "Available",
        };
      }

      if (line.po_qty !== undefined) {
        return {
          available: line.po_qty,
          label: "Ordered",
        };
      }

      if (line.so_qty !== undefined) {
        return {
          available: line.so_qty,
          label: "Ordered",
        };
      }

      if (line.stock !== undefined) {
        return {
          available: line.stock,
          label: "In Stock",
        };
      }

      return null;
    },

    validate: async (value, line, allLines, formData) => {
      const numericValue = parseFloat(value) || 0;
      // What qty must be. Packs × per pack by default; a caller can override
      // (dispatch: on a LTR line packs give LITRES and KG is converted, so the
      // plain product would wrongly flag every litre line). null = skip.
      const calculatedQty = config.expectedQty
        ? config.expectedQty(line)
        : (line.no_of_pack || 0) * (line.qty_per_pack || 0);

      // Block if doesn't match calculation
      if (calculatedQty !== null && Math.abs(numericValue - calculatedQty) > 0.001) {
        return `Quantity must match: ${calculatedQty} (${line.no_of_pack || 0} x ${line.qty_per_pack || 0})`;
      }

      const availableInfo = await baseConfig.getAvailableInfo(line, formData);
      const bd = availableInfo?.breakdown || {};
      const itemId = String(line.itcd?.value || line.itcd);
      const itemName = line.itcd?.label || line.item || `Item ${itemId}`;


      // Accumulate quantity from previous rows in allLines for the SAME item
      let previousRowsQty = 0;
      if (Array.isArray(allLines)) {
        const currentLineIndex = allLines.indexOf(line);
        const limitIndex = currentLineIndex >= 0 ? currentLineIndex : allLines.length;
        for (let i = 0; i < limitIndex; i++) {
          const prevLine = allLines[i];
          if (!prevLine) continue;
          // A caller can leave lines out of the running total (dispatch: a
          // line produced from its BOM does not draw on stock).
          if (config.skipInRunningTotal && config.skipInRunningTotal(prevLine)) continue;
          const prevItemId = String(prevLine.itcd?.value || prevLine.itcd || "");
          if (prevItemId && prevItemId === itemId) {
            previousRowsQty += (parseFloat(prevLine.qty) || (parseFloat(prevLine.no_of_pack || 0) * parseFloat(prevLine.qty_per_pack || 0)) || 0);
          }
        }
      }

      const totalItemQtyInForm = previousRowsQty + numericValue;

      // ── DISPATCH / TRANSFER (breakdown carries godown stock) ──────────────────
      // Two INDEPENDENT rules:
      //   1) STOCK  → as the stock check policy says for config.stockCheckType
      //      (Settings → Stock checking; lib/stock/policyClient.js): block = hard
      //      block, NO tolerance; warn = flagged `isStockWarning` (the form shows
      //      it and still saves); off = not checked. No type → block (as before).
      //   2) SALE ORDER qty → ±10% tolerance (this is the only place tolerance applies)
      if (bd.stockAvailable !== undefined) {
        const stock = Number(bd.stockAvailable) || 0;
        const stockMode = config.stockCheckType
          ? await screenStockMode(config.stockCheckType)
          : "block";
        // Word the message for whichever transaction actually produced this breakdown.
        const actionLabel = bd.alreadyDispatched !== undefined
          ? "dispatch"
          : bd.alreadyTransferred !== undefined
            ? "transfer"
            : "process";

        let stockIssue = null;
        // 1a) No stock at all (zero OR negative) → block
        if (stockMode === "off") {
          // not checked
        } else if (totalItemQtyInForm > 0 && stock <= 0) {
          stockIssue = {
            __varianceModal__: true,
            itemId,
            itemName,
            isAvailabilityError: true,
            available: stock,
            currentQty: totalItemQtyInForm,
            exceedBy: totalItemQtyInForm.toFixed(2),
            message: `No stock available (current stock: ${stock.toFixed(2)} KG). Cannot ${actionLabel} ${totalItemQtyInForm.toFixed(2)} KG.`,
          };
        } else if (totalItemQtyInForm > stock) {
          // 1b) Requested more than physical stock → block (NO tolerance on stock)
          //     The same item on earlier lines is counted first: stock 100, line 1
          //     takes 50, so line 2 only has 50 left.
          const shortBy = (totalItemQtyInForm - stock).toFixed(2);
          const leftForLine = Math.max(0, stock - previousRowsQty);
          stockIssue = {
            __varianceModal__: true,
            itemId,
            itemName,
            isAvailabilityError: true,
            available: leftForLine,
            currentQty: totalItemQtyInForm,
            exceedBy: shortBy,
            message:
              previousRowsQty > 0
                ? `Insufficient stock. Stock ${stock.toFixed(2)} KG, earlier lines of this item ${previousRowsQty.toFixed(2)} KG, so ${leftForLine.toFixed(2)} KG is left for this line but it asks ${numericValue.toFixed(2)} KG (Short by: ${shortBy} KG).`
                : `Insufficient stock. Available: ${stock.toFixed(2)} KG, requested: ${totalItemQtyInForm.toFixed(2)} KG (Short by: ${shortBy} KG).`,
          };
        }
        if (stockIssue && stockMode === "block") return stockIssue;
        // Warn: keep checking the order qty; the shortage is returned last.
        const stockWarning = stockIssue ? { ...stockIssue, isStockWarning: true } : null;

        // 2) SALE ORDER quantity check with ±10% tolerance (only on ordered qty)
        if (bd.orderedQty !== undefined) {
          const orderedQty = Number(bd.orderedQty) || 0;
          const alreadyDispatched = Number(bd.alreadyDispatched) || 0;
          if (orderedQty > 0) {
            // ± band: Settings → Features "dispatch.overDispatchTolerance" (SMS 10 %; the server checks the same)
            const band = (Number(await featureAsync("dispatch.overDispatchTolerance")) || 0) / 100;
            const pct = Math.round(band * 100);
            const maxAllowed = orderedQty * (1 + band);
            const minAllowed = orderedQty * (1 - band); // warn only
            const totalWillBe = alreadyDispatched + totalItemQtyInForm;

            if (totalWillBe > maxAllowed) {
              const exceedBy = (totalWillBe - maxAllowed).toFixed(2);
              return {
                __varianceModal__: true,
                itemId,
                itemName,
                orderedQty,
                alreadyDispatched,
                currentQty: totalItemQtyInForm,
                totalWillBe,
                maxAllowed,
                exceedBy,
                message: `Exceeds the Sale Order by more than ${pct} %. Ordered ${orderedQty.toFixed(2)} KG, already dispatched ${alreadyDispatched.toFixed(2)} KG, total in dispatch ${totalItemQtyInForm.toFixed(2)} KG → total ${totalWillBe.toFixed(2)} KG, max allowed ${maxAllowed.toFixed(2)} KG (Exceed by: ${exceedBy} KG).`,
              };
            }
            if (totalWillBe < minAllowed && alreadyDispatched === 0) {
              console.warn(`Dispatch below SO -${pct}% (short by ${(minAllowed - totalWillBe).toFixed(2)} KG) — allowed.`);
            }
          }
        }

        // Custom validation, then allow
        if (config.customValidate) {
          const customError = await config.customValidate(value, line, allLines, formData);
          if (customError) return customError;
        }
        return stockWarning;
      }

      // ── NON-DISPATCH (GRN / returns / transfers without stock breakdown) ──────
      // Enforce the available balance strictly (no tolerance).
      if (availableInfo) {
        if (numericValue > 0 && availableInfo.available <= 0) {
          return {
            __varianceModal__: true,
            itemId,
            itemName,
            isAvailabilityError: true,
            available: availableInfo.available,
            currentQty: numericValue,
            exceedBy: numericValue.toFixed(2),
            message: `${availableInfo.label} is ${availableInfo.available.toFixed(2)}. Cannot proceed with ${numericValue.toFixed(2)} KG.`,
          };
        }
        if (numericValue > availableInfo.available) {
          const exceedBy = (numericValue - availableInfo.available).toFixed(2);
          return {
            __varianceModal__: true,
            itemId,
            itemName,
            isAvailabilityError: true,
            available: availableInfo.available,
            currentQty: numericValue,
            exceedBy,
            message: `Cannot exceed available ${availableInfo.label.toLowerCase()} (${availableInfo.available.toFixed(2)} KG). Requested: ${numericValue.toFixed(2)} KG (Short by: ${exceedBy} KG).`,
          };
        }
      }

      // Run custom validation if provided
      if (config.customValidate) {
        const customError = await config.customValidate(value, line, allLines, formData);
        if (customError) return customError;
      }

      return null;
    },
    ...config,
  };

  return baseConfig;
};

// âœ… GRN-SPECIFIC: With PO available quantity check (ITEM-WISE from API)
export const createGrnQtyField = (config = {}) => {
  return createQtyFieldWithAvailable({
    getAvailableInfo: async (line, formData) => {
      if (!line.itcd) {
        return null;
      }

      const bondId = formData.bond_id?.value || formData.bond_id;
      const poNo = formData.po_no?.value || formData.po_no;

      // Ex-Bond GRN takes priority: qty is capped by what's left in this
      // In-Bond entry, not by any PO. A direct LC GRN (no bond selected)
      // falls through to "no constraint" below.
      if (bondId) {
        try {
          const res = await axios.get(
            `/api/voucher/checkBondQty?bond_id=${bondId}`,
          );

          const summary = res.data.summary || {};
          const itemId = String(line.itcd?.value || line.itcd);

          const alreadyReceived = summary.itemWiseQty?.[itemId] || 0;
          const orderedQty = summary.orderedItemWiseQty?.[itemId] || 0;
          const balanceQty = summary.balanceItemWiseQty?.[itemId] ?? (orderedQty - alreadyReceived);

          return {
            available: balanceQty,
            label: "Available",
            details: `Bonded: ${orderedQty}, Received: ${alreadyReceived}, Balance: ${balanceQty}`,
            breakdown: {
              orderedQty: orderedQty,
              alreadyReceived: alreadyReceived,
            },
          };
        } catch (error) {
          console.error("Error fetching available bond quantity:", error);
          return null;
        }
      }

      if (!poNo) {
        return null;
      }

      try {
        const res = await axios.get(
          `/api/voucher/checkOrderQty?po_no=${poNo}`,
        );

        const summary = res.data.summary || {};
        const itemId = String(line.itcd?.value || line.itcd);

        // Editing a saved GRN: its own lines are already inside "received".
        // Give them back while it is still against the PO it was saved on
        // (the dispatch ownSavedQty pattern).
        const ownQty = ownSavedQty(formData, itemId);
        const savedPo = formData?.ordersPO?.order_no ?? null;
        const samePo = ownQty > 0 && savedPo != null && String(savedPo) === String(poNo);
        const alreadyReceived = Math.max(
          0,
          (summary.itemWiseQty?.[itemId] || 0) - (samePo ? ownQty : 0),
        );
        const orderedQty = summary.orderedItemWiseQty?.[itemId] || line.po_qty || 0;
        const balanceQty = orderedQty - alreadyReceived;
        // Same +10% tolerance over the order as a dispatch has.
        const maxAllowed = orderedQty * 1.1 - alreadyReceived;

        return {
          available: Math.round(maxAllowed * 1000) / 1000,
          label: "PO balance (+10%)",
          details: `Ordered: ${orderedQty}, Received: ${alreadyReceived}, Balance: ${balanceQty}, +10% allowed`,
        };
      } catch (error) {
        console.error("Error fetching available quantity:", error);
        return null;
      }
    },
    ...config,
  });
};
export const createTransferQtyField = (config = {}) => {
  return createQtyFieldWithAvailable({
    getAvailableInfo: async (line, formData) => {
      if (!formData.req_no || !line.itcd || !formData.godown) {
        return null;
      }

      try {
        // Check 1: Requisition Quantity Balance
        const reqRes = await axios.get(
          `/api/voucher/checkTransactionQty?req_no=${formData.req_no}`,
        );
        const totalTransferredQty = reqRes.data.summary?.totalQty || 0;
        const itemWiseQty = reqRes.data.summary?.itemWiseQty || {};
        const orderedQty = line.req_qty || 0;
        // itcd may be a select object { value, label } or a plain number
        const itcdKey = typeof line.itcd === "object" ? line.itcd?.value : line.itcd;
        const balanceQty = orderedQty - (itemWiseQty[itcdKey] || 0);

        // Check 2: Godown Stock Availability
        let stockAvailable = 0;
        let stockDetails = "Stock check failed";

        try {
          const stockRes = await axios.post("/api/voucher/check-stock", {
            productIds: [line.itcd],
            godown: formData.godown,
          });

          stockAvailable = stockRes.data[line.itcd?.value] || 0;
          stockDetails = `Stock: ${stockAvailable}`;
        } catch (stockError) {
          console.error("Error checking godown stock:", stockError);
          stockDetails = "Stock check unavailable";
        }

        // Determine the limiting factor
        const availableQty = Math.min(balanceQty, stockAvailable);
        const isLimitedByStock = stockAvailable < balanceQty;
        const isLimitedByRequisition = balanceQty < stockAvailable;

        let limitationMessage = "";
        if (isLimitedByStock) {
          limitationMessage = `Limited by stock (${stockAvailable} available)`;
        } else if (isLimitedByRequisition) {
          limitationMessage = `Limited by requisition balance (${balanceQty} remaining)`;
        }

        return {
          available: availableQty,
          label: "Available for Transfer",
          details: `Req Balance: ${balanceQty}, ${stockDetails}`,
          limitation: limitationMessage,
          breakdown: {
            requisitionBalance: balanceQty,
            stockAvailable: stockAvailable,
            orderedQty: orderedQty,
            alreadyTransferred: totalTransferredQty,

          },
        };
      } catch (error) {
        console.error("Error fetching transfer availability:", error);
        return null;
      }
    },

    // FG Transfer (VOUCHER_CONFIG.fgTransfer): stock follows the policy.
    stockCheckType: "fgTransfer",

    // Enhanced validation that considers both requisition balance and stock
    customValidate: async (value, line, allLines, formData) => {
      const numericValue = parseFloat(value) || 0;

      // Get availability info
      const availableInfo = await createTransferQtyField().getAvailableInfo(
        line,
        formData,
      );

      // Stock check policy off / warn: only the requisition balance limits
      // here — the stock shortage (warn) comes from the shared validate.
      const stockMode = await screenStockMode(config.stockCheckType ?? "fgTransfer");
      if (availableInfo && stockMode !== "block") {
        const balance = availableInfo.breakdown?.requisitionBalance;
        if (balance !== undefined && numericValue > balance) {
          return `Exceeds requisition balance (${balance} remaining)`;
        }
        return null;
      }

      if (availableInfo) {
        // Check if exceeds available transfer quantity
        if (numericValue > availableInfo.available) {
          if (availableInfo.limitation) {
            return `Cannot exceed available transfer quantity. ${availableInfo.limitation} `;
          }
          return `Cannot exceed available transfer quantity (${availableInfo.available}) `;
        }

        // Additional validation: Check if stock is insufficient
        if (
          availableInfo.breakdown &&
          numericValue > availableInfo.breakdown.stockAvailable
        ) {
          return `Insufficient stock in godown (${availableInfo.breakdown.stockAvailable} available)`;
        }

        // Additional validation: Check if exceeds requisition balance
        if (
          availableInfo.breakdown &&
          numericValue > availableInfo.breakdown.requisitionBalance
        ) {
          return `Exceeds requisition balance (${availableInfo.breakdown.requisitionBalance} remaining)`;
        }
      }

      return null;
    },
    ...config,
  });
};
/**
 * Godown Transfer qty: checks the FROM godown's stock like Dispatch does —
 * latest Monthly Opening + movements since that month (check-stock with
 * fromOpening). The stock check needs only the item and the From godown;
 * a Requisition, when picked, adds its balance check on top.
 * Stock over-ask is blocked by createQtyFieldWithAvailable's validate.
 */
export const createGodownTransferQtyField = (config = {}) => {
  const getAvailableInfo = async (line, formData) => {
    if (!line.itcd || !formData.godown) return null;

    try {
      const itemId = String(line.itcd?.value ?? line.itcd);

      let stockAvailable = 0;
      try {
        const stockRes = await axios.post("/api/voucher/check-stock", {
          productIds: [line.itcd],
          godown: formData.godown,
          fromOpening: true,
        });
        stockAvailable = Number(stockRes.data[itemId]) || 0;
      } catch (stockError) {
        console.error("Error checking godown stock:", stockError);
      }

      // EDITING a saved transfer: its own lines have ALREADY left the From
      // godown, so today's stock is net of them. Without giving them back,
      // keeping the saved 495 and adding 165 more was checked as 660 against
      // the 165 left — and refused. Add them back while the From godown is
      // still the one it was saved from (and likewise for the requisition).
      const ownQty = ownSavedQty(formData, itemId);
      const savedFrom = formData?.godownDetails?.id;
      const currentFrom = formData.godown?.value ?? formData.godown;
      if (ownQty > 0 && savedFrom != null && String(savedFrom) === String(currentFrom)) {
        stockAvailable += ownQty;
      }

      // Requisition balance — only when the transfer is against one.
      let requisitionBalance;
      let alreadyTransferred = 0;
      if (formData.req_no) {
        const reqNo = formData.req_no?.value ?? formData.req_no;
        const reqRes = await axios.get(`/api/voucher/checkTransactionQty?req_no=${reqNo}`);
        const itemWiseQty = reqRes.data.summary?.itemWiseQty || {};
        alreadyTransferred = itemWiseQty[itemId] || 0;
        // Same give-back on edit: this transfer's saved qty is inside the
        // requisition's "transferred" figure.
        if (ownQty > 0) {
          alreadyTransferred = Math.max(0, alreadyTransferred - ownQty);
        }
        requisitionBalance = (line.req_qty || 0) - alreadyTransferred;
      }

      const available =
        requisitionBalance === undefined
          ? stockAvailable
          : Math.min(stockAvailable, requisitionBalance);

      return {
        available,
        label: "Available for Transfer",
        details:
          requisitionBalance === undefined
            ? `Stock: ${stockAvailable}`
            : `Req Balance: ${requisitionBalance}, Stock: ${stockAvailable}`,
        breakdown: {
          stockAvailable,
          // Marks this as a transfer in the shared stock message.
          alreadyTransferred,
          ...(requisitionBalance !== undefined ? { requisitionBalance } : {}),
        },
      };
    } catch (error) {
      console.error("Error fetching transfer availability:", error);
      return null;
    }
  };

  return createQtyFieldWithAvailable({
    label: "Quantity",
    getAvailableInfo,
    // Stock is checked by the shared validate; this adds the requisition limit.
    customValidate: async (value, line, allLines, formData) => {
      if (!formData.req_no) return null;
      const info = await getAvailableInfo(line, formData);
      const balance = info?.breakdown?.requisitionBalance;
      if (balance !== undefined && (parseFloat(value) || 0) > balance) {
        return `Exceeds requisition balance (${balance} remaining)`;
      }
      return null;
    },
    ...config,
  });
};

// Called from the Godown Transfer Quantity field's validate
// (VOUCHER_CONFIG.transfer): a qty over the From godown stock is blocked /
// warned / not checked as the stock check policy "transfer" says
// (Dispatch-style), and the requisition balance is checked.
const godownTransferStock = createGodownTransferQtyField({ stockCheckType: "transfer" });
// ExBond's BOND-godown check is not a stock-out document type: always a block.
const bondGodownStock = createGodownTransferQtyField();

// ExBond: goods leave the BOND godown (4), so the qty is checked against its
// stock (Monthly Opening + movements) the same way Godown Transfer checks the
// From godown. The wrapped field's own checks (GRN / PO balance) run first.
const BOND_GODOWN = { value: 4, label: "4 - BOND" };
export const withBondStockCheck = (field) => ({
  ...field,
  validate: async (value, line, allLines, formData) => {
    const own = field.validate ? await field.validate(value, line, allLines, formData) : null;
    if (own) return own;
    const error = await bondGodownStock.validate(value, line, allLines, {
      ...formData,
      godown: BOND_GODOWN,
      req_no: null, // no requisition on an ExBond
    });
    if (error?.__varianceModal__ && error.isAvailabilityError) {
      return {
        ...error,
        message: `Insufficient stock in godown 4 - BOND — you cannot ExBond this quantity. ${String(error.message).replace(/transfer/g, "ExBond")}`,
      };
    }
    return error;
  },
});

// The ONE Qty (KG) field on Dispatch and Dispatch Edit.
//   · KG line : qty = No of Packs × Qty Per Pack
//   · LTR line: packs give litres (qty_ltr); qty = litres × ltr_rate (KG moves stock)
//   · Checks per ITEM across all lines: stock (hard) and SO balance (+10%),
//     counting the same item on earlier lines first.
//   · On edit, the dispatch's own saved quantity is added back, so editing a
//     dispatch is not checked against stock/SO it already used itself.
const dispatchExpectedKg = (line) => {
  if (isLitreUnit(line?.unit)) {
    return hasLtrRate(line?.ltr_rate) ? litresToKg(packTotal(line), line.ltr_rate) : null;
  }
  return packTotal(line);
};

// Quantity of `itemId` this dispatch already holds in the database (edit only).
const ownSavedQty = (formData, itemId) =>
  (Array.isArray(formData?.transactions) ? formData.transactions : [])
    .filter((t) => (t.sub_tran_id ?? 1) === 1 && String(t.itcd) === String(itemId))
    .reduce((s, t) => s + (parseFloat(t.qty) || 0), 0);

// Produce-on-dispatch: a dispatch line carrying BOM materials
// (line.materials = [{ itcd, qty }]) is made at dispatch time — the server
// issues the materials from the issue godown and produces the finished good
// into the dispatch godown (lib/dispatch/bomProduction.js). Its own FG stock
// is therefore not what limits it.
export const hasDispatchMaterials = (line) =>
  Array.isArray(line?.materials) &&
  line.materials.some((m) => (m?.itcd?.value ?? m?.itcd) && Number(m?.qty) > 0);

// FG stock of one item in the dispatch godown (Monthly Opening + movements),
// giving back what this dispatch itself already took when editing it.
const dispatchGodownStock = async (line, formData, itemId) => {
  const stockRes = await axios.post("/api/voucher/check-stock", {
    productIds: [line.itcd],
    godown: formData.godown,
    fromOpening: true,
  });
  const ownQty = ownSavedQty(formData, itemId);
  const savedGodown = formData?.godownDetails?.id;
  const currentGodown = formData.godown?.value ?? formData.godown;
  const sameGodown =
    ownQty > 0 && savedGodown != null && String(savedGodown) === String(currentGodown);
  return (
    (parseFloat(stockRes.data[itemId] || stockRes.data[line.itcd?.value]) || 0) +
    (sameGodown ? ownQty : 0)
  );
};

// Dispatch / Dispatch Edit master field: the godown BOM materials are issued
// from (master.godown2). Closed godowns are hidden by /api/setup/godowns.
// Godown 2 (PLANT) is where production draws its materials.
const DISPATCH_ISSUE_GODOWN_FIELD = {
  name: "godown2",
  label: "Issue Materials From",
  type: "select",
  options: "godowns",
  apiEndpoint: "/api/setup/godowns",
  createEndpoint: "/api/setup/godowns",
  nameKeys: ["id", "godown"],
  valueKey: "id",
  defaultValue: setupGodownDefault("productionGodown"),
  defaultGodown: "productionGodown", // Settings → Production setup
};

// Dispatch / Dispatch Edit carry quantities only: rate and GST % are set on
// Sale Invoicing (/accounting/invoicing/sale).

export const createDispatchQtyField = (config = {}) => {
  return createQtyFieldWithAvailable({
    label: "Qty (KG)",
    readOnly: true,
    // FG stock in the dispatch godown follows the stock check policy.
    stockCheckType: "dispatch",
    // ltr_rate must be listed, or the conversion reads undefined.
    dependencies: ["no_of_pack", "qty_per_pack", "qty_ltr", "unit", "ltr_rate"],
    calculate: (a, b) => dispatchExpectedKg(calcLine(a, b)) ?? "",
    expectedQty: (line) => dispatchExpectedKg(line),
    // Produced lines do not draw on the FG stock of later lines of the item.
    skipInRunningTotal: (prevLine) => hasDispatchMaterials(prevLine),
    customValidate: async (value, line) =>
      isLitreUnit(line?.unit) && !hasLtrRate(line?.ltr_rate)
        ? missingLtrRateMessage(line?.item_name)
        : null,
    getAvailableInfo: async (line, formData) => {
      if (!line.itcd || !formData.godown) {
        return null;
      }
      const produced = hasDispatchMaterials(line);

      // Direct dispatch (no Sale Order): only the FG stock in the dispatch
      // godown applies — and not even that when the line is produced from its
      // BOM. The server re-checks everything on save.
      if (!formData.so_no) {
        if (produced) return null;
        try {
          const itemId = String(line.itcd?.value || line.itcd);
          const stockAvailable = await dispatchGodownStock(line, formData, itemId);
          return {
            available: stockAvailable,
            label: "In Stock",
            details: `Stock: ${stockAvailable} KG`,
            breakdown: { stockAvailable },
          };
        } catch (error) {
          console.error("Error checking godown stock:", error);
          return null;
        }
      }

      try {
        // Check 1: Sale Order Quantity Balance (ITEM-WISE from API)
        const soNo = formData.so_no?.value || formData.so_no;
        const soRes = await axios.get(
          `/api/voucher/checkOrderQty?so_no=${soNo}`,
        );

        const summary = soRes.data.summary || {};
        const itemId = String(line.itcd?.value || line.itcd);

        // Editing a saved dispatch: its own lines are already inside both the
        // SO "dispatched" figure and the stock-out. Give them back — but only
        // when the SO / godown is still the one it was saved against.
        const ownQty = ownSavedQty(formData, itemId);
        const sameSo =
          ownQty > 0 && String(formData?.ordersSO?.order_no ?? "") === String(soNo);
        const savedGodown = formData?.godownDetails?.id;
        const currentGodown = formData.godown?.value ?? formData.godown;
        const sameGodown =
          ownQty > 0 && savedGodown != null && String(savedGodown) === String(currentGodown);

        // Get item-wise quantities from API (single source of truth)
        const alreadyDispatched = Math.max(
          0,
          (summary.itemWiseQty?.[itemId] || 0) - (sameSo ? ownQty : 0),
        );
        const orderedQty = summary.orderedItemWiseQty?.[itemId] || line.so_qty || 0;
        const balanceQty = orderedQty - alreadyDispatched;

        // Check 2: Godown Stock Availability
        let stockAvailable = 0;
        let stockDetails = "Stock check failed";

        // Not for the Despatch Without Godown godown (lib/dispatch/withoutGodown.js),
        // whose stock is allowed to go negative.
        const noStockCheck = isWithoutGodownGodown(formData.godown);

        if (noStockCheck) {
          stockAvailable = Number.POSITIVE_INFINITY;
          stockDetails = "Stock not checked (Despatch Without Godown)";
        } else if (produced) {
          // Made at dispatch from its BOM — the FG stock is not the limit.
          stockAvailable = Number.POSITIVE_INFINITY;
          stockDetails = "Produced at dispatch (BOM)";
        } else try {
          // Monthly Opening of this godown + movements since that month.
          const stockRes = await axios.post("/api/voucher/check-stock", {
            productIds: [line.itcd],
            godown: formData.godown,
            fromOpening: true,
          });

          stockAvailable =
            (parseFloat(stockRes.data[itemId] || stockRes.data[line.itcd?.value]) || 0) +
            (sameGodown ? ownQty : 0);
          stockDetails = `Stock: ${stockAvailable}`;
        } catch (stockError) {
          console.error("Error checking godown stock:", stockError);
          stockDetails = "Stock check unavailable";
        }

        // Determine the limiting factor
        const availableQty = Math.min(balanceQty, stockAvailable);
        const isLimitedByStock = stockAvailable < balanceQty;
        const isLimitedBySO = balanceQty < stockAvailable;

        let limitationMessage = "";
        if (isLimitedByStock) {
          limitationMessage = `Limited by stock (${stockAvailable} available)`;
        } else if (isLimitedBySO) {
          limitationMessage = `Limited by SO balance (${balanceQty} remaining)`;
        }

        // Balance and stock are KG (what moves stock). On a LTR line the user
        // works in litres, so the same figures are shown in litres alongside.
        const asLtr = (kg) =>
          isLitreUnit(line?.unit) && hasLtrRate(line?.ltr_rate) && Number.isFinite(kg)
            ? ` (${(kg / parseFloat(line.ltr_rate)).toFixed(2)} LTR)`
            : "";

        return {
          available: availableQty,
          label: "Available for Dispatch",
          details: noStockCheck
            ? `SO Balance: ${balanceQty} KG${asLtr(balanceQty)}, ${stockDetails}`
            : `SO Balance: ${balanceQty} KG${asLtr(balanceQty)}, ${stockDetails} KG${asLtr(stockAvailable)}`,
          limitation: limitationMessage,
          breakdown: {
            soBalance: balanceQty,
            stockAvailable: stockAvailable,
            orderedQty: orderedQty,
            alreadyDispatched: alreadyDispatched,
          },
        };
      } catch (error) {
        console.error("Error fetching dispatch availability:", error);
        return null;
      }
    },
    ...config,
  });
};

export const createPurhcaseReturnnedQtyField = (config = {}) => {
  return createQtyFieldWithAvailable({
    getAvailableInfo: async (line, formData) => {
      if (!formData.po_no || !line.itcd) {
        return null;
      }

      try {
        const res = await axios.get(
          `/api/voucher/checkReturnQty?po_no=${formData.po_no}&grn_no=${formData.grn_no}`,
        );

        const GRNQtyAgainstPO = res.data.summary?.totalQty || 0;
        const orderedQty = line.po_qty || 0;
        const balanceQty = orderedQty - GRNQtyAgainstPO;

        return {
          available: balanceQty,
          label: "Available",
          details: `Ordered: ${orderedQty}, Returned: ${GRNQtyAgainstPO}`,
        };
      } catch (error) {
        console.error("Error fetching available quantity:", error);
        return null;
      }
    },
    ...config,
  });
};

export const createSaleReturnnedQtyField = (config = {}) => {
  return createQtyFieldWithAvailable({
    getAvailableInfo: async (line, formData) => {
      if (!formData.so_no || !line.itcd) {
        return null;
      }

      try {
        const res = await axios.get(
          `/api/voucher/checkReturnQty?so_no=${formData.so_no}&dispatch_no=${formData.dispatch_no}`,
        );

        const GRNQtyAgainstPO = res.data.summary?.totalQty || 0;
        const orderedQty = line.so_qty || 0;
        const balanceQty = orderedQty - GRNQtyAgainstPO;

        return {
          available: balanceQty,
          label: "Available",
          details: `Ordered: ${orderedQty}, Returned: ${GRNQtyAgainstPO}`,
        };
      } catch (error) {
        console.error("Error fetching available quantity:", error);
        return null;
      }
    },
    ...config,
  });
};

// âœ… UNIVERSAL VALIDATION SYSTEM
export const createQtyField = (config = {}) => {
  const baseConfig = {
    name: "qty",
    label: "Qty",
    type: "number",
    required: true,
    dependencies: ["no_of_pack", "qty_per_pack"],
    calculate: (v) => (v.no_of_pack || 0) * (v.qty_per_pack || 0),
    validate: async (value, line, allLines, formData) => {
      const numericValue = parseFloat(value) || 0;
      const calculatedQty = (line.no_of_pack || 0) * (line.qty_per_pack || 0);

      // âœ… UNIVERSAL: Block if doesn't match calculation
      if (numericValue !== calculatedQty) {
        return `Quantity must match: ${calculatedQty} (${line.no_of_pack || 0
          } Ã— ${line.qty_per_pack || 0})`;
      }

      // âœ… UNIVERSAL: Block if zero or negative
      if (numericValue <= 0) {
        return "Quantity must be greater than 0";
      }

      // âœ… Run custom validation if provided
      if (config.customValidate) {
        const customError = await config.customValidate(
          value,
          line,
          allLines,
          formData,
        );
        if (customError) return customError;
      }

      return null;
    },
    ...config,
  };

  return baseConfig;
};

//FOR PO AND SO
export const createOrderPSQtyField = (config = {}) => {
  const baseConfig = {
    name: "qty",
    label: "Qty",
    type: "number",
    required: true,
    // allowManualEntry: true, // âœ… NEW PROPERTY
    // dependencies: ["no_of_packs", "qty_per_pack"],
    onChange: (index, value) => {
      //if qty was edited add qty per pack and no_of _packs


      return {
        qty_per_pack: value.qty,
        no_of_packs: 1,
      };
    },
    // validate: async (value, line, allLines, formData) => {
    //   const numericValue = parseFloat(value) || 0;
    //   const calculatedQty = (line.no_of_packs || 0) * (line.qty_per_pack || 0);

    //   // âœ… UNIVERSAL: Block if doesn't match calculation
    //   // if (numericValue !== calculatedQty) {
    //   //   return `Quantity must match: ${calculatedQty} (${
    //   //     line.no_of_packs || 0
    //   //   } Ã— ${line.qty_per_pack || 0})`;
    //   // }

    //   // âœ… UNIVERSAL: Block if zero or negative
    //   if (numericValue <= 0) {
    //     return "Quantity must be greater than 0";
    //   }

    //   // âœ… Run custom validation if provided
    //   if (config.customValidate) {
    //     const customError = await config.customValidate(
    //       value,
    //       line,
    //       allLines,
    //       formData
    //     );
    //     if (customError) return customError;
    //   }

    //   return null;
    // },
    ...config,
  };

  return baseConfig;
};
// âœ… UNIVERSAL FIELD WITH STOCK VALIDATION
export const createStockQtyField = (config = {}) => {
  return createQtyField({
    // customValidate: async (value, line, allLines, formData) => {
    //   const numericValue = parseFloat(value) || 0;

    //   // Stock validation
    //   if (line.stock !== undefined && numericValue > line.stock) {
    //     return `Insufficient stock (${line.stock} available)`;
    //   }

    //   // Available quantity validation
    //   if (
    //     line.available_qty !== undefined &&
    //     numericValue > line.available_qty
    //   ) {
    //     return `Cannot exceed available quantity (${line.available_qty})`;
    //   }

    //   return null;
    // },
    ...config,
  });
};

// âœ… UNIVERSAL FIELD WITH ORDER VALIDATION
export const createOrderQtyField = (config = {}) => {
  return createQtyField({
    customValidate: async (value, line, allLines, formData) => {
      const numericValue = parseFloat(value) || 0;

      // PO/SO quantity validation
      if (line.po_qty !== undefined && numericValue > line.po_qty) {
        return `Cannot exceed ordered quantity (${line.po_qty})`;
      }

      if (line.so_qty !== undefined && numericValue > line.so_qty) {
        return `Cannot exceed ordered quantity (${line.so_qty})`;
      }

      return null;
    },
    ...config,
  });
};

// âœ… UNIVERSAL AMOUNT FIELD
export const createAmountField = (config = {}) => {
  const baseConfig = {
    name: "amount",
    label: "Amount",
    type: "number",
    dependencies: ["qty", "rate"],
    calculate: (v) => (v.qty || 0) * (v.rate || 0),
    validate: async (value, line, allLines, formData) => {
      const numericValue = parseFloat(value) || 0;
      const calculatedAmount = (line.qty || 0) * (line.rate || 0);

      // Block if doesn't match calculation
      if (numericValue !== calculatedAmount) {
        return `Amount must match: ${calculatedAmount} (${line.qty || 0} Ã— ${line.rate || 0
          })`;
      }

      return null;
    },
    ...config,
  };

  return baseConfig;
};

// âœ… UNIVERSAL MAPPING FUNCTION
export const mapSourceToForm = async (
  sourceData,
  mappingConfig,
  targetFormType,
) => {
  if (!sourceData || !mappingConfig) return { master: {}, lines: [] };

  const mappedData = {
    master: {},
    lines: [],
  };

  const { fieldMappings } = mappingConfig;

  // Map master fields
  if (fieldMappings.master) {
    fieldMappings.master.forEach((mapping) => {
      if (mapping.source && sourceData[mapping.source] !== undefined) {
        mappedData.master[mapping.target] = mapping.transform(
          sourceData[mapping.source],
          sourceData,
        );
      } else if (mapping.source === null || mapping.source === "") {
        // Constant mapping (no source column) — e.g. dispatch godown default.
        mappedData.master[mapping.target] = mapping.transform(null, sourceData);
      }
    });
  }

  // Map line items
  if (fieldMappings.lines) {
    const sourceLines =
      sourceData.orderDetails ||
      sourceData.details ||
      sourceData.transactions ||
      [];

    mappedData.lines = sourceLines.map((detail) => {
      const line = {};

      fieldMappings.lines.forEach((mapping) => {
        if (mapping.source && detail[mapping.source] !== undefined) {
          line[mapping.target] = mapping.transform(
            detail[mapping.source],
            detail,
          );
        } else if (mapping.source === null) {
          line[mapping.target] = mapping.transform(null, detail);
        }
      });


      return line;
    });
  }

  return mappedData;
};

// Sale Order approval fields, from lib/orders/saleOrderApprovalRules.js — add
// a reason there and it shows here:
//   · "Order Type" dropdown — Normal / Free of Cost / Trial Process / Rate
//     Under Negotiation. Only one at a time; picking one sets its flag and
//     clears the others (Form.jsx re-prices the lines).
//   · a checkbox for each flag that combines with any type (No Godown).
const soApprovalCheckboxes = () => [
  {
    name: "soOrderType",
    label: "Order Type",
    // normalSelect = fixed options list ("select" only loads from an API)
    type: "normalSelect",
    options: SO_ORDER_TYPE_OPTIONS,
    defaultValue: SO_ORDER_TYPE_NORMAL,
    clearable: false,
    // Despatch Without Godown sits on its fixed godown (lib/dispatch/
    // withoutGodown.js); leaving that type empties the godown so a real one is picked.
    onChange: async (value, formData) => {
      const flags = orderTypeFlags(value);
      if (withoutGodownOn(flags)) {
        return withoutGodownConfigured()
          ? { ...flags, noGodown: false, godown: { value: WITHOUT_GODOWN_DISPATCH.value, label: WITHOUT_GODOWN_DISPATCH.label } }
          : flags;
      }
      return isWithoutGodownGodown(formData?.godown) ? { ...flags, godown: null } : flags;
    },
  },
  // Urgent tick, off by default. Saved on OrderMaster.urgency_level
  // (Boolean): true when ticked, else false (app/api/orders/[type]).
  {
    name: "urgency_level",
    label: "Urgency Level",
    type: "checkbox",
    checkboxText: "Urgent",
    defaultValue: false,
  },
  ...SO_CHECKBOX_FLAGS.map((f) => ({
    name: f.key,
    label: <span className="whitespace-nowrap me-2">{f.label}</span>,
    type: "checkbox",
  })),
];

// ── Service Invoice (tran_code 21) helpers ──────────────────────────────────
// Mirror lib/service/serviceInvoice.js prepareServiceInvoice so the form shows
// what the server will post: qty defaults to 1 (blank / 0 → 1), amount =
// qty × rate, tax = amount × (st_rate + additional_tax) / 100, each rounded
// to 2 decimals. The server re-prices every line; these are display only.
const svcRound2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const svcNum = (v) => parseFloat(v?.value ?? v) || 0;

export const serviceLineAmounts = (line = {}) => {
  const qty = svcNum(line.qty) || 1;
  const gross = svcRound2(qty * svcNum(line.rate));
  const tax = svcRound2((gross * (svcNum(line.st_rate) + svcNum(line.additional_tax))) / 100);
  return { qty, gross, tax, total: svcRound2(gross + tax) };
};

/** Invoice total of a saved Service Invoice: the vendor's 'Auto Entry' credit. */
export const serviceInvoiceTotal = (entry) => {
  const rows = Array.isArray(entry?.transactions) ? entry.transactions : [];
  const vendor = rows.filter(
    (t) => t.sub_tran_id === 3 && String(t.narration1 || "").trim() === "Auto Entry",
  );
  if (vendor.length) {
    return svcRound2(vendor.reduce((s, t) => s + (Number(t.camt) || 0) - (Number(t.damt) || 0), 0));
  }
  // No auto entry (should not happen): rebuild from the service lines.
  return svcRound2(
    rows
      .filter((t) => (t.sub_tran_id ?? 1) === 1)
      .reduce((s, t) => s + (Number(t.gross_amount ?? t.damt) || 0) + (Number(t.st_amount) || 0), 0),
  );
};

/** "GRN 4455" / "Dispatch 3" — the header reference of a Service Invoice. */
export const serviceInvoiceRef = (entry) => {
  if (entry?.grn_no != null && entry.grn_no !== "") return `GRN ${entry.grn_no}`;
  if (entry?.dispatch_no != null && entry.dispatch_no !== "") return `Dispatch ${entry.dispatch_no}`;
  return "";
};

const fmtAmount = (n) =>
  (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

// ── GRN / Dispatch / Sale Return helpers ─────────────────────────────────
// A select may hold {value,label} or the raw id (an edit loads raw ids).
const selVal = (v) => (v && typeof v === "object" ? v.value : v);
const hasValue = (v) => {
  const x = selVal(v);
  return x !== undefined && x !== null && x !== "";
};
const jsonParam = (obj) => encodeURIComponent(JSON.stringify(obj));

// The document's own lines — sub_tran_id 2/3 are charges / control rows.
const mainDocLines = (entry) =>
  (Array.isArray(entry?.transactions) ? entry.transactions : []).filter(
    (t) => (t.sub_tran_id ?? 1) === 1,
  );

// Money of one line as the server posts it: amount = priced qty × rate (the
// litres on a LTR line, else KG — a value-only line keeps its amount) and
// sales tax = amount × ST % / 100. An invoiced line with an acknowledged qty
// (ack_qty, same unit — lib/invoicing/core.js) is billed on that instead.
export const lineMoney = (line = {}) => {
  const rate = parseFloat(line?.rate) || 0;
  const ack = line?.ack_qty;
  const rawQty =
    ack !== undefined && ack !== null ? ack : isLitreUnit(line?.unit) ? line?.qty_ltr : line?.qty;
  const hasQty = rawQty !== undefined && rawQty !== null && rawQty !== "";
  // A saved value-only line (no quantity at all) keeps its posted amount.
  const amount = hasQty
    ? (parseFloat(rawQty) || 0) * rate
    : parseFloat(line?.damt) || parseFloat(line?.camt) || 0;
  const tax = (amount * (parseFloat(line?.st_rate) || 0)) / 100;
  return { amount, tax, total: amount + tax };
};

/** Total (amount + sales tax) of a saved GRN / Sale Return, for the list. */
export const documentTotal = (entry) =>
  mainDocLines(entry).reduce((s, t) => s + lineMoney(t).total, 0);

// Legacy document number of an imported GRN / dispatch / sale return lives in
// rmk5. Shown read-only, and only when there is one.
// The user's own paper-book number, kept next to the system number
// (TransactionsMaster.manual_no; only a dispatch / GRN stores it).
// Dispatch Manual DC No / City / Route exist while Settings → Features
// "dispatch.extraFields" is on (the server keeps stored values when it is off).
const MANUAL_DC_NO_FIELD = { name: "manual_no", label: "Manual DC No", type: "text", uppercase: true, feature: "dispatch.extraFields" };
const MANUAL_GRN_NO_FIELD = { name: "manual_no", label: "Manual GRN No", type: "text", uppercase: true };
// Dispatch: the city the vehicle is taking the goods to (TransactionsMaster.city).
const DISPATCH_CITY_FIELD = { name: "city", label: "City (Destination)", type: "text", uppercase: true, group: "logistics", feature: "dispatch.extraFields" };
// Dispatch: the route the vehicle takes (TransactionsMaster.route), shown under City.
const DISPATCH_ROUTE_FIELD = { name: "route", label: "Route", type: "text", uppercase: true, group: "logistics", feature: "dispatch.extraFields" };

const LEGACY_DOC_FIELD = {
  name: "rmk5",
  label: "Legacy Doc No",
  type: "text",
  readOnly: true,
  visibility: { dependsOn: "rmk5", condition: "truthy" },
};

// ── GRN ──────────────────────────────────────────────────────────────────
// A PO's open lines (closed status-2 lines left out) at their balance:
// ordered − already received per item, spread over that item's lines.
const grnLinesFromPo = async (poNo) => {
  const [poRes, qtyRes] = await Promise.all([
    axios.get(`/api/orders/purchaseOrder?orderNo=${poNo}`),
    axios.get(`/api/voucher/checkOrderQty?po_no=${poNo}`).catch(() => ({ data: {} })),
  ]);
  const po = poRes.data?.data?.[0];
  if (!po) return { po: null, lines: [] };

  const received = qtyRes.data?.summary?.itemWiseQty || {};
  const left = {};
  for (const d of po.orderDetails || []) {
    const k = String(d.itcd);
    left[k] = (left[k] ?? -(parseFloat(received[k]) || 0)) + (parseFloat(d.qty) || 0);
  }

  const lines = (po.orderDetails || [])
    .filter((d) => d.status !== 2)
    .map((d) => {
      const k = String(d.itcd);
      const balance = Math.max(0, Math.min(parseFloat(d.qty) || 0, left[k] || 0));
      left[k] = (left[k] || 0) - balance;
      // Quantity only — the GRN is priced on Purchase Invoicing.
      return {
        itcd: {
          value: k,
          label: [d.items?.code, d.items?.item].filter(Boolean).join(" - ") || k,
        },
        mm: d.itcd,
        item_name: d.items?.item || "",
        po_qty: parseFloat(d.qty) || 0,
        batch_no: "",
        no_of_pack: 1,
        qty_per_pack: balance,
        qty: balance,
        narration1: "",
      };
    })
    .filter((l) => l.qty > 0);

  // Direct-rate items (grn.directRateByItem) start at the PO rate, editable.
  if (lines.length && (await featureAsync("grn.directRateByItem"))) {
    const direct = await grnDirectRateSet(lines.map((l) => l.itcd.value));
    const rateOf = new Map((po.orderDetails || []).map((d) => [String(d.itcd), parseFloat(d.rate) || ""]));
    for (const l of lines) {
      l.direct_rate = direct.has(l.itcd.value);
      if (l.direct_rate) l.rate = rateOf.get(l.itcd.value) ?? "";
    }
  }
  return { po, lines };
};

// GRN item picked: with a PO linked the line notes the PO quantity. No rate —
// the GRN is quantity only (priced on Purchase Invoicing).
const grnItemChanged = async (value, formData) => {
  const itcd = selVal(value);
  if (!itcd) return {};
  const out = { mm: itcd };
  // Settings → Features "grn.directRateByItem": a ticked item gets a GRN Rate
  if (await featureAsync("grn.directRateByItem")) {
    out.direct_rate = (await grnDirectRateSet([itcd])).has(String(itcd));
    out.rate = "";
  }
  const poNo = selVal(formData?.po_no);
  if (poNo) {
    try {
      const res = await axios.get(`/api/orders/purchaseOrder?orderNo=${poNo}`);
      const d = (res.data?.data?.[0]?.orderDetails || []).find(
        (x) => String(x.itcd) === String(itcd),
      );
      if (d) out.po_qty = parseFloat(d.qty) || 0;
      // A direct-rate item starts at the PO rate; the user may change it.
      if (d && out.direct_rate) out.rate = parseFloat(d.rate) || "";
    } catch (error) {
      console.error("Error fetching PO line:", error);
    }
  }
  return out;
};

// Items whose GRN rate is typed on the GRN (item or category ticked) — a Set of itcd strings.
const grnDirectRateSet = async (itcds) => {
  const ids = [...new Set((itcds || []).map(String).filter(Boolean))];
  if (!ids.length) return new Set();
  try {
    const res = await axios.get(`/api/forms/items/grn-direct-rate?itcds=${ids.join(",")}`);
    return new Set((res.data?.itcds || []).map(String));
  } catch {
    return new Set();
  }
};

// ── Invoiced status of a physical document ───────────────────────────────
// GRN, GRN Return, Dispatch and Dispatch Return carry quantities only; they
// are priced and posted on the Invoicing screens, which stamp OUR invoice
// number on the document (invoice_no, plus invoice_series on older sale
// invoices). A document with an invoice number is invoiced: the server
// refuses to edit it until it is unlocked in Invoicing.
export const isInvoicedDoc = (entry) =>
  entry?.invoiced === true || String(entry?.invoice_no ?? "").trim() !== "";

/** "A-123" / "1045" — the invoice number, or "" while pending. */
export const docInvoiceRef = (entry) =>
  isInvoicedDoc(entry)
    ? entry?.invoice_series
      ? `${entry.invoice_series}-${entry.invoice_no}`
      : String(entry.invoice_no)
    : "";

// List column: the invoice number, or a "Pending" pill.
const INVOICED_COLUMN = {
  name: "invoiced",
  label: "Invoiced",
  type: "text",
  render: (entry) =>
    isInvoicedDoc(entry) ? (
      <span className="inline-flex items-center rounded-full bg-[#edf2ee] px-2 py-0.5 text-xs font-semibold text-[#2f5139] dark:bg-emerald-500/10 dark:text-emerald-400 tabular-nums">
        {docInvoiceRef(entry)}
      </span>
    ) : (
      <span className="inline-flex items-center rounded-full bg-[#f5f0e6] px-2 py-0.5 text-xs font-semibold text-[#5f4b1f] dark:bg-amber-500/10 dark:text-amber-400">
        Pending
      </span>
    ),
};

// ── Dispatch ─────────────────────────────────────────────────────────────
// Sale Order picked on a dispatch (Create Dispatch and New / Edit Dispatch):
// customer + the order's still-open lines (manually closed status-2 lines are
// skipped) at their remaining balance. The godown is the user's choice and is
// never overwritten — except for a Despatch Without Godown order, which is
// always dispatched from its fixed godown (lib/dispatch/withoutGodown.js).
const dispatchSaleOrderChanged = async (value, formData) => {
  if (!value) return { pycd: null, lines: [] };

  try {
    const response = await axios.get(`/api/orders/saleOrder?orderNo=${value}`);
    const soData = response.data.data[0];
    if (!soData) {
      console.error("No sale order found with number:", value);
      return { lines: [] };
    }

    const mappedData = await mapSourceToForm(
      soData,
      VOUCHER_CONFIG.dispatch.sourceMapping,
      "dispatch",
    );

    // Already-dispatched quantities per item
    let dispatchSummary = {};
    try {
      const checkRes = await axios.get(`/api/voucher/checkOrderQty?so_no=${value}`);
      dispatchSummary = checkRes.data.summary || {};
    } catch (checkErr) {
      console.error("Error fetching dispatch summary:", checkErr);
    }
    const itemWiseDispatched = dispatchSummary.itemWiseQty || {};

    const customerValue = soData.party_code;
    const customerLabel = soData.acno?.acname || soData.party_name || "Customer";

    const processedLines = (mappedData.lines || [])
      .filter((line) => {
        const detail = soData.orderDetails?.find((d) => String(d.itcd) === String(line.itcd));
        return !detail || detail.status !== 2;
      })
      .map((line) => {
        const orderDetail =
          soData.orderDetails?.find((d) => String(d.itcd) === String(line.itcd)) || {};
        const itemName =
          orderDetail.items?.item || orderDetail.item_name || orderDetail.item || String(line.itcd);
        const soQty = parseFloat(line.qty) || 0;
        const alreadyDispatched = itemWiseDispatched[String(line.itcd)] || 0;
        const remainingQty = Math.max(0, soQty - alreadyDispatched);

        // Quantity only: the order's rate is applied on Sale Invoicing.
        const { rate, gross_amount, camt, st_rate, st_amount, amount, ...qtyLine } = line;
        return {
          ...qtyLine,
          itcd: { value: line.itcd, label: itemName },
          so_qty: soQty,
          dispatched_qty: alreadyDispatched,
          qty: remainingQty,
          no_of_pack: parseInt(line.no_of_pack) || 1,
          qty_per_pack: parseInt(line.qty_per_pack) || remainingQty || 0,
        };
      });

    // Despatch Without Godown → its fixed godown, no stock check; any other
    // order goes back to DESPATCH if that godown was left from one.
    const godownUpdate =
      soData.dispatchWithoutGodown === true && withoutGodownConfigured()
        ? { godown: { value: WITHOUT_GODOWN_DISPATCH.value, label: WITHOUT_GODOWN_DISPATCH.label } }
        : soData.dispatchWithoutGodown !== true && isWithoutGodownGodown(formData?.godown)
          ? { godown: { value: "3", label: "3 - DESPATCH" } }
          : {};
    if (soData.dispatchWithoutGodown === true) {
      const { toast } = await import("sonner");
      toast.info(
        withoutGodownConfigured()
          ? `Sale Order ${value} is Despatch Without Godown: dispatched from ${WITHOUT_GODOWN_DISPATCH.label}, stock not checked.`
          : `Sale Order ${value} is Despatch Without Godown, but no godown is configured for it yet — it cannot be dispatched.`,
      );
    }

    return {
      ...godownUpdate,
      pycd: customerValue ? { value: customerValue, label: customerLabel } : null,
      lines: processedLines,
    };
  } catch (error) {
    console.error("Error fetching SO details:", error);
    return { lines: [] };
  }
};

// Dispatch line unit. Against a Sale Order the line follows the order's unit
// (set by the item onChange, read-only); a direct dispatch line picks KG or
// LTR — on LTR the packs are litres and KG is converted with Item.ltr_rate.
const DISPATCH_UNIT_FIELD = {
  name: "unit",
  label: "Unit",
  type: "normalSelect",
  options: [
    { value: UNIT_KG, label: UNIT_KG },
    { value: UNIT_LTR, label: UNIT_LTR },
  ],
  defaultValue: UNIT_KG,
  width: "90px",
  // Litres switched off (Features "saleOrder.litreUnits"): no choice — KG,
  // or LTR only where the Sale Order line already is (set by the item onChange).
  readOnly: (line, master) => hasValue(master?.so_no) || featureNow("saleOrder.litreUnits") !== true,
  onChange: (value, line) => {
    const unit = isLitreUnit(value || line?.unit) ? UNIT_LTR : UNIT_KG;
    return {
      unit,
      __warn:
        unit === UNIT_LTR && !hasLtrRate(line?.ltr_rate)
          ? missingLtrRateMessage(line?.item_name)
          : undefined,
    };
  },
};

/** "A-123" — the invoice a dispatch was billed on, or "" before invoicing. */
export const dispatchInvoiceRef = (d) => docInvoiceRef(d);

// ── Sale Return ──────────────────────────────────────────────────────────
// A Sale Return is made against ONE dispatch (master.dispatch_no).
const fetchDispatchByNo = async (dispatchNo) => {
  const n = Number(dispatchNo);
  if (!Number.isFinite(n)) return null;
  const res = await axios.get(
    `/api/voucher/dispatchEdit?limit=1&multiFilters=${jsonParam({ dispatch_no: [n] })}`,
  );
  return res.data?.data?.[0] || null;
};

// KG already returned per item against a dispatch, leaving out the return
// being edited (`exceptTranId`).
const returnedByItem = async (dispatchNo, exceptTranId = null) => {
  const n = Number(dispatchNo);
  if (!Number.isFinite(n)) return {};
  const res = await axios.get(
    `/api/voucher/saleReturn?limit=500&multiFilters=${jsonParam({ dispatch_no: [n] })}`,
  );
  const out = {};
  for (const r of res.data?.data || []) {
    if (exceptTranId != null && Number(r.tran_id) === Number(exceptTranId)) continue;
    for (const t of mainDocLines(r)) {
      if (t.itcd == null) continue;
      out[String(t.itcd)] = (out[String(t.itcd)] || 0) + (parseFloat(t.qty) || 0);
    }
  }
  return out;
};

const dispatchedByItem = (dispatch) => {
  const out = {};
  for (const t of mainDocLines(dispatch)) {
    if (t.itcd == null) continue;
    out[String(t.itcd)] = (out[String(t.itcd)] || 0) + (parseFloat(t.qty) || 0);
  }
  return out;
};

const dispatchPickLabel = (d) =>
  [
    String(d?.dispatch_no ?? d?.tran_id ?? ""),
    d?.invoice_no || "",
    d?.acno?.acname || "",
  ]
    .filter(Boolean)
    .join(" - ");

/**
 * Sale Return master + lines from a dispatch (a dispatch-list row, the
 * original-for-return payload, or the Dispatch picker). Lines carry the
 * dispatch's item, unit, batch, rate and ST %; quantities start at 0.
 */
export const saleReturnFromDispatch = async (dispatch) => {
  if (!dispatch) return { master: {}, lines: [] };
  const lines = mainDocLines(dispatch)
    .filter((t) => t.itcd != null)
    .map((t) => {
      const itcd = String(t.itcd);
      const litre = isLitreUnit(t.unit);
      return {
        itcd: {
          value: itcd,
          label: [t.itemDetails?.code, t.itemDetails?.item].filter(Boolean).join(" - ") || itcd,
        },
        mm: t.itcd,
        item_name: t.itemDetails?.item || "",
        batch_no: t.batch_no || "",
        unit: litre ? UNIT_LTR : UNIT_KG,
        ltr_rate: t.ltr_rate ?? t.itemDetails?.ltr_rate ?? null,
        no_of_pack: 0,
        qty_per_pack: parseFloat(t.qty_per_pack) || 0,
        qty_ltr: litre ? 0 : "",
        qty: 0,
        original_qty: parseFloat(t.qty) || 0,
      };
    });

  return {
    master: {
      dispatch_no:
        dispatch.dispatch_no != null
          ? { value: String(dispatch.dispatch_no), label: dispatchPickLabel(dispatch) }
          : null,
      so_no: dispatch.so_no ?? null,
      pycd:
        dispatch.pycd != null
          ? { value: String(dispatch.pycd), label: `${dispatch.pycd} - ${dispatch.acno?.acname || ""}` }
          : null,
      godown:
        dispatch.godown != null
          ? {
              value: String(dispatch.godown),
              label: `${dispatch.godown} - ${dispatch.godownDetails?.godown || ""}`,
            }
          : null,
      rmk: `Return against Dispatch# ${dispatch.dispatch_no ?? dispatch.tran_id}`,
    },
    lines,
  };
};

// Sale Return Qty (KG): packs → KG exactly like the dispatch (litres on a LTR
// line, converted with ltr_rate), capped per item at what the dispatch
// delivered minus what earlier returns (and earlier lines of this one) took.
const createSaleReturnQtyField = () => ({
  name: "qty",
  label: "Qty (KG)",
  type: "number",
  required: true,
  readOnly: true,
  width: "120px",
  dependencies: ["no_of_pack", "qty_per_pack", "qty_ltr", "unit", "ltr_rate"],
  calculate: (a, b) => dispatchExpectedKg(calcLine(a, b)) ?? "",
  validate: async (value, line, allLines, formData) => {
    if (isLitreUnit(line?.unit) && !hasLtrRate(line?.ltr_rate)) {
      return missingLtrRateMessage(line?.item_name);
    }
    const kg = parseFloat(value) || 0;
    if (!(kg > 0)) return "Enter the quantity returned (remove lines that are not returned)";

    const dispatchNo = selVal(formData?.dispatch_no);
    const itemId = String(selVal(line?.itcd) ?? "");
    if (!hasValue(dispatchNo) || !itemId) return null;

    try {
      const dispatch = await fetchDispatchByNo(dispatchNo);
      if (!dispatch) return null;
      const dispatched = dispatchedByItem(dispatch)[itemId] || 0;
      if (!dispatched) return `This item is not on Dispatch ${dispatchNo}`;
      const returned = (await returnedByItem(dispatchNo, formData?.tran_id))[itemId] || 0;

      let earlier = 0;
      const idx = Array.isArray(allLines) ? allLines.indexOf(line) : -1;
      for (let i = 0; i < (idx >= 0 ? idx : 0); i++) {
        const prev = allLines[i];
        if (String(selVal(prev?.itcd) ?? "") === itemId) earlier += parseFloat(prev?.qty) || 0;
      }

      const left = dispatched - returned - earlier;
      if (kg > left + 0.001) {
        return (
          `Only ${Math.max(0, left).toFixed(2)} KG is left to return: dispatched ${dispatched.toFixed(2)} KG, ` +
          `already returned ${returned.toFixed(2)} KG` +
          (earlier ? `, earlier lines of this return ${earlier.toFixed(2)} KG` : "") +
          "."
        );
      }
    } catch (error) {
      console.error("Error checking returnable quantity:", error);
    }
    return null;
  },
});

// Dispatch Return item picked by hand: its unit / batch from the dispatch
// line when the dispatch has it, else a plain KG line. Quantity only.
const saleReturnItemChanged = async (value, formData) => {
  const itcd = selVal(value);
  if (!itcd) return {};
  const out = { mm: itcd, unit: UNIT_KG };
  try {
    const it = await axios.get(`/api/forms/items/${itcd}`);
    out.item_name = it.data?.item || "";
    out.ltr_rate = it.data?.ltr_rate ?? null;
  } catch (error) {
    console.error("Error fetching item:", error);
  }
  // Return of an old dispatch: prefill the system-start cost rate (saleReturn.requireDispatchLink)
  if (String(formData?.ref_dispatch_no ?? "").trim() && featureNow("saleReturn.requireDispatchLink")) {
    try {
      const r = await axios.get(`/api/voucher/sale-return-cost?start_rate_itcd=${itcd}`);
      out.cost_rate = Number(r.data?.rate) > 0 ? Number(r.data.rate) : "";
    } catch {
      /* typed by the user */
    }
  }
  const dispatchNo = selVal(formData?.dispatch_no);
  if (hasValue(dispatchNo)) {
    try {
      const dispatch = await fetchDispatchByNo(dispatchNo);
      const t = mainDocLines(dispatch).find((x) => String(x.itcd) === String(itcd));
      if (t) {
        out.unit = isLitreUnit(t.unit) ? UNIT_LTR : UNIT_KG;
        out.batch_no = t.batch_no || "";
        out.ltr_rate = t.ltr_rate ?? t.itemDetails?.ltr_rate ?? out.ltr_rate ?? null;
      }
    } catch (error) {
      console.error("Error fetching dispatch line:", error);
    }
  }
  return out;
};

// ── GRN Return (tran_code 9) — against ONE GRN ───────────────────────────
// Mirror of the Dispatch Return: pick the vendor's GRN, its vendor, godown and
// lines (item, batch) come from it, and each item's qty is capped at what the
// GRN received minus earlier returns. Quantity only — priced on Purchase
// Return Invoicing.
const fetchGrnByNo = async (grnNo) => {
  const n = Number(grnNo);
  if (!Number.isFinite(n)) return null;
  const res = await axios.get(
    `/api/voucher/grn?limit=1&multiFilters=${jsonParam({ grn_no: [n] })}`,
  );
  return res.data?.data?.[0] || null;
};

// KG already returned per item against a GRN, leaving out the return being
// edited (`exceptTranId`).
const returnedAgainstGrn = async (grnNo, exceptTranId = null) => {
  const n = Number(grnNo);
  if (!Number.isFinite(n)) return {};
  const res = await axios.get(
    `/api/voucher/grnReturn?limit=500&multiFilters=${jsonParam({ grn_no: [n] })}`,
  );
  const out = {};
  for (const r of res.data?.data || []) {
    if (exceptTranId != null && Number(r.tran_id) === Number(exceptTranId)) continue;
    for (const t of mainDocLines(r)) {
      if (t.itcd == null) continue;
      out[String(t.itcd)] = (out[String(t.itcd)] || 0) + (parseFloat(t.qty) || 0);
    }
  }
  return out;
};

const grnPickLabel = (g) =>
  [String(g?.grn_no ?? g?.tran_id ?? ""), g?.acno?.acname || "", g?.rmk3 || ""]
    .filter(Boolean)
    .join(" - ");

/**
 * GRN Return master + lines from a GRN (a GRN-list row, the
 * original-for-return payload, or the GRN picker). Lines carry the GRN's
 * item and batch; quantities start at 0.
 */
export const grnReturnFromGrn = async (grn) => {
  if (!grn) return { master: {}, lines: [] };
  const lines = mainDocLines(grn)
    .filter((t) => t.itcd != null)
    .map((t) => {
      const itcd = String(t.itcd);
      return {
        itcd: {
          value: itcd,
          label: [t.itemDetails?.code, t.itemDetails?.item].filter(Boolean).join(" - ") || itcd,
        },
        mm: t.itcd,
        item_name: t.itemDetails?.item || "",
        batch_no: t.batch_no || "",
        unit: UNIT_KG,
        no_of_pack: 0,
        qty_per_pack: parseFloat(t.qty_per_pack) || 0,
        qty: 0,
        original_qty: parseFloat(t.qty) || 0,
      };
    });

  return {
    master: {
      grn_no:
        grn.grn_no != null ? { value: String(grn.grn_no), label: grnPickLabel(grn) } : null,
      po_no: grn.po_no ?? null,
      pycd:
        grn.pycd != null
          ? { value: String(grn.pycd), label: `${grn.pycd} - ${grn.acno?.acname || ""}` }
          : null,
      godown:
        grn.godown != null
          ? {
              value: String(grn.godown),
              label: `${grn.godown} - ${grn.godownDetails?.godown || ""}`,
            }
          : null,
      rmk: `Return against GRN# ${grn.grn_no ?? grn.tran_id}`,
    },
    lines,
  };
};

// GRN Return Qty (KG) = packs × qty per pack, capped per item at what the GRN
// received minus earlier returns (and earlier lines of this one).
const createGrnReturnQtyField = () => ({
  name: "qty",
  label: "Qty (KG)",
  type: "number",
  required: true,
  readOnly: true,
  width: "120px",
  dependencies: ["no_of_pack", "qty_per_pack"],
  calculate: (a, b) => packTotal(calcLine(a, b)),
  validate: async (value, line, allLines, formData) => {
    const kg = parseFloat(value) || 0;
    if (!(kg > 0)) return "Enter the quantity returned (remove lines that are not returned)";

    const grnNo = selVal(formData?.grn_no);
    const itemId = String(selVal(line?.itcd) ?? "");
    if (!hasValue(grnNo) || !itemId) return null;

    try {
      const grn = await fetchGrnByNo(grnNo);
      if (!grn) return null;
      const received = dispatchedByItem(grn)[itemId] || 0;
      if (!received) return `This item is not on GRN ${grnNo}`;
      const returned = (await returnedAgainstGrn(grnNo, formData?.tran_id))[itemId] || 0;

      let earlier = 0;
      const idx = Array.isArray(allLines) ? allLines.indexOf(line) : -1;
      for (let i = 0; i < (idx >= 0 ? idx : 0); i++) {
        const prev = allLines[i];
        if (String(selVal(prev?.itcd) ?? "") === itemId) earlier += parseFloat(prev?.qty) || 0;
      }

      const left = received - returned - earlier;
      if (kg > left + 0.001) {
        return (
          `Only ${Math.max(0, left).toFixed(2)} KG is left to return: received ${received.toFixed(2)} KG, ` +
          `already returned ${returned.toFixed(2)} KG` +
          (earlier ? `, earlier lines of this return ${earlier.toFixed(2)} KG` : "") +
          "."
        );
      }
    } catch (error) {
      console.error("Error checking returnable quantity:", error);
    }
    return null;
  },
});

// GRN Return item picked by hand: its batch from the GRN line.
const grnReturnItemChanged = async (value, formData) => {
  const itcd = selVal(value);
  if (!itcd) return {};
  const out = { mm: itcd, unit: UNIT_KG };
  const grnNo = selVal(formData?.grn_no);
  if (hasValue(grnNo)) {
    try {
      const grn = await fetchGrnByNo(grnNo);
      const t = mainDocLines(grn).find((x) => String(x.itcd) === String(itcd));
      if (t) {
        out.batch_no = t.batch_no || "";
        out.item_name = t.itemDetails?.item || "";
        out.qty_per_pack = parseFloat(t.qty_per_pack) || 0;
      }
    } catch (error) {
      console.error("Error fetching GRN line:", error);
    }
  }
  return out;
};

export const VOUCHER_CONFIG = {
  // One Payment Voucher covering cash and bank alike. "Paid From" lists the
  // "Cash & Bank" group of Finance → Account Settings; nothing records which
  // kind it was, because nothing distinguishes them any more.
  payment: {
    buttonText: "Create Payment",
    ModalHeading: "Create Payment Voucher",
    ModalHeadingEdit: "Edit Payment Voucher",
    tran_code: 2,
    // A paperclip on every line: files for that line only (Transactions.attachments).
    lineAttachments: true,
    hasDeductionBlock: true,
    masterFields: [
      {
        name: "pycd",
        formName: "pycd",
        label: "Paid From",
        type: "select",
        options: "masterAccounts", // This is the key to store and access
        apiEndpoint: `/api/accounts/acno?${CASH_BANK_GROUP_PARAM}`,
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        required: true,
        // modalFields: [
        // {
        // name: "acname",
        // label: "Account Name",
        // type: "text",
        // required: true,
        // },
        // {
        // name: "macno",
        // label: "Main Account",
        // type: "select",
        // options: "mainAccounts",
        // apiEndpoint: "/api/accounts/macno",
        // valueKey: "macno",
        // nameKeys: ["macno", "macname"],
        // required: true,
        // },
        // ],
      },
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },
      { name: "check_no", label: "Cheque No", type: "text" },
      { name: "check_date", label: "Cheque Date", type: "date" },
      { name: "rmk", label: "Narration", type: "textarea" },
      // Files on the whole voucher (TransactionsMaster.attachments).
      { name: "attachments", label: "Attachments", type: "file", fullWidth: true }
    ],
    lineFields: [
      {
        name: "acname",
        formName: "acno",
        label: "A/c Name",
        type: "select",
        options: "accounts",
        apiEndpoint: contraAccountsEndpoint,
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        // modalFields: [
        // {
        // name: "acname",
        // label: "Account Name",
        // type: "text",
        // required: true,
        // },
        // {
        // name: "macno",
        // label: "Main Account",
        // type: "select",
        // options: "mainAccounts",
        // apiEndpoint: "/api/accounts/macno",
        // valueKey: "macno",
        // nameKey: "macname",
        // required: true,
        // },
        // ],
      },
      {
        name: "ccname",
        formName: "ccno",
        label: "Cost Center",
        type: "select",
        options: "costCenters",
        apiEndpoint: "/api/setup/cost_centers",
        createEndpoint: "/api/setup/cost_centers",
        nameKey: "ccname",
        valueKey: "ccno",
        // modalFields: [
        // {
        // name: "ccname",
        // label: "Cost Center Name",
        // type: "text",
        // required: true,
        // },
        // ],
      },
      subAccountLineField,
      taxLawLineField, // Settings → Features "tax.lineWht" (lib/tax/lineWht.js)
      { name: "invoice_no", label: "Invoice No", type: "text" },
      { name: "wht_rate", label: "WHT Rate", type: "number" },
      { name: "chno", label: "Cheque No", type: "text" },
      { name: "narration1", label: "Narration", type: "text" },
      // { name: "narration2", label: "Narration2", type: "text" },
      // {
      //   name: "currency",
      //   formName: "currency",
      //   label: "Currency",
      //   type: "select",
      //   options: "currencies",
      //   apiEndpoint: "/api/setup/currencies",
      //   createEndpoint: "/api/setup/currencies",
      //   nameKey: "currency",
      //   valueKey: "id",
      //   modalFields: [
      //     {
      //       name: "currency",
      //       label: "Currency Name",
      //       type: "text",
      //       required: true,
      //     },
      //   ],
      // },
      // { name: "fc_amount", label: "FC Amt", type: "number" },
      // { name: "rate", label: "Exc Rate", type: "number" },
      // Slip # — stored in Transactions.narration5 (VarChar(150)); the
      // voucher route trims it. Shown on the view and the printed voucher.
      { name: "narration5", label: "Slip #", type: "text" },
      {
        name: "damt",
        label: "Amount",
        type: "number",
        calculate: (v) => v.fc_amount * v.rate,

        // validate: (() => {
        //   let timeoutId;
        //   let lastValidatedValue = null;
        //   let pendingValidation = false;

        //   return async (value, line) => {
        //     // âœ… If invoice_no is missing, skip validation entirely
        //     if (!line?.invoice_no) return null;

        //     // Skip redundant or pending validations
        //     if (value === lastValidatedValue || pendingValidation) return null;

        //     // Clear previous timeout
        //     if (timeoutId) clearTimeout(timeoutId);

        //     // Return early for empty or zero values
        //     if (value === null || value === undefined || value === "") {
        //       lastValidatedValue = value;
        //       return null;
        //     }

        //     pendingValidation = true;

        //     return new Promise((resolve) => {
        //       timeoutId = setTimeout(async () => {
        //         try {
        //           const response = await axios.get(
        //             `/api/voucher/check-amount?invoice_no=${line.invoice_no}&amount=${value}&camt=true`
        //           );

        //           lastValidatedValue = value;

        //           if (!response.data.exists) {
        //             resolve(`Invoice ${line.invoice_no} not found`);
        //           } else if (!response.data.valid) {
        //             resolve(
        //               `Amount exceeds available balance (${response.data.availableBalance})`
        //             );
        //           } else {
        //             resolve(null); // âœ… Fixed: must be `null`, not string "null"
        //           }
        //         } catch (error) {
        //           resolve(`Validation error: ${error.message}`);
        //         } finally {
        //           pendingValidation = false;
        //         }
        //       }, 800); // debounce
        //     });
        //   };
        // })(),
      },
    ],
    deductionFields: [
      {
        name: "acname",
        formName: "acno",
        label: "A/c Name",
        type: "select",
        options: "accounts",
        apiEndpoint: contraAccountsEndpoint,
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        // modalFields: [
        // {
        // name: "acname",
        // label: "Account Name",
        // type: "text",
        // required: true,
        // },
        // {
        // name: "macno",
        // label: "Main Account",
        // type: "select",
        // options: "mainAccounts",
        // apiEndpoint: "/api/accounts/macno",
        // valueKey: "macno",
        // nameKey: "macname",
        // required: true,
        // },
        // ],
      },
      {
        name: "ccname",
        formName: "ccno",
        label: "Cost Center",
        type: "select",
        options: "costCenters",
        apiEndpoint: "/api/setup/cost_centers",
        createEndpoint: "/api/setup/cost_centers",
        nameKey: "ccname",
        valueKey: "ccno",
        // modalFields: [
        // {
        // name: "ccname",
        // label: "Cost Center Name",
        // type: "text",
        // required: true,
        // },
        // ],
      },
      subAccountLineField,
      { name: "invoice_no", label: "Invoice No", type: "text" },
      { name: "wht_rate", label: "WHT Rate", type: "number" },
      { name: "chno", label: "Cheque No", type: "text" },
      { name: "narration1", label: "Narration", type: "text" },
      // { name: "narration2", label: "Narration2", type: "text" },
      // {
      //   name: "currency",
      //   formName: "currency",
      //   label: "Currency",
      //   type: "select",
      //   options: "currencies",
      //   apiEndpoint: "/api/setup/currencies",
      //   createEndpoint: "/api/setup/currencies",
      //   nameKey: "currency",
      //   valueKey: "id",
      //   modalFields: [
      //     {
      //       name: "currency",
      //       label: "Currency Name",
      //       type: "text",
      //       required: true,
      //     },
      //   ],
      // },
      // { name: "fc_amount", label: "FC Amt", type: "number" },
      // { name: "rate", label: "Exc Rate", type: "number" },
      {
        name: "camt",
        label: "Amount",
        type: "number",
        // dependencies: ["fc_amount", "rate"],
        calculate: (v) => v.fc_amount * v.rate,
      },
    ],
    totals: {
      mainTotal: {
        label: "Total Payments",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.damt || 0), 0),
      },
      deductionTotal: {
        label: "Total Deductions",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.camt || 0), 0),
      },
      netTotal: {
        label: "Net Payment",
        calculate: (_, t) => {
          const value = t.mainTotal - t.deductionTotal;
          return value.toLocaleString("en-US"); // formats with commas like 10,000
        },
      },
    },
    allowDelete: false,
    allowPrintSaveButton: true,
    allowPrint: true,
    allowEdit: true,
    allowView: true,
    allowCheck: false,
    // balanceCheck: {
    //   condition: async (formData) => {
    //     // First check if net total is negative
    //     if (formData.totals.netTotal < 0) return false;

    //     // Then validate against API
    //     try {
    //       const response = await axios.get(
    //         "/api/reports/trialBalance?dateTo=2025-07-31T11:00:00.000Z"
    //       );
    //       let isValid = false;
    //       if (response.data.data) {
    //         response.data.data.forEach((data) => {
    //           if (data.acno === formData.master.pycd) {
    //             if (data.balance >= formData.totals.netTotal) {
    //               isValid = true;
    //             }
    //           }
    //         });
    //       }

    //       return isValid;
    //     } catch (error) {
    //       console.error("Validation API error:", error);
    //       return false; // Fail-safe: don't allow if API fails
    //     }
    //   },
    //   errorMessage: (formData) => {
    //     if (formData.totals.netTotal < 0) {
    //       return `Net Receipt cannot be negative (Current: ${formData.totals.netTotal.toFixed(
    //         2
    //       )})`;
    //     }
    //     return "Net total exceeds available balance or violates business rules";
    //   },
    // },

    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "tran_id", label: "Transaction No", type: "text" },
      { name: "vr_no", label: "Voucher No", type: "text" },
      {
        name: "pycd",
        label: "Paid From",
        type: "text",
        options: true,
        value1: "acno",
        value2: "acname",
      },
      { name: "rmk", label: "Narration", type: "text" },
      { name: "camt", label: "Total Amount", type: "number", isTotal: true },
    ],
  },
  // One Receipt Voucher covering cash and bank alike — see `payment` above.
  receipt: {
    buttonText: "Create Receipt",
    ModalHeading: "Create Receipt Voucher",
    ModalHeadingEdit: "Edit Receipt Voucher",
    tran_code: 1,
    // A paperclip on every line: files for that line only (Transactions.attachments).
    lineAttachments: true,
    hasDeductionBlock: true,
    masterFields: [
      {
        name: "pycd",
        formName: "pycd",
        label: "Received At",
        type: "select",
        options: "masterAccounts", // This is the key to store and access
        apiEndpoint: `/api/accounts/acno?${CASH_BANK_GROUP_PARAM}`,
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        required: true,
        // modalFields: [
        // {
        // name: "acname",
        // label: "Account Name",
        // type: "text",
        // required: true,
        // },
        // {
        // name: "macno",
        // label: "Main Account",
        // type: "select",
        // options: "mainAccounts",
        // apiEndpoint: "/api/accounts/macno",
        // valueKey: "macno",
        // nameKey: "macname",
        // required: true,
        // },
        // ],
      },
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },
      { name: "check_no", label: "Cheque No", type: "text" },
      { name: "check_date", label: "Cheque Date", type: "date" },
      { name: "rmk", label: "Narration", type: "textarea" },
      // Files on the whole voucher (TransactionsMaster.attachments).
      { name: "attachments", label: "Attachments", type: "file", fullWidth: true }
    ],
    lineFields: [
      {
        name: "acname",
        formName: "acno",
        label: "A/c Name",
        type: "select",
        options: "accounts",
        apiEndpoint: contraAccountsEndpoint,
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        // modalFields: [
        // {
        // name: "acname",
        // label: "Account Name",
        // type: "text",
        // required: true,
        // },
        // {
        // name: "macno",
        // label: "Main Account",
        // type: "select",
        // options: "mainAccounts",
        // apiEndpoint: "/api/accounts/macno",
        // valueKey: "macno",
        // nameKey: "macname",
        // required: true,
        // },
        // ],
      },
      {
        name: "ccname",
        formName: "ccno",
        label: "Cost Center",
        type: "select",
        options: "costCenters",
        apiEndpoint: "/api/setup/cost_centers",
        createEndpoint: "/api/setup/cost_centers",
        nameKey: "ccname",
        valueKey: "ccno",
        // modalFields: [
        // {
        // name: "ccname",
        // label: "Cost Center Name",
        // type: "text",
        // required: true,
        // },
        // ],
      },
      subAccountLineField,
      taxLawLineField, // Settings → Features "tax.lineWht" (lib/tax/lineWht.js)
      // { name: "invoice_no", label: "Invoice No", type: "text" },
      {
        name: "invoice_no",
        formName: "invoice_no",
        label: "Invoice No",
        type: "select",
        options: "invoiceAccounts", // This is the key to store and access
        apiEndpoint: "/api/invoice?tran_code=6",
        createEndpoint: "/api/invoice/",
        nameKey: "label",
        valueKey: "value",
      },
      { name: "wht_rate", label: "WHT Rate", type: "number" },
      { name: "chno", label: "Cheque No", type: "text" },
      { name: "narration1", label: "Narration", type: "text" },
      // { name: "narration2", label: "Narration2", type: "text" },
      // {
      //   name: "currency",
      //   formName: "currency",
      //   label: "Currency",
      //   type: "select",
      //   options: "currencies",
      //   apiEndpoint: "/api/setup/currencies",
      //   createEndpoint: "/api/setup/currencies",
      //   nameKey: "currency",
      //   valueKey: "id",
      //   modalFields: [
      //     {
      //       name: "currency",
      //       label: "Currency Name",
      //       type: "text",
      //       required: true,
      //     },
      //   ],
      // },
      // { name: "fc_amount", label: "FC Amt", type: "number" },
      // { name: "rate", label: "Exc Rate", type: "number" },
      // Slip # — stored in Transactions.narration5 (VarChar(150)); see payment.
      { name: "narration5", label: "Slip #", type: "text" },
      {
        name: "camt",
        label: "Amount",
        type: "number",
        // dependencies: ["fc_amount", "rate"],
        calculate: (v) => v.fc_amount * v.rate,
        // validate: (() => {
        //   let timeoutId;
        //   let lastValidatedValue = null;
        //   let pendingValidation = false;

        //   return async (value, line) => {
        //     // Skip if same as last validated value or already validating
        //     if (value === lastValidatedValue || pendingValidation) return null;

        //     // Clear any pending validation
        //     if (timeoutId) clearTimeout(timeoutId);

        //     // Return immediately for empty values
        //     if (!value || !line.invoice_no) {
        //       lastValidatedValue = value;
        //       return null;
        //     }

        //     // Set pending state
        //     pendingValidation = true;

        //     return new Promise((resolve) => {
        //       timeoutId = setTimeout(async () => {
        //         try {
        //           const response = await axios.get(
        //             `/api/voucher/check-amount?invoice_no=${line.invoice_no}&amount=${value}&damt=true`
        //           );

        //           lastValidatedValue = value;

        //           if (!response.data.exists) {
        //             resolve(`Invoice ${line.invoice_no} not found`);
        //           } else if (!response.data.valid) {
        //             resolve(
        //               `Amount exceeds available balance (${response.data.availableBalance})`
        //             );
        //           } else {
        //             resolve("null");
        //           }
        //         } catch (error) {
        //           resolve(`Validation error: ${error.message}`);
        //         } finally {
        //           pendingValidation = false;
        //         }
        //       }, 800); // Increased debounce to 800ms for better UX
        //     });
        //   };
        // })(),
      },
    ],
    deductionFields: [
      {
        name: "acname",
        formName: "acno",
        label: "A/c Name",
        type: "select",
        options: "accounts",
        apiEndpoint: contraAccountsEndpoint,
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        // modalFields: [
        // {
        // name: "acname",
        // label: "Account Name",
        // type: "text",
        // required: true,
        // },
        // {
        // name: "macno",
        // label: "Main Account",
        // type: "select",
        // options: "mainAccounts",
        // apiEndpoint: "/api/accounts/macno",
        // valueKey: "macno",
        // nameKey: "macname",
        // required: true,
        // },
        // ],
      },
      {
        name: "ccname",
        formName: "ccno",
        label: "Cost Center",
        type: "select",
        options: "costCenters",
        apiEndpoint: "/api/setup/cost_centers",
        createEndpoint: "/api/setup/cost_centers",
        nameKey: "ccname",
        valueKey: "ccno",
        // modalFields: [
        // {
        // name: "ccname",
        // label: "Cost Center Name",
        // type: "text",
        // required: true,
        // },
        // ],
      },
      subAccountLineField,
      {
        name: "invoice_no",
        formName: "invoice_no",
        label: "Invoice No",
        type: "select",
        options: "invoiceAccounts", // This is the key to store and access
        apiEndpoint: "/api/invoice?tran_code=6",
        createEndpoint: "/api/invoice/",
        nameKey: "label",
        valueKey: "value",
      },
      { name: "wht_rate", label: "WHT Rate", type: "number" },
      { name: "chno", label: "Cheque No", type: "text" },
      { name: "narration1", label: "Narration", type: "text" },
      // { name: "narration2", label: "Narration2", type: "text" },
      // {
      //   name: "currency",
      //   formName: "currency",
      //   label: "Currency",
      //   type: "select",
      //   options: "currencies",
      //   apiEndpoint: "/api/setup/currencies",
      //   createEndpoint: "/api/setup/currencies",
      //   nameKey: "currency",
      //   valueKey: "id",
      //   modalFields: [
      //     {
      //       name: "currency",
      //       label: "Currency Name",
      //       type: "text",
      //       required: true,
      //     },
      //   ],
      // },
      // { name: "fc_amount", label: "FC Amt", type: "number" },
      // { name: "rate", label: "Exc Rate", type: "number" },
      {
        name: "damt",
        label: "Amount",
        type: "number",
        // dependencies: ["fc_amount", "rate"],
        calculate: (v) => v.fc_amount * v.rate,
      },
    ],
    totals: {
      mainTotal: {
        label: "Total Receipts",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.camt || 0), 0),
      },
      deductionTotal: {
        label: "Total Deductions",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.damt || 0), 0),
      },
      netTotal: {
        label: "Net Receipt",
        calculate: (_, t) => {
          const value = t.mainTotal - t.deductionTotal;
          return value.toLocaleString("en-US"); // formats with commas like 10,000
        },
      },
    },

    // balanceCheck: {
    //   condition: (formData) => formData.totals.netTotal >= 0,
    //   errorMessage: (formData) =>
    //     `Net Receipt (${formData.totals.netTotal.toFixed(
    //       2
    //     )}) cannot be negative.`,
    // },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "tran_id", label: "Transaction No", type: "text" },
      { name: "vr_no", label: "Voucher No", type: "text" },

      {
        name: "pycd",
        label: "Received At",
        type: "text",
        options: true,
        value1: "acno",
        value2: "acname",
      },
      { name: "rmk", label: "Narration", type: "text" },
      { name: "damt", label: "Total Amount", type: "number", isTotal: true },
    ],
    allowDelete: false,
    allowPrintSaveButton: true,
    allowPrint: true,
    allowEdit: true,
    allowView: true,
    allowCheck: false,
  },
  journal: {
    buttonText: "Create Adjustments",
    ModalHeading: "Create Adjustment",
    ModalHeadingEdit: "Edit Adjustment",
    tran_code: 3,
    // A paperclip on every line: files for that line only (Transactions.attachments).
    lineAttachments: true,
    hasDeductionBlock: false,
    masterFields: [
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },
      { name: "rmk1", label: "Narration", type: "textarea" },
      // Files on the whole voucher (TransactionsMaster.attachments).
      { name: "attachments", label: "Attachments", type: "file", fullWidth: true }
    ],
    lineFields: [
      {
        name: "acname",
        formName: "acno",
        label: "A/c Name",
        type: "select",
        options: "accounts",
        apiEndpoint: journalAccountsEndpoint,
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        // modalFields: [
        // {
        // name: "acname",
        // label: "Account Name",
        // type: "text",
        // required: true,
        // },
        // {
        // name: "macno",
        // label: "Main Account",
        // type: "select",
        // options: "mainAccounts",
        // apiEndpoint: "/api/accounts/macno",
        // valueKey: "macno",
        // nameKey: "macname",
        // required: true,
        // },
        // ],
      },
      {
        name: "ccname",
        formName: "ccno",
        label: "Cost Center",
        type: "select",
        options: "costCenters",
        apiEndpoint: "/api/setup/cost_centers",
        createEndpoint: "/api/setup/cost_centers",
        nameKey: "ccname",
        valueKey: "ccno",
        // modalFields: [
        // {
        // name: "ccname",
        // label: "Cost Center Name",
        // type: "text",
        // required: true,
        // },
        // ],
      },
      subAccountLineField,
      { name: "invoice_no", label: "Invoice No", type: "text" },
      { name: "narration1", label: "Narration1", type: "text" },
      {
        name: "damt",
        label: "Debit Amount",
        type: "number",
        validate: (value, line) => {
          const debit = parseFloat(value) || 0;
          const credit = parseFloat(line.camt) || 0;
          if (debit > 0 && credit > 0) {
            return "Cannot enter both Debit and Credit amounts in the same line.";
          }
          return null;
        },
      },
      {
        name: "camt",
        label: "Credit Amount",
        type: "number",
        validate: (value, line) => {
          const credit = parseFloat(value) || 0;
          const debit = parseFloat(line.damt) || 0;
          if (credit > 0 && debit > 0) {
            return "Cannot enter both Debit and Credit amounts in the same line.";
          }
          return null;
        },
      },
    ],
    totals: {
      debitTotal: {
        label: "Total Debit",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.damt || 0), 0),
      },
      creditTotal: {
        label: "Total Credit",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.camt || 0), 0),
      },
    },
    balanceCheck: {
      condition: (formData) =>
        formData.totals.debitTotal === formData.totals.creditTotal,
      errorMessage: (formData) =>
        `Total Debit (${formData.totals.debitTotal.toFixed(
          2,
        )}) must equal Total Credit (${formData.totals.creditTotal.toFixed(
          2,
        )}).`,
    },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "tran_id", label: "Transaction No", type: "text" },
      { name: "vr_no", label: "Voucher No", type: "text" },
      { name: "rmk1", label: "Narration", type: "text" },
      {
        name: "camt",
        label: "Total Amount",
        type: "text",
        isInnerTotal: true,
        key: "transactions",
      },
    ],
    allowDelete: false,
    allowPrintSaveButton: true,
    allowPrint: true,
    allowEdit: true,
    allowView: true,
    allowCheck: false,
  },

  // Purchase Invoice is retired — the GRN is the purchase (vendor's bill
  // details are entered on the GRN). Existing documents stay viewable here.
  purchase: {
    buttonText: "",
    allowCreate: false,
    ModalHeading: "Create Purchase",
    ModalHeadingEdit: "Create Purchase",
    tran_code: 4,
    hasDeductionBlock: false,
    //  differApi: "/api/voucher/grn",
    //   sourceMapping: {
    //     type: "purchaseOrder",
    //     sourceApi: "/api/voucher/grn",
    //     fieldMappings: {
    //       master: [
    //         {
    //           source: "po_no",
    //           target: "po_no",
    //           transform: (value) => value,
    //         },
    //         {
    //           source: "pycd",
    //           target: "pycd",
    //           transform: (value) => value,
    //         },

    //         {
    //           source: "acno",
    //           target: "acno",
    //           transform: (value) => value,
    //         },
    //         {
    //           source: "godown",
    //           target: "godown",
    //           transform: (value) => value,
    //         },
    //       ],
    //       lines: [
    //         {
    //           source: "itcd",
    //           target: "itcd",
    //           transform: (value) => value,
    //         },
    //         {
    //           source: "qty",
    //           target: "qty",
    //           transform: (value) => value || 0,
    //         },
    //         {
    //           source: "po_qty",
    //           target: "po_qty",
    //           transform: (value) => value || 0,
    //         },
    //         {
    //           source: "no_of_pack",
    //           target: "no_of_pack",
    //           transform: (value) => value || 0,
    //         },
    //         {
    //           source: "qty_per_pack",
    //           target: "qty_per_pack",
    //           transform: (value) => value || 0,
    //         },
    //         {
    //           source: "rate",
    //           target: "rate",
    //           transform: (value) => value || 0,
    //         },
    //         {
    //           source: "gross_amount",
    //           target: "gross_amount",
    //           transform: (value) => value || 0,
    //         },
    //         {
    //           source: "damt",
    //           target: "damt",
    //           transform: (value) => value || 0,
    //         },
    //       ],
    //     },
    //   },
    masterFields: [
      // { name: "dated", label: "Date", type: "date", required: true },
      // { name: "time", label: "Time", type: "time", required: true },
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },
      {
        name: "rmk3",
        label: "Bill No",
        type: "text",
      },

      {
        name: "grn_no",
        label: "GRN No",
        type: "text",
        visibility: {
          dependsOn: "names",
          condition: "false", // Show when itcd has any value
        },
      },

      {
        name: "po_no",
        label: "Purchase Order No",
        type: "select",
        options: "purchaseOrders",
        apiEndpoint: "/api/orders/purchaseOrder",
        nameKey: "order_no",
        valueKey: "order_no",
        onChange: async (value, formData) => {
          if (!value) return;
          try {
            const response = await axios.get(`/api/orders/purchaseOrder`);




            const filterResponse = response.data.data.filter(
              (item) => item.order_no === Number(value),
            );

            return {
              pycd: filterResponse[0].party_code, // Vendor
              godown: filterResponse[0].godown,
              orderDetails: filterResponse[0].orderDetails, // Full details of the order
              // Add other fields you want to auto-fill
            };
          } catch (error) {
            console.error("Error fetching PO details:", error);
            return {};
          }
        },
      },

      {
        name: "pycd",
        label: "Vendor",
        type: "select",
        options: "accounts",
        apiEndpoint: "/api/accounts/acno?group=vendors,lc_accounts,customers",
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        required: true,
        // modalFields: [
        // { name: "name", label: "Vendor Name", type: "text", required: true },
        // ],
      },
      { name: "check_no", label: "ST Inv No", type: "text" },
      { name: "check_date", label: "ST Inv Date", type: "Date" },
      { name: "rmk", label: "Narration", type: "textarea" },
      {
        name: "invoice_no",
        label: "Com Inv No (Optional)",
        type: "text",
        required: false,
        validate: async (value, masterData) => {
          if (!value || !masterData.pycd) return null;
          try {
            const response = await axios.get(
              `/api/voucher/check-invoice?tran_code=4&pycd=${masterData.pycd
              }&invoice_no=${encodeURIComponent(value)}`,
            );
            if (response.data.exists) {
              const nextInvoiceNo =
                response.data.nextInvoiceNo || parseInt(value) + 1;
              return `Invoice number ${value} already exists for this vendor. Try ${nextInvoiceNo} or another number.`;
            }
            return null;
          } catch (error) {
            return `Error checking invoice number: ${error.message}`;
          }
        },
      },
      {
        name: "godown",
        label: "Godown",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKey: "godown",
        valueKey: "id",
        required: true,
        // modalFields: [
        // {
        // name: "godown",
        // label: "Godown Name",
        // type: "text",
        // required: true,
        // },
        // ],
      },
      { name: "rmk2", label: "Delivery No", type: "text" },
    ],
    lineFields: [
      {
        name: "itcd",
        label: "Product",
        type: "select",
        options: "products",
        minWidth: "400px",
        // apiEndpoint: (formData) =>
        //   formData.po_no ? `/api/orders/purchaseOrder` : "/api/setup/items",
        apiEndpoint: "/api/setup/items",
        createEndpoint: "/api/setup/items",
        nameKey: "item",
        valueKey: "itcd",
        required: true,
        // modalFields: [
        // { name: "item", label: "Product Name", type: "text", required: true },
        // {
        // name: "ic_id",
        // label: "Item Category",
        // type: "select",
        // options: "itemCategories",
        // apiEndpoint: "/api/setup/item_categories",
        // valueKey: "id",
        // nameKey: "ic_name",
        // required: true,
        // },
        // ],
      },
      {
        name: "batch_no",
        label: "Batch #",
        type: "text",
      },
      {
        name: "mfg_date",
        label: "Mfg Date",
        type: "date",
      },
      {
        name: "expiry_date",
        label: "Expiry Date",
        type: "date",
      },
      {
        name: "no_of_pack",
        label: "No of Packs",
        type: "number",
        required: true,
      },
      {
        name: "qty_per_pack",
        label: "Qty Per Pack",
        type: "number",
        required: true,
      },
      {
        name: "qty",
        label: "Quantity",
        type: "number",
        required: true,
        dependencies: ["no_of_pack", "qty_per_pack"],
        calculate: (v) => v.no_of_pack * v.qty_per_pack,
        validate: (value, line) => {
          const totalQty = (line.no_of_pack || 0) * (line.qty_per_pack || 0);
          if (value !== totalQty) {
            return `Quantity should be ${totalQty}`;
          }
          return null;
        },
      },
      // createOrderQtyField(), // Uses PO quantity validation
      { name: "rate", label: "Rate", type: "number" },
      {
        name: "damt",
        label: "Gross Amount",
        type: "number",
        required: true,
        dependencies: ["qty", "rate", "no_of_pack", "qty_per_pack"],
        calculate: (v) => v.qty * v.rate,
      },
      { name: "st_rate", label: "ST Rate (%)", type: "number" },
      {
        name: "st_amount",
        label: "ST Amount",
        type: "number",
        dependencies: [
          "damt",
          "st_rate",
          "no_of_pack",
          "qty_per_pack",
          "rate",
        ],
        calculate: (v) => (v.damt * v.st_rate) / 100,
      },
      { name: "additional_tax", label: "Additional Tax", type: "number" },
      {
        name: "total",
        label: "Amount",
        type: "number",
        dependencies: [
          "qty",
          "rate",
          "st_rate",
          "additional_tax",
          "no_of_pack",
          "qty_per_pack",
        ], // Updated dependencies
        calculate: (v) => {

          const damt = v.qty * v.rate; // Calculate damt
          const st_amount = (damt * (v.st_rate || 0)) / 100; // Calculate st_amount
          const addTax = (damt * (v.additional_tax || 0)) / 100; // Calculate additional tax
          return damt + st_amount + (addTax || 0); // Include additional_tax
        },
      },
    ],
    totals: {
      totalQty: {
        label: "Total Qty",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
      },
      grossTotal: {
        label: "Total Gross Amount",
        calculate: (lines) =>
          lines.reduce((sum, l) => sum + (l.gross_amount || 0), 0),
      },
      taxTotal: {
        label: "Total ST Amount",
        calculate: (lines) =>
          lines.reduce((sum, l) => sum + (l.st_amount || 0), 0),
      },
      additionalTaxTotal: {
        label: "Total Additional Tax",
        calculate: (lines) =>
          lines.reduce((sum, l) => sum + (l.additional_tax || 0), 0),
      },
      netTotal: {
        label: "Total Amount",
        calculate: (lines) => {
          const value = lines.reduce((sum, l) => sum + ((l.damt || 0) + (l.st_amount || 0) + (l.additional_tax || 0)), 0);
          return value.toLocaleString("en-US");
        },
      },
    },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "grn_no", label: "GRN No", type: "text" },
      { name: "po_no", label: "PO No", type: "text" },

      { name: "invoice_no", label: "Invoice No", type: "text", multiFilter: true },
      {
        name: "pycd",
        label: "Vendor",
        type: "text",
        options: true,
        value1: "acno",
        value2: "acname",
      },
      {
        name: "rmk3",
        label: "Bill No",
        type: "text",
      },
      { name: "rmk", label: "Narration", type: "text" },
      { name: "damt", label: "Total Amount", type: "number", isTotal: true },
    ],

    allowDelete: false,
    allowPrintSaveButton: false,
    allowPrint: false,
    allowEdit: true,
    allowView: true,
    allowCheck: false,
  },
  serviceInvoice: {
    buttonText: "Create Service Invoice",
    ModalHeading: "Create Service Invoice",
    ModalHeadingEdit: "Edit Service Invoice",
    // Its own code: a Service Entry is 20 (shared with Credit Note), the
    // invoice is the vendor bill that posts (lib/service/serviceInvoice.js).
    tran_code: 21,
    hasDeductionBlock: false,
    // The invoice can be linked to the GRNs / dispatches the service was for
    // (Form.jsx "Linked GRNs / Dispatches" header field → master.links).
    masterLinks: true,
    // âœ… SERVICE ENTRY â†’ SERVICE INVOICE mapping (allow invoice to be populated from Service Entry)
    sourceMapping: {
      type: "serviceEntry",
      sourceApi: "/api/voucher/serviceEntry",
      fieldMappings: {
        master: [
          {
            source: "service_id",
            target: "po_no",
            transform: (value) => value,
          },
          {
            source: "pycd",
            target: "pycd",
            transform: (value) => value,
          },
          {
            source: "acno",
            target: "acno",
            transform: (value) => value,
          },
          {
            source: "godown",
            target: "godown",
            transform: (value) => value,
          },
        ],
        lines: [
          {
            source: "service_id",
            target: "service_id",
            transform: (value) => value || null,
          },
          {
            source: "itcd",
            target: "itcd",
            transform: (value) => value || null,
          },
          {
            source: "qty",
            target: "qty",
            transform: (value) => value || 0,
          },
          {
            source: null,
            target: "original_qty",
            transform: (value, detail) => detail.qty,
          },
          {
            source: "no_of_pack",
            target: "no_of_pack",
            transform: (value) => value || 0,
          },
          {
            source: "qty_per_pack",
            target: "qty_per_pack",
            transform: (value) => value || 0,
          },
          {
            source: "rate",
            target: "rate",
            transform: (value) => value || 0,
          },
          {
            source: "damt",
            target: "damt",
            transform: (value) => value || 0,
          },
        ],
      },
    },
    // A vendor's bill for a service — only what such a bill carries.
    // Narration spans the row; the "Linked GRNs / Dispatches" picker
    // (masterLinks) follows it as its own full-width row.
    masterFields: [
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },
      {
        name: "pycd",
        label: "Vendor",
        type: "select",
        options: "accounts",
        apiEndpoint: `/api/accounts/acno?${VENDOR_GROUP_PARAM}`,
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        required: true,
      },
      {
        name: "invoice_no",
        label: "Vendor Invoice No",
        type: "text",
        // Optional: the imported freight / off-load / weighing invoices carry
        // none, and must stay editable.
        validate: async (value, masterData) => {
          const pycd = masterData?.pycd?.value ?? masterData?.pycd;
          if (!value || !pycd) return null;
          try {
            // Same vendor + same invoice no on ANOTHER service invoice.
            const response = await axios.get(`/api/voucher/serviceInvoice`, {
              params: {
                limit: 5,
                multiFilters: JSON.stringify({ invoice_no: [String(value)], pycd: [Number(pycd)] }),
              },
            });
            const own = Number(masterData?.tran_id) || null;
            const clash = (response.data?.data || []).find((r) => r.tran_id !== own);
            return clash
              ? `Vendor invoice ${value} is already entered for this vendor (voucher ${clash.vr_no ?? clash.tran_id}).`
              : null;
          } catch (error) {
            return null; // the check is a convenience — never block on it
          }
        },
      },
      { name: "check_no", label: "ST Invoice No", type: "text" },
      { name: "check_date", label: "ST Invoice Date", type: "date" },
      {
        name: "po_no",
        label: "Service Order",
        type: "select",
        options: "serviceOrders",
        apiEndpoint: "/api/orders/serviceOrder",
        nameKey: "order_no",
        valueKey: "order_no",
        // Optional helper: picking an order fills the vendor (and godown).
        onChange: async (value) => {
          const orderNo = Number(value?.value ?? value);
          if (!orderNo) return {};
          try {
            const response = await axios.get(`/api/orders/serviceOrder`, {
              params: { orderNo },
            });
            const order = (response.data?.data || []).find(
              (item) => Number(item.order_no) === orderNo,
            );
            if (!order) return {};
            return {
              ...(order.party_code && { pycd: order.party_code }),
              ...(order.godown && { godown: order.godown }),
            };
          } catch (error) {
            console.error("Error fetching service order:", error);
            return {};
          }
        },
      },
      {
        // Not used by the posting (lib/service/serviceInvoice.js) — kept
        // optional for the godown data scope / report filters.
        name: "godown",
        label: "Godown",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKey: "godown",
        valueKey: "id",
      },
      { name: "rmk", label: "Narration", type: "textarea", fullWidth: true },
    ],
    // Services are not packed: Qty (default 1) × Rate. The server prices every
    // line itself (lib/service/serviceInvoice.js); the calculated columns
    // below mirror it (serviceLineAmounts). Additional Tax is not offered —
    // a saved line that has one keeps it (it rides on the line) and it is
    // included in ST Amount / Total.
    newLineDefaults: { qty: 1 },
    lineFields: [
      {
        name: "service_id",
        label: "Service",
        type: "select",
        options: "services",
        apiEndpoint: "/api/setup/services",
        createEndpoint: "/api/setup/services",
        nameKey: "service_name",
        valueKey: "id",
        required: true,
      },
      {
        name: "qty",
        label: "Qty",
        type: "number",
        defaultValue: 1,
        required: true,
        validate: async (value) =>
          (parseFloat(value) || 0) <= 0 ? "Qty must be greater than 0" : null,
      },
      {
        name: "rate",
        label: "Rate",
        type: "number",
        validate: async (value) =>
          (parseFloat(value) || 0) < 0 ? "Rate cannot be negative" : null,
      },
      {
        name: "gross_amount",
        label: "Amount",
        type: "number",
        hideCalculatedHint: true,
        dependencies: ["qty", "rate"],
        calculate: (v) => serviceLineAmounts(v).gross,
      },
      { name: "st_rate", label: "ST %", type: "number" },
      {
        name: "st_amount",
        label: "ST Amount",
        type: "number",
        hideCalculatedHint: true,
        dependencies: ["qty", "rate", "st_rate", "additional_tax"],
        calculate: (v) => serviceLineAmounts(v).tax,
      },
      {
        // Display only — the server posts damt = Amount and the tax apart.
        name: "line_total",
        label: "Total",
        type: "number",
        hideCalculatedHint: true,
        dependencies: ["qty", "rate", "st_rate", "additional_tax"],
        calculate: (v) => serviceLineAmounts(v).total,
      },
    ],
    totals: {
      grossTotal: {
        label: "Amount",
        calculate: (lines) =>
          lines.reduce((sum, l) => sum + serviceLineAmounts(l).gross, 0),
      },
      taxTotal: {
        label: "Sales Tax",
        calculate: (lines) =>
          lines.reduce((sum, l) => sum + serviceLineAmounts(l).tax, 0),
      },
      netTotal: {
        label: "Invoice Total",
        calculate: (lines) =>
          fmtAmount(lines.reduce((sum, l) => sum + serviceLineAmounts(l).total, 0)),
      },
    },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      {
        // Sorts on grn_no; shows "GRN 4455" or "Dispatch 3".
        name: "grn_no",
        label: "Ref",
        type: "text",
        render: (entry) => serviceInvoiceRef(entry) || "-",
      },
      { name: "invoice_no", label: "Vendor Invoice No", type: "text" },
      {
        name: "pycd",
        label: "Vendor",
        type: "text",
        options: true,
        value1: "acno",
        value2: "acname",
      },
      { name: "rmk", label: "Narration", type: "text" },
      {
        // The vendor's 'Auto Entry' is a CREDIT on a service invoice.
        name: "damt",
        label: "Total",
        type: "number",
        render: (entry) => fmtAmount(serviceInvoiceTotal(entry)),
      },
    ],

    allowDelete: false,
    // No print template for service invoices (the row print button only
    // covers tran_codes 1/2/3/6) — the view modal shows the full invoice.
    allowPrint: false,
    allowEdit: true,
    allowView: true,
    allowCheck: false,
  },
  serviceEntry: {
    buttonText: "Create Service Entry",
    ModalHeading: "Create Service Entry",
    ModalHeadingEdit: "Create Service Entry",
    tran_code: 20,
    // âœ… SERVICE ORDER â†’ SERVICE ENTRY mapping (auto-populate when selecting Service Order)
    sourceMapping: {
      type: "serviceOrder",
      sourceApi: "/api/orders/serviceOrder",
      fieldMappings: {
        master: [
          {
            source: "order_no",
            target: "service_id",
            transform: (value) => value,
          },
          {
            source: "party_code",
            target: "pycd",
            transform: (value) => value,
          },
          {
            source: "acno",
            target: "acno",
            transform: (value) => value,
          },
          {
            source: "godown",
            target: "godown",
            transform: (value) => value,
          },
        ],
        lines: [
          {
            source: "service_id",
            target: "service_id",
            transform: (value) => value || null,
          },
          {
            source: "itcd",
            target: "itcd",
            transform: (value) => value || null,
          },
          {
            source: "qty",
            target: "qty",
            transform: (value) => value || 0,
          },
          {
            source: null,
            target: "original_qty",
            transform: (value, detail) => detail.qty,
          },
          {
            source: "no_of_packs",
            target: "no_of_pack",
            transform: (value) => value || 0,
          },
          {
            source: "qty_per_pack",
            target: "qty_per_pack",
            transform: (value) => value || 0,
          },
          {
            source: "rate",
            target: "rate",
            transform: (value) => value || 0,
          },
          {
            source: "amount",
            target: "damt",
            transform: (value) => value || 0,
          },
        ],
      },
    },

    masterFields: [
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },
      createLockableField({
        name: "service_id",
        label: "Service Order No",
        type: "select",
        options: "serviceOrders",
        apiEndpoint: "/api/orders/serviceOrder",
        nameKey: "order_no",
        valueKey: "order_no",
        lockInEdit: true, // ðŸ”’ Always locked in edit
        onChange: async (value, formData, config) => {
          if (!value) return { godown: null, lines: [] };

          try {
            const response = await axios.get(
              `/api/orders/serviceOrder?orderNo=${value}`,
            );
            const poData = response.data.data[0];

            return mapSourceToForm(
              poData,
              config?.sourceMapping,
              "serviceEntry",
            );
          } catch (error) {
            console.error("Error fetching SO:", error);
            throw error;
          }
        },
      }),
      createLockableField({
        name: "pycd",
        label: "Vendor",
        type: "select",
        options: "accounts",
        apiEndpoint: `/api/accounts/acno?${VENDOR_GROUP_PARAM}`,
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        lockInEdit: true,
        required: true,
        // modalFields: [
        // { name: "name", label: "Vendor Name", type: "text", required: true },
        // ],
      }),
      createLockableField({
        name: "godown",
        label: "Godown",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKey: "godown",
        lockInEdit: true,
        valueKey: "id",
        required: true,
        // modalFields: [
        // {
        // name: "godown",
        // label: "Godown Name",
        // type: "text",
        // required: true,
        // },
        // ],
      }),
      { name: "rmk", label: "Narration", type: "textarea" },
    ],

    lineFields: [
      {
        name: "service_id",
        label: "Service",
        type: "select",
        options: "services",
        apiEndpoint: "/api/setup/services",
        createEndpoint: "/api/setup/services",
        nameKey: "service_name",
        valueKey: "id",
        required: true,
        // modalFields: [
        //   { name: "service_name", label: "Service Name", type: "text", required: true },
        //   {
        //     name: "sc_id",
        //     label: "Service Category",
        //     type: "select",
        //     options: "serviceCategories",
        //     apiEndpoint: "/api/setup/item_categories",
        //     valueKey: "id",
        //     nameKey: "ic_name",
        //     required: true,
        //   },
        // ],
      },
      {
        name: "no_of_pack",
        label: "No of Packs",
        type: "number",
        required: true,
      },
      {
        name: "qty_per_pack",
        label: "Qty Per Pack",
        type: "number",
        required: true,
      },
      // âœ… CHANGED: Use universal qty field with GRN-specific validation
      createQtyField({}),

      {
        name: "rate",
        label: "Rate",
        type: "number",
        visibility: {
          dependsOn: "itcd",
          condition: "false", // Show when itcd has any value
        },
      },
      {
        name: "gross_amount",
        label: "Gross Amount",
        type: "number",
        required: true,
        dependencies: ["qty", "rate", "no_of_pack", "qty_per_pack"],
        calculate: (v) => v.qty * v.rate,
        visibility: {
          dependsOn: "itcd",
          condition: "false", // Show when itcd has any value
        },
      },
      {
        name: "damt",
        label: "Amount",
        required: true,
        type: "number",
        dependencies: [
          "qty",
          "rate",
          "st_rate",
          "additional_tax",
          "no_of_pack",
          "qty_per_pack",
        ], // Updated dependencies
        calculate: (v) => {

          const gross_amount = v.qty * v.rate; // Calculate gross_amount
          const st_amount = (gross_amount * (v.st_rate || 0)) / 100; // Calculate st_amount
          const addTax = (gross_amount * (v.additional_tax || 0)) / 100; // Calculate additional tax
          return gross_amount + st_amount + (addTax || 0); // Include additional_tax
        },
        visibility: {
          dependsOn: "itcd",
          condition: "false", // Show when itcd has any value
        },
      },
    ],

    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "order_no", label: "Order No", type: "text" },
      { name: "userid", label: "Created By", type: "text" },
      {
        name: "pycd",
        label: "Vendor",
        type: "text",
        options: true,
        value1: "acno",
        value2: "acname",
      },
      { name: "status", label: "Status", type: "status" }, // âœ… ADD THIS
    ],

    allowDelete: false,
    allowPrint: true,
    allowEdit: true,
    allowView: true,
    allowCheck: false,
  },
  sale: {
    ModalHeading: "Create Sale",
    ModalHeadingEdit: "Edit Sale",
    tran_code: 6,
    hasDeductionBlock: false,
    masterFields: [
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },
      {
        name: "dispatch_no",
        label: "Dispatch No",
        type: "text",
        visibility: {
          dependsOn: "names",
          condition: "false", // Show when itcd has any value
        },
      },
      {
        name: "so_no",
        label: "Sale Order No",
        type: "select",
        options: "saleOrders",
        apiEndpoint: "/api/orders/saleOrder?approvedOnly=true",
        nameKey: "order_no",
        valueKey: "order_no",
        onChange: async (value, formData) => {
          if (!value) return;
          try {
            const response = await axios.get(`/api/orders/saleOrder`);




            const filterResponse = response.data.data.filter(
              (item) => item.order_no === Number(value),
            );

            return {
              pycd: filterResponse[0].party_code, // Vendor
              godown: filterResponse[0].godown,
              orderDetails: filterResponse[0].orderDetails, // Full details of the order
              // Add other fields you want to auto-fill
            };
          } catch (error) {
            console.error("Error fetching PO details:", error);
            return {};
          }
        },
      },
      {
        name: "pycd",
        label: "Customer",
        type: "select",
        options: "accounts",
        apiEndpoint: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`,
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        required: true,
        // modalFields: [
        // {
        // name: "name",
        // label: "Customer Name",
        // type: "text",
        // required: true,
        // },
        // ],
      },
      {
        name: "check_no",
        label: "ST Inv No",
        type: "text",
        autoGenerate: true,
        validate: async (value, masterData) => {
          if (!value) return "ST Inv No is required";
          try {
            const response = await axios.get(
              `/api/voucher/check-sale-numbers?field=check_no&value=${encodeURIComponent(
                value,
              )}&tran_code=6`,
            );
            if (response.data.exists) {
              const nextNumber =
                response.data.nextNumber || parseInt(value) + 1;
              return `ST Inv No ${value} already exists. Try ${nextNumber} or another number.`;
            }
            return null;
          } catch (error) {
            return `Error checking ST Inv No: ${error.message}`;
          }
        },
      },
      { name: "check_date", label: "ST Inv Date", type: "Date" },
      { name: "rmk", label: "Narration", type: "textarea" },
      {
        name: "invoice_no",
        label: "Com Inv No",
        type: "text",
        required: false,
        validate: async (value, masterData) => {
          if (!value || !masterData.pycd) return null;
          try {
            const response = await axios.get(
              `/api/voucher/check-invoice?tran_code=6&pycd=${masterData.pycd
              }&invoice_no=${encodeURIComponent(value)}`,
            );
            if (response.data.exists) {
              const nextInvoiceNo =
                response.data.nextInvoiceNo || parseInt(value) + 1;
              return `Invoice number ${value} already exists for this vendor. Try ${nextInvoiceNo} or another number.`;
            }
            return null;
          } catch (error) {
            return `Error checking invoice number: ${error.message}`;
          }
        },
      },
      {
        name: "godown",
        label: "Godown",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKey: "godown",
        valueKey: "id",
        // modalFields: [
        // {
        // name: "godown",
        // label: "Godown Name",
        // type: "text",
        // required: true,
        // },
        // ],
      },

      {
        name: "rmk2",
        label: "Transporter No",
        type: "select",
        options: "accounts",
        apiEndpoint: `/api/accounts/acno?${TRANSPORTER_GROUP_PARAM}`,
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",

      },
      { name: "tr_amount", label: "Transporter Amount", type: "text" },
      // {
      //   name: "rmk2",
      //   label: "Delivery No",
      //   type: "text",
      //   required: true,
      //   autoGenerate: true,
      //   validate: async (value, masterData) => {
      //     if (!value) return "Delivery No is required";
      //     try {
      //       const response = await axios.get(
      //         `/api/voucher/check-sale-numbers?field=rmk2&value=${encodeURIComponent(
      //           value
      //         )}&tran_code=6`
      //       );
      //       if (response.data.exists) {
      //         const nextNumber =
      //           response.data.nextNumber || parseInt(value) + 1;
      //         return `Delivery No ${value} already exists. Try ${nextNumber} or another number.`;
      //       }
      //       return null;
      //     } catch (error) {
      //       return `Error checking Delivery No: ${error.message}`;
      //     }
      //   },
      // },
    ],
    lineFields: [
      {
        name: "itcd",
        label: "Product",
        type: "select",
        options: "products",
        // apiEndpoint: (formData) =>
        //   formData.so_no ? `/api/orders/saleOrder` : "/api/setup/items",
        apiEndpoint: "/api/setup/items",
        createEndpoint: "/api/setup/items",
        nameKey: "item",
        valueKey: "itcd",
        required: true,
        minWidth: "300px",
        // modalFields: [
        // { name: "item", label: "Product Name", type: "text", required: true },
        // {
        // name: "ic_id",
        // label: "Item Category",
        // type: "select",
        // options: "itemCategories",
        // apiEndpoint: "/api/setup/item_categories",
        // valueKey: "id",
        // nameKey: "ic_name",
        // required: true,
        // },
        // ],
      },
      { name: "no_of_pack", label: "No of Packs", type: "number" },
      { name: "qty_per_pack", label: "Qty Per Pack", type: "number" },
      createStockQtyField(), // Uses stock validation
      { name: "batch_no", label: "Batch No", type: "number" },
      { name: "rate", label: "Rate", type: "number" },
      {
        name: "camt",
        label: "Gross Amount",
        type: "number",
        dependencies: ["qty", "rate", "no_of_pack", "qty_per_pack"],
        calculate: (v) => v.qty * v.rate,
      },
      { name: "st_rate", label: "ST Rate (%)", type: "number" },
      {
        name: "st_amount",
        label: "ST Amount",
        type: "number",
        dependencies: [
          "camt",
          "st_rate",
          "no_of_pack",
          "qty_per_pack",
          "rate",
          "additional_tax",
        ],
        calculate: (v) => ((v.camt * v.st_rate) / 100) + ((v.camt * v.additional_tax) / 100),
      },
      {
        name: "additional_tax", label: "Further Tax", type: "number",
      },
      {
        name: "total",
        label: "Amount",
        type: "number",
        dependencies: [
          "qty",
          "rate",
          "st_rate",
          "additional_tax",
          "no_of_pack",
          "qty_per_pack",
        ], // Updated dependencies
        calculate: (v) => {

          const gross_amount = v.qty * v.rate; // Calculate gross_amount
          const st_amount = (gross_amount * (v.st_rate || 0)) / 100; // Calculate st_amount
          const addTax = (gross_amount * (v.additional_tax || 0)) / 100; // Calculate additional tax
          return gross_amount + st_amount + (addTax || 0); // Include additional_tax
        },
      },
    ],
    totals: {
      totalQty: {
        label: "Total Qty",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
      },
      grossTotal: {
        label: "Total Gross Amount",
        calculate: (lines) =>
          lines.reduce((sum, l) => sum + (l.camt || 0), 0),
      },
      taxTotal: {
        label: "Total ST Amount",
        calculate: (lines) =>
          lines.reduce((sum, l) => sum + (l.st_amount || 0), 0),
      },
      additionalTaxTotal: {
        label: "Total Further Tax",
        calculate: (lines) =>
          lines.reduce((sum, l) => sum + ((l.camt * l.additional_tax) / 100 || 0), 0),
      },
      netTotal: {
        label: "Total Amount",
        calculate: (lines) => {
          const value = lines.reduce((sum, l) => sum + (l.camt || 0) + (l.st_amount || 0) + (l.additional_tax || 0), 0);
          return value.toLocaleString("en-US");
        },
      },
    },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "invoice_no", label: "Invoice No", type: "text", multiFilter: true },
      { name: "dispatch_no", label: "Dispatch No", type: "text" },
      { name: "so_no", label: "Sales Order No", type: "text", multiFilter: true },
      {
        name: "pycd",
        label: "Customer",
        type: "text",
        options: true,
        value1: "acno",
        value2: "acname",
      },
      { name: "rmk", label: "Narration", type: "text" },
      { name: "camt", label: "Total Amount", type: "number", isTotal: true },
    ],
    // SALES → SALE INVOICE is retired (menu hidden): existing invoices stay
    // viewable, new ones are made on Dispatch Invoicing.
    allowCreate: false,
    allowDelete: false,
    allowPrintSaveButton: true,
    allowPrint: true,
    allowEdit: true,
    allowView: true,
    allowCheck: true,
  },
  purchaseReturn: {
    buttonText: "Create Purchase Return",
    ModalHeading: "Create Purchase Return",
    ModalHeadingEdit: "Edit Purchase Return",
    tran_code: 9,
    hasDeductionBlock: false,
    masterFields: [
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },
      {
        name: "rmk3",
        label: "Bill No",
        type: "text",
      },
      {
        name: "grn_no",
        label: "GRN No",
        type: "text",
        visibility: {
          dependsOn: "names",
          condition: "false",
        },
      },
      {
        name: "po_no",
        label: "Purchase Order No",
        type: "select",
        options: "purchaseOrders",
        apiEndpoint: "/api/orders/purchaseOrder",
        nameKey: "order_no",
        valueKey: "order_no",
        onChange: async (value, formData) => {
          if (!value) return;
          try {
            const response = await axios.get(`/api/orders/purchaseOrder`);
            const filterResponse = response.data.data.filter(
              (item) => item.order_no === Number(value),
            );
            return {
              pycd: filterResponse[0].party_code,
              godown: filterResponse[0].godown,
              orderDetails: filterResponse[0].orderDetails,
            };
          } catch (error) {
            console.error("Error fetching PO details:", error);
            return {};
          }
        },
      },
      {
        name: "pycd",
        label: "Vendor",
        type: "select",
        options: "accounts",
        apiEndpoint: "/api/accounts/acno?group=vendors,customers",
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        required: true,
        // modalFields: [
        // { name: "name", label: "Vendor Name", type: "text", required: true },
        // ],
      },
      { name: "check_no", label: "ST Inv No", type: "text" },
      { name: "check_date", label: "ST Inv Date", type: "Date" },
      { name: "rmk", label: "Narration", type: "textarea" },
      // The invoice number belongs to Invoicing; this is only the vendor's ref.
      { name: "vendor_bill_no", label: "Vendor Ref No", type: "text" },
      {
        name: "godown",
        label: "Godown",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKey: "godown",
        valueKey: "id",
        required: true,
        // modalFields: [
        // {
        // name: "godown",
        // label: "Godown Name",
        // type: "text",
        // required: true,
        // },
        // ],
      },
      { name: "rmk2", label: "Delivery No", type: "text" },
    ],
    lineFields: [
      {
        name: "itcd",
        label: "Product",
        type: "select",
        options: "products",
        apiEndpoint: "/api/setup/items",
        createEndpoint: "/api/setup/items",
        nameKeys: ["code", "item"],
        valueKey: "itcd",
        required: true,
        // modalFields: [
        // { name: "item", label: "Product Name", type: "text", required: true },
        // {
        // name: "ic_id",
        // label: "Item Category",
        // type: "select",
        // options: "itemCategories",
        // apiEndpoint: "/api/setup/item_categories",
        // valueKey: "id",
        // nameKey: "ic_name",
        // required: true,
        // },
        // ],
      },
      {
        name: "no_of_pack",
        label: "No of Packs",
        type: "number",
        required: true,
      },
      {
        name: "qty_per_pack",
        label: "Qty Per Pack",
        type: "number",
        required: true,
      },
      {
        name: "qty",
        label: "Quantity",
        type: "number",
        required: true,
        dependencies: ["no_of_pack", "qty_per_pack"],
        calculate: (v) => v.no_of_pack * v.qty_per_pack,
        validate: (value, line) => {
          const totalQty = (line.no_of_pack || 0) * (line.qty_per_pack || 0);
          if (value !== totalQty) {
            return `Quantity should be ${totalQty}`;
          }
          return null;
        },
      },
      { name: "rate", label: "Rate", type: "number" },
      {
        name: "camt",
        label: "Gross Amount",
        type: "number",
        required: true,
        dependencies: ["qty", "rate", "no_of_pack", "qty_per_pack"],
        calculate: (v) => v.qty * v.rate,
      },
      { name: "st_rate", label: "ST Rate (%)", type: "number" },
      {
        name: "st_amount",
        label: "ST Amount",
        type: "number",
        dependencies: ["damt", "st_rate", "no_of_pack", "qty_per_pack", "rate"],
        calculate: (v) => (v.damt * v.st_rate) / 100,
      },
      { name: "additional_tax", label: "Additional Tax", type: "number" },
      {
        name: "total",
        label: "Amount",
        type: "number",
        dependencies: ["qty", "rate", "st_rate", "additional_tax", "no_of_pack", "qty_per_pack"],
        calculate: (v) => {
          const damt = v.qty * v.rate;
          const st_amount = (damt * (v.st_rate || 0)) / 100;
          const addTax = (damt * (v.additional_tax || 0)) / 100;
          return damt + st_amount + (addTax || 0);
        },
      },
    ],
    totals: {
      totalQty: {
        label: "Total Qty",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
      },
      grossTotal: {
        label: "Total Gross Amount",
        calculate: (lines) =>
          lines.reduce((sum, l) => sum + (l.camt || 0), 0),
      },
      taxTotal: {
        label: "Total ST Amount",
        calculate: (lines) =>
          lines.reduce((sum, l) => sum + (l.st_amount || 0), 0),
      },
      additionalTaxTotal: {
        label: "Total Additional Tax",
        calculate: (lines) =>
          lines.reduce((sum, l) => sum + (l.additional_tax || 0), 0),
      },
      netTotal: {
        label: "Total Amount",
        calculate: (lines) => {
          const value = lines.reduce((sum, l) => sum + ((l.camt || 0) + (l.st_amount || 0) + (l.additional_tax || 0)), 0);
          return value.toLocaleString("en-US");
        },
      },
    },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "grn_no", label: "GRN No", type: "text" },
      { name: "po_no", label: "PO No", type: "text" },
      { name: "invoice_no", label: "Invoice No", type: "text", multiFilter: true },
      {
        name: "pycd",
        label: "Vendor",
        type: "text",
        options: true,
        value1: "acno",
        value2: "acname",
      },
      {
        name: "rmk3",
        label: "Bill No",
        type: "text",
      },
      { name: "rmk", label: "Narration", type: "text" },
      { name: "camt", label: "Total Amount", type: "number", isTotal: true },
    ],
    allowDelete: false,
    allowPrintSaveButton: false,
    allowPrint: false,
    allowEdit: true,
    allowView: true,
    allowCheck: false,
  },

  // ── GRN Return (tran_code 9) — against ONE GRN, quantity only ───────────
  // Pick the vendor's GRN (search by GRN no): vendor, godown and the lines
  // (item, batch) come from it; each item's qty is capped at what the GRN
  // received minus earlier returns. The GRN list's Return button opens this
  // form already filled (fromOriginal). Priced on Purchase Return Invoicing.
  grnReturn: {
    buttonText: "Create GRN Return",
    ModalHeading: "Create GRN Return",
    ModalHeadingEdit: "Edit GRN Return",
    tran_code: 9,
    hasDeductionBlock: false,
    differApi: "/api/voucher/grnReturn",
    // Physical document: no rate / amount; invoiced on the Invoicing screen.
    qtyOnly: true,
    invoiceLock: true,
    fromOriginal: (grn) => grnReturnFromGrn(grn),
    cloneOmit: ["rmk5"],
    masterFields: [
      { name: "dated", label: "Date", type: "date", required: true },
      createLockableField({
        name: "pycd",
        label: "Vendor",
        type: "select",
        options: "accounts",
        apiEndpoint: "/api/accounts/acno?group=customers,vendors,lc_accounts,beneficiaries",
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        required: true,
        lockInEdit: true,
        clearable: true,
        // A GRN belongs to one vendor: changing the vendor drops the GRN and
        // the lines it brought.
        onChange: async (value, formData) => {
          const before = selVal(formData?.pycd);
          if (hasValue(formData?.grn_no) && hasValue(before) && String(before) !== String(value)) {
            return { grn_no: null, lines: [] };
          }
          return {};
        },
      }),
      createLockableField({
        name: "grn_no",
        label: "GRN No",
        type: "select",
        options: "grns",
        // The vendor's GRNs, newest first, searchable by GRN no. A saved
        // return (raw GRN no) looks up just its own.
        apiEndpoint: (formData) => {
          const raw = formData?.grn_no;
          if (hasValue(raw) && typeof raw !== "object") {
            return `/api/voucher/grn?limit=1&multiFilters=${jsonParam({ grn_no: [Number(raw)] })}`;
          }
          const vendor = selVal(formData?.pycd);
          return hasValue(vendor)
            ? `/api/voucher/grn?limit=50&multiFilters=${jsonParam({ pycd: [Number(vendor)] })}`
            : "/api/voucher/grn?limit=50";
        },
        nameKeys: ["grn_no", "acno.acname", "rmk3"],
        valueKey: "grn_no",
        required: true,
        lockInEdit: true,
        getPlaceholder: (formData) =>
          hasValue(formData?.pycd) ? "Search the vendor's GRN no" : "Search GRN no",
        onChange: async (value, formData) => {
          if (!value) return {};
          try {
            const grn = await fetchGrnByNo(value);
            if (!grn) return {};
            const { master, lines } = await grnReturnFromGrn(grn);
            // Keep the option the user picked; narration only when blank.
            const { grn_no, rmk, ...rest } = master;
            return {
              ...rest,
              ...(formData?.rmk ? {} : { rmk }),
              lines,
            };
          } catch (error) {
            console.error("Error loading GRN:", error);
            return {};
          }
        },
      }),
      {
        name: "godown",
        label: "Godown",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKeys: ["id", "godown"],
        valueKey: "id",
        required: true,
      },
      { name: "rmk2", label: "Return DC / Challan No", type: "text" },
      { name: "rmk4", label: "Vehicle No", type: "text", uppercase: true },
      LEGACY_DOC_FIELD,
      { name: "rmk", label: "Narration", type: "textarea", fullWidth: true },
    ],
    lineFields: [
      {
        name: "itcd",
        label: "Item",
        type: "select",
        options: "products",
        apiEndpoint: "/api/setup/items",
        createEndpoint: "/api/setup/items",
        nameKeys: ["code", "item"],
        valueKey: "itcd",
        required: true,
        onChange: async (value, line, allLines, formData) => grnReturnItemChanged(value, formData),
      },
      { name: "batch_no", label: "Batch No", type: "text" },
      { name: "unit", label: "Unit", type: "text", readOnly: true, width: "90px" },
      { name: "no_of_pack", label: "No of Packs", type: "number" },
      { name: "qty_per_pack", label: "Qty per Pack", type: "number" },
      createGrnReturnQtyField(),
    ],
    totals: {
      totalQty: {
        label: "Total Qty (KG)",
        calculate: (lines) => lines.reduce((sum, l) => sum + (parseFloat(l.qty) || 0), 0),
      },
    },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "return_no", label: "Return No", type: "text", render: (e) => String(e.vr_no || e.tran_id || "-") },
      { name: "grn_no", label: "GRN No", type: "text" },
      { name: "pycd", label: "Vendor", type: "text", options: true, value1: "acno", value2: "acname" },
      { name: "godown", label: "Godown", type: "text", options: true, value1: "godownDetails", value2: "godown" },
      { name: "qty", label: "Total Qty", type: "number", isInnerTotal: true, key: "transactions" },
      INVOICED_COLUMN,
    ],
    allowDelete: false,
    allowPrint: false,
    allowEdit: true,
    allowView: true,
    allowCheck: false,
    allowClone: false,
  },

  //  saleReturn: {
  //     buttonText: "Create Sale Return",
  //     ModalHeading: "Create Sale Return",
  //     ModalHeadingEdit: "Create Sale Return",
  //     tran_code: 10,
  //     sourceTranCode: 6,  // Selects from Dispatch (tran_code=6)
  //     sourceLabel: "Dispatch",
  //     hasDeductionBlock: false,
  //     hasDeductionBlock: false,
  //     differApi: "/api/voucher/dispatch",
  //     sourceMapping: {
  //       type: "grn",
  //       sourceApi: "/api/voucher/dispatch",
  //       fieldMappings: {
  //         master: [
  //           {
  //             source: "so_no",
  //             target: "so_no",
  //             transform: (value) => value,
  //           },
  //           {
  //             source: "dispatch_no",
  //             target: "dispatch_no",
  //             transform: (value) => value,
  //           },
  //           {
  //             source: "pycd",
  //             target: "pycd",
  //             transform: (value) => value,
  //           },
  //           {
  //             source: "acno",
  //             target: "acno",
  //             transform: (value) => value,
  //           },
  //           {
  //             source: "godown",
  //             target: "godown",
  //             transform: (value) => value,
  //           },
  //         ],
  //         lines: [
  //           {
  //             source: "itcd",
  //             target: "itcd",
  //             transform: (value) => value,
  //           },
  //           {
  //             source: "qty",
  //             target: "qty",
  //             transform: (value) => value || 0,
  //           },
  //           {
  //             source: null, // For validation reference
  //             target: "original_qty",
  //             transform: (value, detail) => detail.qty,
  //           },
  //           {
  //             source: "no_of_pack",
  //             target: "no_of_pack",
  //             transform: (value) => value || 0,
  //           },
  //           {
  //             source: "qty_per_pack",
  //             target: "qty_per_pack",
  //             transform: (value) => value || 0,
  //           },
  //           {
  //             source: "rate",
  //             target: "rate",
  //             transform: (value) => value || 0,
  //           },
  //           {
  //             source: "gross_amount",
  //             target: "gross_amount",
  //             transform: (value) => value || 0,
  //           },
  //           {
  //             source: "camt",
  //             target: "damt",
  //             transform: (value) => value || 0,
  //           },
  //         ],
  //       },
  //     },

  //     masterFields: [
  //       {
  //         name: "dated",
  //         label: "Date",
  //         type: "date",
  //         required: true,
  //       },

  //       {
  //         name: "pycd",
  //         label: "Vendor",
  //         type: "select",
  //         options: "accounts",
  //         apiEndpoint: `/api/accounts/acno?${VENDOR_GROUP_PARAM}`,
  //         createEndpoint: "/api/accounts/acno",
  //         nameKeys: ["acno", "acname"],
  //         valueKey: "acno",
  //         required: true,
  //         // modalFields: [
  //         // { name: "name", label: "Vendor Name", type: "text", required: true },
  //         // ],
  //       },
  //       { name: "check_no", label: "ST Inv No", type: "text" },
  //       { name: "check_date", label: "ST Inv Date", type: "Date" },
  //       { name: "rmk", label: "Narration", type: "textarea" },
  //       {
  //         name: "invoice_no",
  //         label: "Com Inv No",
  //         type: "text",
  //         validate: async (value, masterData) => {
  //           if (!value || !masterData.pycd) return null;
  //           try {
  //             const response = await axios.get(
  //               `/api/voucher/check-invoice?tran_code=10&pycd=${masterData.pycd
  //               }&invoice_no=${encodeURIComponent(value)}`,
  //             );
  //             if (response.data.exists) {
  //               const nextInvoiceNo =
  //                 response.data.nextInvoiceNo || parseInt(value) + 1;
  //               return `Invoice number ${value} already exists for this vendor. Try ${nextInvoiceNo} or another number.`;
  //             }
  //             return null;
  //           } catch (error) {
  //             return `Error checking invoice number: ${error.message}`;
  //           }
  //         },
  //       },
  //       {
  //         name: "godown",
  //         label: "Godown",
  //         type: "select",
  //         options: "godowns",
  //         apiEndpoint: "/api/setup/godowns",
  //         createEndpoint: "/api/setup/godowns",
  //         nameKey: "godown",
  //         valueKey: "id",
  //         // modalFields: [
  //         // {
  //         // name: "godown",
  //         // label: "Godown Name",
  //         // type: "text",
  //         // required: true,
  //         // },
  //         // ],
  //       },
  //       { name: "rmk2", label: "Delivery No", type: "text" },
  //     ],
  //     lineFields: [
  //       {
  //         name: "itcd",
  //         label: "Product",
  //         type: "select",
  //         options: "products",
  //         apiEndpoint: "/api/setup/items",
  //         createEndpoint: "/api/setup/items",
  //         nameKey: "item",
  //         valueKey: "itcd",
  //         // modalFields: [
  //         // { name: "item", label: "Product Name", type: "text", required: true },
  //         // {
  //         // name: "ic_id",
  //         // label: "Item Category",
  //         // type: "select",
  //         // options: "itemCategories",
  //         // apiEndpoint: "/api/setup/item_categories",
  //         // valueKey: "id",
  //         // nameKey: "ic_name",
  //         // required: true,
  //         // },
  //         // ],
  //       },
  //       { name: "no_of_pack", label: "No of Packs", type: "number" },
  //       { name: "qty_per_pack", label: "Qty Per Pack", type: "number" },
  //       createPurhcaseReturnnedQtyField({
  //         customValidate: async (value, line, allLines, formData) => {


  //           if (!formData.so_no || !line.itcd) {
  //             return "Please select PO and item first";
  //           }

  //           try {
  //             const res = await axios.get(
  //               `/api/voucher/checkReturnQty?so_no=${formData.so_no}&dispatch_no=${formData.dispatch_no}`,
  //             );

  //             const GRNQtyAgainstPO = res.data.summary?.totalQty || 0;
  //             const orderedQty = line.so_qty || 0;
  //             const balanceQty = orderedQty - GRNQtyAgainstPO;

  //             const numericValue = parseFloat(value) || 0;

  //             // BLOCK if exceeds available quantity
  //             if (numericValue > balanceQty) {
  //               return `Cannot exceed available quantity (${balanceQty})`;
  //             }

  //             return null;
  //           } catch (error) {
  //             console.error("Validation error:", error);
  //             return "Error validating quantity";
  //           }
  //         },
  //       }),
  //       { name: "rate", label: "Rate", type: "number" },
  //       {
  //         name: "camt",
  //         label: "Gross Amount",
  //         type: "number",
  //         dependencies: ["qty", "rate", "no_of_pack", "qty_per_pack"],
  //         calculate: (v) => v.qty * v.rate,
  //       },
  //       { name: "st_rate", label: "ST Rate (%)", type: "number" },
  //       {
  //         name: "st_amount",
  //         label: "ST Amount",
  //         type: "number",
  //         dependencies: [
  //           "gross_amount",
  //           "st_rate",
  //           "no_of_pack",
  //           "qty_per_pack",
  //           "rate",
  //         ],
  //         calculate: (v) => (v.gross_amount * v.st_rate) / 100,
  //       },
  //       { name: "additional_tax", label: "Additional Tax", type: "number" },
  //       {
  //         name: "total",
  //         label: "Amount",
  //         required: true,
  //         type: "number",
  //         dependencies: [
  //           "qty",
  //           "rate",
  //           "no_of_pack",
  //           "qty_per_pack",
  //           "st_rate",
  //           "additional_tax",
  //         ], // Updated dependencies
  //         calculate: (v) => {

  //           const gross_amount = v.qty * v.rate; // Calculate gross_amount
  //           const st_amount = (gross_amount * (v.st_rate || 0)) / 100; // Calculate st_amount
  //           const addTax = (gross_amount * (v.additional_tax || 0)) / 100; // Calculate additional tax
  //           return gross_amount + st_amount + (addTax || 0); // Include additional_tax
  //         },
  //       },
  //     ],
  //     totals: {
  //       totalQty: {
  //         label: "Total Qty",
  //         calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
  //       },
  //       grossTotal: {
  //         label: "Total Gross Amount",
  //         calculate: (lines) =>
  //           lines.reduce((sum, l) => sum + (l.gross_amount || 0), 0),
  //       },
  //       taxTotal: {
  //         label: "Total ST Amount",
  //         calculate: (lines) =>
  //           lines.reduce((sum, l) => sum + (l.st_amount || 0), 0),
  //       },
  //       additionalTaxTotal: {
  //         label: "Total Additional Tax",
  //         calculate: (lines) =>
  //           lines.reduce((sum, l) => sum + (l.additional_tax || 0), 0),
  //       },
  //       netTotal: {
  //         label: "Total Amount",
  //         calculate: (lines) => {
  //           const value = lines.reduce((sum, l) => sum + (l.damt || 0), 0);
  //           return value.toLocaleString("en-US");
  //         },
  //       },
  //     },
  //     tableFields: [
  //       { name: "dated", label: "Date", type: "date" },
  //       { name: "dispatch_no", label: "Dispatch No", type: "text" },
  //       { name: "invoice_no", label: "Invoice No", type: "text" },
  //       {
  //         name: "pycd",
  //         label: "Customer",
  //         type: "text",
  //         options: true,
  //         value1: "acno",
  //         value2: "acname",
  //       },
  //       { name: "rmk", label: "Narration", type: "text" },
  //       { name: "status", label: "Status", type: "status" },
  //     ],
  //     allowDelete: false,
  //     allowPrint: false,
  //     allowEdit: true,
  //     allowView: true,
  //     allowCheck: false,
  //   }, 


  // ── Dispatch Return (tran_code 10) — against ONE dispatch, quantity only ─
  // (Config key stays `saleReturn`: routes, permissions and the API use it.)
  // Pick the dispatch (by dispatch no): customer, godown and the lines (item,
  // unit, batch) come from it, and each item's qty is capped at what that
  // dispatch delivered minus earlier returns. The dispatch list's Return
  // button opens this form already filled (fromOriginal). Priced on Sale
  // Return Invoicing; freight etc. are billed as Service Invoices.
  saleReturn: {
    buttonText: "Create Dispatch Return",
    ModalHeading: "Create Dispatch Return",
    ModalHeadingEdit: "Edit Dispatch Return",
    label: "Dispatch Return",
    tran_code: 10,
    hasDeductionBlock: false,
    // Physical document: no rate / amount; invoiced on the Invoicing screen.
    qtyOnly: true,
    invoiceLock: true,
    // Form.jsx: the dispatch row handed over by the Return button.
    fromOriginal: (dispatch) => saleReturnFromDispatch(dispatch),
    // Copied with a clone: never the legacy document number.
    cloneOmit: ["rmk5"],
    masterFields: [
      { name: "dated", label: "Date", type: "date", required: true },
      createLockableField({
        name: "dispatch_no",
        label: "Dispatch No",
        type: "select",
        options: "dispatches",
        // The customer's dispatches, newest first, searchable by dispatch no
        // or invoice no. A saved return (raw dispatch no) looks up just its own.
        apiEndpoint: (formData) => {
          const raw = formData?.dispatch_no;
          if (hasValue(raw) && typeof raw !== "object") {
            return `/api/voucher/dispatchEdit?limit=1&multiFilters=${jsonParam({ dispatch_no: [Number(raw)] })}`;
          }
          const customer = selVal(formData?.pycd);
          return hasValue(customer)
            ? `/api/voucher/dispatchEdit?limit=50&multiFilters=${jsonParam({ pycd: [Number(customer)] })}`
            : "/api/voucher/dispatchEdit?limit=50";
        },
        nameKeys: ["dispatch_no", "invoice_no", "acno.acname"],
        // " - " keeps a picked label from being re-fetched (Form.jsx).
        valueKey: "dispatch_no",
        // Required on the form while "saleReturn.requireDispatchLink" is off (as
        // before); on, the server requires it OR the Old Dispatch No below.
        requiredBy: { key: "saleReturn.requireDispatchLink", value: false },
        lockInEdit: true,
        getPlaceholder: () => "Search dispatch no",
        onChange: async (value, formData) => {
          if (!value) return {};
          try {
            const dispatch = await fetchDispatchByNo(value);
            if (!dispatch) return {};
            const { master, lines } = await saleReturnFromDispatch(dispatch);
            // Keep the option the user picked; narration only when blank.
            const { dispatch_no, rmk, ...rest } = master;
            return {
              ...rest,
              ...(formData?.rmk ? {} : { rmk }),
              lines,
            };
          } catch (error) {
            console.error("Error loading dispatch:", error);
            return {};
          }
        },
      }),
      createLockableField({
        name: "pycd",
        label: "Customer",
        type: "select",
        options: "accounts",
        apiEndpoint: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`,
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        required: true,
        lockInEdit: true,
      }),
      {
        name: "godown",
        label: "Godown",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKeys: ["id", "godown"],
        valueKey: "id",
        required: true,
      },
      { name: "rmk4", label: "Vehicle No", type: "text", uppercase: true },
      // A dispatch from before the system started (not in the system): its old
      // number + the warehouse; lines carry their cost rate (saleReturn.requireDispatchLink).
      {
        name: "ref_dispatch_no",
        label: "Old Dispatch No (before system start)",
        type: "text",
        feature: "saleReturn.requireDispatchLink",
        featureKeep: (saved) => Boolean(saved?.master?.ref_dispatch_no),
        disabled: (formData) => hasValue(selVal(formData?.dispatch_no)),
      },
      LEGACY_DOC_FIELD,
      { name: "rmk", label: "Narration", type: "textarea", fullWidth: true },
    ],
    lineFields: [
      {
        name: "itcd",
        label: "Item",
        type: "select",
        options: "products",
        apiEndpoint: "/api/setup/items",
        createEndpoint: "/api/setup/items",
        nameKeys: ["code", "item"],
        valueKey: "itcd",
        required: true,
        onChange: async (value, line, allLines, formData) => saleReturnItemChanged(value, formData),
      },
      // Old dispatch only: the cost the goods come back at — the system-start
      // rate (prefilled; the server sets it) or typed when the item has none.
      {
        name: "cost_rate",
        label: "Cost Rate",
        type: "number",
        width: "110px",
        feature: "saleReturn.requireDispatchLink",
        featureKeep: (saved) => (saved?.lines || saved?.transactions || []).some?.((l) => l?.cost_rate != null),
        readOnly: (line, master) => !String(master?.ref_dispatch_no ?? "").trim(),
      },
      { name: "batch_no", label: "Batch No", type: "text" },
      // The unit the dispatch was made in (KG / LTR).
      { name: "unit", label: "Unit", type: "text", readOnly: true, width: "90px" },
      { name: "no_of_pack", label: "No of Packs", type: "number" },
      { name: "qty_per_pack", label: "Qty per Pack", type: "number" },
      // Same as the dispatch: on a LTR line the packs are litres and the KG is
      // converted with the item's ltr_rate.
      {
        name: "qty_ltr",
        label: "Qty (LTR)",
        type: "number",
        width: "120px",
        dependencies: ["no_of_pack", "qty_per_pack", "unit"],
        readOnly: true,
        calculate: (a, b) => {
          const line = calcLine(a, b);
          if (!isLitreUnit(line.unit)) return "";
          return packTotal(line);
        },
      },
      createSaleReturnQtyField(),
    ],
    totals: {
      totalQty: {
        label: "Total Qty (KG)",
        calculate: (lines) => lines.reduce((sum, l) => sum + (parseFloat(l.qty) || 0), 0),
      },
      totalQtyLtr: {
        label: "Total Qty (LTR)",
        showWhen: (lines) => lines.some((l) => isLitreUnit(l?.unit)),
        calculate: (lines) => lines.reduce((sum, l) => sum + (parseFloat(l.qty_ltr) || 0), 0),
      },
    },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "return_no", label: "Return No", type: "text", render: (e) => String(e.vr_no || e.tran_id || "-") },
      { name: "dispatch_no", label: "Dispatch No", type: "text" },
      { name: "pycd", label: "Customer", type: "text", options: true, value1: "acno", value2: "acname" },
      { name: "godown", label: "Godown", type: "text", options: true, value1: "godownDetails", value2: "godown" },
      { name: "qty", label: "Total Qty", type: "number", isInnerTotal: true, key: "transactions" },
      INVOICED_COLUMN,
    ],
    allowDelete: false,
    allowPrintSaveButton: true,
    allowPrint: true,
    allowEdit: true,
    allowView: true,
    allowCheck: true,
  },
  // Retired: a return is made on Sale Return, against a dispatch. Existing
  // documents stay viewable here.
  dispatchReturn: {
    buttonText: "",
    allowCreate: false,
    ModalHeading: "Create Dispatch Return",
    ModalHeadingEdit: "Edit Dispatch Return",
    tran_code: 10,
    //sourceTranCode: 6,  // Selects from Dispatch documents when used standalone
    //sourceLabel: "Dispatch",
   hasDeductionBlock: false,
    differApi: "/api/voucher/dispatchReturn",
    // sourceMapping: {
    //   type: "dispatch",
    //   sourceApi: "/api/voucher/dispatch",
    //   fieldMappings: {
    //     master: [
    //       { source: "so_no", target: "so_no", transform: (value) => value },
    //       { source: "dispatch_no", target: "dispatch_no", transform: (value) => value },
    //       { source: "pycd", target: "pycd", transform: (value) => value },
    //       { source: "acno", target: "acno", transform: (value) => value },
    //       { source: "godown", target: "godown", transform: (value) => value },
    //     ],
    //     lines: [
    //       { source: "itcd", target: "itcd", transform: (value) => value },
    //       { source: "qty", target: "qty", transform: (value) => value || 0 },
    //       { source: null, target: "original_qty", transform: (value, detail) => detail.qty },
    //       { source: "no_of_pack", target: "no_of_pack", transform: (value) => value || 0 },
    //       { source: "qty_per_pack", target: "qty_per_pack", transform: (value) => value || 0 },
    //     ],
    //   },
    // },
    masterFields: [
      { name: "dated", label: "Date", type: "date", required: true },
      {
        name: "pycd",
        label: "Customer",
        type: "select",
        options: "accounts",
        apiEndpoint: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`,
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        required: true,
        // modalFields: [
        // { name: "name", label: "Customer Name", type: "text", required: true },
        // ],
      },
      { name: "rmk", label: "Narration", type: "textarea" },
      { name: "rmk2", label: "Delivery No", type: "text" },
      {
        name: "godown",
        label: "Warehouse",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKeys: ["id","godown"],
        valueKey: "id",
        // modalFields: [
        // { name: "godown", label: "Godown Name", type: "text", required: true },
        // ],
      },
    ],
    lineFields: [
      {
        name: "itcd",
        label: "Product",
        type: "select",
        options: "products",
        apiEndpoint: "/api/setup/items",
        createEndpoint: "/api/setup/items",
        nameKeys: ["code","item"],
        valueKey: "itcd",
        // modalFields: [
        // { name: "item", label: "Product Name", type: "text", required: true },
        // {
        // name: "ic_id",
        // label: "Item Category",
        // type: "select",
        // options: "itemCategories",
        // apiEndpoint: "/api/setup/item_categories",
        // valueKey: "id",
        // nameKey: "ic_name",
        // required: true,
        // },
        // ],
      },
      { name: "no_of_pack", label: "No of Packs", type: "number" },
      { name: "qty_per_pack", label: "Qty Per Pack", type: "number" },
      createPurhcaseReturnnedQtyField({}),
      // Rate and amount columns hidden — Dispatch-style (no pricing)
      { name: "rate", label: "Rate", type: "number", visibility: { dependsOn: "nothing", condition: "false" } },
      { name: "gross_amount", label: "Gross Amount", type: "number", dependencies: ["qty", "rate"], calculate: (v) => v.qty * v.rate, visibility: { dependsOn: "nothing", condition: "false" } },
      { name: "st_rate", label: "ST Rate (%)", type: "number", visibility: { dependsOn: "nothing", condition: "false" } },
      { name: "st_amount", label: "ST Amount", type: "number", dependencies: ["gross_amount", "st_rate"], calculate: (v) => (v.gross_amount * v.st_rate) / 100, visibility: { dependsOn: "nothing", condition: "false" } },
      { name: "additional_tax", label: "Additional Tax", type: "number", visibility: { dependsOn: "nothing", condition: "false" } },
      { name: "damt", label: "Amount", type: "number", dependencies: ["qty", "rate"], calculate: (v) => v.qty * v.rate, visibility: { dependsOn: "nothing", condition: "false" } },
    ],
    totals: {
      totalQty: {
        label: "Total Qty",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
      },
    },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "dispatch_no", label: "Dispatch No", type: "text" },
      { name: "so_no", label: "SO No", type: "text" },
      {
        name: "pycd",
        label: "Customer",
        type: "text",
        options: true,
        value1: "acno",
        value2: "acname",
      },
      { name: "rmk", label: "Narration", type: "text" },
      // isInnerTotal = Σ transactions[].qty (isTotal sums the sub_tran_id 3
   // "Auto Entry" AMOUNT, not qty). Control rows carry no qty, so no double count.
   { name: "qty", label: "Total Qty", type: "number", isInnerTotal: true , key: "transactions", },
      { name: "status", label: "Status", type: "status" },
    ],
    allowDelete: false,
    allowPrint: false,
    allowEdit: true,
    allowView: true,
    allowCheck: false,
  },

  transfer: {
    buttonText: "Create Material Transfer",
    ModalHeading: "Create Material Transfer",
    ModalHeadingEdit: "Edit Material Transfer",
    tran_code: 11,
    hasDeductionBlock: false,
    differApi: "/api/voucher/transfer",
    // differTitle: "Transfer Requisitions",
    // âœ… REQUISITION â†’ PURCHASE ORDER mapping
    // sourceMapping: {
    //   type: "requisition",
    //   sourceApi: "/api/material/requisition?category=TRANSFER",
    //   fieldMappings: {
    //     master: [
    //       {
    //         source: "tran_id",
    //         target: "req_no",
    //         transform: (value) => value,
    //       },
    //       {
    //         source: "issued_for",
    //         target: "godown",
    //         transform: (value) => value,
    //       },
    //       {
    //         source: "userid",
    //         target: "user_id",
    //         transform: (value) => value,
    //       },

    //       {
    //         source: "issued_by",
    //         target: "godown2",
    //         transform: (value, master) => ({
    //           value: master.godown2Details?.id,
    //           label: master.godown2Details?.godown,
    //         }),
    //       },

    //       // {
    //       //   source: "dated",
    //       //   target: "dated",
    //       //   transform: (value) => new Date(value).toLocaleDateString() // Direct mapping
    //       // }
    //     ],
    //     lines: [
    //       {
    //         source: "itcd", // From requisition details
    //         target: "itcd",
    //         transform: (value) => value,
    //       },
    //       {
    //         source: "qty", // Approved quantity from requisition
    //         target: "qty",
    //         transform: (value) => value || 0,
    //       },
    //       {
    //         source: "qty",
    //         target: "req_qty",
    //         transform: (value) => value || 0,
    //       },
    //       {
    //         source: "qty",
    //         target: "qty_per_pack",
    //         transform: (value) => value || 0,
    //       },
    //       {
    //         source: null, // Default value
    //         target: "no_of_pack",
    //         transform: () => 1,
    //       },
    //       {
    //         source: null, // Default value
    //         target: "rate",
    //         transform: () => 0,
    //       },
    //       {
    //         source: null, // For validation reference
    //         target: "original_qty",
    //         transform: (value, detail) => detail.qty,
    //       },
    //     ],
    //   },
    // },
    masterFields: [
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },

      {
        name: "req_no",
        label: "Material Requisition No",
        type: "select",
        options: "requisitions",
        apiEndpoint: `/api/material/requisition?category=TRANSFER`,
        nameKey: "tran_id",
        valueKey: "tran_id",
        onChange: async (value, formData) => {
          if (!value) {
            // Clear lines and godown if no requisition selected
            return {
              godown: null,
              lines: [], // This will clear mainLines in Step 2
            };
          }
          try {
            // Option 1: Fetch SINGLE requisition by ID (more efficient than fetching all)
            const response = await axios.get(
              `/api/material/requisition/${value}`,
            );
            const reqMaster = response.data; // Assume API returns single object
            const reqDetails = reqMaster.details || []; // Nested details; adjust if flat

            if (!reqMaster)
              return { error: "Requisition not found", lines: [] };

            // Map to lines: Only include items from this requisition
            // Fetch fulfillment progress to exclude already-transferred items
            let remainingByItcd = {};
            try {
              const progressRes = await axios.get(
                `/api/orders/fulfillment-progress?type=requisition&id=${value}`,
              );
              for (const item of progressRes.data?.items || []) {
                remainingByItcd[item.itcd] = item.remainingQty;
              }
            } catch {
              // Non-critical: fall back to full qty if progress fetch fails
            }

            const lines = reqDetails
              .filter((detail) => {
                // Skip items where nothing remains to be transferred
                const remaining = remainingByItcd[detail.itcd];
                if (remaining !== undefined && remaining <= 0) return false;
                return true;
              })
              .map((detail) => {
                // Use remaining qty (if known) instead of full requisition qty
                const remaining = remainingByItcd[detail.itcd];
                const qtyToUse =
                  remaining !== undefined ? remaining : detail.qty;
                const itemObj = detail.item;

                return {
                  itcd: {
                    value: itemObj?.itcd,
                    label: itemObj?.item,
                  },
                  qty: qtyToUse,
                  no_of_pack: 1,
                  qty_per_pack: qtyToUse,
                  rate: 0,
                  original_qty: detail.qty,
                  // Store remaining so the form can show "X of Y remaining"
                  req_qty: detail.qty,
                };
              });

            return {
              godown: {
                value: reqMaster.godownDetails?.id,
                label: reqMaster.godownDetails?.godown,
              },
              godown2: {
                value: reqMaster.godown2Details?.id,
                label: reqMaster.godown2Details?.godown,
              },
              lines: lines,
            };
          } catch (error) {
            console.error("Error fetching requisition details:", error);
            toast.error("Failed to load requisition details");
            return { lines: [] }; // Clear on error
          }
        },
      },

      {
        name: "godown",
        label: "From Warehouse",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        nameKeys: ["id", "godown"],
        valueKey: "id",
        required: true,
      },
      {
        name: "godown2",
        label: "To Warehouse",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        nameKeys: ["id", "godown"],
        valueKey: "id",
        required: true,
        validate: (value, masterData) => {
          if (value === masterData.godown.value) {
            return "Godowns from and to cannot be the same";
          }
          return null;
        },
      },
      { name: "rmk", label: "Narration", type: "textarea" },
    ],
    lineFields: [
      {
        name: "itcd",
        label: "Product",
        type: "select",
        options: "products",
        apiEndpoint: "/api/setup/items",
        nameKeys: ["code", "item"],
        valueKey: "itcd",
        required: true,
      },
      { name: "no_of_pack", label: "No of Packs", type: "number" },
      { name: "qty_per_pack", label: "Qty Per Pack", type: "number" },
      //createTransferQtyField(), 
      // âœ… Uses both requisition balance and stock check
      {
        name: "qty",
        label: "Quantity",
        type: "number",
        required: true,
        dependencies: ["no_of_pack", "qty_per_pack"],
        calculate: (v) => (v.no_of_pack || 0) * (v.qty_per_pack || 0),
        validate: async (value, line, allLines, formData) => {
          const total = (line.no_of_pack || 0) * (line.qty_per_pack || 0);
          if (value !== total) return `Quantity should be ${total}`;
          // From godown stock (Dispatch-style error) + requisition balance
          const error = await godownTransferStock.validate(value, line, allLines, formData);
          // Stock error: name the From godown (id - name) it is short in.
          if (error?.__varianceModal__ && error.isAvailabilityError) {
            const g = formData?.godown;
            const id = g?.value ?? g;
            const label = g?.label ? String(g.label) : "";
            const godownText = label.startsWith(String(id)) ? label : [id, label].filter(Boolean).join(" - ");
            return {
              ...error,
              message: `Insufficient stock in godown ${godownText} — you cannot transfer from this godown. ${error.message}`,
            };
          }
          return error;
        },
      },
      { name: "narration1", label: "Narration", type: "textarea" },
    ],
    totals: {
      totalQty: {
        label: "Total Quantity",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
      },
    },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "tran_id", label: " Requisition #", type: "text" },
      {
        name: "godown",
        label: "From Warehouse",
        type: "text",
        options: true,
        value1: "godownDetails",
        value2: "godown",
      },
      {
        name: "godown2",
        label: "To Warehouse",
        type: "text",
        options: true,
        value1: "godown2Details",
        value2: "godown",
      },
      {
        name: "qty",
        label: "Qty",
        type: "text",
        isInnerTotal: true,
        key: "transactions",
      },

      // { name: "status", label: "Status", type: "status" },
    ],
    allowDelete: false,
    allowPrint: true,
    allowCreate: false,
    allowEdit: true,
    allowView: true,
    allowCheck: false,
  },
  transferEdit: {
    ModalHeading: "Edit Material Transfer",
    ModalHeadingEdit: "Edit Material Transfer",
    tran_code: 11,
    hasDeductionBlock: false,
    // differApi: "/api/material/requisition?category=TRANSFER",
    // differTitle: "Transfer Requisitions",
    // âœ… REQUISITION â†’ PURCHASE ORDER mapping
    sourceMapping: {
      type: "requisition",
      sourceApi: "/api/material/requisition?category=TRANSFER",
      fieldMappings: {
        master: [
          {
            source: "tran_id",
            target: "req_no",
            transform: (value) => value,
          },
          {
            source: "issued_for",
            target: "godown",
            transform: (value) => value,
          },
          {
            source: "userid",
            target: "user_id",
            transform: (value) => value,
          },

          {
            source: "issued_by",
            target: "godown2",
            transform: (value, master) => ({
              value: master.godown2Details?.id,
              label: master.godown2Details?.godown,
            }),
          },

          // {
          //   source: "dated",
          //   target: "dated",
          //   transform: (value) => new Date(value).toLocaleDateString() // Direct mapping
          // }
        ],
        lines: [
          {
            source: "itcd",
            target: "itcd",
            transform: (value) => value,
          },
          {
            source: "qty",
            target: "qty",
            transform: (value) => value || 0,
          },
          {
            source: "qty",
            target: "req_qty",
            transform: (value) => value || 0,
          },
          {
            source: "qty",
            target: "qty_per_pack",
            transform: (value) => value || 0,
          },
          {
            source: null,
            target: "no_of_pack",
            transform: () => 1,
          },
          {
            source: null,
            target: "rate",
            transform: () => 0,
          },
          {
            source: null,
            target: "original_qty",
            transform: (value, detail) => detail.qty,
          },
        ],
      },
    },
    masterFields: [
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },

      {
        name: "req_no",
        label: "Material Requisition No",
        type: "select",
        options: "requisitions",
        apiEndpoint: `/api/material/requisition?category=TRANSFER`,
        nameKey: "tran_id",
        valueKey: "tran_id",
        onChange: async (value, formData) => {
          if (!value) {
            // Clear lines and godown if no requisition selected
            return {
              godown: null,
              lines: [], // This will clear mainLines in Step 2
            };
          }
          try {
            // Option 1: Fetch SINGLE requisition by ID (more efficient than fetching all)
            const response = await axios.get(
              `/api/material/requisition/${value}`,
            );
            const reqMaster = response.data; // Assume API returns single object
            const reqDetails = reqMaster.details || []; // Nested details; adjust if flat

            if (!reqMaster)
              return { error: "Requisition not found", lines: [] };

            // Map to lines: Only include items from this requisition
            // Fetch fulfillment progress to exclude already-transferred items
            let remainingByItcd = {};
            try {
              const progressRes = await axios.get(
                `/api/orders/fulfillment-progress?type=requisition&id=${value}`,
              );
              for (const item of progressRes.data?.items || []) {
                remainingByItcd[item.itcd] = item.remainingQty;
              }
            } catch {
              // Non-critical: fall back to full qty if progress fetch fails
            }

            const lines = reqDetails
              .filter((detail) => {
                // Skip items where nothing remains to be transferred
                const remaining = remainingByItcd[detail.itcd];
                if (remaining !== undefined && remaining <= 0) return false;
                return true;
              })
              .map((detail) => {
                // Use remaining qty (if known) instead of full requisition qty
                const remaining = remainingByItcd[detail.itcd];
                const qtyToUse =
                  remaining !== undefined ? remaining : detail.qty;
                const itemObj = detail.item;

                return {
                  itcd: {
                    value: itemObj?.itcd,
                    label: itemObj?.item,
                  },
                  qty: qtyToUse,
                  no_of_pack: 1,
                  qty_per_pack: qtyToUse,
                  rate: 0,
                  original_qty: detail.qty,
                  // Store remaining so the form can show "X of Y remaining"
                  req_qty: detail.qty,
                };
              });

            return {
              godown: {
                value: reqMaster.godownDetails?.id,
                label: reqMaster.godownDetails?.godown,
              },
              godown2: {
                value: reqMaster.godown2Details?.id,
                label: reqMaster.godown2Details?.godown,
              },
              lines: lines,
            };
          } catch (error) {
            console.error("Error fetching requisition details:", error);
            toast.error("Failed to load requisition details");
            return { lines: [] }; // Clear on error
          }
        },
      },

      {
        name: "godown",
        label: "From Warehouse",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        nameKey: "godown",
        valueKey: "id",
        required: true,
      },
      {
        name: "godown2",
        label: "To Warehouse",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        nameKey: "godown",
        valueKey: "id",
        required: true,
        validate: (value, masterData) => {
          if (value === masterData.godown.value) {
            return "Godowns from and to cannot be the same";
          }
          return null;
        },
      },
      { name: "rmk", label: "Narration", type: "textarea" },
    ],
    lineFields: [
      {
        name: "itcd",
        label: "Product",
        type: "select",
        options: "products",
        apiEndpoint: "/api/setup/items",
        nameKeys: ["code", "item"],
        valueKey: "itcd",
        required: true,
      },
      { name: "no_of_pack", label: "No of Packs", type: "number" },
      { name: "qty_per_pack", label: "Qty Per Pack", type: "number" },
      //createTransferQtyField(), // âœ… Uses both requisition balance and stock check
      {
        name: "qty",
        label: "Quantity",
        type: "number",
        required: true,
        dependencies: ["no_of_pack", "qty_per_pack"],
        calculate: (v) => (v.no_of_pack || 0) * (v.qty_per_pack || 0),
        validate: (value, line) => {
          const total = (line.no_of_pack || 0) * (line.qty_per_pack || 0);
          if (value !== total) return `Quantity should be ${total}`;
          return null;
        },
      },
    ],
    totals: {
      totalQty: {
        label: "Total Quantity",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
      },
    },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "tran_id", label: " Requisition #", type: "text" },
      {
        name: "godown",
        label: "From Warehouse",
        type: "text",
        options: true,
        value1: "godownDetails",
        value2: "godown",
      },
      {
        name: "godown2",
        label: "To Warehouse",
        type: "text",
        options: true,
        value1: "godown2Details",
        value2: "godown",
      },
      {
        name: "qty",
        label: "Qty",
        type: "text",
        isInnerTotal: true,
        key: "transactions",
      },
    ],
    allowDelete: false,
    allowPrint: true,
    allowCreate: true,
    allowEdit: true,
    owView: true,
    trueowCheck: false,
  },

  purchaseOrder: {
    buttonText: "Create Purchase Order",
    ModalHeading: "Create Purchase Order",
    ModalHeadingEdit: "Edit Purchase Order",
    tran_code: 400,
    hasDeductionBlock: false,
    // âœ… PREVIEW NUMBER CONFIG (purchase orders use a DB sequence, no region)
    previewNumber: {
      fieldName: "order_no",
      api: "/api/orders/next-order-no",
      category: 4,
      dependsOn: null,  // no dependency â€” purchase order number doesn't change with any field
      regionParam: null,
    },
    differApi: "/api/material/requisition?category=PURCHASE",
    differTitle: "Purchase Requisitions",
    // âœ… REQUISITION â†’ PURCHASE ORDER mapping
    sourceMapping: {
      type: "requisition",
      sourceApi: "/api/material/requisition?category=PURCHASE",
      fieldMappings: {
        master: [
          {
            source: "tran_id",
            target: "req_no",
            transform: (value) => value,
          },
          {
            source: "dated",
            target: "dated",
            transform: () => new Date().toISOString().split("T")[0], // Set to current date
          },

          {
            source: "dated",
            target: "due_date",
            transform: () => {
              const date = new Date();
              date.setDate(date.getDate() + 15); // Add 15 days
              return date.toISOString().split("T")[0];
            },
          },

          {
            source: "issued_by",
            target: "godown",
            transform: (value) => value,
          },
          // {
          //   source: "dated",
          //   target: "dated",
          //   transform: (value) => new Date(value).toLocaleDateString() // Direct mapping
          // }
        ],
        lines: [
          {
            source: "itcd", // From requisition details
            target: "itcd",
            transform: (value) => value,
          },
          {
            source: "qty", // Approved quantity from requisition
            target: "qty",
            transform: (value) => value || 0,
          },
          {
            source: "qty",
            target: "qty_per_pack",
            transform: (value) => value || 0,
          },
          {
            source: null, // Default value
            target: "no_of_packs",
            transform: () => 1,
          },
          {
            source: null, // Default value
            target: "rate",
            transform: () => 0,
          },
          {
            source: null, // For validation reference
            target: "original_qty",
            transform: (value, detail) => detail.ap_qty || detail.qty,
          },
        ],
      },
    },

    masterFields: [
      {
        name: "order_no",
        label: "Order No",
        type: "text",
        readOnly: true,        // display only â€” DB trigger sets the real value
        previewField: true,    // flag used by Form.jsx to identify this as a preview field
      },
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },
      {
        name: "party_code",
        label: "Supplier",
        type: "select",
        options: "masterAccounts",
        apiEndpoint: `/api/accounts/acno?${VENDOR_GROUP_PARAM}`, // Suppliers
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        required: true,
        // modalFields: [
        // {
        // name: "acname",
        // label: "Supplier Name",
        // type: "text",
        // required: true,
        // },
        // {
        // name: "macno",
        // label: "Main Account",
        // type: "select",
        // options: "mainAccounts",
        // apiEndpoint: "/api/accounts/macno",
        // valueKey: "macno",
        // nameKey: "macname",
        // required: true,
        // },
        // ],
      },
      {
        name: "req_no",
        label: "Material Requisition No",
        type: "select",
        options: "requisitions",
        apiEndpoint: `/api/material/requisition?category=PURCHASE`,
        nameKey: "tran_id",
        valueKey: "tran_id",
        onChange: async (value, formData) => {
          if (!value) {
            // Clear lines and godown if no requisition selected
            return {
              godown: null,
              lines: [], // This will clear mainLines in Step 2
            };
          }
          try {
            // Option 1: Fetch SINGLE requisition by ID (more efficient than fetching all)
            const response = await axios.get(
              `/api/material/requisition/${value}`,
            );
            const reqMaster = response.data; // Assume API returns single object
            const reqDetails = reqMaster.details || []; // Nested details; adjust if flat

            if (!reqMaster)
              return { error: "Requisition not found", lines: [] };

            // Map to lines: Only include items from this requisition
            const lines = reqDetails.map((detail) => {
              const qtyToUse = detail.ap_qty || detail.qty; // Prefer approved qty
              return {
                itcd: {
                  value: detail.itcd,
                  label: detail.item_name || detail.item, // Assume API includes item_name; fallback to itcd
                },
                qty: qtyToUse, // Pre-fill qty (user can edit if needed)
                no_of_packs: 1,
                qty_per_pack: qtyToUse,
                rate: 0, // Default; user fills later
                original_qty: qtyToUse, // For any future validation
              };
            });

            return {
              godown: {
                value: reqMaster.issued_for || formData.godown?.value,
                label: reqMaster.godown_name || formData.godown?.label, // Assume API has godown_name
              },
              lines: lines, // This will populate mainLines in Step 2
            };
          } catch (error) {
            console.error("Error fetching requisition details:", error);
            toast.error("Failed to load requisition details");
            return { lines: [] }; // Clear on error
          }
        },
      },
      //  {
      //   name: "req_no",
      //   label: "Material Requisition No",
      //   type: "select",
      //   options: "requisitions",
      //   apiEndpoint: (formData) => "/api/material/requisition?category=PURCHASE",
      //   nameKey: "tran_id",
      //   valueKey: "tran_id",
      //   onChange: async (value, formData, config) => {
      //     if (!value) {
      //       return {
      //         godown: null,
      //         lines: []
      //       };
      //     }

      //     try {
      //       // Fetch requisition data
      //       const response = await axios.get(`/api/material/requisition/${value}`);
      //       const requisition = response.data;

      //       if (!requisition) {
      //         throw new Error("Requisition not found");
      //       }

      //       // Apply dynamic mapping
      //       const mappedData = mapSourceToForm(requisition, config.sourceMapping);

      //       return mappedData;
      //     } catch (error) {
      //       console.error("Error fetching requisition:", error);
      //       throw error;
      //     }
      //   },
      // },

      {
        name: "godown",
        label: "Godown",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKey: "godown",
        valueKey: "id",
        required: true,
      },
      {
        name: "due_date",
        label: "Due Date",
        type: "date",
        required: true,
      },
      {
        name: "freeOfCost",
        label: "Free of Cost",
        type: "checkbox",
        // No default value; handled in form
      },
      {
        name: "delivery_terms",
        label: "Delivery Terms",
        type: "text",
      },
      {
        name: "payment_terms",
        label: "Payment Terms",
        type: "text",
      },
      {
        name: "delivery_location",
        label: "Delivery Location",
        type: "textarea",
      },
      {
        name: "additional_instructions",
        label: "Instructions",
        type: "textarea",
      },
      // {
      //   name: "status",
      //   label: "Status",
      //   type: "select",
      //   options: "orderStatus",
      //   apiEndpoint: "/api/setup/order-status",
      //   valueKey: "id",
      //   nameKey: "status",
      //   required: true,
      // },
    ],
    lineFields: [
      {
        name: "itcd",
        label: "Product",
        type: "select",
        options: "products",
        apiEndpoint: "/api/setup/items",
        createEndpoint: "/api/setup/items",
        nameKey: "item",
        valueKey: "itcd",
        required: true,
        // modalFields: [
        // { name: "item", label: "Product Name", type: "text", required: true },
        // {
        // name: "ic_id",
        // label: "Item Category",
        // type: "select",
        // options: "itemCategories",
        // apiEndpoint: "/api/setup/item_categories",
        // valueKey: "id",
        // nameKey: "ic_name",
        // required: true,
        // },
        // ],
      },
      {
        name: "no_of_packs",
        label: "No of Packs",
        type: "number",
        required: true,
      },
      {
        name: "qty_per_pack",
        label: "Qty Per Pack",
        type: "number",
        required: true,
      },
      createOrderPSQtyField(), // Basic calculation validation only

      { name: "unit", label: "Unit", type: "text" },
      { name: "rate", label: "Rate", type: "number", required: true },
      {
        name: "amount",
        label: "Amount",
        type: "number",
        dependencies: ["qty", "rate"],
        calculate: (v) => v.qty * v.rate,
      },
    ],
    totals: {
      totalQty: {
        label: "Total Quantity",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
      },
      totalAmount: {
        label: "Total Amount",
        calculate: (lines) =>
          lines.reduce((sum, l) => sum + (l.amount || 0), 0),
      },
    },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "tran_id", label: "Req No", type: "text" },
      // {
      //   name: "party_code",
      //   label: "Supplier",
      //   type: "text",
      //   options: true,
      //   value1: "acno",
      //   value2: "acname",
      // },
      {
        name: "issued_by",
        label: "Godown",
        type: "text",
        options: true,
        value1: "godown2Details",
        value2: "godown",
      },
      {
        name: "qty",
        label: "Total Qty",
        type: "text",
        isInnerTotal: true,
        key: "details",
      },

      // {
      //   name: "ap_qty",
      //   label: "Approved Qty",
      //   type: "text",
      //   isInnerTotal: true,
      //   key: "details",
      // },
      { name: "status", label: "Status", type: "status" },
    ],
    allowDelete: false,
    allowPrint: false,
    allowCreate: true,
    allowEdit: false,
    allowView: false,
    allowCheck: false,
  },
  purchaseOrderEdit: {
    buttonText: "Create Purchase Order",
    ModalHeading: "Create Purchase Order",
    ModalHeadingEdit: "Edit Purchase Order",
    tran_code: 400,
    hasDeductionBlock: false,
    // differApi: "/api/material/requisition?category=PURCHASE",
    // differTitle: "Purchase Requisitions",
    // // âœ… REQUISITION â†’ PURCHASE ORDER mapping
    // sourceMapping: {
    //   type: "requisition",
    //   sourceApi: "/api/material/requisition?category=PURCHASE",
    //   fieldMappings: {
    //     master: [
    //       {
    //         source: "tran_id",
    //         target: "req_no",
    //         transform: (value) => value,
    //       },
    //       {
    //         source: "dated",
    //         target: "dated",
    //         transform: () => new Date().toISOString().split("T")[0], // Set to current date
    //       },

    //       {
    //         source: "dated",
    //         target: "due_date",
    //         transform: () => {
    //           const date = new Date();
    //           date.setDate(date.getDate() + 15); // Add 15 days
    //           return date.toISOString().split("T")[0];
    //         },
    //       },

    //       {
    //         source: "issued_by",
    //         target: "godown",
    //         transform: (value) => value,
    //       },
    //       // {
    //       //   source: "dated",
    //       //   target: "dated",
    //       //   transform: (value) => new Date(value).toLocaleDateString() // Direct mapping
    //       // }
    //     ],
    //     lines: [
    //       {
    //         source: "itcd", // From requisition details
    //         target: "itcd",
    //         transform: (value) => value,
    //       },
    //       {
    //         source: "qty", // Approved quantity from requisition
    //         target: "qty",
    //         transform: (value) => value || 0,
    //       },
    //       {
    //         source: "qty",
    //         target: "qty_per_pack",
    //         transform: (value) => value || 0,
    //       },
    //       {
    //         source: null, // Default value
    //         target: "no_of_packs",
    //         transform: () => 1,
    //       },
    //       {
    //         source: null, // Default value
    //         target: "rate",
    //         transform: () => 0,
    //       },
    //       {
    //         source: null, // For validation reference
    //         target: "original_qty",
    //         transform: (value, detail) => detail.ap_qty || detail.qty,
    //       },
    //     ],
    //   },
    // },

    masterFields: [
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },
      {
        name: "party_code",
        label: "Supplier",
        type: "select",
        options: "masterAccounts",
        apiEndpoint: `/api/accounts/acno?${VENDOR_GROUP_PARAM}`, // Suppliers
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        required: true,
        // modalFields: [
        // {
        // name: "acname",
        // label: "Supplier Name",
        // type: "text",
        // required: true,
        // },
        // {
        // name: "macno",
        // label: "Main Account",
        // type: "select",
        // options: "mainAccounts",
        // apiEndpoint: "/api/accounts/macno",
        // valueKey: "macno",
        // nameKey: "macname",
        // required: true,
        // },
        // ],
      },
      {
        name: "req_no",
        label: "Material Requisition No",
        type: "select",
        options: "requisitions",
        apiEndpoint: `/api/material/requisition?category=PURCHASE`,
        nameKey: "tran_id",
        valueKey: "tran_id",
        onChange: async (value, formData) => {
          if (!value) {
            // Clear lines and godown if no requisition selected
            return {
              godown: null,
              lines: [], // This will clear mainLines in Step 2
            };
          }
          try {
            // Option 1: Fetch SINGLE requisition by ID (more efficient than fetching all)
            const response = await axios.get(
              `/api/material/requisition/${value}`,
            );
            const reqMaster = response.data; // Assume API returns single object
            const reqDetails = reqMaster.details || []; // Nested details; adjust if flat

            if (!reqMaster)
              return { error: "Requisition not found", lines: [] };

            // Map to lines: Only include items from this requisition
            const lines = reqDetails.map((detail) => {
              const qtyToUse = detail.ap_qty || detail.qty; // Prefer approved qty
              return {
                itcd: {
                  value: detail.itcd,
                  label: detail.item_name || detail.item, // Assume API includes item_name; fallback to itcd
                },
                qty: qtyToUse, // Pre-fill qty (user can edit if needed)
                no_of_packs: 1,
                qty_per_pack: qtyToUse,
                rate: 0, // Default; user fills later
                original_qty: qtyToUse, // For any future validation
              };
            });

            return {
              godown: {
                value: reqMaster.issued_for || formData.godown?.value,
                label: reqMaster.godown_name || formData.godown?.label, // Assume API has godown_name
              },
              lines: lines, // This will populate mainLines in Step 2
            };
          } catch (error) {
            console.error("Error fetching requisition details:", error);
            toast.error("Failed to load requisition details");
            return { lines: [] }; // Clear on error
          }
        },
      },
      //  {
      //   name: "req_no",
      //   label: "Material Requisition No",
      //   type: "select",
      //   options: "requisitions",
      //   apiEndpoint: (formData) => "/api/material/requisition?category=PURCHASE",
      //   nameKey: "tran_id",
      //   valueKey: "tran_id",
      //   onChange: async (value, formData, config) => {
      //     if (!value) {
      //       return {
      //         godown: null,
      //         lines: []
      //       };
      //     }

      //     try {
      //       // Fetch requisition data
      //       const response = await axios.get(`/api/material/requisition/${value}`);
      //       const requisition = response.data;

      //       if (!requisition) {
      //         throw new Error("Requisition not found");
      //       }

      //       // Apply dynamic mapping
      //       const mappedData = mapSourceToForm(requisition, config.sourceMapping);

      //       return mappedData;
      //     } catch (error) {
      //       console.error("Error fetching requisition:", error);
      //       throw error;
      //     }
      //   },
      // },

      {
        name: "godown",
        label: "Godown",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKey: "godown",
        valueKey: "id",
        required: true,
      },
      {
        name: "due_date",
        label: "Due Date",
        type: "date",
        required: true,
      },
      {
        name: "freeOfCost",
        label: "Free of Cost",
        type: "checkbox",
        // No default value; handled in form
      },
      {
        name: "delivery_terms",
        label: "Delivery Terms",
        type: "text",
      },
      {
        name: "payment_terms",
        label: "Payment Terms",
        type: "text",
      },
      {
        name: "delivery_location",
        label: "Delivery Location",
        type: "textarea",
      },
      {
        name: "additional_instructions",
        label: "Instructions",
        type: "textarea",
      },
      // {
      //   name: "status",
      //   label: "Status",
      //   type: "select",
      //   options: "orderStatus",
      //   apiEndpoint: "/api/setup/order-status",
      //   valueKey: "id",
      //   nameKey: "status",
      //   required: true,
      // },
    ],
    lineFields: [
      {
        name: "itcd",
        label: "Product",
        type: "select",
        options: "products",
        apiEndpoint: "/api/setup/items",
        createEndpoint: "/api/setup/items",
        nameKey: "item",
        valueKey: "itcd",
        required: true,
        // modalFields: [
        // { name: "item", label: "Product Name", type: "text", required: true },
        // {
        // name: "ic_id",
        // label: "Item Category",
        // type: "select",
        // options: "itemCategories",
        // apiEndpoint: "/api/setup/item_categories",
        // valueKey: "id",
        // nameKey: "ic_name",
        // required: true,
        // },
        // ],
      },
      {
        name: "no_of_packs",
        label: "No of Packs",
        type: "number",
        required: true,
      },
      {
        name: "qty_per_pack",
        label: "Qty Per Pack",
        type: "number",
        required: true,
      },
      createOrderPSQtyField(), // Basic calculation validation only

      { name: "unit", label: "Unit", type: "text" },
      { name: "rate", label: "Rate", type: "number", required: true },
      {
        name: "amount",
        label: "Amount",
        type: "number",
        dependencies: ["qty", "rate"],
        calculate: (v) => v.qty * v.rate,
      },
    ],
    totals: {
      totalQty: {
        label: "Total Quantity",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
      },
      totalAmount: {
        label: "Total Amount",
        calculate: (lines) =>
          lines.reduce((sum, l) => sum + (l.amount || 0), 0),
      },
    },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      // { name: "order_no", label: "Order No", type: "text" },
      // {
      //   name: "party_code",
      //   label: "Supplier",
      //   type: "text",
      //   options: true,
      //   value1: "acno",
      //   value2: "acname",
      // },
      {
        name: "party_code",
        label: "Supplier",
        type: "text",
        options: true,
        value1: "acno",
        value2: "acname",
      },
      {
        name: "qty",
        label: "Total Qty",
        type: "text",
        isInnerTotal: true,
        key: "orderDetails",
      },

      // {
      //   name: "ap_qty",
      //   label: "Approved Qty",
      //   type: "text",
      //   isInnerTotal: true,
      //   key: "details",
      // },
      // { name: "status", label: "Status", type: "status" },
    ],
    allowDelete: false,
    allowPrint: false,
    allowCreate: false,
    allowEdit: true,
    allowView: false,
    allowCheck: false,
  },
  serviceOrder: {
    buttonText: "Create Service Order",
    ModalHeading: "Create Service Order",
    ModalHeadingEdit: "Edit Service Order",
    tran_code: 500,
    hasDeductionBlock: false,
    differApi: "/api/orders/serviceOrder",
    sourceMapping: {
      type: "requisition",
      sourceApi: "/api/material/requisition?category=SERVICE",
      fieldMappings: {
        master: [
          {
            source: "tran_id",
            target: "req_no",
            transform: (value) => value,
          },
          {
            source: "issued_for",
            target: "godown",
            transform: (value) => value,
          },
          {
            source: "issued_by",
            target: "godown2",
            transform: (value) => value,
          },
          {
            source: "dated",
            target: "dated",
            transform: (value) => new Date(value),
          },
        ],
        lines: [
          {
            source: "s_id",
            target: "service_id",
            transform: (value) => value || null,
          },
          {
            source: "itcd",
            target: "itcd",
            transform: (value) => value || null,
          },
          {
            source: "qty",
            target: "qty",
            transform: (value) => value || 0,
          },
          {
            source: null,
            target: "original_qty",
            transform: (value, detail) => detail.qty,
          },
          {
            source: null,
            target: "no_of_packs",
            transform: () => 1,
          },
          {
            source: null,
            target: "qty_per_pack",
            transform: (value, detail) => detail.qty || 0,
          },
          {
            source: null,
            target: "rate",
            transform: () => 0,
          },
        ],
      },
    },

    masterFields: [
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },
      {
        name: "party_code",
        label: "Supplier",
        type: "select",
        options: "masterAccounts",
        apiEndpoint: `/api/accounts/acno?${VENDOR_GROUP_PARAM}`,
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        required: true,
        // modalFields: [
        // {
        // name: "acname",
        // label: "Supplier Name",
        // type: "text",
        // required: true,
        // },
        // {
        // name: "macno",
        // label: "Main Account",
        // type: "select",
        // options: "mainAccounts",
        // apiEndpoint: "/api/accounts/macno",
        // valueKey: "macno",
        // nameKey: "macname",
        // required: true,
        // },
        // ],
      },
      {
        name: "req_no",
        label: "Material Requisition No",
        type: "select",
        options: "requisitions",
        apiEndpoint: `/api/material/requisition?category=SERVICE`,
        nameKey: "tran_id",
        valueKey: "tran_id",
        onChange: async (value, formData) => {
          if (!value) {
            // Clear lines and godown if no requisition selected
            return {
              godown: null,
              lines: [], // This will clear mainLines in Step 2
            };
          }
          try {
            // Option 1: Fetch SINGLE requisition by ID (more efficient than fetching all)
            const response = await axios.get(
              `/api/material/requisition/${value}`,
            );
            const reqMaster = response.data; // Assume API returns single object
            const reqDetails = reqMaster.details || []; // Nested details; adjust if flat

            if (!reqMaster)
              return { error: "Requisition not found", lines: [] };

            // Map to lines: Only include items from this requisition
            const lines = reqDetails.map((detail) => {
              const qtyToUse = detail.ap_qty || detail.qty; // Prefer approved qty
              return {
                itcd: {
                  value: detail.itcd,
                  label: detail.item_name || detail.item, // Assume API includes item_name; fallback to itcd
                },
                qty: qtyToUse, // Pre-fill qty (user can edit if needed)
                no_of_packs: 1,
                qty_per_pack: qtyToUse,
                rate: 0, // Default; user fills later
                original_qty: qtyToUse, // For any future validation
              };
            });

            return {
              godown: {
                value: reqMaster.issued_for || formData.godown?.value,
                label: reqMaster.godown_name || formData.godown?.label, // Assume API has godown_name
              },
              lines: lines, // This will populate mainLines in Step 2
            };
          } catch (error) {
            console.error("Error fetching requisition details:", error);
            toast.error("Failed to load requisition details");
            return { lines: [] }; // Clear on error
          }
        },
      },
      {
        name: "godown",
        label: "Godown",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKey: "godown",
        valueKey: "id",
        required: true,
      },
      {
        name: "due_date",
        label: "Due Date",
        type: "date",
        required: true,
      },
      {
        name: "freeOfCost",
        label: "Free of Cost",
        type: "checkbox",
        // No default value; handled in form
      },
      {
        name: "delivery_terms",
        label: "Delivery Terms",
        type: "text",
      },
      {
        name: "payment_terms",
        label: "Payment Terms",
        type: "text",
      },
      {
        name: "delivery_location",
        label: "Delivery Location",
        type: "textarea",
      },
      {
        name: "additional_instructions",
        label: "Instructions",
        type: "textarea",
      },
    ],
    lineFields: [
      {
        name: "service_id",
        label: "Service",
        type: "select",
        options: "services",
        apiEndpoint: "/api/setup/services",
        createEndpoint: "/api/setup/services",
        nameKey: "service_name",
        valueKey: "id",
        required: true,
        // modalFields: [
        //   { name: "service_name", label: "Service Name", type: "text", required: true },
        //   {
        //     name: "sc_id",
        //     label: "Service Category",
        //     type: "select",
        //     options: "serviceCategories",
        //     apiEndpoint: "/api/setup/item_categories",
        //     valueKey: "id",
        //     nameKey: "ic_name",
        //     required: true,
        //   },
        // ],
      },
      {
        name: "no_of_packs",
        label: "No of Packs",
        type: "number",
        required: true,
      },
      {
        name: "qty_per_pack",
        label: "Qty Per Pack",
        type: "number",
        required: true,
      },
      createOrderPSQtyField(), // Basic calculation validation only

      { name: "unit", label: "Unit", type: "text" },
      { name: "rate", label: "Rate", type: "number", required: true },
      {
        name: "amount",
        label: "Amount",
        type: "number",
        dependencies: ["qty", "rate"],
        calculate: (v) => v.qty * v.rate,
      },
    ],
    totals: {
      totalQty: {
        label: "Total Quantity",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
      },
      totalAmount: {
        label: "Total Amount",
        calculate: (lines) =>
          lines.reduce((sum, l) => sum + (l.amount || 0), 0),
      },
    },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "req_no", label: "Req No", type: "text" },
      {
        name: "party_code",
        label: "Supplier",
        type: "text",
        options: true,
        value1: "acno",
        value2: "acname",
      },
      {
        name: "issued_by",
        label: "Godown",
        type: "text",
        options: true,
        value1: "godown2Details",
        value2: "godown",
      },
      {
        name: "qty",
        label: "Total Qty",
        type: "text",
        isInnerTotal: true,
        key: "details",
      },
      // {
      //   name: "ap_qty",
      //   label: "Approved Qty",
      //   type: "text",
      //   isInnerTotal: true,
      //   key: "details",
      // },
      { name: "status", label: "Status", type: "text" },
    ],
    allowDelete: false,
    allowPrint: true,
    allowEdit: true,
    allowView: true,
    allowCheck: false,
  },
  saleOrder: {
    buttonText: "Create Sale Order",
    ModalHeading: "Create Sale Order",
    ModalHeadingEdit: "Edit Sale Order",
    tran_code: 600,
    hasDeductionBlock: false,
    // âœ… PREVIEW NUMBER CONFIG
    // Fetches last_no+1 from order_region_sequences for display only.
    // Does NOT consume the sequence â€” the DB trigger does that on INSERT.
    previewNumber: {
      fieldName: "order_no",     // which masterData field to populate with the preview
      api: "/api/orders/next-order-no", // endpoint to call
      category: 6,               // category param for the API
      dependsOn: "region",       // re-fetch when this master field changes
      regionParam: "region",     // master field whose value is sent as `region=` query param
    },
    // differApi: "/api/orders/saleOrder",
    // differTitle: "Sale Order",
    // âœ… ADD THIS: Source mapping for auto-population
    // sourceMapping: {
    //   type: "saleOrder",
    //   sourceApi: "/api/orders/saleOrder",
    //   fieldMappings: {
    //     master: [
    //       {
    //         source: "dated",
    //         target: "dated",
    //         transform: (value) => new Date(value),
    //       },
    //       {
    //         source: "due_date",
    //         target: "due_date",
    //         transform: (value) => new Date(value),
    //       },
    //       {
    //         source: "order_no",
    //         target: "order_no",
    //         transform: (value) => value,
    //       },
    //       {
    //         source: "party_code",
    //         target: "party_code",
    //         transform: (value) => value,
    //       },
    //       {
    //         source: "acno",
    //         target: "acno",
    //         transform: (value) => value,
    //       },
    //       {
    //         source: "godown",
    //         target: "godown",
    //         transform: (value) => value,
    //       },
    //       {
    //         source: "region",
    //         target: "region",
    //         transform: (value) => value,
    //       },
    //     ],
    //     lines: [
    //       {
    //         source: "dated",
    //         target: "dated",
    //         transform: (value) => new Date(value),
    //       },
    //       {
    //         source: "due_date",
    //         target: "due_date",
    //         transform: (value) => new Date(value),
    //       },
    //       {
    //         source: "payment_terms",
    //         target: "payment_terms",
    //         transform: (value) => value || "",
    //       },
    //       {
    //         source: "delivery_terms",
    //         target: "delivery_terms",
    //         transform: (value) => value || "",
    //       },

    //       {
    //         source: "region",
    //         target: "region",
    //         transform: (value) => value || "",
    //       },
    //       {
    //         source: "delivery_location",
    //         target: "delivery_location",
    //         transform: (value) => value || "",
    //       },

    //       {
    //         source: "itcd",
    //         target: "itcd",
    //         transform: (value) => value || null
    //       },

    //       {
    //         source: "qty",
    //         target: "qty",
    //         transform: (value) => value || 0,
    //       },
    //       {
    //         source: "no_of_packs",
    //         target: "no_of_packs",
    //         transform: (value) => value || 0,
    //       },
    //       {
    //         source: "qty_per_pack",
    //         target: "qty_per_pack",
    //         transform: (value) => value || 0,
    //       },
    //       {
    //         source: "rate",
    //         target: "rate",
    //         transform: (value) => value || 0,
    //       },
    //       {
    //         source: "amount",
    //         target: "amount",
    //         transform: (value) => value || 0,
    //       },
    //        {
    //         source: "itcd",
    //         target: "mm",
    //         transform: (value) => {value},
    //       },
    //     ],
    //   },
    // },
    masterFields: [
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },
      // Next ISO / Order No — filled by previewNumber (per region) on create;
      // display only, the DB trigger assigns the real order_no on INSERT.
      {
        name: "order_no",
        label: "Order No",
        type: "text",
        readOnly: true,
      },
      {
        name: "party_code",
        label: "Customer",
        type: "select",
        options: "customerAccounts",
        apiEndpoint: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`, // Customers
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        required: true,
        // Small Official / Unofficial book tag beside the label once a customer is picked
        labelBadge: (masterData) => masterData?.customer_book || "",
        onChange: async (value, formData) => {
          if (!value) return { customer_book: "" };

          try {
            // Fetch customer details including payment terms
            const response = await axios.get(
              `/api/forms/customers/details?acno=${value}`,
            );
            const customerData = response.data.customers;


            return {
              // Set payment terms from customer data
              payment_terms: `${customerData[0].crDays} Days` || "",
              delivery_location: customerData[0].address || "",
              due_date: (() => {
                const date = new Date();
                date.setDate(date.getDate() + (customerData[0].crDays || 0));
                return date.toISOString().split("T")[0];
              })(),
              region:
                customerData[0].subCategory === "N"
                  ? "NORTH"
                  : customerData[0].subCategory === "S"
                    ? "SOUTH"
                    : "NORTH",
                // Official / Unofficial badge beside the Customer label (Form.jsx
                // labelBadge): ACNO.isActive true → Official, else Unofficial.
                // Not saved — the order API picks its own fields.
                customer_book: customerData[0].isActive === false ? "Unofficial" : "Official",
              // delivery_terms: customerData.delivery_terms || "",
              // delivery_location: customerData.default_delivery_location || "",
              // Any other customer-specific defaults
            };
          } catch (error) {
            return {};
          }
        },
        // modalFields: [
        // {
        // name: "acname",
        // label: "Customer Name",
        // type: "text",
        // required: true,
        // },
        // {
        // name: "macno",
        // label: "Main Account",
        // type: "select",
        // options: "mainAccounts",
        // apiEndpoint: "/api/accounts/macno",
        // valueKey: "macno",
        // nameKey: "macname",
        // required: true,
        // },
        // ],
      },
      {
        name: "sale_po",
        label: "Purchase Order No",
        type: "text",
      },

      {
        name: "due_date",
        label: "Due Date",
        type: "date",
        required: true,
        // readOnly: true,
      },
      {
        name: "region",
        label: "Region",
        type: "normalSelect",
        options: [
          { value: "NORTH", label: "NORTH" },
          { value: "SOUTH", label: "SOUTH" },
        ],
        defaultValue: { value: "NORTH", label: "NORTH" },
        required: true,
      },
      {
        name: "delivery_terms",
        label: "Delivery Terms",
        type: "text",
      },
      {
        name: "payment_terms",
        label: "Payment Terms",
        type: "text",
        readOnly: true,
      },
      {
        name: "delivery_location",
        label: "Delivery Location",
        type: "textarea",
        readOnly: true,
      },
      {
        name: "additional_instructions",
        label: "Instructions",
        type: "textarea",
      },

      {
        name: "godown",
        label: "Godown",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKey: "godown",
        valueKey: "id",
        required: true,
        defaultValue: { value: "1", label: "FACTORY" },
        // "No Godown" sits at the top of the list; picking it saves the order
        // without a godown and sends it for approval.
        extraOptions: [NO_GODOWN_OPTION],
        onChange: async (value) => ({ noGodown: value === NO_GODOWN_OPTION.value }),
      },
      // Approval checkboxes — each one sends the order for approval (status 3).
      // Labels and behaviour: lib/orders/saleOrderApprovalRules.js
      ...soApprovalCheckboxes(),
      // {
      //   name: "status",
      //   label: "Status",
      //   type: "select",
      //   options: "orderStatus",
      //   apiEndpoint: "/api/setup/order-status",
      //   valueKey: "id",
      //   nameKey: "status",
      //   required: true,
      // },
    ],
    lineFields: [
      // {
      //   name: "mm", //
      //   label: "MM#",
      //   type: "text",
      //   readOnly: true,
      // },
      {
        name: "itcd",
        label: "Product",
        // showLineEdit: under the product, who last added / changed this
        // line's qty or rate and when (OrderDetail.edited_by / edited_at /
        // prev_qty / prev_rate, written by the order PUT) — read-only info.
        showLineEdit: true,
        type: "select",
        options: "products",
        minWidth: "450px",

        // UI LOCK
        disabled: (formData) => {
          const customerAcno =
            formData?.party_code?.value || formData?.party_code;
          return !customerAcno;
        },

        apiEndpoint: (formData, lineData) => {
          const customerAcno =
            formData?.party_code?.value || formData?.party_code;

          if (!customerAcno) return "/api/forms/products?includeAll=false";
          // Settings → Features "saleOrder.priceListOnly": the customer's ticked
          // price list on every order (Free of Cost / Trial included)
          if ((formData?.freeOfCost || formData?.trialProcess) && !featureNow("saleOrder.priceListOnly")) {
            return "/api/forms/products?includeAll=true";
          }

          return `/api/forms/products?customer=${customerAcno}`;
        },
        getPlaceholder: (formData) => {
          const customerAcno =
            formData.party_code?.value || formData.party_code;
          return customerAcno
            ? "Select product"
            : "Please select customer first";
        },
        createEndpoint: "/api/setup/items",
        nameKeys: ["code", "item"],
        separator: " - ",
        valueKey: "itcd",
        required: true,
        // Live stock of the item in godown 3 and godown 9, shown under the
        // Product (create + edit). Same rule as the Stock Report: latest
        // Monthly Opening + movements since (check-stock fromOpening). Display
        // only; the saved snapshot (OrderDetail.stock_g3/g9/total) is taken by
        // the orders API itself at save time.
        lineInfo: {
          key: (line) => String(line?.itcd?.value ?? line?.itcd ?? ""),
          load: async (itcds) => {
            const [g3, g9] = await Promise.all(
              [3, 9].map((godown) =>
                axios
                  .post("/api/voucher/check-stock", { productIds: itcds, godown, fromOpening: true })
                  .then((r) => r.data || {})
                  .catch(() => ({}))
              )
            );
            return Object.fromEntries(
              itcds.map((id) => [id, { g3: Number(g3[id]) || 0, g9: Number(g9[id]) || 0 }])
            );
          },
          items: (info) => [
            { label: "DESPATCH", value: info.g3 },
            { label: "FG-READY STOCK", value: info.g9 },
            { label: "Total", value: (Number(info.g3) || 0) + (Number(info.g9) || 0) },
          ],
        },
        // âœ… ADD THIS: Fetch product rate for the selected customer
        onChange: async (value, line, allLines, formData) => {
          if (!value || !formData?.party_code) return {};
          try {
            const itcd = value?.value ?? value;
            // The item is fetched alongside the customer rate so the line
            // carries its LTR Rate (KG per litre). Everything the unit picker
            // and the Qty (KG) calculation need is then on the line itself,
            // with no further round trip when the user switches to LTR.
            const [response, itemRes] = await Promise.all([
              axios.get(
                `/api/forms/customers/rates?acno=${formData?.party_code?.value}&itcd=${itcd}`,
              ),
              axios.get(`/api/forms/items/${itcd}`).catch(() => ({ data: {} })),
            ]);

            const data = response.data.customers?.[0] || {};
            const itemData = itemRes.data || {};
            const fetchedRate = data.rate || 0;
            const fetcheddate_rate = data.dated || "";

            // a new line takes the order's line type (line types on); Free of Cost / Trial → rate 0
            const free = soLineFree(formData, line);
            return {
              mm: value,
              ...(trialLinesOn() ? { line_type: effectiveLineType(formData, line) } : {}),
              rate: free ? 0 : fetchedRate,
              original_rate: fetchedRate,
              st_rate: free ? 0 : (line.st_rate || data.gst_rate || 0), // AUTO TAX RATE
              original_st_rate: data.gst_rate || 0,
              // KG unless the user switches this line to LTR.
              unit: UNIT_KG,
              ltr_rate: itemData.ltr_rate ?? null,
              item_name: itemData.item || "",
              dated: fetcheddate_rate,
            };
          } catch (error) {
            return {};
          }
        },

        // modalFields: [
        // { name: "item", label: "Product Name", type: "text", required: true },
        // {
        // name: "ic_id",
        // label: "Item Category",
        // type: "select",
        // options: "itemCategories",
        // apiEndpoint: "/api/setup/item_categories",
        // valueKey: "id",
        // nameKey: "ic_name",
        // required: true,
        // },
        // ],
      },
      // {
      //   name: "qty_per_pack",
      //   label: "Qty Per Pack",
      //   type: "number",
      //   required: true,
      //   readOnly: true,
      // allowManualEntry: true,
      // dependencies: ["qty"],
      //     calculate: (v, context = {}, line) => {
      //       const { lastEditedField } = context;

      //   // If user just edited qty_per_pack, return the entered value
      //   if (lastEditedField === "qty_per_pack") {
      //     return v.qty_per_pack || 0;
      //   }

      //   // Your scenarios
      //   const qty = parseFloat(v.qty) || 0;
      //   const noOfPack = parseFloat(context.no_of_packs) || 0;

      //   if(qty===0 && noOfPack>0) return v.qty_per_pack  ;
      //   if (qty === 0 && noOfPack === 0) return 0;
      //   if (qty > 0 && noOfPack === 0) return qty; // qty Ã· 1
      //   if (qty > 0 && noOfPack > 0) return qty / noOfPack;
      //   return 0;
      // },
      // },
      // {
      //   name: "no_of_packs",
      //   label: "No of Packs",
      //   type: "number",
      //   required: true,
      //   readOnly: true,
      // allowManualEntry: true,
      // dependencies: ["qty"],
      //     calculate: (v, context = {}) => {
      //   const { lastEditedField } = context;

      //   // If user just edited no_of_packs, return the entered value
      //   if (lastEditedField === "no_of_packs") {
      //     return v.no_of_pack || 0;
      //   }

      //   // Your scenarios
      //   const qty = parseFloat(v.qty) || 0;
      //   const qtyPerPack = parseFloat(context.qty_per_pack) || 0;

      //   if(qty===0 && qtyPerPack>0) {
      //     return v.no_of_packs}  ;
      //   if (qty === 0 && qtyPerPack === 0) return v.no_of_packs;
      //   if (qty > 0 && qtyPerPack === 0) {
      //     return 1};
      //   if (qty > 0 && qtyPerPack > 0) return qty / qtyPerPack;
      //   return 0;
      // },
      // },
      // ── Unit and quantity ──────────────────────────────────────────────
      // KG is the default and behaves exactly as before. Choosing LTR makes
      // Qty (LTR) the figure the customer ordered and the one the rate prices;
      // Qty (KG) is then derived from the item's LTR Rate and is what will
      // move stock at dispatch. See lib/units/litres.js.
      // Trial / Rate Negotiation per line (Features: orders.trialLineBilling)
      saleOrderLineTypeField(),
      createUnitField(LITRE_FEATURE),
      createQtyLtrField(LITRE_FEATURE),
      createQtyKgField(),
      {
        name: "rate",
        // The rate is per litre on a LTR line and per KG on a KG line — it is
        // the same customer rate, read in the unit the line is transacted in.
        label: "Rate",
        getLabel: (line) => (isLitreUnit(line?.unit) ? "Rate / LTR" : "Rate / KG"),
        type: "number",
        required: true,
        // Customer rate, read-only — except under "Rate Under Negotiation",
        // when the tentative rate may be typed (or left 0).
        // readOnly: (line, master) => !ratesEditableOn(master) || zeroRatesOn(master),
        // Rate is now editable on create and edit. Still locked on Free of
        // Cost / Trial Process orders, whose rates the API forces to 0.
        // With line types on: per line (Free of Cost order or a Trial line).
        readOnly: (line, master) => soLineFree(master, line),
        subtitleField: "dated",
        subtitleLabel: "",
        subtitleValue: (v) => new Date(v).toLocaleDateString('en-US')
      },
      // ── The money chain: amount → st_amount → net_amount ────────────────
      // Form.jsx only recomputes a field when the field the user just edited
      // is named in that field's own `dependencies`. So every derived field
      // here has to list the ROOT inputs (qty, qty_ltr, unit, rate, st_rate),
      // not merely the field above it — net_amount listing only
      // ["amount", "st_amount"] meant typing a qty or picking up a rate
      // recalculated the amount but left Net Amount stale, because neither
      // "amount" nor "st_amount" is a field anyone types into.
      //
      // They are declared in this order, and one pass runs them in order, so
      // st_amount sees the fresh amount and net_amount sees both.
      {
        name: "amount",
        label: "Amount",
        type: "number",
        dependencies: ["qty", "qty_ltr", "unit", "rate"],
        calculate: (a, b) => litreAwareAmount(calcLine(a, b)),
        readOnly: true,
      },
      {
        name: "st_rate",
        label: "ST Rate %",
        type: "number",
        defaultValue: 0,
      },
      {
        name: "st_amount",
        label: "ST Amount",
        type: "number",
        dependencies: ["amount", "st_rate", "qty", "qty_ltr", "unit", "rate"],
        calculate: (a, b) => {
          const line = calcLine(a, b);
          const amount = parseFloat(line.amount) || litreAwareAmount(line);
          return (amount * (parseFloat(line.st_rate) || 0)) / 100;
        },
        readOnly: true,
      },
      {
        name: "net_amount",
        label: "Net Amount",
        type: "number",
        dependencies: ["amount", "st_amount", "st_rate", "qty", "qty_ltr", "unit", "rate"],
        calculate: (a, b) => {
          const line = calcLine(a, b);
          const amount = parseFloat(line.amount) || litreAwareAmount(line);
          const st = parseFloat(line.st_amount) || 0;
          return amount + st;
        },
        readOnly: true,
      },
      // Sale Order line → Production Plan (Features: saleOrder.planFromOrder):
      // Plan Date + Plan Qty / Create (components/Category/SaleOrderPlanCell.jsx)
      { name: "plan_date", label: "Plan Date", type: "saleOrderPlan", part: "date", feature: "saleOrder.planFromOrder" },
      { name: "plan_qty", label: "Plan Qty", type: "saleOrderPlan", part: "qty", feature: "saleOrder.planFromOrder" },
    ],
    totals: {
      totalQty: {
        label: "Total Qty (KG)",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
      },
      // Shown only when the order actually has litre lines, so KG-only orders
      // look exactly as they always have.
      totalQtyLtr: {
        label: "Total Qty (LTR)",
        showWhen: (lines) => lines.some((l) => isLitreUnit(l?.unit)),
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty_ltr || 0), 0),
      },
      totalAmount: {
        label: "Total Amount",
        calculate: (lines) =>
          lines.reduce((sum, l) => sum + (l.amount || 0), 0),
      },
      totalSalesTax: {
        label: "Total Sales Tax",
        calculate: (lines) =>
          lines.reduce((sum, l) => sum + (l.st_amount || 0), 0),
      },
      grandTotal: {
        label: "Grand Total",
        calculate: (lines) =>
          lines.reduce(
            (sum, l) => sum + (l.st_amount || 0) + (l.amount || 0),
            0,
          ),
      },
    },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "order_no", label: "ISO", type: "text" },
      { name: "region", label: "Region", type: "text", multiFilter: true },

      {
        name: "party_code",
        label: "Customer",
        type: "text",
        options: true,
        value1: "acno",
        value2: "acname",
      },
      {
        name: "godown",
        label: "Godown",
        type: "text",
        options: true,
        value1: "godownDetails",
        value2: "godown",
      },
      {
        name: "amount",
        label: "Total Amount",
        type: "text",
        isInnerTotal: true,
        key: "orderDetails",
      },
      {
        name: "qty",
        label: "Total Qty",
        type: "text",
        isInnerTotal: true,
        key: "orderDetails",
      },
      {
        name: "st_amount",
        label: "Sales Tax",
        type: "text",
        isInnerTotal: true,
        key: "orderDetails",
      },
      {
        name: "amount",
        label: "Net Amount",
        type: "text",
        isInnerTotal: true,
        key: "orderDetails",
      },

      { name: "status", label: "Status", type: "status" }, // âœ… ADD THIS

      // { name: "status", label: "Status", type: "text" },
    ],
    allowDelete: false,
    allowPrint: true,
    allowEdit: true,
    allowView: true,
    allowCheck: false,
  },
  saleOrderView: {
    buttonText: "",
    ModalHeading: "",
    ModalHeadingEdit: "",
    tran_code: 600,
    hasDeductionBlock: false,
    differApi: "/api/orders/saleOrder",

    masterFields: [
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },
      {
        name: "party_code",
        label: "Customer",
        type: "select",
        options: "customerAccounts",
        apiEndpoint: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`, // Customers
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        required: true,
        onChange: async (value, formData) => {
          if (!value) return {};

          try {
            // Fetch customer details including payment terms
            const response = await axios.get(
              `/api/forms/customers/details?acno=${value}`,
            );
            const customerData = response.data.customers;


            return {
              // Set payment terms from customer data
              payment_terms: `${customerData[0].crDays} Days` || "",
              delivery_location: customerData[0].address || "",
              due_date: (() => {
                const date = new Date();
                date.setDate(date.getDate() + (customerData[0].crDays || 0));
                return date.toISOString().split("T")[0];
              })(),
              region:
                customerData[0].subCategory === "N"
                  ? "NORTH"
                  : customerData[0].subCategory === "S"
                    ? "SOUTH"
                    : "NORTH",
              // delivery_terms: customerData.delivery_terms || "",
              // delivery_location: customerData.default_delivery_location || "",
              // Any other customer-specific defaults
            };
          } catch (error) {
            return {};
          }
        },
        // modalFields: [
        // {
        // name: "acname",
        // label: "Customer Name",
        // type: "text",
        // required: true,
        // },
        // {
        // name: "macno",
        // label: "Main Account",
        // type: "select",
        // options: "mainAccounts",
        // apiEndpoint: "/api/accounts/macno",
        // valueKey: "macno",
        // nameKey: "macname",
        // required: true,
        // },
        // ],
      },
      {
        name: "sale_po",
        label: "Purchase Order No",
        type: "text",
      },

      {
        name: "due_date",
        label: "Due Date",
        type: "date",
        required: true,
        readOnly: true,
      },
      {
        name: "region",
        label: "Region",
        type: "normalSelect",
        options: [
          { value: "NORTH", label: "NORTH" },
          { value: "SOUTH", label: "SOUTH" },
        ],
        defaultValue: { value: "NORTH", label: "NORTH" },
        required: true,
      },
      {
        name: "delivery_terms",
        label: "Delivery Terms",
        type: "text",
      },
      {
        name: "payment_terms",
        label: "Payment Terms",
        type: "text",
        readOnly: true,
      },
      {
        name: "delivery_location",
        label: "Delivery Location",
        type: "textarea",
        readOnly: true,
      },
      {
        name: "additional_instructions",
        label: "Instructions",
        type: "textarea",
      },

      {
        name: "godown",
        label: "Godown",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKey: "godown",
        valueKey: "id",
        required: true,
        defaultValue: { value: "1", label: "FACTORY" },
        extraOptions: [NO_GODOWN_OPTION],
        onChange: async (value) => ({ noGodown: value === NO_GODOWN_OPTION.value }),
      },
      ...soApprovalCheckboxes(),
      // {
      //   name: "status",
      //   label: "Status",
      //   type: "select",
      //   options: "orderStatus",
      //   apiEndpoint: "/api/setup/order-status",
      //   valueKey: "id",
      //   nameKey: "status",
      //   required: true,
      // },
    ],
    lineFields: [
      {
        name: "mm", //
        label: "MM#",
        type: "text",
        readOnly: true,
      },
      {
        name: "itcd",
        label: "Product",
        type: "select",
        options: "products",
        locked: true,
        apiEndpoint: (formData, lineData) => {

          const customerAcno =
            formData?.party_code?.value || formData?.party_code;

          if (customerAcno && !formData?.freeOfCost && !formData?.trialProcess) {
            return `/api/forms/products?customer=${customerAcno}`;
          }

          if (formData?.freeOfCost || formData?.trialProcess) {
            return "/api/forms/products?includeAll=true";
          }

          // Return all products initially (but empty until customer selected)
          return "/api/forms/products?includeAll=true";
        },
        getPlaceholder: (formData) => {
          const customerAcno =
            formData.party_code?.value || formData.party_code;
          return customerAcno
            ? "Select product"
            : "Please select customer first";
        },
        createEndpoint: "/api/setup/items",
        nameKeys: ["code", "item"],
        separator: " - ",
        valueKey: "itcd",
        required: true,
        // âœ… ADD THIS: Fetch product rate for the selected customer
        onChange: async (value, line, allLines, formData) => {
          if (!value || !formData?.party_code) return {};
          try {
            const response = await axios.get(
              `/api/forms/customers/rates?acno=${formData?.party_code?.value}&itcd=${value}`,
            );

            const data = response.data.customers?.[0] || {};

            return {
              mm: value,
              rate: data.rate || 0,
              st_rate: data.gst_rate || 0, // AUTO TAX RATE
              unit: "KG",
            };
          } catch (error) {
            return {};
          }
        },

        // modalFields: [
        // { name: "item", label: "Product Name", type: "text", required: true },
        // {
        // name: "ic_id",
        // label: "Item Category",
        // type: "select",
        // options: "itemCategories",
        // apiEndpoint: "/api/setup/item_categories",
        // valueKey: "id",
        // nameKey: "ic_name",
        // required: true,
        // },
        // ],
      },

      {
        name: "qty_per_pack",
        label: "Qty Per Pack",
        type: "number",
        required: true,
        readOnly: true,
        // allowManualEntry: true,
        // dependencies: ["qty"],
        //     calculate: (v, context = {}, line) => {
        //       const { lastEditedField } = context;

        //   // If user just edited qty_per_pack, return the entered value
        //   if (lastEditedField === "qty_per_pack") {
        //     return v.qty_per_pack || 0;
        //   }

        //   // Your scenarios
        //   const qty = parseFloat(v.qty) || 0;
        //   const noOfPack = parseFloat(context.no_of_packs) || 0;

        //   if(qty===0 && noOfPack>0) return v.qty_per_pack  ;
        //   if (qty === 0 && noOfPack === 0) return 0;
        //   if (qty > 0 && noOfPack === 0) return qty; // qty Ã· 1
        //   if (qty > 0 && noOfPack > 0) return qty / noOfPack;
        //   return 0;
        // },
      },
      {
        name: "no_of_packs",
        label: "No of Packs",
        type: "number",
        required: true,
        readOnly: true,
        // allowManualEntry: true,
        // dependencies: ["qty"],
        //     calculate: (v, context = {}) => {
        //   const { lastEditedField } = context;

        //   // If user just edited no_of_packs, return the entered value
        //   if (lastEditedField === "no_of_packs") {
        //     return v.no_of_pack || 0;
        //   }

        //   // Your scenarios
        //   const qty = parseFloat(v.qty) || 0;
        //   const qtyPerPack = parseFloat(context.qty_per_pack) || 0;

        //   if(qty===0 && qtyPerPack>0) {
        //     return v.no_of_packs}  ;
        //   if (qty === 0 && qtyPerPack === 0) return v.no_of_packs;
        //   if (qty > 0 && qtyPerPack === 0) {
        //     return 1};
        //   if (qty > 0 && qtyPerPack > 0) return qty / qtyPerPack;
        //   return 0;
        // },
      },
      createOrderPSQtyField(), // Basic calculation validation only
      { name: "unit", label: "Unit", type: "text", readOnly: true },
      {
        name: "rate",
        label: "Rate",
        type: "number",
        required: true,
        readOnly: true,
      },
      {
        name: "amount",
        label: "Amount",
        type: "number",
        dependencies: ["qty", "rate"],
        calculate: (v) => v.qty * v.rate,
      },
      {
        name: "st_rate",
        label: "ST Rate %",
        type: "number",
        defaultValue: 0,
      },
      {
        name: "st_amount",
        label: "ST Amount",
        type: "number",
        dependencies: ["amount", "st_rate", "qty", "rate"],
        calculate: (v) => ((v.amount || 0) * (v.st_rate || 0)) / 100,
        readOnly: true,
      },
      {
        name: "net_amount",
        label: "Net Amount",
        type: "number",
        dependencies: ["amount", "st_amount"],
        calculate: (v) => (v.amount || 0) + (v.st_amount || 0),
        readOnly: true,
      },
    ],
    totals: {
      totalQty: {
        label: "Total Quantity",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
      },
    },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "order_no", label: "ISO", type: "text" },
      {
        name: "party_code",
        label: "Customer",
        type: "text",
        options: true,
        value1: "acno",
        value2: "acname",
      },
      {
        name: "godown",
        label: "Godown",
        type: "text",
        options: true,
        value1: "godownDetails",
        value2: "godown",
      },
      {
        name: "qty",
        label: "Total Qty",
        type: "text",
        isInnerTotal: true,
        key: "orderDetails",
      },


      // { name: "status", label: "Status", type: "text" },
    ],
    allowDelete: false,
    allowPrint: false,
    allowEdit: false,
    allowView: true,
    allowCheck: false,
  },
  // ── GRN — the goods received (tran_code 4), quantity only ────────────────
  // Stock IN at quantities. With a PO linked the lines come from the PO's open
  // items at their balance. No rate / amount / tax here: the GRN is priced and
  // the vendor's bill (bill no / date) entered on Purchase Invoicing, which
  // posts the vendor's credit. Freight, off-loading and weighing are billed as
  // Service Invoices linked to the GRN (its view lists them). `grnEdit`
  // (below VOUCHER_CONFIG) is this same screen.
  grn: {
    buttonText: "Create GRN",
    ModalHeading: "Create GRN",
    ModalHeadingEdit: "Edit GRN",
    differTitle: "Total GRNs",
    tran_code: 4,
    hasDeductionBlock: false,
    // Physical document: no rate / amount; invoiced on the Invoicing screen.
    qtyOnly: true,
    invoiceLock: true,
    // Preview of the next GRN No on create — display only, see /api/voucher/next-number
    nextNumber: { fieldName: "grn_no", type: "grn" },
    differApi: "/api/voucher/grn",
    // Services panel (freight, off-loading, weighing …) → linked Service
    // Invoices, saved with the GRN (Form.jsx, lib/service/documentServices.js).
    documentServices: "GRN",

    masterFields: [
      { name: "dated", label: "Date", type: "date", required: true },
      { name: "grn_no", label: "GRN No", type: "text", readOnly: true },
      createLockableField({
        name: "pycd",
        label: "Vendor",
        type: "select",
        options: "accounts",
        apiEndpoint: "/api/accounts/acno?group=customers,vendors,lc_accounts,beneficiaries",
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        lockInEdit: true,
        required: true,
        clearable: true,
        // A PO belongs to one vendor: changing the vendor drops the PO and
        // the lines it brought.
        onChange: async (value, formData) => {
          const before = selVal(formData?.pycd);
          if (hasValue(formData?.po_no) && hasValue(before) && String(before) !== String(value)) {
            return { po_no: null, lines: [] };
          }
          return {};
        },
      }),
      createLockableField({
        name: "po_no",
        label: "PO No (optional)",
        type: "select",
        options: "purchaseOrders",
        // The vendor's open POs (activeOnly: not every line closed).
        apiEndpoint: (formData) => {
          const vendor = selVal(formData?.pycd);
          return hasValue(vendor)
            ? `/api/orders/purchaseOrder?activeOnly=true&multiFilters=${jsonParam({ party_code: [Number(vendor)] })}`
            : "/api/orders/purchaseOrder?activeOnly=true";
        },
        nameKeys: ["order_no", "acno.acname"],
        valueKey: "order_no",
        lockInEdit: true,
        getPlaceholder: (formData) =>
          hasValue(formData?.pycd) ? "Select the vendor's PO (optional)" : "Select PO (optional)",
        // PO picked → its open items at their balance qty.
        onChange: async (value, formData) => {
          if (!value) return {};
          try {
            const { po, lines } = await grnLinesFromPo(value);
            if (!po) return {};
            return {
              ...(hasValue(formData?.pycd)
                ? {}
                : {
                    pycd: {
                      value: String(po.party_code),
                      label: `${po.party_code} - ${po.acno?.acname || ""}`,
                    },
                  }),
              lines,
            };
          } catch (error) {
            console.error("Error fetching PO:", error);
            return {};
          }
        },
      }),
      createLockableField({
        name: "godown",
        label: "Godown",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKeys: ["id", "godown"],
        valueKey: "id",
        lockInEdit: true,
        required: true,
        // No default: godown 1 is ADMIN, the user picks where goods land.
      }),
      // Our own paper GRN book number; the vendor's DC is the next field.
      MANUAL_GRN_NO_FIELD,
      { name: "rmk4", label: "Vehicle No", type: "text", uppercase: true },
      { name: "rmk3", label: "Vendor DC / Challan No", type: "text" },
      // Vendor bill no / bill date are entered on Purchase Invoicing.
      LEGACY_DOC_FIELD,
      { name: "rmk", label: "Narration", type: "textarea", fullWidth: true },
    ],

    lineFields: [
      {
        name: "itcd",
        label: "Item",
        type: "select",
        options: "products",
        // With a PO linked only its items are offered.
        apiEndpoint: (formData) => {
          const poNo = selVal(formData?.po_no);
          return hasValue(poNo)
            ? `/api/forms/items/exBond-LcItems?orderNo=${poNo}`
            : "/api/setup/items";
        },
        createEndpoint: "/api/setup/items",
        nameKeys: ["code", "item"],
        separator: ["-"],
        valueKey: "itcd",
        required: true,
        getPlaceholder: (formData) =>
          hasValue(formData?.po_no) ? "Select item from the PO" : "Select item",
        onChange: async (value, line, allLines, formData) => grnItemChanged(value, formData),
      },
      { name: "batch_no", label: "Batch No", type: "text" },
      { name: "no_of_pack", label: "No of Packs", type: "number", required: true },
      { name: "qty_per_pack", label: "Qty per Pack", type: "number", required: true },
      // Packs × qty per pack; against a PO capped at its balance + 10%,
      // giving back this GRN's own saved qty on edit.
      createGrnQtyField({ label: "Qty (KG)" }),
      // Rate typed on the GRN — only items / categories ticked "Rate entered on
      // the GRN" (Settings → Features "grn.directRateByItem", lib/grn/directRate.js).
      // Becomes the Purchase Invoicing default; the GRN still posts no amounts.
      {
        name: "rate",
        label: "GRN Rate",
        type: "number",
        feature: "grn.directRateByItem",
        featureKeep: (saved) => (saved?.lines || saved?.transactions || []).some?.((l) => Number(l?.rate) > 0),
        readOnly: (line) => !line?.direct_rate && !(Number(line?.rate) > 0),
        width: "110px",
      },
      { name: "narration1", label: "Narration", type: "textarea" },
    ],

    totals: {
      totalQty: {
        label: "Total Qty",
        calculate: (lines) => lines.reduce((sum, l) => sum + (parseFloat(l.qty) || 0), 0),
      },
    },

    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "grn_no", label: "GRN No", type: "text" },
      { name: "manual_no", label: "Manual GRN No", type: "text" },
      { name: "po_no", label: "PO No", type: "text" },
      { name: "pycd", label: "Vendor", type: "text", options: true, value1: "acno", value2: "acname" },
      { name: "rmk3", label: "Vendor DC", type: "text" },
      { name: "godown", label: "Godown", type: "text", options: true, value1: "godownDetails", value2: "godown" },
      { name: "rmk4", label: "Vehicle", type: "text" },
      { name: "qty", label: "Total Qty", type: "number", isInnerTotal: true, key: "transactions" },
      INVOICED_COLUMN,
    ],

    allowDelete: false,
    allowPrintSaveButton: true,
    allowPrint: true,
    allowEdit: true,
    allowView: true,
    allowCreate: false,
    allowReturn: true,
    returnType: "grnReturn",
    allowCheck: false,
    // Cloning would copy the PO onto a second receipt.
    allowClone: false,
  },
  exbond: {
    buttonText: "Create ExBond",
    ModalHeading: "Create ExBond",
    ModalHeadingEdit: "Edit ExBond",
    tran_code: 4,
    // List shows an Items column (items_description from the voucher API)
    itemsColumn: true,
    // Only LC accounts (the "lc_accounts" group) — see app/api/voucher/[type] GET
    // Resolved server-side with getAccountGroups(vendorGroups).
    vendorGroups: ["lc_accounts"],
    hasDeductionBlock: false,
    // Preview of the next GRN No on create — display only, see /api/voucher/next-number
    nextNumber: { fieldName: "grn_no", type: "grn" },
    // differApi: "/api/voucher/grn",
   

    masterFields: [
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },
      // {
      //   name: "grn_no",
      //   label: "GRN No",
      //   type: "text",
      //   readOnly: true,
      // },
      {
        name: "rmk3",
        label: "Bill No",
        type: "text",
      },
      // createLockableField({
      //   name: "po_no",
      //   label: "Purchase Order No",
      //   type: "select",
      //   options: "purchaseOrders",
      //   apiEndpoint: "/api/orders/purchaseOrder",
      //   nameKey: "order_no",
      //   valueKey: "order_no",
      //   lockInEdit: true, // ðŸ”’ Always locked in edit
      //   onChange: async (value, formData, config) => {
      //     if (!value) return { godown: null, lines: [] };

      //     try {
      //       const response = await axios.get(
      //         `/api/orders/purchaseOrder?orderNo=${value}`,
      //       );
      //       const poData = response.data.data[0];

      //       return mapSourceToForm(poData, config?.sourceMapping, "grn");
      //     } catch (error) {
      //       console.error("Error fetching PO:", error);
      //       throw error;
      //     }
      //   },
      // }),
      // Alternate source for import shipments: selecting an L/C pulls its
      // LCDetail lines directly (no PO involved). Import vs Local (see
      // LC.import_type) decides which account pool the Vendor field below
      // searches. Clearing the L/C also clears any selected Bond.
      createLockableField({
        name: "lc_no",
        label: "L/C No (Import)",
        type: "select",
        options: "letterOfCredits",
        apiEndpoint: "/api/lc",
        nameKey: "lc_no",
        valueKey: "lc_no",
        // lockInEdit: true,
        onChange: async (value, formData) => {
          if (!value) {
            return { lc_import_type: null, pycd: null, bond_id: null };
          }

          try {
            const response = await axios.get(`/api/lc?lc_no=${value}`);
            const lc = response.data;

            // lc_gl is an Int FK to ACNO — account details come via lc_gl_account
            const glAcc = lc.lc_gl_account;
            const vendorVal = glAcc
              ? {
                value: String(glAcc.acno),
                label: `${glAcc.acno} - ${glAcc.acname || ""}`,
              }
              : lc.lc_gl
                ? { value: String(lc.lc_gl), label: String(lc.lc_gl) }
                : null;

            return {
              lc_import_type: lc.import_type || null,
              pycd: vendorVal,
              bond_id: null,
            };
          } catch (error) {
            console.error("Error fetching LC:", error);
            throw error;
          }
        },
      }),
      // Optional: only relevant when the LC's shipment went into bond first.
      // Leaving this blank means the GRN is direct against the LC's own
      // lines above (loaded when it isn't).
      createLockableField({
        name: "bond_id",
        label: "Ex-Bond Entry (optional)",
        type: "select",
        options: "inboundEntries",
        apiEndpoint: (formData) => {
          const lcNo = formData?.lc_no?.value || formData?.lc_no;
          return lcNo ? `/api/inbond?lc_no=${lcNo}` : `/api/inbond`;
        },
        nameKeys: ["id", "lc_ref"],
        valueKey: "id",
        // lockInEdit: true,
        getPlaceholder: (formData) => {
          const lcNo = formData?.lc_no?.value || formData?.lc_no;
          return lcNo ? "Select bond entry (optional)" : "Select an L/C first";
        },
        onChange: async (value, formData) => {
          const lcNo = formData?.lc_no?.value || formData?.lc_no;

          // No bond selected — fall back to the LC's own lines directly.
          if (!value) {
            if (!lcNo) return {};
            try {
              const response = await axios.get(`/api/lc?lc_no=${lcNo}`);
              const lc = response.data;
              const glAcc = lc.lc_gl_account;
              const vendorVal = glAcc
                ? { value: String(glAcc.acno), label: `${glAcc.acno} - ${glAcc.acname || ""}` }
                : lc.lc_gl
                  ? { value: String(lc.lc_gl), label: String(lc.lc_gl) }
                  : null;
              return { lc_import_type: lc.import_type || null, pycd: vendorVal };
            } catch (error) {
              console.error("Error reloading LC details:", error);
              return {};
            }
          }

          try {
            const bondId = value?.value || value;
            const response = await axios.get(`/api/inbond?id=${bondId}`);
            const rawData = response.data;

            // API may return list format {data:[...]} or single object directly
            const bond = rawData?.data?.[0] || rawData;

            // InboundMaster.lc_no is FK to ACNO — bond.acno is the vendor record
            let vendorVal = null;
            if (bond.acno) {
              // Single fetch path: acno relation is included
              vendorVal = {
                value: String(bond.acno.acno),
                label: `${bond.acno.acno} - ${bond.acno.acname || ""}`,
              };
            } else if (bond.lc_no) {
              // List fetch path: acno not included — fetch account directly from lc_no
              try {
                const acRes = await axios.get(`/api/accounts/acno?acno=${bond.lc_no}`);
                const acData = acRes.data?.data?.[0] || acRes.data;
                if (acData?.acno) {
                  vendorVal = {
                    value: String(acData.acno),
                    label: `${acData.acno} - ${acData.acname || ""}`,
                  };
                }
              } catch (acErr) {
                console.warn("[Bond onChange] Could not fetch ACNO for lc_no:", acErr);
              }
            }

            let lcVal = null;
            if (bond.lcmaster) {
              lcVal = {
                value: String(bond.lcmaster.lc_no),
                label: `${bond.lcmaster.id} - ${bond.lcmaster.lc_no}`,
              };
            } else if (bond.lc_ref) {
              lcVal = {
                value: String(bond.lc_ref),
                label: String(bond.lc_ref),
              };
            }

            // Auto-fill L/C No and Vendor — detail lines stay manual
            return {
              ...(lcVal ? { lc_no: lcVal } : {}),
              lc_import_type: bond.lcmaster?.import_type || null,
              ...(vendorVal ? { pycd: vendorVal } : {}),
            };
          } catch (error) {
            console.error("Error fetching bond entry:", error);
            throw error;
          }
        },
      }),
      createLockableField({
        name: "pycd",
        label: "Vendor",
        type: "select",
        options: "accounts",
        // ExBond: only LC accounts (the "lc_accounts" group).
        apiEndpoint: `/api/accounts/acno?${LC_GROUP_PARAM}`,
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        // lockInEdit: true,
        required: true,
        clearable: true,
        // modalFields: [
        // { name: "name", label: "Vendor Name", type: "text", required: true },
        // ],
      }),
      createLockableField({
        name: "godown",
        label: "Warehouse",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKeys: ["id", "godown"],
        // lockInEdit: true,
        valueKey: "id",
        required: true,
        defaultValue: { value: "1", label: "1 - FACTORY" },
        // modalFields: [
        // {
        // name: "godown",
        // label: "Godown Name",
        // type: "text",
        // required: true,
        // },
        // ],
      }),
      {
        name: "rmk5", label: "Category", type: "normalSelect",
        defaultValue: { value: "IMPORTED MATERIAL", label: "IMPORTED MATERIAL" },
        options: [
          { value: "IMPORTED MATERIAL", label: "IMPORTED MATERIAL" },

        ],
      },
      { name: "rmk", label: "Narration", type: "textarea" },
      // { name: "ref_dispatch_no", label: "Ref Dispatch No", type: "text" },
    ],

    lineFields: [  //grn fields
      // {
      //   name: "mm",
      //   label: "MM#",
      //   type: "text",
      //   readOnly: true,
      // },
      {
        name: "itcd",
        label: "Product",
        type: "select",
        options: "products",
        // ✅ DYNAMIC ENDPOINT: Filter items by selected L/C, Ex-Bond, or Purchase Order
        apiEndpoint: (formData, lineData) => {
          const lcNo = formData?.lc_no?.value || formData?.lc_no;
          const bondId = formData?.bond_id?.value || formData?.bond_id;
          const poNo = formData?.po_no?.value || formData?.po_no;

          if (!lcNo && !bondId && !poNo) {
            return `/api/setup/items`;
          }

          const params = new URLSearchParams();
          if (lcNo) params.set("lcNo", lcNo);
          if (bondId) params.set("bondId", bondId);
          if (poNo) params.set("orderNo", poNo);

          return `/api/forms/items/exBond-LcItems?${params.toString()}`;
        },
        createEndpoint: "/api/setup/items",
        nameKeys: ["code", "item"],
        separator: ["-"],
        valueKey: "itcd",
        required: true,
        // âœ…  DYNAMIC PLACEHOLDER
        getPlaceholder: (formData) => {
          const lcNo = formData?.lc_no?.value || formData?.lc_no;
          const bondId = formData?.bond_id?.value || formData?.bond_id;
          const poNo = formData?.po_no?.value || formData?.po_no;
          if (bondId) return "Select product from Ex-Bond Entry";
          if (lcNo) return "Select product from L/C";
          if (poNo) return "Select product from Purchase Order";
          return "Select Product";
        },
        onChange: async (value, line, allLines, formData) => {

          if (!value) return {};

          try {
            // Fetch the item details including its default packing material
            const response = await axios.get(
              `/api/forms/items/${value.value || value}`,
            );
            const batchNoResponse = await axios.get(
              `/api/forms/items/batchNo?itcd=${value.value || value}`,
            );
            const batchNoData = batchNoResponse.data;

            const itemData = response.data;



            // Return the packing material code to auto-populate
            return {
              mm: value?.value || value,
              packing_material_code: itemData.packing_material_code
                ? {

                  value: itemData.itcd,
                  label: itemData.item || "Packing Material",
                }
                : null,
            };
          } catch (error) {
            console.error("Error fetching item packing material:", error);
            return {};
          }
        },
      
      },
      {
        name: "no_of_pack",
        label: "No of Packs",
        type: "number",
        required: true,
      },
      {
        name: "qty_per_pack",
        label: "Qty Per Pack",
        type: "number",
        required: true,
      },
      // âœ… CHANGED: Use universal qty field with GRN-specific validation
      // ExBond: GRN qty checks + stock in godown 4 - BOND (like Godown Transfer)
      withBondStockCheck(createGrnQtyField({})),
      { name: "narration1", label: "Narration", type: "textarea" },
    ],

    totals: {
      totalQty: {
        label: "Total Qty",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
      },
    },




    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "grn_no", label: "Grn No", type: "text" },
      // { name: "order_no", label: "Order No", type: "text" },
      { name: "user_id", label: "Created By", type: "text", options: true, value1: "user", value2: "name" },
      {
        name: "pycd",
        label: "Vendor",
        type: "text",
        options: true,
        value1: "acno",
        value2: "acname",
      },
      {
        // "1) code - item" per line — built by app/api/voucher/[type] GET (itemsColumn)
        name: "items_description",
        label: "Items",
        type: "text",
        multiline: true,
      },
      // {
      //   name: "qty",
      //   label: "Total Qty",
      //   type: "text",
      //   isInnerTotal: true,
      //   key: "details",
      // },
      {
        name: "rmk3",
        label: "Bill No",
        type: "text",
      },
      {
        name: "qty",
        label: "Total Qty",
        type: "text",
        isInnerTotal: true,
        key: "transactions",
      },
      // { name: "status", label: "Status", type: "status" }, // âœ… ADD THIS
    ],

    allowDelete: false,
    allowPrintSaveButton: false,
    allowPrint: false,
    allowEdit: true,
    allowReturn: false,
    // returnType: "grnReturn",
    allowView: false,
    allowCreate: false,
    allowCheck: false,
  },
  exbondEdit: {
    ModalHeading: "Edit ExBond",
    ModalHeadingEdit: "Edit ExBond",
    tran_code: 4,
    // List shows an Items column (items_description from the voucher API)
    itemsColumn: true,
    // List only GRNs whose vendor is an LC account (app/api/voucher/[type] GET)
    // Resolved server-side with getAccountGroups(vendorGroups).
    vendorGroups: ["lc_accounts"],
    differTitle: "Total ExBond's",
    hasDeductionBlock: false,

    masterFields: [
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },
      {
        name: "rmk3",
        label: "Bill No",
        type: "text",
      },
      // createLockableField({
      //   name: "po_no",
      //   label: "Purchase Order No",
      //   type: "select",
      //   options: "purchaseOrders",
      //   apiEndpoint: "/api/orders/purchaseOrder",
      //   nameKey: "order_no",
      //   valueKey: "order_no",
      //   lockInEdit: true, // ðŸ”’ Always locked in edit
      //   onChange: async (value, formData, config) => {
      //     if (!value) return { godown: null, lines: [] };

      //     try {
      //       const response = await axios.get(
      //         `/api/orders/purchaseOrder?orderNo=${value}`,
      //       );
      //       const poData = response.data.data[0];

      //       return mapSourceToForm(poData, config?.sourceMapping, "grn");
      //     } catch (error) {
      //       console.error("Error fetching PO:", error);
      //       throw error;
      //     }
      //   },
      // }),
      createLockableField({
        name: "lc_no",
        label: "L/C No (Import)",
        type: "select",
        options: "letterOfCredits",
        apiEndpoint: "/api/lc",
        nameKey: "lc_no",
        valueKey: "lc_no",
        //lockInEdit: true,
        onChange: async (value, formData) => {
          if (!value) {
            return { lc_import_type: null, pycd: null, bond_id: null };
          }

          try {
            const response = await axios.get(`/api/lc?lc_no=${value}`);
            const lc = response.data;

            // lc_gl is an Int FK to ACNO — account details come via lc_gl_account
            const glAcc = lc.lc_gl_account;
            const vendorVal = glAcc
              ? {
                value: String(glAcc.acno),
                label: `${glAcc.acno} - ${glAcc.acname || ""}`,
              }
              : lc.lc_gl
                ? { value: String(lc.lc_gl), label: String(lc.lc_gl) }
                : null;

            return {
              lc_import_type: lc.import_type || null,
              pycd: vendorVal,
              bond_id: null,
            };
          } catch (error) {
            console.error("Error fetching LC:", error);
            throw error;
          }
        },
      }),
      // Optional: only relevant when the LC's shipment went into bond first.
      // Leaving this blank means the GRN is direct against the LC's own
      // lines above (loaded when it isn't).
      createLockableField({
        name: "bond_id",
        label: "Ex-Bond Entry (optional)",
        type: "select",
        options: "inboundEntries",
        apiEndpoint: (formData) => {
          const lcNo = formData?.lc_no?.value || formData?.lc_no;
          return lcNo ? `/api/inbond?lc_no=${lcNo}` : `/api/inbond`;
        },
        nameKeys: ["id", "lc_ref"],
        valueKey: "id",
        //lockInEdit: true,
        getPlaceholder: (formData) => {
          const lcNo = formData?.lc_no?.value || formData?.lc_no;
          return lcNo ? "Select bond entry (optional)" : "Select an L/C first";
        },
        onChange: async (value, formData) => {
          const lcNo = formData?.lc_no?.value || formData?.lc_no;

          // No bond selected — fall back to the LC's own lines directly.
          if (!value) {
            if (!lcNo) return {};
            try {
              const response = await axios.get(`/api/lc?lc_no=${lcNo}`);
              const lc = response.data;
              const glAcc = lc.lc_gl_account;
              const vendorVal = glAcc
                ? { value: String(glAcc.acno), label: `${glAcc.acno} - ${glAcc.acname || ""}` }
                : lc.lc_gl
                  ? { value: String(lc.lc_gl), label: String(lc.lc_gl) }
                  : null;
              return { lc_import_type: lc.import_type || null, pycd: vendorVal };
            } catch (error) {
              console.error("Error reloading LC details:", error);
              return {};
            }
          }

          try {
            const bondId = value?.value || value;
            const response = await axios.get(`/api/inbond?id=${bondId}`);
            const rawData = response.data;

            // API may return list format {data:[...]} or single object directly
            const bond = rawData?.data?.[0] || rawData;

            // InboundMaster.lc_no is FK to ACNO — bond.acno is the vendor record
            let vendorVal = null;
            if (bond.acno) {
              // Single fetch path: acno relation is included
              vendorVal = {
                value: String(bond.acno.acno),
                label: `${bond.acno.acno} - ${bond.acno.acname || ""}`,
              };
            } else if (bond.lc_no) {
              // List fetch path: acno not included — fetch account directly from lc_no
              try {
                const acRes = await axios.get(`/api/accounts/acno?acno=${bond.lc_no}`);
                const acData = acRes.data?.data?.[0] || acRes.data;
                if (acData?.acno) {
                  vendorVal = {
                    value: String(acData.acno),
                    label: `${acData.acno} - ${acData.acname || ""}`,
                  };
                }
              } catch (acErr) {
                console.warn("[Bond onChange] Could not fetch ACNO for lc_no:", acErr);
              }
            }

            let lcVal = null;
            if (bond.lcmaster) {
              lcVal = {
                value: String(bond.lcmaster.lc_no),
                label: `${bond.lcmaster.id} - ${bond.lcmaster.lc_no}`,
              };
            } else if (bond.lc_ref) {
              lcVal = {
                value: String(bond.lc_ref),
                label: String(bond.lc_ref),
              };
            }

            // Auto-fill L/C No and Vendor — detail lines stay manual
            return {
              ...(lcVal ? { lc_no: lcVal } : {}),
              lc_import_type: bond.lcmaster?.import_type || null,
              ...(vendorVal ? { pycd: vendorVal } : {}),
            };
          } catch (error) {
            console.error("Error fetching bond entry:", error);
            throw error;
          }
        },
      }),
      createLockableField({
        name: "pycd",
        label: "Vendor",
        type: "select",
        options: "accounts",
        // ExBond: only LC accounts (the "lc_accounts" group).
        apiEndpoint: `/api/accounts/acno?${LC_GROUP_PARAM}`,
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        //lockInEdit: true,
        required: true,
        clearable: true,
        // modalFields: [
        // { name: "name", label: "Vendor Name", type: "text", required: true },
        // ],
      }),
      {
        name: "godown",
        label: "Warehouse",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKey: "godown",
        valueKey: "id",
        required: true,
       
      },
       {
        name: "rmk5", label: "Category", type: "normalSelect",
        defaultValue: { value: "IMPORTED MATERIAL", label: "IMPORTED MATERIAL" },
        options: [
          { value: "IMPORTED MATERIAL", label: "IMPORTED MATERIAL" },
        ],
      },
      { name: "rmk", label: "Narration", type: "textarea" },
      // { name: "ref_dispatch_no", label: "Ref Dispatch No", type: "text" },
    ],

    lineFields: [
      // {
      //   name: "mm",
      //   label: "MM#",
      //   type: "text",
      //   readOnly: true,
      // },
      {
        name: "itcd",
        label: "Product",
        type: "select",
        options: "products",
        // âœ… DYNAMIC ENDPOINT: Filter items by selected Sale Order
        apiEndpoint: (formData, lineData) => {

          const soNo = formData?.so_no?.value || formData?.so_no;

          if (!soNo) {

            return `/api/setup/items`;
          }


          return `/api/forms/items/saleOrderItems?saleOrderNo=${soNo}`;
        },
        createEndpoint: "/api/setup/items",
        nameKeys: ["code", "item"],
        separator: ["-"],
        valueKey: "itcd",
        required: true,
        // âœ… DYNAMIC PLACEHOLDER: Guide user to select SO first
        getPlaceholder: (formData) => {
          const soNo = formData?.so_no?.value || formData?.so_no;
          return soNo
            ? "Select product from Sale Order"
            : "Please select Sale Order first";
        },
        onChange: async (value, line, allLines, formData) => {

          if (!value) return {};

          try {
            // Fetch the item details including its default packing material
            const response = await axios.get(
              `/api/forms/items/${value.value || value}`,
            );
            const batchNoResponse = await axios.get(
              `/api/forms/items/batchNo?itcd=${value.value || value}`,
            );
            const batchNoData = batchNoResponse.data;

            const itemData = response.data;



            // Return the packing material code to auto-populate
            return {
              mm: value?.value || value,
              packing_material_code: itemData.packing_material_code
                ? {

                  value: itemData.itcd,
                  label: itemData.item || "Packing Material",
                }
                : null,
            };
          } catch (error) {
            console.error("Error fetching item packing material:", error);
            return {};
          }
        },
        // modalFields: [//
        // { name: "item", label: "Product Name", type: "text", required: true },
        // {
        // name: "ic_id",
        // label: "Item Category",
        // type: "select",
        // options: "itemCategories",
        // apiEndpoint: "/api/setup/item_categories",
        // valueKey: "id",
        // nameKey: "ic_name",
        // required: true,
        // },
        // ],
      },
      // {
      //   name: "itcd",
      //   label: "Product",
      //   type: "select",
      //   options: "products",
      //   apiEndpoint: "/api/setup/items",
      //   createEndpoint: "/api/setup/items",
      //   nameKey: "item",
      //   valueKey: "itcd",
      //   required: true,
      //   modalFields: [
      //     { name: "item", label: "Product Name", type: "text", required: true },
      //     {
      //       name: "ic_id",
      //       label: "Item Category",
      //       type: "select",
      //       options: "itemCategories",
      //       apiEndpoint: "/api/setup/item_categories",
      //       valueKey: "id",
      //       nameKey: "ic_name",
      //       required: true,
      //     },
      //   ],
      // },
      {
        name: "no_of_pack",
        label: "No of Packs",
        type: "number",
        required: true,
      },
      {
        name: "qty_per_pack",
        label: "Qty Per Pack",
        type: "number",
        required: true,
      },
      // âœ… CHANGED: Use universal qty field with GRN-specific validation
      createGrnQtyField({
        // customValidate: async (value, line, allLines, formData) => {
        //   

        //   if (formData.ref_dispatch_no) {
        //     return null; // Skip validation if ref dispatch no is provided
        //   }

        //   if (!formData.po_no || !line.itcd) {
        //     return "Please select PO and item first";
        //   }

        //   try {
        //     // Fetch PO summary including batch-based QC approvals
        //     const res = await axios.get(
        //       `/api/voucher/checkOrderQty?po_no=${formData.po_no}`,
        //     );

        //     // Ordered quantity for this item
        //     const orderedQty = line.po_qty || 0;

        //     // Approved quantity for this item from QC summary
        //     const itemStatus =
        //       res.data.qc_summary?.item_status?.[line.itcd.value || line.itcd];
        //     const approvedQty = itemStatus?.approvedQty || 0;
        //     

        //     // Remaining quantity available for this item
        //     const balanceQty = orderedQty - approvedQty;
        //     
        //     const numericValue = parseFloat(value) || 0;

        //     // Block input if it exceeds available balance
        //     if (numericValue > approvedQty) {
        //       return `Cannot exceed available quantity (${approvedQty})`;
        //     }

        //     // Optional: block negative values
        //     if (numericValue < 0) {
        //       return "Quantity cannot be negative";
        //     }

        //     return null; // Input is valid
        //   } catch (error) {
        //     console.error("Validation error:", error);
        //     return "Error validating quantity";
        //   }
        // }, 
      }),
      { name: "narration1", label: "Narration", type: "textarea" },
    ],
    totals: {
      totalQty: {
        label: "Total Qty",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
      },
    },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "grn_no", label: "Grn No", type: "text" },
      { name: "user_id", label: "Created By", type: "text", options: true, value1: "user", value2: "name" },
      {
        name: "pycd",
        label: "Vendor",
        type: "text",
        options: true,
        value1: "acno",
        value2: "acname",
      },
      {
        // "1) code - item" per line — built by app/api/voucher/[type] GET (itemsColumn)
        name: "items_description",
        label: "Items",
        type: "text",
        multiline: true,
      },
      {
        name: "rmk3",
        label: "Bill No",
        type: "text",
      },
      {
        name: "qty",
        label: "Total Qty",
        type: "text",
        isInnerTotal: true,
        key: "transactions",
      },
      // { name: "status", label: "Status", type: "status" }, // âœ… ADD THIS
    ],

    allowDelete: false,
    allowPrintSaveButton: false,
    allowPrint: false,
    allowEdit: true,
    allowView: false,
    allowCreate: false,
    allowReturn: false,
    // returnType: "grnReturn",
    allowCheck: false,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // FIXED ASSETS GRN (tran_code 14) — a SEPARATE frontend that reuses the GRN
  // form structure but always posts as a Fixed Asset receipt. It does NOT link
  // to a Purchase Order (direct entry), and its Product dropdown only lists
  // fixed-asset items (via the /api/setup/fixed_asset_items setup entity).
  //
  // tran_code 14 is guaranteed here: the Form's apiMap routes this type to
  // /api/voucher/fixedAssetsGrn, and the voucher API resolves the tran_code from
  // this config. No tran_code field is exposed in the form.
  //
  // The existing `grn` config above is intentionally left untouched.
  // ──────────────────────────────────────────────────────────────────────────
  fixedAssetsGrn: {
    label: "Fixed Assets GRN",
    buttonText: "Create Fixed Assets GRN",
    ModalHeading: "Create Fixed Assets GRN",
    ModalHeadingEdit: "Create Fixed Assets GRN",
    tran_code: 14,
    hasDeductionBlock: false,

    masterFields: [
      {
        name: "rmk3",
        label: "Bill No",
        type: "text",
      },
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },
      createLockableField({
        name: "pycd",
        label: "Vendor",
        type: "select",
        options: "accounts",
        apiEndpoint: "/api/accounts/acno?group=fixed_asset_vendors,vendors",
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        lockInEdit: true,
        required: true,
        // modalFields: [
        // { name: "name", label: "Vendor Name", type: "text", required: true },
        // ],
      }),
      { name: "rmk", label: "Narration", type: "textarea" },
      { name: "ref_dispatch_no", label: "Ref Dispatch No", type: "text" },
      // GRN-level Department (rmk4) + Custody (rmk5), one per GRN.
      {
        name: "rmk4",
        label: "Department",
        type: "select",
        options: "departments",
        apiEndpoint: "/api/setup/departments",
        // nameKeys (not nameKey) so the label resolves from id on edit
        nameKeys: ["dept_name"],
        valueKey: "id",
      },
      {
        name: "rmk5",
        label: "Custody",
        type: "select",
        options: "employees",
        apiEndpoint: (masterData) => {
          const dept = masterData?.rmk4?.value ?? masterData?.rmk4 ?? "";
          return dept
            ? `/api/setup/employees?departmentId=${dept}`
            : `/api/setup/employees`;
        },
        nameKeys: ["firstName", "surname"],
        separator: [" "],
        valueKey: "id",
      },
    ],

    lineFields: [
      {
        name: "mm",
        label: "MM#",
        type: "text",
        readOnly: true,
      },
      // Asset No — generated by the API per asset unit, read-only. Blank while
      // creating (assigned on save); populated when viewing/editing.
      {
        name: "asset_no",
        label: "Asset No",
        type: "text",
        readOnly: true,
      },
      {
        name: "itcd",
        label: "Product",
        type: "select",
        options: "products",
        // Fixed-asset items only — reuses the Fixed Asset item setup entity,
        // which filters to items under the "FIXED ASSET" main category. Anything
        // added via the Fixed Asset Item setup appears here automatically.
        apiEndpoint: "/api/setup/fixed_asset_items",
        createEndpoint: "/api/setup/fixed_asset_items",
        nameKeys: ["code", "itcd", "item"],
        separator: ["-"],
        valueKey: "itcd",
        required: true,
        getPlaceholder: () => "Select fixed asset",
        onChange: async (value) => {
          if (!value) return {};

          try {
            const response = await axios.get(
              `/api/forms/items/${value.value || value}`,
            );
            const itemData = response.data;

            return {
              mm: value?.value || value,
              packing_material_code: itemData.packing_material_code
                ? {
                  value: itemData.itcd,
                  label: itemData.item || "Packing Material",
                }
                : null,
            };
          } catch (error) {
            console.error("Error fetching fixed asset item:", error);
            return {};
          }
        },
        // modalFields: [
        // { name: "item", label: "Product Name", type: "text", required: true },
        // {
        // // Only FA categories
        // name: "ic_id",
        // label: "Item Category",
        // type: "select",
        // options: "itemCategories",
        // apiEndpoint: "/api/setup/fixed_asset_categories",
        // valueKey: "id",
        // nameKey: "ic_name",
        // required: true,
        // },
        // ],
      },
      // Qty is split into that many qty=1 asset rows by the backend.
      {
        name: "qty",
        label: "Qty",
        type: "number",
        required: true,
        validate: async (value) => {
          const qty = Number(value);
          if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
            return "Fixed Asset quantity must be a positive whole number.";
          }
          return null;
        },
      },
      // Cost of ONE unit — each asset row carries it (rate × 1); the Fixed
      // Asset Register takes it as the asset's cost (lib/fixedAssets/register.js).
      { name: "rate", label: "Unit Cost", type: "number" },
      // Per-asset register fields: Make/Warranty/Life Pattern/Life Span.
      { name: "narration2", label: "Make", type: "text" },
      { name: "narration3", label: "Warranty Period", type: "text" },
      {
        // text (not select) to avoid the normalSelect null-crash on empty rows
        name: "narration4",
        label: "Life Pattern",
        type: "text",
        placeholder: "YEARS / PRODUCTION_HOURS / PRODUCTION_UNITS",
      },
      {
        // text (not number) to avoid the currency (PKR) prefix; backend coerces to float
        name: "wht_rate",
        label: "Life Span",
        type: "text",
      },
      { name: "narration1", label: "Narration", type: "textarea" },
    ],

    totals: {
      totalQty: {
        label: "Total Qty",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
      },
    },

    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "user_id", label: "Created By", type: "text", options: true, value1: "user", value2: "name" },
      {
        name: "pycd",
        label: "Vendor",
        type: "text",
        options: true,
        value1: "acno",
        value2: "acname",
      },
      {
        name: "rmk3",
        label: "Bill No",
        type: "text",
      },
      {
        name: "qty",
        label: "Total Qty",
        type: "text",
        isInnerTotal: true,
        key: "orderDetails",
      },
      { name: "status", label: "Status", type: "status" },
    ],

    allowDelete: false,
    allowPrintSaveButton: true,
    allowPrint: false,
    allowEdit: true,
    allowView: true,
    allowCreate: true,
    allowCheck: false,
  },

  // ──────────────────────────────────────────────────────────────────────────
  // FIXED ASSET RELOCATION (tran_code 16) / DISPOSAL (tran_code 15) — ported
  // from Accounting. Saved by lib/fixedAssets/voucher.js (called from the
  // voucher route): one line per asset (party_name = asset number). Never
  // edited or deleted: a relocation is history (post another), a disposal is
  // reversed from Fixed Assets → Register. Relocation needs Settings →
  // Features "fixedAssets.relocation"; a disposal posts its gain / loss
  // journal while "fixedAssets.disposalPosting" is on.
  // ──────────────────────────────────────────────────────────────────────────
  fixedAssetRelocation: {
    label: "Fixed Asset Relocation",
    buttonText: "Create Fixed Asset Relocation",
    ModalHeading: "Create Fixed Asset Relocation",
    ModalHeadingEdit: "Fixed Asset Relocation",
    tran_code: 16,
    hasDeductionBlock: false,
    masterFields: [
      { name: "dated", label: "Date", type: "date", required: true },
      { name: "rmk", label: "Reason / Narration", type: "textarea" },
    ],
    lineFields: [
      {
        name: "party_name",
        label: "Asset No",
        type: "select",
        options: "assets",
        apiEndpoint: "/api/fixed-assets/picker?status=IN_USE",
        nameKeys: ["asset_label", "item", "holder"],
        separator: [" — "],
        valueKey: "asset_no",
        required: true,
        wide: true,
        onChange: async (value) => {
          const no = value?.value ?? value;
          if (!no) return {};
          try {
            const res = await axios.get(`/api/fixed-assets/picker?asset_no=${encodeURIComponent(no)}`);
            const a = (res.data?.data || [])[0];
            return a ? { itcd: { value: String(a.itcd), label: a.item || "" } } : {};
          } catch {
            return {};
          }
        },
      },
      {
        name: "itcd",
        label: "Product",
        type: "select",
        options: "products",
        apiEndpoint: "/api/setup/fixed_asset_items",
        nameKeys: ["code", "item"],
        separator: ["-"],
        valueKey: "itcd",
        readOnly: true,
      },
      {
        name: "narration4",
        label: "New Department",
        type: "select",
        options: "departments",
        apiEndpoint: "/api/setup/departments",
        nameKeys: ["dept_name"],
        valueKey: "id",
      },
      {
        name: "narration5",
        label: "New Employee",
        type: "select",
        options: "employees",
        apiEndpoint: (masterData, lineData) => {
          const dept = lineData?.narration4?.value ?? lineData?.narration4 ?? "";
          return dept ? `/api/setup/employees?departmentId=${dept}` : `/api/setup/employees`;
        },
        nameKeys: ["firstName", "surname"],
        separator: [" "],
        valueKey: "id",
      },
      {
        name: "narration3",
        label: "New Location",
        type: "select",
        options: "workLocations",
        apiEndpoint: "/api/setup/work_locations",
        nameKeys: ["location_name"],
        valueKey: "id",
      },
    ],
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "user_id", label: "Entered By", type: "text", options: true, value1: "user", value2: "name" },
      { name: "rmk", label: "Narration", type: "text" },
      { name: "status", label: "Status", type: "status" },
    ],
    allowDelete: false,
    allowPrintSaveButton: true,
    allowPrint: false,
    allowEdit: false,
    allowView: true,
    allowCreate: true,
    allowCheck: false,
  },

  fixedAssetDisposal: {
    label: "Fixed Asset Disposal",
    buttonText: "Create Fixed Asset Disposal",
    ModalHeading: "Create Fixed Asset Disposal",
    ModalHeadingEdit: "Fixed Asset Disposal",
    tran_code: 15,
    hasDeductionBlock: false,
    masterFields: [
      { name: "dated", label: "Date", type: "date", required: true },
      {
        name: "rmk1",
        label: "Disposal Type",
        type: "normalSelect",
        options: [
          { value: "SALE", label: "Sale" },
          { value: "SCRAP", label: "Scrap" },
        ],
        defaultValue: { value: "SALE", label: "Sale" },
        required: true,
      },
      {
        // Receives the proceeds: a customer (sale) or the cash / bank account.
        name: "pycd",
        label: "Customer / Cash-Bank (proceeds)",
        type: "select",
        options: "accounts",
        apiEndpoint: "/api/accounts/acno?group=customers,cash_bank",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
      },
      { name: "rmk", label: "Reason / Narration", type: "textarea" },
    ],
    lineFields: [
      {
        name: "party_name",
        label: "Asset No",
        type: "select",
        options: "assets",
        apiEndpoint: "/api/fixed-assets/picker?status=IN_USE",
        nameKeys: ["asset_label", "item", "nbv_text"],
        separator: [" — "],
        valueKey: "asset_no",
        required: true,
        wide: true,
        onChange: async (value) => {
          const no = value?.value ?? value;
          if (!no) return {};
          try {
            const res = await axios.get(`/api/fixed-assets/picker?asset_no=${encodeURIComponent(no)}`);
            const a = (res.data?.data || [])[0];
            return a ? { itcd: { value: String(a.itcd), label: a.item || "" } } : {};
          } catch {
            return {};
          }
        },
      },
      {
        name: "itcd",
        label: "Product",
        type: "select",
        options: "products",
        apiEndpoint: "/api/setup/fixed_asset_items",
        nameKeys: ["code", "item"],
        separator: ["-"],
        valueKey: "itcd",
        readOnly: true,
      },
      // Proceeds for this asset (0 for a scrap with nothing received).
      { name: "rate", label: "Proceeds", type: "number" },
    ],
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "user_id", label: "Entered By", type: "text", options: true, value1: "user", value2: "name" },
      { name: "rmk1", label: "Type", type: "text" },
      { name: "pycd", label: "Customer / Account", type: "text", options: true, value1: "acno", value2: "acname" },
      { name: "status", label: "Status", type: "status" },
    ],
    allowDelete: false,
    allowPrintSaveButton: true,
    allowPrint: false,
    allowEdit: false,
    allowView: true,
    allowCreate: true,
    allowCheck: false,
  },

  dispatch: {
    buttonText: "",
    ModalHeading: "Create Dispatch",
    ModalHeadingEdit: "Create Dispatch",
    differTitle: "Total Dispatches",
    // Quantity only — priced on Sale Invoicing. (Rows here are Sale Orders.)
    qtyOnly: true,
    // Produce-on-dispatch: each line shows its BOM (scaled to the line qty,
    // editable per dispatch) and sends it as line.materials — Form.jsx.
    lineBom: true,
    // Services panel (freight …) → linked Service Invoices, saved with the dispatch.
    documentServices: "DISPATCH",
    //differApi: "/api/orders/saleOrder",
    differApi: "/api/orders/saleOrder?activeOnly=true",
    tran_code: 6,
    hasDeductionBlock: false,
    // Preview of the next Dispatch No on create — display only, see /api/voucher/next-number
    nextNumber: { fieldName: "dispatch_no", type: "dispatch" },

    //status active only commit
   //  differApi: "/api/orders/saleOrder?activeOnly=true",

    // âœ… ADD THIS: Source mapping for auto-population
    sourceMapping: {
      type: "saleOrder",
      sourceApi: "/api/orders/saleOrder",
      fieldMappings: {
        master: [
          {
            source: "order_no",
            target: "so_no",
            transform: (value) => value,
          },
          {
            source: "party_code",
            target: "pycd",
            transform: (value) => value,
          },
          {
            source: "acno",
            target: "acno",
            transform: (value) => value,
          },
          {
            source: null,
            target: "godown",
            transform: () => ({
              value: "3",
              label: "3 - DESPATCH",
            }),
          }
        ],
        // lines: [
        //   {
        //     source: "itcd",
        //     target: "itcd",
        //     transform: (value) => value,
        //   },
        //   {
        //     source: "qty",
        //     target: "qty",
        //     transform: (value) => value || 0,
        //   },
        //   {
        //     source: "qty",
        //     target: "so_qty",
        //     transform: (value) => value || 0,
        //   },
        //   {
        //     source: "no_of_packs",
        //     target: "no_of_pack",
        //     transform: (value) => value || 0,
        //   },
        //   {
        //     source: "qty_per_pack",
        //     target: "qty_per_pack",
        //     transform: (value) => value || 0,
        //   },
        //   {
        //     source: "rate",
        //     target: "rate",
        //     transform: (value) => value || 0,
        //   },
        //   {
        //     source: "amount",
        //     target: "gross_amount",
        //     transform: (value) => value || 0,
        //   },
        //   {
        //     source: "amount",
        //     target: "camt",
        //     transform: (value) => value || 0,
        //   },
        // ],
      },
    },

    masterFields: [
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },
      {
        name: "dispatch_no",
        label: "Dispatch No",
        type: "text",
        readOnly: true,
      },
      createLockableField({
        name: "so_no",
        label: "Sale Order No",
        type: "select",
        options: "saleOrders",
        // activeOnly=true: exclude orders where all items are manually closed (status=2)
        apiEndpoint: "/api/orders/saleOrder?activeOnly=true",
        nameKey: "order_no",
        valueKey: "order_no",
        lockInEdit: true,
        // Required while Features "dispatch.withoutSaleOrder" = refused
        requiredBy: { key: "dispatch.withoutSaleOrder", value: "refused" },
        // Customer + the order's open lines; the godown is left alone.
        onChange: async (value, formData) => dispatchSaleOrderChanged(value, formData),
      }),
      createLockableField({
        name: "pycd",
        label: "Customer",
        type: "select",
        options: "accounts",
        apiEndpoint: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`,
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        lockInEdit: true,
        required: true,
        // modalFields: [
        // {
        // name: "name",
        // label: "Customer Name",
        // type: "text",
        // required: true,
        // },
        // ],
      }),
      {
        name: "godown",
        label: "Warehouse",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKeys: ["id", "godown"],
        valueKey: "id",
        required: true,
        defaultValue: { value: "3", label: "3 - DESPATCH" }
        // modalFields: [
        // {
        // name: "godown",
        // label: "Warehouse Name",
        // type: "text",
        // required: true,
        // },
        // ],
      },
      // Produce-on-dispatch: the godown each line's BOM materials are issued
      // from (lib/dispatch/bomProduction.js). Required only when a line
      // carries materials — checked in Form.jsx validateForm (lineBom).
      DISPATCH_ISSUE_GODOWN_FIELD,
      MANUAL_DC_NO_FIELD,
      // Freight is billed as a Service Invoice linked to the dispatch — no
      // transporter / amount here.
      { name: "rmk4", label: "Vehicle No", type: "text", uppercase: true },
      DISPATCH_CITY_FIELD,
      DISPATCH_ROUTE_FIELD,
      LEGACY_DOC_FIELD,
      { name: "rmk", label: "Narration", type: "textarea", fullWidth: true },
    ],

    //linefields for dispatch

    lineFields: [
      // {
      //   name: "mm",
      //   label: "MM#",
      //   type: "text",
      //   readOnly: true,
      // },
      {
        name: "itcd",
        label: "Product",
        type: "select",
        options: "products",
        // âœ… DYNAMIC ENDPOINT: Filter items by selected Sale Order
        apiEndpoint: (formData, lineData) => {

          const soNo = formData?.so_no?.value || formData?.so_no;

          if (!soNo) {

            return `/api/setup/items`;
          }


          return `/api/forms/items/saleOrderItems?saleOrderNo=${soNo}`;
        },
        createEndpoint: "/api/setup/items",
        nameKeys: ["code", "item"],
        separator: ["-"],
        valueKey: "itcd",
        required: true,
        // âœ… DYNAMIC PLACEHOLDER: the Sale Order is optional — without one
        // every item can be dispatched (produced from its BOM on the spot).
        getPlaceholder: (formData) => {
          const soNo = formData?.so_no?.value || formData?.so_no;
          return soNo
            ? "Select product from Sale Order"
            : "Select product";
        },
        onChange: async (value, line, allLines, formData) => {

          if (!value) return {};

          try {
            // Fetch the item details including its default packing material
            const response = await axios.get(
              `/api/forms/items/${value.value || value}`,
            );
            // Exact itcd match — `search` also matched item codes/names that
            // merely CONTAIN the number, so the wrong SO line (and its unit)
            // could come back first. Only when a Sale Order is linked: a
            // direct dispatch has none to look in.
            const soNo = formData?.so_no?.value || formData?.so_no;
            let rateAndStData = {};
            if (soNo) {
              try {
                const resRateAndSt = await axios.get(
                  `/api/forms/items/saleOrderItems?saleOrderNo=${soNo}&itcd=${value.value || value}`,
                );
                rateAndStData = resRateAndSt.data || {};
              } catch (soErr) {
                console.error("Error fetching sale order line:", soErr);
              }
            }

            const itemData = response.data;

            // Packing: the item's own default packing material, else none.
            let pmOption = null;
            if (itemData.packing_material_code) {
              try {
                const pmResponse = await axios.get(
                  `/api/forms/items/${itemData.packing_material_code}`
                );
                pmOption = {
                  value: String(itemData.packing_material_code),
                  label: pmResponse.data?.item
                    ? `${itemData.packing_material_code} - ${pmResponse.data.item}`
                    : String(itemData.packing_material_code),
                };
              } catch (pmErr) {
                console.error("Error fetching packing material name:", pmErr);
                pmOption = {
                  value: String(itemData.packing_material_code),
                  label: "Packing Material",
                };
              }
            }

            // The Sale Order line for this item decides the unit when there
            // is an order; a direct dispatch keeps the unit picked on the line.
            // See lib/units/litres.js.
            const soLine = rateAndStData.data?.[0] || {};
            const unit = soNo
              ? (isLitreUnit(soLine.unit) ? UNIT_LTR : UNIT_KG)
              : (isLitreUnit(line?.unit) ? UNIT_LTR : UNIT_KG);

            // No rate: the dispatch is quantity only (priced on Sale Invoicing).
            return {
              mm: value?.value || value,
              packing_material_code: pmOption,
              unit,
              // Carried onto the line so Qty (KG) can be derived and the save
              // can be refused when the conversion is missing.
              ltr_rate: soLine.ltr_rate ?? itemData.ltr_rate ?? null,
              item_name: itemData.item || "",
              __warn:
                unit === UNIT_LTR && !hasLtrRate(soLine.ltr_rate ?? itemData.ltr_rate)
                  ? missingLtrRateMessage(itemData.item)
                  : undefined,
            };
          } catch (error) {
            console.error("Error fetching item packing material:", error);
            return {};
          }
        },
        // modalFields: [//
        // { name: "item", label: "Product Name", type: "text", required: true },
        // {
        // name: "ic_id",
        // label: "Item Category",
        // type: "select",
        // options: "itemCategories",
        // apiEndpoint: "/api/setup/item_categories",
        // valueKey: "id",
        // nameKey: "ic_name",
        // required: true,
        // },
        // ],
      },
      {
        name: "packing_material",
        formName: "packing_material_code",
        label: "Packing Material",
        type: "select",
        options: "packingMaterials",
        apiEndpoint: "/api/setup/all-packing-materials",
        createEndpoint: "/api/setup/items",
        nameKey: "item",
        // "itcd - name"; the list searches name, code and itcd.
        nameKeys: ["itcd", "item"],
        valueKey: "itcd",
        required: false,
        visibility: {
          dependsOn: "itcd",
          condition: "truthy",
        },
      },
      {
        name: "returnable",
        label: "Returnable?",
        type: "checkbox",
        labelText: "YES",
      },
      // {
      //   name: "batch_no",
      //   label: "Batch No",
      //   type: "select",
      //   options: "batchNumbers",
      //   valueKey: "batch_no",
      //   nameKey: "label",
      //   apiEndpoint: (formData, lineData) => {
      //     const itcd = lineData?.itcd?.value || lineData?.itcd;
      //     const godown = formData?.godown?.value || formData?.godown;
      //     if (!itcd) return null;
      //     return `/api/batch/available?itcd=${itcd}${godown ? `&godown=${godown}` : ""}`;
      //   },
      //   getPlaceholder: (lineData) =>
      //     (lineData?.itcd?.value || lineData?.itcd) ? "Select batch" : "Select item first",
      //   visibility: { dependsOn: "itcd", condition: "truthy" },
      // },
      // Optional, typed — same rule on Create and New / Edit Dispatch;
      // required while Features "dispatch.batchRequired" is on.
      { name: "batch_no", label: "Batch No", type: "text", requiredBy: { key: "dispatch.batchRequired" } },
      {
        name: "no_of_pack",
        label: "No of Packs",
        type: "number",
        required: true,
      },
      {
        name: "qty_per_pack",
        label: "Qty Per Pack",
        type: "number",
        required: true,
      },
      // ── Unit and quantity ──────────────────────────────────────────────
      // Against a Sale Order the unit is the order's (read-only); a direct
      // dispatch line picks KG or LTR.
      DISPATCH_UNIT_FIELD,
      // Packs drive BOTH quantities. On a LTR line No of Packs × Qty Per Pack
      // is litres (2 drums × 20 = 40 LTR) and the KG is converted from that;
      // on a KG line it is the KG directly, exactly as dispatch always worked.
      {
        name: "qty_ltr",
        label: "Qty (LTR)",
        type: "number",
        width: "120px",
        dependencies: ["no_of_pack", "qty_per_pack", "unit"],
        readOnly: true,
        calculate: (a, b) => {
          const line = calcLine(a, b);
          if (!isLitreUnit(line.unit)) return "";
          return packTotal(line);
        },
        validate: (value, line) => {
          if (!isLitreUnit(line?.unit)) return null;
          if (!(parseFloat(value) > 0)) return "Enter the packs — litres come from them";
          // Hard stop, unlike the Sale Order: a dispatch moves stock, so it
          // cannot be posted without a way to state the movement in KG.
          if (!hasLtrRate(line?.ltr_rate)) {
            return missingLtrRateMessage(line?.item_name);
          }
          return null;
        },
      },
      // The ONE Qty (KG) column: LTR-aware, plus stock and SO-balance checks
      // per item across all lines. (There used to be a second `qty` field
      // here too, which showed two Qty (KG) columns and overwrote the KG of a
      // LTR line with the litres.)
      createDispatchQtyField(),
    ],
    totals: {
      totalQty: {
        label: "Total Qty (KG)",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
      },
      totalQtyLtr: {
        label: "Total Qty (LTR)",
        showWhen: (lines) => lines.some((l) => isLitreUnit(l?.unit)),
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty_ltr || 0), 0),
      },
    },

    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "order_no", label: "ISO", type: "text" },
      // { name: "dispatch_no", label: "Dispatch No", type: "text" },
      { name: "userid", label: "Created By", type: "text", options: true, value1: "users", value2: "name" },
      // { name: "userid", label: "Created By", type: "text" },
      {
        name: "pycd",
        label: "Customer",
        type: "text",
        options: true,
        value1: "acno",
        value2: "acname",
      },
      {
        name: "qty",
        label: "Total Qty",
        type: "text",
        isInnerTotal: true,
        key: "orderDetails",
      },
      { name: "status", label: "Status", type: "status" },
    ],

    allowDelete: false,
    allowPrintSaveButton: true,
    allowPrint: true,
    allowEdit: false,
    allowView: false,
    allowCreate: true,
    allowCheck: false,
    // Rows here are Sale Orders; a dispatch is made from them, never cloned.
    allowClone: false,
  },
  dispatchEdit: {
    // Standalone create from the dispatch list: a Sale Order is optional.
    // Opens an empty form (Modal.jsx handleOpen) that POSTs to
    // /api/voucher/dispatch like Create Dispatch from a Sale Order row.
    buttonText: "New Dispatch",
    ModalHeading: "New Dispatch",
    ModalHeadingEdit: "Edit Dispatch",
    differTitle: "Total Dispatches",
    lineBom: true,
    documentServices: "DISPATCH",
    // Physical document: no rate / amount; invoiced on the Invoicing screen.
    qtyOnly: true,
    invoiceLock: true,
    // differApi: "/api/orders/saleOrder",
    tran_code: 6,
    // Preview of the next Dispatch No on New Dispatch — display only.
    nextNumber: { fieldName: "dispatch_no", type: "dispatch" },
    hasDeductionBlock: false,

    // âœ… ADD THIS: Source mapping for auto-population
    // sourceMapping: {
    //   type: "saleOrder",
    //   sourceApi: "/api/orders/saleOrder",
    //   fieldMappings: {
    //     master: [
    //       {
    //         source: "order_no",
    //         target: "so_no",
    //         transform: (value) => value,
    //       },
    //       {
    //         source: "party_code",
    //         target: "pycd",
    //         transform: (value) => value,
    //       },
    //       {
    //         source: "acno",
    //         target: "acno",
    //         transform: (value) => value,
    //       },
    //     ],
    //     // lines: [
    //     //   {
    //     //     source: "itcd",
    //     //     target: "itcd",
    //     //     transform: (value) => value,
    //     //   },
    //     //   {
    //     //     source: "qty",
    //     //     target: "qty",
    //     //     transform: (value) => value || 0,
    //     //   },
    //     //   {
    //     //     source: "qty",
    //     //     target: "so_qty",
    //     //     transform: (value) => value || 0,
    //     //   },
    //     //   {
    //     //     source: "no_of_packs",
    //     //     target: "no_of_pack",
    //     //     transform: (value) => value || 0,
    //     //   },
    //     //   {
    //     //     source: "qty_per_pack",
    //     //     target: "qty_per_pack",
    //     //     transform: (value) => value || 0,
    //     //   },
    //     //   {
    //     //     source: "rate",
    //     //     target: "rate",
    //     //     transform: (value) => value || 0,
    //     //   },
    //     //   {
    //     //     source: "amount",
    //     //     target: "gross_amount",
    //     //     transform: (value) => value || 0,
    //     //   },
    //     //   {
    //     //     source: "amount",
    //     //     target: "camt",
    //     //     transform: (value) => value || 0,
    //     //   },
    //     // ],
    //   },
    // },

    masterFields: [
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },
      { name: "dispatch_no", label: "Dispatch No", type: "text", readOnly: true },
      createLockableField({
        name: "so_no",
        label: "Sale Order No",
        type: "select",
        options: "saleOrders",
        // Same list as Create Dispatch: approved orders with an open line.
        apiEndpoint: "/api/orders/saleOrder?activeOnly=true",
        nameKey: "order_no",
        valueKey: "order_no",
        lockInEdit: false,
        requiredBy: { key: "dispatch.withoutSaleOrder", value: "refused" },
        // Same as Create Dispatch: customer + open (non-closed) lines; the
        // godown is never overwritten.
        onChange: async (value, formData) => dispatchSaleOrderChanged(value, formData),
      }),
      createLockableField({
        name: "pycd",
        label: "Customer",
        type: "select",
        options: "accounts",
        apiEndpoint: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`,
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        lockInEdit: true,
        required: true,
        // modalFields: [
        // {
        // name: "name",
        // label: "Customer Name",
        // type: "text",
        // required: true,
        // },
        // ],
      }),
      {
        name: "godown",
        label: "Warehouse",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKey: "godown",
        valueKey: "id",
        required: true,
        // New Dispatch only — an edit keeps the saved godown.
        defaultValue: { value: "3", label: "3 - DESPATCH" },
        // modalFields: [
        // {
        // name: "godown",
        // label: "Warehouse Name",
        // type: "text",
        // required: true,
        // },
        // ],
      },
      DISPATCH_ISSUE_GODOWN_FIELD,
      MANUAL_DC_NO_FIELD,
      // Freight is billed as a Service Invoice linked to the dispatch.
      { name: "rmk4", label: "Vehicle No", type: "text", uppercase: true },
      DISPATCH_CITY_FIELD,
      DISPATCH_ROUTE_FIELD,
      LEGACY_DOC_FIELD,
      { name: "rmk", label: "Narration", type: "textarea", fullWidth: true },
    ],

    lineFields: [
      //dispatchEdit
      // {
      //   name: "mm",
      //   label: "MM#",
      //   type: "text",
      //   readOnly: true,
      // },
      {
        name: "itcd",
        label: "Product",
        type: "select",
        options: "products",
        // âœ… DYNAMIC ENDPOINT: Filter items by selected Sale Order
        apiEndpoint: (formData, lineData) => {

          const soNo = formData?.so_no?.value || formData?.so_no;

          if (!soNo) {

            return `/api/setup/items`;
          }


          return `/api/forms/items/saleOrderItems?saleOrderNo=${soNo}`;
        },
        createEndpoint: "/api/setup/items",
        nameKeys: ["code", "item"],
        separator: ["-"],
        valueKey: "itcd",
        required: true,
        // âœ… DYNAMIC PLACEHOLDER: Guide user to select SO first
        getPlaceholder: (formData) => {
          const soNo = formData?.so_no?.value || formData?.so_no;
          return soNo
            ? "Select product from Sale Order"
            : "Select product";
        },
        onChange: async (value, line, allLines, formData) => {

          if (!value) return {};

          try {
            // Fetch the item details including its default packing material
            const response = await axios.get(
              `/api/forms/items/${value.value || value}`,
            );
            const itemData = response.data;

            let pmOption = null;
            if (itemData.packing_material_code) {
              try {
                const pmResponse = await axios.get(
                  `/api/forms/items/${itemData.packing_material_code}`
                );
                pmOption = {
                  value: String(itemData.packing_material_code),
                  label: pmResponse.data?.item
                    ? `${itemData.packing_material_code} - ${pmResponse.data.item}`
                    : String(itemData.packing_material_code),
                };
              } catch (pmErr) {
                console.error("Error fetching packing material name:", pmErr);
                pmOption = {
                  value: String(itemData.packing_material_code),
                  label: "Packing Material",
                };
              }
            }

            // The Sale Order line decides the unit, exactly as on Create
            // Dispatch. Looked up by exact itcd, not a text search.
            let soLine = {};
            const soNo = formData?.so_no?.value || formData?.so_no;
            if (soNo) {
              try {
                const soRes = await axios.get(
                  `/api/forms/items/saleOrderItems?saleOrderNo=${soNo}&itcd=${value.value || value}`,
                );
                soLine = soRes.data?.data?.[0] || {};
              } catch (soErr) {
                console.error("Error fetching sale order line:", soErr);
              }
            }
            const unit = soNo
              ? (isLitreUnit(soLine.unit) ? UNIT_LTR : UNIT_KG)
              : (isLitreUnit(line?.unit) ? UNIT_LTR : UNIT_KG);
            const ltrRate = soLine.ltr_rate ?? itemData.ltr_rate ?? null;

            // No rate: the dispatch is quantity only (priced on Sale Invoicing).
            return {
              mm: value?.value || value,
              packing_material_code: pmOption,
              unit,
              ltr_rate: ltrRate,
              item_name: itemData.item || "",
              __warn:
                unit === UNIT_LTR && !hasLtrRate(ltrRate)
                  ? missingLtrRateMessage(itemData.item)
                  : undefined,
            };
          } catch (error) {
            console.error("Error fetching item packing material:", error);
            return {};
          }
        },
        // modalFields: [
        // { name: "item", label: "Product Name", type: "text", required: true },
        // {
        // name: "ic_id",
        // label: "Item Category",
        // type: "select",
        // options: "itemCategories",
        // apiEndpoint: "/api/setup/item_categories",
        // valueKey: "id",
        // nameKey: "ic_name",
        // required: true,
        // },
        // ],
      },
      {
        name: "packing_material",
        formName: "packing_material_code",
        label: "Packing Material",
        type: "select",
        options: "packingMaterials",
        apiEndpoint: "/api/setup/all-packing-materials",
        createEndpoint: "/api/setup/items",
        nameKey: "item",
        // "itcd - name"; the list searches name, code and itcd.
        nameKeys: ["itcd", "item"],
        valueKey: "itcd",
        required: false,
        visibility: {
          dependsOn: "itcd",
          condition: "truthy",
        },
      },
      {
        name: "returnable",
        label: "Returnable?",
        type: "checkbox",
        labelText: "YES",
      },
      // {
      //   name: "batch_no",
      //   label: "Batch No",
      //   type: "select",
      //   options: "batchNumbers",
      //   valueKey: "batch_no",
      //   nameKey: "label",
      //   apiEndpoint: (formData, lineData) => {
      //     const itcd = lineData?.itcd?.value || lineData?.itcd;
      //     const godown = formData?.godown?.value || formData?.godown;
      //     if (!itcd) return null;
      //     return `/api/batch/available?itcd=${itcd}${godown ? `&godown=${godown}` : ""}`;
      //   },
      //   getPlaceholder: (lineData) =>
      //     (lineData?.itcd?.value || lineData?.itcd) ? "Select batch" : "Select item first",
      //   visibility: { dependsOn: "itcd", condition: "truthy" },
      // },
      // Typed, like Create Dispatch (required while "dispatch.batchRequired" is on)
      {
        name: "batch_no",
        label: "Batch No",
        type: "text",
        requiredBy: { key: "dispatch.batchRequired" },
      },
      {
        name: "no_of_pack",
        label: "No of Packs",
        type: "number",
        required: true,
      },
      {
        name: "qty_per_pack",
        label: "Qty Per Pack",
        type: "number",
        required: true,
      },
      // ── Unit and quantity — identical to Create Dispatch ───────────────
      // This used to be a single "Quantity = packs × per pack" field, so
      // editing a LTR dispatch saved the LITRES into the KG column and left
      // qty_ltr stale. The unit now comes from the Sale Order (or the stored
      // line), packs give litres on a LTR line, and KG is converted from them.
      DISPATCH_UNIT_FIELD,
      {
        name: "qty_ltr",
        label: "Qty (LTR)",
        type: "number",
        width: "120px",
        dependencies: ["no_of_pack", "qty_per_pack", "unit"],
        readOnly: true,
        calculate: (a, b) => {
          const line = calcLine(a, b);
          if (!isLitreUnit(line.unit)) return "";
          return packTotal(line);
        },
        validate: (value, line) => {
          if (!isLitreUnit(line?.unit)) return null;
          if (!(parseFloat(value) > 0)) return "Enter the packs — litres come from them";
          if (!hasLtrRate(line?.ltr_rate)) return missingLtrRateMessage(line?.item_name);
          return null;
        },
      },
      // Same single Qty (KG) field as Create Dispatch: LTR-aware, and checks
      // stock + SO balance per item across lines, giving back this dispatch's
      // own saved quantity so an edit is not counted twice.
      createDispatchQtyField(),
    ],


    totals: {
      totalQty: {
        label: "Total Qty (KG)",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
      },
      totalQtyLtr: {
        label: "Total Qty (LTR)",
        showWhen: (lines) => lines.some((l) => isLitreUnit(l?.unit)),
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty_ltr || 0), 0),
      },
    },

    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "dispatch_no", label: "Dispatch No", type: "text" },
      { name: "manual_no", label: "Manual DC No", type: "text" },
      { name: "pycd", label: "Customer", type: "text", options: true, value1: "acno", value2: "acname" },
      { name: "godown", label: "Godown", type: "text", options: true, value1: "godownDetails", value2: "godown" },
      { name: "rmk4", label: "Vehicle", type: "text" },
      { name: "city", label: "City", type: "text" },
      { name: "route", label: "Route", type: "text" },
      {
        name: "qty",
        label: "Total Qty",
        type: "text",
        isInnerTotal: true,
        key: "transactions",
      },
      INVOICED_COLUMN,
    ],

    allowDelete: false,
    allowPrintSaveButton: false,
    allowPrint: false,
    allowEdit: true,
    allowReturn: true,
    // One Dispatch Return per dispatch, filled from this row.
    returnType: "saleReturn",
    // Cloning a numbered, possibly invoiced dispatch is not allowed.
    allowClone: false,
    allowCheck: true,
    bulkPrint: true,
  },

  materialIssue: {
    buttonText: "Create Material Issue",
    ModalHeading: "Create Material Issue",
    ModalHeadingEdit: "Edit Material Issue",
    hasDeductionBlock: false,
    tran_code: 7,
    masterFields: [
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },

      {
        name: "godown",
        label: "Godown",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKeys: ["id","godown"],
        separator:"-",
        valueKey: "id",
        required: true,
        // modalFields: [
        // {
        // name: "godown",
        // label: "Godown Name",
        // type: "text",
        // required: true,
        // },
        // ],
      },
      { name: "rmk5", label: "Production #", type: "text" },
      {
        name: "rmk1",
        label: "Reason",
        type: "normalSelect",
        options: [
          { value: "LAB TESTING", label: "5 - LAB TESTING" },
          { value: "DIFF-ADJ/WASTAGE", label: "6 - DIFF-ADJ/WASTAGE"},
          { value: "PROD-CONSUMED", label: "7 - PROD-CONSUMED" },
          { value: "STORES-CONSUMED", label: "8 - STORES-CONSUMED" },
        ],
      },
      { name: "rmk2", label: "Narration", type: "text" },
      { name: "rmk", label: "Outsourced", type: "text", readOnly: true },
    ],

    lineFields: [
      {
        name: "itcd",
        label: "Product",
        type: "select",
        options: "products",
        apiEndpoint: "/api/setup/items",
        createEndpoint: "/api/setup/items",
        nameKeys: ["code", "item"],
        valueKey: "itcd",
        required: true,
        // modalFields: [
        // { name: "item", label: "Product Name", type: "text", required: true },
        // {
        // name: "ic_id",
        // label: "Item Category",
        // type: "select",
        // options: "itemCategories",
        // apiEndpoint: "/api/setup/item_categories",
        // valueKey: "id",
        // nameKey: "ic_name",
        // required: true,
        // },
        // ],
      },
      {
        name: "batch_no",
        label: "Batch #",
        type: "select",
        options: "batchNumbers",
        valueKey: "batch_no",
        nameKey: "label",
        apiEndpoint: (formData, lineData) => {
          const itcd = lineData?.itcd?.value || lineData?.itcd;
          const godown = formData?.godown?.value || formData?.godown;
          if (!itcd) return null;
          return `/api/batch/available?itcd=${itcd}${godown ? `&godown=${godown}` : ""}`;
        },
        getPlaceholder: (lineData) =>
          (lineData?.itcd?.value || lineData?.itcd) ? "Select batch" : "Select item first",
        visibility: { dependsOn: "itcd", condition: "truthy" },
      },
      {
        name: "qty",
        label: "Qty",
        type: "number",
        required: true,
      },
      { name: "narration3", label: "Narration", type: "text" },
    ],
    totals: {
      totalQty: {
        label: "Total Qty",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
      },
    },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "tran_id", label: "Transaction #", type: "text" },
      { name: "rmk5", label: "Production #", type: "text" },
      {
        name: "qty",
        label: "Total Qty",
        type: "text",
        isInnerTotal: true,
        key: "transactions",
      },
    ],
    allowDelete: false,
    allowPrint: true,
    allowEdit: true,
    allowView: true,
    allowCheck: false,
  },

  materialInput: {
    buttonText: "Create Material Input",
    ModalHeading: "Create Material Input",
    ModalHeadingEdit: "Edit Material Input",
    hasDeductionBlock: false,
    tran_code: 8,
    masterFields: [
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },

      {
        name: "godown",
        label: "Godown",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKeys: ["id","godown"],
        valueKey: "id",
        required: true,
        // modalFields: [
        // {
        // name: "godown",
        // label: "Godown Name",
        // type: "text",
        // required: true,
        // },
        // ],
      },
      { name: "rmk2", label: "Delivery No", type: "text" },
      { name: "tran_id", label: "Transaction #", type: "text" },
      { name: "rmk5", label: "Production #", type: "text" },
      { name: "rmk4", label: "M2M", type: "text", readOnly: true },
    ],
    lineFields: [
      {
        name: "itcd",
        label: "Product",
        type: "select",
        options: "products",
        apiEndpoint: (formData) =>
          formData.po_no ? `/api/orders/purchaseOrder` : "/api/setup/items",
        createEndpoint: "/api/setup/items",
        nameKey: "item",
        valueKey: "itcd",
        required: true,
        // modalFields: [
        // { name: "item", label: "Product Name", type: "text", required: true },
        // {
        // name: "ic_id",
        // label: "Item Category",
        // type: "select",
        // options: "itemCategories",
        // apiEndpoint: "/api/setup/item_categories",
        // valueKey: "id",
        // nameKey: "ic_name",
        // required: true,
        // },
        // ],
      },
      {
        name: "batch_no",
        label: "Batch #",
        type: "text",
      },
      {
        name: "qty",
        label: "Qty",
        type: "number",
        required: true,
      },
    ],
    totals: {
      totalQty: {
        label: "Total Qty",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
      },
    },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "tran_id", label: "Transaction #", type: "text", readOnly: true },
      { name: "rmk5", label: "Production #", type: "text" },
      {
        name: "qty",
        label: "Total Qty",
        type: "text",
        isInnerTotal: true,
        key: "transactions",
      },
    ],
    allowDelete: false,
    allowPrint: true,
    allowEdit: true,
    allowView: true,
    allowCheck: false,
  },
  requisition: {
    buttonText: "Create Requisitions",
    ModalHeading: "Create Requisition",
    ModalHeadingEdit: "Edit Requisition",
    tran_code: 1000,
    hasDeductionBlock: false,

    masterFields: [
      {
        name: "req_catagory",
        label: "Requisition Category",
        type: "normalSelect",
        defaultValue: { value: "PURCHASE", label: "PURCHASE" },
        options: [
          { value: "TRANSFER", label: "TRANSFER" },
          { value: "PURCHASE", label: "PURCHASE" },
          { value: "SERVICE", label: "SERVICE" },
        ],
        required: true,
      },
      {
        name: "dated",
        label: "Requisition Date",
        type: "date",
        required: true,
      },
      {
        name: "userid",
        label: "Requested By",
        type: "text",
        user: true,
        required: true,
        readOnly: true,
      },
      {
        name: "issued_by",
        label: "Required By (Warehouse)",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKey: "godown",
        valueKey: "id",
        required: true,
      },
      {
        name: "app_date",
        label: "Approval Date",
        type: "date",
        readOnly: true,
      },
      {
        name: "issued_for",
        label: "Required From (Godown)",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKey: "godown",
        valueKey: "id",
        required: true,
        validate: (value, masterData) => {
          if (value === masterData?.issued_by?.value) {
            return "Godown 'Required From' and 'Required By' cannot be the same.";
          }
          return null;
        },
        // ðŸ‘‡ VISIBILITY CONDITION: Only show when req_category is TRANSFER
        visibility: {
          dependsOn: "req_catagory",
          condition: "equals",
          value: "TRANSFER",
        },
      },
    ],
    lineFields: [
      {
        name: "itcd",
        label: "Item",
        type: "select",
        options: "products",
        apiEndpoint: "/api/setup/items",
        createEndpoint: "/api/setup/items",
        nameKey: "item",
        valueKey: "itcd",
        required: false,
        // modalFields: [
        // { name: "item", label: "Item Name", type: "text", required: true },
        // {
        // name: "ic_id",
        // label: "Item Category",
        // type: "select",
        // options: "itemCategories",
        // apiEndpoint: "/api/setup/item_categories",
        // valueKey: "id",
        // nameKey: "ic_name",
        // required: true,
        // },
        // ],
        visibility: {
          dependsOn: "req_catagory",
          condition: "notEquals",
          value: "SERVICE",
        },
      },
      {
        name: "id",
        label: "Service",
        type: "select",
        options: "services",
        apiEndpoint: "/api/setup/services",
        createEndpoint: "/api/setup/services",
        nameKey: "service_name",
        valueKey: "id",
        required: false,
        visibility: {
          dependsOn: "req_catagory",
          condition: "equals",
          value: "SERVICE",
        },
      },
      {
        name: "qty",
        label: "Quantity",
        type: "number",
      },

      {
        name: "ap_qty",
        label: "Approved Qty",
        type: "number",
        readOnly: true,
      },
    ],
    totals: {
      totalQty: {
        label: "Total Requested Qty",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
      },
      // totalApprovedQty: {
      //   label: "Total Approved Qty",
      //   calculate: (lines) =>
      //     lines.reduce((sum, l) => sum + (l.ap_qty || 0), 0),
      // },
    },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "tran_id", label: "Requisition No", type: "text" },
      { name: "userid", label: "Requested By", type: "text" },
      { name: "req_catagory", label: "Category", type: "text" },

      {
        name: "issued_by",
        label: "Godown",
        type: "text",
        options: true,
        value1: "godown2Details",
        value2: "godown",
      },
      {
        name: "qty",
        label: "Total Qty",
        type: "text",
        isInnerTotal: true,
        key: "details",
      },
      { name: "status", label: "Status", type: "status" }, // âœ… ADD THIS
    ],

    allowDelete: false,
    allowPrint: true,
    allowEdit: true,
    allowView: true,
    allowCheck: false,
  },
  requisitionTransfer: {
    buttonText: "Create Transfer Requisitions",
    ModalHeading: "Create Transfer Requisition",
    ModalHeadingEdit: "Edit Transfer Requisition",
    tran_code: 1000,
    hasDeductionBlock: false,
    differApi: "/api/material/requisition?category=TRANSFER",


    masterFields: [
      {
        name: "req_catagory",
        label: "Requisition Category",
        type: "normalSelect",
        defaultValue: { value: "TRANSFER", label: "TRANSFER" },
        options: [
          { value: "TRANSFER", label: "TRANSFER" },
        ],
        required: true,
      },
      {
        name: "dated",
        label: "Requisition Date",
        type: "date",
        required: true,
      },
      {
        name: "userid",
        label: "Requested By",
        type: "text",
        user: true,
        required: true,
        readOnly: true,
      },
      {
        name: "issued_by",
        label: "Required By (Warehouse)",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKey: "godown",
        valueKey: "id",
        defaultValue: { value: "2", label: "PLANT" },
        required: true,
      },

      {
        name: "issued_for",
        label: "Required From (Godown)",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKey: "godown",
        valueKey: "id",
        required: true,
        defaultValue: { value: "1", label: "FACTORY" },
        validate: (value, masterData) => {
          if (value === masterData?.issued_by?.value) {
            return "Godown 'Required From' and 'Required By' cannot be the same.";
          }
          return null;
        },
        // ðŸ‘‡ VISIBILITY CONDITION: Only show when req_category is TRANSFER
        visibility: {
          dependsOn: "req_catagory",
          condition: "equals",
          value: "TRANSFER",
        },
      },
      {
        name: "app_date",
        label: "Approval Date",
        type: "date",
        readOnly: true,
      },
    ],
    lineFields: [
      {
        name: "itcd",
        label: "Item",
        type: "select",
        options: "products",
        apiEndpoint: "/api/setup/items",
        createEndpoint: "/api/setup/items",
        nameKey: "item",
        valueKey: "itcd",
        required: false,
        // modalFields: [
        //   { name: "item", label: "Item Name", type: "text", required: true },
        //   {
        //     name: "ic_id",
        //     label: "Item Category",
        //     type: "select",
        //     options: "itemCategories",
        //     apiEndpoint: "/api/setup/item_categories",
        //     valueKey: "id",
        //     nameKey: "ic_name",
        //     required: true,
        //   },
        // ],
        // visibility: {
        //   dependsOn: "req_catagory",
        //   condition: "notEquals",
        //   value: "SERVICE",
        // },
      },
      // {
      //   name: "id",
      //   label: "Service",
      //   type: "select",
      //   options: "services",
      //   apiEndpoint: "/api/setup/services",
      //   createEndpoint: "/api/setup/services",
      //   nameKey: "service_name",
      //   valueKey: "id",
      //   required: false,
      //   visibility: {
      //     dependsOn: "req_catagory",
      //     condition: "equals",
      //     value: "SERVICE",
      //   },
      // },
      {
        name: "qty",
        label: "Quantity",
        type: "number",
      },

      // {
      //   name: "ap_qty",
      //   label: "Approved Qty",
      //   type: "number",
      //   readOnly: true,
      // },
    ],
    totals: {
      totalQty: {
        label: "Total Requested Qty",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
      },
      // totalApprovedQty: {
      //   label: "Total Approved Qty",
      //   calculate: (lines) =>
      //     lines.reduce((sum, l) => sum + (l.ap_qty || 0), 0),
      // },
    },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "tran_id", label: "Requisition No", type: "text" },
      { name: "userid", label: "Requested By", type: "text" },
      { name: "req_catagory", label: "Category", type: "text" },

      {
        name: "issued_by",
        label: "Godown",
        type: "text",
        options: true,
        value1: "godown2Details",
        value2: "godown",
      },
      {
        name: "qty",
        label: "Total Qty",
        type: "text",
        isInnerTotal: true,
        key: "details",
      },
      { name: "status", label: "Status", type: "status" }, // ✅ ADD THIS
    ],

    allowDelete: false,
    allowPrint: true,
    allowEdit: true,
    allowView: true,
    allowCheck: false,
  },

  // ─────────────────────────────────────────────────────────────────────
  // REQUISITION: Finished Good Transfer (Production → Finished Goods Store)
  // ─────────────────────────────────────────────────────────────────────
  requisitionFGTransfer: {
    buttonText: "Create FG Transfer Requisition",
    ModalHeading: "Create FG Transfer Requisition",
    ModalHeadingEdit: "Edit FG Transfer Requisition",
    tran_code: 1000,
    hasDeductionBlock: false,
    differApi: "/api/material/requisition?category=FG_TRANSFER",

    masterFields: [
      {
        name: "req_catagory",
        label: "Requisition Category",
        type: "normalSelect",
        defaultValue: { value: "FG_TRANSFER", label: "FG_TRANSFER" },
        options: [{ value: "FG_TRANSFER", label: "FG_TRANSFER" }],
        required: true,
      },
      {
        name: "dated",
        label: "Requisition Date",
        type: "date",
        required: true,
      },
      {
        name: "userid",
        label: "Requested By",
        type: "text",
        user: true,
        required: true,
        readOnly: true,
      },
      {
        name: "issued_by",
        label: "Required By (Finished Goods Store)",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKey: "godown",
        valueKey: "id",
        required: true,
      },
      {
        name: "issued_for",
        label: "Required From (Production Godown)",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKey: "godown",
        valueKey: "id",
        required: true,
        validate: (value, masterData) => {
          if (value === masterData?.issued_by?.value) {
            return "Godown 'Required From' and 'Required By' cannot be the same.";
          }
          return null;
        },
      },
      {
        name: "app_date",
        label: "Approval Date",
        type: "date",
        readOnly: true,
      },
    ],
    lineFields: [
      {
        name: "itcd",
        label: "Finished Good Item",
        type: "select",
        options: "products",
        // Items of the finished-goods categories of Settings → Production setup
        // (never a fixed category id) — finishedCategoryIdsNow()
        apiEndpoint: () => `/api/setup/items?ic_id=${finishedCategoryIdsNow().join(",")}`,
        createEndpoint: "/api/setup/items",
        nameKey: "item",
        valueKey: "itcd",
        required: true,
      },
      {
        name: "qty",
        label: "Quantity",
        type: "number",
      },
    ],
    totals: {
      totalQty: {
        label: "Total Requested Qty",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
      },
    },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "tran_id", label: "Requisition No", type: "text" },
      { name: "userid", label: "Requested By", type: "text" },
      { name: "req_catagory", label: "Category", type: "text" },
      {
        name: "issued_by",
        label: "Godown",
        type: "text",
        options: true,
        value1: "godown2Details",
        value2: "godown",
      },
      {
        name: "qty",
        label: "Total Qty",
        type: "text",
        isInnerTotal: true,
        key: "details",
      },
      { name: "status", label: "Status", type: "status" },
    ],

    allowDelete: false,
    allowPrint: true,
    allowEdit: true,
    allowView: true,
    allowCheck: false,
  },

  // ─────────────────────────────────────────────────────────────────────
  // TRANSFER: Finished Good Transfer (fulfills requisitionFGTransfer)
  // ─────────────────────────────────────────────────────────────────────
  fgTransfer: {
    buttonText: "Create FG Transfer",
    ModalHeading: "Create FG Transfer",
    ModalHeadingEdit: "Create FG Transfer",
    tran_code: 11,
    hasDeductionBlock: false,
    differApi: "/api/material/requisition?category=FG_TRANSFER",
    differTitle: "FG Transfer Requisitions",

    sourceMapping: {
      type: "requisition",
      sourceApi: "/api/material/requisition?category=FG_TRANSFER",
      fieldMappings: {
        master: [
          {
            source: "tran_id",
            target: "req_no",
            transform: (value) => value,
          },
          {
            source: "issued_for",
            target: "godown",
            transform: (value) => value,
          },
          {
            source: "userid",
            target: "user_id",
            transform: (value) => value,
          },

          {
            source: "issued_by",
            target: "godown2",
            transform: (value, master) => ({
              value: master.godown2Details?.id,
              label: master.godown2Details?.godown,
            }),
          },

          // {
          //   source: "dated",
          //   target: "dated",
          //   transform: (value) => new Date(value).toLocaleDateString() // Direct mapping
          // }
        ],
        lines: [
          {
            source: "itcd", // From requisition details
            target: "itcd",
            transform: (value) => value,
          },
          {
            source: "qty", // Approved quantity from requisition
            target: "qty",
            transform: (value) => value || 0,
          },
          {
            source: "qty",
            target: "req_qty",
            transform: (value) => value || 0,
          },
          {
            source: "qty",
            target: "qty_per_pack",
            transform: (value) => value || 0,
          },
          {
            source: null, // Default value
            target: "no_of_pack",
            transform: () => 1,
          },
          {
            source: null, // Default value
            target: "rate",
            transform: () => 0,
          },
          {
            source: null, // For validation reference
            target: "original_qty",
            transform: (value, detail) => detail.qty,
          },
        ],
      },
    },

    masterFields: [
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },
      {
        name: "req_no",
        label: "FG Transfer Requisition No",
        type: "select",
        options: "requisitions",
        apiEndpoint: "/api/material/requisition?category=FG_TRANSFER",
        nameKey: "tran_id",
        valueKey: "tran_id",
        onChange: async (value, formData) => {
          if (!value) {
            return { godown: null, lines: [] };
          }
          try {
            const response = await axios.get(
              `/api/material/requisition/${value}`,
            );
            const reqMaster = response.data;
            const reqDetails = reqMaster.details || [];

            if (!reqMaster) return { error: "Requisition not found", lines: [] };

            // Fetch fulfillment progress to exclude already-transferred items
            let remainingByItcd = {};
            try {
              const progressRes = await axios.get(
                `/api/orders/fulfillment-progress?type=requisitionFGTransfer&id=${value}`,
              );
              for (const item of progressRes.data?.items || []) {
                remainingByItcd[item.itcd] = item.remainingQty;
              }
            } catch {
              // Non-critical: fall back to full qty
            }

            const lines = reqDetails
              .filter((detail) => {
                const remaining = remainingByItcd[detail.itcd];
                if (remaining !== undefined && remaining <= 0) return false;
                return true;
              })
              .map((detail) => {
                const remaining = remainingByItcd[detail.itcd];
                const qtyToUse =
                  remaining !== undefined ? remaining : detail.qty;
                const itemObj = detail.item;

                return {
                  itcd: {
                    value: itemObj?.itcd,
                    label: itemObj?.item,
                  },
                  qty: qtyToUse,
                  no_of_pack: 1,
                  qty_per_pack: qtyToUse,
                  rate: 0,
                  original_qty: detail.qty,
                  req_qty: detail.qty,
                };
              });

            return {
              godown: {
                value: reqMaster.godownDetails?.id,
                label: reqMaster.godownDetails?.godown,
              },
              godown2: {
                value: reqMaster.godown2Details?.id,
                label: reqMaster.godown2Details?.godown,
              },
              lines,
            };
          } catch (error) {
            console.error("Error fetching FG requisition details:", error);
            toast.error("Failed to load requisition details");
            return { lines: [] };
          }
        },
      },
      {
        name: "godown",
        label: "From Warehouse (Production)",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        nameKey: "godown",
        valueKey: "id",
        required: true,
      },
      {
        name: "godown2",
        label: "To Warehouse (Finished Goods Store)",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        nameKey: "godown",
        valueKey: "id",
        required: true,
        validate: (value, masterData) => {
          if (value === masterData.godown.value) {
            return "Godowns from and to cannot be the same";
          }
          return null;
        },
      },
      { name: "rmk", label: "Narration", type: "textarea" },
    ],
    lineFields: [
      {
        name: "itcd",
        label: "Finished Good",
        type: "select",
        options: "products",
        apiEndpoint: "/api/setup/items",
        nameKeys: ["code", "item"],
        valueKey: "itcd",
        required: true,
      },
      { name: "no_of_pack", label: "No of Packs", type: "number" },
      { name: "qty_per_pack", label: "Qty Per Pack", type: "number" },
      createTransferQtyField(),
    ],
    totals: {
      totalQty: {
        label: "Total Quantity",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
      },
    },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "tran_id", label: "Requisition #", type: "text" },
      {
        name: "godown",
        label: "From Warehouse",
        type: "text",
        options: true,
        value1: "godownDetails",
        value2: "godown",
      },
      {
        name: "godown2",
        label: "To Warehouse",
        type: "text",
        options: true,
        value1: "godown2Details",
        value2: "godown",
      },
      {
        name: "qty",
        label: "Qty",
        type: "text",
        isInnerTotal: true,
        key: "details",
      },
      { name: "status", label: "Status", type: "status" },
    ],
    allowDelete: false,
    allowPrint: true,
    allowCreate: true,
    allowEdit: false,
    allowView: true,
    allowCheck: false,
  },
  // dispatch requision
  dispatchTransfer: {
    buttonText: "Create Production Plan",
    ModalHeading: "Create Production Plan",
    ModalHeadingEdit: "Edit Production Plan",
    tran_code: 1000,
    hasDeductionBlock: false,
    differApi: "/api/material/requisition?category=DISPATCH",


    masterFields: [
      {
        name: "req_catagory",
        label: "Plan Category",
        type: "normalSelect",
        defaultValue: { value: "DISPATCH", label: "DISPATCH" },
        options: [
          { value: "DISPATCH", label: "DISPATCH" },
        ],
        required: true,
      },
      {
        name: "dated",
        label: "Plan Date",
        type: "date",
        required: true,
      },
      {
        name: "userid",
        label: "Requested By",
        type: "text",
        user: true,
        required: true,
        readOnly: true,
      },
      {
        name: "issued_by",
        label: "Required By (Warehouse)",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKeys: ["id", "godown"],
        valueKey: "id",
        defaultValue: setupGodownDefault("productionGodown"),
        defaultGodown: "productionGodown", // Settings → Production setup
        required: true,
      },

      {
        name: "issued_for",
        label: "Required From (Godown)",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKeys: ["id", "godown"],
        valueKey: "id",
        required: true,
        defaultValue: setupGodownDefault("planFromGodown"),
        defaultGodown: "planFromGodown",
        validate: (value, masterData) => {
          if (value === masterData?.issued_by?.value) {
            return "Godown 'Required From' and 'Required By' cannot be the same.";
          }
          return null;
        },
        // ðŸ‘‡ VISIBILITY CONDITION: Only show when req_category is TRANSFER
        visibility: {
          dependsOn: "req_catagory",
          condition: "equals",
          value: "DISPATCH",
        },
      },
      {
        name: "app_date",
        label: "Approval Date",
        type: "date",
        readOnly: true,
      },
    ],
    lineFields: [
      {
        name: "so_no",
        label: "Sale Order No",
        type: "select",
        options: "saleOrders",
        apiEndpoint: "/api/orders/saleOrder?approvedOnly=true",
        nameKeys: ["order_no", "acno.acname"],
        separator: " - ",
        valueKey: "order_no",
        createEndpoint: "/api/orders/saleOrder",
        required: true,
        minWidth: "320px",
        onChange: async (value, line, allLines, formData) => {
          return {
            itcd: null,
            stock: "",
            qty: "",
            ordered_qty: 0,
            dispatch_qty: 0,
          };
        },
      },
      {
        name: "itcd",
        label: "Item",
        type: "select",
        options: "products",
        minWidth: "350px",
        apiEndpoint: (formData, lineData) => {
          const soNo = lineData?.so_no?.value || lineData?.so_no;
          if (!soNo) return `/api/setup/items`;
          return `/api/forms/items/saleOrderItems?saleOrderNo=${soNo}`;
        },
        createEndpoint: "/api/setup/items",
        nameKeys: ["code", "item"],
        separator: ["-"],
        valueKey: "itcd",
        required: true,
        disabled: (lineData) => {
          const soNo = lineData?.so_no?.value || lineData?.so_no;
          return !soNo;
        },
        onChange: async (value, line, allLines, formData) => {
          if (!value) return {};
          try {
            const soNo = line?.so_no?.value || line?.so_no;
            if (!soNo) return {};
            const response = await axios.get(
              `/api/forms/items/saleOrderItems?saleOrderNo=${soNo}&itcd=${value}`
            );
            const orderItems = response.data?.data || [];
            const matchingItem = orderItems.find(item => String(item.itcd) === String(value));
            if (matchingItem) {
              const orderedQty = matchingItem.qty || 0;
              const dispatchedQty = matchingItem.dispatched_qty || 0;
              const remainingQty = Math.max(0, orderedQty - dispatchedQty);

              // Check stock level using /api/voucher/check-stock
              let stock = 0;
              const godownId = formData?.issued_for?.value || formData?.issued_for || 1;
              try {
                const stockRes = await axios.post("/api/voucher/check-stock", {
                  productIds: [value],
                  godown: godownId,
                });
                stock = stockRes.data?.[value] || 0;
              } catch (stockError) {
                console.error("Error fetching stock inside onChange:", stockError);
              }

              // Calculate already allocated quantity for this item in other lines of the form
              let allocatedQtyGlobal = 0;
              let allocatedQtyForOrder = 0;
              if (Array.isArray(allLines)) {
                allLines.forEach((l) => {
                  const lItcd = l.itcd?.value || l.itcd;
                  if (String(lItcd) === String(value)) {
                    allocatedQtyGlobal += Number(l.qty || 0);

                    const lSoNo = l.so_no?.value || l.so_no;
                    if (String(lSoNo) === String(soNo)) {
                      allocatedQtyForOrder += Number(l.qty || 0);
                    }
                  }
                });
              }

              const adjustedRemainingQty = Math.max(0, remainingQty - allocatedQtyForOrder);
              const adjustedStock = Math.max(0, stock - allocatedQtyGlobal);
              const suggestedQty = adjustedRemainingQty > 0 ? adjustedRemainingQty : adjustedStock;

              // The stock hint follows the policy "dispatchTransfer" (off hides it).
              if (typeof window !== "undefined" && (await screenStockMode("dispatchTransfer")) !== "off") {
                try {
                  const { toast } = await import("sonner");
                  toast.info(
                    `Stock Check: Available stock is ${adjustedStock}. Recommended Production Plan Qty is ${suggestedQty}.`,
                    {
                      duration: 8000,
                      position: "top-right",
                    }
                  );
                } catch (toastError) {
                  console.error("Failed to show toast:", toastError);
                }
              }

              return {
                stock: adjustedStock,
                qty: "",
                ordered_qty: orderedQty,
                dispatch_qty: dispatchedQty,
              };
            }
          } catch (error) {
            console.error("Error in production plan itcd onChange:", error);
          }
          return {};
        },
      },
      {
        name: "qty",
        label: "Quantity",
        type: "number",
        required: true,
      },
      {
        name: "ordered_qty",
        label: "Ordered Qty",
        type: "number",
        readOnly: true,
      },
      {
        name: "dispatch_qty",
        label: "Dispatch Qty",
        type: "number",
        readOnly: true,
      },
      // {
      //   name: "id",
      //   label: "Service",
      //   type: "select",
      //   options: "services",
      //   apiEndpoint: "/api/setup/services",
      //   createEndpoint: "/api/setup/services",
      //   nameKey: "service_name",
      //   valueKey: "id",
      //   required: false,
      //   visibility: {
      //     dependsOn: "req_catagory",
      //     condition: "equals",
      //     value: "SERVICE",
      //   },
      // },
      // Lab's Nature (Features: production.labNature) — a change of a saved
      // Nature goes through the approval rules on "Production Plan"
      {
        name: "nature",
        label: "Nature",
        type: "normalSelect",
        options: PLAN_NATURE_OPTIONS,
        feature: "production.labNature",
        width: "170px",
      },
      {
        name: "stock",
        label: "Stock",
        type: "number",
        readOnly: true,
      },
      {
        name: "remarks",
        label: "Remarks",
        type: "textarea",
        readOnly: true,
      },


      // {
      //   name: "ap_qty",
      //   label: "Approved Qty",
      //   type: "number",
      //   readOnly: true,
      // },
    ],
    totals: {
      totalQty: {
        label: "Total Requested Qty",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
      },
      // totalApprovedQty: {
      //   label: "Total Approved Qty",
      //   calculate: (lines) =>
      //     lines.reduce((sum, l) => sum + (l.ap_qty || 0), 0),
      // },
    },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "tran_id", label: "Plan No", type: "text" },
      { name: "userid", label: "Requested By", type: "text" },
      // { name: "req_catagory", label: "Category", type: "text" },

      {
        name: "issued_by",
        label: "Godown",
        type: "text",
        options: true,
        value1: "godown2Details",
        value2: "godown",
      },
      {
        name: "qty",
        label: "Total Qty",
        type: "text",
        isInnerTotal: true,
        key: "details",
      },
      // { name: "status", label: "Status", type: "status" },
    ],

    allowDelete: false,
    allowPrint: true,
    allowEdit: true,
    allowView: true,
    allowCheck: false,
  },
  productionPlan: {
    // buttonText: "Create Production Plan",
    // ModalHeading: "Create Production Plan",
    ModalHeadingEdit: "Edit Production Plan",
    tran_code: 1000,
    hasDeductionBlock: false,
    differApi: "/api/material/requisition?category=DISPATCH",


    masterFields: [
      createLockableField({
        name: "req_catagory",
        label: "Plan Category",
        type: "select",
        defaultValue: { value: "DISPATCH", label: "DISPATCH" },
        options: [
          { value: "DISPATCH", label: "DISPATCH" },
        ],
        required: true,
        lockInEdit: true,
      }),
      {
        name: "dated",
        label: "Plan Date",
        type: "date",
        required: true,
        readOnly: true,
      },
      {
        name: "userid",
        label: "Requested By",
        type: "text",
        user: true,
        required: true,
        readOnly: true,
      },

      createLockableField({
        name: "issued_by",
        label: "Required By (Warehouse)",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKey: "godown",
        valueKey: "id",
        defaultValue: setupGodownDefault("productionGodown"),
        defaultGodown: "productionGodown", // Settings → Production setup
        required: true,
        lockInEdit: true,
      }),
      createLockableField({

        name: "issued_for",
        label: "Required From (Godown)",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKey: "godown",
        valueKey: "id",
        required: true,
        lockInEdit: true,
        defaultValue: setupGodownDefault("planFromGodown"),
        defaultGodown: "planFromGodown",
        validate: (value, masterData) => {
          if (value === masterData?.issued_by?.value) {
            return "Godown 'Required From' and 'Required By' cannot be the same.";
          }
          return null;
        },
        // ðŸ‘‡ VISIBILITY CONDITION: Only show when req_category is TRANSFER
        visibility: {
          dependsOn: "req_catagory",
          condition: "equals",
          value: "DISPATCH",
        },


      }),
      {
        name: "app_date",
        label: "Approval Date",
        type: "date",
        readOnly: true,
      },
    ],
    lineFields: [
      createLockableField({

        name: "so_no",
        label: "Sale Order No",
        type: "select",
        options: "saleOrders",
        apiEndpoint: "/api/orders/saleOrder?approvedOnly=true",
        //nameKey: "order_no",
        // "10306 - CUSTOMER NAME" — acname comes from the included acno relation
        nameKeys: ["order_no", "acno.acname"],
        separator: " - ",
        valueKey: "order_no",
        createEndpoint: "/api/orders/saleOrder",
        minWidth: "320px",
        // required: true,
        lockInEdit: true,
        onChange: async (value, line, allLines, formData) => {
          return {
            itcd: null,
            stock: "",
            qty: "",
            ordered_qty: 0,
            dispatch_qty: 0,
          };
        },


      }),
      createLockableField({

        name: "itcd",
        label: "Item",
        type: "select",
        options: "products",
        minWidth: "350px",
        apiEndpoint: (formData, lineData) => {
          const soNo = lineData?.so_no?.value || lineData?.so_no;
          if (!soNo) return `/api/setup/items`;
          return `/api/forms/items/saleOrderItems?saleOrderNo=${soNo}`;
        },
        createEndpoint: "/api/setup/items",
        nameKeys: ["code", "item"],
        separator: ["-"],
        valueKey: "itcd",
        // required: true,
        lockInEdit: true,
        disabled: (lineData) => {
          const soNo = lineData?.so_no?.value || lineData?.so_no;
          return !soNo;
        },
        onChange: async (value, line, allLines, formData) => {
          if (!value) return {};
          try {
            const soNo = line?.so_no?.value || line?.so_no;
            if (!soNo) return {};
            const response = await axios.get(
              `/api/forms/items/saleOrderItems?saleOrderNo=${soNo}&itcd=${value}`
            );
            const orderItems = response.data?.data || [];
            const matchingItem = orderItems.find(item => String(item.itcd) === String(value));
            if (matchingItem) {
              const orderedQty = matchingItem.qty || 0;
              const dispatchedQty = matchingItem.dispatched_qty || 0;
              const remainingQty = Math.max(0, orderedQty - dispatchedQty);

              // Check stock level using /api/voucher/check-stock
              let stock = 0;
              const godownId = formData?.issued_for?.value || formData?.issued_for || 1;
              try {
                const stockRes = await axios.post("/api/voucher/check-stock", {
                  productIds: [value],
                  godown: godownId,
                });
                stock = stockRes.data?.[value] || 0;
              } catch (stockError) {
                console.error("Error fetching stock inside onChange:", stockError);
              }

              // Calculate already allocated quantity for this item in other lines of the form
              let allocatedQtyGlobal = 0;
              let allocatedQtyForOrder = 0;
              if (Array.isArray(allLines)) {
                allLines.forEach((l) => {
                  const lItcd = l.itcd?.value || l.itcd;
                  if (String(lItcd) === String(value)) {
                    allocatedQtyGlobal += Number(l.qty || 0);

                    const lSoNo = l.so_no?.value || l.so_no;
                    if (String(lSoNo) === String(soNo)) {
                      allocatedQtyForOrder += Number(l.qty || 0);
                    }
                  }
                });
              }

              const adjustedRemainingQty = Math.max(0, remainingQty - allocatedQtyForOrder);
              const adjustedStock = Math.max(0, stock - allocatedQtyGlobal);
              const suggestedQty = adjustedRemainingQty > 0 ? adjustedRemainingQty : adjustedStock;

              // The stock hint follows the policy "dispatchTransfer" (off hides it).
              if (typeof window !== "undefined" && (await screenStockMode("dispatchTransfer")) !== "off") {
                try {
                  const { toast } = await import("sonner");
                  toast.info(
                    `Stock Check: Available stock is ${adjustedStock}. Recommended Production Plan Qty is ${suggestedQty}.`,
                    {
                      duration: 8000,
                      position: "top-right",
                    }
                  );
                } catch (toastError) {
                  console.error("Failed to show toast:", toastError);
                }
              }

              return {
                stock: adjustedStock,
                qty: "",
                ordered_qty: orderedQty,
                dispatch_qty: dispatchedQty,
              };
            }
          } catch (error) {
            console.error("Error in production plan itcd onChange:", error);
          }
          return {};
        }

      }),
      {
        name: "qty",
        label: "Quantity",
        type: "number",
        readOnly: true
      },
      {
        name: "ordered_qty",
        label: "Ordered Qty",
        type: "number",
        readOnly: true,
      },
      {
        name: "dispatch_qty",
        label: "Dispatch Qty",
        type: "number",
        readOnly: true,
      },
      // {
      //   name: "id",
      //   label: "Service",
      //   type: "select",
      //   options: "services",
      //   apiEndpoint: "/api/setup/services",
      //   createEndpoint: "/api/setup/services",
      //   nameKey: "service_name",
      //   valueKey: "id",
      //   required: false,
      //   visibility: {
      //     dependsOn: "req_catagory",
      //     condition: "equals",
      //     value: "SERVICE",
      //   },
      // },
      // Lab's Nature (Features: production.labNature) — a change of a saved
      // Nature goes through the approval rules on "Production Plan"
      {
        name: "nature",
        label: "Nature",
        type: "normalSelect",
        options: PLAN_NATURE_OPTIONS,
        feature: "production.labNature",
        width: "170px",
      },
      // Process / Manufacturing line → Create Process Order with this plan picked
      { name: "process_order_link", label: "Process Order", type: "planProcessOrder", feature: "production.labNature", readOnly: true },
      {
        name: "stock",
        label: "Stock",
        type: "number",
        readOnly: true,
      },
      {
        name: "remarks",
        label: "Remarks",
        type: "textarea",
      },


      // {
      //   name: "ap_qty",
      //   label: "Approved Qty",
      //   type: "number",
      //   readOnly: true,
      // },
    ],
    totals: {
      totalQty: {
        label: "Total Requested Qty",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
      },
      // totalApprovedQty: {
      //   label: "Total Approved Qty",
      //   calculate: (lines) =>
      //     lines.reduce((sum, l) => sum + (l.ap_qty || 0), 0),
      // },
    },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "tran_id", label: "Plan No", type: "text" },
      { name: "userid", label: "Requested By", type: "text" },
      // { name: "req_catagory", label: "Category", type: "text" },

      {
        name: "issued_by",
        label: "Godown",
        type: "text",
        options: true,
        value1: "godown2Details",
        value2: "godown",
      },
      {
        name: "qty",
        label: "Total Qty",
        type: "text",
        isInnerTotal: true,
        key: "details",
      },
      // { name: "status", label: "Status", type: "status" },
    ],

    allowDelete: false,
    allowPrint: true,
    allowEdit: true,
    allowView: true,
    allowCheck: false,
  },


  materialIssueLanded: {
    buttonText: "Create Landed Material Issue",
    ModalHeading: "Create Landed Material Issue",
    ModalHeadingEdit: "Edit Landed Material Issue",
    hasDeductionBlock: false,
    differApi: "/api/voucher/materialIssueLanded?outsourced=true",
    tran_code: 7,
    masterFields: [
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },
      {
        name: "godown",
        label: "Godown",
        type: "select",
        options: "godowns",
        apiEndpoint: "/api/setup/godowns",
        createEndpoint: "/api/setup/godowns",
        nameKey: "godown",
        valueKey: "id",
        required: true,
      },
      {
        name: "pycd",
        formName: "pycd",
        label: "Paid From",
        type: "select",
        options: "masterAccounts", // This is the key to store and access
        apiEndpoint: `/api/accounts/acno?${CASH_BANK_GROUP_PARAM}`,
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        required: true,
      },
      {
        name: "rmk1",
        label: "Outsourced",
        type: "select",
        options: [
          { value: "Yes", label: "Yes" },
        ],
        defaultValue: { value: "Yes", label: "Yes" },
        required: true,
      },
    ],
    lineFields: [
      {
        name: "itcd",
        label: "Product",
        type: "select",
        options: "products",
        apiEndpoint: "/api/setup/items",
        createEndpoint: "/api/setup/items",
        nameKey: "item",
        valueKey: "itcd",
        required: true,
        onChange: async (value, line, allLines, formData) => {
          if (!value) return {};
          try {
            const response = await axios.get(
              `/api/voucher/getRate?itcd=${value.value || value}&date=${formData.dated}`,
            );

            const data = response.data?.averageRate || {};

            return {
              rate: data,
            };
          } catch (error) {
            return {};
          }
        },
      },
      {
        name: "qty",
        label: "Quantity",
        type: "number",
        required: true,
      },
      {
        name: "rate",
        label: "Rate",
        type: "number",
        required: true,
      },
      {
        name: "total",
        label: "Total",
        type: "number",
        required: true,
        dependencies: ["qty", "rate"],
        calculate: (v) => (v.qty || 0) * (v.rate || 0),
      },
    ],

    totals: {
      totalQty: {
        label: "Total Qty",
        calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
      },

      totalAmount: {
        label: "Total Amount",
        calculate: (lines) =>
          lines.reduce((sum, l) => sum + ((l.qty || 0) * (l.rate || 0)), 0),
      }
    },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "tran_id", label: "Transaction #", type: "text" },
      {
        name: "pycd",
        label: "Customer",
        type: "text",
        options: true,
        value1: "acno",
        value2: "acname",
      },
      {
        name: "qty",
        label: "Total Qty",
        type: "text",
        isInnerTotal: true,
        key: "transactions",
      },
    ],
    allowDelete: false,
    allowPrint: true,
    allowEdit: true,
    allowView: true,
    allowCheck: false,
  },


  letterOfCredit: {
    buttonText: "Create Letter Of Credit",
    label: "Letter Of Credit",
    ModalHeading: "Letter Of Credit",
    ModalHeadingEdit: "Edit Letter Of Credit",
    hasDeductionBlock: false,
    differApi: "/api/lc",
    // Header bands (formLayout.js) — ~30 fields, so grouped by what they are.
    masterGroups: [
      { key: "lc", label: "L/C" },
      { key: "terms", label: "Terms & invoice" },
      { key: "shipment", label: "Shipment" },
      { key: "docs", label: "Documents" },
      { key: "notes", label: "Remarks" },
    ],

    masterFields: [
      {
        name: "lc_no",
        group: "lc",
        label: "L/C No",
        type: "text",
      },
      {
        name: "import_type",
        group: "lc",
        label: "Import Type",
        type: "normalSelect",
        options: [
          { value: "LC", label: "LC" },
          { value: "CONT", label: "CONT" },
          { value: "ADV", label: "ADVANCE" },
        ],
      },
      {
        name: "lc_gl",
        group: "lc",
        formName: "lc_gl",
        label: "L/C GL #",
        type: "select",
        options: "masterAccounts",
        apiEndpoint: `/api/accounts/acno?${LC_GROUP_PARAM}`,
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        // The Main Account list is filtered to the same group this field
        // reads from (LC / Import Accounts) — it was unfiltered, so you could
        // file a new L/C GL under any group and the dropdown would never show
        // it again.
        modalFields: [
          {
            name: "acname",
            label: "Account Name",
            type: "text",
            required: true,
          },
          {
            name: "macno",
            label: "Main Account",
            type: "select",
            options: "mainAccounts",
            apiEndpoint: `/api/accounts/macno?${LC_GROUP_PARAM}`,
            valueKey: "macno",
            nameKeys: ["macno", "macname"],
            required: true,
          },
        ],
      },
      {
        name: "cont_no",
        group: "lc",
        label: "Cont No",
        type: "text",
      },
      {
        name: "bank",
        group: "lc",
        formName: "bank",
        label: "Bank",
        type: "select",
        options: "masterAccounts",
        apiEndpoint: `/api/accounts/acno?${CASH_BANK_GROUP_PARAM}`,
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        required: true,
        // Pinned to the same group the Bank field lists (Cash & Bank), so a
        // bank created through the modal lands where the dropdown finds it.
        modalFields: [
          {
            name: "acname",
            label: "Account Name",
            type: "text",
            required: true,
          },
          {
            name: "macno",
            label: "Main Account",
            type: "select",
            options: "mainAccounts",
            apiEndpoint: `/api/accounts/macno?${CASH_BANK_GROUP_PARAM}`,
            valueKey: "macno",
            nameKeys: ["macno", "macname"],
            required: true,
          },
        ],
      },
      {
        name: "lc_date",
        group: "lc",
        label: "L/C Date",
        type: "date",
        required: "true"
      },
      {
        name: "lc_exp_date",
        group: "lc",
        label: "L/C Exp Date",
        type: "date",
      },
      {
        name: "beneficiary",
        group: "lc",
        formName: "beneficiary",
        label: "Beneficiary",
        type: "select",
        options: "masterAccounts",
        apiEndpoint: `/api/accounts/acno?${BENEFICIARY_GROUP_PARAM}`,
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        required: true,
        // Same add-on-the-fly modal as L/C GL and Bank. The main account is
        // pinned to the group this field reads from (LC Beneficiaries), so a
        // beneficiary created here lands where the dropdown will find it again.
        modalFields: [
          {
            name: "acname",
            label: "Account Name",
            type: "text",
            required: true,
          },
          {
            name: "macno",
            label: "Main Account",
            type: "select",
            options: "mainAccounts",
            apiEndpoint: `/api/accounts/macno?${BENEFICIARY_GROUP_PARAM}`,
            valueKey: "macno",
            nameKeys: ["macno", "macname"],
            required: true,
          },
        ],
      },
      {
        name: "terms",
        group: "terms",
        label: "Terms",
        type: "text",
      },
      {
        name: "curr",
        group: "terms",
        label: "Currency",
        type: "select",
        options: "currencies",
        apiEndpoint: "/api/currency",
        nameKeys: ["currency_name"],
        valueKey: "currency_code",
      },
      {
        name: "doc_rtd_exc_rate",
        group: "terms",
        label: "Exc Rate",
        type: "number",
      },
      {
        name: "mny_ship_date",
        group: "terms",
        label: "Max Ship Date",
        type: "date",
      },
      {
        name: "per_inv_no",
        group: "terms",
        label: "P.I No",
        type: "text",
      },
      {
        name: "per_inv_date",
        group: "terms",
        label: "P.I Date",
        type: "date",
      },
      {
        name: "inc_no",
        group: "terms",
        label: "MCN No",
        type: "text",
      },
      {
        name: "roi_no",
        group: "terms",
        label: "ROI No",
        type: "text",
      },
      {
        name: "vessel",
        group: "shipment",
        label: "Vessel",
        type: "text",
      },
      {
        name: "voyage",
        group: "shipment",
        label: "Voyage",
        type: "text",
      },
      {
        name: "etd",
        group: "shipment",
        label: "ETD",
        type: "date",
      },
      {
        name: "eta",
        group: "shipment",
        label: "ETA",
        type: "date",
      },
      {
        name: "vessel_int_no",
        group: "shipment",
        label: "Vessel Intimation No",
        type: "text",
      },
      {
        name: "container_no",
        group: "shipment",
        label: "Container No",
        type: "text",
      },
      {
        name: "cont_seal_no",
        group: "shipment",
        label: "Container Seal No",
        type: "text",
      },
      {
        name: "bl_no",
        group: "shipment",
        label: "BL No",
        type: "text",
      },
      {
        name: "bl_date",
        group: "shipment",
        label: "BL Date",
        type: "date",
      },
      {
        name: "ship_company",
        group: "shipment",
        label: "Shipping Company",
        type: "text",
      },
      {
        name: "agent",
        group: "shipment",
        label: "Agent",
        type: "text",
      },
      {
        name: "doc_arr_date",
        group: "docs",
        label: "Doc Arrival Date",
        type: "date",
      },
      {
        name: "doc_rtd_due_date",
        group: "docs",
        label: "Doc Rtd Due Date",
        type: "date",
      },
      {
        name: "doc_rtd_date",
        group: "docs",
        label: "Doc Rtd Date",
        type: "date",
      },
      {
        name: "remarks",
        group: "notes",
        label: "Remarks",
        type: "textarea",
      },
    ],

    lineFields: [
      {
        name: "bl_no",
        label: "BL No",
        type: "text",
      },
      {
        name: "itcd",
        label: "Item",
        type: "select",
        options: "items",
        apiEndpoint: "/api/setup/items",
        createEndpoint: "/api/setup/items",
        nameKeys: ["code", "item"],
        separator: ["-"],
        valueKey: "itcd",
      },
      {
        name: "qty",
        label: "Qty",
        type: "number",
      },
      {
        name: "fc_rate",
        label: "FC Rate",
        type: "number",
      },
      {
        name: "fc_amount",
        label: "FC Amount",
        type: "number",
        dependencies: ["qty", "fc_rate"],
        calculate: (v) => (v.qty || 0) * (v.fc_rate || 0),
      },
      {
        name: "exc_rate",
        label: "Exc Rate",
        type: "number",
      },
      {
        name: "pkr_amount",
        label: "PKR Amount",
        type: "number",
        dependencies: ["fc_amount", "exc_rate"],
        calculate: (v) => (v.fc_amount || 0) * (v.exc_rate || 0),
      },
      {
        name: "bonded_wh",
        label: "Bonded WH",
        type: "text",
      },
    ],

    totals: {
      totalQty: {
        label: "Total Qty",
        calculate: (lines) =>
          lines.reduce((s, l) => s + (Number(l.qty) || 0), 0),
      },
      totalFCAmount: {
        label: "FC Amount",
        calculate: (lines) =>
          lines.reduce((s, l) => s + (Number(l.fc_amount) || 0), 0),
      },
      totalPKRAmount: {
        label: "PKR Amount",
        calculate: (lines) =>
          lines.reduce((s, l) => s + (Number(l.pkr_amount) || 0), 0),
      },
    },

    tableFields: [
      {
        name: "lc_no",
        label: "L/C No",
        type: "text",
      },
      {
        name: "bl_no",
        label: "BL No",
        type: "text",
      },
      {
        name: "lc_gl_account",
        label: "LC GL",
        type: "text",
        options: true,
        value1: "lc_gl_account",
        value2: "acname",
      },
      {
        name: "lc_date",
        label: "L/C Date",
        type: "date",
      },
      {
        name: "items_description",
        label: "LC Items",
        type: "text",
        multiline: true, // one item per line
      },
      {
        name: "qty",
        label: "Total Qty",
        type: "text",
        isInnerTotal: true,
        key: "details",
      },
      {
        name: "beneficiary_account",
        label: "Beneficiary",
        type: "text",
        options: true,
        value1: "beneficiary_account",
        value2: "acname",
      },
      {
        name: "curr",
        label: "Currency",
        type: "text",
      },
    ],

    allowDelete: false,
    allowPrint: true,
    allowEdit: true,
    allowView: true,
    allowCheck: false,
  },

  inBond: {
    buttonText: "Create In-Bond Entry",
    label: "In-Bond Entry",
    ModalHeading: "In-Bond Entry",
    ModalHeadingEdit: "Edit In-Bond Entry",
    hasDeductionBlock: false,
    differApi: "/api/inbond",

    // Selecting an L/C pre-fills lines from LCDetail — the goods that are
    // going into bond instead of straight to the factory (Direct GRN).
    // sourceMapping: {
    //   type: "lc",
    //   sourceApi: "/api/lc",
    //   fieldMappings: {
    //     master: [
    //       {
    //         source: "lc_no",
    //         target: "lc_no",
    //         transform: (value) => value,
    //       },
    //     ],
    //     lines: [
    //       {
    //         source: "bl_no",
    //         target: "bl_no",
    //         transform: (value) => value,
    //       },
    //       {
    //         source: "itcd",
    //         target: "itcd",
    //         transform: (value) => value,
    //       },
    //       {
    //         source: "qty",
    //         target: "qty",
    //         transform: (value) => value || 0,
    //       },
    //     ],
    //   },
    // },

    masterFields: [
      createLockableField({
        name: "lc_ref",
        label: "L/C Ref",
        type: "select",
        options: "letterOfCredits",
        apiEndpoint: "/api/lc",
        nameKeys: ["id", "lc_no"],
        valueKey: "lc_no",
        // lockInEdit: true,
        required: false,
        onChange: async (value, formData) => {

          try {
            const response = await axios.get(`/api/lc?lc_no=${value}`);
            const lc = response.data;

            // lc_gl is an Int FK to ACNO — account details come via lc_gl_account
            const glAcc = lc.lc_gl_account;
            const vendorVal = glAcc
              ? {
                value: String(glAcc.acno),
                label: `${glAcc.acno} - ${glAcc.acname || ""}`,
              }
              : lc.lc_gl
                ? { value: String(lc.lc_gl), label: String(lc.lc_gl) }
                : null;

            return {
              lc_no: vendorVal,
              lCMasterId: lc.id,
              bond_id: lc.bl_no

            };
          } catch (error) {
            console.error("Error fetching LC:", error);
            throw error;
          }
        },
      }),
      createLockableField({
        name: "lc_no",
        label: "L/C GL",
        type: "select",
        options: "letterOfCredits",
        apiEndpoint: `/api/accounts/acno?${LC_GROUP_PARAM}`,
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        // lockInEdit: true,
        required: false,
        // onChange: async (value, formData, config) => {
        //   if (!value) return { lines: [] };

        //   try {
        //     const response = await axios.get(`/api/lc?lc_no=${value}`);
        //     const lcData = response.data;

        //     return mapSourceToForm(lcData, config?.sourceMapping, "inBond");
        //   } catch (error) {
        //     console.error("Error fetching LC:", error);
        //     throw error;
        //   }
        // },
      }),
      {
        name: "bond_id",
        label: "BL-NO",
        type: "text",
        required: false,
      },
      {
        name: "bond_location_id",
        label: "Bond Location",
        type: "select",
        options: "bondLocations",
        apiEndpoint: "/api/setup/bond_locations",
        createEndpoint: "/api/setup/bond_locations",
        nameKey: "location",
        valueKey: "id",
        required: true,
        // modalFields: [
        // { name: "location", label: "Location", type: "text", required: true },
        // ],
      },
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },
      {
        name: "bond_ref",
        label: "Bond Ref / Remarks",
        type: "textarea",
      },
      {
        name: "bond_limit",
        label: "Bond Limit",
        type: "date",
      },
      {
        name: "lCMasterId",
        label: "LC Master Id",
        type: "text",
        readOnly: "true"
      },
    ],

    lineFields: [
      // {
      //   name: "bl_no",
      //   label: "BL No",
      //   type: "text",
      // },
      {
        name: "itcd",
        label: "Item",
        type: "select",
        options: "items",
        // ✅ DYNAMIC ENDPOINT: Filter items by selected L/C Ref
        apiEndpoint: (formData) => {
          const lcRef =
            formData?.lc_ref?.value ||
            formData?.lc_ref ||
            formData?.lc_no?.value ||
            formData?.lc_no;

          if (!lcRef) {
            return `/api/setup/items`;
          }

          const params = new URLSearchParams();
          params.set("lcNo", lcRef);

          return `/api/forms/items/exBond-LcItems?${params.toString()}`;
        },
        getPlaceholder: (formData) => {
          const lcRef =
            formData?.lc_ref?.value ||
            formData?.lc_ref ||
            formData?.lc_no?.value ||
            formData?.lc_no;
          if (lcRef) return "Select product from L/C";
          return "Select product";
        },
        createEndpoint: "/api/setup/items",
        nameKeys: ["code", "item"],
        separator: ["-"],
        valueKey: "itcd",
        required: true,
      },
      {
        name: "qty",
        label: "Qty",
        type: "number",
        required: true,
      },
    ],

    totals: {
      totalQty: {
        label: "Total Qty",
        calculate: (lines) =>
          lines.reduce((s, l) => s + (Number(l.qty) || 0), 0),
      },
    },

    tableFields: [
      {
        name: "dated",
        label: "Date",
        type: "date",
      },
      {
        name: "bond_id",
        label: "BL-NO",
        type: "text",
      },
      {
        name: "lc_ref",
        label: "L/C No",
        type: "text",
      },
      {
        name: "items_description",
        label: "LC Items",
        type: "text",
        multiline: true,
      },
      {
        name: "lc_gl_account",
        label: "LC GL",
        type: "text",
        options: true,
        value1: "acno",
        value2: "acname",
      },
      {
        name: "qty",
        label: "Total Qty",
        type: "text",
        isInnerTotal: true,
        key: "transactions",
      },
    ],

    allowDelete: false,
    allowPrint: true,
    allowEdit: true,
    allowView: true,
    allowCheck: false,
  },

  debit: {
    buttonText: "Create Debit Note",
    ModalHeading: "Create Debit Note",
    ModalHeadingEdit: "Create Debit Note",
    tran_code: 19,
    hasDeductionBlock: false,
    masterFields: [
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },
      {
        name: "pycd",
        label: "Vendor",
        type: "select",
        options: "accounts",
        apiEndpoint: `/api/accounts/acno?${VENDOR_GROUP_PARAM}`,
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        required: true,
        modalFields: [
          { name: "name", label: "Vendor Name", type: "text", required: true },
        ],
      },
    ],
    lineFields: [
      {
        name: "acname",
        formName: "acno",
        label: "A/c Name",
        type: "select",
        options: "accounts",
        apiEndpoint: "/api/accounts/acno?excludeGroup=cash_bank",
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        modalFields: [
          {
            name: "acname",
            label: "Account Name",
            type: "text",
            required: true,
          },
          {
            name: "macno",
            label: "Main Account",
            type: "select",
            options: "mainAccounts",
            apiEndpoint: "/api/accounts/macno",
            valueKey: "macno",
            nameKey: "macname",
            required: true,
          },
        ],
      },
      {
        name: "invoice_no",
        formName: "invoice_no",
        label: "Invoice No",
        type: "select",
        options: "invoiceAccounts", // This is the key to store and access
        apiEndpoint: "/api/invoice?tran_code=6",
        createEndpoint: "/api/invoice/",
        nameKey: "label",
        valueKey: "value",
      },
      {
        name: "camt",
        label: "Amount",
        type: "number",
        calculate: (v) => v.fc_amount * v.rate,
      },
    ],
    //     totals: {
    //   totalQty: {
    //     label: "Total Qty",
    //     calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
    //   },
    //   grossTotal: {
    //     label: "Total Gross Amount",
    //     calculate: (lines) =>
    //       lines.reduce((sum, l) => sum + (l.gross_amount || 0), 0),
    //   },
    //   taxTotal: {
    //     label: "Total ST Amount",
    //     calculate: (lines) =>
    //       lines.reduce((sum, l) => sum + (l.st_amount || 0), 0),
    //   },
    //   additionalTaxTotal: {
    //     label: "Total Additional Tax",
    //     calculate: (lines) =>
    //       lines.reduce((sum, l) => sum + (l.additional_tax || 0), 0),
    //   },
    //   netTotal: {
    //     label: "Total Amount",
    //     calculate: (lines) => {
    //       const value = lines.reduce((sum, l) => sum + ((l.damt || 0) + (l.st_amount || 0) + (l.additional_tax || 0)), 0);
    //       return value.toLocaleString("en-US");
    //     },
    //   },
    // },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },

      { name: "invoice_no", label: "Invoice No", type: "text", multiFilter: true },
      {
        name: "pycd",
        label: "Vendor",
        type: "text",
        options: true,
        value1: "acno",
        value2: "acname",
      },
      { name: "damt", label: "Total Amount", type: "number", isTotal: true },
    ],

    allowDelete: false,
    allowPrintSaveButton: false,
    allowPrint: false,
    allowEdit: true,
    allowView: true,
    allowCheck: false,
  },

  credit: {
    buttonText: "Create Credit Note",
    ModalHeading: "Create Credit Note",
    ModalHeadingEdit: "Edit Credit Note",
    tran_code: 20,
    hasDeductionBlock: false,
    masterFields: [
      {
        name: "dated",
        label: "Date",
        type: "date",
        required: true,
      },
      {
        name: "pycd",
        label: "Customer",
        type: "select",
        options: "accounts",
        apiEndpoint: `/api/accounts/acno?${CUSTOMER_GROUP_PARAM}`,
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        required: true,
        modalFields: [
          {
            name: "name",
            label: "Customer Name",
            type: "text",
            required: true,
          },
        ],
      },
    ],
    lineFields: [
      {
        name: "acname",
        formName: "acno",
        label: "A/c Name",
        type: "select",
        options: "accounts",
        apiEndpoint: "/api/accounts/acno?excludeGroup=cash_bank",
        createEndpoint: "/api/accounts/acno",
        nameKeys: ["acno", "acname"],
        valueKey: "acno",
        modalFields: [
          {
            name: "acname",
            label: "Account Name",
            type: "text",
            required: true,
          },
          {
            name: "macno",
            label: "Main Account",
            type: "select",
            options: "mainAccounts",
            apiEndpoint: "/api/accounts/macno",
            valueKey: "macno",
            nameKey: "macname",
            required: true,
          },
        ],
      },
      {
        name: "invoice_no",
        formName: "invoice_no",
        label: "Invoice No",
        type: "select",
        options: "invoiceAccounts", // This is the key to store and access
        apiEndpoint: "/api/invoice?tran_code=6",
        createEndpoint: "/api/invoice/",
        nameKey: "label",
        valueKey: "value",
      },
      {
        name: "damt",
        label: "Amount",
        type: "number",
        dependencies: ["qty", "rate", "no_of_pack", "qty_per_pack"],
        calculate: (v) => v.qty * v.rate,
      },
    ],
    // totals: {
    //   totalQty: {
    //     label: "Total Qty",
    //     calculate: (lines) => lines.reduce((sum, l) => sum + (l.qty || 0), 0),
    //   },
    //   grossTotal: {
    //     label: "Total Gross Amount",
    //     calculate: (lines) =>
    //       lines.reduce((sum, l) => sum + (l.camt || 0), 0),
    //   },
    //   taxTotal: {
    //     label: "Total tax Amount",
    //     calculate: (lines) =>
    //       lines.reduce((sum, l) => sum + (l.tax_amount || 0), 0),
    //   },
    //   additionalTaxTotal: {
    //     label: "Total Further Tax",
    //     calculate: (lines) =>
    //       lines.reduce((sum, l) => sum + (l.additional_tax_amount || 0), 0),
    //   },
    //   netTotal: {
    //     label: "Total Amount",
    //     calculate: (lines) => {
    //       const value = lines.reduce((sum, l) => sum + (l.camt || 0) + (l.st_amount || 0), 0);
    //       return value.toLocaleString("en-US");
    //     },
    //   },
    // },
    tableFields: [
      { name: "dated", label: "Date", type: "date" },
      { name: "invoice_no", label: "Invoice No", type: "text", multiFilter: true },
      {
        name: "pycd",
        label: "Customer",
        type: "text",
        options: true,
        value1: "acno",
        value2: "acname",
      },
      { name: "camt", label: "Total Amount", type: "number", isTotal: true },
    ],
    allowDelete: false,
    allowPrintSaveButton: true,
    allowPrint: true,
    allowEdit: true,
    allowView: true,
    allowCheck: true,
  },

};

// The old "Edit GRN" list (/accounting/report/grnEdit) is still linked from
// notifications (lib/notifications/links.js) and named by the server's rate
// resolution — it is the one GRN screen now.
VOUCHER_CONFIG.grnEdit = { ...VOUCHER_CONFIG.grn };
