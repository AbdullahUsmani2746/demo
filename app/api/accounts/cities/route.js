import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { getAccountGroups } from "@/lib/accounts/accountSettings";

// Returns distinct cities from customer accounts. `group` (account groups from
// Finance → Account Settings, e.g. ?group=customers) and / or `macno` accept
// comma-separated lists; with neither, every customer group is used.
export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const macnoParam = searchParams.get("macno") || "";
    const groupKeys = (searchParams.get("group") || "")
      .split(",")
      .map((g) => g.trim())
      .filter(Boolean);
    if (!macnoParam && !groupKeys.length) groupKeys.push("customers");
    const macnos = [
      ...new Set([
        ...macnoParam
          .split(",")
          .map((m) => parseInt(m.trim(), 10))
          .filter((m) => !Number.isNaN(m)),
        ...(groupKeys.length ? await getAccountGroups(groupKeys) : []),
      ]),
    ];

    const results = await prisma.aCNO.findMany({
      where: {
        macno: { in: macnos },
        city: { not: null, notIn: ["", "null"] },
      },
      select: { city: true },
      distinct: ["city"],
      orderBy: { city: "asc" },
    });

    const cities = results
      .map((r) => r.city?.trim())
      .filter(Boolean)
      .sort();

    const data = cities.map((city) => ({ city }));

    return NextResponse.json({ data, total: data.length });
  } catch (error) {
    console.error("Error fetching cities:", error);
    return NextResponse.json(
      { error: "Failed to fetch cities" },
      { status: 500 }
    );
  }
}
