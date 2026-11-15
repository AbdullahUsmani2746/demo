import axios from "axios";
import { jsPDF } from "jspdf";

export const generateSalesOrderPDF = async (
  orderData,
  session = null,
  currencyData = null,
  companyData = null,
  mode = "download",
) => {
  const order = orderData.data[0];

  // ============== ALL VALUES CONSOLIDATED HERE ==============
  const pageWidth = 210;
  const pageHeight = 297;
  const margin = 10;

  const companyName = companyData?.name || "N/A";
 
  // const currencySymbol = currencyData?.symbol || "N/A";
  const currencyCode = currencyData?.code || "N/A";

  

  // Modern Color Palette
  const colors = {
    primary: [128, 0, 32], // Dark Blue (Header)
    secondary: [241, 90, 34], // Orange (Accents)
    lightBg: [248, 249, 250], // Light Gray (Backgrounds)
    darkText: [33, 37, 41], // Almost Black (Text)
    border: [206, 212, 218], // Soft Gray (Borders)
    success: [40, 167, 69], // Green (Totals)
    white: [255, 255, 255],
  };

  const documentTitle = "SALE ORDER";

   const printedBy = session?.user?.name || order.userid || "N/A";
  const printedOn =
    new Date().toLocaleDateString("en-GB") +
    " " +
    new Date().toLocaleTimeString("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });

  // Format date function
  const formatDate = (dateString) => {
    if (!dateString) return "N/A";
    const date = new Date(dateString);
    return date
      .toLocaleDateString("en-GB", {
        day: "2-digit",
        month: "short",
        year: "2-digit",
      })
      .toUpperCase();
  };

  const formatCurrency = (amount) => {
    try {
      return new Intl.NumberFormat("en-US", {
        style: "currency",
        currency: currencyCode,
        minimumFractionDigits: 0,
      }).format(amount || 0);
    } catch (e) {
      return (amount || 0).toLocaleString("en-US", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });
    }
  };

  // Dynamic order details from API
  const orderDetails = {
    date: formatDate(order.dated) || "-",
    saleOrderNo: String(order.order_no).padStart(),
    customer: order.acno?.acname || "Unknown Customer",
    customerRef: order.additional_instructions || "-",
    paymentTerms: order.payment_terms || "-",
    deliveryTerms: order.delivery_terms || "-",
    deliveryLocation: order.delivery_location || "-",
    dueDate: formatDate(order.due_date) || "-",
  };

  // Process order items from API
  const orderItems = order.orderDetails?.map((item, index) => ({
    sNo: (index + 1).toString() || "-",
    prodCode: item.items?.sku || "-",
    productName:  `${item.items?.code || ""} - ${item.items?.item || ""}` || "Unknown Product",
    packing: `${item.no_of_packs}x${item.qty_per_pack}=${item.qty}` || "-",
    qtyKg: item.qty.toString() || "-",
    rate: item.rate ? formatCurrency(item.rate) : "-",
    amount: item.amount ? formatCurrency(item.amount) : "-",
  }));

  // Calculate total quantity
  const totalAmount = order.orderDetails?.reduce(
    (sum, item) => sum + (item.amount || 0),
    0
  );

  // ============== PDF GENERATION CODE ==============
  const doc = new jsPDF({ unit: "mm", format: "a4" });

// Modern Header with square borders
const drawHeader = (yPosition = margin) => {
  const companyHeight = 15;

  // ================= COMPANY BAR =================
  doc.setFont("helvetica", "bold");
  doc.setFontSize(24);

  doc.setFillColor(...colors.primary);
  doc.rect(0, yPosition, pageWidth, companyHeight, "F");

  doc.setTextColor(...colors.white);
  doc.text(companyName, pageWidth / 2, yPosition + 10, {
    align: "center",
  });

  // ================= TITLE BAR =================
  const titleHeight = 12;
  const titleY = yPosition + companyHeight;

  doc.setFillColor(...colors.lightBg);
  doc.rect(0, titleY, pageWidth, titleHeight, "F");

  doc.setTextColor(...colors.secondary);
  doc.setFontSize(16);
  doc.text(documentTitle, pageWidth / 2, titleY + 7, {
    align: "center",
  });

  // ================= PRINTED INFO (MODERN CARD) =================
  const infoBoxWidth = 55;
  const infoBoxHeight = 14;
  const infoX = pageWidth - margin - infoBoxWidth;
  const infoY = titleY + 4;

  // Card background
  doc.setFillColor(...colors.white);
  doc.setDrawColor(...colors.secondary);
  doc.setLineWidth(0.3);
  doc.roundedRect(
    infoX,
    infoY,
    infoBoxWidth,
    infoBoxHeight,
    2,
    2,
    "FD"
  );

  // Labels
  doc.setFont("helvetica", "normal");
  doc.setFontSize(6.5);
  doc.setTextColor(...colors.secondary);

  doc.text("PRINTED ON", infoX + 3, infoY + 5);
  doc.text("PRINTED BY", infoX + 3, infoY + 10);

  // Values
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7);
  doc.setTextColor(...colors.darkText);

  doc.text(printedOn, infoX + infoBoxWidth - 3, infoY + 5, {
    align: "right",
  });

  doc.text(printedBy, infoX + infoBoxWidth - 3, infoY + 10, {
    align: "right",
  });

  // ================= TITLE UNDERLINE =================
  doc.setDrawColor(...colors.secondary);
  doc.setLineWidth(0.5);
  doc.line(
    pageWidth / 2 - 30,
    titleY + 10.5,
    pageWidth / 2 + 30,
    titleY + 10.5
  );

  return titleY + titleHeight + 5;
};



  // Modern Card-like Details Section with square borders
  const drawOrderDetails = (yPosition) => {
    yPosition += 5; // Add some spacing

    // Create a card container with square corners
    doc.setFillColor(...colors.white);
    doc.setDrawColor(...colors.border);
    doc.setLineWidth(0.5);
    doc.rect(margin, yPosition, pageWidth - 2 * margin, 28, "FD"); // Increased height for additional fields

    const rowHeight = 6;
    const labelWidth = 30;
    const valueWidth = 45;

    doc.setFontSize(10);
    doc.setLineWidth(0.2);
    doc.setDrawColor(...colors.border);

    // --- Date Row ---
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...colors.primary);
    doc.text("Date", margin + 5, yPosition + 4);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(...colors.darkText);
    doc.text(
      orderDetails.date,
      margin + labelWidth + valueWidth / 2,
      yPosition + 4,
      { align: "center" }
    );

    // --- Sale Order No (right side) ---
    const rightX = pageWidth - margin - labelWidth - valueWidth;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...colors.primary);
    doc.text("Sale Order No", rightX + 5, yPosition + 6);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(...colors.secondary);
    doc.text(
      orderDetails.saleOrderNo,
      rightX + labelWidth + 5 + (valueWidth - 5) / 2,
      yPosition + 6,
      { align: "center" }
    );

    yPosition += rowHeight;

    // --- Customer Row ---
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...colors.primary);
    doc.text("Customer", margin + 5, yPosition + 4);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(...colors.darkText);
    doc.text(
      orderDetails.customer,
      margin + 45, // <-- yahan label ke baad offset rakho
      yPosition + 4
    );

    yPosition += rowHeight;

    // --- Customer Ref + Payment Terms Row ---
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...colors.primary);
    doc.text("Customer Ref", margin + 5, yPosition + 4);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(...colors.darkText);
    doc.text(
      orderDetails.customerRef || "-",
      margin + labelWidth + valueWidth / 2,
      yPosition + 4,
      { align: "center" }
    );

    const paymentX = pageWidth - margin - labelWidth - valueWidth;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...colors.primary);
    doc.text("Payment Terms", paymentX + 5, yPosition + 4);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(...colors.darkText);
    doc.text(
      orderDetails.paymentTerms,
      paymentX + labelWidth + 5 + (valueWidth - 5) / 2,
      yPosition + 4,
      { align: "center" }
    );

    yPosition += rowHeight;

    // --- Delivery Terms + Due Date Row ---
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...colors.primary);
    doc.text("Delivery Terms", margin + 5, yPosition + 4);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(...colors.darkText);
    doc.text(
      orderDetails.deliveryTerms,
      margin + labelWidth + valueWidth / 2,
      yPosition + 4,
      { align: "center" }
    );

    const dueDateX = pageWidth - margin - labelWidth - valueWidth;
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...colors.primary);
    doc.text("Due Date", dueDateX + 5, yPosition + 4);

    doc.setFont("helvetica", "normal");
    doc.setTextColor(...colors.darkText);
    doc.text(
      orderDetails.dueDate,
      dueDateX + labelWidth + 5 + (valueWidth - 5) / 2,
      yPosition + 4,
      { align: "center" }
    );

    return yPosition + rowHeight + 6;
  };

  // Modern Table with square borders
  const drawTableHeader = (yPosition) => {
    const rowHeight = 7;
    const colWidths = [10, 23, 85, 22, 15, 15, 20];
    let currentX = margin;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(10);
    doc.setTextColor(...colors.white);
    doc.setLineWidth(0.5);
    doc.setDrawColor(...colors.primary);

    const headers = [
      "S.No",
      "Prod Code",
      "Product Name",
      "Packing",
      "Qty",
      "Rate",
      "Amount",
    ];

    headers.forEach((header, index) => {
      doc.setFillColor(...colors.primary);
      doc.rect(currentX, yPosition, colWidths[index], rowHeight, "FD");
      doc.text(header, currentX + colWidths[index] / 2, yPosition + 5, {
        align: "center",
      });
      currentX += colWidths[index];
    });

    return yPosition + rowHeight;
  };

  const drawTableRow = (item, yPosition, rowHeight = 6) => {
    const colWidths = [10, 23, 85, 22, 15, 15, 20];
    let currentX = margin;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(7);
    doc.setLineWidth(0.2);
    doc.setDrawColor(...colors.border);

    const values = [
      item.sNo,
      item.prodCode,
      item.productName,
      item.packing,
      item.qtyKg,
      item.rate,
      item.amount,
    ];

    // Zebra striping
    const isEvenRow = parseInt(item.sNo) % 2 === 0;
    const rowColor = isEvenRow ? colors.lightBg : colors.white;

    values.forEach((value, index) => {
      doc.setFillColor(...rowColor);
      doc.rect(currentX, yPosition, colWidths[index], rowHeight, "FD");

      // Highlight important numeric fields
      if (index === 4) doc.setTextColor(...colors.secondary); // Qty
      else if (index === 5 || index === 6)
        doc.setTextColor(...colors.primary); // Rate/Amount
      else doc.setTextColor(...colors.darkText);

      if (index === 0 || index === 3 || index === 4) {
        doc.text(value, currentX + colWidths[index] / 2, yPosition + 4, {
          align: "center",
        });
      } else if (index === 5 || index === 6) {
        doc.text(value || "-", currentX + colWidths[index] - 2, yPosition + 4, {
          align: "right",
        });
      } else {
        doc.text(value, currentX + 2, yPosition + 4);
      }
      currentX += colWidths[index];
    });

    return yPosition + rowHeight;
  };

  // Highlighted Total Row with square borders
  const drawTotal = (yPosition) => {
    const rowHeight = 7;
    const colWidths = [10, 23, 85, 22, 15, 15, 20];
    let currentX = margin;

    doc.setFont("helvetica", "bold");
    doc.setFontSize(8);
    doc.setFillColor(...colors.lightBg);
    doc.setDrawColor(...colors.border);
    doc.setLineWidth(0.3);
    doc.setTextColor(...colors.primary);

    // Merged cells for label (adjusted for removed column)
    const mergedWidth =
      colWidths[0] + colWidths[1] + colWidths[2] + colWidths[3] + colWidths[4];
    doc.rect(currentX, yPosition, mergedWidth, rowHeight, "FD");
    doc.text("Total", currentX + mergedWidth - 5, yPosition + 5, {
      align: "right",
    });
    currentX += mergedWidth;

    // Total amount
    doc.setFillColor(...colors.white);
    doc.rect(currentX, yPosition, colWidths[5] + colWidths[6], rowHeight, "FD");
    doc.setTextColor(...colors.primary);
    doc.text(
      formatCurrency(totalAmount),
      pageWidth - margin - 5,
      yPosition + 5,
      { align: "right" }
    );

    return yPosition + rowHeight;
  };

  // Modern Signature Lines with square borders
  const drawSignatures = (yPosition) => {
    yPosition += 160;

    doc.setFont("helvetica", "normal");
    doc.setFontSize(9);
    doc.setTextColor(...colors.darkText);

    // Signature lines
    doc.setDrawColor(...colors.secondary);
    doc.setLineWidth(0.5);

    // Authorized
    const lineY = yPosition + 15;
    doc.line(margin + 20, lineY, margin + 80, lineY);
    doc.setFont("helvetica", "bold");
    doc.setTextColor(...colors.primary);
    doc.text("AUTHORIZED SIGNATURE", margin + 50, lineY + 5, {
      align: "center",
    });

    // Received
    doc.line(pageWidth - margin - 80, lineY, pageWidth - margin - 20, lineY);
    doc.text("RECEIVED SIGNATURE", pageWidth - margin - 50, lineY + 5, {
      align: "center",
    });
  };

  // === Begin PDF Rendering ===
  let currentY = drawHeader();
  currentY = drawOrderDetails(currentY);
  currentY = drawTableHeader(currentY);

  orderItems?.forEach((item) => {
    if (currentY > pageHeight - 60) {
      doc.addPage();
      currentY = drawHeader();
      currentY = drawOrderDetails(currentY);
      currentY = drawTableHeader(currentY);
    }
    currentY = drawTableRow(item, currentY);
  });

  currentY = drawTotal(currentY);
  drawSignatures(currentY);

  if (mode === "print") {
    doc.autoPrint();
    window.open(doc.output("bloburl"), "_blank");
  }

  return doc;
};
