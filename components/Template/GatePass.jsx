import axios from "axios";
import { jsPDF } from "jspdf";
import { format } from "date-fns";

export const generateGatePassPDF = async (
  voucherId,
  session = null,
  currency,
  company
) => {
  let voucherData = {};

  if (voucherId && typeof voucherId === "object") {
    if (voucherId.transactions || voucherId.entries) {
      voucherData = voucherId;
    } else {
      const id = voucherId.tran_id || voucherId.voucherId || voucherId.id;
      if (id) {
        try {
          const res = await axios.get(`/api/voucher/getById?id=${id}`);
          voucherData = res.data?.data || {};
          if (Array.isArray(voucherData)) voucherData = voucherData[0];
        } catch (error) {
          console.error("Error fetching Gate Pass data via getById", error);
        }
      }
    }
  } else if (voucherId) {
    try {
      const res = await axios.get(`/api/voucher/getById?id=${voucherId}`);
      voucherData = res.data?.data || {};
      if (Array.isArray(voucherData)) voucherData = voucherData[0];
    } catch (error) {
      console.error("Error fetching Gate Pass data via getById", error);
    }
  }

  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const W = 210;
  const m = 10;
  const AW = W - 2 * m;

  const red = [237, 28, 36];
  const headerGray = [217, 217, 217];
  const borderCol = [0, 0, 0];

  let y = 10;

  doc.setDrawColor(...borderCol);
  doc.setLineWidth(0.3);

  // Top border
  doc.line(m, y, W - m, y);

  // --- HEADER SECTION ---
  doc.line(m, y, m, y + 35); // Left border
  doc.line(W - m, y, W - m, y + 35); // Right border

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Gate Pass", W / 2, y + 4, { align: "center" });
  const textW = doc.getTextWidth("Gate Pass");
  doc.line(W / 2 - textW / 2, y + 5, W / 2 + textW / 2, y + 5);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  // const printDate = format(new Date(), "MMM-dd-yy HH:mm:ss").toUpperCase();
  // 12-hour time with AM/PM, e.g. OCT-19-26 11:24:39 PM
  const printDate = format(new Date(), "MMM-dd-yy hh:mm:ss a").toUpperCase();
  doc.text(printDate, W - m - 2, y + 4, { align: "right" });

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
    doc.addImage(logoData, "JPEG", m + 5, y + 6, 22, 22);
  } else {
    // Logo placeholder fallback
    doc.setFillColor(...red);
    doc.circle(m + 15, y + 17, 9, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("KC", m + 15, y + 19, { align: "center" });
    doc.setTextColor(0, 0, 0);
  }

  // Company Name
  doc.setFont("helvetica", "bold");
  doc.setFontSize(16);
  doc.text(
    company?.name || "Company",
    W / 2 + 5,
    y + 15,
    { align: "center" }
  );

  // Build address from structured fields to avoid duplicate city (e.g. Karachi twice)
  let companyAddr = [
    company?.addr1,
    company?.addr2,
    company?.city,
  ].filter(Boolean).join(", ") || (Array.isArray(company?.address) ? company.address.join(", ") : company?.address) || "";
  if (typeof companyAddr === "string") {
    companyAddr = companyAddr.replace(/\r?\n|\r/g, ", ");
    // Clean to remove duplicate/redundant ", Pakistan" and duplicate ", Karachi"
    companyAddr = companyAddr.replace(/,\s*Pakistan/gi, "");
    const firstKarachiIdx = companyAddr.toLowerCase().indexOf("karachi");
    if (firstKarachiIdx !== -1) {
      const beforeFirst = companyAddr.slice(0, firstKarachiIdx + 7);
      const afterFirst = companyAddr.slice(firstKarachiIdx + 7);
      companyAddr = beforeFirst + afterFirst.replace(/,\s*Karachi/gi, "");
    }
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(companyAddr, W / 2 + 5, y + 21, { align: "center" });

  y += 35;
  doc.line(m, y, W - m, y); // Bottom border of header

  // --- CUSTOMER & GP INFO SECTION ---
  const infoH = 25;
  doc.line(m, y, m, y + infoH); // Left border
  doc.line(W - m, y, W - m, y + infoH); // Right border

  const midX = m + 110;
  doc.line(midX, y, midX, y + infoH); // Divider

  // Customer Details (Left)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Customer Details:", m + 2, y + 4);

  doc.setFont("helvetica", "normal");
  const customerName = voucherData.acno?.acname || "";
  doc.text(customerName, m + 2, y + 9);

  doc.setFont("helvetica", "bold");
  doc.text("STRN:", m + 2, y + 14);
  doc.setFont("helvetica", "normal");
  // Customer setup keeps these as ACNO.stRegNo / ACNO.ntnNo
  doc.text(String(voucherData.acno?.stRegNo || voucherData.acno?.strn || ""), m + 12, y + 14);

  doc.setFont("helvetica", "bold");
  doc.text("NTN:", m + 50, y + 14);
  doc.setFont("helvetica", "normal");
  doc.text(String(voucherData.acno?.ntnNo || voucherData.acno?.ntn || ""), m + 58, y + 14);

  doc.setFont("helvetica", "bold");
  doc.text("Address:", m + 2, y + 19);
  doc.setFont("helvetica", "normal");
  // Customer setup: Address / Shipping Address, else Bank / Invoicing Address
  const address = voucherData.acno?.address || voucherData.acno?.customerBankAddr || "";
  doc.text(doc.splitTextToSize(address, 90), m + 15, y + 19);

  // GP Info (Right)
  doc.setFont("helvetica", "bold");
  doc.text("GP No:", midX + 2, y + 4);
  doc.text("Date:", midX + 2, y + 9);
  doc.text("Customer Ref:", midX + 2, y + 14);

  doc.setFont("helvetica", "normal");
  const gpNo = String(voucherData.tran_no || voucherData.gp_no || "");
  doc.text(gpNo, midX + 25, y + 4);

  const gpDate = voucherData.dated
    ? format(new Date(voucherData.dated), "dd-MM-yyyy")
    : "";
  doc.text(gpDate, midX + 25, y + 9);
  // doc.text(String(voucherData.customer_ref || ""), midX + 25, y + 14);
  // Customer Ref = the Purchase Order No entered on the sale order
  // (OrderMaster.sale_po), same as the Commercial Invoice.
  doc.text(String(voucherData.ordersSO?.sale_po || voucherData.customer_ref || ""), midX + 25, y + 14);

  y += infoH;
  doc.line(m, y, W - m, y); // Bottom border of info

  // --- TABLE HEADER ---
  const headerH = 12;
  doc.setFillColor(...headerGray);
  doc.rect(m, y, AW, headerH, "FD");

  const colW = [15, 80, 20, 75]; // Total 190
  const headers = ["S.NO", "Description", "Batch No", "Item Units"];

  let x = m;
  doc.setFont("helvetica", "bold");
  headers.forEach((h, i) => {
    doc.line(x, y, x, y + headerH); // left border of cell
    doc.text(h, x + colW[i] / 2, y + headerH / 2 + 1.5, { align: "center" });
    x += colW[i];
  });
  doc.line(W - m, y, W - m, y + headerH); // right border of header

  y += headerH;
  doc.line(m, y, W - m, y);

  // --- TABLE BODY ---
  const transactions = (voucherData.transactions || []).filter((item) => {
    const itemName =
      item.itcd?.label ||
      item.itemDetails?.item ||
      item.item_name ||
      item.Description ||
      "";
    const qty = Number(item.qty || item.quantity) || 0;
    const packs = Number(item.no_of_pack || item.packs) || 0;
    return itemName || qty || packs;
  });

  const rowH = 7;
  doc.setFont("helvetica", "normal");

  let totalCans = 0;
  let grandTotal = 0;

  transactions.forEach((item, index) => {
    let rowX = m;

    // Borders
    doc.line(rowX, y, rowX, y + rowH);

    // S.NO
    doc.text(String(index + 1), rowX + colW[0] / 2, y + 4.5, {
      align: "center",
    });
    rowX += colW[0];
    doc.line(rowX, y, rowX, y + rowH);

    // Description
    const itemCode =
      String(item.code || item.item_code || item.itemDetails?.code || item.itcd?.code || item.itemCode || "").trim();
    const rawName = String(item.itcd?.label || item.itemDetails?.item || item.item_name || "").trim();
    const itemName = itemCode ? (rawName && !rawName.startsWith(itemCode) ? `${itemCode} - ${rawName}` : (rawName || itemCode)) : rawName;
    doc.text(itemName, rowX + colW[1] / 2, y + 4.5, { align: "center", maxWidth: colW[1] - 2 });
    rowX += colW[1];
    doc.line(rowX, y, rowX, y + rowH);

    // Batch No
    const batch = item.batch_no || "";
    doc.text(batch, rowX + colW[2] / 2, y + 4.5, { align: "center" });
    rowX += colW[2];
    doc.line(rowX, y, rowX, y + rowH);

    // Item Units
    const um = item.uom || item.unit || item.um || "KG";
    const isLitre = Boolean(um && (String(typeof um === "object" ? um.value : um).trim().toUpperCase() === "LTR" || String(typeof um === "object" ? um.value : um).trim().toUpperCase() === "LITRE"));
    const packs = Number(item.no_of_pack || item.packs) || 0;
    const rawQty = Number(item.qty || item.quantity) || 0;
    const ltrQty = Number(item.qty_ltr ?? item.priced_qty ?? item.billed_qty ?? item.qty_billed) || 0;
    const qty = isLitre ? (ltrQty || rawQty) : rawQty;
    const unitLabel = isLitre ? "LTR" : "KG";

    totalCans += packs;
    grandTotal += qty;

    let unitsText = "";
    if (packs > 0 && qty > 0) {
      const qtyPerPack = Number((qty / packs).toFixed(1));
      unitsText = `${packs} X ${qtyPerPack} = ${Number(qty.toFixed(1))} ${unitLabel}`;
    } else if (qty > 0) {
      unitsText = `${Number(qty.toFixed(1))} ${unitLabel}`;
    }

    doc.text(unitsText, rowX + colW[3] / 2, y + 4.5, { align: "center" });
    rowX += colW[3];
    doc.line(rowX, y, rowX, y + rowH); // Right border

    y += rowH;
    doc.line(m, y, W - m, y);
  });

  // --- TOTALS SECTION ---
  const totalH = 12;
  doc.line(m, y, m, y + totalH);
  doc.line(W - m, y, W - m, y + totalH);

  doc.setFont("helvetica", "bold");

  doc.text("Total Cans", W / 2 + 10, y + 7, { align: "right" });
  doc.text(String(totalCans), W / 2 + 20, y + 7, { align: "center" });
  doc.line(W / 2 + 15, y + 8, W / 2 + 25, y + 8); // Underline Total Cans

  const hasLitre = transactions.some((t) => {
    const um = t.uom || t.unit || t.um;
    return Boolean(um && (String(typeof um === "object" ? um.value : um).trim().toUpperCase() === "LTR" || String(typeof um === "object" ? um.value : um).trim().toUpperCase() === "LITRE"));
  });
  doc.text("Grand Total:", W / 2 + 55, y + 7, { align: "right" });
  doc.text(`${Number(grandTotal.toFixed(2))} ${hasLitre ? "LTR" : "KG"}`, W - m - 5, y + 7, { align: "right" });
  doc.line(W / 2 + 65, y + 8, W - m - 5, y + 8); // Underline Grand Total

  y += totalH;
  doc.line(m, y, W - m, y);

  // --- FOOTER SECTION ---
  const footerH = 45;
  doc.line(m, y, m, y + footerH);
  doc.line(W - m, y, W - m, y + footerH);

  doc.setFont("helvetica", "bold");
  const companyName = (company?.name || "Company").toUpperCase();
  doc.text(
    `For ${companyName}`,
    W - m - 5,
    y + 10,
    { align: "right" }
  );

  doc.setFontSize(8);
  doc.text("Receiver's Signature", m + 5, y + footerH - 5);
  doc.text("Rechecked Signature", W / 2, y + footerH - 5, { align: "center" });
  doc.text("Authorized Signature", W - m - 5, y + footerH - 5, {
    align: "right",
  });

  y += footerH;
  doc.line(m, y, W - m, y);

  return doc;
};
