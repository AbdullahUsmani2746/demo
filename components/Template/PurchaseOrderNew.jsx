import { jsPDF } from "jspdf";
import { orderPdfFromArgs } from "./OrderLetterhead";
import { featureAsync } from "@/lib/features/client";
import { companyShortName } from "@/lib/companyName";

// The standard layout — printed while Settings → Features "Print Purchase / Sale
// Orders on the letterhead" (documents.orderLetterhead) is off.
export const generateImportPurchaseOrderPDF = async (
  orderData,
  session = null,
  currencyData = null,
  companyData = null,
  mode = "download",
) => {
  const order = orderData.data[0];
  const doc = new jsPDF({ unit: "mm", format: "a4" });

  const LOGO_RIGHT = companyData?.logo || "N/A";
  const companyName = companyData?.name || "N/A";
  const companyAddress = companyData?.address || ["N/A"];

  const currencySymbol = currencyData?.symbol || "N/A";
  const currencyCode = currencyData?.code || "N/A";

  // Helper function to format amount with currency
  const formatCurrency = (amount) => {
    const num = parseFloat(amount) || 0;
    return `${currencySymbol} ${num.toLocaleString("en-US", {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    })}`;
  };

  const page = { w: 210, h: 297, m: 10 };
  const c = {
    headerBg: [242, 242, 242],
    text: [0, 0, 0],
    gray: [100, 100, 100],
    lightGray: [230, 230, 230],
    border: [150, 150, 150],
  };

  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date.toLocaleDateString("en-GB", {
      day: "numeric",
      month: "short",
      year: "numeric",
    });
  };

  const printedBy = session?.user?.name || order.userid || "N/A";
  const printedOn =
    new Date().toLocaleDateString("en-GB") +
    " " +
    new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  const vendor = {
    name: order.acno?.acname || "Unknown Vendor",
    contactPerson: order.acno?.contactPerson || "-",
    phone: order.acno?.phoneFax || "-",
    address: (() => {
      const text = order.acno?.address || "-";
      const MAX = 38;

      if (text === "-") return ["-"];
      if (text.length <= MAX) return [text];

      const line1 = text.slice(0, MAX);
      const line2 = text.slice(MAX, MAX * 2);

      return [line1, line2];
    })(),
  };

  const poInfo = {
    poNo: order.order_no?.toString() || "-",
    poDate: formatDate(order.dated),
    ntn: order.acno?.ntnNo || "-",
  };

  // ============================================
  // TABLE ROWS - Currency symbol use karo
  // ============================================
  const rows = order.orderDetails.map((item) => [
    item.items?.item || "Unknown Product",
    item.qty?.toString() || "0",
    formatCurrency(item.rate),
    formatCurrency(item.amount),
  ]);

  // ============================================
  // TOTALS - Currency symbol use karo
  // ============================================
  const subtotal = order.orderDetails.reduce(
    (sum, item) => sum + (item.amount || 0),
    0
  );

  const totals = {
    subtotal: formatCurrency(subtotal),
    total: formatCurrency(subtotal),
  };

  const drawHeader = () => {
    let y = page.m;

    const boxH = 10;
    const boxW = 70;

    doc.setDrawColor(0, 0, 0);
    doc.setTextColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.rect(page.m, y, boxW, boxH);

    doc.setFontSize(8);
    doc.setFont("helvetica", "bold");
    doc.text("Printed On:", page.m + 3, y + 4);

    doc.setFont("helvetica", "normal");
    doc.text(printedOn, page.m + 22, y + 4);

    doc.setFont("helvetica", "bold");
    doc.text("Printed By:", page.m + 3, y + 8);

    doc.setFont("helvetica", "normal");
    doc.text(printedBy, page.m + 22, y + 8);

    y += boxH + 6;

    const rx = page.w - page.m - 75;

    try {
      doc.addImage(LOGO_RIGHT, "PNG", rx + 15, y, 8, 8);
    } catch (e) {
      
    }

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);
    doc.text(companyShortName(companyName), rx + 25, y + 5.5);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...c.text);
    doc.text(companyName, rx + 25, y + 10);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...c.text);

    let ry = y + 13;
    companyAddress.forEach((l) => {
      doc.text(l, rx + 25, ry);
      ry += 3;
    });

    return page.m + 38;
  };

  const drawTitle = (y) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text("PURCHASE ORDER", page.m, y + 7);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`NTN # ${poInfo.ntn}`, page.w - page.m, y + 7, { align: "right" });

    return y + 8;
  };

  const drawDetailsBox = (y) => {
    const boxH = 40;
    const boxW = page.w - 2 * page.m;
    const midPoint = boxW / 2;

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.rect(page.m, y, boxW, boxH);

    doc.line(page.m + midPoint + 3, y, page.m + midPoint + 3, y + boxH);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("VENDOR DETAILS", page.m + 30, y + 6);

    let ly = y + 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);

    const vendorInfo = [
      ["Vendor Name:", vendor.name],
      ["Contact Person:", vendor.contactPerson],
      ["Tel. Phone #:", vendor.phone],
      ["ADDRESS:", vendor.address[0] || "-"],
    ];

    vendorInfo.forEach(([label, value]) => {
      doc.setFont("helvetica", "bold");
      doc.text(label, page.m + 3, ly);
      doc.setFont("helvetica", "normal");

      if (label === "ADDRESS:" && vendor.address.length > 1) {
        vendor.address.forEach((line, idx) => {
          doc.text(line, page.m + 32, ly + idx * 3.5);
        });
        ly += (vendor.address.length - 1) * 3.5;
      } else {
        doc.text(value.toString(), page.m + 32, ly);
      }
      ly += 4.5;
    });

    const rx = page.m + midPoint + 9;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("PO DETAILS", rx + 38, y + 6);

    let ry = y + 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);

    const poDetails = [
      ["PO #.", poInfo.poNo],
      ["PO Issuance Date:", poInfo.poDate],
      // ["Currency:", `${currencyCode} (${currencySymbol})`],
    ];

    poDetails.forEach(([label, value]) => {
      doc.setFont("helvetica", "bold");
      doc.text(label, rx, ry);
      doc.setFont("helvetica", "normal");
      doc.text(value, rx + 50, ry);
      ry += 4.5;
    });

    return y + boxH + 5;
  };

  const drawTableHeader = (y) => {
    const colW = [90, 30, 35, 35];
    const startX = page.m;
    const headerH = 7;
    const tableW = page.w - 2 * page.m;

    doc.setFillColor(...c.headerBg);
    doc.rect(startX, y, tableW, headerH, "F");

    doc.setDrawColor(0, 0, 0);
    doc.rect(startX, y, tableW, headerH);

    const heads = [
      "DESCRIPTION",
      "QTY (KG)",
      `UNIT PRICE (${currencyCode})`,
      "TOTAL",
    ];

    let x = startX;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);

    heads.forEach((h, i) => {
      const align = i === 0 ? "left" : "center";
      const tx = align === "left" ? x + 2 : x + colW[i] / 2;
      doc.text(h, tx, y + 5, { align });

      if (i < heads.length - 1) {
        doc.line(x + colW[i], y, x + colW[i], y + headerH);
      }

      x += colW[i];
    });

    return y + headerH;
  };

  const drawRow = (y, vals) => {
    const colW = [90, 30, 35, 35];
    const startX = page.m;
    const tableW = page.w - 2 * page.m;
    const rowH = 7;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);

    doc.setDrawColor(0, 0, 0);
    doc.rect(startX, y, tableW, rowH);

    let x = startX;
    vals.forEach((v, i) => {
      const align = i === 0 ? "left" : "center";
      const tx = align === "left" ? x + 2 : x + colW[i] / 2;
      doc.text(v.toString(), tx, y + 5, { align });

      if (i < vals.length - 1) {
        doc.line(x + colW[i], y, x + colW[i], y + rowH);
      }
      x += colW[i];
    });

    return y + rowH;
  };

  const drawTotals = (y) => {
    const colW = [90, 30, 35, 35];
    const startX = page.m;
    const tableW = page.w - 2 * page.m;
    const rowH = 7;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.rect(startX, y, tableW, rowH);

    doc.text("Total", startX + 2, y + 5);
    doc.text(
      totals.subtotal,
      startX + colW[0] + colW[1] + colW[2] + colW[3] / 2,
      y + 5,
      { align: "center" }
    );

    let x = startX;
    for (let i = 0; i < 3; i++) {
      x += colW[i];
      doc.line(x, y, x, y + rowH);
    }

    y += rowH;

    doc.rect(startX, y, tableW, rowH);
    doc.text("Total PO Amount", startX + 2, y + 5);
    doc.text(
      totals.total,
      startX + colW[0] + colW[1] + colW[2] + colW[3] / 2,
      y + 5,
      { align: "center" }
    );

    x = startX;
    for (let i = 0; i < 3; i++) {
      x += colW[i];
      doc.line(x, y, x, y + rowH);
    }

    return y + rowH + 5;
  };

  const drawTerms = (y) => {
    const paymentTerms = order.payment_terms || "LC at Sight";
    const deliveryTerms = order.delivery_terms || "CFR";

    const boxX = page.m;
    const boxW = page.w - 2 * page.m;
    const boxH = 15;

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.rect(boxX, y, boxW, boxH);

    let cy = y + 4;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Comments or Special Instructions", page.m + 2, cy);

    cy += 5;

    doc.setFont("helvetica", "bold");
    doc.text("Payment Terms:", page.m + 2, cy);
    doc.setFont("helvetica", "bold");
    doc.text(paymentTerms, page.m + 32, cy);

    cy += 4;

    doc.setFont("helvetica", "bold");
    doc.text("Shipment conditions:", page.m + 2, cy);
    doc.setFont("helvetica", "bold");
    doc.text(deliveryTerms, page.m + 40, cy);

    y += boxH + 5;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Terms & Conditions:", page.m, y);

    y += 5;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);

    const terms = [
      `1. Payment term: ${paymentTerms}`,
      `2. Shipment conditions ${deliveryTerms}`,
      "3. Mention our PO# on your DC/invoice.",
      "4. Proforma invoice must show country of origin, HS code, the port of origin and port of discharge, payment terms, & shipment condition",
      "5. Documents must include Packing list, BL, Commercial invoice",
      "6. Beneficiary's manually signed commercial invoice in three copies, with description of good & country of origin",
      "7. Please note that in the documentation or on the material, there is no reference of India or Indian cities",
      `9. 3/3 Original Ocean Bill of lading, made out to the applicant (${companyName}), Notifying the applicant and also Notifying            Bank mentioned on contract`,
      "10. The BL must contain: description of goods, country of origin, HS Code, applicant NTN, banks import contract number",
      "11. Please notify applicant & bank mentioned on contract on bl.",
      "12. All documents must be issued in English Language",
      "13. All Documents drafts to be send prior to the shipment via Email to the Applicant- to be confirmed before final creation.",
      "14. Original Documents to be send from bank to bank (Applicants bank mentioned on contract)",
      "15. Tracking details of original document shipment will be shared via email-.",
      "",
      "Note: these are general terms and conditions, all other bank requirements & conditions will be mentioned on LC",
    ];

    terms.forEach((term) => {
      if (y > page.h - 25) {
        doc.addPage();
        y = page.m;
      }
      const lines = doc.splitTextToSize(term, page.w - 2 * page.m);
      lines.forEach((line) => {
        doc.text(line, page.m, y);
        y += 3.5;
      });
    });

    return y;
  };

  const drawFooter = () => {
    const footY = page.h - 10;

    doc.setFont("helvetica", "italic");
    doc.setFontSize(8);
    doc.setTextColor(100, 100, 100);
    doc.text(
      "This is a system generated document & does not require sign and stamp",
      page.w / 2,
      footY,
      { align: "center" }
    );
  };

  const render = () => {
    let curY = drawHeader();
    // curY = drawUserInfoBox(curY); // Added user info box
    curY = drawTitle(curY);
    curY = drawDetailsBox(curY);
    curY = drawTableHeader(curY);

    rows.forEach((r) => {
      if (curY > page.h - 40) {
        doc.addPage();
        curY = drawHeader();
        curY = drawTableHeader(curY);
      }
      curY = drawRow(curY, r);
    });

    curY = drawTotals(curY);
    curY = drawTerms(curY);
    drawFooter();
  };

  render();

  if (mode === "print") {
    doc.autoPrint();
    window.open(doc.output("bloburl"), "_blank");
  }

  return doc;
};

// Every print button calls this: the letterhead (components/Template/OrderLetterhead.js)
// when documents.orderLetterhead is on, else the standard layout. Same call shapes.
export const generatePurchaseOrderPDF = async (...args) =>
  (await featureAsync("documents.orderLetterhead")) ? orderPdfFromArgs("purchase", args) : generateImportPurchaseOrderPDF(...args);
