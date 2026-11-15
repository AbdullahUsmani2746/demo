import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { invoicingRoute } from "@/lib/invoicing/route";
import { nextInvoiceNo } from "@/lib/invoicing/core";
import { kindConfig } from "@/lib/invoicing/kinds";

// GET /api/invoicing/[kind]/next-number → { next }
// A preview: the generate route allocates under a lock and may hand out a
// later number if someone invoices first.
export const GET = invoicingRoute("view", async (req, { kind }) => {
  const next = await nextInvoiceNo(prisma, kindConfig(kind).tran_code);
  return NextResponse.json({ next });
});
