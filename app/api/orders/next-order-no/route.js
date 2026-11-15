import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";

/**
 * GET /api/orders/next-order-no?region=NORTH&category=6
 *
 * Returns a PREVIEW of the next order number for the given region + category.
 * This is purely a READ — it does NOT consume or increment the sequence.
 * The actual order_no is assigned by the DB trigger on INSERT.
 *
 * Query params:
 *   region    - e.g. "NORTH", "SOUTH"  (required for category 6 / sale orders)
 *   category  - 4 = purchase order, 6 = sale order  (required)
 */
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const region = searchParams.get("region");
    const category = parseInt(searchParams.get("category"), 10);

    if (!category) {
      return NextResponse.json(
        { error: "category is required" },
        { status: 400 }
      );
    }

    // Sale orders (category 6): the live database has NO order-number trigger
    // and order_region_sequences is empty — OrderMaster.order_no simply takes
    // its column default, nextval('ordermaster_order_no_seq'). So the preview
    // reads that sequence (no nextval — opening the form never burns a number).
    // Region does not affect the number; it is still accepted, and echoed back.
    if (category === 6) {
      const [row] = await prisma.$queryRawUnsafe(
        `SELECT last_value, is_called FROM public.ordermaster_order_no_seq`
      );
      // is_called = false right after SETVAL(..., false): the next nextval
      // returns last_value itself, not last_value + 1.
      const last = Number(row.last_value);

      return NextResponse.json({
        nextOrderNo: row.is_called ? last + 1 : last,
        region: region ? region.toUpperCase() : null,
        category,
      });
    }

    // Old region-based preview — order_region_sequences / the region trigger
    // from sequence.txt were never installed on the live database.
    // if (category === 6) {
    //   if (!region) {
    //     return NextResponse.json(
    //       { error: "region is required for sale orders (category 6)" },
    //       { status: 400 }
    //     );
    //   }
    //
    //   const seq = await prisma.order_region_sequences.findUnique({
    //     where: {
    //       region_category: {
    //         region: region.toUpperCase(),
    //         category,
    //       },
    //     },
    //   });
    //
    //   if (!seq) {
    //     return NextResponse.json(
    //       { error: `No sequence found for region ${region}, category ${category}` },
    //       { status: 404 }
    //     );
    //   }
    //
    //   return NextResponse.json({
    //     nextOrderNo: seq.last_no + 1,
    //     region: seq.region,
    //     category: seq.category,
    //     currentLast: seq.last_no,
    //   });
    // }

    // Purchase orders (category 4) use a DB sequence (purchase_order_seq)
    // We can read the current value of the sequence without consuming it
    if (category === 4) {
      const result = await prisma.$queryRaw`
        SELECT last_value + 1 AS next_val
        FROM purchase_order_seq
      `;

      const nextVal = result?.[0]?.next_val
        ? Number(result[0].next_val)
        : null;

      return NextResponse.json({
        nextOrderNo: nextVal,
        region: null,
        category: 4,
      });
    }

    return NextResponse.json(
      { error: `Unsupported category: ${category}` },
      { status: 400 }
    );
  } catch (error) {
    console.error("[next-order-no] Error:", error);
    return NextResponse.json(
      { error: "Failed to fetch next order number", details: error.message },
      { status: 500 }
    );
  }
}
