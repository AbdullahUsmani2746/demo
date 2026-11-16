// lib/pos/receiptHtml.js
// ============================================================
// Printable POS documents, as self-contained HTML (client-safe):
//   receiptHtml(r, ctx)   thermal receipt, 58 / 80 mm roll (Settings → Point of Sale → Receipt paper)
//   invoiceHtml(r, ctx)   A4 invoice of the same receipt
//   zReportHtml(z, ctx)   shift / day close (Z report) on the thermal roll
// ctx = { company, settings, currency }. printHtml() prints through a hidden
// iframe, so the till page itself is never re-laid out for print.
// ============================================================

const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);
const money = (n) => (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const qtyFmt = (n) => (Number(n) || 0).toLocaleString("en-US", { maximumFractionDigits: 3 });
const when = (d) => (d ? new Date(d).toLocaleString("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "");
const METHOD = { CASH: "Cash", CARD: "Card / Bank", CREDIT: "On account" };

function companyBlock(company, settings, { center = true } = {}) {
  const addr = [company?.addr1, company?.addr2, company?.city].filter(Boolean).join(", ");
  return `
    <div class="${center ? "c" : ""}">
      <div class="co">${esc(company?.company || "")}</div>
      ${addr ? `<div>${esc(addr)}</div>` : ""}
      ${company?.phone ? `<div>Tel ${esc(company.phone)}</div>` : ""}
      ${settings?.receiptHeader ? `<div class="pre">${esc(settings.receiptHeader)}</div>` : ""}
    </div>`;
}

const thermalCss = (w) => `
  @page { size: ${w}mm auto; margin: 0; }
  * { box-sizing: border-box; }
  body { margin: 0; padding: 3mm ${w === 58 ? 2 : 4}mm; width: ${w}mm; font: ${w === 58 ? 10.5 : 12}px/1.35 "Courier New", ui-monospace, monospace; color: #000; }
  .c { text-align: center; } .r { text-align: right; } .b { font-weight: 700; }
  .co { font-size: 1.35em; font-weight: 700; margin-bottom: 2px; }
  .pre { white-space: pre-line; }
  hr { border: 0; border-top: 1px dashed #000; margin: 6px 0; }
  table { width: 100%; border-collapse: collapse; }
  td { padding: 1px 0; vertical-align: top; }
  .tot td { font-size: 1.25em; font-weight: 700; padding-top: 3px; }
  .muted { font-size: .9em; }
  .tag { display: inline-block; border: 1px solid #000; padding: 1px 6px; font-weight: 700; margin: 4px 0; }
`;

function shell(title, css, body) {
  return `<!doctype html><html><head><meta charset="utf-8"><title>${esc(title)}</title><style>${css}</style></head><body>${body}</body></html>`;
}

export function receiptHtml(r, { company, settings, currency = "" } = {}) {
  const w = Number(settings?.paperWidth) === 58 ? 58 : 80;
  const isReturn = r.kind === "RETURN";
  const customer = r.customer_name || r.party?.acname || settings?.walkInName || "Walk-in Customer";
  const lines = (r.items || [])
    .map(
      (i) => `
      <tr><td colspan="2">${esc(i.name)}${i.code ? ` <span class="muted">(${esc(i.code)})</span>` : ""}</td></tr>
      <tr><td class="muted">&nbsp; ${qtyFmt(i.qty)} ${esc(i.unit || "")} × ${money(i.rate)}${i.discount ? ` − ${money(i.discount)}` : ""}</td><td class="r">${money(isReturn ? i.net : i.gross - (i.discount || 0))}</td></tr>
      ${i.note ? `<tr><td colspan="2" class="muted">&nbsp; ${esc(i.note)}</td></tr>` : ""}`,
    )
    .join("");
  const pays = (r.payments || []).map((p) => `<tr><td>${isReturn ? "Refund — " : ""}${METHOD[p.method] || p.method}${p.reference ? ` <span class="muted">${esc(p.reference)}</span>` : ""}</td><td class="r">${money(p.amount)}</td></tr>`).join("");
  const body = `
    ${companyBlock(company, settings)}
    <hr>
    <div class="c">${isReturn ? '<span class="tag">REFUND</span><br>' : ""}<span class="b">${esc(r.invoice_no || "")}</span></div>
    <table class="muted">
      <tr><td>${esc(when(r.time || r.dated))}</td><td class="r">${esc(r.entered_by || "")}</td></tr>
      <tr><td colspan="2">Customer: ${esc(customer)}${r.customer_phone ? ` · ${esc(r.customer_phone)}` : ""}</td></tr>
      ${isReturn && r.ref ? `<tr><td colspan="2">Refund of ${esc(r.ref.invoice_no)}</td></tr>` : ""}
    </table>
    <hr>
    <table>${lines}</table>
    <hr>
    <table>
      ${r.discount ? `<tr><td>Subtotal</td><td class="r">${money(r.subtotal)}</td></tr><tr><td>Discount</td><td class="r">− ${money(r.discount)}</td></tr>` : ""}
      ${r.tax ? `<tr><td>Tax</td><td class="r">${money(r.tax)}</td></tr>` : ""}
      ${r.rounding ? `<tr><td>Round off</td><td class="r">${money(r.rounding)}</td></tr>` : ""}
      <tr class="tot"><td>${isReturn ? "REFUNDED" : "TOTAL"} ${esc(currency)}</td><td class="r">${money(r.total)}</td></tr>
    </table>
    <hr>
    <table>
      ${pays}
      ${!isReturn && r.tendered ? `<tr><td>Tendered</td><td class="r">${money(r.tendered)}</td></tr>` : ""}
      ${!isReturn && r.change_due ? `<tr class="b"><td>Change</td><td class="r">${money(r.change_due)}</td></tr>` : ""}
    </table>
    <hr>
    <div class="c muted">Items: ${qtyFmt((r.items || []).reduce((s, i) => s + i.qty, 0))}</div>
    ${settings?.receiptFooter ? `<div class="c pre" style="margin-top:6px">${esc(settings.receiptFooter)}</div>` : ""}
    <div style="height:8mm"></div>`;
  return shell(r.invoice_no || "Receipt", thermalCss(w), body);
}

export function invoiceHtml(r, { company, settings, currency = "" } = {}) {
  const isReturn = r.kind === "RETURN";
  const customer = r.customer_name || r.party?.acname || settings?.walkInName || "Walk-in Customer";
  const css = `
    @page { size: A4; margin: 14mm; }
    body { font: 12px/1.45 system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif; color: #1a1a1a; margin: 0; }
    .head { display: flex; justify-content: space-between; align-items: flex-start; border-bottom: 3px solid #800000; padding-bottom: 10px; }
    .co { font-size: 20px; font-weight: 800; color: #800000; }
    .pre { white-space: pre-line; }
    h1 { margin: 0; font-size: 22px; letter-spacing: .04em; text-align: right; }
    .meta { margin-top: 14px; display: grid; grid-template-columns: 1fr 1fr; gap: 12px; }
    .box { border: 1px solid #ddd; border-radius: 6px; padding: 8px 10px; }
    .lbl { font-size: 10px; text-transform: uppercase; letter-spacing: .06em; color: #777; }
    table { width: 100%; border-collapse: collapse; margin-top: 16px; }
    th { background: #800000; color: #fff; text-align: left; font-size: 11px; padding: 6px 8px; }
    td { border-bottom: 1px solid #eee; padding: 6px 8px; vertical-align: top; }
    .r { text-align: right; } .muted { color: #777; font-size: 11px; }
    .totals { margin-left: auto; width: 300px; margin-top: 10px; }
    .totals td { border: 0; padding: 3px 8px; }
    .grand td { font-size: 16px; font-weight: 800; border-top: 2px solid #800000; padding-top: 6px; }
    .foot { margin-top: 28px; border-top: 1px solid #ddd; padding-top: 8px; text-align: center; color: #555; }
  `;
  const rows = (r.items || [])
    .map(
      (i, n) => `<tr><td>${n + 1}</td><td>${esc(i.name)}${i.code ? `<div class="muted">${esc(i.code)}</div>` : ""}${i.note ? `<div class="muted">${esc(i.note)}</div>` : ""}</td>
      <td class="r">${qtyFmt(i.qty)} ${esc(i.unit || "")}</td><td class="r">${money(i.rate)}</td><td class="r">${i.discount ? money(i.discount) : ""}</td>
      <td class="r">${i.tax ? money(i.tax) : ""}</td><td class="r">${money((isReturn ? i.net : i.gross - (i.discount || 0)) + (i.tax || 0))}</td></tr>`,
    )
    .join("");
  const pays = (r.payments || []).map((p) => `${METHOD[p.method] || p.method} ${money(p.amount)}${p.reference ? ` (${esc(p.reference)})` : ""}`).join(" · ");
  const body = `
    <div class="head">
      <div>${companyBlock(company, settings, { center: false })}</div>
      <div><h1>${isReturn ? "CREDIT NOTE" : "INVOICE"}</h1><div class="r"><b>${esc(r.invoice_no || "")}</b></div><div class="r muted">${esc(when(r.time || r.dated))}</div></div>
    </div>
    <div class="meta">
      <div class="box"><div class="lbl">Bill to</div><b>${esc(customer)}</b>${r.party?.acno && r.customer_name !== settings?.walkInName ? `<div class="muted">Account ${esc(r.party.acno)}</div>` : ""}${r.customer_phone ? `<div>${esc(r.customer_phone)}</div>` : ""}</div>
      <div class="box"><div class="lbl">Details</div>${r.godown ? `<div>Godown: ${esc(r.godown.godown)}</div>` : ""}<div>Cashier: ${esc(r.entered_by || "")}</div>${isReturn && r.ref ? `<div>Refund of ${esc(r.ref.invoice_no)}</div>` : ""}</div>
    </div>
    <table><thead><tr><th>#</th><th>Item</th><th class="r">Qty</th><th class="r">Rate</th><th class="r">Discount</th><th class="r">Tax</th><th class="r">Amount</th></tr></thead><tbody>${rows}</tbody></table>
    <table class="totals">
      <tr><td>Subtotal</td><td class="r">${money(r.subtotal)}</td></tr>
      ${r.discount ? `<tr><td>Discount</td><td class="r">− ${money(r.discount)}</td></tr>` : ""}
      ${r.tax ? `<tr><td>Tax</td><td class="r">${money(r.tax)}</td></tr>` : ""}
      ${r.rounding ? `<tr><td>Round off</td><td class="r">${money(r.rounding)}</td></tr>` : ""}
      <tr class="grand"><td>${isReturn ? "Refunded" : "Total"} ${esc(currency)}</td><td class="r">${money(r.total)}</td></tr>
    </table>
    ${pays ? `<p class="muted" style="text-align:right">${isReturn ? "Refunded by" : "Paid by"}: ${pays}</p>` : ""}
    ${settings?.receiptFooter ? `<div class="foot pre">${esc(settings.receiptFooter)}</div>` : ""}`;
  return shell(r.invoice_no || "Invoice", css, body);
}

export function zReportHtml(z, { company, settings, title = "Z REPORT", shift = null, currency = "" } = {}) {
  const w = Number(settings?.paperWidth) === 58 ? 58 : 80;
  const row = (l, v, cls = "") => `<tr class="${cls}"><td>${esc(l)}</td><td class="r">${v}</td></tr>`;
  const body = `
    ${companyBlock(company, settings)}
    <hr><div class="c b">${esc(title)}</div>
    <table class="muted">
      ${shift ? row("Shift", `#${shift.id}`) + row("Cashier", esc(shift.cashier || "")) + row("Opened", esc(when(shift.opened_at))) + (shift.closed_at ? row("Closed", esc(when(shift.closed_at))) : "") : ""}
      ${row("Printed", esc(when(new Date())))}
    </table>
    <hr><table>
      ${row("Sales", z.receipts)}${row("Returns", z.returns)}${row("Items sold", qtyFmt(z.itemsSold))}
      ${row("Gross sales", money(z.grossSales))}${row("Discounts", "− " + money(z.discounts))}${row("Tax", money(z.tax))}
      ${z.rounding ? row("Round off", money(z.rounding)) : ""}
      ${row("Sales total", money(z.salesTotal))}${row("Refunds", "− " + money(z.returnsTotal))}
      ${row(`NET SALES ${currency}`, money(z.netSales), "tot")}
    </table>
    <hr><div class="b">By payment</div><table>
      ${["CASH", "CARD", "CREDIT"].map((m) => row(METHOD[m], `${money(z.salesByMethod?.[m])}${z.refundsByMethod?.[m] ? ` / −${money(z.refundsByMethod[m])}` : ""}`)).join("")}
    </table>
    <hr><div class="b">Cash drawer</div><table>
      ${row("Opening float", money(z.openingFloat))}${row("+ Cash sales", money(z.salesByMethod?.CASH))}${row("− Cash refunds", money(z.refundsByMethod?.CASH))}
      ${row("Expected", money(z.expectedCash), "b")}
      ${z.countedCash != null ? row("Counted", money(z.countedCash)) + row(z.difference < 0 ? "Short" : z.difference > 0 ? "Over" : "Difference", money(z.difference), "b") : ""}
    </table>
    <div style="height:8mm"></div>`;
  return shell(title, thermalCss(w), body);
}

/** Print an HTML document through a hidden iframe. */
export function printHtml(html) {
  if (typeof document === "undefined") return;
  const frame = document.createElement("iframe");
  frame.setAttribute("aria-hidden", "true");
  frame.style.cssText = "position:fixed;right:0;bottom:0;width:0;height:0;border:0;visibility:hidden";
  document.body.appendChild(frame);
  const doc = frame.contentWindow.document;
  doc.open();
  doc.write(html);
  doc.close();
  const go = () => {
    try {
      frame.contentWindow.focus();
      frame.contentWindow.print();
    } finally {
      setTimeout(() => frame.remove(), 1500);
    }
  };
  if (doc.readyState === "complete") setTimeout(go, 50);
  else frame.onload = go;
}
