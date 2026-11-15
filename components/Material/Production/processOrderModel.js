// components/Material/Production/processOrderModel.js
// ============================================================
// Pure helpers of the Process Order form (ProcessOrderForm.jsx): the editable
// state shape, loading an existing order into it, validation and the request
// body sent to /api/manufacturing/production (see lib/manufacturing/processOrder.js).
//
//   outputs  production (finished) items — LEFT panel
//   lines    issuance lines (materials + instructions), each belonging to one
//            output through `outputKey` — RIGHT panel
// ============================================================
// Default godowns + packing categories come from Settings → Production setup
// (hooks/useProductionSetup.js → `setup`), passed in by the form.
import { godownForCategory, isPackingCategory } from "@/lib/production/setupConfig";

export const PRODUCTION_TYPES = { NEW: "new", SF: "sf", REPROCESSING: "reprocessing" };
export const DEFAULT_UNIT = "KG";
export const UNIT_OPTIONS = ["KG", "PCS", "NOS", "FT", "MTR", "ROLL", "PCK", "TON", "PAR", "MND", "OTH"];
export { godownForCategory, isPackingCategory };

let seq = 0;
export const newKey = (prefix) => `${prefix}_${Date.now().toString(36)}_${(seq++).toString(36)}`;

export const toNum = (v) => {
  if (v === "" || v === null || v === undefined) return 0;
  const n = parseFloat(v);
  return Number.isFinite(n) ? n : 0;
};
export const round = (n, d = 3) => {
  const f = 10 ** d;
  return Math.round((Number(n) || 0) * f) / f;
};
export const fmtQty = (n) =>
  (Number(n) || 0).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 3 });

/** An item's unit as a posting unit: litres are not a stock unit here (qty is KG). */
export const unitOfItem = (unit) => {
  const u = String(unit || "").trim().toUpperCase();
  if (!u || u === "LTR" || u === "LITRE" || u === "LITER") return DEFAULT_UNIT;
  return u;
};

export const emptyOutput = (overrides = {}) => ({
  key: newKey("out"),
  finished_id: null,
  item_code: "",
  item_name: "",
  ic_id: null,
  bom_id: null,
  bom_label: "",
  qty: "",
  actual_yield: null,
  unit: DEFAULT_UNIT,
  godown: null,
  batch_no: "",
  ...overrides,
});

/** `setup` (Production setup) gives a material line its default issue godown. */
export const emptyLine = (outputKey, kind = "material", overrides = {}, setup) => ({
  key: newKey("ln"),
  id: null,
  outputKey,
  kind,
  material_id: null,
  material_code: "",
  material_desc: "",
  material_qty: "",
  material_percentage: 0,
  godown: kind === "material" ? setup.productionGodown : null,
  unit: kind === "material" ? DEFAULT_UNIT : null,
  fromBom: false,
  orig: null,
  ...overrides,
});

export const emptyHeader = () => ({
  dated: new Date().toISOString().split("T")[0],
  req_del_date: "",
  req_no: "",
  req_items: [],
  sale_ord_no: null,
  machine_id: "",
  time_min: "",
  viscosity: "",
  m2m: false,
  receipe_id: null,
  // reprocessing: wait for Send to Production (processOrder.batchRequiredReprocessing)
  batch_required: false,
});

/** BOM materials (from /api/manufacturing/bom/:id `materials`) → issuance lines. */
export const linesFromBom = (outputKey, materials = [], qty = 0, setup) =>
  materials.map((m) =>
    emptyLine(outputKey, "material", {
      material_id: m.id ?? m.material_id,
      material_code: m.code ?? m.material_code ?? "",
      material_desc: m.name ?? m.material_desc ?? "",
      material_percentage: toNum(m.percentage ?? m.material_percentage),
      material_qty: round((toNum(qty) * toNum(m.percentage ?? m.material_percentage)) / 100),
      fromBom: true,
    }, setup),
  );

/**
 * Recipe details (RECEIPE_DETAIL rows: product_id, product_desc, product_percentage, sno)
 * → issuance lines, in recipe order. A row without an item is an instruction.
 * Used when Settings → Features makes process orders from recipes
 * (production.processOrderSource = "recipe"). Materials follow the planned
 * quantity like BOM lines (fromBom) until edited by hand.
 */
export const linesFromRecipe = (outputKey, details = [], qty = 0, setup) =>
  [...details]
    .sort((a, b) => (a.sno || 0) - (b.sno || 0) || (a.id || 0) - (b.id || 0))
    .map((d, i) =>
      d.product_id
        ? emptyLine(outputKey, "material", {
            material_id: d.product_id,
            material_code: d.item?.code || "",
            material_desc: d.product_desc || d.item?.item || "",
            material_percentage: toNum(d.product_percentage),
            material_qty: round((toNum(qty) * toNum(d.product_percentage)) / 100),
            fromBom: true,
          }, setup)
        : emptyLine(outputKey, "instruction", { material_desc: d.product_desc || `Instruction ${d.sno || i + 1}` }, setup),
    );

/** An order from GET /api/manufacturing/production → editable state. */
export function loadOrder(plan, setup) {
  if (!plan) {
    const out = emptyOutput();
    return { header: emptyHeader(), outputs: [out], lines: [] };
  }
  const rawOutputs = plan.outputs?.length
    ? plan.outputs
    : [{ line_no: 1, finished_id: plan.finished_id, qty: plan.qty, actual_yield: plan.actual_yield, batch_no: plan.batch_no, bom_id: plan.bom_id }];

  const outputs = rawOutputs.map((o, i) =>
    emptyOutput({
      line_no: o.line_no ?? i + 1,
      finished_id: o.finished_id ?? null,
      item_code: o.item_code || (i === 0 ? plan.recipe?.item?.code || "" : ""),
      item_name: o.item_name || (i === 0 ? plan.productName || "" : ""),
      ic_id: o.ic_id ?? (i === 0 ? plan.productCategory ?? null : null),
      bom_id: o.bom_id ?? null,
      bom_label: o.bom_id ? `BOM #${o.bom_id}` : "",
      qty: o.qty ?? "",
      actual_yield: o.actual_yield ?? null,
      unit: o.unit || DEFAULT_UNIT,
      godown: o.godown ?? null,
      batch_no: o.batch_no || "",
    }),
  );
  const keyOfLine = new Map(outputs.map((o) => [Number(o.line_no), o.key]));

  // A detail with material_id is a material; one without is an instruction.
  const details = [...(plan.productionPlanDetail || [])].sort(
    (a, b) => (a.sno || 0) - (b.sno || 0) || (a.id || 0) - (b.id || 0),
  );
  const editedMaterials = new Set((plan.changeLogs || []).map((l) => l.material_id).filter(Boolean));
  const lines = details.map((d) => {
    const isMaterial = d.material_id !== null && d.material_id !== undefined;
    return emptyLine(keyOfLine.get(Number(d.output_line) || 1) || outputs[0].key, isMaterial ? "material" : "instruction", {
      id: d.id ?? null,
      material_id: isMaterial ? d.material_id : null,
      material_code: d.material_code || d.item?.code || "",
      material_desc: d.material_desc || d.item?.item || "",
      material_qty: isMaterial ? d.material_qty ?? 0 : 0,
      material_percentage: d.material_percentage ?? 0,
      godown: isMaterial ? d.issue_godown ?? d.godown ?? setup.productionGodown : null,
      unit: isMaterial ? d.issue_unit || d.unit || DEFAULT_UNIT : null,
      wastage_percentage: d.item?.wastage_percentage ?? null,
      edited: isMaterial && editedMaterials.has(d.material_id),
      orig: { qty: d.material_qty ?? 0, pct: d.material_percentage ?? 0, desc: d.material_desc || "" },
    }, setup);
  });

  // Group the lines by production item, keeping their saved order inside it
  const order = new Map(outputs.map((o, i) => [o.key, i]));
  lines.sort((a, b) => order.get(a.outputKey) - order.get(b.outputKey));

  const header = {
    ...emptyHeader(),
    dated: plan.dated || emptyHeader().dated,
    req_del_date: plan.req_del_date || "",
    req_no: plan.req_no || "",
    sale_ord_no: plan.sale_ord_no ?? null,
    machine_id: plan.machine_id ?? "",
    time_min: plan.time_min ?? "",
    viscosity: plan.viscosity || "",
    m2m: !!plan.m2m,
    batch_required: !!plan.batch_required,
    receipe_id: plan.receipe_id ?? null,
    receipe_label: plan.receipe_id
      ? `Recipe #${plan.receipe_id}${plan.recipe?.item ? ` - ${plan.recipe.item.code || ""} ${plan.recipe.item.item || ""}` : ""}`
      : "",
  };
  return { header, outputs, lines };
}

/** Godown an output produces into when the user has not picked one. */
export const outputGodown = (o, setup) => o.godown ?? (o.finished_id ? godownForCategory(setup, o.ic_id) : null);

/**
 * Inline validation.
 * @returns {{ outputs: Map<key, string[]>, lines: Map<key, string[]>, header: string[], count: number }}
 */
export function validate({ header, outputs, lines, type, setup, stockShort = new Map(), blockOnStock = false, requireRecipe = false, requireBom = false }) {
  const out = new Map();
  const ln = new Map();
  const head = [];
  const push = (map, key, msg) => {
    if (!map.has(key)) map.set(key, []);
    map.get(key).push(msg);
  };

  if (!header.dated) head.push("Plan date is required");
  if (outputs.length === 0) head.push("Add at least one production item");
  // Settings → Features: process orders are made from recipes
  if (requireRecipe && !header.receipe_id) head.push("Choose the recipe — new process orders are made from a recipe");

  for (const o of outputs) {
    if (!o.finished_id) push(out, o.key, "Select the production item");
    if (!(toNum(o.qty) > 0)) push(out, o.key, "Enter the quantity to produce");
    if (!outputGodown(o, setup)) push(out, o.key, "Select the production godown");
    // Settings → Features "production.bomRequired"
    if (requireBom && !o.bom_id) push(out, o.key, "Choose the BOM — process orders must name a BOM");
    const mats = lines.filter((l) => l.outputKey === o.key && l.kind === "material");
    if (mats.length === 0) push(out, o.key, "No issuances — load the BOM or add lines");
  }
  for (const l of lines) {
    if (l.kind === "instruction") continue;
    if (!l.material_id) push(ln, l.key, "Select the item to issue");
    if (!(toNum(l.material_qty) > 0)) push(ln, l.key, "Enter the issue quantity");
    if (!l.godown) push(ln, l.key, "Select the issue godown");
    if (blockOnStock && stockShort.get(l.key) > 0) push(ln, l.key, "Not enough stock");
  }

  // Requisition (Plan No): planned output must not exceed its total qty
  if (type === PRODUCTION_TYPES.NEW && header.req_no && header.req_items?.length) {
    const reqTotal = header.req_items.reduce((s, r) => s + toNum(r.qty), 0);
    const planned = outputs.reduce((s, o) => s + toNum(o.qty), 0);
    if (reqTotal > 0 && planned > reqTotal) {
      head.push(
        `Production qty (${fmtQty(planned)}) exceeds the Dispatch Requisition total (${fmtQty(reqTotal)}) of Plan #${header.req_no}`,
      );
    }
  }

  // An issuance error also flags its production item
  for (const l of lines) {
    if (ln.has(l.key) && !out.has(l.outputKey)) push(out, l.outputKey, "Fix the highlighted issuance lines");
  }
  const count = head.length + [...out.values()].reduce((s, v) => s + v.length, 0) + [...ln.values()].reduce((s, v) => s + v.length, 0);
  return { outputs: out, lines: ln, header: head, count };
}

/** Editable state → POST / PUT body. */
export function buildPayload({ header, outputs, lines, type, isEdit, locked, setup }) {
  const outputsBody = outputs.map((o, i) => ({
    line_no: i + 1,
    finished_id: o.finished_id,
    bom_id: o.bom_id || null,
    qty: toNum(o.qty),
    actual_yield:
      o.actual_yield !== null && o.actual_yield !== "" && o.actual_yield !== undefined
        ? toNum(o.actual_yield)
        : type === PRODUCTION_TYPES.REPROCESSING
          ? toNum(o.qty)
          : null,
    unit: o.unit || DEFAULT_UNIT,
    godown: outputGodown(o, setup),
    batch_no: o.batch_no || null,
  }));
  const lineNoOf = new Map(outputs.map((o, i) => [o.key, i + 1]));
  const qtyOf = new Map(outputs.map((o) => [o.key, toNum(o.qty)]));

  const ordered = outputs.flatMap((o) =>
    lines.filter((l) => l.outputKey === o.key && (l.kind === "material" || String(l.material_desc || "").trim() || l.id)),
  );
  const details = ordered.map((l, i) => {
    const isMat = l.kind === "material";
    const outQty = qtyOf.get(l.outputKey) || 0;
    const qty = isMat ? toNum(l.material_qty) : 0;
    // Posted orders are locked: send the stored values back untouched
    const pct = !isMat ? 0 : locked ? l.material_percentage : outQty > 0 ? round((qty / outQty) * 100, 4) : 0;
    return {
      sno: i + 1,
      material_id: isMat ? l.material_id : null,
      material_desc: l.material_desc || "",
      material_qty: qty,
      material_percentage: pct,
      output_line: lineNoOf.get(l.outputKey) || 1,
      godown: isMat ? l.godown : null,
      unit: isMat ? l.unit || DEFAULT_UNIT : null,
    };
  });

  // Edit history of materials already saved
  const changeLogs = [];
  if (isEdit && !locked) {
    for (const l of ordered) {
      if (l.kind !== "material" || !l.id || !l.orig) continue;
      const d = details[ordered.indexOf(l)];
      if (round(l.orig.qty) !== round(d.material_qty)) {
        changeLogs.push({
          detail_id: l.id,
          field_name: "material_qty",
          old_value: String(l.orig.qty),
          new_value: String(d.material_qty),
          material_id: l.material_id,
          material_desc: l.material_desc,
        });
      }
      if (round(l.orig.pct, 2) !== round(d.material_percentage, 2)) {
        changeLogs.push({
          detail_id: l.id,
          field_name: "material_percentage",
          old_value: String(l.orig.pct),
          new_value: String(d.material_percentage),
          material_id: l.material_id,
          material_desc: l.material_desc,
        });
      }
    }
  }

  const first = outputsBody[0] || {};
  return {
    type,
    ...header,
    req_items: undefined,
    machine_id: header.machine_id === "" ? null : header.machine_id,
    time_min: header.time_min === "" ? null : header.time_min,
    // master mirrors production item 1 (old clients / legacy route path)
    finished_id: first.finished_id,
    qty: first.qty,
    batch_no: first.batch_no,
    bom_id: first.bom_id,
    actual_yield: first.actual_yield,
    outputs: outputsBody,
    productionPlanDetail: details,
    reprocessing_materials: [],
    changeLogs: changeLogs.length ? changeLogs : undefined,
  };
}

/** One production item of an order shaped like a single-item plan (PDF template). */
export function planForOutput(plan, lineNo = 1) {
  const outputs = plan?.outputs?.length ? plan.outputs : null;
  if (!outputs) return plan;
  const o = outputs.find((x) => Number(x.line_no) === Number(lineNo)) || outputs[0];
  return {
    ...plan,
    finished_id: o.finished_id,
    productName: o.item_name || plan.productName,
    qty: o.qty,
    actual_yield: o.actual_yield,
    batch_no: o.batch_no,
    bom_id: o.bom_id,
    productionPlanDetail: (plan.productionPlanDetail || []).filter(
      (d) => (Number(d.output_line) || 1) === Number(o.line_no),
    ),
  };
}
