import axios from "axios";
import { jsPDF } from "jspdf";
import { format } from "date-fns";

// Goods Receipt Note (GRN, tran_code 4) — the purchase document: what was
// received, from whom, against which PO / vendor bill, and its value.
export const generateGRNPDF = async (
  voucherId,
  session = null,
  currency,
  company
) => {
  const id = typeof voucherId === "object" ? voucherId.tran_id || voucherId.voucherId || voucherId.id : voucherId;
  const res = await axios.get(`/api/voucher/grn?id=${id}`);
  const voucherData = res.data?.data?.[0] || {};

  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const W = 210;
  const H = 297;
  const m = 10;

  const maroon = [128, 0, 32];
  const headerGray = [240, 240, 240];
  const lightGray = [230, 230, 230];
  const border = [150, 150, 150];

  let x = 0;
  let y = 0;

  const formatDate = (dateStr) => {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return "";
    return `${String(d.getDate()).padStart(2, "0")}-${d
      .toLocaleString("en-US", { month: "short" })
      .toUpperCase()}-${String(d.getFullYear()).slice(-2)}`;
  };
  const num = (n, digits = 2) =>
    (Number(n) || 0).toLocaleString("en-US", {
      minimumFractionDigits: digits,
      maximumFractionDigits: digits,
    });
  const qtyFmt = (n) =>
    (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 3 });
  const fit = (text, width) => {
    const lines = doc.splitTextToSize(String(text ?? ""), width);
    return lines.length > 1 ? `${lines[0].replace(/\s+$/, "")}...` : lines[0] || "";
  };

  const companyName = company?.name || "";

  // ===== HEADER =====
  const topGap = 5;
  const barHeight = 14;
  const centerX = m + (W - 2 * m) / 2;

  doc.setFillColor(...maroon);
  doc.rect(m, topGap, W - 2 * m, barHeight, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(companyName, centerX, topGap + barHeight / 2 + 2, { align: "center" });

  const boxY = 22;
  const boxH = 10;
  doc.setFillColor(0, 0, 0);
  doc.rect(m, boxY, W - 2 * m, boxH, "F");
  doc.setFontSize(14);
  doc.text("GOODS RECEIPT NOTE", centerX, boxY + boxH / 2 + 2, { align: "center" });

  // ===== INFO TABLE =====
  const rowH = 7;
  const labelW = 32;
  const valueW = 58;
  const gap = 10;
  const leftX = m;
  const rightX = m + labelW + valueW + gap;

  doc.setFontSize(9);
  doc.setLineWidth(0.3);
  doc.setDrawColor(...border);
  doc.setTextColor(0, 0, 0);

  const cell = (cx, cy, label, value) => {
    doc.setFont("helvetica", "bold");
    doc.setFillColor(...lightGray);
    doc.rect(cx, cy, labelW, rowH, "FD");
    doc.text(label, cx + 2, cy + 4.8);
    doc.setFont("helvetica", "normal");
    doc.setFillColor(255, 255, 255);
    doc.rect(cx + labelW, cy, valueW, rowH, "FD");
    doc.text(fit(value || "-", valueW - 4), cx + labelW + 2, cy + 4.8);
  };

  const godownName = voucherData.godownDetails?.godown
    ? `${voucherData.godown} - ${voucherData.godownDetails.godown}`
    : voucherData.godown;
  const rows = [
    ["GRN No", voucherData.grn_no, "Date", formatDate(voucherData.dated)],
    ["PO No", voucherData.po_no, "Godown", godownName],
    ["Vendor DC No", voucherData.rmk3, "Vehicle No", voucherData.rmk4],
    ...(voucherData.manual_no ? [["Manual GRN No", voucherData.manual_no, null, null]] : []),
  ];
  y = 37;
  for (const [l1, v1, l2, v2] of rows) {
    cell(leftX, y, l1, v1 != null ? String(v1) : "");
    if (l2) cell(rightX, y, l2, v2 != null ? String(v2) : "");
    y += rowH;
  }
  y += 3;

  // VENDOR BOX
  const vendorH = 14;
  doc.roundedRect(m, y, W - 2 * m, vendorH, 2.5, 2.5);
  doc.setFont("helvetica", "bold");
  doc.text("Vendor :", m + 3, y + 5.5);
  doc.text("Address :", m + 3, y + 11);
  doc.setFont("helvetica", "normal");
  doc.text(fit(voucherData.acno?.acname || "", W - 2 * m - 30), m + 25, y + 5.5);
  doc.text(fit(voucherData.acno?.address || "", W - 2 * m - 30), m + 25, y + 11);
  y += vendorH + 4;

  // ===== LINES =====
  // Quantity only: a GRN carries no rate — it is priced on Purchase Invoicing.
  const colW = [9, 83, 26, 22, 22, 28]; // = 190
  const headers = [
    "Sr#",
    "DESCRIPTION OF GOODS",
    "Batch#",
    ["No of", "Packs"],
    ["Qty per", "Pack"],
    "Qty (KG)",
  ];
  const headerH = 11;

  const drawHeader = () => {
    x = m;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    headers.forEach((h, i) => {
      doc.setFillColor(...headerGray);
      doc.rect(x, y, colW[i], headerH, "FD");
      if (Array.isArray(h)) {
        doc.text(h, x + colW[i] / 2, y + 4.5, { align: "center" });
      } else {
        doc.text(h, x + colW[i] / 2, y + headerH / 2 + 1.5, { align: "center" });
      }
      x += colW[i];
    });
    y += headerH;
    doc.setFont("helvetica", "normal");
  };
  drawHeader();

  let totalPacks = 0;
  let totalQty = 0;
  const lineH = 7;

  (voucherData.transactions || [])
    .filter((t) => (t.sub_tran_id ?? 1) === 1)
    .forEach((line, index) => {
      if (y + lineH > H - 40) {
        doc.addPage();
        y = 15;
        drawHeader();
      }
      const itemName = [line.itemDetails?.code, line.itemDetails?.item].filter(Boolean).join(" - ");
      const packs = Number(line.no_of_pack) || 0;
      const perPack = Number(line.qty_per_pack) || 0;
      const qty = Number(line.qty) || 0;

      totalPacks += packs;
      totalQty += qty;

      const values = [
        { t: String(index + 1), a: "center" },
        { t: fit(itemName, colW[1] - 3), a: "left" },
        { t: fit(line.batch_no || "-", colW[2] - 2), a: "center" },
        { t: qtyFmt(packs), a: "center" },
        { t: qtyFmt(perPack), a: "center" },
        { t: qtyFmt(qty), a: "right" },
      ];
      x = m;
      values.forEach((v, i) => {
        doc.rect(x, y, colW[i], lineH);
        const tx = v.a === "left" ? x + 1.5 : v.a === "right" ? x + colW[i] - 1.5 : x + colW[i] / 2;
        doc.text(v.t, tx, y + 4.8, { align: v.a });
        x += colW[i];
      });
      y += lineH;
    });

  // ===== TOTALS =====
  doc.setFont("helvetica", "bold");
  x = m;
  const mergeW = colW[0] + colW[1] + colW[2];
  doc.rect(x, y, mergeW, lineH);
  doc.text("TOTAL", x + 2, y + 4.8);
  x += mergeW;
  doc.rect(x, y, colW[3], lineH);
  doc.text(qtyFmt(totalPacks), x + colW[3] / 2, y + 4.8, { align: "center" });
  x += colW[3];
  doc.rect(x, y, colW[4], lineH);
  x += colW[4];
  doc.rect(x, y, colW[5], lineH);
  doc.text(qtyFmt(totalQty), x + colW[5] - 1.5, y + 4.8, { align: "right" });
  y += lineH;

  if (voucherData.rmk) {
    y += 4;
    doc.setFont("helvetica", "bold");
    doc.text("Narration:", m, y);
    doc.setFont("helvetica", "normal");
    doc.text(fit(voucherData.rmk, W - 2 * m - 22), m + 20, y);
  }

  // ===== FOOTER =====
  const printedBy = session?.user?.name || "System";
  const printedOn = format(new Date(), "d-MMM-yyyy HH:mm");
  const sigY = Math.max(y + 25, H - 25);
  if (sigY > H - 10) doc.addPage();
  const footY = sigY > H - 10 ? H - 25 : sigY;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("RECEIVER'S SIGNATURE", m, footY);
  doc.text(companyName, W - m, footY, { align: "right" });
  doc.setFontSize(7);
  doc.setTextColor(120, 120, 120);
  doc.text(`Printed by ${printedBy} on ${printedOn}`, m, footY + 8);

  return doc;
};
