"use client";

import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useSession } from "next-auth/react";
import { createPortal } from "react-dom";
import { AnimatePresence, motion } from "framer-motion";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  Package,
  Eye,
  CheckCircle2,
  XCircle,
  X,
  Truck,
  Download,
  Printer,
  BarChart3,
  AlertCircle,
  Calendar,
  Tag,
  Clock,
  Hash,
  Building2,
  Scale,
  Info,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import AsyncSelect from "react-select/async";
import generateQCCertificate from "@/utils/generateQCCertificate";
import { useCompany } from "@/context/CompanyContext";
import generateNCRCertificate from "@/utils/generateNCRCertificate";

// Status Badge Component
const StatusBadge = ({ status }) => {
  const statusConfig = {
    draft: {
      bg: "bg-amber-50",
      text: "text-amber-800",
      border: "border-amber-200",
      icon: <Clock className="h-3 w-3" />,
      label: "Draft",
    },
    DRAFT: {
      bg: "bg-amber-50",
      text: "text-amber-800",
      border: "border-amber-200",
      icon: <Clock className="h-3 w-3" />,
      label: "Draft",
    },
    approve: {
      bg: "bg-emerald-50",
      text: "text-emerald-800",
      border: "border-emerald-200",
      icon: <CheckCircle2 className="h-3 w-3" />,
      label: "Approved",
    },
    APPROVED: {
      bg: "bg-emerald-50",
      text: "text-emerald-800",
      border: "border-emerald-200",
      icon: <CheckCircle2 className="h-3 w-3" />,
      label: "Approved",
    },
    reject: {
      bg: "bg-red-50",
      text: "text-red-800",
      border: "border-red-200",
      icon: <XCircle className="h-3 w-3" />,
      label: "Rejected",
    },
    REJECTED: {
      bg: "bg-red-50",
      text: "text-red-800",
      border: "border-red-200",
      icon: <XCircle className="h-3 w-3" />,
      label: "Rejected",
    },
    REWORK: {
      bg: "bg-orange-50",
      text: "text-orange-800",
      border: "border-orange-200",
      icon: <Clock className="h-3 w-3" />,
      label: "Rework",
    },
    HOLD: {
      bg: "bg-blue-50",
      text: "text-blue-800",
      border: "border-blue-200",
      icon: <Clock className="h-3 w-3" />,
      label: "Hold",
    },
  };

  const config = statusConfig[status] || statusConfig.draft;

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${config.bg} ${config.text} ${config.border}`}
    >
      {config.icon}
      <span className="text-xs font-medium">{config.label}</span>
    </div>
  );
};

// Print Preview Modal Component
const PrintPreviewModal = ({
  isOpen,
  onClose,
  pdfUrl,
  title,
  onDownload,
}) => {
  const handlePrint = () => {
    const printWindow = window.open(pdfUrl);
    if (printWindow) {
      printWindow.onload = () => {
        printWindow.print();
      };
    }
  };

  if (!isOpen) return null;

  return createPortal(
    <AnimatePresence>
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50 p-4"
        onClick={onClose}
      >
        <motion.div
          initial={{ scale: 0.95, opacity: 0, y: 20 }}
          animate={{ scale: 1, opacity: 1, y: 0 }}
          exit={{ scale: 0.95, opacity: 0, y: 20 }}
          transition={{ type: "spring", duration: 0.5 }}
          className="bg-white rounded-2xl shadow-2xl w-full max-w-6xl h-[90vh] flex flex-col overflow-hidden"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Header */}
          <div className="bg-primary px-6 py-4 text-white flex justify-between items-center">
            <div>
              <h2 className="text-xl font-bold">Print Preview</h2>
              <p className="text-sm text-primary-foreground opacity-80">{title}</p>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handlePrint}
                className="bg-white text-primary hover:bg-gray-100"
              >
                <Printer className="h-4 w-4 mr-2" />
                Print
              </Button>
              <Button
                onClick={onDownload}
                variant="outline"
                className="border-white bg-primary text-white hover:bg-primary"
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
                <X className="h-5 w-5" />
              </Button>
            </div>
          </div>

          {/* PDF Viewer */}
          <div className="flex-1 bg-gray-100 p-4 overflow-hidden">
            <iframe
              src={`${pdfUrl}#toolbar=0&navpanes=0`}
              className="w-full h-full rounded-lg shadow-inner bg-white"
              title="PDF Preview"
            />
          </div>
        </motion.div>
      </motion.div>
    </AnimatePresence>,
    document.body
  );
};

// Info Card Component
const InfoCard = ({ icon: Icon, title, value, className = "" }) => (
  <div
    className={`bg-white rounded-lg border border-gray-200 p-4 ${className}`}
  >
    <div className="flex items-center gap-3">
      <div className="p-2 bg-gray-50 rounded-lg">
        <Icon className="h-4 w-4 text-gray-600" />
      </div>
      <div>
        <p className="text-xs text-gray-500 font-medium">{title}</p>
        <p className="text-sm font-semibold text-gray-900 mt-0.5">
          {value || "-"}
        </p>
      </div>
    </div>
  </div>
);

export default function QualityControlIndex() {
  const { company } = useCompany();
  const { data: session } = useSession();
  const [loading, setLoading] = useState(true);
  const [plans, setPlans] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [localSearch, setLocalSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [stats, setStats] = useState({
    total: 0,
    draft: 0,
    approved: 0,
    rejected: 0,
    rework: 0,
  });

  // Print Preview State
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [previewPdfUrl, setPreviewPdfUrl] = useState("");
  const [previewTitle, setPreviewTitle] = useState("");
  const [currentPlan, setCurrentPlan] = useState(null);
  const router = useRouter();

  // modal state
  const [modalOpen, setModalOpen] = useState(false);
  const [modalInput, setModalInput] = useState("");
  const [modalSelect, setModalSelect] = useState("");
  const [allProductionPlanIds, setAllProductionPlanIds] = useState([]);
  const [isSelectLoading, setIsSelectLoading] = useState(false);
  const [cachedOptions, setCachedOptions] = useState([]);
  const [visibleOptions, setVisibleOptions] = useState([]);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const currentChunkRef = useRef(1);
  const CHUNK_SIZE = 250;

  // sort state
  const [sortField, setSortField] = useState("batch_no");
  const [sortOrder, setSortOrder] = useState("desc");

  useEffect(() => {
    const t = setTimeout(() => {
      setSearch(localSearch);
      setPage(1);
    }, 450);
    return () => clearTimeout(t);
  }, [localSearch]);

  const load = async () => {
    setLoading(true);
    try {
      const params = {
        page: String(page),
        pageSize: String(pageSize),
        ...(search ? { search } : {}),
        sortField,
        sortOrder,
      };

      const res = await fetch(
        `/api/forms/qualitycontrol?${new URLSearchParams(params)}`,
      );
      const data = await res.json();

      if (Array.isArray(data.data)) {
        setPlans(data.data);
        setAllProductionPlanIds(data.allProductionPlanIds || []);
        setTotal(Number(data.total) || 0);
        setTotalPages(Number(data.totalPages) || 1);

        // Calculate stats
        setStats({
          total: data.total || 0,
          draft: data.data.filter((p) => p.status === "DRAFT").length,
          approved: data.data.filter((p) => p.status === "APPROVED").length,
          rejected: data.data.filter((p) => p.status === "REJECTED").length,
          rework: data.data.filter((p) => p.status === "REWORK").length,
        });
      } else {
        setPlans([]);
        setAllProductionPlanIds([]);
        setTotal(0);
        setTotalPages(1);
        setStats({
          total: 0,
          draft: 0,
          approved: 0,
          rejected: 0,
          rework: 0,
        });
      }
    } catch (error) {
      console.error("Error loading QC records:", error);
      toast.error("Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [page, pageSize, search, sortField, sortOrder]);

  const filteredPlans = useMemo(() => {
    if (filterStatus === "all") return plans;
    return plans.filter((plan) => plan.status === filterStatus);
  }, [plans, filterStatus]);

  const rangeLabel = useMemo(() => {
    const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(total, page * pageSize);
    return `${start}–${end} of ${total}`;
  }, [page, pageSize, total]);

  // Transform IDs to options once and cache them
  useEffect(() => {
    const options = allProductionPlanIds.map((id) => ({
      value: id,
      label: `Process Order ${id}`,
    }));
    setCachedOptions(options);
    setVisibleOptions(options.slice(0, CHUNK_SIZE));
  }, [allProductionPlanIds]);

  // Load next chunk of options
  const loadMoreOptions = useCallback(() => {
    const nextChunk = currentChunkRef.current + 1;
    const start = (nextChunk - 1) * CHUNK_SIZE;
    const end = nextChunk * CHUNK_SIZE;

    setIsLoadingMore(true);
    setTimeout(() => {
      setVisibleOptions((prev) => [
        ...prev,
        ...cachedOptions.slice(start, end),
      ]);
      currentChunkRef.current = nextChunk;
      setIsLoadingMore(false);
    }, 100);
  }, [cachedOptions]);

  // Filter options based on input
  const filterOptions = useCallback(
    (inputValue) => {
      if (!inputValue) {
        return visibleOptions;
      }

      const searchLower = inputValue.toLowerCase();
      return cachedOptions
        .filter((option) => option.label.toLowerCase().includes(searchLower))
        .slice(0, visibleOptions.length);
    },
    [cachedOptions, visibleOptions],
  );

  // AsyncSelect load function
  const loadOptions = useCallback(
    (inputValue) => {
      return new Promise((resolve) => {
        setTimeout(() => {
          resolve(filterOptions(inputValue));
        }, 10);
      });
    },
    [filterOptions],
  );

  // Helper for toggling sort
  const handleSort = (field) => {
    if (sortField === field) {
      setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
    setPage(1);
  };

  const handleDownloadPDF = async (plan) => {
    const toastId = toast.loading("Generating PDF...");
    try {
      const res = await fetch(`/api/forms/qualitycontrol/${plan.id}`);
      if (!res.ok) throw new Error("Failed to fetch QC details");
      const data = await res.json();

      const a1 = data.attempts?.find((a) => a.attempt_no === 1) || { rows: [] };
      const a2 = data.attempts?.find((a) => a.attempt_no === 2) || { rows: [] };
      const a1Map = new Map(a1.rows.map((r) => [r.parameter_name, r.quality_realized ?? ""]));
      const a2Map = new Map(a2.rows.map((r) => [r.parameter_name, r.quality_realized ?? ""]));

      const testResults = (data.parameters || []).map((p) => ({
        parameter: p.parameter_name,
        standard: p.quality_standard,
        result: a2Map.get(p.parameter_name) || a1Map.get(p.parameter_name) || "-",
      }));

      const rejectReason = a2.reject_reason || a1.reject_reason || "Quality parameters not met";

      if (plan.status === "REJECTED") {
        await generateNCRCertificate({
          companyName: company?.name || "Company",
          logoUrl: company?.logo || "",
          ncrTitle: "NON CONFIRMITY REQUEST FORM",
          batchNumber: data.master.batch_no || plan.batch_no,
          inkCode: (plan.item_code || "") + " " + (plan.item_name || ""),
          manufacturingDate: data.master.mfg_date,
          batchSize: data.master.batch_size,
          departmentName: data.master.department_name || "",
          testResults: testResults,
          rejectReason: rejectReason,
          rootCause: "",
          correction: "",
          correctiveAction: "",
          actionForImplementation: "",
          preventiveActionRequired: "NO",
          responsibility: "",
          targetDate: "",
          verifiedEffectiveness: "",
          capaEffective: "No",
          plantHeadSignature: "",
          closingDate: "",
          mode: "print",
        });
      } else {
        await generateQCCertificate({
          companyName: company?.name || "Company",
          logoUrl: company?.logo || "",
          title: "QUALITY ASSURANCE CERTIFICATE",
          manufacturingDate: data.master.mfg_date,
          expiryDate: data.master.expiry_date,
          batchNumber: data.master.batch_no || plan.batch_no,
          inkCode: (plan.item_code || "") + " " + (plan.item_name || ""),
          customer: "-",
          batchSize: data.master.batch_size,
          status: plan.status,
          approvedBy: data.master.approved_by || session?.user?.name || "Quality Manager",
          comments: "",
          departmentName: data.master.department_name || "",
          testResults: testResults,
          mode: "print",
        });
      }

      toast.dismiss(toastId);
    } catch (error) {
      console.error(error);
      toast.error("Error generating print", { id: toastId });
    }
  };

  const handleDownloadFromPreview = () => {
    if (!previewPdfUrl || !currentPlan) return;
    const link = document.createElement("a");
    link.href = previewPdfUrl;
    const fileName = currentPlan.status === "REJECTED"
      ? `NCR-Report-${currentPlan.batch_no}.pdf`
      : `QC-Certificate-${currentPlan.batch_no}.pdf`;
    link.setAttribute("download", fileName);
    document.body.appendChild(link);
    link.click();
    link.remove();
  };

  return (
    <div className="min-h-screen bg-secondary p-4 md:p-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center gap-2">
              <Package className="h-7 w-7 text-primary" />
              Quality Control Dashboard
            </h1>
            <p className="text-black mt-1">
              Manage production quality inspections
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex items-center gap-2"
              onClick={load}
            >
              <Download className="h-4 w-4" />
              Refresh
            </Button>
            <Button
              onClick={() => setModalOpen(true)}
              className="bg-primary hover:bg-primary text-white flex items-center gap-2"
            >
              <Plus className="h-4 w-4" />
              New QC Check
            </Button>
          </div>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <Card className="bg-primary/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-primary font-medium">
                    Total Plans
                  </p>
                  <p className="text-2xl font-bold text-black mt-2">
                    {stats.total}
                  </p>
                </div>
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Package className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-primary/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-primary font-medium">Draft</p>
                  <p className="text-2xl font-bold text-black mt-2">
                    {stats.draft}
                  </p>
                </div>
                <div className="p-2 bg-amber-50 rounded-lg">
                  <Clock className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-primary/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-primary font-medium">Approved</p>
                  <p className="text-2xl font-bold text-black mt-2">
                    {stats.approved}
                  </p>
                </div>
                <div className="p-2 bg-emerald-50 rounded-lg">
                  <CheckCircle2 className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-primary/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-primary font-medium">Rejected</p>
                  <p className="text-2xl font-bold text-black mt-2">
                    {stats.rejected}
                  </p>
                </div>
                <div className="p-2 bg-red-50 rounded-lg">
                  <XCircle className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-primary/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-primary font-medium">Hold</p>
                  <p className="text-2xl font-bold text-black mt-2">
                    {stats.rework}
                  </p>
                </div>
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Clock className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>
               {/* Rework Card (second) */}
          <Card className="bg-primary/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-primary font-medium">Rework</p>
                  <p className="text-2xl font-bold text-black mt-2">{stats.rework}</p>
                </div>
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Clock className="h-5 w-5 text-primary" />
                </div>
              </div>
            </CardContent>
          </Card>

        </div>

        {/* Search and Filter */}
        <Card className="mb-6">
          <CardContent className="p-4">
            <div className="flex flex-col lg:flex-row lg:items-center lg:justify-between gap-4">
              <div className="flex-1 max-w-lg">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    type="text"
                    placeholder="Search process order, MM details, Ink Code, batch numbers..."
                    value={localSearch}
                    onChange={(e) => setLocalSearch(e.target.value)}
                    className="pl-10"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="flex items-center gap-2">
                  <Filter className="h-4 w-4 text-gray-500" />
                  <Select value={filterStatus} onValueChange={setFilterStatus}>
                    <SelectTrigger className="w-[140px]">
                      <SelectValue placeholder="Filter by status" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Status</SelectItem>
                      <SelectItem value="DRAFT">Draft</SelectItem>
                      <SelectItem value="APPROVED">Approved</SelectItem>
                      <SelectItem value="REJECTED">Rejected</SelectItem>
                      <SelectItem value="REWORK">Hold</SelectItem>
                      <SelectItem value="REWORK">Rework</SelectItem>
                    </SelectContent>
                  </Select>
                </div>

                <div className="flex items-center gap-2">
                  <span className="text-sm text-gray-600">Show:</span>
                  <Select
                    value={pageSize.toString()}
                    onValueChange={(value) => {
                      setPageSize(Number(value));
                      setPage(1);
                    }}
                  >
                    <SelectTrigger className="w-[80px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {[10, 20, 50, 100].map((n) => (
                        <SelectItem key={n} value={n.toString()}>
                          {n}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Production Plans Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-24 flex justify-center items-center">
              <div className="flex flex-col items-center gap-4">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                <p className="text-gray-600 font-medium">Loading records...</p>
              </div>
            </div>
          ) : filteredPlans.length === 0 ? (
            <div className="py-24 text-center">
              <Package className="h-16 w-16 text-gray-400 mx-auto mb-4" />
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                No records found
              </h3>
              <p className="text-gray-600">
                No quality control records match your criteria.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full">
                <thead>
                  <tr className="bg-primary border-b border-gray-200 border-2 border-primary/50">
                    <th className="px-6 py-2 text-center text-xs font-semibold text-white uppercase tracking-wider">
                      Process Order No
                    </th>
                    <th className="px-6 py-2 text-left text-xs font-semibold text-white uppercase tracking-wider">
                      MM Details
                    </th>
                    {/* <th className="px-6 py-2 text-left text-xs font-semibold text-white uppercase tracking-wider">
                      QC Barcode
                    </th> */}
                    <th className="px-6 py-2 text-left text-xs font-semibold text-white uppercase tracking-wider">
                      Batch Info
                    </th>
                    <th className="px-6 py-2 text-left text-xs font-semibold text-white uppercase tracking-wider">
                      Approved By
                    </th>
                    <th className="px-6 py-2 text-left text-xs font-semibold text-white uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px-6 py-2 text-left text-xs font-semibold text-white uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredPlans.map((plan) => (
                    <tr
                      key={plan.id}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-6 py-2 border-2 border-primary/50">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">
                              #{plan.id}
                            </Badge>
                          </div>
                        </div>
                      </td>
                      {/* <td className="px-6 py-1 border-2 border-primary/50">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-900 break-all">
                                  {plan.qc_barcode || "-"}
                                </span>
                              </div>
                            </div>
                          </div>
                        </div>
                      </td> */}
                      <td className="px-6 py-1 border-2 border-primary/50">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-900">
                                  {plan.itcd}
                                </span>
                              </div>
                              <p className="text-sm text-gray-600 truncate max-w-xs">
                                {plan.item_name}
                              </p>
                              <p className="text-sm text-gray-600 truncate max-w-xs"> ({plan.item_code})</p>

                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-1 border-2 border-primary/50">
                        <div className="space-y-2">
                          <div className="flex items-center justify-between">
                            <div className="min-w-0">
                              <div className="flex items-center gap-2">
                                <span className="text-sm font-medium text-gray-900">
                                  Batch #{plan.batch_no}
                                </span>
                              </div>
                              <p className="text-sm text-gray-600">
                                Size: {plan.batch_size} KG
                              </p>
                              {plan.mfg_date && (
                                <p className="text-xs text-gray-500 mt-1">
                                  Mfg:{" "}
                                  {new Date(plan.mfg_date).toLocaleDateString()}
                                </p>
                              )}
                            </div>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-1 border-2 border-primary/50">
                        <div className="space-y-1">
                          <span className="text-sm font-medium text-gray-900">
                            {plan.approved_by || "-"}
                          </span>
                        </div>
                      </td>
                      <td className="px-6 py-1 border-2 border-primary/50">
                        <div className="flex gap-3">
                          <StatusBadge status={plan.status} />
                          <div className="text-xs flex-1 text-black">
                            {plan.attempt_date
                              ? `Last attempt: ${new Date(plan.attempt_date).toLocaleDateString()}`
                              : "No attempts"}
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-1 border-2 border-primary/50">
                        <div className="flex items-center gap-2">
                          <Button
                            onClick={() => handleDownloadPDF(plan)}
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                            title="Print Preview"
                          >
                            <Printer className="h-3 w-3" />
                          </Button>
                          <Button
                            onClick={() =>
                              window.open(
                                `/accounting/forms/qualitycontrol/${plan.id}?mode=view`,
                                "_self",
                              )
                            }
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-black hover:text-gray-900 hover:bg-gray-100"
                            title="View Details"
                          >
                            <Eye className="h-3 w-3" />
                          </Button>
                          <Button
                            onClick={() =>
                              window.open(
                                `/accounting/forms/qualitycontrol/${plan.id}`,
                                "_self",
                              )
                            }
                            size="sm"
                            variant="ghost"
                            className="h-7 w-7 p-0 text-blue-600 hover:text-blue-700 hover:bg-blue-50"
                            title="Edit"
                          >
                            <Pencil className="h-3 w-3" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardContent>

        {/* Pagination */}
        {filteredPlans.length > 0 && (
          <div className="px-6 py-2 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
            <div className="text-sm fone-medium text-primary">
              Showing {rangeLabel}
            </div>
            <div className="flex items-center gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.max(1, p - 1))}
                disabled={page <= 1}
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <div className="flex items-center gap-1">
                {Array.from({ length: Math.min(5, totalPages) }, (_, i) => {
                  let pageNum;
                  if (totalPages <= 5) {
                    pageNum = i + 1;
                  } else if (page <= 3) {
                    pageNum = i + 1;
                  } else if (page >= totalPages - 2) {
                    pageNum = totalPages - 4 + i;
                  } else {
                    pageNum = page - 2 + i;
                  }

                  return (
                    <Button
                      key={pageNum}
                      variant={page === pageNum ? "default" : "outline"}
                      size="sm"
                      onClick={() => setPage(pageNum)}
                    >
                      {pageNum}
                    </Button>
                  );
                })}
              </div>

              <Button
                variant="outline"
                size="sm"
                onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
                disabled={page >= totalPages}
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>
          </div>
        )}
      </Card>

      {/* New QC Check Modal */}
      <Dialog open={modalOpen} onOpenChange={setModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary">
              <Plus className="h-5 w-5" />
              New Quality Control Check
            </DialogTitle>
            <DialogDescription>
              Go to a process order to start quality control checks.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Enter Process Order No
              </label>
              <Input
                type="text"
                value={modalInput}
                onChange={(e) => setModalInput(e.target.value)}
                placeholder="e.g. 123"
                className="w-full"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Or select Process Order No
              </label>
              <div className="relative">
                <AsyncSelect
                  cacheOptions
                  defaultOptions={visibleOptions}
                  value={
                    modalSelect
                      ? {
                        value: modalSelect,
                        label: `Process Order ${modalSelect}`,
                      }
                      : null
                  }
                  loadOptions={loadOptions}
                  onChange={(option) =>
                    setModalSelect(option ? option.value : "")
                  }
                  placeholder="-- Choose process order --"
                  className="w-full"
                  onMenuScrollToBottom={() => {
                    if (
                      !isLoadingMore &&
                      visibleOptions.length < cachedOptions.length
                    ) {
                      loadMoreOptions();
                    }
                  }}
                  noOptionsMessage={() => "No matching process orders"}
                  loadingMessage={() => "Loading more options..."}
                />
              </div>
            </div>

            <div className="bg-primary border border-blue-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <Info className="h-4 w-4 text-white mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-white">Note:</p>
                  <p className="text-xs text-white mt-1">
                    You will be redirected to the quality control form for the
                    selected process order.
                  </p>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setModalInput("");
                setModalSelect("");
                setModalOpen(false);
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={() => {
                const val = (modalSelect || modalInput || "").toString().trim();
                if (!val) {
                  toast.error("Please enter or select a process order ID");
                  return;
                }
                setModalOpen(false);
                router.push(`/accounting/forms/qualitycontrol/${val}`);
              }}
              className="bg-primary hover:bg-primary"
            >
              Go to QC Form
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Print Preview Modal */}
      <PrintPreviewModal
        isOpen={isPreviewOpen}
        onClose={() => setIsPreviewOpen(false)}
        pdfUrl={previewPdfUrl}
        title={previewTitle}
        onDownload={handleDownloadFromPreview}
      />
    </div>
  );
}
