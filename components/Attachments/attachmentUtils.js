// components/Attachments/attachmentUtils.js — file attachments of a document
// (TransactionsMaster.attachments) or of one of its lines
// (Transactions.attachments). See app/api/voucher/attachments/route.js.

export const ATTACHMENT_ACCEPT = ".pdf,.doc,.docx,.xls,.xlsx,.csv,.txt,.png,.jpg,.jpeg,.webp,.gif";
export const MAX_ATTACHMENT_MB = 15;

const IMAGE_EXT = new Set(["png", "jpg", "jpeg", "webp", "gif", "bmp", "svg", "avif"]);
const SHEET_EXT = new Set(["xls", "xlsx", "csv"]);
const DOC_EXT = new Set(["doc", "docx", "txt", "rtf", "odt"]);

/** Name / extension / kind (image · pdf · sheet · doc · other) of a stored URL. */
export function fileMeta(url) {
  const raw = String(url || "").split("?")[0].split("#")[0];
  let name = raw.split("/").pop() || "file";
  try {
    name = decodeURIComponent(name);
  } catch {
    /* keep the raw segment */
  }
  // Uploads are stored as `<timestamp>-<name>` (lib/space.js).
  name = name.replace(/^\d{10,}-/, "");
  const ext = (name.includes(".") ? name.split(".").pop() : "").toLowerCase();
  const kind = IMAGE_EXT.has(ext)
    ? "image"
    : ext === "pdf"
      ? "pdf"
      : SHEET_EXT.has(ext)
        ? "sheet"
        : DOC_EXT.has(ext)
          ? "doc"
          : "other";
  return { name, ext, kind };
}

/** Only stored URLs — a stale File object or junk never reaches the UI. */
export const urlsOf = (value) =>
  (Array.isArray(value) ? value : []).filter((u) => typeof u === "string" && u);

/**
 * Upload files. target { voucherId } / { lineId } appends them to that
 * document / line; no target = upload only (the caller saves the URLs).
 * → { paths, attachments (the target's full list, or null), errors }
 */
export async function uploadAttachments(files, target = {}) {
  const list = Array.from(files || []);
  const tooBig = list.filter((f) => f.size > MAX_ATTACHMENT_MB * 1024 * 1024);
  const ok = list.filter((f) => !tooBig.includes(f));
  const errors = tooBig.map((f) => `${f.name} is larger than ${MAX_ATTACHMENT_MB} MB`);
  if (ok.length === 0) return { paths: [], attachments: null, errors };

  const form = new FormData();
  ok.forEach((f) => form.append("attachment", f));
  if (target.voucherId) form.append("voucherId", String(target.voucherId));
  if (target.lineId) form.append("lineId", String(target.lineId));

  const res = await fetch("/api/voucher/attachments", { method: "POST", body: form });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) {
    throw new Error(data.error || "Upload failed");
  }
  return {
    paths: data.paths || [],
    attachments: data.attachments ?? null,
    errors: [...errors, ...(data.errors || [])],
  };
}

/** Unlink a file from its document / line → the remaining list. */
export async function removeAttachment(url, target = {}) {
  const params = new URLSearchParams({ attachmentUrl: url });
  if (target.lineId) params.set("lineId", String(target.lineId));
  else if (target.voucherId) params.set("voucherId", String(target.voucherId));
  const res = await fetch(`/api/voucher/attachments?${params}`, { method: "DELETE" });
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || "Could not remove the file");
  return data.attachments || [];
}

/** The document's files and its lines' — { attachments, lines, count }. */
export async function fetchAttachments(voucherId) {
  const res = await fetch(`/api/voucher/attachments?voucherId=${voucherId}`);
  const data = await res.json().catch(() => ({}));
  if (!res.ok || !data.success) throw new Error(data.error || "Could not load attachments");
  return data.data;
}

/** Files on a document row of a listing: its own plus its lines'. */
export function attachmentCountOf(entry) {
  const own = urlsOf(entry?.attachments).length;
  const lines = (entry?.transactions || []).reduce((s, t) => s + urlsOf(t?.attachments).length, 0);
  return own + lines;
}
