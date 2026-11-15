// components/Invoicing/print.js — print an invoiced document from Invoicing.
//
// Every kind prints on the Sales Invoice layout (components/Template/
// SaleInvoice.jsx) — Official (GST columns) or Unofficial — titled per kind, with the amounts Invoicing POSTED on
// each line (gross_amount / st_amount, additional tax included) — never
// recomputed. A sale invoice also has the dispatch paperwork the old Dispatch
// Invoicing page printed: commercial invoice, delivery note and gate pass.
// Only invoiced documents print: a pending one has no number or amounts yet.
//
// The invoice (and commercial invoice) lines show the BILLED qty — the line's
// acknowledged qty (Transactions.ack_qty, in the billing unit) when set. The
// delivery note and gate pass keep the physical qty that left the godown.

import axios from "axios";
import { isLitreUnit } from "@/lib/units/litres";
import { generateSaleInvoicePDF } from "@/components/Template/SaleInvoice";
import { askOfficialPrint } from "@/lib/officialPrint";
import { generateCommercialInvoicePDF } from "@/components/Template/CommercialInvoice";
import { generateOffCommercialInvoicePDF } from "@/components/Template/OffCommercialInvoice";
import { generateDeliveryNotePDF } from "@/components/Template/DeliveryNote";
import { generateOffDeliveryNotePDF } from "@/components/Template/OffDeliveryNote";
import { generateGatePassPDF } from "@/components/Template/GatePass";
import { generateOffGatePassPDF } from "@/components/Template/OffGatePass";

// Invoice heading per kind (official / unofficial) and the party ref label.
const INVOICE_LAYOUT = {
  sale: { title: "Sales Invoice", official: "Sales Tax Invoice", refLabel: "Customer Ref" },
  "sale-return": { title: "Credit Note", refLabel: "Customer Ref" },
  purchase: { title: "Purchase Invoice", refLabel: "Vendor Bill No" },
  "purchase-return": { title: "Debit Note", refLabel: "Vendor Ref No" },
};

/** Print options for a kind: [type, label]. The invoice is always first. */
export function printOptionsFor(kind) {
  const invoice = [["invoice", INVOICE_LAYOUT[kind]?.title ?? "Invoice"]];
  if (kind !== "sale") return invoice;
  return [
    ...invoice,
    ["commercial", "Commercial Invoice"],
    ["deliveryNote", "Delivery Note"],
    ["gatePass", "Gate Pass"],
  ];
}

/**
 * A line with its billed (acknowledged) qty in the field the templates read:
 * qty_ltr on a LTR line, qty otherwise. ack_qty NULL = unchanged.
 */
function withBilledQty(t) {
  if (t.ack_qty === null || t.ack_qty === undefined) return t;
  const ack = Number(t.ack_qty) || 0;
  if (isLitreUnit(t.unit)) {
    // The templates fall back to the KG qty when qty_ltr is 0.
    return { ...t, qty_ltr: ack, ...(ack === 0 ? { qty: 0 } : {}) };
  }
  return { ...t, qty: ack };
}

function openForPrint(pdfDoc) {
  pdfDoc.autoPrint();
  window.open(pdfDoc.output("bloburl"), "_blank");
}

/**
 * Fetch the document and open the chosen print in the browser print dialog.
 * @param {string} kind  sale | sale-return | purchase | purchase-return
 * @param {number} tranId
 * @param {string} type  from printOptionsFor(kind)
 */
export async function printInvoicingDocument(kind, tranId, type, { session, currency, company }) {
  const { data } = await axios.get(`/api/voucher/getById?id=${tranId}`);
  const voucher = data?.data;
  if (!voucher) throw new Error("Document not found");
  if (String(voucher.invoice_no ?? "").trim() === "") {
    throw new Error("This document is not invoiced yet — generate the invoice first.");
  }

  if (type === "invoice") {
    const layout = INVOICE_LAYOUT[kind];
    if (!layout) throw new Error(`Unknown invoicing kind: ${kind}`);
    const purchaseSide = kind === "purchase" || kind === "purchase-return";
    const official = await askOfficialPrint();
    const pdfDoc = await generateSaleInvoicePDF({
      voucher: {
        ...voucher,
        // The party ref line: the vendor's bill no on purchases.
        customer_ref: purchaseSide ? voucher.vendor_bill_no || "" : voucher.customer_ref,
        ordersSO: purchaseSide ? null : voucher.ordersSO,
        // Item lines only: the posted control rows (sub_tran_id 3) are not lines.
        // Billed on the acknowledged qty; amounts are the posted gross / st.
        transactions: (voucher.transactions || []).filter((t) => t.sub_tran_id === 1).map(withBilledQty),
      },
      companyData: company,
      currencyData: currency,
      official,
      title: ((official && layout.official) || layout.title).toUpperCase(),
      refLabel: layout.refLabel,
      // The terms are written to the customer.
      showTerms: !purchaseSide,
    });
    openForPrint(pdfDoc);
    return;
  }

  if (kind !== "sale") throw new Error("Only sale invoices have dispatch paperwork");
  // Inactive customers print the "Off" versions, as on the old page.
  const active = voucher.pycdAcno?.isActive !== false;
  let pdfDoc;
  if (type === "commercial") {
    // A billing document: qty × rate on the acknowledged qty.
    const billed = { ...voucher, transactions: (voucher.transactions || []).map(withBilledQty) };
    pdfDoc = active
      ? await generateCommercialInvoicePDF(billed, session, currency, company)
      : generateOffCommercialInvoicePDF(billed);
  } else if (type === "deliveryNote") {
    pdfDoc = active
      ? await generateDeliveryNotePDF(voucher, session, currency, company)
      : generateOffDeliveryNotePDF(voucher);
  } else if (type === "gatePass") {
    pdfDoc = active
      ? await generateGatePassPDF(voucher, session, currency, company)
      : generateOffGatePassPDF(voucher);
  } else {
    throw new Error(`Unknown print type: ${type}`);
  }
  openForPrint(pdfDoc);
}
