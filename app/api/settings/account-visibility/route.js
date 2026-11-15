import prisma from "@/lib/prisma";
import { NextResponse } from "next/server";
import { guard } from "@/lib/auth/route";

// Global, database-persisted switch for whether off (inactive) accounts are
// revealed on the Chart of Accounts management page. This never affects
// transaction/voucher account pickers — those always hide off accounts and
// never read this setting.
const SETTING_KEY = "show_off_accounts";

export async function GET() {
  try {
    const setting = await prisma.settings.findUnique({
      where: { key: SETTING_KEY },
    });

    return NextResponse.json({
      data: { showOffAccounts: setting?.value === "true" },
      status: 200,
    });
  } catch (error) {
    console.error("Failed to fetch account visibility setting:", error);
    return NextResponse.json(
      { error: "Failed to fetch account visibility setting" },
      { status: 500 }
    );
  }
}

export const PUT = guard("settings.manage", async (request) => {
  try {
    const { showOffAccounts } = await request.json();

    if (typeof showOffAccounts !== "boolean") {
      return NextResponse.json(
        { error: "showOffAccounts (boolean) is required" },
        { status: 400 }
      );
    }

    const setting = await prisma.settings.upsert({
      where: { key: SETTING_KEY },
      update: { value: String(showOffAccounts) },
      create: {
        key: SETTING_KEY,
        value: String(showOffAccounts),
        description: "Whether off (inactive) accounts are shown on the Chart of Accounts page",
      },
    });

    return NextResponse.json({
      data: { showOffAccounts: setting.value === "true" },
      status: 200,
    });
  } catch (error) {
    console.error("Failed to update account visibility setting:", error);
    return NextResponse.json(
      { error: "Failed to update account visibility setting" },
      { status: 500 }
    );
  }
});
