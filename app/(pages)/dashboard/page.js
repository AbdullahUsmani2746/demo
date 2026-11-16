// app/dashboard/page.js
// The landing page after sign-in. Everyone is sent on to their own home
// (lib/client-helpers.js homeFor); this list shows only while that happens or
// when there is nowhere else to go.
"use client"

import { useSession } from "next-auth/react"
import { useRouter } from "next/navigation"
import { useEffect } from "react"
import Link from "next/link"
import { ArrowRight, Calculator, Home, LayoutDashboard, Loader2, Store, Users } from "lucide-react"
import { homeFor } from "@/lib/client-helpers"
import { useRoles } from "@/hooks/useRoles"

const WORKSPACES = [
  {
    href: "/pos",
    area: "pos",
    icon: Store,
    title: "Point of Sale",
    description: "Ring up sales and see today's transactions",
    cta: "Open POS",
  },
  {
    href: "/accounting", // dashboard or the Applications launcher (app/(pages)/accounting/page.js)
    area: null,
    icon: Calculator,
    title: "Accounting",
    description: "Vouchers, reports and the business dashboard",
    cta: "Open Accounting",
  },
  {
    href: "/admin/dashboard",
    area: "admin",
    icon: Users,
    title: "Admin Panel",
    description: "Users, permissions and system settings",
    cta: "Open Admin Panel",
  },
]

export default function Dashboard() {
  const { data: session, status } = useSession()
  const router = useRouter()
  const { roleName } = useRoles()

  useEffect(() => {
    if (status === "authenticated" && session?.user) {
      const redirectUrl = homeFor(session.user)
      if (redirectUrl !== "/dashboard") {
        router.push(redirectUrl)
      }
    }
  }, [session, status, router])

  const user = session?.user
  const leaving = status === "authenticated" && user && homeFor(user) !== "/dashboard"

  if (status === "loading" || leaving) {
    return (
      <div className="flex min-h-[60vh] items-center justify-center bg-muted/40">
        <div className="flex items-center gap-3 rounded-xl border border-border bg-background px-5 py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
          {leaving ? "Opening your workspace…" : "Loading…"}
        </div>
      </div>
    )
  }

  const areas = user?.areas || []
  const workspaces = WORKSPACES.filter((w) => !w.area || user?.superAdmin || areas.includes(w.area))

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto max-w-[1600px] px-3 py-5 sm:px-6">
        {/* Header */}
        <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20">
              <Home className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] text-muted-foreground">Home</p>
              <h1 className="truncate text-2xl font-bold tracking-tight text-foreground">
                Welcome back{session?.user?.name ? `, ${session.user.name}` : ""}
              </h1>
              {user?.role && (
                <p className="text-sm text-muted-foreground">
                  Signed in as <span className="font-medium text-foreground">{roleName(user.role)}</span>
                </p>
              )}
            </div>
          </div>
          <Link
            href="/dashboard/insights"
            className="inline-flex h-10 items-center gap-2 rounded-md border border-border bg-background px-4 text-sm font-medium text-foreground transition-colors hover:border-primary/40 hover:text-primary"
          >
            <LayoutDashboard className="h-4 w-4" />
            My Dashboards
          </Link>
        </div>

        {workspaces.length > 0 ? (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {workspaces.map((w) => {
              const Icon = w.icon
              return (
                <Link
                  key={w.href}
                  href={w.href}
                  className="group flex flex-col rounded-xl border border-border bg-background p-4 transition-colors hover:border-primary/40 hover:bg-primary/[0.03]"
                >
                  <div className="flex items-start gap-3">
                    <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="h-5 w-5" />
                    </span>
                    <div className="min-w-0">
                      <h2 className="text-base font-semibold text-foreground group-hover:text-primary">{w.title}</h2>
                      <p className="mt-0.5 text-sm text-muted-foreground">{w.description}</p>
                    </div>
                  </div>
                  <span className="mt-4 inline-flex items-center gap-1.5 text-sm font-medium text-primary">
                    {w.cta}
                    <ArrowRight className="h-4 w-4 transition-transform group-hover:translate-x-0.5" />
                  </span>
                </Link>
              )
            })}
          </div>
        ) : (
          <div className="mx-auto max-w-md rounded-xl border border-border bg-background px-6 py-12 text-center">
            <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Home className="h-5 w-5" />
            </span>
            <h2 className="text-lg font-semibold text-foreground">Nothing to open here yet</h2>
            <p className="mt-1.5 text-sm text-muted-foreground">
              Use the menu to reach your screens, or ask your administrator for access.
            </p>
          </div>
        )}
      </div>
    </div>
  )
}
