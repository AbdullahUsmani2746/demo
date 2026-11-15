import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { buildMenuTree } from "@/lib/menu/buildMenuTree";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { hiddenApprovalPages } from "@/lib/approvals/access";
import { blockedMenuIdsFor } from "@/lib/menu/blocks";
import {
  APP_MENU_ORDER_SOURCE_KEY,
  DEFAULT_APP_MENU_SETTINGS,
  ORDER_SOURCE,
} from "@/lib/menu/appMenuSettings";

// Which ordering rule to apply, read from Settings. Any failure falls back to
// the built-in list rather than reordering the menu unexpectedly.
async function readOrderSource() {
  try {
    const row = await prisma.settings.findUnique({
      where: { key: APP_MENU_ORDER_SOURCE_KEY },
    });
    return Object.values(ORDER_SOURCE).includes(row?.value)
      ? row.value
      : DEFAULT_APP_MENU_SETTINGS.orderSource;
  } catch (error) {
    console.error("Failed to read menu order source:", error);
    return DEFAULT_APP_MENU_SETTINGS.orderSource;
  }
}

// ✅ Recursive function to fetch all assigned + descendant menus
async function getAllMenusForEmployee(employeeId) {
  // 1️⃣ Get menus directly assigned to the employee
  const employeeMenus = await prisma.employee_menu.findMany({
    where: { employee_id: parseInt(employeeId) },
    include: { menu: true },
  });

  // Switched-off menus (menus.is_active = false) are never shown.
  let allMenus = employeeMenus.map((em) => em.menu).filter((m) => m?.is_active !== false);
  let toCheck = allMenus.map((m) => m.id);

  // 2️⃣ Keep fetching children until none left
  while (toCheck.length > 0) {
    const childMenus = await prisma.menus.findMany({
      where: { parent_id: { in: toCheck }, is_active: true },
    });

    if (childMenus.length === 0) break;

    // Add them to our list and keep going deeper
    allMenus = [...allMenus, ...childMenus];
    toCheck = childMenus.map((m) => m.id);
  }

  // 3️⃣ Add the parents of what was assigned (the parent row only, not its
  // other children), so an entry assigned on its own still sits under its
  // module — ACCOUNTS DESK > VOUCHERS — instead of floating at the top.
  const have = new Set(allMenus.map((m) => m.id));
  let parentIds = [...new Set(allMenus.map((m) => m.parent_id).filter((id) => id != null && !have.has(id)))];
  while (parentIds.length > 0) {
    const parents = await prisma.menus.findMany({ where: { id: { in: parentIds }, is_active: true } });
    parents.forEach((p) => have.add(p.id));
    allMenus = [...allMenus, ...parents];
    parentIds = [...new Set(parents.map((p) => p.parent_id).filter((id) => id != null && !have.has(id)))];
  }

  // Remove duplicates by ID
  const uniqueMenus = Array.from(new Map(allMenus.map((m) => [m.id, m])).values());
  return uniqueMenus;
}

// ✅ API Route
export async function GET(request) {
  try {
    const searchParams = request.nextUrl.searchParams;
    const employeeId = searchParams.get("employeeId");
    // The whole tree only for roles that show the whole menu (Admin → Roles).
    const session = await getServerSession(authOptions);
    const all = searchParams.get("all") === "true" && session?.user?.navMode === "all";

    let allMenus;

    if (all) {
      // Full, live menu tree — for roles with no Employee record to filter
      // permissions by (e.g. Accountant), rather than employee_menu-driven
      // filtering. Pulls directly from the same menus table buildMenuTree
      // already renders, so it can never drift from the real menu set.
      allMenus = await prisma.menus.findMany({ where: { is_active: true } });
    } else {
      if (!employeeId) {
        return NextResponse.json({ error: "Missing employeeId" }, { status: 400 });
      }

      // Get all assigned + descendant menus
      allMenus = await getAllMenusForEmployee(employeeId);
    }

    // Approval pages show only to people allowed to approve (Permissions →
    // Approvals), whatever menus they are linked to — lib/approvals/catalog.js.
    // Menus blocked for this person / role, with everything under them.
    const blocked = await blockedMenuIdsFor(session?.user);
    if (blocked.size && allMenus?.length) allMenus = allMenus.filter((m) => !blocked.has(Number(m.id)));
    const hidden = await hiddenApprovalPages(session);
    if (hidden.length && allMenus?.length) {
      allMenus = allMenus.filter((m) => !hidden.some((p) => m.url === p || String(m.url || "").startsWith(`${p}/`)));
    }

    if (!allMenus || allMenus.length === 0) {

      return NextResponse.json([]);
    }

    // Build hierarchical menu tree. The id set lets the builder tell a genuine
    // root from a menu whose parent simply is not visible to this employee.
    const availableIds = new Set(allMenus.map((m) => Number(m.id)));
    const orderSource = await readOrderSource();
    const menuTree = buildMenuTree(allMenus, null, availableIds, orderSource);

    

    return NextResponse.json(menuTree);
  } catch (error) {
    console.error("❌ Error fetching employee menus:", error);
    return NextResponse.json(
      { error: "Failed to load menus", message: error.message },
      { status: 500 }
    );
  }
}
