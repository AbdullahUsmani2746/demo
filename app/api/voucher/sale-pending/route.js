import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { documentScopeWhere } from "@/lib/auth/documentScope";

// Classify errors on each sub_tran_id=1 item line of a dispatch (tran_code=6).
// Returns an empty array for free-of-cost orders (rate=0 is intentional there).
// Returns an empty array when no SO is linked (nothing to compare against).
function classifyLineErrors(transactions, soDetails, isFreeOfCost) {
  if (isFreeOfCost || !soDetails) return [];

  const errors = [];

  for (const t of transactions) {
    if (t.sub_tran_id !== 1 || !t.itcd) continue;
    const qty = Number(t.qty) || 0;
    if (qty <= 0) continue;

    const rate = Number(t.rate) || 0;
    const stRate = Number(t.st_rate) || 0;
    const soDetail = soDetails.find((d) => d.itcd === t.itcd);
    const soRate = soDetail ? Number(soDetail.rate) : null;
    const soStRate = soDetail ? (Number(soDetail.st_rate) || 0) : null;
    const itemName = t.itemDetails?.item || `Item #${t.itcd}`;

    if (!soDetail) {
      errors.push({
        line_id: t.id, itcd: t.itcd, itemName, qty,
        rate, soRate: null, stRate, soStRate: null,
        errorType: "ITEM_NOT_IN_SO",
        errorMessage: "Product not found in Sale Order",
        isFixable: false,
      });
    } else if (rate === 0) {
      errors.push({
        line_id: t.id, itcd: t.itcd, itemName, qty,
        rate: 0, soRate, stRate, soStRate,
        errorType: "RATE_ZERO",
        errorMessage:
          soRate && soRate > 0
            ? `Rate is 0 — SO has ${soRate}`
            : "Rate is 0 and SO has no rate set either",
        isFixable: soRate != null && soRate > 0,
      });
    } else if (soRate != null && Math.abs(rate - soRate) > 0.001) {
      errors.push({
        line_id: t.id, itcd: t.itcd, itemName, qty,
        rate, soRate, stRate, soStRate,
        errorType: "RATE_MISMATCH",
        errorMessage: `Dispatch rate ${rate} ≠ SO rate ${soRate}`,
        isFixable: true,
      });
    } else if (soStRate != null && soStRate > 0 && Math.abs(stRate - soStRate) > 0.001) {
      // Rate is correct but ST rate doesn't match the SO
      errors.push({
        line_id: t.id, itcd: t.itcd, itemName, qty,
        rate, soRate, stRate, soStRate,
        errorType: "ST_RATE_MISMATCH",
        errorMessage: `ST rate ${stRate}% ≠ SO ST rate ${soStRate}%`,
        isFixable: true,
      });
    }
  }

  return errors;
}

export async function GET(req) {
  try {
    const url = new URL(req.url);
    const tran_code = parseInt(url.searchParams.get("tran_code"));
    const invoice_no_null = url.searchParams.get("invoice_no_null") === "true";

    if (!tran_code) {
      return NextResponse.json({ message: "tran_code is required" }, { status: 400 });
    }

    // Data scope: only the user's own godowns' documents.
    const scopeFrags = await documentScopeWhere(await getServerSession(authOptions), tran_code);

    const raw = await prisma.transactionsMaster.findMany({
      where: {
        tran_code,
        ...(scopeFrags.length && { AND: scopeFrags }),
        OR: [
          { invoice_no: "" },
          { invoice_no: null }
        ],
        ordersSO: {
          freeOfCost: false
        }
      },
      include: {
        acno: true,
        godownDetails: true,
        godown2Details: true,
        ordersSO: {
          include: { orderDetails: true },
        },
        transactions: {
          include: {
            acnoDetails: true,
            itemDetails: true,
            godownDetails: true,
            costCenter: true,
            currencyDetails: true,
          },
        },
      },
      orderBy: { dated: "desc" },
    });

    const data = raw
      .map((record) => {
        const isFreeOfCost = record.ordersSO?.freeOfCost === true;
        const soDetails = record.ordersSO?.orderDetails ?? null;
        const lineErrors = classifyLineErrors(record.transactions, soDetails, isFreeOfCost);
        const hasRateIssue = lineErrors.length > 0;
        const isFixable = lineErrors.some((e) => e.isFixable);
        return { ...record, isFreeOfCost, lineErrors, hasRateIssue, isFixable };
      })
      .filter((record) => {
        const totalDamt = record.transactions.reduce((sum, t) => sum + (Number(t.damt) || 0), 0);
        const totalCamt = record.transactions.reduce((sum, t) => sum + (Number(t.camt) || 0), 0);
        // Keep if: has a non-zero amount, OR has line errors, OR is free-of-cost with dispatched qty
        const hasDispatchedQty = record.transactions.some(
          (t) => t.sub_tran_id === 1 && (Number(t.qty) || 0) > 0
        );
        return (totalDamt + totalCamt) !== 0 || record.hasRateIssue || (record.isFreeOfCost && hasDispatchedQty);
      });

    const rateIssueCount = data.filter((d) => d.hasRateIssue).length;

    return NextResponse.json({ data, rateIssueCount });
  } catch (error) {
    console.error("❌ Error fetching pending sales:", error);
    return NextResponse.json({ message: "Internal server error" }, { status: 500 });
  }
}
