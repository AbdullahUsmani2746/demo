import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { VOUCHER_CONFIG } from "@/components/Category/constants";
import { getServerSession } from 'next-auth'
import { authOptions } from '@/lib/auth'
import { setAuditActor } from '@/lib/audit/context'
import { reserveAssetNumbers } from '@/app/api/assets/generate-asset-no/route'
import { FIXED_ASSET_TRAN_CODES, saveFixedAssetVoucher, registerGrnAssets, fixedAssetDocumentError, faErrorBody } from '@/lib/fixedAssets/voucher'
import {
  isLitreUnit,
  resolveLineQuantities,
  missingLtrRateMessage,
} from '@/lib/units/litres'
import {
  clearVoucherAllocations,
  syncTaggedVoucherLines,
} from '@/lib/ledger/invoiceMatcher'
import { guardBy } from "@/lib/auth/route";
import { resolveItemAccounts } from "@/lib/accounts/itemAccounts";
import { getAccountGroups } from "@/lib/accounts/accountSettings";
import {
  POSTING_TYPES as SERVICE_POSTING_TYPES,
  prepareServiceInvoice,
  prepareServiceLinks,
  serviceHeaderRefs,
  serviceInvoiceAutoEntries,
  syncServiceLinks,
} from "@/lib/service/serviceInvoice";
import {
  planDocumentServices,
  syncDocumentServices,
  hasServiceWork,
  documentServicesDeleteError,
} from "@/lib/service/documentServices";
import {
  planDispatchBom,
  syncDispatchBom,
  deleteDispatchBom,
  findDispatchBomVouchers,
} from "@/lib/dispatch/bomProduction";
import {
  TAX_RULE,
  resolveTaxAccounts,
  buildTaxEntriesFor,
  resolveTransportAccounts,
  buildTransportEntries,
} from "@/lib/ledger/autoEntryAccounts";
import { isInvoicedMaster } from "@/lib/invoicing/kinds";
import { closedGodownError } from "@/lib/godowns";
import { documentScopeWhere, documentScopeError, recordScopeError } from "@/lib/auth/documentScope";
import { checkStockForSave } from "@/lib/stock/checkStock";
import { stockTypeForVoucher } from "@/lib/stock/policy";
import {
  packingNeeds,
  checkPackingStock,
  syncPackingConsumption,
  resolvePackingAccounts,
  deletePackingConsumption,
} from "@/lib/dispatch/packingConsumption";
import { SO_STATUS, pendingApprovalMessage, rejectedMessage } from "@/lib/orders/saleOrderApproval";
import { checkPeriodLock } from "@/lib/periodLock";
import { systemVoucherError } from "@/lib/vouchers/systemVouchers";
import { documentLabel } from "@/lib/periodLockCatalog";
import { guardedSave } from "@/lib/voucher/saveGuard";
import { approvalGate, runApprovedRequest } from "@/lib/approvals/rules";
import { getCashBankMacnos } from "@/lib/accounts/partyMacnos";
import { feature } from "@/lib/features/server";
import { markGrnDirectRates } from "@/lib/grn/directRate";
import { saleReturnLinkError } from "@/lib/saleReturns/dispatchLink";
import { applyLineWht } from "@/lib/tax/lineWht";
import { allocateOrderLines } from "@/lib/orders/lineAllocation";
import { stampDispatchLineTypes, trialDispatchLockError } from "@/lib/dispatch/trialBilling";
import {
  stripExtraFields,
  withoutSaleOrderError,
  batchRequiredError,
  dispatchLitreError,
  overDispatchError,
  overDispatchBand,
  packingConsumptionOn,
} from "@/lib/dispatch/dispatchChecks";
import { applySubAccounts, cleanSubAccount, SUB_ACCOUNT_TRAN_CODES } from "@/lib/vouchers/subAccounts";
// Features: dispatch.requirePostedProcessOrder / plan links on dispatch lines
import { dispatchReadyError, stampDispatchPlanLinks } from "@/lib/production/planNature";
import { attachEnteredBy, ENTERED_BY_USER_SELECT, userDisplayName } from "@/lib/audit/enteredBy";
import {
  withoutGodownId,
  isWithoutGodownOrder,
  noProductionPlan,
  WITHOUT_GODOWN_NOT_SET,
} from "@/lib/dispatch/withoutGodown";

// A dispatch (tran_code 6) may not be posted against a Sale Order that is
// still waiting for approval, or was rejected. Returns an error message, or null.
async function pendingSaleOrderError(tran_code, so_no) {
  if (tran_code !== 6 || !so_no) return null;
  const so = await prisma.orderMaster.findUnique({
    where: { order_no: Number(so_no) },
    select: { status: true },
  });
  if (so?.status === SO_STATUS.PENDING_APPROVAL) return pendingApprovalMessage(so_no);
  if (so?.status === SO_STATUS.REJECTED) return rejectedMessage(so_no);
  return null;
}

// Despatch Without Godown Sale Order (lib/dispatch/withoutGodown.js): the
// dispatch is moved to its fixed godown whatever the form sent. Returns
// { withoutGodown, error } — error while that godown is not configured. A
// category without a No Godown Sale Acno is refused by resolveVoucherAccounts.
async function applyWithoutGodown(tran_code, cleanMaster) {
  if (tran_code !== 6 || !(await isWithoutGodownOrder(cleanMaster.so_no))) {
    return { withoutGodown: false, error: null };
  }
  const godown = withoutGodownId();
  if (godown == null) return { withoutGodown: true, error: WITHOUT_GODOWN_NOT_SET };
  cleanMaster.godown = godown;
  return { withoutGodown: true, error: null };
}

// GET method
export const GET = guardBy(
  async (req, { params }) => `${(await params).type}.view`,
  async (req, { params, session }) => {
  const { type } = await params;
  const url = new URL(req.url);
  const page = parseInt(url.searchParams.get("page") || "1");
  const limit = parseInt(url.searchParams.get("limit") || "10");
  const search = url.searchParams.get("search") || "";
  const outsourced = url.searchParams.get("outsourced") === "true";
  const filterStatus = url.searchParams.get("filterStatus") || "";
  const sortBy = url.searchParams.get("sortBy") || "dated";
  const sortDir = url.searchParams.get("sortDir") || "desc";
  const id = url.searchParams.get("id") || "";

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

  const skip = (page - 1) * limit;
  const applySkip = search ? 0 : skip;

  const tran_code = VOUCHER_CONFIG[type]?.tran_code;
  if (!tran_code) {
    return NextResponse.json(
      { message: "Invalid voucher type" },
      { status: 400 }
    );
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

  // Search spans the voucher header AND its Transactions lines, so a cheque
  // number, a narration or a party typed on a line finds its voucher.
  //
  // Numeric columns are only added when the term actually is a number. The
  // old `equals: isNaN(...) ? undefined : n` form was harmless but dead — a
  // text search left five branches that could never match anything.
  const like = { contains: search, mode: "insensitive" };
  const searchNumber = Number(search);
  const isNumericSearch = search !== "" && !Number.isNaN(searchNumber);

  const searchOR = [
    // ── header ──────────────────────────────────────────────
    // `acno` is the relation to ACNO (its FK column is pycd). Filtering
    // `pycd` — a plain Int — with { acname } threw a Prisma validation
    // error, which took the whole search down with it.
    { acno: { acname: like } },
    { invoice_no: like },
    { check_no: like },
    { rmk: like },
    { rmk1: like },
    { rmk2: like },
    { rmk3: like },
    { rmk4: like },
    { rmk5: like },
    { manual_no: like },
    { city: like },
    { route: like },
    ...(isNumericSearch
      ? [
          { tran_id: searchNumber },
          { vr_no: searchNumber },
          { grn_no: searchNumber },
          { dispatch_no: searchNumber },
          { so_no: searchNumber },
          { pycd: searchNumber },
        ]
      : []),

    // ── lines ───────────────────────────────────────────────
    {
      transactions: {
        some: {
          OR: [
            { narration1: like },
            { narration2: like },
            { narration3: like },
            { narration4: like },
            { narration5: like },
            { chno: like },
            { party_name: like },
            // The line's own invoice_no — this is where a knock-off stamps
            // its match, and the header column does not carry it.
            { invoice_no: like },
            { acnoDetails: { acname: like } },
            ...(isNumericSearch ? [{ acno: searchNumber }] : []),
          ],
        },
      },
    },
  ];

  // A type can list only vouchers whose party sits under named Account
  // Settings groups — ExBond: GRNs of LC accounts (vendorGroups
  // ["lc_accounts"]). Not set → no filter; set but unconfigured → no rows.
  const vendorGroups = VOUCHER_CONFIG[type]?.vendorGroups;
  const vendorMacnos = Array.isArray(vendorGroups) && vendorGroups.length > 0
    ? await getAccountGroups(vendorGroups)
    : null;

  const where = {
    tran_code,
    ...(vendorMacnos && {
      acno: { macno: { in: vendorMacnos } },
    }),
    ...(id && !isNaN(Number(id)) && { tran_id: Number(id) }),
    ...(outsourced && { rmk1: "Yes" }),
    ...(search && { OR: searchOR }),
    // ...(filterStatus && { sync_status: filterStatus }),
    ...dateFilter, // ✅ Date filter add karein
    ...multiFilterWhere, // ✅ Multi-value filter
  };

  // Data scope (Admin → Permissions): a user / department limited to some
  // godowns sees only documents touching them (either side of a transfer).
  // lib/auth/scopeDimensions.js
  const scopeFrags = await documentScopeWhere(session, tran_code);
  if (scopeFrags.length) where.AND = [...(where.AND || []), ...scopeFrags];

  const [vouchers, total, invoices] = await Promise.all([
    prisma.transactionsMaster.findMany({
      where,
      skip: applySkip,
      take: limit,
      orderBy: { [sortBy]: sortDir },
      include: {
        acno: true,
        godownDetails: true,
        godown2Details: true,
        // Name only — the whole User row would send the password hash.
        user: { select: ENTERED_BY_USER_SELECT },
        ordersSO: true,
        ordersPO: true,
        transactions: {
          include: {
            acnoDetails: true,
            itemDetails: true,
            packingDetails: true,
            godownDetails: true,
            costCenter: true,
            currencyDetails: true,
            // Service Invoice: the service's name for the list / view / edit.
            ...(tran_code === 21 && {
              serviceDetails: { select: { id: true, service_name: true } },
            }),
          },
        },
      },
    }),
    prisma.transactionsMaster.count({ where }),
    prisma.transactionsMaster.findMany({
      where: {
        tran_code,
        OR: [
          { invoice_no: "" },
          { invoice_no: null }
        ],
        ordersSO: {
          freeOfCost: false
        }
      },
      select: {
        tran_id: true,
        transactions: {
          select: { damt: true, camt: true }
        }
      }
    }),
  ]);

  const totalNullInvoicesCount = invoices.filter((record) => {
    const totalDamt = record.transactions.reduce((sum, t) => sum + (Number(t.damt) || 0), 0);
    const totalCamt = record.transactions.reduce((sum, t) => sum + (Number(t.camt) || 0), 0);
    return (totalDamt + totalCamt) !== 0;
  }).length;

  const totalPages = Math.ceil(total / limit);

  console.log("Fetched vouchers with where clause:", vouchers.length);

  // itemsColumn (ExBond): one "n) code - item" line per item, like the
  // Letter of Credit list's LC Items column. Other types are untouched.
  const withItemsColumn = VOUCHER_CONFIG[type]?.itemsColumn === true;

  const addMMMinTransactions = vouchers.map((voucher) => {
    voucher.transactions.forEach((transaction) => {
      transaction.mm = transaction.itcd;
    });
    if (withItemsColumn) {
      voucher.items_description = voucher.transactions
        .filter((t) => (t.sub_tran_id ?? 1) === 1 && t.itcd != null)
        .map((t, i) => `${i + 1}) ${[t.itemDetails?.code, t.itemDetails?.item].filter(Boolean).join(" - ") || t.itcd}`)
        .join("\n");
    }
    voucher.entered_by = userDisplayName(voucher.user);
    return voucher;
  });
  // "Entered by" for older vouchers with no user_id: their AuditLog creator
  // (one batched lookup for the page) — lib/audit/enteredBy.js.
  await attachEnteredBy(addMMMinTransactions, "TransactionsMaster");


  return NextResponse.json({
    data: removeBigInt(addMMMinTransactions),
    totalPages,
    page,
    limit,
    total,
    totalNullInvoices: totalNullInvoicesCount,
  });
  },
);
// ============================================================
// CONSTANTS
// ============================================================

const ALLOWED_MASTER_FIELDS = new Set([
  "dated", "time", "clr_date", "tran_code", "vr_no",
  "service_id", "req_no", "pycd", "check_no", "check_date",
  "grn_no", "dispatch_no", "rmk", "rmk1", "rmk2", "rmk3", "rmk4", "rmk5",
  "user_id", "invoice_no", "godown", "godown2", "tr_amount", "tran_no",
  "ref_dispatch_no", "wc_order_id", "sync_status", "po_no", "so_no",
  "bond_id", "lc_no",
  // Dispatch "Manual DC No" / GRN "Manual GRN No" (the user's paper book number).
  "manual_no",
  // Dispatch "City" — where the vehicle is going.
  "city",
  // Dispatch "Route" — the way the vehicle goes.
  "route",
  // Files on the document (URLs — uploaded first via /api/voucher/attachments).
  "attachments",
  // GRN / purchase return: the vendor's bill no and date. Normally entered on
  // Invoicing (lib/invoicing/core.js); the voucher forms may still send them.
  "bill_date", "vendor_bill_no"
]);

const ALLOWED_LINE_FIELDS = new Set([
  "tran_id", "acno", "itcd", "service_id", "packing_material_code", "ccno",
  "batch_no", "po_qty", "so_qty", "req_qty", "narration1", "narration2",
  "narration3", "narration4", "narration5", "chno", "check_date", "party_name",
  // qty is KILOGRAMS and qty_ltr is litres. qty_ltr was missing from this list,
  // which is why the column was never written despite existing on the model.
  "stock", "unit", "damt", "camt", "qty", "qty_ltr", "original_qty", "rate",
  "wht_rate", "st_rate", "godown", "invoice_no", "sub_tran_id", "currency",
  "gross_amount", "fc_amount", "no_of_pack", "qty_per_pack", "returnable",
  "st_amount", "additional_tax",
  // Sale return of an old dispatch: its cost rate (saleReturn.requireDispatchLink,
  // lib/saleReturns/dispatchLink.js). Payment / receipt line tax law (tax.lineWht).
  "cost_rate", "tax_law_code",
  // Receipt / payment / journal line Sub Account (feature "vouchers.subAccounts",
  // settled by applySubAccounts in lib/vouchers/subAccounts.js before mapping).
  "sub_account",
  // Files on the line (URLs). A save recreates the lines, so they ride along.
  "attachments",
  // Dispatch line: TRIAL / RATE_NEG of its Sale Order line (orders.trialLineBilling).
  // Set only by the server (stampDispatchLineTypes) — what a client sends is dropped.
  "line_type",
  // Dispatch line: Production Plan / Process Order it came from — set only by
  // the server (stampDispatchPlanLinks, lib/production/planNature.js).
  "plan_no", "process_order_no",
  // ack_qty (acknowledged qty) is deliberately NOT here: only Invoicing
  // (lib/invoicing/core.js) writes it. Saving / editing a document recreates
  // its lines, so an acknowledgement made against the old qty is dropped
  // (NULL = bill the billable qty) and anything the client sends is ignored.
]);

// 20 / 21: a Service Entry / Service Invoice keeps the Service Order it is for.
const PO_ALLOWED = new Set([4, 9, 20, 21]);
const SO_ALLOWED = new Set([6, 10]);

// Physical documents carry QUANTITY ONLY (decided 2026-10-25): a GRN (4), a
// GRN / purchase return (9), a dispatch (6) and a dispatch / sale return (10)
// are posted UNPRICED — rate / st_rate 0, no amounts, no sub_tran_id=3 auto
// entries, no invoice number. Pricing, the ledger posting and the invoice
// number are applied later on the SAME document by Invoicing
// (/api/invoicing/[kind], lib/invoicing/core.js). Anything the client sends as
// a rate or amount here is discarded. "purchase", "sale" and "exbond" also map
// to tran_code 4 / 6 but are separate, direct-entry forms and stay priced.
const RATE_DEFERRED_TYPES = new Set([
  "dispatch", "dispatchEdit",
  "grn", "grnEdit",
  "grnReturn", "purchaseReturn",
  "saleReturn", "dispatchReturn",
]);

// Dispatch-only behaviour: issue godown, packing consumption, produce-on-dispatch BOM.
const DISPATCH_TYPES = new Set(["dispatch", "dispatchEdit"]);

// Transactions.line_type (a dispatch line's trial type) is set only by
// stampDispatchLineTypes — never taken from the request.
// The same for plan_no / process_order_no (stampDispatchPlanLinks).
const dropLineType = (line) => {
  if (!line || typeof line !== "object") return line;
  const { line_type, plan_no, process_order_no, ...rest } = line;
  return rest;
};

// An invoiced physical document (invoice_no set, or imported 'L' history) is
// locked: editing or deleting it would strip the pricing and the ledger rows
// off a document that carries an invoice number. Unlock it in Invoicing first.
// Checked on the STORED document's tran_code, not the route type, so the
// priced "purchase" / "sale" / "exbond" forms cannot edit one either.
const INVOICED_TRAN_CODES = new Set([4, 6, 9, 10]);
// The priced "purchase" / "sale" / "exbond" forms are retired (menus hidden):
// whatever form saves a GRN, dispatch or return, it is saved quantity-only.
const isDeferred = (type, tran_code) =>
  RATE_DEFERRED_TYPES.has(type) || INVOICED_TRAN_CODES.has(Number(tran_code));
function invoicedDocumentError(stored, type) {
  const deferred = RATE_DEFERRED_TYPES.has(type) || INVOICED_TRAN_CODES.has(Number(stored?.tran_code));
  if (!deferred || !isInvoicedMaster(stored)) return null;
  const no = String(stored.invoice_no ?? "").trim() || "imported history";
  return `This document is invoiced as ${no} — unlock it in Invoicing first.`;
}

// Same check inside the write transaction, with the master row locked: an
// invoice generated between the early check and this write (Invoicing takes
// the same row lock) must not be stripped by the delete / recreate of lines.
async function lockNotInvoiced(tx, tran_id, type) {
  const rows = await tx.$queryRaw`
    SELECT tran_code, invoice_no, invoice_series
    FROM "TRANSACTIONS_MASTER" WHERE tran_id = ${Number(tran_id)} FOR UPDATE`;
  const error = invoicedDocumentError(rows[0], type);
  if (error) throw Object.assign(new Error(error), { statusCode: 422 });
}

// The header of a deferred document never carries an invoice number: that is
// Invoicing's. A GRN / purchase-return form still sends the VENDOR's bill no
// in invoice_no — it is kept as vendor_bill_no instead.
function stripDeferredInvoiceNo(master, tran_code) {
  const typed = String(master.invoice_no?.value ?? master.invoice_no ?? "").trim();
  if ([4, 9].includes(tran_code) && typed && !String(master.vendor_bill_no ?? "").trim()) {
    master.vendor_bill_no = typed;
  }
  if (master.vendor_bill_no != null) master.vendor_bill_no = String(master.vendor_bill_no).trim().slice(0, 60) || null;
  delete master.invoice_no;
  return master;
}

// ============================================================
// HELPERS
// ============================================================

const parseOptionalInt = (value) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = parseInt(value, 10);
  return isNaN(parsed) ? null : parsed;
};

const parseOptionalFloat = (value, fallback = 0.0) =>
  parseFloat(value) || fallback;

// Attachment lists keep only stored file URLs; anything else (a File the
// browser serialised as {}) is dropped. Not an array → leave the column alone.
const cleanAttachments = (value) =>
  Array.isArray(value)
    ? value.filter((u) => typeof u === "string" && /^https?:\/\//i.test(u))
    : undefined;

const filterFields = (obj, allowedSet) =>
  Object.fromEntries(
    Object.entries(obj).filter(([key]) => allowedSet.has(key))
  );

// ============================================================
// SHARED: Validate and normalize master
// ============================================================

// Material Issue / Production / packing consumption that a dispatch keeps in
// step with itself. Changed by hand, the link (rmk1 / rmk4) can break and the
// next dispatch edit would create a second one while the orphan still counts.
const AUTO_DISPATCH_MARKERS = new Set(["AUTO_PACKING", "AUTO_DISPATCH_BOM", "AUTO_DISPATCH_PROD"]);
function autoVoucherError(master) {
  // Payroll, HR pay-outs … are never changed by hand (lib/vouchers/systemVouchers.js).
  const system = systemVoucherError(master);
  if (system) return system;
  if (!master || !AUTO_DISPATCH_MARKERS.has(master.rmk1)) return null;
  return `This entry is generated by dispatch${master.rmk4 ? ` (tran ${master.rmk4})` : ""} — edit or delete the dispatch instead.`;
}

// A document may only be edited / deleted through its own type's route: the
// URL type decides the permission checked and how the voucher is re-posted
// (e.g. a Service Entry (20) must not be rewritten as a Service Invoice (21)).
function tranCodeMismatchError(stored, type) {
  const expected = VOUCHER_CONFIG[type]?.tran_code;
  if (!stored || expected == null || Number(stored.tran_code) === Number(expected)) return null;
  return `This document is a ${documentLabel(stored.tran_code)}, not a ${documentLabel(expected)}.`;
}

// The issue godown a dispatch form sends in master.godown2 ({value,label} or
// an id) — read BEFORE normalizeMaster drops it from the dispatch master.
function issueGodownOf(master) {
  return parseOptionalInt(master?.godown2?.value ?? master?.godown2);
}

// Data scope for the issue godowns: the dispatch's own godowns are checked by
// documentScopeError, but its BOM materials leave stock from these (the
// header's "Issue Materials From" and any godown a material row names).
async function issueGodownScopeError(session, issueGodowns) {
  const ids = (issueGodowns || []).filter((g) => g != null);
  if (!ids.length) return null;
  const err = await recordScopeError(session, "godown", ids);
  return err ? `${err} An issue godown is outside them.` : null;
}

function normalizeMaster(master, tran_code) {
  const now = new Date();

  if ([1, 2, 3, 4, 6, 9, 10, 7, 8, 19, 20, 21].includes(tran_code)) {
    master.dated = master.dated ? new Date(master.dated) : now;
    master.time = master.dated;
    // A Service Invoice's check_date is the vendor's ST invoice date: blank
    // stays blank (other vouchers default it to today, as before).
    master.check_date = master.check_date
      ? new Date(master.check_date)
      : [20, 21].includes(tran_code) ? null : now;
    master.godown = parseOptionalInt(master.godown);
    master.pycd = Number(master.pycd);
    // Dispatch: the form's godown2 is the godown its BOM materials are issued
    // from. It is read by the route (issueGodownOf) and stored ONLY on the auto
    // Material Issue — never on the dispatch, because stock reports read
    // master.godown2 as a transfer's second godown and would count the
    // dispatch out of the issue godown too.
    if (tran_code === 6) master.godown2 = null;
  } else if (tran_code === 3 || tran_code === 11) {
    master.dated = new Date(master.dated);
    master.check_date = master.dated;
    master.time = master.dated;
    if (tran_code === 11) {
      master.godown = parseOptionalInt(master.godown);
      master.godown2 = parseOptionalInt(master.godown2);
    }
  } else if (tran_code === 14) {
    // Fixed Assets GRN: the date arrives as YYYY-MM-DD (or an ISO string) —
    // Prisma needs a Date. (Disposal 15 / relocation 16: lib/fixedAssets/voucher.js.)
    master.dated = master.dated ? new Date(master.dated) : now;
    master.time = master.dated;
  }

  master.po_no = master.po_no && PO_ALLOWED.has(tran_code) ? Number(master.po_no) : null;
  master.so_no = master.so_no && SO_ALLOWED.has(tran_code) ? Number(master.so_no) : null;

  // grn_no / dispatch_no are Int? in the schema — coerce empty strings to null
  // so a Purchase Invoice can be posted directly without a GRN.
  // A return's link to its original (GRN Return → grn_no, Sale Return →
  // dispatch_no) can arrive as a select object — unwrap it, Invoicing reads it
  // for the default rates (lib/invoicing/rates.js).
  if ("grn_no" in master) master.grn_no = parseOptionalInt(master.grn_no?.value ?? master.grn_no);
  if ("dispatch_no" in master) master.dispatch_no = parseOptionalInt(master.dispatch_no?.value ?? master.dispatch_no);

  // bond_id / lc_no arrive as select objects ({value, label}) or plain
  // strings from the GRN form's L/C / Ex-Bond fields — unwrap and coerce
  // empty selections to null so the FK columns stay clean.
  if (master.bond_id && typeof master.bond_id === "object") master.bond_id =Number( master.bond_id.value )?? null;
  if (master.bond_id === "") master.bond_id = null;
  if (master.lc_no && typeof master.lc_no === "object") master.lc_no = master.lc_no.value ?? null;
  if (master.lc_no === "") master.lc_no = null;

  // Receipt/Payment used to stamp rmk3 with "cash" or "bank". There is one
  // Payment and one Receipt now, so nothing records the distinction.
  if (master.rmk2?.value) master.rmk2 = String(master.rmk2.value);
  if (master.rmk1?.value) master.rmk1 = String(master.rmk1.value);
  if(master.rmk5?.value) master.rmk5 = String(master.rmk5.value)
  if (master.tr_amount) master.tr_amount = parseOptionalFloat(master.tr_amount);
  // Freight on a GRN / dispatch / sale return is billed as a Service Invoice;
  // the document itself no longer carries a freight amount.
  if ([4, 6, 10].includes(tran_code)) master.tr_amount = null;
  if ("bill_date" in master) {
    master.bill_date = master.bill_date ? new Date(master.bill_date?.value ?? master.bill_date) : null;
    if (master.bill_date && Number.isNaN(master.bill_date.getTime())) master.bill_date = null;
  }
  // Manual DC / GRN No: only a dispatch or GRN keeps one; blank = none.
  if ("manual_no" in master) {
    master.manual_no = [4, 6].includes(tran_code)
      ? String(master.manual_no ?? "").trim().slice(0, 50) || null
      : null;
  }
  // Dispatch City: only a dispatch keeps one; blank = none.
  if ("city" in master) {
    master.city = tran_code === 6 ? String(master.city?.value ?? master.city ?? "").trim().toUpperCase().slice(0, 100) || null : null;
  }
  // Dispatch Route: only a dispatch keeps one; blank = none.
  if ("route" in master) {
    master.route = tran_code === 6 ? String(master.route ?? "").trim().toUpperCase().slice(0, 150) || null : null;
  }
  if (master.pycd?.value === "") master.pycd = null;
  if (master?.acno?.acno) delete master.acno;
  master.attachments = cleanAttachments(master.attachments);

  return filterFields(master, ALLOWED_MASTER_FIELDS);
}

// ============================================================
// SHARED: Resolve every ledger account the voucher posts to
// ============================================================
// Item lines: item category column → Finance → Account Settings default
// (lib/accounts/itemAccounts.js — 4 purchase, 9 purchase return, 6 sales,
// 10 sales return, 7 / 11 stock). Plus, when auto entries are built, the
// sales-tax accounts and the transport pair (lib/ledger/autoEntryAccounts.js).
//
// Runs BEFORE anything is written: a missing account (422) or a transporter
// that is not an account (400) refuses the whole voucher instead of leaving
// half of it behind.
// ============================================================

const ITEM_ACCOUNT_TRAN_CODES = [4, 6, 7, 9, 10, 11];

async function resolveVoucherAccounts(lines, tran_code, master, { withAutoEntries, withoutGodown = false }) {
  const accounts = { lineAcno: {}, tax: null, transport: null };

  // A Material Issue's lines carry no account; only its landed-cost JV
  // (rmk1 "Yes") needs the stock accounts, so only that case may refuse.
  const needsItemAccounts =
    ITEM_ACCOUNT_TRAN_CODES.includes(tran_code) && (tran_code !== 7 || master?.rmk1 === "Yes");

  if (needsItemAccounts) {
    const { lineAcno, taxAcno } = await resolveItemAccounts(lines, tran_code, { withoutGodown });
    accounts.lineAcno = lineAcno;
    if (withAutoEntries && TAX_RULE[tran_code]) {
      accounts.tax = await resolveTaxAccounts(lines, tran_code, { taxAcno });
    }
  }

  if (withAutoEntries) {
    accounts.transport = await resolveTransportAccounts(tran_code, master.rmk2, master.tr_amount);
  }

  return accounts;
}

// The quantity a line is priced on: a LTR line's rate is per litre, so its
// value comes from qty_ltr, not from the derived KG. Shared by mapLine and
// buildAutoEntries so the party row always equals the goods lines.
function pricedQtyOf(line) {
  return isLitreUnit(line.unit)
    ? parseOptionalFloat(line.qty_ltr)
    : parseOptionalFloat(line.qty);
}

// ============================================================
// LTR ⇄ KG — resolve stock lines, and BLOCK what cannot be converted
// ============================================================
// A dispatch inherits its unit from the Sale Order; it never asks for it.
// Where that unit is LTR the litres are the source of truth: qty_ltr holds
// them and qty (KG, which is what moves stock) is derived from the item's
// current ltr_rate.
//
// Unlike a Sale Order, a missing ltr_rate here is FATAL. A sale order takes an
// order; a dispatch moves inventory, and posting a litre line without a
// conversion would either put litres into a KG column or leave the stock
// movement blank. Both are silently wrong, so the whole voucher is refused
// with a message naming the items to fix.
//
// See lib/units/litres.js.
async function resolveStockLineUnits(lines) {
  const itemIds = [
    ...new Set(
      lines
        .map((l) => parseOptionalInt(l.itcd?.value ?? l.itcd))
        .filter((n) => n != null),
    ),
  ];

  if (itemIds.length === 0) return { lines, blocked: [] };

  const items = await prisma.item.findMany({
    where: { itcd: { in: itemIds } },
    select: { itcd: true, item: true, ltr_rate: true },
  });
  const itemById = new Map(items.map((i) => [i.itcd, i]));

  const blocked = [];

  const resolved = lines.map((line) => {
    // Only litre lines need anything doing; a KG line is left exactly as it
    // arrived so nothing about existing vouchers changes.
    if (!isLitreUnit(line.unit)) return line;

    const itcd = parseOptionalInt(line.itcd?.value ?? line.itcd);
    const item = itemById.get(itcd);

    const q = resolveLineQuantities({
      unit: line.unit,
      qty: line.qty,
      qty_ltr: line.qty_ltr,
      ltr_rate: item?.ltr_rate ?? null,
      rate: line.rate,
    });

    if (!q.convertible) {
      blocked.push(missingLtrRateMessage(item?.item || `Item #${itcd}`));
      return line;
    }

    return { ...line, unit: q.unit, qty: q.qty, qty_ltr: q.qty_ltr };
  });

  return { lines: resolved, blocked };
}

// ============================================================
// SHARED: Map a single line to DB shape
// ============================================================

// `deferred` — a physical document (RATE_DEFERRED_TYPES): quantity only. Rate,
// GST % and every amount are 0 until Invoicing prices it, or the ledger would
// hold a sales credit / purchase debit with no party entry against it.
function mapLine(line, tran_id, tran_code, itemAccountMap, { deferred = false } = {}) {
  const base = {
    ...line,
    tran_id,
    sub_tran_id: 1,
    itcd: Number(line.itcd?.value) || Number(line.itcd) || null,
    acno: Number(line.acno?.value) || Number(line.acno) || null,
    packing_material_code:
      Number(line.packing_material_code?.value) ||
      Number(line.packing_material_code) ||
      null,
  };

  if ([1, 2].includes(tran_code)) {
    base.currency = parseOptionalInt(line.currency);
    // Receipt / payment line "Slip #" lives in narration5 (VarChar(150)).
    if ("narration5" in base) {
      const slip = base.narration5 == null ? "" : String(base.narration5).trim();
      base.narration5 = slip ? slip.slice(0, 150) : null;
    }
  }

  if ([1, 2, 3, 4, 6, 9, 10, 11, 7, 8].includes(tran_code)) {
    base.ccno = parseOptionalInt(line.ccno?.value ?? null);
  }

  if ([4, 6, 9, 10, 11].includes(tran_code)) {
    const itemValue = parseOptionalInt(line.itcd?.value ?? line.itcd);
    if (itemValue != null) {
      base.itcd = itemValue;
      base.acno = itemAccountMap[itemValue] ?? null;
    }

    if ([9, 10].includes(tran_code) && line.original_qty) {
      base.original_qty = parseOptionalFloat(line.original_qty);
    }

    // Price on the unit the line was transacted in (see pricedQtyOf).
    const pricedQty = pricedQtyOf(line);

    if (deferred) {
      // GRN direct rate (grn.directRateByItem, lib/grn/directRate.js): the
      // typed rate is kept as the invoicing default — still no amounts.
      base.rate = line.__directRate ? Math.max(0, parseOptionalFloat(line.rate) || 0) : 0;
      base.st_rate = 0;
      base.damt = 0;
      base.camt = 0;
      base.gross_amount = 0;
      base.st_amount = 0;
    } else if ([4].includes(tran_code)) {
      // Direct-entry purchase ("purchase" / "exbond"). A value-only line (no
      // quantity — e.g. an imported adjustment) keeps the amount it carries;
      // anything with a quantity is priced qty × rate.
      base.damt = pricedQty
        ? pricedQty * parseOptionalFloat(line.rate)
        : parseOptionalFloat(line.damt ?? line.gross_amount);
    } else if ([6].includes(tran_code)) {
      base.camt = pricedQty * parseOptionalFloat(line.rate);
    }
  }

  // Sub Account: receipt / payment / journal only (lib/vouchers/subAccounts.js)
  if (SUB_ACCOUNT_TRAN_CODES.has(tran_code)) base.sub_account = cleanSubAccount(line.sub_account);
  else delete base.sub_account;

  delete base.type;
  base.attachments = cleanAttachments(line.attachments);
  return filterFields(base, ALLOWED_LINE_FIELDS);
}

// ============================================================
// SHARED: Map a single deduction to DB shape
// ============================================================

function mapDeduction(deduction, tran_id) {
  const base = {
    ...deduction,
    tran_id,
    sub_tran_id: 2,
    itcd: null,
    acno: Number(deduction.acno?.value) || null,
    ccno: parseOptionalInt(deduction.ccno?.value) || null,
    currency: parseOptionalInt(deduction.currency),
    invoice_no: deduction.invoice_no?.value || null,
    sub_account: cleanSubAccount(deduction.sub_account),
  };
  return filterFields(base, ALLOWED_LINE_FIELDS);
}

// ============================================================
// FIXED ASSETS (tran_code 14 only)
// A line is a Fixed Asset when Item -> ItemCategory -> MainCategory name
// starts with "FIXED ASSET" (case-insensitive). No hardcoded IDs.
// ============================================================
const FIXED_ASSETS_MAIN_CATEGORY_PREFIX = "FIXED ASSET";

// Returns the Set of itcd values (from lines) that are Fixed Assets.
async function getFixedAssetItemIds(lines) {
  const itemIds = lines
    .map((line) => parseOptionalInt(line.itcd?.value ?? line.itcd))
    .filter((id) => id !== null);

  if (itemIds.length === 0) return new Set();

  const items = await prisma.item.findMany({
    where: { itcd: { in: itemIds } },
    select: {
      itcd: true,
      itemCategories: {
        select: { mainCategory: { select: { mc_name: true } } },
      },
    },
  });

  const set = new Set();
  for (const item of items) {
    const mcName = item.itemCategories?.mainCategory?.mc_name;
    if (mcName?.trim().toUpperCase().startsWith(FIXED_ASSETS_MAIN_CATEGORY_PREFIX)) {
      set.add(item.itcd);
    }
  }
  return set;
}

// Fixed Asset qty must be a positive whole number. Returns error string or null.
function validateFixedAssetQty(rawQty) {
  const qty = Number(rawQty);
  if (!Number.isFinite(qty) || !Number.isInteger(qty) || qty <= 0) {
    return "Fixed Asset quantity must be a positive whole number.";
  }
  return null;
}


function normalizeFixedAssetLine(line) {
  const out = { ...line };

  const toScalarSelect = (v) =>
    v && typeof v === "object" ? (v.value != null ? String(v.value) : null) : v;

  const toFloatOrNull = (v) => {
    if (v === "" || v == null) return null;
    const n = parseFloat(v);
    return Number.isFinite(n) ? n : null;
  };

  if ("narration4" in out) out.narration4 = toScalarSelect(out.narration4) ?? null;
  if ("wht_rate" in out) out.wht_rate = toFloatOrNull(out.wht_rate);

  out.no_of_pack = 1;
  out.qty_per_pack = 1;

  return out;
}

// Splits each Fixed Asset line (qty N) into N qty=1 rows, each with a unique
// asset_no from assetNumbers. Non-FA lines pass through unchanged.
function expandFixedAssetLines(mappedLines, originalLines, fixedAssetIds, assetNumbers) {
  const out = [];
  let cursor = 0;

  mappedLines.forEach((mapped, idx) => {
    const rawItcd = parseOptionalInt(
      originalLines[idx]?.itcd?.value ?? originalLines[idx]?.itcd
    );
    const isFixedAsset = rawItcd !== null && fixedAssetIds.has(rawItcd);

    if (!isFixedAsset) {
      out.push(mapped); // normal inventory — unchanged
      return;
    }

    const units = Number(mapped.qty);
    // damt was computed for the full qty; divide back to per-unit
    const perUnitDamt = units > 0 ? (Number(mapped.damt) || 0) / units : 0;
    for (let i = 0; i < units; i++) {
      out.push({
        ...mapped,
        qty: 1,
        damt: perUnitDamt,
        asset_no: assetNumbers[cursor++],
      });
    }
  });

  return out;
}

// ============================================================
// SHARED: Build auto entries
// ============================================================

// ============================================================
// SHARED: Auto JV for materialIssueLanded (tran_code=7, rmk1="Yes")
// Creates a separate tran_code=3 JV master + balanced lines.
// rmk5 on the JV stores the source tran_id so PUT can find + replace it.
// `stockAcno` is itcd → the item's STOCK account (resolveItemAccounts(lines, 7)).
// ============================================================

async function createLandedCostJV(sourceTranId, masterData, lines, stockAcno) {
  let totalLandedAmount = 0;
  const jvLines = [];

  for (const line of lines) {
    const lineAmount = parseOptionalFloat(line.qty) * parseOptionalFloat(line.rate);
    if (lineAmount === 0) continue;
    totalLandedAmount += lineAmount;
    const itemId = parseOptionalInt(line.itcd?.value ?? line.itcd);
    const stockAccno = stockAcno[itemId];
    if (stockAccno) {
      jvLines.push({ sub_tran_id: 1, acno: stockAccno, damt: 0, camt: lineAmount, narration1: "Material Issue Landed Cost" });
    }
  }

  if (totalLandedAmount === 0 || jvLines.length === 0) return null;

  // Debit line (pycd account)
  const debitLine = { sub_tran_id: 1, acno: masterData.pycd || null, damt: totalLandedAmount, camt: 0, narration1: "Material Issue Landed Cost" };

  const jvMaster = await prisma.transactionsMaster.create({
    data: {
      tran_code: 3,
      dated: masterData.dated,
      time: masterData.dated,
      check_date: masterData.dated,
      rmk1: "Material Issue Landed Cost",
      rmk5: String(sourceTranId), // link back to source voucher
      pycd: masterData.pycd || null,
      user_id: masterData.user_id || null,
    },
  });

  await prisma.transactions.createMany({
    data: [debitLine, ...jvLines].map((l) => ({ ...l, tran_id: jvMaster.tran_id })),
  });

  return jvMaster.tran_id;
}

async function checkOrderStatus(masterData) {
  try {
    const orderNo = masterData.so_no;

    if (!orderNo) return;

    // ± band (Features: dispatch.overDispatchTolerance, SMS 10 %): a line is
    // fully dispatched once within it of the ordered qty.
    const TOLERANCE = await overDispatchBand();

    // Order Master
    const orderMaster = await prisma.orderMaster.findUnique({
      where: {
        order_no: orderNo,
      },
      include: {
        orderDetails: true,
      },
    });

    if (!orderMaster) return;

    // A Sale Order waiting for approval keeps status 3 — dispatch
    // progress must never move it to open on its own.
    if (orderMaster.status === SO_STATUS.PENDING_APPROVAL || orderMaster.status === SO_STATUS.REJECTED) return;

    console.log("Order:", orderNo);

    // Quantity moved per item against this order (same rows as before), split
    // over the order's lines of that item in line order (lib/orders/lineAllocation.js)
    // — with the same item on two lines, each used to get the whole total.
    const issuedPerItem = new Map();
    for (const itcd of new Set(orderMaster.orderDetails.map((d) => d.itcd).filter((v) => v != null))) {
      const issued = await prisma.transactions.aggregate({
        where: { itcd, transactionsMaster: { so_no: orderNo } },
        _sum: { qty: true },
      });
      issuedPerItem.set(Number(itcd), issued._sum.qty || 0);
    }
    const issuedPerLine = allocateOrderLines(orderMaster.orderDetails, issuedPerItem);

    for (const detail of orderMaster.orderDetails) {
      const issuedQty = issuedPerLine.get(detail.id) || 0;
      const orderQty = detail.qty || 0;

      const minQty = orderQty * (1 - TOLERANCE);
      const maxQty = orderQty * (1 + TOLERANCE);

      const newDetailStatus =
        issuedQty >= minQty && issuedQty <= maxQty ? 2 : 1;

      if (detail.status !== newDetailStatus) {
        console.log(
          `Updating Detail ${detail.id}: issued=${issuedQty}, order=${orderQty}, range=[${minQty}-${maxQty}], status ${detail.status} -> ${newDetailStatus}`
        );
        await prisma.orderDetail.update({
          where: {
            id: detail.id,
          },
          data: {
            status: newDetailStatus,
          },
        });
      }
    }

    // Check karo koi pending detail to nahi
    const pending = await prisma.orderDetail.count({
      where: {
        order_no: orderNo,
        status: {
          not: 2,
        },
      },
    });

    const newMasterStatus = pending === 0 ? 2 : 1;

    if (orderMaster.status !== newMasterStatus) {
      console.log(
        `Updating Order Master ${orderNo}: status ${orderMaster.status} -> ${newMasterStatus}`
      );
      await prisma.orderMaster.update({
        where: {
          order_no: orderNo,
        },
        data: {
          status: newMasterStatus,
        },
      });
    }
  } catch (error) {
    console.error("checkOrderStatus Error:", error);
  }
}

// ── Delete the auto JV that was previously created for a source tran_id ──────
async function deleteLandedCostJV(sourceTranId) {
  const existing = await prisma.transactionsMaster.findFirst({
    where: { tran_code: 3, rmk1: "Material Issue Landed Cost", rmk5: String(sourceTranId) },
    select: { tran_id: true },
  });
  if (!existing) return;
  await prisma.transactions.deleteMany({ where: { tran_id: existing.tran_id } });
  await prisma.transactionsMaster.delete({ where: { tran_id: existing.tran_id } });
}

// Party row = goods + sales tax; the ST rows carry the same tax grouped per
// tax account, so every voucher balances:
//   4  GRN / purchase    party Cr  · input tax Dr
//   9  purchase return   party Dr  · input tax Cr (reverses the input tax)
//   6  dispatch / sale   party Dr  · output tax Cr
//   10 sale return       party Cr  · output tax Dr (reverses the output tax)
// `accounts` comes from resolveVoucherAccounts().
function buildAutoEntries(lines, deductions, tran_code, tran_id, masterData, accounts) {
  let totalDamt = 0;
  let totalCamt = 0;
  let totalStAmount = 0;

  for (const line of lines) {
    // Same rule as mapLine: a value-only purchase line (no quantity) counts
    // with its own amount, so the vendor credit always equals the lines.
    totalDamt +=
      [4].includes(tran_code)
        ? (pricedQtyOf(line)
            ? pricedQtyOf(line) * parseOptionalFloat(line.rate)
            : parseOptionalFloat(line.damt ?? line.gross_amount))
        : parseOptionalFloat(line.damt);

    totalCamt +=
      [6].includes(tran_code)
        ? pricedQtyOf(line) * parseOptionalFloat(line.rate)
        : parseOptionalFloat(line.camt);

    totalStAmount += parseOptionalFloat(line.st_amount);
  }

  if ([1, 2].includes(tran_code) && Array.isArray(deductions)) {
    for (const d of deductions) {
      if (tran_code === 2) totalCamt += parseOptionalFloat(d.camt);
      else if (tran_code === 1) totalDamt += parseOptionalFloat(d.damt);
    }
  }

  const damt =
    tran_code === 1 ? totalCamt - totalDamt :
      [6, 9].includes(tran_code) ? totalCamt + totalStAmount : 0;

  const camt =
    tran_code === 2 ? totalDamt - totalCamt :
      [4, 10].includes(tran_code) ? totalDamt + totalStAmount : 0;

  const entries = [
    {
      tran_id,
      sub_tran_id: 3,
      narration1: "Auto Entry",
      damt: damt || 0,
      camt: camt || 0,
      acno: masterData.pycd || null,
    },
  ];

  if (accounts.tax) {
    entries.push(...buildTaxEntriesFor(lines, tran_code, tran_id, accounts.tax));
  }

  entries.push(...buildTransportEntries(tran_id, accounts.transport, masterData.tr_amount));

  return entries;
}

// A row that carries money must name its account: the ledger and the Trial
// Balance file every amount under one, so a row without one drops out of them
// — the voucher still balances, the Trial Balance does not. Checked on the
// rows the save would post (lines, deductions, auto entries) before anything
// is written. Returns an error message, or null.
const ACCOUNT_REQUIRED_CODES = new Set([1, 2, 3, 4, 6, 9, 10]);
const carriesMoney = (r) => Math.abs(Number(r?.damt) || 0) >= 0.005 || Math.abs(Number(r?.camt) || 0) >= 0.005;

function rowsWithoutAccountError(tran_code, mappedLines, mappedDeductions, autoEntries) {
  if (!ACCOUNT_REQUIRED_CODES.has(tran_code)) return null;
  const missing = [];
  mappedLines.forEach((r, i) => {
    if (carriesMoney(r) && !r.acno) missing.push(r.itcd ? `line ${i + 1} (its item has no ledger account set)` : `line ${i + 1}`);
  });
  mappedDeductions.forEach((r, i) => {
    if (carriesMoney(r) && !r.acno) missing.push(`deduction ${i + 1}`);
  });
  if (autoEntries.some((r) => carriesMoney(r) && !r.acno)) {
    missing.push([1, 2].includes(tran_code) ? "the cash / bank account" : "the party account");
  }
  return missing.length
    ? `Select an account on ${missing.join(", ")}. An amount without an account cannot be posted — it would drop out of the ledger and put the Trial Balance out.`
    : null;
}

// The rows a save would post, mapped without a tran_id, then checked.
function voucherAccountError({ lines, deductions, tran_code, type, master, accounts, withAutoEntries }) {
  if (!ACCOUNT_REQUIRED_CODES.has(tran_code)) return null;
  const mapped = lines.map((l) => mapLine(l, null, tran_code, accounts.lineAcno, { deferred: isDeferred(type, tran_code) }));
  const auto = withAutoEntries ? buildAutoEntries(lines, deductions, tran_code, null, master, accounts) : [];
  return rowsWithoutAccountError(tran_code, mapped, deductions.map((d) => mapDeduction(d, null)), auto);
}

// The check on the raw request body, ahead of the approval gate (the save
// checks again on the final rows). Item lines are left to the save, whose
// item accounts are resolved there.
function bodyAccountError(body, tran_code) {
  if (!ACCOUNT_REQUIRED_CODES.has(tran_code)) return null;
  const lines = (Array.isArray(body?.lines) ? body.lines : []).map((l) => mapLine(l, null, tran_code, {})).filter((r) => !r.itcd);
  const deductions = (Array.isArray(body?.deductions) ? body.deductions : []).map((d) => mapDeduction(d, null));
  const pycd = body?.master?.pycd?.value ?? body?.master?.pycd;
  const header = [1, 2].includes(tran_code) && !pycd && (lines.some(carriesMoney) || deductions.some(carriesMoney)) ? [{ damt: 1, acno: null }] : [];
  return rowsWithoutAccountError(tran_code, lines, deductions, header);
}

async function checkAccountLock(acno) {
  const numAcno = Number(acno?.value ?? acno);
  if (!numAcno || isNaN(numAcno)) return false;

  const account = await prisma.aCNO.findUnique({
    where: {
      acno: numAcno,
    },
    select: {
      lock: true,
    },
  });

  return account?.lock === true;
}

// ============================================================
// SHARED: Validate request body
// ============================================================

function validateBody(body) {
  if (!body || typeof body !== "object")
    return "Request body must be a JSON object";

  const { master, lines, deductions } = body;

  if (!master || typeof master !== "object")
    return "Master must be a valid object";

  if (!Array.isArray(lines))
    return "Lines must be a valid array";

  if (deductions && !Array.isArray(deductions))
    return "Deductions must be a valid array if provided";

  return null;
}

// Batch stock is derived directly from Transactions.batch_no — there is no
// separate balance table. Each line stores its own batch_no, and the batch
// stock API computes per-batch quantity on demand from these lines.

// ============================================================
// POST — Create Voucher
// ============================================================

// Next free voucher number — the same rule as /api/voucher/next-vr-no.
async function nextVrNo(tranCode) {
  // A row without a number (NULL sorts first in DESC) must not restart the series.
  const where = { tran_code: tranCode, vr_no: { not: null } };
  if (tranCode === 1 || tranCode === 2) where.acno = { macno: { in: await getCashBankMacnos() } };
  const last = await prisma.transactionsMaster.findFirst({ where, orderBy: { vr_no: "desc" }, select: { vr_no: true } });
  return (last?.vr_no ?? 0) + 1;
}

// Posting a held document once an approver approves it (lib/approvals/rules.js).
// Reached only through /api/approvals/requests/[id] (header x-approval-post);
// runApprovedRequest checks the caller is an approver and the request still
// pending, then runs the create / update AS ITS REQUESTER. A new voucher gets
// a fresh number (the one shown when it was requested may have been used).
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

// POST — create. Approval rules (Permissions → Approvals) first: a matching
// document is held, not posted. Then guardedSave (lib/voucher/saveGuard.js):
// a double-click, a retry after a dropped connection, or two users posting the
// same Sale Order at once can no longer create the document twice.
export const POST = guardBy(
  // An approver posting a held document need not hold <type>.create —
  // runApprovedRequest checks they are an approver of its rule instead.
  async (req, { params }) => (req.headers.get("x-approval-post") ? null : `${(await params).type}.create`),
  async (req, ctx) => {
    const { type } = await ctx.params;
    const tran_code = VOUCHER_CONFIG[type]?.tran_code;
    const approval = approvalHeaders(req);
    if (approval) {
      return runApprovedRequest({
        requestId: approval.id,
        type,
        session: ctx.session,
        remarks: approval.remarks,
        prepare: async (payload) => {
          if (payload.master && "vr_no" in payload.master) payload.master.vr_no = await nextVrNo(tran_code);
          return payload;
        },
        run: (synthetic, actingSession) => createVoucher(synthetic, { ...ctx, actingSession }),
      });
    }
    let body = null;
    try {
      body = await req.clone().json();
    } catch {
      body = null;
    }
    if (!tran_code || !body) return createVoucher(req, ctx);

    // An amount without an account is refused before it can be held for approval
    const accountError = bodyAccountError(body, tran_code);
    if (accountError) return NextResponse.json({ message: accountError }, { status: 422 });
    // …and so is a missing / unknown Sub Account (createVoucher repeats the check)
    const subAccountError = await applySubAccounts({ tranCode: tran_code, lines: body.lines, deductions: body.deductions });
    if (subAccountError) return NextResponse.json({ message: subAccountError }, { status: 422 });

    const held = await approvalGate({ type, tranCode: tran_code, action: "create", body, session: ctx.session });
    if (held) return held;

    return guardedSave({
      body,
      tranCode: tran_code,
      label: VOUCHER_CONFIG[type]?.label || type,
      userId: ctx.session?.user?.id ?? null,
      // The body is already parsed: hand it over rather than reading the request a
      // second time (a re-read after clone() fails intermittently: "Body is unusable").
      save: () => createVoucher(req, { ...ctx, parsedBody: body }),
    });
  },
);

// actingSession: set only when an approved request is posted — the document is
// then saved as its requester (runApprovedRequest, lib/approvals/rules.js).
async function createVoucher(req, { params, actingSession = null, parsedBody = null }) {
  try {
    const { type } = await params;
    const tran_code = VOUCHER_CONFIG[type]?.tran_code;
    const session = actingSession ?? await getServerSession(authOptions)
    setAuditActor(session);



    if (!tran_code) {
      return NextResponse.json({ message: "Invalid voucher type" }, { status: 400 });
    }

    const body = parsedBody ?? await req.json();
    const validationError = validateBody(body);
    if (validationError) {
      return NextResponse.json({ message: validationError }, { status: 400 });
    }

    const { master, deductions = [] } = body;
    let { lines } = body;
    // Every document gets its voucher number: a form that does not send one
    // (e.g. Dispatch, numbered by dispatch_no) still takes the next of its
    // series, so ledgers and registers never show VR # 0 / blank.
    if (master && !(Number(master.vr_no) > 0)) master.vr_no = await nextVrNo(tran_code);

    // Settings → Features (lib/features/catalog.js). Switched off = the request
    // cannot use the flow, whatever a screen sends.
    if (DISPATCH_TYPES.has(type) && !(await feature("dispatch.produceOnDispatch"))) {
      lines = lines.map(({ materials, ...line }) => line); // a dispatch takes finished goods in stock only
    }
    // A line's trial type is the server's to set (stampDispatchLineTypes below)
    lines = lines.map(dropLineType);
    if (DISPATCH_TYPES.has(type)) await stripExtraFields(master); // dispatch.extraFields off → not written
    // Ported from Accounting (Settings → Features): GRN direct rate, sale return
    // dispatch link + old-dispatch cost rate, withholding tax per line.
    await markGrnDirectRates(lines, { tranCode: tran_code });
    if (tran_code === 10) {
      const linkError = await saleReturnLinkError(master, lines);
      if (linkError) return NextResponse.json({ message: linkError }, { status: 422 });
    }
    const whtError = await applyLineWht({ tranCode: tran_code, lines, deductions });
    if (whtError) return NextResponse.json({ message: whtError }, { status: 422 });
    if (!(await feature("documents.servicesPanel"))) delete body.services; // no services booked from the document
    // Sub Accounts (feature "vouchers.subAccounts"): off → none written; on → checked, and required where set up
    const subAccountError = await applySubAccounts({ tranCode: tran_code, lines, deductions });
    if (subAccountError) return NextResponse.json({ message: subAccountError }, { status: 422 });

    const isLocked = await checkAccountLock(master?.pycd);

    if (isLocked) {
      return NextResponse.json(
        {
          message: "This account is locked. Please contact Finance Department.",
        },
        { status: 422 }
      );
    }
    // Period lock guard
    const lockError = await checkPeriodLock(master?.dated, tran_code, { action: "create" });
    if (lockError) {
      return NextResponse.json({ message: lockError }, { status: 422 });
    }

    // Fixed Asset Disposal (15) / Relocation (16): lib/fixedAssets/voucher.js
    if (FIXED_ASSET_TRAN_CODES.has(tran_code)) {
      const fa = await saveFixedAssetVoucher({ tran_code, body, session });
      return NextResponse.json(fa.body, { status: fa.status });
    }

    delete master.orderDetails;
    if ([9, 10].includes(tran_code)) {
      delete master.tran_id;
      delete master.godownDetails;
      delete master.godown2Details;
      delete master.transactions;
    }

    const issueGodown = DISPATCH_TYPES.has(type) ? issueGodownOf(master) : null;
    if (isDeferred(type, tran_code)) stripDeferredInvoiceNo(master, tran_code);
    const cleanMaster = normalizeMaster(master, tran_code);

    const soPendingError = await pendingSaleOrderError(tran_code, cleanMaster.so_no);
    if (soPendingError) {
      return NextResponse.json({ message: soPendingError }, { status: 422 });
    }

    // Settings → Features on a dispatch (lib/dispatch/dispatchChecks.js)
    if (DISPATCH_TYPES.has(type)) {
      const featureError =
        (await withoutSaleOrderError(cleanMaster.so_no)) ||
        (await batchRequiredError(lines)) ||
        (await dispatchLitreError(lines, { soNo: cleanMaster.so_no })) ||
        // Process / Manufacturing plan line without a posted Process Order, or not marked by the Lab
        (await dispatchReadyError({ soNo: cleanMaster.so_no, lines }));
      if (featureError) return NextResponse.json({ message: featureError }, { status: 422 });
    }

    const { withoutGodown, error: withoutGodownError } = await applyWithoutGodown(tran_code, cleanMaster);
    if (withoutGodownError) {
      return NextResponse.json({ message: withoutGodownError }, { status: 422 });
    }

    // Closed godowns (Setup → Godowns) cannot be posted to — except the
    // Despatch Without Godown godown by such a dispatch.
    const godownError = await closedGodownError([
      cleanMaster.godown, cleanMaster.godown2, ...(Array.isArray(lines) ? lines : []).map((l) => l?.godown),
    ], { allow: withoutGodown ? [cleanMaster.godown] : [] });
    if (godownError) {
      return NextResponse.json({ message: godownError }, { status: 422 });
    }

    // Data scope: only into / out of the user's own godowns.
    const postScopeError = await documentScopeError(session, tran_code, cleanMaster, lines);
    if (postScopeError) {
      return NextResponse.json({ message: postScopeError }, { status: 403 });
    }

    // Packing material: consumed by an automatic tran_code 7 entry linked to
    // this dispatch (lib/dispatch/packingConsumption.js). Short stock follows
    // the stock check policy "packing" (Settings → Stock checking).
    // Nothing is packed for a Despatch Without Godown — no consumption.
    // Settings → Features "dispatch.packingConsumption" off → none for a new dispatch.
    const packing = DISPATCH_TYPES.has(type) && !withoutGodown && (await packingConsumptionOn()) ? packingNeeds(lines) : new Map();
    const warnings = [];
    if (packing.size) {
      const packingLockError = await checkPeriodLock(cleanMaster.dated, 7, { action: "create" });
      if (packingLockError) {
        return NextResponse.json({ message: packingLockError }, { status: 422 });
      }
      const { message: packingShort, mode: packingMode } = await checkPackingStock({
        db: prisma,
        needs: packing,
        godown: cleanMaster.godown,
        dispatchTranId: null,
      });
      if (packingShort) {
        if (packingMode === "block") {
          return NextResponse.json({ message: packingShort }, { status: 422 });
        }
        warnings.push(packingShort);
      }
    }

    // Physical documents are saved without rates: PO / Sale Order / price
    // list rates are only Invoicing's defaults now (lib/invoicing/rates.js).

    // LTR ⇄ KG. Refuses the whole voucher when a litre line's item has no
    // ltr_rate — a dispatch must never post a stock movement nobody can justify.
    {
      const { lines: unitLines, blocked } = await resolveStockLineUnits(lines);
      if (blocked.length > 0) {
        return NextResponse.json(
          { message: blocked.join(" "), issues: blocked },
          { status: 422 },
        );
      }
      lines = unitLines;
    }

    if (DISPATCH_TYPES.has(type)) {
      // Over the Sale Order by more than the band (dispatch.overDispatchTolerance)
      const overError = await overDispatchError({ soNo: cleanMaster.so_no, lines });
      if (overError) return NextResponse.json({ message: overError }, { status: 422 });
      // Each line remembers its Sale Order line's Trial / Rate Negotiation type
      lines = await stampDispatchLineTypes({
        soNo: cleanMaster.so_no, lines, enabled: await feature("orders.trialLineBilling"),
      });
      // Plan No / Process Order No of each line's Sale Order item
      lines = await stampDispatchPlanLinks({ soNo: cleanMaster.so_no, lines });
    }

    // Stock check policy (Settings → Stock checking, lib/stock/checkStock.js)
    // for every stock-out voucher except dispatch, which bomProduction checks.
    // Block → throws 422 (caught below); warn → a warning on the response.
    const stockType = stockTypeForVoucher(type, tran_code);
    if (stockType) {
      const { message: stockShort } = await checkStockForSave({
        type: stockType,
        godown: cleanMaster.godown,
        lines,
      });
      if (stockShort) warnings.push(stockShort);
    }

    // Produce-on-dispatch: each line's BOM materials are stock-checked in the
    // issue godown (a line without materials in the dispatch godown) and
    // valued, before anything is written (lib/dispatch/bomProduction.js).
    let bomPlan = null;
    // Despatch Without Godown: nothing produced, no stock check.
    if (DISPATCH_TYPES.has(type)) {
      bomPlan = withoutGodown
        ? noProductionPlan(cleanMaster)
        : await planDispatchBom({ lines, master: cleanMaster, issueGodown });
      warnings.push(...bomPlan.warnings);
      if (bomPlan.inputs.length) {
        // The issue godowns only matter when something is issued from them.
        const issueGodownError = await closedGodownError(bomPlan.issueGodowns);
        if (issueGodownError) return NextResponse.json({ message: issueGodownError }, { status: 422 });
        const issueScopeError = await issueGodownScopeError(session, bomPlan.issueGodowns);
        if (issueScopeError) return NextResponse.json({ message: issueScopeError }, { status: 403 });
        for (const code of [7, 8]) {
          const bomLockError = await checkPeriodLock(cleanMaster.dated, code, { action: "create" });
          if (bomLockError) return NextResponse.json({ message: bomLockError }, { status: 422 });
        }
      }
    }

    const addUserintoCleanMaster = { ...cleanMaster, user_id: session?.user?.id }

    // Fixed Asset GRN (tran_code 14): split lines into qty=1 asset rows with
    // unique asset numbers, reserved atomically in the same transaction.
    if (tran_code === 14) {
      lines = lines.map(normalizeFixedAssetLine);

      const fixedAssetIds = await getFixedAssetItemIds(lines);

      for (const line of lines) {
        const rawItcd = parseOptionalInt(line.itcd?.value ?? line.itcd);
        if (rawItcd !== null && fixedAssetIds.has(rawItcd)) {
          const qtyError = validateFixedAssetQty(line.qty);
          if (qtyError) {
            return NextResponse.json({ message: qtyError }, { status: 400 });
          }
        }
      }

      const totalAssetUnits = lines.reduce((sum, line) => {
        const rawItcd = parseOptionalInt(line.itcd?.value ?? line.itcd);
        if (rawItcd !== null && fixedAssetIds.has(rawItcd)) {
          return sum + Number(line.qty);
        }
        return sum;
      }, 0);

      // Asset lines keep posting to the category's stock account (→ 'stock'
      // default), as they did before purchases got their own account.
      const { lineAcno: itemAccountMap } = await resolveItemAccounts(lines, 7);

      const faMasterData = await prisma.$transaction(async (tx) => {
        const createdMaster = await tx.transactionsMaster.create({
          data: addUserintoCleanMaster,
        });

        // Map lines using the existing shape as a purchase GRN (tran_code 4),
        // then expand fixed-asset lines into per-unit rows with asset numbers.
        const mappedLines = lines.map((line) =>
          mapLine(line, createdMaster.tran_id, 4, itemAccountMap)
        );

        const assetNumbers =
          totalAssetUnits > 0
            ? await reserveAssetNumbers(tx, totalAssetUnits)
            : [];

        const expandedLines = expandFixedAssetLines(
          mappedLines,
          lines,
          fixedAssetIds,
          assetNumbers
        );

        const mappedDeductions = deductions.map((d) =>
          mapDeduction(d, createdMaster.tran_id)
        );

        await tx.transactions.createMany({
          data: [...expandedLines, ...mappedDeductions],
        });

        // Feature "fixedAssets.autoRegisterFromGrn": the units join the
        // Fixed Asset Register (+ capitalisation journal) in this same save.
        const registration = await registerGrnAssets(tx, createdMaster.tran_id, session);
        return { ...createdMaster, registration };
      }, { timeout: 60_000, maxWait: 20_000 }).catch((error) => {
        const known = faErrorBody(error);
        if (known) return { refused: known };
        throw error;
      });
      if (faMasterData.refused) return NextResponse.json(faMasterData.refused.body, { status: faMasterData.refused.status });

      return NextResponse.json(
        { message: "Voucher updated", voucherId: faMasterData.tran_id, vrNo: faMasterData.vr_no, grnNo: faMasterData.grn_no, dispatchNo: faMasterData.dispatch_no, registration: faMasterData.registration },
        { status: 201 }
      );
    }

    // Deferred-pricing documents get no sub_tran_id=3 rows here — Invoicing
    // builds them when the invoice is generated.
    const withAutoEntries =
      [1, 2, 4, 6, 9, 10].includes(tran_code) && !isDeferred(type, tran_code);

    // Every account resolved before the first write (422 / 400 on a gap).
    const accounts = await resolveVoucherAccounts(lines, tran_code, cleanMaster, { withAutoEntries, withoutGodown });
    const accountError = voucherAccountError({ lines, deductions, tran_code, type, master: cleanMaster, accounts, withAutoEntries });
    if (accountError) return NextResponse.json({ message: accountError }, { status: 422 });
    const packingAcno = packing.size ? await resolvePackingAccounts(packing) : {};

    // GRN / dispatch Services panel → its linked Service Invoices
    // (lib/service/documentServices.js), validated before anything is written.
    const servicePlan = SERVICE_POSTING_TYPES.has(type)
      ? null
      : await planDocumentServices({ services: body.services, tranCode: tran_code, master: cleanMaster, session });

    // Service Invoice: priced from qty × rate, posted (Dr expense / Dr input
    // tax / Cr vendor) and linked to its GRNs / dispatches in one transaction
    // (lib/service/serviceInvoice.js). Everything is resolved before writing.
    if (SERVICE_POSTING_TYPES.has(type)) {
      const serviceLines = await prepareServiceInvoice(lines);
      const serviceLinks = await prepareServiceLinks(master?.links);
      const serviceRefs = await serviceHeaderRefs(serviceLinks);
      const serviceAuto = await serviceInvoiceAutoEntries(serviceLines, cleanMaster, null);
      const serviceMaster = await prisma.$transaction(async (tx) => {
        const created = await tx.transactionsMaster.create({ data: { ...addUserintoCleanMaster, ...serviceRefs } });
        await tx.transactions.createMany({
          data: [
            ...serviceLines.map((line) => mapLine(line, created.tran_id, tran_code, {})),
            ...serviceAuto.map((row) => ({ ...row, tran_id: created.tran_id })),
          ],
        });
        await syncServiceLinks(tx, created.tran_id, serviceLinks);
        return created;
      });
      return NextResponse.json(
        { message: "Voucher updated", voucherId: serviceMaster.tran_id, vrNo: serviceMaster.vr_no, warnings },
        { status: 201 }
      );
    }

    // Dispatch: the dispatch, its packing consumption and its auto Material
    // Issue / Production are written together or not at all.
    if (DISPATCH_TYPES.has(type)) {
      const dispatchMaster = await prisma.$transaction(
        async (tx) => {
          const created = await tx.transactionsMaster.create({ data: addUserintoCleanMaster });
          await tx.transactions.createMany({
            data: [
              ...lines.map((line) => mapLine(line, created.tran_id, tran_code, accounts.lineAcno, { deferred: true })),
              ...deductions.map((d) => mapDeduction(d, created.tran_id)),
            ],
          });
          if (packing.size) {
            await syncPackingConsumption(tx, created, packing, { acnoByItcd: packingAcno });
          }
          // Re-check stock under per-item locks inside the transaction, so a
          // dispatch saved at the same moment cannot take the same stock.
          const lockedPlan = withoutGodown
            ? noProductionPlan(cleanMaster)
            : await planDispatchBom({
                db: tx, lines, master: cleanMaster, issueGodown, dispatchTranId: created.tran_id, lock: true,
              });
          await syncDispatchBom(tx, created, lockedPlan);
          await syncDocumentServices(tx, created, servicePlan);
          return created;
        },
        { timeout: 60_000, maxWait: 20_000 },
      );
      await checkOrderStatus(dispatchMaster);
      return NextResponse.json(
        { message: "Voucher updated", voucherId: dispatchMaster.tran_id, vrNo: dispatchMaster.vr_no, grnNo: dispatchMaster.grn_no, dispatchNo: dispatchMaster.dispatch_no, warnings },
        { status: 201 }
      );
    }

    // GRN with services: the GRN and its service invoices are written together
    // or not at all. (A GRN is quantity-only — no auto entries to build.)
    if (hasServiceWork(servicePlan)) {
      const docMaster = await prisma.$transaction(async (tx) => {
        const created = await tx.transactionsMaster.create({ data: addUserintoCleanMaster });
        await tx.transactions.createMany({
          data: [
            ...lines.map((line) => mapLine(line, created.tran_id, tran_code, accounts.lineAcno, { deferred: isDeferred(type, tran_code) })),
            ...deductions.map((d) => mapDeduction(d, created.tran_id)),
          ],
        });
        await syncDocumentServices(tx, created, servicePlan);
        return created;
      });
      return NextResponse.json(
        { message: "Voucher updated", voucherId: docMaster.tran_id, vrNo: docMaster.vr_no, grnNo: docMaster.grn_no, dispatchNo: docMaster.dispatch_no, warnings },
        { status: 201 }
      );
    }

    const masterData = await prisma.transactionsMaster.create({ data: addUserintoCleanMaster });

    const mappedLines = lines.map((line) =>
      mapLine(line, masterData.tran_id, tran_code, accounts.lineAcno, { deferred: isDeferred(type, tran_code) })
    );

    const mappedDeductions = deductions.map((d) =>
      mapDeduction(d, masterData.tran_id)
    );

    const autoEntries = withAutoEntries
      ? buildAutoEntries(lines, deductions, tran_code, masterData.tran_id, masterData, accounts)
      : [];

    await prisma.transactions.createMany({
      data: [...mappedLines, ...mappedDeductions, ...autoEntries],
    });

    // Receipt/Payment/JV lines the user tagged with an invoice_no become
    // INVOICE_KNOCKOFF allocations right away (untagged ones wait for the
    // FIFO cron), so outstanding/aging see the settlement immediately.
    if ([1, 2, 3].includes(tran_code)) {
      await syncTaggedVoucherLines(prisma, masterData.tran_id, { userId: session?.user?.id ?? null });
    }

    if (tran_code === 6) {
      await checkOrderStatus(masterData);
    }

    if (packing.size) {
      await prisma.$transaction((tx) =>
        syncPackingConsumption(tx, masterData, packing, { acnoByItcd: packingAcno }),
      );
    }

    // Auto JV for materialIssueLanded — tran 7 lines resolve to each item's
    // stock account, which is what the JV credits.
    if (tran_code === 7 && masterData.rmk1 === "Yes") {
      await createLandedCostJV(masterData.tran_id, masterData, lines, accounts.lineAcno);
    }

    return NextResponse.json(
      { message: "Voucher updated", voucherId: masterData.tran_id, vrNo: masterData.vr_no, grnNo: masterData.grn_no, dispatchNo: masterData.dispatch_no, warnings },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error saving voucher:", error);
    // Account Settings gaps (422) and bad transporter accounts (400)
    if ([400, 403, 422].includes(error?.statusCode)) {
      return NextResponse.json({ message: error.message }, { status: error.statusCode });
    }
    return NextResponse.json(
      { message: "Server error", error: error?.message ?? String(error) },
      { status: 500 }
    );
  }
}

// ============================================================
// PUT — Update Voucher
// ============================================================

// PUT — an edit. Approval rules that apply to edits (Permissions → Approvals)
// hold it: the saved voucher stays as it is until an approver approves, then
// the edit is applied as its requester (lib/approvals/rules.js).
export const PUT = guardBy(
  async (req, { params }) => (req.headers.get("x-approval-post") ? null : `${(await params).type}.update`),
  async (req, ctx) => {
    const { type } = await ctx.params;
    const tran_code = VOUCHER_CONFIG[type]?.tran_code;
    const approval = approvalHeaders(req);
    if (approval) {
      return runApprovedRequest({
        requestId: approval.id,
        type,
        session: ctx.session,
        remarks: approval.remarks,
        run: (synthetic, actingSession) => updateVoucher(synthetic, { ...ctx, actingSession }),
      });
    }
    let body = null;
    try {
      body = await req.clone().json();
    } catch {
      body = null;
    }
    const tranId = Number(body?.master?.tran_id);
    if (tran_code && tranId) {
      const accountError = bodyAccountError(body, tran_code);
      if (accountError) return NextResponse.json({ message: accountError }, { status: 422 });
      // Checked before the approval gate, so a user who may not edit this
      // document cannot park an edit request on it (nor read it back through
      // the request). updateVoucher repeats these checks when it runs.
      const stored = await prisma.transactionsMaster.findUnique({
        where: { tran_id: tranId },
        select: { tran_code: true, vr_no: true, grn_no: true, dispatch_no: true, godown: true, godown2: true, pycd: true, invoice_no: true, invoice_series: true },
      });
      if (!stored) return NextResponse.json({ message: "Transaction not found" }, { status: 404 });
      const mismatchError = tranCodeMismatchError(stored, type);
      if (mismatchError) return NextResponse.json({ message: mismatchError }, { status: 422 });
      const invoicedError = invoicedDocumentError(stored, type);
      if (invoicedError) return NextResponse.json({ message: invoicedError }, { status: 422 });
      const storedScopeError =
        (await documentScopeError(ctx.session, tran_code, stored)) ||
        (await documentScopeError(ctx.session, tran_code, body.master, body.lines));
      if (storedScopeError) return NextResponse.json({ message: storedScopeError }, { status: 403 });
      const subAccountError = await applySubAccounts({ tranCode: tran_code, lines: body.lines, deductions: body.deductions, storedTranId: tranId });
      if (subAccountError) return NextResponse.json({ message: subAccountError }, { status: 422 });
      const held = await approvalGate({
        type,
        tranCode: tran_code,
        action: "update",
        targetId: tranId,
        targetNo: stored?.dispatch_no ?? stored?.grn_no ?? stored?.vr_no ?? tranId,
        body,
        session: ctx.session,
      });
      if (held) return held;
    }
    return updateVoucher(req, { ...ctx, parsedBody: body }); // read the body once (see POST)
  },
);

async function updateVoucher(req, { params, actingSession = null, parsedBody = null }) {
  try {
    const { type } = await params;
    const tran_code = VOUCHER_CONFIG[type]?.tran_code;
    const session = actingSession ?? await getServerSession(authOptions);
    setAuditActor(session);

    if (!tran_code) {
      return NextResponse.json({ message: "Invalid voucher type" }, { status: 400 });
    }

    // Parse body early so we can read dated for period-lock check. Both the
    // stored date and the new one are checked, so a voucher in a locked month
    // cannot be edited out of it by changing its date.
    const putBody = parsedBody ?? await req.json();
    const putTranId = Number(putBody?.master?.tran_id);
    const storedVoucher = putTranId
      ? await prisma.transactionsMaster.findUnique({
          where: { tran_id: putTranId },
          select: { tran_code: true, dated: true, invoice_no: true, invoice_series: true, vendor_bill_no: true, godown: true, godown2: true, pycd: true, rmk1: true, rmk4: true, so_no: true, dispatch_no: true, dispatch_part: true },
        })
      : null;
    if (putTranId && !storedVoucher) {
      return NextResponse.json({ message: "Transaction not found" }, { status: 404 });
    }
    const mismatchError = tranCodeMismatchError(storedVoucher, type);
    if (mismatchError) return NextResponse.json({ message: mismatchError }, { status: 422 });
    const autoError = autoVoucherError(storedVoucher);
    if (autoError) return NextResponse.json({ message: autoError }, { status: 422 });
    // Fixed assets: a registered GRN, a disposal, a relocation (lib/fixedAssets/voucher.js)
    const faDocError = await fixedAssetDocumentError(storedVoucher, putTranId);
    if (faDocError) return NextResponse.json({ message: faDocError }, { status: 422 });
    // A trial billing part, or a dispatch whose trial items were billed on parts
    const trialLockError = await trialDispatchLockError(storedVoucher);
    if (trialLockError) return NextResponse.json({ message: trialLockError }, { status: 422 });
    const putLockError = await checkPeriodLock(
      [storedVoucher?.dated, putBody?.master?.dated],
      tran_code,
      { action: "update" },
    );
    if (putLockError) {
      return NextResponse.json({ message: putLockError }, { status: 422 });
    }

    const body = putBody;
    const validationError = validateBody(body);
    if (validationError) {
      return NextResponse.json({ message: validationError }, { status: 400 });
    }
    // Settings → Features: services panel off → the edit leaves linked service
    // invoices as they are. (Produce on dispatch switched off applies to new
    // dispatches; an edit keeps the materials the dispatch was saved with.)
    if (!(await feature("documents.servicesPanel"))) delete body.services;

    const { master, deductions = [] } = body;
    let { lines } = body;
    // A line's trial type is the server's to set (stampDispatchLineTypes below)
    lines = lines.map(dropLineType);
    // dispatch.extraFields off → Manual DC No / City / Route left as stored
    if (DISPATCH_TYPES.has(type)) await stripExtraFields(master);
    // Ported from Accounting (Settings → Features) — see createVoucher.
    await markGrnDirectRates(lines, { tranCode: tran_code, storedTranId: putTranId });
    if (tran_code === 10) {
      const linkError = await saleReturnLinkError(master, lines, { storedTranId: putTranId });
      if (linkError) return NextResponse.json({ message: linkError }, { status: 422 });
    }
    const whtError = await applyLineWht({ tranCode: tran_code, lines, deductions, isEdit: true });
    if (whtError) return NextResponse.json({ message: whtError }, { status: 422 });
    // Sub Accounts: off → a line keeps only the sub account it was saved with
    const subAccountError = await applySubAccounts({ tranCode: tran_code, lines, deductions, storedTranId: putTranId });
    if (subAccountError) return NextResponse.json({ message: subAccountError }, { status: 422 });

    const isLocked = await checkAccountLock(master?.pycd);

    if (isLocked) {
      return NextResponse.json(
        {
          message: "This account is locked. Please contact Finance Department.",
        },
        { status: 422 }
      );
    }

    const tran_id = master?.tran_id;
    if (!tran_id) {
      return NextResponse.json({ message: "tran_id is required for update" }, { status: 400 });
    }

    // An invoiced physical document is locked. This PUT deletes and recreates
    // every line including the sub_tran_id=3 auto entries, which would strip
    // the pricing off a document that carries an invoice number.
    const invoicedError = invoicedDocumentError(storedVoucher, type);
    if (invoicedError) {
      return NextResponse.json({ message: invoicedError }, { status: 422 });
    }

    delete master.orderDetails;
    if ([9, 10].includes(tran_code)) {
      delete master.godownDetails;
      delete master.godown2Details;
      delete master.transactions;
    }

    const issueGodown = DISPATCH_TYPES.has(type) ? issueGodownOf(master) : null;
    if (isDeferred(type, tran_code)) {
      // Not invoiced (refused above): the header keeps no invoice number, and
      // a vendor bill no already on the document survives a form that omits it.
      stripDeferredInvoiceNo(master, tran_code);
      if (master.vendor_bill_no == null && storedVoucher?.vendor_bill_no) {
        master.vendor_bill_no = storedVoucher.vendor_bill_no;
      }
    }
    const cleanMaster = normalizeMaster(master, tran_code);
    // "Entered by" is the creator (set on create from the session) — an edit never changes it.
    delete cleanMaster.user_id;

    const soPendingError = await pendingSaleOrderError(tran_code, cleanMaster.so_no);
    if (soPendingError) {
      return NextResponse.json({ message: soPendingError }, { status: 422 });
    }

    // Settings → Features on a dispatch, as on create — what the stored
    // dispatch already had may stay (lib/dispatch/dispatchChecks.js)
    if (DISPATCH_TYPES.has(type)) {
      const featureError =
        (await withoutSaleOrderError(cleanMaster.so_no, storedVoucher)) ||
        (await batchRequiredError(lines, tran_id)) ||
        (await dispatchLitreError(lines, { soNo: cleanMaster.so_no, tranId: tran_id })) ||
        // items the stored dispatch already had are not refused
        (await dispatchReadyError({ soNo: cleanMaster.so_no, lines, tranId: tran_id }));
      if (featureError) return NextResponse.json({ message: featureError }, { status: 422 });
    }

    const { withoutGodown, error: withoutGodownError } = await applyWithoutGodown(tran_code, cleanMaster);
    if (withoutGodownError) {
      return NextResponse.json({ message: withoutGodownError }, { status: 422 });
    }

    // Closed godowns cannot be posted to — but a voucher that already used
    // one before it closed can still be corrected, so its own godowns pass.
    const storedGodownRows = await prisma.transactions.findMany({
      where: { tran_id: Number(tran_id) },
      select: { godown: true },
      distinct: ["godown"],
    });
    const godownError = await closedGodownError(
      [cleanMaster.godown, cleanMaster.godown2, ...(Array.isArray(lines) ? lines : []).map((l) => l?.godown)],
      {
        allow: [
          storedVoucher?.godown, storedVoucher?.godown2, ...storedGodownRows.map((r) => r.godown),
          ...(withoutGodown ? [cleanMaster.godown] : []),
        ],
      },
    );
    if (godownError) {
      return NextResponse.json({ message: godownError }, { status: 422 });
    }

    // Data scope: the stored document AND the edited one must both be the
    // user's — no editing someone else's, nor moving one out of reach.
    const putScopeError =
      (storedVoucher && (await documentScopeError(session, tran_code, storedVoucher))) ||
      (await documentScopeError(session, tran_code, cleanMaster, lines));
    if (putScopeError) {
      return NextResponse.json({ message: putScopeError }, { status: 403 });
    }

    // Packing material: consumed by an automatic tran_code 7 entry linked to
    // this dispatch (lib/dispatch/packingConsumption.js). Short stock follows
    // the stock check policy "packing" (Settings → Stock checking).
    // Nothing is packed for a Despatch Without Godown — no consumption.
    // "dispatch.packingConsumption" off → only a dispatch that already has its
    // automatic packing issue keeps it in step (packingConsumptionOn).
    const packingOn = DISPATCH_TYPES.has(type) && !withoutGodown && (await packingConsumptionOn(Number(tran_id)));
    const packing = packingOn ? packingNeeds(lines) : new Map();
    const warnings = [];
    if (packing.size) {
      const packingLockError = await checkPeriodLock(cleanMaster.dated, 7, { action: "update" });
      if (packingLockError) {
        return NextResponse.json({ message: packingLockError }, { status: 422 });
      }
      const { message: packingShort, mode: packingMode } = await checkPackingStock({
        db: prisma,
        needs: packing,
        godown: cleanMaster.godown,
        dispatchTranId: Number(tran_id),
      });
      if (packingShort) {
        if (packingMode === "block") {
          return NextResponse.json({ message: packingShort }, { status: 422 });
        }
        warnings.push(packingShort);
      }
    }

    // Same LTR ⇄ KG guard as POST — an edit must not be able to slip through
    // what a create refuses.
    {
      const { lines: unitLines, blocked } = await resolveStockLineUnits(lines);
      if (blocked.length > 0) {
        return NextResponse.json(
          { message: blocked.join(" "), issues: blocked },
          { status: 422 },
        );
      }
      lines = unitLines;
    }

    if (DISPATCH_TYPES.has(type)) {
      const overError = await overDispatchError({ soNo: cleanMaster.so_no, lines, excludeTranId: Number(tran_id) });
      if (overError) return NextResponse.json({ message: overError }, { status: 422 });
      // An edit keeps the trial type each item was first dispatched with
      lines = await stampDispatchLineTypes({
        soNo: cleanMaster.so_no, tranId: Number(tran_id), lines, enabled: await feature("orders.trialLineBilling"),
      });
      // An edit keeps each item's Plan No / Process Order No
      lines = await stampDispatchPlanLinks({ soNo: cleanMaster.so_no, tranId: Number(tran_id), lines });
    }

    // Stock check policy, as on create; the voucher's own saved lines are
    // left out of the stock figure, since they are about to be replaced.
    const stockType = stockTypeForVoucher(type, tran_code);
    if (stockType) {
      const { message: stockShort } = await checkStockForSave({
        type: stockType,
        godown: cleanMaster.godown,
        lines,
        excludeTranIds: [Number(tran_id)],
      });
      if (stockShort) warnings.push(stockShort);
    }

    // Produce-on-dispatch, as on create; this dispatch's own previous
    // documents are left out of the stock check (lib/dispatch/bomProduction.js).
    let bomPlan = null;
    if (DISPATCH_TYPES.has(type)) {
      bomPlan = withoutGodown
        ? noProductionPlan(cleanMaster)
        : await planDispatchBom({ lines, master: cleanMaster, issueGodown, dispatchTranId: Number(tran_id) });
      warnings.push(...bomPlan.warnings);
      const existingBom = await findDispatchBomVouchers(prisma, Number(tran_id));
      if (bomPlan.inputs.length) {
        // A godown this dispatch already issued from stays usable after it closes.
        const issueGodownError = await closedGodownError(bomPlan.issueGodowns, {
          allow: existingBom.issueRows.map((r) => r.godown),
        });
        if (issueGodownError) return NextResponse.json({ message: issueGodownError }, { status: 422 });
        const issueScopeError = await issueGodownScopeError(session, bomPlan.issueGodowns);
        if (issueScopeError) return NextResponse.json({ message: issueScopeError }, { status: 403 });
      }
      if (bomPlan.inputs.length || existingBom.issue.length || existingBom.prod.length) {
        for (const code of [7, 8]) {
          const bomLockError = await checkPeriodLock([storedVoucher?.dated, cleanMaster.dated], code, { action: "update" });
          if (bomLockError) return NextResponse.json({ message: bomLockError }, { status: 422 });
        }
      }
    }

    const withAutoEntries =
      [1, 2, 4, 6, 9, 10].includes(tran_code) && !isDeferred(type, tran_code);

    // Every account resolved before the first write (422 / 400 on a gap).
    const accounts = await resolveVoucherAccounts(lines, tran_code, cleanMaster, { withAutoEntries, withoutGodown });
    const accountError = voucherAccountError({ lines, deductions, tran_code, type, master: cleanMaster, accounts, withAutoEntries });
    if (accountError) return NextResponse.json({ message: accountError }, { status: 422 });
    const packingAcno = packing.size ? await resolvePackingAccounts(packing) : {};

    // GRN / dispatch Services panel, as on create.
    const servicePlan = SERVICE_POSTING_TYPES.has(type)
      ? null
      : await planDocumentServices({
          services: body.services, tranCode: tran_code, sourceTranId: Number(tran_id), master: cleanMaster, session,
        });

    // Service Invoice: re-priced and re-posted like a create. Services already
    // on this invoice may stay even if switched off since.
    let serviceLinks = null;
    let serviceAuto = [];
    if (SERVICE_POSTING_TYPES.has(type)) {
      const kept = await prisma.transactions.findMany({
        where: { tran_id: Number(tran_id), service_id: { not: null } },
        select: { service_id: true },
      });
      lines = await prepareServiceInvoice(lines, { keepServiceIds: new Set(kept.map((k) => k.service_id)) });
      serviceLinks = await prepareServiceLinks(master?.links);
      Object.assign(cleanMaster, await serviceHeaderRefs(serviceLinks));
      serviceAuto = await serviceInvoiceAutoEntries(lines, cleanMaster, Number(tran_id));
    }

    const mappedLines = lines.map((line) =>
      mapLine(line, Number(tran_id), tran_code, accounts.lineAcno, { deferred: isDeferred(type, tran_code) })
    );

    const mappedDeductions = deductions.map((d) =>
      mapDeduction(d, Number(tran_id))
    );

    const autoEntries = withAutoEntries
      ? buildAutoEntries(lines, deductions, tran_code, Number(tran_id), { ...cleanMaster, tran_id }, accounts)
      : serviceAuto;

    // Replace auto JV for materialIssueLanded before main transaction
    if (tran_code === 7 && cleanMaster.rmk1 === "Yes") {
      await deleteLandedCostJV(Number(tran_id));
    }

    // ✅ Run everything in a transaction for atomicity.
    // INVOICE_KNOCKOFF.source_line_id is a hard FK onto the lines being
    // replaced, so the voucher's allocations are dropped first and rebuilt
    // from the new lines' invoice_no tags afterwards (see invoiceMatcher.js).
    const masterData = await prisma.$transaction(async (tx) => {
      await lockNotInvoiced(tx, tran_id, type);
      const updated = await tx.transactionsMaster.update({
        where: { tran_id: Number(tran_id) },
        data: cleanMaster,
      });
      await clearVoucherAllocations(tx, Number(tran_id));
      await tx.transactions.deleteMany({
        where: { tran_id: Number(tran_id) },
      });
      await tx.transactions.createMany({
        data: [...mappedLines, ...mappedDeductions, ...autoEntries],
      });
      if (serviceLinks) {
        await syncServiceLinks(tx, Number(tran_id), serviceLinks);
      }
      await syncDocumentServices(tx, updated, servicePlan);
      if ([1, 2, 3].includes(tran_code)) {
        await syncTaggedVoucherLines(tx, Number(tran_id), { userId: session?.user?.id ?? null });
      }
      // Rebuild (or remove) the packing consumption and the auto Material
      // Issue / Production to match the edited lines
      if (DISPATCH_TYPES.has(type)) {
        await syncPackingConsumption(tx, updated, packing, { acnoByItcd: packingAcno });
        // Same stock check again, under per-item locks inside the transaction.
        const lockedPlan = withoutGodown
          ? noProductionPlan(cleanMaster)
          : await planDispatchBom({
              db: tx, lines, master: cleanMaster, issueGodown, dispatchTranId: Number(tran_id), lock: true,
            });
        await syncDispatchBom(tx, updated, lockedPlan);
      }
      return updated;
    }, DISPATCH_TYPES.has(type) || hasServiceWork(servicePlan) ? { timeout: 60_000, maxWait: 20_000 } : undefined);


    if (tran_code === 6) {
      await checkOrderStatus(masterData);
    }

    // Re-create auto JV for materialIssueLanded after main transaction
    if (tran_code === 7 && cleanMaster.rmk1 === "Yes") {
      await createLandedCostJV(Number(tran_id), { ...cleanMaster, user_id: session?.user?.id, tran_id: Number(tran_id) }, lines, accounts.lineAcno);
    }

    return NextResponse.json(
      { message: "Voucher updated", voucherId: tran_id, vrNo: masterData.vr_no, grnNo: masterData.grn_no, dispatchNo: masterData.dispatch_no, warnings },
      { status: 200 }
    );
  } catch (error) {
    console.error("Error updating voucher:", error);
    if (error?.status === 422) {
      return NextResponse.json({ message: error.message }, { status: 422 });
    }
    // Account Settings gaps (422) and bad transporter accounts (400)
    if ([400, 403, 422].includes(error?.statusCode)) {
      return NextResponse.json({ message: error.message }, { status: error.statusCode });
    }
    return NextResponse.json(
      { message: "Server error", error: error?.message ?? String(error) },
      { status: 500 }
    );
  }
}

// DELETE method
export const DELETE = guardBy(
  async (req, { params }) => `${(await params).type}.delete`,
  async (req, { params }) => {
  try {
    const { type } = await params;
    const session = await getServerSession(authOptions);
    setAuditActor(session);

    const { tran_id } = await req.json();

    if (!tran_id) {
      return NextResponse.json(
        { message: "tran_id is required" },
        { status: 400 }
      );
    }

    // 🛠️ Get tran_code first
    const master = await prisma.transactionsMaster.findUnique({
      where: { tran_id },
    });

    if (!master) {
      return NextResponse.json(
        { message: "Transaction not found" },
        { status: 404 }
      );
    }

    const tran_code = master.tran_code;

    const mismatchError = tranCodeMismatchError(master, type);
    if (mismatchError) return NextResponse.json({ message: mismatchError }, { status: 422 });

    const autoError = autoVoucherError(master);
    if (autoError) return NextResponse.json({ message: autoError }, { status: 422 });
    const faDocError = await fixedAssetDocumentError(master, tran_id);
    if (faDocError) return NextResponse.json({ message: faDocError }, { status: 422 });

    const invoicedError = invoicedDocumentError(master, type);
    if (invoicedError) return NextResponse.json({ message: invoicedError }, { status: 422 });

    // A trial billing part, or a dispatch whose trial items were billed on parts
    const trialLockError = await trialDispatchLockError(master);
    if (trialLockError) return NextResponse.json({ message: trialLockError }, { status: 422 });

    // A GRN / dispatch keeps its service invoices — they are removed first.
    const servicesError = await documentServicesDeleteError(tran_id, tran_code);
    if (servicesError) return NextResponse.json({ message: servicesError }, { status: 422 });

    // Data scope: only the user's own godowns' documents can be deleted.
    const deleteScopeError = await documentScopeError(session, tran_code, master);
    if (deleteScopeError) {
      return NextResponse.json({ message: deleteScopeError }, { status: 403 });
    }

    // Period lock guard
    const deleteLockError = await checkPeriodLock(master.dated, tran_code, { action: "delete" });
    if (deleteLockError) {
      return NextResponse.json({ message: deleteLockError }, { status: 422 });
    }

    // A dispatch's auto Material Issue / Production go with it, so their
    // months must be open too.
    if (tran_code === 6) {
      const bom = await findDispatchBomVouchers(prisma, tran_id);
      if (bom.issue.length || bom.prod.length) {
        for (const code of [7, 8]) {
          const bomLockError = await checkPeriodLock(master.dated, code, { action: "delete" });
          if (bomLockError) return NextResponse.json({ message: bomLockError }, { status: 422 });
        }
      }
    }

    // 🛠️ Revert stock before deleting if applicable
    // 🛠️ Revert stock before deleting if applicable
    if ([4, 6, 9, 10].includes(tran_code)) {
      const lines = await prisma.transactions.findMany({
        where: {
          tran_id,
          sub_tran_id: 1,
        },
      });

      for (const line of lines) {
        const itemId = parseInt(line.itcd);
        const qty = parseFloat(line.qty || 0);

        if (itemId && qty > 0) {
          const isIncrement = [4, 10].includes(tran_code);
          const revertQty = isIncrement ? -qty : qty;

          // 🔍 Get current stock first
          const item = await prisma.item.findUnique({
            where: { itcd: itemId },
            select: { stock: true },
          });

          if (!item) continue;

          const newStock = item.stock + revertQty;

          // ✅ Only update stock if it won't go below zero
          if (newStock >= 0) {
            await prisma.item.update({
              where: { itcd: itemId },
              data: {
                stock: {
                  increment: revertQty,
                },
              },
            });
          } else {
            console.warn(
              `Skipped stock update for item ${itemId}: stock would go negative.`
            );
          }
        }
      }
    }
    // Delete child and master records. Allocations sourced from this voucher
    // go first — they hold an FK onto its lines.
    await prisma.$transaction(async (tx) => {
      await lockNotInvoiced(tx, tran_id, type);
      await clearVoucherAllocations(tx, tran_id);
      // A dispatch takes its packing-material consumption and its auto
      // Material Issue / Production with it
      if (tran_code === 6) {
        await deletePackingConsumption(tx, tran_id);
        await deleteDispatchBom(tx, tran_id);
      }
      // A service invoice takes its GRN / dispatch links with it
      if (tran_code === 21) {
        await tx.serviceInvoiceLink.deleteMany({ where: { tran_id } });
      }
      await tx.transactions.deleteMany({ where: { tran_id } });
      await tx.transactionsMaster.delete({ where: { tran_id } });
    });

    return NextResponse.json({
      message: "Voucher and related transactions deleted successfully",
    });
  } catch (error) {
    console.error("Delete error:", error);
    if (error?.statusCode === 422) {
      return NextResponse.json({ message: error.message }, { status: 422 });
    }
    return NextResponse.json(
      { message: "Server error", error: error.message },
      { status: 500 }
    );
  }
  },
);

function removeBigInt(obj) {
  return JSON.parse(
    JSON.stringify(obj, (_, value) =>
      typeof value === "bigint" ? value.toString() : value
    )
  );
}