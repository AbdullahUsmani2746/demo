// Official / Unofficial print choice. Safe to import from server code (the
// voucher template is also used by /api/voucher/generate-pdf): the modal
// (components/OfficialPrintPrompt.jsx) is only loaded in the browser.
// Resolves true (official) / false (unofficial); throws PRINT_CANCELLED.

export const PRINT_CANCELLED = "Print cancelled";

// Ask once per print batch (Print All fires many PDFs back-to-back).
let last = { at: 0, official: true };
let pending = null;

export function askOfficialPrint() {
  if (typeof window === "undefined") return Promise.resolve(true);
  if (Date.now() - last.at < 5000) return Promise.resolve(last.official);
  if (!pending) {
    pending = import("@/components/OfficialPrintPrompt")
      .then(({ openOfficialPrintModal }) => openOfficialPrintModal())
      .then((official) => {
        last = { at: Date.now(), official };
        return official;
      })
      .finally(() => {
        pending = null;
      });
  }
  return pending;
}
