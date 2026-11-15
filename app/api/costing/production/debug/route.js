import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";

/**
 * GET /api/costing/production/debug?plan_id=&month=&year=
 *
 * Diagnostic endpoint — shows exactly why T7/T8 are or aren't linking.
 * Remove or protect this route before going to production.
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const planId = parseInt(searchParams.get("plan_id") || "0");
    const month  = parseInt(searchParams.get("month")  || new Date().getMonth() + 1);
    const year   = parseInt(searchParams.get("year")   || new Date().getFullYear());

    if (!planId) {
      return NextResponse.json({ error: "plan_id required" }, { status: 400 });
    }

    const startDate = new Date(year, month - 1, 1, 0, 0, 0, 0);
    const endDate   = new Date(year, month,     0, 23, 59, 59, 999);
    const planIdStr = String(planId);

    // 1. Show the plan itself
    const plan = await prisma.productionPlanMaster.findUnique({
      where:  { id: planId },
      select: { id: true, finished_id: true, qty: true, actual_yield: true, dated: true, status: true },
    });

    // 2. ALL tran_code=7 in this month — raw rmk5 values, no filter
    const allT7InMonth = await prisma.$queryRaw`
      SELECT
        tm.tran_id,
        tm.vr_no,
        tm.dated,
        tm.rmk5,
        COALESCE(tm.rmk5, '')                                                             AS rmk5_raw,
        REGEXP_REPLACE(COALESCE(tm.rmk5, ''), '[^0-9]', '', 'g')                          AS rmk5_digits,
        NULLIF(REGEXP_REPLACE(COALESCE(tm.rmk5, ''), '[^0-9]', '', 'g'), '')              AS rmk5_nullif,
        LENGTH(REGEXP_REPLACE(COALESCE(tm.rmk5, ''), '[^0-9]', '', 'g'))                  AS rmk5_digit_len,
        COUNT(t.id)::int                                                                   AS line_count
      FROM "TRANSACTIONS_MASTER" tm
      LEFT JOIN "Transactions" t ON t.tran_id = tm.tran_id
      WHERE tm.tran_code = 7
        AND tm.dated >= ${startDate}
        AND tm.dated <= ${endDate}
      GROUP BY tm.tran_id, tm.vr_no, tm.dated, tm.rmk5
      ORDER BY tm.dated DESC
      LIMIT 50
    `;

    // 3. tran_code=7 with ANY rmk5 containing the plan_id digits (loose match)
    const looseT7Match = await prisma.$queryRaw`
      SELECT
        tm.tran_id,
        tm.vr_no,
        tm.dated,
        tm.rmk5,
        tm.tran_code,
        REGEXP_REPLACE(COALESCE(tm.rmk5, ''), '[^0-9]', '', 'g') AS rmk5_digits
      FROM "TRANSACTIONS_MASTER" tm
      WHERE tm.tran_code = 7
        AND COALESCE(tm.rmk5, '') LIKE ${'%' + planIdStr + '%'}
      ORDER BY tm.dated DESC
      LIMIT 20
    `;

    // 3b. DIRECT STRING MATCH — simplest possible: rmk5 = '1000017335'
    const directStringMatch = await prisma.$queryRaw`
      SELECT
        tm.tran_id,
        tm.vr_no,
        tm.dated,
        tm.rmk5,
        tm.tran_code,
        COUNT(t.id)::int AS line_count
      FROM "TRANSACTIONS_MASTER" tm
      LEFT JOIN "Transactions" t ON t.tran_id = tm.tran_id
      WHERE tm.rmk5 = ${planIdStr}
      GROUP BY tm.tran_id, tm.vr_no, tm.dated, tm.rmk5, tm.tran_code
      ORDER BY tm.dated DESC
      LIMIT 20
    `;

    // 3c. ALL tran_codes that have rmk5 containing this plan_id (not just =7)
    const anyTranCodeWithRmk5 = await prisma.$queryRaw`
      SELECT
        tm.tran_code,
        COUNT(DISTINCT tm.tran_id)::int AS voucher_count,
        MIN(tm.dated) AS earliest,
        MAX(tm.dated) AS latest,
        string_agg(DISTINCT tm.rmk5, ', ' ORDER BY tm.rmk5) AS rmk5_values
      FROM "TRANSACTIONS_MASTER" tm
      WHERE COALESCE(tm.rmk5, '') LIKE ${'%' + planIdStr + '%'}
      GROUP BY tm.tran_code
      ORDER BY tm.tran_code
    `;

    // 4. Exact integer match (the actual query we use)
    const exactT7Match = await prisma.$queryRaw`
      SELECT
        tm.tran_id,
        tm.vr_no,
        tm.dated,
        tm.rmk5,
        COUNT(t.id)::int AS line_count
      FROM "TRANSACTIONS_MASTER" tm
      LEFT JOIN "Transactions" t ON t.tran_id = tm.tran_id
      WHERE tm.tran_code = 7
        AND NULLIF(REGEXP_REPLACE(COALESCE(tm.rmk5, ''), '[^0-9]', '', 'g'), '')::integer = ${planId}
      GROUP BY tm.tran_id, tm.vr_no, tm.dated, tm.rmk5
      ORDER BY tm.dated DESC
    `;

    // 5. Same exact match but WITH date range
    const exactT7MatchWithDate = await prisma.$queryRaw`
      SELECT
        tm.tran_id,
        tm.vr_no,
        tm.dated,
        tm.rmk5,
        COUNT(t.id)::int AS line_count
      FROM "TRANSACTIONS_MASTER" tm
      LEFT JOIN "Transactions" t ON t.tran_id = tm.tran_id
      WHERE tm.tran_code = 7
        AND tm.dated >= ${startDate}
        AND tm.dated <= ${endDate}
        AND NULLIF(REGEXP_REPLACE(COALESCE(tm.rmk5, ''), '[^0-9]', '', 'g'), '')::integer = ${planId}
      GROUP BY tm.tran_id, tm.vr_no, tm.dated, tm.rmk5
      ORDER BY tm.dated DESC
    `;

    // 6. Check sub_tran_id values on matched T7 lines
    const subTranCheck = await prisma.$queryRaw`
      SELECT
        t.sub_tran_id,
        COUNT(*)::int AS cnt,
        SUM(t.qty) AS total_qty
      FROM "TRANSACTIONS_MASTER" tm
      JOIN "Transactions" t ON t.tran_id = tm.tran_id
      WHERE tm.tran_code = 7
        AND NULLIF(REGEXP_REPLACE(COALESCE(tm.rmk5, ''), '[^0-9]', '', 'g'), '')::integer = ${planId}
      GROUP BY t.sub_tran_id
    `;

    // 7. Show ACTUAL Transactions lines for matched T7 vouchers
    //    — reveals whether itcd is set, qty values, sub_tran_id
    const t7Lines = await prisma.$queryRaw`
      SELECT
        t.id,
        t.tran_id,
        t.itcd,
        t.qty,
        t.damt,
        t.camt,
        t.sub_tran_id,
        t.godown,
        i.item AS item_name,
        i.code AS item_code
      FROM "TRANSACTIONS_MASTER" tm
      JOIN "Transactions" t ON t.tran_id = tm.tran_id
      LEFT JOIN "Item" i ON i.itcd = t.itcd
      WHERE tm.tran_code = 7
        AND tm.dated >= ${startDate}
        AND tm.dated <= ${endDate}
        AND NULLIF(REGEXP_REPLACE(COALESCE(tm.rmk5, ''), '[^0-9]', '', 'g'), '')::integer = ${planId}
      ORDER BY t.id
    `;

    // 8. Run the EXACT same query as getActualIssuances / plan-activity T7
    //    (sub_tran_id = 1, qty > 0 — WITHOUT itcd IS NOT NULL so we can see what's there)
    const exactT7QueryResult = await prisma.$queryRaw`
      SELECT
        t.itcd,
        i.item AS item_name,
        t.sub_tran_id,
        SUM(t.qty) AS total_qty,
        COUNT(*)::int AS line_count
      FROM "TRANSACTIONS_MASTER" tm
      JOIN "Transactions" t ON t.tran_id = tm.tran_id
      LEFT JOIN "Item" i ON i.itcd = t.itcd
      WHERE tm.tran_code = 7
        AND tm.dated >= ${startDate}
        AND tm.dated <= ${endDate}
        AND NULLIF(REGEXP_REPLACE(COALESCE(tm.rmk5, ''), '[^0-9]', '', 'g'), '')::integer = ${planId}
        AND t.sub_tran_id = 1
        AND t.qty > 0
      GROUP BY t.itcd, i.item, t.sub_tran_id
      ORDER BY total_qty DESC
    `;

    return NextResponse.json({
      debug_for:    { plan_id: planId, month, year },
      date_range:   { from: startDate, to: endDate },
      plan,

      // How many T7 vouchers exist in this month at all
      t7_in_month_count:   allT7InMonth.length,
      t7_in_month_sample:  allT7InMonth.slice(0, 10).map(r => ({
        tran_id:        Number(r.tran_id),
        vr_no:          r.vr_no != null ? Number(r.vr_no) : null,
        dated:          r.dated,
        rmk5_raw:       r.rmk5_raw,
        rmk5_digits:    r.rmk5_digits,
        rmk5_nullif:    r.rmk5_nullif,
        rmk5_digit_len: Number(r.rmk5_digit_len),
        line_count:     Number(r.line_count),
      })),

      // Loose LIKE match (does rmk5 contain the plan_id at all?)
      loose_match_count:  looseT7Match.length,
      loose_match:        looseT7Match.map(r => ({
        tran_id:     Number(r.tran_id),
        vr_no:       r.vr_no != null ? Number(r.vr_no) : null,
        dated:       r.dated,
        rmk5:        r.rmk5,
        tran_code:   r.tran_code,
        rmk5_digits: r.rmk5_digits,
      })),

      // DIRECT string match: WHERE rmk5 = '1000017335' (any tran_code)
      direct_string_match_count: directStringMatch.length,
      direct_string_match: directStringMatch.map(r => ({
        tran_id:    Number(r.tran_id),
        vr_no:      r.vr_no != null ? Number(r.vr_no) : null,
        dated:      r.dated,
        rmk5:       r.rmk5,
        tran_code:  r.tran_code,
        line_count: Number(r.line_count),
      })),

      // ALL tran_codes that have rmk5 = this plan_id (tells you which codes store it)
      any_tran_code_with_rmk5: anyTranCodeWithRmk5.map(r => ({
        tran_code:     r.tran_code,
        voucher_count: Number(r.voucher_count),
        earliest:      r.earliest,
        latest:        r.latest,
        rmk5_values:   r.rmk5_values,
      })),

      // Exact integer match (no date filter)
      exact_match_no_date_count: exactT7Match.length,
      exact_match_no_date:       exactT7Match.map(r => ({
        tran_id:    Number(r.tran_id),
        vr_no:      r.vr_no != null ? Number(r.vr_no) : null,
        dated:      r.dated,
        rmk5:       r.rmk5,
        line_count: Number(r.line_count),
      })),

      // Exact integer match WITH date filter
      exact_match_with_date_count: exactT7MatchWithDate.length,
      exact_match_with_date:       exactT7MatchWithDate.map(r => ({
        tran_id:    Number(r.tran_id),
        vr_no:      r.vr_no != null ? Number(r.vr_no) : null,
        dated:      r.dated,
        rmk5:       r.rmk5,
        line_count: Number(r.line_count),
      })),

      // sub_tran_id breakdown on matched rows
      sub_tran_id_breakdown: subTranCheck.map(r => ({
        sub_tran_id: r.sub_tran_id,
        count:       Number(r.cnt),
        total_qty:   Number(r.total_qty || 0),
      })),

      // ── NEW: Actual T7 transaction lines (the most diagnostic) ──
      // Shows each Transactions row: itcd, qty, sub_tran_id, item name
      t7_lines: t7Lines.map(r => ({
        id:          Number(r.id),
        tran_id:     Number(r.tran_id),
        itcd:        r.itcd != null ? Number(r.itcd) : null,   // NULL means no item linked!
        qty:         r.qty  != null ? Number(r.qty)  : null,
        damt:        r.damt != null ? Number(r.damt) : null,
        camt:        r.camt != null ? Number(r.camt) : null,
        sub_tran_id: r.sub_tran_id,
        godown:      r.godown != null ? Number(r.godown) : null,
        item_name:   r.item_name || null,
        item_code:   r.item_code || null,
      })),

      // ── Exact query result (what the costing engine will actually find) ──
      exact_query_result: exactT7QueryResult.map(r => ({
        itcd:       r.itcd != null ? Number(r.itcd) : null,
        item_name:  r.item_name || "(no item record)",
        sub_tran_id: r.sub_tran_id,
        total_qty:  Number(r.total_qty || 0),
        line_count: Number(r.line_count),
      })),
      exact_query_row_count: exactT7QueryResult.length,
    });
  } catch (error) {
    console.error("Production debug error:", error);
    return NextResponse.json({ error: error.message }, { status: 500 });
  }
}
