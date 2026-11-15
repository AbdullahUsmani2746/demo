import { jsPDF } from "jspdf";

export const generateTransferPDF = async (
  transferData,
  session = null,
  currency = null,
  company = null,
) => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  // --- Colors ---
  const c = {
    maroon: [128, 0, 32],
    darkGray: [64, 64, 64],
    lightGray: [230, 230, 230],
    border: [150, 150, 150],
    black: [0, 0, 0],
    white: [255, 255, 255],
  };

  // --- Page setup ---
  const page = { w: 210, h: 297, m: 10 };

  const items =
    transferData.transactions?.map((transaction) => ({
      code: transaction.itcd?.toString() || "N/A",
      desc: transaction.itemDetails?.item || "Unknown Item",
      qty: transaction.qty?.toString() || "0",
    })) || [];

  // --- Format data from transferData ---
  const data = {
    date: transferData.dated
      ? new Date(transferData.dated).toLocaleDateString("en-GB") +
        " " +
        new Date(transferData.dated).toLocaleTimeString()
      : new Date().toLocaleDateString("en-GB"),
    fromGodown: transferData.godownDetails?.godown || "N/A",
    toGodown: transferData.godown2Details?.godown || "N/A",
    requisitionNo: transferData.req_no?.toString() || "N/A", // Transfer No removed
    narration: transferData.rmk || "",
    transferNo: transferData.tran_id?.toString() || "N/A",
    user: transferData.user.name || "System",
    printedBy: session?.user?.name || "N/A",
    printedOn:
      new Date().toLocaleDateString("en-GB") +
      " " +
      new Date().toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    items: items,
  };

  const totalQty = data.items.reduce((s, i) => s + parseInt(i.qty || 0), 0);

  // --- Company Header ---
  const drawHeader = (y) => {
    const h = 12;
    doc.setFillColor(...c.maroon);
    doc.rect(page.m, y, page.w - 2 * page.m, h, "F");
    doc.setTextColor(...c.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(company?.name || "Company Name", page.w / 2, y + 8, {
      align: "center",
    });
    return y + h + 2;
  };

  // --- Title Bar ---
  const drawTitle = (y) => {
    const h = 10;
    doc.setFillColor(...c.darkGray);
    doc.rect(page.m, y, page.w - 2 * page.m, h, "F");
    doc.setTextColor(...c.white);
    doc.setFontSize(12);
    doc.text("MATERIAL TRANSFER NOTE", page.w / 2, y + 7, { align: "center" });
    return y + h;
  };

  // --- Info Table ---
  const drawInfo = (y) => {
    const rowH = 8;
    const tableWidth = page.w - 2 * page.m;
    const startX = page.m;

    const leftLabelW = 35;
    const leftValueW = 55;
    const rightLabelW = 35;
    const rightValueW = 55;

    doc.setFontSize(9);
    doc.setLineWidth(0.3);
    doc.setDrawColor(...c.border);
    doc.setTextColor(...c.black);

    const leftStartX = startX;
    const rightStartX = startX + leftLabelW + leftValueW + 10;

    // Row 1: Printed On (Full width)
    let yPos = y;
    let x = leftStartX;
    doc.setFont("helvetica", "bold");
    doc.setFillColor(...c.lightGray);
    doc.rect(x, yPos, leftLabelW, rowH, "FD");
    doc.text("Printed On", x + leftLabelW / 2, yPos + 5.5, { align: "center" });

    x += leftLabelW;
    doc.setFont("helvetica", "normal");
    doc.setFillColor(...c.white);
    doc.rect(x, yPos, tableWidth - leftLabelW, rowH, "FD");
    doc.text(
      data.printedOn || "-",
      x + (tableWidth - leftLabelW) / 2,
      yPos + 5.5,
      {
        align: "center",
      },
    );

    yPos += rowH;

    // Row 2: Date (Left) / Requisition No (Right)
    // Row 2: Date / Transfer No / Requisition No
    x = leftStartX;

    // Column widths
    const colLabelW = 25;
    const colValueW = 35;
    const gap = 10;

    // ---------------- DATE ----------------
    doc.setFont("helvetica", "bold");
    doc.setFillColor(...c.lightGray);
    doc.rect(x, yPos, colLabelW, rowH, "FD");
    doc.text("Date", x + colLabelW / 2, yPos + 5.5, { align: "center" });

    x += colLabelW;
    doc.setFont("helvetica", "normal");
    doc.setFillColor(...c.white);
    doc.rect(x, yPos, colValueW, rowH, "FD");
    doc.text(data.date || "-", x + colValueW / 2, yPos + 5.5, {
      align: "center",
    });

    x += colValueW + gap;

    // ---------------- TRANSFER NO ----------------
    doc.setFont("helvetica", "bold");
    doc.setFillColor(...c.lightGray);
    doc.rect(x, yPos, colLabelW, rowH, "FD");
    doc.text("Transfer No", x + colLabelW / 2, yPos + 5.5, {
      align: "center",
    });

    x += colLabelW;
    doc.setFont("helvetica", "normal");
    doc.setFillColor(...c.white);
    doc.rect(x, yPos, colValueW, rowH, "FD");
    doc.text(data.transferNo || "-", x + colValueW / 2, yPos + 5.5, {
      align: "center",
    });

    x += colValueW + gap;

    // ---------------- REQUISITION NO ----------------
    doc.setFont("helvetica", "bold");
    doc.setFillColor(...c.lightGray);
    doc.rect(x, yPos, colLabelW, rowH, "FD");
    doc.text("Requisition No", x + colLabelW / 2, yPos + 5.5, {
      align: "center",
    });

    x += colLabelW;
    doc.setFont("helvetica", "normal");
    doc.setFillColor(...c.white);
    doc.rect(x, yPos, colValueW, rowH, "FD");
    doc.text(data.requisitionNo || "-", x + colValueW / 2, yPos + 5.5, {
      align: "center",
    });

    yPos += rowH;

    // Row 3: From Godown (Left) / To Godown (Right)
    x = leftStartX;
    doc.setFont("helvetica", "bold");
    doc.setFillColor(...c.lightGray);
    doc.rect(x, yPos, leftLabelW, rowH, "FD");
    doc.text("From Godown", x + leftLabelW / 2, yPos + 5.5, {
      align: "center",
    });

    x += leftLabelW;
    doc.setFont("helvetica", "normal");
    doc.setFillColor(...c.white);
    doc.rect(x, yPos, leftValueW, rowH, "FD");
    doc.text(data.fromGodown || "-", x + leftValueW / 2, yPos + 5.5, {
      align: "center",
    });

    x = rightStartX;
    doc.setFont("helvetica", "bold");
    doc.setFillColor(...c.lightGray);
    doc.rect(x, yPos, rightLabelW, rowH, "FD");
    doc.text("To Godown", x + rightLabelW / 2, yPos + 5.5, { align: "center" });

    x += rightLabelW;
    doc.setFont("helvetica", "normal");
    doc.setFillColor(...c.white);
    doc.rect(x, yPos, rightValueW, rowH, "FD");
    doc.text(data.toGodown || "-", x + rightValueW / 2, yPos + 5.5, {
      align: "center",
    });

    yPos += rowH;

    // Row 4: User (Left) / Narration (Right)
    x = leftStartX;
    doc.setFont("helvetica", "bold");
    doc.setFillColor(...c.lightGray);
    doc.rect(x, yPos, leftLabelW, rowH, "FD");
    doc.text("User", x + leftLabelW / 2, yPos + 5.5, { align: "center" });

    x += leftLabelW;
    doc.setFont("helvetica", "normal");
    doc.setFillColor(...c.white);
    doc.rect(x, yPos, leftValueW, rowH, "FD");
    doc.text(data.user || "-", x + leftValueW / 2, yPos + 5.5, {
      align: "center",
    });

    x = rightStartX;
    doc.setFont("helvetica", "bold");
    doc.setFillColor(...c.lightGray);
    doc.rect(x, yPos, rightLabelW, rowH, "FD");
    doc.text("Narration", x + rightLabelW / 2, yPos + 5.5, { align: "center" });

    x += rightLabelW;
    doc.setFont("helvetica", "normal");
    doc.setFillColor(...c.white);
    doc.rect(x, yPos, rightValueW, rowH, "FD");
    const narrationText =
      data.narration.length > 20
        ? data.narration.substring(0, 20) + "..."
        : data.narration;
    doc.text(narrationText || "-", x + rightValueW / 2, yPos + 5.5, {
      align: "center",
    });

    yPos += rowH;

    // Row 5: Printed By (Full width)
    x = leftStartX;
    doc.setFont("helvetica", "bold");
    doc.setFillColor(...c.lightGray);
    doc.rect(x, yPos, leftLabelW, rowH, "FD");
    doc.text("Printed By", x + leftLabelW / 2, yPos + 5.5, { align: "center" });

    x += leftLabelW;
    doc.setFont("helvetica", "normal");
    doc.setFillColor(...c.white);
    doc.rect(x, yPos, tableWidth - leftLabelW, rowH, "FD");
    doc.text(
      data.printedBy || "-",
      x + (tableWidth - leftLabelW) / 2,
      yPos + 5.5,
      {
        align: "center",
      },
    );

    return yPos + rowH + 2;
  };

  // --- Table Header ---
  const drawTableHeader = (y) => {
    const colW = [40, 110, 40]; // 3 columns only
    const headers = ["Material Code", "Material Description", "Qty"]; // Updated headers
    const startX = page.m;
    const rh = 8;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...c.black);
    doc.setDrawColor(...c.border);

    let x = startX;
    headers.forEach((h, i) => {
      doc.setFillColor(...c.lightGray);
      doc.rect(x, y, colW[i], rh, "F");
      doc.rect(x, y, colW[i], rh, "S");
      doc.text(h, x + colW[i] / 2, y + 5, { align: "center" });
      x += colW[i];
    });

    return y + rh;
  };

  // --- Table Rows ---
  const drawItem = (y, item) => {
    const colW = [40, 110, 40]; // 3 columns only
    const vals = [item.code, item.desc, item.qty]; // Only 3 values
    const rh = 8;
    let x = page.m;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    vals.forEach((v, i) => {
      doc.rect(x, y, colW[i], rh);
      if (i === 1) {
        // Material Description - left aligned with padding
        doc.text(v, x + 2, y + 5);
      } else {
        // Material Code and Qty - centered
        doc.text(v, x + colW[i] / 2, y + 5, { align: "center" });
      }
      x += colW[i];
    });
    return y + rh;
  };

  // --- Total Row ---
  const drawTotal = (y) => {
    const colW = [40, 110, 40]; // 3 columns only
    const rh = 8;
    let x = page.m;

    // Total label spans first two columns
    doc.rect(x, y, colW[0] + colW[1], rh);
    doc.setFont("helvetica", "bold");
    doc.text("Total:", x + colW[0] + colW[1] - 3, y + 5, { align: "right" });

    x += colW[0] + colW[1];
    // Total qty in third column
    doc.rect(x, y, colW[2], rh);
    doc.text(`${totalQty.toString()}`, x + colW[2] / 2, y + 5, {
      align: "center",
    });

    return y + rh;
  };

  // --- Signatures ---
  const drawSignatures = (y) => {
    const signatureWidth = 50;
    const spacing = (page.w - 2 * page.m - 3 * signatureWidth) / 2;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);

    // Transferred By signature
    doc.text("Transferred By", page.m, y);
    doc.line(page.m, y + 2, page.m + signatureWidth, y + 2);

    // Approved By signature (centered)
    doc.text("Approved By", page.m + signatureWidth + spacing, y);
    doc.line(
      page.m + signatureWidth + spacing,
      y + 2,
      page.m + signatureWidth + spacing + signatureWidth,
      y + 2,
    );

    // Received By signature
    doc.text("Received By", page.w - page.m - signatureWidth, y);
    doc.line(page.w - page.m - signatureWidth, y + 2, page.w - page.m, y + 2);
  };

  // --- Footer ---
  const drawFooter = (y) => {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(...c.darkGray);
    doc.text(
      `${company?.name || "Company"} - MATERIAL TRANSFER NOTE`,
      page.w / 2,
      y,
      { align: "center" },
    );
  };

  // --- Add New Page ---
  const addNewPage = () => {
    doc.addPage();
    let y = page.m;
    y = drawHeader(y);
    y = drawTitle(y);
    return y;
  };

  // --- Render PDF with Multi-page Support ---
  let y = page.m;
  y = drawHeader(y);
  y = drawTitle(y);
  y = drawInfo(y + 3);
  y = drawTableHeader(y + 3);

  const itemHeight = 8;
  const spaceForSignatures = 30;
  const spaceForFooter = 10;
  const maxItemsPerPage = Math.floor(
    (page.h - y - spaceForSignatures - spaceForFooter) / itemHeight,
  );

  let pageStartIndex = 0;
  let currentPage = 1;

  while (pageStartIndex < data.items.length) {
    const pageEndIndex = Math.min(
      pageStartIndex + maxItemsPerPage,
      data.items.length,
    );

    for (let i = pageStartIndex; i < pageEndIndex; i++) {
      y = drawItem(y, data.items[i]);
    }

    // Draw footer for current page
    drawSignatures(page.h - page.m - 25);
    drawFooter(page.h - page.m);

    if (pageEndIndex < data.items.length) {
      y = addNewPage();
      y = drawTableHeader(y + 3);
      pageStartIndex = pageEndIndex;
      currentPage++;
    } else {
      y = drawTotal(y);
      break;
    }
  }

  if (data.items.length === 0) {
    y = drawTotal(y);
    drawSignatures(page.h - page.m - 100);
    drawFooter(page.h - page.m);
  }

  
  return doc;
};
