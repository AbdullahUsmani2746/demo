// components/Template/OrderLetterhead.js — Purchase Order and Sale Order on the
// company's own letterhead (SMS, 20 Nov 2026; Settings → Features
// documents.orderLetterhead): logo, Dated, title, office address + order no + web / e-mail,
// the VENDOR / CUSTOMER band with NTN and telephone, a maroon PRODUCT /
// QUANTITY / UNIT PRICE / TOTAL COST table (rate + GST, total incl. GST),
// NOTE (payment terms, delivery, instructions) and Prepared / Checked /
// Approved By. Used by generatePurchaseOrderPDF (PurchaseOrderNew.jsx) and
// generateSalesOrderPDF (SalesOrder.jsx), so every print button gets it.
//
// Order no. printed as <COMPANY>/PO/<order no>/<year> (SO for a Sale Order).
import { jsPDF } from "jspdf";
import { companyShortName } from "@/lib/companyName";

const MAROON = [158, 15, 20];
const INK = [20, 20, 20];
const GRID = [40, 40, 40];
const SHADE = [242, 242, 242];

async function loadImage(src) {
  if (!src || typeof window === "undefined") return null;
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

const num = (v) => {
  const n = Number(v && typeof v === "object" ? v.value : v);
  return Number.isFinite(n) ? n : 0;
};
const money = (n) => Math.round(num(n)).toLocaleString("en-US");
const qtyText = (n) => num(n).toLocaleString("en-US", { maximumFractionDigits: 3 });
const ddmmyyyy = (d) => {
  if (!d) return "";
  const x = new Date(d);
  return `${String(x.getDate()).padStart(2, "0")}/${String(x.getMonth() + 1).padStart(2, "0")}/${x.getFullYear()}`;
};
const stamp = (d) => {
  if (!d) return "";
  const x = new Date(d);
  const date = x.toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "numeric" }).replace(/ /g, "-").toUpperCase();
  const time = x.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
  return `${date} ${time}`;
};

/**
 * kind: "purchase" | "sale". Returns the jsPDF document (callers save / print / merge it).
 */
export async function generateOrderLetterheadPDF(order, { kind = "purchase", company = null, currency = null, session = null } = {}) {
  const sale = kind === "sale";
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const M = 8; // page border
  const L = 18;
  const R = W - 18;
  const cur = currency?.code && currency.code !== "PKR" ? currency.code : "RS.";
  const short = companyShortName(company?.name || "") || "CO";
  const year = new Date(order.dated || Date.now()).getFullYear();
  const orderNo = `${short}/${sale ? "SO" : "PO"}/${order.order_no}/${year}`;
  const logo = await loadImage(company?.logo || "/logo/logo.jpeg");

  const border = () => {
    doc.setDrawColor(...GRID);
    doc.setLineWidth(0.3);
    doc.rect(M, M, W - 2 * M, H - 2 * M);
  };
  border();

  // ── Logo + Dated ──
  let y = 16;
  if (logo) {
    try {
      const { width, height } = doc.getImageProperties(logo);
      const h = 20;
      doc.addImage(logo, L, y, Math.min(70, (h * width) / height), h);
    } catch {
      /* no logo */
    }
  }
  doc.setTextColor(...INK);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text(`Dated:     ${ddmmyyyy(order.dated)}`, R - 10, y + 24, { align: "right" });

  // ── Title ──
  y += 38;
  doc.setFont("times", "bold");
  doc.setFontSize(22);
  const title = sale ? "SALE ORDER" : "PURCHASE ORDER";
  doc.text(title, W / 2, y, { align: "center" });
  const tw = doc.getTextWidth(title);
  doc.setLineWidth(0.6);
  doc.line(W / 2 - tw / 2, y + 1.2, W / 2 + tw / 2, y + 1.2);

  // ── Our office ──
  y += 10;
  doc.setFont("times", "normal");
  doc.setFontSize(11);
  const addr = (Array.isArray(company?.address) ? company.address : [company?.address])
    .filter(Boolean)
    .filter((l) => !/^(phone|fax|email)\s*:/i.test(String(l)))
    .join(", ");
  const office = doc.splitTextToSize(`Office Address: ${addr || [company?.addr1, company?.addr2, company?.city].filter(Boolean).join(", ")}`, 95);
  doc.text(office, L, y);
  y += office.length * 4.8;
  doc.text(`${sale ? "SO" : "PO"} No: ${orderNo}`, L, y);
  y += 4.8;
  if (sale && order.sale_po) {
    doc.text(`Customer PO: ${order.sale_po}`, L, y);
    y += 4.8;
  }
  if (company?.phone) {
    doc.text(`Phone: ${company.phone}`, L, y);
    y += 4.8;
  }
  if (company?.email) {
    doc.setTextColor(17, 85, 204);
    for (const e of String(company.email).split(/[,;\s]+/).filter(Boolean)) {
      doc.textWithLink(e, L, y, { url: `mailto:${e}` });
      const ew = doc.getTextWidth(e);
      doc.setDrawColor(17, 85, 204);
      doc.setLineWidth(0.2);
      doc.line(L, y + 0.6, L + ew, y + 0.6);
      y += 4.8;
    }
    doc.setTextColor(...INK);
    doc.setDrawColor(...GRID);
  }

  // ── VENDOR / CUSTOMER band ──
  y += 2;
  doc.setFont("times", "bold");
  doc.setFontSize(11);
  const band = sale ? "CUSTOMER" : "VENDOR";
  const bw = doc.getTextWidth(band) + 3;
  doc.setFillColor(...MAROON);
  doc.rect(W / 2 - bw / 2, y - 4, bw, 5.5, "F");
  doc.setTextColor(255, 255, 255);
  doc.text(band, W / 2, y, { align: "center" });
  doc.setTextColor(...INK);

  y += 9;
  const party = order.acno || {};
  doc.setFont("times", "normal");
  doc.setFontSize(11);
  let ly = y;
  doc.text(String(party.acname || "").toUpperCase(), L, ly);
  ly += 5;
  const paddr = doc.splitTextToSize(party.address || "", 105);
  doc.text(paddr, L, ly);
  ly += paddr.length * 5;
  if (party.email) {
    doc.setTextColor(17, 85, 204);
    doc.text(String(party.email), L, ly);
    doc.setTextColor(...INK);
    ly += 5;
  }
  const rx = L + 122;
  doc.text("NTN:", rx, y);
  doc.text(String(party.ntnNo || "—"), rx + 18, y);
  const tel = doc.splitTextToSize(`Telephone: ${party.phoneFax || "—"}`, R - rx);
  doc.text(tel, rx, y + 6);
  if (party.contactPerson) doc.text(`Contact: ${party.contactPerson}`, rx, y + 6 + tel.length * 5);
  y = Math.max(ly, y + 16) + 4;

  // ── Lines ──
  const cols = [
    { w: 80, label: "PRODUCT" },
    { w: 26, label: "QUANTITY" },
    { w: 23, label: "UNIT\nPRICE" },
    { w: R - L + 6 - 129, label: `TOTAL\nCOST (${cur})` },
  ];
  const X0 = L - 3;
  const TW = cols.reduce((s, c) => s + c.w, 0);
  const head = () => {
    doc.setFillColor(...MAROON);
    doc.rect(X0, y, TW, 10, "F");
    doc.setDrawColor(...GRID);
    doc.rect(X0, y, TW, 10);
    doc.setTextColor(255, 255, 255);
    doc.setFont("times", "bold");
    doc.setFontSize(10);
    let x = X0;
    cols.forEach((c, i) => {
      const parts = c.label.split("\n");
      doc.text(parts, x + c.w / 2, y + (parts.length > 1 ? 4 : 6), { align: "center" });
      if (i) doc.line(x, y, x, y + 10);
      x += c.w;
    });
    doc.setTextColor(...INK);
    y += 10;
  };
  head();

  const lines = (order.orderDetails || []).filter((d) => d && (d.itcd || d.items || num(d.qty)));
  let total = 0;
  doc.setFont("times", "normal");
  doc.setFontSize(10);
  lines.forEach((d, idx) => {
    const unit = d.unit === "LTR" ? "LTR" : d.unit || d.items?.unit || "KG";
    const q = d.unit === "LTR" && d.qty_ltr ? d.qty_ltr : d.qty;
    const amount = num(d.amount) || num(q) * num(d.rate);
    const rate = num(d.st_rate ?? order.st_rate);
    const tax = d.st_amount != null && num(d.st_amount) ? num(d.st_amount) : (amount * rate) / 100;
    const lineTotal = amount + tax;
    total += lineTotal;
    const name = doc.splitTextToSize(String(d.items?.item || d.service?.name || `Item ${d.itcd ?? ""}`).toUpperCase(), cols[0].w - 4);
    const rowH = Math.max(10, name.length * 4.5 + 4);
    if (y + rowH > H - 70) {
      doc.addPage();
      border();
      y = 20;
      head();
      doc.setFont("times", "normal");
      doc.setFontSize(10);
    }
    if (idx % 2 === 0) {
      doc.setFillColor(...SHADE);
      doc.rect(X0, y, TW, rowH, "F");
    }
    doc.setDrawColor(...GRID);
    let x = X0;
    const cells = [name, `${qtyText(q)} ${unit}`, `${money(d.rate)}${rate ? `+GST` : ""}`, `${money(lineTotal)}/-`];
    cells.forEach((v, i) => {
      doc.text(v, x + cols[i].w / 2, y + 5.5, { align: "center" });
      doc.line(x, y, x, y + rowH);
      x += cols[i].w;
    });
    doc.line(X0 + TW, y, X0 + TW, y + rowH);
    y += rowH;
  });
  // TOTAL (incl. GST)
  doc.setFont("times", "bold");
  doc.setFontSize(11);
  const totH = 12;
  doc.rect(X0, y, TW, totH);
  let x = X0;
  cols.forEach((c, i) => {
    if (i) doc.line(x, y, x, y + totH);
    x += c.w;
  });
  doc.text("TOTAL", X0 + cols[0].w - 18, y + 7.5, { align: "center" });
  doc.text(`${cur === "RS." ? "Rs." : cur} ${money(total)}/-`, X0 + TW - cols[3].w / 2, y + 7.5, { align: "center" });
  y += totH + 7;

  // ── NOTE ──
  const notes = [
    order.payment_terms && `Payment Terms: ${order.payment_terms}`,
    order.delivery_terms && `Delivery on: ${order.delivery_terms}`,
    order.delivery_location && `Delivery Location: ${order.delivery_location}`,
    order.due_date && `${sale ? "Delivery by" : "Required by"}: ${ddmmyyyy(order.due_date)}`,
    order.additional_instructions,
  ].filter(Boolean);
  doc.setFont("times", "bold");
  doc.setFontSize(10);
  doc.text("NOTE:", L - 2, y);
  doc.setLineWidth(0.2);
  doc.line(L - 2, y + 0.6, L - 2 + doc.getTextWidth("NOTE:"), y + 0.6);
  y += 5;
  doc.setFont("times", "normal");
  for (const n of notes.length ? notes : ["—"]) {
    const t = doc.splitTextToSize(String(n), R - L - 12);
    doc.text("•", L + 2, y);
    doc.text(t, L + 7, y);
    y += t.length * 4.4;
  }

  // ── Prepared / Checked / Approved By ──
  y += 10;
  if (y > H - 45) {
    doc.addPage();
    border();
    y = 30;
  }
  const bx = L + 2;
  const bW = R - L - 4;
  const cw = bW / 3;
  doc.setDrawColor(...GRID);
  doc.setLineWidth(0.3);
  doc.rect(bx, y, bW, 6);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  ["Prepared By", "Checked By", "Approved By"].forEach((h, i) => {
    doc.text(h, bx + cw * i + cw / 2, y + 4.2, { align: "center" });
    if (i) doc.line(bx + cw * i, y, bx + cw * i, y + 6);
  });
  const prepared = order.entered_by || order.users?.name || session?.user?.name || "";
  const approved = order.approved_by_name || "";
  // One name across all three when the same person did everything (as on the template).
  const same = !approved || approved === prepared;
  doc.rect(bx, y + 6, bW, 8);
  doc.setFontSize(13);
  if (same) {
    doc.text(String(prepared).toUpperCase(), bx + bW / 2, y + 12, { align: "center" });
  } else {
    doc.line(bx + cw, y + 6, bx + cw, y + 14);
    doc.line(bx + 2 * cw, y + 6, bx + 2 * cw, y + 14);
    doc.setFontSize(10);
    doc.text(String(prepared).toUpperCase(), bx + cw / 2, y + 11.5, { align: "center" });
    doc.text(String(approved).toUpperCase(), bx + 2 * cw + cw / 2, y + 11.5, { align: "center" });
  }
  doc.rect(bx, y + 14, bW, 5);
  doc.setFontSize(8.5);
  const preparedAt = stamp(order.dated);
  const approvedAt = order.approved_at ? stamp(order.approved_at) : "";
  if (same) {
    doc.text(preparedAt, bx + bW / 2, y + 17.6, { align: "center" });
  } else {
    doc.line(bx + cw, y + 14, bx + cw, y + 19);
    doc.line(bx + 2 * cw, y + 14, bx + 2 * cw, y + 19);
    doc.text(preparedAt, bx + cw / 2, y + 17.6, { align: "center" });
    doc.text(approvedAt, bx + 2 * cw + cw / 2, y + 17.6, { align: "center" });
  }

  doc.setFont("helvetica", "italic");
  doc.setFontSize(7.5);
  doc.setTextColor(120, 120, 120);
  doc.text("This is a system generated document.", W / 2, H - M - 4, { align: "center" });
  doc.setTextColor(...INK);
  return doc;
}

/**
 * The two older call shapes, both still used:
 *   fn({ data: [order], company, currency })
 *   fn({ data: [order] }, session, currency, company, mode)
 */
export async function orderPdfFromArgs(kind, args) {
  const [first, session = null, currencyArg = null, companyArg = null, mode = "download"] = args;
  const order = first?.data?.[0] ?? first;
  const doc = await generateOrderLetterheadPDF(order, {
    kind,
    company: companyArg ?? first?.company ?? null,
    currency: currencyArg ?? first?.currency ?? null,
    session,
  });
  if (mode === "print" && typeof window !== "undefined") {
    doc.autoPrint();
    window.open(doc.output("bloburl"), "_blank");
  }
  return doc;
}
