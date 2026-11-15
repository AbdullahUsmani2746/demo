import axios from "axios";
import { jsPDF } from "jspdf";

// ╔══════════════════════════════════════════════════════════════════╗
// ║          STAMP & SIGNATURE CONFIG — SIRF YAHAN CHANGE KARO      ║
// ╠══════════════════════════════════════════════════════════════════╣
// ║                                                                  ║
// ║  REAL IMAGE USE KARNE KA TARIKA:                                 ║
// ║                                                                  ║
// ║  Step 1: Apni signature ya stamp ki PNG/JPG image lo             ║
// ║  Step 2: Is website pe jao:                                      ║
// ║          https://base64.guru/converter/encode/image              ║
// ║  Step 3: Image upload karo, copy karo poori base64 string        ║
// ║  Step 4: Neeche SIGNATURE_BASE64 ya STAMP_BASE64 mein paste karo ║
// ║  Step 5: USE_REAL_IMAGES = true kar do — bas! Done.              ║
// ║                                                                  ║
// ║  NOTE: String "data:image/png;base64,ABC123..." jaisi hogi       ║
// ║                                                                  ║
// ╚══════════════════════════════════════════════════════════════════╝

const SIGNATURE_STAMP_CONFIG = {
  // ─────────────────────────────────────────────────────────────────
  // STEP 1: Jab real image ready ho to yahan true karo
  // Abhi false hai → dummy shapes draw honge (testing ke liye)
  // ─────────────────────────────────────────────────────────────────
  USE_REAL_IMAGES: false,

  // ─────────────────────────────────────────────────────────────────
  // STEP 2: Apni real images ki base64 strings yahan paste karo
  // (USE_REAL_IMAGES = false ho to ye ignore hoga)
  // ─────────────────────────────────────────────────────────────────
  SIGNATURE_BASE64: "", // "data:image/png;base64,iVBORw0KGgoA..."
  STAMP_BASE64: "", // "data:image/png;base64,iVBORw0KGgoA..."

  // ─────────────────────────────────────────────────────────────────
  // STEP 3: Image ka size adjust karo (mm mein)
  // ─────────────────────────────────────────────────────────────────
  SIGNATURE_WIDTH: 44, // mm — signature image ki width
  SIGNATURE_HEIGHT: 14, // mm — signature image ki height
  STAMP_WIDTH: 23, // mm — stamp image ki width
  STAMP_HEIGHT: 23, // mm — stamp image ki height

  // ─────────────────────────────────────────────────────────────────
  // Dummy stamp settings — sirf dummy mode mein use hoga
  // ─────────────────────────────────────────────────────────────────
  STAMP_COLOR: [139, 0, 0], // RGB — dark red
  STAMP_DEPT_LABEL: "DISPATCH DEPT.", // stamp ke andar neeche wala text
};

// ══════════════════════════════════════════════════════════════════
//  BAAKI FILE TOUCH KARNE KI ZAROORAT NAHI — UPAR SE KARO CHANGES
// ══════════════════════════════════════════════════════════════════

export const generateDispatchNotePDF = async (
  voucherId,
  session = null,
  currency,
  company,
  mode = "download",
) => {
  const id = typeof voucherId === "object" ? voucherId.tran_id || voucherId.voucherId || voucherId.id : voucherId;
  const res = await axios.get(`/api/voucher/dispatch?id=${id}`);
  const voucherData = res.data?.data[0] || {};

  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const c = {
    maroon: [128, 0, 32],
    darkGray: [64, 64, 64],
    lightGray: [230, 230, 230],
    border: [150, 150, 150],
    black: [0, 0, 0],
    white: [255, 255, 255],
    headerGray: [240, 240, 240],
    stampRed: SIGNATURE_STAMP_CONFIG.STAMP_COLOR,
  };

  const page = { w: 210, h: 297, m: 10 };
  let y = 0;

  const narration =
    voucherData.rmk || voucherData.narration || voucherData.remarks || "";

  const formatDate = (dateStr) => {
    if (!dateStr) return "";
    const date = new Date(dateStr);
    const day = String(date.getDate()).padStart(2, "0");
    const month = date
      .toLocaleString("en-US", { month: "short" })
      .toUpperCase();
    const year = String(date.getFullYear()).slice(-2);
    return `${day}-${month}-${year}`;
  };

  const drawHeader = (y) => {
    const h = 12;
    doc.setFillColor(...c.maroon);
    doc.rect(page.m, y, page.w - 2 * page.m, h, "F");
    doc.setTextColor(...c.white);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(16);
    doc.text(company?.name || "", page.w / 2, y + 8, { align: "center" });
    return y + h + 2;
  };

  const drawTitle = (y) => {
    const h = 8;
    doc.setFillColor(...c.darkGray);
    doc.rect(page.m, y, page.w - 2 * page.m, h, "F");
    doc.setTextColor(...c.white);
    doc.setFontSize(12);
    doc.text("DISPATCH NOTE", page.w / 2, y + 5.5, { align: "center" });
    return y + h;
  };

  const drawInfo = (y) => {
    const rowH = 7;
    const tableWidth = page.w - 2 * page.m;
    const startX = page.m;
    const leftLabelW = 30;
    const leftValueW = 60;
    const rightLabelW = 30;
    const rightValueW = 60;
    const leftStartX = startX;
    const rightStartX = startX + leftLabelW + leftValueW + 10;

    doc.setFontSize(9);
    doc.setLineWidth(0.3);
    doc.setDrawColor(...c.border);
    doc.setTextColor(...c.black);

    const printedBy = session?.user?.name || "N/A";
    const printedOn =
      new Date().toLocaleDateString("en-GB") +
      " " +
      new Date().toLocaleTimeString("en-GB", {
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
      });

    let yPos = y;
    let x = leftStartX;

    // Row 1 — Printed On (full width), or Manual DC No / Printed On
    if (voucherData.manual_no) {
      doc.setFont("helvetica", "bold");
      doc.setFillColor(...c.lightGray);
      doc.rect(x, yPos, leftLabelW, rowH, "FD");
      doc.text("Manual DC No", x + leftLabelW / 2, yPos + 4.5, { align: "center" });
      x += leftLabelW;
      doc.setFont("helvetica", "normal");
      doc.setFillColor(...c.white);
      doc.rect(x, yPos, leftValueW, rowH, "FD");
      doc.text(String(voucherData.manual_no), x + leftValueW / 2, yPos + 4.5, { align: "center" });
      x = rightStartX;
      doc.setFont("helvetica", "bold");
      doc.setFillColor(...c.lightGray);
      doc.rect(x, yPos, rightLabelW, rowH, "FD");
      doc.text("Printed On", x + rightLabelW / 2, yPos + 4.5, { align: "center" });
      x += rightLabelW;
      doc.setFont("helvetica", "normal");
      doc.setFillColor(...c.white);
      doc.rect(x, yPos, rightValueW, rowH, "FD");
      doc.text(printedOn, x + rightValueW / 2, yPos + 4.5, { align: "center" });
    } else {
      doc.setFont("helvetica", "bold");
      doc.setFillColor(...c.lightGray);
      doc.rect(x, yPos, leftLabelW, rowH, "FD");
      doc.text("Printed On", x + leftLabelW / 2, yPos + 4.5, { align: "center" });
      x += leftLabelW;
      doc.setFont("helvetica", "normal");
      doc.setFillColor(...c.white);
      doc.rect(x, yPos, tableWidth - leftLabelW, rowH, "FD");
      doc.text(printedOn, x + (tableWidth - leftLabelW) / 2, yPos + 4.5, {
        align: "center",
      });
    }
    yPos += rowH;

    // Row 2 — Challan No / Date
    x = leftStartX;
    doc.setFont("helvetica", "bold");
    doc.setFillColor(...c.lightGray);
    doc.rect(x, yPos, leftLabelW, rowH, "FD");
    doc.text("Dispatch No", x + leftLabelW / 2, yPos + 4.5, { align: "center" });
    x += leftLabelW;
    doc.setFont("helvetica", "normal");
    doc.setFillColor(...c.white);
    doc.rect(x, yPos, leftValueW, rowH, "FD");
    doc.text(
      String(voucherData.dispatch_no || "N/A"),
      x + leftValueW / 2,
      yPos + 4.5,
      { align: "center" },
    );
    x = rightStartX;
    doc.setFont("helvetica", "bold");
    doc.setFillColor(...c.lightGray);
    doc.rect(x, yPos, rightLabelW, rowH, "FD");
    doc.text("Date", x + rightLabelW / 2, yPos + 4.5, { align: "center" });
    x += rightLabelW;
    doc.setFont("helvetica", "normal");
    doc.setFillColor(...c.white);
    doc.rect(x, yPos, rightValueW, rowH, "FD");
    doc.text(formatDate(voucherData.dated), x + rightValueW / 2, yPos + 4.5, {
      align: "center",
    });
    yPos += rowH;

    // Row 3 — Vehicle No / SO No
    x = leftStartX;
    doc.setFont("helvetica", "bold");
    doc.setFillColor(...c.lightGray);
    doc.rect(x, yPos, leftLabelW, rowH, "FD");
    doc.text(voucherData.city ? "Vehicle / City" : "Vehicle No", x + leftLabelW / 2, yPos + 4.5, { align: "center" });
    x += leftLabelW;
    doc.setFont("helvetica", "normal");
    doc.setFillColor(...c.white);
    doc.rect(x, yPos, leftValueW, rowH, "FD");
    doc.text(
      [voucherData.rmk4 || "N/A", voucherData.city].filter(Boolean).join(" · "),
      x + leftValueW / 2,
      yPos + 4.5,
      { align: "center" },
    );
    x = rightStartX;
    doc.setFont("helvetica", "bold");
    doc.setFillColor(...c.lightGray);
    doc.rect(x, yPos, rightLabelW, rowH, "FD");
    doc.text("ISO #", x + rightLabelW / 2, yPos + 4.5, { align: "center" });
    x += rightLabelW;
    doc.setFont("helvetica", "normal");
    doc.setFillColor(...c.white);
    doc.rect(x, yPos, rightValueW, rowH, "FD");
    doc.text(
      String(voucherData.so_no || "N/A"),
      x + rightValueW / 2,
      yPos + 4.5,
      { align: "center" },
    );
    yPos += rowH;

    // Row 4 — Printed By / User
    x = leftStartX;
    doc.setFont("helvetica", "bold");
    doc.setFillColor(...c.lightGray);
    doc.rect(x, yPos, leftLabelW, rowH, "FD");
    doc.text("Printed By", x + leftLabelW / 2, yPos + 4.5, { align: "center" });
    x += leftLabelW;
    doc.setFont("helvetica", "normal");
    doc.setFillColor(...c.white);
    doc.rect(x, yPos, leftValueW, rowH, "FD");
    doc.text(printedBy, x + leftValueW / 2, yPos + 4.5, { align: "center" });
    x = rightStartX;
    doc.setFont("helvetica", "bold");
    doc.setFillColor(...c.lightGray);
    doc.rect(x, yPos, rightLabelW, rowH, "FD");
    doc.text("User", x + rightLabelW / 2, yPos + 4.5, { align: "center" });
    x += rightLabelW;
    doc.setFont("helvetica", "normal");
    doc.setFillColor(...c.white);
    doc.rect(x, yPos, rightValueW, rowH, "FD");
    doc.text(
      String(voucherData.userid || "Accountant User"),
      x + rightValueW / 2,
      yPos + 4.5,
      { align: "center" },
    );
    yPos += rowH;

    // Row 5 — Po No
    x = leftStartX;
    doc.setFont("helvetica", "bold");
    doc.setFillColor(...c.lightGray);
    doc.rect(x, yPos, leftLabelW, rowH, "FD");
    doc.text("Customer Po No #", x + leftLabelW / 2, yPos + 4.5, { align: "center" });
    x += leftLabelW;
    doc.setFont("helvetica", "normal");
    doc.setFillColor(...c.white);
    doc.rect(x, yPos, leftValueW, rowH, "FD");
    doc.text(
      String(voucherData.ordersSO?.sale_po || "-"),
      x + leftValueW / 2,
      yPos + 4.5,
      { align: "center" },
    );
    x = rightStartX;
    doc.setFillColor(...c.lightGray);
    doc.rect(x, yPos, rightLabelW, rowH, "FD");
    doc.rect(x + rightLabelW, yPos, rightValueW, rowH, "D"); // Empty value box
    yPos += rowH;

    // Row 6 — Narration
    x = leftStartX;
    doc.setFont("helvetica", "bold");
    doc.setFillColor(...c.lightGray);
    doc.rect(x, yPos, leftLabelW, rowH, "FD");
    doc.text("Narration", x + leftLabelW / 2, yPos + 4.5, { align: "center" });
    x += leftLabelW;
    doc.setFont("helvetica", "normal");
    doc.setFillColor(...c.white);
    doc.rect(x, yPos, tableWidth - leftLabelW, rowH, "FD");
    const narText =
      narration.length > 40 ? narration.substring(0, 40) + "..." : narration;
    doc.text(narText || "-", x + (tableWidth - leftLabelW) / 2, yPos + 4.5, {
      align: "center",
    });
    yPos += rowH;

    return yPos + rowH;
  };

  const drawBuyerBox = (y) => {
    const boxH = 14;
    doc.setDrawColor(...c.border);
    doc.setLineWidth(0.3);
    doc.roundedRect(page.m, y, page.w - 2 * page.m, boxH, 2.5, 2.5);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("Buyer's Name :", page.m + 3, y + 5);
    doc.text("Address :", page.m + 3, y + 10);
    doc.setFont("helvetica", "normal");
    doc.text(
      voucherData.pycd?.label || voucherData.acno?.acname || "N/A",
      page.m + 28,
      y + 5,
    );
    doc.text(voucherData.acno?.address || "N/A", page.m + 28, y + 10);
    return y + boxH + 3;
  };

  const drawTableHeader = (y) => {
    const colW = [8, 67, 30, 25, 15, 15, 17, 13];
    const headers = [
      "Sr#",
      "DESCRIPTION OF GOODS",
      "Batch#",
      ["Packing", "Unit"],
      ["Packed", "Qty"],
      ["Qty per", "Pack"],
      "Qty",
      "Unit",
    ];
    const rh = 8.5;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setTextColor(...c.black);
    doc.setDrawColor(...c.border);
    doc.setLineWidth(0.3);
    let x = page.m;
    headers.forEach((h, i) => {
      doc.setFillColor(...c.headerGray);
      doc.rect(x, y, colW[i], rh, "F");
      doc.rect(x, y, colW[i], rh, "S");
      if (Array.isArray(h)) {
        doc.text(h[0], x + colW[i] / 2, y + 3, { align: "center" });
        doc.text(h[1], x + colW[i] / 2, y + 7, { align: "center" });
      } else {
        doc.text(h, x + colW[i] / 2, y + rh / 2 + 1, { align: "center" });
      }
      x += colW[i];
    });
    return y + rh;
  };

  const drawItem = (y, item, index) => {
    const colW = [8, 67, 30, 25, 15, 15, 17, 13];
    const rh = 8.5;
    let x = page.m;
    doc.setFont("helvetica", "normal");
    doc.setDrawColor(...c.border);
    doc.setLineWidth(0.3);
    doc.rect(x, y, colW[0], rh);
    doc.setFontSize(9);
    doc.text(String(index + 1), x + colW[0] / 2, y + 5.5, { align: "center" });
    x += colW[0];
    doc.rect(x, y, colW[1], rh);
    doc.setFontSize(7.5);
    // Wrap text if too long
    const wrappedDesc = doc.splitTextToSize(item.desc, colW[1] - 4);
    doc.text(wrappedDesc, x + 2, y + 4);
    x += colW[1];
    doc.rect(x, y, colW[2], rh);
    doc.setFontSize(8);
    doc.text(item.batch, x + 2, y + 5.5);
    x += colW[2];
    doc.rect(x, y, colW[3], rh);
    doc.setFontSize(7);
    const wrappedPacking = doc.splitTextToSize(item.packingUnit, colW[3] - 2);
    doc.text(wrappedPacking, x + colW[3] / 2, y + 3.5, { align: "center" });
    x += colW[3];
    doc.rect(x, y, colW[4], rh);
    doc.setFontSize(9);
    doc.text(item.packedQty, x + colW[4] / 2, y + 5.5, { align: "center" });
    x += colW[4];
    doc.rect(x, y, colW[5], rh);
    doc.text(item.qtyPerPack, x + colW[5] / 2, y + 5.5, { align: "center" });
    x += colW[5];
    doc.rect(x, y, colW[6], rh);
    doc.text(item.qty, x + colW[6] / 2, y + 5.5, { align: "center" });
    x += colW[6];
    doc.rect(x, y, colW[7], rh);
    doc.text(item.unit, x + colW[7] / 2, y + 5.5, { align: "center" });
    return y + rh;
  };

  const drawTotal = (y, totalPackedQty, totalQty) => {
    const colW = [8, 67, 30, 25, 15, 15, 17, 13];
    const rh = 8;
    let x = page.m;
    const mergeW = colW[0] + colW[1] + colW[2] + colW[3];
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.setDrawColor(...c.border);
    doc.rect(x, y, mergeW, rh);
    doc.text(`TOTAL `, x + 3, y + 5.5);
    x += mergeW;
    doc.rect(x, y, colW[4], rh);
    doc.text(String(totalPackedQty), x + colW[4] / 2, y + 5.5, {
      align: "center",
    });
    x += colW[4];
    doc.rect(x, y, colW[5], rh);
    x += colW[5];
    doc.rect(x, y, colW[6], rh);
    doc.text(totalQty, x + colW[6] / 2, y + 5.5, { align: "center" });
    x += colW[6];
    doc.rect(x, y, colW[7], rh);
    doc.text("kG", x + colW[7] / 2, y + 5.5, { align: "center" });
    return y + rh;
  };

  // ══════════════════════════════════════════════════════════════════
  // drawSignatures — config se automatically decide hota hai
  // real images use hongi ya dummy shapes
  // ══════════════════════════════════════════════════════════════════
  const drawSignatures = (y) => {
    const sigAreaY = y;
    const m = page.m;
    const colW = (page.w - 2 * m) / 3;
    const col1X = m;
    const col2X = m + colW;
    const col3X = m + colW * 2;
    const cfg = SIGNATURE_STAMP_CONFIG;

    // ── COL 1: Receiver (blank box) ──
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...c.black);
    doc.text("RECEIVER'S SIGNATURE", col1X + colW / 2, sigAreaY + 4, {
      align: "center",
    });
    doc.setDrawColor(...c.border);
    doc.setLineWidth(0.4);
    doc.rect(col1X + 4, sigAreaY + 7, colW - 8, 18);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(160, 160, 160);
    doc.text("Sign & Stamp Here", col1X + colW / 2, sigAreaY + 17, {
      align: "center",
    });
    doc.setTextColor(...c.black);
    doc.setFontSize(7.5);
    doc.text("Name: ________________________", col1X + 4, sigAreaY + 30);
    doc.text("Date: _________________________", col1X + 4, sigAreaY + 35);

    // ── COL 2: Guard (blank box) ──
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...c.black);
    doc.text("CHECKED BY THE GUARD", col2X + colW / 2, sigAreaY + 4, {
      align: "center",
    });
    doc.setDrawColor(...c.border);
    doc.setLineWidth(0.4);
    doc.rect(col2X + 4, sigAreaY + 7, colW - 8, 18);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(160, 160, 160);
    doc.text("Guard Signature", col2X + colW / 2, sigAreaY + 17, {
      align: "center",
    });
    doc.setTextColor(...c.black);
    doc.setFontSize(7.5);
    doc.text("Name: ________________________", col2X + 4, sigAreaY + 30);
    doc.text("Time: __________________________", col2X + 4, sigAreaY + 35);

    // ── COL 3: Authorized Signatory ──
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(...c.black);
    doc.text("AUTHORIZED SIGNATORY", col3X + colW / 2, sigAreaY + 4, {
      align: "center",
    });

    const stampCX = col3X + colW / 2;
    const stampCY = sigAreaY + 19;

    if (cfg.USE_REAL_IMAGES) {
      // ══ REAL IMAGE MODE ══════════════════════════════════════════
      // Stamp image
      if (cfg.STAMP_BASE64) {
        doc.addImage(
          cfg.STAMP_BASE64,
          "PNG",
          stampCX - cfg.STAMP_WIDTH / 2, // center align karo
          sigAreaY + 7,
          cfg.STAMP_WIDTH,
          cfg.STAMP_HEIGHT,
        );
      }
      // Signature image (stamp ke neeche)
      if (cfg.SIGNATURE_BASE64) {
        doc.addImage(
          cfg.SIGNATURE_BASE64,
          "PNG",
          col3X + (colW - cfg.SIGNATURE_WIDTH) / 2, // center align
          sigAreaY + 7 + cfg.STAMP_HEIGHT + 2,
          cfg.SIGNATURE_WIDTH,
          cfg.SIGNATURE_HEIGHT,
        );
      }
    } else {
      // ══ DUMMY MODE (testing) ══════════════════════════════════════
      // Circular stamp
      const stampR = 12;
      doc.setDrawColor(...c.stampRed);
      doc.setLineWidth(1.2);
      doc.circle(stampCX, stampCY, stampR, "S");
      doc.setLineWidth(0.5);
      doc.circle(stampCX, stampCY, stampR - 2.5, "S");
      doc.setFont("helvetica", "bold");
      doc.setTextColor(...c.stampRed);
      doc.setFontSize(5);
      doc.text(
        (company?.name || "COMPANY NAME").toUpperCase().substring(0, 18),
        stampCX,
        stampCY - 5,
        { align: "center" },
      );
      doc.setFontSize(5.5);
      doc.text("AUTHORIZED", stampCX, stampCY, { align: "center" });
      doc.text("SIGNATORY", stampCX, stampCY + 4, { align: "center" });
      doc.setFontSize(4.5);
      doc.text(cfg.STAMP_DEPT_LABEL, stampCX, stampCY + 8, { align: "center" });

      // Cursive dummy signature
      doc.setTextColor(...c.black);
      doc.setDrawColor(20, 20, 120);
      doc.setLineWidth(0.6);
      doc.lines(
        [
          [6, -8, 10, -12, 14, -6],
          [4, 4, 8, 6, 12, 2],
          [4, -6, 8, -8, 12, -4],
          [4, 4, 6, 6, 10, 2],
          [4, -4, 8, -6, 12, -2],
        ],
        col3X + 4,
        sigAreaY + 30,
        [1, 1],
        null,
        false,
      );
    }

    // Underline + company name (dono modes mein same)
    doc.setDrawColor(...c.border);
    doc.setLineWidth(0.3);
    doc.line(col3X + 4, sigAreaY + 33, col3X + colW - 4, sigAreaY + 33);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(80, 80, 80);
    doc.text(
      (company?.name || "Company Name").toUpperCase(),
      col3X + colW / 2,
      sigAreaY + 37,
      { align: "center" },
    );
  };

  // ── Items ──
  const items =
    voucherData.transactions
      ?.filter((sub) => sub.sub_tran_id === 1)
      .map((line) => {
        const inkCode = line.itemDetails?.code || "";
        const itemName = line.itcd?.label || line.itemDetails?.item || "Unknown Item";
        const packing = line.packingDetails?.item ? `(${line.packingDetails.item})` : "";
        return {
          desc: [inkCode, itemName, packing].filter(Boolean).join(" "),
          batch: String(line.batch_no || line.narration5 || "-"),
          packingUnit: String(line.packingDetails?.item || "-"),
          packedQty: String(Number(line.no_of_pack) || 0),
          qtyPerPack: Number(line.qty_per_pack || 0).toFixed(2),
          qty: Number(line.qty || 0).toFixed(2),
          unit: String(line.unit_name || "KG"),
        };
      }) || [];

  const totalPackedQty = items.reduce(
    (s, i) => s + parseInt(i.packedQty || 0),
    0,
  );
  const totalQty = items
    .reduce((s, i) => s + parseFloat(i.qty || 0), 0)
    .toFixed(2);

  // ── Render ──
  y = page.m;
  y = drawHeader(y);
  y = drawTitle(y);
  y = drawInfo(y + 3);
  y = drawBuyerBox(y);
  y = drawTableHeader(y);

  const spaceForSignatures = 52;
  const addNewPage = () => {
    doc.addPage();
    let ny = page.m;
    ny = drawHeader(ny);
    ny = drawTitle(ny);
    return drawTableHeader(ny + 3);
  };

  for (let i = 0; i < items.length; i++) {
    const isLastItem = i === items.length - 1;
    const itemHeight = 8.5;
    // Buffer for total box (8mm) and signatures (~50mm)
    const footerHeight = isLastItem ? 60 : 8.5; 

    if (y + itemHeight + footerHeight > page.h - page.m) {
      y = addNewPage();
    }
    y = drawItem(y, items[i], i);
  }

  if (items.length > 0) {
    y = drawTotal(y, totalPackedQty, totalQty);
  } else {
    y = drawTotal(y, 0, "0.00");
  }

  drawSignatures(page.h - page.m - 48);

  if (mode === "print") {
    doc.autoPrint();
    window.open(doc.output("bloburl"), "_blank");
  }
  return doc;
};
