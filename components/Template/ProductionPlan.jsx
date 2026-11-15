
import axios from "axios";
import { jsPDF } from "jspdf";

export const generateProductionPlan = async (
  requisitionInput,
  session = null,
  company = null,
  currency = null,
  mode = "download",
) => {
  let requisitionData = requisitionInput || {};
  if (typeof requisitionInput === "number" || typeof requisitionInput === "string") {
    try {
      const res = await axios.get(`/api/material/requisition?tranNo=${requisitionInput}`);
      requisitionData = res.data?.data?.[0] || {};
    } catch (e) {
      requisitionData = {};
    }
  }

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

  // --- Live stock: TOTAL over all godowns — latest Monthly Opening + movements
  //     since that month (app/api/material/bom-stock) ---
  const rawDetails = requisitionData.details || requisitionData.items || [];
  let stockMap = {};

  if (rawDetails.length > 0) {
    const productIds = rawDetails.map((d) => d.itcd || d.item?.itcd).filter(Boolean);
    if (productIds.length > 0) {
      try {
        const stockRes = await axios.get("/api/material/bom-stock", {
          params: { items: productIds.join(",") },
        });
        stockMap = stockRes.data?.data || {};
      } catch (e) {
        console.error("Failed to fetch live stock for Production Plan print:", e);
      }
    }
  }

  // --- Format data from requisitionData ---
  const data = {
    date: requisitionData.dated
      ? new Date(requisitionData.dated).toLocaleDateString("en-GB")
      : new Date().toLocaleDateString("en-GB"),
    issuedBy: requisitionData.godown2Details?.godown || "N/A",
    requisitionNo: requisitionData.tran_id?.toString() || "N/A",
    issuedFor: requisitionData.godownDetails?.godown || "N/A",
    user: requisitionData.userid || "N/A",
    printedBy: session?.user?.name || "N/A",
    printedOn:
      new Date().toLocaleDateString("en-GB") +
      " " +
      new Date().toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: true,
      }),
    items:
      rawDetails
        .map((detail) => {
          const custName =
            detail.acname ||
            detail.acnoDetails?.acname ||
            detail.ordersSO?.acname ||
            detail.ordersSO?.acnoDetails?.acname ||
            detail.customerName ||
            detail.customer?.name ||
            detail.party_name ||
            detail.partyName ||
            requisitionData.acname ||
            requisitionData.acnoDetails?.acname ||
            requisitionData.ordersSO?.acname ||
            requisitionData.ordersSO?.acnoDetails?.acname ||
            requisitionData.customerName ||
            requisitionData.customer?.name ||
            requisitionData.party_name ||
            requisitionData.partyName ||
            "";
          const custCode =
            detail.cust_code ||
            detail.customerCode ||
            detail.acno ||
            detail.acnoDetails?.acno ||
            detail.customer?.code ||
            detail.ordersSO?.acno ||
            detail.ordersSO?.acnoDetails?.acno ||
            requisitionData.cust_code ||
            requisitionData.acno ||
            requisitionData.acnoDetails?.acno ||
            requisitionData.ordersSO?.acno ||
            requisitionData.ordersSO?.acnoDetails?.acno ||
            "";

          const soNo =
            detail.so_no?.value != null
              ? detail.so_no.value
              : detail.so_no != null && detail.so_no !== ""
              ? detail.so_no
              : detail.ordersSO?.order_no ||
                detail.ordersSO?.sale_no ||
                requisitionData.so_no ||
                "";

          // Customer: full name only (no SO# combined)
          let customerDisplay = "-";
          if (custName) {
            customerDisplay = custName;
          } else if (custCode) {
            customerDisplay = String(custCode);
          }

          // Ink Code: prefer item.code (actual alpha code), fallback to itcd numeric
          const inkCode =
            detail.item?.code ||
            detail.item?.inkCode ||
            detail.code ||
            detail.inkCode ||
            detail.itcd?.toString() ||
            "-";

          const desc =
            detail.desc ||
            detail.item?.item ||
            detail.item_name ||
            detail.description ||
            "Unknown Item";

          const itcdVal = detail.itcd || detail.item?.itcd;
          // Live total stock (all godowns) first; the stock saved on the line
          // when the plan was made is only a fallback.
          const stockVal =
            (itcdVal && stockMap[itcdVal] != null)
              ? stockMap[itcdVal]
              : detail.stock != null
              ? detail.stock
              : detail.bal_qty != null
              ? detail.bal_qty
              : detail.item?.stock != null
              ? detail.item.stock
              : detail.godown_stock != null
              ? detail.godown_stock
              : 0;

          const custPo =
            detail.sale_po !== undefined
              ? detail.sale_po
              : detail.po_no ||
                detail.ordersSO?.sale_po ||
                detail.ordersSO?.po_no ||
                "";

          return {
            customer: customerDisplay,
            csCode: custCode ? String(custCode) : "-",
            soNo: soNo ? String(soNo) : "-",
            custPo: custPo ? String(custPo) : "-",
            code: inkCode,
            desc: desc,
            stock: Number(stockVal || 0).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }),
            qty: detail.qty != null ? Number(detail.qty).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 2 }) : "0",
            rawQty: Number(detail.qty || 0),
          };
        })
        .sort((a, b) => {
          const custCompare = a.customer.localeCompare(b.customer, undefined, { numeric: true, sensitivity: "base" });
          if (custCompare !== 0) return custCompare;
          const soCompare = a.soNo.localeCompare(b.soNo, undefined, { numeric: true, sensitivity: "base" });
          if (soCompare !== 0) return soCompare;
          return a.code.localeCompare(b.code, undefined, { numeric: true, sensitivity: "base" });
        }),
  };

  const totalQty = data.items.reduce((s, i) => s + (i.rawQty || 0), 0);

  // --- Company Header ---
  const drawHeader = (y) => {
    const h = 12;
    doc.setFillColor(...c.maroon);
    doc.rect(page.m, y, page.w - 2 * page.m, h, "F");
    doc.setTextColor(...c.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    const companyName = company?.name || "Company";
    doc.text(companyName, page.w / 2, y + 8, {
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
    doc.text("PRODUCTION PLAN", page.w / 2, y + 7, { align: "center" });
    return y + h;
  };

  // --- Info Table ---
  const drawInfo = (y) => {
    const rowH = 8;
    const tableWidth = page.w - 2 * page.m;
    const leftLabelW = 30;
    const leftValueW = 65;
    const rightLabelW = 30;
    const rightValueW = 65;

    let yPos = y;
    const leftStartX = page.m;

    doc.setTextColor(...c.black);

    // Row 1: Date & Plan No
    let x = leftStartX;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.setFillColor(...c.lightGray);
    doc.setDrawColor(...c.border);
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

    // Row 2: Date (Left) / PLAN No (Right)
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

    const rightStartX = x + leftValueW;
    x = rightStartX;
    doc.setFont("helvetica", "bold");
    doc.setFillColor(...c.lightGray);
    doc.rect(x, yPos, rightLabelW, rowH, "FD");
    doc.text("Plan No", x + rightLabelW / 2, yPos + 5.5, { align: "center" });

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
  // Columns: Customer Name | CS Code | ISO# | Cust PO | Code | Product Description | Stock | Qty
  const drawTableHeader = (y) => {
    const colW = [32, 16, 16, 18, 18, 50, 18, 22];
    const headers = ["Customer Name", "CS Code", "ISO#", "Cust PO", "Code", "Product Description", "Stock", "Qty"];
    const startX = page.m;
    const rh = 8;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(7.5);
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
  // vals order: customer, csCode, soNo, custPo, code, desc, stock, qty
  const itemRowH = 7;
  const drawItem = (y, item) => {
    const colW = [32, 16, 16, 18, 18, 50, 18, 22];
    const vals = [item.customer, item.csCode, item.soNo, item.custPo, item.code, item.desc, item.stock, item.qty];
    const rh = itemRowH;
    let x = page.m;

    doc.setFont("helvetica", "normal");
    vals.forEach((v, i) => {
      doc.rect(x, y, colW[i], rh);
      if (i === 0) {
        // Customer Name: left-aligned, wrap up to 2 lines
        doc.setFontSize(7);
        const lines = doc.splitTextToSize(String(v || "-"), colW[i] - 3);
        if (lines.length > 1) {
          doc.text(lines[0], x + 2, y + 2.9);
          doc.text(lines[1], x + 2, y + 5.7);
        } else {
          doc.text(lines[0] || "-", x + 2, y + 4.5);
        }
      } else if (i === 5) {
        // Product Description: left-aligned, truncate
        doc.setFontSize(7.5);
        const textStr = doc.splitTextToSize(String(v || "-"), colW[i] - 3)[0] || "-";
        doc.text(textStr, x + 2, y + 4.5);
      } else {
        // CS Code, ISO#, Cust PO, Code, Stock, Qty: center-aligned
        doc.setFontSize(7.5);
        doc.text(String(v || "-"), x + colW[i] / 2, y + 4.5, { align: "center" });
      }
      x += colW[i];
    });
    return y + rh;
  };

  // --- Total Row ---
  const drawTotal = (y) => {
    const colW = [32, 16, 16, 18, 18, 50, 18, 22];
    const rh = 8;
    let x = page.m;

    const leftWidth = colW[0] + colW[1] + colW[2] + colW[3] + colW[4] + colW[5] + colW[6];
    doc.rect(x, y, leftWidth, rh);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8.5);
    doc.text("Total:", x + leftWidth - 3, y + 5, { align: "right" });

    x += leftWidth;
    doc.rect(x, y, colW[7], rh);
    const totalQtyStr = totalQty % 1 === 0
      ? totalQty.toLocaleString("en-US")
      : totalQty.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    doc.text(totalQtyStr, x + colW[7] / 2, y + 5, { align: "center" });

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
    const companyName = company?.name || "Company";
    doc.text(companyName, page.w / 2, y, {
      align: "center",
    });
  };

  // --- Add New Page ---
  const addNewPage = () => {
    doc.addPage();
    let y = page.m;
    y = drawTableHeader(y);
    return y;
  };

  // --- Render PDF with Multi-page Support ---
  let y = page.m;
  y = drawHeader(y);
  y = drawTitle(y);
  y = drawInfo(y);
  y = drawTableHeader(y);

  // const spaceForSignatures = 25;
  const spaceForFooter = 8;
  const totalRowH = 8;
  // Total row + footer, needed only on the last page
  const closingSpace = totalRowH + spaceForFooter;

  // Fill every page to the bottom; reserve closing space only on the last page
  let index = 0;
  while (index < data.items.length) {
    const remaining = data.items.length - index;
    const fitWithClosing = Math.floor((page.h - y - closingSpace) / itemRowH);
    if (remaining <= fitWithClosing) {
      for (; index < data.items.length; index++) {
        y = drawItem(y, data.items[index]);
      }
      break;
    }

    const fitFullPage = Math.floor((page.h - page.m - y) / itemRowH);
    // If all remaining rows fit but the total/signatures don't, carry the last
    // row over so they never land alone on a page.
    const take = remaining <= fitFullPage ? remaining - 1 : fitFullPage;
    const end = index + take;
    for (; index < end; index++) {
      y = drawItem(y, data.items[index]);
    }
    y = addNewPage();
  }

  // Draw Total
  y = drawTotal(y);

  // Draw Signatures with gap (y + 8 gives space from total)
  // drawSignatures(y + 8);

  // Draw Footer (NO Pakistani Rupees)
  drawFooter(page.h - 4);

  
  if (mode === "print") {
    doc.autoPrint();
    window.open(doc.output("bloburl"), "_blank");
  }
  return doc;
};