import prisma from "@/lib/prisma";
import { getCustomerMacnos } from "@/lib/accounts/partyMacnos";
import { NextResponse } from "next/server";
import { getAccountLedger,calculateAccountLedgerSummary } from "../reports/[reportType]/route";

export function formatLetterDate(dateStr) {
    if (!dateStr) return "";
    const d = new Date(dateStr);
    if (isNaN(d.getTime())) return dateStr;
    return d.toLocaleDateString("en-US", {
        month: "long",
        day: "numeric",
        year: "numeric",
    });
}

async function getBalanceConfirmationData(filters) {
    const { asOfDate, region, customer, auditorName, auditorEmail } = filters;

    if (!asOfDate) {
        throw new Error("As of date is required");
    }

    let customerIds = [];
    if (customer) {
        if (Array.isArray(customer)) {
            customerIds = customer.map(Number);
        } else if (typeof customer === "string" && customer.includes(",")) {
            customerIds = customer.split(",").map((s) => Number(s.trim())).filter(Boolean);
        } else {
            customerIds = [Number(customer)];
        }
    }

    if (customerIds.length === 0) {
        return [];
    }

    const customerWhere = {
        acno: { in: customerIds },
        macno: { in: await getCustomerMacnos() },
    };
    if (region && region !== "all") {
        customerWhere.subCategory = region === "NORTH" ? "N" : "S";
    }

    const customers = await prisma.aCNO.findMany({
        where: customerWhere,
        select: {
            acno: true,
            acname: true,
            address: true,
            city: true,
            subCategory: true,
        },
        orderBy: { acname: "asc" },
    });

    const asOfDateStr =
        asOfDate instanceof Date
            ? asOfDate.toISOString().split("T")[0]
            : String(asOfDate).split("T")[0];

    const letters = [];
    for (const cust of customers) {
        const ledgerData = await getAccountLedger({
            account: cust.acno,
            dateFrom: "2000-01-01",
            dateTo: asOfDateStr,
        });
        const ledgerSummary = calculateAccountLedgerSummary(ledgerData);
        const balance = Number(ledgerSummary.closing) || 0;

        const addressParts = [cust.address, cust.city].filter(Boolean);

        letters.push({
            acno: cust.acno,
            customerName: cust.acname || "",
            customerAddress: addressParts.join(", "),
            region:
                cust.subCategory === "N"
                    ? "NORTH"
                    : cust.subCategory === "S"
                        ? "SOUTH"
                        : cust.subCategory || "",
            balance,
            asOfDate: asOfDateStr,
            letterDate: new Date().toISOString().split("T")[0],
            auditorName: auditorName || "",
            auditorEmail: auditorEmail || "",
        });
    }

    return letters;
}

export async function GET(request) {
    try {
        const { searchParams } = new URL(request.url);
        const asOfDate = searchParams.get("asOfDate");
        const region = searchParams.get("region");
        const customer = searchParams.get("customer");
        const auditorName = searchParams.get("auditorName");
        const auditorEmail = searchParams.get("auditorEmail");

        if (!asOfDate) {
            return NextResponse.json({ error: "As of date is required" }, { status: 400 });
        }

        const data = await getBalanceConfirmationData({
            asOfDate,
            region,
            customer,
            auditorName,
            auditorEmail,
        });

        return NextResponse.json({ data, status: 200 });
    } catch (error) {
        console.error("Balance Confirmation API error:", error);
        return NextResponse.json(
            { error: error?.message || "Failed to fetch balance confirmation data" },
            { status: 500 }
        );
    }
}
