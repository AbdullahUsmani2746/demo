"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  Filter,
  ChevronLeft,
  ChevronRight,
  Package,
  Eye,
  CheckCircle2,
  XCircle,
  Truck,
  Download,
  BarChart3,
  Clock,
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
import OrderQcScanner from "@/components/Orders/OrderQcScanner";

// Status Badge Component
const StatusBadge = ({ status }) => {
  const statusConfig = {
    draft: {
      bg: "bg-amber-50",
      text: "text-amber-800",
      border: "border-amber-200",
      icon: <Clock className="h-3 w-3" />,
      label: "Awaiting QA",
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
      className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border ${config.bg} ${config.text} ${config.border}`}
    >
      {config.icon}
      <span className="text-xs font-medium">{config.label}</span>
    </div>
  );
};

// Quick Actions Component - ONLY APPROVE/REJECT (NO GRN)
const QuickActions = ({
  orderNo,
  itcd,
  currentStatus,
  grnNo,
  batchNo,
  onAction,
}) => {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleAction = async (action) => {
    setLoading(true);
    try {
      // Pass batchNo to the action handler
      await onAction(orderNo, itcd, action, batchNo);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex items-center gap-1">
      {/* Show GRN number if already created (read-only) */}
      {grnNo ? (
        <Badge
          variant="outline"
          className="bg-purple-50 text-purple-700 border-purple-200"
        >
          <Truck className="h-3 w-3 mr-1" />
          GRN #{grnNo}
        </Badge>
      ) : (
        <>
          {/* Only show approve/reject for draft items */}
          {currentStatus === "draft" && (
            <>
              <Button
                onClick={() => handleAction("approve")}
                disabled={loading}
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-emerald-600 hover:text-emerald-700 hover:bg-emerald-50"
                title="Approve"
              >
                {loading ? (
                  <div className="h-3 w-3 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <CheckCircle2 className="h-3 w-3" />
                )}
              </Button>
              <Button
                onClick={() => handleAction("reject")}
                disabled={loading}
                size="sm"
                variant="ghost"
                className="h-7 w-7 p-0 text-red-600 hover:text-red-700 hover:bg-red-50"
                title="Reject"
              >
                {loading ? (
                  <div className="h-3 w-3 border-2 border-red-600 border-t-transparent rounded-full animate-spin" />
                ) : (
                  <XCircle className="h-3 w-3" />
                )}
              </Button>
            </>
          )}
        </>
      )}
      <Button
        onClick={() =>
          router.push(
            `/accounting/forms/orderqualitycontrol/${orderNo}?itcd=${itcd}`,
          )
        }
        size="sm"
        variant="ghost"
        className="h-7 w-7 p-0 text-gray-600 hover:text-gray-900 hover:bg-gray-100"
        title="View Details"
      >
        <Eye className="h-3 w-3" />
      </Button>
    </div>
  );
};

export default function OrderQualityControlIndex() {
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState([]);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [search, setSearch] = useState("");
  const [localSearch, setLocalSearch] = useState("");
  const [filterStatus, setFilterStatus] = useState("all");
  const [grnInfo, setGrnInfo] = useState({});
  const [batchInfo, setBatchInfo] = useState({});
  const [stats, setStats] = useState({
    total: 0,
    pending: 0,
    approved: 0,
    rejected: 0,
    grnCreated: 0,
  });
  const router = useRouter();

  // Modal states
  const [rejectModalOpen, setRejectModalOpen] = useState(false);
  const [approveModalOpen, setApproveModalOpen] = useState(false);
  const [actionData, setActionData] = useState(null);
  const [rejectReason, setRejectReason] = useState("");
  const [batchNumber, setBatchNumber] = useState(""); // New
  const [approvalRemarks, setApprovalRemarks] = useState(""); // New

  // Debounced search
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
        includeGrn: "true",
        includeBatch: "true",
      };

      const res = await fetch(
        `/api/forms/orderqualitycontrol?${new URLSearchParams(params)}`,
      );
      const data = await res.json();

      setOrders(data.orders || []);
      setTotal(Number(data.total) || 0);
      setTotalPages(Number(data.totalPages) || 1);

      if (data.grnInfo) {
        setGrnInfo(data.grnInfo);
      }

      if (data.batchInfo) {
        setBatchInfo(data.batchInfo);
      }

      // Calculate stats
      const allItems = data.orders?.flatMap((order) => order.items) || [];
      setStats({
        total: allItems.length,
        pending: allItems.filter((item) => item.status === "draft").length,
        approved: allItems.filter(
          (item) => item.status === "approve" || item.status === "approved",
        ).length,
        rejected: allItems.filter(
          (item) => item.status === "reject" || item.status === "rejected",
        ).length,
        grnCreated: Object.keys(data.grnInfo || {}).length,
      });
    } catch (error) {
      console.error("Error loading QC records:", error);
      toast.error("Failed to load data");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, [page, pageSize, search]);

  const filteredOrders = useMemo(() => {
    let filtered = orders;

    if (filterStatus !== "all") {
      filtered = filtered
        .map((order) => ({
          ...order,
          items: order.items.filter((item) => item.status === filterStatus),
        }))
        .filter((order) => order.items.length > 0);
    }

    return filtered;
  }, [orders, filterStatus]);

  const rangeLabel = useMemo(() => {
    const start = total === 0 ? 0 : (page - 1) * pageSize + 1;
    const end = Math.min(total, page * pageSize);
    return `${start}–${end} of ${total}`;
  }, [page, pageSize, total]);

  const handleAction = async (orderNo, itcd, action, batchNo) => {
    // Store batchNo in actionData for use in modals
    setActionData({ orderNo, itcd, action, batchNo });

    if (action === "reject") {
      setRejectReason("");
      setRejectModalOpen(true);
      return;
    }

    if (action === "approve") {
      // Set initial batch number from existing data
      setBatchNumber(batchNo || "");
      setApprovalRemarks("");
      setApproveModalOpen(true);
    }
  };

  // Update the handleApproveSubmit function:

  const handleApproveSubmit = async () => {
    // Check if this item already has a batch number
    const key = `${actionData.orderNo}-${actionData.itcd}`;
    const existingBatch = batchInfo[key]?.batch_no;

    // If no existing batch number AND no new batch number provided
    if (!existingBatch && !batchNumber.trim()) {
      toast.error("Batch number is required for this item");
      return;
    }

    try {
      const response = await fetch(
        `/api/forms/orderqualitycontrol/order/${actionData.orderNo}/status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itcd: actionData.itcd,
            status: "approve",
            batch_no: batchNumber.trim(), // Send batch number
            remarks: approvalRemarks.trim(), // Add optional remarks
          }),
        },
      );

      const data = await response.json();

      if (data.ok) {
        toast.success(
          data.grnNo
            ? `Item approved and GRN #${data.grnNo} created successfully!`
            : "Item approved successfully!",
        );
        load();
      } else {
        toast.error(data.error || "Failed to approve item");
      }
    } catch (error) {
      toast.error("Error approving item");
    } finally {
      setApproveModalOpen(false);
      setActionData(null);
      setBatchNumber(""); // Reset batch number
      setApprovalRemarks(""); // Reset remarks
    }
  };

  const handleRejectSubmit = async () => {
    if (!rejectReason.trim()) {
      toast.error("Reject reason is required");
      return;
    }

    try {
      const response = await fetch(
        `/api/forms/orderqualitycontrol/order/${actionData.orderNo}/status`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            itcd: actionData.itcd,
            status: "reject",
            reject_reason: rejectReason,
          }),
        },
      );

      const data = await response.json();

      if (data.ok) {
        toast.success("Item rejected successfully");
        load();
      } else {
        toast.error(data.error || "Failed to reject item");
      }
    } catch (error) {
      toast.error("Error rejecting item");
    } finally {
      setRejectModalOpen(false);
      setActionData(null);
      setRejectReason("");
    }
  };

  return (
    <div className="min-h-screen bg-secondary p-4 md:p-6">
      {/* Header */}
      <div className="mb-8">
        <OrderQcScanner />

        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-6">
          <div>
            <h1 className="text-2xl md:text-3xl font-bold text-primary flex items-center gap-2">
              <Package className="h-7 w-7 text-black" />
              QA Department Dashboard
            </h1>
            <p className="text-black mt-1">
              Review and approve quality inspections
            </p>
          </div>
          {/* <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              className="flex items-center bg-primary text-white px-4 py-4 gap-2"
            >
              <Download className="h-4 w-4" />
              Export
            </Button>
          </div> */}
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
          <Card className="bg-primary/20">
            <CardContent className="p-4">
              <div className="flex items-center justify-between">
                <div>
                  <p className="text-sm text-primary font-medium">
                    Total Items
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
                  <p className="text-sm text-primary font-medium">Pending QA</p>
                  <p className="text-2xl font-bold text-black mt-2">
                    {stats.pending}
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
                  <p className="text-sm text-primary font-medium">
                    GRNs Created
                  </p>
                  <p className="text-2xl font-bold text-black mt-2">
                    {stats.grnCreated}
                  </p>
                </div>
                <div className="p-2 bg-purple-50 rounded-lg">
                  <Truck className="h-5 w-5 text-primary" />
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
                    placeholder="Search orders, MM, vendors, or GRN numbers..."
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
                      <SelectItem value="draft">Pending QA</SelectItem>
                      <SelectItem value="approve">Approved</SelectItem>
                      <SelectItem value="reject">Rejected</SelectItem>
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

      {/* Orders Table */}
      <Card>
        <CardContent className="p-0">
          {loading ? (
            <div className="py-24 flex justify-center items-center">
              <div className="flex flex-col items-center gap-4">
                <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
                <p className="text-gray-600 font-medium">Loading records...</p>
              </div>
            </div>
          ) : filteredOrders.length === 0 ? (
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
                    <th className="px-6 py-2 text-left text-xs font-semibold text-white uppercase tracking-wider">
                      Order Details
                    </th>
                    <th className="px-6 py-2 text-left text-xs font-semibold text-white uppercase tracking-wider">
                      MM Details
                    </th>
                    <th className="px-6 py-2 text-left text-xs font-semibold text-white uppercase tracking-wider">
                      Status
                    </th>
                    <th className="px6 py-2 text-left text-xs font-semibold text-white uppercase tracking-wider">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-200">
                  {filteredOrders.map((order) => (
                    <tr
                      key={order.order_no}
                      className="hover:bg-gray-50 transition-colors"
                    >
                      <td className="px-6 py-2 border-2 border-primary/50">
                        <div>
                          <div className="flex items-center gap-2 mb-2">
                            <Badge className="bg-blue-100 text-primary hover:bg-blue-100">
                              PO #{order.order_no}
                            </Badge>
                            <span className="text-xs font-medium text-gray-900">
                              {order.order_name}
                            </span>
                          </div>
                        </div>
                      </td>
                      <td className="px-6 py-2 border-2 border-primary/50">
                        <div className="space-y-3">
                          {order.items?.map((item) => {
                            const key = `${order.order_no}-${item.itcd}`;
                            const batchData = batchInfo[key];
                            const hasBatchNo = batchData?.batch_no;

                            return (
                              <div
                                key={item.itcd}
                                className="flex items-center justify-between"
                              >
                                <div className="min-w-0">
                                  <div className="flex items-center gap-2">
                                    <span className="text-sm font-medium text-gray-900">
                                      {item.itcd}
                                    </span>
                                    {/* {item.grn_no && (
                                      <Badge
                                        variant="outline"
                                        className="text-xs"
                                      >
                                        GRN #{item.grn_no}
                                      </Badge>
                                    )} */}
                                    {hasBatchNo && (
                                      <Badge
                                        variant="outline"
                                        className="text-xs bg-blue-50 text-primary border-blue-200"
                                      >
                                        Batch #{hasBatchNo}
                                      </Badge>
                                    )}
                                    {item.qa_barcode && (
                                      <Badge
                                        variant="outline"
                                        className="text-xs bg-amber-50 text-amber-700 border-amber-200"
                                      >
                                        {item.qa_barcode}
                                      </Badge>
                                    )}
                                    {item.qc_barcode && (
                                      <Badge
                                        variant="outline"
                                        className="text-xs bg-emerald-50 text-emerald-700 border-emerald-200"
                                      >
                                        {item.qc_barcode}
                                      </Badge>
                                    )}
                                  </div>
                                  <p className="text-xs text-gray-600 truncate max-w-xs">
                                    {item.item_name}
                                  </p>
                                  {/* {hasBatchNo && (
                                    <p className="text-xs text-gray-500 mt-1">
                                      Batch: {hasBatchNo}
                                    </p>
                                  )} */}
                                </div>
                                <div className="flex flex-col items-end">
                                  <span className="text-sm text-black whitespace-nowrap">
                                    {item.qty} {item.unit}
                                  </span>
                                </div>
                              </div>
                            );
                          })}
                        </div>
                      </td>
                      <td className="px-6 py-2 border-2 border-primary/50">
                        <div className="space-y-2">
                          {order.items?.map((item) => (
                            <div
                              key={item.itcd}
                              className="flex items-center justify-between"
                            >
                              <StatusBadge status={item.status} />
                            </div>
                          ))}
                        </div>
                      </td>
                      <td className="px-6 py-2 border-2 border-primary/50">
                        <div className="space-y-3">
                          {order.items?.map((item) => {
                            const key = `${order.order_no}-${item.itcd}--${item.id}`;
                            const grnNo = grnInfo[key];
                            const batchData = batchInfo[key];

                            return (
                              <div
                                key={item.itcd}
                                className="flex items-center justify-between"
                              >
                                <QuickActions
                                  orderNo={order.order_no}
                                  itcd={item.itcd}
                                  currentStatus={item.status}
                                  grnNo={grnNo}
                                  batchNo={batchData?.batch_no}
                                  onAction={handleAction}
                                />
                                {item.grn_status === "CREATED" && !grnNo ? (
                                  <Badge
                                    variant="outline"
                                    className="bg-purple-50 text-purple-700 border-purple-200"
                                  >
                                    GRN Created
                                  </Badge>
                                ) : null}
                              </div>
                            );
                          })}
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
        {filteredOrders.length > 0 && (
          <div className="px-6 py-3 bg-gray-50 border-t border-gray-200 flex items-center justify-between">
            <div className="text-sm text-primary font-medium">
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

      {/* Reject Modal */}
      <Dialog open={rejectModalOpen} onOpenChange={setRejectModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-red-600">
              <XCircle className="h-5 w-5" />
              Reject Quality Check
            </DialogTitle>
            <DialogDescription>
              Please provide a reason for rejecting this quality check.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            {actionData && (
              <div className="bg-gray-50 border border-gray-200 rounded-lg p-4">
                <p className="text-sm font-medium text-gray-900">
                  Order #{actionData.orderNo} • ITCD {actionData.itcd}
                </p>
              </div>
            )}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Rejection Reason *
              </label>
              <Textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                placeholder="Enter detailed reason for rejection..."
                rows={4}
                className="w-full"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => {
                setRejectModalOpen(false);
                setActionData(null);
                setRejectReason("");
              }}
            >
              Cancel
            </Button>
            <Button
              onClick={handleRejectSubmit}
              disabled={!rejectReason.trim()}
              className="bg-primary hover:bg-red-700"
            >
              Confirm Reject
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Approve Modal */}
      <Dialog open={approveModalOpen} onOpenChange={setApproveModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2 text-primary">
              <CheckCircle2 className="h-5 w-5" />
              Approve Quality Check
            </DialogTitle>
            <DialogDescription>
              Are you sure you want to approve this item?
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-primary rounded-lg p-4">
              <div className="flex items-start gap-3">
                <CheckCircle2 className="h-5 w-5 text-white mt-0.5" />
                <div>
                  <h4 className="font-medium text-white">Approval Summary</h4>
                  <ul className="mt-2 text-sm text-white space-y-1">
                    <li>• Order #{actionData?.orderNo}</li>
                    <li>• Item: ITCD {actionData?.itcd}</li>
                    {actionData?.batchNo && (
                      <li>
                        • Existing Batch: <strong>{actionData.batchNo}</strong>
                      </li>
                    )}
                    <li>
                      • <strong>Item will be marked as approved</strong>
                    </li>
                    <li>• Store can create GRN after approval</li>
                  </ul>
                </div>
              </div>
            </div>

            {/* Add Batch Number Input */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Batch Number{" "}
                {!actionData?.batchNo && (
                  <span className="text-red-500">*</span>
                )}
              </label>
              <Input
                value={batchNumber}
                onChange={(e) => setBatchNumber(e.target.value)}
                placeholder="Enter batch/lot number"
                className="w-full"
                required={!actionData?.batchNo}
              />
              <p className="text-xs text-gray-500 mt-1">
                {actionData?.batchNo
                  ? "Batch number already exists. You can change it if needed."
                  : "Required if item requires batch tracking."}
              </p>
            </div>

            {/* Add Remarks Input (Optional) */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Remarks (Optional)
              </label>
              <Textarea
                value={approvalRemarks}
                onChange={(e) => setApprovalRemarks(e.target.value)}
                placeholder="Add any additional notes or comments..."
                rows={3}
                className="w-full"
              />
            </div>
          </div>
          <DialogFooter>
            <Button
              variant="outline"
              onClick={() => setApproveModalOpen(false)}
            >
              Cancel
            </Button>
            <Button
              onClick={handleApproveSubmit}
              className="bg-primary hover:bg-primary"
            >
              Confirm Approval
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
