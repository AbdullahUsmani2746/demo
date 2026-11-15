import axios from "axios";
import { jsPDF } from "jspdf";
import { format } from "date-fns";

export const generateDeliveryNotePDF = async (
  voucherId,
  session = null,
  currency,
  company
) => {
  let voucherData = {};

  if (voucherId && typeof voucherId === "object") {
    // If it's already a full object with transaction details, use it directly
    if (voucherId.transactions || voucherId.entries) {
      voucherData = voucherId;
    } else {
      // Otherwise, extract the ID and fetch the full details
      const id = voucherId.tran_id || voucherId.voucherId || voucherId.id;
      if (id) {
        try {
          const res = await axios.get(`/api/voucher/getById?id=${id}`);
          voucherData = res.data?.data || voucherData;
          if (Array.isArray(voucherData)) {
            voucherData = voucherData[0];
          }
        } catch (error) {
          console.error("Error fetching Delivery Note data via getById", error);
        }
      }
    }
  } else if (voucherId) {
    // It's a plain ID (number or string)
    try {
      const res = await axios.get(`/api/voucher/getById?id=${voucherId}`);
      voucherData = res.data?.data || voucherData;
      if (Array.isArray(voucherData)) {
        voucherData = voucherData[0];
      }
    } catch (error) {
      console.error("Error fetching Delivery Note data via getById", error);
    }
  }

  // Fallback in case getById did not return anything but voucherId is an object
  if (typeof voucherId === "object" && voucherId !== null && Object.keys(voucherId).length > 2 && !voucherData.id) {
    voucherData = voucherId;
  }

  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const W   = 210;
  const m   = 8;
  const boxW = W - 2 * m; // 194 mm

  doc.setLineWidth(0.4);
  doc.setDrawColor(0, 0, 0);

  let y = m;

  // ─── TITLE ───────────────────────────────────────────────────────────────
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Delivery Note", W / 2, y + 4.5, { align: "center" });
  const titleW = doc.getTextWidth("Delivery Note");
  doc.setLineWidth(0.3);
  doc.line(W / 2 - titleW / 2, y + 5.5, W / 2 + titleW / 2, y + 5.5);
  doc.setLineWidth(0.4);

  // ─── LOGO ────────────────────────────────────────────────────────────────
  let logoData = null;
  try { 
    const response = await fetch(company?.logo || "/logo/logo.jpeg");
    if (response.ok) {
      const blob = await response.blob();
      logoData = await new Promise((resolve) => {
        const reader = new FileReader();
        reader.onloadend = () => resolve(reader.result);
        reader.readAsDataURL(blob);
      });
    }
  } catch (err) {
    console.warn("Could not load logo", err);
  }

  if (logoData) {
    doc.addImage(logoData, "JPEG", m + 2, y + 2, 22, 22);
  }

  // ─── COMPANY INFO (centered, offset right of logo) ───────────────────────
  const companyName    = (company?.name    || "Company").toUpperCase();
  
  // Build address line from addr1, addr2, city fields to prevent multi-line overlap
  let companyAddr = [
    company?.addr1,
    company?.addr2,
    company?.city,
  ].filter(Boolean).join(", ") || (Array.isArray(company?.address) ? company.address.join(", ") : company?.address) || "";

  if (typeof companyAddr === "string") {
    companyAddr = companyAddr.replace(/\r?\n|\r/g, ", ");
  }

  // Build contact line from phone and email to prevent multi-line overlap
  let companyContact = [
    company?.phone ? `TEL. : ${company.phone}` : null,
    company?.email ? `EMAIL : ${company.email}` : null,
  ].filter(Boolean).join(" ") || company?.contact || "";

  if (typeof companyContact === "string") {
    companyContact = companyContact.replace(/\r?\n|\r/g, " ");
  }

  const companyStrn    = company?.strn     || "-";
  const companyNtn     = company?.ntn      || "-";

  const cx = W / 2; // centre shifted slightly right of logo

  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(companyName, cx, y + 11, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(companyAddr,    cx, y + 17, { align: "center" });
  doc.text(companyContact, cx, y + 22, { align: "center" });
  doc.text(`STRN : ${companyStrn} NTN : ${companyNtn}`, cx, y + 27, { align: "center" });

  y += 30;

  // ─── HEADER DIVIDER ──────────────────────────────────────────────────────
  doc.line(m, y, m + boxW, y);

  // ─── CUSTOMER & NOTE INFO SECTION ────────────────────────────────────────
  const infoH = 32;
  const midX  = m + 110;
  doc.line(midX, y, midX, y + infoH); // vertical divider

  // Left – Customer Details
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Customer Details:", m + 2, y + 5);

  const customerName = voucherData.acno?.acname || voucherData.customer?.name || voucherData.customerName || "";
  doc.setFont("helvetica", "normal");
  doc.text(customerName, m + 2, y + 11);

  doc.setFont("helvetica", "bold");
  doc.text("STRN:", m + 2, y + 17);
  doc.setFont("helvetica", "normal");
  // Customer setup keeps these as ACNO.stRegNo / ACNO.ntnNo
  doc.text(String(voucherData.acno?.stRegNo || voucherData.acno?.strn || ""), m + 14, y + 17);

  doc.setFont("helvetica", "bold");
  doc.text("NTN:", m + 52, y + 17);
  doc.setFont("helvetica", "normal");
  doc.text(String(voucherData.acno?.ntnNo || voucherData.acno?.ntn || ""), m + 62, y + 17);

  doc.setFont("helvetica", "bold");
  doc.text("Address", m + 2, y + 23);
  doc.setFont("helvetica", "normal");
  // Customer setup: Address / Shipping Address, else Bank / Invoicing Address
  const address =
    voucherData.acno?.address || voucherData.acno?.customerBankAddr ||
    voucherData.customer?.address || voucherData.customer?.customerBankAddr || "";
  const addrLines = doc.splitTextToSize(address, 90);
  doc.text(addrLines, m + 2, y + 29);

  // Right – Note Info
  doc.setFont("helvetica", "bold");
  doc.text("Invoice No:",    midX + 4, y + 5);
  doc.text("Date:",          midX + 4, y + 11);
  doc.text("Customer Ref:",  midX + 4, y + 17);
  doc.text("Bilty No:",      midX + 4, y + 23);
  doc.text("Inv Desp Ref:",  midX + 4, y + 29);

  const vDate = voucherData.dated || voucherData.date;
  const formattedDate = vDate ? format(new Date(vDate), "dd-MM-yyyy") : "";

  doc.setFont("helvetica", "normal");
  doc.text(String(voucherData.invoice_no || voucherData.tran_no || ""), midX + 32, y + 5);
  doc.text(formattedDate,                                                  midX + 32, y + 11);
  // doc.text(String(voucherData.customer_ref || ""),                          midX + 32, y + 17);
  // Customer Ref = the Purchase Order No entered on the sale order
  // (OrderMaster.sale_po), same as the Commercial Invoice.
  doc.text(String(voucherData.ordersSO?.sale_po || voucherData.customer_ref || ""), midX + 32, y + 17);
  doc.text(String(voucherData.bilty_no     || ""),                          midX + 32, y + 23);
  doc.text(String(voucherData.inv_desp_ref || ""),                          midX + 32, y + 29);

  y += infoH;
  doc.line(m, y, m + boxW, y);

  // ─── TABLE HEADER ────────────────────────────────────────────────────────
  const colW = [12, 72, 18, 92]; // S.NO | Description | Batch No | Item Units
  const colX = [
    m,
    m + colW[0],
    m + colW[0] + colW[1],
    m + colW[0] + colW[1] + colW[2],
  ];

  const theadH = 12;
  doc.setFillColor(217, 217, 217);
  doc.rect(m, y, boxW, theadH, "F");
  doc.rect(m, y, boxW, theadH);

  for (let i = 1; i < colX.length; i++) {
    doc.line(colX[i], y, colX[i], y + theadH);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  const cy = y + theadH / 2 + 1.5;
  doc.text("S.NO",        colX[0] + colW[0] / 2, cy, { align: "center" });
  doc.text("Description", colX[1] + colW[1] / 2, cy, { align: "center" });
  doc.text("Batch No",    colX[2] + colW[2] / 2, cy, { align: "center" });
  doc.text("Item Units",  colX[3] + colW[3] / 2, cy, { align: "center" });

  y += theadH;

  // ─── TABLE BODY ──────────────────────────────────────────────────────────
  const allTxns = voucherData.transactions || voucherData.entries || [];
  const rows    = allTxns.filter((t) => !t.sub_tran_id || t.sub_tran_id === 1);

  const tableBodyH   = 95;
  const tableBottomY = y + tableBodyH;

  // draw outer & column borders for full body area
  doc.setLineWidth(0.4);
  doc.line(m,        y, m,        tableBottomY);
  for (let i = 1; i < colX.length; i++) {
    doc.line(colX[i], y, colX[i], tableBottomY);
  }
  doc.line(m + boxW, y, m + boxW, tableBottomY);
  doc.line(m, tableBottomY, m + boxW, tableBottomY);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const rowH = 6;
  let rowY = y + 5;
  let totalCans = 0;
  let grandTotal = 0;

  rows.forEach((item, index) => {
    if (rowY > tableBottomY - 2) return;

    const itemCode = String(item.code || item.item_code || item.itemDetails?.code || item.itcd?.code || item.itemCode || "").trim();
    const rawName  = String(item.itcd?.label || item.itemDetails?.item || item.item_name || item.Description || "").trim();
    const itemName = itemCode ? (rawName && !rawName.startsWith(itemCode) ? `${itemCode} - ${rawName}` : (rawName || itemCode)) : rawName;
    const batch    = item.batch_no || item.BatchNo || item.batch || "";
    const um       = item.uom || item.unit || item.um || "KG";
    const isLitre  = Boolean(um && (String(typeof um === "object" ? um.value : um).trim().toUpperCase() === "LTR" || String(typeof um === "object" ? um.value : um).trim().toUpperCase() === "LITRE"));
    const packs    = Number(item.no_of_pack || item.packs) || 0;
    const rawQty   = Number(item.qty || item.quantity) || 0;
    const ltrQty   = Number(item.qty_ltr ?? item.priced_qty ?? item.billed_qty ?? item.qty_billed) || 0;
    const qty      = isLitre ? (ltrQty || rawQty) : rawQty;
    const unitLabel = isLitre ? "LTR" : "KG";

    totalCans  += packs;
    grandTotal += qty;

    let unitsText = "";
    if (packs > 0 && qty > 0) {
      const qtyPerPack = Number((qty / packs).toFixed(1));
      unitsText = `${packs} X ${qtyPerPack} = ${Number(qty.toFixed(1))} ${unitLabel}`;
    } else if (qty > 0) {
      unitsText = `${Number(qty.toFixed(1))} ${unitLabel}`;
    }

    doc.text(String(index + 1), colX[0] + colW[0] / 2, rowY, { align: "center" });
    doc.text(itemName,          colX[1] + colW[1] / 2, rowY, { align: "center" });
    doc.text(batch,             colX[2] + colW[2] / 2, rowY, { align: "center" });
    doc.text(unitsText,         colX[3] + colW[3] / 2, rowY, { align: "center" });

    rowY += rowH;
  });

  y = tableBottomY;

  // ─── TOTALS ──────────────────────────────────────────────────────────────
  const totalsY = y + 12;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);

  doc.text("Total Cans",               m + 102, totalsY);
  doc.text(String(totalCans),          m + 128, totalsY, { align: "center" });
  doc.setLineWidth(0.3);
  doc.line(m + 122, totalsY + 1, m + 134, totalsY + 1);

  const hasLitre = rows.some((t) => {
    const um = t.uom || t.unit || t.um;
    return Boolean(um && (String(typeof um === "object" ? um.value : um).trim().toUpperCase() === "LTR" || String(typeof um === "object" ? um.value : um).trim().toUpperCase() === "LITRE"));
  });
  doc.text("Grand Total:",             m + 142, totalsY);
  doc.text(`${Number(grandTotal.toFixed(2))} ${hasLitre ? "LTR" : "KG"}`, m + 188, totalsY, { align: "right" });
  doc.line(m + 168, totalsY + 1, m + 188, totalsY + 1);

  // ─── FOOTER ──────────────────────────────────────────────────────────────
  const forY = totalsY + 22;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(`For ${companyName}`, W / 2, forY, { align: "center" });

  const sigY = forY + 28;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text("Receiver's Signature",  m + 4,          sigY, { align: "left"   });
  doc.text("Rechecked Signature",   W / 2,           sigY, { align: "center" });
  doc.text("Authorized Signature",  m + boxW - 4,    sigY, { align: "right"  });

  // ─── OUTER BORDER ────────────────────────────────────────────────────────
  const boxH = sigY + 3 - m;
  doc.setLineWidth(0.4);
  doc.rect(m, m, boxW, boxH);

  return doc;
};
