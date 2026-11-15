import axios from "axios";
import { jsPDF } from "jspdf";
import { toWords } from "number-to-words";
import { DEFAULT_COMPANY_LOGO, companyShortName } from "@/lib/companyName";


export const generateSalesTaxPDF = async ({
  voucher,
  session = null,
  currencyData = null,
  companyData = null,
  mode = "download",
}) => {
  const {
    dated,
    tran_code,
    vr_no,
    so_no,
    po_no,
    dispatch_no,
    userId,
    rmk,
    rmk1,
    transactions,
    acno,
    invoice_no,
    godownDetails,
    ordersSO,
  } = voucher;



  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const actualCompany = companyData?.data || companyData;
  //console.log("PDF Template received companyData:", companyData);
  const LOGO_RIGHT = actualCompany?.logo || DEFAULT_COMPANY_LOGO;
  const companyName = actualCompany?.name || actualCompany?.company || actualCompany?.companyName || "N/A";
  const companyAddress = Array.isArray(actualCompany?.address) ? actualCompany.address : ["N/A"];

  // const currencySymbol = currencyData?.symbol || "N/A";
  const currencyCode = currencyData?.code || "N/A";

  const page = { w: 210, h: 297, m: 5 };
  const c = {
    red: [204, 0, 0],
    gray: [160, 160, 160],
    lightGray: [240, 240, 240],
    darkGray: [220, 220, 220],
    text: [0, 0, 0],
  };

  const fmt0 = (n) =>
    Number(n).toLocaleString("en-PK", {
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    });

  const fmt2 = (n) =>
    Number(n).toLocaleString("en-PK", {
      // minimumFractionDigits: 0,
      // maximumFractionDigits: 0,
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });

  const printedBy = session?.user?.name || voucher?.userid || "N/A";
  const printedOn =
    new Date().toLocaleDateString("en-GB") +
    " " +
    new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  // -----------------------------------------------------------------
  // Prepare Dynamic Data from Voucher
  // -----------------------------------------------------------------

  const customer = {
    name: acno?.acname ? String(acno.acname) : "Unknown Customer",
    address: acno?.customerBankAddr
      ? String(acno.customerBankAddr)
      : godownDetails?.godown || "Not Provided",
    ntn: acno?.ntnNo ? String(acno.ntnNo) : "Not Available",
    strn: acno?.stRegNo ? String(acno.stRegNo) : "Not Available",
    contact: acno?.phoneFax ? String(acno.phoneFax) : "",
    paymentTerms: acno?.crDays ? String(acno.crDays) + " Days" : "Not Available",
  };
  const formatDate = (date) => {
    const d = new Date(date);

    const day = String(d.getDate()).padStart(2, "0");

    const month = d
      .toLocaleString("en-GB", { month: "short" })
      .toUpperCase();

    const year = String(d.getFullYear()).slice(-2);

    return `${day}-${month}-${year}`;
  };

  const invoiceInfo = {
    invoiceNo: invoice_no ? String(invoice_no) : `INV-${String(vr_no)}`,

    invoiceDate: dated
      ? formatDate(dated)
      : formatDate(new Date()),

    dnNo: String(dispatch_no || rmk1 || "-"),

    dnDate: dated
      ? formatDate(dated)
      : formatDate(new Date()),

    paymentTerms: customer.paymentTerms,
    hsCode: "3215",
    salesOrderNo: String(so_no || "-"),
    purchaseOrderNo: String(ordersSO?.sale_po || "-"),
  };

  // const invoiceInfo = {
  //   invoiceNo: invoice_no ? String(invoice_no) : `INV-${String(vr_no)}`,
  //   invoiceDate: (dated || dated)
  //     ? new Date(dated || dated).toLocaleDateString("en-GB")
  //     : new Date().toLocaleDateString("en-GB"),
  //   dnNo: String(dispatch_no || rmk1 || "-"),
  //   dnDate: (dated || dated)
  //     ? new Date(dated || dated).toLocaleDateString("en-GB")
  //     : new Date().toLocaleDateString("en-GB"),
  //   paymentTerms: String(30),
  //   hsCode: "3215", // if dynamic, wrap with String()
  //   salesOrderNo: String(so_no || "-"),
  //   purchaseOrderNo: String(ordersSO.sale_po || "-"),
  // };

  // Table Rows from Transactions
  const rows = [];
  let totalQty = 0;
  let totalExc = 0;
  let totalTax = 0;
  let totalInc = 0;

  transactions
    ?.filter((t) => t.sub_tran_id !== 3) // Exclude total transactions
    .forEach((t, idx) => {
      const itemName =
        t.itemDetails?.item || t.acnoDetails?.acname || "Unknown";
      const materialCode = t.itemDetails?.code || t.chno || "-";
      const qty = t.qty ?? 0;
      const unitPrice = t.rate ?? 0;
      const valueExc = qty * unitPrice;
      const taxRate = (t.st_rate ?? 0) + (t.additional_tax ?? 0);
      const taxAmount = valueExc * (taxRate / 100);
      const totalValue = valueExc + taxAmount;

      rows.push([
        String(idx + 1),
        itemName,
        materialCode,
        "KG",
        fmt2(qty),
        fmt2(unitPrice),
        fmt0(valueExc),
        fmt2(taxRate),
        fmt0(taxAmount),
        fmt0(totalValue),
      ]);

      totalQty += qty;
      totalExc += valueExc;
      totalTax += taxAmount;
      totalInc += totalValue;
    });

  const totals = {
    qty: fmt2(totalQty),
    exc: fmt0(totalExc),
    tax: fmt0(totalTax),
    inc: fmt0(totalInc),
  };

  // -----------------------------------------------------------------
  // Header
  // -----------------------------------------------------------------
  const drawHeader = () => {
    let y = page.m;

    const boxH = 10;
    const boxW = 70;

    // doc.setDrawColor(0, 0, 0);
    // doc.setTextColor(0, 0, 0);
    // doc.setLineWidth(0.3);
    // doc.rect(page.m, y, boxW, boxH);

    // // Printed On
    // doc.setFontSize(8);
    // doc.setFont("helvetica", "bold");
    // doc.text("Printed On:", page.m + 3, y + 4);

    // doc.setFont("helvetica", "normal");
    // doc.text(printedOn, page.m + 22, y + 4);

    // // Printed By
    // doc.setFont("helvetica", "bold");
    // doc.text("Printed By:", page.m + 3, y + 8);

    // doc.setFont("helvetica", "normal");
    // doc.text(printedBy, page.m + 22, y + 8);

    // y += boxH + 6;

    // RIGHT LOGO + company details
    const rx = page.w - page.m - 75;

    // Logo
    try {
      doc.addImage(LOGO_RIGHT, "PNG", rx + 15, y, 8, 8);
    } catch (e) {

    }

    // Short company name aligned with logo
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);
    doc.text(companyShortName(companyName), rx + 25, y + 5.5);

    // Company name
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...c.text);
    doc.text(companyName, rx + 25, y + 10);

    // Company details
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...c.text);

    let ry = y + 13;
    companyAddress.forEach((l) => {
      doc.text(l, rx + 25, ry);
      ry += 3;
    });

    if (actualCompany?.website) doc.text(actualCompany.website, rx + 25, ry);

    // EXTRA GAP BELOW HEADER
    const extraGap = 6;

    // NTN / STRN lower
    doc.setFontSize(7);
    doc.text(
      `National Tax No: ${actualCompany?.ntn || "-"}`,
      page.m,
      page.m + 13 + extraGap
    );
    doc.text(
      `S.T.Registration No: ${actualCompany?.stRegNo || "-"}`,
      page.m,
      page.m + 18 + extraGap
    );

    // TITLE lower
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("SALES TAX INVOICE", page.w / 2, page.m + 17 + extraGap, {
      align: "center",
    });

    // return increased Y
    return page.m + 23 + extraGap;
  };

  // -----------------------------------------------------------------
  // Customer + Invoice Info Box
  // -----------------------------------------------------------------
  const drawInfoBox = (y) => {
    const startX = page.m;
    const boxW = page.w - 2 * page.m;

    const leftColW = boxW * 0.65;
    const rightColX = startX + leftColW + 4;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);

    // Wrap address to prevent overlapping
    const addrLines = doc.splitTextToSize(customer.address, 120);

    const otherLines = [
      customer.contact ? `Contact: ${customer.contact}` : "",
      `NTN No: ${customer.ntn}`,
      `ST NO: ${customer.strn}`,
    ].filter(Boolean);

    // Calculate dynamic height based on wrapped lines
    // customer name is 1 line: 4mm
    // addrLines & otherLines: 3.8mm per line
    // 5mm padding top, 2mm padding bottom
    const leftHeight = 5 + 4 + (addrLines.length * 3.8) + (otherLines.length * 3.8) + 2;
    const rightHeight = 32; // Default height for 8 lines of invoice details

    const boxH = Math.max(rightHeight, leftHeight);

    doc.setDrawColor(60, 60, 60);
    doc.rect(startX, y, boxW, boxH);

    // LEFT SIDE (Customer Info)
    let ly = y + 5;

    // Draw name on a single line as originally defined
    doc.text(customer.name.toUpperCase(), startX + 3, ly);
    ly += 4;

    addrLines.forEach((l) => {
      doc.text(l, startX + 3, ly);
      ly += 3.8;
    });

    otherLines.forEach((l) => {
      doc.text(l, startX + 3, ly);
      ly += 3.8;
    });

    // RIGHT SIDE (Invoice Details)
    const info = [
      ["Invoice No :", invoiceInfo.invoiceNo],
      ["Invoice Date :", invoiceInfo.invoiceDate],
      ["DN No :", invoiceInfo.dnNo],
      ["DN Date :", invoiceInfo.dnDate],
      ["Payment Terms:", invoiceInfo.paymentTerms],
      ["HSCode:", invoiceInfo.hsCode],
      ["Sales Order No :", invoiceInfo.salesOrderNo],
      ["Purchase Order No:", invoiceInfo.purchaseOrderNo],
    ];

    let ry = y + 5;
    const labelX = rightColX - 5;
    const valueX = labelX + 42;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8.5);

    info.forEach(([label, value]) => {
      doc.text(label, labelX, ry);
      doc.text(String(value ?? ""), valueX, ry);

      ry += 3.5;
    });

    return y + boxH + 4;
  };

  // -----------------------------------------------------------------
  // Table Header
  // -----------------------------------------------------------------
  const drawTableHeader = (y) => {
    const colW = [8, 51, 26, 9, 15, 15, 18, 11, 18, 21];
    const startX = page.m,
      headerH = 16,
      tableW = page.w - 2 * page.m;

    doc.setFillColor(...c.lightGray);
    doc.rect(startX, y, tableW, headerH, "F");

    doc.setDrawColor(60, 60, 60);
    doc.rect(startX, y, tableW, headerH);

    const heads = [
      "SR.\nNO",
      "ITEM CODE/\nITEM DESCRIPTION",
      "MATERIAL\nCODE",
      "UOM",
      "QUANTITY",
      "UNIT\nPRICE",
      "VALUE\n(Exc. Tax)",
      "SALES\nTAX %",
      "SALES TAX\nAMOUNT",
      "TOTAL VALUE\n(inc. S.Tax)",
    ];

    let x = startX;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);

    heads.forEach((h, i) => {
      const lines = h.split("\n");
      const lineHeight = doc.getLineHeight() * 0.4;
      const totalHeight = lines.length * lineHeight;
      const startY = y + headerH / 2 - totalHeight / 2 + lineHeight * 0.85;

      lines.forEach((line, j) => {
        const textY = startY + j * lineHeight;
        doc.text(line, x + colW[i] / 2, textY, { align: "center" });
      });

      if (i < heads.length - 1) {
        doc.line(x + colW[i], y, x + colW[i], y + headerH);
      }

      x += colW[i];
    });

    return y + headerH;
  };

  // -----------------------------------------------------------------
  // Table Row
  // -----------------------------------------------------------------
  const drawRow = (y, vals, alt) => {
    const colW = [8, 51, 26, 9, 15, 15, 18, 11, 18, 21];
    const startX = page.m;
    const tableW = page.w - 2 * page.m;
    const lineH = 4;

    // doc.setFont("helvetica", "normal");
    // doc.setFontSize(8);

    // --- calculate line heights per cell ---
    const lineCounts = vals.map((v, i) => {
      if (i === 2) doc.setFontSize(7);
      else doc.setFontSize(8);
      const maxWidth = colW[i] - 4;
      const lines = doc.splitTextToSize(v.toString(), maxWidth);
      return lines.length;
    });

    const rowH = Math.max(...lineCounts) * lineH + 2; // dynamic height

    // --- background ---
    if (alt) {
      doc.setFillColor(...c.lightGray);
      doc.rect(startX, y, tableW, rowH, "F");
    }

    // --- outer border ---
    doc.setDrawColor(...c.gray);
    doc.rect(startX, y, tableW, rowH);

    // --- draw text and vertical lines ---
    let x = startX;
    vals.forEach((v, i) => {
      if (i === 2) doc.setFontSize(7);
      else doc.setFontSize(8);

      const align = "center";
      const tx =
        align === "center"
          ? x + colW[i] / 2
          : align === "center"
            ? x + colW[i] - 2
            : x + 2;

      const maxWidth = colW[i] - 4;
      const lines = doc.splitTextToSize(v.toString(), maxWidth);

      lines.forEach((line, li) => {
        const ty = y + lineH * (li + 1);
        doc.text(line, tx, ty, { align });
      });

      if (i < vals.length - 1) doc.line(x + colW[i], y, x + colW[i], y + rowH);
      x += colW[i];
    });

    return y + rowH;
  };

  // -----------------------------------------------------------------
  // Totals Line
  // -----------------------------------------------------------------
  const drawTotalsLine = (y) => {
    const gap = 3;
    y += gap;

    const colW = [8, 51, 26, 9, 15, 15, 18, 11, 18, 21];
    const startX = page.m;
    const rowH = 8;
    const tableW = page.w - 2 * page.m;

    doc.setDrawColor(100, 100, 100);
    doc.rect(startX, y, tableW, rowH);

    // Draw vertical lines (starting after the first 4 columns)
    let lx = startX;
    for (let i = 0; i < colW.length - 1; i++) {
      lx += colW[i];
      if (i >= 3) {
        doc.line(lx, y, lx, y + rowH);
      }
    }

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.text("Total:", startX + 2, y + 5);

    let x = startX;
    for (let i = 0; i < 4; i++) x += colW[i];

    doc.text(totals.qty, x + colW[4] - 2, y + 5, { align: "right" });
    x += colW[4] + colW[5];

    doc.text(totals.exc, x + colW[6] - 2, y + 5, { align: "right" });
    x += colW[6] + colW[7];

    doc.text(totals.tax, x + colW[8] - 2, y + 5, { align: "right" });
    x += colW[8];

    doc.text(totals.inc, x + colW[9] - 2, y + 5, { align: "right" });

    return y + rowH + 9;
  };

  // -----------------------------------------------------------------
  // Total Bar
  // -----------------------------------------------------------------
  const drawTotalBar = (y) => {
    const barH = 11;
    const startX = page.m;
    const fullW = page.w - 2 * page.m;

    const rightW = fullW * 0.55;
    const leftW = fullW - rightW;

    doc.setFillColor(191, 191, 191);
    doc.rect(startX + leftW, y, rightW, barH, "F");

    doc.setDrawColor(0, 0, 0);
    doc.rect(startX + leftW, y, rightW, barH);
    doc.line(startX + leftW + 70, y, startX + leftW + 70, y + barH);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(13);

    doc.text(`Total Amount (${currencyCode})`, startX + leftW + 4, y + 7);
    doc.text(totals.inc, startX + leftW + rightW - 4, y + 7, {
      align: "right",
    });

    return y + barH;
  };

  // -----------------------------------------------------------------
  // Amount in Words
  // -----------------------------------------------------------------
  const toTitleCase = (str) => {
    return str.replace(/\b\w+(?:-\w+)*\b/g, (word) =>
      word
        .split("-")
        .map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
        .join("-")
    );
  };
 const drawWords = (y) => {
  const amount = parseFloat(totals.inc.replace(/,/g, "")) || 0;
  const rupees = Math.floor(amount);
  const paisa = Math.round((amount - rupees) * 100);

  let words = toWords(rupees);

  // Remove dashes/hyphens and commas
  words = words.replace(/-/g, " ").replace(/,/g, "");

  words = words ? toTitleCase(words) : "";

  const txt =
    paisa > 0
      ? `Rupees ${words} And ${paisa} Paisas Only.`
      : `Rupees ${words} Only.`; 

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text(txt, page.w - page.m - 5, y + 8, { align: "right" });

  return y + 2;
};
  // const drawWords = (y) => {
  //   const amount = parseFloat(totals.inc.replace(/,/g, "")) || 0;
  //   const rupees = Math.floor(amount);
  //   const paisa = Math.round((amount - rupees) * 100);

  //   const words = toWords(rupees);
  //   const txt = `Rupees ${words} And ${paisa} Paisas Only.`;

  //   doc.setFont("helvetica", "normal");
  //   doc.setFontSize(9);
  //   doc.text(txt, page.w - page.m - 5, y + 8, { align: "right" });

  //   return y + 2;
  // };

  // -----------------------------------------------------------------
  // Footer
  // -----------------------------------------------------------------
  const drawFooter = (y) => {
    const footY = page.h - 22;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text(companyName, page.w / 2, footY, {
      align: "center",
    });

    doc.setFont("helvetica", "italic");
    doc.setFontSize(7);
    doc.text(
      "This is system generated invoice and does not required signature",
      page.w / 2,
      footY + 5,
      { align: "center" }
    );

    doc.setFont("helvetica", "bold");
    doc.setTextColor(...c.red);
    doc.setFontSize(7);
    const itwh =
      "PLEASE DEDUCT ONLY 1% ITWH WITH REFERENCE TO OUR EXEMPTION LETTER #100000271624224";
    doc.text(itwh, page.w / 2, footY + 10, { align: "center" });
    doc.setTextColor(...c.text);
  };

  // -----------------------------------------------------------------
  // Render with Pagination
  // -----------------------------------------------------------------
  const render = () => {
    let curY = drawHeader();
    curY = drawInfoBox(curY);
    curY = drawTableHeader(curY);

    const rowsPerPage = Math.floor((page.h - curY - 55) / 7);
    let rendered = 0;

    rows.forEach((r, i) => {
      if (rendered >= rowsPerPage) {
        doc.addPage();
        curY = drawHeader();
        curY = drawInfoBox(curY);
        curY = drawTableHeader(curY);
        rendered = 0;
      }
      curY = drawRow(curY, r, i % 2 === 1);
      rendered++;
    });

    curY = drawTotalsLine(curY);
    curY = drawTotalBar(curY);
    curY = drawWords(curY);
    drawFooter(curY);
  };

  render();
  if (mode === "print") {
    doc.autoPrint();
    window.open(doc.output("bloburl"), "_blank");
  }
  return doc;
};
