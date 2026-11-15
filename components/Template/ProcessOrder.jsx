// import { jsPDF } from "jspdf";

// export const generateProcessOrderPDF = (productionPlan) => {
//   const doc = new jsPDF({ unit: "mm", format: "a4" });

//   const W = 210; // A4 width
//   const m = 10; // margin

//   const maroon = [128, 0, 32];
//   const titleGray = [100, 100, 100];
//   const lightGray = [245, 245, 245];

//   let y = 0;

//   // ===== HEADER (Exact same as original) =====
//   const drawHeader = () => {
//     const topGap = 5;
//     const barHeight = 14;
//     const centerX = m + (W - 2 * m) / 2;

//     // Top Maroon Bar
//     doc.setFillColor(...maroon);
//     doc.rect(m, topGap, W - 2 * m, barHeight, "F");

//     doc.setTextColor(255, 255, 255);
//     doc.setFont("helvetica", "bold");
//     doc.setFontSize(16);
//     doc.text(companyName, centerX, topGap + barHeight / 2 + 2, {
//       align: "center",
//     });

//     y = topGap + barHeight + 5;

//     // Title Box - Process Order View
//     const titleBoxH = 12;
//     doc.setFillColor(...titleGray);
//     doc.rect(m, y, W - 2 * m, titleBoxH, "F");

//     doc.setTextColor(255, 255, 255);
//     doc.setFont("helvetica", "bold");
//     doc.setFontSize(16);
//     doc.text("Process Order View", centerX, y + titleBoxH / 2 + 2, {
//       align: "center",
//     });

//     y += titleBoxH + 8;
//   };

//   drawHeader();

//   // ===== Extract data (with fallbacks) =====
//   const materialCode = productionPlan.finished_id || "";
//   const materialDesc = productionPlan.productName || "";
//   const reqDelDate = productionPlan.req_del_date
//     ? new Date(productionPlan.req_del_date).toLocaleDateString("en-GB")
//     : "";
//   const batchNo = productionPlan.batch_no || "";
//   const plannedYield = productionPlan.qty || "";
//   const actualYield = productionPlan.actual_yield || "";
//   const viscosity = productionPlan.viscosity || "";
//   const salesOrderNo = productionPlan.sale_ord_no || "";
//   const machineInfo = productionPlan.machine_id || "";
//   const timeMin = productionPlan.time_min || "";

//   // ===== First Row: Material Code + Right Side (Required Delivery Date) =====
//   const rowH = 7;
//   let x = m;

//   // LEFT: Material Code Label
//   doc.setFillColor(200, 200, 200);
//   doc.rect(x, y, 40, rowH, "FD");
//   doc.setFont("helvetica", "bold");
//   doc.setFontSize(8.5);
//   doc.setTextColor(0, 0, 0);
//   doc.text("Material Code", x + 15, y + 4.5, { align: "center" });

//   x += 30;
//   // LEFT: Material Code Value
//   doc.setFillColor(255, 255, 255);
//   doc.rect(x, y, 30, rowH, "FD");
//   doc.setFont("helvetica", "normal");
//   doc.text(String(materialCode), x + 15, y + 4.5, { align: "center" });

//   // RIGHT: Required Delivery Date Label
//   x = m + 115;
//   doc.setFillColor(200, 200, 200);
//   doc.rect(x, y, 40, rowH, "FD");
//   doc.setFont("helvetica", "bold");
//   doc.setFontSize(8);
//   doc.text("Required Delivery Date", x + 20, y + 4.5, { align: "center" });

//   x += 40;
//   // RIGHT: Required Delivery Date Value
//   doc.setFillColor(255, 255, 255);
//   doc.rect(x, y, 25, rowH, "FD");
//   doc.setFont("helvetica", "normal");
//   doc.text(reqDelDate, x + 12.5, y + 4.5, { align: "center" });

//   y += rowH;

//   // ===== Second Row: Material Description + Right Side (Master Samples) =====
//   x = m;
//   doc.setFillColor(200, 200, 200);
//   doc.rect(x, y, 40, rowH, "FD");
//   doc.setFont("helvetica", "bold");
//   doc.setFontSize(8.5);
//   doc.text("Material Description", x + 2, y + 4.5);

//   x += 32;
//   doc.setFillColor(255, 255, 255);
//   doc.rect(x, y, 72, rowH, "FD");
//   doc.setFont("helvetica", "normal");
//   doc.setFontSize(7.5);
//   doc.text(materialDesc, x + 2, y + 4.5, { maxWidth: 68 });

//   // RIGHT: Master Samples Label
//   x = m + 115;
//   doc.setFillColor(200, 200, 200);
//   doc.rect(x, y, 40, rowH, "FD");
//   doc.setFont("helvetica", "bold");
//   doc.setFontSize(8);
//   doc.text("Master Samples", x + 5, y + 4.5);

//   x += 40;
//   // RIGHT: Master Samples Value
//   doc.setFillColor(255, 255, 255);
//   doc.rect(x, y, 25, rowH, "FD");
//   doc.setFont("helvetica", "normal");
//   doc.text(batchNo, x + 12.5, y + 4.5, { align: "center" });

//   y += rowH;

//   // ===== Third Row: Planned Yield =====
//   x = m + 115;
//   doc.setFillColor(200, 200, 200);
//   doc.rect(x, y, 40, rowH, "FD");
//   doc.setFont("helvetica", "bold");
//   doc.setFontSize(8);
//   doc.text("Planned Yield", x + 5, y + 5);

//   x += 40;
//   doc.setFillColor(255, 255, 255);
//   doc.rect(x, y, 25, rowH, "FD");
//   doc.setFont("helvetica", "normal");
//   doc.text(String(actualYield), x + 12.5, y + 5, { align: "center" });

//   y += rowH;

//   // ===== Fourth Row: Qty =====
//   x = m + 115;
//   doc.setFillColor(200, 200, 200);
//   doc.rect(x, y, 40, rowH, "FD");
//   doc.setFont("helvetica", "bold");
//   doc.setFontSize(8);
//   doc.text("Qty", x + 5, y + 5);

//   x += 40;
//   doc.setFillColor(255, 255, 255);
//   doc.rect(x, y, 25, rowH, "FD");
//   doc.setFont("helvetica", "normal");
//   doc.text(String(plannedYield), x + 12.5, y + 5, { align: "center" });

//   y += rowH;

//   // ===== Fifth Row: Plan # (Right side only - if exists) =====
//   if (productionPlan.id) {
//     x = m + 115;
//     doc.setFillColor(200, 200, 200);
//     doc.rect(x, y, 40, rowH, "FD");
//     doc.setFont("helvetica", "bold");
//     doc.setFontSize(8);
//     doc.text("Plan #", x + 5, y + 5);

//     x += 40;
//     doc.setFillColor(255, 255, 255);
//     doc.rect(x, y, 25, rowH, "FD");
//     doc.setFont("helvetica", "normal");
//     doc.text(String(productionPlan.id), x + 12.5, y + 5, { align: "center" });

//     y += rowH;
//   }

//   y += 3;

//   // ===== Fifth Row: Viscosity (full width left) =====
//   x = m;
//   doc.setFillColor(200, 200, 200);
//   doc.rect(x, y, 40, rowH, "FD");
//   doc.setFont("helvetica", "bold");
//   doc.setFontSize(8.5);
//   doc.text("Viscosity", x + 2, y + 4.5);

//   x += 20;
//   doc.setFillColor(255, 255, 255);
//   doc.rect(x, y, 65, rowH, "FD");
//   doc.setFont("helvetica", "normal");
//   doc.setFontSize(7.5);
//   doc.text(viscosity, x + 2, y + 4.5, { maxWidth: 60 });

//   y += rowH;

//   // ===== Sixth Row: Sales Order No (left) =====
//   x = m;
//   doc.setFillColor(200, 200, 200);
//   doc.rect(x, y, 45, rowH, "FD");
//   doc.setFont("helvetica", "bold");
//   doc.setFontSize(8.5);
//   doc.text("Sales Order No", x + 2, y + 4.5);

//   x += 30;
//   doc.setFillColor(255, 255, 255);
//   doc.rect(x, y, 35, rowH, "FD");
//   doc.setFont("helvetica", "normal");
//   doc.text(String(salesOrderNo), x + 2, y + 4.5);

//   y += rowH;

//   // ===== Seventh Row: Machine & Utilization (spanning) =====
//   x = m;
//   doc.setFillColor(200, 200, 200);
//   doc.rect(x, y, 40, rowH, "FD");
//   doc.setFont("helvetica", "bold");
//   doc.setFontSize(8);
//   doc.text("Machine & Utilization", x + 1, y + 4.5);

//   x += 30;
//   doc.setFillColor(255, 255, 255);
//   doc.rect(x, y, 55, rowH, "FD");
//   doc.setFont("helvetica", "normal");
//   doc.setFontSize(7.5);
//   doc.text(String(machineInfo), x + 2, y + 4.5);

//   x += 55;
//   doc.setFillColor(255, 255, 255);
//   doc.rect(x, y, 20, rowH, "FD");
//   doc.text(String(timeMin), x + 10, y + 4.5, { align: "center" });

//   y += rowH + 10;

//   // ===== Table Header (EXACT SAME AS ORIGINAL) =====
//   x = m;
//   const colWidths = [15, 25, 120, 30];
//   const headerH = 10;

//   doc.setFillColor(220, 220, 220);
//   doc.setFont("helvetica", "bold");
//   doc.setFontSize(9);

//   doc.setFillColor(220, 220, 220);
//   doc.rect(x, y, colWidths[0], headerH, "FD");
//   doc.text("S.No", x + colWidths[0] / 2, y + 6, { align: "center" });
//   x += colWidths[0];

//   doc.setFillColor(220, 220, 220);
//   doc.rect(x, y, colWidths[1], headerH, "FD");
//   doc.text("Component", x + colWidths[1] / 2, y + 6, { align: "center" });
//   x += colWidths[1];

//   doc.setFillColor(220, 220, 220);
//   doc.rect(x, y, colWidths[2], headerH, "FD");
//   doc.text("Component Description", x + colWidths[2] / 2, y + 6, {
//     align: "center",
//   });
//   x += colWidths[2];

//   doc.setFillColor(220, 220, 220);
//   doc.rect(x, y, colWidths[3], headerH, "FD");
//   doc.text("Qty", x + colWidths[3] / 2, y + 6, { align: "center" });

//   y += headerH;

//   // ===== Table Rows - DYNAMIC DATA =====
//   const details = productionPlan.productionPlanDetail || [];

//   doc.setFont("helvetica", "normal");
//   doc.setFontSize(8.5);

//   details.forEach((detail, idx) => {
//     x = m;
//     const rowHeight =
//       detail.material_desc && detail.material_desc.length > 50 ? 10 : 8;

//     // Alternate row coloring
//     if (idx % 2 === 1) {
//       doc.setFillColor(...lightGray);
//       doc.rect(m, y, W - 2 * m, rowHeight, "F");
//     }

//     // S.No
//     doc.setDrawColor(150, 150, 150);
//     doc.rect(x, y, colWidths[0], rowHeight, "D");
//     doc.setTextColor(0, 0, 0);
//     doc.text(String(detail.sno || idx + 1), x + colWidths[0] / 2, y + 5.5, {
//       align: "center",
//     });
//     x += colWidths[0];

//     // Component
//     doc.rect(x, y, colWidths[1], rowHeight, "D");
//     if (detail.material_id) {
//       doc.text(String(detail.material_id), x + 2, y + 5.5);
//     }
//     x += colWidths[1];

//     // Description - Red for instructions (no material_id)
//     doc.rect(x, y, colWidths[2], rowHeight, "D");
//     const description = detail.material_desc || "";

//     if (!detail.material_id && description) {
//       doc.setTextColor(200, 0, 0); // 🔴 instruction
//     } else {
//       doc.setTextColor(0, 0, 0); // ⚫ normal text
//     }

//     doc.text(description, x + 2, y + 5.5, {
//       maxWidth: colWidths[2] - 4,
//     });
//     x += colWidths[2];

//     doc.setTextColor(0, 0, 0); // reset back to black

//     // Qty
//     doc.rect(x, y, colWidths[3], rowHeight, "D");
//     if (detail.material_qty) {
//       doc.text(String(detail.material_qty), x + colWidths[3] / 2, y + 5.5, {
//         align: "center",
//       });
//     }

//     y += rowHeight;
//   });

//   y += 15;

//   // ===== Footer Section (EXACT SAME AS ORIGINAL) =====
//   doc.setFont("helvetica", "normal");
//   doc.setFontSize(10);
//   doc.text(
//     "Comments ________________________________________________________________________",
//     m,
//     y
//   );
//   y += 15;

//   doc.text("Made By _________________________________", m, y);
//   doc.text("Checked By _________________________________", m, y + 10);

//   doc.text("Actual Yield _____________________________", m + 100, y);
//   doc.text("Tank No. _________________________________", m + 100, y + 10);

//   return doc;
// };

// second AI code


import { jsPDF } from "jspdf";
import autoTable from "jspdf-autotable";
import { useState } from "react";
import { useEffect } from "react";

export const generateProcessOrderPDF = (productionPlan, items = {}, instruction = {}, text="", company = null) => {


  console.log(items);
  console.log(instruction);

  const qcResults = items?.item_qualities || [];
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
    doc.text(company?.name || company?.company || "Company", centerX, topGap + barHeight / 2 + 2, {
      align: "center",
    });

    y = topGap + barHeight + 3;

    const titleBoxH = 10;
    doc.setFillColor(...titleGray);
    doc.rect(m, y, W - 2 * m, titleBoxH, "F");

    doc.setTextColor(255, 255, 255);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.text("Process Order" + " " + text, centerX, y + titleBoxH / 2 + 2, {
      align: "center",
    });

    y += titleBoxH + 5;
  };

  drawHeader();

  // ===== Extract data =====
  const materialCode = productionPlan.finished_id || "";
  const materialDesc = productionPlan.productName || items.item || "";
  const reqDelDate = productionPlan.req_del_date
    ? new Date(productionPlan.req_del_date).toLocaleDateString("en-GB")
    : "";
  const batchNo = productionPlan.batch_no || "";
  const plannedYield = productionPlan.qty || "";
  const actualYield = productionPlan.actual_yield || "";
  const viscosity = productionPlan.viscosity || "";
  const salesOrderNo = productionPlan.sale_ord_no || "";
  // const machineInfo = instruction.machine_id || "";
  // const machineName = instruction.item.item || "";
  // const timeMin = productionPlan.time_min || "";
  const material_sample = items.alternate_id || "";
  const masterInkCode = items.code || "";
  const mfgDate = productionPlan.mfg_date 
    ? new Date(productionPlan.mfg_date).toLocaleDateString("en-GB") 
    : "";
  const expiryDate = productionPlan.exp_date 
    ? new Date(productionPlan.exp_date).toLocaleDateString("en-GB") 
    : "";
  const formattedDated = productionPlan.dated
    ? new Date(productionPlan.dated).toLocaleDateString("en-GB")
    : "";

  // ===== Info Rows (compact spacing) =====
  const rowH = 4;
  let x = m;

  // Helper to check if a value has actual data (allowing 0)
  const hasData = (val) => val !== null && val !== undefined && String(val).trim() !== "" && String(val).trim().toLowerCase() !== "null";

  // Row 1: Material Code & Required Delivery Date
  x = m;
  doc.setFillColor(200, 200, 200);
  doc.rect(x, y, 40, rowH, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.setTextColor(0, 0, 0);
  doc.text("Material Code", x + 11, y + 3, { align: "center" });

  x += 30;
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, 30, rowH, "FD");
  doc.setFont("helvetica", "normal");
  doc.text(String(materialCode ?? ""), x + 15, y + 3, { align: "center" });

  y += rowH;

  // Row 2: Material Description & Batch No
  const rowH_Desc = 11;
  x = m;
  doc.setFillColor(200, 200, 200);
  doc.rect(x, y, 40, rowH_Desc, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Material Description", x + 2, y + 4);

  x += 32;
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, 75, rowH_Desc, "FD");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text(`${masterInkCode} ${materialDesc}`, x + 2, y + 4, { maxWidth: 70 });

  x = m + 110;
  doc.setFillColor(200, 200, 200);
  doc.rect(x, y, 40, rowH_Desc, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("Batch No", x + 2, y + 6);

  x += 40;
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, 40, rowH_Desc, "FD");
  doc.setFont("helvetica", "normal");
  doc.setFontSize(8);
  doc.text(String(batchNo ?? ""), x + 20, y + 6, { align: "center" });
  y += rowH_Desc;

  // Row 3: Master Sample & Actual Yield
  // x = m;
  // doc.setFillColor(200, 200, 200);
  // doc.rect(x, y, 40, rowH, "FD");
  // doc.setFont("helvetica", "bold");
  // doc.setFontSize(8);
  // doc.text("Master Sample", x + 2, y + 3);

  // x += 32;
  // doc.setFillColor(255, 255, 255);
  // doc.rect(x, y, 30, rowH, "FD");
  // doc.setFont("helvetica", "normal");
  // doc.setFontSize(7);
  // doc.text(String(material_sample ?? ""), x + 2, y + 3);

  x = m + 110;
  doc.setFillColor(200, 200, 200);
  doc.rect(x, y, 40, rowH, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("Actual Yield", x + 2, y + 3);

  x += 40;
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, 40, rowH, "FD");
  doc.setFont("helvetica", "normal");
  doc.text(hasData(actualYield) ? Number(actualYield).toFixed(2) : "", x + 20, y + 3, { align: "center" });
  y += rowH;

  // Row 4: Planned Yield & Process Order No#
  x = m + 110;
  doc.setFillColor(200, 200, 200);
  doc.rect(x, y, 40, rowH, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("Planned Yield", x + 2, y + 3);

  x += 40;
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, 40, rowH, "FD");
  doc.setFont("helvetica", "normal");
  doc.text(hasData(plannedYield) ? Number(plannedYield).toFixed(2) : "", x + 20, y + 3, { align: "center" });
  y += rowH;

  // Row 5: Process Order No#
  x = m + 110;
  doc.setFillColor(200, 200, 200);
  doc.rect(x, y, 40, rowH, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("Process Order No#", x + 2, y + 3);

  x += 40;
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, 40, rowH, "FD");
  doc.setFont("helvetica", "normal");
  doc.text(String(productionPlan.id ?? ""), x + 20, y + 3, { align: "center" });
  y += rowH;

  // Row 6: Date
  x = m + 110;
  doc.setFillColor(200, 200, 200);
  doc.rect(x, y, 40, rowH, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.5);
  doc.text("Date", x + 2, y + 3);

  x += 40;
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, 40, rowH, "FD");
  doc.setFont("helvetica", "normal");
  doc.text(String(formattedDated ?? ""), x + 20, y + 3, { align: "center" });
  y += rowH;

  y += 2;

  // Sales Order Row
  x = m;
  doc.setFillColor(200, 200, 200);
  doc.rect(x, y, 45, rowH, "FD");
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Sales Order No", x + 2, y + 3);

  x += 30;
  doc.setFillColor(255, 255, 255);
  doc.rect(x, y, 35, rowH, "FD");
  doc.setFont("helvetica", "normal");
  doc.text(String(salesOrderNo ?? ""), x + 2, y + 3);
  y += rowH;

  // // Machine Row
  // x = m;
  // doc.setFillColor(200, 200, 200);
  // doc.rect(x, y, 40, rowH, "FD");
  // doc.setFont("helvetica", "bold");
  // doc.setFontSize(7.5);
  // doc.text("Machine & Utilization", x + 2, y + 3);

  // x += 30;
  // doc.setFillColor(255, 255, 255);
  // doc.rect(x, y, 55, rowH, "FD");
  // doc.setFont("helvetica", "normal");
  // doc.setFontSize(7);
  // doc.text(String(machineName ?? ""), x + 2, y + 3);

  // x += 55;
  // doc.setFillColor(255, 255, 255);
  // doc.rect(x, y, 20, rowH, "FD");
  // doc.text(String(machineInfo ?? ""), x + 10, y + 3, { align: "center" });
  // y += rowH;

  y += 5;

  y += 5;

  // ===== TABLE HEADER =====
  x = m;
  // Column widths: S.No, Component, Description, Qty, Batch No
  const colWidths = [12, 22, 88, 28, 30];
  const headerH = 8;

  doc.setFillColor(220, 220, 220);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);

  doc.setFillColor(220, 220, 220);
  doc.rect(x, y, colWidths[0], headerH, "FD");
  doc.text("S.No", x + colWidths[0] / 2, y + 5.5, { align: "center" });
  x += colWidths[0];

  doc.setFillColor(220, 220, 220);
  doc.rect(x, y, colWidths[1], headerH, "FD");
  doc.text("Component", x + colWidths[1] / 2, y + 5.5, { align: "center" });
  x += colWidths[1];

  doc.setFillColor(220, 220, 220);
  doc.rect(x, y, colWidths[2], headerH, "FD");
  doc.text("Component Description", x + colWidths[2] / 2, y + 5.5, {
    align: "center",
  });
  x += colWidths[2];

  doc.setFillColor(220, 220, 220);
  doc.rect(x, y, colWidths[3], headerH, "FD");
  doc.text("Qty", x + colWidths[3] / 2, y + 5.5, { align: "center" });
  x += colWidths[3];

  doc.setFillColor(220, 220, 220);
  doc.rect(x, y, colWidths[4], headerH, "FD");
  doc.text("Batch No", x + colWidths[4] / 2, y + 5.5, { align: "center" });

  y += headerH;

  // ===== TABLE ROWS =====
  const details = productionPlan.productionPlanDetail || [];
  const sortedDetails = [...details].sort((a, b) => (a.sno || 0) - (b.sno || 0));

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);

  sortedDetails.forEach((detail, idx) => {
    doc.setFont("helvetica", "normal");
    x = m;

    const description = detail.material_desc || "";
    const componentText = detail.material_id ? String(detail.material_id) : "";

    const isMaterialRow = description.includes("(material)");
    const rowFont = isMaterialRow ? "bold" : "normal";

    // Calculate row height - compact
    const descLines = doc.splitTextToSize(description, colWidths[2] - 4);
    const compLines = doc.splitTextToSize(componentText, colWidths[1] - 4);
    const linesCount = Math.max(descLines.length, compLines.length, 1);
    const rowHeight = Math.max(5, linesCount * 3.8 + 1);

    // Alternate row coloring
    if (idx % 2 === 1) {
      doc.setFillColor(...lightGray);
      doc.rect(m, y, W - 2 * m, rowHeight, "F");
    }

    // S.No
    doc.setDrawColor(150, 150, 150);
    doc.rect(x, y, colWidths[0], rowHeight, "D");
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", rowFont);
    const snoY = y + (rowHeight / 2) + 1;
    if (isMaterialRow) {
      doc.setLineWidth(0.05);
      doc.text(String(detail.sno || idx + 1), x + colWidths[0] / 2, snoY, {
        align: "center",
        renderingMode: "fillAndStroke",
      });
      doc.setLineWidth(0.15); // Reset for rect drawing
    } else {
      doc.text(String(detail.sno || idx + 1), x + colWidths[0] / 2, snoY, {
        align: "center",
      });
    }
    x += colWidths[0];

    // Component
    doc.rect(x, y, colWidths[1], rowHeight, "D");
    if (componentText) {
      doc.setFont("helvetica", rowFont);
      if (isMaterialRow) {
        doc.setLineWidth(0.05);
        doc.text(componentText, x + colWidths[1] / 2, y + 3.5, {
          maxWidth: colWidths[1] - 4,
          align: "center",
          renderingMode: "fillAndStroke",
        });
        doc.setLineWidth(0.15);
      } else {
        doc.text(componentText, x + colWidths[1] / 2, y + 3.5, {
          maxWidth: colWidths[1] - 4,
          align: "center",
        });
      }
    }
    x += colWidths[1];

    // Description
    doc.rect(x, y, colWidths[2], rowHeight, "D");

    if (!detail.material_id && description) {
      doc.setTextColor(200, 0, 0);
      doc.setFont("helvetica", "normal");
    } else {
      doc.setTextColor(0, 0, 0);
      doc.setFont("helvetica", rowFont);
    }

    if (isMaterialRow) {
      doc.setLineWidth(0.05);
      doc.text(description, x + colWidths[2] / 2, y + 3.5, {
        maxWidth: colWidths[2] - 4,
        align: "center",
        renderingMode: "fillAndStroke",
      });
      doc.setLineWidth(0.15);
    } else {
      doc.text(description, x + colWidths[2] / 2, y + 3.5, {
        maxWidth: colWidths[2] - 4,
        align: "center",
      });
    }
    x += colWidths[2];

    // Qty
    doc.setTextColor(0, 0, 0);
    doc.setFont("helvetica", rowFont);
    doc.rect(x, y, colWidths[3], rowHeight, "D");
    if (detail.material_qty) {
      const qtyValue = typeof detail.material_qty === 'number'
        ? detail.material_qty.toFixed(2)
        : hasData(detail.material_qty) ? Number(detail.material_qty).toFixed(2) : "";
      if (isMaterialRow) {
        doc.setLineWidth(0.05);
        doc.text(qtyValue, x + colWidths[3] / 2, snoY, {
          align: "center",
          renderingMode: "fillAndStroke",
        });
        doc.setLineWidth(0.15);
      } else {
        doc.text(qtyValue, x + colWidths[3] / 2, snoY, {
          align: "center",
        });
      }
    }
    x += colWidths[3];

    // Batch No (Empty for manual entry)
    doc.rect(x, y, colWidths[4], rowHeight, "D");

    y += rowHeight;
  });

  // Page 1 Footer: Made By, Checked By, Actual Yield, Tank No.
  y += 5;
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text("Made By _________________________________", m, y + 5);
  doc.text("Actual Yield _____________________________", m + 100, y + 5);
  doc.text("Checked By ______________________________", m, y + 15);
  doc.text("Tank No. _________________________________", m + 100, y + 15);

  // Tracking Stamp (Box style like image) - Resized to be smaller & thinner
  const stampX = m;
  const stampY = y + 40; 
  const stampW = 50;
  const rowH_Stamp = 5;
  const stampH = rowH_Stamp * 6; 

  doc.setDrawColor(140, 140, 140); 
  doc.setLineWidth(0.4);
  doc.rect(stampX, stampY, stampW, stampH);
  
  doc.setLineWidth(0.15);
  const labels = [
    "Date.",
    "Mixing Start Time.",
    "Mixing End Time.",
    "QC Time In.",
    "QC Time Out.",
    "Passed By."
  ];

  labels.forEach((label, i) => {
    const rowY = stampY + (i * rowH_Stamp);
    if (i > 0) {
      doc.line(stampX, rowY, stampX + stampW, rowY);
    }
    doc.setFontSize(7);
    doc.setFont("helvetica", "bold");
    doc.text(label, stampX + 2, rowY + 3.5);
    doc.line(stampX + 24, rowY + 4, stampX + stampW - 2, rowY + 4); // Adjusted fill line start
  });
  doc.setDrawColor(140, 140, 140); // Reset color
  doc.setLineWidth(0.1);

  // Helper to draw footer (QC Certificate style)
  const drawFooter = (startY) => {
    // Reset all drawing state after autoTable
    doc.setTextColor(0, 0, 0);
    doc.setDrawColor(140, 140, 140);
    doc.setFillColor(255, 255, 255);
    doc.setLineWidth(0.1);

    const currentY = startY + 5;

    const leftWidth = 100;

    // COMMENTS BY QC
    // doc.setFillColor(220, 220, 220);
    // doc.setDrawColor(140, 140, 140);
    // doc.rect(m, currentY, leftWidth, 7, "FD");
    // doc.setTextColor(0, 0, 0);
    // doc.setFontSize(9);
    // doc.setFont("helvetica", "bold");
    // doc.text("COMMENTS BY QC", m + leftWidth / 2, currentY + 7 / 2 + 1.5, { align: "center" });

    // doc.setFillColor(255, 255, 255);
    // doc.setDrawColor(140, 140, 140);
    // doc.roundedRect(m, currentY + 8, leftWidth, 25, 2, 2);

    // APPROVED BY
    // const appY = currentY + 40;
    // doc.setFillColor(220, 220, 220);
    // doc.setDrawColor(140, 140, 140);
    // doc.rect(m, appY, leftWidth, 7, "FD");
    // doc.setTextColor(0, 0, 0);
    // doc.setFontSize(9);
    // doc.setFont("helvetica", "bold");
    // doc.text("APPROVED BY", m + 2, appY + 7 / 2 + 1.5);

    // doc.setFillColor(255, 255, 255);
    // doc.setDrawColor(140, 140, 140);
    // doc.rect(m, appY + 8, leftWidth, 12);

    // Right side: APPROVED badge
    // const pageWidth = doc.internal.pageSize.getWidth();
    // const rightMargin = m;
    // const approvedWidth = 50;
    // const approvedX = pageWidth - rightMargin - approvedWidth;

    // doc.setDrawColor(140, 140, 140);
    // doc.rect(approvedX, currentY, approvedWidth, 7, "S");
    // doc.setFont("helvetica", "bold");
    // doc.setFontSize(9);
    // doc.setTextColor(0, 0, 0);
    // doc.text("RESULT REMARKS", approvedX + approvedWidth / 2, currentY + 7 / 2 + 1.5, { align: "center" });
  };

  // ===== PAGE 2: QC TABLE & FOOTER (Back Side) =====
  // doc.addPage();
  // drawHeader();
  
  // Page 2 Header (Batch Details)
  let y2 = 35;
  const rowH_P2 = 7;
  const innerPad = 2;

  const chip = (cx, cy, cw, ch, ctext, calign = "") => {
    doc.setFillColor(220, 220, 220);
    doc.setDrawColor(140, 140, 140);
    doc.rect(cx, cy, cw, ch, "FD");
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(9);
    doc.setFont("helvetica", "bold");
    const tx = calign === "center" ? cx + cw / 2 : cx + innerPad;
    doc.text(String(ctext), tx, cy + ch / 2 + 1.5, { align: calign || "left" });
  };

  const valueBox = (vx, vy, vw, vh, vtext = "") => {
    doc.setFillColor(255, 255, 255);
    doc.setDrawColor(140, 140, 140);
    doc.rect(vx, vy, vw, vh, "FD");
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(9);
    doc.setFont("helvetica", "normal");
    doc.text(String(vtext || ""), vx + vw / 2, vy + vh / 2 + 1.5, {
      align: "center",
    });
  };

  // chip(m, y2, 45, rowH_P2, "Material Description");
  // doc.setFillColor(255, 255, 255);
  // doc.setDrawColor(140, 140, 140);
  // doc.rect(m + 45, y2, 80, rowH_P2, "FD");
  // doc.setTextColor(0, 0, 0);
  // doc.setFontSize(7);
  // doc.setFont("helvetica", "normal");
  // doc.text(`${masterInkCode} ${materialDesc}`, m + 47, y2 + rowH_P2 / 2 + 1.5, { maxWidth: 75 });
  
  // chip(m + 130, y2, 35, rowH_P2, "Batch Size (KG)", "center");
  // valueBox(m + 165, y2, 25, rowH_P2, plannedYield);
  // y2 += rowH_P2;

  // y2 += 10;

  // if (qcResults && qcResults.length > 0) {
  //   autoTable(doc, {
  //     startY: y2,
  //     tableWidth: 190,
  //     head: [["Test Description", "Standards", "Result"]],
  //     body: qcResults.map((r) => [
  //       String(r.parameter_name || ""),
  //       String(r.quality_standard || ""),
  //       String(""),
  //     ]),
  //     styles: {
  //       font: "helvetica",
  //       fontSize: 8,
  //       lineWidth: 0.15,
  //       cellPadding: 2,
  //       halign: "center",
  //       valign: "middle",
  //     },
  //     headStyles: {
  //       fillColor: [200, 200, 200],
  //       textColor: 0,
  //       fontStyle: "bold",
  //     },
  //     theme: "grid",
  //     margin: { left: m, right: m },
  //   });

  //   drawFooter(doc.lastAutoTable.finalY + 10);
  // } else {
    drawFooter(y2 + 10);
  // }

  return doc;
};