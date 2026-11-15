import { jsPDF } from "jspdf";
import { toWords } from "number-to-words";
import { format } from "date-fns";

const formatDateDDMMYYYY = (dateVal) => {
  if (!dateVal) return "";
  try {
    const d = new Date(dateVal);
    if (isNaN(d.getTime())) return String(dateVal);
    return format(d, "dd-MM-yyyy");
  } catch {
    return String(dateVal);
  }
};

export const generateOffCommercialInvoicePDF = (
  data = {},
  session = null,
  currency = null,
  company = null
) => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const customerName =
    data.customerName ||
    data.customer?.name ||
    data.acno?.acname ||
    data.pycdAcno?.acname ||
    "";
  const customerAddress =
    data.customerAddress ||
    data.customer?.address ||
    data.acno?.address ||
    data.pycdAcno?.address ||
    // else Bank / Invoicing Address from customer setup
    data.acno?.customerBankAddr ||
    data.pycdAcno?.customerBankAddr ||
    "";
  const invoiceNo =
    data.invoiceNo ||
    data.invoice_no ||
    data.invoice?.number ||
    data.vr_no ||
    data.tran_no ||
    "";
  const formattedDate = formatDateDDMMYYYY(data.date || data.dated);
  // const customerRef = data.customerRef || data.customer_ref || "";
  // Customer Ref = the Purchase Order No entered on the sale order
  // (OrderMaster.sale_po), same as the Commercial Invoice.
  const customerRef = data.ordersSO?.sale_po || data.customerRef || data.customer_ref || "";
  const saleOrderNo =
    data.saleOrderNo || data.sale_order_no ||
    data.so_no || data.ordersSO?.order_no ||
    data.invoice?.po || "";
  const companyTitle = data.companyTitle || company?.name || "GIT";
  const forCompany = data.forCompany || `For ${companyTitle}`;
  const remarks = data.remarks || data.rmk || "";

  const allTxns = data.items || data.transactions || data.entries || [];
  const validTxns = Array.isArray(allTxns)
    ? allTxns.filter((item) => {
        if (item.sub_tran_id && item.sub_tran_id !== 1) return false;
        const rawDesc = String(
          item.description ||
            item.itcd?.label ||
            item.itemDetails?.item ||
            item.item_name ||
            item.Description ||
            ""
        ).trim();
        const rawQty = Number(item.qty || item.quantity || item.weight) || 0;
        const ltrQty = Number(item.qty_ltr ?? item.priced_qty ?? item.billed_qty ?? item.qty_billed) || 0;
        const packs = Number(item.cans || item.no_of_pack || item.packs) || 0;
        return rawDesc !== "" || rawQty > 0 || ltrQty > 0 || packs > 0;
      })
    : [];

  const items = validTxns.map((item, index) => {
    const um = item.um || item.uom || item.unit || "KG";
    const umStr = String(typeof um === "object" ? um.value || um.label : um).trim().toUpperCase();
    const isLitre = Boolean(umStr === "LTR" || umStr === "LITRE");
    const rawQty = Number(item.qty || item.quantity || item.weight) || 0;
    const ltrQty =
      Number(item.qty_ltr ?? item.priced_qty ?? item.billed_qty ?? item.qty_billed ?? item.no_of_pack) || 0;
    const qty = isLitre ? ltrQty || rawQty : rawQty;
    const price = Number(item.price || item.rate || 0);
    const amount = Number(item.amount || item.net_amount || qty * price || 0);

    const itemCode = String(
      item.code || item.item_code || item.itemDetails?.code || item.itcd?.code || item.itemCode || ""
    ).trim();
    const rawDesc = String(
      item.description || item.itcd?.label || item.itemDetails?.item || item.item_name || ""
    ).trim();
    const description = itemCode
      ? rawDesc && !rawDesc.startsWith(itemCode)
        ? `${itemCode} - ${rawDesc}`
        : rawDesc || itemCode
      : rawDesc;

    return {
      sno: item.sno || index + 1,
      description,
      batchNo: item.batchNo || item.batch_no || "-",
      qty: qty.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
      um: String(typeof um === "object" ? um.value || um.label : um),
      price: price.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
      amountVal: amount,
      amount: amount.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
    };
  });

  const totalAmountVal = items.reduce((sum, item) => sum + item.amountVal, 0);
  const totalAmountFormatted = totalAmountVal > 0
    ? totalAmountVal.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })
    : "0.00";

  const amountInWords = (() => {
    if (data.amountInWords) return data.amountInWords;
    try {
      const rounded = Math.round(totalAmountVal);
      if (rounded > 0) {
        const words = toWords(rounded);
        return `Rupees ${words.charAt(0).toUpperCase() + words.slice(1)} Only.`;
      }
    } catch {
      // fallback
    }
    return "Rupees Only.";
  })();

  const W = 210;
  const m = 8;
  const boxW = W - 2 * m; // 194mm

  doc.setLineWidth(0.4);
  doc.setDrawColor(0, 0, 0);

  // Top Title: Commercial Invoice (Underlined)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  const titleY = m + 6;
  doc.text("Commercial Invoice", W / 2, titleY, { align: "center" });
  doc.setLineWidth(0.3);
  doc.line(W / 2 - 18, titleY + 1, W / 2 + 18, titleY + 1);

  // Company Name
  doc.setFontSize(22);
  doc.text(companyTitle, W / 2, m + 18, { align: "center" });

  // Header Divider Line
  const headerDivY = m + 28;
  doc.line(m, headerDivY, m + boxW, headerDivY);

  doc.setFontSize(9.5);
  doc.setFont("helvetica", "normal");
  const addressLines = customerAddress ? doc.splitTextToSize(customerAddress, 88) : [];
  const addressHeight = Math.max(1, addressLines.length) * 4.5;

  // Dynamic Info Box Height
  const infoH = Math.max(34, 25 + addressHeight);
  const midX = m + 96;
  doc.line(midX, headerDivY, midX, headerDivY + infoH);

  // Left Column: Customer Details
  doc.setFontSize(9.5);
  doc.setFont("helvetica", "bold");
  doc.text("Customer Details:", m + 2, headerDivY + 5);
  doc.setFont("helvetica", "normal");
  doc.text(customerName, m + 2, headerDivY + 11);
  doc.setFont("helvetica", "bold");
  doc.text("Address", m + 2, headerDivY + 20);
  doc.setFont("helvetica", "normal");
  doc.text(addressLines, m + 2, headerDivY + 26);

  // Right Column: Invoice Info
  doc.setFont("helvetica", "bold");
  doc.text("Invoice No:", midX + 4, headerDivY + 5);
  doc.text("Date:", midX + 4, headerDivY + 12);
  doc.text("Customer Ref:", midX + 4, headerDivY + 19);
  doc.text("Sale Order No:", midX + 4, headerDivY + 26);

  doc.setFont("helvetica", "normal");
  doc.text(String(invoiceNo), midX + 35, headerDivY + 5);
  doc.text(String(formattedDate), midX + 35, headerDivY + 12);
  doc.text(String(customerRef), midX + 35, headerDivY + 19);
  doc.text(String(saleOrderNo), midX + 35, headerDivY + 26);

  // Table Top Divider Line
  const tableTopY = headerDivY + infoH;
  doc.line(m, tableTopY, m + boxW, tableTopY);

  // Table Column Widths (Total = 194mm)
  const colW = [12, 64, 20, 20, 14, 24, 40];
  const colX = [
    m,
    m + colW[0],
    m + colW[0] + colW[1],
    m + colW[0] + colW[1] + colW[2],
    m + colW[0] + colW[1] + colW[2] + colW[3],
    m + colW[0] + colW[1] + colW[2] + colW[3] + colW[4],
    m + colW[0] + colW[1] + colW[2] + colW[3] + colW[4] + colW[5],
  ];

  const headerH = 15;
  doc.setFillColor(220, 220, 220);
  doc.rect(m, tableTopY, boxW, headerH, "F");
  doc.rect(m, tableTopY, boxW, headerH);

  for (let i = 1; i < colX.length; i++) {
    doc.line(colX[i], tableTopY, colX[i], tableTopY + headerH);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("S.NO", colX[0] + colW[0] / 2, tableTopY + headerH / 2 + 1, { align: "center" });
  doc.text("Description", colX[1] + colW[1] / 2, tableTopY + headerH / 2 + 1, { align: "center" });
  doc.text("Batch No", colX[2] + colW[2] / 2, tableTopY + headerH / 2 + 1, { align: "center" });
  doc.text("Qty", colX[3] + colW[3] / 2, tableTopY + headerH / 2 + 1, { align: "center" });
  doc.text("U/M", colX[4] + colW[4] / 2, tableTopY + headerH / 2 + 1, { align: "center" });
  doc.text("Price", colX[5] + colW[5] / 2, tableTopY + headerH / 2 + 1, { align: "center" });
  doc.text("Amount (Rs)", colX[6] + colW[6] / 2, tableTopY + headerH / 2 + 1, { align: "center" });

  // Table Body Rows
  let currentY = tableTopY + headerH;
  const rowH = 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);

  items.forEach((item) => {
    // Row horizontal line
    doc.line(m, currentY + rowH, m + boxW, currentY + rowH);

    const textY = currentY + 4.5;
    doc.text(String(item.sno), colX[0] + colW[0] / 2, textY, { align: "center" });
    doc.text(String(item.description), colX[1] + colW[1] / 2, textY, { align: "center" });
    doc.text(String(item.batchNo), colX[2] + colW[2] / 2, textY, { align: "center" });
    doc.text(String(item.qty), colX[3] + colW[3] / 2, textY, { align: "center" });
    doc.text(String(item.um), colX[4] + colW[4] / 2, textY, { align: "center" });
    doc.text(String(item.price), colX[5] + colW[5] / 2, textY, { align: "center" });
    doc.text(String(item.amount), colX[6] + colW[6] / 2, textY, { align: "center" });

    currentY += rowH;
  });

  // Vertical column grid lines end at currentY (bottom of last item row)
  doc.line(m, tableTopY + headerH, m, currentY);
  for (let i = 1; i < colX.length; i++) {
    doc.line(colX[i], tableTopY + headerH, colX[i], currentY);
  }
  doc.line(m + boxW, tableTopY + headerH, m + boxW, currentY);

  // Total Amount Row
  const totalRowY = currentY;
  const totalRowH = 7;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("TOTAL AMOUNT", colX[6] - 6, totalRowY + 5, { align: "right" });

  // Total Amount Value Box
  doc.rect(colX[6], totalRowY, colW[6], totalRowH);
  doc.text(totalAmountFormatted, colX[6] + colW[6] / 2, totalRowY + 5, { align: "center" });

  // Clean Open Remarks & Amount in Words Area
  const wordsY = totalRowY + totalRowH + 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text(amountInWords, m + 2, wordsY);

  const remarksY = wordsY + 7;
  doc.text("REMARKS:", m + 2, remarksY);
  if (remarks) {
    doc.setFont("helvetica", "normal");
    doc.text(String(remarks), m + 26, remarksY);
  }
  doc.line(m + 24, remarksY + 1, m + boxW - 6, remarksY + 1);

  // Horizontal line across below REMARKS
  const afterRemarksY = remarksY + 4;
  doc.line(m, afterRemarksY, m + boxW, afterRemarksY);

  // Left & Right Outer Border lines for the open Remarks area
  doc.line(m, totalRowY, m, afterRemarksY);
  doc.line(m + boxW, totalRowY, m + boxW, afterRemarksY);

  // Sub Footer: "For GIT" (Centered)
  const forY = afterRemarksY + 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(forCompany, W / 2, forY, { align: "center" });

  // Signatures
  const sigY = forY + 25;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text("Receiver's Signature", m + 4, sigY, { align: "left" });
  doc.text("Rechecked Signature", W / 2, sigY, { align: "center" });
  doc.text("Authorized Signature", m + boxW - 4, sigY, { align: "right" });

  // Draw Outer Border Box exact to fitted content
  const boxH = sigY + 3 - m;
  doc.rect(m, m, boxW, boxH);

  return doc;
};
