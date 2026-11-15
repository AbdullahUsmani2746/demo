import prisma from "@/lib/prisma";

/**
 * Auto-generate the next batch number as an INTEGER series.
 * Format: YY + 7-digit running sequence  (e.g. 260000001 for year 2026).
 * Shared by GRN QA and process-order QC so both use the same series.
 */
export async function generateBatchNo() {
  const yy    = new Date().getFullYear().toString().slice(-2); // "26"
  const start = Number(yy) * 10000000;                          // 260000000
  const end   = start + 10000000;                              // 270000000

  const last = await prisma.qualityMaster.findFirst({
    where:   { batch_no: { gte: start, lt: end } },
    orderBy: { batch_no: "desc" },
    select:  { batch_no: true },
  });

  if (!last?.batch_no) return start + 1;
  return last.batch_no + 1;
}

/**
 * Returns true if `batch_no` is already used for the SAME item (itcd).
 * Scoped per item; `excludeId` skips the current record (re-approval/edit).
 */
export async function isBatchDuplicate(batch_no, itcd, excludeId = null) {
  const num = parseInt(batch_no);
  if (isNaN(num) || !itcd) return false;
  const existing = await prisma.qualityMaster.findFirst({
    where: {
      batch_no: num,
      itcd:     Number(itcd),
      ...(excludeId ? { id: { not: Number(excludeId) } } : {}),
    },
    select: { id: true },
  });
  return !!existing;
}
