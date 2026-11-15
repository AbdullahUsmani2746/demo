// /api/hr/payroll/tax — salaried income-tax slabs per fiscal year (July–June).
//   GET  ?year=2026   the slabs of FY 2026-27 (and which years have slabs)
//   PUT  { fiscal_year, slabs: [{ from_amount, to_amount, fixed_amount, rate_percent }] }
//        replaces that year's slabs (hr.payroll.manage)
import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { HR_PERMS } from "@/lib/hr/access";
import { hrRoute, jsonBody } from "@/lib/hr/route";
import { fiscalYearOf } from "@/lib/hr/payroll/compute";
import { PayrollError } from "@/lib/hr/payroll/run";
import { todayKey } from "@/lib/hr/time";

const VIEW = [HR_PERMS.payrollView, HR_PERMS.payrollManage, HR_PERMS.payrollApprove, HR_PERMS.payrollPost];

export const GET = hrRoute(VIEW, async (req) => {
  const y = Number(new URL(req.url).searchParams.get("year")) || fiscalYearOf(todayKey().slice(0, 7));
  const [slabs, years] = await Promise.all([
    prisma.hrTaxSlab.findMany({ where: { fiscal_year: y }, orderBy: { from_amount: "asc" } }),
    prisma.hrTaxSlab.findMany({ distinct: ["fiscal_year"], select: { fiscal_year: true }, orderBy: { fiscal_year: "desc" } }),
  ]);
  return NextResponse.json({ fiscal_year: y, slabs, years: years.map((r) => r.fiscal_year) });
});

export const PUT = hrRoute([HR_PERMS.payrollManage], async (req) => {
  const b = await jsonBody(req);
  const fy = Number(b.fiscal_year);
  if (!Number.isInteger(fy) || fy < 2000 || fy > 2100) throw new PayrollError("Pick the fiscal year.");
  const raw = Array.isArray(b.slabs) ? b.slabs : [];
  if (!raw.length || raw.length > 20) throw new PayrollError("Enter 1 to 20 slabs.");
  const slabs = raw
    .map((s) => ({
      from_amount: Number(s.from_amount),
      to_amount: s.to_amount === "" || s.to_amount == null ? null : Number(s.to_amount),
      fixed_amount: Number(s.fixed_amount || 0),
      rate_percent: Number(s.rate_percent || 0),
    }))
    .sort((a, c) => a.from_amount - c.from_amount);
  slabs.forEach((s, i) => {
    const n = i + 1;
    if (![s.from_amount, s.fixed_amount, s.rate_percent].every(Number.isFinite) || s.from_amount < 0 || s.fixed_amount < 0) throw new PayrollError(`Slab ${n}: amounts must be numbers of 0 or more.`);
    if (s.rate_percent < 0 || s.rate_percent > 100) throw new PayrollError(`Slab ${n}: rate is a % from 0 to 100.`);
    if (s.to_amount !== null && (!Number.isFinite(s.to_amount) || s.to_amount <= s.from_amount)) throw new PayrollError(`Slab ${n}: "up to" must be above "from".`);
    if (i > 0 && slabs[i - 1].to_amount !== s.from_amount) throw new PayrollError(`Slab ${n} must start where slab ${i} ends (${slabs[i - 1].to_amount ?? "—"}).`);
  });
  if (slabs[0].from_amount !== 0) throw new PayrollError("The first slab must start at 0.");
  if (slabs[slabs.length - 1].to_amount !== null) throw new PayrollError("The last slab must have no upper limit.");
  await prisma.$transaction([
    prisma.hrTaxSlab.deleteMany({ where: { fiscal_year: fy } }),
    prisma.hrTaxSlab.createMany({ data: slabs.map((s) => ({ ...s, fiscal_year: fy })) }),
  ]);
  return NextResponse.json({ success: true, message: `Tax slabs for ${fy}–${String(fy + 1).slice(2)} saved. Draft payrolls use them when recalculated.` });
});
