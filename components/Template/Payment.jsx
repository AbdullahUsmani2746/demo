import { jsPDF } from "jspdf";
import { toWords } from "number-to-words";
import { stripPvtLtd } from "@/lib/companyName";
import { askOfficialPrint } from "@/lib/officialPrint";

export const generateVoucherPDF = async (
  voucher,
  companyData = null,
  currencyData = null,
  mode = "download",
) => {
  const { dated, tran_code, vr_no, user_id, rmk, transactions, acno, rmk1,tran_id, user, invoice_no } =
    voucher;

  // Modern color palette
  const colors = {
    primary: [41, 128, 185], // Professional blue
    secondary: [52, 73, 94], // Dark blue-gray
    accent: [231, 76, 60], // Elegant red
    success: [46, 204, 113], // Modern green
    light: [236, 240, 241], // Light gray
    lighter: [250, 252, 253], // Very light gray
    white: [255, 255, 255], // Pure white
    dark: [44, 62, 80], // Dark text
    border: [189, 195, 199], // Border gray
    headerBg: [248, 249, 250], // Header background
    alternateRow: [248, 249, 250], // Alternate row color
  };

  // Voucher type configuration
// Voucher type configuration
const voucherTypes = {
  1: {
    cash: {
      title: "CASH RECEIPT VOUCHER",
      color: colors.success,
      paidFromLabel: "Received At",
      totalLabel: "CASH RECEIPT TOTAL",
    },
    bank: {
      title: "BANK RECEIPT VOUCHER",
      color: colors.success,
      paidFromLabel: "Received In Bank",
      totalLabel: "BANK RECEIPT TOTAL",
    },
  },
  2: {
    cash: {
      title: "CASH PAYMENT VOUCHER",
      color: colors.accent,
      paidFromLabel: "Paid From",
      totalLabel: "CASH PAYMENT TOTAL",
    },
    bank: {
      title: "BANK PAYMENT VOUCHER",
      color: colors.accent,
      paidFromLabel: "Paid From Bank",
      totalLabel: "BANK PAYMENT TOTAL",
    },
  },
  3: {
    title: "JOURNAL VOUCHER",
    color: colors.primary,
    paidFromLabel: "Journal Entry",
    totalLabel: "JOURNAL TOTAL",
  },
};

 const rawCompanyName = companyData?.name || "N/A";
  const companyName = (await askOfficialPrint()) ? rawCompanyName : stripPvtLtd(rawCompanyName);

  // const currencySymbol = currencyData?.symbol || "N/A";
  const currencyCode = currencyData?.code || "N/A";

let voucherConfig;

// If Journal
if (tran_code === 3) {
  voucherConfig = voucherTypes[3];
} 
// If Payment or Receipt → Check account type. Cash and bank share one
// account group (Finance → Account Settings "Cash & Bank"), so nothing in the
// chart says which kind the account is: the caller may pass voucher.isBank;
// otherwise the cash wording is used.
else if (tran_code === 1 || tran_code === 2) {
  const isBank = voucher?.isBank === true;
  voucherConfig = isBank
    ? voucherTypes[tran_code].bank
    : voucherTypes[tran_code].cash;
}

  const headerValues = {
    date: dated ? new Date(dated).toLocaleDateString() : "",
    vrNo: String(vr_no) || "",
    trNo: String(tran_id).padStart(10, "0"),
    invoiceNo: invoice_no || "",
    user: user_id || "Default User",
    printedBy: user?.name || user_id || "N/A",
    printOn: new Date().toLocaleString(undefined, {
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }),
    paidFrom: acno?.acname || "",
    narration: tran_code === 3 ? rmk1 || " " : rmk || "",
  };

  // Process transactions based on type
  let lineEntries, deductionEntries, lineTotal, deductionTotal;

  if (tran_code === 3) {
    // Journal voucher - all transactions are line entries
    lineEntries = transactions || [];
    deductionEntries = [];
    lineTotal = lineEntries.reduce((sum, t) => sum + (t.damt || 0), 0);
    deductionTotal = 0;
  } else {
    // Payment/Receipt vouchers
    lineEntries = transactions.filter((t) => t.sub_tran_id === 1);
    deductionEntries = transactions.filter((t) => t.sub_tran_id === 2);
    lineTotal = lineEntries.reduce(
      (sum, t) => sum + (t.damt || t.camt || 0),
      0
    );
    deductionTotal = deductionEntries.reduce(
      (sum, t) => sum + (t.damt || t.camt || 0),
      0
    );
  }

  const showInvoiceCol = lineEntries.some((t) => t.invoice_no && String(t.invoice_no).trim() !== "");
  const showWhtCol = (tran_code === 1 || tran_code === 2) && lineEntries.some((t) => t.wht_rate !== undefined && t.wht_rate !== null && Number(t.wht_rate) > 0);
  const showChequeCol = (tran_code === 1 || tran_code === 2) && lineEntries.some((t) => t.chno && String(t.chno).trim() !== "");
  // Slip # of a receipt / payment line is stored in Transactions.narration5.
  const showSlipCol = (tran_code === 1 || tran_code === 2) && [...lineEntries, ...deductionEntries].some((t) => t.narration5 && String(t.narration5).trim() !== "");

  const formatEntries = (entries) =>
    entries.map((t) => ({
      acctNo: String(t.acno) || "",
      accountTitle: t.acnoDetails?.acname || "",
      amount: (t.damt || t.camt || 0).toLocaleString("en-PK", {
        minimumFractionDigits: 2,
      }),
      debit:
        tran_code === 3
          ? (t.damt || 0).toLocaleString("en-PK", {
              minimumFractionDigits: 2,
            })
          : "",
      credit:
        tran_code === 3
          ? (t.camt || 0).toLocaleString("en-PK", {
              minimumFractionDigits: 2,
            })
          : "",
      narration: t.narration || headerValues.narration || "",
      invoiceNo: t.invoice_no || "",
      whtRate: t.wht_rate !== undefined && t.wht_rate !== null && Number(t.wht_rate) > 0 ? `${t.wht_rate}%` : "",
      chequeNo: t.chno || "",
      slipNo: t.narration5 || "",
    }));

  const lineDisplayEntries = formatEntries(lineEntries);
  const deductionDisplayEntries = formatEntries(deductionEntries);

  const totalAmount = [...lineDisplayEntries, ...deductionDisplayEntries]
    .reduce((sum, e) => {
      const numeric = Number(e.amount.replace(/,/g, ""));
      return sum + (isNaN(numeric) ? 0 : numeric);
    }, 0);

  const amountInWordsText = `Rupees ${toWords(parseInt(totalAmount)).replace(
    /\b\w/g,
    (l) => l.toUpperCase()
  )} Only.`;

  // Page configuration
  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 12;

  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const drawModernHeader = (yPosition = margin) => {
    const companyHeight = 14;
    const titleHeight = 8;
    

    // Modern company header with gradient effect
    doc.setFillColor(...colors.headerBg);
    doc.rect(0, yPosition, pageWidth, companyHeight, "F");

    // Top accent line
    doc.setFillColor(...voucherConfig.color);
    doc.rect(0, yPosition, pageWidth, 2, "F");

    
    // Company name
    doc.setFont("helvetica", "bold");
    doc.setFontSize(18);
    doc.setTextColor(...colors.dark);
    doc.text(companyName, pageWidth / 2, yPosition + 9, {
      align: "center",
    });

    // Elegant subtitle
    // doc.setFont("helvetica", "normal");
    // doc.setFontSize(9);
    // doc.setTextColor(...colors.secondary);
    // doc.text(
    //   "Professional Accounting Solutions",
    //   pageWidth / 2,
    //   yPosition + 14,
    //   { align: "center" }
    // );

    // Modern voucher title section
    const titleY = yPosition + companyHeight + 2;
    doc.setFillColor(...voucherConfig.color);
    doc.rect(margin, titleY, pageWidth - 2 * margin, titleHeight, "F");

    // Rounded corners effect with white corners
    // doc.setFillColor(...colors.white);
    // doc.rect(margin, titleY, 2, 2, "F");
    // doc.rect(pageWidth - margin - 2, titleY, 2, 2, "F");

    doc.setTextColor(...colors.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(voucherConfig.title, pageWidth / 2, titleY + 5.5, {
      align: "center",
    });

    // Modern form section
    const formY = titleY + titleHeight + 3;
    const rowHeight = 6;
    const labelWidth = 20;
    const valueWidth = 35;

    // First row - Date and Voucher No
    doc.setFillColor(...colors.light);
    doc.setTextColor(...colors.dark);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);

    // Date section
    doc.rect(margin, formY, labelWidth, rowHeight, "F");
    doc.setLineWidth(0.3);
    doc.setDrawColor(...colors.border);
    doc.rect(margin, formY, labelWidth, rowHeight);
    doc.text("DATE", margin + labelWidth / 2, formY + 4, { align: "center" });

    doc.setFillColor(...colors.white);
    doc.rect(margin + labelWidth, formY, valueWidth, rowHeight, "F");
    doc.rect(margin + labelWidth, formY, valueWidth, rowHeight);
    doc.setFont("helvetica", "normal");
    doc.text(headerValues.date, margin + labelWidth + 2, formY + 4);

    // Voucher No section
    const vrX = pageWidth - margin - labelWidth - valueWidth;
    doc.setFillColor(...colors.light);
    doc.setFont("helvetica", "bold");
    doc.rect(vrX, formY, labelWidth, rowHeight, "F");
    doc.rect(vrX, formY, labelWidth, rowHeight);
    doc.text("VR NO", vrX + labelWidth / 2, formY + 4, { align: "center" });

    doc.setFillColor(...colors.white);
    doc.rect(vrX + labelWidth, formY, valueWidth, rowHeight, "F");
    doc.rect(vrX + labelWidth, formY, valueWidth, rowHeight);
    doc.setFont("helvetica", "normal");
    doc.text(headerValues.vrNo, vrX + labelWidth + 2, formY + 4);

    // Second row - Transaction details
    const row2Y = formY + rowHeight;

    // Transaction No
    doc.setFillColor(...colors.light);
    doc.setFont("helvetica", "bold");
    doc.rect(margin, row2Y, labelWidth, rowHeight, "F");
    doc.rect(margin, row2Y, labelWidth, rowHeight);
    doc.text("TR NO", margin + labelWidth / 2, row2Y + 4, { align: "center" });

    doc.setFillColor(...colors.white);
    doc.rect(margin + labelWidth, row2Y, valueWidth, rowHeight, "F");
    doc.rect(margin + labelWidth, row2Y, valueWidth, rowHeight);
    doc.setFont("helvetica", "normal");
    doc.text(headerValues.trNo, margin + labelWidth + 2, row2Y + 4);

    // User section
    const userX = margin + labelWidth + valueWidth + 10;
    const userValueWidth = 40; // Reduced from 46 to leave gap before PRINTED box
    doc.setFillColor(...colors.light);
    doc.setFont("helvetica", "bold");
    doc.rect(userX, row2Y, labelWidth, rowHeight, "F");
    doc.rect(userX, row2Y, labelWidth, rowHeight);
    doc.text("USER", userX + labelWidth / 2, row2Y + 4, { align: "center" });

    doc.setFillColor(...colors.white);
    doc.rect(userX + labelWidth, row2Y, userValueWidth, rowHeight, "F");
    doc.rect(userX + labelWidth, row2Y, userValueWidth, rowHeight);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(6.5);
    doc.text(headerValues.user, userX + labelWidth + 2, row2Y + 4);
    doc.setFontSize(8);

    // Print timestamp
    doc.setFillColor(...colors.light);
    doc.setFont("helvetica", "bold");
    doc.rect(vrX, row2Y, labelWidth, rowHeight, "F");
    doc.rect(vrX, row2Y, labelWidth, rowHeight);
    doc.text("PRINTED ON", vrX + labelWidth / 2, row2Y + 4, { align: "center" });

    doc.setFillColor(...colors.white);
    doc.rect(vrX + labelWidth, row2Y, valueWidth, rowHeight, "F");
    doc.rect(vrX + labelWidth, row2Y, valueWidth, rowHeight);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(headerValues.printOn, vrX + labelWidth + 2, row2Y + 4);

    // Printed By
    const printedByY = row2Y + rowHeight;
    doc.setFillColor(...colors.light);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.rect(vrX, printedByY, labelWidth, rowHeight, "F");
    doc.rect(vrX, printedByY, labelWidth, rowHeight);
    doc.text("PRINTED BY", vrX + labelWidth / 2, printedByY + 4, { align: "center" });

    doc.setFillColor(...colors.white);
    doc.rect(vrX + labelWidth, printedByY, valueWidth, rowHeight, "F");
    doc.rect(vrX + labelWidth, printedByY, valueWidth, rowHeight);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.text(headerValues.printedBy, vrX + labelWidth + 2, printedByY + 4);

    // Account section
    const accountY = row2Y + rowHeight;
    if (tran_code !== 3) {
      doc.setFillColor(...colors.light);
      doc.setFont("helvetica", "bold");
      doc.setFontSize(8);
      doc.rect(margin, accountY, labelWidth + 5, rowHeight, "F");
      doc.rect(margin, accountY, labelWidth + 5, rowHeight);
      doc.text(
        voucherConfig.paidFromLabel,
        margin + (labelWidth + 5) / 2,
        accountY + 4,
        { align: "center" }
      );

      doc.setFillColor(...colors.white);
      const accountValueWidth = pageWidth - 2 * margin - labelWidth - 5 - (labelWidth + valueWidth) - 2;
      doc.rect(
        margin + labelWidth + 5,
        accountY,
        accountValueWidth,
        rowHeight,
        "F"
      );
      doc.rect(margin + labelWidth + 5, accountY, accountValueWidth, rowHeight);
      doc.setFont("helvetica", "normal");
      doc.text(headerValues.paidFrom, margin + labelWidth + 7, accountY + 4);
    }

    let nextY = accountY + rowHeight;

    // Narration section
    const narrationY = nextY + 2;
    const narrationLabelWidth = pageWidth - 2 * margin;

    doc.setFillColor(...colors.light);
    doc.setFont("helvetica", "bold");
    doc.rect(margin, narrationY, narrationLabelWidth, rowHeight, "F");
    doc.rect(margin, narrationY, narrationLabelWidth, rowHeight);
    doc.text("NARRATION", pageWidth / 2, narrationY + 4, { align: "center" });

    doc.setFillColor(...colors.white);
    doc.rect(
      margin,
      narrationY + rowHeight,
      pageWidth - 2 * margin,
      rowHeight,
      "F"
    );
    doc.rect(margin, narrationY + rowHeight, pageWidth - 2 * margin, rowHeight);
    doc.setFont("helvetica", "normal");
    doc.text(headerValues.narration, margin + 2, narrationY + rowHeight + 4);

    return narrationY + 2 * rowHeight + 4;
  };

  const drawModernTableHeader = (yPosition) => {
    const headerHeight = 8;

    // Modern table header with gradient
    doc.setFillColor(...colors.secondary);
    doc.rect(margin, yPosition, pageWidth - 2 * margin, headerHeight, "F");

    doc.setTextColor(...colors.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);

    if (tran_code === 3) {
      // Journal voucher columns
      const col1Width = 25;
      const colInvWidth = showInvoiceCol ? 30 : 0;
      const col4Width = 35;
      const col5Width = 35;
      const col2Width = (pageWidth - 2 * margin) - col1Width - colInvWidth - col4Width - col5Width;

      doc.text("CODE", margin + col1Width / 2, yPosition + 5, {
        align: "center",
      });
      doc.text(
        "ACCOUNT TITLE",
        margin + col1Width + col2Width / 2,
        yPosition + 5,
        { align: "center" }
      );
      if (showInvoiceCol) {
        doc.text(
          "INVOICE NO",
          margin + col1Width + col2Width + colInvWidth / 2,
          yPosition + 5,
          { align: "center" }
        );
      }
      doc.text(
        "DEBIT",
        margin + col1Width + col2Width + colInvWidth + col4Width / 2,
        yPosition + 5,
        { align: "center" }
      );
      doc.text(
        "CREDIT",
        margin + col1Width + col2Width + colInvWidth + col4Width + col5Width / 2,
        yPosition + 5,
        { align: "center" }
      );

      // Column dividers
      doc.setDrawColor(...colors.white);
      doc.setLineWidth(0.5);
      doc.line(
        margin + col1Width,
        yPosition,
        margin + col1Width,
        yPosition + headerHeight
      );
      doc.line(
        margin + col1Width + col2Width,
        yPosition,
        margin + col1Width + col2Width,
        yPosition + headerHeight
      );
      if (showInvoiceCol) {
        doc.line(
          margin + col1Width + col2Width + colInvWidth,
          yPosition,
          margin + col1Width + col2Width + colInvWidth,
          yPosition + headerHeight
        );
      }
      doc.line(
        margin + col1Width + col2Width + colInvWidth + col4Width,
        yPosition,
        margin + col1Width + col2Width + colInvWidth + col4Width,
        yPosition + headerHeight
      );
    } else {
      // Payment/Receipt voucher columns
      const totalTableWidth = pageWidth - 2 * margin; // 186
      const col1Width = 25; // ACCOUNT NO
      const col3Width = 41; // AMOUNT
      let colInvoiceWidth = 0;
      let colWhtWidth = 0;
      let colChequeWidth = 0;

      if (showInvoiceCol) colInvoiceWidth = 25;
      if (showWhtCol) colWhtWidth = 20;
      if (showChequeCol) colChequeWidth = 25;
      const colSlipWidth = showSlipCol ? 22 : 0;

      const col2Width = totalTableWidth - col1Width - col3Width - colInvoiceWidth - colWhtWidth - colChequeWidth - colSlipWidth;

      const col1X = margin;
      const col2X = col1X + col1Width;
      const colInvoiceX = col2X + col2Width;
      const colWhtX = colInvoiceX + colInvoiceWidth;
      const colChequeX = colWhtX + colWhtWidth;
      const colSlipX = colChequeX + colChequeWidth;
      const colAmountX = colSlipX + colSlipWidth;

      doc.text("ACCOUNT NO", col1X + col1Width / 2, yPosition + 5, {
        align: "center",
      });
      doc.text("ACCOUNT TITLE", col2X + col2Width / 2, yPosition + 5, {
        align: "center",
      });
      if (showInvoiceCol) {
        doc.text("INVOICE NO", colInvoiceX + colInvoiceWidth / 2, yPosition + 5, {
          align: "center",
        });
      }
      if (showWhtCol) {
        doc.text("WHT RATE", colWhtX + colWhtWidth / 2, yPosition + 5, {
          align: "center",
        });
      }
      if (showChequeCol) {
        doc.text("CHEQUE NO", colChequeX + colChequeWidth / 2, yPosition + 5, {
          align: "center",
        });
      }
      if (showSlipCol) {
        doc.text("SLIP #", colSlipX + colSlipWidth / 2, yPosition + 5, {
          align: "center",
        });
      }
      doc.text("AMOUNT", colAmountX + col3Width / 2, yPosition + 5, {
        align: "center",
      });

      // Column dividers
      doc.setDrawColor(...colors.white);
      doc.setLineWidth(0.5);
      doc.line(col2X, yPosition, col2X, yPosition + headerHeight);
      doc.line(colInvoiceX, yPosition, colInvoiceX, yPosition + headerHeight);
      if (showInvoiceCol) {
        doc.line(colWhtX, yPosition, colWhtX, yPosition + headerHeight);
      }
      if (showWhtCol) {
        doc.line(colChequeX, yPosition, colChequeX, yPosition + headerHeight);
      }
      if (showChequeCol) {
        doc.line(colSlipX, yPosition, colSlipX, yPosition + headerHeight);
      }
      if (showSlipCol) {
        doc.line(colAmountX, yPosition, colAmountX, yPosition + headerHeight);
      }
    }

    return yPosition + headerHeight;
  };

  const drawModernTableRow = (
    entry,
    yPosition,
    isAlternate = false,
    rowHeight = 6
  ) => {
    // Alternate row coloring
    if (isAlternate) {
      doc.setFillColor(...colors.alternateRow);
      doc.rect(margin, yPosition, pageWidth - 2 * margin, rowHeight, "F");
    }

    // Row border
    doc.setDrawColor(...colors.border);
    doc.setLineWidth(0.2);
    doc.rect(margin, yPosition, pageWidth - 2 * margin, rowHeight);

    doc.setTextColor(...colors.dark);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);

    if (tran_code === 3) {
      // Journal voucher row
      const col1Width = 25;
      const colInvWidth = showInvoiceCol ? 30 : 0;
      const col4Width = 35;
      const col5Width = 35;
      const col2Width = (pageWidth - 2 * margin) - col1Width - colInvWidth - col4Width - col5Width;

      // Dynamic row height based on how many lines account title wraps to
      const accountText = doc.splitTextToSize(entry.accountTitle, col2Width - 4);
      const lineH = 3.5; // mm per line at fontSize 8
      const dynamicRowHeight = Math.max(rowHeight, 2 + accountText.length * lineH + 2);

      // Redraw row border with correct height
      doc.setDrawColor(...colors.border);
      doc.setLineWidth(0.2);
      if (isAlternate) {
        doc.setFillColor(...colors.alternateRow);
        doc.rect(margin, yPosition, pageWidth - 2 * margin, dynamicRowHeight, "F");
      } else {
        doc.setFillColor(...colors.white);
        doc.rect(margin, yPosition, pageWidth - 2 * margin, dynamicRowHeight, "F");
      }
      doc.rect(margin, yPosition, pageWidth - 2 * margin, dynamicRowHeight);

      doc.setTextColor(...colors.dark);
      doc.setFont("helvetica", "normal");
      doc.setFontSize(8);

      doc.text(entry.acctNo, margin + 2, yPosition + 4);

      // Account title with text wrapping
      doc.text(accountText, margin + col1Width + 2, yPosition + 4);

      // Invoice No
      if (showInvoiceCol) {
        doc.text(entry.invoiceNo || "", margin + col1Width + col2Width + 2, yPosition + 4);
      }

      // Debit amount
      if (entry.debit && entry.debit !== "0.00") {
        doc.text(
          entry.debit,
          margin + col1Width + col2Width + colInvWidth + col4Width - 2,
          yPosition + 4,
          { align: "right" }
        );
      }

      // Credit amount
      if (entry.credit && entry.credit !== "0.00") {
        doc.text(
          entry.credit,
          margin + col1Width + col2Width + colInvWidth + col4Width + col5Width - 2,
          yPosition + 4,
          { align: "right" }
        );
      }

      // Column dividers
      doc.setDrawColor(...colors.border);
      doc.line(
        margin + col1Width,
        yPosition,
        margin + col1Width,
        yPosition + dynamicRowHeight
      );
      doc.line(
        margin + col1Width + col2Width,
        yPosition,
        margin + col1Width + col2Width,
        yPosition + dynamicRowHeight
      );
      if (showInvoiceCol) {
        doc.line(
          margin + col1Width + col2Width + colInvWidth,
          yPosition,
          margin + col1Width + col2Width + colInvWidth,
          yPosition + dynamicRowHeight
        );
      }
      doc.line(
        margin + col1Width + col2Width + colInvWidth + col4Width,
        yPosition,
        margin + col1Width + col2Width + colInvWidth + col4Width,
        yPosition + dynamicRowHeight
      );

      return yPosition + dynamicRowHeight;
    } else {
      // Payment/Receipt voucher row - dynamic columns
      const totalTableWidth = pageWidth - 2 * margin;
      const col1Width = 25;
      const col3Width = 41;
      let colInvoiceWidth = 0;
      let colWhtWidth = 0;
      let colChequeWidth = 0;

      if (showInvoiceCol) colInvoiceWidth = 25;
      if (showWhtCol) colWhtWidth = 20;
      if (showChequeCol) colChequeWidth = 25;
      const colSlipWidth = showSlipCol ? 22 : 0;

      const col2Width = totalTableWidth - col1Width - col3Width - colInvoiceWidth - colWhtWidth - colChequeWidth - colSlipWidth;

      const col1X = margin;
      const col2X = col1X + col1Width;
      const colInvoiceX = col2X + col2Width;
      const colWhtX = colInvoiceX + colInvoiceWidth;
      const colChequeX = colWhtX + colWhtWidth;
      const colSlipX = colChequeX + colChequeWidth;
      const colAmountX = colSlipX + colSlipWidth;

      // Account No
      doc.text(entry.acctNo, col1X + 2, yPosition + 4);

      // Account title with text wrapping
      const accountText = doc.splitTextToSize(entry.accountTitle, col2Width - 4);
      doc.text(accountText, col2X + 2, yPosition + 4);

      // Invoice No
      if (showInvoiceCol) {
        doc.text(entry.invoiceNo || "", colInvoiceX + 2, yPosition + 4);
      }

      // WHT Rate
      if (showWhtCol) {
        doc.text(entry.whtRate || "", colWhtX + colWhtWidth - 2, yPosition + 4, { align: "right" });
      }

      // Cheque No
      if (showChequeCol) {
        doc.text(entry.chequeNo || "", colChequeX + 2, yPosition + 4);
      }

      // Slip #
      if (showSlipCol) {
        doc.text(doc.splitTextToSize(entry.slipNo || "", colSlipWidth - 3)[0] || "", colSlipX + 2, yPosition + 4);
      }

      // Amount
      doc.text(
        entry.amount,
        colAmountX + col3Width - 2,
        yPosition + 4,
        { align: "right" }
      );

      // Column dividers
      doc.setDrawColor(...colors.border);
      doc.line(col2X, yPosition, col2X, yPosition + rowHeight);
      doc.line(colInvoiceX, yPosition, colInvoiceX, yPosition + rowHeight);
      if (showInvoiceCol) {
        doc.line(colWhtX, yPosition, colWhtX, yPosition + rowHeight);
      }
      if (showWhtCol) {
        doc.line(colChequeX, yPosition, colChequeX, yPosition + rowHeight);
      }
      if (showChequeCol) {
        doc.line(colSlipX, yPosition, colSlipX, yPosition + rowHeight);
      }
      if (showSlipCol) {
        doc.line(colAmountX, yPosition, colAmountX, yPosition + rowHeight);
      }

    }

    return yPosition + rowHeight;
  };

  const drawModernSectionTotal = (yPosition, label, totalValue) => {
    const totalHeight = 7;
    const labelWidth = tran_code === 3 ? 150 : 145;
    const amountWidth = tran_code === 3 ? 40 : 41;

    doc.setFillColor(...colors.light);
    doc.rect(margin, yPosition, labelWidth, totalHeight, "F");
    doc.rect(margin, yPosition, labelWidth, totalHeight);

    doc.setFillColor(...colors.light);
    doc.rect(margin + labelWidth, yPosition, amountWidth, totalHeight, "F");
    doc.rect(margin + labelWidth, yPosition, amountWidth, totalHeight);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...colors.dark);
    doc.text(label + ":", margin + labelWidth - 5, yPosition + 4.5, {
      align: "right",
    });
    doc.text(
      totalValue.toLocaleString("en-PK", { minimumFractionDigits: 2 }),
      margin + labelWidth + amountWidth - 2,
      yPosition + 4.5,
      { align: "right" }
    );

    return yPosition + totalHeight;
  };

  const drawModernTotal = (yPosition) => {
    yPosition += 5;
    const totalHeight = 8;
    const labelWidth = tran_code === 3 ? 115 : 145;
    const amountWidth = tran_code === 3 ? 71 : 41;

    // Modern total section with accent color
    doc.setFillColor(...voucherConfig.color);
    doc.rect(margin, yPosition, labelWidth, totalHeight, "F");
    doc.rect(margin, yPosition, labelWidth, totalHeight);

    doc.setFillColor(...voucherConfig.color);
    doc.rect(margin + labelWidth, yPosition, amountWidth, totalHeight, "F");
    doc.rect(margin + labelWidth, yPosition, amountWidth, totalHeight);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(...colors.white);
    doc.text("TOTAL AMOUNT:", margin + labelWidth - 5, yPosition + 5, {
      align: "right",
    });
    doc.text(
      `${totalAmount.toLocaleString("en-US")} ${currencyCode}`,
      margin + labelWidth + amountWidth - 2,
      yPosition + 5,
      { align: "right" }
    );

    return yPosition + totalHeight;
  };

  const drawModernAmountInWords = (yPosition) => {
    yPosition += 3;
    const boxHeight = 10;

    // Modern amount in words section
    doc.setFillColor(...colors.headerBg);
    doc.rect(margin, yPosition, pageWidth - 2 * margin, boxHeight, "F");
    doc.setLineWidth(0.3);
    doc.setDrawColor(...colors.border);
    doc.rect(margin, yPosition, pageWidth - 2 * margin, boxHeight);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...colors.dark);
    doc.text("AMOUNT IN WORDS:", margin + 2, yPosition + 4.5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.text(amountInWordsText, margin + 2, yPosition + 8);

    return yPosition + boxHeight;
  };

  const drawModernFooter = (yPosition) => {
    yPosition += 15;
    const signatureY = yPosition + 20;
    const lineY = signatureY - 5;
    const lineWidth = 40;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...colors.dark);

    // Modern signature sections
    const signatures = [
      { label: "PREPARED BY", x: margin + 25 },
      { label: "APPROVED BY", x: pageWidth / 2 },
      { label: "RECEIVED BY", x: pageWidth - margin - 25 },
    ];

    signatures.forEach((sig) => {
      // Signature line
      doc.setDrawColor(...colors.border);
      doc.setLineWidth(0.5);
      doc.line(sig.x - lineWidth / 2, lineY, sig.x + lineWidth / 2, lineY);

      // Label
      doc.text(sig.label, sig.x, signatureY, { align: "center" });
    });
  };

  // === Begin PDF Rendering ===
  let currentY = drawModernHeader();
  currentY = drawModernTableHeader(currentY);

  let rowCount = 0;

  // Render main entries
  lineDisplayEntries.forEach((entry) => {
    if (currentY > pageHeight - 60) {
      doc.addPage();
      currentY = drawModernHeader();
      currentY = drawModernTableHeader(currentY);
      rowCount = 0;
    }
    currentY = drawModernTableRow(entry, currentY, rowCount % 2 === 1);
    rowCount++;
  });

  // Add section total for non-journal vouchers
  if (tran_code !== 3) {
    currentY = drawModernSectionTotal(
      currentY,
      voucherConfig.totalLabel,
      lineTotal
    );

    // Render deduction entries if any
    if (deductionDisplayEntries.length > 0) {
      currentY += 3.5;
      doc.setFont("helvetica", "bold");
      doc.setFontSize(9);
      doc.setTextColor(...(tran_code === 1 ? colors.success : colors.accent));
      doc.text("DEDUCTIONS", margin, currentY);
      currentY += 2;

      deductionDisplayEntries.forEach((entry) => {
        if (currentY > pageHeight - 60) {
          doc.addPage();
          currentY = drawModernHeader();
          currentY = drawModernTableHeader(currentY);
          rowCount = 0;
        }
        currentY = drawModernTableRow(entry, currentY, rowCount % 2 === 1);
        rowCount++;
      });

      currentY = drawModernSectionTotal(
        currentY,
        "DEDUCTION TOTAL",
        deductionTotal
      );
    }
  }

  // 1. Draw Total and Amount in Words first
currentY = drawModernTotal(currentY);
currentY = drawModernAmountInWords(currentY);

// 2. Ensure footer is aligned to bottom by pushing it if needed
const footerStartY = 252; // Adjust to where footer should start on A4 (297mm) page

if (currentY < footerStartY) {
  currentY = footerStartY;
}

// 3. Now draw footer at the adjusted position
drawModernFooter(currentY);


  if (mode === "print") {
    doc.autoPrint();
    window.open(doc.output("bloburl"), "_blank");
  }
  return doc;
};
