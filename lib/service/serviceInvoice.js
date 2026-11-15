// lib/service/serviceInvoice.js
// ============================================================
// SERVICE INVOICE POSTING + GRN / DISPATCH LINKS
//
// A Service Invoice (tran_code 21, voucher type "serviceInvoice") posts:
//   sub_tran_id 1  each service line  Dr expense account   = qty × rate
//                  expense account: Service.expense_acno → its category's
//                  expense_acno → Account Settings 'service_expense' → 422
//   sub_tran_id 3  vendor (pycd)      Cr  Σ amount + Σ tax   'Auto Entry'
//                  input tax          Dr  Σ tax per account  'ST Auto Entry'
//                                     (Account Settings 'sales_tax_input')
// A Service ENTRY (tran_code 20) is the receipt of the service, not the
// bill — it posts nothing; only the invoice is expensed (no double cost).
//
// The invoice (header) names the GRNs (tran_code 4) and dispatches
// (tran_code 6) it was for: `master.links = [{ source_tran_id, source_type }]`
// → table service_invoice_links, stored with line_no 0 = the whole invoice
// (tracking and reports; the cost itself goes to the expense accounts).
//
// Services switched off (Service.is_active = false) cannot be put on a new
// line; a line that already carried the service on this invoice may keep it.
// ============================================================
import prisma from "@/lib/prisma";
import { requireAccount, getAccount, accountSettingError } from "@/lib/accounts/accountSettings";

export const POSTING_TYPES = new Set(["serviceInvoice"]);
// Documents a service invoice can be for: GRN, dispatch, and sale return
// (return freight). A sale return has no number of its own — its document
// no (rmk5) identifies it.
const SOURCE_TYPES = { GRN: 4, DISPATCH: 6, SALE_RETURN: 10 };

const intOf = (v) => {
  const n = Number(v?.value ?? v);
  return Number.isInteger(n) && n > 0 ? n : null;
};
const num = (v) => parseFloat(v?.value ?? v) || 0;
const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;
const badRequest = (message) => Object.assign(new Error(message), { statusCode: 400 });

/**
 * Price every service line from qty × rate (the client's amounts are not
 * trusted) and resolve its expense account. Throws 400 / 422.
 * @param {object[]} lines
 * @param {{ db?, keepServiceIds?: Set<number> }} opts keepServiceIds — services
 *        already on the invoice being edited (allowed even if now inactive)
 */
export async function prepareServiceInvoice(lines, { db = prisma, keepServiceIds = new Set() } = {}) {
  const serviceIds = [...new Set((lines || []).map((l) => intOf(l?.service_id)).filter(Boolean))];
  const services = serviceIds.length
    ? await db.service.findMany({
        where: { id: { in: serviceIds } },
        select: {
          id: true, service_name: true, expense_acno: true, is_active: true,
          serviceCategory: { select: { expense_acno: true } },
        },
      })
    : [];
  const byId = new Map(services.map((s) => [s.id, s]));
  const fallback = await getAccount("service_expense");

  const missingAccount = [];
  const out = (lines || []).map((line, index) => {
    const serviceId = intOf(line?.service_id);
    if (!serviceId) throw badRequest(`Line ${index + 1}: choose a service.`);
    const service = byId.get(serviceId);
    if (!service) throw badRequest(`Line ${index + 1}: unknown service ${serviceId}.`);
    if (!service.is_active && !keepServiceIds.has(serviceId)) {
      throw badRequest(`Line ${index + 1}: "${service.service_name}" is switched off (Setup → Services).`);
    }
    const acno = service.expense_acno ?? service.serviceCategory?.expense_acno ?? fallback;
    if (acno == null) missingAccount.push(service.service_name || serviceId);

    const qty = num(line.qty) || 1;
    const rate = num(line.rate);
    if (rate < 0) throw badRequest(`Line ${index + 1}: rate cannot be negative.`);
    const st_rate = num(line.st_rate);
    const additional_tax = num(line.additional_tax);
    const gross = round2(qty * rate);
    const st_amount = round2((gross * (st_rate + additional_tax)) / 100);
    return {
      ...line,
      service_id: serviceId,
      acno: acno ?? null,
      qty,
      rate,
      st_rate,
      additional_tax,
      gross_amount: gross,
      st_amount,
      damt: gross,
      camt: 0,
    };
  });

  if (missingAccount.length) {
    throw accountSettingError(
      "service_expense",
      `(or give the service / its category an expense account) — services: ${missingAccount.slice(0, 5).join(", ")}`,
    );
  }
  return out;
}

/** sub_tran_id 3 rows: vendor Cr total, input tax Dr. Resolve before writing. */
export async function serviceInvoiceAutoEntries(pricedLines, master, tran_id) {
  const vendor = intOf(master?.pycd);
  if (!vendor) throw badRequest("Choose the vendor.");
  const goods = pricedLines.reduce((s, l) => s + (l.gross_amount || 0), 0);
  const tax = pricedLines.reduce((s, l) => s + (l.st_amount || 0), 0);
  const rows = [
    { tran_id, sub_tran_id: 3, narration1: "Auto Entry", acno: vendor, damt: 0, camt: round2(goods + tax) },
  ];
  if (tax > 0) {
    rows.push({
      tran_id, sub_tran_id: 3, narration1: "ST Auto Entry",
      acno: await requireAccount("sales_tax_input"), damt: round2(tax), camt: 0,
    });
  }
  return rows;
}

/**
 * Validate the invoice's `master.links` and return the rows to store. Every
 * linked document must exist and be a GRN (4) / dispatch (6) as claimed.
 */
export async function prepareServiceLinks(links, { db = prisma } = {}) {
  const wanted = [];
  const seen = new Set();
  for (const link of Array.isArray(links) ? links : []) {
    const source_tran_id = intOf(link?.source_tran_id ?? link?.value);
    const source_type = String(link?.source_type || "").toUpperCase();
    if (!source_tran_id) continue;
    if (!SOURCE_TYPES[source_type]) throw badRequest("Linked documents must be GRNs, dispatches or sale returns.");
    if (seen.has(source_tran_id)) continue;
    seen.add(source_tran_id);
    wanted.push({ line_no: 0, source_tran_id, source_type });
  }
  if (!wanted.length) return [];

  const docs = await db.transactionsMaster.findMany({
    where: { tran_id: { in: wanted.map((w) => w.source_tran_id) } },
    select: { tran_id: true, tran_code: true },
  });
  const codeOf = new Map(docs.map((d) => [d.tran_id, d.tran_code]));
  for (const w of wanted) {
    if (codeOf.get(w.source_tran_id) !== SOURCE_TYPES[w.source_type]) {
      throw badRequest(`${w.source_type} ${w.source_tran_id} does not exist.`);
    }
  }
  return wanted;
}

/** Replace an invoice's links (call inside its save transaction). */
export async function syncServiceLinks(tx, tran_id, links) {
  await tx.serviceInvoiceLink.deleteMany({ where: { tran_id } });
  if (links.length) {
    await tx.serviceInvoiceLink.createMany({ data: links.map((l) => ({ ...l, tran_id })) });
  }
}

/** For the edit form: [{ source_tran_id, source_type, label }] of the invoice. */
export async function loadServiceLinks(tran_id, { db = prisma } = {}) {
  const rows = await db.serviceInvoiceLink.findMany({ where: { tran_id }, orderBy: { id: "asc" } });
  if (!rows.length) return [];
  const docs = await db.transactionsMaster.findMany({
    where: { tran_id: { in: [...new Set(rows.map((r) => r.source_tran_id))] } },
    select: { tran_id: true, grn_no: true, dispatch_no: true, dated: true, rmk5: true, acno: { select: { acname: true } } },
  });
  const docOf = new Map(docs.map((d) => [d.tran_id, d]));
  const seen = new Set();
  return rows
    .filter((r) => (seen.has(r.source_tran_id) ? false : seen.add(r.source_tran_id)))
    .map((r) => {
      const d = docOf.get(r.source_tran_id);
      const no = r.source_type === "GRN" ? d?.grn_no : r.source_type === "DISPATCH" ? d?.dispatch_no : d?.rmk5;
      return {
        source_tran_id: r.source_tran_id,
        source_type: r.source_type,
        label: `${r.source_type} ${no ?? d?.rmk5 ?? r.source_tran_id}${d?.dated ? ` · ${new Date(d.dated).toLocaleDateString("en-GB")}` : ""}${d?.acno?.acname ? ` · ${d.acno.acname}` : ""}`,
      };
    });
}

/**
 * The header reference a Service Invoice carries for its first linked GRN /
 * dispatch: { grn_no } or { dispatch_no } (the document's own number), so the
 * invoice can be found by "GRN 4455" / "dispatch 5687" like the imported ones.
 * Both null when nothing is linked.
 */
export async function serviceHeaderRefs(links, { db = prisma } = {}) {
  const first = (links || [])[0];
  if (!first) return { grn_no: null, dispatch_no: null };
  const doc = await db.transactionsMaster.findUnique({
    where: { tran_id: first.source_tran_id },
    select: { grn_no: true, dispatch_no: true },
  });
  if (first.source_type === "GRN") return { grn_no: doc?.grn_no ?? null, dispatch_no: null };
  if (first.source_type === "DISPATCH") return { grn_no: null, dispatch_no: doc?.dispatch_no ?? null };
  return { grn_no: null, dispatch_no: null }; // sale return: linked, no header number
}
