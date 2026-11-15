// ─────────────────────────────────────────────────────────────────────────────
//  Amount input helpers.
//
//  Money is easier to read grouped ("23,000" not "23000"), and easier to
//  mistype when it is not — so amount fields format as you type. The commas
//  are presentation only: state and payloads keep the raw numeric string, and
//  `parseAmountInput` is what turns whatever is on screen back into it.
//
//  A plain `<input type="number">` cannot do this at all (it rejects commas),
//  which is why amount fields are text inputs with inputMode="decimal".
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Whatever the user typed -> a raw numeric string ("23,000.50" -> "23000.50").
 * Keeps a trailing "." so "23000." stays typeable, and never lets a second
 * decimal point or a stray letter through.
 */
export function parseAmountInput(text) {
  let s = String(text ?? "").replace(/[^\d.]/g, "");
  const firstDot = s.indexOf(".");
  if (firstDot !== -1) {
    // Drop every dot after the first one.
    s = s.slice(0, firstDot + 1) + s.slice(firstDot + 1).replace(/\./g, "");
    const [int, dec] = s.split(".");
    s = `${int}.${dec.slice(0, 2)}`; // two decimal places is what the column stores
  }
  return s;
}

/**
 * Raw numeric string -> grouped for display ("23000.5" -> "23,000.5").
 * The decimal part is left exactly as typed: forcing it to two places while
 * someone is still typing fights the caret.
 */
export function formatAmountInput(value) {
  const raw = parseAmountInput(value);
  if (raw === "") return "";
  const [int, dec] = raw.split(".");
  const grouped = int ? Number(int).toLocaleString("en-US") : "";
  if (raw.includes(".")) return `${grouped || "0"}.${dec ?? ""}`;
  return grouped;
}
