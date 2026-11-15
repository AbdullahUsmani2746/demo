import { jsPDF } from "jspdf";
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

export const generateOffDeliveryNotePDF = (
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
  // Customer setup keeps these as ACNO.stRegNo / ACNO.ntnNo
  const strn = String(
    data.strn || data.customer?.strn ||
    data.acno?.stRegNo || data.acno?.strn ||
    data.pycdAcno?.stRegNo || data.pycdAcno?.strn || ""
  );
  const ntn = String(
    data.ntn || data.customer?.ntn ||
    data.acno?.ntnNo || data.acno?.ntn ||
    data.pycdAcno?.ntnNo || data.pycdAcno?.ntn || ""
  );
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
  const biltyNo = data.biltyNo || data.bilty_no || "";
  const invDespRef = data.invDespRef || data.inv_desp_ref || "";
  const companyTitle = data.companyTitle || company?.name || "GIT";
  const forCompany = data.forCompany || `For ${companyTitle}`;

  // Filter out sub_tran_id != 1 and non-items
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

  let totalCans = 0;
  let grandTotalWeight = 0;
  let hasLitre = false;

  const items = validTxns.map((item, index) => {
    const um = item.um || item.uom || item.unit || "KG";
    const umStr = String(typeof um === "object" ? um.value || um.label : um).trim().toUpperCase();
    const isLitre = Boolean(umStr === "LTR" || umStr === "LITRE");
    if (isLitre) hasLitre = true;

    const rawQty = Number(item.qty || item.quantity || item.weight) || 0;
    const ltrQty =
      Number(item.qty_ltr ?? item.priced_qty ?? item.billed_qty ?? item.qty_billed) || 0;
    const qty = isLitre ? ltrQty || rawQty : rawQty;
    const unitLabel = isLitre ? "LTR" : "KG";
    const packs = Number(item.cans || item.no_of_pack || item.packs) || 0;

    totalCans += packs;
    grandTotalWeight += qty;

    let itemUnits = "";
    if (item.itemUnits) {
      itemUnits = item.itemUnits;
    } else if (packs > 0 && qty > 0) {
      const qtyPerPack = Number((qty / packs).toFixed(1));
      itemUnits = `${packs} X ${qtyPerPack} = ${Number(qty.toFixed(1))} ${unitLabel}`;
    } else if (qty > 0) {
      itemUnits = `${Number(qty.toFixed(1))} ${unitLabel}`;
    } else {
      itemUnits = "-";
    }

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
      itemUnits,
      cans: packs,
      weight: qty,
    };
  });

  const formattedGrandTotal = `${Number(grandTotalWeight.toFixed(2))} ${hasLitre ? "LTR" : "KG"}`;

  const W = 210;
  const m = 8;
  const boxW = W - 2 * m; // 194mm

  doc.setLineWidth(0.4);
  doc.setDrawColor(0, 0, 0);

  // Top Title: Delivery Note (Underlined)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  const titleY = m + 6;
  doc.text("Delivery Note", W / 2, titleY, { align: "center" });
  doc.setLineWidth(0.3);
  doc.line(W / 2 - 14, titleY + 1, W / 2 + 14, titleY + 1);

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
  const infoH = Math.max(40, 32 + addressHeight);
  const midX = m + 96;
  doc.line(midX, headerDivY, midX, headerDivY + infoH);

  // Left Column: Customer Details
  doc.setFontSize(9.5);
  doc.setFont("helvetica", "bold");
  doc.text("Customer Details:", m + 2, headerDivY + 5);
  doc.setFont("helvetica", "normal");
  doc.text(customerName, m + 2, headerDivY + 11);

  doc.setFont("helvetica", "bold");
  doc.text("STRN:", m + 2, headerDivY + 19);
  doc.setFont("helvetica", "normal");
  doc.text(String(strn), m + 16, headerDivY + 19);

  doc.setFont("helvetica", "bold");
  doc.text("NTN:", m + 58, headerDivY + 19);
  doc.setFont("helvetica", "normal");
  doc.text(String(ntn), m + 70, headerDivY + 19);

  doc.setFont("helvetica", "bold");
  doc.text("Address", m + 2, headerDivY + 27);
  doc.setFont("helvetica", "normal");
  doc.text(addressLines, m + 2, headerDivY + 33);

  // Right Column: Delivery Note Info
  doc.setFont("helvetica", "bold");
  doc.text("Invoice No:", midX + 4, headerDivY + 5);
  doc.text("Date:", midX + 4, headerDivY + 12);
  doc.text("Customer Ref:", midX + 4, headerDivY + 19);
  doc.text("Bilty No:", midX + 4, headerDivY + 26);
  doc.text("Inv Desp Ref:", midX + 4, headerDivY + 33);

  doc.setFont("helvetica", "normal");
  doc.text(String(invoiceNo), midX + 35, headerDivY + 5);
  doc.text(String(formattedDate), midX + 35, headerDivY + 12);
  doc.text(String(customerRef), midX + 35, headerDivY + 19);
  doc.text(String(biltyNo), midX + 35, headerDivY + 26);
  doc.text(String(invDespRef), midX + 35, headerDivY + 33);

  // Table Top Divider Line
  const tableTopY = headerDivY + infoH;
  doc.line(m, tableTopY, m + boxW, tableTopY);

  // Table Header
  const colW = [12, 72, 18, 92];
  const colX = [
    m,
    m + colW[0],
    m + colW[0] + colW[1],
    m + colW[0] + colW[1] + colW[2],
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
  doc.text("Item Units", colX[3] + colW[3] / 2, tableTopY + headerH / 2 + 1, { align: "center" });

  // Table Body Box
  let currentY = tableTopY + headerH;
  const tableBodyH = 95;
  const tableBottomY = currentY + tableBodyH;

  // Vertical Lines
  doc.line(m, currentY, m, tableBottomY);
  for (let i = 1; i < colX.length; i++) {
    doc.line(colX[i], currentY, colX[i], tableBottomY);
  }
  doc.line(m + boxW, currentY, m + boxW, tableBottomY);
  doc.line(m, tableBottomY, m + boxW, tableBottomY);

  // Row Data Rendering
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);
  const rowH = 6;
  let rowY = currentY + 5;

  items.forEach((item) => {
    if (rowY <= tableBottomY - 2) {
      doc.text(String(item.sno), colX[0] + colW[0] / 2, rowY, { align: "center" });
      doc.text(String(item.description), colX[1] + colW[1] / 2, rowY, { align: "center" });
      doc.text(String(item.batchNo), colX[2] + colW[2] / 2, rowY, { align: "center" });
      doc.text(String(item.itemUnits), colX[3] + colW[3] / 2, rowY, { align: "center" });
      rowY += rowH;
    }
  });

  // Totals Section
  const totalsY = tableBottomY + 12;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10.5);

  doc.text("Total Cans", m + 102, totalsY);
  doc.text(String(totalCans), m + 128, totalsY, { align: "center" });
  doc.line(m + 122, totalsY + 1, m + 134, totalsY + 1); // Underline

  doc.text("Grand Total:", m + 142, totalsY);
  doc.text(String(formattedGrandTotal), m + 188, totalsY, { align: "right" });
  doc.line(m + 168, totalsY + 1, m + 188, totalsY + 1); // Underline

  // Sub Footer: "For GIT" (Centered)
  const forY = totalsY + 22;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(forCompany, W / 2, forY, { align: "center" });

  // Signatures
  const sigY = forY + 28;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text("Receiver's Signature", m + 4, sigY, { align: "left" });
  doc.text("Rechecked Signature", W / 2, sigY, { align: "center" });
  doc.text("Authorized Signature", m + boxW - 4, sigY, { align: "right" });

  // Outer Border Box fitted to content
  const boxH = sigY + 3 - m;
  doc.rect(m, m, boxW, boxH);

  return doc;
};
