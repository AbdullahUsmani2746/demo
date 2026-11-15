// GET /api/fixed-assets/picker — assets for the relocation / disposal line
// pickers (components/Category/constants.js). ?status=IN_USE, ?search=,
// ?asset_no= (label lookup). Any signed-in user; the voucher route checks
// the voucher rights.
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";
import { loadAssets } from "@/lib/fixedAssets/register";

export const GET = guard(null, async (req) => {
  const url = new URL(req.url);
  const where = {};
  const status = url.searchParams.get("status");
  if (status) where.status = status;
  const no = parseInt(url.searchParams.get("asset_no") ?? "", 10);
  if (Number.isFinite(no)) where.asset_no = no;
  const { assets } = await loadAssets({ where });
  const term = (url.searchParams.get("search") || "").trim().toLowerCase();
  const data = assets
    .filter((a) => !term || [a.asset_label, a.asset_no, a.item, a.category, a.department, a.employee].some((v) => String(v ?? "").toLowerCase().includes(term)))
    .slice(0, 200)
    .map((a) => ({
      asset_no: a.asset_no, asset_label: a.asset_label, itcd: a.itcd, item: a.item, category: a.category, status: a.status,
      department_id: a.department_id, employee_id: a.employee_id, location_id: a.location_id,
      holder: [a.department, a.employee, a.location].filter(Boolean).join(" / ") || null,
      cost: a.cost, nbv: a.nbv, nbv_text: `NBV ${a.nbv.toLocaleString("en-US", { maximumFractionDigits: 2 })}`,
    }));
  return NextResponse.json({ data });
});
