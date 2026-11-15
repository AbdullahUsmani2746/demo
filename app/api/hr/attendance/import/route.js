// /api/hr/attendance/import — punches from a file (any machine's export).
//
//   POST { file_name, rows: [{ code, time }] }
//     code  the user id on the machine (or the employee id)
//     time  "YYYY-MM-DD HH:MM[:SS]" — Karachi time, as the machine printed it
// The screen reads the Excel / CSV and maps its columns; this stores the
// punches (duplicates ignored) and rebuilds the days they touch.
import { NextResponse } from "next/server";
import { HR_PERMS } from "@/lib/hr/access";
import { hrRoute, jsonBody } from "@/lib/hr/route";
import { ingestPunches } from "@/lib/hr/attendance/save";
import { instantFromWall } from "@/lib/hr/time";

const TIME_RE = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{1,2}):(\d{2})(?::(\d{2}))?$/;

export const POST = hrRoute([HR_PERMS.import], async (req, { session }) => {
  const body = await jsonBody(req);
  const rows = Array.isArray(body.rows) ? body.rows : [];
  if (!rows.length) return NextResponse.json({ error: "The file has no rows to import." }, { status: 400 });
  if (rows.length > 50000) return NextResponse.json({ error: "At most 50,000 punches per file — split it." }, { status: 400 });

  const punches = [];
  const bad = [];
  rows.forEach((r, i) => {
    const code = String(r?.code ?? "").trim();
    const m = TIME_RE.exec(String(r?.time ?? "").trim());
    const parts = m ? m.slice(1).map((v) => Number(v ?? 0)) : null;
    const valid =
      code &&
      code.length <= 30 &&
      parts &&
      parts[1] >= 1 && parts[1] <= 12 && parts[2] >= 1 && parts[2] <= 31 && parts[3] <= 23 && parts[4] <= 59 && parts[5] <= 59;
    if (!valid) {
      if (bad.length < 10) bad.push(i + 1);
      return;
    }
    punches.push({ device_user_id: code, punch_time: instantFromWall(...parts) });
  });
  if (!punches.length) {
    return NextResponse.json({ error: `No usable rows — check the code and date-time columns (rows ${bad.join(", ")}).` }, { status: 400 });
  }
  const future = punches.filter((p) => p.punch_time > new Date());
  if (future.length) return NextResponse.json({ error: `${future.length} punch(es) are in the future — check the date column.` }, { status: 400 });

  const batch = `import-${Date.now()}`;
  const result = await ingestPunches({ punches, source: "IMPORT", batch, actor: session.user.id });
  return NextResponse.json({
    ...result,
    skippedRows: rows.length - punches.length,
    badRows: bad,
    message:
      `${result.inserted} new punch(es) of ${punches.length} · ${result.days} day(s) updated` +
      (result.unmapped ? ` · ${result.unmapped} machine id(s) not matched to an employee (map them under Machines)` : "") +
      (result.skippedManual ? ` · ${result.skippedManual} day(s) kept as corrected by hand` : ""),
  });
});
