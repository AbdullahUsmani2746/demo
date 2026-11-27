"use client";
import React, { useState, useEffect, useRef } from "react";
import Link from "next/link";
import {
  Package,
  ArrowUpCircle,
  ArrowDownCircle,
  RefreshCw,
  ChevronLeft,
  ChevronRight,
  Search,
  Eye,
  X,
  Box,
  FileText,
  Activity,
  TrendingUp,
  AlertTriangle,
  CheckCircle,
  BarChart3,
  ExternalLink,
  Factory,
} from "lucide-react";
import axios from "axios";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Dialog, DialogContent, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { voucherHref } from "@/lib/vouchers/voucherLink";
import { poRefOf } from "@/lib/manufacturing/processOrderRef";
import {
  LabHeader, LabCard, LabStat, LabEmpty, Chip, CODE_CHIP, TH, TD, NUM, TOTAL_ROW,
  TABS_SCROLL, DIALOG, DIALOG_HEAD, DIALOG_BODY, DIALOG_FOOT,
} from "@/components/Material/shared/LabUI";

// Material Issue = tran_code 7, Material Input = tran_code 8 (the rows carry
// their own tran_code when the API sends it).
const ISSUE_CODE = 7;
const INPUT_CODE = 8;
const qtyOf = (t) => (t?.transactions || []).reduce((sum, x) => sum + (x.qty || 0), 0);
const fmtQty = (n) => Number(n || 0).toLocaleString();

/** Small "open this voucher" icon link (lib/vouchers/voucherLink.js). */
function VoucherLink({ row, code, label = "Open voucher" }) {
  const href = row ? voucherHref({ ...row, tran_code: row.tran_code ?? code }) : null;
  if (!href) return null;
  return (
    <Link
      href={href}
      title={label}
      aria-label={`${label} ${row.tran_id}`}
      className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
    >
      <ExternalLink className="h-3.5 w-3.5" />
    </Link>
  );
}

/** Item lines of one voucher: maroon header, totals row; cards under md. */
function LinesTable({ items, totalLabel, total, tone }) {
  return (
    <div className="overflow-x-auto">
      <table className="vl-grid w-full text-sm">
        <thead>
          <tr>
            <th className={TH}>#</th>
            <th className={TH}>Item Code</th>
            <th className={TH}>Item Name</th>
            <th className={`${TH} text-right`}>Quantity</th>
            <th className={TH}>Unit</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {items.length === 0 ? (
            <tr><td colSpan={5} className="px-3 py-6 text-center text-muted-foreground">No lines</td></tr>
          ) : items.map((item, index) => (
            <tr key={item.id || index} className="hover:bg-muted/40">
              <td className={`${TD} tabular-nums text-muted-foreground`} data-label="#">{index + 1}</td>
              <td className={TD} data-label="Item Code"><span className={CODE_CHIP}>{item.itemDetails?.code || "N/A"}</span></td>
              <td className={`${TD} max-md:col-span-2`} data-label="Item Name">{item.itemDetails?.item || item.item}</td>
              <td className={`${TD} ${NUM} font-semibold ${tone || "text-foreground"}`} data-label="Quantity">{fmtQty(item.qty)}</td>
              <td className={`${TD} text-muted-foreground`} data-label="Unit">{item.itemDetails?.unit || item.unit}</td>
            </tr>
          ))}
        </tbody>
        {total != null && items.length > 0 && (
          <tfoot className="max-md:block">
            <tr className={cn(TOTAL_ROW, "max-md:flex max-md:justify-between max-md:px-3.5 max-md:py-2.5")}>
              <td colSpan={3} className={`${TD} text-right max-md:p-0`}>{totalLabel}</td>
              <td className={`${TD} ${NUM} max-md:p-0 ${tone || ""}`}>{fmtQty(total)}</td>
              <td className="max-md:hidden" />
            </tr>
          </tfoot>
        )}
      </table>
    </div>
  );
}

const TransactionDetailsModal = ({ transaction, code, onClose }) => {
  const items = transaction?.transactions || [];

  return (
    <Dialog open={!!transaction} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn(DIALOG, "max-w-4xl")}>
        {transaction && (
          <>
            <div className={cn(DIALOG_HEAD, "flex items-center gap-3 pr-12")}>
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <FileText className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="text-base font-semibold text-primary">Transaction Details</DialogTitle>
                <DialogDescription className="text-xs">
                  ID: <span className={CODE_CHIP}>{transaction.tran_id}</span> · Date:{" "}
                  {new Date(transaction.dated).toLocaleDateString()}
                  {poRefOf(transaction) ? <> · Process order {poRefOf(transaction)}</> : null}
                </DialogDescription>
              </div>
            </div>
            <div className={cn(DIALOG_BODY, "p-0 sm:p-0")}>
              <LinesTable items={items} totalLabel="Total" total={qtyOf(transaction)} />
            </div>
            <div className={DIALOG_FOOT}>
              {voucherHref({ ...transaction, tran_code: transaction.tran_code ?? code }) && (
                <Button asChild variant="outline">
                  <Link href={voucherHref({ ...transaction, tran_code: transaction.tran_code ?? code })}>
                    <ExternalLink className="mr-1.5 h-4 w-4" />Open voucher
                  </Link>
                </Button>
              )}
              <Button onClick={onClose} className="bg-primary text-primary-foreground hover:bg-primary/90">Close</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

const ProductionDetailsModal = ({ production, onClose }) => {
  const issueItems = production?.issue?.transactions || [];
  const inputItems = production?.input?.transactions || [];

  const totalIssueQty = issueItems.reduce(
    (sum, item) => sum + (item.qty || 0),
    0
  );
  const totalInputQty = inputItems.reduce(
    (sum, item) => sum + (item.qty || 0),
    0
  );
  const wastage = totalIssueQty - totalInputQty;
  const efficiency =
    totalIssueQty > 0 ? ((totalInputQty / totalIssueQty) * 100).toFixed(2) : 0;

  return (
    <Dialog open={!!production} onOpenChange={(o) => !o && onClose()}>
      <DialogContent className={cn(DIALOG, "max-w-6xl")}>
        {production && (
          <>
            <div className={cn(DIALOG_HEAD, "flex items-center gap-3 pr-12")}>
              <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg bg-primary text-primary-foreground">
                <Activity className="h-4 w-4" />
              </span>
              <div className="min-w-0">
                <DialogTitle className="text-base font-semibold text-primary">Production Yield Analysis</DialogTitle>
                <DialogDescription className="text-xs">
                  Production #: <span className={CODE_CHIP}>{production.production_no}</span> · Date:{" "}
                  {new Date(production.date).toLocaleDateString()}
                </DialogDescription>
              </div>
            </div>

            <div className={cn(DIALOG_BODY, "space-y-5")}>
              <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
                <LabStat label="Material Issued" value={totalIssueQty.toLocaleString()} icon={ArrowUpCircle} tone="brand" />
                <LabStat label="Actual Yield" value={totalInputQty.toLocaleString()} icon={ArrowDownCircle} tone="ok" />
                <LabStat label="Wastage" value={wastage.toLocaleString()} icon={wastage > 0 ? AlertTriangle : CheckCircle} tone={wastage > 0 ? "warn" : "ok"} />
                <LabStat label="Efficiency" value={`${efficiency}%`} icon={TrendingUp} tone="muted" />
              </div>

              <LabCard
                icon={ArrowUpCircle}
                title={<>Material Issue — Raw Materials <span className="font-normal text-muted-foreground">(Tran ID {production.issue?.tran_id})</span></>}
                subtitle={`Godown: ${production.issue?.godownDetails?.godown || "N/A"}`}
                actions={<VoucherLink row={production.issue} code={ISSUE_CODE} />}
              >
                <LinesTable items={issueItems} totalLabel="Total Issued" total={totalIssueQty} />
              </LabCard>

              <div className="flex justify-center">
                <span className="inline-flex items-center gap-2 rounded-full border border-border bg-muted/60 px-4 py-1.5 text-xs font-medium text-muted-foreground">
                  <Factory className="h-4 w-4" /> Production Process
                </span>
              </div>

              <LabCard
                icon={ArrowDownCircle}
                title={<>Material Input — Finished Product <span className="font-normal text-muted-foreground">(Tran ID {production.input?.tran_id})</span></>}
                subtitle={`Godown: ${production.input?.godownDetails?.godown || "N/A"}`}
                actions={<VoucherLink row={production.input} code={INPUT_CODE} />}
              >
                <LinesTable items={inputItems} totalLabel="Total Produced" total={totalInputQty} tone="text-[#2f5139] dark:text-emerald-300" />
              </LabCard>
            </div>

            <div className={DIALOG_FOOT}>
              <Button onClick={onClose} className="bg-primary text-primary-foreground hover:bg-primary/90">Close</Button>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
};

const MaterialDataViewer = () => {
  const [issueData, setIssueData] = useState([]);
  const [inputData, setInputData] = useState([]);
  const [yieldData, setYieldData] = useState([]);
  const [loading, setLoading] = useState(true);
  const [yieldLoading, setYieldLoading] = useState(false);
  const [activeTab, setActiveTab] = useState("issue");
  const [currentPage, setCurrentPage] = useState(1);
  const [yieldCurrentPage, setYieldCurrentPage] = useState(1);
  const [searchTerm, setSearchTerm] = useState("");
  const [totalRecords, setTotalRecords] = useState(0);
  const [yieldTotalRecords, setYieldTotalRecords] = useState(0);
  const [totalPages, setTotalPages] = useState(0);
  const [yieldTotalPages, setYieldTotalPages] = useState(0);
  const [selectedTransaction, setSelectedTransaction] = useState(null);
  const [selectedProduction, setSelectedProduction] = useState(null);
  const [stats, setStats] = useState({
    issueCount: 0,
    inputCount: 0,
    issueQty: 0,
    inputQty: 0,
  });
  const [yieldStats, setYieldStats] = useState({
    totalProductions: 0,
    totalIssued: 0,
    totalProduced: 0,
    totalWastage: 0,
    avgEfficiency: 0,
  });
  const recordsPerPage = 10;

  useEffect(() => {
    if (activeTab !== "yield") {
      fetchData();
    } else {
      fetchYieldData();
    }
  }, [activeTab, currentPage, searchTerm, yieldCurrentPage]);

  useEffect(() => {
    fetchStats();
  }, []);

  const fetchData = async () => {
    setLoading(true);
    try {
      const endpoint =
        activeTab === "issue"
          ? "/api/voucher/materialIssue"
          : "/api/voucher/materialInput";

      const response = await axios.get(endpoint, {
        params: {
          page: currentPage,
          limit: recordsPerPage,
          search: searchTerm || undefined,
        },
      });

      const data = response.data;

      if (activeTab === "issue") {
        setIssueData(data.data || []);
      } else {
        setInputData(data.data || []);
      }

      setTotalRecords(data.total || 0);
      setTotalPages(
        data.totalPages || Math.ceil((data.total || 0) / recordsPerPage)
      );
    } catch (error) {
      console.error("Error fetching data:", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchYieldData = async () => {
    setYieldLoading(true);
    try {
      const [issueRes, inputRes] = await Promise.all([
        axios.get("/api/voucher/materialIssue"),
        axios.get("/api/voucher/materialInput"),
      ]);

      const issueData = issueRes.data.data || [];
      const inputData = inputRes.data.data || [];

      // Merge issue + production by process order (lib/manufacturing/processOrderRef.js)
      const productionMap = new Map();

      issueData.forEach((issue) => {
        const prodNo = poRefOf(issue);
        if (prodNo) {
          if (!productionMap.has(prodNo)) {
            productionMap.set(prodNo, {
              production_no: prodNo,
              date: issue.dated,
              issue: issue,
              input: null,
            });
          }
        }
      });

      inputData.forEach((input) => {
        const prodNo = poRefOf(input);
        if (prodNo && productionMap.has(prodNo)) {
          const existing = productionMap.get(prodNo);
          existing.input = input;
        }
      });

      let merged = Array.from(productionMap.values()).filter(
        (item) => item.issue && item.input
      );

      // Calculate yield stats
      let totalIssued = 0;
      let totalProduced = 0;
      let efficiencies = [];

      merged.forEach((item) => {
        const issueQty =
          item.issue.transactions?.reduce((sum, t) => sum + (t.qty || 0), 0) ||
          0;
        const inputQty =
          item.input.transactions?.reduce((sum, t) => sum + (t.qty || 0), 0) ||
          0;

        totalIssued += issueQty;
        totalProduced += inputQty;

        if (issueQty > 0) {
          efficiencies.push((inputQty / issueQty) * 100);
        }
      });

      const avgEff =
        efficiencies.length > 0
          ? (
              efficiencies.reduce((a, b) => a + b, 0) / efficiencies.length
            ).toFixed(2)
          : 0;

      setYieldStats({
        totalProductions: merged.length,
        totalIssued,
        totalProduced,
        totalWastage: totalIssued - totalProduced,
        avgEfficiency: avgEff,
      });

      // Set pagination
      setYieldTotalRecords(merged.length);
      setYieldTotalPages(Math.ceil(merged.length / recordsPerPage));

      const startIdx = (yieldCurrentPage - 1) * recordsPerPage;
      const paginatedData = merged.slice(startIdx, startIdx + recordsPerPage);

      setYieldData(paginatedData);
    } catch (error) {
      console.error("Error fetching yield data:", error);
    } finally {
      setYieldLoading(false);
    }
  };

  const fetchStats = async () => {
    try {
      const [issueRes, inputRes] = await Promise.all([
        axios.get("/api/voucher/materialIssue", {
          params: { page: 1, limit: 1 },
        }),
        axios.get("/api/voucher/materialInput", {
          params: { page: 1, limit: 1 },
        }),
      ]);

      setStats({
        issueCount: issueRes.data.total || 0,
        inputCount: inputRes.data.total || 0,
        issueQty: issueRes.data.totalQty || 0,
        inputQty: inputRes.data.totalQty || 0,
      });
    } catch (error) {
      console.error("Error fetching stats:", error);
    }
  };

  const formatDate = (dateStr) => {
    if (!dateStr) return "-";
    return new Date(dateStr).toLocaleDateString("en-PK", {
      day: "2-digit",
      month: "short",
      year: "numeric",
    });
  };

  const goToPage = (page) => {
    if (activeTab === "yield") {
      setYieldCurrentPage(Math.max(1, Math.min(page, yieldTotalPages)));
    } else {
      setCurrentPage(Math.max(1, Math.min(page, totalPages)));
    }
  };

  const handleSearch = (value) => {
    setSearchTerm(value);
    setCurrentPage(1);
  };

  const handleRefresh = () => {
    if (activeTab === "yield") {
      fetchYieldData();
    } else {
      fetchData();
    }
    fetchStats();
  };

  // "/" focuses the search (Ctrl+K is the header's menu search).
  const searchRef = useRef(null);
  useEffect(() => {
    const onKey = (e) => {
      const typing = /^(INPUT|TEXTAREA|SELECT)$/.test(e.target?.tagName) || e.target?.isContentEditable;
      if (e.key === "/" && !typing && !e.ctrlKey && !e.metaKey && !e.altKey) {
        e.preventDefault();
        searchRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const skeletonRows = (cols) =>
    Array.from({ length: 6 }, (_, i) => (
      <tr key={`sk-${i}`}>
        <td colSpan={cols} className="px-3 py-3"><Skeleton className="h-6 w-full rounded-md" /></td>
      </tr>
    ));

  const renderDataTable = (data, type) => {
    const isIssue = type === "issue";
    const code = isIssue ? ISSUE_CODE : INPUT_CODE;
    const pageTotal = data.reduce((s, t) => s + qtyOf(t), 0);

    return (
      <div className="max-h-[70vh] overflow-auto">
        <table className="vl-grid w-full text-sm">
          <thead>
            <tr>
              <th className={TH}>Date</th>
              <th className={TH}>Tran ID</th>
              <th className={TH}>Process order #</th>
              <th className={TH}>Warehouse</th>
              <th className={TH}>User</th>
              <th className={TH}>Items</th>
              <th className={`${TH} text-right`}>Total Qty</th>
              <th className={`${TH} text-right`}>Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {loading && data.length === 0 ? skeletonRows(8) : data.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <LabEmpty
                    icon={Package}
                    title={searchTerm ? "No records found matching your search" : `No ${isIssue ? "issues" : "inputs"} found`}
                    hint={searchTerm ? "Try another transaction ID." : null}
                  />
                </td>
              </tr>
            ) : data.map((transaction, index) => {
              const totalQty = qtyOf(transaction);
              const productCount = transaction.transactions?.length || 0;

              return (
                <tr key={index} className="transition-colors hover:bg-muted/40">
                  <td className={`${TD} whitespace-nowrap tabular-nums`} data-label="Date">{formatDate(transaction.dated)}</td>
                  <td className={TD} data-label="Tran ID"><span className={CODE_CHIP}>{transaction.tran_id}</span></td>
                  <td className={TD} data-label="Process order #">
                    {poRefOf(transaction) ? <span className="font-mono text-[12.5px]">{poRefOf(transaction)}</span> : <span className="text-muted-foreground">—</span>}
                  </td>
                  <td className={TD} data-label="Warehouse">
                    <span className="inline-flex items-center gap-1.5">
                      <Package className="h-3.5 w-3.5 flex-shrink-0 text-muted-foreground" />
                      {transaction.godownDetails?.godown || "-"}
                    </span>
                  </td>
                  <td className={TD} data-label="User">
                    <Chip tone="muted" className="font-medium">{transaction.user_id || "-"}</Chip>
                  </td>
                  <td className={TD} data-label="Items">
                    <Chip tone="brand"><Box className="h-3 w-3" />{productCount} items</Chip>
                  </td>
                  <td className={`${TD} ${NUM} font-semibold text-foreground`} data-label="Total Qty">
                    {totalQty.toLocaleString()}
                  </td>
                  <td className={`${TD} vl-actions whitespace-nowrap text-right`}>
                    <div className="inline-flex items-center gap-0.5">
                      <button
                        type="button"
                        onClick={() => setSelectedTransaction(transaction)}
                        title="View all items details"
                        aria-label={`View details of ${transaction.tran_id}`}
                        className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-primary/10 hover:text-primary"
                      >
                        <Eye className="h-3.5 w-3.5" />
                      </button>
                      <VoucherLink row={transaction} code={code} />
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
          {data.length > 0 && (
            <tfoot className="max-md:hidden">
              <tr className={TOTAL_ROW}>
                <td className={TD} colSpan={6}>Total · this page</td>
                <td className={`${TD} ${NUM}`}>{pageTotal.toLocaleString()}</td>
                <td className={TD} />
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    );
  };

  const effTone = (e) => (e >= 90 ? "ok" : e >= 70 ? "warn" : "bad");

  const renderYieldTable = (data) => (
    <div className="max-h-[70vh] overflow-auto">
      <table className="vl-grid w-full text-sm">
        <thead>
          <tr>
            <th className={TH}>Date</th>
            <th className={TH}>Production #</th>
            <th className={TH}>Issue Tran ID</th>
            <th className={TH}>Input Tran ID</th>
            <th className={`${TH} text-right`}>Issued Qty</th>
            <th className={`${TH} text-right`}>Produced Qty</th>
            <th className={`${TH} text-right`}>Wastage</th>
            <th className={`${TH} text-right`}>Efficiency</th>
            <th className={`${TH} text-right`}>Action</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-border">
          {yieldLoading && data.length === 0 ? skeletonRows(9) : data.length === 0 ? (
            <tr>
              <td colSpan={9}>
                <LabEmpty icon={Activity} title="No production yield records found" hint="A production shows here once both its issue and its input are posted." />
              </td>
            </tr>
          ) : data.map((item, index) => {
            const issueQty = qtyOf(item.issue);
            const inputQty = qtyOf(item.input);
            const wastage = issueQty - inputQty;
            const efficiency =
              issueQty > 0 ? ((inputQty / issueQty) * 100).toFixed(1) : 0;

            return (
              <tr key={index} className="transition-colors hover:bg-muted/40">
                <td className={`${TD} whitespace-nowrap tabular-nums`} data-label="Date">{formatDate(item.date)}</td>
                <td className={`${TD} font-semibold text-foreground`} data-label="Production #">{item.production_no}</td>
                <td className={TD} data-label="Issue Tran ID">
                  <span className="inline-flex items-center gap-0.5">
                    <span className={CODE_CHIP}>{item.issue.tran_id}</span>
                    <VoucherLink row={item.issue} code={ISSUE_CODE} label="Open material issue" />
                  </span>
                </td>
                <td className={TD} data-label="Input Tran ID">
                  <span className="inline-flex items-center gap-0.5">
                    <span className={CODE_CHIP}>{item.input.tran_id}</span>
                    <VoucherLink row={item.input} code={INPUT_CODE} label="Open material input" />
                  </span>
                </td>
                <td className={`${TD} ${NUM}`} data-label="Issued Qty">{issueQty.toLocaleString()}</td>
                <td className={`${TD} ${NUM} font-semibold`} data-label="Produced Qty">{inputQty.toLocaleString()}</td>
                <td className={`${TD} ${NUM}`} data-label="Wastage">
                  <Chip tone={wastage > 0 ? "warn" : "ok"} className="tabular-nums">{wastage.toLocaleString()}</Chip>
                </td>
                <td className={`${TD} ${NUM}`} data-label="Efficiency">
                  <Chip tone={effTone(efficiency)} className="tabular-nums">{efficiency}%</Chip>
                </td>
                <td className={`${TD} vl-actions text-right`}>
                  <Button size="sm" variant="outline" className="h-8 gap-1.5" onClick={() => setSelectedProduction(item)}>
                    <Eye className="h-3.5 w-3.5" />Details
                  </Button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );

  const currentData = activeTab === "issue" ? issueData : inputData;
  const startIndex = (currentPage - 1) * recordsPerPage;
  const endIndex = Math.min(startIndex + recordsPerPage, totalRecords);

  const yieldStartIndex = (yieldCurrentPage - 1) * recordsPerPage;
  const yieldEndIndex = Math.min(
    yieldStartIndex + recordsPerPage,
    yieldTotalRecords
  );

  const isYield = activeTab === "yield";
  const pg = {
    current: isYield ? yieldCurrentPage : currentPage,
    total: isYield ? yieldTotalPages : totalPages,
    busy: isYield ? yieldLoading : loading,
    from: isYield ? yieldStartIndex + 1 : startIndex + 1,
    to: isYield ? yieldEndIndex : endIndex,
    count: isYield ? yieldTotalRecords : totalRecords,
  };
  const TAB_BTN = (on) =>
    cn(
      "relative flex items-center gap-1.5 whitespace-nowrap border-b-2 px-3 pb-2.5 pt-3 text-sm font-medium transition-colors",
      on ? "border-primary text-primary" : "border-transparent text-muted-foreground hover:text-foreground",
    );

  return (
    <div className="min-h-screen bg-muted/40">
      <main className="mx-auto max-w-[1600px] space-y-5 px-3 py-5 sm:px-6">
        <LabHeader
          icon={Factory}
          breadcrumb="Accounting"
          title="Material Management"
          subtitle="Material Issue, Input & Yield Analysis"
          actions={
            <Button variant="outline" size="sm" className="h-9" onClick={handleRefresh} disabled={loading || yieldLoading}>
              <RefreshCw className={cn("mr-1.5 h-4 w-4", (loading || yieldLoading) && "animate-spin")} />
              Refresh
            </Button>
          }
        />

        {/* Stat tiles change with the tab */}
        {isYield ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <LabStat label="Productions" value={yieldStats.totalProductions} icon={Activity} tone="brand" />
            <LabStat label="Total Issued" value={yieldStats.totalIssued.toLocaleString()} icon={ArrowUpCircle} tone="brand" />
            <LabStat label="Total Produced" value={yieldStats.totalProduced.toLocaleString()} icon={ArrowDownCircle} tone="ok" />
            <LabStat label="Total Wastage" value={yieldStats.totalWastage.toLocaleString()} icon={AlertTriangle} tone={yieldStats.totalWastage > 0 ? "warn" : "ok"} />
            <LabStat label="Avg Efficiency" value={`${yieldStats.avgEfficiency}%`} icon={TrendingUp} tone="muted" />
          </div>
        ) : (
          <div className="grid grid-cols-2 gap-3">
            <LabStat label="Material Issue" value={stats.issueCount} icon={ArrowUpCircle} tone="brand" hint="Vouchers posted" />
            <LabStat label="Material Input" value={stats.inputCount} icon={ArrowDownCircle} tone="ok" hint="Vouchers posted" />
          </div>
        )}

        <section className="overflow-clip rounded-xl border border-border bg-background">
          {/* Tabs */}
          <div className={cn(TABS_SCROLL, "border-b border-border px-3 sm:px-3")}>
            <div role="tablist" aria-label="View" className="inline-flex w-max min-w-full gap-1">
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "issue"}
                onClick={() => {
                  setActiveTab("issue");
                  setCurrentPage(1);
                }}
                className={TAB_BTN(activeTab === "issue")}
              >
                <ArrowUpCircle className="h-4 w-4" />
                Material Issue <span className="tabular-nums">({stats.issueCount})</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeTab === "input"}
                onClick={() => {
                  setActiveTab("input");
                  setCurrentPage(1);
                }}
                className={TAB_BTN(activeTab === "input")}
              >
                <ArrowDownCircle className="h-4 w-4" />
                Material Input <span className="tabular-nums">({stats.inputCount})</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={isYield}
                onClick={() => {
                  setActiveTab("yield");
                  setYieldCurrentPage(1);
                }}
                className={TAB_BTN(isYield)}
              >
                <BarChart3 className="h-4 w-4" />
                Yield Analysis
              </button>
            </div>
          </div>

          {/* Toolbar — search only for Issue / Input */}
          {!isYield && (
            <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
              <label className="flex h-9 min-w-[200px] flex-1 items-center gap-2 rounded-lg border border-border px-3 text-muted-foreground focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 sm:max-w-md">
                <Search className="h-4 w-4 flex-shrink-0" />
                <input
                  ref={searchRef}
                  type="text"
                  placeholder="Search by Transaction ID..."
                  aria-label="Search by transaction ID"
                  value={searchTerm}
                  onChange={(e) => handleSearch(e.target.value)}
                  onKeyDown={(e) => e.key === "Escape" && handleSearch("")}
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
                />
                {searchTerm ? (
                  <button type="button" onClick={() => handleSearch("")} aria-label="Clear search" className="hover:text-foreground">
                    <X className="h-4 w-4" />
                  </button>
                ) : (
                  <kbd className="hidden rounded border border-b-2 border-border px-1.5 font-mono text-[10.5px] sm:inline">/</kbd>
                )}
              </label>
              {loading && currentData.length > 0 && (
                <span className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
                  <RefreshCw className="h-3.5 w-3.5 animate-spin" />Loading…
                </span>
              )}
            </div>
          )}
          {isYield && yieldLoading && yieldData.length > 0 && (
            <div className="flex items-center gap-1.5 border-b border-border px-3 py-2 text-xs text-muted-foreground">
              <RefreshCw className="h-3.5 w-3.5 animate-spin" />Loading…
            </div>
          )}

          {/* Data table */}
          {isYield ? renderYieldTable(yieldData) : renderDataTable(currentData, activeTab)}

          {/* Pagination */}
          {pg.total > 1 && (
            <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border bg-muted/30 px-4 py-3">
              <div className="text-sm tabular-nums text-muted-foreground">
                Showing {pg.from} to {pg.to} of {pg.count} records
              </div>

              <div className="flex flex-wrap items-center gap-1">
                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Previous page"
                  onClick={() => goToPage(pg.current - 1)}
                  disabled={pg.current === 1 || pg.busy}
                >
                  <ChevronLeft className="h-4 w-4" />
                </Button>

                {[...Array(pg.total)].map((_, i) => {
                  const page = i + 1;
                  if (
                    page === 1 ||
                    page === pg.total ||
                    (page >= pg.current - 1 && page <= pg.current + 1)
                  ) {
                    return (
                      <Button
                        key={page}
                        size="sm"
                        variant={pg.current === page ? "default" : "outline"}
                        onClick={() => goToPage(page)}
                        disabled={pg.busy}
                        aria-current={pg.current === page ? "page" : undefined}
                        className={cn("h-8 min-w-8 px-2 tabular-nums", pg.current === page && "bg-primary text-primary-foreground hover:bg-primary/90")}
                      >
                        {page}
                      </Button>
                    );
                  } else if (page === pg.current - 2 || page === pg.current + 2) {
                    return (
                      <span key={page} className="px-1 text-muted-foreground">
                        …
                      </span>
                    );
                  }
                  return null;
                })}

                <Button
                  variant="outline"
                  size="icon"
                  className="h-8 w-8"
                  aria-label="Next page"
                  onClick={() => goToPage(pg.current + 1)}
                  disabled={pg.current === pg.total || pg.busy}
                >
                  <ChevronRight className="h-4 w-4" />
                </Button>
              </div>
            </div>
          )}
        </section>

        {/* Transaction Details Modal */}
        <TransactionDetailsModal
          transaction={selectedTransaction}
          code={activeTab === "issue" ? ISSUE_CODE : INPUT_CODE}
          onClose={() => setSelectedTransaction(null)}
        />

        {/* Production Details Modal */}
        <ProductionDetailsModal
          production={selectedProduction}
          onClose={() => setSelectedProduction(null)}
        />
      </main>
    </div>
  );
};

export default MaterialDataViewer;
