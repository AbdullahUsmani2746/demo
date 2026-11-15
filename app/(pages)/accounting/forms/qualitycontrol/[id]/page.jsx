"use client";

import { useState, useEffect, useMemo, useCallback } from "react";
import { useSession } from "next-auth/react";
import { useParams, useRouter, useSearchParams } from "next/navigation";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  CardFooter,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { RefreshCcw } from "lucide-react";
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
  AlertCircle,
  BarChart3,
  Tag,
  ChevronRight,
  User,
} from "lucide-react";
import { format } from "date-fns";
import { toast } from "sonner";
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
      icon: <RefreshCcw className="h-3 w-3" />,
      label: "Rework",
    },
    HOLD: {
      bg: "bg-blue-50",
      text: "text-blue-800",
      border: "border-blue-200",
      icon: <RefreshCw className="h-3 w-3" />,
      label: "Hold",
    },
  };

  const config = statusConfig[status] || statusConfig.draft;

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
    className={`p-4 rounded-lg border ${active ? "bg-blue-50 border-blue-200" : "bg-gray-50 border-gray-200"
      }`}
  >
    <div className="flex items-center gap-3">
      <div
        className={`h-8 w-8 rounded-full flex items-center justify-center text-sm font-semibold ${active ? "bg-blue-100 text-blue-600" : "bg-gray-100 text-gray-600"
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

export default function QualityControlForm() {
  const { company } = useCompany();
  const params = useParams();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { data: session } = useSession();
  const procId = params?.id;
  const isViewOnly = searchParams.get("mode") === "view";

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [originalDates, setOriginalDates] = useState({ mfgDate: "", expiryDate: "" });

  const [masterData, setMasterData] = useState({
    qcId: "",
    qcBarcode: "",
    procOrderNo: "",
    itcd: "",
    itemName: "",
    batchNo: "",
    batchSize: "",
    mfgDate: "",
    expiryDate: "",
    status: "DRAFT",
    departmentName: "",
    approvedBy: "",
    customer_name: "",
  });

  const [parameters, setParameters] = useState([]);
  const [workflowStep, setWorkflowStep] = useState(1);

  // Modal states
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [detailsModalOpen, setDetailsModalOpen] = useState(false);
  const [pendingStatusChange, setPendingStatusChange] = useState(null);
  const [rejectReason, setRejectReason] = useState("");


  // Yeh function parameters ko sort karega
  const sortParametersByPriority = (params) => {
    const priorityOrder = ['VISCOSITY', 'SOLID', 'ADHESION', 'ΔE'];

    return [...params].sort((a, b) => {
      const indexA = priorityOrder.indexOf(a.name);
      const indexB = priorityOrder.indexOf(b.name);

      if (indexA !== -1 && indexB !== -1) {
        return indexA - indexB;
      }
      if (indexA !== -1) return -1;
      if (indexB !== -1) return 1;
      return 0;
    });
  };

  const attempt3Enabled = useMemo(
    () => {
      const status = masterData.status?.toUpperCase();
      return !isViewOnly && (status === "REWORK" || status === "APPROVED");
    },
    [masterData.status, isViewOnly],
  );

  const attempt2Enabled = useMemo(
    () => {
      const status = masterData.status?.toUpperCase();
      return !isViewOnly && (status === "REWORK" || status === "APPROVED");
    },
    [masterData.status, isViewOnly],
  );
  const attempt1Enabled = useMemo(
    () => {
      const status = masterData.status?.toUpperCase();
      return !isViewOnly && (status === "DRAFT" || status === "REWORK" || status === "APPROVED");
    },
    [masterData.status, isViewOnly],
  );

  const tableRejectReason = useMemo(() => {
    if (!parameters.length) return null;
    const attempt3Reason = parameters[0]?.attempt3?.rejectReason?.trim();
    const attempt2Reason = parameters[0]?.attempt2?.rejectReason?.trim();
    const attempt1Reason = parameters[0]?.attempt1?.rejectReason?.trim();
    return attempt3Reason || attempt2Reason || attempt1Reason || null;
  }, [parameters]);

  useEffect(() => {
    const status = masterData.status?.toUpperCase();
    if ((status === "REWORK" || status === "HOLD") && !rejectModalOpen) {
      setPendingStatusChange(status);
      setRejectModalOpen(true);
    }
  }, [masterData.status]);

  const getStatusOptions = () => {
    return [
      { value: "DRAFT", label: "Draft" },
      { value: "HOLD", label: "Hold" },
      { value: "REWORK", label: "Rework" },
      { value: "APPROVED", label: "Approve" },
      { value: "REJECTED", label: "Reject" },
    ];
  };

  const fetchQC = async (silent = false) => {
    // If called from onClick, silent might be an event object. 
    // We only want it to be silent if it's explicitly boolean true.
    const isSilent = silent === true;
    if (!isSilent) setLoading(true);
    try {
      const res = await fetch(`/api/forms/qualitycontrol/${procId}`, {
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`GET failed ${res.status}`);
      const data = await res.json();

      const fetchedMfgDate = data.master.mfg_date
        ? new Date(data.master.mfg_date).toISOString().split("T")[0]
        : "";
      const fetchedExpiryDate = data.master.expiry_date
        ? new Date(data.master.expiry_date).toISOString().split("T")[0]
        : "";

      setMasterData({
        qcId: String(data.master.qc_id ?? ""),
        qcBarcode: data.master.qc_barcode ?? "",
        procOrderNo: String(data.master.proc_ord_no ?? ""),
        itcd: String(data.master.itcd ?? ""),
        inkCode: String(data.master.inkCode ?? ""),
        batchNo: data.master.batch_no ?? "",
        itemName: data.master.item_name ?? "",
        batchSize: String(data.master.batch_size ?? ""),
        mfgDate: fetchedMfgDate,
        expiryDate: fetchedExpiryDate,
        status: data.master.status ?? "DRAFT",
        departmentName: data.master.department_name ?? "Unknown",
        approvedBy: data.master.approved_by ?? "",
        customer_name: data.master.customer_name ?? "",
      });
      setOriginalDates({ mfgDate: fetchedMfgDate, expiryDate: fetchedExpiryDate });

      const a1 = data.attempts?.find((a) => a.attempt_no === 1) || {
        attempt_date: "",
        rows: [],
        reject_reason: null,
      };
      const a2 = data.attempts?.find((a) => a.attempt_no === 2) || {
        attempt_date: "",
        rows: [],
        reject_reason: null,
      };
      const a3 = data.attempts?.find((a) => a.attempt_no === 3) || {
        attempt_date: "",
        rows: [],
        reject_reason: null,
      };

      const a1Map = new Map(
        a1.rows.map((r) => [r.parameter_name, r.quality_realized ?? ""]),
      );
      const a2Map = new Map(
        a2.rows.map((r) => [r.parameter_name, r.quality_realized ?? ""]),
      );
      const a3Map = new Map(
        a3.rows.map((r) => [r.parameter_name, r.quality_realized ?? ""]),
      );

      // const mapped = (data.parameters || []).map((p) => ({
      //   name: p.parameter_name,
      //   standard: p.quality_standard,
      //   attempt1: {
      //     attemptNo: 1,
      //     attemptDate:
      //       a1.attempt_date || new Date().toISOString().split("T")[0],
      //     qualityRealized: a1Map.get(p.parameter_name) ?? "",
      //     rejectReason: a1.reject_reason || null,
      //   },
      //   attempt2: {
      //     attemptNo: 2,
      //     attemptDate:
      //       a2.attempt_date || new Date().toISOString().split("T")[0],
      //     qualityRealized: a2Map.get(p.parameter_name) ?? "",
      //     rejectReason: a2.reject_reason || null,
      //   },
      // }));
      // setParameters(mapped);

      const mapped = (data.parameters || []).map((p) => ({
        name: p.parameter_name,
        standard: p.quality_standard,
        attempt1: {
          attemptNo: 1,
          attemptDate: a1.attempt_date || new Date().toISOString().split("T")[0],
          qualityRealized: a1Map.get(p.parameter_name) ?? "",
          rejectReason: a1.reject_reason || null,
        },
        attempt2: {
          attemptNo: 2,
          attemptDate: a2.attempt_date || new Date().toISOString().split("T")[0],
          qualityRealized: a2Map.get(p.parameter_name) ?? "",
          rejectReason: a2.reject_reason || null,
        },
        attempt3: {
          attemptNo: 3,
          attemptDate: a3.attempt_date || new Date().toISOString().split("T")[0],
          qualityRealized: a3Map.get(p.parameter_name) ?? "",
          rejectReason: a3.reject_reason || null,
        },
      }));

      // Neeche yeh line add karo - Sorting yahan hogi
      const sortedParameters = sortParametersByPriority(mapped);
      setParameters(sortedParameters);  // <-- Changed line

      // Set workflow step based on status
      let step = 1;
      if (masterData.status === "DRAFT" && mapped.length > 0) step = 2;
      if (masterData.status === "REWORK") step = 3;
      if (masterData.status === "APPROVED") step = 4;
      if (masterData.status === "REJECTED") step = 1; // Can retry
      setWorkflowStep(step);
    } catch (e) {
      toast.error("Failed to load quality control data");
      console.error("Fetch error:", e);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (procId) fetchQC();
  }, [procId]);

  const handleAttempt1Change = (paramIndex, value) => {
    if (!attempt1Enabled) return;
    const newParams = [...parameters];
    newParams[paramIndex].attempt1.qualityRealized = value;
    setParameters(newParams);
  };

  const handleAttempt2Change = (paramIndex, value) => {
    if (!attempt2Enabled) return;
    const newParams = [...parameters];
    newParams[paramIndex].attempt2.qualityRealized = value;
    setParameters(newParams);
  };

  const handleAttempt3Change = (paramIndex, value) => {
    if (!attempt3Enabled) return;
    const newParams = [...parameters];
    newParams[paramIndex].attempt3.qualityRealized = value;
    setParameters(newParams);
  };

  const handleStatusChange = async (value) => {
    // Only validate if parameters exist
    if (parameters.length > 0) {
      // If moving away from DRAFT, enforce Attempt-1 has data
      if (masterData.status === "DRAFT" && value !== "DRAFT") {
        const allAttempt1Empty = parameters.every(
          (p) =>
            !p.attempt1.qualityRealized ||
            p.attempt1.qualityRealized.trim() === "",
        );
        if (allAttempt1Empty) {
          toast.error(
            "Enter at least one Attempt 1 value before changing status.",
          );
          return;
        }
      }

      // Block REWORK or HOLD → APPROVED if attempt 2 values are all empty
      if (
        (masterData.status === "REWORK" || masterData.status === "HOLD") &&
        value === "APPROVED"
      ) {
        const allAttempt2Empty = parameters.every(
          (p) =>
            !p.attempt2.qualityRealized ||
            p.attempt2.qualityRealized.trim() === "",
        );
        if (allAttempt2Empty) {
          toast.error("Enter at least one Attempt 2 value before approving.");
          return;
        }
      }
    }

    if (value === "HOLD") {
      setPendingStatusChange(value);
      setRejectModalOpen(true);
      setRejectReason("");
      return;
    }

    if (value === "REWORK") {
      setPendingStatusChange(value);
      setRejectModalOpen(true);
      setRejectReason("");
      return;
    }

    // If status is REJECTED, open modal to get reject reason
    if (value === "REJECTED") {
      setPendingStatusChange(value);
      setRejectModalOpen(true);
      setRejectReason("");
      return;
    }

    // For other statuses, update directly
    await performStatusUpdate(value, null);
  };

  const performStatusUpdate = async (value, rejectReasonValue) => {
    setSubmitting(true);
    try {
      const body = {
        status: value,
        mfg_date: masterData.mfgDate,
        expiry_date: masterData.expiryDate
      };
      if (rejectReasonValue) {
        body.reject_reason = rejectReasonValue;
      }

      const res = await fetch(`/api/forms/qualitycontrol/${procId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (!res.ok) {
        toast.error(data?.error || "Status update failed");
        return;
      }

      // Show success message with batch number if approved
      if (value === "APPROVED") {
        if (data.batch_no) {
          toast.success(`✅ Batch approved! Batch number: ${data.batch_no}`);
        } else {
          toast.success("✅ Batch approved!");
        }
      } else {
        toast.success(`✅ Status updated to ${value}`);
      }

      // Refresh the data to show updated batch number
      await fetchQC();

      // Update workflow step
      let step = 1;
      if (value === "DRAFT") step = 2;
      if (value === "REWORK") step = 3;
      if (value === "APPROVED") step = 4;
      if (value === "REJECTED") step = 1;
      setWorkflowStep(step);
    } catch (e) {
      console.error("Status update error:", e);
      toast.error("Server error while updating status");
    } finally {
      setSubmitting(false);
      setRejectModalOpen(false);
      setPendingStatusChange(null);
      setRejectReason("");
    }
  };

  const handleRejectReasonSubmit = async () => {
    if (!rejectReason || rejectReason.trim() === "") {
      toast.error("Reject reason cannot be empty");
      return;
    }

    await performStatusUpdate(pendingStatusChange, rejectReason.trim());
  };

  const handleSave = async (isAuto = false) => {
    if (!isAuto) setSaving(true);
    try {
      // Validate Attempt-1 when status is DRAFT (Only for manual saves)
      const allAttempt1Empty = parameters.every(
        (p) =>
          !p.attempt1.qualityRealized ||
          p.attempt1.qualityRealized.trim() === "",
      );

      if (!isAuto && masterData.status === "DRAFT" && allAttempt1Empty) {
        toast.error("Attempt 1 values cannot all be empty.");
        setSaving(false);
        return;
      }

      // Validate Attempt-2 when status is REWORK (Only for manual saves)
      const allAttempt2Empty = parameters.every(
        (p) =>
          !p.attempt2.qualityRealized ||
          p.attempt2.qualityRealized.trim() === "",
      );

      if (!isAuto && masterData.status === "REWORK" && allAttempt2Empty) {
        toast.error("Attempt 2 values cannot all be empty.");
        setSaving(false);
        return;
      }

      // decide which attempt is being saved
      const isAttempt2 = masterData.status === "REWORK";

      const sending = parameters.map((p) => ({
        parameter_name: p.name,
        quality_realized: isAttempt2
          ? p.attempt2.qualityRealized
          : p.attempt1.qualityRealized,
      }));

      const res = await fetch(`/api/forms/qualitycontrol/${procId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          parameters: sending,
          mfg_date: masterData.mfgDate,
          expiry_date: masterData.expiryDate
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        if (!isAuto) toast.error(data?.error || "Save failed");
        return;
      }

      if (!isAuto) await fetchQC(true); // Only fetch for manual saves to avoid state revert race conditions

      if (!isAuto) {
        toast.success(
          data?.status
            ? `Saved (Attempt ${data.attempt_no}). Status: ${data.status}`
            : "Saved successfully",
        );
      }
    } catch (e) {
      if (!isAuto) toast.error("Server error while saving");
    } finally {
      if (!isAuto) setSaving(false);
    }
  };

  // Debounced Auto-Save
  useEffect(() => {
    const editableStatus = ["DRAFT", "REWORK", "APPROVED"].includes(masterData.status?.toUpperCase());

    if (!loading && !isViewOnly && editableStatus && parameters.length > 0) {
      const timer = setTimeout(() => {
        handleSave(true);
      }, 2000);

      return () => clearTimeout(timer);
    }
  }, [parameters, masterData.mfgDate, masterData.expiryDate]);

  const handleUpdateBatchInfo = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/forms/qualitycontrol/${procId}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mfg_date: masterData.mfgDate,
          expiry_date: masterData.expiryDate,
        }),
      });

      const data = await res.json();
      if (!res.ok) {
        toast.error(data?.error || "Update failed");
        return;
      }

      toast.success("Batch information updated successfully");
      await fetchQC();
    } catch (e) {
      toast.error("Server error while updating batch info");
    } finally {
      setSaving(false);
    }
  };

  const handleDownloadPDF = () => {
    // Check if rejected status
    if (masterData.status === "REJECTED") {
      // Generate NCR (Non-Conformity Report) for rejected batch
      generateNCRCertificate({
        companyName: company?.name || "Company",
        logoUrl: company?.logo || "",
        ncrTitle: "NON CONFIRMITY REQUEST FORM",
        batchNumber: masterData.batchNo,
        inkCode: masterData.code + " " + masterData.itemName,
        manufacturingDate: masterData.mfgDate,
        batchSize: masterData.batchSize,
        departmentName: masterData.departmentName,
        testResults: parameters.map((p) => ({
          parameter: p.name,
          standard: p.standard,
          result: p.attempt3?.qualityRealized || p.attempt2?.qualityRealized || p.attempt1?.qualityRealized,
        })),
        rejectReason: tableRejectReason || "Quality parameters not met",
        rootCause: "", // User will fill manually
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
      });
    } else {
      // Generate regular QC Certificate for approved batch
      generateQCCertificate({
        companyName: company?.name || "Company",
        logoUrl: company?.logo || "",
        title: "QUALITY ASSURANCE CERTIFICATE",
        manufacturingDate: masterData.mfgDate,
        expiryDate: masterData.expiryDate,
        batchNumber: masterData.batchNo,
        inkCode: masterData.inkCode + " " + masterData.itemName,
        customer: "-",
        batchSize: masterData.batchSize,
        status: masterData.status,
        approvedBy: masterData.approvedBy || session?.user?.name || "Quality Manager",
        comments: "",
        departmentName: masterData.departmentName,
        testResults: parameters.map((p) => ({
          parameter: p.name,
          standard: p.standard,
          result: p.attempt3?.qualityRealized || p.attempt2?.qualityRealized || p.attempt1?.qualityRealized,
        })),
      });
    }
  };

  return (
    <div className="min-h-screen bg-secondary p-4 md:p-6">
      {/* Header */}
      <div className="mb-6">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center gap-2">
              <TestTube className="h-7 w-7 text-primary" />
              Quality Control Form
            </h1>
            <p className="text-black mt-1">
              Process Order #{procId} • Quality Testing Management
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
        <div className="mb-1">
          <h3 className="text-sm font-semibold text-black mb-3">
            Quality Control Workflow
          </h3>
        </div>

        {/* Info Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <InfoCard
            icon={Hash}
            title="Process Order"
            value={masterData.procOrderNo}
          />
          <InfoCard
            icon={Tag}
            title="QC Barcode"
            value={masterData.qcBarcode}
          />
          <InfoCard icon={Box} title="MM No" value={`${masterData.itcd}`} />
          <InfoCard
            icon={Package}
            title="Batch Number"
            value={masterData.batchNo}
          />
          <InfoCard
            icon={Calendar}
            title="QC Date"
            value={
              masterData.mfgDate
                ? format(new Date(masterData.mfgDate), "dd MMM yyyy")
                : "-"
            }
          />
          <InfoCard
            icon={Scale}
            title="Batch Size"
            value={masterData.batchSize}
          />
          {masterData.status === "APPROVED" && masterData.approvedBy && (
            <InfoCard
              icon={CheckCircle2}
              title="Approved By"
              value={masterData.approvedBy}
            />
          )}
          <InfoCard
            icon={User}
            title="Customer"
            value={masterData.customer_name || "-"}
          />
        </div>

        <div className="grid grid-cols-1 md:grid-cols-6 gap-3">
          {/* Quick Actions */}
          <Card className="border-blue-200 bg-white md:col-span-2 h-full">
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-primary flex items-center gap-2">
                <Zap className="h-4 w-4" />
                Quick Actions
              </CardTitle>
              <CardDescription className="text-black">
                Generate certificates and manage quality control
              </CardDescription>
            </CardHeader>

            <CardContent>
              <div className="space-y-3">
                <Button
                  onClick={handleDownloadPDF}
                  disabled={!masterData.batchNo}
                  className="w-full bg-primary hover:bg-primary text-white"
                >
                  <Download className="h-4 w-4 mr-2" />
                  Download Certificate
                </Button>

                <Button
                  onClick={fetchQC}
                  disabled={loading}
                  variant="outline"
                  className="w-full"
                >
                  <RefreshCw
                    className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""}`}
                  />
                  Refresh Data
                </Button>
              </div>
            </CardContent>
          </Card>

          {/* Item Details */}
          <Card className="md:col-span-2 h-full">
            <CardHeader className="pb-2">
              <CardTitle className="text-sm font-semibold text-gray-700 flex items-center gap-2">
                <Box className="h-4 w-4" />
                MM Details
              </CardTitle>
            </CardHeader>

            <CardContent className="space-y-3">
              {/* ITCD + Status in one row */}
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-0.5">
                    MM No
                  </label>
                  <Input
                    value={masterData.itcd}
                    className="h-8 bg-gray-50 text-sm"
                    readOnly
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-gray-700 mb-0.5">
                    Status
                  </label>
                  <Select
                    value={masterData.status}
                    onValueChange={handleStatusChange}
                    disabled={submitting || isViewOnly}
                  >
                    <SelectTrigger className="h-8 text-sm">
                      <SelectValue placeholder="Select status" />
                    </SelectTrigger>
                    <SelectContent>
                      {getStatusOptions().map((option) => (
                        <SelectItem key={option.value} value={option.value}>
                          {option.label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              {/* Item Name full row */}
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-0.5">
                  MM Name
                </label>
                <Input
                  value={masterData.itemName}
                  className="h-8 bg-gray-50 text-sm"
                  readOnly
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-gray-700 mb-0.5">
                  Ink Code
                </label>
                <Input
                  value={masterData.item_code || masterData.inkCode || ""}
                  className="h-8 bg-gray-50 text-sm"
                  readOnly
                />
              </div>
            </CardContent>
          </Card>
          {/* Approved Status Display */}
          {masterData.status === "APPROVED" && (
            <Card className="border-emerald-200 bg-emerald-50 md:col-span-2 h-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-emerald-800 flex items-center gap-2">
                  <CheckCircle2 className="h-4 w-4" />
                  Batch Approved
                </CardTitle>
                <CardDescription className="text-emerald-700 text-xs">
                  Quality certificate is ready to generate
                </CardDescription>
              </CardHeader>

              <CardContent>
                <div className="bg-white border border-emerald-200 rounded-lg p-3 h-full flex flex-col justify-between">
                  <div>
                    <p className="font-semibold text-emerald-800">
                      Quality Certificate Ready
                    </p>
                    <p className="text-xs text-emerald-700 mt-1">
                      Download the quality assurance certificate for this batch.
                    </p>
                  </div>

                  <Button
                    onClick={handleDownloadPDF}
                    disabled={!masterData.batchNo}
                    className="bg-primary hover:bg-primary mt-3 self-end"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
          {masterData.status === "REJECTED" && (
            <Card className="border-red-200 bg-red-50 md:col-span-2 h-full">
              <CardHeader className="pb-2">
                <CardTitle className="text-sm font-semibold text-red-800 flex items-center gap-2">
                  <XCircle className="h-4 w-4" />
                  Batch Rejected
                </CardTitle>
                <CardDescription className="text-red-700 text-xs">
                  Quality certificate is ready to generate
                </CardDescription>
              </CardHeader>

              <CardContent>
                <div className="bg-white border border-red-200 rounded-lg p-3 h-full flex flex-col justify-between">
                  <div>
                    <p className="font-semibold text-red-800">
                      Rejection Certificate Ready
                    </p>
                    <p className="text-xs text-red-700 mt-1">
                      Download the quality rejection certificate for this batch.
                    </p>
                  </div>

                  <Button
                    onClick={handleDownloadPDF}
                    disabled={!masterData.batchNo}
                    className="bg-primary hover:bg-primary mt-3 self-end"
                  >
                    <Download className="h-4 w-4 mr-2" />
                    Download
                  </Button>
                </div>
              </CardContent>
            </Card>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-4 gap-6">
        {/* Left Panel - Item Details */}
        <div className="lg:col-span-1 space-y-6">
          {/* Item Details Card */}

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
                  Batch Number
                </label>
                <Input
                  value={masterData.batchNo}
                  className="w-full bg-gray-50"
                  readOnly
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
                    const newMfgDate = e.target.value;
                    let newExpiryDate = masterData.expiryDate;
                    if (newMfgDate) {
                      const d = new Date(newMfgDate);
                      d.setFullYear(d.getFullYear() + 1);
                      d.setDate(d.getDate() - 2);
                      newExpiryDate = d.toISOString().split("T")[0];
                    }
                    setMasterData({ ...masterData, mfgDate: newMfgDate, expiryDate: newExpiryDate });
                  }}
                  className="w-full bg-gray-50"
                  disabled={isViewOnly}
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Expiry Date
                </label>
                <Input
                  type="date"
                  value={masterData.expiryDate}
                  onChange={(e) => setMasterData({ ...masterData, expiryDate: e.target.value })}
                  className="w-full bg-gray-50"
                  readOnly
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-gray-700 mb-1">
                  Batch Size
                </label>
                <Input
                  value={masterData.batchSize}
                  className="w-full bg-gray-50"
                  readOnly
                />
              </div>
              <Button
                onClick={handleUpdateBatchInfo}
                disabled={isViewOnly || saving || (masterData.mfgDate === originalDates.mfgDate && masterData.expiryDate === originalDates.expiryDate)}
                className="w-full mt-2 bg-primary hover:bg-primary text-white"
                variant="outline"
              >
                {saving ? "Updating..." : "Update"}
              </Button>
            </CardContent>
          </Card>
        </div>

        {/* Right Panel - Main Content */}
        <div className="lg:col-span-3 space-y-6">
          {/* Quality Parameters Section */}
          <Card>
            <CardHeader>
              <CardTitle className="text-sm font-semibold text-gray-700">
                Quality Parameters Testing
              </CardTitle>
              <CardDescription>
                {parameters.length} parameters to test • Current status:{" "}
                {masterData.status}
              </CardDescription>
            </CardHeader>
            <CardContent>
              {tableRejectReason && (
                <div className="mb-4 p-3 bg-red-50 border border-red-200 rounded-lg">
                  <div className="flex items-start gap-2">
                    <AlertTriangle className="h-4 w-4 text-red-600 mt-0.5 flex-shrink-0" />
                    <div>
                      <p className="text-sm font-medium text-red-800">
                        {masterData.status === "REWORK"
                          ? "Hold Reason:"
                          : "Rejection Reason:"}
                      </p>
                      <p className="text-xs text-red-700 mt-1">
                        {tableRejectReason}
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Attempts Info */}
              <div className="flex items-center justify-between mb-4 p-3 bg-gray-50 rounded-lg">
                <div className="flex items-center gap-4">
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-blue-100 text-primary flex items-center justify-center text-xs font-semibold">
                      1
                    </div>
                    <span className="text-sm font-medium text-gray-700">
                      Attempt 1
                    </span>
                    <span className="text-xs text-gray-500">
                      {parameters[0]?.attempt1.attemptDate || "-"}
                    </span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-400" />
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-blue-100 text-primary flex items-center justify-center text-xs font-semibold">
                      2
                    </div>
                    <span className="text-sm font-medium text-gray-700">
                      Attempt 2
                    </span>
                    <span className="text-xs text-gray-500">
                      {parameters[0]?.attempt2.attemptDate || "-"}
                    </span>
                  </div>
                  <ChevronRight className="h-4 w-4 text-gray-400" />
                  <div className="flex items-center gap-2">
                    <div className="h-6 w-6 rounded-full bg-blue-100 text-primary flex items-center justify-center text-xs font-semibold">
                      3
                    </div>
                    <span className="text-sm font-medium text-gray-700">
                      Attempt 3
                    </span>
                    <span className="text-xs text-gray-500">
                      {parameters[0]?.attempt3.attemptDate || "-"}
                    </span>
                  </div>
                </div>
                <div className="text-xs text-gray-500">
                  {masterData.status === "DRAFT"
                    ? "Editing Attempt 1"
                    : masterData.status === "REWORK"
                      ? "Editing Attempt 2"
                      : "View Only"}
                </div>
              </div>

              {/* Parameters Table */}
              <div className="border rounded-lg overflow-hidden">
                <table className="w-full">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase border-r">
                        Parameter Name
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase border-r">
                        Quality Standard
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase border-r">
                        Attempt 1 Value
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase border-r">
                        Attempt 2 Value
                      </th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 uppercase">
                        Attempt 3 Value
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-200">
                    {parameters.map((param, index) => (
                      <tr key={param.name} className="hover:bg-gray-50">
                        <td className="px-4 py-3 border-r">
                          <div className="font-medium text-gray-900">
                            {param.name}
                          </div>
                        </td>
                        <td className="px-4 py-3 border-r">
                          <div className="text-gray-600">{param.standard}</div>
                        </td>
                        <td className="px-4 py-3 border-r">
                          <Input
                            value={param.attempt1.qualityRealized ?? ""}
                            onChange={(e) =>
                              handleAttempt1Change(index, e.target.value)
                            }
                            className={`w-full ${!attempt1Enabled
                              ? "bg-gray-100 cursor-not-allowed"
                              : ""
                              }`}
                            placeholder="Enter value"
                            disabled={!attempt1Enabled}
                          />
                        </td>
                        <td className="px-4 py-3 border-r">
                          <Input
                            value={param.attempt2.qualityRealized ?? ""}
                            onChange={(e) =>
                              handleAttempt2Change(index, e.target.value)
                            }
                            className={`w-full ${!attempt2Enabled
                              ? "bg-gray-100 cursor-not-allowed"
                              : ""
                              }`}
                            placeholder="Enter value"
                            disabled={!attempt2Enabled}
                          />
                        </td>
                        <td className="px-4 py-3">
                          <Input
                            value={param.attempt3.qualityRealized ?? ""}
                            onChange={(e) =>
                              handleAttempt3Change(index, e.target.value)
                            }
                            className={`w-full ${!attempt3Enabled
                              ? "bg-gray-100 cursor-not-allowed"
                              : ""
                              }`}
                            placeholder="Enter value"
                            disabled={!attempt3Enabled}
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
            <CardFooter className="border-t bg-gray-50">
              <div className="flex justify-between w-full items-center">
                <div className="text-sm text-gray-600">
                  {parameters.length} parameters • Status: {masterData.status}
                </div>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    onClick={fetchQC}
                    disabled={loading}
                    className='mt-2'
                  >
                    <RefreshCw
                      className={`h-4 w-4 mr-2 ${loading ? "animate-spin" : ""
                        }`}
                    />
                    Refresh
                  </Button>
                  <Button
                    onClick={handleSave}
                    disabled={
                      isViewOnly ||
                      saving ||
                      loading ||
                      (masterData.status?.toUpperCase() !== "DRAFT" &&
                        masterData.status?.toUpperCase() !== "REWORK" &&
                        masterData.status?.toUpperCase() !== "APPROVED")
                    }
                    className="bg-primary hover:bg-primary mt-2"
                  >
                    <Save className="h-4 w-4 mr-2" />
                    {saving ? "Saving..." : "Save Changes"}
                  </Button>
                </div>
              </div>
            </CardFooter>
          </Card>

          {/* Status Actions */}
          {masterData.status === "DRAFT" && parameters.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-gray-700">
                  Complete Quality Check
                </CardTitle>
                <CardDescription>
                  Based on test results, decide on the next step for this batch.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-4 bg-emerald-50 border border-emerald-200 rounded-lg">
                    <div className="flex items-center gap-2 mb-3">
                      <CheckCircle2 className="h-5 w-5 text-emerald-600" />
                      <span className="text-sm font-semibold text-emerald-800">
                        Approve
                      </span>
                    </div>
                    <p className="text-xs text-emerald-700 mb-3">
                      Approve the batch if all quality parameters meet
                      standards.
                    </p>
                    <Button
                      onClick={() => handleStatusChange("APPROVED")}
                      className="w-full bg-emerald-600 hover:bg-emerald-700 text-white text-xs"
                      disabled={submitting}
                    >
                      Approve Batch
                    </Button>
                  </div>

                  <div className="p-4 bg-blue-50 border border-blue-200 rounded-lg">
                    <div className="flex items-center gap-2 mb-3">
                      <RefreshCw className="h-5 w-5 text-blue-600" />
                      <span className="text-sm font-semibold text-blue-800">
                        Send for Hold
                      </span>
                    </div>
                    <p className="text-xs text-blue-700 mb-3">
                      Send batch for Hold if parameters need adjustment.
                    </p>
                    <Button
                      onClick={() => handleStatusChange("HOLD")}
                      className="w-full bg-blue-600 hover:bg-blue-700 text-white text-xs"
                      disabled={submitting}
                    >
                      Mark for Hold
                    </Button>
                  </div>

                  <div className="p-4 bg-red-50 border border-red-200 rounded-lg">
                    <div className="flex items-center gap-2 mb-3">
                      <XCircle className="h-5 w-5 text-red-600" />
                      <span className="text-sm font-semibold text-red-800">
                        Reject
                      </span>
                    </div>
                    <p className="text-xs text-red-700 mb-3">
                      Reject the batch if quality standards are not met.
                    </p>
                    <Button
                      onClick={() => handleStatusChange("REJECTED")}
                      className="w-full bg-red-600 hover:bg-red-700 text-white text-xs"
                      disabled={submitting}
                    >
                      Reject Batch
                    </Button>
                  </div>

                  <div className="p-4 bg-orange-50 border border-orange-200 rounded-lg shadow-sm">
                    <div className="flex items-center gap-2 mb-3">
                      <RefreshCcw className="h-5 w-5 text-orange-600" />
                      <span className="text-sm font-semibold text-orange-800">
                        Rework
                      </span>
                    </div>
                    <p className="text-xs text-orange-700 mb-3">
                      Send the batch for rework to correct quality issues before
                      resubmission for approval.
                    </p>
                    <Button
                      onClick={() => handleStatusChange("REWORK")}
                      className="w-full bg-orange-600 hover:bg-orange-700 text-white text-xs"
                      disabled={submitting}
                    >
                      Send for Rework
                    </Button>
                  </div>

                </div>
              </CardContent>
            </Card>
          )}

          {/* Rejected Status Display */}
          {masterData.status === "REJECTED" && (
            <Card className="border-red-200 bg-red-50">
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-red-800 flex items-center gap-2">
                  <XCircle className="h-4 w-4" />
                  Batch Rejected
                </CardTitle>
              </CardHeader>
              <CardContent>
                <div className="bg-white border border-red-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <AlertTriangle className="h-5 w-5 text-red-600 mt-0.5" />
                    <div>
                      <p className="font-semibold text-red-800 mb-1">
                        {masterData.status === "REWORK"
                          ? "Hold Reason"
                          : "Rejection Reason"}
                      </p>
                      <p className="text-sm text-gray-700">
                        {tableRejectReason || "No reason provided"}
                      </p>
                      <div className="mt-4 p-3 bg-primary rounded">
                        <p className="text-sm font-medium text-white mb-2">
                          Next Steps
                        </p>
                        <p className="text-xs text-white mb-3">
                          To restart quality control, change status back to
                          DRAFT.
                        </p>
                        <Button
                          onClick={() => handleStatusChange("DRAFT")}
                          size="sm"
                          className="bg-white text-primary"
                          disabled={submitting}
                        >
                          <RefreshCw className="h-4 w-4 mr-2" />
                          Restart Quality Check
                        </Button>
                      </div>
                    </div>
                  </div>
                </div>
              </CardContent>
            </Card>
          )}

          {/* Rework Status Display */}
          {masterData.status === "REWORK" && (
            <Card className="border-blue-200 bg-blue-50">
              <CardHeader>
                <CardTitle className="text-sm font-semibold text-blue-800 flex items-center gap-2">
                  <RefreshCw className="h-4 w-4" />
                  Batch Sent for Hold
                </CardTitle>
                <CardDescription className="text-blue-700">
                  This batch is currently on hold. Enter Attempt 2 test results.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <div className="bg-white border border-blue-200 rounded-lg p-4">
                  <div className="flex items-start gap-3">
                    <Info className="h-5 w-5 text-blue-600 mt-0.5" />
                    <div>
                      <p className="font-semibold text-blue-800 mb-1">
                        Hold Instructions
                      </p>
                      <p className="text-sm text-gray-700 mb-3">
                        Enter the quality values after hold in the Attempt 2
                        column. After saving, you can approve or reject the
                        batch based on hold results.
                      </p>
                      <div className="flex gap-3">
                        <Button
                          onClick={() => handleStatusChange("APPROVED")}
                          className="bg-emerald-600 hover:bg-emerald-700"
                          disabled={submitting}
                        >
                          <CheckCircle2 className="h-4 w-4 mr-2" />
                          Approve After Hold
                        </Button>
                        <Button
                          onClick={() => handleStatusChange("REJECTED")}
                          variant="outline"
                          className="border-red-300 text-red-700"
                          disabled={submitting}
                        >
                          <XCircle className="h-4 w-4 mr-2" />
                          Reject After Hold
                        </Button>
                      </div>
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
            <DialogTitle className={`flex items-center gap-2 ${pendingStatusChange === "REWORK"
                ? "text-orange-700"
                : pendingStatusChange === "HOLD"
                  ? "text-blue-700"
                  : "text-red-700"
              }`}>
              {pendingStatusChange === "REWORK" ? (
                <RefreshCcw className="h-5 w-5" />
              ) : pendingStatusChange === "HOLD" ? (
                <RefreshCw className="h-5 w-5" />
              ) : (
                <XCircle className="h-5 w-5" />
              )}
              {pendingStatusChange === "REWORK"
                ? "Rework Batch"
                : pendingStatusChange === "HOLD"
                  ? "Hold Batch"
                  : "Reject Batch"}
            </DialogTitle>

            <DialogDescription>
              {pendingStatusChange === "REWORK"
                ? "Please provide a reason for reworking this batch."
                : pendingStatusChange === "HOLD"
                  ? "Please provide a reason for holding this batch."
                  : "Please provide a reason for rejecting this batch. This will be recorded in the quality control history."}
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                {pendingStatusChange === "REWORK"
                  ? "Rework Reason *"
                  : pendingStatusChange === "HOLD"
                    ? "Hold Reason *"
                    : "Rejection Reason *"}
              </label>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Enter detailed reason..."
                className="min-h-[120px]"
              />
              <p className="text-xs text-gray-500 mt-2">
                Required for audit purposes. Minimum 10 characters.
              </p>
            </div>
            <div className={`border rounded-lg p-3 ${pendingStatusChange === "REWORK"
                ? "bg-orange-50 border-orange-200"
                : pendingStatusChange === "HOLD"
                  ? "bg-blue-50 border-blue-200"
                  : "bg-red-50 border-red-200"
              }`}>
              <div className="flex items-start gap-2">
                <AlertTriangle className={`h-4 w-4 mt-0.5 flex-shrink-0 ${pendingStatusChange === "REWORK"
                    ? "text-orange-600"
                    : pendingStatusChange === "HOLD"
                      ? "text-blue-600"
                      : "text-red-600"
                  }`} />
                <div>
                  <p className={`text-sm font-medium ${pendingStatusChange === "REWORK"
                      ? "text-orange-800"
                      : pendingStatusChange === "HOLD"
                        ? "text-blue-800"
                        : "text-red-800"
                    }`}>Important:</p>

                  <p className={`text-xs mt-1 ${pendingStatusChange === "REWORK"
                      ? "text-orange-700"
                      : pendingStatusChange === "HOLD"
                        ? "text-blue-700"
                        : "text-red-700"
                    }`}>
                    {pendingStatusChange === "REWORK"
                      ? "This batch will be sent for rework."
                      : pendingStatusChange === "HOLD"
                        ? "This batch will be placed on hold for Attempt 2 testing."
                        : "Rejecting this batch will stop the quality control process. You can restart it later by changing status back to DRAFT."}
                  </p>
                </div>
              </div>
            </div>
          </div>
          <DialogFooter className="flex flex-col sm:flex-row gap-2">
            <Button
              variant="outline"
              onClick={() => {
                setRejectModalOpen(false);
                setPendingStatusChange(null);
                setRejectReason("");
              }}
              className="w-full sm:w-auto"
            >
              Cancel
            </Button>
            <Button
              onClick={handleRejectReasonSubmit}
              className={`w-full sm:w-auto text-white ${pendingStatusChange === "REWORK"
                  ? "bg-orange-600 hover:bg-orange-700"
                  : pendingStatusChange === "HOLD"
                    ? "bg-blue-600 hover:bg-blue-700"
                    : "bg-red-600 hover:bg-red-700"
                }`}
              disabled={
                submitting ||
                !rejectReason.trim() ||
                rejectReason.trim().length < 10
              }
            >
              {submitting
                ? "Processing..."
                : pendingStatusChange === "REWORK"
                  ? "Confirm Rework"
                  : pendingStatusChange === "HOLD"
                    ? "Confirm Hold"
                    : "Confirm Reject"}
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
              Quality Control Details
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <Tabs defaultValue="general" className="w-full">
              <TabsList className="grid grid-cols-3 mb-4">
                <TabsTrigger value="general">General Info</TabsTrigger>
                <TabsTrigger value="attempts">Test Attempts</TabsTrigger>
                <TabsTrigger value="history">QC History</TabsTrigger>
              </TabsList>

              <TabsContent value="general" className="space-y-4">
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <p className="text-xs font-medium text-gray-500">
                      QC Barcode
                    </p>
                    <p className="text-sm font-semibold text-gray-900 break-all">
                      {masterData.qcBarcode || "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500">
                      Process Order No
                    </p>
                    <p className="text-sm font-semibold text-gray-900">
                      {masterData.procOrderNo}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500">MM No</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {masterData.itcd}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500">MM Name</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {masterData.itemName}
                    </p>
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
                      Batch Size
                    </p>
                    <p className="text-sm font-semibold text-gray-900">
                      {masterData.batchSize}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500">
                      Current Status
                    </p>
                    <p className="text-sm font-semibold text-gray-900">
                      {masterData.status}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500">QC Date</p>
                    <p className="text-sm font-semibold text-gray-900">
                      {masterData.mfgDate
                        ? format(new Date(masterData.mfgDate), "dd MMM yyyy")
                        : "-"}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs font-medium text-gray-500">
                      Expiry Date
                    </p>
                    <p className="text-sm font-semibold text-gray-900">
                      {masterData.expiryDate
                        ? format(new Date(masterData.expiryDate), "dd MMM yyyy")
                        : "-"}
                    </p>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="attempts" className="space-y-4">
                <div className="space-y-3">
                  {/* Attempt 1 */}
                  <div className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="font-semibold text-gray-900">Attempt 1</p>
                        <p className="text-xs text-gray-500">
                          {parameters[0]?.attempt1.attemptDate || "-"}
                        </p>
                      </div>
                      {parameters[0]?.attempt1.rejectReason && (
                        <Badge variant="destructive" className="text-xs">
                          Rejected
                        </Badge>
                      )}
                    </div>

                    {parameters[0]?.attempt1.rejectReason && (
                      <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded">
                        <p className="text-xs font-medium text-red-800">
                          Rejection Reason:
                        </p>
                        <p className="text-xs text-red-700 mt-1">
                          {parameters[0]?.attempt1.rejectReason}
                        </p>
                      </div>
                    )}

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
                              Realized Value
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {parameters.map((param, rowIndex) => (
                            <tr
                              key={rowIndex}
                              className="border-b last:border-0"
                            >
                              <td className="py-2">{param.name}</td>
                              <td className="py-2">{param.standard}</td>
                              <td className="py-2">
                                <span
                                  className={
                                    param.attempt1.qualityRealized
                                      ? "font-medium text-gray-900"
                                      : "text-gray-500"
                                  }
                                >
                                  {param.attempt1.qualityRealized ||
                                    "Not recorded"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Attempt 2 */}
                  <div className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="font-semibold text-gray-900">Attempt 2</p>
                        <p className="text-xs text-gray-500">
                          {parameters[0]?.attempt2.attemptDate || "-"}
                        </p>
                      </div>
                      {parameters[0]?.attempt2.rejectReason && (
                        <Badge variant="destructive" className="text-xs">
                          Rejected
                        </Badge>
                      )}
                    </div>

                    {parameters[0]?.attempt2.rejectReason && (
                      <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded">
                        <p className="text-xs font-medium text-red-800">
                          Rejection Reason:
                        </p>
                        <p className="text-xs text-red-700 mt-1">
                          {parameters[0]?.attempt2.rejectReason}
                        </p>
                      </div>
                    )}

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
                              Realized Value
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {parameters.map((param, rowIndex) => (
                            <tr
                              key={rowIndex}
                              className="border-b last:border-0"
                            >
                              <td className="py-2">{param.name}</td>
                              <td className="py-2">{param.standard}</td>
                              <td className="py-2">
                                <span
                                  className={
                                    param.attempt2.qualityRealized
                                      ? "font-medium text-gray-900"
                                      : "text-gray-500"
                                  }
                                >
                                  {param.attempt2.qualityRealized ||
                                    "Not recorded"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>

                  {/* Attempt 3 */}
                  <div className="border rounded-lg p-4">
                    <div className="flex items-center justify-between mb-3">
                      <div>
                        <p className="font-semibold text-gray-900">Attempt 3</p>
                        <p className="text-xs text-gray-500">
                          {parameters[0]?.attempt3.attemptDate || "-"}
                        </p>
                      </div>
                      {parameters[0]?.attempt3.rejectReason && (
                        <Badge variant="destructive" className="text-xs">
                          Rejected
                        </Badge>
                      )}
                    </div>

                    {parameters[0]?.attempt3.rejectReason && (
                      <div className="mb-3 p-2 bg-red-50 border border-red-200 rounded">
                        <p className="text-xs font-medium text-red-800">
                          Rejection Reason:
                        </p>
                        <p className="text-xs text-red-700 mt-1">
                          {parameters[0]?.attempt3.rejectReason}
                        </p>
                      </div>
                    )}

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
                              Realized Value
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {parameters.map((param, rowIndex) => (
                            <tr
                              key={rowIndex}
                              className="border-b last:border-0"
                            >
                              <td className="py-2">{param.name}</td>
                              <td className="py-2">{param.standard}</td>
                              <td className="py-2">
                                <span
                                  className={
                                    param.attempt3.qualityRealized
                                      ? "font-medium text-gray-900"
                                      : "text-gray-500"
                                  }
                                >
                                  {param.attempt3.qualityRealized ||
                                    "Not recorded"}
                                </span>
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                </div>
              </TabsContent>

              <TabsContent value="history" className="space-y-4">
                <div className="text-center py-8 text-gray-500">
                  <FileText className="h-12 w-12 mx-auto text-gray-300 mb-3" />
                  <p>No detailed history available</p>
                  <p className="text-sm text-gray-400 mt-1">
                    Quality control history is recorded in the test attempts
                    above.
                  </p>
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
