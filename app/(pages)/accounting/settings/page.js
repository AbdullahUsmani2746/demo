"use client";
// Accounting → Settings. A side list of sections (tabs across the top on a
// phone); the open section is kept in the address (?tab=…) so a link can open
// it directly. "More settings" links to the settings that have their own page.
import React, { useEffect, useState } from "react";
import Link from "next/link";
import { useSession } from "next-auth/react";
import CurrencySettings from "@/components/Settings/CurrencySettings";
import CompanySettings from "@/components/Settings/CompanySettings";
import NotificationSettings from "@/components/Settings/NotificationSettings";
import StockCheckSettings from "@/components/Settings/StockCheckSettings";
import FeatureSettings from "@/components/Settings/FeatureSettings";
import ProductionSetupSettings from "@/components/Settings/ProductionSetupSettings";
import FixedAssetSettings from "@/components/Settings/FixedAssetSettings";
import PosSettings from "@/components/Settings/PosSettings";
import { ArrowUpRight, Bell, Boxes, Building, Building2, DollarSign, Factory, Landmark, ListTree, Lock, Settings2, ShieldCheck, Store, ToggleRight, UserCheck, UserCog, Users } from "lucide-react";

// MACNO groups are set on Account settings (its Parties / Vouchers sections),
// so they are not a section here.
const TABS = [
  { id: "company", label: "Company", icon: Building, description: "Name, logo, address and tax details", Component: CompanySettings },
  { id: "currency", label: "Currency", icon: DollarSign, description: "The currency every amount is shown in", Component: CurrencySettings },
  { id: "notifications", label: "Notifications", icon: Bell, description: "Who receives which alerts", Component: NotificationSettings },
  { id: "features", label: "Features", icon: ToggleRight, description: "Switch business flows on or off", Component: FeatureSettings },
  { id: "stock", label: "Stock checking", icon: Boxes, description: "No check, warn or block short stock", Component: StockCheckSettings },
  { id: "production", label: "Production setup", icon: Factory, description: "Item category kinds and production godowns", Component: ProductionSetupSettings },
  { id: "fixedAssets", label: "Fixed assets", icon: Building2, description: "Depreciation rules, category defaults and accounts", Component: FixedAssetSettings },
  { id: "pos", label: "Point of Sale", icon: Store, description: "Till godown, walk-in account, tax, rounding, receipt", Component: PosSettings },
];

const LINKS = [
  { href: "/accounting/settings/accounts", label: "Account settings", icon: Landmark, description: "Posting accounts and MACNO groups" },
  { href: "/accounting/menu", label: "Menus", icon: ListTree, description: "The sidebar menu tree" },
  { href: "/accounting/employee-menus", label: "Employee menus", icon: UserCheck, description: "Which menus each employee sees" },
  { href: "/accounting/period-lock", label: "Period lock", icon: Lock, description: "Close months and date ranges" },
  // /admin/* — for people whose roles open the Admin area (middleware.js)
  { href: "/admin/roles", label: "Roles", icon: Users, description: "Roles, who holds them, what each may do", adminArea: true },
  { href: "/admin/permissions", label: "Permissions", icon: ShieldCheck, description: "Who can do what", adminArea: true },
  { href: "/admin/user", label: "Logins & Roles", icon: UserCog, description: "Every login, its roles and employee", adminArea: true },
];

const SettingsPage = () => {
  const { data: session } = useSession();
  const [activeTab, setActiveTab] = useState("company");

  // Open the section named in the address, and keep the address in step.
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get("tab");
    if (t && TABS.some((x) => x.id === t)) setActiveTab(t);
  }, []);
  const choose = (id) => {
    setActiveTab(id);
    const url = new URL(window.location.href);
    url.searchParams.set("tab", id);
    window.history.replaceState(null, "", url);
  };

  const active = TABS.find((t) => t.id === activeTab) || TABS[0];
  const Active = active.Component;
  const adminArea = !!session?.user?.superAdmin || (session?.user?.areas || []).includes("admin");
  const links = LINKS.filter((l) => !l.adminArea || adminArea);

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto max-w-[1400px] px-3 py-5 sm:px-6">
        {/* Header */}
        <div className="mb-4 flex items-center gap-3">
          <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20">
            <Settings2 className="h-5 w-5" />
          </span>
          <div className="min-w-0">
            <p className="text-[12.5px] text-muted-foreground">Accounting</p>
            <h1 className="text-2xl font-bold tracking-tight text-foreground">Settings</h1>
          </div>
        </div>

        {/* grid-cols-1 (minmax 0): on a phone the tab strip scrolls instead of widening the page */}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[260px_minmax(0,1fr)]">
          {/* Sections */}
          <nav aria-label="Settings sections" className="min-w-0 lg:sticky lg:top-[calc(var(--header-height)+16px)]">
            <div className="flex gap-1 overflow-x-auto rounded-xl border border-border bg-background p-1.5 lg:flex-col lg:overflow-visible">
              {TABS.map((tab) => {
                const Icon = tab.icon;
                const on = tab.id === active.id;
                return (
                  <button
                    key={tab.id}
                    type="button"
                    onClick={() => choose(tab.id)}
                    aria-current={on ? "page" : undefined}
                    className={`flex flex-shrink-0 items-center gap-3 rounded-lg px-3 py-2 text-left transition-colors lg:w-full ${
                      on ? "bg-primary text-primary-foreground" : "text-foreground/85 hover:bg-primary/[0.06] hover:text-primary"
                    }`}
                  >
                    <span className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${on ? "bg-white/20" : "bg-primary/10 text-primary"}`}>
                      <Icon className="h-4 w-4" />
                    </span>
                    <span className="min-w-0">
                      <span className="block whitespace-nowrap text-sm font-semibold">{tab.label}</span>
                      <span className={`hidden truncate text-[11.5px] lg:block ${on ? "text-white/80" : "text-muted-foreground"}`}>{tab.description}</span>
                    </span>
                  </button>
                );
              })}
            </div>

            {links.length > 0 && (
              <div className="mt-3 hidden rounded-xl border border-border bg-background p-1.5 lg:block">
                <p className="px-3 pb-1 pt-2 text-[11px] font-bold uppercase tracking-wider text-primary">More settings</p>
                {links.map((l) => {
                  const Icon = l.icon;
                  return (
                    <Link key={l.href} href={l.href} className="group flex items-center gap-3 rounded-lg px-3 py-2 hover:bg-primary/[0.06]">
                      <Icon className="h-4 w-4 flex-shrink-0 text-primary/70" />
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-medium text-foreground group-hover:text-primary">{l.label}</span>
                        <span className="block truncate text-[11.5px] text-muted-foreground">{l.description}</span>
                      </span>
                      <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground opacity-0 group-hover:opacity-100" />
                    </Link>
                  );
                })}
              </div>
            )}
          </nav>

          {/* Section */}
          {/* The section draws its own heading; this only gives it room. */}
          <section className="min-w-0 rounded-xl border border-border bg-background p-4 sm:p-5">
            <Active />
          </section>

          {/* More settings, under the section on a phone */}
          {links.length > 0 && (
            <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:hidden">
              {links.map((l) => {
                const Icon = l.icon;
                return (
                  <Link key={l.href} href={l.href} className="flex items-center gap-3 rounded-xl border border-border bg-background px-3 py-2.5">
                    <Icon className="h-4 w-4 flex-shrink-0 text-primary" />
                    <span className="min-w-0 flex-1">
                      <span className="block text-sm font-medium">{l.label}</span>
                      <span className="block truncate text-[11.5px] text-muted-foreground">{l.description}</span>
                    </span>
                    <ArrowUpRight className="h-3.5 w-3.5 text-muted-foreground" />
                  </Link>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default SettingsPage;
