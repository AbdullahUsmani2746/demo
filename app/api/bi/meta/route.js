// GET /api/bi/meta — everything the BI Designer needs to build: datasets
// (fields / measures, no SQL), visuals, periods, and the people / roles /
// departments dashboards can be assigned to.
import prisma from "@/lib/prisma";
import { activeRoleCodes } from "@/lib/auth/roleCatalog";
import { guard } from "@/lib/auth/route";
import { bi, biJson } from "@/lib/bi/http";
import { DATASETS, datasetMeta } from "@/lib/bi/datasets";
import { VISUALS, PERIODS, GRAINS, AGGS, FILTER_OPS } from "@/lib/bi/visuals";
import { filterableFields } from "@/lib/bi/validate";

export const GET = guard(
  null,
  bi(async () => {
    const [departments, users, approvalRules] = await Promise.all([
      prisma.department.findMany({ select: { id: true, dept_name: true }, orderBy: { id: "asc" } }),
      prisma.user.findMany({
        select: { id: true, name: true, email: true, role: true, departmentId: true },
        orderBy: { name: "asc" },
      }),
      // Follow-up scenarios name approval rules: their approvers see every item
      prisma.approvalRule.findMany({
        select: { id: true, name: true, doc_type: true, is_active: true },
        orderBy: [{ doc_type: "asc" }, { name: "asc" }],
      }),
    ]);
    return biJson({
      datasets: DATASETS.map(datasetMeta),
      visuals: VISUALS,
      periods: PERIODS,
      grains: GRAINS,
      aggs: AGGS,
      filterOps: FILTER_OPS,
      dashboardFilterFields: filterableFields(),
      roles: await activeRoleCodes(),
      departments,
      users,
      approvalRules,
    });
  }, { design: true }),
);
