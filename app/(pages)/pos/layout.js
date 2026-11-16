"use client";
// Point of Sale shell: one slim top bar (company, sections, cashier, shift
// state) so the till gets the whole screen. Sections follow the person's
// rights (bootstrap); on a phone they fold into a menu.
import React, { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { usePathname, useRouter } from "next/navigation";
import { useSession } from "next-auth/react";
import { BarChart3, Clock, Grid3X3, LayoutDashboard, LogOut, Menu, Package, Receipt, RotateCcw, ShoppingCart, X } from "lucide-react";
import { signOutAndForgetDevice } from "@/lib/pwa/signOut";
import { useCompany } from "@/context/CompanyContext";
import { usePosBoot } from "@/components/POS/shared";

const NAV = [
  { href: "/pos", label: "Home", icon: LayoutDashboard, exact: true },
  { href: "/pos/cart", label: "Sell", icon: ShoppingCart, right: "sell" },
  { href: "/pos/orders", label: "Receipts", icon: Receipt },
  { href: "/pos/posReturn", label: "Refund", icon: RotateCcw, right: "refund" },
  { href: "/pos/shift", label: "Shift", icon: Clock },
  { href: "/pos/reports", label: "Reports", icon: BarChart3 },
  { href: "/pos/products", label: "Products", icon: Package, right: "manage" },
  { href: "/pos/categories", label: "Categories", icon: Grid3X3, right: "manage" },
];

export default function PosLayout({ children }) {
  const pathname = usePathname() || "";
  const router = useRouter();
  const { data: session } = useSession();
  const { getCompanyLogo, company } = useCompany();
  const { data: boot } = usePosBoot();
  const [menu, setMenu] = useState(false);
  const rights = boot?.rights || {};
  const items = NAV.filter((n) => !n.right || rights[n.right] || session?.user?.superAdmin);
  const isActive = (n) => (n.exact ? pathname === n.href : pathname === n.href || pathname.startsWith(`${n.href}/`));
  const companyName = boot?.company?.company || company?.name || "Point of Sale";
  const userName = session?.user?.name || boot?.user?.name || "";
  const leave = () => {
    if (session?.user?.navMode === "all") router.push("/dashboard");
    else signOutAndForgetDevice({ callbackUrl: "/auth/signin" });
  };

  return (
    <div className="flex min-h-[100dvh] flex-col bg-background">
      <header className="sticky top-0 z-40 flex h-14 flex-shrink-0 items-center gap-2 bg-primary px-2 text-primary-foreground shadow-md sm:px-3">
        <button type="button" className="rounded-lg p-2 hover:bg-white/10 md:hidden" aria-label="Menu" onClick={() => setMenu(true)}>
          <Menu className="h-5 w-5" />
        </button>
        <Link href="/pos" className="flex min-w-0 items-center gap-2 pr-2">
          <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center overflow-hidden rounded-lg bg-white">
            <Image src={getCompanyLogo()} alt="" width={36} height={36} unoptimized className="h-8 w-8 object-contain" />
          </span>
          <span className="hidden min-w-0 leading-tight sm:block">
            <span className="block max-w-[180px] truncate text-[14px] font-bold">{companyName}</span>
            <span className="block text-[10.5px] uppercase tracking-wider text-white/70">Point of Sale</span>
          </span>
        </Link>
        <nav className="hidden min-w-0 flex-1 items-center gap-0.5 overflow-x-auto md:flex" aria-label="Point of sale">
          {items.map((n) => {
            const Icon = n.icon;
            return (
              <Link
                key={n.href}
                href={n.href}
                aria-current={isActive(n) ? "page" : undefined}
                aria-label={n.label}
                title={n.label}
                className={`flex h-10 flex-shrink-0 items-center gap-1.5 rounded-lg px-2.5 text-[13px] xl:px-3 font-semibold transition-colors ${isActive(n) ? "bg-white text-primary shadow-sm" : "text-white/85 hover:bg-white/10 hover:text-white"}`}
              >
                <Icon className="h-4 w-4" /> <span className={isActive(n) ? "inline" : "hidden xl:inline"}>{n.label}</span>
              </Link>
            );
          })}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link href="/pos/shift" className={`hidden items-center gap-1.5 rounded-full px-2.5 py-1 text-[11.5px] font-semibold sm:flex ${boot?.shift ? "bg-emerald-500/90 text-white" : "bg-white/15 text-white/85"}`}>
            <span className={`h-2 w-2 rounded-full ${boot?.shift ? "bg-white" : "bg-white/50"}`} />
            {boot?.shift ? `Shift #${boot.shift.id}` : "No shift"}
          </Link>
          <span className="hidden max-w-[140px] truncate text-[12.5px] font-medium text-white/90 lg:block" title={userName}>{userName}</span>
          <button type="button" onClick={leave} className="flex items-center gap-1.5 rounded-lg px-2.5 py-2 text-[12.5px] font-semibold text-white/90 hover:bg-white/10" title={session?.user?.navMode === "all" ? "Back to the ERP" : "Sign out"}>
            <LogOut className="h-4 w-4" />
            <span className="hidden xl:inline">{session?.user?.navMode === "all" ? "Back to ERP" : "Sign out"}</span>
          </button>
        </div>
      </header>

      {menu && (
        <div className="fixed inset-0 z-50 md:hidden" role="dialog" aria-modal="true" aria-label="Menu">
          <div className="absolute inset-0 bg-black/40" onClick={() => setMenu(false)} />
          <div className="absolute inset-y-0 left-0 flex w-72 max-w-[85vw] flex-col bg-background shadow-2xl">
            <div className="flex items-center justify-between bg-primary px-4 py-3 text-primary-foreground">
              <div className="min-w-0">
                <p className="truncate text-[15px] font-bold">{companyName}</p>
                <p className="truncate text-[12px] text-white/75">{userName}</p>
              </div>
              <button type="button" aria-label="Close menu" className="rounded-lg p-2 hover:bg-white/10" onClick={() => setMenu(false)}><X className="h-5 w-5" /></button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto p-3">
              {items.map((n) => {
                const Icon = n.icon;
                return (
                  <Link key={n.href} href={n.href} onClick={() => setMenu(false)}
                    className={`flex min-h-[48px] items-center gap-3 rounded-xl px-3 text-[15px] font-semibold ${isActive(n) ? "bg-primary text-primary-foreground" : "hover:bg-muted"}`}>
                    <Icon className="h-5 w-5" /> {n.label}
                  </Link>
                );
              })}
            </nav>
            <div className="border-t border-border p-3">
              <p className="mb-2 px-1 text-[12px] text-muted-foreground">{boot?.shift ? `Shift #${boot.shift.id} open` : "No shift open"}</p>
              <button type="button" onClick={leave} className="flex min-h-[48px] w-full items-center gap-3 rounded-xl px-3 text-[15px] font-semibold hover:bg-muted">
                <LogOut className="h-5 w-5" /> {session?.user?.navMode === "all" ? "Back to ERP" : "Sign out"}
              </button>
            </div>
          </div>
        </div>
      )}

      <main className="min-w-0 flex-1">{children}</main>
    </div>
  );
}
