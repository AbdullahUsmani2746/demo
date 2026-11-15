import prisma from "@/lib/prisma";

/**
 * Process Order Timing Report
 * Shows each scan stage for every process order in the date range.
 * Flags stages where scanned_at > expected_at (is_late = true).
 */
export async function getProcessOrderTimingReport({
  dateFrom,
  dateTo,
  proc_ord_no,
  lateOnly = false,
} = {}) {
  const start = dateFrom ? new Date(dateFrom) : new Date("2000-01-01");
  const end   = dateTo   ? new Date(dateTo)   : new Date();
  start.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);

  const where = {
    scanned_at: { gte: start, lte: end },
    ...(proc_ord_no ? { proc_ord_no: parseInt(proc_ord_no) } : {}),
    ...(lateOnly    ? { is_late: true }                      : {}),
  };

  const logs = await prisma.processScanLog.findMany({
    where,
    orderBy: [{ proc_ord_no: "asc" }, { scanned_at: "asc" }],
    include: {
      planMaster: {
        select: {
          id:          true,
          batch_no:    true,
          currentStage: true,
          item: { select: { item: true } },
        },
      },
    },
  });

  const data = logs.map((log) => {
    const delayMs = log.is_late && log.expected_at
      ? new Date(log.scanned_at).getTime() - new Date(log.expected_at).getTime()
      : 0;
    const delay_minutes = delayMs > 0 ? Math.round(delayMs / 60000) : 0;

    return {
      proc_ord_no:   log.proc_ord_no,
      item_name:     log.planMaster?.item?.item ?? "",
      batch_no:      log.planMaster?.batch_no ?? "",
      stage:         log.stage,
      scanned_at:    log.scanned_at,
      expected_at:   log.expected_at,
      is_late:       log.is_late ? "LATE" : "On Time",
      scanned_by:    log.scanned_by ?? "",
      delay_minutes,
      remarks:       log.remarks ?? "",
    };
  });

  const summary = {
    total_scans:   data.length,
    late_count:    data.filter((r) => r.is_late === "LATE").length,
    on_time_count: data.filter((r) => r.is_late !== "LATE").length,
  };

  return { data, summary };
}
