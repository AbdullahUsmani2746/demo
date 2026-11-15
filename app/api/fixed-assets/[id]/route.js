// /api/fixed-assets/[id] — one asset.
//   GET  the asset, its rules (and where each comes from), movements,
//        depreciation posted, disposal and the schedule      (fixedAsset.manage)
//   PUT  its own overrides — method, useful life, rate, salvage, in-service
//        date, brought-forward accumulated depreciation (and cost when no
//        capitalisation journal carries it) — only until its first
//        depreciation is posted; description / remarks any time; the holder
//        only while the Relocation voucher is switched off (kept as a
//        HOLDER_CHANGE movement)                               (fixedAsset.manage)
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { setAuditActor } from "@/lib/audit/context";
import { feature } from "@/lib/features/server";
import { loadAssets } from "@/lib/fixedAssets/register";
import { buildSchedule, dayKey, r2, ymOf, addMonths } from "@/lib/fixedAssets/calc";
import { FaError } from "@/lib/fixedAssets/errors";
import { faResponse, actorOf } from "../_shared";

async function load(id) {
  const { assets, settings } = await loadAssets({ where: { id } });
  if (!assets.length) throw new FaError("Asset not found.", 404);
  return { asset: assets[0], settings };
}

export const GET = guard("fixedAsset.manage", async (req, { params }) => {
  try {
    const id = Number((await params).id);
    const { asset, settings } = await load(id);
    const [movements, depts, locs] = await Promise.all([
      prisma.fixedAssetMovement.findMany({ where: { asset_id: id }, orderBy: [{ dated: "asc" }, { id: "asc" }] }),
      prisma.department.findMany({ select: { id: true, dept_name: true } }),
      prisma.workLocation.findMany({ select: { id: true, location_name: true } }),
    ]);
    const empIds = [...new Set(movements.flatMap((m) => [m.from_employee_id, m.to_employee_id]).filter(Boolean))];
    const emps = empIds.length ? await prisma.employee.findMany({ where: { id: { in: empIds } }, select: { id: true, firstName: true, surname: true } }) : [];
    const dn = new Map(depts.map((d) => [d.id, d.dept_name]));
    const ln = new Map(locs.map((l) => [l.id, l.location_name]));
    const en = new Map(emps.map((e) => [e.id, `${e.firstName} ${e.surname ?? ""}`.trim()]));
    const holder = (d, e, l) => [dn.get(d), en.get(e), ln.get(l)].filter(Boolean).join(" / ") || "—";
    const posted = new Map(asset.lines.map((l) => [l.period, { amount: l.amount, tran_id: l.jv_tran_id, kind: "POSTED" }]));
    if (asset.disposal?.month_charge) {
      const p = ymOf(asset.disposal.dated);
      posted.set(p, { amount: r2((posted.get(p)?.amount ?? 0) + asset.disposal.month_charge), tran_id: asset.disposal.jv_tran_id, kind: "DISPOSAL" });
    }
    const lastRun = await prisma.fixedAssetDepreciationRun.findFirst({ where: { status: "POSTED" }, orderBy: { period: "desc" } });
    const projectFrom = lastRun ? addMonths(lastRun.period, 1) : ymOf(new Date());
    const depreciationOn = await feature("fixedAssets.depreciation");
    const schedule = depreciationOn
      ? buildSchedule({ asset, rules: asset.rules, settings, posted, projectFrom, disposedOn: asset.disposal ? asset.disposal.dated : null })
      : [];
    const relocationOn = await feature("fixedAssets.relocation");
    return NextResponse.json({
      data: {
        ...asset,
        editable: !asset.has_depreciation && asset.status === "IN_USE",
        cost_editable: !asset.has_depreciation && asset.status === "IN_USE" && !asset.capitalisation_tran_id,
        holder_editable: asset.status === "IN_USE" && !relocationOn,
        movements: movements.map((m) => ({
          ...m, dated: dayKey(m.dated),
          from: holder(m.from_department_id, m.from_employee_id, m.from_location_id),
          to: holder(m.to_department_id, m.to_employee_id, m.to_location_id),
        })),
        schedule,
      },
    });
  } catch (error) {
    return faResponse(error, "GET [id]");
  }
});

const optInt = (v, min, max, label) => {
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isInteger(n) || n < min || n > max) throw new FaError(`${label}: a whole number from ${min} to ${max}.`);
  return n;
};
const optNum = (v, min, max, label) => {
  if (v === null || v === "") return null;
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new FaError(`${label}: a number from ${min} to ${max}.`);
  return r2(n);
};

export const PUT = guard("fixedAsset.manage", async (req, { params, session }) => {
  setAuditActor(session);
  try {
    const id = Number((await params).id);
    const { asset } = await load(id);
    const body = await req.json().catch(() => ({}));
    const data = {};
    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
    if (has("description")) data.description = body.description ? String(body.description).slice(0, 250) : null;
    if (has("remarks")) data.remarks = body.remarks ? String(body.remarks).slice(0, 500) : null;

    const ruleKeys = ["method", "useful_life_months", "rb_rate", "salvage_value", "in_service_date", "opening_accumulated", "cost"];
    if (ruleKeys.some(has)) {
      if (asset.status !== "IN_USE") throw new FaError("A disposed asset cannot be changed.", 409);
      if (asset.has_depreciation) {
        throw new FaError("Depreciation is already posted for this asset — its cost, life, method and salvage are fixed now.", 409);
      }
      if (has("method")) {
        if (body.method != null && body.method !== "" && !["SL", "RB"].includes(body.method)) throw new FaError("Method: SL or RB.");
        data.method = body.method || null;
      }
      if (has("useful_life_months")) data.useful_life_months = optInt(body.useful_life_months, 1, 1200, "Useful life (months)");
      if (has("rb_rate")) data.rb_rate = optNum(body.rb_rate, 0.01, 100, "Rate %");
      if (has("cost") && Number(body.cost) !== asset.cost) {
        if (asset.capitalisation_tran_id) throw new FaError("The cost is posted by the GRN's capitalisation journal and cannot be changed here.", 409);
        data.cost = optNum(body.cost, 0, 1e12, "Cost") ?? 0;
      }
      const cost = data.cost ?? asset.cost;
      if (has("salvage_value")) data.salvage_value = optNum(body.salvage_value, 0, cost, "Salvage value");
      if (has("opening_accumulated")) data.opening_accumulated = optNum(body.opening_accumulated, 0, cost, "Accumulated depreciation brought forward") ?? 0;
      if (has("in_service_date")) {
        const d = dayKey(body.in_service_date);
        if (!d || d > dayKey(new Date())) throw new FaError("In-service date: today or earlier.");
        data.in_service_date = new Date(`${d}T00:00:00.000Z`);
      }
    }

    const holderKeys = ["department_id", "employee_id", "location_id"];
    const holderChange = holderKeys.some((k) => has(k) && (body[k] === "" ? null : body[k] == null ? null : Number(body[k])) !== asset[k]);
    if (holderChange) {
      if (await feature("fixedAssets.relocation")) throw new FaError("Move the asset with a Fixed Asset Relocation voucher (it keeps the history).", 409);
      if (asset.status !== "IN_USE") throw new FaError("A disposed asset cannot be moved.", 409);
      for (const k of holderKeys) if (has(k)) data[k] = body[k] === null || body[k] === "" ? null : optInt(body[k], 1, 2 ** 31 - 1, k);
    }

    if (!Object.keys(data).length) return NextResponse.json({ message: "Nothing to change." }, { status: 400 });
    await prisma.$transaction(async (tx) => {
      await tx.fixedAsset.update({ where: { id }, data });
      if (holderChange) {
        await tx.fixedAssetMovement.create({
          data: {
            asset_id: id, kind: "HOLDER_CHANGE", dated: new Date(`${dayKey(new Date())}T00:00:00.000Z`),
            from_department_id: asset.department_id, from_employee_id: asset.employee_id, from_location_id: asset.location_id,
            to_department_id: data.department_id !== undefined ? data.department_id : asset.department_id,
            to_employee_id: data.employee_id !== undefined ? data.employee_id : asset.employee_id,
            to_location_id: data.location_id !== undefined ? data.location_id : asset.location_id,
            created_by: actorOf(session), remarks: body.remarks ? String(body.remarks).slice(0, 500) : null,
          },
        });
      }
    });
    return NextResponse.json({ message: "Asset saved", data: (await load(id)).asset });
  } catch (error) {
    return faResponse(error, "PUT [id]");
  }
});
