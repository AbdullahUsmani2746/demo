import { generateMonthlyOpeningStock } from "@/lib/openingStockGenerate";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";

// POST /api/opening-stock/calculate  { month, year }
// month/year = the month whose OPENING you want. It is derived from the
// closing of the previous month (same code path as locking a period).
export const POST = guard("openingStock.calculate", async (request, { session }) => {
  try {
    const { month, year } = await request.json();

    if (!month || !year) {
      return NextResponse.json({ error: "Month and year are required" }, { status: 400 });
    }

    const prevMonth = month === 1 ? 12 : month - 1;
    const prevYear = month === 1 ? year - 1 : year;

    const result = await generateMonthlyOpeningStock(prevMonth, prevYear);

    return NextResponse.json({
      success: true,
      message: `Generated opening stock for ${month}/${year} from ${prevMonth}/${prevYear} closing`,
      count: result.rates,
      ...result,
    });
  } catch (error) {
    console.error("Opening stock calculate error:", error);
    return NextResponse.json({ error: "Failed to calculate opening stock" }, { status: 500 });
  }
});
