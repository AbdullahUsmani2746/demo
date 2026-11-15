import { NextResponse } from "next/server";
import prisma from "@/lib/prisma";
import { isPathBlocked } from "@/lib/menu/blocks";
import { navModeFor, userRoleCodes } from "@/lib/auth/roleCatalog";

// Recursive function to fetch all assigned + descendant menus
async function getAllMenusForEmployee(employeeId) {
  // Get menus directly assigned to the employee
  const employeeMenus = await prisma.employee_menu.findMany({
    where: { employee_id: parseInt(employeeId) },
    include: { menu: true },
  });

  let allMenus = employeeMenus.map((em) => em.menu);
  let toCheck = allMenus.map((m) => m.id);

  // Keep fetching children until none left
  while (toCheck.length > 0) {
    const childMenus = await prisma.menus.findMany({
      where: { parent_id: { in: toCheck } },
    });

    if (childMenus.length === 0) break;

    // Add them to our list and keep going deeper
    allMenus = [...allMenus, ...childMenus];
    toCheck = childMenus.map((m) => m.id);
  }

  // Remove duplicates by ID
  const uniqueMenus = Array.from(new Map(allMenus.map((m) => [m.id, m])).values());
  return uniqueMenus;
}

const normalizeUrl = (url) => {
  if (!url || url === "#") return "";
  // Strip query parameters and trailing slash
  return url.split("?")[0].replace(/\/$/, "").toLowerCase();
};

export async function GET(request) {
  try {
    const { searchParams } = new URL(request.url);
    const email = searchParams.get("email");
    const path = searchParams.get("path");

    if (!email || !path) {
      return NextResponse.json({ authorized: false, reason: "Missing parameters" }, { status: 400 });
    }

    // Get user from DB
    const user = await prisma.user.findUnique({
      where: { email },
    });

    if (!user) {
      return NextResponse.json({ authorized: false, reason: "User not found" });
    }

    // A menu blocked for this person or their role (Permissions → Menu access)
    // is refused to everyone but ADMIN — before any bypass below.
    // A failed look-up (e.g. the MenuBlock table not created yet) must not
    // take every page check down with it — logged, and treated as not blocked.
    const roles = await userRoleCodes(user.id, user.role);
    let blocked = false;
    try {
      blocked = await isPathBlocked({ ...user, roles }, path);
    } catch (e) {
      console.error("[check-permission] menu block look-up failed:", e);
    }
    if (blocked) {
      return NextResponse.json({ authorized: false, reason: "Blocked for you (Permissions → Menu access)" });
    }

    // The Approvals inbox is open to every signed-in user: each list on it is
    // limited to the person's own share by /api/approvals/requests.
    if (normalizeUrl(path) === "/dashboard/approvals") {
      return NextResponse.json({ authorized: true });
    }

    // Roles that show the whole menu (Super Admin, management — Admin → Roles)
    // open every page that is not blocked for them.
    if ((await navModeFor(roles)) === "all") {
      return NextResponse.json({ authorized: true });
    }

    // Normalize requested path
    const normalizedPath = normalizeUrl(path);

    // Get all active menus with URLs from DB
    const allDbMenus = await prisma.menus.findMany({
      where: {
        is_active: true,
        url: { not: null },
      },
    });

    // Find if the requested path is a restricted menu
    const matchingRestrictedMenus = allDbMenus.filter((m) => {
      const normMenuUrl = normalizeUrl(m.url);
      return normMenuUrl && normMenuUrl === normalizedPath;
    });

    // If the URL is not managed/restricted by any active menu, allow access
    if (matchingRestrictedMenus.length === 0) {
      return NextResponse.json({ authorized: true });
    }

    // Find employee using email
    const employee = await prisma.employee.findUnique({
      where: { emailAddress: email },
    });

    if (!employee) {
      // User is not Admin and has no Employee profile linked, so they cannot access restricted menus
      return NextResponse.json({ authorized: false, reason: "Employee profile not found" });
    }

    // Get all assigned and descendant menus for this employee
    const allowedMenus = await getAllMenusForEmployee(employee.id);

    // Check if any of the matched restricted menus are allowed for this employee (by ID or normalized URL)
    const hasAccess = matchingRestrictedMenus.some((restrictedMenu) =>
      allowedMenus.some((allowedMenu) => {
        if (allowedMenu.id === restrictedMenu.id) return true;
        const normAllowed = normalizeUrl(allowedMenu.url);
        const normRestricted = normalizeUrl(restrictedMenu.url);
        return normAllowed && normRestricted && normAllowed === normRestricted;
      })
    );

    return NextResponse.json({ authorized: hasAccess });
  } catch (error) {
    console.error(" Error in check-permission route:", error);
    return NextResponse.json(
      { authorized: false, error: "Internal server error", message: error.message },
      { status: 500 }
    );
  }
}
