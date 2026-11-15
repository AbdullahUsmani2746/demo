import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";

export async function GET() {
  try {
    // Per-user saved report orders (reportAccountOrder:<report>:<user>) and
    // report Display settings (reportDisplay:<user>) are private to their
    // owner — not part of the company settings list.
    const settings = await prisma.settings.findMany({
      where: {
        AND: [
          { NOT: { key: { startsWith: "reportAccountOrder:" } } },
          { NOT: { key: { startsWith: "reportDisplay:" } } },
        ],
      },
    });

    // Backend pe data format karo
    const formattedSettings = settings.map((setting) => {
      let extractedMacnoValue = "";
      let macnoValue ;

      // Value se macno extract karo
      if (setting.value) {
        const match = setting.value.match(/(?:macno|excludeMacno)=(.+)/i);
        if (match) {
          extractedMacnoValue = match[1]; // "27" ya "003,004"
        }
      }

      const trimmedMacnoValue = extractedMacnoValue.trim();
      

      // Agar multiple macno hain, to unhe array mein convert karo

      if (trimmedMacnoValue.includes(",")) {
        macnoValue = trimmedMacnoValue
          .split(",")
          .map((item) => parseInt(item.trim()))
          .filter((num) => !isNaN(num)); // sirf valid numbers rakhega
      } else {
        const num = parseInt(trimmedMacnoValue.trim());
        if (!isNaN(num)) macnoValue = [num];
      }

      return {
        ...setting,
        macnoValue: macnoValue, // Frontend ke liye ready value
      };
    });

    return NextResponse.json({ data: formattedSettings, status: 200 });
  } catch (error) {
    console.error(error);
    return NextResponse.json(
      { error: "Failed to fetch Settings" },
      { status: 500 }
    );
  }
}

export const POST = guard("settings.manage", async (request) => {
  try {
    const body = await request.json();
    const { key, macnoValue, description, exclude } = body;

    if (!key) {
      return NextResponse.json({ error: "key is required" }, { status: 400 });
    }

    // Backend pe value format karo
    let formattedValue = "";
    if (macnoValue) {
      const prefix = exclude ? "excludeMacno" : "macno";
      formattedValue = `${prefix}=${macnoValue}`;
    }

    const newSetting = await prisma.settings.create({
      data: {
        key,
        value: formattedValue,
        description,
        exclude: exclude ?? false,
      },
    });

    return NextResponse.json({ data: newSetting, status: 201 });
  } catch (error) {
    if (error.code === "P2002") {
      return NextResponse.json(
        { error: "Key must be unique" },
        { status: 400 }
      );
    }

    return NextResponse.json(
      { error: "Failed to create Setting" },
      { status: 500 }
    );
  }
});

export const PUT = guard("settings.manage", async (request) => {
  try {
    const body = await request.json();
    const { id, key, macnoValue, description, exclude } = body;

    if (!id) {
      return NextResponse.json(
        { error: "id is required to update setting" },
        { status: 400 }
      );
    }

    // Backend pe value format karo
    let formattedValue = "";
    if (macnoValue) {
      const prefix = exclude ? "excludeMacno" : "macno";
      formattedValue = `${prefix}=${macnoValue}`;
    }

    

    const updatedSetting = await prisma.settings.update({
      where: { id: Number(id) },
      data: {
        key,
        value: formattedValue,
        description,
        exclude,
      },
    });

    return NextResponse.json({ data: updatedSetting, status: 200 });
  } catch (error) {
    if (error.code === "P2025") {
      return NextResponse.json({ error: "Setting not found" }, { status: 404 });
    }

    return NextResponse.json(
      { error: "Failed to update Setting" },
      { status: 500 }
    );
  }
});
