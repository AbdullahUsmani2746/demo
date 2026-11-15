import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";

export const generateBOMCalculationPDF = (
  bom,
  typedQty,
  session,
  company,
  customerName = "",
  printType = "",
  saleOrderNo = "",
  note = ""
) => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const W = 210;
  const m = 10;

  const maroon = [128, 0, 32];
  const titleGray = [100, 100, 100];
  const lightGray = [245, 245, 245];

  let y = 2;

  // ===== HEADER =====
  const drawHeader = () => {
    const topGap = 5;
    const barHeight = 12;
    const centerX = m + (W - 2 * m) / 2;

    doc.setFillColor(...maroon);
    doc.rect(m, topGap, W - 2 * m, barHeight, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text(company?.name || "Company", centerX, topGap + barHeight / 2 + 2, {
      align: "center",
    });

    y = topGap + barHeight + 3;

    const titleBoxH = 10;
    doc.setFillColor(...titleGray);
    doc.rect(m, y, W - 2 * m, titleBoxH, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("PROCESS ORDER - FORMULA ISSUED BY LAB", centerX, y + titleBoxH / 2 + 2, {
      align: "center",
    });

    y += titleBoxH + 5;
  };

  drawHeader();

  // ===== Extract data =====
  // The first row prints the customer this BOM is being issued for, chosen on
  // the view screen before printing. It replaces the old "Material Code" box —
  // the product is already identified by Ink Code and Material Description.
  const customer = String(customerName || bom.customer_name || "").trim();
  const materialDesc = bom.product_name || "";
  // Try various fallbacks for Ink Code and Master Sample
  const inkCode = bom.item?.code || bom.product_code || "";
  const masterSample = bom.item?.alternate_id || bom.alternate_id || "";
  const dated = new Date().toLocaleDateString("en-GB");

  // ===== Info Rows (Aligned Layout) =====
  const rowH = 7;
  const labelW = 40;
  const valueW = 85; // Left values width
  const rightLabelW = 25;
  const rightValueW = 40;

  let x = m;

  // Row 1: Customer Name or Print Type & Date
  doc.setFillColor(220, 220, 220);
  doc.rect(x, y, labelW, rowH, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  
  const labelText = printType ? "Print Type" : "Customer Name";
  const valText = printType || customer;

  doc.text(labelText, x + 2, y + 4.5);

  x += labelW;
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, valueW, rowH, "FD");
  doc.setFont("helvetica", "normal");
  // Long account names would otherwise run past the box and over the Date cell
  doc.setFontSize(8);
  doc.text(valText, x + 2, y + 4.5, { maxWidth: valueW - 4 });
  doc.setFontSize(9);

  // RIGHT: Date
  x = m + labelW + valueW;
  doc.setFillColor(220, 220, 220);
  doc.rect(x, y, rightLabelW, rowH, "FD");
  doc.setFont("helvetica", "bold");
  doc.text("Date", x + 2, y + 4.5);

  x += rightLabelW;
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, rightValueW, rowH, "FD");
  doc.setFont("helvetica", "normal");
  doc.text(dated, x + 2, y + 4.5);

  y += rowH;
  x = m;

  // Row 2: Material Description & Qty (Under Date)
  doc.setFillColor(220, 220, 220);
  doc.rect(x, y, labelW, rowH, "FD");
  doc.setFont("helvetica", "bold");
  doc.text("Material Description", x + 2, y + 4.5);

  x += labelW;
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, valueW, rowH, "FD");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(materialDesc, x + 2, y + 4.5, { maxWidth: valueW - 4 });

  // RIGHT: Qty (Under Date)
  x = m + labelW + valueW;
  doc.setFillColor(220, 220, 220);
  doc.rect(x, y, rightLabelW, rowH, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text("Qty", x + 2, y + 4.5);

  x += rightLabelW;
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, rightValueW, rowH, "FD");
  doc.setFont("helvetica", "normal");
  doc.text(String(typedQty) + " KG", x + 2, y + 4.5);

  y += rowH;
  x = m;

  // Row 3: Ink Code
  doc.setFillColor(220, 220, 220);
  doc.rect(x, y, labelW, rowH, "FD");
  doc.setFont("helvetica", "bold");
  doc.text("Ink Code", x + 2, y + 4.5);

  x += labelW;
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, valueW + rightLabelW + rightValueW, rowH, "FD"); // Span to end
  doc.setFont("helvetica", "normal");
  doc.text(String(inkCode), x + 2, y + 4.5);

  y += rowH;
  x = m;

  // Row 4: Master Sample
  doc.setFillColor(220, 220, 220);
  doc.rect(x, y, labelW, rowH, "FD");
  doc.setFont("helvetica", "bold");
  doc.text("Master Sample", x + 2, y + 4.5);

  x += labelW;
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, valueW, rowH, "FD");
  doc.setFont("helvetica", "normal");
  doc.text(String(masterSample), x + 2, y + 4.5);

  // RIGHT: Sale Order No (optional, chosen on the view screen)
  x = m + labelW + valueW;
  doc.setFillColor(220, 220, 220);
  doc.rect(x, y, rightLabelW, rowH, "FD");
  doc.setFont("helvetica", "bold");
  doc.text("SO No", x + 2, y + 4.5);

  x += rightLabelW;
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, rightValueW, rowH, "FD");
  doc.setFont("helvetica", "normal");
  doc.text(saleOrderNo ? String(saleOrderNo) : "", x + 2, y + 4.5);

  y += rowH + 10;

  // ===== TABLE HEADER =====
  // Columns: S.No | Code | Description (empty) | Percentage | Qty
  x = m;
  const colWidths = [15, 30, 70, 35, 40]; // total = 190 (matches W - 2*m)
  const headerH = 10;

  doc.setFillColor(220, 220, 220);
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);

  doc.rect(x, y, colWidths[0], headerH, "FD");
  doc.text("S.No", x + colWidths[0] / 2, y + 6, { align: "center" });
  x += colWidths[0];

  doc.setFillColor(220, 220, 220);
  doc.rect(x, y, colWidths[1], headerH, "FD");
  doc.text("Code", x + colWidths[1] / 2, y + 6, { align: "center" });
  x += colWidths[1];

  doc.setFillColor(220, 220, 220);
  doc.rect(x, y, colWidths[2], headerH, "FD");
  doc.text("Description", x + colWidths[2] / 2, y + 6, { align: "center" });
  x += colWidths[2];

  doc.setFillColor(220, 220, 220);
  doc.rect(x, y, colWidths[3], headerH, "FD");
  doc.text("Percentage", x + colWidths[3] / 2, y + 6, { align: "center" });
  x += colWidths[3];

  doc.setFillColor(220, 220, 220);
  doc.rect(x, y, colWidths[4], headerH, "FD");
  doc.text("Qty", x + colWidths[4] / 2, y + 6, { align: "center" });

  y += headerH;

  // ===== TABLE ROWS =====
  // Codes with letters first (A→Z, e.g. ENC13, ENC33, V-12734), then the
  // all-digit codes (1907, 1908, 2603). `numeric` sorts the digits inside a
  // code naturally (ENC9 before ENC13).
  const isNumericCode = (c) => /^\d+$/.test(String(c ?? "").trim());
  // bom.keepOrder: the rows were arranged by hand on the view screen — print as-is.
  const details = bom.keepOrder ? [...(bom.bom_details || [])] : [...(bom.bom_details || [])].sort((a, b) => {
    const ca = String(a.material_code ?? "").trim();
    const cb = String(b.material_code ?? "").trim();
    const na = isNumericCode(ca);
    const nb = isNumericCode(cb);
    if (na !== nb) return na ? 1 : -1;
    return ca.localeCompare(cb, undefined, { numeric: true, sensitivity: "base" });
  });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  let totalPercentage = 0;
  let totalQty = 0;

  // details.forEach((detail, idx) => {
  //   x = m;
  //   const percentage = parseFloat(detail.material_percentage || 0);
  //   const qty = ((percentage / 100) * typedQty).toFixed(2);

  //   totalPercentage += percentage;
  //   totalQty += parseFloat(qty);

  //   // Fixed row height since description is left empty
  //   const rowHeight = 8;

  //   // Draw cells
  //   doc.setDrawColor(150, 150, 150);

  //   // S.No
  //   doc.rect(x, y, colWidths[0], rowHeight, "D");
  //   doc.text(String(idx + 1), x + colWidths[0] / 2, y + rowHeight / 2 + 1, { align: "center" });
  //   x += colWidths[0];

  //   // Code
  //   doc.rect(x, y, colWidths[1], rowHeight, "D");
  //   doc.text(String(detail.material_code), x + colWidths[1] / 2, y + rowHeight / 2 + 1, { align: "center" });
  //   x += colWidths[1];

  //   // Description -> left empty on purpose
  //   doc.rect(x, y, colWidths[2], rowHeight, "D");
  //   x += colWidths[2];

  //   // Percentage
  //   doc.rect(x, y, colWidths[3], rowHeight, "D");
  //   doc.text(`${percentage.toFixed(2)}%`, x + colWidths[3] / 2, y + rowHeight / 2 + 1, { align: "center" });
  //   x += colWidths[3];

  //   // Qty
  //   doc.rect(x, y, colWidths[4], rowHeight, "D");
  //   doc.text(qty, x + colWidths[4] / 2, y + rowHeight / 2 + 1, { align: "center" });

  //   y += rowHeight;

  //   // Check for page break
  //   if (y > 270) {
  //     doc.addPage();
  //     y = 20;
  //   }
  // });
details.forEach((detail, idx) => {
    x = m;
    const percentage = parseFloat(detail.material_percentage || 0);
    const qty = ((percentage / 100) * typedQty).toFixed(3);

    totalPercentage += percentage;
    totalQty += parseFloat(qty);

    // Fixed row height since description is left empty
    const rowHeight = 8;

    // Draw cells
    doc.setDrawColor(150, 150, 150);

    // S.No
    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(0, 0, 0);
    doc.rect(x, y, colWidths[0], rowHeight, "D");
    doc.text(String(idx + 1), x + colWidths[0] / 2, y + rowHeight / 2 + 1, { align: "center" });
    x += colWidths[0];

    // Code
    doc.rect(x, y, colWidths[1], rowHeight, "D");
    doc.text(String(detail.material_code), x + colWidths[1] / 2, y + rowHeight / 2 + 1, { align: "center" });
    x += colWidths[1];

    // Description -> left empty on purpose
    doc.rect(x, y, colWidths[2], rowHeight, "D");
    x += colWidths[2];

    // Percentage — thora chota font
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7.5);
    doc.setTextColor(0, 0, 0);
    doc.rect(x, y, colWidths[3], rowHeight, "D");
    doc.setFontSize(7);
    doc.text(`${percentage.toFixed(3)}%`, x + colWidths[3] / 2, y + rowHeight / 2 + 1, { align: "center" });
    doc.setFontSize(9);
    x += colWidths[3];

    // Qty — bigger aur dark (bold black)
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.setTextColor(0, 0, 0);
    doc.rect(x, y, colWidths[4], rowHeight, "D");
    doc.text(qty, x + colWidths[4] / 2, y + rowHeight / 2 + 1, { align: "center" });

    y += rowHeight;

    // Check for page break
    if (y > 270) {
      doc.addPage();
      y = 20;
    }
  });
  // ===== TOTAL ROW =====
  if (y + 8 > 270) {
    doc.addPage();
    y = 20;
  }

  x = m;
  const totalRowH = 8;

  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setDrawColor(150, 150, 150);

  // ---- Total label (merged S.No + Code + Description) ----
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, colWidths[0] + colWidths[1] + colWidths[2], totalRowH, "F");
  doc.rect(x, y, colWidths[0] + colWidths[1] + colWidths[2], totalRowH, "S");
  doc.setTextColor(0, 0, 0);
  doc.text("Total", x + 4, y + totalRowH / 2 + 1);
  x += colWidths[0] + colWidths[1] + colWidths[2];

  // ---- Total Percentage ----
  doc.setFillColor(230, 230, 230);
  doc.rect(x, y, colWidths[3], totalRowH, "F");
  doc.rect(x, y, colWidths[3], totalRowH, "S");
  doc.setTextColor(0, 0, 0);
  doc.text(`${totalPercentage.toFixed(3)}%`, x + colWidths[3] / 2, y + totalRowH / 2 + 1, { align: "center" });
  x += colWidths[3];

  // ---- Total Qty ----
  doc.setFillColor(230, 230, 230);
  doc.rect(x, y, colWidths[4], totalRowH, "F");
  doc.rect(x, y, colWidths[4], totalRowH, "S");
  doc.setTextColor(0, 0, 0);
  doc.text(totalQty.toFixed(2), x + colWidths[4] / 2, y + totalRowH / 2 + 1, { align: "center" });

  y += totalRowH;

  // ===== NOTE (typed on the view screen, e.g. "22.50 = 25LTR / 135kg = 150LTR") =====
  const noteText = String(note || "").trim();
  if (noteText) {
    // Full-width box with a black border, just under the Total row
    y += 3;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.setTextColor(0, 0, 0);
    const noteLines = doc.splitTextToSize(noteText, W - 2 * m - 6);
    const noteH = 3 + noteLines.length * 5; // 8mm for one line, same as a table row
    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.2);
    doc.rect(m, y, W - 2 * m, noteH, "S");
    doc.text(noteLines, W / 2, y + 5.5, { align: "center" });
    y += noteH;
  }

  y += 15;

  if (y + 40 > 280) {
    doc.addPage();
    y = 20;
  }

  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.setTextColor(0, 0, 0);
  doc.setDrawColor(0, 0, 0);
  doc.setLineWidth(0.3);

  // Line 1: Comments
  doc.text("Comments", m, y);
  doc.line(m + 22, y + 1, W - m, y + 1);

  y += 15;

  // Line 2: Made By & Actual Yield
  doc.text("Made By", m, y);
  doc.line(m + 22, y + 1, m + 90, y + 1);

  doc.text("Actual Yield", m + 110, y);
  doc.line(m + 135, y + 1, W - m, y + 1);

  y += 15;

  // Line 3: Checked By & Tank No
  doc.text("Checked By", m, y);
  doc.line(m + 22, y + 1, m + 90, y + 1);

  doc.text("Tank No", m + 110, y);
  doc.line(m + 135, y + 1, W - m, y + 1);

  // ===== FOOTER: print day / date / time, bottom centre of every page =====
  // e.g. "Saturday October 10 2026 11:24 AM"
  const now = new Date();
  const datePart = now.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).replace(/,/g, "");
  const timePart = now.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", hour12: true });
  const printedAt = `${datePart} ${timePart}`;

  const pageH = doc.internal.pageSize.getHeight();
  const pageCount = doc.getNumberOfPages();
  for (let p = 1; p <= pageCount; p++) {
    doc.setPage(p);
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);
    doc.text(printedAt, W / 2, pageH - 8, { align: "center" });
  }

  return doc;
};