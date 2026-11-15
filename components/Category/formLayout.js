// components/Category/formLayout.js
// ============================================================
// Header layout of the voucher form (Form.jsx): the master fields are shown
// in labelled groups instead of one long grid.
//
//   Document · Party & store · Delivery & logistics · Details · Notes & files
//
// A field's group is its config `group` key when set, else worked out from
// its name / label / type below — so all voucher configs get grouped without
// touching each one. Layout only: the fields, their order inside a group and
// everything they do are unchanged. Form.jsx walks Enter / Tab in this
// on-screen order (masterOrder).
//
// A voucher with many header fields of its own kind (Letter of Credit) sets
// `masterGroups: [{ key, label }]` in its config and `group` on each field;
// Form.jsx then shows each group as a full-width band. A field without a
// matching `group` goes to the "notes" group (textarea / files) or the first.
// ============================================================

export const MASTER_GROUPS = [
  { key: "document", label: "Document" },
  { key: "party", label: "Party & store" },
  { key: "logistics", label: "Delivery & logistics" },
  { key: "details", label: "Details" },
  { key: "notes", label: "Notes & files" },
];

const BY_NAME = {
  document: new Set([
    "dated", "vr_no", "grn_no", "dispatch_no", "manual_no", "order_no", "po_no", "so_no", "req_no",
    "sale_po", "due_date", "check_no", "check_date", "invoice_no", "bill_date", "app_date",
    "tran_id", "lc_no", "bond_id", "invoice_series", "req_catagory", "vendor_bill_no",
  ]),
  party: new Set([
    "pycd", "party_code", "acname", "macno", "acno", "godown", "godown2", "issued_by",
    "issued_for", "userid", "region", "currency",
  ]),
  logistics: new Set(["delivery_terms", "payment_terms", "delivery_location", "city", "route"]),
  notes: new Set(["rmk", "additional_instructions", "attachments"]),
};

const LOGISTICS_LABEL = /vehicle|challan|\bdc\b|delivery|transport|driver|builty|bilty/i;
const NOTES_LABEL = /narration|remark|instruction|note/i;

const labelText = (label) => (typeof label === "string" ? label : "");

/** The group key of one master field. */
export function masterGroupOf(field, groups) {
  if (groups) {
    if (field?.group && groups.some((g) => g.key === field.group)) return field.group;
    const own = masterGroupOf(field);
    return own === "notes" && groups.some((g) => g.key === "notes") ? "notes" : groups[0].key;
  }
  if (field?.group && MASTER_GROUPS.some((g) => g.key === field.group)) return field.group;
  const name = field?.formName || field?.name;
  const label = labelText(field?.label);
  if (field?.type === "file" || field?.type === "file-upload" || field?.type === "textarea") return "notes";
  for (const [key, names] of Object.entries(BY_NAME)) if (names.has(name)) return key;
  if (LOGISTICS_LABEL.test(label)) return "logistics";
  if (NOTES_LABEL.test(label)) return "notes";
  return "details";
}

/**
 * The master fields in groups, each item { field, index } with `index` the
 * field's position in masterFields (what keyboard navigation and auto-focus
 * use). Empty groups are left out; config order is kept inside a group.
 */
export function groupMasterFields(masterFields = [], customGroups) {
  const groups = customGroups?.length ? customGroups : MASTER_GROUPS;
  const buckets = new Map(groups.map((g) => [g.key, []]));
  masterFields.forEach((field, index) => {
    if (!field || field.name === "tran_code") return;
    buckets.get(masterGroupOf(field, customGroups?.length ? groups : undefined)).push({ field, index });
  });
  return groups.map((g) => ({ ...g, items: buckets.get(g.key) })).filter((g) => g.items.length);
}

/** masterFields indexes in on-screen order. */
export const masterVisualOrder = (masterFields = [], customGroups) =>
  groupMasterFields(masterFields, customGroups).flatMap((g) => g.items.map((i) => i.index));
