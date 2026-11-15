// lib/audit/explain.js — every Audit Trail row in words: what happened, what
// the system did and why. Runs on rows already named by describeRows()
// (lib/audit/refs.js), in /api/audit.
//
//   story   "Ali added FG-101 — White Emulsion (qty 25) to Production plan #621 for Sale Order 1092."
//   why     the reason, when the fields / table tell it ("The dispatch was
//           invoiced (Invoicing).", "Done automatically by …")
//   resave  a document saved again replaces all its lines (delete + add) —
//           each removed line is paired with the line added back for the same
//           item in the same save: { same: true } = re-added with no change,
//           else { diffs: [{ field, old, new }] } = what the save changed
//
// Pure — no database; dates are shown in the server's time zone.

const DAY = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric" });
const DAY_TIME = new Intl.DateTimeFormat("en-GB", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit", hourCycle: "h12" });
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

// Bookkeeping columns: not a difference between a removed line and its re-added copy
const NOT_A_CHANGE = new Set(["id", "created_at", "updated_at", "createdAt", "updatedAt", "edited_at", "edited_by", "prev_qty", "prev_rate", "nature_at", "last_sync", "sync_status"]);

const FIELD_NAMES = {
  itcd: "item", material_id: "material", finished_id: "product", qty: "qty", qty_ltr: "qty (ltr)", rate: "rate", amount: "amount",
  damt: "debit", camt: "credit", acno: "account", pycd: "party", party_code: "customer", godown: "godown", godown2: "to godown",
  so_no: "Sale Order", sale_ord_no: "Sale Order", plan_date: "plan date", plan_qty: "plan qty", no_of_packs: "packs", no_of_pack: "packs",
  st_rate: "ST rate %", st_amount: "ST amount", status: "status", nature: "nature", batch_no: "batch no", invoice_no: "invoice no",
  invoiced_at: "invoiced at", invoice_series: "invoice series", approved_by: "approved by", approved_at: "approved at",
  sent_to_production_date: "sent to production", actual_yield: "actual yield", barcode: "barcode", transaction_id: "production voucher",
  dated: "date", due_date: "due date", userid: "user", user_id: "user", narration1: "narration", remarks: "remarks",
};
export const fieldName = (f) => FIELD_NAMES[f] ?? String(f).replace(/_/g, " ").replace(/([a-z])([A-Z])/g, "$1 $2").toLowerCase();

// Numbers that are ids / document nos. — shown as they are, no thousands commas
const ID_LIKE = /(^id$|_id$|_no$|^tran_|^vr_|^itcd$|^acno$|^pycd$|^order_no$|^so_no$|code$)/;

/** A stored value as words: names for ids, dates as dates, — for empty. */
export function say(v, label, field = "") {
  if (label) return label;
  if (v === null || v === undefined || v === "") return "—";
  if (typeof v === "boolean") return v ? "Yes" : "No";
  if (typeof v === "number" && ID_LIKE.test(field)) return String(v);
  if (typeof v === "number") return v.toLocaleString("en-US", { maximumFractionDigits: 4 });
  if (typeof v === "string" && ISO_RE.test(v)) {
    const d = new Date(v);
    if (!Number.isNaN(d.getTime())) return /T00:00(:00(\.0+)?)?(Z|[+-]00:?00)?$/.test(v) ? DAY.format(d) : DAY_TIME.format(d);
  }
  if (typeof v === "object") return JSON.stringify(v);
  return String(v);
}

const sameValue = (a, b) => {
  if ((a ?? "") === (b ?? "")) return true;
  if (typeof a === "string" && typeof b === "string" && ISO_RE.test(a) && ISO_RE.test(b)) return a.slice(0, 10) === b.slice(0, 10);
  const na = Number(a);
  const nb = Number(b);
  return a != null && b != null && a !== "" && b !== "" && Number.isFinite(na) && Number.isFinite(nb) && Math.abs(na - nb) < 1e-6;
};

const singular = (label) => (/ies$/.test(label) ? label.replace(/ies$/, "y") : /[^s]s$/.test(label) ? label.slice(0, -1) : label);
const isDiff = (c) => c && ("old" in c || "new" in c);

/** "FG-101 — White Emulsion" / "account City Traders" / "" — what a line is about. */
function subjectOf(r) {
  if (r.item) return [r.item.code, r.item.name].filter(Boolean).join(" — ") || `item ${r.item.itcd}`;
  if (r.account?.name) return `account ${r.account.name}`;
  return "";
}

// Why a change happened, read from the fields it touched
function reasonOf(r, fields) {
  const field = fieldReason(r, fields);
  if (r.source !== "system" && r.user_id) return field;
  const job = String(r.user_name || "").replace(/^System:\s*/, "");
  const sys = job
    ? `Done automatically by the system job "${job}" — no one keyed it.`
    : "Recorded with no user: done by the system (a scheduled job, a script, or a screen / device that does not pass who did it).";
  return field ? `${field} ${sys}` : sys;
}

function fieldReason(r, fields) {
  const has = (...f) => f.some((x) => fields.has(x));
  if (r.model_name === "OrderDetail" && has("plan_date", "plan_qty")) return "The Sale Order line was sent to the Production Plan — the plan date / qty are kept on the order line too.";
  if (r.model_name === "TransactionsMaster" && has("invoice_no", "invoiced_at", "invoice_series")) return "The document was invoiced (Invoicing) — the invoice no. and time were stamped on it.";
  if (has("approved_by", "approved_at")) return "The document was approved — who approved it and when were stamped on it.";
  if (r.model_name === "productionPlanMaster" && has("sent_to_production_date", "transaction_id")) return "The Process Order was posted to production — the production voucher was made and linked.";
  if (r.model_name === "productionPlanMaster" && has("barcode")) return "A barcode was generated for the Process Order (label printing / factory scanning).";
  if (r.model_name === "ReqDetail" && has("nature")) return "The Nature of the plan line was picked on Edit Production Plan.";
  if (r.model_name === "ReqMaster" && has("so_no")) return "Another Sale Order was added to this day's Production Plan — the plan keeps the latest order's no.";
  if (has("status")) return "The document's status moved on (saved / approved / dispatched / posted).";
  return null;
}

function changeList(changes) {
  return changes
    .filter(isDiff)
    .map((c) => `${fieldName(c.field)} ${say(c.old, c.old_label, c.field)} → ${say(c.new, c.new_label, c.field)}`)
    .join("; ");
}

// "qty 25", "qty 25, rate 940" — the main figures of a line
function figures(snap, labels) {
  if (!snap) return "";
  const out = [];
  for (const f of ["qty", "qty_ltr", "plan_qty", "rate", "damt", "camt", "material_qty", "material_percentage"]) {
    if (snap[f] != null && snap[f] !== "" && Number(snap[f]) !== 0) out.push(`${fieldName(f)} ${say(snap[f], labels?.[f], f)}`);
  }
  if (snap.godown != null && labels?.godown) out.push(`godown ${labels.godown}`);
  return out.join(", ");
}

/** Pair the lines a re-save removed and added back (same save, document, table and item). */
function pairResaves(rows) {
  const groups = new Map();
  rows.forEach((r, i) => {
    if (!r.batch_id || (r.action !== "create" && r.action !== "delete") || !r.snapshot || r.model_name === r.doc_model) return;
    const s = r.snapshot;
    const key = [r.batch_id, r.model_name, r.doc_id, r.item?.itcd ?? "", s.so_no ?? "", s.sub_tran_id ?? "", s.acno ?? ""].join("|");
    if (!groups.has(key)) groups.set(key, { del: [], add: [] });
    groups.get(key)[r.action === "delete" ? "del" : "add"].push(i);
  });
  const out = new Map(); // row index → { same, diffs, other }
  for (const { del, add } of groups.values()) {
    const n = Math.min(del.length, add.length);
    for (let k = 0; k < n; k += 1) {
      const d = rows[del[k]];
      const a = rows[add[k]];
      const diffs = [];
      for (const [f, v] of Object.entries(a.snapshot)) {
        if (NOT_A_CHANGE.has(f) || !(f in d.snapshot)) continue;
        if (!sameValue(d.snapshot[f], v)) diffs.push({ field: f, old: d.snapshot[f], new: v, old_label: d.snapshot_labels?.[f], new_label: a.snapshot_labels?.[f] });
      }
      const same = diffs.length === 0;
      out.set(del[k], { same, diffs, role: "removed", other: a.id });
      out.set(add[k], { same, diffs, role: "added", other: d.id });
    }
  }
  return out;
}

/** Rows (named) → rows with story / why / resave. */
export function explainRows(rows) {
  const resaves = pairResaves(rows);
  return rows.map((r, i) => {
    try {
      const who = r.source === "system" || !r.user_id ? r.user_name || "The system" : r.user_name || "Someone";
      const what = singular(r.model_label || r.model_name);
      const doc = `${singular(r.doc_label || r.doc_model)} #${r.doc_id}`;
      const child = r.doc_model && r.doc_model !== r.model_name;
      const subject = subjectOf(r);
      const iso = r.iso && r.doc_model !== "OrderMaster" ? ` for Sale Order ${r.iso}` : "";
      const recNo = r.record_id && r.record_id !== "new" ? ` #${r.record_id}` : "";
      const changes = Array.isArray(r.changes) ? r.changes : [];
      const diffs = changes.filter(isDiff);
      const notes = changes.filter((c) => c && !isDiff(c) && c.field !== "SO");
      const sys = r.source === "system" || !r.user_id;
      const fig = figures(r.snapshot, r.snapshot_labels);
      const pair = resaves.get(i);
      let story;
      let why = null;

      if (pair) {
        const part = pair.role === "removed" ? "the removed copy" : "the added copy";
        story = `${who} saved ${doc} again — the system rewrites every line on a save, so the line ${subject || what}${iso} was removed and added back`;
        story += pair.same ? ` unchanged (this is ${part}).` : ` with: ${changeList(pair.diffs)} (this is ${part}).`;
        why = pair.same
          ? "Not a real change: the line was removed and added back exactly as it was when the document was re-saved."
          : "The document was edited: this line was re-saved with the change shown.";
      } else if (r.action === "create") {
        if (child) story = `${who} added ${subject || what}${fig ? ` (${fig})` : ""} to ${doc}${iso}.`;
        else story = `${who} created ${what}${recNo}${subject ? ` — ${subject}` : ""}${iso}${fig ? ` (${fig})` : ""}.`;
        if (notes.length) story = `${who} added ${notes.map((c) => `${fieldName(c.field)} ${say(c.value)}`).join(", ")} to ${doc}.`;
      } else if (r.action === "delete") {
        if (child) story = `${who} removed ${subject || what}${fig ? ` (${fig})` : ""} from ${doc}${iso}.`;
        else story = `${who} deleted ${what}${recNo}${subject ? ` — ${subject}` : ""}${iso}.`;
        if (notes.length) story = `${who} removed ${notes.map((c) => `${fieldName(c.field)} ${say(c.value)}`).join(", ")} from ${doc}.`;
      } else if (r.action === "update") {
        const on = child ? `${subject || what}${recNo && !subject ? recNo : ""} in ${doc}` : `${what}${recNo}${subject ? ` (${subject})` : ""}`;
        const ctx = notes.length ? ` (${notes.map((c) => `${fieldName(c.field)} ${say(c.value)}`).join(", ")})` : "";
        story = diffs.length ? `${who} changed ${on}${ctx}${iso}: ${changeList(diffs)}.` : `${who} changed ${on}${ctx}${iso}.`;
        why = reasonOf(r, new Set(diffs.map((c) => c.field)));
      } else {
        story = `${who} ${r.action} ${what}${recNo}.`;
      }
      if (!why && r.model_name === "ReqDetail" && r.action === "create" && r.iso) why = `The Sale Order line was put on the Production Plan (from the Sale Order line's Create button, its approval, or the Production Plan form).`;
      if (!why && r.model_name === "productionPlanMaster" && r.action === "create") why = `A Process Order was made${r.iso ? ` for Sale Order ${r.iso}` : ""} to produce this item${r.snapshot?.batch_no ? ` (batch ${r.snapshot.batch_no})` : ""}.`;
      if (!why && r.model_name === "ReqMaster" && r.action === "create" && r.iso) why = `There was no Production Plan for that day yet, so the system opened one when Sale Order ${r.iso} was planned.`;
      if (sys && r.action !== "update") why = why ? `${why} ${reasonOf(r, new Set())}` : reasonOf(r, new Set());

      return { ...r, story, why, resave: pair ? { same: pair.same, role: pair.role, diffs: pair.diffs, other: pair.other } : null };
    } catch {
      return r;
    }
  });
}
