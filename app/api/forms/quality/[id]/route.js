// app/api/item-quality/[itcd]/route.js
import { NextResponse } from 'next/server';
import prisma from "@/lib/prisma";
import { guard } from "@/lib/auth/route";

// GET /api/item-quality/:itcd
export async function GET(req, { params }) {
  try {
    const { id } = params;

    if (!id) {
      return NextResponse.json({ error: "Item ID is required" }, { status: 400 });
    }

    const qualities = await prisma.item_Quality.findMany({
      where: { itcd: parseInt(id) },
      select: {
        parameter_name: true,
        quality_standard: true,
      },
      orderBy: { parameter_name: "asc" },
    });

    return NextResponse.json(qualities);
  } catch (error) {
    console.error("Error fetching item quality:", error);
    return NextResponse.json(
      { error: "Failed to fetch item quality" },
      { status: 500 }
    );
  }
}

// POST /api/item-quality/:itcd
// for updating or inserting quality parameters
export const POST = guard("qualityControl.manage", async (req, { params }) => {
  try {
    const { itcd } = params;
    const body = await req.json();

    // body will be an object like { viscosity: "10", gloss: "5", ... }
    const entries = Object.entries(body);

    // Upsert each parameter
    const results = [];
    for (const [parameter_name, quality_standard] of entries) {
      if (quality_standard && quality_standard.trim() !== "") {
        const upserted = await prisma.item_Quality.upsert({
          where: {
            itcd_parameter_name: {
              itcd: parseInt(itcd),
              parameter_name,
            },
          },
          update: { quality_standard },
          create: {
            itcd: parseInt(itcd),
            parameter_name,
            quality_standard,
          },
        });
        results.push(upserted);
      }
    }

    return NextResponse.json(results);
  } catch (error) {
    console.error("Error saving item quality:", error);
    return NextResponse.json(
      { error: "Failed to save item quality" },
      { status: 500 }
    );
  }
});
