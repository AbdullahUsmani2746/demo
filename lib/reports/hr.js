import { ForbiddenError } from "@/lib/auth/permissions";
import { employeeScopeWhere, hrRights } from "@/lib/hr/access";
import { canRunReport, engineColumns, HR_REPORTS, hrReportKey } from "@/lib/hr/reports/catalog";
import { runHrReport } from "@/lib/hr/reports/run";
import { feature } from "@/lib/features/server";

// ─────────────────────────────────────────────────────────────────────────────
//  HR reports on the report engine
//
//  The eleven HR reports (lib/hr/reports/catalog.js, rows from
//  lib/hr/reports/run.js) served through GET /api/reports/[reportType] under
//  the keys hrAttendanceSummary, hrLeaveRegister, … (catalog hrEngineKey).
//
//  Access — on top of report.<type>.view, checked by the route:
//    the HR right the report needs (canRunReport: attendance, leave, salary,
//    loans or payroll view), and only the employees the session works with
//    (employeeScopeWhere: departments, work locations, team).
//
//  Filters (components/Reports/config.js)
//    dateFrom / dateTo   - "range" reports; Date objects already normalised by
//                          the route, read back as local day keys
//    day                 - "day" reports, one date
//    month               - "month" reports, YYYY-MM
//    fromMonth / toMonth - "monthRange" reports, YYYY-MM
//    kind                - the report's "Show" choice
//    department          - Department id(s), comma separated
//    location            - Work location id(s), comma separated
//    q                   - employee name or number
//  Defaults and range limits stay in run.js (reportParams).
//
//  Returns { data, summary, columns }. columns is only needed by Leave taken,
//  whose columns are the leave types actually used.
// ─────────────────────────────────────────────────────────────────────────────

/** "1,4" / "all" / "" → [1, 4] / [] / []. */
const ids = (v) =>
  String(v ?? "")
    .split(",")
    .map((s) => Number(s.trim()))
    .filter((n) => Number.isInteger(n) && n > 0);

/** Date → YYYY-MM-DD by its local parts (the route set local day boundaries). */
const dayKey = (d) =>
  d instanceof Date && !isNaN(d)
    ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`
    : "";

const round2 = (n) => Math.round((Number(n) || 0) * 100) / 100;

/** Employee `where`: the session's employees, then the screen's filters. */
async function employeeWhere(session, filters) {
  const and = [await employeeScopeWhere(session)];
  const depts = ids(filters.department);
  if (depts.length) and.push({ departmentId: { in: depts } });
  const locations = ids(filters.location);
  if (locations.length) and.push({ workLocationId: { in: locations } });
  const q = String(filters.q ?? "").trim();
  if (q) {
    const words = q.split(/\s+/).map((w) => ({
      OR: [
        { firstName: { contains: w, mode: "insensitive" } },
        { middleName: { contains: w, mode: "insensitive" } },
        { surname: { contains: w, mode: "insensitive" } },
      ],
    }));
    and.push(/^\d+$/.test(q) ? { OR: [{ id: Number(q) }, { attendanceId: q }] } : { AND: words });
  }
  return { AND: and };
}

/** Engine filters → the query string run.js reads (reportParams). */
function hrSearchParams(filters) {
  const sp = new URLSearchParams();
  const set = (k, v) => v && v !== "all" && sp.set(k, v);
  set("from", dayKey(filters.dateFrom));
  set("to", dayKey(filters.dateTo));
  set("month", filters.month);
  // "day" reports: the picker's value (a date or a date string) → YYYY-MM-DD, local day
  if (filters.day) set("day", filters.day instanceof Date ? dayKey(filters.day) : dayKey(new Date(filters.day)));
  set("fromMonth", filters.fromMonth);
  set("toMonth", filters.toMonth);
  set("kind", filters.kind);
  return sp;
}

/** Run one HR report for the engine, as the signed-in person. */
export async function getHrReport(reportType, filters, session) {
  const key = hrReportKey(reportType);
  if (!key) throw Object.assign(new Error("Unknown HR report."), { status: 404 });
  if (!canRunReport(await hrRights(session), key)) {
    throw new ForbiddenError("You do not have the HR right for this report.");
  }
  if (HR_REPORTS[key].feature && !(await feature(HR_REPORTS[key].feature))) {
    throw new ForbiddenError("This report belongs to a feature that is switched off (Settings → Features).");
  }

  const out = await runHrReport(key, {
    employeeWhere: await employeeWhere(session, filters),
    searchParams: hrSearchParams(filters),
  });
  return toEngine(key, out);
}

/** runHrReport output → { data, summary, columns } for the engine. */
export function toEngine(key, out) {
  // Minutes → decimal hours, matching the "(h)" columns (engineColumns).
  const minutes = out.columns.filter((c) => c.type === "minutes").map((c) => c.key);
  const data = minutes.length
    ? out.rows.map((r) => ({ ...r, ...Object.fromEntries(minutes.map((k) => [k, round2((Number(r[k]) || 0) / 60)])) }))
    : out.rows;

  return {
    data,
    summary: { period: out.subtitle || HR_REPORTS[key].title, rows: data.length },
    columns: engineColumns(out.columns),
  };
}
