"use client";

import { useEffect, useState, use, useCallback } from "react";
import { useRouter } from "next/navigation";
import { motion, AnimatePresence } from "framer-motion";
import Table from "@/components/Category/Table";
import Modal from "@/components/Category/Modal";
import { VOUCHER_CONFIG } from "@/components/Category/constants";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  RefreshCw,
  TrendingUp,
  BarChart3,
  Layers,
  Sparkles,
} from "lucide-react";
import axios from "axios";

// Import TanStack React Query
import {
  useQuery,
  useQueryClient,
  useMutation,
  keepPreviousData,
} from "@tanstack/react-query";

const CONFIG = {
  voucher: {
    payment: {
      label: "Payment",
      stats: ["total"],
      apiPath: "payment",
      icon: TrendingUp,
      gradient: "from-primary to-primary",
    },
    receipt: {
      label: "Receipt",
      stats: ["total"],
      apiPath: "receipt",
      icon: BarChart3,
      gradient: "from-primary to-primary",
    },
    journal: {
      label: "Journal",
      stats: ["total"],
      apiPath: "journal",
      icon: Layers,
      gradient: "from-primary to-primary",
    },
    letterOfCredit: {
      label: "Letter Of Credit",
      stats: ["total"],
      apiPath: "letterOfCredit",
      icon: Layers,
      gradient: "from-primary to-primary",
    },
    inBond: {
      label: "In-Bond Entry",
      stats: ["total"],
      apiPath: "inBond",
      icon: Layers,
      gradient: "from-primary to-primary",
    },
  },
  invoice: {
    purchase: {
      label: "Purchase Invoice",
      stats: ["total"],
      apiPath: "purchase",
      icon: TrendingUp,
      gradient: "from-primary to-primary",
    },
    sale: {
      label: "Sales Invoice",
      stats: ["total"],
      apiPath: "sale",
      icon: Sparkles,
      gradient: "from-primary to-primary",
    },
    serviceInvoice: {
      label: "Service Invoice",
      stats: ["total"],
      apiPath: "serviceInvoice",
      icon: Sparkles,
      gradient: "from-primary to-primary",
    },
    debit: {
      label: "Debit Note",
      stats: ["total"],
      apiPath: "debit",
      icon: TrendingUp,
      gradient: "from-primary to-primary",
    },
    credit: {
      label: "Credit Note",
      stats: ["total"],
      apiPath: "credit",
      icon: TrendingUp,
      gradient: "from-primary to-primary",
    },
  },



  return: {
    // Each card counts its own document type (the voucher API filters by
    // the type's tran_code), not the purchase / sale it reverses.
    purchaseReturn: {
      label: "Purchase Return",
      stats: ["total"],
      apiPath: "purchaseReturn",
      icon: TrendingUp,
      gradient: "from-primary to-primary",
    },
    saleReturn: {
      label: "Dispatch Return",
      stats: ["total"],
      apiPath: "saleReturn",
      icon: Sparkles,
      gradient: "from-primary to-primary",
    },
    grnReturn: {
      label: "GRN Return",
      stats: ["total"],
      apiPath: "grnReturn",
      icon: TrendingUp,
      gradient: "from-primary to-primary",
    },
    dispatchReturn: {
      label: "Dispatch Return",
      stats: ["total"],
      apiPath: "dispatchReturn",
      icon: Sparkles,
      gradient: "from-primary to-primary",
    },
  },

  godown: {
    transfer: {
      label: "Transfer Stock",
      stats: ["total"],
      apiPath: "transfer",
      icon: TrendingUp,
      gradient: "from-primary to-primary",
    },
    transferEdit: {
      label: "Edit Transfer Stock",
      stats: ["total"],
      apiPath: "transfer",
      icon: TrendingUp,
      gradient: "from-primary to-primary",
    },
    fgTransfer: {
      label: "FG Transfer",
      stats: ["total"],
      apiPath: "transfer",
      icon: TrendingUp,
      gradient: "from-primary to-primary",
    },
  },
  report: {
    grn: {
      label: "GRN",
      totalText: "Total GRNs",
      stats: ["total"],
      apiPath: "grn",
      icon: TrendingUp,
      gradient: "from-primary to-primary",
    },
    grnEdit: {
      label: "GRN",
      totalText: "Total GRNs",
      stats: ["total"],
      apiPath: "grn",
      icon: TrendingUp,
      gradient: "from-primary to-primary",
    },
    exbond: {
      label: "ExBond",
      totalText: "Total ExBond",
      stats: ["total"],
      apiPath: "exbond",
      icon: TrendingUp,
      gradient: "from-primary to-primary",
    },
    exbondEdit: {
      label: "ExBond",
      totalText: "Total ExBond",
      stats: ["total"],
      apiPath: "exbond",
      icon: TrendingUp,
      gradient: "from-primary to-primary",
    },
    fixedAssetsGrn: {
      label: "Fixed Assets GRN",
      totalText: "Total Fixed Assets GRNs",
      stats: ["total"],
      apiPath: "fixedAssetsGrn",
      icon: TrendingUp,
      gradient: "from-primary to-primary",
    },
    serviceEntry: {
      label: "Service Entry",
      stats: ["total"],
      apiPath: "serviceEntry",
      icon: TrendingUp,
      gradient: "from-primary to-primary",
    },
    serviceInvoice: {
      label: "Service Invoice",
      stats: ["total"],
      apiPath: "serviceInvoice",
      icon: TrendingUp,
      gradient: "from-primary to-primary",
    },
    dispatch: {
      label: "Sale Order",
      totalText: "Total Dispatches",
      stats: ["total"],
      apiPath: "dispatch",
      icon: Sparkles,
      gradient: "from-primary to-primary",
    },
    dispatchEdit: {
      // Rendered as "{label}s" → "Dispatches".
      label: "Dispatche",
      totalText: "Total Dispatches",
      stats: ["total"],
      apiPath: "dispatchEdit",
      icon: Sparkles,
      gradient: "from-primary to-primary",
    },
  },

  order: {
    purchaseOrder: {
      label: "Purchase Requisition",
      stats: ["total"],
      apiPath: "purchaseOrder",
      icon: TrendingUp,
      gradient: "from-primary to-primary",
    },
    purchaseOrderEdit: {
      label: "Purchase Order",
      stats: ["total"],
      apiPath: "purchaseOrderEdit",
      icon: Sparkles,
      gradient: "from-primary to-primary",
    },
    saleOrder: {
      label: "Sales Order",
      stats: ["total"],
      apiPath: "saleOrder",
      icon: Sparkles,
      gradient: "from-primary to-primary",
    },
    saleOrderView: {
      label: "Sales Order",
      stats: ["total"],
      apiPath: "saleOrder",
      icon: Sparkles,
      gradient: "from-primary to-primary",
    },
    serviceOrder: {
      label: "Service Order",
      stats: ["total"],
      apiPath: "serviceOrder",
      icon: Sparkles,
      gradient: "from-primary to-primary",
    },
  },

  material: {

    requisition: {
      label: "Material Requisition",
      stats: ["total"],
      apiPath: "requisition",
      icon: BarChart3,
      gradient: "from-primary to-primary",
    },

    requisitionTransfer: {
      label: "Transfer Requisition",
      stats: ["total"],
      apiPath: "requisition",
      icon: BarChart3,
      gradient: "from-primary to-primary",
    },

    requisitionFGTransfer: {
      label: "FG Transfer Requisition",
      stats: ["total"],
      apiPath: "requisition",
      icon: BarChart3,
      gradient: "from-primary to-primary",
    },

    fgTransfer: {
      label: "FG Transfer",
      stats: ["total"],
      apiPath: "purchase",
      icon: TrendingUp,
      gradient: "from-primary to-primary",
    },
    dispatchTransfer:{
      label: "Production Plan",
      stats: ["total"],
      apiPath: "requisition",
      icon: BarChart3,
      gradient: "from-primary to-primary",
    },
    productionPlan:{
      label: "Production Plan",
      stats: ["total"],
      apiPath: "requisition",
      icon: BarChart3,
      gradient: "from-primary to-primary",
    }
  },

  production: {
    materialIssue: {
      label: "Material Consumption",
      stats: ["total"],
      apiPath: "materialIssue",
      icon: TrendingUp,
      gradient: "from-primary to-primary",
    },
    materialInput: {
      label: "Material Input For Production",
      stats: ["total"],
      apiPath: "materialInput",
      icon: Sparkles,
      gradient: "from-primary to-primary",
    },
    materialIssueLanded: {
      label: "Material Issue For Landed Cost",
      stats: ["total"],
      apiPath: "materialIssueLanded",
      icon: TrendingUp,
      gradient: "from-primary to-primary",
    },
  },

};

// Animation variants
const containerVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: {
    opacity: 1,
    y: 0,
    transition: {
      duration: 0.6,
      ease: [0.22, 1, 0.36, 1],
      staggerChildren: 0.1,
    },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20, scale: 0.95 },
  visible: {
    opacity: 1,
    y: 0,
    scale: 1,
    transition: {
      duration: 0.5,
      ease: [0.22, 1, 0.36, 1],
    },
  },
};

const cardHoverVariants = {
  hover: {
    y: -4,
    scale: 1.02,
    transition: {
      duration: 0.2,
      ease: [0.22, 1, 0.36, 1],
    },
  },
  tap: {
    scale: 0.98,
    transition: {
      duration: 0.1,
      ease: [0.22, 1, 0.36, 1],
    },
  },
};

const StatCard = ({ stat, value, name, isLoading, gradient, icon: Icon }) => (
  <motion.div
    variants={itemVariants}
    whileHover="hover"
    whileTap="tap"
    className="group cursor-pointer"
  >
    <Card className="w-60 relative overflow-hidden border-0 bg-gradient-to-br from-primary to-primary backdrop-blur-xl shadow-xl shadow-black/5 hover:shadow-2xl hover:shadow-black/10 transition-all duration-300">
      <div
        className={`absolute inset-0 bg-gradient-to-br ${gradient} opacity-5 group-hover:opacity-10 transition-opacity duration-300`}
      />
      <CardHeader className="relative">
        <div className="flex items-center justify-between">
          <CardTitle className="text-sm font-semibold text-white uppercase tracking-wider">
            {name}
          </CardTitle>
          <div
            className={`p-2 rounded-xl bg-gradient-to-br ${gradient} shadow-lg`}
          >
            <Icon size={16} className="text-white" />
          </div>
        </div>
      </CardHeader>
      <CardContent className="relative">
        <AnimatePresence mode="wait">
          {isLoading ? (
            <motion.div
              key="loading"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="h-8 w-20 bg-gradient-to-r from-slate-200 via-slate-300 to-slate-200 animate-pulse rounded-lg"
            />
          ) : (
            <motion.div
              key="loaded"
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.8 }}
              transition={{ duration: 0.3, ease: [0.22, 1, 0.36, 1] }}
              className="text-3xl font-bold bg-gradient-to-r from-slate-800 to-slate-600 bg-clip-text text-transparent text-white"
            >
              {value ?? "-"}
            </motion.div>
          )}
        </AnimatePresence>
      </CardContent>
    </Card>
  </motion.div>
);

// Fetch stats function for React Query
const fetchStats = async ({ queryKey }) => {
  const [_, category, type, apiPath] = queryKey;



  let api;
  if (type === "letterOfCredit") {
    api = "/api/lc";
  } else if (type === "inBond") {
    api = "/api/inbond";
  } else if (category === "order") {
    api = `/api/orders/${apiPath}`;
  } else if (category === "material") {
    api = `/api/material/${apiPath}`;
  } else {
    api = `/api/voucher/${apiPath}`;
  }

  const response = await axios.get(api);

  if (category === "material") {
    return { total: response.data.total };
  }

  return response.data;
};

export default function DynamicVoucherPage({ params: paramsPromise }) {
  const router = useRouter();
  const params = use(paramsPromise);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  // React Query Client
  const queryClient = useQueryClient();

  const categoryConfig = CONFIG[params.category];
  const typeConfig = categoryConfig?.[params.type];

  // React Query for stats data
  const {
    data: stats = {},
    isLoading: isStatsLoading,
    isError: isStatsError,
    error: statsError,
    isFetching: isStatsFetching,
    refetch: refetchStats,
  } = useQuery({
    queryKey: ["stats", params.category, params.type, typeConfig?.apiPath],
    queryFn: fetchStats,
    enabled: !!typeConfig,
    staleTime: 1000 * 60 * 5, // 5 minutes
    gcTime: 1000 * 60 * 10, // 10 minutes
    retry: 3,
    retryDelay: 1000,
  });

  const refreshData = useCallback(() => {
    refetchStats();
    setRefreshTrigger(prev => prev + 1);
  }, [refetchStats]);

  // Keyboard navigation
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === "r" && (e.ctrlKey || e.metaKey)) {
        e.preventDefault();
        refreshData();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [refreshData]);

  if (!typeConfig) {
    router.replace("/404");
    return null;
  }

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto max-w-full px-3 py-5 sm:px-6">
        {/* Header: title + count, Refresh and New */}
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <p className="mb-1 text-[12.5px] capitalize text-muted-foreground">{params.category}</p>
            <h1 className="flex flex-wrap items-center gap-2.5 text-2xl font-bold tracking-tight text-foreground">
              {typeConfig.label}s
              {typeConfig.stats.map((stat) => (
                <span
                  key={stat}
                  title={typeConfig.totalText || `Total ${typeConfig.label}`}
                  className="inline-flex h-6 min-w-[24px] items-center justify-center rounded-full bg-primary/10 px-2.5 text-xs font-bold tabular-nums text-primary"
                >
                  {isStatsLoading ? "…" : (stats[stat]?.toLocaleString?.("en-US") ?? stats[stat] ?? "-")}
                </span>
              ))}
            </h1>
          </div>

          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            <Button
              onClick={refreshData}
              variant="outline"
              className="h-10 gap-2 bg-background"
              disabled={isStatsFetching}
              title="Refresh (Ctrl+R)"
            >
              <RefreshCw size={16} className={isStatsFetching ? "animate-spin" : ""} />
              Refresh
              <kbd className="hidden rounded border border-b-2 border-border bg-background px-1.5 font-mono text-[11px] font-semibold sm:inline">
                Ctrl+R
              </kbd>
            </Button>

            <Modal
              type={params.type}
              refreshTrigger={refreshTrigger}
              category={params.category}
              onSuccess={refreshData}
            />
          </div>
        </div>

        {/* Error Alert for Stats */}
        {isStatsError && (
          <motion.div
            initial={{ opacity: 0, y: -20 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-6"
          >
            <div className="bg-red-50 border border-red-200 rounded-lg p-4">
              <p className="text-red-800 font-medium">
                Failed to load stats: {statsError?.message || "Unknown error"}
              </p>
              <Button
                onClick={() => refetchStats()}
                variant="outline"
                size="sm"
                className="mt-2"
              >
                Retry
              </Button>
            </div>
          </motion.div>
        )}

        {/* List */}
        <Table
          type={params.type}
          refreshTrigger={refreshTrigger}
          category={params.category}
          onSuccess={refreshData}
        />
      </div>
    </div>
  );
}