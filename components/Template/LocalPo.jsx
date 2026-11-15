import { jsPDF } from "jspdf";
import { DEFAULT_COMPANY_NAME, DEFAULT_COMPANY_LOGO, companyShortName } from "@/lib/companyName";

// `company` = the company-context profile ({ name, logo, address[], phone, ... }).
export const generateLocalPurchaseOrderPDF = (company = {}) => {
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const LOGO_RIGHT = company?.logo || DEFAULT_COMPANY_LOGO;
  const companyName = company?.name || company?.company || DEFAULT_COMPANY_NAME;

  const page = { w: 210, h: 297, m: 10 };
  const c = {
    headerBg: [242, 242, 242],
    text: [0, 0, 0],
    gray: [100, 100, 100],
  };

  const vendor = {
    name: "Kompass Pakistan (Pvt.) Ltd",
    contactPerson: "Mr. S. Farhan Jafri",
    phone: "",
    fax: "",
    address: "",
  };

  const poInfo = {
    poNo: "RM/0280/2025",
    poDate: "06-Nov-2025",
    ntn: "-",
    docType: "Local PO",
  };

  const rows = [
    ["Ethoxy Propanol (Propylene Glycol Monoethyl Ether)", "5950", "Kg", "700.00", "4,165,000"],
  ];

  const totals = {
    total: "4,165,000",
    salesTax: "749,700",
    totalAmount: "Rs 4,914,700",
  };

  const drawHeader = () => {
    let y = page.m;

    // RIGHT LOGO + company details
    const rx = page.w - page.m - 70;

    // Logo
    try {
      doc.addImage(LOGO_RIGHT, "PNG", rx + 15, y, 8, 8);
    } catch {
      /* logo optional */
    }

    // Short company name aligned with logo
    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(30, 30, 30);
    doc.text(companyShortName(companyName), rx + 25, y + 5.5);

    // Company details
    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setTextColor(...c.text);

    const addr = [
      companyName,
      ...(Array.isArray(company?.address) && company.address.length
        ? company.address
        : [company?.addr1, company?.addr2, company?.city, company?.phone ? `Phone: ${company.phone}` : ""]
      ).filter(Boolean),
    ];

    let ry = y + 11;
    addr.forEach((l) => {
      doc.text(l, rx + 17, ry);
      ry += 3;
    });

    return page.m + 38;
  };

  const drawTitle = (y) => {
    doc.setFont("helvetica", "bold");
    doc.setFontSize(14);
    doc.setTextColor(0, 0, 0);
    doc.text("PURCHASE ORDER", page.m, y);

    doc.setFont("helvetica", "normal");
    doc.setFontSize(10);
    doc.text(`NTN # ${poInfo.ntn}`, page.w - page.m, y, { align: "right" });

    return y + 2;
  };

  const drawDetailsBox = (y) => {
    const boxH = 35;
    const boxW = page.w - 2 * page.m;
    const midPoint = boxW / 2;

    doc.setDrawColor(0, 0, 0);
    doc.setLineWidth(0.3);
    doc.rect(page.m, y, boxW, boxH);

    doc.line(page.m + midPoint, y, page.m + midPoint, y + boxH);

    doc.setFont("helvetica", "bold");
    doc.setFontSize(9);
    doc.text("VENDOR DETAILS", page.m + 24, y + 6);

    let ly = y + 11;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);

    const vendorInfo = [
      ["Vendor Name:", vendor.name],
      ["Contact Person:", vendor.contactPerson],
      ["Tel. Phone #:", vendor.phone],
      ["Fax:", vendor.fax],
      ["ADDRESS:", vendor.address],
    ];

    vendorInfo.forEach(([label, value]) => {
      doc.setFont("helvetica", "bold");
      doc.text(label, page.m + 3, ly);
      doc.setFont("helvetica", "normal");
      doc.text(value, page.m + 32, ly);
      ly += 4.5;
    });

    const rx = page.m + midPoint + 3;
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("PO DETAILS", rx + 40, y + 6);

    let ry = y + 16;
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);

    const poDetails = [
      ["PO #.", poInfo.poNo],
      ["Date:", poInfo.poDate],
      ["Document Type:", poInfo.docType],
    ];

    poDetails.forEach(([label, value]) => {
      doc.setFont("helvetica", "bold");
      doc.text(label, rx, ry);
      doc.setFont("helvetica", "normal");
      doc.text(value, rx + 32, ry);
      ry += 4.5;
    });

    return y + boxH + 5;
  };

  const drawTableHeader = (y) => {
    const colW = [70, 20, 20, 30, 40];
    const startX = page.m;
    const headerH = 7;
    const tableW = page.w - 2 * page.m;

    doc.setFillColor(...c.headerBg);
    doc.rect(startX, y, tableW, headerH, "F");

    doc.setDrawColor(0, 0, 0);
    doc.rect(startX, y, tableW, headerH);

    const heads = ["DESCRIPTION", "QTY", "Unit", "UNIT PRICE", "TOTAL"];

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
    const colW = [70, 20, 20, 30, 40];
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
    const colW = [70, 20, 20, 30, 40];
    const startX = page.m;
    const tableW = page.w - 2 * page.m;
    const rowH = 7;

    // Total row
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.rect(startX, y, tableW, rowH);

    doc.text("Total", startX + 2, y + 5);
    doc.text(
      totals.total,
      startX + colW[0] + colW[1] + colW[2] + colW[3] + colW[4] / 2,
      y + 5,
      { align: "center" }
    );

    let x = startX;
    for (let i = 0; i < 4; i++) {
      x += colW[i];
      doc.line(x, y, x, y + rowH);
    }

    y += rowH;

    // Sales Tax row
    doc.rect(startX, y, tableW, rowH);
    doc.text("Sales Tax", startX + 2, y + 5);
    doc.setFont("helvetica", "normal");
    doc.text("18.0%", startX + colW[0] + colW[1] + colW[2] + colW[3] / 2, y + 5, { align: "center" });
    doc.setFont("helvetica", "bold");
    doc.text(
      totals.salesTax,
      startX + colW[0] + colW[1] + colW[2] + colW[3] + colW[4] / 2,
      y + 5,
      { align: "center" }
    );

    x = startX;
    for (let i = 0; i < 4; i++) {
      x += colW[i];
      doc.line(x, y, x, y + rowH);
    }

    y += rowH;

    // Total PO Amount row
    doc.rect(startX, y, tableW, rowH);
    doc.text("Total PO Amount", startX + 2, y + 5);
    doc.text(
      totals.totalAmount,
      startX + colW[0] + colW[1] + colW[2] + colW[3] + colW[4] / 2,
      y + 5,
      { align: "center" }
    );

    x = startX;
    for (let i = 0; i < 4; i++) {
      x += colW[i];
      doc.line(x, y, x, y + rowH);
    }

    return y + rowH + 5;
  };

  const drawTerms = (y) => {
    // ========== DRAW BORDER AROUND TOP COMMENTS SECTION ==========
    const boxX = page.m;
    const boxW = page.w - 2 * page.m;
    const boxH = 10;

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
    doc.setFont("helvetica", "normal");
    doc.text("30 Days from Delivery", page.m + 32, cy);

    y += boxH + 5;

    // ========== TERMS & CONDITIONS HEADING ==========
    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.text("Terms & Conditions:", page.m, y);

    y += 5;

    // ========== LIST TERMS ==========
    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);

    const terms = [
      "1) Delivery: Ex-Karachi",
      "2) Inspection by our Quality Department will considered as final at our premises.",
      "3) Any rejection of material will be lifted by the supplier at their own risk and cost.",
      "4) PO can be cancelled at any time.",
      "5) Mention our PO# on your DC & invoice.",
      "6) Please send two copies of bill/invoice with the delivery of goods.",
      "7) Due days will be counted after receiving of invoice.",
      "8) Material will be accepted after quality approval.",
      "9) For any objection please inform via return email within 24 hours otherwise PO will be considered as ACCEPTED.",
      "10) Delivery of goods will not be accepted on Saturday & Sunday.",
      "11) You are requested to follow our delivery dates strictly.",
      `12) Complaint handled and resolved in 3 working days. Else ${companyName} has a right to take the decision and issue debit note.`,
      "13) No responsibility will be taken for the payment of goods supplied/services rendered unless covered by this purchase order.",
      "14) All payments made subject to deduction of withholding tax & any other deduction required by law or imposed by the respective authorities shall be to the account of the supplier/service provider.",
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
    const footY = page.h - 15;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(8);
    doc.setTextColor(0, 0, 0);
    
    // Left side - Purchasing Manager
    const leftX = page.m + 20;
    doc.text("_____________________", leftX, footY - 5);
    doc.setFont("helvetica", "bold");
    doc.text("Purchasing Manager", leftX, footY);
    
    // Right side - Managing Director
    const rightX = page.w - page.m - 40;
    doc.setFont("helvetica", "normal");
    doc.text("_____________________", rightX, footY - 5);
    doc.setFont("helvetica", "bold");
    doc.text("Managing Director", rightX + 2, footY);
  };

  const render = () => {
    let curY = drawHeader();
    curY = drawTitle(curY);
    curY = drawDetailsBox(curY);
    curY = drawTableHeader(curY);

    rows.forEach((r) => {
      curY = drawRow(curY, r);
    });

    curY = drawTotals(curY);
    curY = drawTerms(curY);
    drawFooter();
  };

  render();
  return doc;
};