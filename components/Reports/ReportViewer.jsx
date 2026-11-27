"use client";

import React, { useState, useEffect, useMemo, useCallback, useRef } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { REPORT_CONFIG } from "./config";
import { useFeatures } from "@/hooks/useFeatures";
import { applyReportFeatures } from "@/lib/features/apply";
import { saveAs } from "file-saver";
import * as XLSX from "xlsx-js-style";
import { format } from "date-fns";
import {
  useQuery,
  useQueryClient,
  keepPreviousData,
  useQueries,
} from "@tanstack/react-query";
import Select from "react-select";
import {
  Card,
  CardHeader,
  CardTitle,
  CardDescription,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Calendar } from "@/components/ui/calendar";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Badge } from "@/components/ui/badge";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DownloadIcon,
  FilterIcon,
  RefreshCwIcon,
  BarChart3Icon,
  CalendarIcon,
  SearchIcon,
  XIcon,
  EyeIcon,
  Eye,
  FileTextIcon,
  FileSpreadsheetIcon,
  FileIcon,
  ChevronDownIcon,
  Loader2Icon,
  DatabaseIcon,
  ArrowUpIcon,
  ArrowDownIcon,
  SparklesIcon,
  Clock,
  Users,
  Activity,
  Search,
  Database,
  Loader2,
  RefreshCw,
  ChevronsLeft,
  ChevronLeft,
  ChevronRight,
  ChevronsRight,
  EyeOffIcon,
  ArrowRight,
  X,
  Grid3x3,
  LayoutList,
  ArrowUp,
  ArrowDown,
  Check,
  Landmark,
  ListOrdered,
  MoreHorizontal,
} from "lucide-react";
import AccountOrderPanel from "./AccountOrderPanel";
import RecordLinesSheet from "./RecordLinesSheet";
import axios from "axios";
import { toast } from "sonner";
import { generateBOMPDF } from "../Template/Bom";
import { useSession } from "next-auth/react";
import { useCurrency } from "@/context/CurrencyContext";
import { useCompany } from "@/context/CompanyContext";
import { motion, AnimatePresence } from "framer-motion";
import { Printer, Download, X as CloseIcon } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { useIsMobile } from "@/hooks/use-mobile";
import { voucherHref, voucherLabel } from "@/lib/vouchers/voucherLink";
import WideTable from "./WideTable";
import ReportSummary from "./ReportSummary";
import {
  ReportFilterChips,
  ReportFilterPanel,
  SummaryTypeTabs,
  summaryTypeFilter,
  withDependents,
} from "./ReportFilters";
import { resolveLayout, voucherOf } from "./layout";
import { withItemColumns, itemRowGroups } from "./itemColumns";
import { exportWideExcel, exportWidePdf } from "./wideExport";
import {
  VIEW_PARAM,
  buildReportHref,
  currentLocationKey,
  keepReservedParams,
  pushTrailStep,
  saveScroll,
  takeScroll,
  trailDepthOf,
  trailStepsFor,
  withTrailParam,
} from "./reportTrail";

// Helper function to fetch report data
const fetchReportData = async ({ queryKey }) => {
  const [_, config, params] = queryKey;
  const response = await axios.get(config.apiEndpoint, { params });
  return response.data;
};

// Helper function to fetch filter options
const fetchFilterOptions = async ({ queryKey }) => {
  const [_, endpoint] = queryKey;
  const res = await fetch(endpoint);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const data = await res.json();
  return Array.isArray(data) ? data : data.data || [];
};

// Helper function to fetch godowns
const fetchGodowns = async () => {
  // Reports list closed godowns too — their history must stay reportable
  const res = await axios.get("/api/setup/godowns", { params: { includeInactive: true } });
  return res.data.data;
};

// Helper function to fetch quality parameters
const fetchQualityParameters = async () => {
  const res = await axios.get("/api/setup/quality_parameters");
  return res.data.data || [];
};

const ReportViewer = ({ reportType }) => {
  const router = useRouter();
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  const { currency } = useCurrency();
  const { company } = useCompany();
  const searchParams = useSearchParams();

  const formatDate = (date) => {
    if (!date) return "";
    if (!(date instanceof Date) || isNaN(date)) return "";
    // Format as DD-MM-YYYY
    const day = String(date.getDate()).padStart(2, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const year = date.getFullYear();
    return `${day}-${month}-${year}`;
  };

  // Helper to check if report type is QC
  const isQCReport = reportType === "qc" || reportType === "orderQc";

  const [error, setError] = useState(null);
  const [rawConfig, setConfig] = useState(null);
  // Settings → Features: filters / options / columns marked `feature: "<key>"`
  // show only while that feature is on (lib/features/apply.js).
  const { values: featureValues } = useFeatures();
  const config = useMemo(() => applyReportFeatures(rawConfig, featureValues), [rawConfig, featureValues]);
  // Print Preview States
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewPdfUrl, setPreviewPdfUrl] = useState("");
  const [previewTitle, setPreviewTitle] = useState("");
  const [currentFileName, setCurrentFileName] = useState("");
  const [currentDoc, setCurrentDoc] = useState(null);
  const [showPdfOrientationModal, setShowPdfOrientationModal] = useState(false);

  const PrintPreviewModal = ({ isOpen, onClose, pdfUrl, title, onDownload }) => {
    return (
      <AnimatePresence>
        {isOpen && (
          <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm">
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              className="bg-white rounded-2xl shadow-2xl w-full max-w-5xl h-[90vh] flex flex-col overflow-hidden border border-gray-200"
            >
              {/* Header */}
              <div className="bg-[#8b0000] px-6 py-4 flex items-center justify-between border-b border-white/10 shadow-lg">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/20 rounded-lg backdrop-blur-md">
                    <Printer className="w-5 h-5 text-white" />
                  </div>
                  <h3 className="text-xl font-bold text-white tracking-tight">
                    {title}
                  </h3>
                </div>
                <div className="flex gap-2">
                  <Button
                    onClick={handlePrint}
                    className="bg-white text-[#8b0000] hover:bg-gray-100"
                  >
                    <Printer className="h-4 w-4 mr-2" />
                    Print
                  </Button>
                  <Button
                    onClick={onDownload}
                    variant="outline"
                    className="bg-transparent border border-white text-white hover:bg-white/20 hover:text-white"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </Button>
                  <Button
                    variant="ghost"
                    size="icon"
                    onClick={onClose}
                    className="text-white hover:bg-white/20"
                  >
                    <CloseIcon className="h-5 w-5" />
                  </Button>
                </div>
              </div>

              {/* PDF Viewer */}
              <div className="flex-1 bg-gray-100 p-6 overflow-hidden relative">
                <iframe
                  src={pdfUrl}
                  className="w-full h-full rounded-xl shadow-inner border border-gray-300"
                  title="PDF Preview"
                />
              </div>

              {/* Footer */}
              <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex justify-end gap-3 text-xs text-gray-500 font-medium">
                Standard ERP Reporting System • Print Preview Mode
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    );
  };

  const handleDownloadFromPreview = () => {
    if (currentDoc && currentFileName) {
      currentDoc.save(currentFileName);
    } else if (previewPdfUrl && currentFileName) {
      const link = document.createElement("a");
      link.href = previewPdfUrl;
      link.download = currentFileName;
      document.body.appendChild(link);
      link.click();
      link.remove();
    }
  };

  const handlePrint = () => {
    if (currentDoc) {
      currentDoc.autoPrint();
      const blobUrl = currentDoc.output("bloburl");
      window.open(blobUrl, "_blank");
    } else if (previewPdfUrl) {
      window.open(previewPdfUrl, "_blank");
    }
  };
  const [apiColumns, setApiColumns] = useState([]);
  const [parameterColumns, setParameterColumns] = useState([]);
  const [filters, setFilters] = useState({});
  const [enableHorizontalScroll, setEnableHorizontalScroll] = useState(false);

  // UI state
  const [showFilters, setShowFilters] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [selectedRecord, setSelectedRecord] = useState(null);
  const [viewMode, setViewMode] = useState("table");
  const [detailRow, setDetailRow] = useState(null);
  const [isExporting, setIsExporting] = useState(false);
  const [isPostingJV, setIsPostingJV] = useState(false);
  const [showJVModal, setShowJVModal] = useState(false);
  const [showAccountOrder, setShowAccountOrder] = useState(false); // config.accountOrder
  const [jvPreview, setJvPreview] = useState(null);
  const [isLoadingJVPreview, setIsLoadingJVPreview] = useState(false);
  const [jvPosted, setJvPosted] = useState(null);
  const [sortConfig, setSortConfig] = useState({ key: null, direction: "asc" });

  // Column visibility — persisted per reportType in localStorage
  const [hiddenColumns, setHiddenColumns] = useState(() => {
    try {
      const stored = localStorage.getItem(`reportColumns_${reportType}`);
      return stored ? JSON.parse(stored) : {};
    } catch {
      return {};
    }
  });
  const [showColumnPanel, setShowColumnPanel] = useState(false);
  const [showRowsPanel, setShowRowsPanel] = useState(false);
  // KPI strip collapsed (Summary button / Alt+S) — remembered per report
  const [summaryCollapsed, setSummaryCollapsed] = useState(false);
  useEffect(() => {
    try {
      setSummaryCollapsed(localStorage.getItem(`reportSummaryCollapsed_${reportType}`) === "1");
    } catch {
      setSummaryCollapsed(false);
    }
  }, [reportType]);
  const toggleSummary = useCallback(() => {
    setSummaryCollapsed((prev) => {
      const next = !prev;
      try {
        localStorage.setItem(`reportSummaryCollapsed_${reportType}`, next ? "1" : "0");
      } catch { }
      return next;
    });
  }, [reportType]);

  // Filter panel — the field a chip opens it on, and its pending (not yet
  // applied) values, which dependent option lists load from while it is open.
  const [filterFocus, setFilterFocus] = useState(null);
  const [filterDraft, setFilterDraft] = useState(null);
  // The wide table's "Amounts" switch — the KPI strip follows "In thousands".
  const [wideAmounts, setWideAmounts] = useState("full");

  const toggleColumn = (field) => {
    setHiddenColumns((prev) => {
      const next = { ...prev, [field]: !prev[field] };
      try {
        localStorage.setItem(`reportColumns_${reportType}`, JSON.stringify(next));
      } catch { }
      return next;
    });
  };

  const resetColumns = () => {
    setHiddenColumns({});
    try {
      localStorage.removeItem(`reportColumns_${reportType}`);
    } catch { }
  };

  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(100);

  // Search state
  const [searchTerm, setSearchTerm] = useState("");
  const [searchColumn, setSearchColumn] = useState("all");

  // Debounce timer for pushing filter changes into the URL (see
  // handleFilterChange) — keeps router.replace from firing on every
  // keystroke while typing into a text filter.
  const filterUrlSyncTimer = useRef(null);

  // Animation states
  const [isFilterAnimating, setIsFilterAnimating] = useState(false);
  const [dataLoadingProgress, setDataLoadingProgress] = useState(0);
  const [summaryAnimationDelay, setSummaryAnimationDelay] = useState(0);

  const [showDrillDownModal, setShowDrillDownModal] = useState(false);
  const [drillDownRow, setDrillDownRow] = useState(null);
  const [drillDownFilters, setDrillDownFilters] = useState({});
  const [showProcessOrderModal, setShowProcessOrderModal] = useState(false);
  const [processOrderLoading, setProcessOrderLoading] = useState(false);
  const [processOrderExporting, setProcessOrderExporting] = useState(false);
  const [selectedProcessOrderBlock, setSelectedProcessOrderBlock] = useState(null);

  // TanStack Query for godowns
  const { data: godowns } = useQuery({
    queryKey: ["godowns"],
    queryFn: fetchGodowns,
    enabled: config?.dynamicColumns && reportType === "stockMetrics",
  });

  // Quality parameters are now fetched from the API response for qcParameters report
  // No need for separate query - parameterColumns will be extracted from reportData

  // Filter controls live in ./ReportFilters (panel, chips, summary-type tabs).

  // Keyboard shortcuts: Alt+F → Filters, Alt+S → Summary
  useEffect(() => {
    if (!config) return;
    const handleKeyDown = (e) => {
      if (!e.altKey) return;
      if (e.key === "f" || e.key === "F") {
        e.preventDefault();
        setFilterFocus(null);
        setShowFilters(true);
      } else if (e.key === "s" || e.key === "S") {
        if (config.summaryFields?.length > 0) {
          e.preventDefault();
          toggleSummary();
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [config, toggleSummary]);

  const getColumnLabel = (field) => {
    const col = allColumns?.find((c) => c.field === field);
    return col ? col.headerName : "All Columns";
  };

  // Reload data when columns-changing filters are modified
  useEffect(() => {
    if (config?.getColumns && filters.type) {
      const timeoutId = setTimeout(() => {
        queryClient.invalidateQueries({ queryKey: ["reportData"] });
      }, 500);
      return () => clearTimeout(timeoutId);
    }
  }, [filters.type, config, queryClient]);

  // Helper function to resolve templates
  const resolveTemplate = (template, currentFilters) => {
    if (typeof template !== "string") return template;

    return template.replace(/\{\{([^}]+)\}\}/g, (match, expression) => {
      const parts = expression.split("|").map((p) => p.trim());

      for (const part of parts) {
        if (currentFilters[part] !== undefined) {
          return currentFilters[part];
        }

        if (part.includes("→")) {
          const [condition, result] = part.split("→").map((p) => p.trim());
          const [filterName, expectedValue] = condition
            .split("=")
            .map((p) => p.trim());

          if (currentFilters[filterName] === expectedValue) {
            return result;
          }
        }

        if (!part.includes("=") && !part.includes("→")) {
          return part;
        }
      }

      return "";
    });
  };

  const handleDrillDown = (row) => {
    setDrillDownRow(row);
    setDrillDownFilters({
      ...(filters.godown && { godown: filters.godown }),
      ...(filters.dateTo && { dateTo: filters.dateTo }),
    });
    if (config.drillDown.linkBuilder && !config.drillDown.fields) {
      const link = config.drillDown.linkBuilder(row, drillDownFilters);
      goDrill(link);
    } else {
      setShowDrillDownModal(true);
    }
  };

  // Initialize configuration and filters
  useEffect(() => {
    if (!reportType) return;

    const reportConfig = REPORT_CONFIG[reportType];
    if (!reportConfig) {
      console.error("Invalid report type:", reportType);
      return;
    }

    setConfig(reportConfig);
    setApiColumns([]);

    const initialFilters = {};

    // In the useEffect that initializes filters
    reportConfig.filters.forEach((filter) => {
      // Locked filters always use their forced default — ignore URL params
      if (filter.locked && filter.default !== undefined) {
        initialFilters[filter.name] = filter.default;
        return;
      }

      const paramValue = searchParams.get(filter.name);



      if (paramValue !== null) {
        // For date filters, store as string in DD-MM-YYYY format
        if (filter.type === "date") {
          try {
            // Check if paramValue is already in DD-MM-YYYY format
            const dateRegex = /^\d{2}-\d{2}-\d{4}$/;
            if (dateRegex.test(paramValue)) {
              initialFilters[filter.name] = paramValue;
            } else {
              const dateObj = new Date(paramValue);
              if (!isNaN(dateObj)) {
                const day = String(dateObj.getDate()).padStart(2, '0');
                const month = String(dateObj.getMonth() + 1).padStart(2, '0');
                const year = dateObj.getFullYear();
                initialFilters[filter.name] = `${day}-${month}-${year}`;
              } else {
                initialFilters[filter.name] = "";
              }
            }
          } catch (e) {
            console.error(`Error parsing date for ${filter.name}:`, e);
            initialFilters[filter.name] = "";
          }
        } else {
          initialFilters[filter.name] = paramValue;
        }
      } else if (filter.default !== undefined) {
        if (filter.type === "select" && typeof filter.default === "object" && "value" in filter.default) {
          initialFilters[filter.name] = filter.default.value;
        } else if (filter.type === "date" && filter.default) {
          // Format default date if it exists
          const defaultDate = new Date(filter.default);
          if (!isNaN(defaultDate)) {
            const day = String(defaultDate.getDate()).padStart(2, '0');
            const month = String(defaultDate.getMonth() + 1).padStart(2, '0');
            const year = defaultDate.getFullYear();
            initialFilters[filter.name] = `${day}-${month}-${year}`;
          } else {
            initialFilters[filter.name] = filter.default;
          }
        } else {
          initialFilters[filter.name] = filter.default;
        }
      } else {
        initialFilters[filter.name] = "";
      }
    });


    setFilters(initialFilters);
    // Intentionally NOT depending on `searchParams`: handleFilterChange/
    // handleDateChange push every keystroke into the URL via router.replace
    // for shareability, which changes `searchParams`. If this effect also
    // re-ran on that change, it would re-derive `filters` from a
    // possibly-stale URL snapshot and stomp whatever the user just typed —
    // that's what caused text filters (e.g. Wastage/Tonage/Margin %) to only
    // ever keep the first character typed. Filters are seeded from the URL
    // once per report (on mount / report switch); after that,
    // handleFilterChange/handleDateChange are the single source of truth.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [reportType]);

  const serializeFilterDate = (value) => {
    if (!value) return null;

    if (value instanceof Date) {
      return Number.isNaN(value.getTime()) ? null : value.toISOString();
    }

    if (typeof value === "string") {
      const dateRegex = /^\d{2}-\d{2}-\d{4}$/;
      if (dateRegex.test(value)) {
        const [day, month, year] = value.split("-");
        const dateObj = new Date(Date.UTC(
          Number.parseInt(year, 10),
          Number.parseInt(month, 10) - 1,
          Number.parseInt(day, 10),
        ));
        return Number.isNaN(dateObj.getTime()) ? null : dateObj.toISOString();
      }

      const parsed = new Date(value);
      if (Number.isNaN(parsed.getTime())) return null;

      // If it's a full ISO string, it might already be UTC. 
      // But if it's YYYY-MM-DD from the URL, we should ensure it stays the same day.
      if (value.length <= 10) {
        return new Date(Date.UTC(parsed.getFullYear(), parsed.getMonth(), parsed.getDate())).toISOString();
      }
      return parsed.toISOString();
    }

    return null;
  };

  const buildQueryParams = useMemo(() => {
    const params = {
      page: currentPage,
      limit: pageSize,
      search: searchTerm,
      searchColumn: searchColumn !== "all" ? searchColumn : undefined,
      sortBy: sortConfig.key,
      sortOrder: sortConfig.direction,
      ...filters,
    };

    // Remove empty/null values and convert dates properly
    Object.keys(params).forEach((key) => {
      try {
        if (
          params[key] === null ||
          params[key] === undefined ||
          params[key] === ""
        ) {
          delete params[key];
        } else if (params[key] instanceof Date) {
          const serialized = serializeFilterDate(params[key]);
          if (serialized) {
            params[key] = serialized;
          } else {
            delete params[key];
          }
        } else if (typeof params[key] === "string" && key.toLowerCase().includes("date")) {
          const serialized = serializeFilterDate(params[key]);
          if (serialized) {
            params[key] = serialized;
          } else {
            console.warn(`Invalid date string for key ${key}: ${params[key]}`);
            delete params[key];
          }
        }
      } catch (error) {
        console.error(`Error processing filter ${key}:`, error);
        delete params[key];
      }
    });

    return params;
  }, [currentPage, pageSize, searchTerm, searchColumn, sortConfig, filters]);
  // TanStack Query for main report data
  const {
    data: reportData,
    isLoading,
    isError,
    error: queryError,
    isFetching,
    refetch,
  } = useQuery({
    queryKey: ["reportData", config, buildQueryParams],
    queryFn: fetchReportData,
    enabled: !!config && Object.keys(filters).length > 0,
    placeholderData: keepPreviousData,
    staleTime: 5 * 60 * 1000,
    gcTime: 10 * 60 * 1000,
    onSuccess: (data) => {
      if (data.config && data.config.columns) {
        setApiColumns(data.config.columns);
      } else {
        setApiColumns([]);
      }
      setSummaryAnimationDelay(200);
    },
    onError: (err) => {
      setError(err.message || "Failed to load report data");
    },
  });

  // "Compare with previous period" (the table's Display menu): the same report
  // for the period of equal length just before dateFrom..dateTo. WideTable
  // matches its rows to these by the identity columns.
  const [compareOn, setCompareOn] = useState(false);
  const prevPeriodParams = useMemo(() => {
    const from = new Date(buildQueryParams.dateFrom);
    const to = new Date(buildQueryParams.dateTo);
    if (!buildQueryParams.dateFrom || !buildQueryParams.dateTo || Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to < from) return null;
    const DAY = 86400000;
    const span = to.getTime() - from.getTime();
    return {
      ...buildQueryParams,
      dateFrom: new Date(from.getTime() - span - DAY).toISOString(),
      dateTo: new Date(from.getTime() - DAY).toISOString(),
    };
  }, [buildQueryParams]);
  const { data: prevReportData, isFetching: prevFetching } = useQuery({
    queryKey: ["reportData", config, prevPeriodParams],
    queryFn: fetchReportData,
    enabled: !!config && compareOn && !!prevPeriodParams,
    staleTime: 5 * 60 * 1000,
  });
  const prevRows = useMemo(() => {
    const src = Array.isArray(prevReportData?.allData) ? prevReportData.allData : prevReportData?.data;
    return Array.isArray(src) ? src : null;
  }, [prevReportData]);

  // Extract data from query result
  const data = reportData?.data || [];
  const allData = reportData?.allData || [];
  const summary = reportData?.summary || {};
  const totalRecords = reportData?.pagination?.total || 0;
  const startRecord = reportData?.pagination?.startRecord || 0;
  const endRecord = reportData?.pagination?.endRecord || 0;
  const totalPages = reportData?.pagination?.totalPages || 0;

  const processedTableData = useMemo(() => {
    if (!data || data.length === 0) return [];

    const isSalesOrderBalance = reportType === 'salesOrderBalance';
    const shouldGroup = isSalesOrderBalance && filters.showCustomerTotal;

    if (!shouldGroup) {
      return data;
    }

    const resultRows = [];
    let lastCustomer = null;
    let customerTotalOrdered = 0;
    let customerTotalShip = 0;
    let customerTotalPending = 0;

    data.forEach((item, index) => {
      const currentCustomer = (item.customer || "").trim();

      if (lastCustomer !== null && currentCustomer !== lastCustomer) {
        resultRows.push({
          _isCustomerTotalRow: true,
          customer: "Customer Total:",
          totalOrdered: customerTotalOrdered,
          totalShip: customerTotalShip,
          totalPending: customerTotalPending,
        });
        customerTotalOrdered = 0;
        customerTotalShip = 0;
        customerTotalPending = 0;
      }

      lastCustomer = currentCustomer;
      customerTotalOrdered += item.totalOrdered || 0;
      customerTotalShip += item.totalShip || 0;
      customerTotalPending += item.totalPending || 0;

      resultRows.push({
        ...item,
        _isDataRow: true,
      });

      if (index === data.length - 1) {
        resultRows.push({
          _isCustomerTotalRow: true,
          customer: "Customer Total:",
          totalOrdered: customerTotalOrdered,
          totalShip: customerTotalShip,
          totalPending: customerTotalPending,
        });
      }
    });

    return resultRows;
  }, [data, reportType, filters.showCustomerTotal]);

  // Grouped reports (document header + lines, sections, hierarchies) render
  // through the wide engine with `layout.groupRows` (components/Reports/
  // layout.js) — the old config.groupedDetailView table is gone (rule 15).

  // Extract parameter columns from API response if available
  useEffect(() => {
    if (reportData?.parameterColumns && reportData.parameterColumns.length > 0) {
      setParameterColumns(reportData.parameterColumns);
    }
  }, [reportData?.parameterColumns]);

  // Accounts Activity compare-months mode returns dynamic net-per-month columns
  // from the API. Sync them into apiColumns (onSuccess is a no-op in RQ v5).
  useEffect(() => {
    if (reportType === "accountsActivity") {
      if (filters.compareMonths && reportData?.config?.columns) {
        setApiColumns(reportData.config.columns);
      } else {
        setApiColumns([]);
      }
    }
  }, [reportType, filters.compareMonths, reportData?.config?.columns]);

  // Stock Activity "Godown Wise": the API appends an IN/OUT column pair for
  // every godown that moved stock, so use the column list it returns.
  useEffect(() => {
    if (reportType === "stockActivity") {
      if (filters.godownWise && reportData?.config?.columns) {
        setApiColumns(reportData.config.columns);
      } else {
        setApiColumns([]);
      }
    }
  }, [reportType, filters.godownWise, reportData?.config?.columns]);

  // Reports with a services breakdown (config.services — GRN, dispatch,
  // purchase, sale …): the API sends one column per service used plus the
  // totals (lib/service/landedCost.js); they go after the view's own columns,
  // under a "Services" band (components/Reports/layout.js).
  // Reports with config.apiExtraColumns (Stock Activity With Rate, COGS: one
  // column per service category) get the API's columns as sent — each names
  // its band and position (`extra: { id, label, before }`).
  const serviceColumns = useMemo(() => {
    if (config?.apiExtraColumns) return reportData?.config?.extraColumns || [];
    if (!config?.services) return [];
    return (reportData?.config?.extraColumns || []).map((c) => ({
      ...c,
      extra: { id: "services", label: "Services", foldTo: "services_amount" },
    }));
  }, [config?.services, config?.apiExtraColumns, reportData?.config?.extraColumns]);

  // Reports whose columns depend on the data (config.apiColumns, e.g. HR
  // Leave taken: one column per leave type used) take the API's column list.
  useEffect(() => {
    if (config?.apiColumns) setApiColumns(reportData?.config?.columns || []);
  }, [config?.apiColumns, reportData?.config?.columns]);

  // Fetch filter options using TanStack Query. While the filter panel is open
  // a dependent list (e.g. orders of the chosen customer) follows the panel's
  // pending value, so it can be picked before Apply.
  const optionFilters = filterDraft || filters;
  const filterQueries = useQueries({
    queries:
      config?.filters
        ?.filter((filter) => filter.apiEndpoint)
        ?.map((filter) => {
          const endpoint = resolveTemplate(filter.apiEndpoint, optionFilters);

          if (
            filter.dependsOn &&
            !optionFilters[filter.dependsOn] &&
            filter.dependsOnRequired !== false
          ) {
            return {
              queryKey: ["filterOption", "skip"],
              queryFn: () => [],
              enabled: false,
            };
          }

          return {
            queryKey: ["filterOption", endpoint],
            queryFn: fetchFilterOptions,
            enabled: !!endpoint && !!config,
            staleTime: 5 * 60 * 1000,
          };
        }) || [],
  });

  // Build filter options from query results
  const filterOptions = useMemo(() => {
    const options = {};

    config?.filters?.forEach((filter, index) => {
      if (filter.apiEndpoint) {
        const queryIndex = config.filters
          .slice(0, index)
          .filter((f) => f.apiEndpoint).length;

        if (
          queryIndex < filterQueries.length &&
          filterQueries[queryIndex]?.data
        ) {
          options[filter.name] = filterQueries[queryIndex].data;
        } else {
          options[filter.name] = [];
        }
      } else if (filter.options) {
        options[filter.name] = filter.options.map((opt) => ({
          value: opt.value || opt,
          label: opt.label || opt,
        }));
      }
    });

    return options;
  }, [config, filterQueries]);

  const getFilterLabel = useCallback((filterName, value) => {
    if (!value || value === "all" || value === "") return null;

    const filterCfg = config?.filters?.find(f => f.name === filterName);
    if (!filterCfg) return value;

    const options = filterOptions[filterName] || [];

    const getSingleLabel = (val) => {
      const found = options.find(opt => {
        const optValue = String(opt[filterCfg.valueKey || "value"] || opt.value || opt.id || "");
        return optValue === String(val);
      });

      if (found) {
        if (filterCfg.nameKeys && Array.isArray(filterCfg.nameKeys)) {
          const labelParts = filterCfg.nameKeys.map(k => found[k]).filter(v => v != null && v !== "");
          return labelParts.length > 0 ? labelParts.join(filterCfg.separator || " - ") : val;
        }
        return found.label || found.name || found[filterCfg.nameKey || "label"] || val;
      }
      return val;
    };

    if (filterCfg.multiple || filterCfg.isMulti || Array.isArray(value) || (typeof value === "string" && value.includes(","))) {
      const values = Array.isArray(value) ? value : String(value).split(",");
      const labels = values.map(v => getSingleLabel(v.trim())).filter(Boolean);
      return labels.length > 0 ? labels.join(", ") : value;
    }

    return getSingleLabel(value);
  }, [config, filterOptions]);

  const periodInfo = useMemo(() => {
    const formatDateForPeriod = (val) => {
      if (!val) return "";
      let d = val;
      if (typeof val === "string") {
        const dateRegex = /^\d{2}-\d{2}-\d{4}$/;
        if (dateRegex.test(val)) {
          const [day, month, year] = val.split("-");
          d = new Date(year, month - 1, day);
        } else {
          d = new Date(val);
        }
      }
      return isNaN(d?.getTime?.() || NaN)
        ? String(val)
        : format(d, "d-MMM-yyyy");
    };

    const from = filters.dateFrom || "01-01-2000";
    const to = filters.dateTo || format(new Date(), "dd-MM-yyyy");
    let info = `  |  Period: ${formatDateForPeriod(from)} to ${formatDateForPeriod(to)}`;

    // Add other active filters dynamically on a new line
    let extraFilters = "";
    if (config?.filters) {
      config.filters.forEach(f => {
        if (f.type !== "date" && filters[f.name] && filters[f.name] !== "all" && filters[f.name] !== "") {
          const label = getFilterLabel(f.name, filters[f.name]);
          if (label) {
            extraFilters += (extraFilters ? "  |  " : "") + `${f.label}: ${label}`;
          }
        }
      });
    }

    if (extraFilters) {
      info += `\n${extraFilters}`;
    }

    return info;
  }, [filters, config, getFilterLabel]);

  const handlePageChange = (page) => {
    setCurrentPage(page);
  };

  const handlePageSizeChange = (newPageSize) => {
    setPageSize(parseInt(newPageSize));
    setCurrentPage(1);
  };

  // Data scope: a report that shows ONE godown at a time, run by a user
  // limited to several (Admin → Permissions), comes back asking for a choice.
  // Pick their first permitted one for them and say so, instead of erroring.
  const scopeChoiceHandledRef = useRef(null);
  useEffect(() => {
    const body = queryError?.response?.data;
    if (queryError?.response?.status !== 400 || !body?.filter || !body?.options?.length) return;
    const key = `${body.filter}:${body.options.join(",")}`;
    if (scopeChoiceHandledRef.current === key) return;
    scopeChoiceHandledRef.current = key;
    const first = String(body.options[0]);
    const name = (godowns || []).find((g) => String(g.id) === first)?.godown;
    handleFilterChange(body.filter, { value: first, label: name ? `${first} - ${name}` : first }, true);
    toast.info(
      `This report shows one ${body.filter} at a time — showing ${name || first}. Switch in the filter to see your others.`,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [queryError, godowns]);

  const handleFilterChange = (name, value, skipAnimation = false) => {
    if (!skipAnimation) {
    setIsFilterAnimating(true);
    setTimeout(() => setIsFilterAnimating(false), 300);
    }

    let filterValue = value;
    if (value === "All" || value === "all") {
      filterValue = "";
    }

    const newFilters = { ...filters, [name]: filterValue };

    if (config?.filters) {
      config.filters.forEach((f) => {
        if (f.dependsOn === name && f.clearOnDependencyChange !== false) {
          newFilters[f.name] = "";
        }
      });
    }

    setFilters(newFilters);
    setCurrentPage(1);

    // Push the URL update after a short pause instead of on every keystroke.
    // handleFilterChange can fire many times a second while typing into a
    // text filter (Wastage %, Tonage, Margin %, ...) — router.replace()-ing
    // on every one of those is unnecessary (it's purely for shareable/
    // bookmarkable URLs, not for local state, which setFilters above already
    // updated instantly) and was a source of jank/focus issues while typing.
    if (filterUrlSyncTimer.current) clearTimeout(filterUrlSyncTimer.current);
    filterUrlSyncTimer.current = setTimeout(() => {
      const params = new URLSearchParams();
      Object.entries(newFilters).forEach(([key, val]) => {
        if (val !== null && val !== undefined && val !== "") {
          if (val instanceof Date) {
            params.append(key, val.toISOString());
          } else {
            params.append(key, val);
          }
        }
      });
      router.replace(`?${keepReservedParams(params).toString()}`);
    }, 400);
  };

  const handleDateChange = (name, value) => {


    // Ensure value is a string
    let stringValue = "";

    if (value instanceof Date && !isNaN(value)) {
      const day = String(value.getDate()).padStart(2, '0');
      const month = String(value.getMonth() + 1).padStart(2, '0');
      const year = value.getFullYear();
      stringValue = `${day}-${month}-${year}`;
    } else if (typeof value === 'string') {
      stringValue = value;
    } else if (value === null || value === undefined) {
      stringValue = "";
    } else {
      stringValue = String(value);
    }



    // Store as string
    const newFilters = { ...filters, [name]: stringValue };

    setFilters(newFilters);
    setCurrentPage(1);

    const params = new URLSearchParams();

    Object.entries(newFilters).forEach(([key, val]) => {
      if (val !== null && val !== undefined && val !== "") {
        params.append(key, val);
      }
    });

    router.replace(`?${keepReservedParams(params).toString()}`);
  };

  // Several filter changes at once (panel Apply, chip ×, Clear all) — the same
  // state + address update handleFilterChange makes for one change.
  const commitFilters = (next) => {
    setFilters(next);
    setCurrentPage(1);
    if (filterUrlSyncTimer.current) clearTimeout(filterUrlSyncTimer.current);
    const params = new URLSearchParams();
    Object.entries(next).forEach(([key, val]) => {
      if (val !== null && val !== undefined && val !== "") {
        params.append(key, val instanceof Date ? val.toISOString() : val);
      }
    });
    router.replace(`?${keepReservedParams(params).toString()}`);
  };

  // Panel Apply: results cached for other filter sets count as stale, so the
  // applied set is fetched fresh — as the old "Apply & Close" refresh did.
  const applyPanelFilters = (next) => {
    queryClient.invalidateQueries({ queryKey: ["reportData"], refetchType: "none" });
    commitFilters(next);
  };

  const removeFilters = (names) =>
    commitFilters(names.reduce((acc, n) => withDependents(config.filters, acc, n, ""), { ...filters }));

  const openFilters = (field = null) => {
    setFilterFocus(field);
    setShowFilters(true);
  };

  const handleSort = (key) => {
    setSortConfig((prev) => ({
      key,
      direction: prev.key === key && prev.direction === "asc" ? "desc" : "asc",
    }));
  };

  const getProcessOrderQuery = () => {
    const params = new URLSearchParams();
    const dateFrom = serializeFilterDate(filters.dateFrom);
    const dateTo = serializeFilterDate(filters.dateTo);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    return params;
  };

  const fetchProcessOrderDetails = async (processOrderId) => {
    setShowProcessOrderModal(true);
    setProcessOrderLoading(true);
    try {
      const params = getProcessOrderQuery();
      const response = await fetch(
        `/api/reports/processOrderReconciliation/${processOrderId}?${params.toString()}`,
      );
      if (!response.ok) {
        throw new Error("Failed to fetch process order details");
      }
      const result = await response.json();
      setSelectedProcessOrderBlock(result.processOrder || null);
    } catch (err) {
      console.error(err);
      setSelectedProcessOrderBlock(null);
      alert("Failed to load process order details.");
    } finally {
      setProcessOrderLoading(false);
    }
  };

  const exportSingleProcessOrder = async (type) => {
    if (!selectedProcessOrderBlock) return;
    const processOrderId = selectedProcessOrderBlock.processOrder || "123";
    setProcessOrderExporting(true);
    try {
      const params = getProcessOrderQuery();
      const endpoint =
        type === "pdf"
          ? `/api/reports/processOrderReconciliation/${processOrderId}/pdf`
          : `/api/reports/processOrderReconciliation/${processOrderId}/excel`;

      const response = await fetch(`${endpoint}?${params.toString()}`, {
        method: "GET",
      });

      if (!response.ok) {
        throw new Error(`Failed to export process order ${type.toUpperCase()}`);
      }

      const blob = await response.blob();
      const url = window.URL.createObjectURL(blob);

      if (type === "pdf") {
        setPreviewPdfUrl(url);
        setPreviewTitle(`Process Order - ${processOrderId === "123" ? "Unassigned" : processOrderId}`);
        setCurrentFileName(`Process_Order_${processOrderId === "123" ? "Unassigned" : processOrderId}.pdf`);
        setCurrentDoc(null);
        setIsPreviewOpen(true);
      } else {
        const link = document.createElement("a");
        link.href = url;
        link.download = `Process_Order_${processOrderId === "123" ? "Unassigned" : processOrderId}.xlsx`;
        document.body.appendChild(link);
        link.click();
        link.remove();
        // window.URL.revokeObjectURL(url); // Don't revoke immediately if we might need it, but for excel it's fine
      }
    } catch (err) {
      console.error(err);
      alert(`Failed to export ${type.toUpperCase()}.`);
    } finally {
      setProcessOrderExporting(false);
    }
  };

  const handleRowClick = (row) => {
    if (reportType === "processOrderReconciliation") {
      const processOrderId = row?.process_order_no || "123";
      fetchProcessOrderDetails(processOrderId);
      return;
    }

    if (config.detailColumns) {
      setSelectedRecord(row);
      setDetailRow(row.transactions || row.orderDetails || row.materials || []);
      setShowDetails(true);
    }
  };

  const handleRefresh = () => {
    queryClient.invalidateQueries({ queryKey: ["reportData"] });
    filterQueries.forEach((query, index) => {
      const filter = config?.filters?.filter((f) => f.apiEndpoint)[index];
      if (filter) {
        const endpoint = resolveTemplate(filter.apiEndpoint, filters);
        if (endpoint) {
          queryClient.invalidateQueries({
            queryKey: ["filterOption", endpoint],
          });
        }
      }
    });
  };

  const handleExport = async (format) => {
    if (!data || data.length === 0) return;

    setIsExporting(true);

    try {
      switch (format) {
        case "excel":
          await exportToExcel();
          break;
        case "pdf":
          if (reportType === "bom") {
            await exportBOMPDF(session);
          } else if (reportType === "processOrderReconciliation") {
            await exportProcessOrderReconciliationPDF();
          } else {
            await exportToPDF();
          }
          break;
        case "csv":
          await exportToCSV();
          break;
        default:
          console.error(" Unknown export format:", format);
      }
    } catch (error) {
      console.error("Export error:", error);
    } finally {
      setIsExporting(false);
    }
  };

  // ── Journal Voucher (tran_code 3) preview + post from the current report ──
  // Step 1: open the modal and fetch a non-persisting preview of the voucher.
  const openJVPreview = async () => {
    if (!config.postJV) return;
    setShowJVModal(true);
    setJvPreview(null);
    setJvPosted(null);
    setIsLoadingJVPreview(true);
    try {
      const res = await axios.post(config.apiEndpoint, {
        action: "postJV",
        preview: true,
        filters: buildQueryParams,
      });
      setJvPreview(res.data);
    } catch (err) {
      const data = err?.response?.data;
      toast.error(data?.error || "Failed to build Journal Voucher preview.");
      setShowJVModal(false);
    } finally {
      setIsLoadingJVPreview(false);
    }
  };

  // Step 2: commit the voucher (server recomputes + persists).
  const handlePostJV = async () => {
    if (!config.postJV) return;
    setIsPostingJV(true);
    try {
      const res = await axios.post(config.apiEndpoint, {
        action: "postJV",
        preview: false,
        filters: buildQueryParams,
      });
      // Keep the modal open and show an in-place "posted" confirmation.
      setJvPosted(res.data);
    } catch (err) {
      const data = err?.response?.data;
      const detail = Array.isArray(data?.details) && data.details.length > 0
        ? data.details.join(", ")
        : undefined;
      toast.error(data?.error || "Failed to post Journal Voucher.", { description: detail });
    } finally {
      setIsPostingJV(false);
    }
  };

  const exportBOMPDF = async (session) => {
    try {
      setIsExporting(true);

      const bomIds = allData
        .map((bom) => bom.bomId || bom.id)
        .filter((id) => id);

      if (bomIds.length === 0) {
        alert("No BOM records found");
        return;
      }

      const response = await axios.post("/api/manufacturing/bom/bulk", {
        ids: bomIds,
      });

      const bomData = response.data.data;

      if (!bomData || bomData.length === 0) {
        alert("No BOM details found");
        return;
      }

      const formattedBOMs = bomData.map((bom) => ({
        bomNo: String(bom.id).padStart(5),
        bomDate: format(new Date(bom.dateCreated), "dd-MMM-yy").toUpperCase(),
        productNo: String(bom.finishedId),
        jobNo: bom.jobNo || "N/A",
        productName: bom.productName || "N/A",
        productCategory: bom.productCategory || "N/A",
        user: bom.createdBy || "System",
        items: (bom.materials || []).map((material) => ({
          mm: String(material.id),
          code: material.code || "N/A",
          desc: material.name || "N/A",
          category: material.category || "N/A",
          pct: String(material.percentage || 0),
        })),
      }));

      const doc = generateBOMPDF(formattedBOMs, session, company);

      const timestamp = format(new Date(), "yyyy-MM-dd_HHmm");
      const blobUrl = doc.output("bloburl");
      setPreviewPdfUrl(blobUrl);
      setPreviewTitle(`BOM Report - ${timestamp}`);
      setCurrentFileName(`BOM_Report_${timestamp}.pdf`);
      setCurrentDoc(doc);
      setIsPreviewOpen(true);
    } catch (error) {
      console.error("BOM PDF Error:", error);
      alert(`Failed to generate BOM PDF: ${error.message}`);
    } finally {
      setIsExporting(false);
    }
  };

  const exportProcessOrderReconciliationPDF = async () => {
    const params = new URLSearchParams();
    const dateFrom = serializeFilterDate(filters.dateFrom);
    const dateTo = serializeFilterDate(filters.dateTo);
    if (dateFrom) params.set("dateFrom", dateFrom);
    if (dateTo) params.set("dateTo", dateTo);
    if (filters.processOrder) params.set("processOrder", filters.processOrder);
    if (filters.item) params.set("item", filters.item);
    if (filters.category) params.set("category", filters.category);

    const response = await fetch(`/api/reports/processOrderReconciliation/pdf?${params.toString()}`, {
      method: "GET",
    });

    if (!response.ok) {
      throw new Error("Failed to generate process order reconciliation PDF");
    }

    const blob = await response.blob();
    const url = window.URL.createObjectURL(blob);
    const timestamp = format(new Date(), "yyyy-MM-dd_HHmm");

    setPreviewPdfUrl(url);
    setPreviewTitle(`Process Order Reconciliation - ${timestamp}`);
    setCurrentFileName(`Process_Order_Reconciliation_${timestamp}.pdf`);
    setCurrentDoc(null); // It's a blob URL
    setIsPreviewOpen(true);
  };

  const exportToExcel = async () => {
    const workbook = XLSX.utils.book_new();

    const getExcelRichText = (text) => {
      const parts = text.split(/(\n|\s*\|\s*)/);
      const richText = [];
      parts.forEach(part => {
        if (part === '\n' || part.trim() === '|') {
          richText.push({ t: part });
        } else if (part.includes(':')) {
          const colonIndex = part.indexOf(':');
          const label = part.substring(0, colonIndex + 1);
          const val = part.substring(colonIndex + 1);
          // Standard style for labels and values
          richText.push({ t: label, s: { font: { bold: true, italic: true, sz: 12, color: { rgb: "2C3E50" } } } });
          richText.push({ t: val || "", s: { font: { italic: true, sz: 12, color: { rgb: "2C3E50" } } } });
        } else {
          richText.push({ t: part, s: { font: { italic: true, sz: 12, color: { rgb: "2C3E50" } } } });
        }
      });
      return richText;
    };

    const formatCellValue = (value) => {
      if (isQCReport) {
        if (
          value === null ||
          value === undefined ||
          value === "" ||
          value === 0 ||
          value === "0"
        ) {
          return "";
        }
        return value;
      }
      if (
        value === null ||
        value === undefined ||
        value === 0 ||
        value === "0"
      ) {
        return "0";
      }

      // Check if value is a valid ISO date string (YYYY-MM-DDTHH:mm:ss)
      if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(value)) {
        const date = new Date(value);
        if (!isNaN(date)) {
          return format(date, "MMM dd, yyyy"); // Format to: Mar 12, 2026
        }
      }

      return value;
    };
    const calculateColumnWidth = (data, columnKey) => {
      const headerLength = columnKey.length;
      const maxContentLength = Math.max(
        ...data.map((row) =>
          row[columnKey] ? row[columnKey].toString().length : 0,
        ),
      );

      if (
        columnKey.toLowerCase().includes("item") ||
        columnKey.toLowerCase().includes("name")
      ) {
        return Math.min(Math.max(headerLength, maxContentLength, 25), 40);
      }
      return Math.min(Math.max(headerLength, maxContentLength, 10), 30);
    };

    const showDetails =
      config.detailColumns &&
      allData.some((item) => {
        return (
          item[config.detailData || "transactions"] &&
          item[config.detailData || "transactions"].length > 0
        );
      });



    const summaryTypeVal = typeof filters?.type === "object" ? filters?.type?.value : filters?.type;
    const isDispatchReport = reportType === "dispatch";
    const isCustomerSummaryType = isDispatchReport ? summaryTypeVal === "customer" : true;

    // A row_type stream (layout.groupRows) is not customer blocks.
    if (config.layout === 'nested' && !wideModel?.groupRows && isCustomerSummaryType && (reportType !== 'salesOrderBalance' || filters.showCustomerTotal)) {
      const isSalesOrderBalance = reportType === 'salesOrderBalance';
      const aoaData = [];
      const merges = [];

      const safeDate = (val) => {
        if (!val) return "N/A";
        const d = new Date(val);
        return isNaN(d.getTime()) ? "N/A" : format(d, "MMM dd, yyyy");
      };

      // Ensure data is strictly sorted for grouping
      // Find min orderDate for each customer to determine their global order
      const customerMinDates = {};
      allData.forEach((item) => {
        const cust = (isSalesOrderBalance ? (item.customer || "") : (item.acno?.acname || "")).trim().toLowerCase();
        const d = new Date(isSalesOrderBalance ? item.orderDate : item.dated);
        if (!customerMinDates[cust] || d < customerMinDates[cust]) {
          customerMinDates[cust] = d;
        }
      });

      // Ensure data is strictly sorted for grouping
      const sortedData = [...allData].sort((a, b) => {
        const custA = (isSalesOrderBalance ? (a.customer || "") : (a.acno?.acname || "")).trim().toLowerCase();
        const custB = (isSalesOrderBalance ? (b.customer || "") : (b.acno?.acname || "")).trim().toLowerCase();

        // 1. Sort by customer's oldest record date
        const minDateA = customerMinDates[custA];
        const minDateB = customerMinDates[custB];
        if (minDateA - minDateB !== 0) {
          return minDateA - minDateB;
        }

        // 2. Sort by customer name alphabetically if min dates are identical
        if (custA !== custB) return custA.localeCompare(custB);

        // 3. Sort individual records by date ascending
        const dateA = new Date(isSalesOrderBalance ? a.orderDate : a.dated);
        const dateB = new Date(isSalesOrderBalance ? b.orderDate : b.dated);
        if (dateA - dateB !== 0) return dateA - dateB;

        const isoA = isSalesOrderBalance ? (a.orderNo || 0) : (a.so_no || 0);
        const isoB = isSalesOrderBalance ? (b.orderNo || 0) : (b.so_no || 0);
        return isoA - isoB;
      });

      // 1. Company Header
      aoaData.push([{ v: company?.name || (isSalesOrderBalance ? "Sales Order Balance Report" : "Dispatch Report"), s: { font: { bold: true, sz: 16, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "800000" } }, alignment: { horizontal: "center" } } }]);
      merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: config.detailColumns.length - 1 } });

      // 2. Generated Date
      const subtitleText = `Generated by: ${session?.user?.name || "System"}${periodInfo}`;
      aoaData.push([{
        v: subtitleText,
        r: getExcelRichText(subtitleText),
        s: { font: { italic: true }, alignment: { horizontal: "left", vertical: "center", wrapText: true } }
      }]);
      merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: config.detailColumns.length - 1 } });

      let lastCustomer = null;
      let customerTotalOrdered = 0;
      let customerTotalShip = 0;
      let customerTotalPending = 0;
      let customerTotalQty = 0;

      sortedData.forEach((item, index) => {
        const currentCustomer = (isSalesOrderBalance ? (item.customer || "") : (item.acno?.acname || "")).trim();

        // Customer Change -> Push Customer Total
        if (lastCustomer !== null && currentCustomer !== lastCustomer) {
          const midCustFooterRow = new Array(config.detailColumns.length).fill({ v: "", s: { fill: { fgColor: { rgb: "C8C8C8" } } } });
          if (isSalesOrderBalance) {
            midCustFooterRow[config.detailColumns.length - 4] = { v: "Customer Total:", s: { font: { bold: true }, fill: { fgColor: { rgb: "C8C8C8" } }, alignment: { horizontal: "right" } } };
            midCustFooterRow[config.detailColumns.length - 3] = { v: customerTotalOrdered.toFixed(2), s: { font: { bold: true }, fill: { fgColor: { rgb: "C8C8C8" } }, alignment: { horizontal: "center" } } };
            midCustFooterRow[config.detailColumns.length - 2] = { v: customerTotalShip.toFixed(2), s: { font: { bold: true }, fill: { fgColor: { rgb: "C8C8C8" } }, alignment: { horizontal: "center" } } };
            midCustFooterRow[config.detailColumns.length - 1] = { v: customerTotalPending.toFixed(2), s: { font: { bold: true }, fill: { fgColor: { rgb: "C8C8C8" } }, alignment: { horizontal: "center" } } };
          } else {
            midCustFooterRow[config.detailColumns.length - 2] = { v: "Customer Total:", s: { font: { bold: true }, fill: { fgColor: { rgb: "C8C8C8" } }, alignment: { horizontal: "right" } } };
            midCustFooterRow[config.detailColumns.length - 1] = { v: customerTotalQty.toFixed(2), s: { font: { bold: true }, fill: { fgColor: { rgb: "C8C8C8" } }, alignment: { horizontal: "center" } } };
          }
          aoaData.push(midCustFooterRow);
          customerTotalOrdered = 0;
          customerTotalShip = 0;
          customerTotalPending = 0;
          customerTotalQty = 0;
        }

        // New Customer Header
        if (currentCustomer !== lastCustomer) {
          lastCustomer = currentCustomer;
          aoaData.push([{
            v: `Customer: ${currentCustomer}`,
            s: { font: { bold: true, color: { rgb: "FFFFFF" } }, fill: { fgColor: { rgb: "800000" } }, alignment: { horizontal: "center" } }
          }]);
          merges.push({ s: { r: aoaData.length - 1, c: 0 }, e: { r: aoaData.length - 1, c: config.detailColumns.length - 1 } });
        }

        if (isSalesOrderBalance) {
          customerTotalOrdered += item.totalOrdered || 0;
          customerTotalShip += item.totalShip || 0;
          customerTotalPending += item.totalPending || 0;
        } else {
          const currentItemTotal = item.transactions?.reduce((sum, t) => sum + (parseFloat(t.qty) || 0), 0) || 0;
          customerTotalQty += currentItemTotal;
        }

        // ISO Row
        const ISO_STYLE = { font: { bold: true }, fill: { fgColor: { rgb: "F0F0F0" } }, alignment: { horizontal: "center" }, border: { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } } };
        if (isSalesOrderBalance) {
          aoaData.push([
            { v: `Date: ${safeDate(item.orderDate)}`, s: ISO_STYLE },
            { v: `ISO: ${item.orderNo}`, s: ISO_STYLE },
            { v: `PO#: ${item.sale_po || ""}`, s: ISO_STYLE },
            { v: "", s: ISO_STYLE },
            { v: "", s: ISO_STYLE }
          ]);
        } else {
          aoaData.push([
            { v: `Date: ${safeDate(item.dated)}`, s: ISO_STYLE },
            { v: `ISO: ${item.so_no}`, s: ISO_STYLE },
            { v: `Dispatch#: ${item.dispatch_no}`, s: ISO_STYLE },
            { v: item.invoice_no ? `Invoice#: ${item.invoice_no}` : "Invoice#:", s: ISO_STYLE },
            { v: "", s: ISO_STYLE } // 5th empty cell with border
          ]);
        }

        // Sub-Headers Row (MM#, etc.)
        const SUB_HEADER_STYLE = { font: { bold: true, color: { rgb: "000000" } }, fill: { fgColor: { rgb: "C8C8C8" } }, alignment: { horizontal: "center" } };
        aoaData.push(config.detailColumns.map(col => ({ v: col.headerName, s: SUB_HEADER_STYLE })));

        // Detail Rows
        item.transactions?.forEach(detail => {
          aoaData.push(config.detailColumns.map(col => {
            const val = col.valueGetter ? col.valueGetter({ row: detail }) : detail[col.field];
            return { v: formatCellValue(val), s: { alignment: { horizontal: "center" }, border: { top: { style: "thin" }, bottom: { style: "thin" }, left: { style: "thin" }, right: { style: "thin" } } } };
          }));
        });

        // Item Footer (Total Dispatch / Order Total)
        const FOOTER_STYLE = { font: { bold: true }, fill: { fgColor: { rgb: "C8C8C8" } }, alignment: { horizontal: "center" } };
        const footerRow = new Array(config.detailColumns.length).fill({ v: "", s: FOOTER_STYLE });
        if (isSalesOrderBalance) {
          footerRow[config.detailColumns.length - 4] = { v: "Order Total:", s: { ...FOOTER_STYLE, alignment: { horizontal: "right" } } };
          footerRow[config.detailColumns.length - 3] = { v: item.totalOrdered.toFixed(2), s: FOOTER_STYLE };
          footerRow[config.detailColumns.length - 2] = { v: (item.totalShip || 0).toFixed(2), s: FOOTER_STYLE };
          footerRow[config.detailColumns.length - 1] = { v: item.totalPending.toFixed(2), s: FOOTER_STYLE };
        } else {
          const currentItemTotal = item.transactions?.reduce((sum, t) => sum + (parseFloat(t.qty) || 0), 0) || 0;
          footerRow[config.detailColumns.length - 2] = { v: "Total Dispatch:", s: { ...FOOTER_STYLE, alignment: { horizontal: "right" } } };
          footerRow[config.detailColumns.length - 1] = { v: currentItemTotal.toFixed(2), s: FOOTER_STYLE };
        }
        aoaData.push(footerRow);

        // Last record -> Push final Customer Total
        if (index === sortedData.length - 1) {
          const custFooterRow = new Array(config.detailColumns.length).fill({ v: "", s: { fill: { fgColor: { rgb: "C8C8C8" } } } });
          if (isSalesOrderBalance) {
            custFooterRow[config.detailColumns.length - 4] = { v: "Customer Total:", s: { font: { bold: true }, fill: { fgColor: { rgb: "C8C8C8" } }, alignment: { horizontal: "right" } } };
            custFooterRow[config.detailColumns.length - 3] = { v: customerTotalOrdered.toFixed(2), s: { font: { bold: true }, fill: { fgColor: { rgb: "C8C8C8" } }, alignment: { horizontal: "center" } } };
            custFooterRow[config.detailColumns.length - 2] = { v: customerTotalShip.toFixed(2), s: { font: { bold: true }, fill: { fgColor: { rgb: "C8C8C8" } }, alignment: { horizontal: "center" } } };
            custFooterRow[config.detailColumns.length - 1] = { v: customerTotalPending.toFixed(2), s: { font: { bold: true }, fill: { fgColor: { rgb: "C8C8C8" } }, alignment: { horizontal: "center" } } };
          } else {
            custFooterRow[config.detailColumns.length - 2] = { v: "Customer Total:", s: { font: { bold: true }, fill: { fgColor: { rgb: "C8C8C8" } }, alignment: { horizontal: "right" } } };
            custFooterRow[config.detailColumns.length - 1] = { v: customerTotalQty.toFixed(2), s: { font: { bold: true }, fill: { fgColor: { rgb: "C8C8C8" } }, alignment: { horizontal: "center" } } };
          }
          aoaData.push(custFooterRow);
        }
      });

      const worksheet = XLSX.utils.aoa_to_sheet(aoaData);
      worksheet["!merges"] = merges;

      // Auto-size columns
      // const wscols = config.detailColumns.map((col, i) => {
      //   if (i === 1) return { wch: 40 }; // Product Description
      //   return { wch: 20 };
      // });
      const wscols = config.detailColumns.map((col) => {
        const header = col.headerName.toUpperCase();
        if (header.includes("ITEM") || header.includes("DESCRIPTION") || header.includes("GOODS")) {
          return { wch: 60 }; // Wide for item names
        }
        if (header.includes("MM#") || header.includes("CODE")) {
          return { wch: 25 }; // Medium for codes
        }
        return { wch: 15 };
      });
      worksheet["!cols"] = wscols;

      XLSX.utils.book_append_sheet(workbook, worksheet, isSalesOrderBalance ? "Sales Order Balance" : "Dispatch Report");
      const timestamp = format(new Date(), "yyyy-MM-dd_HHmm");
      XLSX.writeFile(workbook, `${isSalesOrderBalance ? "Sales_Order_Balance" : "Dispatch_Report"}_${timestamp}.xlsx`);
      return;
    }

    if (showDetails) {
      const detailData = [];
      allData.forEach((item) => {
        const detailItems = item[config.detailData || "transactions"];

        if (detailItems && detailItems.length > 0) {
          detailItems.forEach((detail) => {
            const detailRow = {};

            if (reportType === "bom") {
              detailRow["BOM ID"] = formatCellValue(detail.bom_id) || "";
            } else {
              detailRow["Date"] = formatCellValue(item.dated) || "";
              if (item.tran_id) {
                detailRow["Transaction #"] =
                  formatCellValue(item.tran_id) || "";
              }
              if (reportType === "sale") {
                if (item.so_no) {
                  detailRow["ISO"] = formatCellValue(item.so_no) || "";
                }
                if (item.dispatch_no) {
                  detailRow["Dispatch No"] =
                    formatCellValue(item.dispatch_no) || "";
                }
                if (item.invoice_no) {
                  detailRow["Invoice No"] = formatCellValue(item.invoice_no) || "";
                }

              }
              if (item.order_no) {
                detailRow["Order #"] = formatCellValue(item.order_no) || "";
              }
              detailRow["Vendor/Customer"] =
                formatCellValue(item.acno?.acname) || "";
              if (reportType === "sale") {
                detailRow["Customer NTN"] = formatCellValue(item.acno?.ntnNo) || "";
              }
            }

            config.detailColumns.forEach((col) => {
              let val = col.valueGetter
                ? col.valueGetter({ row: detail })
                : detail[col.field];

              if ((val === undefined || val === null) && col.field === "balance") {
                val = item.balance;
              }

              detailRow[col.headerName] = formatCellValue(val);
            });

            detailData.push(detailRow);
          });
        }
      });

      const detailWorksheet = XLSX.utils.json_to_sheet(detailData, {
        origin: "A4",
      });

      const detailCompanyName = company?.name || "Company";

      XLSX.utils.sheet_add_aoa(
        detailWorksheet,
        [[detailCompanyName]],
        { origin: "A1" },
      );

      XLSX.utils.sheet_add_aoa(
        detailWorksheet,
        [[config.title + " - Details"]],
        { origin: "A2" },
      );

      const detailSubtitleText = `Generated by: ${session?.user?.name || "System"}${periodInfo}`;
      XLSX.utils.sheet_add_aoa(
        detailWorksheet,
        [[{
          v: detailSubtitleText,
          r: getExcelRichText(detailSubtitleText),
          s: { font: { italic: true }, alignment: { horizontal: "left", vertical: "center", wrapText: true } }
        }]],
        { origin: "A3" },
      );

      const detailColCount = Object.keys(detailData[0] || {}).length - 1;
      detailWorksheet["!merges"] = [
        { s: { r: 0, c: 0 }, e: { r: 0, c: detailColCount } },
        { s: { r: 1, c: 0 }, e: { r: 1, c: detailColCount } },
        { s: { r: 2, c: 0 }, e: { r: 2, c: detailColCount } },
      ];

      ["A1", "A2", "A3"].forEach((cellRef, idx) => {
        if (!detailWorksheet[cellRef]) {
          detailWorksheet[cellRef] = {
            v:
              idx === 0
                ? detailCompanyName
                : idx === 1
                  ? config.title + " - Details"
                  : detailSubtitleText,
            t: "s",
          };
        }

        if (idx === 0 || idx === 1) {
          const numCols = Object.keys(detailData[0] || {}).length;
          for (let c = 0; c < numCols; c++) {
            const currentCellRef = XLSX.utils.encode_cell({ r: idx, c });
            if (!detailWorksheet[currentCellRef]) {
              detailWorksheet[currentCellRef] = { v: "", t: "s" };
            }
            detailWorksheet[currentCellRef].s = {
              font: {
                bold: true,
                sz: 24,
                color: { rgb: "FFFFFF" },
                name: "Calibri",
                scheme: "major",
              },
              fill: {
                patternType: "solid",
                fgColor: { rgb: "27AE60" },
                bgColor: { rgb: "27AE60" },
              },
              alignment: {
                horizontal: "center",
                vertical: "center",
                wrapText: true,
              },
            };

            if (idx === 0) {
              detailWorksheet[currentCellRef].s.border = {
                bottom: { style: "thick", color: { rgb: "FFFFFF" } },
              };
            }
          }

          if (!detailWorksheet["!rows"]) detailWorksheet["!rows"] = [];
          if (idx === 0) detailWorksheet["!rows"][0] = { hpt: 40 };
          if (idx === 1) detailWorksheet["!rows"][1] = { hpt: 40 };
        } else {
          if (!detailWorksheet["!rows"]) detailWorksheet["!rows"] = [];
          detailWorksheet["!rows"][2] = { hpt: periodInfo.includes('\n') ? 60 : 25 };

          const numCols = Object.keys(detailData[0] || {}).length;
          for (let c = 0; c < numCols; c++) {
            const currentCellRef = XLSX.utils.encode_cell({ r: idx, c });
            if (!detailWorksheet[currentCellRef]) {
              detailWorksheet[currentCellRef] = { v: "", t: "s" };
            }
            detailWorksheet[currentCellRef].s = {
              font: {
                italic: true,
                sz: 12,
                color: { rgb: "2C3E50" },
                name: "Calibri",
              },
              fill: {
                patternType: "solid",
                fgColor: { rgb: "D6EAF8" },
                bgColor: { rgb: "D6EAF8" },
              },
              alignment: {
                horizontal: "left",
                vertical: "center",
                wrapText: true,
              },
            };
          }
        }
      });

      const detailWscols = Object.keys(detailData[0] || {}).map((key) => ({
        wch:
          key.toLowerCase().includes("item") ||
            key.toLowerCase().includes("name") ||
            key.toLowerCase().includes("product")
            ? 50
            : calculateColumnWidth(detailData, key),
      }));
      detailWorksheet["!cols"] = detailWscols;

      const detailWsrows = [];
      for (let i = 0; i <= detailData.length + 3; i++) {
        detailWsrows.push({
          hpt: i === 0 || i === 1 ? 40 : i === 2 ? (periodInfo.includes('\n') ? 60 : 25) : 36,
        });
      }
      detailWorksheet["!rows"] = detailWsrows;

      const detailRange = XLSX.utils.decode_range(
        detailWorksheet["!ref"] || "A1",
      );
      for (let row = 0; row <= detailRange.e.r; row++) {
        for (let col = detailRange.s.c; col <= detailRange.e.c; col++) {
          const cell = XLSX.utils.encode_cell({ r: row, c: col });
          if (!detailWorksheet[cell]) {
            detailWorksheet[cell] = { v: "" };
          }

          const borderStyle = {
            style: "thin",
            color: { rgb: "000000" },
          };

          if (row === 3) {
            detailWorksheet[cell].s = {
              fill: { fgColor: { rgb: "27AE60" } },
              font: {
                bold: true,
                color: { rgb: "FFFFFF" },
                size: 12,
              },
              alignment: {
                horizontal: "center",
                vertical: "center",
                wrapText: true,
              },
              border: {
                top: borderStyle,
                bottom: borderStyle,
                left: borderStyle,
                right: borderStyle,
              },
            };
          } else if (row > 3) {
            detailWorksheet[cell].s = {
              fill: {
                fgColor: {
                  rgb: row % 2 === 0 ? "E8F5E9" : "FFFFFF",
                },
              },
              font: {
                size: 11,
                color: { rgb: "000000" },
              },
              alignment: {
                horizontal: "center",
                vertical: "center",
                wrapText: true,
              },
              border: {
                top: borderStyle,
                bottom: borderStyle,
                left: borderStyle,
                right: borderStyle,
              },
            };
          }
        }
      }

      const summaryData = allData.map((item, index) => {
        const row = {};
        allColumns?.filter((col) => !hiddenColumns[col.field])?.forEach((col) => {
          if (col.valueGetter) {
            row[col.headerName] = formatCellValue(
              col.valueGetter({ row: item }),
            );
          } else {
            row[col.headerName] = formatCellValue(item[col.field]);
          }
          if (reportType === "sale" && col.headerName === "Customer") {
            row["Customer NTN"] = formatCellValue(item.acno?.ntnNo) || "";
          }
        });

        let detailRowNumber = 4;

        for (let i = 0; i < index; i++) {
          const detailItems = allData[i][config.detailData || "transactions"];

          if (detailItems && detailItems.length > 0) {
            detailRowNumber += detailItems.length;
          }
        }

        row["View Details"] = {
          f: `HYPERLINK("#Details!A${detailRowNumber}", "View →")`,
          t: "s",
        };
        return row;
      });

      const summaryWorksheet = XLSX.utils.json_to_sheet(summaryData, {
        origin: "A4",
      });

      const companyName = company?.name || "Company";

      XLSX.utils.sheet_add_aoa(
        summaryWorksheet,
        [[companyName]],
        {
          origin: "A1",
        },
      );

      XLSX.utils.sheet_add_aoa(
        summaryWorksheet,
        [[config.title + " - Summary"]],
        {
          origin: "A2",
        },
      );

      const subtitleText = `Generated by: ${session?.user?.name || "System"}${periodInfo}`;
      XLSX.utils.sheet_add_aoa(
        summaryWorksheet,
        [[{
          v: subtitleText,
          r: getExcelRichText(subtitleText),
          s: { font: { italic: true }, alignment: { horizontal: "left", vertical: "center", wrapText: true } }
        }]],
        { origin: "A3" },
      );

      summaryWorksheet["!merges"] = [
        {
          s: { r: 0, c: 0 },
          e: { r: 0, c: Object.keys(summaryData[0] || {}).length - 1 },
        },
        {
          s: { r: 1, c: 0 },
          e: { r: 1, c: Object.keys(summaryData[0] || {}).length - 1 },
        },
        {
          s: { r: 2, c: 0 },
          e: { r: 2, c: Object.keys(summaryData[0] || {}).length - 1 },
        },
      ];

      ["A1", "A2", "A3"].forEach((cellRef, idx) => {
        if (!summaryWorksheet[cellRef]) {
          summaryWorksheet[cellRef] = {
            v:
              idx === 0
                ? companyName
                : idx === 1
                  ? config.title + " - Summary"
                  : subtitleText,
            r: idx === 2 ? getExcelRichText(subtitleText) : undefined,
            t: "s",
          };
        }

        if (idx === 0 || idx === 1) {
          const numCols = Object.keys(summaryData[0] || {}).length;
          for (let c = 0; c < numCols; c++) {
            const currentCellRef = XLSX.utils.encode_cell({ r: idx, c });
            if (!summaryWorksheet[currentCellRef]) {
              summaryWorksheet[currentCellRef] = { v: "", t: "s" };
            }
            summaryWorksheet[currentCellRef].s = {
              font: {
                bold: true,
                sz: 24,
                color: { rgb: "FFFFFF" },
                name: "Calibri",
                scheme: "major",
              },
              fill: {
                patternType: "solid",
                fgColor: { rgb: "4472C4" },
                bgColor: { rgb: "4472C4" },
              },
              alignment: {
                horizontal: "center",
                vertical: "center",
                wrapText: true,
              },
            };

            if (idx === 0) {
              summaryWorksheet[currentCellRef].s.border = {
                bottom: { style: "thick", color: { rgb: "FFFFFF" } },
              };
            }
          }

          if (!summaryWorksheet["!rows"]) {
            summaryWorksheet["!rows"] = [];
          }
          if (idx === 0) summaryWorksheet["!rows"][0] = { hpt: 40 };
          if (idx === 1) summaryWorksheet["!rows"][1] = { hpt: 40 };
        } else if (idx === 2) {
          if (!summaryWorksheet["!rows"]) {
            summaryWorksheet["!rows"] = [];
          }
          summaryWorksheet["!rows"][2] = { hpt: periodInfo.includes('\n') ? 60 : 25 };

          const numCols = Object.keys(summaryData[0] || {}).length;
          for (let c = 0; c < numCols; c++) {
            const currentCellRef = XLSX.utils.encode_cell({ r: idx, c });
            if (!summaryWorksheet[currentCellRef]) {
              summaryWorksheet[currentCellRef] = { v: "", t: "s" };
            }
            summaryWorksheet[currentCellRef].s = {
              font: {
                italic: true,
                sz: 12,
                color: { rgb: "2C3E50" },
                name: "Calibri",
              },
              fill: {
                patternType: "solid",
                fgColor: { rgb: "D6EAF8" },
                bgColor: { rgb: "D6EAF8" },
              },
              alignment: {
                horizontal: "left",
                vertical: "center",
                wrapText: true,
              },
            };
          }
        }
      });

      const summaryWscols = Object.keys(summaryData[0] || {}).map((key) => ({
        wch:
          key === "View Details" ? 12 : calculateColumnWidth(summaryData, key),
      }));
      summaryWorksheet["!cols"] = summaryWscols;

      const summaryWsrows = [];
      for (let i = 0; i <= summaryData.length + 3; i++) {
        summaryWsrows.push({
          hpt: i === 0 || i === 1 ? 40 : i === 2 ? (periodInfo.includes('\n') ? 60 : 25) : 32,
        });
      }
      summaryWorksheet["!rows"] = summaryWsrows;

      const summaryRange = XLSX.utils.decode_range(
        summaryWorksheet["!ref"] || "A1",
      );
      const viewDetailsColIndex = Object.keys(summaryData[0]).indexOf(
        "View Details",
      );

      for (let row = 0; row <= summaryRange.e.r; row++) {
        for (let col = summaryRange.s.c; col <= summaryRange.e.c; col++) {
          const cell = XLSX.utils.encode_cell({ r: row, c: col });
          if (!summaryWorksheet[cell]) {
            summaryWorksheet[cell] = { v: "" };
          }

          const borderStyle = {
            style: "thin",
            color: { rgb: "000000" },
          };

          if (row === 3) {
            summaryWorksheet[cell].s = {
              fill: { fgColor: { rgb: "2C3E50" } },
              font: {
                bold: true,
                color: { rgb: "FFFFFF" },
                size: 12,
              },
              alignment: {
                horizontal: "center",
                vertical: "center",
                wrapText: true,
              },
              border: {
                top: borderStyle,
                bottom: borderStyle,
                left: borderStyle,
                right: borderStyle,
              },
            };
          } else if (row > 3) {
            if (col === viewDetailsColIndex) {
              summaryWorksheet[cell].s = {
                fill: {
                  fgColor: {
                    rgb: row % 2 === 0 ? "F8F9FA" : "FFFFFF",
                  },
                },
                font: {
                  color: { rgb: "0563C1" },
                  underline: true,
                  bold: true,
                  size: 11,
                },
                alignment: {
                  horizontal: "center",
                  vertical: "center",
                },
                border: {
                  top: borderStyle,
                  bottom: borderStyle,
                  left: borderStyle,
                  right: borderStyle,
                },
              };
            } else {
              summaryWorksheet[cell].s = {
                fill: {
                  fgColor: {
                    rgb: row % 2 === 0 ? "F8F9FA" : "FFFFFF",
                  },
                },
                font: {
                  size: 11,
                  color: { rgb: "000000" },
                },
                alignment: {
                  horizontal: "center",
                  vertical: "center",
                  wrapText: true,
                },
                border: {
                  top: borderStyle,
                  bottom: borderStyle,
                  left: borderStyle,
                  right: borderStyle,
                },
              };
            }
          }
        }
      }

      XLSX.utils.book_append_sheet(workbook, summaryWorksheet, "Summary");
      XLSX.utils.book_append_sheet(workbook, detailWorksheet, "Details");

      workbook.Props = workbook.Props || {};
      workbook.Props.ActiveTab = 0;
    } else {
      // ── Standard Excel export — Modern Professional Design ──────────────
      const filteredData = groupedAllData;
      // Group headers / subtotals are presentation rows; the grand total below
      // sums only the real ones.
      const plainRows = filteredData.filter((r) => !r?.__rowType);
      const rawColumnsForExport = isQCReport ? exportColumns : allColumns;
      const columnsForExport = rawColumnsForExport?.filter((col) => !hiddenColumns[col.field]);
      const numCols = columnsForExport?.length || 1;
      const companyName = company?.name || "Company Name";

      // ── Build AOA rows ─────────────────────────────────────────────────
      const aoa = [];
      const merges = [];

      // Row 0: Company name
      aoa.push([companyName, ...Array(numCols - 1).fill('')]);
      merges.push({ s: { r: 0, c: 0 }, e: { r: 0, c: numCols - 1 } });

      // Row 1: Report title
      aoa.push([config.title, ...Array(numCols - 1).fill('')]);
      merges.push({ s: { r: 1, c: 0 }, e: { r: 1, c: numCols - 1 } });

      // Row 2: Generated by / period
      const subtitleText = `Generated by: ${session?.user?.name || 'System'}${periodInfo}`;
      aoa.push([subtitleText, ...Array(numCols - 1).fill('')]);
      merges.push({ s: { r: 2, c: 0 }, e: { r: 2, c: numCols - 1 } });

      // Check if columns have grouped headers (e.g. sales_matrix_monthwise)
      const hasGroupHeaders = columnsForExport?.some((col) => col.groupHeader);

      let dataStartRowIdx;

      if (hasGroupHeaders) {
        // ── Row 3: Group header row ────────────────────────────────────────
        const groupRow3 = [];
        const groupRow4 = [];
        let colIndex = 0;

        // Build group spans
        const groups = [];
        columnsForExport.forEach((col) => {
          const gName = col.groupHeader || null;
          const lastGroup = groups[groups.length - 1];
          if (lastGroup && lastGroup.groupHeader === gName) {
            lastGroup.cols.push(col);
          } else {
            groups.push({ groupHeader: gName, cols: [col], startCol: colIndex });
          }
          colIndex++;
        });

        // Row 3: group labels (merged), non-grouped columns push empty placeholders merged into row 4
        columnsForExport.forEach((col) => { groupRow3.push(''); groupRow4.push(''); });

        colIndex = 0;
        groups.forEach((grp) => {
          if (!grp.groupHeader) {
            // Non-grouped: label in row 3, row 4 is blank (we'll merge row 3+4 for these cells)
            groupRow3[grp.startCol] = grp.cols[0].headerName;
            merges.push({ s: { r: 3, c: grp.startCol }, e: { r: 4, c: grp.startCol + grp.cols.length - 1 } });
          } else {
            // Group header: label in row 3 merged across span
            groupRow3[grp.startCol] = grp.groupHeader;
            if (grp.cols.length > 1) {
              merges.push({ s: { r: 3, c: grp.startCol }, e: { r: 3, c: grp.startCol + grp.cols.length - 1 } });
            }
            // Sub-headers in row 4
            grp.cols.forEach((col, i) => {
              groupRow4[grp.startCol + i] = col.headerName;
            });
          }
        });

        aoa.push(groupRow3); // Row 3
        aoa.push(groupRow4); // Row 4
        dataStartRowIdx = 5;
      } else {
        // Row 3: flat single column headers
        aoa.push(columnsForExport.map(col => col.exportHeader || col.headerName));
      // Helper: parse any date value into a JS Date, or null
      // Data rows (row 4+)
        dataStartRowIdx = 4;
      }

      // Data rows
      const groupExcelRows = { header: [], total: [] };
      filteredData.forEach(item => {
        const rowIdx = aoa.length;
        if (item?.__rowType === 'groupHeader') {
          groupExcelRows.header.push(rowIdx);
          aoa.push(columnsForExport.map((c, i) => (i === 0 ? item.__label : '')));
          return;
        }
        if (item?.__rowType === 'groupTotal') {
          groupExcelRows.total.push(rowIdx);
          aoa.push(columnsForExport.map((col, i) => {
            if (i === 0) return item.__label;
            if (!Object.prototype.hasOwnProperty.call(item, col.field)) return '';
            return Number(item[col.field]) || 0;
          }));
          return;
        }
        aoa.push(columnsForExport.map(col => {
          const v = col.valueGetter ? col.valueGetter({ row: item }) : item[col.field];
          if (col.type === 'currency' || col.type === 'number') {
            return Number(v) || 0;
          }
          return formatCellValue(v);
        }));
      });

      // Totals row
      const hasTotals = !isQCReport && columnsForExport?.some(c => c.showTotal);
      if (hasTotals) {
        aoa.push(columnsForExport.map((col, idx) => {
          if (col.showTotal) {
            if (col.totalType === 'last') {
              for (let i = plainRows.length - 1; i >= 0; i--) {
                const v = col.valueGetter ? col.valueGetter({ row: plainRows[i] }) : plainRows[i][col.field];
                if (v !== null && v !== undefined) return Number(v) || 0;
              }
              return 0;
            }
            return plainRows.reduce((acc, row) => {
              const v = col.valueGetter ? col.valueGetter({ row }) : row[col.field];
              return acc + (Number(v) || 0);
            }, 0);
          }
          return idx === 0 ? 'TOTAL' : '';
        }));
      }

      const ws = XLSX.utils.aoa_to_sheet(aoa);
      ws['!merges'] = merges;

      // Column widths
      ws['!cols'] = columnsForExport.map(col => {
        const key = col.headerName;
        return { wch: calculateColumnWidth(filteredData.map(r => ({ [key]: col.valueGetter ? col.valueGetter({ row: r }) : r[col.field] })), key) };
      });

      // Row heights
      ws['!rows'] = aoa.map((_, i) => {
        if (i === 0) return { hpt: 40 };
        if (i === 1) return { hpt: 32 };
        if (i === 2) return { hpt: periodInfo.includes('\n') ? 52 : 24 };
        if (i === 3) return { hpt: 22 };
        if (hasGroupHeaders && i === 4) return { hpt: 20 };
        return { hpt: 20 };
      });

      // ── Apply cell styles ──────────────────────────────────────────────
      const thinBorder = (color = 'E2E8F0') => ({ style: 'thin', color: { rgb: color } });
      const cellBorder = { top: thinBorder(), bottom: thinBorder(), left: thinBorder(), right: thinBorder() };
      const strongBorder = { top: thinBorder('94A3B8'), bottom: thinBorder('94A3B8'), left: thinBorder('94A3B8'), right: thinBorder('94A3B8') };

      const totalRows = aoa.length;
      const colHalign = (ci) => {
        const col = columnsForExport[ci];
        if (col?.type === 'currency' || col?.type === 'number') return 'right';
        if (col?.type === 'date') return 'center';
        return 'left';
      };

      for (let r = 0; r < totalRows; r++) {
        for (let c = 0; c < numCols; c++) {
          const ref = XLSX.utils.encode_cell({ r, c });
          if (!ws[ref]) ws[ref] = { v: '', t: 's' };

          const isDataRow = r >= dataStartRowIdx && !(hasTotals && r === totalRows - 1);
          const isTotalsRow = hasTotals && r === totalRows - 1;
          const isGroupHeaderRow = hasGroupHeaders && r === 3;
          const isSubHeaderRow = hasGroupHeaders ? r === 4 : r === 3;
          const isColHeaderRow = isGroupHeaderRow || isSubHeaderRow;
          const align = { horizontal: colHalign(c), vertical: 'center', wrapText: false };

          if (r === 0) {
            ws[ref].s = {
              font: { bold: true, sz: 20, color: { rgb: 'FFFFFF' }, name: 'Calibri' },
              fill: { patternType: 'solid', fgColor: { rgb: '0F1726' } },
              alignment: { horizontal: 'center', vertical: 'center' },
              border: { bottom: { style: 'medium', color: { rgb: '6366F1' } } },
            };
          } else if (r === 1) {
            ws[ref].s = {
              font: { bold: true, sz: 14, color: { rgb: 'C7D2FE' }, name: 'Calibri' },
              fill: { patternType: 'solid', fgColor: { rgb: '1E293B' } },
              alignment: { horizontal: 'center', vertical: 'center' },
            };
          } else if (r === 2) {
            ws[ref].s = {
              font: { italic: true, sz: 10, color: { rgb: '334155' }, name: 'Calibri' },
              fill: { patternType: 'solid', fgColor: { rgb: 'EFF6FF' } },
              alignment: { horizontal: 'left', vertical: 'center', wrapText: true },
              border: { left: { style: 'medium', color: { rgb: '6366F1' } } },
            };
          } else if (isGroupHeaderRow) {
            // Row 3 when grouped: top group label row (darker)
            ws[ref].s = {
              font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' }, name: 'Calibri' },
              fill: { patternType: 'solid', fgColor: { rgb: '0F1726' } },
              alignment: { horizontal: 'center', vertical: 'center' },
              border: strongBorder,
            };
          } else if (isSubHeaderRow) {
            // Row 4 when grouped (or row 3 when flat): sub-header row
            ws[ref].s = {
              font: { bold: true, sz: 10, color: { rgb: 'FFFFFF' }, name: 'Calibri' },
              fill: { patternType: 'solid', fgColor: { rgb: '1E293B' } },
              alignment: { ...align, horizontal: 'center' },
              border: strongBorder,
            };
          } else if (isTotalsRow) {
            ws[ref].s = {
              font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' }, name: 'Calibri' },
              fill: { patternType: 'solid', fgColor: { rgb: '0F1726' } },
              alignment: { ...align },
              border: { top: { style: 'medium', color: { rgb: '6366F1' } }, bottom: thinBorder('6366F1'), left: thinBorder(), right: thinBorder() },
              numFmt: (columnsForExport[c]?.type === 'currency' || columnsForExport[c]?.type === 'number') ? '#,##0.00' : undefined,
            };
          } else if (groupExcelRows.header.includes(r)) {
            // Group separator: the account (or other group) this block belongs to
            ws[ref].s = {
              font: { bold: true, sz: 11, color: { rgb: 'FFFFFF' }, name: 'Calibri' },
              fill: { patternType: 'solid', fgColor: { rgb: '1E293B' } },
              alignment: { horizontal: 'left', vertical: 'center' },
              border: cellBorder,
            };
          } else if (groupExcelRows.total.includes(r)) {
            const col = columnsForExport[c];
            ws[ref].s = {
              font: { bold: true, sz: 10, color: { rgb: '0F1726' }, name: 'Calibri' },
              fill: { patternType: 'solid', fgColor: { rgb: 'E2E8F0' } },
              alignment: { ...align },
              border: strongBorder,
              numFmt: (col?.type === 'currency' || col?.type === 'number') ? '#,##0.00' : undefined,
            };
          } else if (isDataRow) {
            const isEven = (r - dataStartRowIdx) % 2 === 0;
            const col = columnsForExport[c];
            ws[ref].s = {
              font: { sz: 10, color: { rgb: '1E293B' }, name: 'Calibri' },
              fill: { patternType: 'solid', fgColor: { rgb: isEven ? 'F8FAFC' : 'FFFFFF' } },
              alignment: { ...align, wrapText: false },
              border: cellBorder,
              numFmt: (col?.type === 'currency' || col?.type === 'number') ? '#,##0.00' : undefined,
            };
          }
        }
      }

      XLSX.utils.book_append_sheet(workbook, ws, 'Report');
      workbook.Props = workbook.Props || {};
      workbook.Props.ActiveTab = 0;
    }

    const timestamp = format(new Date(), "yyyy-MM-dd_HHmm");
    XLSX.writeFile(workbook, `${config.title}_${timestamp}.xlsx`);
  };

  const exportToPDF = async (pdfOrientation = "landscape") => {
    try {
      setIsExporting(true);

      const { jsPDF } = await import("jspdf");
      const { default: autoTable } = await import("jspdf-autotable");

      let doc;
      if (isQCReport) {
        doc = new jsPDF({
          orientation: pdfOrientation || "landscape",
          unit: "mm",
          format: pdfOrientation === "portrait" ? [300, 500] : [500, 300],
          putOnlyUsedFonts: true,
        });
      } else {
        doc = new jsPDF({
          orientation: pdfOrientation || "landscape",
          unit: "mm",
          putOnlyUsedFonts: true,
        });
      }

      if (isQCReport) {
        const companyName = company?.name || "Company";
        const reportDate = format(new Date(), "EEEE MMMM dd yyyy h:mm a");
        let currentY = 5;

        doc.setFont("helvetica", "bold");
        doc.setFontSize(14);
        doc.setTextColor(0, 0, 0);
        doc.text(companyName, doc.internal.pageSize.width / 2, currentY, {
          align: "center",
        });
        currentY += 6;

        doc.setFontSize(12);
        doc.text(
          reportType === "qc"
            ? "Quality Control Results"
            : "Order Quality Control Results",
          doc.internal.pageSize.width / 2,
          currentY,
          { align: "center" },
        );
        currentY += 5;

        doc.setFont("helvetica", "normal");
        doc.setFontSize(9);
        doc.text(reportDate, 10, currentY);
        doc.text("Page 1 of 1", doc.internal.pageSize.width - 10, currentY, {
          align: "right",
        });
        currentY += 8;
      }
      const isAccountLedger = config.title === "Account Ledger";
      const showDetails = !isAccountLedger &&
        config.detailColumns && data.some((item) => item.transactions);

      const commonStyles = {
        fontSize: isQCReport ? 6 : 9,
        font: "helvetica",
        cellPadding: isQCReport ? 0.3 : 1,
        textColor: [0, 0, 0],
        halign: "center",
        valign: "middle",
        lineWidth: 0.2,
        lineColor: [0, 0, 0],
        overflow: "linebreak",
        minCellHeight: isQCReport ? 3.5 : 5,
        lineHeight: isQCReport ? 1.05 : 1.2,
      };

      if (showDetails && config.showSummary) {
        const detailData = [];
        allData.forEach((item) => {
          if (item.transactions?.length > 0) {
            item.transactions.forEach((detail) => {
              const detailRow = {
                Date: formatCellValue(item.dated) || "0",
                "Vr #": formatCellValue(item.vr_no) || "0",
                "Account No": formatCellValue(item.acno) || "0",
              };

              config.detailColumns.forEach((col) => {
                // Use `in` to check if key EXISTS in detail (even if null/0).
                // Only fall back to parent item if key is entirely absent (e.g. balance).
                const val = col.valueGetter
                  ? col.valueGetter({ row: detail })
                  : col.field in detail
                    ? detail[col.field]   // debit/credit/acname — use detail value (even if null)
                    : item[col.field];    // balance — not in detail, read from parent item

                if (col.type === "currency") {
                  detailRow[col.headerName] = formatCurrency(val, currency);
                } else {
                  detailRow[col.headerName] = formatCellValue(val);
                }
              });

              // config.detailColumns.forEach((col) => {
              //   detailRow[col.headerName] = col.valueGetter
              //     ? formatCellValue(col.valueGetter({ row: detail }))
              //     : formatCellValue(detail[col.field]);
              // });
              detailData.push(detailRow);
            });
          }
        });

        if (!isQCReport) {
          doc.setFont("helvetica", "bold");
          doc.setTextColor(255, 255, 255);
          doc.setFillColor(39, 174, 96);
          doc.rect(0, 0, doc.internal.pageSize.width, 20, "F");

          doc.setFontSize(18);
          const companyName = company?.name || "Company";
          doc.text(companyName, doc.internal.pageSize.width / 2, 8, { align: "center" });

          doc.setDrawColor(255, 255, 255);
          doc.setLineWidth(0.5);
          doc.line(0, 11, doc.internal.pageSize.width, 11);

          doc.setFontSize(14);
          doc.text(config.title, doc.internal.pageSize.width / 2, 17, { align: "center" });

          const hasNewline = periodInfo.includes('\n');
          doc.setFontSize(10);
          doc.setTextColor(44, 62, 80);
          doc.setFillColor(214, 234, 248);
          // Increase background height slightly for better breathing room
          doc.rect(0, 20, doc.internal.pageSize.width, hasNewline ? 14 : 7, "F");

          const fullText = `Generated by: ${session?.user?.name || "System"}${periodInfo}`;
          const lines = fullText.split('\n');

          lines.forEach((line, index) => {
            const yPos = 25 + (index * 6); // More spacing between lines
            const segments = line.split(/(\s*\|\s*)/);

            // Calculate total width for right alignment
            let totalWidth = 0;
            segments.forEach(seg => {
              if (seg.includes(':')) {
                const colonIdx = seg.indexOf(':');
                const label = seg.substring(0, colonIdx + 1);
                const val = seg.substring(colonIdx + 1);
                doc.setFont("helvetica", "bolditalic");
                totalWidth += doc.getTextWidth(label);
                doc.setFont("helvetica", "italic");
                totalWidth += doc.getTextWidth(val || "");
              } else {
                doc.setFont("helvetica", "italic");
                totalWidth += doc.getTextWidth(seg);
              }
            });

            let startX = 10;
            segments.forEach(seg => {
              if (seg.includes(':')) {
                const colonIdx = seg.indexOf(':');
                const label = seg.substring(0, colonIdx + 1);
                const val = seg.substring(colonIdx + 1);
                doc.setFont("helvetica", "bolditalic");
                doc.text(label, startX, yPos);
                startX += doc.getTextWidth(label);
                doc.setFont("helvetica", "italic");
                doc.text(val || "", startX, yPos);
                startX += doc.getTextWidth(val || "");
              } else {
                doc.setFont("helvetica", "italic");
                doc.text(seg, startX, yPos);
                startX += doc.getTextWidth(seg);
              }
            });
          });
        }

        const detailHeaders = [
          { title: "Date", dataKey: "Date", width: 25 },
          { title: "Vr #", dataKey: "Vr #", width: 12 },
          { title: "Account No", dataKey: "Account No", width: 22 },
          ...config.detailColumns.map((col) => ({
            title: col.headerName,
            dataKey: col.headerName,
            width: col.width || 40,
          })),
        ];

        const pageWidth = doc.internal.pageSize.width - 100;
        const columnCount = detailHeaders.length;
        const baseWidth = pageWidth / columnCount;

        const columnStyles = {};
        detailHeaders.forEach((header, idx) => {
          columnStyles[idx] = { cellWidth: header.width };
        });

        autoTable(doc, {
          head: [detailHeaders.map((h) => h.title)],
          body: detailData.map((row) =>
            detailHeaders.map((header) => {
              const value = row[header.dataKey] || "";
              return typeof value === "string" ? value.trim() : value;
            }),
          ),
          startY: isQCReport ? 25 : (periodInfo.includes('\n') ? 36 : 30),
          margin: { left: 10, right: 10 },
          styles: commonStyles,
          headStyles: {
            fillColor: isQCReport ? [241, 90, 34] : [39, 174, 96],
            textColor: [255, 255, 255],
            fontSize: isQCReport ? 8 : 10,
            cellPadding: isQCReport ? 0.5 : 1,
            fontStyle: "bold",
            halign: "center",
            lineWidth: 0.25,
          },
          bodyStyles: {
            lineWidth: 0.25,
          },
          alternateRowStyles: {
            fillColor: [232, 245, 233],
          },
          columnStyles: columnStyles,
          didDrawCell: (data) => {
            if (data.cell.raw && data.cell.raw.length > 30) {
              data.row.height = Math.max(data.row.height, 8);
            }
          },
        });
      } else if (reportType === 'salesOrderBalance' && filters.showCustomerTotal) {
        const isSalesOrderBalance = reportType === 'salesOrderBalance';
        const filteredData = config?.dynamicColumns ? allData : allData;
        const rawColumnsForExport = isQCReport ? exportColumns : allColumns;
        const columnsForExport = rawColumnsForExport?.filter((col) => !hiddenColumns[col.field]);

        // Find min orderDate for each customer to determine their global order
        const customerMinDates = {};
        const baseExportData = config?.dynamicColumns ? allData : allData;
        baseExportData.forEach((item) => {
          const cust = (isSalesOrderBalance ? (item.customer || "") : (item.acno?.acname || "")).trim().toLowerCase();
          const d = new Date(isSalesOrderBalance ? item.orderDate : item.dated);
          if (!customerMinDates[cust] || d < customerMinDates[cust]) {
            customerMinDates[cust] = d;
          }
        });

        // Ensure data is strictly sorted for grouping
        const dataForExport = [...baseExportData].sort((a, b) => {
          const custA = (isSalesOrderBalance ? (a.customer || "") : (a.acno?.acname || "")).trim().toLowerCase();
          const custB = (isSalesOrderBalance ? (b.customer || "") : (b.acno?.acname || "")).trim().toLowerCase();

          // 1. Sort by customer's oldest record date
          const minDateA = customerMinDates[custA];
          const minDateB = customerMinDates[custB];
          if (minDateA - minDateB !== 0) {
            return minDateA - minDateB;
          }

          // 2. Sort by customer name alphabetically if min dates are identical
          if (custA !== custB) return custA.localeCompare(custB);

          // 3. Sort individual records by date ascending
          const dateA = new Date(isSalesOrderBalance ? a.orderDate : a.dated);
          const dateB = new Date(isSalesOrderBalance ? b.orderDate : b.dated);
          if (dateA - dateB !== 0) return dateA - dateB;

          const isoA = isSalesOrderBalance ? (a.orderNo || 0) : (a.so_no || 0);
          const isoB = isSalesOrderBalance ? (b.orderNo || 0) : (b.so_no || 0);
          return isoA - isoB;
        });

        const mainData = [];
        let lastCustomerName = null;
        let lastISOValue = null;
        let customerTotalQty = 0; // Accumulator for customer total
        let customerTotalOrdered = 0;
        let customerTotalShip = 0;
        let customerTotalPending = 0;

        dataForExport.forEach((item, index) => {
          const currentCustomer = (isSalesOrderBalance ? (item.customer || "") : (item.acno?.acname || "")).trim();
          const currentISO = isSalesOrderBalance ? item.orderNo : item.so_no;

          // Before adding a new customer header, check if we need to add the previous customer's total
          if (lastCustomerName !== null && currentCustomer !== lastCustomerName) {
            mainData.push({
              _isCustomerTotal: true,
              _totalQty: customerTotalQty,
              _totalOrdered: customerTotalOrdered,
              _totalShip: customerTotalShip,
              _totalPending: customerTotalPending
            });
            customerTotalQty = 0; // Reset
            customerTotalOrdered = 0;
            customerTotalShip = 0;
            customerTotalPending = 0;
          }

          // Only add customer header if it's a new customer
          if (currentCustomer && currentCustomer !== lastCustomerName) {
            lastCustomerName = currentCustomer;
            lastISOValue = null; // Reset ISO tracking for new customer
            mainData.push({
              _isCustomerOnlyHeader: true,
              _customerName: currentCustomer
            });
          }

          // Add ISO header when ISO or Customer changes
          if ((config.groupBy === 'so_no' || config.groupBy === 'orderNo') && currentISO !== lastISOValue) {
            lastISOValue = currentISO;
            mainData.push({
              _isISOHeader: true,
              _so_no: currentISO,
              _row: item // Contains date, tran_id, etc.
            });
            // Add sub-headers under the ISO info line
            mainData.push({ _isSubHeader: true });
          }

          if (config.layout === 'nested') {
            if (isSalesOrderBalance) {
              customerTotalOrdered += item.totalOrdered || 0;
              customerTotalShip += item.totalShip || 0;
              customerTotalPending += item.totalPending || 0;
            } else {
              const currentItemTotal = item.transactions?.reduce((sum, detail) => sum + (parseFloat(detail.qty) || 0), 0) || 0;
              customerTotalQty += currentItemTotal;
            }

            // No need to add _isMasterHeader here as it's replaced by _isISOHeader logic above
            item.transactions?.forEach(detail => {
              const detailRow = {};
              config.detailColumns.forEach(col => {
                detailRow[col.headerName] = col.valueGetter ? col.valueGetter({ row: detail }) : detail[col.field];
              });
              mainData.push({ _isDetailRow: true, _row: detailRow });
            });
            mainData.push({ _isMasterFooter: true, _row: item });
          } else {
            // ... non-nested logic if any ...
          }

          // If last record overall, push the last customer's total
          if (index === dataForExport.length - 1) {
            mainData.push({
              _isCustomerTotal: true,
              _totalQty: customerTotalQty,
              _totalOrdered: customerTotalOrdered,
              _totalShip: customerTotalShip,
              _totalPending: customerTotalPending
            });
          }
        });

        if (!isQCReport) {
          doc.setFont("helvetica", "bold");
          doc.setTextColor(255, 255, 255);
          doc.setFillColor(68, 114, 196);
          doc.rect(0, 0, doc.internal.pageSize.width, 20, "F");

          doc.setFontSize(18);
          const companyName = company?.name || "Company";
          doc.text(companyName, doc.internal.pageSize.width / 2, 8, { align: "center" });

          doc.setDrawColor(255, 255, 255);
          doc.setLineWidth(0.5);
          doc.line(0, 11, doc.internal.pageSize.width, 11);

          doc.setFontSize(14);
          doc.text(config.title, doc.internal.pageSize.width / 2, 17, { align: "center" });

          const hasNewline = periodInfo.includes('\n');
          doc.setFontSize(10);
          doc.setTextColor(44, 62, 80);
          doc.setFillColor(214, 234, 248);
          doc.rect(0, 20, doc.internal.pageSize.width, hasNewline ? 14 : 7, "F");

          const fullText = `Generated by: ${session?.user?.name || "System"}${periodInfo}`;
          const lines = fullText.split('\n');

          lines.forEach((line, index) => {
            const yPos = 25 + (index * 6);
            const segments = line.split(/(\s*\|\s*)/);

            let totalWidth = 0;
            segments.forEach(seg => {
              if (seg.includes(':')) {
                const colonIdx = seg.indexOf(':');
                const label = seg.substring(0, colonIdx + 1);
                const val = seg.substring(colonIdx + 1);
                doc.setFont("helvetica", "bolditalic");
                totalWidth += doc.getTextWidth(label);
                doc.setFont("helvetica", "italic");
                totalWidth += doc.getTextWidth(val || "");
              } else {
                doc.setFont("helvetica", "italic");
                totalWidth += doc.getTextWidth(seg);
              }
            });

            let startX = 10;
            segments.forEach(seg => {
              if (seg.includes(':')) {
                const colonIdx = seg.indexOf(':');
                const label = seg.substring(0, colonIdx + 1);
                const val = seg.substring(colonIdx + 1);
                doc.setFont("helvetica", "bolditalic");
                doc.text(label, startX, yPos);
                startX += doc.getTextWidth(label);
                doc.setFont("helvetica", "italic");
                doc.text(val || "", startX, yPos);
                startX += doc.getTextWidth(val || "");
              } else {
                doc.setFont("helvetica", "italic");
                doc.text(seg, startX, yPos);
                startX += doc.getTextWidth(seg);
              }
            });
          });
        }

        const exportHeaders = config.layout === 'nested'
          ? config.detailColumns.map(col => ({ title: col.headerName, dataKey: col.headerName, width: col.width || 40 }))
          : columnsForExport.map(col => ({ title: col.headerName, dataKey: col.headerName, width: col.width || 40 }));

        const mainHeaders = exportHeaders;

        const marginSize = isQCReport ? 5 : 10;
        const pageWidth = doc.internal.pageSize.width - marginSize * 2;
        const columnCount = mainHeaders.length;

        const columnStyles = {};

        let totalDesiredWidth = 0;
        const desiredWidths = mainHeaders.map((header) => {
          let desiredWidth = header.width || (isQCReport ? 10 : 40);

          if (isQCReport) {
            if (header.title.toLowerCase().includes("product")) {
              desiredWidth = 30;
            } else if (
              header.title.toLowerCase().includes("mfg date") ||
              header.title.toLowerCase().includes("date")
            ) {
              desiredWidth = 18;
            } else if (
              header.title.toLowerCase().includes("batch") ||
              header.title.toLowerCase().includes("ord no") ||
              header.title.toLowerCase().includes("itcd")
            ) {
              desiredWidth = 14;
            } else if (
              header.title.toLowerCase().includes("result") ||
              header.title.toLowerCase().includes("qc result")
            ) {
              desiredWidth = 16;
            } else if (
              header.title.toLowerCase().includes("reason") ||
              header.title.toLowerCase().includes("reject")
            ) {
              desiredWidth = 20;
            } else {
              desiredWidth = 10;
            }
          }

          totalDesiredWidth += desiredWidth;
          return desiredWidth;
        });

        const scaleFactor = pageWidth / totalDesiredWidth;
        desiredWidths.forEach((desiredWidth, idx) => {
          columnStyles[idx] = { cellWidth: desiredWidth * scaleFactor };
        });

        autoTable(doc, {
          showHead: false,
          head: [mainHeaders.map((h) => h.title)],
          body: mainData.map((row) => {
            if (row._isCustomerOnlyHeader) {
              return [{ content: `Customer: ${row._customerName}`, colSpan: mainHeaders.length, styles: { halign: 'center' } }];
            }
            if (row._isISOHeader) {
              const r = row._row;
              const safeDate = (val) => {
                if (!val) return "N/A";
                const d = new Date(val);
                return isNaN(d.getTime()) ? "N/A" : format(d, "MMM dd, yyyy");
              };
              if (isSalesOrderBalance) {
                return [
                  { content: `Date: ${safeDate(r.orderDate)}` },
                  { content: `ISO: ${row._so_no}` },
                  { content: `PO#: ${r.sale_po || ""}` },
                  { content: "" }
                ];
              }
              return [
                { content: `Date: ${safeDate(r.dated)}` },
                { content: `ISO: ${row._so_no}` },
                { content: `Dispatch#: ${r.dispatch_no}` },
                { content: `Invoice#: ${r.invoice_no || ""}` }
              ];
            }
            if (row._isSubHeader) {
              return mainHeaders.map(h => h.title);
            }
            if (row._isMasterFooter) {
              const res = new Array(mainHeaders.length).fill("");
              if (isSalesOrderBalance) {
                res[mainHeaders.length - 4] = "Order Total:";
                res[mainHeaders.length - 3] = row._row.totalOrdered.toFixed(2);
                res[mainHeaders.length - 2] = (row._row.totalShip || 0).toFixed(2);
                res[mainHeaders.length - 1] = row._row.totalPending.toFixed(2);
              } else {
                const totalQty = row._row.transactions?.reduce((sum, item) => sum + (parseFloat(item.qty) || 0), 0).toFixed(2);
                res[mainHeaders.length - 2] = "Total Dispatch:";
                res[mainHeaders.length - 1] = totalQty;
              }
              return res;
            }
            if (row._isCustomerTotal) {
              const res = new Array(mainHeaders.length).fill("");
              if (isSalesOrderBalance) {
                res[mainHeaders.length - 4] = "Customer Total:";
                res[mainHeaders.length - 3] = row._totalOrdered.toFixed(2);
                res[mainHeaders.length - 2] = row._totalShip.toFixed(2);
                res[mainHeaders.length - 1] = row._totalPending.toFixed(2);
              } else {
                res[mainHeaders.length - 2] = "Customer Total:";
                res[mainHeaders.length - 1] = row._totalQty.toFixed(2);
              }
              return res;
            }
            if (row._isDetailRow) {
              return mainHeaders.map((header) => {
                const value = row._row[header.dataKey] || "";
                return typeof value === "string" ? value.trim() : value;
              });
            }
            return mainHeaders.map((header) => {
              const value = row[header.dataKey] || "";
              return typeof value === "string" ? value.trim() : value;
            });
          }),
          startY: isQCReport ? 25 : (periodInfo.includes('\n') ? 36 : 30),
          margin: { left: marginSize, right: marginSize },
          styles: commonStyles,
          headStyles: {
            fillColor: isQCReport ? [241, 90, 34] : [44, 62, 80],
            textColor: [255, 255, 255],
            fontSize: isQCReport ? 7 : 10,
            cellPadding: isQCReport ? 0.3 : 1,
            fontStyle: "bold",
            halign: "center",
            lineWidth: 0.2,
          },
          bodyStyles: {
            lineWidth: 0.25,
            halign: "center",
          },
          alternateRowStyles: {
            fillColor: [248, 249, 250],
          },
          columnStyles: columnStyles,
          didParseCell: (data) => {
            const text = data.cell.text[0] || "";
            if (text.startsWith('Customer:')) {
              data.cell.styles.fillColor = [128, 0, 0]; // Deep Maroon
              data.cell.styles.textColor = [255, 255, 255];
              data.cell.styles.fontStyle = 'bold';
              data.cell.styles.fontSize = 11;
            } else if (
              text.startsWith('ISO:') ||
              text.startsWith('Date:') ||
              text.startsWith('Dispatch#:') ||
              text.startsWith('Invoice#:') ||
              text.startsWith('PO#:')
            ) {
              data.cell.styles.fillColor = [240, 240, 240]; // Light Grey
              data.cell.styles.fontStyle = 'bold';
              data.cell.styles.textColor = [0, 0, 0]; // Pure black for maximum contrast
              data.cell.styles.fontSize = 10;
            }

            if (data.row.index === mainData.findIndex(r => r === data.row.raw)) {
              // ...
            }
            // Style for footer
            const rawRow = mainData[data.row.index];
            if (rawRow && (rawRow._isMasterFooter || rawRow._isCustomerTotal)) {
              data.cell.styles.fontStyle = 'bold';
              data.cell.styles.fillColor = [200, 200, 200]; // Neutral Light Grey
              data.cell.styles.textColor = [50, 50, 50];
            }
            if (rawRow && rawRow._isSubHeader) {
              data.cell.styles.fillColor = [200, 200, 200]; // Same Neutral Light Grey
              data.cell.styles.textColor = [50, 50, 50];
              data.cell.styles.fontStyle = 'bold';
              data.cell.styles.fontSize = 10;
            }
          },
          didDrawCell: (data) => {
            if (data.cell.raw && data.cell.raw.length > 30) {
              data.row.height = Math.max(data.row.height, 8);
            }
          },
        });
      } else {
        // --- STANDARD REPORT PDF FLOW — Modern Professional Design ---
        // Grouped rows carry the group headers / subtotals; totals below must
        // skip them so the grand total is not double-counted.
        const filteredData = groupedAllData;
        const plainRows = filteredData.filter((r) => !r?.__rowType);
        const rawColumnsForExport = isQCReport ? exportColumns : allColumns;
        const columnsForExport = rawColumnsForExport?.filter((col) => !hiddenColumns[col.field]);
        const pageW = doc.internal.pageSize.width;
        const margin = 10;
        const companyNamePDF = company?.name || "Company Name";

        if (!isQCReport) {
          // ── Header banner ────────────────────────────────────────────────
          doc.setFillColor(15, 23, 42);
          doc.rect(0, 0, pageW, 20, 'F');

          // Company name — left, white bold
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(14);
          doc.setTextColor(255, 255, 255);
          doc.text(companyNamePDF, margin, 11);

          // Report title — left, muted below company
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(8.5);
          doc.setTextColor(148, 163, 184);
          doc.text(config.title.toUpperCase(), margin, 17.5);

          // Print date — right, top
          const pdfDate = format(new Date(), 'dd MMM yyyy, HH:mm');
          doc.setFont('helvetica', 'normal');
          doc.setFontSize(7.5);
          doc.setTextColor(148, 163, 184);
          doc.text(pdfDate, pageW - margin, 11, { align: 'right' });
          doc.text(`${filteredData.length} record(s)`, pageW - margin, 17.5, { align: 'right' });

          // Thin bottom border on banner
          doc.setDrawColor(30, 41, 59);
          doc.setLineWidth(0.4);
          doc.line(0, 20, pageW, 20);

          // ── Info bar ──────────────────────────────────────────────────────
          const fullText = `Generated by: ${session?.user?.name || 'System'}${periodInfo}`;
          const infoLines = fullText.split('\n');
          const infoLineH = 6.5;
          const infoBarH = infoLines.length * infoLineH + 3;
          const infoBarY = 20;

          doc.setFillColor(248, 250, 252);
          doc.rect(0, infoBarY, pageW, infoBarH, 'F');

          // Bottom border of info bar
          doc.setDrawColor(226, 232, 240);
          doc.setLineWidth(0.3);
          doc.line(0, infoBarY + infoBarH, pageW, infoBarY + infoBarH);

          doc.setFontSize(7.5);
          infoLines.forEach((line, li) => {
            const segs = line.split(/\s*\|\s*/);
            let x = margin;
            const y = infoBarY + 2 + infoLineH * (li + 0.75);

            segs.forEach((seg, si) => {
              // Vertical pipe divider between segments
              if (si > 0) {
                doc.setDrawColor(203, 213, 225);
                doc.setLineWidth(0.3);
                doc.line(x + 2.5, y - 3.5, x + 2.5, y + 1);
                x += 7;
              }
              const ci = seg.indexOf(':');
              if (ci !== -1) {
                const lbl = seg.substring(0, ci + 1);
                const val = seg.substring(ci + 1).trim();
                // Label — bold slate
                doc.setFont('helvetica', 'bold');
                doc.setTextColor(71, 85, 105);
                doc.text(lbl, x, y);
                x += doc.getTextWidth(lbl) + 1.5;
                // Value — dark
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(15, 23, 42);
                doc.text(val, x, y);
                x += doc.getTextWidth(val);
              } else if (seg.trim()) {
                doc.setFont('helvetica', 'normal');
                doc.setTextColor(15, 23, 42);
                doc.text(seg.trim(), x, y);
                x += doc.getTextWidth(seg.trim());
              }
            });
          });

          var tableStartY = infoBarY + infoBarH + 1;
        } else {
          var tableStartY = 25;
        }

        // ── Column width calculation ──────────────────────────────────────
        const isPortrait = pdfOrientation === "portrait";
        const exportHeaders = columnsForExport.map(col => ({ title: col.headerName, width: col.width || 40 }));
        const marginSize = isQCReport ? 5 : 10;
        const availableW = pageW - marginSize * 2;
        let totalW = 0;
        const rawWidths = exportHeaders.map((h) => {
          totalW += h.width;
          return h.width;
        });
        const scale = availableW / totalW;
        const columnStyles = {};
        rawWidths.forEach((w, i) => {
          const col = columnsForExport[i];
          columnStyles[i] = {
            cellWidth: w * scale,
            halign:
              col?.type === "currency" || col?.type === "number" || col?.showTotal
                ? "right"
                : col?.type === "date"
                ? "center"
                : "left",
          };
        });

        // ── Table body ────────────────────────────────────────────────────
        const groupRowIdx = { header: new Set(), total: new Set() };
        const tableBody = filteredData.map((row, rowIdx) => {
          if (row?.__rowType === "groupHeader") {
            groupRowIdx.header.add(rowIdx);
            return columnsForExport.map((c, i) => (i === 0 ? row.__label : ""));
          }
          if (row?.__rowType === "groupTotal") {
            groupRowIdx.total.add(rowIdx);
            return columnsForExport.map((col, i) => {
              if (i === 0) return row.__label;
              if (!Object.prototype.hasOwnProperty.call(row, col.field)) return "";
              const num = Number(row[col.field]) || 0;
              return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2, });
            });
          }
          return columnsForExport.map((col) => {
            let v = col.valueGetter ? col.valueGetter({ row }) : row[col.field];
            if (col.type === "currency" || col.type === "number") {
              const num = Number(v) || 0;
              return num.toLocaleString("en-US", {
                minimumFractionDigits: 2,
                maximumFractionDigits: 2,
              });
            }
            v = formatCellValue(v);
            return typeof v === "string" ? v.trim() : v;
          });
        });

        // ── Totals footer ─────────────────────────────────────────────────
        const pdfTotalsFooter =
          !isQCReport && columnsForExport?.some((c) => c.showTotal)
            ? [
                columnsForExport.map((col, idx) => {
                  if (col.showTotal) {
                    let val;
                    if (col.totalType === "last") {
                      val = 0;
                      for (let i = plainRows.length - 1; i >= 0; i--) {
                    const v = col.valueGetter ? col.valueGetter({ row: plainRows[i] })
                          : plainRows[i][col.field];
                    if (v !== null && v !== undefined) { val = Number(v) || 0; break; }
                      }
                    } else {
                      val = plainRows.reduce((a, row) => {
                        const v = col.valueGetter
                          ? col.valueGetter({ row })
                          : row[col.field];
                        return a + (Number(v) || 0);
                      }, 0);
                    }
                    return val.toLocaleString("en-US", {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    });
                  }
              return idx === 0 ? "TOTAL" : "";
                }),
              ]
            : undefined;

        // ── Column headers ────────────────────────────────────────────────
        const pdfHasGroupHeaders = columnsForExport?.some((col) => col.groupHeader);
        let pdfHead;

        if (pdfHasGroupHeaders) {
          // Build group spans for PDF
          const pdfGroups = [];
          let pdfColIdx = 0;
          columnsForExport.forEach((col) => {
            const gName = col.groupHeader || null;
            const lastGroup = pdfGroups[pdfGroups.length - 1];
            if (lastGroup && lastGroup.groupHeader === gName) {
              lastGroup.cols.push(col);
            } else {
              pdfGroups.push({ groupHeader: gName, cols: [col], startCol: pdfColIdx });
            }
            pdfColIdx++;
          });

          // Row 1: group header cells
          const pdfHeadRow1 = [];
          pdfGroups.forEach((grp) => {
            if (!grp.groupHeader) {
              // Non-grouped cols: rowSpan=2
              grp.cols.forEach((col) => {
                pdfHeadRow1.push({
                  content: col.headerName,
                  rowSpan: 2,
                  styles: { halign: 'center', valign: 'middle', fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold' },
                });
              });
            } else {
              // Grouped cols: colSpan = number of cols in group
              pdfHeadRow1.push({
                content: grp.groupHeader,
                colSpan: grp.cols.length,
                styles: { halign: 'center', valign: 'middle', fillColor: [30, 41, 59], textColor: [255, 255, 255], fontStyle: 'bold' },
              });
            }
          });

          // Row 2: sub-header cells for grouped cols only
          const pdfHeadRow2 = [];
          columnsForExport.forEach((col) => {
            if (col.groupHeader) {
              pdfHeadRow2.push({
                content: col.headerName,
                styles: {
                  halign: col.align === 'right' ? 'right' : col.align === 'center' ? 'center' : 'center',
                  valign: 'middle',
                  fillColor: [51, 65, 85],
                  textColor: [255, 255, 255],
                  fontStyle: 'bold',
                },
              });
            }
          });

          pdfHead = [pdfHeadRow1, pdfHeadRow2];
        } else {
          const headNameRow = columnsForExport.map((col) => col.exportHeader || col.headerName);
          pdfHead = [headNameRow];
        }

        autoTable(doc, {
          head: pdfHead,
          body: tableBody,
          foot: pdfTotalsFooter,
          showFoot: pdfTotalsFooter ? "lastPage" : "never",
          startY: tableStartY,
          margin: { left: marginSize, right: marginSize, bottom: 12 },
          rowPageBreak: "avoid",
          styles: {
            fontSize: isPortrait ? 7 : isQCReport ? 6 : 8,
            font: "helvetica",
            cellPadding: isPortrait
              ? { top: 1, bottom: 1, left: 0.6, right: 0.6 }
              : isQCReport
              ? 0.3
              : { top: 2.5, bottom: 2.5, left: 2, right: 2 },
            lineWidth: 0.15,
            lineColor: [226, 232, 240],
            overflow: "linebreak",
            minCellHeight: isPortrait ? 3 : isQCReport ? 3.5 : 5.5,
          },
          headStyles: {
            fillColor: [15, 23, 42],
            textColor: [255, 255, 255],
            fontStyle: "bold",
            fontSize: isPortrait ? 6.5 : isQCReport ? 7 : 8.5,
            cellPadding: isPortrait
              ? { top: 1, bottom: 1, left: 0.6, right: 0.6 }
              : isQCReport
              ? 0.5
              : { top: 3, bottom: 2, left: 2, right: 2 },
            lineWidth: 0,
          },
          bodyStyles: {
            lineWidth: 0.15,
            lineColor: [226, 232, 240],
            textColor: [30, 41, 59],
          },
          alternateRowStyles: {
            fillColor: [248, 250, 252],
          },
          footStyles: {
            fillColor: [15, 23, 42],
            textColor: [255, 255, 255],
            fontStyle: "bold",
            fontSize: isPortrait ? 6.5 : 8,
            cellPadding: isPortrait ? { top: 1, bottom: 1, left: 0.6, right: 0.6 } : { top: 2.5, bottom: 2.5, left: 2, right: 2 },
            lineWidth: 0,
          },
          columnStyles: columnStyles,
          didParseCell: (hook) => {
            if (hook.section === "foot") {
              const col = columnsForExport[hook.column.index];
              if (col?.type === "currency" || col?.type === "number" || col?.showTotal) {
                hook.cell.styles.halign = "right";
              }
            }
            if (hook.section !== "body") return;
            if (groupRowIdx.header.has(hook.row.index)) {
              hook.cell.styles.fillColor = [30, 41, 59];
              hook.cell.styles.textColor = [255, 255, 255];
              hook.cell.styles.fontStyle = "bold";
            } else if (groupRowIdx.total.has(hook.row.index)) {
              hook.cell.styles.fillColor = [226, 232, 240];
              hook.cell.styles.fontStyle = "bold";
              const col = columnsForExport[hook.column.index];
              if (col?.type === "currency" || col?.type === "number" || col?.showTotal) {
                hook.cell.styles.halign = "right";
              }
            }
          },
        });
      }

      const pageCount = doc.internal.getNumberOfPages();
      for (let i = 1; i <= pageCount; i++) {
        doc.setPage(i);
        const pw = doc.internal.pageSize.getWidth();
        const ph = doc.internal.pageSize.getHeight();

        // Modern footer bar
        doc.setFillColor(241, 245, 249);
        doc.rect(0, ph - 7, pw, 7, 'F');

        doc.setFont('helvetica', 'normal');
        doc.setFontSize(7);
        doc.setTextColor(100, 116, 139);
        doc.text(company?.name || '', 10, ph - 2.8);
        doc.text(
          `Page ${i} of ${pageCount}  ·  ${format(new Date(), 'dd MMM yyyy')}`,
          pw - 10,
          ph - 2.8,
          { align: 'right' }
        );

        // Mini header repeat on page 2+
        if (i > 1 && !isQCReport) {
          doc.setFillColor(15, 23, 42);
          doc.rect(0, 0, pw, 7, 'F');
          doc.setFont('helvetica', 'bold');
          doc.setFontSize(7.5);
          doc.setTextColor(255, 255, 255);
          doc.text(config.title.toUpperCase(), 10, 5);
          doc.setFont('helvetica', 'normal');
          doc.setTextColor(148, 163, 184);
          doc.text(company?.name || '', pw - 10, 5, { align: 'right' });
        }
      }

      const timestamp = format(new Date(), "yyyy-MM-dd_HHmm");
      const blobUrl = doc.output("bloburl");
      setPreviewPdfUrl(blobUrl);
      setPreviewTitle(`${config.title} - ${timestamp}`);
      setCurrentFileName(`${config.title}_${timestamp}.pdf`);
      setCurrentDoc(doc);
      setIsPreviewOpen(true);
    } catch (error) {
      console.error("PDF Export Error:", error);
      alert("Failed to generate PDF. Please check console for details.");
    } finally {
      setIsExporting(false);
    }
  };

  const formatCellValue = (value) => {
    if (isQCReport) {
      if (
        value === null ||
        value === undefined ||
        value === "" ||
        value === 0 ||
        value === "0"
      ) {
        return "";
      }
      return value;
    }
    if (value === null || value === undefined || value === 0 || value === "0") {
      return "0";
    }

    // Check if value is a strict ISO date string (YYYY-MM-DD or YYYY-MM-DDTHH:mm:ss) or a Date object
    const isISODate = value instanceof Date ||
      (typeof value === "string" && /^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}:\d{2})?/.test(value));
    if (isISODate) {
      const date = new Date(value);
      if (!isNaN(date.getTime())) {
        return format(date, "MMM dd, yyyy");
      }
    }

    return value;
  };

  const exportToCSV = async () => {
    let csvContent = "";

    const baseColumnsToUse = isQCReport
      ? exportColumns && exportColumns.length > 0
        ? exportColumns
        : allColumns
      : allColumns && allColumns.length > 0
        ? allColumns
        : config.columns || [];

    const columnsToUse = baseColumnsToUse.filter((col) => !hiddenColumns[col.field]);

    const mainHeaders = columnsToUse.map(
      (col) => `"${col.headerName.replace(/"/g, '""')}"`,
    );
    csvContent += mainHeaders.join(",") + "\n";

    data.forEach((item) => {
      const row = columnsToUse.map((col) => {
        let value = col.valueGetter
          ? col.valueGetter({ row: item })
          : item[col.field] || "";
        if (value === null || value === undefined || value === "") {
          value = "";
        }
        return `"${String(value).replace(/"/g, '""')}"`;
      });
      csvContent += row.join(",") + "\n";

      if (
        config.detailColumns &&
        item.transactions &&
        item.transactions.length > 0
      ) {
        csvContent += "\nDetails for " + (item.vr_no || item.id) + "\n";

        const detailHeaders = [
          "Parent ID",
          "Parent Voucher",
          ...config.detailColumns.map((col) => col.headerName),
        ];
        csvContent +=
          detailHeaders.map((h) => `"${h.replace(/"/g, '""')}"`).join(",") +
          "\n";

        item.transactions.forEach((detail) => {
          const detailRow = [
            item.id || "",
            item.vr_no || "",
            ...config.detailColumns.map((col) => {
              const value = col.valueGetter
                ? col.valueGetter({ row: detail })
                : detail[col.field] || "";
              return `"${String(value).replace(/"/g, '""')}"`;
            }),
          ];
          csvContent += detailRow.join(",") + "\n";
        });

        csvContent += "\n";
      }
    });

    const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
    saveAs(blob, `${config.title}_${format(new Date(), "yyyy-MM-dd")}.csv`);
  };

  const sortedData = useMemo(() => {
    if (!sortConfig.key && data.items) return data.items;
    if (!sortConfig.key) return data;

    return [...data].sort((a, b) => {
      const aVal = a[sortConfig.key];
      const bVal = b[sortConfig.key];

      if (typeof aVal === "number" && typeof bVal === "number") {
        return sortConfig.direction === "asc" ? aVal - bVal : bVal - aVal;
      }

      const aStr = String(aVal || "").toLowerCase();
      const bStr = String(bVal || "").toLowerCase();

      return sortConfig.direction === "asc"
        ? aStr.localeCompare(bStr)
        : bStr.localeCompare(aStr);
    });
  }, [data, sortConfig]);



  const dynamicColumns = useMemo(() => {
    if (!config?.dynamicColumns) return [];

    if (reportType === "stockMetrics" && godowns) {
      return godowns.map((godown) => ({
        field: `godown_${godown.id}`,
        headerName: godown.godown,
        width: 30,
        type: "number",
        valueGetter: (params) => params.row?.godownstocks[godown.id] || 0,
      }));
    }

    if (reportType === "qcParameters" && parameterColumns && parameterColumns.length > 0) {
      return parameterColumns;
    }

    return [];
  }, [config, godowns, parameterColumns, reportType]);

  const reportColumns = useMemo(() => {
    if (!config) return [];

    // Accounts Activity: in compare-months mode use the dynamic month columns
    // returned by the API; otherwise use the local static columns (which keep
    // their valueGetter functions that don't survive JSON serialization).
    if (reportType === "accountsActivity") {
      if (filters.compareMonths && apiColumns.length > 0) {
        return apiColumns;
      }
      return config.getColumns ? config.getColumns(filters) : config.columns || [];
    }

    if (reportType === "stockActivity") {
      if (filters.godownWise && apiColumns.length > 0) return apiColumns;
      return config.getColumns ? config.getColumns(filters) : config.columns || [];
    }

    if (config.apiColumns && apiColumns.length > 0) return apiColumns;

    // For qcParameters, use apiColumns which already have parameters merged from API
    if (reportType === "qcParameters") {
      if (apiColumns.length > 0) {
        return apiColumns;
      }
      // Fallback: if apiColumns empty, build them locally with parameterColumns
      return config.getColumns ? config.getColumns(filters, parameterColumns) : config.columns || [];
    }

    if (isQCReport) {
      if (apiColumns.length > 0) {
        return apiColumns;
      }
      return config.getColumns
        ? config.getColumns(filters)
        : config.columns || [];
    }

    const baseColumns = config.getColumns
      ? config.getColumns(filters)
      : config.columns || [];

    return [...baseColumns, ...dynamicColumns, ...serviceColumns];
  }, [config, dynamicColumns, serviceColumns, filters, reportType, apiColumns, parameterColumns]);

  // + the item Code / Category / Sub Category a report lacks (itemColumns.js)
  const itemSourceRows = Array.isArray(reportData?.allData) ? allData : data;
  const allColumns = useMemo(
    () => withItemColumns(reportColumns, Array.isArray(itemSourceRows) ? itemSourceRows : [], config),
    [reportColumns, itemSourceRows, config],
  );

  const exportColumns = useMemo(() => {
    if (!isQCReport || !allData || allData.length === 0) {
      return allColumns;
    }

    const enableHorizontalScroll = allColumns?.length > 10;

    const baseCols = config.getColumns
      ? config.getColumns(filters)
      : config.columns || [];

    const standardFields = [
      "id",
      "mfg_date",
      "proc_ord_no",
      "itcd",
      "item_name",
      "batch_no",
      "batch_size",
      "status",
      "display_status",
      "reject_reason",
      "transactions",
    ];
    const parameterNames = new Set();

    allData.forEach((row) => {
      Object.keys(row).forEach((key) => {
        if (!standardFields.includes(key) && row[key] !== undefined) {
          parameterNames.add(key);
        }
      });
    });

    const paramColumns = Array.from(parameterNames)
      .sort()
      .map((paramName) => ({
        field: paramName,
        headerName: paramName.toUpperCase(),
        width: 60,
        valueGetter: (params) => params.row[paramName] || "",
      }));

    const rejectReasonColumn = {
      field: "reject_reason",
      headerName: "REJECT REASON",
      width: 100,
      valueGetter: (params) => params.row.reject_reason || "",
    };

    const statusColumn = {
      field: "display_status",
      headerName: "QC RESULT",
      width: 60,
      valueGetter: (params) => {
        return params.row.display_status || params.row.status || "";
      },
    };

    return [...baseCols, ...paramColumns, rejectReasonColumn, statusColumn];
  }, [reportType, allData, config, filters, allColumns]);

  // ── Row grouping: separator + subtotal between groups ──────────────────────
  // Declared per report as config.rowGrouping, so any report whose filter can
  // select several parties can read as one block per party instead of one
  // undifferentiated list. Shape:
  //   rowGrouping: {
  //     by: "acno",                                  // field that identifies the group
  //     labelFields: ["acno", "acname"],             // how the group is named
  //     activateWhen: { filter: "account", minSelected: 2, emptyMeansAll? },  // optional
  //     subtotalLabel: "Account Total",              // default "Total"
  //     totalFields: ["debit", "credit"],            // default: columns with showTotal
  //     showHeader: true,                            // default true
  //   }
  // Synthetic rows are tagged __rowType ("groupHeader" | "groupTotal") and are
  // excluded from every total, so the grand total never double-counts them.
  const rowGrouping = config?.rowGrouping;

  const isRowGroupingActive = useMemo(() => {
    if (!rowGrouping?.by) return false;
    const aw = rowGrouping.activateWhen;
    if (!aw) return true;
    const v = filters?.[aw.filter];
    const count = Array.isArray(v)
      ? v.length
      : typeof v === "string" && v
        ? v.split(",").filter(Boolean).length
        : v ? 1 : 0;
    // emptyMeansAll: nothing picked = every account (e.g. Cash & Bank Book).
    if (aw.emptyMeansAll && count === 0) return true;
    return count >= (aw.minSelected ?? 2);
  }, [rowGrouping, filters]);

  const applyRowGrouping = useCallback((rows) => {
    if (!isRowGroupingActive || !Array.isArray(rows) || rows.length === 0) return rows;

    const cols = allColumns || [];
    const sumFields = rowGrouping.totalFields?.length
      ? rowGrouping.totalFields
      : cols.filter((c) => c.showTotal && c.totalType !== "last").map((c) => c.field);
    const lastFields = cols.filter((c) => c.showTotal && c.totalType === "last").map((c) => c.field);

    const fields = rowGrouping.labelFields || [rowGrouping.by];
    // Take each part from the first row in the group that actually carries it:
    // an account with no movement has a blank name on its opening row, which
    // would otherwise label the whole block with a bare account number.
    const labelOf = (group) =>
      fields
        .map((f) => {
          const hit = group.find((r) => r[f] !== null && r[f] !== undefined && r[f] !== "");
          return hit ? hit[f] : null;
        })
        .filter((v) => v !== null && v !== undefined && v !== "")
        .join(rowGrouping.labelSeparator ?? " — ");

    // Collect contiguous runs of the same key, then emit header + rows + total.
    const groups = [];
    rows.forEach((row) => {
      const k = row[rowGrouping.by];
      const last = groups[groups.length - 1];
      if (last && last.key === k) last.rows.push(row);
      else groups.push({ key: k, rows: [row] });
    });

    const out = [];
    groups.forEach((group) => {
      const label = labelOf(group.rows);
      if (rowGrouping.showHeader !== false) {
        out.push({ __rowType: "groupHeader", __label: label });
      }
      out.push(...group.rows);

      const totals = {};
      sumFields.forEach((f) => {
        totals[f] = group.rows.reduce((acc, r) => acc + (Number(r[f]) || 0), 0);
      });
      // A running balance is not additive — carry the group's last value.
      lastFields.forEach((f) => {
        totals[f] = 0;
        for (let i = group.rows.length - 1; i >= 0; i--) {
          const v = group.rows[i][f];
          if (v !== null && v !== undefined) { totals[f] = Number(v) || 0; break; }
        }
      });
      out.push({
        __rowType: "groupTotal",
        __label: `${rowGrouping.subtotalLabel || "Total"} — ${label}`,
        ...totals,
      });
    });
    return out;
  }, [isRowGroupingActive, rowGrouping, allColumns]);

  const groupedData = useMemo(() => applyRowGrouping(data), [applyRowGrouping, data]);
  const groupedAllData = useMemo(() => applyRowGrouping(allData), [applyRowGrouping, allData]);

  const columnTotals = useMemo(() => {
    const totals = {};
    if (isQCReport) return totals;
    const sourceData = (allData.length > 0 ? allData : data).filter((r) => !r?.__rowType);
    allColumns?.forEach(col => {
      if (!col.showTotal) return;
      if (col.totalType === 'last') {
        for (let i = sourceData.length - 1; i >= 0; i--) {
          const v = col.valueGetter ? col.valueGetter({ row: sourceData[i] }) : sourceData[i][col.field];
          if (v !== null && v !== undefined) { totals[col.field] = Number(v) || 0; return; }
        }
        totals[col.field] = 0;
      } else {
        totals[col.field] = sourceData.reduce((acc, row) => {
          const val = col.valueGetter ? col.valueGetter({ row }) : row[col.field];
          return acc + (Number(val) || 0);
        }, 0);
      }
    });
    return totals;
  }, [allColumns, allData, data, isQCReport]);

  // ── Wide report layout + drill trail (CLAUDE.md rule 15) ─────────────────
  // Every report renders through WideTable — grouped documents and sections
  // too (layout.groupRows), the QC reports (their attempts open in the Record
  // Details sheet) and Process Order Reconciliation (its row opens its own
  // reconciliation window, which keeps its own PDF / Excel).
  const isMobile = useIsMobile();
  const wideRef = useRef(null);
  const isWideMode = !!config;
  // The API returns every row in allData; the wide table shows them as one
  // long list. A response without allData keeps the server paging.
  const hasAllData = Array.isArray(reportData?.allData);
  const wideShowsAll = isWideMode && hasAllData;
  const wideRows = useMemo(() => {
    const src = hasAllData ? allData : data;
    return Array.isArray(src) ? src : [];
  }, [hasAllData, allData, data]);
  const wideModel = useMemo(
    () =>
      isWideMode
        ? resolveLayout({
            config,
            filters,
            columns: allColumns,
            legacyGrouping: isRowGroupingActive ? rowGrouping : null,
            itemGroups: config?.itemColumns === false ? null : itemRowGroups(wideRows),
          })
        : null,
    [isWideMode, config, filters, allColumns, isRowGroupingActive, rowGrouping, wideRows],
  );

  const trailDepth = trailDepthOf(searchParams);
  const [trailSteps, setTrailSteps] = useState([]);
  const [wideInitialScroll, setWideInitialScroll] = useState(null);
  useEffect(() => {
    setTrailSteps(trailStepsFor(trailDepth));
  }, [reportType, trailDepth]);
  useEffect(() => {
    setWideInitialScroll(takeScroll(currentLocationKey()));
  }, [reportType]);

  // "Item: 1000004 - Toluene · Godown: Main" — names a step in the breadcrumb.
  const activeFilterList = useCallback(() => {
    if (!config?.filters) return [];
    return config.filters
      .filter((f) => {
        const v = filters[f.name];
        return v !== undefined && v !== null && v !== "" && v !== "all" && v !== false;
      })
      .map((f) => {
        const raw = filters[f.name];
        const label = typeof f.label === "function" ? f.label(filters) : f.label;
        const value = f.type === "select" ? getFilterLabel(f.name, raw) || raw : f.type === "checkbox" ? "Yes" : raw;
        return { name: f.name, type: f.type, label, value: String(value) };
      });
  }, [config, filters, getFilterLabel]);
  // Summary type (`type` select, ≤ 7 fixed options) is shown as tabs, not in the panel.
  const typeTab = useMemo(() => summaryTypeFilter(config), [config]);
  const panelHidden = useMemo(() => new Set(typeTab ? [typeTab.name] : []), [typeTab]);
  const filterLoadingNames = useMemo(() => {
    const set = new Set();
    (config?.filters || [])
      .filter((f) => f.apiEndpoint)
      .forEach((f, i) => {
        if (filterQueries[i]?.isLoading) set.add(f.name);
      });
    return set;
  }, [config, filterQueries]);
  const trailSub = useMemo(
    () =>
      activeFilterList()
        .filter((f) => f.type === "select")
        .slice(0, 2)
        .map((f) => f.value)
        .join(" · "),
    [activeFilterList],
  );

  const currentHref = () =>
    buildReportHref(window.location.pathname, filters, {
      view: wideRef.current?.getView?.() || searchParams.get(VIEW_PARAM) || undefined,
      depth: trailDepth,
    });

  // Open the next step: another report (a trail step, Back returns here) or a
  // voucher (pushed, so the browser's Back lands on this report). The current
  // address is first rewritten with the full state so either way of coming
  // back finds the same filters, view and scroll position.
  const goDrill = (href, { voucher = false } = {}) => {
    if (!href) return;
    const here = currentHref();
    try {
      window.history.replaceState(window.history.state, "", here);
    } catch {
      // ignore — the step still opens
    }
    saveScroll(here, wideRef.current?.getScroll?.() || { win: window.scrollY });
    const isReport = String(href).includes("/reports/");
    if (voucher || !isReport) {
      router.push(href);
      return;
    }
    pushTrailStep(trailDepth, { label: config.title, sub: trailSub, href: here });
    router.push(withTrailParam(href, trailDepth + 1));
  };
  const goBack = () => {
    const prev = trailSteps[trailDepth - 1];
    if (prev?.href) router.push(prev.href);
    else router.back();
  };

  // Alt+← = Back in the trail (only while there is one; Ctrl+K stays the header search).
  useEffect(() => {
    if (!trailDepth) return;
    const onKey = (e) => {
      if (e.altKey && !e.ctrlKey && !e.metaKey && e.key === "ArrowLeft") {
        e.preventDefault();
        goBack();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [trailDepth, trailSteps]);

  const onWideViewChange = useCallback((viewId) => {
    try {
      const p = new URLSearchParams(window.location.search);
      if (p.get(VIEW_PARAM) === viewId) return;
      p.set(VIEW_PARAM, viewId);
      window.history.replaceState(window.history.state, "", `${window.location.pathname}?${p.toString()}`);
    } catch {
      // the view just is not kept in the address
    }
  }, []);

  // Ways deeper from one row — row panel buttons and the row action icons.
  const wideActionsFor = (row) => {
    const out = [];
    // Process Order Reconciliation: the order's own reconciliation window.
    if (reportType === "processOrderReconciliation" && row?.process_order_no) {
      out.push({ key: "por", label: "Open reconciliation", kind: "lines", primary: true, onClick: () => handleRowClick(row) });
    }
    (Array.isArray(config?.drill) ? config.drill : []).forEach((d, i) => {
      try {
        if (d.when && !d.when(row, filters)) return;
        const href = d.href(row, filters);
        if (href) out.push({ key: `drill${i}`, label: d.label, kind: "drill", onClick: () => goDrill(href) });
      } catch (e) {
        console.error("drill href failed:", e);
      }
    });
    const v = wideModel ? voucherOf(wideModel, row) : null;
    const vHref = v ? voucherHref(v) : null;
    if (vHref) {
      out.push({ key: "voucher", label: `Open ${voucherLabel(v.tran_code) || "voucher"}`, kind: "voucher", onClick: () => goDrill(vHref, { voucher: true }) });
    }
    // The older drillDown link, unless the report now names its drills.
    if (config?.drillDown?.enabled && config.drillDown.linkBuilder && !Array.isArray(config?.drill)) {
      out.push({ key: "legacy", label: config.drillDown.label || "Open details", kind: "drill", onClick: () => handleDrillDown(row) });
    }
    if (config?.detailColumns) {
      const lines = row?.[config.detailData || "transactions"] || row?.orderDetails || row?.materials;
      if (Array.isArray(lines) && lines.length) {
        out.push({ key: "lines", label: `Show lines (${lines.length})`, kind: "lines", onClick: () => handleRowClick(row) });
      }
    }
    return out;
  };

  // Record Details sheet: which rows can be stepped to, and the voucher of
  // the open record (shown as "Open voucher" in its header).
  const recordHasLines = useCallback(
    (row) => {
      if (isQCReport) return true;
      const l = row?.[config?.detailData || "transactions"] || row?.transactions || row?.orderDetails || row?.materials;
      return Array.isArray(l) && l.length > 0;
    },
    [isQCReport, config],
  );
  const recordVoucher = useMemo(() => {
    if (!selectedRecord) return null;
    const v = voucherOf(wideModel || { voucher: null }, selectedRecord);
    const href = v ? voucherHref(v) : null;
    return href ? { href, label: `Open ${voucherLabel(v.tran_code) || "voucher"}` } : null;
  }, [selectedRecord, wideModel]);

  const runCustomRowAction = async (action, row) => {
    if (action.confirm && !window.confirm(action.confirm(row))) return;
    try {
      await action.onClick(row);
      refetch();
    } catch (err) {
      console.error("Row action error:", err);
      alert("Action failed: " + (err.message || "Unknown error"));
    }
  };

  // Older export paths that do more than the table (detail sheets, nested
  // customer blocks, BOM sheets) stay one click away as "classic".
  // A grouped row_type stream (layout.groupRows) has no classic export — the
  // standard Excel / PDF already keep its groups and subtotals.
  const hasClassicExport =
    !!config &&
    !wideModel?.groupRows &&
    (config.layout === "nested" || !!config.detailColumns || reportType === "bom" || reportType === "processOrderReconciliation");
  const ownPdf = reportType === "bom" || reportType === "processOrderReconciliation";
  const handleWideExport = async (kind, mode = "view") => {
    const model = wideRef.current?.getExportModel?.(mode);
    if (!model) return;
    setIsExporting(true);
    try {
      const stamp = format(new Date(), "yyyy-MM-dd_HHmm");
      const meta = {
        title: config.title,
        companyName: company?.name || "",
        userName: session?.user?.name || "System",
        generatedAt: format(new Date(), "dd MMM yyyy, HH:mm"),
        filters: activeFilterList(),
        fileBase: `${config.title}_${mode === "all" ? "All" : "View"}_${stamp}`,
      };
      if (kind === "excel") {
        await exportWideExcel(model, meta);
      } else {
        const doc = await exportWidePdf(model, meta);
        setPreviewPdfUrl(doc.output("bloburl"));
        setPreviewTitle(`${config.title} - ${stamp}`);
        setCurrentFileName(`${meta.fileBase}.pdf`);
        setCurrentDoc(doc);
        setIsPreviewOpen(true);
      }
    } catch (err) {
      console.error("Wide export failed:", err);
      toast.error(`Could not export ${kind === "excel" ? "Excel" : "PDF"}.`);
    } finally {
      setIsExporting(false);
    }
  };

  if (!config) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50/30 to-indigo-50/20 p-6">
        <div className="max-w-7xl mx-auto">
          <Card className="shadow-2xl border-slate-200/50 overflow-hidden">
            <CardHeader className="bg-gradient-to-r from-primary via-primary to-primary text-white">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-white/20 rounded-lg">
                  <Loader2Icon className="w-6 h-6 animate-spin" />
                </div>
                <div>
                  <CardTitle className="text-2xl font-bold">
                    Loading Report Configuration...
                  </CardTitle>
                  <CardDescription className="text-blue-100">
                    Please wait while we prepare your report
                  </CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent className="p-12 space-y-8">
              <div className="space-y-4">
                <div className="h-4 bg-slate-200 rounded-full animate-pulse" />
                <div className="h-4 bg-slate-200 rounded-full animate-pulse w-3/4" />
                <div className="h-4 bg-slate-200 rounded-full animate-pulse w-1/2" />
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    );
  }

  // Header bar on a phone (< 640px): row 1 = title + Filters + "⋯" (summary,
  // arrange accounts, post JV, exports); row 2 = columns, count, pagination.
  // From sm up it is the one-line desktop bar. Display only — every phone item
  // calls the same handler as its desktop button.
  const activeFilterCount = config.filters.filter((f) => filters[f.name] && filters[f.name] !== "" && filters[f.name] !== "all").length;
  const canExport = !isExporting && data.length > 0;
  const hasSummaryToggle = config.summaryFields?.length > 0 && (isLoading || Object.keys(summary).length > 0);
  const hasExports = !!(config.exportOptions?.excel || config.exportOptions?.pdf || config.exportOptions?.csv);
  const hasPhoneMenu = hasExports || !!config.accountOrder || !!config.postJV || hasSummaryToggle;

  return (
    <div className="min-w-0 max-w-full">
      <div className="min-w-0">
        {/* ── Drill trail: breadcrumb + Back when opened from another report ── */}
        {trailDepth > 0 && (
          <nav aria-label="Report trail" className="flex min-w-0 items-center gap-x-1.5 gap-y-1 border-b border-border bg-muted/60 px-2 py-1 text-xs sm:flex-wrap sm:px-3 sm:py-1.5">
            <button
              type="button"
              onClick={goBack}
              title="Back (Alt+←)"
              className="mr-1 inline-flex h-9 shrink-0 items-center gap-1 rounded-md border border-border bg-background px-2.5 font-semibold text-primary hover:border-primary sm:h-7 sm:px-2"
            >
              <ChevronLeft className="h-3.5 w-3.5" /> Back
            </button>
            {/* Phone: only the step just before this one; "…" stands for the rest */}
            {trailSteps.length > 1 && (
              <>
                <span className="shrink-0 text-muted-foreground sm:hidden" aria-hidden="true">…</span>
                <ChevronRight className="h-3 w-3 shrink-0 text-muted-foreground/60 sm:hidden" />
              </>
            )}
            {trailSteps.map((s, i) => (
              <React.Fragment key={i}>
                <button
                  type="button"
                  onClick={() => router.push(s.href)}
                  className={`${i < trailSteps.length - 1 ? "hidden sm:inline" : ""} min-w-0 max-w-[38vw] truncate text-muted-foreground hover:text-primary hover:underline sm:max-w-[260px]`}
                  title={s.sub ? `${s.label} · ${s.sub}` : s.label}
                >
                  {s.label}
                  {s.sub ? <span className="opacity-70"> · {s.sub}</span> : null}
                </button>
                <ChevronRight className={`h-3 w-3 shrink-0 text-muted-foreground/60 ${i < trailSteps.length - 1 ? "hidden sm:block" : ""}`} />
              </React.Fragment>
            ))}
            <span className="min-w-0 truncate font-semibold text-foreground sm:max-w-[260px]">
              {config.title}
              {trailSub ? <span className="font-normal text-muted-foreground"> · {trailSub}</span> : null}
            </span>
          </nav>
        )}
        {/* ── Single merged bar: [left: columns+rows+count] [center: title] [right: pagination+actions] ── */}
        {/* Wraps on a phone: the title takes its own line, the tools below it. */}
        <div className="bg-primary px-2 sm:px-3 py-1.5 flex flex-wrap sm:flex-nowrap items-center gap-x-1 gap-y-0.5 sm:gap-2 shadow-sm min-h-[40px]">

          {/* LEFT — columns toggle + rows select + record count */}
          <div className="order-4 sm:order-none flex-1 flex items-center gap-1.5 min-w-0">
            {/* Columns toggle */}
            <div className="relative">
              <button
                onClick={() => { setShowColumnPanel(v => !v); setShowRowsPanel(false); }}
                aria-label="Columns"
                title="Columns"
                className="inline-flex h-10 min-w-10 justify-center sm:h-auto sm:min-w-0 items-center gap-1 text-xs font-medium text-white/65 hover:text-white hover:bg-white/15 px-2 py-1 rounded transition-colors"
              >
                <EyeIcon className="w-4 h-4 sm:w-3.5 sm:h-3.5" />
                <span className="hidden sm:inline">Columns</span>
                {Object.values(hiddenColumns).filter(Boolean).length > 0 && (
                  <span className="bg-white text-primary text-[10px] font-bold px-1 py-0 rounded-full leading-none ml-0.5">
                    {Object.values(hiddenColumns).filter(Boolean).length}
                  </span>
                )}
              </button>
              {showColumnPanel && (
                <div
                  className="absolute left-0 top-full mt-1 z-[9999] bg-white border border-slate-200 rounded-xl shadow-xl w-52 max-w-[calc(100vw-1rem)] overflow-hidden"
                  onMouseLeave={() => setShowColumnPanel(false)}
                >
                  <div className="flex items-center justify-between px-3 py-2 bg-primary text-white">
                    <span className="text-xs font-semibold uppercase tracking-wide">Columns</span>
                    <button onClick={resetColumns} className="text-[10px] text-white/80 hover:text-white underline">Show all</button>
                  </div>
                  <div className="max-h-60 overflow-y-auto py-1">
                    {allColumns?.map((col) => (
                      <label key={col.field} className="flex min-h-10 sm:min-h-0 items-center gap-2.5 px-3 py-1.5 hover:bg-slate-50 cursor-pointer">
                        <input type="checkbox" checked={!hiddenColumns[col.field]} onChange={() => toggleColumn(col.field)} className="accent-primary w-3.5 h-3.5 rounded" />
                        <span className="text-xs text-slate-700 truncate">{col.headerName}</span>
                      </label>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {/* Rows per page — the wide table shows every row in one list */}
            {!wideShowsAll && (
            <div className="relative">
              <button
                onClick={() => { setShowRowsPanel(v => !v); setShowColumnPanel(false); }}
                aria-label={`${pageSize} rows per page`}
                className="inline-flex h-10 sm:h-auto items-center gap-1 text-xs font-medium text-white/65 hover:text-white hover:bg-white/15 px-2 py-1 rounded transition-colors"
              >
                {pageSize}<span className="hidden sm:inline"> rows</span> <ChevronDownIcon className="w-3 h-3" />
              </button>
              {showRowsPanel && (
                <div
                  className="absolute left-0 top-full mt-1 z-[9999] bg-white border border-slate-200 rounded-lg shadow-xl overflow-hidden w-24"
                  onMouseLeave={() => setShowRowsPanel(false)}
                >
                  {[10, 25, 50, 100,200,500,1000].map(n => (
                    <button key={n} onClick={() => { handlePageSizeChange(String(n)); setShowRowsPanel(false); }}
                      className={`w-full min-h-10 sm:min-h-0 text-left px-3 py-1.5 text-xs transition-colors ${pageSize === n ? "font-semibold text-primary bg-primary/5" : "text-slate-700 hover:bg-slate-50"}`}>
                      {n} rows
                    </button>
                  ))}
                </div>
              )}
            </div>
            )}

            {/* Separator + record count */}
            {!isLoading && totalRecords > 0 && wideShowsAll && (
              <span className="text-xs text-white/60 whitespace-nowrap">
                <span className="text-white font-semibold">{totalRecords.toLocaleString()}</span> rows
              </span>
            )}
            {!isLoading && totalRecords > 0 && !wideShowsAll && (
              <>
                <div className="hidden sm:block w-px h-3.5 bg-white/20" />
                <span className="text-xs text-white/60 whitespace-nowrap">
                  <span className="text-white font-semibold">{startRecord}–{endRecord}</span>
                  {" "}of{" "}
                  <span className="text-white font-semibold">{totalRecords}</span>
                </span>
              </>
            )}
            {(isLoading || isFetching) && (
              <span className="flex items-center gap-1 text-white/50 text-xs">
                <Loader2Icon className="w-3 h-3 animate-spin" /><span className="hidden sm:inline">Loading…</span>
              </span>
            )}
          </div>

          {/* CENTER — title (shrink-0 so it stays centered between two flex-1 sides).
              Phone: first row, left-aligned, up to two lines, beside the phone actions. */}
          <div className="order-1 sm:order-none min-w-0 flex-1 sm:flex-none sm:w-auto sm:shrink-0 px-1 sm:px-3 py-1 sm:py-0 text-left sm:text-center">
            <h1 title={config.title} className="text-sm font-bold text-white leading-tight break-words line-clamp-2 sm:line-clamp-none sm:whitespace-nowrap">{config.title}</h1>
          </div>

          {/* PHONE — Filters + "⋯" (the desktop buttons on the right are hidden below sm) */}
          <div className="order-2 flex shrink-0 items-center gap-1 sm:hidden">
            <button onClick={() => openFilters()}
              aria-label={activeFilterCount ? `Filters, ${activeFilterCount} set` : "Filters"}
              className="relative h-10 w-10 flex items-center justify-center rounded-lg bg-white text-primary hover:bg-white/90 shadow-sm transition-colors">
              {isFetching ? <Loader2Icon className="w-4 h-4 animate-spin" /> : <FilterIcon className="w-4 h-4" />}
              {activeFilterCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-primary text-white text-[10px] font-bold min-w-4 h-4 px-0.5 rounded-full flex items-center justify-center leading-none border border-white">
                  {activeFilterCount}
                </span>
              )}
            </button>
            {hasPhoneMenu && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button aria-label="More actions" title="More actions"
                    className="h-10 w-10 flex items-center justify-center rounded-lg text-white hover:bg-white/15 transition-colors">
                    <MoreHorizontal className="w-5 h-5" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" collisionPadding={8} className="w-64 max-w-[calc(100vw-1rem)] max-h-[var(--radix-dropdown-menu-content-available-height)] overflow-y-auto">
                  {hasSummaryToggle && (
                    <DropdownMenuItem className="min-h-10" onSelect={toggleSummary}>
                      <BarChart3Icon className="w-4 h-4 mr-2" />
                      {summaryCollapsed ? "Show summary" : "Hide summary"}
                    </DropdownMenuItem>
                  )}
                  {config.accountOrder && (
                    <DropdownMenuItem className="min-h-10" onSelect={() => setShowAccountOrder(true)}>
                      <ListOrdered className="w-4 h-4 mr-2" />
                      Arrange accounts
                    </DropdownMenuItem>
                  )}
                  {config.postJV && (
                    <DropdownMenuItem className="min-h-10" disabled={isPostingJV || isLoadingJVPreview || data.length === 0} onSelect={openJVPreview}>
                      <Landmark className="w-4 h-4 mr-2" />
                      {config.postJV.label}
                    </DropdownMenuItem>
                  )}
                  {hasExports && (
                    <>
                      {(hasSummaryToggle || config.accountOrder || config.postJV) && <DropdownMenuSeparator />}
                      <DropdownMenuLabel className="text-[11px] uppercase tracking-wider text-muted-foreground">Export</DropdownMenuLabel>
                    </>
                  )}
                  {config.exportOptions?.excel && (isWideMode ? (
                    <>
                      <DropdownMenuItem className="min-h-10" disabled={!canExport} onSelect={() => handleWideExport("excel", "view")}>
                        <FileSpreadsheetIcon className="w-4 h-4 mr-2 text-emerald-600" />Excel — current view
                      </DropdownMenuItem>
                      <DropdownMenuItem className="min-h-10" disabled={!canExport} onSelect={() => handleWideExport("excel", "all")}>
                        <FileSpreadsheetIcon className="w-4 h-4 mr-2 text-emerald-600" />Excel — everything
                      </DropdownMenuItem>
                      {hasClassicExport && (
                        <DropdownMenuItem className="min-h-10" disabled={!canExport} onSelect={() => handleExport("excel")}>
                          <FileSpreadsheetIcon className="w-4 h-4 mr-2 text-emerald-600" />Excel — classic (with detail sheets)
                        </DropdownMenuItem>
                      )}
                    </>
                  ) : (
                    <DropdownMenuItem className="min-h-10" disabled={!canExport} onSelect={() => handleExport("excel")}>
                      <FileSpreadsheetIcon className="w-4 h-4 mr-2 text-emerald-600" />Excel
                    </DropdownMenuItem>
                  ))}
                  {config.exportOptions?.pdf && (isWideMode ? (
                    <>
                      <DropdownMenuItem className="min-h-10" disabled={!canExport} onSelect={() => handleWideExport("pdf", "view")}>
                        <FileTextIcon className="w-4 h-4 mr-2 text-red-600" />PDF — current view
                      </DropdownMenuItem>
                      {hasClassicExport && (
                        <DropdownMenuItem className="min-h-10" disabled={!canExport} onSelect={() => (ownPdf ? handleExport("pdf") : setShowPdfOrientationModal(true))}>
                          <FileTextIcon className="w-4 h-4 mr-2 text-red-600" />
                          {reportType === "bom" ? "PDF — BOM sheets" : reportType === "processOrderReconciliation" ? "PDF — reconciliation format" : "PDF — classic (with details)"}
                        </DropdownMenuItem>
                      )}
                    </>
                  ) : (
                    <DropdownMenuItem className="min-h-10" disabled={!canExport} onSelect={() => setShowPdfOrientationModal(true)}>
                      <FileTextIcon className="w-4 h-4 mr-2 text-red-600" />PDF
                    </DropdownMenuItem>
                  ))}
                  {config.exportOptions?.csv && (
                    <DropdownMenuItem className="min-h-10" disabled={!canExport} onSelect={() => handleExport("csv")}>
                      <FileIcon className="w-4 h-4 mr-2 text-sky-600" />CSV
                    </DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>

          {/* Phone: line break — row 2 (columns, count, pages) starts here */}
          <div aria-hidden="true" className="order-3 basis-full h-0 sm:hidden" />

          {/* RIGHT — pagination + exports + summary + filters */}
          <div className="order-5 sm:order-none flex-1 flex flex-wrap items-center justify-end gap-1">
            {/* Pagination — phone: ‹ page / pages › with 40px buttons */}
            {totalPages > 1 && !wideShowsAll && (
              <>
                <button onClick={() => handlePageChange(1)} disabled={currentPage === 1}
                  aria-label="First page" className="hidden sm:flex h-6 w-6 items-center justify-center rounded text-white/50 hover:text-white hover:bg-white/15 disabled:opacity-25 transition-colors">
                  <ChevronsLeft className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handlePageChange(currentPage - 1)} disabled={currentPage === 1}
                  aria-label="Previous page" className="h-10 w-10 sm:h-6 sm:w-6 flex items-center justify-center rounded text-white/50 hover:text-white hover:bg-white/15 disabled:opacity-25 transition-colors">
                  <ChevronLeft className="w-3.5 h-3.5" />
                </button>
                <span className="sm:hidden px-1 text-xs tabular-nums text-white/80">{currentPage} / {totalPages}</span>
                {[...Array(Math.min(5, totalPages))].map((_, i) => {
                  let pageNum;
                  if (totalPages <= 5) pageNum = i + 1;
                  else if (currentPage <= 3) pageNum = i + 1;
                  else if (currentPage >= totalPages - 2) pageNum = totalPages - 4 + i;
                  else pageNum = currentPage - 2 + i;
                  return (
                    <button key={i} onClick={() => handlePageChange(pageNum)}
                      className={`hidden sm:flex h-6 w-6 items-center justify-center rounded text-xs font-medium transition-colors ${currentPage === pageNum ? "bg-white text-primary font-bold" : "text-white/60 hover:text-white hover:bg-white/15"}`}>
                      {pageNum}
                    </button>
                  );
                })}
                <button onClick={() => handlePageChange(currentPage + 1)} disabled={currentPage === totalPages}
                  aria-label="Next page" className="h-10 w-10 sm:h-6 sm:w-6 flex items-center justify-center rounded text-white/50 hover:text-white hover:bg-white/15 disabled:opacity-25 transition-colors">
                  <ChevronRight className="w-3.5 h-3.5" />
                </button>
                <button onClick={() => handlePageChange(totalPages)} disabled={currentPage === totalPages}
                  aria-label="Last page" className="hidden sm:flex h-6 w-6 items-center justify-center rounded text-white/50 hover:text-white hover:bg-white/15 disabled:opacity-25 transition-colors">
                  <ChevronsRight className="w-3.5 h-3.5" />
                </button>
                <div className="hidden sm:block w-px h-4 bg-white/20 mx-0.5" />
              </>
            )}

            {/* Desktop actions (sm and up) — on a phone they are the Filters button and the "⋯" menu */}
            <div className="hidden sm:contents">
            {/* Exports — wide reports: Excel "Current view" / "Everything", PDF of the current view */}
            {isWideMode && config.exportOptions?.excel && (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <button disabled={isExporting || data.length === 0} title="Export Excel"
                    className="h-7 w-7 flex items-center justify-center rounded hover:bg-white/15 disabled:opacity-30 transition-colors">
                    <FileSpreadsheetIcon className="w-4 h-4 text-emerald-400" />
                  </button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="end" className="w-56">
                  <DropdownMenuItem onSelect={() => handleWideExport("excel", "view")}>
                    <span className="flex-1">Excel — current view</span>
                  </DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => handleWideExport("excel", "all")}>Excel — everything</DropdownMenuItem>
                  {hasClassicExport && (
                    <DropdownMenuItem onSelect={() => handleExport("excel")}>Excel — classic (with detail sheets)</DropdownMenuItem>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
            {isWideMode && config.exportOptions?.pdf && (
              hasClassicExport ? (
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <button disabled={isExporting || data.length === 0} title="Export PDF"
                      className="h-7 w-7 flex items-center justify-center rounded hover:bg-white/15 disabled:opacity-30 transition-colors">
                      <FileTextIcon className="w-4 h-4 text-red-400" />
                    </button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="end" className="w-56">
                    <DropdownMenuItem onSelect={() => handleWideExport("pdf", "view")}>PDF — current view</DropdownMenuItem>
                    <DropdownMenuItem onSelect={() => (ownPdf ? handleExport("pdf") : setShowPdfOrientationModal(true))}>
                      {reportType === "bom" ? "PDF — BOM sheets" : reportType === "processOrderReconciliation" ? "PDF — reconciliation format" : "PDF — classic (with details)"}
                    </DropdownMenuItem>
                  </DropdownMenuContent>
                </DropdownMenu>
              ) : (
                <button onClick={() => handleWideExport("pdf", "view")} disabled={isExporting || data.length === 0}
                  title="Export PDF (current view)"
                  className="h-7 w-7 flex items-center justify-center rounded hover:bg-white/15 disabled:opacity-30 transition-colors">
                  <FileTextIcon className="w-4 h-4 text-red-400" />
                </button>
              )
            )}
            {/* Exports — icon only, branded colors */}
            {!isWideMode && config.exportOptions?.excel && (
              <button onClick={() => handleExport("excel")} disabled={isExporting || data.length === 0}
                title="Export Excel"
                className="h-7 w-7 flex items-center justify-center rounded hover:bg-white/15 disabled:opacity-30 transition-colors">
                <FileSpreadsheetIcon className="w-4 h-4 text-emerald-400" />
              </button>
            )}
            {!isWideMode && config.exportOptions?.pdf && (
              <button onClick={() => setShowPdfOrientationModal(true)} disabled={isExporting || data.length === 0}
                title="Export PDF"
                className="h-7 w-7 flex items-center justify-center rounded hover:bg-white/15 disabled:opacity-30 transition-colors">
                <FileTextIcon className="w-4 h-4 text-red-400" />
              </button>
            )}
            {config.exportOptions?.csv && (
              <button onClick={() => handleExport("csv")} disabled={isExporting || data.length === 0}
                title="Export CSV"
                className="h-7 w-7 flex items-center justify-center rounded hover:bg-white/15 disabled:opacity-30 transition-colors">
                <FileIcon className="w-4 h-4 text-sky-400" />
              </button>
            )}
            {(config.exportOptions?.excel || config.exportOptions?.pdf || config.exportOptions?.csv) && (
              <div className="w-px h-4 bg-white/20 mx-0.5" />
            )}

            {/* Arrange accounts — the user's saved account order (Funds Flow / Position) */}
            {config.accountOrder && (
              <>
                <button
                  onClick={() => setShowAccountOrder(true)}
                  title="Arrange accounts — set and save the order of accounts"
                  className="h-7 px-2.5 flex items-center gap-1.5 rounded bg-primary-foreground/10 text-primary-foreground/80 hover:text-primary-foreground hover:bg-primary-foreground/20 text-xs font-semibold transition-colors">
                  <ListOrdered className="w-3.5 h-3.5" />
                  <span className="hidden sm:inline">Arrange accounts</span>
                </button>
                <div className="w-px h-4 bg-white/20 mx-0.5" />
              </>
            )}

            {/* Post Journal Voucher (tran_code 3) — COGS / COGM */}
            {config.postJV && (
              <>
                <button
                  onClick={openJVPreview}
                  disabled={isPostingJV || isLoadingJVPreview || data.length === 0}
                  title={config.postJV.label}
                  className="h-7 px-2.5 flex items-center gap-1.5 rounded bg-emerald-500 text-white hover:bg-emerald-600 disabled:opacity-30 text-xs font-semibold transition-colors">
                  {(isPostingJV || isLoadingJVPreview) ? <Loader2Icon className="w-3.5 h-3.5 animate-spin" /> : <Landmark className="w-3.5 h-3.5" />}
                  <span>{config.postJV.label}</span>
                </button>
                <div className="w-px h-4 bg-white/20 mx-0.5" />
              </>
            )}

            {/* Summary toggle — collapses the KPI strip (Alt+S) */}
            {config.summaryFields?.length > 0 && (isLoading || Object.keys(summary).length > 0) && (
              <button
                onClick={toggleSummary}
                title={summaryCollapsed ? "Show summary (Alt+S)" : "Hide summary (Alt+S)"}
                aria-pressed={!summaryCollapsed}
                className={`h-7 px-2.5 flex items-center gap-1.5 rounded text-xs font-semibold transition-colors ${!summaryCollapsed ? "bg-primary-foreground text-primary" : "bg-primary-foreground/10 text-primary-foreground/70 hover:text-primary-foreground hover:bg-primary-foreground/20"}`}
              >
                <BarChart3Icon className="w-3.5 h-3.5" />
                <span>Summary</span>
              </button>
            )}

            {/* Filters — icon only with active badge */}
            <button onClick={() => openFilters()}
              title="Filters (Alt+F)"
              className="relative h-7 w-7 flex items-center justify-center rounded bg-white text-primary hover:bg-white/90 shadow-sm transition-colors ml-0.5">
              {isFetching ? <Loader2Icon className="w-4 h-4 animate-spin" /> : <FilterIcon className="w-4 h-4" />}
              {config.filters.filter(f => filters[f.name] && filters[f.name] !== "" && filters[f.name] !== "all").length > 0 && (
                <span className="absolute -top-1 -right-1 bg-primary text-white text-[9px] font-bold w-3.5 h-3.5 rounded-full flex items-center justify-center leading-none border border-white">
                  {config.filters.filter(f => filters[f.name] && filters[f.name] !== "" && filters[f.name] !== "all").length}
                </span>
              )}
            </button>
            </div>
          </div>
        </div>

        {config.accountOrder && (
          <AccountOrderPanel
            open={showAccountOrder}
            onOpenChange={setShowAccountOrder}
            reportType={reportType}
            config={config}
            params={buildQueryParams}
            onSaved={() => queryClient.invalidateQueries({ queryKey: ["reportData"] })}
          />
        )}

        {/* ── Post Journal Voucher preview modal ── */}
        {config.postJV && (
          <Dialog open={showJVModal} onOpenChange={(o) => !isPostingJV && setShowJVModal(o)}>
            <DialogContent className="max-w-2xl p-0 gap-0">
              <DialogHeader className="px-5 py-3 bg-primary">
                <DialogTitle className="text-white text-sm font-bold flex items-center gap-2">
                  <Landmark className="w-4 h-4" />
                  {config.postJV.confirmTitle}
                </DialogTitle>
              </DialogHeader>

              {/* Success — JV posted */}
              {jvPosted && (
                <div className="px-6 py-8 flex flex-col items-center text-center gap-3">
                  <div className="w-14 h-14 rounded-full bg-emerald-100 flex items-center justify-center">
                    <Check className="w-8 h-8 text-emerald-600" />
                  </div>
                  <div className="text-base font-bold text-slate-800">Your Journal Voucher is posted</div>
                  <div className="text-sm text-slate-500">{jvPosted.message}</div>
                  <div className="mt-1 px-4 py-2 rounded-lg bg-slate-50 border border-slate-200">
                    <div className="text-[11px] uppercase tracking-wide text-slate-400 font-semibold">Voucher No</div>
                    <div className="text-2xl font-extrabold text-primary tabular-nums">#{jvPosted.vr_no ?? jvPosted.tran_id}</div>
                  </div>
                  <div className="text-xs text-slate-500 tabular-nums">
                    Dr {(jvPosted.totalDebit || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    {"  =  "}
                    Cr {(jvPosted.totalCredit || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
                    {jvPosted.lineCount != null ? ` · ${jvPosted.lineCount} lines` : ""}
                  </div>
                </div>
              )}

              {/* Loading */}
              {!jvPosted && isLoadingJVPreview && (
                <div className="px-5 py-10 flex flex-col items-center justify-center gap-2 text-slate-500">
                  <Loader2Icon className="w-6 h-6 animate-spin" />
                  <span className="text-xs">Building voucher preview…</span>
                </div>
              )}

              {/* Preview body */}
              {!jvPosted && !isLoadingJVPreview && jvPreview && (
                <div className="max-h-[70vh] overflow-y-auto">
                  {/* Meta strip */}
                  <div className="px-5 pt-4 pb-3 flex flex-wrap items-center gap-x-6 gap-y-1 text-xs text-slate-600 border-b border-slate-100">
                    <span><span className="opacity-60">Type:</span> <span className="font-semibold">JV (tran_code 3)</span></span>
                    <span><span className="opacity-60">Voucher:</span> <span className="font-semibold">{jvPreview.rmk}</span></span>
                    <span><span className="opacity-60">Date:</span> <span className="font-semibold">{jvPreview.dated ? new Date(jvPreview.dated).toLocaleDateString() : "—"}</span></span>
                    <span className="inline-flex items-center gap-1">
                      <span className="opacity-60">Status:</span>
                      {jvPreview.balanced
                        ? <span className="font-semibold text-emerald-600">Balanced</span>
                        : <span className="font-semibold text-red-600">Unbalanced</span>}
                    </span>
                  </div>

                  {/* Warnings */}
                  {jvPreview.duplicateTranId && (
                    <div className="mx-5 mt-3 px-3 py-2 rounded bg-amber-50 border border-amber-200 text-amber-800 text-xs">
                      A {jvPreview.tag} voucher for this period is already posted (voucher #{jvPreview.duplicateTranId}). Posting again is blocked.
                    </div>
                  )}
                  {Array.isArray(jvPreview.missing) && jvPreview.missing.length > 0 && (
                    <div className="mx-5 mt-3 px-3 py-2 rounded bg-red-50 border border-red-200 text-red-700 text-xs">
                      <div className="font-semibold mb-1">{jvPreview.missing.length} item(s) have no stock account (stock_acno) on their category — set it before posting:</div>
                      <div className="max-h-24 overflow-y-auto leading-relaxed">{jvPreview.missing.join(", ")}</div>
                    </div>
                  )}

                  {/* Lines table */}
                  <div className="px-5 py-3">
                    <table className="w-full text-xs border-collapse">
                      <thead>
                        <tr className="text-slate-500 border-b border-slate-200">
                          <th className="text-left font-semibold py-1.5 pr-2">Account</th>
                          <th className="text-right font-semibold py-1.5 px-2 w-32">Debit</th>
                          <th className="text-right font-semibold py-1.5 pl-2 w-32">Credit</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(jvPreview.lines || []).map((l, i) => (
                          <tr key={i} className="border-b border-slate-50">
                            <td className="py-1.5 pr-2">
                              <span className="font-medium text-slate-700">{l.acname}</span>
                              <span className="text-slate-400 ml-1">#{l.acno}</span>
                            </td>
                            <td className="py-1.5 px-2 text-right tabular-nums">{l.damt ? l.damt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""}</td>
                            <td className="py-1.5 pl-2 text-right tabular-nums">{l.camt ? l.camt.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 }) : ""}</td>
                          </tr>
                        ))}
                        {(jvPreview.lines || []).length === 0 && (
                          <tr><td colSpan={3} className="py-4 text-center text-slate-400">No lines to post.</td></tr>
                        )}
                      </tbody>
                      <tfoot>
                        <tr className="border-t-2 border-slate-300 font-bold text-slate-800">
                          <td className="py-2 pr-2 text-right">Total</td>
                          <td className="py-2 px-2 text-right tabular-nums">{(jvPreview.totalDebit || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                          <td className="py-2 pl-2 text-right tabular-nums">{(jvPreview.totalCredit || 0).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</td>
                        </tr>
                      </tfoot>
                    </table>
                  </div>
                </div>
              )}

              {/* Footer actions */}
              <div className="px-5 py-3 border-t border-slate-100 bg-slate-50/80 flex items-center justify-end gap-2">
                {jvPosted ? (
                  <Button size="sm" onClick={() => setShowJVModal(false)}
                    className="bg-primary text-white hover:bg-primary/90 h-8 px-5 text-xs font-semibold">
                    Done
                  </Button>
                ) : (
                  <>
                    <Button variant="outline" size="sm" onClick={() => setShowJVModal(false)} disabled={isPostingJV}
                      className="h-8 px-4 text-xs border-slate-200 text-slate-600">
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handlePostJV}
                      disabled={isPostingJV || isLoadingJVPreview || !jvPreview?.canPost}
                      title={jvPreview && !jvPreview.canPost ? "Resolve the issues above before posting" : undefined}
                      className="bg-emerald-600 text-white hover:bg-emerald-700 h-8 px-4 text-xs font-semibold">
                      {isPostingJV ? <Loader2Icon className="w-3.5 h-3.5 mr-1.5 animate-spin" /> : <Landmark className="w-3.5 h-3.5 mr-1.5" />}
                      Post JV
                    </Button>
                  </>
                )}
              </div>
            </DialogContent>
          </Dialog>
        )}

        {/* ── PDF Orientation Selection Modal ── */}
        <Dialog open={showPdfOrientationModal} onOpenChange={setShowPdfOrientationModal}>
          <DialogContent className="max-w-md p-6">
            <DialogHeader>
              <DialogTitle className="text-lg font-bold flex items-center gap-2">
                <FileTextIcon className="w-5 h-5 text-red-500" />
                Select PDF Orientation
              </DialogTitle>
            </DialogHeader>
            <p className="text-sm text-slate-600 my-2">
              Please select the page layout orientation for your PDF report:
            </p>
            <div className="grid grid-cols-2 gap-4 mt-3">
              <Button
                variant="outline"
                className="flex flex-col items-center justify-center p-5 h-auto gap-3 border-2 border-slate-200 hover:border-primary hover:bg-primary/5 transition-all rounded-xl"
                onClick={() => {
                  setShowPdfOrientationModal(false);
                  exportToPDF("portrait");
                }}
              >
                <div className="w-9 h-12 border-2 border-slate-500 rounded flex items-center justify-center bg-white shadow-sm">
                  <span className="text-[9px] font-bold text-slate-600">A4</span>
                </div>
                <div className="text-center">
                  <div className="font-bold text-sm text-slate-800">Portrait</div>
                  <div className="text-[11px] text-slate-500">Vertical Layout</div>
                </div>
              </Button>

              <Button
                variant="outline"
                className="flex flex-col items-center justify-center p-5 h-auto gap-3 border-2 border-slate-200 hover:border-primary hover:bg-primary/5 transition-all rounded-xl"
                onClick={() => {
                  setShowPdfOrientationModal(false);
                  exportToPDF("landscape");
                }}
              >
                <div className="w-12 h-9 border-2 border-slate-500 rounded flex items-center justify-center bg-white shadow-sm">
                  <span className="text-[9px] font-bold text-slate-600">A4</span>
                </div>
                <div className="text-center">
                  <div className="font-bold text-sm text-slate-800">Landscape</div>
                  <div className="text-[11px] text-slate-500">Horizontal Layout</div>
                </div>
              </Button>
            </div>
          </DialogContent>
        </Dialog>

        {/* ── Filter panel ── */}
        {/* Right-side panel on desktop, bottom sheet on a phone; edits apply on Apply. */}
        <ReportFilterPanel
          open={showFilters}
          onOpenChange={setShowFilters}
          isMobile={isMobile}
          config={config}
          filters={filters}
          filterOptions={filterOptions}
          loadingNames={filterLoadingNames}
          hiddenNames={panelHidden}
          focusField={filterFocus}
          isFetching={isFetching}
          onApply={applyPanelFilters}
          onRefresh={handleRefresh}
          onDraftChange={setFilterDraft}
        />

        {/* ── Active filter chips ── */}
        <ReportFilterChips
          config={config}
          filters={filters}
          hiddenNames={panelHidden}
          getFilterLabel={getFilterLabel}
          onOpen={openFilters}
          onRemove={removeFilters}
        />

        {/* ── Summary type tabs ── */}
        {typeTab && (
          <SummaryTypeTabs
            filter={typeTab}
            value={filters[typeTab.name]}
            onChange={(v) => handleFilterChange(typeTab.name, v)}
          />
        )}

        {/* ── Summary (KPI strip) ── */}
        {config.summaryFields?.length > 0 && !summaryCollapsed && !isError && (
          <ReportSummary
            fields={config.summaryFields}
            summary={summary}
            loading={isLoading}
            fetching={isFetching && !isLoading}
            currencyCode={currency?.code}
            scale={isWideMode ? wideAmounts : "full"}
          />
        )}

        <Card className="overflow-hidden border-0 shadow-none rounded-none">
          <CardContent className="p-2 flex justify-center">
            {isLoading ? (
              <div className="p-12 space-y-6">
                <div className="flex items-center justify-center space-x-4">
                  <Loader2 className="w-8 h-8 animate-spin text-primary" />
                  <span className="text-lg font-medium text-slate-700">
                    Loading report data...
                  </span>
                </div>
                <div className="w-full bg-slate-200 rounded-full h-2">
                  <div
                    className="bg-primary h-2 rounded-full transition-all duration-300 ease-out"
                    style={{ width: `${dataLoadingProgress}%` }}
                  />
                </div>
              </div>
            ) : isError ? (
              <div className="p-12 text-center space-y-4">
                <div className="p-4 bg-red-50 rounded-full w-16 h-16 mx-auto flex items-center justify-center">
                  <X className="w-8 h-8 text-red-600" />
                </div>
                <h3 className="text-xl font-semibold text-red-900">
                  Error Loading Data
                </h3>
                <p className="text-slate-600 max-w-md mx-auto">
                  {queryError?.message || "Failed to load report data"}
                </p>
                <Button
                  onClick={handleRefresh}
                  variant="outline"
                  className="mt-4 bg-primary text-white hover:primary border-primary"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Retry
                </Button>
              </div>
            ) : data.length === 0 ? (
              <div className="p-12 text-center space-y-4">
                <div className="p-4 bg-primary rounded-full w-16 h-16 mx-auto flex items-center justify-center">
                  <Database className="w-8 h-8 text-white" />
                </div>
                <h3 className="text-xl font-semibold text-slate-900">
                  No Data Found
                </h3>
                <p className="text-slate-600 max-w-md mx-auto">
                  No records match your current search and filter criteria. Try
                  adjusting your search terms or filters.
                </p>
                <Button
                  onClick={handleRefresh}
                  variant="outline"
                  className="mt-4 bg-primary text-white hover:primary border-primary"
                >
                  <RefreshCw className="w-4 h-4 mr-2" />
                  Refresh Data
                </Button>
              </div>
            ) : isWideMode && wideModel ? (
              /* ── Wide report table (rule 15) ── */
              <WideTable
                key={reportType}
                ref={wideRef}
                reportType={reportType}
                model={wideModel}
                rows={wideRows}
                hiddenColumns={hiddenColumns}
                blinkCells={config.blinkCells}
                initialView={searchParams.get(VIEW_PARAM)}
                onViewChange={onWideViewChange}
                actionsFor={wideActionsFor}
                customRowActions={config.rowActions || []}
                onCustomAction={runCustomRowAction}
                panelSubtitle={[trailSub, periodInfo.split("\n")[0].replace(/^\s*\|\s*/, "")].filter(Boolean).join(" · ")}
                initialScroll={wideInitialScroll}
                onAmountsChange={setWideAmounts}
                highlightRow={config.highlightRow}
                blinkCellsPurple={config.blinkCellsPurple}
                rowTextClass={config.rowTextClass}
                compare={{
                  available: !!prevPeriodParams,
                  on: compareOn,
                  rows: prevRows,
                  loading: compareOn && prevFetching,
                  onToggle: setCompareOn,
                }}
              />
            ) : (
              <>
                {/* ── Table ── */}
                <div className="overflow-auto max-w-full max-h-[calc(100vh-100px)]">
                  <Table className="table-auto w-max border-collapse rounded-md" >
                    <TableHeader>
                      {(() => {
                        const visibleCols = allColumns?.filter((col) => !hiddenColumns[col.field]) || [];
                        const hasGroupHeaders = visibleCols.some((col) => col.groupHeader);

                        if (!hasGroupHeaders) {
                          return (
                      <TableRow className="border-0">
                        {(
                          visibleCols.map((column, index) => {
                            const isSortable = !isQCReport && column.sortable !== false;
                            return (
                              <TableHead
                                key={index}
                                className={`font-semibold text-white text-xs px-3 py-2.5 text-left sticky top-0 z-10 bg-primary whitespace-nowrap border-r border-white/20 last:border-r-0 ${isSortable ? "cursor-pointer hover:bg-primary/90 select-none" : ""}`}
                                onClick={() => isSortable && handleSort(column.field)}
                              >
                                <div className="flex items-center gap-1.5">
                                  <span>{column.headerName}</span>
                                  {isSortable && sortConfig.key === column.field && (
                                    sortConfig.direction === "asc"
                                      ? <ArrowUp className="w-3 h-3 text-white/70 flex-shrink-0" />
                                      : <ArrowDown className="w-3 h-3 text-white/70 flex-shrink-0" />
                                  )}
                                </div>
                              </TableHead>
                            );
                          })
                        )}
                        {(config.detailColumns || config.drillDown?.enabled) && (
                          <TableHead className="font-semibold text-white text-xs px-3 py-2.5 sticky top-0 z-10 bg-primary w-16 text-center border-l border-white/20">
                            Action
                          </TableHead>
                        )}
                        {config.rowActions && config.rowActions.length > 0 && (
                          <TableHead className="font-semibold text-white text-xs px-3 py-2.5 sticky top-0 z-10 bg-primary w-24 text-center border-l border-white/20">
                            Actions
                          </TableHead>
                        )}
                      </TableRow>
                          );
                        }

                        // Build group structure
                        const groups = [];
                        visibleCols.forEach((col) => {
                          const gName = col.groupHeader || null;
                          const lastGroup = groups[groups.length - 1];
                          if (lastGroup && lastGroup.groupHeader === gName) {
                            lastGroup.cols.push(col);
                          } else {
                            groups.push({ groupHeader: gName, cols: [col] });
                          }
                        });

                        return (
                          <>
                            {/* Row 1: Top Header Groups */}
                            <TableRow className="border-0">
                              {groups.map((grp, gIdx) => {
                                if (!grp.groupHeader) {
                                  return grp.cols.map((column, cIdx) => {
                                    const isSortable = !isQCReport && column.sortable !== false;
                                    return (
                                      <TableHead
                                        key={`gh1-${gIdx}-${cIdx}`}
                                        rowSpan={2}
                                        className={`font-semibold text-white text-xs px-3 py-2.5 text-left sticky top-0 z-10 bg-primary whitespace-nowrap border-r border-b border-white/20 last:border-r-0 ${isSortable ? "cursor-pointer hover:bg-primary/90 select-none" : ""}`}
                                        onClick={() => isSortable && handleSort(column.field)}
                                      >
                                        <div className="flex items-center gap-1.5">
                                          <span>{column.headerName}</span>
                                          {isSortable && sortConfig.key === column.field && (
                                            sortConfig.direction === "asc"
                                              ? <ArrowUp className="w-3 h-3 text-white/70 flex-shrink-0" />
                                              : <ArrowDown className="w-3 h-3 text-white/70 flex-shrink-0" />
                                          )}
                                        </div>
                                      </TableHead>
                                    );
                                  });
                                }

                                return (
                                  <TableHead
                                    key={`gh1-${gIdx}`}
                                    colSpan={grp.cols.length}
                                    className="font-semibold text-white text-xs px-3 py-1.5 text-center sticky top-0 z-10 bg-primary/90 whitespace-nowrap border-r border-b border-white/20"
                                  >
                                    {grp.groupHeader}
                                  </TableHead>
                                );
                              })}
                              {(config.detailColumns || config.drillDown?.enabled) && (
                                <TableHead rowSpan={2} className="font-semibold text-white text-xs px-3 py-2.5 sticky top-0 z-10 bg-primary w-16 text-center border-l border-b border-white/20">
                                  Action
                                </TableHead>
                              )}
                              {config.rowActions && config.rowActions.length > 0 && (
                                <TableHead rowSpan={2} className="font-semibold text-white text-xs px-3 py-2.5 sticky top-0 z-10 bg-primary w-24 text-center border-l border-b border-white/20">
                                  Actions
                                </TableHead>
                              )}
                            </TableRow>

                            {/* Row 2: Sub-headers for grouped columns */}
                            <TableRow className="border-0">
                              {visibleCols
                                .filter((col) => col.groupHeader)
                                .map((column, index) => {
                                  const isSortable = !isQCReport && column.sortable !== false;
                                  return (
                                    <TableHead
                                      key={`gh2-${index}`}
                                      className={`font-semibold text-white text-xs px-2 py-1.5 sticky top-[29px] z-10 bg-primary whitespace-nowrap border-r border-white/20 last:border-r-0 ${
                                        column.align === 'right' ? 'text-right' : column.align === 'center' ? 'text-center' : 'text-left'
                                      } ${isSortable ? "cursor-pointer hover:bg-primary/90 select-none" : ""}`}
                                      onClick={() => isSortable && handleSort(column.field)}
                                    >
                                      <div className={`flex items-center gap-1 ${
                                        column.align === 'right' ? 'justify-end' : column.align === 'center' ? 'justify-center' : 'justify-start'
                                      }`}>
                                        <span>{column.headerName}</span>
                                        {isSortable && sortConfig.key === column.field && (
                                          sortConfig.direction === "asc"
                                            ? <ArrowUp className="w-3 h-3 text-white/70 flex-shrink-0" />
                                            : <ArrowDown className="w-3 h-3 text-white/70 flex-shrink-0" />
                                        )}
                                      </div>
                                    </TableHead>
                                  );
                                })}
                            </TableRow>
                          </>
                        );
                      })()}
                    </TableHeader>
                    <TableBody>
                      {(
                        /* ── Standard flat table ── */
                        <>
                          {groupedData?.map((row, index) => {
                          // Group header / subtotal rows injected by applyRowGrouping
                          if (row?.__rowType) {
                            const visible = allColumns?.filter((col) => !hiddenColumns[col.field]) || [];
                            const extraCol = (config.detailColumns || config.drillDown?.enabled) ? 1 : 0;
                            if (row.__rowType === "groupHeader") {
                              return (
                                <TableRow key={`gh-${index}`} className="bg-primary hover:bg-primary">
                                  <TableCell
                                    colSpan={visible.length + extraCol}
                                    className="px-3 py-2 text-xs font-bold tracking-wide text-white border border-primary"
                                  >
                                    {row.__label}
                                  </TableCell>
                                </TableRow>
                              );
                            }
                            return (
                              <TableRow key={`gt-${index}`} className="bg-slate-200/80 hover:bg-slate-200">
                                {visible.map((column, colIdx) => {
                                  const isLabelCell = colIdx === 0;
                                  const hasValue = Object.prototype.hasOwnProperty.call(row, column.field);
                                  return (
                                    <TableCell
                                      key={colIdx}
                                      className={`px-3 py-1.5 text-xs font-bold align-middle border border-slate-300 ${isLabelCell ? "" : "whitespace-nowrap"}`}
                                    >
                                      {isLabelCell
                                        ? row.__label
                                        : hasValue
                                          ? (column.type === "currency"
                                              ? formatCurrency(row[column.field], currency)
                                              : column.type === "number"
                                                ? new Intl.NumberFormat("en-US", { style: "decimal" }).format(row[column.field])
                                                : row[column.field])
                                          : ""}
                                    </TableCell>
                                  );
                                })}
                                {extraCol === 1 && <TableCell className="border border-slate-300" />}
                              </TableRow>
                            );
                          }
                          return (
                          <TableRow
                            key={index}
                            className={`transition-colors duration-100 ${
                              config.detailColumns || reportType === "processOrderReconciliation"
                                ? "cursor-pointer"
                                : ""
                            } ${index % 2 === 0 ? "bg-white hover:bg-primary/5" : "bg-slate-50/70 hover:bg-primary/5"}`}
                            onClick={() => handleRowClick(row)}
                          >
                            {allColumns?.filter((col) => !hiddenColumns[col.field]).map((column, colIdx) => {
                              const cellBlink = config.blinkCells?.(row, column.field) ?? false;
                              return (
                              <TableCell
                                key={colIdx}
                                className={`px-3 py-1.5 text-xs align-middle border border-slate-200${cellBlink ? " animate-pulse bg-red-100 font-semibold text-red-700" : ""}`}
                              >
                                <div className="min-w-0">
                                  {column.valueGetter ? (
                                    column.type === "currency" ? (
                                      <span className="font-semibold text-green-600 whitespace-nowrap">
                                        {formatCurrency(
                                          column.valueGetter({ row }),
                                          currency,
                                        )}
                                      </span>
                                    ) : column.type === "number" ? (
                                      <span className="whitespace-nowrap">
                                        {new Intl.NumberFormat("en-US", {
                                          style: "decimal",
                                        }).format(column.valueGetter({ row }))}
                                      </span>
                                    ) : (
                                      <span
                                        className={`${column.className || ""
                                          } break-words`}
                                      >
                                        {column.valueGetter({ row })}
                                      </span>
                                    )
                                  ) : column.type === "date" ? (
                                    <span className="whitespace-nowrap">
                                      {(() => {
                                        const d = new Date(row[column.field]);
                                        return isNaN(d.getTime()) ? "N/A" : format(d, "MMM dd, yyyy");
                                      })()}
                                    </span>
                                  ) : column.type === "number" ? (
                                    <span className="whitespace-nowrap">
                                      {new Intl.NumberFormat("en-US", {
                                        style: "decimal",
                                      }).format(row[column.field])}
                                    </span>
                                  ) : column.type === "currency" ? (
                                    <span className="font-semibold text-green-600 whitespace-nowrap">
                                      {formatCurrency(
                                        row[column.field],
                                        currency,
                                      )}
                                    </span>
                                  ) : column.type === "badge" ? (
                                    <Badge
                                      variant={getBadgeVariant(row[column.field])}
                                      className="font-medium whitespace-nowrap"
                                    >
                                      {row[column.field]}
                                    </Badge>
                                  ) : (
                                    <span
                                      className={`${column.className || ""
                                        } break-words block`}
                                    >
                                      {row[column.field]}
                                    </span>
                                  )}
                                </div>
                              </TableCell>
                              ); })}
                            {(config.detailColumns || config.drillDown?.enabled) && (
                              <TableCell className="px-2 py-1 border border-slate-200 w-16 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  {config.detailColumns && (
                                    <Button
                                      onClick={(e) => { e.stopPropagation(); handleRowClick(row); setShowDetails(true); }}
                                      variant="ghost"
                                      size="sm"
                                      className="h-6 w-6 p-0 text-primary/60 hover:text-primary hover:bg-primary/10 rounded"
                                    >
                                      <Eye className="w-3.5 h-3.5" />
                                    </Button>
                                  )}
                                  {config.drillDown?.enabled && (
                                    <Button
                                      variant="ghost"
                                      size="sm"
                                      onClick={(e) => { e.stopPropagation(); handleDrillDown(row); }}
                                      className="h-6 w-6 p-0 text-primary/60 hover:text-primary hover:bg-primary/10 rounded"
                                    >
                                      <ArrowRight className="w-3.5 h-3.5" />
                                    </Button>
                                  )}
                                </div>
                              </TableCell>
                            )}
                            {config.rowActions && config.rowActions.length > 0 && (
                              <TableCell className="px-2 py-1 border border-slate-200 w-24 text-center">
                                <div className="flex items-center justify-center gap-1">
                                  {config.rowActions.map((action, actionIdx) => {
                                    const isVisible = !action.show || action.show(row);
                                    if (!isVisible) return null;
                                    return (
                                      <Button
                                        key={actionIdx}
                                        variant={action.variant || "destructive"}
                                        size="sm"
                                        onClick={async (e) => {
                                          e.stopPropagation();
                                          if (action.confirm && !window.confirm(action.confirm(row))) return;
                                          try {
                                            await action.onClick(row);
                                            refetch();
                                          } catch (err) {
                                            console.error("Row action error:", err);
                                            alert("Action failed: " + (err.message || "Unknown error"));
                                          }
                                        }}
                                        className={`h-6 px-2 text-[10px] font-semibold ${action.className || ""}`}
                                      >
                                        {action.label}
                                      </Button>
                                    );
                                  })}
                                </div>
                              </TableCell>
                            )}
                          </TableRow>
                          ); })}
                          {!isQCReport && allColumns?.some(c => c.showTotal) && (
                            <TableRow className="bg-primary/10">
                              {allColumns?.filter(col => !hiddenColumns[col.field]).map((col, idx) => (
                                <TableCell key={idx} className="px-3 py-1.5 text-xs font-bold text-primary border border-primary/30">
                                  {col.showTotal
                                    ? col.type === 'currency'
                                      ? formatCurrency(columnTotals[col.field] ?? 0, currency)
                                      : (columnTotals[col.field] ?? 0).toLocaleString()
                                    : idx === 0 ? 'TOTAL' : ''}
                                </TableCell>
                              ))}
                              {(config.detailColumns || config.drillDown?.enabled) && (
                                <TableCell className="border border-primary/30" />
                              )}
                            </TableRow>
                          )}
                        </>
                      )}
                    </TableBody>
                  </Table>
                </div>

              </>
            )}
          </CardContent>
        </Card>

        <Dialog
          open={showProcessOrderModal}
          onOpenChange={(open) => {
            setShowProcessOrderModal(open);
            if (!open) setSelectedProcessOrderBlock(null);
          }}
        >
          <DialogContent className="max-w-5xl p-0 overflow-hidden">
            <DialogHeader className="px-6 py-4 bg-primary text-white">
              <DialogTitle className="text-xl font-bold">
                Process Order{" "}
                {selectedProcessOrderBlock?.processOrder || "Details"}
              </DialogTitle>
            </DialogHeader>

            <div className="p-6 space-y-4 bg-white max-h-[75vh] overflow-y-auto">
              {processOrderLoading ? (
                <div className="py-12 text-center text-slate-600">
                  Loading process order details...
                </div>
              ) : !selectedProcessOrderBlock ? (
                <div className="py-12 text-center text-slate-600">
                  No process order data found for selected filters.
                </div>
              ) : (
                <div className="border border-slate-300 rounded-md overflow-hidden">
                  <div className="bg-slate-200 px-3 py-2 flex justify-between text-sm font-bold">
                    <span>
                      Process Order {selectedProcessOrderBlock.processOrder}
                    </span>
                    <span>
                      Date{" "}
                      {selectedProcessOrderBlock.date
                        ? format(
                          new Date(selectedProcessOrderBlock.date),
                          "dd-MMM-yy",
                        ).toUpperCase()
                        : ""}
                    </span>
                  </div>

                  <table className="w-full text-sm">
                    <thead className="bg-slate-100">
                      <tr>
                        <th className="text-center border px-2 py-1">MM#</th>
                        <th className="text-left border px-2 py-1">
                          Material Description
                        </th>
                        <th className="text-left border px-2 py-1">
                          Ink Code
                        </th>
                        <th className="text-left border px-2 py-1">
                          Batch No
                        </th>
                        <th className="text-right border px-2 py-1">
                          Qty Issued
                        </th>
                        <th className="text-right border px-2 py-1">
                          Qty Produced
                        </th>
                        <th className="text-right border px-2 py-1">Variance</th>
                        <th className="text-right border px-2 py-1">Var %</th>
                      </tr>
                    </thead>
                    <tbody>
                      {selectedProcessOrderBlock.items.map((item, idx) => (
                        <tr key={`${item.mm}-${idx}`}>
                          <td className="border px-2 py-1 text-center">
                            {item.mm}
                          </td>
                          <td className="border px-2 py-1">
                            {item.materialDescription}
                          </td>
                          <td className="border px-2 py-1">
                            {item.code}
                          </td>
                          <td className="border px-2 py-1">
                            {item.batch_no}
                          </td>
                          <td className="border px-2 py-1 text-right">
                            {Number((item.issuance).toFixed(2)) || ""}
                          </td>
                          <td className="border px-2 py-1 text-right">
                            {Number((item.production).toFixed(2)) || ""}
                          </td>
                          <td className="border px-2 py-1 text-right">
                            {Number((item.variance).toFixed(2)) || ""}
                          </td>
                          <td className="border px-2 py-1 text-right">
                            {item.var_percent ? Number(item.var_percent).toFixed(2) + "%" : ""}
                          </td>
                        </tr>
                      ))}
                      <tr className="bg-slate-100 font-bold">
                        <td className="border px-2 py-1 text-center"></td>
                        <td className="border px-2 py-1 text-right">
                          Process Order Total:
                        </td>
                        <td className="border px-2 py-1"></td>
                        <td className="border px-2 py-1"></td>
                        <td className="border px-2 py-1 text-right">
                          {Number(
                            selectedProcessOrderBlock.totals?.issuance || 0,
                          ).toFixed(2)}
                        </td>
                        <td className="border px-2 py-1 text-right">
                          {Number(
                            selectedProcessOrderBlock.totals?.production || 0,
                          ).toFixed(2)}
                        </td>
                        <td className="border px-2 py-1 text-right">
                          {Number(
                            selectedProcessOrderBlock.totals?.variance || 0,
                          ).toFixed(2)}
                        </td>
                        <td className="border px-2 py-1 text-right">
                          {Number(
                            selectedProcessOrderBlock.totals?.issuance > 0
                              ? (selectedProcessOrderBlock.totals.variance / selectedProcessOrderBlock.totals.issuance) * 100
                              : 0
                          ).toFixed(2) + "%"}
                        </td>
                      </tr>
                    </tbody>
                  </table>
                </div>
              )}

              <div className="flex justify-end gap-2">
                <Button
                  onClick={() => exportSingleProcessOrder("pdf")}
                  disabled={
                    processOrderLoading ||
                    processOrderExporting ||
                    !selectedProcessOrderBlock
                  }
                >
                  Export PDF
                </Button>
                <Button
                  variant="outline"
                  onClick={() => exportSingleProcessOrder("excel")}
                  disabled={
                    processOrderLoading ||
                    processOrderExporting ||
                    !selectedProcessOrderBlock
                  }
                >
                  Export Excel
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => setShowProcessOrderModal(false)}
                >
                  Close
                </Button>
              </div>
            </div>
          </DialogContent>
        </Dialog>

        {/* "Show lines" / Record Details — right sheet (bottom on phones),
            prev / next through the report's rows, Excel of the lines. */}
        {config.detailColumns && (
          <RecordLinesSheet
            open={!!(showDetails && detailRow)}
            onClose={() => setShowDetails(false)}
            title={`${config.title} — lines`}
            record={selectedRecord}
            lines={detailRow}
            columns={config.detailColumns}
            isQC={isQCReport}
            rows={isWideMode ? wideRows : data}
            hasLines={recordHasLines}
            onStep={handleRowClick}
            voucher={recordVoucher}
            onOpenVoucher={() => {
              setShowDetails(false);
              goDrill(recordVoucher?.href, { voucher: true });
            }}
            companyName={company?.name || ""}
            userName={session?.user?.name || "System"}
          />
        )}
      </div>

      {/* Older drillDown: asks for its fields (e.g. a date range), then opens
          the next report as a trail step. Standard dialog, theme tokens. */}
      {config.drillDown && (
        <Dialog open={showDrillDownModal} onOpenChange={setShowDrillDownModal}>
          <DialogContent className="max-w-md gap-0 overflow-hidden p-0 max-h-[92dvh] flex flex-col">
            <div className="border-b border-border bg-primary/5 px-5 py-3 pr-10">
              <DialogTitle className="text-base font-semibold text-foreground">
                {config.drillDown.modalTitle}
              </DialogTitle>
              <p className="text-xs text-muted-foreground">
                {[drillDownRow?.code || drillDownRow?.acno || drillDownRow?.itcd, drillDownRow?.name || drillDownRow?.acname || drillDownRow?.item]
                  .filter(Boolean)
                  .join(" · ") || "Choose the period for the detailed view"}
              </p>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto p-5 space-y-4">
              {config.drillDown.fields?.map((field, index) => (
                <div key={index} className="space-y-2">
                  <Label>{field.label}</Label>
                  {field.type === "date" ? (
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          className="w-full justify-start text-left font-normal"
                        >
                          {/* {console.log("date check: ", 

                            format(
                              drillDownFilters[field.name],
                              "PPP"
                            )
                          )} */}
                          {drillDownFilters[field.name] ? (
                            format(
                              new Date(
                                (() => {
                                  const rawDate = drillDownFilters[field.name];
                                  const [day, month, year] = rawDate.split("-");
                                  return `${year}-${month}-${day}`;
                                })()
                              ),
                              "PPP"
                            )
                          ) : (
                            <span>Select {field.label.toLowerCase()}</span>
                          )}
                          <CalendarIcon className="ml-auto h-4 w-4 opacity-50" />
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0">
                        <Calendar
                          mode="single"
                          selected={drillDownFilters[field.name]}
                          onSelect={(date) => {
                            const formatted = formatDate(date);

                            setDrillDownFilters((prev) => ({
                              ...prev,
                              [field.name]: formatted,
                            }))

                          }

                          }
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                  ) : (
                    <Input
                      type={field.type}
                      value={drillDownFilters[field.name] || ""}
                      onChange={(e) =>
                        setDrillDownFilters((prev) => ({
                          ...prev,
                          [field.name]: e.target.value,
                        }))
                      }
                    />
                  )}
                </div>
              ))}
            </div>
            <div className="flex flex-wrap justify-end gap-2 border-t border-border px-5 py-3">
              <Button
                variant="outline"
                onClick={() => setShowDrillDownModal(false)}
              >
                Cancel
              </Button>
              <Button
                onClick={() => {
                  if (config.drillDown.linkBuilder) {
                    const link = config.drillDown.linkBuilder(
                      drillDownRow,
                      drillDownFilters,
                    );
                    goDrill(link);
                  }
                  setShowDrillDownModal(false);
                }}
                disabled={
                  !Object.keys(drillDownFilters).every(
                    (key) =>
                      drillDownFilters[key] !== undefined &&
                      drillDownFilters[key] !== null &&
                      drillDownFilters[key] !== "",
                  )
                }
              >
                View Details
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      )}
      <PrintPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        pdfUrl={previewPdfUrl}
        title={previewTitle}
        onDownload={handleDownloadFromPreview}
      />
    </div>
  );
};

const formatCurrency = (value, currency) => {

  if (typeof value !== "number") return "-";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currency?.code || "-",
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  }).format(value);
};

const getBadgeVariant = (value) => {
  if (typeof value !== "string") return "secondary";

  const lowerValue = value.toLowerCase();
  // Import statuses (Imported Material Stock / In Transit / Deals)
  if (
    lowerValue.includes("expired") ||
    lowerValue.includes("over released") ||
    lowerValue.includes("eta passed") ||
    lowerValue.includes("expiring")
  ) return "destructive";
  if (lowerValue.includes("partially") || lowerValue.includes("arrived")) return "outline";
  if (lowerValue.includes("fully released") || lowerValue.includes("received")) return "default";
  if (
    lowerValue.includes("active") ||
    lowerValue.includes("complete") ||
    lowerValue.includes("success")
  ) {
    return "default";
  } else if (lowerValue.includes("pending") || lowerValue.includes("warning")) {
    return "secondary";
  } else if (
    lowerValue.includes("inactive") ||
    lowerValue.includes("error") ||
    lowerValue.includes("failed")
  ) {
    return "destructive";
  }
  return "secondary";
};

export default ReportViewer;
