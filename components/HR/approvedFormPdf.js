// components/HR/approvedFormPdf.js — the "Final Filled Approved Form" of a
// leave / salary advance / loan request that went through its approval chain
// (lib/hr/chains.js). Built from the request page's own data
// (GET /api/approvals/requests/[id]): the details, every step with who
// approved it, when and their remarks, and signature lines.
// Standard layout until the owner's template replaces it (only this file).
// Browser only: jspdf + jspdf-autotable load when the form is downloaded.

const BRAND = [128, 0, 0];
const when = (d) =>
  d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "—";

const ACTION = { approved: "Approved", rejected: "Rejected", paid: "Paid" };

export async function downloadApprovedForm({ company, d }) {
  const { jsPDF } = await import("jspdf");
  const { default: autoTable } = await import("jspdf-autotable");
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const W = doc.internal.pageSize.getWidth();
  const r = d.request;
  const address = Array.isArray(company?.address) ? company.address.filter(Boolean).join(", ") : company?.address || "";

  // Header band
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

  // Details of the request
  autoTable(doc, {
    startY: doc.lastAutoTable.finalY + 4,
    head: [["Details", ""]],
    theme: "grid",
    headStyles: { fillColor: BRAND, textColor: 255, fontSize: 9 },
    styles: { fontSize: 9, cellPadding: 2 },
    columnStyles: { 0: { cellWidth: 50, fontStyle: "bold" } },
    body: (d.header ?? []).map((h) => [h.label, String(h.value ?? "")]),
  });

  // Instalments / days, when the request has lines
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

  // Approval trail — every step, who, when, remarks
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

  // Signatures
  let y = doc.lastAutoTable.finalY + 22;
  if (y > doc.internal.pageSize.getHeight() - 30) {
    doc.addPage();
    y = 40;
  }
  const sig = ["Employee", "HR", "Approved by", "Accounts / Paid by"];
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
  doc.save(`approved-form-R-${r.id}.pdf`);
}
