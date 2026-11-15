"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import axios from "axios";
import {
  Search,
  Package,
  Save,
  Plus,
  Eye,
  Truck,
  CheckCircle,
  AlertCircle,
  Calendar,
  Tag,
  Clock,
  ArrowRight,
  Info,
  Warehouse,
  Box,
  Check,
  X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Separator } from "@/components/ui/separator";
import { toast } from "sonner";

export default function StoreQAEntryPage() {
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [orders, setOrders] = useState([]);
  const [search, setSearch] = useState("");
  const [editingItem, setEditingItem] = useState(null);
  const [showBatchFields, setShowBatchFields] = useState(false);
  const [formData, setFormData] = useState({
    batchNo: "",
    mfgDate: new Date().toISOString().split("T")[0],
    expiryDate: "",
    receivedQty: "",
    remarks: "",
  });

  const loadPendingOrders = async () => {
    setLoading(true);
    try {
      const response = await axios.get('/api/store/qa-entry/pending');
      setOrders(response.data.orders || []);
    } catch (error) {
      console.error("Error loading orders:", error);
      toast.error(error.response?.data?.error || "Failed to load pending orders");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadPendingOrders();
  }, []);

  const handleSaveQA = async () => {
    // Validation
    if (!formData.receivedQty || parseFloat(formData.receivedQty) <= 0) {
      toast.error("Received quantity must be greater than 0");
      return;
    }

    if (showBatchFields && !formData.batchNo.trim()) {
      toast.error("Batch number is required when batch info is enabled");
      return;
    }

    setSaving(true);
    try {
      const payload = {
        order_no: editingItem.order_no,
        itcd: editingItem.itcd,
        received_qty: parseFloat(formData.receivedQty),
        remarks: formData.remarks || null,
      };

      // Add batch info only if user entered it
      if (showBatchFields && formData.batchNo.trim()) {
        payload.batch_no = formData.batchNo.trim();
        payload.mfg_date = formData.mfgDate;
        payload.expiry_date = formData.expiryDate || null;
      }

      const response = await axios.post('/api/store/qa-entry', payload);

      if (response.data.ok) {
        toast.success("Goods receiving entry saved successfully!");
        
        // Reset form
        setEditingItem(null);
        setShowBatchFields(false);
        setFormData({
          batchNo: "",
          mfgDate: new Date().toISOString().split("T")[0],
          expiryDate: "",
          receivedQty: "",
          remarks: "",
        });
        
        // Reload orders
        await loadPendingOrders();
      }
    } catch (error) {
      console.error("Error saving entry:", error);
      toast.error(error.response?.data?.error || "Failed to save entry");
    } finally {
      setSaving(false);
    }
  };

  const startEdit = (order) => {
    setEditingItem(order);
    setShowBatchFields(false);
    setFormData({
      batchNo: "",
      mfgDate: new Date().toISOString().split("T")[0],
      expiryDate: "",
      receivedQty: order.ordered_qty.toString(), // Pre-fill with ordered quantity
      remarks: "",
    });
  };

  const cancelEdit = () => {
    setEditingItem(null);
    setShowBatchFields(false);
    setFormData({
      batchNo: "",
      mfgDate: new Date().toISOString().split("T")[0],
      expiryDate: "",
      receivedQty: "",
      remarks: "",
    });
  };

  const filteredOrders = orders.filter((order) => {
    if (!search) return true;
    const searchLower = search.toLowerCase();
    return (
      order.order_no.toString().includes(searchLower) ||
      order.vendor_name.toLowerCase().includes(searchLower) ||
      order.item_name.toLowerCase().includes(searchLower) ||
      order.itcd.toString().includes(searchLower)
    );
  });

  return (
    <div className="min-h-screen bg-secondary p-4 md:p-6">
      {/* Header */}
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-4 mb-8">
        <div className="flex items-center gap-3">
          <div className="p-2 bg-primary rounded-xl shrink-0">
            <Warehouse className="h-8 w-8 text-white" />
          </div>
          <div>
            <h1 className="text-xl md:text-2xl font-bold text-primary">
              Goods Receiving & QA Entry
            </h1>
            <p className="text-black text-sm max-w-lg">
              Enter received quantities and optional batch information. Items
              will be sent to QA department for quality inspection.
            </p>
          </div>
        </div>

        <Button
          variant="outline"
          onClick={loadPendingOrders}
          disabled={loading}
          className="gap-2 bg-primary text-white whitespace-nowrap"
        >
          {loading ? "Loading..." : "Refresh"}
        </Button>
      </div>

      {/* SEARCH + STATS IN ONE ROW */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6 mb-6">
        {/* LEFT – Search (2 columns) */}
        <Card className="lg:col-span-2 border-gray-200 shadow-sm">
          <CardContent className="p-4 md:p-6 h-full flex items-center">
            <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 w-full">
              <div className="flex-1">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-gray-400" />
                  <Input
                    type="text"
                    placeholder="Search purchase orders, vendors, items, or ITCD..."
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                    className="pl-10 h-11 bg-gray-50 border-gray-300"
                  />
                </div>
              </div>

              <div className="flex items-center gap-3 shrink-0">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSearch("")}
                  className="h-9"
                >
                  Clear
                </Button>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* RIGHT – Stats */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Card className="bg-primary/20 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-blue-50 rounded-lg">
                  <Box className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-primary font-medium">
                    Total Items
                  </p>
                  <p className="text-xl font-bold text-black">
                    {filteredOrders.length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>

          <Card className="bg-primary/20 shadow-sm">
            <CardContent className="p-4">
              <div className="flex items-center gap-3">
                <div className="p-2 bg-amber-50 rounded-lg">
                  <Clock className="h-5 w-5 text-primary" />
                </div>
                <div>
                  <p className="text-sm text-primary font-medium">
                    Awaiting Entry
                  </p>
                  <p className="text-xl font-bold text-black">
                    {filteredOrders.length}
                  </p>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>

      {/* Orders Table */}
      <Card className="shadow-lg overflow-hidden">
        <CardContent className="p-0">
          {loading ? (
            <div className="py-16 flex flex-col items-center justify-center">
              <div className="relative">
                <div className="h-12 w-12 rounded-full border-4 border-blue-100"></div>
                <div className="h-12 w-12 rounded-full border-4 border-blue-600 border-t-transparent animate-spin absolute top-0 left-0"></div>
              </div>
              <p className="mt-4 text-gray-600 font-medium">
                Loading pending items...
              </p>
              <p className="text-sm text-gray-500 mt-1">
                Fetching purchase orders data
              </p>
            </div>
          ) : filteredOrders.length === 0 ? (
            <div className="py-16 text-center">
              <div className="mx-auto w-20 h-20 bg-gradient-to-br from-blue-50 to-blue-100 rounded-full flex items-center justify-center mb-4">
                <Check className="h-8 w-8 text-blue-500" />
              </div>
              <h3 className="text-lg font-semibold text-gray-900 mb-2">
                All caught up!
              </h3>
              <p className="text-gray-600 max-w-md mx-auto">
                {search 
                  ? "No items found matching your search criteria."
                  : "All received items have been entered for quality control."}
              </p>
              <Button
                variant="outline"
                className="mt-4 gap-2"
                onClick={loadPendingOrders}
              >
                Check for new items
              </Button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <Table className="p-3">
                <TableHeader className="bg-primary border-2 border-primary/50">
                  <TableRow className="hover:bg-transparent">
                    <TableHead className="font-semibold text-white text-center">
                      Purchase Order
                    </TableHead>
                    <TableHead className="font-semibold text-white text-center">
                      Item Details
                    </TableHead>
                    <TableHead className="font-semibold text-white text-center">
                      Quantities
                    </TableHead>
                    <TableHead className="font-semibold text-white text-center">
                      Status
                    </TableHead>
                    <TableHead className="font-semibold text-white text-center">
                      Actions
                    </TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredOrders.map((order) => (
                    <TableRow
                      key={`${order.order_no}-${order.itcd}`}
                      className="hover:bg-blue-50/50 transition-colors group"
                    >
                      <TableCell className="border-2 border-primary/50 px-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <Badge className="  text-primary font-medium p-0 bg-transparent shadow-none">
                              {order.order_no}
                            </Badge>
                            <span className="font-medium text-xs text-gray-900">
                              {order.vendor_name}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="border-2 border-primary/50 px-3">
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-medium text-gray-900">
                              {order.itcd}
                            </span>
                             <span className="text-xs text-gray-600 line-clamp-2">
                              {order.item_name}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="border-2 border-primary/50 px-3">
                        <div className="text-right space-y-1">
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-black">Ordered:</span>
                            <span className="text-sm font-semibold">
                              {order.ordered_qty}
                            </span>
                          </div>
                          <div className="flex justify-between items-center">
                            <span className="text-sm text-black">Approved:</span>
                            <span className="text-sm font-semibold">
                              {order.approved_qty}
                            </span>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="border-2 border-primary/50 px-4 text-center">
                        <div className="flex items-center gap-2">
                          <Badge
                            variant="outline"
                            className={`
                              text-center
                              ${
                                order.approved_qty === 0
                                  ? "bg-red-50 border-red-200 text-red-700"
                                  : order.approved_qty >= order.ordered_qty
                                    ? "bg-green-700 border-green-200 text-white"
                                    : "bg-amber-50 border-amber-200 text-amber-700"
                              }
                            `}
                          >
                            <Clock className="h-3 w-3 mr-1" />
                            {
                            order.approved_qty === 0
                            ? "NOT APPROVED"
                            : order.approved_qty >= order.ordered_qty
                              ? "FULLY APPROVED"
                              : "PARTIALLY APPROVED"
                            }
                          </Badge>
                        </div>
                      </TableCell>
                      <TableCell className="border-2 border-primary/50 px-2 text-center">
                        {editingItem?.order_no === order.order_no &&
                        editingItem?.itcd === order.itcd ? (
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              onClick={handleSaveQA}
                              disabled={saving}
                              className="bg-primary gap-1"
                            >
                              <Save className="h-4 w-4" />
                              {saving ? "Saving..." : "Save Entry"}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={cancelEdit}
                              disabled={saving}
                            >
                              Cancel
                            </Button>
                          </div>
                        ) : (
                          <Button
                            onClick={() => startEdit(order)}
                            className="bg-primary text-white gap-1"
                          >
                            <Plus className="h-4 w-4" />
                            Enter Details
                            <ArrowRight className="h-3 w-3" />
                          </Button>
                        )}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Entry Form Modal */}
      {editingItem && (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center p-4 z-50 animate-in fade-in">
          <Card className="w-full max-w-4xl max-h-[95vh] overflow-hidden border-0 shadow-2xl">
            <CardHeader className="bg-primary text-white">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <div className="p-2 bg-white/20 rounded-lg">
                    <Package className="h-5 w-5" />
                  </div>
                  <div>
                    <CardTitle className="text-white">
                      Goods Receiving Entry
                    </CardTitle>
                    <CardDescription className="text-blue-100">
                      PO #{editingItem.order_no} • ITCD {editingItem.itcd}
                    </CardDescription>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={cancelEdit}
                  disabled={saving}
                  className="text-white hover:bg-white/20"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>

            <div className="overflow-y-auto max-h-[calc(90vh-200px)]">
              <CardContent className="p-6 space-y-6">
                {/* Item Summary */}
                <div className="bg-primary/20 rounded-xl p-4 border border-gray-200">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm font-medium text-primary">
                        Item Name
                      </p>
                      <p className="text-lg font-semibold text-black">
                        {editingItem.item_name}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-primary">
                        Ordered Quantity
                      </p>
                      <p className="text-lg font-semibold text-black">
                        {editingItem.ordered_qty}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-primary">Vendor</p>
                      <p className="font-medium text-black">
                        {editingItem.vendor_name}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-primary">Rate</p>
                      <p className="font-medium text-black">
                        PKR {editingItem.rate?.toLocaleString() || "0.00"}
                      </p>
                    </div>
                  </div>
                </div>

                {/* Received Quantity */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <Label className="text-base font-semibold text-gray-900">
                      Received Quantity *
                    </Label>
                    <div className="text-sm text-gray-500">
                      Ordered: {editingItem.ordered_qty}
                    </div>
                  </div>
                  <div className="relative">
                    <Input
                      type="number"
                      step="0.01"
                      min="0"
                      value={formData.receivedQty}
                      onChange={(e) =>
                        setFormData({
                          ...formData,
                          receivedQty: e.target.value,
                        })
                      }
                      placeholder={`Enter received quantity in ${editingItem.unit}`}
                      className="h-12 text-lg pl-12 border-2 focus:border-blue-500 focus:ring-blue-500"
                      disabled={saving}
                    />
                    <div className="absolute left-4 top-1/2 transform -translate-y-1/2">
                      <div className="p-2 bg-blue-100 rounded-lg">
                        <Box className="h-4 w-4 text-blue-600" />
                      </div>
                    </div>
                    <div className="absolute right-4 top-1/2 transform -translate-y-1/2 text-gray-500">
                      {editingItem.unit}
                    </div>
                  </div>
                  {formData.receivedQty && parseFloat(formData.receivedQty) > 0 && (
                    <div
                      className={`p-3 rounded-lg ${parseFloat(formData.receivedQty) > editingItem.ordered_qty ? "bg-amber-50 border border-amber-200" : "bg-emerald-50 border border-emerald-200"}`}
                    >
                      <div className="flex items-center gap-2">
                        <Info
                          className={`h-4 w-4 ${parseFloat(formData.receivedQty) > editingItem.ordered_qty ? "text-amber-600" : "text-emerald-600"}`}
                        />
                        <span className="text-sm font-medium">
                          {parseFloat(formData.receivedQty) >
                          editingItem.ordered_qty
                            ? `⚠️ Received ${(parseFloat(formData.receivedQty) - editingItem.ordered_qty).toFixed(2)} ${editingItem.unit} more than ordered`
                            : `✓ Received ${(editingItem.ordered_qty - parseFloat(formData.receivedQty)).toFixed(2)} ${editingItem.unit} less than ordered`}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                {/* Batch Information Toggle */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between p-4 bg-gray-50 rounded-lg">
                    <div className="flex items-center gap-3">
                      <div className="p-2 bg-white rounded-lg border">
                        <Tag className="h-4 w-4 text-gray-600" />
                      </div>
                      <div>
                        <Label className="text-base font-semibold text-gray-900">
                          Batch Information
                        </Label>
                        <p className="text-sm text-gray-500">
                          Optional - QA department can enter batch details later
                        </p>
                      </div>
                    </div>
                    <Switch
                      checked={showBatchFields}
                      onCheckedChange={setShowBatchFields}
                      disabled={saving}
                      className="data-[state=checked]:bg-blue-600"
                    />
                  </div>

                  {/* Batch Fields (Conditional) */}
                  {showBatchFields && (
                    <div className="space-y-4 animate-in slide-in-from-top-2">
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div className="space-y-2">
                          <Label className="font-medium">
                            Batch/Lot Number *
                          </Label>
                          <Input
                            value={formData.batchNo}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                batchNo: e.target.value,
                              })
                            }
                            placeholder="Enter batch or lot number"
                            className="h-11"
                            disabled={saving}
                          />
                        </div>
                        <div className="space-y-2">
                          <Label className="font-medium">
                            Manufacturing Date
                          </Label>
                          <div className="relative">
                            <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                            <Input
                              type="date"
                              value={formData.mfgDate}
                              onChange={(e) =>
                                setFormData({
                                  ...formData,
                                  mfgDate: e.target.value,
                                })
                              }
                              className="h-11 pl-10"
                              disabled={saving}
                            />
                          </div>
                        </div>
                      </div>
                      <div className="space-y-2">
                        <Label className="font-medium">
                          Expiry Date (Optional)
                        </Label>
                        <div className="relative">
                          <Calendar className="absolute left-3 top-1/2 transform -translate-y-1/2 h-4 w-4 text-gray-400" />
                          <Input
                            type="date"
                            value={formData.expiryDate}
                            onChange={(e) =>
                              setFormData({
                                ...formData,
                                expiryDate: e.target.value,
                              })
                            }
                            className="h-11 pl-10"
                            disabled={saving}
                          />
                        </div>
                      </div>
                    </div>
                  )}
                </div>

                {/* Remarks */}
                <div className="space-y-2">
                  <Label className="text-base font-semibold text-gray-900">
                    Remarks (Optional)
                  </Label>
                  <Textarea
                    value={formData.remarks}
                    onChange={(e) =>
                      setFormData({ ...formData, remarks: e.target.value })
                    }
                    placeholder="Any notes about quality, packaging, damage, or special instructions..."
                    className="min-h-[100px] resize-none border-2 focus:border-blue-500 focus:ring-blue-500"
                    disabled={saving}
                  />
                </div>

                {/* Information Card */}
                <div className="bg-primary border border-blue-200 rounded-xl p-4">
                  <div className="flex items-start gap-3">
                    <AlertCircle className="h-5 w-5 text-white mt-0.5 flex-shrink-0" />
                    <div className="space-y-2">
                      <p className="font-medium text-white">
                        Workflow Information
                      </p>
                      <ul className="text-sm text-white space-y-1 list-disc pl-5">
                        <li>
                          After saving, item will be sent to QA department for
                          quality inspection
                        </li>
                        <li>
                          Batch information is optional - QA can enter it during
                          inspection
                        </li>
                        <li>
                          QA will approve or reject the item based on quality
                          tests
                        </li>
                        <li>
                          Once approved, GRN can be created by store department
                        </li>
                      </ul>
                    </div>
                  </div>
                </div>
              </CardContent>
            </div>

            {/* Footer Actions */}
            <CardContent className="border-t bg-gray-50 p-6">
              <div className="flex flex-col sm:flex-row gap-3 justify-between items-center">
                <div className="text-sm text-primary font-medium">
                  Store Entry → QA Inspection → GRN Creation
                </div>
                <div className="flex gap-3">
                  <Button
                    variant="outline"
                    onClick={cancelEdit}
                    disabled={saving}
                    className="min-w-[100px]"
                  >
                    Cancel
                  </Button>
                  <Button
                    onClick={handleSaveQA}
                    disabled={
                      saving ||
                      !formData.receivedQty ||
                      parseFloat(formData.receivedQty) <= 0 ||
                      (showBatchFields && !formData.batchNo.trim())
                    }
                    className="bg-primary min-w-[140px] gap-2"
                  >
                    <Save className="h-4 w-4" />
                    {saving ? "Saving..." : "Save & Send to QA"}
                    <ArrowRight className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        </div>
      )}
    </div>
  );
}