import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { guard } from "@/lib/auth/route";

// Fixed Asset number generation (tran_code 14). Single global running sequence
// over Transactions.asset_no. reserveAssetNumbers() is used inside the GRN save
// transaction; POST exposes it standalone.

// Fixed advisory-lock key so concurrent reservations serialize (no overlap).
const ASSET_NO_LOCK_KEY = 914140014;

// Reserve `count` consecutive asset numbers atomically. `tx` must be an
// interactive Prisma transaction client (the advisory lock is transaction-scoped).
export async function reserveAssetNumbers(tx, count) {
    if (!tx || typeof tx.$queryRaw !== "function") {
        throw new Error(
            "reserveAssetNumbers must be called with an interactive Prisma transaction client"
        );
    }

    const n = Number(count);
    if (!Number.isInteger(n) || n < 1) {
        throw new Error("reserveAssetNumbers: count must be a positive integer");
    }

    await tx.$executeRaw`SELECT pg_advisory_xact_lock(${ASSET_NO_LOCK_KEY})`;

    const rows = await tx.$queryRaw`
    SELECT COALESCE(MAX(asset_no), 0) AS max_no
    FROM "Transactions"
  `;

    const currentMax = Number(rows?.[0]?.max_no ?? 0);

    const numbers = [];
    for (let i = 1; i <= n; i++) {
        numbers.push(currentMax + i);
    }
    return numbers;
}

// POST { count?: number } -> { assetNumbers: number[] }. Standalone use.
export const POST = guard("fixedAsset.manage", async (req) => {
    try {
        const session = await getServerSession(authOptions);
        if (!session) {
            return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
        }

        let count = 1;
        try {
            const body = await req.json();
            if (body && body.count != null) count = body.count;
        } catch {
            // default to 1
        }

        const n = Number(count);
        if (!Number.isInteger(n) || n < 1) {
            return NextResponse.json(
                { error: "count must be a positive integer" },
                { status: 400 }
            );
        }

        const assetNumbers = await prisma.$transaction((tx) =>
            reserveAssetNumbers(tx, n)
        );

        return NextResponse.json({ assetNumbers });
    } catch (error) {
        console.error("Error generating asset numbers:", error);
        return NextResponse.json(
            { error: "Failed to generate asset numbers", message: error.message },
            { status: 500 }
        );
    }
});
