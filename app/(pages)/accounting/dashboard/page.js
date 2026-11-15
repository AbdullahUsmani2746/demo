"use client";
// Accounting → Dashboard. The charts each person may see (Admin → Graph
// permissions), grouped by module: one filter card (dates, plus customer /
// item when a module uses them), a sticky module bar that jumps to a section
// and follows the scroll, then each module's charts.

import { useState, useEffect, useRef, useCallback } from "react";
import {
  SalesCombinedGraph,
  SalesRegionGraph,
  ProductionCombinedGraph,
  ProductionItemGraph,
  LabCombinedGraph,
  LabItemGraph,
  ScmCombinedGraph,
  FinanceCombinedGraph,
  StoreCombinedGraph,
  DispatchCombinedGraph,
  OpManagerCombinedGraph,
  QualityAssuranceCombinedGraph,
  PayrollOperationCombinedGraph,
  GraphFilters,
  DashboardGrid,
} from "@/components/Graphs";
import { useSession } from "next-auth/react";
import axios from "axios";
import {
  Lock,
  BarChart3,
  TrendingUp,
  Package,
  FlaskConical,
  ShoppingCart,
  DollarSign,
  Store,
  Truck,
  Settings2,
  ShieldCheck,
  Users,
  LayoutDashboard,
  SlidersHorizontal,
} from "lucide-react";
import { GRAPH_DEFINITIONS } from "@/components/Graphs/permissions";
import { GraphSkeleton } from "@/components/Graphs/shared/GraphCard";
import { format } from "date-fns";

const GRAPH_COMPONENT_MAP = {
  "sales:combined": SalesCombinedGraph,
  "sales:region": SalesRegionGraph,
  "production:combined": ProductionCombinedGraph,
  "production:item": ProductionItemGraph,
  "lab:combined": LabCombinedGraph,
  "lab:item": LabItemGraph,
  "scm:combined": ScmCombinedGraph,
  "finance:combined": FinanceCombinedGraph,
  "store:combined": StoreCombinedGraph,
  "dispatch:combined": DispatchCombinedGraph,
  "opmanager:combined": OpManagerCombinedGraph,
  "qualityassurance:combined": QualityAssuranceCombinedGraph,
  "payrolloperation:combined": PayrollOperationCombinedGraph,
};

const CATEGORY_ICON = {
  sales: TrendingUp,
  production: Package,
  lab: FlaskConical,
  scm: ShoppingCart,
  finance: DollarSign,
  store: Store,
  dispatch: Truck,
  opmanager: Settings2,
  qualityassurance: ShieldCheck,
  payrolloperation: Users,
};

function getGreeting() {
  const hour = new Date().getHours();
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

function getFirstName(name) {
  if (!name) return "there";
  return name.split(" ")[0];
}

const AccountingDashboard = () => {
  const { data: session, status } = useSession();
  const [dateFrom, setDateFrom] = useState(null);
  const [dateTo, setDateTo] = useState(null);
  const [customer, setCustomer] = useState({ value: "all", label: "All Customers" });
  const [item, setItem] = useState(null);
  const [allowedGraphs, setAllowedGraphs] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(null);
  const sectionRefs = useRef({});
  const navRef = useRef(null);
  const [now, setNow] = useState(new Date());

  useEffect(() => {
    const tick = setInterval(() => setNow(new Date()), 60000);
    return () => clearInterval(tick);
  }, []);

  useEffect(() => {
    const threeMonthsAgo = new Date();
    threeMonthsAgo.setMonth(threeMonthsAgo.getMonth() - 3);
    setDateFrom(threeMonthsAgo);
    setDateTo(new Date());
  }, []);

  useEffect(() => {
    const fetchPermissions = async () => {
      if (status === "loading") return;
      if (!session) { setIsLoading(false); return; }
      try {
        const response = await axios.get("/api/graphs/permissions");
        setAllowedGraphs(response.data);
      } catch {
        setAllowedGraphs({ allowedGraphs: {}, allAllowed: false });
      } finally {
        setIsLoading(false);
      }
    };
    fetchPermissions();
  }, [session, status]);

  const getAllowedGraphsList = useCallback(() => {
    if (!allowedGraphs) return [];
    if (allowedGraphs.allAllowed) {
      return Object.keys(GRAPH_DEFINITIONS).flatMap((categoryKey) =>
        GRAPH_DEFINITIONS[categoryKey].graphs.map((graph) => ({
          category: categoryKey,
          graphId: graph.id,
          graphName: graph.name,
          component: GRAPH_COMPONENT_MAP[`${categoryKey}:${graph.id}`],
        }))
      );
    }
    return Object.keys(allowedGraphs.allowedGraphs || {}).flatMap((categoryKey) =>
      (allowedGraphs.allowedGraphs[categoryKey].graphs || []).map((graph) => ({
        category: categoryKey,
        graphId: graph.id,
        graphName: graph.name,
        component: GRAPH_COMPONENT_MAP[`${categoryKey}:${graph.id}`],
      }))
    );
  }, [allowedGraphs]);

  const allowedGraphsList = getAllowedGraphsList();
  const hasAnyAccess = allowedGraphsList.length > 0;

  const graphsByCategory = {};
  allowedGraphsList.forEach((graph) => {
    if (!graphsByCategory[graph.category]) graphsByCategory[graph.category] = [];
    graphsByCategory[graph.category].push(graph);
  });

  const categoryKeys = Object.keys(graphsByCategory);
  // The filter card shows customer / item only when a module on the page uses it.
  const anyCustomer = categoryKeys.includes("sales");
  const anyItem = categoryKeys.includes("production") || categoryKeys.includes("lab");

  const scrollToSection = (key) => {
    setActiveTab(key);
    sectionRefs.current[key]?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  useEffect(() => {
    if (categoryKeys.length && !activeTab) setActiveTab(categoryKeys[0]);
  }, [categoryKeys.length]);

  // The module bar follows the scroll: the section nearest the top is active.
  useEffect(() => {
    if (!categoryKeys.length || typeof IntersectionObserver === "undefined") return;
    const io = new IntersectionObserver(
      (entries) => {
        const top = entries
          .filter((e) => e.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
        if (top?.target?.dataset?.key) setActiveTab(top.target.dataset.key);
      },
      { rootMargin: "-140px 0px -55% 0px" }
    );
    categoryKeys.forEach((k) => sectionRefs.current[k] && io.observe(sectionRefs.current[k]));
    return () => io.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categoryKeys.join("|")]);

  // Keep the active module tab in view on a phone (scrolls the bar only, never the page).
  useEffect(() => {
    const bar = navRef.current;
    const el = bar?.querySelector(`[data-tab="${activeTab}"]`);
    if (!bar || !el) return;
    const a = el.getBoundingClientRect();
    const b = bar.getBoundingClientRect();
    if (a.left < b.left) bar.scrollLeft -= b.left - a.left + 8;
    else if (a.right > b.right) bar.scrollLeft += a.right - b.right + 8;
  }, [activeTab]);

  const userName = session?.user?.name || session?.user?.email || "";
  const header = (
    <PageHeader
      greeting={`${getGreeting()}, ${getFirstName(userName)}`}
      dateStr={format(now, "EEEE, d MMMM yyyy")}
      categoryCount={categoryKeys.length}
      graphCount={allowedGraphsList.length}
    />
  );

  if (status === "loading" || isLoading) {
    return (
      <div className="min-h-screen bg-muted/40">
        <div className="mx-auto max-w-[1600px] px-3 py-5 sm:px-6" aria-busy="true">
          {header}
          <div className="mb-4 h-24 animate-pulse rounded-xl border border-border bg-background" />
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            {[0, 1].map((i) => (
              <div key={i} className="overflow-hidden rounded-xl border border-border bg-background">
                <div className="border-b border-primary/15 bg-primary/5 px-4 py-3">
                  <div className="h-4 w-48 animate-pulse rounded bg-primary/10" />
                </div>
                <div className="p-4">
                  <GraphSkeleton />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    );
  }

  if (!hasAnyAccess) {
    return (
      <div className="min-h-screen bg-muted/40">
        <div className="mx-auto max-w-[1600px] px-3 py-5 sm:px-6">
          {header}
          <div className="mx-auto mt-6 max-w-md rounded-xl border border-border bg-background px-6 py-12 text-center">
            <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Lock className="h-5 w-5" />
            </span>
            <h2 className="text-lg font-semibold text-foreground">No charts for you yet</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              You don&apos;t have permission to view any dashboard charts. Ask your administrator to give you access
              to the modules you work with.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto max-w-[1600px] px-3 pb-16 pt-5 sm:px-6">
        {header}

        {/* Filters — one set for the whole page */}
        <section className="overflow-hidden rounded-xl border border-border bg-background">
          <div className="flex items-center gap-2 border-b border-primary/15 bg-primary/5 px-4 py-2.5">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-primary">Filters</h2>
            <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">Applies to every chart below</span>
          </div>
          <div className="p-4">
            <GraphFilters
              dateFrom={dateFrom}
              dateTo={dateTo}
              customer={anyCustomer ? customer : undefined}
              item={anyItem ? item : undefined}
              onDateFromChange={setDateFrom}
              onDateToChange={setDateTo}
              onCustomerChange={anyCustomer ? setCustomer : undefined}
              onItemChange={anyItem ? setItem : undefined}
              showCustomer={anyCustomer}
              showItem={anyItem}
            />
          </div>
        </section>

        {/* Module bar */}
        {categoryKeys.length > 1 && (
          <nav
            aria-label="Dashboard modules"
            className="sticky top-[var(--header-height,0px)] z-20 -mx-3 mt-4 border-b border-border bg-muted/95 px-3 backdrop-blur supports-[backdrop-filter]:bg-muted/80 sm:-mx-6 sm:px-6"
          >
            <div ref={navRef} className="no-scrollbar flex gap-1 overflow-x-auto">
              {categoryKeys.map((key) => {
                const Icon = CATEGORY_ICON[key] || BarChart3;
                const def = GRAPH_DEFINITIONS[key];
                const isActive = activeTab === key;
                return (
                  <button
                    key={key}
                    type="button"
                    data-tab={key}
                    onClick={() => scrollToSection(key)}
                    aria-current={isActive ? "true" : undefined}
                    className={`-mb-px flex flex-shrink-0 items-center gap-2 whitespace-nowrap border-b-2 px-3 py-2.5 text-sm font-medium transition-colors ${
                      isActive
                        ? "border-primary text-primary"
                        : "border-transparent text-muted-foreground hover:text-foreground"
                    }`}
                  >
                    <Icon className="h-4 w-4" />
                    {def?.name || key}
                  </button>
                );
              })}
            </div>
          </nav>
        )}

        {/* Sections */}
        <div className="mt-5 space-y-8">
          {categoryKeys.map((categoryKey) => {
            const category = GRAPH_DEFINITIONS[categoryKey];
            const graphs = graphsByCategory[categoryKey];
            const Icon = CATEGORY_ICON[categoryKey] || BarChart3;
            const showCustomer = categoryKey === "sales";
            const showItem = categoryKey === "production" || categoryKey === "lab";

            return (
              <section
                key={categoryKey}
                data-key={categoryKey}
                ref={(el) => { sectionRefs.current[categoryKey] = el; }}
                className="scroll-mt-[calc(var(--header-height,0px)+56px)]"
              >
                <div className="mb-3 flex items-center gap-3">
                  <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                    <Icon className="h-[18px] w-[18px]" />
                  </span>
                  <div className="min-w-0 flex-1">
                    <h2 className="truncate text-lg font-semibold text-foreground">{category?.name || categoryKey}</h2>
                    <p className="text-xs text-muted-foreground">
                      {graphs.length} {graphs.length === 1 ? "chart" : "charts"}
                      {showCustomer && customer?.label ? ` · ${customer.label}` : ""}
                      {showItem && item?.label ? ` · ${item.label}` : ""}
                    </p>
                  </div>
                </div>

                <DashboardGrid>
                  {graphs.map((graph) => {
                    const GraphComponent = GRAPH_COMPONENT_MAP[`${categoryKey}:${graph.graphId}`];
                    if (!GraphComponent) return null;
                    const isPayroll = graph.category === "payrolloperation";
                    return (
                      <GraphComponent
                        key={`${categoryKey}-${graph.graphId}`}
                        customer={showCustomer ? (customer?.value || null) : undefined}
                        item={showItem ? (item?.value || null) : undefined}
                        dateFrom={dateFrom}
                        dateTo={dateTo}
                        gridClassName={isPayroll ? "lg:col-span-2" : ""}
                      />
                    );
                  })}
                </DashboardGrid>
              </section>
            );
          })}
        </div>
      </div>
    </div>
  );
};

function PageHeader({ greeting, dateStr, categoryCount, graphCount }) {
  return (
    <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
      <div className="flex min-w-0 items-center gap-3">
        <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20">
          <LayoutDashboard className="h-5 w-5" />
        </span>
        <div className="min-w-0">
          <p className="text-[12.5px] text-muted-foreground">Accounting</p>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Dashboard</h1>
          <p className="truncate text-sm text-muted-foreground">
            {greeting} · {dateStr}
          </p>
        </div>
      </div>
      {(categoryCount > 0 || graphCount > 0) && (
        <div className="flex flex-wrap items-center gap-2">
          <StatChip label="Modules" value={categoryCount} />
          <StatChip label="Charts" value={graphCount} />
        </div>
      )}
    </div>
  );
}

function StatChip({ label, value }) {
  return (
    <div className="flex items-baseline gap-1.5 rounded-lg border border-border bg-background px-3 py-1.5">
      <span className="text-base font-bold tabular-nums text-foreground">{value}</span>
      <span className="text-xs text-muted-foreground">{label}</span>
    </div>
  );
}

export default AccountingDashboard;
