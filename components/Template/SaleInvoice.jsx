// components/Template/SaleInvoice.jsx — the Invoicing print (sale, sale return,
// purchase, purchase return) in the "SALES INVOICE FORMAT" layout.
//
// official = true  → full company name, NTN/STRN, and the GST columns of the
//                    sales tax invoice (Value Excl. / Rate / GST / Value Incl.).
// official = false → company name without "Pvt Ltd", no tax: Qty × Rate only.
// Amounts are the posted line gross_amount / st_amount — never recomputed.

import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { toWords } from "number-to-words";
import { isLitreUnit } from "@/lib/units/litres";
import { stripPvtLtd } from "@/lib/companyName";

const TERMS = [
  "Payment Obligation: All payments must be made as per the agreed payment terms stated on this invoice. Late payment will delay deliveries in case of advance payments or may result in cancellation of the order.",
  "Delivery & Risk: Goods are deemed delivered once handed over to the client, transporter, or courier. Risk and responsibility transfer at that point.",
  "Claims & Returns: Any discrepancies, damages, or claims must be reported in writing within 1 day of delivery. We strongly recommend testing and checking the product at the time of receiving. Later complaints will not be catered without valid proof. Returns are subject to prior approval.",
  "Taxes & Duties: All applicable taxes, duties, and government levies are the responsibility of the client, unless otherwise agreed.",
  "Force Majeure: We are not liable for delays or non-performance due to events beyond our control, including but not limited to natural disasters, strikes, or regulatory actions.",
  "Jurisdiction: This invoice and any related disputes shall be governed by the laws of Sindh, Pakistan.",
  "For returnable drums, the empty drums must be returned with the next shipment. If the return exceeds 30 days the cost of the drums will be charged and adjusted in the respective ledger.",
];

const MAROON = [128, 0, 0];
const GRID = [120, 120, 120];
const HEAD_BG = [235, 235, 235];

const fmt = (n, dp = 0) =>
  Number(n || 0).toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: 2 });
const fmtQty = (n) => String(Number((Number(n) || 0).toFixed(2)));

function fmtDate(v) {
  const d = new Date(v);
  if (isNaN(d)) return "";
  return `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
}

async function loadImage(src) {
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Billed qty of a posted line: litres on a LTR line, else qty. */
function lineQty(t) {
  return isLitreUnit(t.unit) ? Number(t.qty_ltr) || Number(t.qty) || 0 : Number(t.qty) || 0;
}

/**
 * @param {object} p
 * @param {object} p.voucher     /api/voucher/getById data (item lines only)
 * @param {object} p.companyData
 * @param {object} p.currencyData
 * @param {boolean} p.official
 * @param {string} p.title       e.g. "SALES INVOICE"
 * @param {string} p.refLabel    e.g. "Customer Ref" / "Vendor Bill No"
 * @param {boolean} p.showTerms
 * @returns {jsPDF}
 */
export async function generateSaleInvoicePDF({
  voucher,
  companyData: company,
  currencyData,
  official,
  title,
  refLabel = "Customer Ref",
  showTerms = true,
}) {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const m = 10;
  const boxW = W - 2 * m;
  const cur = currencyData?.code || "PKR";

  const companyName = official ? company?.name || "Company" : stripPvtLtd(company?.name) || "Company";
  const logo = await loadImage(company?.logo || "/logo/logo.jpeg");

  doc.setDrawColor(...GRID);
  doc.setLineWidth(0.3);

  // --- Company header ---
  let y = m + 6;
  if (logo) {
    try {
      const { width, height } = doc.getImageProperties(logo);
      const h = 16;
      doc.addImage(logo, m, m, Math.min(30, (h * width) / height), h);
    } catch {}
  }
  doc.setTextColor(...MAROON);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text(companyName.toUpperCase(), W / 2, y, { align: "center", maxWidth: boxW - 60 });
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "italic");
  doc.setFontSize(9);
  const addr = [company?.addr1, company?.addr2, company?.city].filter(Boolean).join(", ");
  const contact = [company?.email, company?.phone].filter(Boolean).join(" / ");
  if (addr) doc.text(addr, W / 2, (y += 5), { align: "center" });
  if (contact) doc.text(`Contact. ${contact}`, W / 2, (y += 4.5), { align: "center" });
  if (official && (company?.ntn || company?.strn)) {
    doc.setFont("helvetica", "bold");
    doc.text(`NTN: ${company?.ntn || "-"}    STRN: ${company?.strn || "-"}`, W / 2, (y += 4.5), { align: "center" });
  }
  y = Math.max(y + 5, m + 22);

  // --- Party box (left) + invoice box (right) ---
  const party = voucher.acno || {};
  const leftW = 124;
  const rightX = m + leftW + 4;
  const rightW = boxW - leftW - 4;
  const top = y;

  doc.setFontSize(9);
  const addrLines = doc.splitTextToSize(party.address || party.customerBankAddr || "", leftW - 32);
  const partyRows = [
    ["Code:", String(party.acno ?? "")],
    ["Name:", party.acname || ""],
    ["Address:", addrLines],
    ["NTN:", party.ntnNo || ""],
    ...(official ? [["STRN:", party.stRegNo || ""]] : []),
    ["Contact:", [party.contactPerson, party.phoneFax].filter(Boolean).join(" - ")],
    ["Email:", party.email || ""],
    ["Remarks:", voucher.rmk || ""],
  ];
  let ly = top + 6;
  partyRows.forEach(([label, value]) => {
    doc.setFont("helvetica", "normal");
    doc.setTextColor(60, 60, 60);
    doc.text(label, m + 4, ly);
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", label === "Name:" ? "bold" : "normal");
    const lines = Array.isArray(value) ? (value.length ? value : [""]) : doc.splitTextToSize(String(value), leftW - 32);
    doc.text(lines, m + 28, ly);
    ly += Math.max(1, lines.length) * 4.5 + 1;
  });

  const infoRows = [
    ["Invoice No", String(voucher.invoice_no ?? "")],
    ["Invoice Date", fmtDate(voucher.dated)],
    ["DC#", String(voucher.dispatch_no ?? voucher.ref_dispatch_no ?? "")],
    [refLabel, String(voucher.ordersSO?.sale_po || voucher.customer_ref || "")],
    ["Payment Terms", party.crDays != null ? `${party.crDays} Days` : ""],
  ];
  const titleH = 11;
  const infoH = infoRows.length * 6.5;
  const boxH = Math.max(ly - top + 1, titleH + infoH + 2);

  doc.rect(m, top, leftW, boxH);
  doc.rect(rightX, top, rightW, boxH);
  doc.setTextColor(...MAROON);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(13);
  doc.text(title, rightX + rightW / 2, top + 7.5, { align: "center" });
  doc.setTextColor(0, 0, 0);
  doc.line(rightX, top + titleH, rightX + rightW, top + titleH);
  const splitX = rightX + rightW * 0.45;
  doc.setFontSize(8.5);
  infoRows.forEach(([label, value], i) => {
    const ry = top + titleH + i * 6.5;
    doc.setFont("helvetica", "bold");
    doc.text(label, rightX + 3, ry + 4.5);
    doc.text(value, splitX + (rightX + rightW - splitX) / 2, ry + 4.5, { align: "center" });
  });
  doc.line(splitX, top + titleH, splitX, top + titleH + infoH);
  y = top + boxH + 4;

  // --- Item lines ---
  const lines = voucher.transactions || [];
  let totQty = 0, totEx = 0, totSt = 0;
  const body = lines.map((t, i) => {
    const qty = lineQty(t);
    const ex = Number(t.gross_amount) || qty * (Number(t.rate) || 0);
    const st = Number(t.st_amount) || 0;
    totQty += qty; totEx += ex; totSt += st;
    const desc = t.itemDetails?.item || t.rmk || "";
    const pack = t.packingDetails?.item || "";
    const unit = t.unit || "KG";
    return official
      ? [i + 1, desc, t.batch_no || "-", pack, fmtQty(qty), unit, fmt(t.rate, 2), fmt(ex), `${Number(t.st_rate) || 0}%`, fmt(st), fmt(ex + st)]
      : [i + 1, t.itemDetails?.sku || t.itcd || "", t.batch_no || "-", desc, pack, unit, fmtQty(qty), fmt(t.rate, 2), fmt(ex)];
  });
  const head = official
    ? [["S.No", "Description of Goods", "Batch No", "Packaging", "Qty", "UOM", "Unit Price\nEx. GST", "Value\nExcl. GST", "GST\nRate", "GST", "Value\nIncl. GST"]]
    : [["S.No", "Product Code", "Batch No", "Description", "Packaging", "UOM", "Quantity", "Rate", "Amount"]];
  const right = { halign: "right" };
  const columnStyles = official
    ? { 0: { cellWidth: 9, halign: "center" }, 1: { cellWidth: 38 }, 4: right, 6: right, 7: right, 8: { halign: "center" }, 9: right, 10: right }
    : { 0: { cellWidth: 10, halign: "center" }, 3: { cellWidth: 52 }, 6: right, 7: right, 8: right };

  autoTable(doc, {
    startY: y,
    head,
    body,
    theme: "grid",
    margin: { left: m, right: m, top: m + 4 },
    styles: { fontSize: official ? 7.5 : 8.5, cellPadding: 1.8, lineColor: GRID, lineWidth: 0.2, textColor: 0, valign: "middle" },
    headStyles: { fillColor: HEAD_BG, textColor: 0, fontStyle: "bold", halign: "center" },
    columnStyles,
    foot: [
      official
        ? ["", "TOTAL", "", "", fmtQty(totQty), "", "", fmt(totEx), "", fmt(totSt), fmt(totEx + totSt)]
        : ["", "", "", "TOTAL", "", "", fmtQty(totQty), "", fmt(totEx)],
    ],
    footStyles: { fillColor: HEAD_BG, textColor: 0, fontStyle: "bold", halign: "right" },
    showFoot: "lastPage",
  });
  y = doc.lastAutoTable.finalY + 4;

  // --- Notes + totals ---
  const grand = official ? totEx + totSt : totEx;
  const totalsRows = official
    ? [["Value Excl. GST", fmt(totEx)], ["Sales Tax (GST)", fmt(totSt)], [`TOTAL ${cur}`, fmt(grand)]]
    : [[`TOTAL ${cur}`, fmt(grand)]];
  const ensure = (need) => {
    if (y + need > H - m) { doc.addPage(); y = m + 4; }
  };
  const notesH = Math.max(18, totalsRows.length * 7 + 4);
  ensure(notesH + 30);
  const notesW = boxW * 0.6;
  doc.rect(m, y, notesW, notesH);
  doc.rect(m + notesW, y, boxW - notesW, notesH);
  doc.setFontSize(8.5);
  doc.setFont("helvetica", "bold");
  doc.text("Notes", m + 3, y + 5);
  doc.setFont("helvetica", "normal");
  let words = "";
  try {
    const w = toWords(Math.round(grand));
    words = `${w.charAt(0).toUpperCase()}${w.slice(1)} ${cur === "PKR" ? "Rupees" : cur} Only.`;
  } catch {}
  doc.text(doc.splitTextToSize(`Amount in words: ${words}`, notesW - 6), m + 3, y + 10);
  totalsRows.forEach(([label, value], i) => {
    const ty = y + 6 + i * 7;
    const last = i === totalsRows.length - 1;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(last ? 11 : 9);
    doc.text(label, m + notesW + 4, ty + (last && official ? 1 : 3));
    doc.text(value, m + boxW - 4, ty + (last && official ? 1 : 3), { align: "right" });
  });
  y += notesH;

  // --- Sign-off ---
  const colW3 = boxW / 3;
  doc.rect(m, y, boxW, 7);
  ["Prepared By", "Checked By", "Approved By"].forEach((l, i) => {
    if (i) doc.line(m + i * colW3, y, m + i * colW3, y + 7);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text(l, m + i * colW3 + colW3 / 2, y + 4.8, { align: "center" });
  });
  y += 7;
  doc.rect(m, y, boxW, 14);
  doc.setFontSize(11);
  doc.text(String(voucher.user?.name || voucher.user?.username || voucher.user_id || ""), m + colW3 / 2, y + 6, { align: "center" });
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(new Date().toLocaleString("en-GB", { dateStyle: "long", timeStyle: "medium" }), m + colW3 / 2, y + 11, { align: "center" });
  y += 18;

  // --- Terms & Conditions ---
  if (showTerms) {
    doc.setFontSize(8);
    const termLines = TERMS.map((t, i) => doc.splitTextToSize(`${i + 1}. ${t}`, boxW - 6));
    const termsH = 7 + termLines.reduce((s, l) => s + l.length * 3.6 + 0.8, 0);
    ensure(termsH);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Terms & Conditions:", m, y + 4);
    doc.line(m, y + 5, m + doc.getTextWidth("Terms & Conditions:"), y + 5);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    let ty = y + 9;
    termLines.forEach((l) => {
      doc.text(l, m, ty);
      ty += l.length * 3.6 + 0.8;
    });
  }

  // --- Faded logo watermark + page numbers on every page ---
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    if (logo) {
      try {
        const { width, height } = doc.getImageProperties(logo);
        const ww = 130;
        const wh = (ww * height) / width;
        doc.setGState(new doc.GState({ opacity: 0.08 }));
        doc.addImage(logo, (W - ww) / 2, (H - wh) / 2, ww, wh);
        doc.setGState(new doc.GState({ opacity: 1 }));
      } catch {}
    }
    if (pages > 1) {
      doc.setFont("helvetica", "normal");
      doc.setFontSize(7.5);
      doc.text(`Page ${p} of ${pages}`, W - m, H - 5, { align: "right" });
    }
  }

  return doc;
}
