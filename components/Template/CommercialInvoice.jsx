import axios from "axios";
import { jsPDF } from "jspdf";
import { format } from "date-fns";

export const generateCommercialInvoicePDF = async (
  voucherId,
  session = null,
  currency,
  company
) => {
  const id =
    typeof voucherId === "object"
      ? voucherId.tran_id || voucherId.voucherId || voucherId.id
      : voucherId;

  let voucherData = {};
  try {
    const res = await axios.get(`/api/voucher/invoice?id=${id}`); // Example endpoint
    voucherData = res.data?.data?.[0] || voucherData;
  } catch (error) {
    console.error("Error fetching Commercial Invoice data", error);
  }

  // If we receive the raw object instead of fetching, support it
  if (typeof voucherId === "object" && Object.keys(voucherId).length > 2 && !voucherData.id) {
    voucherData = voucherId;
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
  const headerH = 35;
  doc.line(m, y, m, y + headerH); // Left border
  doc.line(W - m, y, W - m, y + headerH); // Right border

  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text("Commercial Invoice", W / 2, y + 4, { align: "center" });
  const textW = doc.getTextWidth("Commercial Invoice");
  doc.line(W / 2 - textW / 2, y + 4.5, W / 2 + textW / 2, y + 4.5);

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

  // Company Name & Details
  doc.setFont("helvetica", "bold");
  doc.setFontSize(14);
  doc.text(
    company?.name || "Company",
    W / 2 + 5,
    y + 11,
    { align: "center" }
  );

  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(
    [company?.addr1, company?.addr2, company?.city].filter(Boolean).join(", ") ||
      (Array.isArray(company?.address) ? company.address.join(", ") : company?.address) ||
      "",
    W / 2 + 5,
    y + 16,
    { align: "center" }
  );
  doc.text(
    [company?.phone ? `TEL. : ${company.phone}` : null, company?.email ? `EMAIL : ${company.email}` : null]
      .filter(Boolean)
      .join(" ") || company?.contact || "",
    W / 2 + 5,
    y + 21,
    { align: "center" }
  );
  doc.text(
    `STRN : ${company?.strn || "-"} NTN : ${company?.ntn || "-"}`,
    W / 2 + 5,
    y + 26,
    { align: "center" }
  );

  y += headerH;
  doc.line(m, y, W - m, y); // Bottom border of header

  // --- CUSTOMER & INFO SECTION ---
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
  const customerName = voucherData.acno?.acname || voucherData.customer?.name || voucherData.customerName || "";
  doc.text(customerName, m + 2, y + 9);

  doc.setFont("helvetica", "bold");
  doc.text("STRN:", m + 2, y + 14);
  doc.setFont("helvetica", "normal");
  // Customer setup keeps these as ACNO.stRegNo / ACNO.ntnNo
  doc.text(
    String(
      voucherData.acno?.stRegNo || voucherData.acno?.strn ||
      voucherData.customer?.stRegNo || voucherData.customer?.strn || ""
    ),
    m + 12,
    y + 14,
  );

  doc.setFont("helvetica", "bold");
  doc.text("NTN:", m + 50, y + 14);
  doc.setFont("helvetica", "normal");
  doc.text(
    String(
      voucherData.acno?.ntnNo || voucherData.acno?.ntn ||
      voucherData.customer?.ntnNo || voucherData.customer?.ntn || ""
    ),
    m + 58,
    y + 14,
  );

  doc.setFont("helvetica", "bold");
  doc.text("Address:", m + 2, y + 19);
  doc.setFont("helvetica", "normal");
  // Customer setup: Address / Shipping Address, else Bank / Invoicing Address
  const address =
    voucherData.acno?.address || voucherData.acno?.customerBankAddr ||
    voucherData.customer?.address || voucherData.customer?.customerBankAddr || "";
  doc.text(doc.splitTextToSize(address, 90), m + 15, y + 19);

  // Invoice Info (Right)
  doc.setFont("helvetica", "bold");
  doc.text("Invoice No:", midX + 2, y + 4);
  doc.text("Date:", midX + 2, y + 9);
  doc.text("Customer Ref:", midX + 2, y + 14);
  doc.text("Sale Order No:", midX + 2, y + 19);

  doc.setFont("helvetica", "normal");
  doc.text(String(voucherData.invoice_no || voucherData.tran_no || ""), midX + 25, y + 4);
  
  const vDate = voucherData.dated || voucherData.date;
  const formattedDate = vDate ? format(new Date(vDate), "dd-MM-yyyy") : "";
  doc.text(formattedDate, midX + 25, y + 9);
  
  // doc.text(String(voucherData.customer_ref || ""), midX + 25, y + 14);
  // Customer Ref = the Purchase Order No entered on the sale order
  // (OrderMaster.sale_po — same field Sale Tax Invoice prints).
  doc.text(
    String(voucherData.ordersSO?.sale_po || voucherData.customer_ref || ""),
    midX + 25,
    y + 14,
  );
  doc.text(
    String(voucherData.sale_order_no || voucherData.so_no || voucherData.ordersSO?.order_no || ""),
    midX + 25,
    y + 19,
  );

  y += infoH;
  doc.line(m, y, W - m, y); // Bottom border of info

  // --- TABLE HEADER ---
  const theadH = 12;
  doc.setFillColor(...headerGray);
  doc.rect(m, y, AW, theadH, "FD");

  // Columns: S.NO, Description, Batch No, Qty, U/M, Price, Amount (Rs)
  const colW = [12, 68, 20, 18, 15, 22, 35]; // Total 190
  const headers = ["S.NO", "Description", "Batch No", "Qty", "U/M", "Price", "Amount (Rs)"];

  let x = m;
  doc.setFont("helvetica", "bold");
  headers.forEach((h, i) => {
    doc.line(x, y, x, y + theadH); // left border of cell
    doc.text(h, x + colW[i] / 2, y + theadH / 2 + 1.5, { align: "center" });
    x += colW[i];
  });
  doc.line(W - m, y, W - m, y + theadH); // right border of header

  y += theadH;
  doc.line(m, y, W - m, y);

  // --- TABLE BODY ---
  // Only sub_tran_id === 1 are actual inventory items (exclude auto entries sub_tran_id 2, 3)
  const allTransactions = voucherData.transactions || voucherData.entries || [];
  const transactions = allTransactions.filter(
    (t) => !t.sub_tran_id || t.sub_tran_id === 1
  );
  const rowH = 7;
  doc.setFont("helvetica", "normal");

  let totalQty = 0;
  let totalAmount = 0;

  transactions.forEach((item, index) => {
    let rowX = m;
    doc.line(rowX, y, rowX, y + rowH);

    // S.NO
    doc.text(String(index + 1), rowX + colW[0] / 2, y + 4.5, { align: "center" });
    rowX += colW[0];
    doc.line(rowX, y, rowX, y + rowH);

    // Description
    const itemCode = String(item.code || item.item_code || item.itemDetails?.code || item.itcd?.code || item.itemCode || "").trim();
    const rawName = String(item.itcd?.label || item.itemDetails?.item || item.item_name || item.Description || item.desc || "").trim();
    const itemName = itemCode ? (rawName && !rawName.startsWith(itemCode) ? `${itemCode} - ${rawName}` : (rawName || itemCode)) : rawName;
    doc.text(itemName, rowX + colW[1] / 2, y + 4.5, { align: "center", maxWidth: colW[1] - 2 });
    rowX += colW[1];
    doc.line(rowX, y, rowX, y + rowH);

    // Batch No
    const batch = item.batch_no || item.BatchNo || item.batch || "";
    doc.text(batch, rowX + colW[2] / 2, y + 4.5, { align: "center" });
    rowX += colW[2];
    doc.line(rowX, y, rowX, y + rowH);

    // Qty
    const um = item.uom || item.unit || item.um || "KG";
    const isLitre = Boolean(um && String(typeof um === "object" ? um.value : um).trim().toUpperCase() === "LTR" || String(typeof um === "object" ? um.value : um).trim().toUpperCase() === "LITRE");
    const rawQty = Number(item.qty || item.quantity) || 0;
    const ltrQty = Number(item.qty_ltr ?? item.priced_qty ?? item.billed_qty ?? item.qty_billed ?? item.no_of_pack) || 0;
    const qty = isLitre ? (ltrQty || rawQty) : rawQty;
    totalQty += qty;
    doc.text(qty ? String(Number(qty.toFixed(2))) : "", rowX + colW[3] / 2, y + 4.5, { align: "center" });
    rowX += colW[3];
    doc.line(rowX, y, rowX, y + rowH);

    // U/M
    doc.text(String(um), rowX + colW[4] / 2, y + 4.5, { align: "center" });
    rowX += colW[4];
    doc.line(rowX, y, rowX, y + rowH);

    // Price
    const price = Number(item.price || item.rate) || 0;
    doc.text(price ? price.toLocaleString() : "", rowX + colW[5] / 2, y + 4.5, { align: "center" });
    rowX += colW[5];
    doc.line(rowX, y, rowX, y + rowH);

    // Amount
    const amount = Number(item.amount || item.net_amount) || (qty * price);
    totalAmount += amount;
    doc.text(amount ? amount.toLocaleString() : "0", rowX + colW[6] / 2, y + 4.5, { align: "center" });
    rowX += colW[6];
    doc.line(rowX, y, rowX, y + rowH); // Right border

    y += rowH;
    doc.line(m, y, W - m, y);
  });

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
    const itemTax = (itemAmount * itemStRate) / 100;
    return sum + itemTax;
  }, 0);

  const taxAmount =
    calculatedTaxAmount ||
    (totalAmount * taxPercent) / 100 ||
    Number(voucherData.sales_tax_amount ?? voucherData.st_amount ?? voucherData.tax_amount) ||
    0;

  const grandAmount = totalAmount + taxAmount;

  const rowTH = 7; // height of each totals row
  const totalSectionH = 3 * rowTH; // 3 rows total
  const priceColX = m + colW[0] + colW[1] + colW[2] + colW[3] + colW[4];
  const priceColW = colW[5];
  const amountColX = priceColX + priceColW;
  const amountColW = colW[6];
  const totalsStartY = y;

  // Draw all 4 vertical borders spanning full totals height at once — no gaps
  doc.line(m,          totalsStartY, m,          totalsStartY + totalSectionH); // left outer
  doc.line(priceColX,  totalsStartY, priceColX,  totalsStartY + totalSectionH); // price col left
  doc.line(amountColX, totalsStartY, amountColX, totalsStartY + totalSectionH); // amount col left
  doc.line(W - m,      totalsStartY, W - m,      totalsStartY + totalSectionH); // right outer

  doc.setFont("helvetica", "bold");

  // ── Row 1: TOTAL AMOUNT ──
  doc.text("TOTAL AMOUNT", priceColX - 2, y + 4.8, { align: "right" });
  doc.text(totalAmount.toLocaleString(), amountColX + amountColW / 2, y + 4.8, { align: "center" });
  y += rowTH;
  doc.line(priceColX, y, W - m, y); // bottom of row 1 (starts at priceColX to leave left space clean)

  // ── Row 2: ADD: SALES TAX ──
  doc.text("ADD: SALES TAX", priceColX - 2, y + 4.8, { align: "right" });
  doc.text(`${taxPercent} %`, priceColX + priceColW / 2, y + 4.8, { align: "center" });
  doc.text(taxAmount.toLocaleString(), amountColX + amountColW / 2, y + 4.8, { align: "center" });
  y += rowTH;
  doc.line(priceColX, y, W - m, y); // bottom of row 2 (starts at priceColX to leave left space clean)

  // ── Row 3: GRAND AMOUNT ──
  doc.text("GRAND AMOUNT", priceColX - 2, y + 4.8, { align: "right" });
  // const qtyText = `${Number(totalQty.toFixed(2))} KG`;
  // Same rule as GatePass/DeliveryNote: any LTR line → total shown in LTR, else KG
  const hasLitre = transactions.some((item) => {
    const um = item.uom || item.unit || item.um || "KG";
    const umStr = String(typeof um === "object" ? um.value : um).trim().toUpperCase();
    return umStr === "LTR" || umStr === "LITRE";
  });
  const qtyText = `${Number(totalQty.toFixed(2))} ${hasLitre ? "LTR" : "KG"}`;
  doc.text(qtyText, priceColX + priceColW / 2, y + 4.8, { align: "center" });
  doc.text(grandAmount.toLocaleString(), amountColX + amountColW / 2, y + 4.8, { align: "center" });
  y += rowTH;
  doc.line(priceColX, y, W - m, y); // bottom of row 3 ✅ (full width to close the section)

  // --- REMARKS SECTION ---
  const remarkH = 20;
  doc.line(m, y, m, y + remarkH);
  doc.line(W - m, y, W - m, y + remarkH);

  doc.setFont("helvetica", "bold");
  doc.text("Rupees Only.", m + 2, y + 6);
  doc.text("REMARKS:", m + 2, y + 14);
  
  // Underline for remarks
  doc.setFont("helvetica", "normal");
  doc.setDrawColor(150, 150, 150);
  doc.line(m + 22, y + 14, W - m - 5, y + 14);
  doc.setDrawColor(0, 0, 0);

  y += remarkH;
  doc.line(m, y, W - m, y);

  // --- FOOTER SECTION ---
  const footerH = 45;
  doc.line(m, y, m, y + footerH);
  doc.line(W - m, y, W - m, y + footerH);

  doc.setFont("helvetica", "bold");
  doc.text(
    `For ${company?.name || "Company"}`,
    W - m - 5,
    y + 10,
    { align: "right" }
  );

  doc.setFontSize(8);
  doc.text("Receiver's Signature", m + 5, y + footerH - 5);
  doc.text("Rechecked Signature", W / 2, y + footerH - 5, { align: "center" });
  doc.text("Authorized Signature", W - m - 5, y + footerH - 5, { align: "right" });

  y += footerH;
  doc.line(m, y, W - m, y);

  return doc;
};
