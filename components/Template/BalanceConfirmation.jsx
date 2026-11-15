import { jsPDF } from "jspdf";
import { DEFAULT_COMPANY_NAME, DEFAULT_COMPANY_LOGO, companyShortName } from "@/lib/companyName";

export function formatLetterDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return dateStr;
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
  });
}

export function formatBalanceAmount(amount) {
  const num = Number(amount) || 0;
  return num.toLocaleString("en-PK", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function drawLetterHeader(doc, companyData, page) {
  const actualCompany = companyData?.data || companyData;
  const companyName =
    actualCompany?.name ||
    actualCompany?.company ||
    DEFAULT_COMPANY_NAME;
  const companyAddress = Array.isArray(actualCompany?.address)
    ? actualCompany.address
    : [];
  const phone = actualCompany?.phone ? `Phone: ${actualCompany.phone}` : "";
  const cleanAddress = companyAddress.filter(
    (line) => !line.toLowerCase().includes("phone:")
  );
  const website = actualCompany?.website || "";
  const LOGO_RIGHT = actualCompany?.logo || DEFAULT_COMPANY_LOGO;

  let y = page.m;

  // Right: logo + short company name + company details
  const rx = page.w - page.m - 75;

  // Logo image
  try {
    doc.addImage(LOGO_RIGHT, "PNG", rx + 14, y, 8, 8);
  } catch {
    /* logo optional */
  }

  // Short company name (first word) as the bold label
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.setTextColor(30, 30, 30);
  doc.text(companyShortName(companyName), rx + 24, y + 5.5);

  // Company name
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(0, 0, 0);
  doc.text(companyName, rx + 24, y + 10);

  // Address lines
  doc.setFontSize(6.5);
  let ry = y + 14;
  cleanAddress.forEach((line) => {
    doc.text(line, rx + 24, ry);
    ry += 3;
  });
  if (phone) {
    doc.text(phone, rx + 24, ry);
    ry += 3;
  }
  if (website) doc.text(website, rx + 24, ry);

  return y + 28;
}

function drawLetterBody(doc, letter, companyData, startY, page) {
  const actualCompany = companyData?.data || companyData;
  const companyName =
    actualCompany?.name ||
    actualCompany?.company ||
    DEFAULT_COMPANY_NAME;
  const contentWidth = page.w - 2 * page.m;
  const asOfFormatted = formatLetterDate(letter.asOfDate);
  const letterDateFormatted = formatLetterDate(letter.letterDate);
  const balanceFormatted = formatBalanceAmount(letter.balance);
  const auditorName = letter.auditorName || "_________________________";
  const auditorEmail = letter.auditorEmail || "_________________________";

  let y = startY + 6;

  // Date
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.setTextColor(0, 0, 0);
  doc.text(letterDateFormatted, page.m, y);
  y += 9;

  // Customer name (bold uppercase)
  doc.setFont("helvetica", "bold");
  doc.setFontSize(9);
  doc.text(letter.customerName?.toUpperCase() || "", page.m, y);
  y += 4.5;

  // Customer address
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  const addressLines = doc.splitTextToSize(
    letter.customerAddress || "Address",
    contentWidth
  );
  addressLines.forEach((line) => {
    doc.text(line, page.m, y);
    y += 4;
  });
  y += 5;

  // Body paragraphs
  const paragraphs = [
    `As part of their normal audit procedures, we have been requested by our auditors, ${auditorName} to ask you to confirm directly to them whether or not the balance owing by you to the company as at ${asOfFormatted} agrees with your records at that date.`,
    `According to our records the balance at ${asOfFormatted} in our favour was Rs. ${balanceFormatted}.`,
    `If the balance is in agreement with that shown by your records, please sign the confirmation below and return it directly to ${auditorName} and also email it to ${auditorEmail}. Please do this even if the account has been settled.`,
    "If the balance is not in agreement with that shown by your records will you please send the confirmation to our auditors showing, if possible, details of the items making up the difference.",
  ];

  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);

  paragraphs.forEach((para, idx) => {
    if (idx === 1) {
      const prefix = `According to our records the balance at ${asOfFormatted} in our favour was Rs. `;
      const suffix = `.`;
      const widthPrefix = doc.getTextWidth(prefix);
      const widthBalance = doc.getTextWidth(balanceFormatted);

      if (y > page.h - 40) {
        doc.addPage();
        y = page.m + 10;
      }
      doc.text(prefix, page.m, y);
      doc.text(balanceFormatted, page.m + widthPrefix, y);
      doc.line(page.m + widthPrefix, y + 0.5, page.m + widthPrefix + widthBalance, y + 0.5);
      doc.text(suffix, page.m + widthPrefix + widthBalance, y);
      y += 4.5;
      y += 2.5;
      return;
    }

    const lines = doc.splitTextToSize(para, contentWidth);
    lines.forEach((line) => {
      if (y > page.h - 40) {
        doc.addPage();
        y = page.m + 10;
      }
      doc.text(line, page.m, y);
      y += 4.5;
    });
    y += 2.5;
  });

  y += 2;
  doc.text("Your co-operation in this matter is greatly appreciated.", page.m, y);
  y += 7;
  doc.text("Yours faithfully,", page.m, y);
  y += 16;

  doc.line(page.m, y, page.m + 55, y);
  y += 5;

  doc.text("For and on behalf of", page.m, y);
  y += 4.5;
  doc.setFont("helvetica", "bold");
  doc.text(companyName, page.m, y);
  y += 10;

  // Separator line
  doc.setDrawColor(0, 0, 0);
  doc.line(page.m, y, page.w - page.m, y);
  y += 8;

  // Section B options
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  doc.text("Please tick A or fill B as appropriate:", page.m, y);
  y += 7;

  const optAPrefix = `A:        The balance of Rs. `;
  const optASuffix = ` owing by us as at ${asOfFormatted} is in agreement with our records.`;
  const widthOptAPrefix = doc.getTextWidth(optAPrefix);
  const widthOptABalance = doc.getTextWidth(balanceFormatted);

  if (y > page.h - 40) {
    doc.addPage();
    y = page.m + 10;
  }
  doc.text(optAPrefix, page.m, y);
  doc.text(balanceFormatted, page.m + widthOptAPrefix, y);
  doc.line(page.m + widthOptAPrefix, y + 0.5, page.m + widthOptAPrefix + widthOptABalance, y + 0.5);
  doc.text(optASuffix, page.m + widthOptAPrefix + widthOptABalance, y);
  y += 4.5;
  y += 3;

  const optionB = `B:        The balance owing by us as at ${asOfFormatted} was ___________________________. Details of the difference are attached.`;
  doc.splitTextToSize(optionB, contentWidth).forEach((line) => {
    if (y > page.h - 40) {
      doc.addPage();
      y = page.m + 10;
    }
    doc.text(line, page.m, y);
    y += 4.5;
  });
  y += 14;

  // Signature line 
  doc.line(page.m, y, page.m + 55, y);
  y += 5;

  doc.text(`For and on behalf of`, page.m, y);
  y += 4.5;

  doc.text(letter.customerName || "", page.m, y);
  y += 10;

  // Signature line 
  doc.line(page.m, y, page.m + 55, y);
  y += 5;

  doc.text("Name & Designation", page.m, y);
  y += 4.5;

  doc.text(letter.customerName || "", page.m, y);

  // doc.text(`For and on behalf of ${letter.customerName || ""}`, page.m, y);
  // y += 12;
  // doc.text("Name & Designation", page.m, y);
  // y += 4.5;
  // doc.text(letter.customerName || "", page.m, y);

  // Footer company name
  doc.setFontSize(7);
  doc.setTextColor(0, 0, 0);
  doc.text(companyName, page.m, page.h - 8);
}

export function generateBalanceConfirmationPDF(letters, companyData = null, mode = "download") {
  if (!letters?.length) return null;

  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const page = { w: 210, h: 297, m: 15 };

  letters.forEach((letter, index) => {
    if (index > 0) doc.addPage();
    const headerEnd = drawLetterHeader(doc, companyData, page);
    drawLetterBody(doc, letter, companyData, headerEnd, page);
  });

  const fileName =
    letters.length === 1
      ? `Balance_Confirmation_${letters[0].customerName?.replace(/\s+/g, "_") || "letter"}.pdf`
      : "Balance_Confirmation_Letters.pdf";

  if (mode === "blob") {
    return doc.output("blob");
  }
  doc.save(fileName);
  return doc;
}

export function BalanceConfirmationPreview({ letter, companyData }) {
  const actualCompany = companyData?.data || companyData;
  const companyName =
    actualCompany?.name ||
    actualCompany?.company ||
    DEFAULT_COMPANY_NAME;
  const companyAddress = Array.isArray(actualCompany?.address)
    ? actualCompany.address
    : [];
  const phone = actualCompany?.phone ? `Phone: ${actualCompany.phone}` : "";
  const cleanAddress = companyAddress.filter(
    (line) => !line.toLowerCase().includes("phone:")
  );
  const website = actualCompany?.website || "";
  const asOfFormatted = formatLetterDate(letter.asOfDate);
  const letterDateFormatted = formatLetterDate(letter.letterDate);
  const balanceFormatted = formatBalanceAmount(letter.balance);

  return (
    <div
      className="bg-white text-black mx-auto shadow-md print:shadow-none print:p-0"
      style={{
        maxWidth: "210mm",
        padding: "15mm",
        fontFamily: "Arial, sans-serif",
        fontSize: "9pt",
        lineHeight: "1.4",
      }}
    >
      {/* Header */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginBottom: "20px" }}>
        {/* Left: spacer — keeps the company block on the right */}
        <div />

        {/* Right: logo + company info */}
        <div style={{ textAlign: "left", fontSize: "7pt", maxWidth: "55%" }}>
          <div style={{ display: "flex", alignItems: "flex-start", gap: "6px" }}>
            {actualCompany?.logo && (
              <img
                src={actualCompany.logo}
                alt="Logo"
                style={{ height: "20px", marginTop: "1px", flexShrink: 0 }}
              />
            )}
            <div>
              <p style={{ fontWeight: "bold", fontSize: "9pt", margin: "0 0 2px 0" }}>
                {companyShortName(companyName)}
              </p>
              <p style={{ margin: "0 0 1px 0", fontSize: "7pt" }}>{companyName}</p>
              {cleanAddress.map((line, i) => (
                <p key={i} style={{ margin: "0 0 1px 0", fontSize: "6.5pt" }}>
                  {line}
                </p>
              ))}
              {phone && <p style={{ margin: "0 0 1px 0", fontSize: "6.5pt" }}>{phone}</p>}
              {website && <p style={{ margin: 0, fontSize: "6.5pt" }}>{website}</p>}
            </div>
          </div>
        </div>
      </div>

      {/* Date */}
      <p style={{ marginBottom: "16px" }}>{letterDateFormatted}</p>

      {/* Customer */}
      <p style={{ fontWeight: "bold", textTransform: "uppercase", marginBottom: "2px" }}>
        {letter.customerName}
      </p>
      <p style={{ marginBottom: "16px" }}>{letter.customerAddress || "Address"}</p>

      {/* Paragraphs */}
      <p style={{ marginBottom: "10px", textAlign: "justify" }}>
        As part of their normal audit procedures, we have been requested by our auditors,{" "}
        <strong>{letter.auditorName}</strong> to ask you to confirm directly to them whether or not
        the balance owing by you to the company as at <strong>{asOfFormatted}</strong> agrees with
        your records at that date.
      </p>

      {/* <p style={{ marginBottom: "10px", textAlign: "justify" }}>
        According to our records the balance at <strong>{asOfFormatted}</strong> in our favour was{" "}
        <strong>Rs. {balanceFormatted}</strong>.
      </p> */}
      <p style={{ marginBottom: "10px", textAlign: "justify" }}>
        According to our records the balance at{" "}
        <strong>{asOfFormatted}</strong> in our favour was{" "}
        <span
          style={{
            display: "inline-block",
            borderBottom: "1px solid #000",
            fontWeight: "bold",
          }}
        >
          Rs. {balanceFormatted}
        </span>.
      </p>

      <p style={{ marginBottom: "10px", textAlign: "justify" }}>
        If the balance is in agreement with that shown by your records, please sign the confirmation
        below and return it directly to <strong>{letter.auditorName}</strong> and also email it to{" "}
        <strong>{letter.auditorEmail}</strong>. Please do this even if the account has been settled.
      </p>

      <p style={{ marginBottom: "10px", textAlign: "justify" }}>
        If the balance is not in agreement with that shown by your records will you please send the
        confirmation to our auditors showing, if possible, details of the items making up the
        difference.
      </p>

      <p style={{ marginBottom: "6px" }}>Your co-operation in this matter is greatly appreciated.</p>
      <p style={{ marginBottom: "28px" }}>Yours faithfully,</p>
      <p style={{ marginBottom: "3px" }}>For and on behalf of</p>
      <p style={{ fontWeight: "bold", marginBottom: "20px" }}>{companyName}</p>

      <hr style={{ borderColor: "#000", margin: "16px 0" }} />

      <p style={{ marginBottom: "10px" }}>Please tick A or fill B as appropriate:</p>
      {/* <p style={{ marginBottom: "8px" }}>
        <span style={{ display: "inline-block", width: "20px", fontWeight: "normal" }}>A:</span>
        {"  "}The balance of <strong>Rs. {balanceFormatted}</strong> owing by us as at{" "}
        <strong>{asOfFormatted}</strong> is in agreement with our records.
      </p> */}
      <p style={{ marginBottom: "8px" }}>
        <span
          style={{
            display: "inline-block",
            width: "20px",
            fontWeight: "normal",
          }}
        >
          A:
        </span>
        {" "}
        The balance of{" "}
        <span
          style={{
            display: "inline-block",
            borderBottom: "1px solid #000",
            paddingBottom: "1px",
            fontWeight: "bold",
          }}
        >
          Rs. {balanceFormatted}
        </span>{" "}
        owing by us as at <strong>{asOfFormatted}</strong> is in agreement with our records.
      </p>
      <p style={{ marginBottom: "26px" }}>
        <span style={{ display: "inline-block", width: "20px" }}>B:</span>
        {"  "}The balance owing by us as at <strong>{asOfFormatted}</strong> was{" "}
        ___________________________. Details of the difference are attached.
      </p>

      <div style={{ marginTop: "40px" }}>
        <div style={{ borderTop: "1px solid #000", width: "200px", marginBottom: "5px" }}></div>
        <p style={{ margin: "0 0 4.5px 0" }}>For and on behalf of</p>
        <p style={{ margin: "0 0 10px 0" }}>{letter.customerName || ""}</p>

        <div style={{ borderTop: "1px solid #000", width: "200px", marginBottom: "5px" }}></div>
        <p style={{ margin: "0 0 4.5px 0" }}>Name &amp; Designation</p>
        <p style={{ margin: "0" }}>{letter.customerName || ""}</p>
      </div>

      <p style={{ fontSize: "7pt", color: "#aaa", marginTop: "24px" }}>{companyName}</p>
    </div>
  );
}
