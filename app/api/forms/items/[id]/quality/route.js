import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";

// GET all quality parameters for a specific item
export async function GET(request, { params }) {
    try {
        const itcd = parseInt((await params).id);

        const itemQuality = await prisma.item_Quality.findMany({
            where: { itcd },
            include: {
                quality_parameters: true,
            },
        });

        return NextResponse.json(itemQuality);
    } catch (error) {
        console.error("Error fetching item quality:", error);
        return NextResponse.json(
            { error: "Failed to fetch item quality", details: error.message },
            { status: 500 }
        );
    }
}

// POST/UPDATE quality parameters for an item
export const POST = guard("setup.items.manage", async (request, { params }) => {
    try {
        const itcd = parseInt((await params).id);
        const { qualityParameters } = await request.json();

        // Validate item exists
        const item = await prisma.item.findUnique({
            where: { itcd },
        });

        if (!item) {
            return NextResponse.json(
                { error: "Item not found" },
                { status: 404 }
            );
        }

        // Use transaction to ensure all operations succeed or fail together
        const result = await prisma.$transaction(async (tx) => {
            // Delete existing quality parameters for this item
            await tx.item_Quality.deleteMany({
                where: { itcd },
            });

            // Insert new quality parameters
            const createdParams = [];
            for (const param of qualityParameters) {
                // Verify parameter exists in master table
                const paramExists = await tx.quality_parameters.findUnique({
                    where: { parameter_name: param.parameter_name },
                });

                if (!paramExists) {
                    // Create parameter if it doesn't exist
                    await tx.quality_parameters.create({
                        data: {
                            parameter_name: param.parameter_name,
                        },
                    });
                }

                const created = await tx.item_Quality.create({
                    data: {
                        itcd,
                        parameter_name: param.parameter_name,
                        quality_standard: param.quality_standard,
                    },
                });

                createdParams.push(created);
            }

            return createdParams;
        });

        return NextResponse.json({
            success: true,
            message: "Quality parameters saved successfully",
            data: result,
        });
    } catch (error) {
        console.error("Error saving quality parameters:", error);
        return NextResponse.json(
            { error: "Failed to save quality parameters", details: error.message },
            { status: 500 }
        );
    }
});

// DELETE all quality parameters for an item
export const DELETE = guard("setup.items.manage", async (request, { params }) => {
    try {
        const itcd = parseInt((await params).id);

        await prisma.item_Quality.deleteMany({
            where: { itcd },
        });

        return NextResponse.json({
            success: true,
            message: "Quality parameters deleted successfully",
        });
    } catch (error) {
        console.error("Error deleting quality parameters:", error);
        return NextResponse.json(
            { error: "Failed to delete quality parameters", details: error.message },
            { status: 500 }
        );
    }
});