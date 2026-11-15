"use client";
// Accounting → Analytics & Graphs. The charts each person may see (Admin →
// Graph permissions), one module at a time: underline tabs pick the module,
// one filter card (dates, plus customer / item when that module uses them),
// then the module's charts in the dashboard grid.

import { useState, useEffect } from "react";
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
import { GraphSkeleton } from "@/components/Graphs/shared/GraphCard";
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
  SlidersHorizontal,
} from "lucide-react";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { LabHeader, TABS_LIST, TABS_SCROLL, TABS_TRIGGER } from "@/components/Material/shared/LabUI";
import { GRAPH_DEFINITIONS } from "@/components/Graphs/permissions";

// Map graph IDs to their components
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

const PAGE = "min-h-screen bg-muted/40";
const FRAME = "mx-auto max-w-[1600px] px-3 py-5 sm:px-6";

const GraphsPage = () => {
  const { data: session, status } = useSession();
  const [dateFrom, setDateFrom] = useState(null);
  const [dateTo, setDateTo] = useState(null);
  const [customer, setCustomer] = useState({
    value: "all",
    label: "All Customers",
  });
  const [item, setItem] = useState(null);
  const [allowedGraphs, setAllowedGraphs] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [activeTab, setActiveTab] = useState(null);

  useEffect(() => {
    const defaultDateFrom = (() => {
      const today = new Date();
      const threeMonthsAgo = new Date();
      threeMonthsAgo.setMonth(today.getMonth() - 3);
      return threeMonthsAgo;
    })();
    setDateFrom(defaultDateFrom);
    setDateTo(new Date());
  }, []);

  useEffect(() => {
    const fetchPermissions = async () => {
      if (status === "loading") return;

      if (!session) {
        setIsLoading(false);
        return;
      }

      try {
        const response = await axios.get("/api/graphs/permissions");
        setAllowedGraphs(response.data);
      } catch (error) {
        console.error("Error fetching graph permissions:", error);
        setAllowedGraphs({ allowedGraphs: {}, allAllowed: false });
      } finally {
        setIsLoading(false);
      }
    };

    fetchPermissions();
  }, [session, status]);

  // Get all allowed graphs across all categories
  const getAllowedGraphsList = () => {
    if (!allowedGraphs) return [];

    if (allowedGraphs.allAllowed) {
      // Admin/Manager - return all graphs from all categories
      const allGraphs = [];
      Object.keys(GRAPH_DEFINITIONS).forEach((categoryKey) => {
        const category = GRAPH_DEFINITIONS[categoryKey];
        category.graphs.forEach((graph) => {
          allGraphs.push({
            category: categoryKey,
            graphId: graph.id,
            graphName: graph.name,
            component: GRAPH_COMPONENT_MAP[`${categoryKey}:${graph.id}`],
          });
        });
      });
      return allGraphs;
    }

    // Regular user - return only allowed graphs
    const allowedGraphsList = [];
    Object.keys(allowedGraphs.allowedGraphs || {}).forEach((categoryKey) => {
      const category = allowedGraphs.allowedGraphs[categoryKey];
      category.graphs.forEach((graph) => {
        allowedGraphsList.push({
          category: categoryKey,
          graphId: graph.id,
          graphName: graph.name,
          component: GRAPH_COMPONENT_MAP[`${categoryKey}:${graph.id}`],
        });
      });
    });
    return allowedGraphsList;
  };

  const allowedGraphsList = getAllowedGraphsList();
  const hasAnyAccess = allowedGraphsList.length > 0;

  // Group graphs by category for better organization
  const graphsByCategory = {};
  allowedGraphsList.forEach((graph) => {
    if (!graphsByCategory[graph.category]) {
      graphsByCategory[graph.category] = [];
    }
    graphsByCategory[graph.category].push(graph);
  });
  const categoryKeys = Object.keys(graphsByCategory);
  const currentTab = categoryKeys.includes(activeTab) ? activeTab : categoryKeys[0];

  const header = (
    <LabHeader
      icon={BarChart3}
      breadcrumb="Accounting"
      title="Analytics & Graphs"
      subtitle="Visual insights into your business performance"
      badge={hasAnyAccess ? `${allowedGraphsList.length} charts` : undefined}
      className="mb-4"
    />
  );

  if (status === "loading" || isLoading) {
    return (
      <div className={PAGE}>
        <div className={FRAME} aria-busy="true">
          {header}
          <div className="mb-4 h-10 w-full max-w-md animate-pulse rounded-lg bg-background" />
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
      <div className={PAGE}>
        <div className={FRAME}>
          {header}
          <div className="mx-auto mt-6 max-w-md rounded-xl border border-border bg-background px-6 py-12 text-center">
            <span className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Lock className="h-5 w-5" />
            </span>
            <h2 className="text-lg font-semibold text-foreground">No access</h2>
            <p className="mt-1.5 text-sm leading-relaxed text-muted-foreground">
              You don&apos;t have permission to view any graphs. Please contact your administrator to request access.
            </p>
          </div>
        </div>
      </div>
    );
  }

  const category = GRAPH_DEFINITIONS[currentTab];
  const graphs = graphsByCategory[currentTab] || [];
  const showCustomer = currentTab === "sales";
  const showItem = currentTab === "production" || currentTab === "lab";
  const CategoryIcon = CATEGORY_ICON[currentTab] || BarChart3;

  return (
    <div className={PAGE}>
      <div className={`${FRAME} pb-16`}>
        {header}

        {/* Module tabs */}
        {categoryKeys.length > 1 && (
          <Tabs value={currentTab} onValueChange={setActiveTab} className="mb-4">
            <div className={TABS_SCROLL}>
              <TabsList className={TABS_LIST}>
                {categoryKeys.map((key) => {
                  const Icon = CATEGORY_ICON[key] || BarChart3;
                  return (
                    <TabsTrigger key={key} value={key} className={TABS_TRIGGER}>
                      <Icon className="h-4 w-4" />
                      {GRAPH_DEFINITIONS[key]?.name || key}
                    </TabsTrigger>
                  );
                })}
              </TabsList>
            </div>
          </Tabs>
        )}

        {/* Filters — shared by every module; customer / item only where the module uses them */}
        <section className="overflow-hidden rounded-xl border border-border bg-background">
          <div className="flex items-center gap-2 border-b border-primary/15 bg-primary/5 px-4 py-2.5">
            <SlidersHorizontal className="h-4 w-4 text-primary" />
            <h2 className="text-sm font-semibold text-primary">Filters</h2>
            <span className="ml-auto hidden text-xs text-muted-foreground sm:inline">
              Applies to the {category?.name || currentTab} charts
            </span>
          </div>
          <div className="p-4">
            <GraphFilters
              key={currentTab}
              dateFrom={dateFrom}
              dateTo={dateTo}
              customer={showCustomer ? customer : undefined}
              item={showItem ? item : undefined}
              onDateFromChange={setDateFrom}
              onDateToChange={setDateTo}
              onCustomerChange={showCustomer ? setCustomer : undefined}
              onItemChange={showItem ? setItem : undefined}
              showCustomer={showCustomer}
              showItem={showItem}
            />
          </div>
        </section>

        {/* Charts of the selected module */}
        <section className="mt-5">
          <div className="mb-3 flex items-center gap-3">
            <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
              <CategoryIcon className="h-[18px] w-[18px]" />
            </span>
            <div className="min-w-0 flex-1">
              <h2 className="truncate text-lg font-semibold text-foreground">{category?.name || currentTab}</h2>
              <p className="text-xs text-muted-foreground">
                {graphs.length} {graphs.length === 1 ? "chart" : "charts"}
                {showCustomer && customer?.label ? ` · ${customer.label}` : ""}
                {showItem && item?.label ? ` · ${item.label}` : ""}
              </p>
            </div>
          </div>

          {/* Layout is handled by DashboardGrid (dashboard-safe, graph-agnostic). */}
          <DashboardGrid>
            {graphs.map((graph) => {
              const GraphComponent = GRAPH_COMPONENT_MAP[`${currentTab}:${graph.graphId}`];
              if (!GraphComponent) {
                console.warn(`No component found for graph: ${currentTab}:${graph.graphId}`);
                return null;
              }

              return (
                <GraphComponent
                  key={`${currentTab}-${graph.graphId}`}
                  customer={showCustomer ? (customer?.value || null) : undefined}
                  item={showItem ? (item?.value || null) : undefined}
                  dateFrom={dateFrom}
                  dateTo={dateTo}
                  gridClassName={currentTab === "payrolloperation" ? "lg:col-span-2" : ""}
                />
              );
            })}
          </DashboardGrid>
        </section>
      </div>
    </div>
  );
};

export default GraphsPage;
