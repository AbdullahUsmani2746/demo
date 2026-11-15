import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export default async function generateQCCertificate({
  companyName = "Company",
  logoUrl = "",
  title = "QUALITY ASSURANCE CERTIFICATE",
  manufacturingDate,
  expiryDate,
  batchNumber,
  inkCode,
  customer,
  batchSize,
  testResults,
  comments,
  approvedBy,
  departmentName, // NEW: Department name for badge
  mode = "download", // "download", "print", or "preview"
}) {
  const doc = new jsPDF("p", "mm", "a4");
  doc.setFont("helvetica", "normal");

  /* ============ GLOBAL STYLES ============ */
  const gray = (g) => doc.setTextColor(g, g, g);
  const drawGray = (g) => doc.setDrawColor(g, g, g);
  const fillGray = (g) => doc.setFillColor(g, g, g);
  drawGray(120);
  doc.setLineWidth(0.1);

  /* ============ DEPARTMENT BADGE (TOP-RIGHT) ============ */
  const getDepartmentLetter = (deptName) => {
    if (!deptName) return "N/A";
    const dept = deptName.toLowerCase().trim();
    if (dept.includes("lab") || dept.includes("quality") || dept.includes("qc")) return "Q";
    if (dept.includes("production") || dept.includes("manufacturing")) return "P";
    if (dept.includes("store") || dept.includes("warehouse")) return "S";
    return deptName.charAt(0).toUpperCase();
  };

  const deptLetter = getDepartmentLetter(departmentName);
  const badgeX = 200;
  const badgeY = 8;

  // Draw circular badge
  doc.setFillColor(34, 139, 34); // Green color
  doc.circle(badgeX, badgeY, 3, "F");

  // Draw letter
  doc.setTextColor(255, 255, 255); // White text
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(deptLetter, badgeX, badgeY + 1.5, { align: "center" });

  // Reset colors
  gray(0);

  /* ============ LOGO + HEADER ============ */
  try {
    const possiblePaths = [logoUrl, "/logo/logo.jpeg"].filter(Boolean);

    let logo = null;
    for (const path of possiblePaths) {
      try {
        const response = await fetch(path);
        if (response.ok) {
          const blob = await response.blob();
          logo = await new Promise((res) => {
            const fr = new FileReader();
            fr.onload = () => res(fr.result);
            fr.readAsDataURL(blob);
          });
          break;
        }
      } catch { }
    }

    if (logo) {
      // Logo - positioned before company name
      doc.addImage(logo, "png", 55, 14, 10, 10);

      // Company name - right after logo
      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      gray(0);
      doc.text(companyName, 68, 21);
    } else {
      console.warn("Logo not found in any of the expected locations");
      // Fallback: Just show company name centered if no logo
      doc.setFontSize(16);
      doc.setFont("helvetica", "bold");
      gray(0);
      doc.text(companyName, 105, 21, { align: "center" });
    }
  } catch (error) {
    console.error("Failed to load logo:", error);
    // Fallback: Just show company name centered if error
    doc.setFontSize(16);
    doc.setFont("helvetica", "bold");
    gray(0);
    doc.text(companyName, 105, 21, { align: "center" });
  }

  // Title
  doc.setFontSize(11);
  doc.setFont("helvetica", "bold");
  gray(0);
  doc.text(title, 105, 29, { align: "center" });

  /* ============ FORM FIELDS ============ */
  const innerPad = 2;
  const chip = (x, y, w, h, text, align = "") => {
    fillGray(220);
    drawGray(140);
    doc.rect(x, y, w, h, "FD");
    gray(0);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    const tx = align === "center" ? x + w / 2 : x + innerPad;
    doc.text(String(text), tx, y + h / 2 + 1.5, { align });
  };

  const valueBox = (x, y, w, h, text = "") => {
    fillGray(255);
    drawGray(140);
    doc.rect(x, y, w, h);
    gray(0);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(String(text || ""), x + w / 2, y + h / 2 + 1.5, {
      align: "center",
    });
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "N/A";
    const date = new Date(dateStr);
    if (isNaN(date.getTime())) return dateStr;
    const day = String(date.getDate()).padStart(2, "0");
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  };

  // Manufacturing Date & Expiry Date
  chip(15, 35, 45, 7, "Manufacturing Date");
  valueBox(60, 35, 30, 7, formatDate(manufacturingDate));

  chip(15, 42, 45, 7, "Expiry Date");
  valueBox(60, 42, 30, 7, formatDate(expiryDate));

  // Batch # (right column)
  chip(145, 35, 25, 7, "Batch #", "center");
  valueBox(170, 35, 25, 7, batchNumber);

  // Ink Code row
  chip(15, 52, 60, 7, "Ink Code with Description");
  valueBox(75, 52, 120, 7, inkCode);

  // Batch Size row
  chip(15, 59, 60, 7, "Batch Size (KG)");
  valueBox(75, 59, 30, 7, batchSize);

  const tableStartY = 78;

  /* ============ DELTA (Δ) RENDERING HELPER ============
   * jsPDF's built-in Helvetica has no Greek Δ (U+0394) glyph, so it silently
   * drops. We draw such cells manually: Δ is rendered via the built-in Symbol
   * font (where the byte "D" maps to uppercase Delta) and the rest in Helvetica. */
  const drawMixedText = (cell) => {
    const raw = String(cell.raw ?? "");
    const fontSize = cell.styles.fontSize || 9;
    const fontStyle = cell.styles.fontStyle || "normal";
    doc.setFontSize(fontSize);
    doc.setTextColor(0, 0, 0);

    // Split into runs of Δ vs. non-Δ characters
    const runs = [];
    for (const ch of raw) {
      const isDelta = ch === "Δ";
      const last = runs[runs.length - 1];
      if (last && last.delta === isDelta) {
        last.t += isDelta ? "D" : ch; // Symbol "D" == Δ
      } else {
        runs.push({ t: isDelta ? "D" : ch, delta: isDelta });
      }
    }

    // Measure total width using the correct font per run
    let total = 0;
    for (const run of runs) {
      if (run.delta) doc.setFont("Symbol", "normal");
      else doc.setFont("helvetica", fontStyle);
      total += doc.getTextWidth(run.t);
    }

    // Draw centered within the cell
    let x = cell.x + cell.width / 2 - total / 2;
    const baselineY = cell.y + cell.height / 2 + 1.2;
    for (const run of runs) {
      if (run.delta) doc.setFont("Symbol", "normal");
      else doc.setFont("helvetica", fontStyle);
      doc.text(run.t, x, baselineY);
      x += doc.getTextWidth(run.t);
    }

    doc.setFont("helvetica", "normal");
  };

  /* ============ TEST TABLE ============ */
  autoTable(doc, {
    startY: tableStartY,
    head: [["Test Description", "Standards", "Result"]],
    body: (testResults || []).map((r) => [
      String(r.parameter || ""),
      String(r.standard || ""),
      String(r.result || ""),
    ]),
    didParseCell: (data) => {
      // Suppress default (broken) drawing for cells containing Δ
      if (data.section === "body" && String(data.cell.raw ?? "").includes("Δ")) {
        data.cell.text = [""];
      }
    },
    didDrawCell: (data) => {
      if (data.section === "body" && String(data.cell.raw ?? "").includes("Δ")) {
        drawMixedText(data.cell);
      }
    },
    styles: {
      font: "helvetica",
      fontSize: 9,
      lineWidth: 0.15,
      lineColor: [140, 140, 140],
      cellPadding: { top: 2.5, right: 2, bottom: 2.5, left: 2 },
      halign: "center",
      valign: "middle",
    },
    headStyles: {
      fillColor: [220, 220, 220],
      textColor: 0,
      fontStyle: "bold",
      halign: "center",
      lineWidth: 0.15,
      lineColor: [140, 140, 140],
    },
    bodyStyles: {
      fillColor: [255, 255, 255],
    },
    alternateRowStyles: {
      fillColor: [255, 255, 255],
    },
    theme: "grid",
    margin: { left: 15, right: 15 },
    tableWidth: 180,
    columnStyles: {
      0: { cellWidth: 60, halign: "center" },
      1: { cellWidth: 85, halign: "center" },
      2: { cellWidth: 35, halign: "center" },
    },
  });

  const y = doc.lastAutoTable.finalY + 20;

  /* ============ BOTTOM SECTION ============ */

  // Left section
  const leftWidth = 100;
  chip(15, y, leftWidth, 7, "COMMENTS BY QC", "center");
  fillGray(255);
  drawGray(140);
  doc.roundedRect(15, y + 8, leftWidth, 25, 2, 2);

  // Approved By
  const y2 = y + 40;
  chip(15, y2, leftWidth, 7, "APPROVED BY");
  fillGray(255);
  drawGray(140);
  doc.rect(15, y2 + 8, leftWidth, 12);
  // Render approved by name
  gray(0);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text(String(approvedBy || ""), 15 + leftWidth / 2, y2 + 8 + 7, { align: "center" });

  // Right section
  drawGray(140);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);

  const pageWidth = doc.internal.pageSize.getWidth();
  const rightMargin = 15;
  const approvedWidth = 50;
  const approvedX = pageWidth - rightMargin - approvedWidth;

  doc.rect(approvedX, y, approvedWidth, 7, "S");

  doc.text("APPROVED", approvedX + approvedWidth / 2, y + 7 / 2 + 1.5, {
    align: "center",
  });

  if (mode === "print") {
    doc.autoPrint();
    window.open(doc.output("bloburl"), "_blank");
  } else if (mode === "preview") {
    return doc;
  } else {
    doc.save(`QC-Certificate-${batchNumber || "NA"}.pdf`);
  }
}