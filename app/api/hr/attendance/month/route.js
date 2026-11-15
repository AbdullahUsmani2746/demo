// /api/hr/attendance/month — the monthly sheet.
//
//   GET ?month=YYYY-MM&department=&q=
//   → { days: [{ day, weekday, holiday }],
//       rows: [{ employee, shift, cells: [cell | null], summary }] }
// A cell is compact (144 people × 31 days): s status, i / o in / out,
// l late, e early, ot overtime, w worked minutes, r needs review, m set by hand,
// src source, k locked, sw off-day swap ({ t: WORK | OFF, d: the paired day }),
// co comp-off earned (1 / 0.5). null = not employed that day.
import { NextResponse } from "next/server";
import { employeeFilter, HR_PERMS } from "@/lib/hr/access";
import { hrRoute } from "@/lib/hr/route";
import { employeeLite, loadContext, resolveDay, shiftLite, summaryShift } from "@/lib/hr/attendance/sheet";
import { monthSummary } from "@/lib/hr/attendance/rules";
import { eachDay, hmOf, monthRange, todayKey, weekdayOf } from "@/lib/hr/time";

export const GET = hrRoute([HR_PERMS.view, HR_PERMS.mark, HR_PERMS.approve], async (req, { session }) => {
  const sp = new URL(req.url).searchParams;
  const today = todayKey();
  const range = monthRange(sp.get("month")) ?? monthRange(today.slice(0, 7));
  const ctx = await loadContext({ employeeWhere: await employeeFilter(session, sp), ...range });
  const days = eachDay(range.from, range.to);

  const rows = ctx.employees.map((emp) => {
    const resolved = days.map((d) => resolveDay(ctx, emp, d, today));
    const shift = summaryShift(ctx, emp);
    return {
      employee: employeeLite(emp),
      shift: shiftLite(shift),
      cells: resolved.map((d) =>
        d.employed
          ? {
              s: d.status,
              i: hmOf(d.check_in),
              o: hmOf(d.check_out),
              l: d.late_minutes || 0,
              e: d.early_minutes || 0,
              ot: d.overtime_minutes || 0,
              w: d.worked_minutes || 0,
              r: d.needs_review ? 1 : 0,
              m: d.status_override ? 1 : 0,
              src: d.source,
              k: d.locked ? 1 : 0,
              lt: d.leave_type_id || undefined,
              lh: d.leave_half ? 1 : undefined,
              note: d.remarks || undefined,
              sw: d.swap ? { t: d.swap.type, d: d.swap.other } : undefined,
              co: d.comp_off_earned || undefined,
            }
          : null,
      ),
      summary: monthSummary(resolved.filter((d) => d.employed), shift),
    };
  });

  return NextResponse.json({
    month: range.from.slice(0, 7),
    from: range.from,
    to: range.to,
    today,
    days: days.map((d) => {
      const h = ctx.holidayOn.get(d);
      return { day: d, weekday: weekdayOf(d), holiday: h ? { name: h.name, is_paid: h.is_paid } : null };
    }),
    rows,
  });
});
