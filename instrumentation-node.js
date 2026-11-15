// instrumentation-node.js — loaded by instrumentation.js in the Node.js runtime only.
//
// Next.js runs register() once at process startup (server-only). This is
// where all scheduled/cron jobs for this app live, since production is a
// single long-lived Node process (Docker, "node server.js",
// --restart unless-stopped) — not serverless — so an in-process scheduler
// is safe here. See CLAUDE.md / lib/ledger/invoiceMatcher.js.

export async function registerJobs() {

  // node-cron is in serverExternalPackages (next.config.mjs): a runtime
  // require(), traced into the standalone build. Only the Node.js runtime
  // loads this file (instrumentation.js), so the edge bundle never sees it.
  const cron = await import("node-cron");
  const { runInvoiceKnockoffMatching } = await import("./lib/ledger/invoiceMatcher.js");
  const { calculateAndStoreMonthlySalesTeamActuals } = await import("./utils/monthlySalesTeamSnapshot.js");
  // Writes made by a job are recorded in the audit trail as "System: <job>".
  const { runAsSystem } = await import("./lib/audit/context.js");

  // Auto invoice knock-off / reconciliation — twice daily, Asia/Karachi.
  const runKnockoffMatching = (label) => {
    runAsSystem("Invoice knock-off", () => runInvoiceKnockoffMatching({ trigger: "CRON" }))
      .then((result) =>
        console.log(`[cron] Invoice knock-off matching (${label}) completed:`, result),
      )
      .catch((error) =>
        console.error(`[cron] Invoice knock-off matching (${label}) failed:`, error),
      );
  };

  cron.default.schedule("30 1 * * *", () => runKnockoffMatching("01:30"), {
    timezone: "Asia/Karachi",
  });
  cron.default.schedule("0 20 * * *", () => runKnockoffMatching("20:00"), {
    timezone: "Asia/Karachi",
  });

  // NOTE: there is deliberately NO opening-stock cron. Opening stock is
  // written only when a costing period is locked (or via the manual
  // "Calculate" button) — see lib/openingStockGenerate.js. A blind monthly
  // snapshot used to overwrite lock-period output with wrong numbers.

  // Monthly Sales Team MIS actuals snapshot — 1st of every month, 2:30 AM,
  // Asia/Karachi. Locks Sales Month (Ton) / Sale Amt (Rs) / Rec Month (Rs)
  // for the month that just ended (see utils/monthlySalesTeamSnapshot.js).
  cron.default.schedule(
    "30 2 1 * *",
    async () => {
      // The month that just ended, in PAKISTAN time. Reading new Date() in
      // the server's own zone (UTC) at 02:30 PKT on the 1st still gives the
      // previous day — so this used to lock the month BEFORE the one that
      // ended (on 1 Oct it re-locked August and never locked September).
      const { previousMonthKarachi } = await import("./lib/salesTargets/monthKey.js");
      const { month, year } = previousMonthKarachi();
      runAsSystem("Sales team MIS snapshot", () => calculateAndStoreMonthlySalesTeamActuals(month, year)).catch((error) =>
        console.error("[cron] Monthly Sales Team MIS snapshot failed:", error),
      );
      // The new month's Target Recovery for every customer (set by the
      // system — lib/salesTargets/autoTarget.js), so the MIS has it from day 1.
      const { karachiNow } = await import("./lib/salesTargets/monthKey.js");
      const { syncTargetRecovery } = await import("./lib/salesTargets/autoTarget.js");
      const today = karachiNow();
      runAsSystem("Sales targets — new month", () => syncTargetRecovery({ year: today.year, month: today.month })).catch((error) =>
        console.error("[cron] New-month Target Recovery failed:", error),
      );
    },
    { timezone: "Asia/Karachi" },
  );

  // BI follow-ups (lib/bi/followups.js): re-scan the follow-up questions every
  // 30 min in working hours, and send the daily digest / escalations at 09:00.
  const followups = () => import("./lib/bi/followups.js");
  cron.default.schedule(
    "*/30 7-21 * * *",
    async () => {
      try {
        await runAsSystem("Follow-up sync", async () => (await followups()).syncFollowups());
      } catch (error) {
        console.error("[cron] Follow-up sync failed:", error);
      }
    },
    { timezone: "Asia/Karachi" },
  );
  cron.default.schedule(
    "0 9 * * *",
    async () => {
      try {
        console.log("[cron] Follow-up escalations:", await runAsSystem("Follow-up escalations", async () => (await followups()).runEscalations()));
      } catch (error) {
        console.error("[cron] Follow-up escalations failed:", error);
      }
    },
    { timezone: "Asia/Karachi" },
  );

  // 08:00 morning summary of each recipient's own dashboard (lib/bi/morning.js;
  // who gets it: Admin → Notifications → "Morning summary (8:00)").
  cron.default.schedule(
    "0 8 * * *",
    async () => {
      try {
        const { runMorningSummaries } = await import("./lib/bi/morning.js");
        // Not runAsSystem: the figures must follow "Hide off books" like any
        // screen does (lib/prisma.js skips that filter for system jobs).
        console.log("[cron] Morning summaries sent:", await runMorningSummaries());
      } catch (error) {
        console.error("[cron] Morning summary failed:", error);
      }
    },
    { timezone: "Asia/Karachi" },
  );

  // HR attendance machines set to "sync automatically" (HR → Attendance →
  // Machines): pull new punches every 15 minutes (lib/hr/devices.js).
  // Inside its own NEXT_RUNTIME check, not just after the early return above:
  // Next replaces the check with a constant, so webpack drops this branch from
  // the edge build of this file — otherwise it tries to bundle zkteco-js
  // (net / dgram / fs) for the edge runtime and the build fails.
  if (process.env.NEXT_RUNTIME === "nodejs") {
    cron.default.schedule(
      "*/15 * * * *",
      async () => {
        try {
          const { syncAllDevices } = await import("./lib/hr/devices.js");
          const result = await runAsSystem("Attendance machine sync", syncAllDevices);
          const failed = (result.devices || []).filter((d) => !d.ok);
          if (failed.length) console.error("[cron] Attendance machine sync failed:", failed);
        } catch (error) {
          console.error("[cron] Attendance machine sync failed:", error);
        }
      },
      { timezone: "Asia/Karachi" },
    );
  }

  console.log(
    "[instrumentation] Cron jobs registered: invoice-knockoff-matching (01:30, 20:00 Asia/Karachi), monthly-sales-team-mis (1st @ 02:30 Asia/Karachi), bi-followups (every 30 min 07-21, escalations 09:00), hr-attendance-machines (every 15 min)",
  );
}
