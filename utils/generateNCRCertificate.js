import jsPDF from "jspdf";
import autoTable from "jspdf-autotable";

export default async function generateNCRCertificate({
  companyName = "Company",
  logoUrl = "",
  ncrTitle = "NON CONFIRMITY REQUEST FORM",
  batchNumber,
  inkCode,
  manufacturingDate,
  batchSize,
  testResults,
  rejectReason,
  rootCause = "",
  correction = "",
  correctiveAction = "",
  actionForImplementation = "",
  preventiveActionRequired = "NO",
  responsibility = "",
  targetDate = "",
  verifiedEffectiveness = "",
  capaEffective = "No",
  plantHeadSignature = "",
  closingDate = "",
  departmentName, // NEW: Department name for badge
  mode = "download", // "download", "print", or "preview"
}) {
  const doc = new jsPDF("p", "mm", "a4");
  doc.setFont("helvetica", "normal");

  /* ============ GLOBAL STYLES - SAME AS QC CERTIFICATE ============ */
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
  doc.setFillColor(220, 53, 69); // Red color for NCR
  doc.circle(badgeX, badgeY, 3, "F");

  // Draw letter
  doc.setTextColor(255, 255, 255); // White text
  doc.setFontSize(10);
  doc.setFont("helvetica", "bold");
  doc.text(deptLetter, badgeX, badgeY + 1.5, { align: "center" });

  // Reset colors
  gray(0);

  /* ============ LOGO + HEADER - SAME AS QC CERTIFICATE ============ */
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
  doc.text(ncrTitle, 105, 29, { align: "center" });

  /* ============ FORM SECTIONS - SAME STYLE AS QC CERTIFICATE ============ */
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
    const lines = doc.splitTextToSize(String(text || ""), w - 4);
    doc.text(lines, x + innerPad, y + 4);
  };

  let yPos = 35;

  // DETAILS Section
  chip(15, yPos, 180, 7, "DETAILS:");
  valueBox(15, yPos + 7, 180, 30, rejectReason);
  yPos += 37;

  // ROOT CAUSE Section
  chip(15, yPos, 180, 7, "ROOT CAUSE:");
  valueBox(15, yPos + 7, 180, 25, rootCause);
  yPos += 32;

  // CORRECTION Section
  chip(15, yPos, 180, 7, "CORRECTION:");
  valueBox(15, yPos + 7, 180, 25, correction);
  yPos += 32;

  // CORRECTIVE ACTION Section
  chip(15, yPos, 180, 7, "CORRECTIVE ACTION:");
  valueBox(15, yPos + 7, 180, 25, correctiveAction);
  yPos += 32;

  // ACTION FOR IMPLEMENTATION Section
  chip(15, yPos, 180, 7, "ACTION FOR IMPLEMENTATION:");
  valueBox(15, yPos + 7, 180, 12, actionForImplementation);
  yPos += 19;

  /* ============ PREVENTIVE ACTION ROW ============ */
  chip(15, yPos, 120, 7, "PROPOSED PREVENTIVE ACTION REQUIRED:");

  // YES checkbox
  const checkboxX = 137;
  fillGray(255);
  drawGray(140);
  doc.rect(checkboxX, yPos + 1, 4, 4);
  gray(0);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("YES", checkboxX + 6, yPos + 4.5);
  if (preventiveActionRequired === "YES") {
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("✓", checkboxX + 0.5, yPos + 4);
  }

  // NO checkbox
  const noCheckboxX = checkboxX + 20;
  fillGray(255);
  drawGray(140);
  doc.rect(noCheckboxX, yPos + 1, 4, 4);
  gray(0);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("NO", noCheckboxX + 6, yPos + 4.5);
  if (preventiveActionRequired === "NO") {
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("✓", noCheckboxX + 0.5, yPos + 4);
  }

  yPos += 7;

  /* ============ RESPONSIBILITY & TARGET DATE ROW ============ */
  chip(15, yPos, 90, 7, "RESPONSIBILITY:");
  valueBox(15, yPos + 7, 90, 8, responsibility);

  chip(105, yPos, 90, 7, "TARGET DATE:");
  valueBox(105, yPos + 7, 90, 8, targetDate);

  yPos += 15;

  /* ============ VERIFIED FOR EFFECTIVENESS ============ */
  chip(15, yPos, 180, 7, "VERIFIED FOR EFFECTIVENESS:");
  fillGray(255);
  drawGray(140);
  doc.rect(15, yPos + 7, 180, 15);

  gray(0);
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  doc.text("Note: Check complaint repetition / frequency in previous months.", 17, yPos + 11);

  // CAPA FOUND EFFECTIVE
  doc.setFontSize(9);
  doc.setFont("helvetica", "bold");
  doc.text("CAPA FOUND EFFECTIVE:", 17, yPos + 17);

  // Yes checkbox
  const capaYesX = 65;
  fillGray(255);
  drawGray(140);
  doc.rect(capaYesX, yPos + 13, 4, 4);
  gray(0);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("Yes", capaYesX + 6, yPos + 16.5);
  if (capaEffective === "Yes") {
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("✓", capaYesX + 0.5, yPos + 16);
  }

  // No checkbox
  const capaNoX = capaYesX + 18;
  fillGray(255);
  drawGray(140);
  doc.rect(capaNoX, yPos + 13, 4, 4);
  gray(0);
  doc.setFontSize(9);
  doc.setFont("helvetica", "normal");
  doc.text("No", capaNoX + 6, yPos + 16.5);
  if (capaEffective === "No") {
    doc.setFontSize(11);
    doc.setFont("helvetica", "bold");
    doc.text("✓", capaNoX + 0.5, yPos + 16);
  }

  yPos += 22;

  /* ============ FINAL ROW - SIGNATURE & CLOSING DATE ============ */
  chip(15, yPos, 90, 7, "PLANT HEAD'S SIGNATURE:");
  valueBox(15, yPos + 7, 90, 12, plantHeadSignature);

  chip(105, yPos, 90, 7, "CORRECTIVE ACTION CLOSING DATE:");
  valueBox(105, yPos + 7, 90, 12, closingDate);

  // Add batch info at bottom for reference
  yPos += 25;
  doc.setFontSize(8);
  doc.setFont("helvetica", "italic");
  gray(100);
  doc.text(`Batch #: ${batchNumber || "N/A"} | Ink Code: ${inkCode || "N/A"} | Mfg Date: ${manufacturingDate || "N/A"} | Batch Size: ${batchSize || "N/A"} KG`,
    105, yPos, { align: "center" });

  if (mode === "print") {
    doc.autoPrint();
    window.open(doc.output("bloburl"), "_blank");
  } else if (mode === "preview") {
    return doc;
  } else {
    doc.save(`NCR-Report-${batchNumber || "NA"}.pdf`);
  }
}