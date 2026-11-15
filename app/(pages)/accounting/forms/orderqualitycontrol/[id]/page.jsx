"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableHeader,
  TableBody,
  TableRow,
  TableHead,
  TableCell,
} from "@/components/ui/table";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Textarea } from "@/components/ui/textarea";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Package,
  Plus,
  Eye,
  X,
  FileText,
  Hash,
  Box,
  Building2,
  Calendar,
  Scale,
  CheckCircle2,
  XCircle,
  Clock,
  Truck,
  AlertTriangle,
  Info,
  Download,
  Filter,
  RefreshCw,
  Save,
  TestTube,
  ClipboardCheck,
  Zap,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";

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
    approve: {
      bg: "bg-emerald-50",
      text: "text-emerald-800",
      border: "border-emerald-200",
      icon: <CheckCircle2 className="h-3 w-3" />,
      label: "Approved",
    },
    approved: {
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
    rejected: {
      bg: "bg-red-50",
      text: "text-red-800",
      border: "border-red-200",
      icon: <XCircle className="h-3 w-3" />,
      label: "Rejected",
    },
  };

  const config = statusConfig[status?.toLowerCase()] || statusConfig.draft;

  return (
    <div
      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full border ${config.bg} ${config.text} ${config.border}`}
    >
      {config.icon}
      <span className="text-sm font-medium">{config.label}</span>
    </div>
  );
};

// Info Card Component
const InfoCard = ({ icon: Icon, title, value, className = "" }) => (
  <div
    className={`bg-primary/20 rounded-lg border border-gray-200 p-4 ${className}`}
  >
    <div className="flex items-center gap-3">
      <div className="p-2 bg-gray-50 rounded-lg">
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div>
        <p className="text-xs text-primary font-medium">{title}</p>
        <p className="text-sm font-semibold text-gray-900 mt-0.5">
          {value || "-"}
        </p>
      </div>
    </div>
  </div>
);

// Workflow Card Component
const WorkflowCard = ({ step, title, description, active = false }) => (
  <div
    className={`p-4 rounded-lg border ${
      active ? "bg-blue-50 border-blue-200" : "bg-gray-50 border-gray-200"
    }`}
  >
    <div className="flex items-center gap-3">
      <div
        className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-semibold ${
          active ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-600"
        }`}
      >
        {step}
      </div>
      <div>
        <h4 className="text-sm font-semibold text-gray-900">{title}</h4>
        <p className="text-xs text-gray-600 mt-0.5">{description}</p>
      </div>
    </div>
  </div>
);

export default function OrderQualityControlForm() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();
  const orderId = params?.id;
  const urlItcd = searchParams?.get("itcd");

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);

  const [masterData, setMasterData] = useState({
    orderNo: "",
    itcd: "",
    itemName: "",
    batchSize: "",
    batchNo: "",
    mfgDate: "",
    expiryDate: "",
    vendorName: "",
    status: "draft",
    hasParameters: true,
    grnNo: null,
  });

  const [parameters, setParameters] = useState([]);
  const [attempts, setAttempts] = useState([]);
  const [activeAttemptIndex, setActiveAttemptIndex] = useState(0);
  const [allItems, setAllItems] = useState([]);
  const [selectedItcd, setSelectedItcd] = useState(null);
  const [workflowStep, setWorkflowStep] = useState(1);

  // Modal states
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [rejectReason, setRejectReason] = useState("");
  const [pendingAction, setPendingAction] = useState(null);
  const [batchNo, setBatchNo] = useState("");
  const [batchMfgDate, setBatchMfgDate] = useState("");
  const [batchExpiryDate, setBatchExpiryDate] = useState("");

  const canEdit = useMemo(() => {
    return masterData.status === "draft";
  }, [masterData.status]);

  const canEditAttempt = useCallback(
    (attemptIndex) => {
      if (masterData.status === "approve" || masterData.status === "approved")
        return false;
      if (masterData.status === "reject" || masterData.status === "rejected") {
        return false;
      }
      return masterData.status === "draft";
    },
    [masterData.status, attempts.length],
  );

  const canAddAttempt = useMemo(() => {
    if (masterData.status === "reject" || masterData.status === "rejected")
      return true;
    if (masterData.status === "draft" && masterData.hasParameters)
      return attempts.length === 0;
    return false;
  }, [masterData.status, attempts.length, masterData.hasParameters]);

  const showQuickActions = useMemo(() => {
    return !masterData.hasParameters && masterData.status === "draft";
  }, [masterData.hasParameters, masterData.status]);

  const fetchQC = async (itcdToFetch = null) => {
    setLoading(true);
    try {
      const itcd = itcdToFetch || selectedItcd;
      const url = itcd
        ? `/api/forms/orderqualitycontrol/${orderId}?itcd=${itcd}`
        : `/api/forms/orderqualitycontrol/${orderId}`;

      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`Failed to load: ${res.status}`);
      const data = await res.json();

      // Set all items
      if (data.allItems && Array.isArray(data.allItems)) {
        setAllItems(data.allItems);
        if (
          !selectedItcd ||
          (data.selectedItcd && data.selectedItcd !== selectedItcd)
        ) {
          setSelectedItcd(data.selectedItcd || data.allItems[0]?.itcd || null);
        }
      }

      const newStatus = data.master.status ?? "draft";
      const hasParameters = (data.parameters || []).length > 0;
      const batchNo = data.master.batch_no ? String(data.master.batch_no) : "";
      const backendAttempts = data.attempts || [];

      // Set workflow step based on status
      let step = 1;
      if (newStatus === "draft" && hasParameters && backendAttempts.length > 0)
        step = 2;
      if (newStatus === "approve" || newStatus === "approved") step = 3;
      if (data.master.grn_exists) step = 4;
      setWorkflowStep(step);

      setMasterData({
        orderNo: String(data.master.order_no ?? ""),
        itcd: String(data.master.itcd ?? ""),
        itemName: data.master.item_name ?? "",
        batchSize: String(data.master.batch_size ?? ""),
        batchNo: batchNo,
        mfgDate: data.master.mfg_date
          ? new Date(data.master.mfg_date).toISOString().split("T")[0]
          : "",
        expiryDate: data.master.expiry_date
          ? new Date(data.master.expiry_date).toISOString().split("T")[0]
          : "",
        vendorName: data.master.vendor_name ?? "",
        status: newStatus,
        hasParameters: hasParameters,
        grnNo: data.master.grn_exists,
      });

      // Set parameters
      setParameters(data.parameters || []);

      if (backendAttempts.length === 0 && hasParameters) {
        const emptyAttempt = {
          attempt_no: 1,
          attempt_date: new Date().toISOString().split("T")[0],
          rows: (data.parameters || []).map((p) => ({
            parameter_name: p.parameter_name,
            quality_standard: p.quality_standard,
            quality_realized: "",
          })),
        };
        setAttempts([emptyAttempt]);
        setActiveAttemptIndex(0);
      } else {
        setAttempts(backendAttempts);
        setActiveAttemptIndex(
          backendAttempts.length > 0 ? backendAttempts.length - 1 : 0,
        );
      }
    } catch (e) {
      toast.error("Failed to load quality control data");
      console.error("Fetch error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (orderId) {
      const itcdToFetch = urlItcd ? Number(urlItcd) : null;
      fetchQC(itcdToFetch);
    }
  }, [orderId, urlItcd]);

  const handleItemChange = (newItcd) => {
    setSelectedItcd(newItcd);
    router.replace(
      `/accounting/forms/orderqualitycontrol/${orderId}?itcd=${newItcd}`,
      { scroll: false },
    );
    fetchQC(newItcd);
  };

  const handleParameterChange = (paramName, value) => {
    if (!canEditAttempt(activeAttemptIndex)) return;

    const newAttempts = [...attempts];
    if (newAttempts[activeAttemptIndex]) {
      const row = newAttempts[activeAttemptIndex].rows.find(
        (r) => r.parameter_name === paramName,
      );
      if (row) {
        row.quality_realized = value;
        setAttempts(newAttempts);
      }
    }
  };

  const handleAddAttempt = () => {
    if (!canAddAttempt) {
      if (masterData.status === "draft" && attempts.length > 0) {
        toast.warning(
          "Wait for current attempt to be approved or rejected before adding a new one.",
        );
      }
      return;
    }

    const newAttemptNo =
      attempts.length > 0
        ? Math.max(...attempts.map((a) => a.attempt_no)) + 1
        : 1;

    const newAttempt = {
      attempt_no: newAttemptNo,
      attempt_date: new Date().toISOString().split("T")[0],
      rows: parameters.map((p) => ({
        parameter_name: p.parameter_name,
        quality_standard: p.quality_standard,
        quality_realized: "",
      })),
    };

    setAttempts([...attempts, newAttempt]);
    setActiveAttemptIndex(attempts.length);
    setWorkflowStep(2);
  };

  const handleDirectApprove = () => {
    setPendingAction("direct-approve");

    // Check if batch number exists
    if (!masterData.batchNo || masterData.batchNo.trim() === "") {
      // No batch number - open batch modal
      setBatchNo("");
      setBatchMfgDate(new Date().toISOString().split("T")[0]);
      setBatchExpiryDate("");
      setBatchModalOpen(true);
    } else {
      // Batch number exists - proceed to approve
      setApproveModalOpen(true);
    }
  };

  const handleDirectReject = () => {
    setPendingAction("direct-reject");
    setRejectReason("");
    setRejectModalOpen(true);
  };

  const handleNormalApprove = () => {
    setPendingAction("normal-approve");

    // Check if batch number exists
    if (!masterData.batchNo || masterData.batchNo.trim() === "") {
      // No batch number - open batch modal
      setBatchNo("");
      setBatchMfgDate(new Date().toISOString().split("T")[0]);
      setBatchExpiryDate("");
      setBatchModalOpen(true);
    } else {
      // Batch number exists - proceed to approve
      setApproveModalOpen(true);
    }
  };

  const handleNormalReject = () => {
    setPendingAction("normal-reject");
    setRejectReason("");
    setRejectModalOpen(true);
  };

  const handleBatchSaveAndApprove = async () => {
    if (!batchNo.trim()) {
      toast.error("Batch number is required");
      return;
    }

    setSubmitting(true);
    try {
      // First save batch information
      const batchRes = await fetch(
        `/api/forms/orderqualitycontrol/${orderId}`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            batch_no: batchNo.trim(),
            mfg_date: batchMfgDate || new Date().toISOString().split("T")[0],
            expiry_date: batchExpiryDate || null,
            itcd: selectedItcd,
          }),
        },
      );

      const batchData = await batchRes.json();

      if (!batchRes.ok) {
        toast.error(batchData?.error || "Failed to save batch information");
        return;
      }

      // Then approve the item
      const approveRes = await fetch(
        `/api/forms/orderqualitycontrol/order/${orderId}/status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itcd: selectedItcd,
            status: "approve",
          }),
        },
      );

      const approveData = await approveRes.json();

      if (!approveRes.ok) {
        toast.error(approveData?.error || "Failed to approve item");
        return;
      }

      toast.success("Batch saved and item approved successfully!");
      setBatchModalOpen(false);
      setWorkflowStep(3);

      // Refresh data
      await fetchQC();
    } catch (e) {
      toast.error("Server error while processing");
      console.error("Batch save error:", e);
    } finally {
      setSubmitting(false);
    }
  };

  const performStatusUpdate = async (status, rejectReasonValue = null) => {
    setSubmitting(true);
    try {
      const body = {
        status,
        itcd: selectedItcd,
      };

      if (rejectReasonValue) {
        body.reject_reason = rejectReasonValue;
      }

      const res = await fetch(
        `/api/forms/orderqualitycontrol/order/${orderId}/status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );

      const data = await res.json();

      if (!res.ok) {
        toast.error(data?.error || "Status update failed");
        return;
      }

      await fetchQC();

      if (status === "approve") {
        toast.success("Item approved successfully!");
        setWorkflowStep(3);
      } else {
        toast.success("Item rejected");
        setWorkflowStep(1);
      }

      setRejectReason("");
    } catch (e) {
      toast.error("Server error while updating status");
      console.error("Status update error:", e);
    } finally {
      setSubmitting(false);
      setRejectModalOpen(false);
      setApproveModalOpen(false);
      setPendingAction(null);
    }
  };

  const handleRejectReasonSubmit = async () => {
    if (!rejectReason || rejectReason.trim() === "") {
      toast.error("Reject reason cannot be empty");
      return;
    }

    await performStatusUpdate("reject", rejectReason.trim());
  };

  const handleApproveSubmit = async () => {
    await performStatusUpdate("approve");
  };

  const handleSaveAttempt = async () => {
    if (!canEditAttempt(activeAttemptIndex)) {
      toast.error("Cannot edit this attempt");
      return;
    }

    setSaving(true);
    try {
      const activeAttempt = attempts[activeAttemptIndex];
      if (!activeAttempt) {
        toast.error("No attempt selected");
        return;
      }

      // Validate batch_no
      if (!masterData.batchNo || masterData.batchNo.trim() === "") {
        toast.error("Batch number is required");
        return;
      }

      // Validate quality values if there are parameters
      if (parameters.length > 0) {
        const hasData = activeAttempt.rows.some(
          (row) => row.quality_realized && row.quality_realized.trim() !== "",
        );

        if (!hasData) {
          toast.error("Enter at least one quality value before saving");
          return;
        }
      }

      const sending = activeAttempt.rows.map((row) => ({
        parameter_name: row.parameter_name,
        quality_realized: row.quality_realized ?? "",
      }));

      const body = {
        parameters: sending,
        itcd: selectedItcd,
        batch_no: masterData.batchNo.trim(),
        mfg_date: masterData.mfgDate || new Date().toISOString().split("T")[0],
      };

      if (masterData.expiryDate) {
        body.expiry_date = masterData.expiryDate;
      }

      const res = await fetch(`/api/forms/orderqualitycontrol/${orderId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data?.error || "Save failed");
        return;
      }

      await fetchQC();

      if (data.status === "reject") {
        toast.warning(
          data.message || "Saved, but rejected due to duplicate batch number",
        );
      } else {
        toast.success("Quality control data saved successfully");
        setWorkflowStep(2);
      }
    } catch (e) {
      toast.error("Server error while saving");
      console.error("Save error:", e);
    } finally {
      setSaving(false);
    }
  };

  const activeAttempt = attempts[activeAttemptIndex];

  return (
    <div className="min-h-screen bg-secondary p-4 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center gap-2">
              <TestTube className="h-7 w-7 text-primary" />
              Order Quality Control
            </h1>
            <p className="text-black mt-1">
              Purchase Order #{orderId} • Quality Inspection Management
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setDetailsModalOpen(true)}
              className="flex items-center bg-primary text-white gap-2"
            >
              <Eye className="h-4 w-4" />
              View Details
            </Button>
            <StatusBadge status={masterData.status} />
          </div>
        </div>

        {/* Workflow Progress */}
        <div className="mb-2">
          <h3 className="text-sm font-semibold text-black mb-2">
            Quality Control Workflow
          </h3>
          <div className="grid grid-cols-1 md:grid-cols-6 gap-2">
            {/* <WorkflowCard
              step={1}
              title="Setup"
              description="Select item & enter batch info"
              active={workflowStep >= 1}
            />
            <WorkflowCard
              step={2}
              title="Testing"
              description="Perform quality tests"
              active={workflowStep >= 2}
            />
            <WorkflowCard
              step={3}
              title="Approval"
              description="Approve or reject item"
              active={workflowStep >= 3}
            />
            <WorkflowCard
              step={4}  
              title="GRN"
              description="Store creates goods receipt"
              active={workflowStep >= 4}
            /> */}
            <InfoCard
              icon={Hash}
              title="Order Number"
              value={masterData.orderNo}
            />
            <InfoCard
              icon={Box}
              title="MM No"
              value={`${masterData.itcd}`}
            />
            {/* Vendor */}
            <InfoCard
              icon={Building2}
              title="Vendor"
              value={masterData.vendorName}
              className="lg:col-span-2"
            />

            {/* GRN / Status */}
            {masterData.grnNo ? (
              <InfoCard
                icon={Truck}
                title="GRN Number"
                value={`GRN #${masterData.grnNo}`}
                className="lg:col-span-2 bg-emerald-50 border-emerald-200"
              />
            ) : (
              <InfoCard
                icon={ClipboardCheck}
                title="Status"
                value={masterData.status.toUpperCase()}
                className="lg:col-span-2"
              />
            )}
          </div>
        </div>

        {/* Info Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-8 gap-4 mb-6">
          {/* Quick Actions */}
          {masterData.status === "draft" && (
            <Card className="border-blue-200 bg-blue-50 lg:col-span-3 h-full flex flex-col">
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-primary flex items-center gap-2">
                  <Zap className="h-4 w-4" />
                  Quick Actions
                </CardTitle>
                <CardDescription className="text-black">
                  {masterData.hasParameters
                    ? "Skip testing and directly decide"
                    : "No quality parameters defined"}
                </CardDescription>
              </CardHeader>

              <CardContent className="flex-1">
                <div className="grid grid-cols-1 gap-3">
                  <Button
                    onClick={handleDirectApprove}
                    className="bg-primary text-white"
                  >
                    <CheckCircle2 className="h-4 w-4 mr-2" />
                    Direct Approve
                  </Button>

                  <Button
                    onClick={handleDirectReject}
                    variant="outline"
                    className="border-red-300 text-red-700 hover:bg-primary"
                  >
                    <XCircle className="h-4 w-4 mr-2" />
                    Direct Reject
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Order Items */}
          <Card className="lg:col-span-4 h-full flex flex-col">
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Box className="h-4 w-4" />
                Order Items
              </CardTitle>
            </CardHeader>

            <CardContent className="flex-1 overflow-y-auto">
              <div className="space-y-2">
                {allItems.map((item) => (
                  <button
                    key={item.id}
                    onClick={() => handleItemChange(item.itcd)}
                    className={`w-full p-3 rounded-lg border text-left transition-all ${
                      selectedItcd === item.itcd
                        ? "bg-blue-50 border-blue-300 ring-2 ring-blue-100"
                        : "bg-white border-gray-200 hover:bg-gray-50"
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <div>
                        <p className="font-medium text-gray-900">
                          {item.itcd}
                        </p>
                        <p className="text-sm text-gray-600 truncate">
                          {item.item_name}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        <div className="text-xs px-2 py-1 bg-gray-100 rounded">
                          {item.qty} {item.unit}
                        </div>
                        {!item.has_parameters && (
                          <div className="text-xs px-2 py-1 bg-amber-100 text-amber-800 rounded">
                            No QC
                          </div>
                        )}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Panel - Item Selection & Batch Info */}
        <div className="lg:col-span-1 space-y-6">
          {/* Batch Information */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Package className="h-4 w-4" />
                Batch Information
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Batch Number *
                </label>
                <Input
                  value={masterData.batchNo}
                  onChange={(e) => {
                    setMasterData((prev) => ({
                      ...prev,
                      batchNo: e.target.value,
                    }));
                  }}
                  className="w-full"
                  placeholder="Enter batch number"
                  readOnly={
                    masterData.status === "approve" ||
                    masterData.status === "approved"
                  }
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  QC Date
                </label>
                <Input
                  type="date"
                  value={masterData.mfgDate}
                  onChange={(e) => {
                    setMasterData((prev) => ({
                      ...prev,
                      mfgDate: e.target.value,
                    }));
                  }}
                  className="w-full"
                  readOnly={
                    masterData.status === "approve" ||
                    masterData.status === "approved"
                  }
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Expiry Date
                </label>
                <Input
                  type="date"
                  value={masterData.expiryDate}
                  onChange={(e) => {
                    setMasterData((prev) => ({
                      ...prev,
                      expiryDate: e.target.value,
                    }));
                  }}
                  className="w-full"
                  readOnly={
                    masterData.status === "approve" ||
                    masterData.status === "approved"
                  }
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Batch Size
                </label>
                <Input
                  value={masterData.batchSize}
                  className="w-full"
                  readOnly
                />
              </div>
            </CardContent>
          </Card>
        </div>

        {/* Right Panel - Main Content */}
        <div className="lg:col-span-3 space-y-6">
          {/* Quality Testing Section */}
          {masterData.hasParameters ? (
            <>
              {/* Attempts Navigation */}
              {attempts.length > 0 && (
                <Card>
                  <CardHeader>
                    <div className="flex items-center justify-between">
                      <CardTitle className="text-sm font-semibold text-gray-700">
                        Quality Test Attempts
                      </CardTitle>
                      {canAddAttempt && (
                        <Button
                          onClick={handleAddAttempt}
                          size="sm"
                          className="flex items-center gap-2"
                          disabled={!canAddAttempt}
                        >
                          <Plus className="h-4 w-4" />
                          New Attempt
                        </Button>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-2 overflow-x-auto pb-2">
                      {attempts.map((attempt, index) => (
                        <button
                          key={attempt.original_attempt_no || index}
                          onClick={() => setActiveAttemptIndex(index)}
                          className={`flex-shrink-0 px-4 py-2 rounded-lg border transition-all ${
                            activeAttemptIndex === index
                              ? "bg-blue-600 text-white border-blue-600"
                              : "bg-white border-gray-300 hover:bg-gray-50"
                          }`}
                        >
                          <div className="font-medium">
                            Attempt {attempt.attempt_no}
                          </div>
                          <div className="text-xs opacity-75">
                            {attempt.attempt_date}
                          </div>
                          {attempt.reject_reason && (
                            <div className="text-xs mt-1 px-2 py-0.5 bg-red-100 text-red-700 rounded">
                              Rejected
                            </div>
                          )}
                        </button>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              )}

              {/* Quality Parameters Table */}
              {parameters.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold text-gray-700">
                      Quality Parameters
                      {activeAttempt && (
                        <span className="ml-2 text-gray-500 font-normal">
                          • Attempt {activeAttempt.attempt_no}
                        </span>
                      )}
                    </CardTitle>
                  </CardHeader>
                  <CardContent>
                    <div className="border rounded-lg overflow-hidden">
                      <table className="w-full">
                        <thead className="bg-gray-50">
                          <tr>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                              Parameter
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                              Standard
                            </th>
                            <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                              Realized Value
                            </th>
                          </tr>
                        </thead>
                        <tbody className="divide-y divide-gray-200">
                          {parameters.map((param, index) => {
                            const row = activeAttempt?.rows?.find(
                              (r) => r.parameter_name === param.parameter_name,
                            );
                            return (
                              <tr
                                key={param.parameter_name}
                                className="hover:bg-gray-50"
                              >
                                <td className="px-4 py-3">
                                  <div className="font-medium text-gray-900">
                                    {param.parameter_name}
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  <div className="text-gray-600">
                                    {param.quality_standard}
                                  </div>
                                </td>
                                <td className="px-4 py-3">
                                  <Input
                                    value={row?.quality_realized ?? ""}
                                    onChange={(e) =>
                                      handleParameterChange(
                                        param.parameter_name,
                                        e.target.value,
                                      )
                                    }
                                    className={`w-full ${
                                      !canEditAttempt(activeAttemptIndex)
                                        ? "bg-gray-100 cursor-not-allowed"
                                        : ""
                                    }`}
                                    placeholder="Enter value"
                                    disabled={
                                      !canEditAttempt(activeAttemptIndex)
                                    }
                                  />
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                  <CardFooter className="border-t bg-gray-50">
                    <div className="flex justify-between w-full items-center">
                      <div className="text-sm text-gray-600">
                        {parameters.length} parameters • {attempts.length}{" "}
                        attempts
                      </div>
                      <div className="flex gap-2">
                        <Button
                          variant="outline"
                          onClick={fetchQC}
                          disabled={loading}
                        >
                          <RefreshCw
                            className={`h-4 w-4 mr-2 ${
                              loading ? "animate-spin" : ""
                            }`}
                          />
                          Refresh
                        </Button>
                        <Button
                          onClick={handleSaveAttempt}
                          disabled={
                            saving || !canEditAttempt(activeAttemptIndex)
                          }
                          className="bg-blue-600 hover:bg-blue-700"
                        >
                          <Save className="h-4 w-4 mr-2" />
                          {saving ? "Saving..." : "Save Attempt"}
                        </Button>
                      </div>
                    </div>
                  </CardFooter>
                </Card>
              )}

              {/* Normal Status Actions */}
              {masterData.status === "draft" && attempts.length > 0 && (
                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm font-semibold text-gray-700">
                      Complete Quality Check
                    </CardTitle>
                    <CardDescription>
                      Based on test results, approve or reject this item.
                    </CardDescription>
                  </CardHeader>
                  <CardContent>
                    <div className="flex gap-4">
                      <Button
                        onClick={handleNormalApprove}
                        className="flex-1 bg-emerald-600 hover:bg-emerald-700"
                        disabled={submitting}
                      >
                        <CheckCircle2 className="h-4 w-4 mr-2" />
                        Approve Based on Tests
                      </Button>
                      <Button
                        onClick={handleNormalReject}
                        variant="outline"
                        className="flex-1 border-red-300 text-red-700 hover:bg-red-50"
                        disabled={submitting}
                      >
                        <XCircle className="h-4 w-4 mr-2" />
                        Reject Based on Tests
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </>
          ) : (
            /* No Parameters Message */
            <Card className="border-primary p-0 bg-white">
              <CardHeader className="p-2 text-center">
                <CardTitle className="text-sm font-semibold justify-center text-amber-800 flex items-center gap-2">
                  <AlertTriangle className="h-4 w-4" />
                  No Quality Parameters Defined
                </CardTitle>
                <CardDescription className="text-amber-700">
                  This item doesn't require quality testing. You can directly
                  approve or reject it.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-amber-100 border border-amber-200 rounded-lg p-1">
                  <div className="flex items-start gap-3">
                    <Info className="h-5 w-5 text-amber-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-amber-800 mb-1">
                        Item Information
                      </p>
                      <p className="text-sm text-amber-700">
                        Item <strong>ITCD {masterData.itcd}</strong> (
                        {masterData.itemName}) does not have any quality
                        parameters defined in the system. This typically means
                        the item doesn't require laboratory testing or quality
                        verification.
                      </p>
                    </div>
                  </div>
                </div>

                {showQuickActions && (
                  <div className="mt-6 p-4 bg-white border border-gray-200 rounded-lg">
                    <p className="text-sm font-medium text-gray-700 mb-3">
                      Available Actions:
                    </p>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                      <div className="p-3 bg-emerald-50 border border-emerald-200 rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <CheckCircle2 className="h-4 w-4 text-emerald-600" />
                          <span className="text-sm font-semibold text-emerald-800">
                            Direct Approve
                          </span>
                        </div>
                        <p className="text-xs text-emerald-700">
                          Accept the item without testing. This will mark the
                          item as approved and allow GRN creation.
                        </p>
                      </div>
                      <div className="p-3 bg-red-50 border border-red-200 rounded-lg">
                        <div className="flex items-center gap-2 mb-2">
                          <XCircle className="h-4 w-4 text-red-600" />
                          <span className="text-sm font-semibold text-red-800">
                            Direct Reject
                          </span>
                        </div>
                        <p className="text-xs text-red-700">
                          Reject the item without testing. You'll need to
                          provide a reason for rejection.
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </CardContent>
            </Card>
          )}

          {/* GRN Information Display (Read-only) */}
          {masterData.grnNo && (
            <Card className="border-purple-200 bg-purple-50">
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-purple-800 flex items-center gap-2">
                  <Truck className="h-4 w-4" />
                  Goods Receipt Note
                </CardTitle>
                <CardDescription className="text-purple-700">
                  GRN #{masterData.grnNo} created by store department.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-white border border-purple-200 rounded-lg p-4">
                  <div className="flex items-center justify-between">
                    <div>
                      <p className="font-semibold text-purple-800 text-lg">
                        GRN #{masterData.grnNo}
                      </p>
                      <p className="text-sm text-purple-700 mt-1">
                        Goods Receipt Note created by store department.
                      </p>
                    </div>
                    <Button
                      variant="outline"
                      className="border-purple-300 text-purple-700 hover:bg-purple-50"
                      onClick={() => {
                        // Navigate to GRN view
                        window.open(
                          `/accounting/transactions/grn/${masterData.grnNo}`,
                          "_blank",
                        );
                      }}
                    >
                      <Eye className="h-4 w-4 mr-2" />
                      View GRN
                    </Button>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Rejected Status Display */}
          {(masterData.status === "reject" ||
            masterData.status === "rejected") &&
            attempts.length > 0 && (
              <Card className="border-red-200 bg-red-50">
                <CardHeader>
                  <CardTitle className="text-sm font-semibold text-red-800 flex items-center gap-2">
                    <XCircle className="h-4 w-4" />
                    Item Rejected
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="bg-white border border-red-200 rounded-lg p-4">
                    <div className="flex items-start gap-3">
                      <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
                      <div>
                        <p className="font-semibold text-red-800 mb-1">
                          Rejection Reason
                        </p>
                        <p className="text-sm text-gray-700">
                          {attempts[attempts.length - 1]?.reject_reason ||
                            "No reason provided"}
                        </p>
                        {canAddAttempt && (
                          <div className="mt-4 p-3 bg-amber-50 border border-amber-200 rounded">
                            <p className="text-sm font-medium text-amber-800 mb-2">
                              Retry Available
                            </p>
                            <p className="text-xs text-amber-700 mb-3">
                              You can create a new testing attempt for this
                              item.
                            </p>
                            <Button
                              onClick={handleAddAttempt}
                              size="sm"
                              className="bg-amber-600 hover:bg-amber-700"
                            >
                              <Plus className="h-4 w-4 mr-2" />
                              Create New Attempt
                            </Button>
                          </div>
                        )}
                      </div>
                    </div>
                  </div>
                </CardContent>
              </Card>
            )}
        </div>
      </div>

      {/* Reject Reason Modal */}
      <Dialog open={rejectModalOpen} onOpenChange={setRejectModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-700">
              <XCircle className="h-5 w-5" />
              Reject Item
            </DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting this item. This will be
              recorded in the quality control history.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Rejection Reason *
              </label>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Enter detailed reason for rejection..."
                className="min-h-[120px]"
              />
              <p className="text-xs text-gray-500 mt-2">
                Required for audit purposes. Minimum 10 characters.
              </p>
            </div>
            <div className="bg-red-50 border border-red-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-red-800">Important:</p>
                  <p className="text-xs text-red-700 mt-1">
                    Rejecting this item will cancel the current quality control
                    process.
                    {masterData.hasParameters &&
                      " A new attempt can be created later if needed."}
                  </p>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="flex flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setRejectModalOpen(false)}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              onClick={handleRejectReasonSubmit}
              className="w-full sm:w-auto bg-red-600 hover:bg-red-700"
              disabled={
                submitting ||
                !rejectReason.trim() ||
                rejectReason.trim().length < 10
              }
            >
              {submitting ? "Processing..." : "Confirm Reject"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve Confirmation Modal */}
      <Dialog open={approveModalOpen} onOpenChange={setApproveModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-emerald-700">
              <CheckCircle2 className="h-5 w-5" />
              Approve Item
            </DialogTitle>
            <DialogDescription>
              Confirm approval of this item. Once approved, GRN can be created.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="bg-emerald-50 border border-emerald-200 rounded-lg p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-emerald-100 rounded-full">
                  <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                </div>
                <div>
                  <p className="font-semibold text-emerald-800">Item Details</p>
                  <div className="text-sm text-emerald-700 mt-1 space-y-1">
                    <p>ITCD: {masterData.itcd}</p>
                    <p>Batch: {masterData.batchNo}</p>
                    <p>Item: {masterData.itemName}</p>
                  </div>
                </div>
              </div>
            </div>

            {pendingAction === "normal-approve" && attempts.length > 0 && (
              <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                <p className="text-sm font-medium text-blue-800 mb-1">
                  Quality Test Results Summary
                </p>
                <div className="text-xs text-blue-700 space-y-1">
                  <p>• Based on {attempts.length} test attempt(s)</p>
                  <p>• Latest attempt: {activeAttempt?.attempt_date}</p>
                  <p>• Parameters tested: {parameters.length}</p>
                </div>
              </div>
            )}

            <div className="border-t pt-4">
              <p className="text-sm font-medium text-gray-700 mb-2">
                Approval will:
              </p>
              <ul className="text-sm text-gray-600 space-y-1 list-disc pl-5">
                <li>Mark the item as approved</li>
                <li>Lock all quality control data</li>
                <li>Enable GRN creation</li>
                <li>Update inventory records</li>
              </ul>
            </div>
          </div>
          <DialogFooter className="flex flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setApproveModalOpen(false)}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              onClick={handleApproveSubmit}
              className="w-full sm:w-auto bg-emerald-600 hover:bg-emerald-700"
              disabled={submitting}
            >
              {submitting ? "Processing..." : "Confirm Approval"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Details Modal */}
      <Dialog open={detailsModalOpen} onOpenChange={setDetailsModalOpen}>
        <DialogContent className="sm:max-w-2xl">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <FileText className="h-5 w-5" />
              Order & MM Details
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Tabs defaultValue="general" className="w-full">
              <TabsList className="grid grid-cols-3 mb-4">
                <TabsTrigger value="general">General Info</TabsTrigger>
                <TabsTrigger value="quality">Quality History</TabsTrigger>
                <TabsTrigger value="documents">Documents</TabsTrigger>
              </TabsList>

              <TabsContent value="general" className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-medium text-gray-500">
                      Order Number
                    </p>
                    <p className="text-sm font-semibold text-gray-900">
                      {masterData.orderNo}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500">
                      Order Date
                    </p>
                    <p className="text-sm font-semibold text-gray-900">-</p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500">Vendor</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {masterData.vendorName}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500">
                      Vendor Code
                    </p>
                    <p className="text-sm font-semibold text-gray-900">-</p>
                  </div>
                  <div className="col-span-2">
                    <p className="text-xs font-medium text-gray-500">
                      Delivery Address
                    </p>
                    <p className="text-sm font-semibold text-gray-900">-</p>
                  </div>
                </div>

                <div className="border-t pt-4">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">
                    MM Details
                  </h4>
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-xs font-medium text-gray-500">MM No</p>
                      <p className="text-sm font-semibold text-gray-900">
                        {masterData.itcd}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500">
                        MM Name
                      </p>
                      <p className="text-sm font-semibold text-gray-900">
                        {masterData.itemName}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500">
                        Quantity
                      </p>
                      <p className="text-sm font-semibold text-gray-900">
                        {masterData.batchSize}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500">Unit</p>
                      <p className="text-sm font-semibold text-gray-900">-</p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500">
                        Batch Number
                      </p>
                      <p className="text-sm font-semibold text-gray-900">
                        {masterData.batchNo || "-"}
                      </p>
                    </div>
                    <div>
                      <p className="text-xs font-medium text-gray-500">
                        QC Date
                      </p>
                      <p className="text-sm font-semibold text-gray-900">
                        {masterData.mfgDate
                          ? format(new Date(masterData.mfgDate), "dd MMM yyyy")
                          : "-"}
                      </p>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="quality" className="space-y-4">
                {attempts.length > 0 ? (
                  <div className="space-y-3">
                    {attempts.map((attempt, index) => (
                      <div key={index} className="border rounded-lg p-4">
                        <div className="flex items-center justify-between mb-3">
                          <div>
                            <p className="font-semibold text-gray-900">
                              Attempt {attempt.attempt_no}
                            </p>
                            <p className="text-xs text-gray-500">
                              {attempt.attempt_date}
                            </p>
                          </div>
                          {attempt.reject_reason && (
                            <Badge variant="destructive" className="text-xs">
                              Rejected
                            </Badge>
                          )}
                        </div>

                        {attempt.reject_reason && (
                          <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded">
                            <p className="text-xs font-medium text-red-800">
                              Rejection Reason:
                            </p>
                            <p className="text-xs text-red-700 mt-1">
                              {attempt.reject_reason}
                            </p>
                          </div>
                        )}

                        {attempt.rows && attempt.rows.length > 0 && (
                          <div className="overflow-x-auto">
                            <table className="w-full text-sm">
                              <thead>
                                <tr className="border-b">
                                  <th className="py-2 text-left font-medium text-gray-700">
                                    Parameter
                                  </th>
                                  <th className="py-2 text-left font-medium text-gray-700">
                                    Standard
                                  </th>
                                  <th className="py-2 text-left font-medium text-gray-700">
                                    Realized
                                  </th>
                                </tr>
                              </thead>
                              <tbody>
                                {attempt.rows.map((row, rowIndex) => (
                                  <tr
                                    key={rowIndex}
                                    className="border-b last:border-0"
                                  >
                                    <td className="py-2">
                                      {row.parameter_name}
                                    </td>
                                    <td className="py-2">
                                      {row.quality_standard}
                                    </td>
                                    <td className="py-2">
                                      <span
                                        className={
                                          row.quality_realized
                                            ? "font-medium text-gray-900"
                                            : "text-gray-500"
                                        }
                                      >
                                        {row.quality_realized || "Not recorded"}
                                      </span>
                                    </td>
                                  </tr>
                                ))}
                              </tbody>
                            </table>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-center py-8 text-gray-500">
                    <FileText className="h-12 w-12 mx-auto text-gray-300 mb-3" />
                    <p>No quality test history available</p>
                  </div>
                )}
              </TabsContent>

              <TabsContent value="documents" className="space-y-4">
                <div className="text-center py-8 text-gray-500">
                  <FileText className="h-12 w-12 mx-auto text-gray-300 mb-3" />
                  <p>No documents attached</p>
                  <Button variant="outline" size="sm" className="mt-3">
                    <Plus className="h-4 w-4 mr-2" />
                    Upload Document
                  </Button>
                </div>
              </TabsContent>
            </Tabs>
          </div>
          <DialogFooter>
            <Button
              onClick={() => setDetailsModalOpen(false)}
              className="w-full"
            >
              Close
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Batch Information Modal */}
      <Dialog open={batchModalOpen} onOpenChange={setBatchModalOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <Package className="h-5 w-5" />
              Enter Batch Information
            </DialogTitle>
            <DialogDescription>
              Batch number is required before approval. Please enter the batch
              details.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Batch Number *
              </label>
              <Input
                value={batchNo}
                onChange={(e) => setBatchNo(e.target.value)}
                placeholder="Enter batch number"
                className="w-full"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Mfg Date
                </label>
                <Input
                  type="date"
                  value={batchMfgDate}
                  onChange={(e) => setBatchMfgDate(e.target.value)}
                  className="w-full"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">
                  Expiry Date
                </label>
                <Input
                  type="date"
                  value={batchExpiryDate}
                  onChange={(e) => setBatchExpiryDate(e.target.value)}
                  className="w-full"
                />
              </div>
            </div>

            <div className="bg-primary border border-amber-200 rounded-lg p-3">
              <div className="flex items-start gap-2">
                <AlertTriangle className="h-4 w-4 text-white mt-0.5 flex-shrink-0" />
                <div>
                  <p className="text-sm font-medium text-white">Note:</p>
                  <p className="text-xs text-white mt-1">
                    Batch number is mandatory for approval. Make sure the batch
                    number is accurate as it cannot be changed after approval.
                  </p>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="flex flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => setBatchModalOpen(false)}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              onClick={handleBatchSaveAndApprove}
              className="w-full sm:w-auto bg-primary hover:bg-primary"
              disabled={submitting || !batchNo.trim()}
            >
              {submitting ? "Processing..." : "Save & Approve"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Loading Overlay */}
      {loading && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg p-6 flex flex-col items-center">
            <RefreshCw className="h-8 w-8 text-blue-600 animate-spin mb-3" />
            <p className="text-gray-700">Loading quality control data...</p>
          </div>
        </div>
      )}
    </div>
  );
}
