import { NextResponse } from "next/server";
import { can } from "@/lib/auth/permissions";
import { getServerSession } from "next-auth";

import prisma from "@/lib/prisma";
import { authOptions } from "@/lib/auth";
import {
  APP_MENU_LEVEL_KEY,
  APP_MENU_THRESHOLD_KEY,
  APP_MENU_ORDER_SOURCE_KEY,
  APP_MENU_SETTINGS_PERMISSION,
  DEFAULT_APP_MENU_SETTINGS,
  LEVEL,
  ORDER_SOURCE,
  THRESHOLD_MAX,
  THRESHOLD_MIN,
  normalizeAppMenuSettings,
  normalizeThreshold,
} from "@/lib/menu/appMenuSettings";

// Kept separate from /api/settings because that route rewrites every value
// into "macno=..." form. These rows hold plain values in the same table.

export async function GET() {
  try {
    const rows = await prisma.settings.findMany({
      where: { key: {
        in: [
          APP_MENU_LEVEL_KEY,
          APP_MENU_THRESHOLD_KEY,
          APP_MENU_ORDER_SOURCE_KEY,
        ],
      } },
    });

    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));

    return NextResponse.json({
      data: normalizeAppMenuSettings({
        level: byKey[APP_MENU_LEVEL_KEY],
        autoThreshold: byKey[APP_MENU_THRESHOLD_KEY],
        orderSource: byKey[APP_MENU_ORDER_SOURCE_KEY],
      }),
      status: 200,
    });
  } catch (error) {
    console.error("Failed to read app menu settings:", error);
    // A settings outage should not take the Applications page down with it.
    return NextResponse.json({ data: DEFAULT_APP_MENU_SETTINGS, status: 200 });
  }
}

export async function PUT(request) {
  try {
    const session = await getServerSession(authOptions);

    if (!session?.user) {
      return NextResponse.json({ error: "Not signed in" }, { status: 401 });
    }

    // This setting applies to everyone, so not everyone may change it.
    if (!(await can(session, APP_MENU_SETTINGS_PERMISSION))) {
      return NextResponse.json(
        { error: "You are not allowed to change this setting" },
        { status: 403 }
      );
    }

    const body = await request.json();

    const updates = [];
    if (body.level !== undefined) {
      if (!Object.values(LEVEL).includes(body.level)) {
        return NextResponse.json({ error: "Invalid level" }, { status: 400 });
      }
      updates.push([APP_MENU_LEVEL_KEY, body.level, "Applications page: tile depth (module / sub / auto)"]);
    }

    if (body.autoThreshold !== undefined) {
      const parsed = Number.parseInt(body.autoThreshold, 10);
      if (Number.isNaN(parsed) || parsed < THRESHOLD_MIN || parsed > THRESHOLD_MAX) {
        return NextResponse.json(
          { error: `Threshold must be between ${THRESHOLD_MIN} and ${THRESHOLD_MAX}` },
          { status: 400 }
        );
      }
      updates.push([
        APP_MENU_THRESHOLD_KEY,
        String(normalizeThreshold(parsed)),
        "Applications page: show sub level when the user has fewer than this many modules",
      ]);
    }

    if (body.orderSource !== undefined) {
      if (!Object.values(ORDER_SOURCE).includes(body.orderSource)) {
        return NextResponse.json({ error: "Invalid order source" }, { status: 400 });
      }
      updates.push([
        APP_MENU_ORDER_SOURCE_KEY,
        body.orderSource,
        "Menu order: built-in list, or the order_no column on menus",
      ]);
    }

    if (updates.length === 0) {
      return NextResponse.json({ error: "Nothing to update" }, { status: 400 });
    }

    for (const [key, value, description] of updates) {
      await prisma.settings.upsert({
        where: { key },
        update: { value },
        create: { key, value, description },
      });
    }

    const rows = await prisma.settings.findMany({
      where: { key: {
        in: [
          APP_MENU_LEVEL_KEY,
          APP_MENU_THRESHOLD_KEY,
          APP_MENU_ORDER_SOURCE_KEY,
        ],
      } },
    });
    const byKey = Object.fromEntries(rows.map((r) => [r.key, r.value]));

    return NextResponse.json({
      data: normalizeAppMenuSettings({
        level: byKey[APP_MENU_LEVEL_KEY],
        autoThreshold: byKey[APP_MENU_THRESHOLD_KEY],
        orderSource: byKey[APP_MENU_ORDER_SOURCE_KEY],
      }),
      status: 200,
    });
  } catch (error) {
    console.error("Failed to update app menu settings:", error);
    return NextResponse.json(
      { error: "Failed to update setting", message: error.message },
      { status: 500 }
    );
  }
}
