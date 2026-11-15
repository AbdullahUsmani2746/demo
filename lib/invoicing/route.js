// lib/invoicing/route.js — shared bits of the /api/invoicing/[kind] handlers.
import { NextResponse } from "next/server";
import { guardBy } from "@/lib/auth/route";
import { kindConfig, invoicingPermission } from "@/lib/invoicing/kinds";
import { InvoicingError } from "@/lib/invoicing/core";

/**
 * guardBy() with invoicing.<kind>.<action>. An unknown kind still needs a
 * permission nobody holds (full-access roles pass and then get the 400).
 */
export function invoicingRoute(action, handler) {
  return guardBy(
    async (req, { params }) => invoicingPermission((await params).kind, action),
    async (req, ctx) => {
      const { kind } = await ctx.params;
      if (!kindConfig(kind)) {
        return NextResponse.json(
          { message: `Unknown invoicing kind "${kind}" — use sale, sale-return, purchase or purchase-return` },
          { status: 400 },
        );
      }
      try {
        return await handler(req, { ...ctx, kind });
      } catch (error) {
        if (error instanceof InvoicingError) {
          return NextResponse.json({ message: error.message }, { status: error.status });
        }
        console.error(`invoicing ${kind} ${action} error:`, error);
        return NextResponse.json(
          { message: "Invoicing request failed", error: error?.message ?? String(error) },
          { status: 500 },
        );
      }
    },
  );
}
