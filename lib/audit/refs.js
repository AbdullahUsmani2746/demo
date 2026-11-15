// lib/audit/refs.js — what the id columns of an audit row point at, so the
// Audit Trail shows names (item code + name, account, godown, user …)
// instead of bare ids, and every line row says which item it is about.
//
//   refFields(model)      column → the table its value points at: the Prisma
//                         schema relations, plus columns holding an id with no
//                         declared relation (userid, approved_by, party_code …)
//   contextFields(model)  the columns that say which record a row is (its ids,
//                         parent, SO / plan no …): kept on every update entry
//                         (lib/audit/logger.js), since an update only records
//                         the fields that changed
//   describeRows(db, rows) adds names to rows read from AuditLog
//                         (/api/audit): changes[].old_label / new_label,
//                         snapshot_labels, item { itcd, code, name },
//                         account { acno, name }, iso (the Sale Order no.)
//
// No prisma import — the caller passes its client (lib/prisma.js imports the
// logger, which imports this file).
import { Prisma } from "@prisma/client";
import { AUDIT_PARENTS } from "./catalog";
import { LOCKABLE_DOCUMENTS } from "../periodLockCatalog";

const MODELS = new Map(Prisma.dmmf.datamodel.models.map((m) => [m.name, m]));
const join = (...parts) => parts.filter((p) => p != null && p !== "").join(" ");

// How a record of each table is named; a table not listed is named by its
// `name` / `title` column, when it has one.
const NAMES = {
  Item: { fields: ["code", "item"], label: (r) => [r.code, r.item].filter(Boolean).join(" — ") },
  ACNO: { fields: ["acname"], label: (r) => r.acname },
  User: { fields: ["name", "username", "email"], label: (r) => r.name || r.username || r.email },
  Employee: { fields: ["firstName", "middleName", "surname"], label: (r) => join(r.firstName, r.middleName, r.surname) },
  Godown: { fields: ["godown"] },
  Company: { fields: ["company"] },
  Department: { fields: ["dept_name"] },
  Designation: { fields: ["desg_name"] },
  WorkLocation: { fields: ["location_name"] },
  Service: { fields: ["service_name"] },
  ServiceCategory: { fields: ["sc_name"] },
  MACNO: { fields: ["macname"] },
  CostCenter: { fields: ["ccname"] },
  Currency: { fields: ["currency"] },
  MainCategory: { fields: ["mc_name"] },
  ItemCategory: { fields: ["ic_name"] },
  ProductCategory: { fields: ["pc_name"] },
  ProductMasterCategory: { fields: ["pmc_name"] },
  BusinessUnit: { fields: ["business_unit"] },
  ColorCode: { fields: ["color_code"] },
  InkType: { fields: ["ink_type"] },
  NatureOfInk: { fields: ["nature_of_ink"] },
  PrintingProperty: { fields: ["printing_property"] },
  Subtrates: { fields: ["subtrate"] },
  SRLamination: { fields: ["sr_lamination"] },
  MACHINE_INSTRUCTION_MASTER: { fields: ["descr"] },
  TaxSetup: { fields: ["tax_name"] },
  BondLocation: { fields: ["location"] },
  Manager: { fields: ["manager"] },
  menus: { fields: ["title"] },
  Permission: { fields: ["label"] },
};

// Columns that hold an id without a declared relation (matched by name, and
// only when the column's type is the target's id type).
const BY_NAME = {
  User: ["user_id", "userid", "approved_by", "edited_by", "created_by", "requested_by", "decided_by", "submitted_by", "done_by", "owner_id", "triggered_by", "calculated_by"],
  Item: ["itcd", "material_id", "finished_id", "packing_material_code"],
  ACNO: ["acno", "pycd", "party_code", "customer_code"],
  Godown: ["godown", "godown2", "godown_id"],
  Employee: ["employee_id"],
};

// The item / account a row is about, in this order of preference.
const ITEM_FIELDS = ["itcd", "material_id", "finished_id"];
const ACCOUNT_FIELDS = ["acno", "pycd", "party_code", "customer_code"];
// Sale Order a row comes from
const ISO_FIELDS = ["so_no", "sale_ord_no"];
// Kept on update entries besides the ids: which document / line it is.
const LINK_FIELDS = ["so_no", "sale_ord_no", "order_no", "plan_id", "plan_no", "process_order_no", "req_no", "req_catagory", "tran_code", "sub_tran_id", "vr_no", "invoice_no", "dispatch_no", "batch_no", "code", "item", "acname", "godown"];

const TRAN_CODES = new Map(LOCKABLE_DOCUMENTS.flatMap((g) => g.items.map((i) => [i.code, i.label])));

const pkOf = (m) => m?.fields.filter((f) => f.isId) ?? [];
const accessor = (model) => model[0].toLowerCase() + model.slice(1);

let nameSpecs = null;
/** target table → { pk, pkType, select, label } — only tables we can name. */
function nameSpec(target) {
  if (!nameSpecs) nameSpecs = new Map();
  if (nameSpecs.has(target)) return nameSpecs.get(target);
  const m = MODELS.get(target);
  const pk = pkOf(m);
  let spec = null;
  if (m && pk.length === 1) {
    const scalars = new Set(m.fields.filter((f) => f.kind === "scalar").map((f) => f.name));
    const def = NAMES[target] ?? { fields: ["name", "title"].filter((f) => scalars.has(f)).slice(0, 1) };
    const fields = def.fields.filter((f) => scalars.has(f));
    if (fields.length) {
      spec = {
        pk: pk[0].name,
        pkType: pk[0].type,
        fields,
        label: def.label ?? ((r) => r[fields[0]]),
      };
    }
  }
  nameSpecs.set(target, spec);
  return spec;
}

const refCache = new Map();
/** Map column → target table, for the id columns of `model` we can name. */
export function refFields(model) {
  if (refCache.has(model)) return refCache.get(model);
  const m = MODELS.get(model);
  const out = new Map();
  if (m) {
    const scalar = new Map(m.fields.filter((f) => f.kind === "scalar").map((f) => [f.name, f]));
    for (const f of m.fields) {
      if (f.kind !== "object" || f.relationFromFields?.length !== 1) continue;
      const col = f.relationFromFields[0];
      if (!out.has(col) && nameSpec(f.type)) out.set(col, f.type);
    }
    for (const [target, cols] of Object.entries(BY_NAME)) {
      const spec = nameSpec(target);
      if (!spec) continue;
      for (const col of cols) {
        const f = scalar.get(col);
        if (f && !out.has(col) && f.type === spec.pkType) out.set(col, target);
      }
    }
  }
  refCache.set(model, out);
  return out;
}

const ctxCache = new Map();
/** The columns that identify a record of `model` (ids, parent, links). */
export function contextFields(model) {
  if (ctxCache.has(model)) return ctxCache.get(model);
  const m = MODELS.get(model);
  const scalars = new Set(m?.fields.filter((f) => f.kind === "scalar").map((f) => f.name) ?? []);
  const cols = new Set([...pkOf(m).map((f) => f.name), ...refFields(model).keys()]);
  if (AUDIT_PARENTS[model]) cols.add(AUDIT_PARENTS[model][1]);
  for (const f of LINK_FIELDS) if (scalars.has(f)) cols.add(f);
  const list = [...cols].filter((c) => scalars.has(c));
  ctxCache.set(model, list);
  return list;
}

/** The context columns of a row that have a value — what an update entry keeps. */
export function contextOf(model, row) {
  if (!row) return null;
  const out = {};
  for (const f of contextFields(model)) {
    const v = row[f];
    if (v === null || v === undefined || v === "") continue;
    out[f] = typeof v === "bigint" ? v.toString() : v instanceof Date ? v.toISOString() : v?.constructor?.name === "Decimal" ? v.toString() : v;
  }
  return Object.keys(out).length ? out : null;
}

const keyOf = (target, v) => `${target}:${String(v)}`;
const castId = (spec, v) => {
  if (spec.pkType === "Int") {
    const n = Number(v);
    return Number.isInteger(n) ? n : null;
  }
  return v == null ? null : String(v);
};
const isPlain = (v) => v !== null && v !== undefined && v !== "" && typeof v !== "object";

/**
 * Rows as read from AuditLog → the same rows with names added. Never throws:
 * a lookup that fails leaves the ids as they are.
 */
export async function describeRows(db, rows) {
  if (!rows?.length) return rows;
  try {
    // 1. What each row is about: its snapshot (create / delete, or the
    //    context an update keeps), the values an update changed, and — for
    //    older updates kept without context — the record as it is now.
    const ctx = rows.map((r) => {
      const c = { ...(r.snapshot && typeof r.snapshot === "object" && !Array.isArray(r.snapshot) ? r.snapshot : {}) };
      if (r.action === "update" && Array.isArray(r.changes)) {
        for (const ch of r.changes) {
          if (ch && "field" in ch && ("new" in ch || "old" in ch)) c[ch.field] = ch.new ?? ch.old ?? c[ch.field];
        }
      }
      return c;
    });

    const live = new Map(); // model → Set(record ids)
    rows.forEach((r, i) => {
      if (r.action !== "update" || (r.snapshot && typeof r.snapshot === "object")) return;
      const pk = pkOf(MODELS.get(r.model_name));
      if (pk.length !== 1 || !refFields(r.model_name).size || !r.record_id) return;
      if (!live.has(r.model_name)) live.set(r.model_name, new Set());
      live.get(r.model_name).add(r.record_id);
      ctx[i].__live = true;
    });
    const liveRows = new Map(); // `${model}:${id}` → current record
    await Promise.all(
      [...live].map(async ([model, ids]) => {
        try {
          const pk = pkOf(MODELS.get(model))[0];
          const values = [...ids].map((v) => (pk.type === "Int" ? Number(v) : String(v))).filter((v) => v === v);
          if (!values.length) return;
          const select = Object.fromEntries(contextFields(model).map((f) => [f, true]));
          const found = await db[accessor(model)].findMany({ where: { [pk.name]: { in: values } }, select });
          for (const rec of found) liveRows.set(`${model}:${rec[pk.name]}`, rec);
        } catch (e) {
          console.error(`[audit] could not read ${model} for names:`, e?.message);
        }
      }),
    );
    rows.forEach((r, i) => {
      if (!ctx[i].__live) return;
      delete ctx[i].__live;
      const rec = liveRows.get(`${r.model_name}:${r.record_id}`);
      // What the update itself recorded wins over the record as it is now
      if (rec) ctx[i] = { ...rec, ...ctx[i] };
    });

    // 2. Every id to name, per table.
    const wanted = new Map(); // target → Set(id)
    const want = (target, v) => {
      if (!isPlain(v)) return;
      const id = castId(nameSpec(target), v);
      if (id === null) return;
      if (!wanted.has(target)) wanted.set(target, new Set());
      wanted.get(target).add(id);
    };
    rows.forEach((r, i) => {
      const refs = refFields(r.model_name);
      if (!refs.size) return;
      for (const [col, target] of refs) want(target, ctx[i][col]);
      if (Array.isArray(r.changes)) {
        for (const ch of r.changes) {
          const target = ch && refs.get(ch.field);
          if (target) {
            want(target, ch.old);
            want(target, ch.new);
          }
        }
      }
    });

    const names = new Map(); // `${target}:${id}` → { label, rec }
    await Promise.all(
      [...wanted].map(async ([target, ids]) => {
        const spec = nameSpec(target);
        try {
          const select = Object.fromEntries([spec.pk, ...spec.fields].map((f) => [f, true]));
          const found = await db[accessor(target)].findMany({ where: { [spec.pk]: { in: [...ids] } }, select });
          for (const rec of found) {
            const label = spec.label(rec);
            if (label) names.set(keyOf(target, rec[spec.pk]), { label: String(label), rec });
          }
        } catch (e) {
          console.error(`[audit] could not name ${target}:`, e?.message);
        }
      }),
    );

    // 3. Names onto the rows.
    return rows.map((r, i) => {
      const refs = refFields(r.model_name);
      const c = ctx[i];
      const nameOf = (col, v) => {
        if (col === "tran_code" && isPlain(v)) return TRAN_CODES.get(Number(v)) ?? null;
        const target = refs.get(col);
        return target && isPlain(v) ? names.get(keyOf(target, v))?.label ?? null : null;
      };

      const changes = Array.isArray(r.changes)
        ? r.changes.map((ch) => {
            if (!ch || !("field" in ch) || !("old" in ch || "new" in ch)) return ch;
            const old_label = nameOf(ch.field, ch.old);
            const new_label = nameOf(ch.field, ch.new);
            return old_label || new_label ? { ...ch, ...(old_label && { old_label }), ...(new_label && { new_label }) } : ch;
          })
        : r.changes;

      let snapshot_labels = null;
      if (r.snapshot && typeof r.snapshot === "object" && !Array.isArray(r.snapshot)) {
        for (const [col, v] of Object.entries(r.snapshot)) {
          const label = nameOf(col, v);
          if (label) (snapshot_labels ??= {})[col] = label;
        }
      }

      // The item / account the row is about
      const itemCols = [...ITEM_FIELDS, ...[...refs].filter(([col, t]) => t === "Item" && !ITEM_FIELDS.includes(col) && col !== "packing_material_code").map(([col]) => col), "packing_material_code"];
      let item = null;
      for (const col of itemCols) {
        if (refs.get(col) !== "Item" || !isPlain(c[col])) continue;
        const hit = names.get(keyOf("Item", c[col]));
        item = { itcd: Number(c[col]), code: hit?.rec.code ?? null, name: hit?.rec.item ?? null };
        break;
      }
      let account = null;
      for (const col of ACCOUNT_FIELDS) {
        if (refs.get(col) !== "ACNO" || !isPlain(c[col])) continue;
        account = { acno: Number(c[col]), name: names.get(keyOf("ACNO", c[col]))?.label ?? null };
        break;
      }
      const isoCol = ISO_FIELDS.find((col) => isPlain(c[col]));
      const iso = isoCol ? Number(c[isoCol]) || null : null;

      return { ...r, changes, snapshot_labels, item, account, iso };
    });
  } catch (e) {
    console.error("[audit] naming failed:", e);
    return rows;
  }
}
