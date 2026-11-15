import axios from "axios";
import { jsPDF } from "jspdf";
import { format } from "date-fns";
import { toWords } from "number-to-words";

export const generateSalesTaxInvoicePDF = async (
  params,
  _session = null,
  _currency,
  _company
) => {
  // Support both object-style call: { voucher, currencyData, companyData, session, mode }
  // and legacy positional call: (voucherId, session, currency, company)
  let voucherData = {};
  let company = _company;
  let currency = _currency;
  let mode = null;
  // Optional, for Invoicing (components/Invoicing): the same layout titled as
  // a Purchase Invoice / Credit Note / Debit Note, and `posted` prints each
  // line's posted gross_amount / st_amount (incl. additional tax) instead of
  // recomputing them. Defaults keep every existing print unchanged.
  let title = "Sales Tax Invoice";
  let partyLabel = "Customer Details:";
  let refLabel = "Customer Ref:";
  let posted = false;

  if (params && typeof params === "object" && ("voucher" in params || "currencyData" in params || "companyData" in params)) {
    // Object-style call — data already fetched by caller
    voucherData = params.voucher || {};
    company = params.companyData || _company;
    currency = params.currencyData || _currency;
    mode = params.mode || null;
    title = params.title || title;
    partyLabel = params.partyLabel || partyLabel;
    refLabel = params.refLabel || refLabel;
    posted = params.posted === true;
  } else {
    // Legacy positional call: first arg is voucherId or a raw data object
    const voucherId = params;
    const id =
      typeof voucherId === "object"
        ? voucherId.tran_id || voucherId.voucherId || voucherId.id
        : voucherId;

    if (id) {
      try {
        const res = await axios.get(`/api/voucher/invoice?id=${id}`);
        voucherData = res.data?.data?.[0] || {};
      } catch (error) {
        console.error("Error fetching Sales Invoice data", error);
      }
    }

    if (typeof voucherId === "object" && Object.keys(voucherId).length > 2 && !voucherData.id) {
      voucherData = voucherId;
    }
  }

  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const W = 210;
  const m = 8;
  const boxW = W - 2 * m; // 194mm

  const borderCol = [0, 0, 0];
  doc.setDrawColor(...borderCol);
  doc.setLineWidth(0.4);

  let y = m;

  // --- HEADER SECTION ---
  // Top Right: ORIGINAL INVOICE
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("ORIGINAL INVOICE", m + boxW - 2, y + 5, { align: "right" });

  // Top Center: Sales Tax Invoice (Underlined)
  // doc.setFontSize(10);
  // doc.text("Sales Tax Invoice", W / 2 - 10, y + 5, { align: "center" });
  // doc.setLineWidth(0.3);
  // doc.line(W / 2 - 25, y + 6, W / 2 + 5, y + 6);

  // Top Center: Sales Tax Invoice (Underlined)
  doc.setFontSize(10);
  doc.text(title, W / 2 + 3, y + 5, { align: "center" });

  doc.setLineWidth(0.3);
  doc.line(W / 2 - 12, y + 6, W / 2 + 18, y + 6);

  // Logo loading without aspect ratio stretch
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
    console.warn("Could not load logo image", err);
  }

  if (logoData) {
    // Proportional logo rendering (20mm x 20mm square container)
    doc.addImage(logoData, "JPEG", m + 3, y + 4, 20, 20);
  } else {
    // Crisp red circle fallback logo
    doc.setFillColor(237, 28, 36);
    doc.circle(m + 13, y + 14, 9, "F");
    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text("EC", m + 13, y + 17, { align: "center" });
    doc.setTextColor(0, 0, 0);
  }

  // Company Name & Details
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15.5);
  doc.text(
    company?.name || "Company",
    W / 2 + 10,
    y + 11,
    { align: "center" }
  );

  // Build address line from addr1, addr2, city fields
  let companyAddrLine = (
    [company?.addr1, company?.addr2, company?.city].filter(Boolean).join(", ") ||
    ""
  )
    .replace(/Pakistan,\s*Karachi/gi, "Pakistan")
    .replace(/Karachi,\s*Karachi/gi, "Karachi");

  // Build contact line from phone and email
  const companyContactLine = [
    company?.phone ? `TEL. : ${company.phone}` : null,
    company?.email ? `EMAIL : ${company.email}` : null,
  ].filter(Boolean).join(" ") || "";

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(companyAddrLine, W / 2 + 10, y + 16, { align: "center" });
  doc.text(companyContactLine, W / 2 + 10, y + 21, { align: "center" });
  doc.setFont("helvetica", "bold");
  doc.text(
    `STRN : ${company?.strn || "-"} NTN : ${company?.ntn || "-"}`,
    W / 2 + 10,
    y + 26,
    { align: "center" }
  );

  const headerH = 30;
  y += headerH;
  doc.setLineWidth(0.4);
  doc.line(m, y, m + boxW, y); // Bottom border of header

  // --- CUSTOMER & INFO SECTION (DYNAMIC HEIGHT) ---
  const customerName =
    voucherData.acno?.acname || voucherData.customer?.name || voucherData.customerName || "";
  // Customer setup: Address / Shipping Address, else Bank / Invoicing Address
  const address =
    voucherData.acno?.address || voucherData.acno?.customerBankAddr ||
    voucherData.customer?.address || voucherData.customer?.customerBankAddr || "";
  
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  const addressLines = address ? doc.splitTextToSize(address, 88) : [];
  const addressHeight = addressLines.length * 4.5;
  
  // Calculate dynamic info box height based on address lines with sufficient bottom padding
  const infoH = Math.max(34, 28 + addressHeight + 4);
  const midX = m + 96;

  doc.line(midX, y, midX, y + infoH); // Vertical divider

  // Customer Details (Left)
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text(partyLabel, m + 2, y + 5);

  doc.setFont("helvetica", "normal");
  doc.text(customerName, m + 2, y + 11);

  doc.setFont("helvetica", "bold");
  doc.text("STRN:", m + 2, y + 18);
  doc.setFont("helvetica", "normal");
  // Customer setup keeps these as ACNO.stRegNo / ACNO.ntnNo
  doc.text(
    String(
      voucherData.acno?.stRegNo || voucherData.acno?.strn ||
      voucherData.customer?.stRegNo || voucherData.customer?.strn || ""
    ),
    m + 15,
    y + 18,
  );

  doc.setFont("helvetica", "bold");
  doc.text("NTN:", m + 58, y + 18);
  doc.setFont("helvetica", "normal");
  doc.text(
    String(
      voucherData.acno?.ntnNo || voucherData.acno?.ntn ||
      voucherData.customer?.ntnNo || voucherData.customer?.ntn || ""
    ),
    m + 68,
    y + 18,
  );

  doc.setFont("helvetica", "bold");
  doc.text("Address", m + 2, y + 25);
  doc.setFont("helvetica", "normal");
  doc.text(addressLines, m + 2, y + 30);

  // Right Column: Invoice Info
  doc.setFont("helvetica", "bold");
  doc.text("Invoice No:", midX + 4, y + 5);
  doc.text("Date:", midX + 4, y + 12);
  doc.text(refLabel, midX + 4, y + 19);

  doc.setFont("helvetica", "normal");
  // Customer Ref = the Purchase Order No entered on the sale order
  // (OrderMaster.sale_po), same as the Commercial Invoice.
  doc.text(
    String(voucherData.ordersSO?.sale_po || voucherData.customer_ref || ""),
    midX + 35,
    y + 19,
  );
  doc.text(String(voucherData.invoice_no || voucherData.tran_no || ""), midX + 35, y + 5);

  const vDate = voucherData.dated || voucherData.date || "2026-08-01";
  let formattedDate = vDate;
  try {
    const d = new Date(vDate);
    formattedDate = `${String(d.getDate()).padStart(2, "0")}-${String(d.getMonth() + 1).padStart(2, "0")}-${d.getFullYear()}`;
  } catch {}
  doc.text(formattedDate, midX + 35, y + 12);

  y += infoH;
  doc.line(m, y, m + boxW, y); // Bottom border of info box

  // --- TABLE HEADER ---
  const tableTopY = y;
  const headerGray = [220, 220, 220];
  const theadH = 15;
  doc.setFillColor(...headerGray);
  doc.rect(m, y, boxW, theadH, "F");
  doc.rect(m, y, boxW, theadH);

  // Columns: S.NO, Description, Batch No, Qty, U/M, Price, Amount (Rs)
  const colW = [12, 64, 20, 20, 14, 24, 40]; // Total 194
  const colX = [
    m,
    m + colW[0],
    m + colW[0] + colW[1],
    m + colW[0] + colW[1] + colW[2],
    m + colW[0] + colW[1] + colW[2] + colW[3],
    m + colW[0] + colW[1] + colW[2] + colW[3] + colW[4],
    m + colW[0] + colW[1] + colW[2] + colW[3] + colW[4] + colW[5],
  ];

  for (let i = 1; i < colX.length; i++) {
    doc.line(colX[i], y, colX[i], y + theadH);
  }

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("S.NO", colX[0] + colW[0] / 2, y + theadH / 2 + 1, { align: "center" });
  doc.text("Description", colX[1] + colW[1] / 2, y + theadH / 2 + 1, { align: "center" });
  doc.text("Batch No", colX[2] + colW[2] / 2, y + theadH / 2 + 1, { align: "center" });
  doc.text("Qty", colX[3] + colW[3] / 2, y + theadH / 2 + 1, { align: "center" });
  doc.text("U/M", colX[4] + colW[4] / 2, y + theadH / 2 + 1, { align: "center" });
  doc.text("Price", colX[5] + colW[5] / 2, y + theadH / 2 + 1, { align: "center" });
  doc.text("Amount (Rs)", colX[6] + colW[6] / 2, y + theadH / 2 + 1, { align: "center" });

  y += theadH;

  // --- DYNAMIC TABLE ROWS ---
  const allTransactions =
    voucherData.transactions || voucherData.entries || voucherData.items || [];

  // Filter out empty/blank rows — only keep rows that have a description OR qty OR amount
  const transactions = allTransactions.filter((item) => {
    const desc = item.Description || item.description || item.itcd?.label || item.itemDetails?.item || item.item_name || "";
    const qty = Number(item.qty || item.quantity) || 0;
    const amount = Number(item.amount || item.net_amount) || 0;
    return desc || qty || amount;
  });

  const rowH = 6;

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8.5);

  let totalQty = 0;
  let totalAmount = 0;

  transactions.forEach((item, index) => {
    // Draw row horizontal border line
    doc.line(m, y + rowH, m + boxW, y + rowH);

    const um = item.uom || item.unit || item.um || "KG";
    const isLitre = Boolean(um && String(typeof um === "object" ? um.value : um).trim().toUpperCase() === "LTR" || String(typeof um === "object" ? um.value : um).trim().toUpperCase() === "LITRE");
    const rawQty = Number(item.qty || item.quantity) || 0;
    const ltrQty = Number(item.qty_ltr ?? item.priced_qty ?? item.billed_qty ?? item.qty_billed ?? item.no_of_pack) || 0;
    const qty = isLitre ? (ltrQty || rawQty) : rawQty;
    const price = Number(item.price || item.rate) || 0;
    const amount = posted ? Number(item.gross_amount) || 0 : Number(item.amount || item.net_amount) || qty * price;

    totalQty += qty;
    totalAmount += amount;

    const textY = y + 4.5;
    doc.text(String(index + 1), colX[0] + colW[0] / 2, textY, { align: "center" });

    const itemCode = String(item.code || item.item_code || item.itemDetails?.code || item.itcd?.code || item.itemCode || "").trim();
    const rawName = String(item.Description || item.description || item.itcd?.label || item.itemDetails?.item || item.item_name || "").trim();
    const itemName = itemCode ? (rawName && !rawName.startsWith(itemCode) ? `${itemCode} - ${rawName}` : (rawName || itemCode)) : rawName;
    doc.text(itemName, colX[1] + colW[1] / 2, textY, { align: "center", maxWidth: colW[1] - 2 });

    const batch = item.batch_no || item.BatchNo || item.batchNo || item.batch || "-";
    doc.text(String(batch), colX[2] + colW[2] / 2, textY, { align: "center" });

    // 125.00 → "125", 9.50 → "9.5", 9.25 → "9.25" — no trailing .00
    doc.text(qty ? String(Number(qty.toFixed(2))) : "0", colX[3] + colW[3] / 2, textY, { align: "center" });

    doc.text(String(um), colX[4] + colW[4] / 2, textY, { align: "center" });

    doc.text(price ? price.toLocaleString("en-US") : "", colX[5] + colW[5] / 2, textY, { align: "center" });

    doc.text(amount ? amount.toLocaleString("en-US") : "0", colX[6] + colW[6] / 2, textY, { align: "center" });

    y += rowH;
  });

  // Vertical column grid lines end at table bottom (last item row)
  doc.line(m, tableTopY + theadH, m, y);
  for (let i = 1; i < colX.length; i++) {
    doc.line(colX[i], tableTopY + theadH, colX[i], y);
  }
  doc.line(m + boxW, tableTopY + theadH, m + boxW, y);

  // --- TOTALS SECTION ---
  const firstTxnWithTax = transactions.find(
    (t) =>
      (t.st_rate != null && t.st_rate !== "") ||
      (t.sales_tax_percent != null && t.sales_tax_percent !== "") ||
      (t.st_percent != null && t.st_percent !== "") ||
      (t.stRate != null && t.stRate !== "")
  );

  const rawTaxPercent =
    voucherData.sales_tax_percent ??
    voucherData.st_rate ??
    voucherData.stRate ??
    voucherData.st_percent ??
    firstTxnWithTax?.st_rate ??
    firstTxnWithTax?.sales_tax_percent ??
    firstTxnWithTax?.st_percent ??
    firstTxnWithTax?.stRate ??
    0;

  const taxPercent = Number(rawTaxPercent) || 0;

  const calculatedTaxAmount = transactions.reduce((sum, item) => {
    const um = item.uom || item.unit || item.um || "KG";
    const isLitre = Boolean(um && String(typeof um === "object" ? um.value : um).trim().toUpperCase() === "LTR" || String(typeof um === "object" ? um.value : um).trim().toUpperCase() === "LITRE");
    const rawQty = Number(item.qty || item.quantity) || 0;
    const ltrQty = Number(item.qty_ltr ?? item.priced_qty ?? item.billed_qty ?? item.qty_billed ?? item.no_of_pack) || 0;
    const qty = isLitre ? (ltrQty || rawQty) : rawQty;
    const price = Number(item.price || item.rate) || 0;
    const itemAmount = Number(item.amount || item.net_amount) || qty * price;
    const itemStRate = Number(
      item.st_rate ?? item.sales_tax_percent ?? item.st_percent ?? item.stRate ?? taxPercent
    );
    const itemTax = posted ? Number(item.st_amount) || 0 : (itemAmount * itemStRate) / 100;
    return sum + itemTax;
  }, 0);

  const taxAmount = posted ? calculatedTaxAmount :
    calculatedTaxAmount ||
    (totalAmount * taxPercent) / 100 ||
    Number(voucherData.sales_tax_amount ?? voucherData.st_amount ?? voucherData.tax_amount) ||
    0;

  const grandAmount = totalAmount + taxAmount;

  const totalsY = y;
  const totalsRowH = 6;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);

  // Row 1: TOTAL AMOUNT
  doc.text("TOTAL AMOUNT", colX[5] - 4, totalsY + 4.5, { align: "right" });
  doc.rect(colX[6], totalsY, colW[6], totalsRowH);
  doc.text(totalAmount ? totalAmount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : "0", colX[6] + colW[6] / 2, totalsY + 4.5, { align: "center" });

  // Row 2: ADD: SALES TAX
  const row2Y = totalsY + totalsRowH;
  doc.text("ADD: SALES TAX", colX[5] - 4, row2Y + 4.5, { align: "right" });
  doc.text(`${taxPercent} %`, colX[5] + colW[5] / 2, row2Y + 4.5, { align: "center" });
  doc.rect(colX[6], row2Y, colW[6], totalsRowH);
  doc.text(taxAmount ? taxAmount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : "0", colX[6] + colW[6] / 2, row2Y + 4.5, { align: "center" });

  // Row 3: GRAND AMOUNT
  const row3Y = row2Y + totalsRowH;
  doc.text("GRAND AMOUNT", colX[5] - 4, row3Y + 4.5, { align: "right" });

  // Underlined Total Weight/Qty in Price Column
  // const totalQtyStr = `${Number(totalQty.toFixed(2))} KG`;
  // Same rule as GatePass/DeliveryNote: any LTR line → total shown in LTR, else KG
  const hasLitre = transactions.some((item) => {
    const um = item.uom || item.unit || item.um || "KG";
    const umStr = String(typeof um === "object" ? um.value : um).trim().toUpperCase();
    return umStr === "LTR" || umStr === "LITRE";
  });
  const totalQtyStr = `${Number(totalQty.toFixed(2))} ${hasLitre ? "LTR" : "KG"}`;
  doc.text(totalQtyStr, colX[5] + colW[5] / 2, row3Y + 4.5, { align: "center" });
  const qtyW = doc.getTextWidth(totalQtyStr);
  doc.line(
    colX[5] + colW[5] / 2 - qtyW / 2,
    row3Y + 5.5,
    colX[5] + colW[5] / 2 + qtyW / 2,
    row3Y + 5.5
  );

  doc.rect(colX[6], row3Y, colW[6], totalsRowH);
  doc.text(grandAmount ? grandAmount.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : "0", colX[6] + colW[6] / 2, row3Y + 4.5, { align: "center" });

  // --- REMARKS & WORDS SECTION ---
  const afterTotalsY = row3Y + totalsRowH;

  const wordsY = afterTotalsY + 7;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);

  let wordsText = "Rupees Only.";
  if (grandAmount > 0) {
    try {
      const words = toWords(Math.round(grandAmount));
      wordsText = `${words.charAt(0).toUpperCase() + words.slice(1)} Rupees Only.`;
    } catch {}
  }
  doc.text(wordsText, m + 2, wordsY);

  const remarksY = wordsY + 7;
  doc.text("REMARKS:", m + 2, remarksY);
  doc.line(m + 24, remarksY + 1, m + boxW - 6, remarksY + 1);

  // Horizontal line below REMARKS
  const afterRemarksY = remarksY + 4;
  doc.line(m, afterRemarksY, m + boxW, afterRemarksY);

  // Left & Right border lines for Remarks area
  doc.line(m, totalsY, m, afterRemarksY);
  doc.line(m + boxW, totalsY, m + boxW, afterRemarksY);

  // --- FOOTER SECTION ---
  const forCompanyStr = `For ${company?.name || "Company"}`;
  const forY = afterRemarksY + 10;
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9.5);
  doc.text(forCompanyStr, m + boxW - 4, forY, { align: "right" });

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

  // Handle output based on mode
  if (mode === "print") {
    doc.autoPrint();
    window.open(doc.output("bloburl"), "_blank");
    return doc;
  }

  return doc;
};