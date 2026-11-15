// /api/bi/access — which datasets each department may use (BI Designer only)
//   GET → { departments, datasets, access: { [departmentId]: [datasetKey] } }
//   PUT { departmentId, datasets: [key] } — replace; [] = no limit (all datasets)
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";
import { bi, biJson } from "@/lib/bi/http";
import { BiError } from "@/lib/bi/engine";
import { DATASETS } from "@/lib/bi/datasets";

export const GET = guard(
  null,
  bi(async () => {
    const [departments, rows] = await Promise.all([
      prisma.department.findMany({ select: { id: true, dept_name: true }, orderBy: { id: "asc" } }),
      prisma.biDatasetAccess.findMany(),
    ]);
    const access = {};
    for (const r of rows) (access[r.department_id] ||= []).push(r.dataset);
    return biJson({
      departments,
      datasets: DATASETS.map(({ key, label, description }) => ({ key, label, description })),
      access,
    });
  }, { design: true }),
);

export const PUT = guard(
  null,
  bi(async (req) => {
    const { departmentId, datasets = [] } = await req.json();
    const dept = Number(departmentId);
    if (!Number.isFinite(dept)) throw new BiError("departmentId is required.");
    const keys = [...new Set(datasets)].filter((k) => DATASETS.some((d) => d.key === k));
    await prisma.$transaction([
      prisma.biDatasetAccess.deleteMany({ where: { department_id: dept } }),
      ...(keys.length
        ? [prisma.biDatasetAccess.createMany({ data: keys.map((dataset) => ({ department_id: dept, dataset })) })]
        : []),
    ]);
    return biJson({ ok: true });
  }, { design: true }),
);
