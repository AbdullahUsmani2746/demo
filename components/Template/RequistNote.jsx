// import { jsPDF } from "jspdf";

// export const generateRequisitionNotePDF = async (
//   requisitionData,
//   session = null,
//   company,
//   currency
// ) => {
//   const doc = new jsPDF({ unit: "mm", format: "a4" });

//   // --- Colors ---
//   const c = {
//     maroon: [128, 0, 32],
//     darkGray: [64, 64, 64],
//     lightGray: [230, 230, 230],
//     border: [150, 150, 150],
//     black: [0, 0, 0],
//     white: [255, 255, 255],
//   };

//   // --- Page setup ---
//   const page = { w: 210, h: 297, m: 10 };

//   const narration =
//     requisitionData.rmk ||
//     requisitionData.narration ||
//     requisitionData.remarks ||
//     "";

//   // --- Format data from requisitionData ---
//   const data = {
//     date: requisitionData.dated
//       ? new Date(requisitionData.dated).toLocaleDateString("en-GB") +
//         " " +
//         new Date(requisitionData.dated).toLocaleTimeString()
//       : new Date().toLocaleDateString("en-GB"),
//     issuedBy: requisitionData.godown2Details?.godown || "N/A",
//     requisitionNo: requisitionData.tran_id?.toString() || "N/A",
//     issuedFor: requisitionData.godownDetails?.godown || "N/A",
//     user: requisitionData.userid || "N/A",
//     printedBy: session?.user?.name || "N/A",
//     printedOn:
//       new Date().toLocaleDateString("en-GB") +
//       " " +
//       new Date().toLocaleTimeString("en-GB", {
//         hour: "2-digit",
//         minute: "2-digit",
//         second: "2-digit",
//       }),
//     items:
//       requisitionData.details?.map((detail) => ({
//         code: detail.itcd?.toString() || "N/A",
//         desc: detail.item?.item || "Unknown Item",
//         qty: detail.qty?.toString() || "0",
//       })) || [],
//   };

//   const totalQty = data.items.reduce((s, i) => s + parseInt(i.qty || 0), 0);

//   // --- Company Header ---
//   const drawHeader = (y) => {
//     const h = 12;
//     doc.setFillColor(...c.maroon);
//     doc.rect(page.m, y, page.w - 2 * page.m, h, "F");
//     doc.setTextColor(...c.white);
//     doc.setFont("helvetica", "bold");
//     doc.setFontSize(16);
//     doc.text(company?.name, page.w / 2, y + 8, {
//       align: "center",
//     });
//     return y + h + 2;
//   };

//   // --- Title Bar ---
//   const drawTitle = (y) => {
//     const h = 10;
//     doc.setFillColor(...c.darkGray);
//     doc.rect(page.m, y, page.w - 2 * page.m, h, "F");
//     doc.setTextColor(...c.white);
//     doc.setFontSize(12);
//     doc.text("REQUISITION NOTE", page.w / 2, y + 7, { align: "center" });
//     return y + h;
//   };

//   // --- Info Table ---
//   const drawInfo = (y) => {
//     const rowH = 8;
//     const tableWidth = page.w - 2 * page.m;
//     const startX = page.m;

//     const leftLabelW = 30;
//     const leftValueW = 60;
//     const rightLabelW = 30;
//     const rightValueW = 60;

//     doc.setFontSize(9);
//     doc.setLineWidth(0.3);
//     doc.setDrawColor(...c.border);
//     doc.setTextColor(...c.black);

//     const leftStartX = startX;
//     const rightStartX = startX + leftLabelW + leftValueW + 10;

//     // Row 1: Printed On (Full width) - MOVED TO TOP
//     let yPos = y;
//     let x = leftStartX;
//     doc.setFont("helvetica", "bold");
//     doc.setFillColor(...c.lightGray);
//     doc.rect(x, yPos, leftLabelW, rowH, "FD");
//     doc.text("Printed On", x + leftLabelW / 2, yPos + 5.5, { align: "center" });

//     x += leftLabelW;
//     doc.setFont("helvetica", "normal");
//     doc.setFillColor(...c.white);
//     doc.rect(x, yPos, tableWidth - leftLabelW, rowH, "FD");
//     doc.text(
//       data.printedOn || "-",
//       x + (tableWidth - leftLabelW) / 2,
//       yPos + 5.5,
//       {
//         align: "center",
//       }
//     );

//     yPos += rowH;

//     // Row 2: Date (Left) / Requisition No (Right)
//     x = leftStartX;
//     doc.setFont("helvetica", "bold");
//     doc.setFillColor(...c.lightGray);
//     doc.rect(x, yPos, leftLabelW, rowH, "FD");
//     doc.text("Date", x + leftLabelW / 2, yPos + 5.5, { align: "center" });

//     x += leftLabelW;
//     doc.setFont("helvetica", "normal");
//     doc.setFillColor(...c.white);
//     doc.rect(x, yPos, leftValueW, rowH, "FD");
//     doc.text(data.date || "-", x + leftValueW / 2, yPos + 5.5, {
//       align: "center",
//     });

//     x = rightStartX;
//     doc.setFont("helvetica", "bold");
//     doc.setFillColor(...c.lightGray);
//     doc.rect(x, yPos, rightLabelW, rowH, "FD");
//     doc.text("Requisition No", x + rightLabelW / 2, yPos + 5.5, {
//       align: "center",
//     });

//     x += rightLabelW;
//     doc.setFont("helvetica", "normal");
//     doc.setFillColor(...c.white);
//     doc.rect(x, yPos, rightValueW, rowH, "FD");
//     doc.text(data.requisitionNo || "-", x + rightValueW / 2, yPos + 5.5, {
//       align: "center",
//     });

//     yPos += rowH;

//     // Row 3: Issued By (Left) / Issued For (Right)
//     x = leftStartX;
//     doc.setFont("helvetica", "bold");
//     doc.setFillColor(...c.lightGray);
//     doc.rect(x, yPos, leftLabelW, rowH, "FD");
//     doc.text("Issued By", x + leftLabelW / 2, yPos + 5.5, { align: "center" });

//     x += leftLabelW;
//     doc.setFont("helvetica", "normal");
//     doc.setFillColor(...c.white);
//     doc.rect(x, yPos, leftValueW, rowH, "FD");
//     doc.text(data.issuedBy || "-", x + leftValueW / 2, yPos + 5.5, {
//       align: "center",
//     });

//     x = rightStartX;
//     doc.setFont("helvetica", "bold");
//     doc.setFillColor(...c.lightGray);
//     doc.rect(x, yPos, rightLabelW, rowH, "FD");
//     doc.text("Issued For", x + rightLabelW / 2, yPos + 5.5, {
//       align: "center",
//     });

//     x += rightLabelW;
//     doc.setFont("helvetica", "normal");
//     doc.setFillColor(...c.white);
//     doc.rect(x, yPos, rightValueW, rowH, "FD");
//     doc.text(data.issuedFor || "-", x + rightValueW / 2, yPos + 5.5, {
//       align: "center",
//     });

//     yPos += rowH;

//     // Row 4: User (Left) / Printed By (Right)
//     x = leftStartX;
//     doc.setFont("helvetica", "bold");
//     doc.setFillColor(...c.lightGray);
//     doc.rect(x, yPos, leftLabelW, rowH, "FD");
//     doc.text("User", x + leftLabelW / 2, yPos + 5.5, { align: "center" });

//     x += leftLabelW;
//     doc.setFont("helvetica", "normal");
//     doc.setFillColor(...c.white);
//     doc.rect(x, yPos, leftValueW, rowH, "FD");
//     doc.text(data.user || "-", x + leftValueW / 2, yPos + 5.5, {
//       align: "center",
//     });

//     x = rightStartX;
//     doc.setFont("helvetica", "bold");
//     doc.setFillColor(...c.lightGray);
//     doc.rect(x, yPos, rightLabelW, rowH, "FD");
//     doc.text("Printed By", x + rightLabelW / 2, yPos + 5.5, {
//       align: "center",
//     });

//     x += rightLabelW;
//     doc.setFont("helvetica", "normal");
//     doc.setFillColor(...c.white);
//     doc.rect(x, yPos, rightValueW, rowH, "FD");
//     doc.text(data.printedBy || "-", x + rightValueW / 2, yPos + 5.5, {
//       align: "center",
//     });

//     // Row 5: Narration (Full width)
//     x = leftStartX;
//     doc.setFont("helvetica", "bold");
//     doc.setFillColor(...c.lightGray);
//     doc.rect(x, yPos, leftLabelW, rowH, "FD");
//     doc.text("Narration", x + leftLabelW / 2, yPos + 5.5, { align: "center" });

//     x += leftLabelW;
//     doc.setFont("helvetica", "normal");
//     doc.setFillColor(...c.white);
//     doc.rect(x, yPos, tableWidth - leftLabelW, rowH, "FD");

//     doc.text(narration || "-", x + (tableWidth - leftLabelW) / 2, yPos + 5.5, {
//       align: "center",
//     });

//     yPos += rowH;

//     return yPos + 2;
//   };

//   // --- Table Header ---
//   const drawTableHeader = (y) => {
//     const colW = [40, 120, 30];
//     const headers = ["Material Code", "Material Description", "Qty"];
//     const startX = page.m;
//     const rh = 8;

//     doc.setFont("helvetica", "bold");
//     doc.setFontSize(9);
//     doc.setTextColor(...c.black);
//     doc.setDrawColor(...c.border);

//     let x = startX;
//     headers.forEach((h, i) => {
//       doc.setFillColor(...c.lightGray);
//       doc.rect(x, y, colW[i], rh, "F");
//       doc.rect(x, y, colW[i], rh, "S");
//       doc.text(h, x + colW[i] / 2, y + 5, { align: "center" });
//       x += colW[i];
//     });

//     return y + rh;
//   };

//   // --- Table Rows ---
//   const drawItem = (y, item) => {
//     const colW = [40, 120, 30];
//     const vals = [item.code, item.desc, item.qty || "0"];
//     const rh = 8;
//     let x = page.m;

//     doc.setFont("helvetica", "normal");
//     doc.setFontSize(9);
//     vals.forEach((v, i) => {
//       doc.rect(x, y, colW[i], rh);
//       if (i === 1) {
//         // Material Description - left aligned with padding
//         doc.text(v, x + 2, y + 5);
//       } else {
//         // Material Code and Qty - centered
//         doc.text(v, x + colW[i] / 2, y + 5, { align: "center" });
//       }
//       x += colW[i];
//     });
//     return y + rh;
//   };

//   // --- Total Row ---
//   const drawTotal = (y) => {
//     const colW = [40, 120, 30];
//     const rh = 8;
//     let x = page.m;

//     doc.rect(x, y, colW[0] + colW[1], rh);
//     doc.setFont("helvetica", "bold");
//     doc.text("Total:", x + colW[0] + colW[1] - 3, y + 5, { align: "right" });

//     x += colW[0] + colW[1];
//     doc.rect(x, y, colW[2], rh);
//     doc.text(`${totalQty.toString()}`, x + colW[2] / 2, y + 5, {
//       align: "center",
//     });

//     return y + rh;
//   };

//   // --- Signatures ---
//   const drawSignatures = (y) => {
//     const signatureWidth = 50;
//     const spacing = (page.w - 2 * page.m - 3 * signatureWidth) / 2;

//     doc.setFont("helvetica", "normal");
//     doc.setFontSize(9);

//     // Issued By signature
//     doc.text("Issued By", page.m, y);
//     doc.line(page.m, y + 2, page.m + signatureWidth, y + 2);

//     // Approved By signature (centered)
//     doc.text("Approved By", page.m + signatureWidth + spacing, y);
//     doc.line(
//       page.m + signatureWidth + spacing,
//       y + 2,
//       page.m + signatureWidth + spacing + signatureWidth,
//       y + 2
//     );

//     // Received By signature
//     doc.text("Received By", page.w - page.m - signatureWidth, y);
//     doc.line(page.w - page.m - signatureWidth, y + 2, page.w - page.m, y + 2);
//   };

//   // --- Footer ---
//   const drawFooter = (y) => {
//     doc.setFont("helvetica", "italic");
//     doc.setFontSize(8);
//     doc.setTextColor(...c.darkGray);
//     doc.text(`${company?.name} - REQUISITION NOTE`, page.w / 2, y, {
//       align: "center",
//     });
//   };

//   // --- Add New Page ---
//   const addNewPage = () => {
//     doc.addPage();
//     let y = page.m;
//     y = drawHeader(y);
//     y = drawTitle(y);
//     return y;
//   };

//   // --- Render PDF with Multi-page Support ---
//   let y = page.m;
//   y = drawHeader(y);
//   y = drawTitle(y);
//   y = drawInfo(y + 3);
//   y = drawTableHeader(y + 3);

//   const itemHeight = 8;
//   const spaceForSignatures = 30;
//   const spaceForFooter = 10;
//   const maxItemsPerPage = Math.floor(
//     (page.h - y - spaceForSignatures - spaceForFooter) / itemHeight
//   );

//   let pageStartIndex = 0;
//   let currentPage = 1;

//   while (pageStartIndex < data.items.length) {
//     const pageEndIndex = Math.min(
//       pageStartIndex + maxItemsPerPage,
//       data.items.length
//     );

//     for (let i = pageStartIndex; i < pageEndIndex; i++) {
//       y = drawItem(y, data.items[i]);
//     }

//     // Draw footer for current page
//     drawSignatures(page.h - page.m - 25);
//     drawFooter(page.h - page.m);

//     if (pageEndIndex < data.items.length) {
//       y = addNewPage();
//       y = drawTableHeader(y + 3);
//       pageStartIndex = pageEndIndex;
//       currentPage++;
//     } else {
//       y = drawTotal(y);
//       // drawSignatures(y + 10);
//       break;
//     }
//   }

//   if (data.items.length === 0) {
//     y = drawTotal(y);
//     drawSignatures(page.h - page.m - 100);
//     drawFooter(page.h - page.m);
//   }

//   
//   
//   return doc;
// };
import { jsPDF } from "jspdf";

export const generateRequisitionNotePDF = async (
  requisitionData,
  session = null,
  company,
  currency,
  mode = "download",
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

  const narration =
    requisitionData.rmk ||
    requisitionData.narration ||
    requisitionData.remarks ||
    "";

  // --- Format data from requisitionData ---
  const data = {
    date: requisitionData.dated
      ? new Date(requisitionData.dated).toLocaleDateString("en-GB") +
        " " +
        new Date(requisitionData.dated).toLocaleTimeString()
      : new Date().toLocaleDateString("en-GB"),
    issuedBy: requisitionData.godown2Details?.godown || "N/A",
    requisitionNo: requisitionData.tran_id?.toString() || "N/A",
    issuedFor: requisitionData.godownDetails?.godown || "N/A",
    user: requisitionData.userid || "N/A",
    printedBy: session?.user?.name || "N/A",
    printedOn:
      new Date().toLocaleDateString("en-GB") +
      " " +
      new Date().toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      }),
    items:
      (requisitionData.details || [])
        .map((detail) => ({
          code: detail.itcd?.toString() || "N/A",
          desc: detail.item?.item || "Unknown Item",
          qty: detail.qty?.toString() || "0",
        }))
        .sort((a, b) => a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: 'base' })),
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
    doc.text(company?.name, page.w / 2, y + 8, {
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
    doc.text("REQUISITION NOTE", page.w / 2, y + 7, { align: "center" });
    return y + h;
  };

  // --- Info Table ---
  const drawInfo = (y) => {
    const rowH = 8;
    const tableWidth = page.w - 2 * page.m;
    const startX = page.m;

    const leftLabelW = 30;
    const leftValueW = 60;
    const rightLabelW = 30;
    const rightValueW = 60;

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
      }
    );

    yPos += rowH;

    // Row 2: Date (Left) / Requisition No (Right)
    x = leftStartX;
    doc.setFont("helvetica", "bold");
    doc.setFillColor(...c.lightGray);
    doc.rect(x, yPos, leftLabelW, rowH, "FD");
    doc.text("Date", x + leftLabelW / 2, yPos + 5.5, { align: "center" });

    x += leftLabelW;
    doc.setFont("helvetica", "normal");
    doc.setFillColor(...c.white);
    doc.rect(x, yPos, leftValueW, rowH, "FD");
    doc.text(data.date || "-", x + leftValueW / 2, yPos + 5.5, {
      align: "center",
    });

    x = rightStartX;
    doc.setFont("helvetica", "bold");
    doc.setFillColor(...c.lightGray);
    doc.rect(x, yPos, rightLabelW, rowH, "FD");
    doc.text("Requisition No", x + rightLabelW / 2, yPos + 5.5, {
      align: "center",
    });

    x += rightLabelW;
    doc.setFont("helvetica", "normal");
    doc.setFillColor(...c.white);
    doc.rect(x, yPos, rightValueW, rowH, "FD");
    doc.text(data.requisitionNo || "-", x + rightValueW / 2, yPos + 5.5, {
      align: "center",
    });

    yPos += rowH;

    // Row 3: Issued By (Left) / Issued For (Right)
    x = leftStartX;
    doc.setFont("helvetica", "bold");
    doc.setFillColor(...c.lightGray);
    doc.rect(x, yPos, leftLabelW, rowH, "FD");
    doc.text("Issued By", x + leftLabelW / 2, yPos + 5.5, { align: "center" });

    x += leftLabelW;
    doc.setFont("helvetica", "normal");
    doc.setFillColor(...c.white);
    doc.rect(x, yPos, leftValueW, rowH, "FD");
    doc.text(data.issuedBy || "-", x + leftValueW / 2, yPos + 5.5, {
      align: "center",
    });

    x = rightStartX;
    doc.setFont("helvetica", "bold");
    doc.setFillColor(...c.lightGray);
    doc.rect(x, yPos, rightLabelW, rowH, "FD");
    doc.text("Issued For", x + rightLabelW / 2, yPos + 5.5, {
      align: "center",
    });

    x += rightLabelW;
    doc.setFont("helvetica", "normal");
    doc.setFillColor(...c.white);
    doc.rect(x, yPos, rightValueW, rowH, "FD");
    doc.text(data.issuedFor || "-", x + rightValueW / 2, yPos + 5.5, {
      align: "center",
    });

    yPos += rowH;

    // Row 4: User (Left) / Printed By (Right)
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
    doc.text("Printed By", x + rightLabelW / 2, yPos + 5.5, {
      align: "center",
    });

    x += rightLabelW;
    doc.setFont("helvetica", "normal");
    doc.setFillColor(...c.white);
    doc.rect(x, yPos, rightValueW, rowH, "FD");
    doc.text(data.printedBy || "-", x + rightValueW / 2, yPos + 5.5, {
      align: "center",
    });

    // Row 5: Narration (Full width)
    x = leftStartX;
    doc.setFont("helvetica", "bold");
    doc.setFillColor(...c.lightGray);
    doc.rect(x, yPos, leftLabelW, rowH, "FD");
    doc.text("Narration", x + leftLabelW / 2, yPos + 5.5, { align: "center" });

    x += leftLabelW;
    doc.setFont("helvetica", "normal");
    doc.setFillColor(...c.white);
    doc.rect(x, yPos, tableWidth - leftLabelW, rowH, "FD");

    doc.text(narration || "-", x + (tableWidth - leftLabelW) / 2, yPos + 5.5, {
      align: "center",
    });

    yPos += rowH;

    return yPos + 2;
  };

  // --- Table Header ---
  const drawTableHeader = (y) => {
    const colW = [40, 120, 30];
    const headers = ["Material Code", "Material Description", "Qty"];
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
    const colW = [40, 120, 30];
    const vals = [item.code, item.desc, item.qty || "0"];
    const rh = 8;
    let x = page.m;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    vals.forEach((v, i) => {
      doc.rect(x, y, colW[i], rh);
      if (i === 1) {
        doc.text(v, x + 2, y + 5);
      } else {
        doc.text(v, x + colW[i] / 2, y + 5, { align: "center" });
      }
      x += colW[i];
    });
    return y + rh;
  };

  // --- Total Row ---
  const drawTotal = (y) => {
    const colW = [40, 120, 30];
    const rh = 8;
    let x = page.m;

    doc.rect(x, y, colW[0] + colW[1], rh);
    doc.setFont("helvetica", "bold");
    doc.text("Total:", x + colW[0] + colW[1] - 3, y + 5, { align: "right" });

    x += colW[0] + colW[1];
    doc.rect(x, y, colW[2], rh);
    doc.text(`${totalQty.toString()}`, x + colW[2] / 2, y + 5, {
      align: "center",
    });

    return y + rh;
  };

  // ===== SIGNATURES - With gap from top =====
  const drawSignatures = (y) => {
    const signatureWidth = 55;
    const spacing = (page.w - 2 * page.m - 3 * signatureWidth) / 2;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...c.black);

    // Issued By
    doc.text("Issued By:", page.m, y);
    doc.line(page.m + 22, y, page.m + signatureWidth, y);

    // Approved By
    doc.text("Approved By:", page.m + signatureWidth + spacing, y);
    doc.line(
      page.m + signatureWidth + spacing + 27,
      y,
      page.m + signatureWidth + spacing + signatureWidth,
      y
    );

    // Received By
    doc.text("Received By:", page.w - page.m - signatureWidth, y);
    doc.line(
      page.w - page.m - signatureWidth + 26,
      y,
      page.w - page.m,
      y
    );

    return y + 12;
  };

  // --- Footer (only company name, NO Pakistani Rupees) ---
  const drawFooter = (y) => {
    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(...c.darkGray);
    doc.text(`${company?.name}`, page.w / 2, y, {
      align: "center",
    });
  };

  // --- Add New Page ---
  const addNewPage = () => {
    doc.addPage();
    let y = page.m;
    y = drawHeader(y);
    y = drawTitle(y);
    y = drawInfo(y);
    y = drawTableHeader(y);
    return y;
  };

  // --- Render PDF with Multi-page Support ---
  let y = page.m;
  y = drawHeader(y);
  y = drawTitle(y);
  y = drawInfo(y);
  y = drawTableHeader(y);

  const itemHeight = 8;
  const spaceForSignatures = 25;
  const spaceForFooter = 10;
  const maxItemsPerPage = Math.floor(
    (page.h - y - spaceForSignatures - spaceForFooter) / itemHeight
  );

  let pageStartIndex = 0;
  let currentPage = 1;

  while (pageStartIndex < data.items.length) {
    const pageEndIndex = Math.min(
      pageStartIndex + maxItemsPerPage,
      data.items.length
    );

    for (let i = pageStartIndex; i < pageEndIndex; i++) {
      y = drawItem(y, data.items[i]);
    }

    // Draw Total
    y = drawTotal(y);

    // Draw Signatures with gap (y + 8 gives space from total)
    drawSignatures(y + 8);

    // Draw Footer (NO Pakistani Rupees)
    drawFooter(page.h - page.m - 5);

    if (pageEndIndex < data.items.length) {
      y = addNewPage();
      pageStartIndex = pageEndIndex;
      currentPage++;
    } else {
      break;
    }
  }

  if (data.items.length === 0) {
    y = drawTotal(y);
    drawSignatures(y + 8);
    drawFooter(page.h - page.m - 5);
  }

  
  if (mode === "print") {
    doc.autoPrint();
    window.open(doc.output("bloburl"), "_blank");
  }
  return doc;
};