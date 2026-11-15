import { withAuth } from "next-auth/middleware"
import { NextResponse } from "next/server"

export default withAuth(
  async function middleware(req) {
    const { pathname } = req.nextUrl
    const { token } = req.nextauth

    // Check if user is authenticated
    if (!token) {
      return NextResponse.redirect(new URL("/auth/signin", req.url))
    }

    // The jwt callback re-reads the user every 60s and stamps token.blocked
    // when the account has been deactivated, the employee marked inactive, or
    // (when enabled) all screens removed. Stop the request here so an already
    // signed-in user loses access within a minute rather than at token expiry.
    if (token.blocked) {
      const reason = encodeURIComponent(token.blocked)
      if (pathname.startsWith("/api")) {
        return NextResponse.json(
          { error: "Session revoked", reason: token.blocked },
          { status: 401 },
        )
      }
      return NextResponse.redirect(
        new URL(`/auth/signin?error=${reason}`, req.url),
      )
    }

    // Areas by permission, not by role name: the token carries the areas the
    // person may open (lib/auth/sessionGuard.js AREA_PERMISSIONS — e.g. /admin
    // = users / permissions / menus / settings / notifications manage), worked
    // out from their roles at sign-in and every minute after. Super Admin
    // opens everything. Inlined rather than imported: middleware runs on the
    // edge and those modules pull in Prisma.
    const roles = token?.roles ?? (token?.role ? [token.role] : [])
    const superAdmin = roles.includes("ADMIN")
    const areas = token?.areas ?? []

    if (pathname.startsWith("/admin") && !superAdmin && !areas.includes("admin")) {
      return NextResponse.redirect(new URL("/unauthorized", req.url))
    }

    // /accounting/*: every signed-in person; each page is checked against
    // their menus below and each action against their permissions.

    if (pathname.startsWith("/pos") && !superAdmin && !areas.includes("pos")) {
      return NextResponse.redirect(new URL("/unauthorized", req.url))
    }

    // Default dashboard routes
    if (pathname.startsWith("/dashboard") || pathname === "/") {
      // Allow all authenticated users to access dashboard
      if (!token) {
        return NextResponse.redirect(new URL("/auth/signin", req.url))
      }
    }

    // Bypass check-permission API to prevent authentication/recursion loops during fetch
    if (pathname === "/api/menu/check-permission") {
      return NextResponse.next()
    }

    // ✅ Custom Menu-based Permission check
    const isApiRoute = pathname.startsWith("/api") || pathname.includes("/api/")
    const isStaticFile = pathname.includes(".")
    const isPublicRoute = ["/unauthorized", "/auth/signin", "/auth/error"].includes(pathname)
    // Only Super Admin skips the check: roles that show the whole menu still
    // pass every menu, but a menu BLOCKED for them (Permissions → Menu access)
    // must not open — /api/menu/check-permission decides both.
    const isBypassedRole = superAdmin
    // /dashboard/* (My Dashboards, Follow-ups, Approvals) is open to every
    // signed-in user: each page's API decides what that person may see.
    const isOpenToAll = pathname === "/dashboard" || pathname.startsWith("/dashboard/")

    if (!isBypassedRole && !isOpenToAll && !isApiRoute && !isStaticFile && !isPublicRoute && token?.email) {
      try {
        const origin = req.nextUrl.origin
        const checkUrl = new URL(`/api/menu/check-permission`, origin)
        checkUrl.searchParams.set("email", token.email)
        checkUrl.searchParams.set("path", pathname)

        const res = await fetch(checkUrl, {
          headers: {
            cookie: req.headers.get("cookie") || "",
          },
        })
        if (res.ok) {
          const data = await res.json()
          if (data && data.authorized === false) {
            return NextResponse.redirect(new URL("/unauthorized", req.url))
          }
        }
      } catch (err) {
        console.error("❌ Middleware menu permission check failed:", err)
      }
    }

    return NextResponse.next()
  },
  {
    callbacks: {
      // Now this properly checks authentication
      authorized: ({ token }) => !!token,
    },
  }
)

export const config = {
  matcher: ["/", "/dashboard/:path*", "/admin/:path*", "/accounting/:path*", "/pos/:path*", "/api/:path*"]
}