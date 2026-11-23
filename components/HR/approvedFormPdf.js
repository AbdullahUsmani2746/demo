// components/HR/approvedFormPdf.js — the "Final Filled Approved Form" of a
// request that went through its approval chain (lib/hr/chains.js, or an
// approval rule in steps — lib/approvals/docChains.js). Built from the request
// page's own data (GET /api/approvals/requests/[id]).
//
//   Salary advance / loan (d.form.kind ADVANCE / LOAN), when Settings →
//     Features "hr.applicationLetters" is on → the application letter (SMS
//     templates, 20 Nov 2026: "LOAN APPLICATION
//     (INTERNAL)" to the Managing Director, "ADVANCE SALARY APPLICATION
//     (INTERNAL)" to HR): employee information, request details, Department
//     Head recommendation and Final Approval filled from the chain — who, when,
//     remarks — with the company logo as a light watermark.
//   Anything else → the standard layout: details, lines, every step, signatures.
// Browser only: jspdf + jspdf-autotable load when the form is downloaded.
import { featureAsync } from "@/lib/features/client";

const BRAND = [128, 0, 0];
const INK = [20, 20, 20];
const when = (d) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";
const ACTION = { approved: "Approved", rejected: "Rejected", paid: "Paid" };

const ordinal = (n) => {
  const s = ["th", "st", "nd", "rd"];
  const v = n % 100;
  return `${n}${s[(v - 20) % 10] || s[v] || s[0]}`;
};
/** 19th November, 2026 */
const longDate = (d) => {
  const x = d ? new Date(d) : new Date();
  return `${ordinal(x.getDate())} ${x.toLocaleString("en-GB", { month: "long" })}, ${x.getFullYear()}`;
};
const dmy = (d) => {
  if (!d) return "";
  const x = new Date(d);
  return `${String(x.getDate()).padStart(2, "0")}-${String(x.getMonth() + 1).padStart(2, "0")}-${x.getFullYear()}`;
};
const rs = (n) => (n == null || n === "" ? "" : `Rs. ${Math.round(Number(n)).toLocaleString("en-US")}/-`);

async function loadImage(src) {
  if (!src) return null;
  try {
    const res = await fetch(src);
    if (!res.ok) return null;
    const blob = await res.blob();
    return await new Promise((resolve) => {
      const reader = new FileReader();
      reader.onloadend = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
  } catch {
    return null;
  }
}

/** Who approved what, read from the chain: recommendation (before the final step), final approval, payment. */
function decisionsOf(d) {
  const steps = d.chain?.steps ?? [];
  const final = d.chain?.final ?? steps.length - 1;
  const acted = steps.flatMap((s, i) => (s.acted ?? []).map((a) => ({ ...a, step: i, label: s.label })));
  const approved = acted.filter((a) => a.action === "approved");
  return {
    recommend: approved.filter((a) => a.step < final).at(-1) ?? null,
    final: approved.find((a) => a.step === final) ?? null,
    paid: acted.find((a) => a.action === "paid") ?? null,
  };
}

export async function downloadApprovedForm({ company, d }) {
  const { jsPDF } = await import("jspdf");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  if ((d.form?.kind === "LOAN" || d.form?.kind === "ADVANCE") && (await featureAsync("hr.applicationLetters"))) {
    await applicationLetter(doc, { company, d });
    doc.save(`${d.form.kind === "LOAN" ? "loan" : "advance-salary"}-application-${d.form.employee_name.replace(/\s+/g, "-")}-R-${d.request.id}.pdf`);
    return;
  }
  const { default: autoTable } = await import("jspdf-autotable");
  standardForm(doc, autoTable, { company, d });
  doc.save(`approved-form-R-${d.request.id}.pdf`);
}

// ── The company's application letter (loan / salary advance) ───────────────
async function applicationLetter(doc, { company, d }) {
  const f = d.form;
  const loan = f.kind === "LOAN";
  const W = doc.internal.pageSize.getWidth();
  const H = doc.internal.pageSize.getHeight();
  const L = 25;
  const R = W - 25;
  const logo = await loadImage(company?.logo || "/logo/logo.jpeg");
  const { recommend, final } = decisionsOf(d);

  const watermark = () => {
    if (!logo) return;
    try {
      const { width, height } = doc.getImageProperties(logo);
      const w = 120;
      const h = (w * height) / width;
      doc.saveGraphicsState();
      doc.setGState(new doc.GState({ opacity: 0.12 }));
      doc.addImage(logo, (W - w) / 2, (H - h) / 2 - 10, w, h);
      doc.restoreGraphicsState();
    } catch {
      /* no watermark */
    }
  };
  watermark();

  let y = 28;
  doc.setTextColor(...INK);
  doc.setFont("times", "bold");
  doc.setFontSize(17);
  doc.text(loan ? "LOAN APPLICATION (INTERNAL)" : "ADVANCE SALARY APPLICATION (INTERNAL)", W / 2, y, { align: "center" });

  y += 13;
  doc.setFontSize(11);
  doc.text("Date:", L, y);
  doc.setFont("times", "normal");
  doc.text(longDate(d.request.requested_at), L + 11, y);

  y += 10;
  doc.setFont("times", "bold");
  doc.text("To", L, y);
  doc.setFont("times", "normal");
  doc.text(loan ? "The Managing Director" : "Human Resource Department", L, y + 5.5);

  y += 20;
  doc.setFont("times", "bold");
  doc.setFontSize(12.5);
  const subject = `Subject: ${loan ? "Loan Request" : "Advance Salary Request"} – Approval`;
  doc.text(subject, L, y);
  doc.setLineWidth(0.3);
  doc.line(L, y + 1, L + doc.getTextWidth(subject), y + 1);

  // Body paragraph — the employee's name in bold, as on the template.
  y += 9;
  doc.setFontSize(11);
  const para = (text, x0, y0, width, lh = 5.6) => {
    const words = text.split(/\s+/);
    let line = [];
    let yy = y0;
    const flush = (last = false) => {
      const plain = line.map((w) => w.t).join(" ");
      let x = x0;
      const gaps = line.length - 1;
      const natural = line.reduce((s, w) => {
        doc.setFont("times", w.b ? "bold" : "normal");
        return s + doc.getTextWidth(w.t) + (w.b ? 0.6 : 0);
      }, 0);
      doc.setFont("times", "normal");
      const space = doc.getTextWidth(" ");
      const extra = !last && gaps > 0 ? (width - natural - gaps * space) / gaps : 0;
      for (const w of line) {
        doc.setFont("times", w.b ? "bold" : "normal");
        doc.text(w.t, x, yy);
        x += doc.getTextWidth(w.t) + space + extra + (w.b ? 0.6 : 0);
      }
      yy += lh;
      return plain;
    };
    for (const raw of words) {
      const w = raw.startsWith("**") ? { t: raw.replace(/\*\*/g, ""), b: true } : { t: raw, b: raw.endsWith("**") };
      w.t = w.t.replace(/\*\*/g, "");
      const test = [...line, w];
      const widthOf = test.reduce((s, x) => {
        doc.setFont("times", x.b ? "bold" : "normal");
        return s + doc.getTextWidth(x.t);
      }, 0) + (test.length - 1) * doc.getTextWidth(" ");
      if (widthOf > width && line.length) {
        flush();
        line = [w];
      } else line = test;
    }
    if (line.length) flush(true);
    doc.setFont("times", "normal");
    return yy;
  };
  const bold = (s) => s.split(/\s+/).map((w) => `**${w}**`).join(" ");
  y = para(
    `This application has been generated by the ${loan ? "HR/Admin" : "HR"} Department based on the information submitted by ${bold(f.employee_name)} through the official ${loan ? "online loan" : "advance salary"} request form. The employee obtained prior verbal consent from the concerned Head of Department${loan ? "" : " / Manager"} before submitting the request. After internal review and verification of the submitted details, this application is now being presented for ${bold(loan ? "written HOD endorsement and final management approval," : "written HOD / Manager endorsement and final management approval,")} as per applicable company policies.`,
    L, y, R - L,
  );

  const heading = (text) => {
    y += 6;
    doc.setFont("times", "bold");
    doc.setFontSize(12.5);
    doc.text(text, L, y);
    doc.line(L, y + 1, L + doc.getTextWidth(text), y + 1);
    doc.setFontSize(11);
    y += 9;
  };
  // Width of a label in bold (measured while bold is set, so the value never runs into it).
  const boldWidth = (t) => {
    doc.setFont("times", "bold");
    const w = doc.getTextWidth(t);
    doc.setFont("times", "normal");
    return w;
  };
  const field = (label, value) => {
    const lw = boldWidth(`${label}:`) + 2.2;
    doc.setFont("times", "bold");
    doc.text(`${label}:`, L, y);
    doc.setFont("times", "normal");
    const lines = doc.splitTextToSize(String(value || "—"), R - L - lw - 2);
    doc.text(lines, L + lw, y);
    y += 7 * Math.max(1, lines.length) - (lines.length > 1 ? 1.5 * (lines.length - 1) : 0);
  };

  heading("Employee Information");
  field("Employee Name", f.employee_name);
  field("Employee Code / ID", f.employee_code);
  field("Designation", f.designation);
  field("Department", f.department);
  if (loan) {
    field("Date of Joining", dmy(f.joined));
    field("CNIC No", f.cnic);
  }
  field("Salary", f.salary ? rs(f.salary) : "Not set");

  heading(loan ? "Loan Request Details" : "Advance Salary Request Details");
  if (loan) {
    field("Loan Type", "Personal Loan");
    field("Loan Amount Requested", rs(f.amount));
    field("Purpose of Loan", f.purpose);
    field("Repayment Period", `${f.months} Month${f.months === 1 ? "" : "s"}`);
    field("Proposed Monthly Deduction", rs(f.installment));
  } else {
    field("Amount Requested", rs(f.amount));
    if (f.purpose) field("Reason", f.purpose);
    field("Recovery", `${rs(f.installment)} × ${f.months} month(s), from ${f.start_month}`);
  }

  // Page 2 for the loan (as the template); the advance fits on one page.
  if (loan) {
    doc.addPage();
    watermark();
    y = 28;
  } else y += 2;

  doc.setFont("times", "normal");
  doc.setFontSize(11);
  y = para(
    `The request is hereby submitted for detailed review and consideration, and for final approval by the competent authority, strictly in accordance with the company’s approved ${loan ? "loan " : ""}policy, internal procedures and applicable terms and conditions.`,
    L, y, R - L,
  );
  if (loan) {
    y += 4;
    doc.setFont("times", "bold");
    doc.text("Attachment:", L, y);
    doc.setFont("times", "normal");
    doc.setFontSize(10);
    doc.text("Online Loan Request Form duly filled and submitted by the employee / admin.", L + boldWidth("Attachment:") + 2.2, y);
    doc.setFontSize(11);
    y += 4;
  }

  // Department Head recommendation — the step before the final approval.
  const signLine = (name, a, x = L) => {
    doc.setLineWidth(0.4);
    doc.line(x, y, x + 65, y);
    doc.setFont("times", "bold");
    doc.text(name || "", x, y + 5);
    doc.text(a ? `Signed online · ${when(a.at)}` : "Signature & Date", x, y + 10);
    doc.setFont("times", "normal");
  };
  // A section that does not fit goes to a new page (the footer keeps 20mm).
  const ensure = (space) => {
    if (y + space <= H - 20) return;
    doc.addPage();
    watermark();
    y = 28;
  };
  y += 8;
  ensure(60);
  doc.setFont("times", "bold");
  doc.setFontSize(13);
  doc.text("Department Head Recommendation", L, y);
  doc.setFontSize(11);
  y += 8;
  doc.setFont("times", "normal");
  y = para("I confirm that I have reviewed the above request and recommend it for management approval.", L, y, R - L);
  y += 4;
  doc.setFont("times", "bold");
  doc.text("Recommended Amount (If Different):", L, y);
  doc.setFont("times", "normal");
  doc.text(recommend ? "Same as requested" : "__________________", L + boldWidth("Recommended Amount (If Different):") + 2.2, y);
  if (recommend?.note) {
    y += 6;
    doc.text(doc.splitTextToSize(`Remarks: ${recommend.note}`, R - L), L, y);
  }
  y += 24;
  signLine(recommend?.by, recommend);

  // Final approval (CEO / Managing Director) — the chain's final step.
  y += 26;
  ensure(70);
  doc.setFont("times", "bold");
  doc.setFontSize(13);
  doc.text(loan ? "Final Approval (CEO / Authorized Managing Director)" : "Final Approval", L, y);
  doc.setFontSize(11);
  y += 9;
  doc.setFont("zapfdingbats", "normal");
  doc.text(final ? "n" : "o", L, y); // ■ ticked box / □
  doc.text("o", L + 32, y);
  doc.setFont("times", "normal");
  doc.text("Approved", L + 5, y);
  doc.text("Not Approved", L + 37, y);
  y += 8;
  doc.text(`Approved ${loan ? "Loan " : ""}Amount:`, L, y);
  doc.text(final ? rs(f.amount) : "______________________", L + 52, y);
  if (loan) {
    y += 6;
    doc.text("Approved Repayment Terms:", L, y);
    doc.text(final ? `${f.months} (Months)` : "___________(Months)", L + 52, y);
  }
  if (final?.note) {
    y += 6;
    doc.text(doc.splitTextToSize(`Remarks: ${final.note}`, R - L), L, y);
  }
  y += 26;
  signLine(final?.by || (loan ? "Managing Director" : ""), final);

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184);
  const pages = doc.getNumberOfPages();
  for (let p = 1; p <= pages; p++) {
    doc.setPage(p);
    doc.text(`Generated from the ERP approval record R-${d.request.id} · approved online by the people named · printed ${when(new Date())}`, W / 2, H - 8, { align: "center" });
  }
}

// ── Standard layout (anything without its own template) ────────────────────
function standardForm(doc, autoTable, { company, d }) {
  const W = doc.internal.pageSize.getWidth();
  const r = d.request;
  const address = Array.isArray(company?.address) ? company.address.filter(Boolean).join(", ") : company?.address || "";

  doc.setFillColor(...BRAND);
  doc.rect(0, 0, W, 26, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(15);
  doc.text(company?.name || "Approved Form", 14, 12);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(9);
  if (address) doc.text(address, 14, 19, { maxWidth: W - 100 });
  doc.setFont("helvetica", "bold");
  doc.setFontSize(12);
  doc.text(`${String(r.form || "Request").toUpperCase()} — APPROVED FORM`, W - 14, 15, { align: "right" });

  doc.setTextColor(30, 41, 59);
  autoTable(doc, {
    startY: 32,
    theme: "plain",
    styles: { fontSize: 9, cellPadding: 1.2 },
    columnStyles: { 0: { textColor: [100, 116, 139], cellWidth: 34 }, 2: { textColor: [100, 116, 139], cellWidth: 30 } },
    body: [
      ["Request no.", `R-${r.id}`, "Status", r.status === "approved" ? "Approved" : "Approved — payment pending"],
      ["Entered by", r.requested_by || "—", "Entered on", when(r.requested_at)],
      ["Approval chain", d.chain?.name || "—", "Result", r.posted_no || "—"],
    ],
  });

  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 4,
    head: [["Details", ""]],
    theme: "grid",
    headStyles: { fillColor: BRAND, textColor: 255, fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 0: { cellWidth: 50, fontStyle: "bold" } },
    body: (d.header ?? []).map((h) => [h.label, String(h.value ?? "")]),
  });

  if (d.lines?.rows?.length) {
    autoTable(doc, {
      startY: doc.lastAutoTable.finalY + 4,
      head: [d.lines.columns],
      theme: "striped",
      headStyles: { fillColor: [71, 85, 105], fontSize: 8 },
      styles: { fontSize: 8, cellPadding: 1.5 },
      body: d.lines.rows,
    });
  }

  const trail = [];
  for (const [i, s] of (d.chain?.steps ?? []).entries()) {
    if (s.acted?.length) {
      for (const a of s.acted) {
        trail.push([
          `${i + 1}. ${s.label}${s.final ? " (final)" : ""}`,
          `${ACTION[a.action] ?? a.action}${a.forwarded_to?.length ? ` → ${a.forwarded_to.join(", ")}` : ""}`,
          a.by || "—",
          when(a.at),
          a.note || "",
        ]);
      }
    } else {
      trail.push([`${i + 1}. ${s.label}${s.final ? " (final)" : ""}`, s.state === "current" ? "Waiting" : "—", s.now?.join(" / ") || s.who?.join(" / ") || "—", "", ""]);
    }
  }
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 4,
    head: [["Step", "Decision", "By", "On", "Remarks"]],
    theme: "grid",
    headStyles: { fillColor: BRAND, textColor: 255, fontSize: 9 },
    styles: { fontSize: 8.5, cellPadding: 2 },
    columnStyles: { 0: { cellWidth: 42 }, 1: { cellWidth: 34 }, 2: { cellWidth: 34 }, 3: { cellWidth: 32 } },
    body: trail,
  });

  let y = doc.lastAutoTable.finalY + 22;
  if (y > doc.internal.pageSize.getHeight() - 30) {
    doc.addPage();
    y = 40;
  }
  const sig = ["Prepared by", "Checked by", "Approved by", "Accounts / Paid by"];
  const colW = (W - 28) / sig.length;
  doc.setFontSize(8.5);
  doc.setTextColor(71, 85, 105);
  sig.forEach((label, i) => {
    const x = 14 + i * colW;
    doc.line(x + 3, y, x + colW - 3, y);
    doc.text(label, x + colW / 2, y + 5, { align: "center" });
  });

  doc.setFontSize(7.5);
  doc.setTextColor(148, 163, 184);
  doc.text(`Printed ${when(new Date())} · generated from the ERP approval record R-${r.id}`, 14, doc.internal.pageSize.getHeight() - 8);
}
