// components/HR/printDoc.js — printable HR letters and statements (bank advice
// letter, tax certificate, final settlement statement). Opens the document in
// a new window with print styles and the browser's print dialog — "Save as
// PDF" there gives the PDF. Every value goes through esc().

export const esc = (v) =>
  String(v ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

export const money = (n) =>
  (Math.round((Number(n) || 0) * 100) / 100).toLocaleString("en-PK", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Amount in words (Pakistani style: thousand, lakh, crore) — "Twelve Thousand Five Hundred Rupees Only". */
export function amountInWords(n) {
  const ones = ["", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen", "Seventeen", "Eighteen", "Nineteen"];
  const tens = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];
  const two = (x) => (x < 20 ? ones[x] : `${tens[Math.floor(x / 10)]}${x % 10 ? ` ${ones[x % 10]}` : ""}`);
  const three = (x) => [x >= 100 ? `${ones[Math.floor(x / 100)]} Hundred` : "", two(x % 100)].filter(Boolean).join(" ");
  const whole = Math.floor(Math.abs(Number(n) || 0));
  const paisa = Math.round((Math.abs(Number(n) || 0) - whole) * 100);
  if (!whole && !paisa) return "Zero Rupees Only";
  const parts = [];
  let x = whole;
  const crore = Math.floor(x / 10000000); x %= 10000000;
  const lakh = Math.floor(x / 100000); x %= 100000;
  const thousand = Math.floor(x / 1000); x %= 1000;
  if (crore) parts.push(`${crore >= 100 ? three(crore) : two(crore)} Crore`);
  if (lakh) parts.push(`${two(lakh)} Lakh`);
  if (thousand) parts.push(`${two(thousand)} Thousand`);
  if (x) parts.push(three(x));
  return `${parts.join(" ")} Rupees${paisa ? ` and ${two(paisa)} Paisa` : ""} Only`.trim();
}

const STYLE = `
  *{box-sizing:border-box} body{font-family:Arial,Helvetica,sans-serif;color:#111;margin:0;padding:24px;font-size:12.5px;line-height:1.45}
  .doc{max-width:800px;margin:0 auto}
  .head{border-bottom:3px solid #800000;padding-bottom:10px;margin-bottom:16px}
  .head h1{margin:0;color:#800000;font-size:20px} .head p{margin:2px 0 0;color:#555}
  h2{font-size:15px;margin:18px 0 8px;color:#800000} .muted{color:#666}
  table{width:100%;border-collapse:collapse;margin:8px 0}
  th{background:#800000;color:#fff;text-align:left;padding:6px 8px;font-size:11px;text-transform:uppercase;letter-spacing:.03em}
  td{padding:5px 8px;border-bottom:1px solid #ddd;vertical-align:top}
  td.n,th.n{text-align:right;font-variant-numeric:tabular-nums;white-space:nowrap}
  tr.total td{font-weight:bold;border-top:2px solid #800000;background:#f7eeee}
  .grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:4px 24px;margin:8px 0}
  .grid div{display:flex;justify-content:space-between;gap:8px;border-bottom:1px dotted #ccc;padding:3px 0}
  .grid b{font-weight:600}
  .sign{display:flex;justify-content:space-between;gap:24px;margin-top:56px}
  .sign div{flex:1;border-top:1px solid #333;padding-top:4px;text-align:center;color:#444}
  .box{border:1px solid #ddd;border-radius:6px;padding:10px 12px;margin:10px 0;background:#fafafa}
  @media print{body{padding:0}.noprint{display:none}}
  @page{size:A4;margin:14mm}
`;

/**
 * A full-page letterhead picture behind the text (repeated on every printed
 * page) and the text kept inside its margins: the repeating table header /
 * footer rows hold the room of the letterhead's own header and footer.
 * letterhead = { url, top, bottom, left, right } (mm) — lib/hr/letters/letterhead.js.
 */
function onLetterhead(body, lh) {
  const n = (v) => Math.max(0, Number(v) || 0);
  return {
    style: `
      @page{size:A4;margin:0}
      html,body{margin:0;padding:0}
      body{padding:0!important}
      .lh-bg{position:fixed;top:0;left:0;width:210mm;height:297mm;z-index:-1;object-fit:fill}
      .lh-page{width:210mm;margin:0 auto;border-collapse:collapse}
      .lh-page>thead td,.lh-page>tfoot td,.lh-page>tbody>tr>td.lh-body{border:0;padding:0}
      .lh-page>tbody>tr>td.lh-body{padding:0 ${n(lh.right)}mm 0 ${n(lh.left)}mm}
      .lh-page .doc{max-width:none}
      @media screen{body{background:#eee}.lh-page{background:#fff;min-height:297mm;position:relative}.lh-bg{position:absolute;left:50%;transform:translateX(-50%)}}
    `,
    html: `<img class="lh-bg" src="${esc(lh.url)}" alt="">
      <table class="lh-page"><thead><tr><td style="height:${n(lh.top)}mm"></td></tr></thead>
      <tfoot><tr><td style="height:${n(lh.bottom)}mm"></td></tr></tfoot>
      <tbody><tr><td class="lh-body"><div class="doc">${body}</div></td></tr></tbody></table>`,
  };
}

/**
 * Open `body` (HTML, already escaped) in a print window. With `letterhead`
 * the page is printed on it (onLetterhead) instead of the plain margins.
 */
export function printDocument({ title, body, letterhead = null }) {
  const w = window.open("", "_blank");
  if (!w) throw new Error("The browser blocked the print window — allow pop-ups for this site.");
  const lh = letterhead?.url ? onLetterhead(body, letterhead) : null;
  w.document.open();
  // onload waits for the letterhead picture, so it is on the page when printed.
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title><style>${STYLE}${lh ? lh.style : ""}</style></head><body>${lh ? lh.html : `<div class="doc">${body}</div>`}<script>window.onload=function(){setTimeout(function(){window.print()},250)}</script></body></html>`);
  w.document.close();
}

/** Letterhead: company name and address. */
export const letterhead = (company, subtitle) =>
  `<div class="head"><h1>${esc(company?.name ?? "")}</h1>${company?.address ? `<p>${esc(company.address)}</p>` : ""}${subtitle ? `<p><b>${esc(subtitle)}</b></p>` : ""}</div>`;
