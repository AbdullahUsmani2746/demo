"use client";
// Show Account: the read-only chart of accounts as one list — balance-sheet
// category, main account and its sub accounts — with Excel / PDF export.
// Under md every row becomes a card (table.vl-grid in app/globals.css).
import { useState, useEffect, useRef } from "react";
import { Button } from "@/components/ui/button";
import { jsPDF } from "jspdf";
import ReactSelect from "react-select";
import {
  FileText,
  FileSpreadsheet,
  AlertCircle,
  Loader2,
  ChevronLeft,
  ChevronRight,
  Eye,
  Database,
  ListTree,
  RefreshCw,
  Search,
  X,
} from "lucide-react";
import ExcelJS from "exceljs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { selectStyles } from "@/components/shared/EntityFormPanel";
import axios from "axios";
import { toast } from "sonner";
import { useCompany } from "@/context/CompanyContext";
import { useSession } from "next-auth/react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";

const ChartOfAccountsView = () => {
  const [exportLoading, setExportLoading] = useState(false);
  const [exporting, setExporting] = useState(null); // "excel" | "pdf" — which button spins

  const { company } = useCompany();
  const { data: session } = useSession();
  const queryClient = useQueryClient();

  // "Show Off Accounts" is a single database-persisted switch shared with the
  // Chart of Accounts management page (Settings key "show_off_accounts").
  // Toggling it here affects that page too, and vice versa.
  const canManageVisibility = !!session?.user;
  const { data: visibilitySetting } = useQuery({
    queryKey: ["account-visibility-setting"],
    queryFn: async () => {
      const response = await axios.get("/api/settings/account-visibility");
      return response.data.data;
    },
  });
  const showInactive = visibilitySetting?.showOffAccounts ?? false;
  const includeInactive = canManageVisibility && showInactive;

  const toggleShowInactiveMutation = useMutation({
    mutationFn: (nextValue) =>
      axios.put("/api/settings/account-visibility", {
        showOffAccounts: nextValue,
      }),
    onSuccess: () => {
      // Object form: the v4 array form invalidated every query in the app.
      // Lists keyed on the setting (here and on Chart of Accounts) follow it.
      queryClient.invalidateQueries({ queryKey: ["account-visibility-setting"] });
      queryClient.invalidateQueries({ queryKey: ["accountData"] });
      queryClient.invalidateQueries({ queryKey: ["allAccountData"] });
    },
    onError: (error) => {
      toast.error("Failed to update Show Off Accounts setting", {
        description: error.response?.data?.error || error.message,
      });
    },
  });



  // Pagination state
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [totalItems, setTotalItems] = useState(0);
  const [selectedSubAccounts, setSelectedSubAccounts] = useState(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [subFilter, setSubFilter] = useState("");
  const [search, setSearch] = useState("");
  const [searchInput, setSearchInput] = useState(""); // what is typed; becomes `search` after a pause
  const searchRef = useRef(null);
  const [itemsPerPage, setItemsPerPage] = useState(30);
  // Worked out from the total, so a cached page / page-size switch never
  // leaves a stale page count behind.
  const pageCount = Math.max(1, Math.ceil(totalItems / itemsPerPage));

  // TanStack Query: Fetch paginated account data
  const {
    data: accountData = [],
    isLoading: loading,
    isFetching: fetching,
    isError,
    error: queryError,
    refetch: refetchAccountData,
  } = useQuery({
    queryKey: ["accountData", currentPage, itemsPerPage, search, includeInactive],
    queryFn: async () => {
      const response = await axios.get(`/api/accounts/paged`, {
        params: {
          page: currentPage,
          limit: itemsPerPage,
          search: search,
          ...(includeInactive ? { includeInactive: true } : {}),
        },
        timeout: 10000,
      });

      if (response.data?.success) {
        setTotalItems(response.data.pagination?.total || 0);
        setTotalPages(
          Math.ceil((response.data.pagination?.total || 0) / itemsPerPage),
        );
        return response.data.data || [];
      } else {
        throw new Error(response.data?.message || "Failed to fetch data");
      }
    },
    staleTime: 2 * 60 * 1000, // 2 minutes
    gcTime: 5 * 60 * 1000, // 5 minutes
    retry: 2,
  });

  // TanStack Query v5 dropped `onError` on useQuery, so the old handler never
  // ran and a failed load showed as "no data". Toast it from here instead.
  useEffect(() => {
    if (!isError) return;
    console.error("Error fetching data:", queryError);
    toast.error("Error loading data", { description: errText(queryError) });
  }, [isError, queryError]);

  // TanStack Query: Fetch all accounts for export
  const { data: allAccountData = [] } = useQuery({
    queryKey: ["allAccountData", includeInactive],
    queryFn: async () => {
      const response = await axios.get("/api/accounts/all", {
        params: includeInactive ? { includeInactive: true } : {},
        timeout: 30000,
      });

      if (response.data?.success) {
        return response.data.data || [];
      } else {
        throw new Error(
          response.data?.message || "Failed to fetch export data",
        );
      }
    },
    enabled: false, // Don't fetch automatically, only when needed
    staleTime: 5 * 60 * 1000, // 5 minutes
    gcTime: 10 * 60 * 1000, // 10 minutes
  });

  // Handle page change
  const handlePageChange = (page) => {
    if (page >= 1 && page <= pageCount && page !== currentPage) {
      setCurrentPage(page);
      // TanStack Query will automatically refetch with new page
    }
  };

  // Prepare export data
  const prepareExportData = (data) => {
    return data.flatMap((item) => {
      const balanceSheetCode = item.balanceSheetCode || "";
      const balanceSheetCategory = item.balanceSheetCategory || "";
      const mainAccounts = item.mainAccounts || "";
      const subAccounts = Array.isArray(item.subAccounts)
        ? item.subAccounts
        : [];

      // Extract number from main account (e.g., "6 DEPRICABLE FIXED ASSETS" -> "6")
      const extractNumber = (text) => {
        if (!text) return "";
        const match = text.toString().match(/^(\d+)/);
        return match ? match[1] : "";
      };

      // Extract text without number (e.g., "6 DEPRICABLE FIXED ASSETS" -> "DEPRICABLE FIXED ASSETS")
      const extractText = (text) => {
        if (!text) return "";
        return text.toString().replace(/^\d+\s*/, "");
      };

      const mainAccountNumber = extractNumber(mainAccounts);
      const mainAccountText = extractText(mainAccounts);

      if (subAccounts.length === 0) {
        return [
          {
            "Balance Sheet Code": balanceSheetCode,
            "Balance Sheet Category": balanceSheetCategory,
            "Main Acc No": mainAccountNumber,
            "Main Account": mainAccountText,
            "Sub Acc No": "",
            "Sub Account": "",
          },
        ];
      }

      return subAccounts.map((subAccount) => {
        const subAccountNumber = extractNumber(subAccount);
        const subAccountText = extractText(subAccount);

        return {
          "Balance Sheet Code": balanceSheetCode,
          "Balance Sheet Category": balanceSheetCategory,
          "Main Acc No": mainAccountNumber,
          "Main Account": mainAccountText,
          "Sub Acc No": subAccountNumber,
          "Sub Account": subAccountText,
        };
      });
    });
  };

  // Export to Excel - Modern Professional Styling
  const exportToExcel = async () => {
    try {
      setExportLoading(true);

      // Check if we're in a browser environment
      if (typeof window === "undefined") {
        throw new Error("Export is only available in browser environment");
      }

      let companyName = company?.name || "Company";

      // Get cached data or fetch fresh (matches what's currently shown on screen)
      const exportData = await queryClient.fetchQuery({
        queryKey: ["allAccountData", includeInactive],
        queryFn: async () => {
          const response = await axios.get("/api/accounts/all", {
            params: includeInactive ? { includeInactive: true } : {},
            timeout: 30000,
          });
          if (response.data?.success) {
            return response.data.data || [];
          }
          throw new Error(
            response.data?.message || "Failed to fetch export data",
          );
        },
      });

      if (exportData.length === 0) {
        toast.warning("No data available for export");
        return;
      }

      const flatData = prepareExportData(exportData);
      const headers = Object.keys(flatData[0] || {});

      // Create new workbook and worksheet
      const workbook = new ExcelJS.Workbook();
      const worksheet = workbook.addWorksheet("Chart of Accounts", {
        pageSetup: {
          paperSize: 9, // A4
          orientation: "portrait",
          margins: {
            left: 0.7,
            right: 0.7,
            top: 0.75,
            bottom: 0.75,
            header: 0.3,
            footer: 0.3,
          },
        },
      });

      // Current date and time
      const currentDate = new Date().toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
      });
      const currentTime = new Date().toLocaleTimeString("en-US", {
        hour: "2-digit",
        minute: "2-digit",
      });

      // Set workbook properties
      workbook.creator = companyName;
      workbook.lastModifiedBy = "Chart of Accounts System";
      workbook.created = new Date();
      workbook.modified = new Date();
      workbook.subject = "Financial Report - Chart of Accounts";
      workbook.title = "Chart of Accounts Export";
      workbook.category = "Financial Reports";

      // Modern gradient-style company header (Row 1)
      worksheet.mergeCells(
        "A1",
        `${String.fromCharCode(65 + headers.length - 1)}1`,
      );
      const companyCell = worksheet.getCell("A1");
      companyCell.value = companyName;
      companyCell.style = {
        font: {
          name: "Segoe UI",
          size: 22,
          bold: true,
          color: { argb: "FF1A365D" }, // Dark blue
        },
        fill: {
          type: "gradient",
          gradient: "angle",
          degree: 90,
          stops: [
            { position: 0, color: { argb: "FFF7FAFC" } }, // Light gray-blue
            { position: 1, color: { argb: "FFE2E8F0" } }, // Slightly darker
          ],
        },
        alignment: {
          horizontal: "center",
          vertical: "middle",
        },
      };

      // Modern report title with accent color (Row 2)
      worksheet.mergeCells(
        "A2",
        `${String.fromCharCode(65 + headers.length - 1)}2`,
      );
      const titleCell = worksheet.getCell("A2");
      titleCell.value = "CHART OF ACCOUNTS";
      titleCell.style = {
        font: {
          name: "Segoe UI Semibold",
          size: 18,
          bold: true,
          color: { argb: "FFFFFFFF" }, // White text
        },
        fill: {
          type: "gradient",
          gradient: "angle",
          degree: 45,
          stops: [
            { position: 0, color: { argb: "FF3182CE" } }, // Blue
            { position: 1, color: { argb: "FF2C5282" } }, // Darker blue
          ],
        },
        alignment: {
          horizontal: "center",
          vertical: "middle",
        },
      };

      // Modern date and info row (Row 3)
      worksheet.mergeCells(
        "A3",
        `${String.fromCharCode(65 + headers.length - 1)}3`,
      );
      const dateCell = worksheet.getCell("A3");
      dateCell.value = `Report Generated: ${currentDate} at ${currentTime} | Total Records: ${flatData.length}`;
      dateCell.style = {
        font: {
          name: "Segoe UI",
          size: 11,
          italic: true,
          color: { argb: "FF4A5568" }, // Gray
        },
        fill: {
          type: "pattern",
          pattern: "solid",
          fgColor: { argb: "FFF8FAFC" }, // Very light gray
        },
        alignment: {
          horizontal: "center",
          vertical: "middle",
        },
      };

      // Spacing row (Row 4)
      const spacingRow = worksheet.getRow(4);
      spacingRow.eachCell((cell) => {
        cell.style = {
          fill: {
            type: "pattern",
            pattern: "solid",
            fgColor: { argb: "FFFFFFFF" },
          },
        };
      });

      // Modern table headers with gradient (Row 5)
      const headerRow = worksheet.getRow(5);
      headers.forEach((header, index) => {
        const cell = headerRow.getCell(index + 1);
        cell.value = header.toUpperCase().replace(/_/g, " ");
        cell.style = {
          font: {
            name: "Segoe UI Semibold",
            size: 11,
            bold: true,
            color: { argb: "FFFFFFFF" },
          },
          fill: {
            type: "gradient",
            gradient: "angle",
            degree: 90,
            stops: [
              { position: 0, color: { argb: "FF2D3748" } }, // Dark gray
              { position: 1, color: { argb: "FF4A5568" } }, // Medium gray
            ],
          },
          alignment: {
            horizontal: "center",
            vertical: "middle",
            wrapText: true,
          },
          border: {
            top: { style: "thick", color: { argb: "FF1A202C" } },
            bottom: { style: "thick", color: { argb: "FF1A202C" } },
            left: { style: "medium", color: { argb: "FF2D3748" } },
            right: { style: "medium", color: { argb: "FF2D3748" } },
          },
        };
      });

      // Modern data rows with subtle styling
      flatData.forEach((dataRow, rowIndex) => {
        const excelRow = worksheet.getRow(rowIndex + 6);
        const isAlternateRow = rowIndex % 2 === 1;

        headers.forEach((header, colIndex) => {
          const cell = excelRow.getCell(colIndex + 1);
          cell.value = dataRow[header] || "";

          // Apply modern styling
          cell.style = {
            font: {
              name: "Segoe UI",
              size: 10,
              color: { argb: "FF2D3748" }, // Dark text
            },
            fill: {
              type: "pattern",
              pattern: "solid",
              fgColor: { argb: isAlternateRow ? "FFF7FAFC" : "FFFFFFFF" }, // Very subtle alternating
            },
            alignment: {
              horizontal: colIndex === 0 ? "center" : "left", // First column centered
              vertical: "middle",
              wrapText: true,
              indent: colIndex === 0 ? 0 : 1,
            },
            border: {
              top: { style: "thin", color: { argb: "FFE2E8F0" } },
              bottom: { style: "thin", color: { argb: "FFE2E8F0" } },
              left: { style: "thin", color: { argb: "FFE2E8F0" } },
              right: { style: "thin", color: { argb: "FFE2E8F0" } },
            },
          };

          // Special styling for first column (codes)
          if (colIndex === 0) {
            cell.style.font.bold = true;
            cell.style.font.color = { argb: "FF3182CE" }; // Blue color for codes
          }
        });
      });

      // Add bottom border to last data row
      const lastDataRowIndex = flatData.length + 5;
      const lastRow = worksheet.getRow(lastDataRowIndex);
      lastRow.eachCell((cell) => {
        if (cell.style.border) {
          cell.style.border.bottom = {
            style: "thick",
            color: { argb: "FF2D3748" },
          };
        }
      });

      // Set optimized column widths
      headers.forEach((header, index) => {
        let maxWidth = header.length + 3;

        // Check data for max width
        flatData.forEach((row) => {
          const cellValue = String(row[header] || "");
          if (cellValue.length > maxWidth) {
            maxWidth = cellValue.length;
          }
        });

        // Set specific widths for number columns
        if (header.includes("Acc No")) {
          worksheet.getColumn(index + 1).width = 16;
        } else if (header.includes("Balance Sheet")) {
          worksheet.getColumn(index + 1).width = 25;
        } else if (header.includes("Account")) {
          worksheet.getColumn(index + 1).width = 40;
        } else {
          const columnWidth = Math.min(Math.max(maxWidth + 3, 15), 55);
          worksheet.getColumn(index + 1).width = columnWidth;
        }
      });

      // Set optimized row heights for modern look
      worksheet.getRow(1).height = 45; // Company header - taller
      worksheet.getRow(2).height = 35; // Report title
      worksheet.getRow(3).height = 25; // Date info
      worksheet.getRow(4).height = 8; // Spacing
      worksheet.getRow(5).height = 30; // Headers - taller for better readability

      // Set data row heights with better spacing
      for (let i = 6; i <= flatData.length + 5; i++) {
        worksheet.getRow(i).height = 24;
      }

      // Add conditional formatting for better visual hierarchy
      worksheet.addConditionalFormatting({
        ref: `A6:${String.fromCharCode(65 + headers.length - 1)}${flatData.length + 5
          }`,
        rules: [
          {
            type: "expression",
            formulae: ["MOD(ROW(),2)=0"],
            style: {
              fill: {
                type: "pattern",
                pattern: "solid",
                fgColor: { argb: "FFF7FAFC" },
              },
            },
          },
        ],
      });

      // Generate modern filename
      const timestamp = new Date().toISOString().split("T")[0];
      const cleanCompanyName = companyName
        .replace(/[^a-zA-Z0-9 ]/g, "")
        .replace(/\s+/g, "_");
      const filename = `${cleanCompanyName}_ChartOfAccounts_${timestamp}.xlsx`;

      // Write file with compression
      const buffer = await workbook.xlsx.writeBuffer({
        compression: 6, // Good compression
      });

      const blob = new Blob([buffer], {
        type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      });

      // Create download link
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = filename;

      // Trigger download
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      window.URL.revokeObjectURL(url);

      toast.success(" Excel Export Completed!", {
        description: `Modern professional report "${filename}" downloaded successfully with ${flatData.length} records.`,
        duration: 4000,
      });
    } catch (error) {
      console.error("Excel export error:", error);
      toast.error(" Excel Export Failed", {
        description:
          error.message ||
          "Unable to generate Excel report. Please check your connection and try again.",
        duration: 5000,
      });
    } finally {
      setExportLoading(false);
    }
  };

  const exportToPDF = async () => {
    try {
      setExportLoading(true);

      if (typeof window === "undefined") {
        throw new Error("Export is only available in browser environment");
      }

      // Use company from context
      let companyName = company?.name || "Company";

      // Prefetch all account data for PDF (matches what's currently shown on screen)
      const exportData = await queryClient.fetchQuery({
        queryKey: ["allAccountData", includeInactive],
        queryFn: async () => {
          const response = await axios.get("/api/accounts/all", {
            params: includeInactive ? { includeInactive: true } : {},
            timeout: 30000,
          });
          if (response.data?.success) {
            return response.data.data || [];
          }
          throw new Error(
            response.data?.message || "Failed to fetch export data",
          );
        },
      });

      if (exportData.length === 0) {
        toast.warning("No data available for export");
        return;
      }

      // === Prepare PDF Data (using same prepareExportData function as Excel) ===
      const preparePdfData = (data) => {
        const rows = [];

        // Helper functions to extract number and text
        const extractNumber = (text) => {
          if (!text) return "";
          const match = text.toString().match(/^(\d+)/);
          return match ? match[1] : "";
        };

        const extractText = (text) => {
          if (!text) return "";
          return text.toString().replace(/^\d+\s*/, "");
        };

        data.forEach((item) => {
          const mainAccNumber = extractNumber(item.mainAccounts || "");
          const mainAccText = extractText(item.mainAccounts || "");

          if (Array.isArray(item.subAccounts) && item.subAccounts.length > 0) {
            item.subAccounts.forEach((subAcc) => {
              const subAccNumber = extractNumber(subAcc || "");
              const subAccText = extractText(subAcc || "");

              rows.push({
                "BAL SHEET CODE": item.balanceSheetCode || item.code || "-",
                "BAL SHEET CAT":
                  item.balanceSheetCategory || item.category || "-",
                "MAIN ACC NO": mainAccNumber || "-",
                "MAIN ACCOUNT": mainAccText || "-",
                "SUB ACC NO": subAccNumber || "-",
                "SUB ACCOUNTS": subAccText || "-",
              });
            });
          } else {
            const subAccNumber = extractNumber(item.subAccounts || "");
            const subAccText = extractText(item.subAccounts || "");

            rows.push({
              "BAL SHEET CODE": item.balanceSheetCode || item.code || "-",
              "BAL SHEET CAT":
                item.balanceSheetCategory || item.category || "-",
              "MAIN ACC NO": mainAccNumber || "-",
              "MAIN ACCOUNT": mainAccText || "-",
              "SUB ACC NO": subAccNumber || "-",
              "SUB ACCOUNTS": subAccText || "-",
            });
          }
        });
        return rows;
      };

      const flatData = preparePdfData(exportData);
      const headers = Object.keys(flatData[0] || {});

      // === PDF Setup ===
      const doc = new jsPDF({
        unit: "mm",
        format: "a4",
        orientation: "landscape",
      });
      const pageWidth = 297;
      const pageHeight = 210;
      const margin = 10;
      const colors = {
        primary: [33, 82, 156],
        secondary: [241, 90, 34],
        lightBg: [248, 249, 250],
        darkText: [33, 37, 41],
        border: [206, 212, 218],
        white: [255, 255, 255],
      };

      // === Header ===
      const drawHeader = (pageNumber = 1, totalPages = 1) => {
        doc.setFillColor(...colors.primary);
        doc.rect(0, 0, pageWidth, 25, "F");
        doc.setFont("helvetica", "bold");
        doc.setFontSize(20);
        doc.setTextColor(...colors.white);
        doc.text(companyName, pageWidth / 2, 16, { align: "center" });

        doc.setFillColor(...colors.lightBg);
        doc.rect(0, 25, pageWidth, 15, "F");
        doc.setFontSize(16);
        doc.setTextColor(...colors.primary);
        doc.text("CHART OF ACCOUNTS", pageWidth / 2, 35, { align: "center" });

        const currentDate = new Date().toLocaleDateString("en-US", {
          year: "numeric",
          month: "long",
          day: "numeric",
        });

        doc.setFont("helvetica", "normal");
        doc.setFontSize(10);
        doc.setTextColor(...colors.darkText);

        doc.text(`Generated: ${currentDate}`, margin, 48);
        doc.text(`Total Records: ${flatData.length}`, margin, 53);
        doc.text(`User: ${session?.user?.name}`, margin, 58);

        doc.text(
          `Page ${pageNumber} of ${totalPages}`,
          pageWidth - margin,
          48,
          { align: "right" },
        );
        doc.text(
          `Report Time: ${new Date().toLocaleTimeString()}`,
          pageWidth - margin,
          53,
          { align: "right" },
        );

        return 60;
      };

      // === Pagination & Rendering ===
      const rowHeight = 9;
      const headerHeight = 60;
      const footerHeight = 20;
      const availableHeight = pageHeight - headerHeight - footerHeight;
      const rowsPerPage = Math.floor(availableHeight / rowHeight);

      const totalPages = Math.ceil(flatData.length / rowsPerPage);
      let currentPage = 1;
      let dataIndex = 0;

      while (dataIndex < flatData.length) {
        if (currentPage > 1) doc.addPage();

        let currentY = drawHeader(currentPage, totalPages) + 5;

        // --- Table Header ---
        const colWidths = [50, 50, 25, 55, 25, 50];
        let curX = margin;

        headers.forEach((header, index) => {
          // Rectangle background
          doc.setFillColor(...colors.primary);
          doc.setDrawColor(...colors.white);
          doc.rect(curX, currentY, colWidths[index], 10, "FD");

          // Header text
          doc.setFont("helvetica", "bold");
          doc.setFontSize(10);
          doc.setTextColor(...colors.white);

          let headerText = header.toUpperCase().replace(/_/g, " ");
          // Shorten headers if needed
          if (headerText === "BAL SHEET CODE") headerText = "BAL SHEET CODE";
          if (headerText === "BAL SHEET CAT") headerText = "BAL SHEET CATEGORY";
          if (headerText === "MAIN ACC NO") headerText = "MAIN NO";
          if (headerText === "SUB ACC NO") headerText = "SUB NO";

          doc.text(headerText, curX + colWidths[index] / 2, currentY + 7, {
            align: "center",
          });

          curX += colWidths[index];
        });

        currentY += 10;

        // --- Table Rows ---
        let rowsOnThisPage = 0;
        while (
          dataIndex < flatData.length &&
          rowsOnThisPage < rowsPerPage &&
          currentY < pageHeight - footerHeight
        ) {
          const row = flatData[dataIndex];
          const isEven = rowsOnThisPage % 2 === 0;

          let curX = margin;
          headers.forEach((header, colIndex) => {
            const value = row[header] || "-";

            const bgColor = isEven ? colors.white : colors.lightBg;
            doc.setFillColor(...bgColor);
            doc.setDrawColor(...colors.border);
            doc.setLineWidth(0.1);

            doc.rect(curX, currentY, colWidths[colIndex], rowHeight, "F");

            // Text style
            doc.setFont("helvetica", "normal");
            doc.setFontSize(8);

            if (colIndex === 2 || colIndex === 4) {
              // Number columns (MAIN ACC NO, SUB ACC NO)
              doc.setFont("helvetica", "bold");
              doc.setTextColor(...colors.secondary);
              doc.text(
                String(value),
                curX + colWidths[colIndex] / 2,
                currentY + 5,
                { align: "center" },
              );
            } else if (colIndex === 0) {
              // Balance Sheet Code
              doc.setFont("helvetica", "bold");
              doc.setTextColor(...colors.primary);
              doc.text(String(value), curX + 2, currentY + 5);
            } else {
              doc.setFont("helvetica", "normal");
              doc.setTextColor(...colors.darkText);
              const maxWidth = colWidths[colIndex] - 4;
              const lines = doc.splitTextToSize(String(value), maxWidth);
              doc.text(lines, curX + 2, currentY + 5);
            }

            curX += colWidths[colIndex];
          });

          currentY += rowHeight;
          dataIndex++;
          rowsOnThisPage++;
        }

        // --- Footer ---
        doc.setFont("helvetica", "italic");
        doc.setFontSize(8);
        doc.setTextColor(...colors.border);
        doc.text(
          `Generated by Chart of Accounts System | ${companyName}`,
          pageWidth / 2,
          pageHeight - 10,
          { align: "center" },
        );

        currentPage++;
      }

      // === Save File ===
      const fileName = `${companyName
        .replace(/[^a-zA-Z0-9 ]/g, "")
        .replace(/\s+/g, "_")}_ChartOfAccounts_${new Date().toISOString().split("T")[0]
        }.pdf`;
      doc.save(fileName);

      toast.success("PDF Export Completed!", {
        description: `Professional PDF report "${fileName}" downloaded successfully with ${flatData.length} records.`,
        duration: 4000,
      });

      return {
        success: true,
        message: `PDF exported successfully with ${flatData.length} records`,
        filename: fileName,
      };
    } catch (error) {
      console.error("PDF export error:", error);
      toast.error("PDF Export Failed", {
        description:
          error.message ||
          "Unable to generate PDF report. Please check your connection and try again.",
        duration: 5000,
      });
      throw new Error(error.message || "Failed to generate PDF");
    } finally {
      setExportLoading(false);
    }
  };

  // Run an export from its button: remember which one is running so only that
  // button spins. exportToPDF re-throws after its own toast — swallow it here
  // so the click does not leave an unhandled rejection.
  const runExport = (kind, fn) => {
    setExporting(kind);
    Promise.resolve()
      .then(fn)
      .catch(() => {})
      .finally(() => setExporting(null));
  };

  // Five page buttons around the current page, like the setup lists.
  const pageWindow = (() => {
    let start = Math.max(1, currentPage - 2);
    const end = Math.min(pageCount, start + 4);
    start = Math.max(1, end - 4);
    return Array.from({ length: end - start + 1 }, (_, i) => start + i);
  })();

  const openSubAccountsModal = (subAccounts, mainAccount, category) => {
    setSelectedSubAccounts({
      subAccounts,
      mainAccount,
      category,
    });
    setSubFilter("");
    setIsModalOpen(true);
  };

  // The search box: typed text settles for 300 ms before it becomes the query
  // (one request per pause, not per key). Esc clears it.
  useEffect(() => {
    const t = setTimeout(() => {
      if (searchInput !== search) {
        setSearch(searchInput);
        setCurrentPage(1);
      }
    }, 300);
    return () => clearTimeout(t);
  }, [searchInput, search]);

  // "/" = focus the search, unless typing somewhere or the dialog is open.
  useEffect(() => {
    const onKey = (e) => {
      if (e.key !== "/" || e.ctrlKey || e.metaKey || e.altKey || isModalOpen) return;
      const t = e.target;
      if (/^(INPUT|TEXTAREA|SELECT)$/.test(t?.tagName) || t?.isContentEditable) return;
      e.preventDefault();
      searchRef.current?.focus();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [isModalOpen]);

  const subCountOnPage = accountData.reduce(
    (n, item) => n + (Array.isArray(item?.subAccounts) ? item.subAccounts.length : 0),
    0,
  );
  const firstRow = totalItems > 0 ? (currentPage - 1) * itemsPerPage + 1 : 0;
  const lastRow = Math.min(currentPage * itemsPerPage, totalItems);
  const exportDisabled = loading || exportLoading || accountData.length === 0;

  const subList = selectedSubAccounts
    ? selectedSubAccounts.subAccounts
        .map((s) => splitCode(s))
        .filter(
          (s) =>
            !subFilter.trim() ||
            `${s.code} ${s.name}`.toLowerCase().includes(subFilter.trim().toLowerCase()),
        )
    : [];
  const mainParts = splitCode(selectedSubAccounts?.mainAccount);

  return (
    <div className="min-h-screen bg-muted/40">
      <div className="mx-auto max-w-[1600px] px-3 py-5 sm:px-6">
        {/* Header */}
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <span className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#800000] to-[#5c0000] text-white shadow-md shadow-red-900/20">
              <ListTree className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="text-[12.5px] text-muted-foreground">Accounting · Show Account</p>
              <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight text-foreground">
                Chart of Accounts
                <span
                  className="inline-flex h-6 items-center rounded-full bg-primary/10 px-2.5 text-xs font-bold tabular-nums text-primary"
                  title="Main accounts"
                >
                  {totalItems}
                </span>
                {includeInactive && (
                  <span className="inline-flex h-6 items-center gap-1.5 rounded-full bg-[#f5f0e6] px-2.5 text-xs font-semibold text-[#5f4b1f]">
                    <span className="h-1.5 w-1.5 rounded-full bg-current" />
                    Off accounts shown
                  </span>
                )}
              </h1>
            </div>
          </div>
          <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto">
            {canManageVisibility && (
              <label
                className="flex h-10 items-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-medium"
                title="Shared with the Chart of Accounts page"
              >
                <Switch
                  checked={showInactive}
                  disabled={toggleShowInactiveMutation.isPending}
                  onCheckedChange={(v) => toggleShowInactiveMutation.mutate(v)}
                  aria-label="Show off accounts"
                />
                Show off accounts
              </label>
            )}
            <Button
              variant="outline"
              className="h-10 gap-2 bg-background"
              onClick={() => refetchAccountData()}
              disabled={fetching}
              title="Refresh"
            >
              <RefreshCw className={`h-4 w-4 ${fetching ? "animate-spin" : ""}`} />
              <span className="hidden sm:inline">Refresh</span>
            </Button>
            <Button
              variant="outline"
              className="h-10 flex-1 gap-2 bg-background sm:flex-none"
              onClick={() => runExport("excel", exportToExcel)}
              disabled={exportDisabled}
            >
              {exporting === "excel" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileSpreadsheet className="h-4 w-4" />
              )}
              Excel
            </Button>
            <Button
              className="h-10 flex-1 gap-2 sm:flex-none"
              onClick={() => runExport("pdf", exportToPDF)}
              disabled={exportDisabled}
            >
              {exporting === "pdf" ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <FileText className="h-4 w-4" />
              )}
              PDF
            </Button>
          </div>
        </div>

        <div className="overflow-hidden rounded-xl border border-border bg-background">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-border p-3">
            <label className="flex h-10 min-w-0 flex-1 basis-[220px] items-center gap-2 rounded-lg border border-border px-3 text-muted-foreground focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15 sm:max-w-md">
              <Search className="h-4 w-4 flex-shrink-0" />
              <input
                ref={searchRef}
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") {
                    e.preventDefault();
                    setSearchInput("");
                  }
                }}
                placeholder="Search accounts…"
                aria-label="Search accounts"
                className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
              />
              {searchInput ? (
                <button
                  type="button"
                  onClick={() => setSearchInput("")}
                  aria-label="Clear search"
                  className="hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              ) : (
                <kbd className="hidden rounded border border-b-2 border-border px-1.5 font-mono text-[10.5px] sm:inline">
                  /
                </kbd>
              )}
            </label>
            <div className="ml-auto flex items-center gap-2">
              <span className="hidden text-xs text-muted-foreground sm:inline">
                <b className="tabular-nums text-foreground">{subCountOnPage}</b> sub-accounts on this page
              </span>
              <div className="w-[130px]">
                <ReactSelect
                  aria-label="Rows per page"
                  options={PAGE_SIZES}
                  value={
                    PAGE_SIZES.find((o) => o.value === itemsPerPage) || {
                      value: itemsPerPage,
                      label: `${itemsPerPage} / page`,
                    }
                  }
                  onChange={(o) => {
                    setItemsPerPage(o.value);
                    setCurrentPage(1);
                  }}
                  isSearchable={false}
                  menuPortalTarget={typeof document !== "undefined" ? document.body : null}
                  styles={selectStyles(false)}
                />
              </div>
            </div>
          </div>

          {isError ? (
            <ErrorState message={errText(queryError)} onRetry={() => refetchAccountData()} />
          ) : (
            <div className="overflow-x-auto md:max-h-[calc(100vh-290px)] md:min-h-[320px] md:overflow-y-auto">
              <table className="vl-grid w-full text-sm">
                <thead>
                  <tr className="text-left">
                    {[
                      { label: "BS Code", className: "w-[110px]" },
                      { label: "Balance Sheet Category" },
                      { label: "Main Account" },
                      { label: "Sub Accounts", className: "w-[150px] text-right" },
                    ].map((h) => (
                      <th
                        key={h.label}
                        className={`sticky top-0 z-10 whitespace-nowrap bg-primary px-3 py-2.5 text-[11.5px] font-bold uppercase tracking-wide text-primary-foreground ${h.className || ""}`}
                      >
                        {h.label}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {loading ? (
                    Array.from({ length: 8 }).map((_, i) => (
                      <tr key={i} className="border-b border-border/60">
                        {Array.from({ length: 4 }).map((__, j) => (
                          <td key={j} className="px-3 py-3">
                            <Skeleton className={`h-4 ${j === 0 ? "w-12" : j === 3 ? "ml-auto w-20" : "w-full max-w-[220px]"}`} />
                          </td>
                        ))}
                      </tr>
                    ))
                  ) : accountData.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="px-3 py-14 text-center">
                        <Database className="mx-auto mb-3 h-10 w-10 text-primary/30" />
                        <p className="font-semibold text-foreground">
                          {search ? "Nothing matches your search" : "No accounts to show"}
                        </p>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {search ? "Try another word, or press Esc in the search box." : "There are no account records yet."}
                        </p>
                      </td>
                    </tr>
                  ) : (
                    accountData.map((item, index) => {
                      const balanceSheetCode = item?.balanceSheetCode || "";
                      const balanceSheetCategory = item?.balanceSheetCategory || "";
                      const mainAccounts = item?.mainAccounts || "";
                      const subAccounts = Array.isArray(item?.subAccounts) ? item.subAccounts : [];
                      const main = splitCode(mainAccounts);

                      return (
                        <tr
                          key={`${index}-${balanceSheetCode}`}
                          className={`border-b border-border/60 transition-colors hover:bg-primary/[0.03] ${fetching ? "opacity-60" : ""}`}
                        >
                          <td data-label="BS Code" className="px-3 py-2.5">
                            {balanceSheetCode ? (
                              <span className="rounded bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums text-primary">
                                {balanceSheetCode}
                              </span>
                            ) : (
                              <span className="text-muted-foreground">—</span>
                            )}
                          </td>
                          <td data-label="Category" className="max-w-[320px] px-3 py-2.5">
                            <span className="block truncate text-foreground/90" title={balanceSheetCategory}>
                              {balanceSheetCategory || <span className="text-muted-foreground">—</span>}
                            </span>
                          </td>
                          <td data-label="Main Account" className="px-3 py-2.5 max-md:col-span-2">
                            <span className="flex min-w-0 items-center gap-2">
                              {main.code && (
                                <span className="flex-shrink-0 rounded bg-primary/10 px-1.5 py-0.5 font-mono text-xs font-bold tabular-nums text-primary">
                                  {main.code}
                                </span>
                              )}
                              <span className="truncate font-semibold text-foreground" title={main.name}>
                                {main.name || <span className="font-normal text-muted-foreground">—</span>}
                              </span>
                            </span>
                          </td>
                          <td className="vl-actions whitespace-nowrap px-3 py-1.5 text-right">
                            {subAccounts.length > 0 ? (
                              <button
                                type="button"
                                onClick={() =>
                                  openSubAccountsModal(subAccounts, mainAccounts, balanceSheetCategory)
                                }
                                className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-primary/25 bg-primary/5 px-2.5 text-xs font-semibold text-primary hover:bg-primary hover:text-primary-foreground"
                              >
                                <Eye className="h-3.5 w-3.5" />
                                View
                                <span className="rounded-full bg-primary/10 px-1.5 tabular-nums">{subAccounts.length}</span>
                              </button>
                            ) : (
                              <span className="inline-flex items-center rounded-full bg-muted px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                                No sub-accounts
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
                {!loading && accountData.length > 0 && (
                  <tfoot className="hidden md:table-footer-group">
                    <tr className="border-t-2 border-primary/20 bg-primary/5 font-semibold">
                      <td colSpan={3} className="px-3 py-2.5 text-primary">
                        Page total · {accountData.length} main account{accountData.length === 1 ? "" : "s"}
                      </td>
                      <td className="px-3 py-2.5 text-right tabular-nums text-primary">
                        {subCountOnPage} sub-account{subCountOnPage === 1 ? "" : "s"}
                      </td>
                    </tr>
                  </tfoot>
                )}
              </table>
            </div>
          )}

          {/* Paging */}
          {!isError && totalItems > 0 && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t border-border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
              <span>
                {firstRow}–{lastRow} of <b className="text-foreground">{totalItems}</b>
              </span>
              {pageCount > 1 && (
                <div className="flex flex-wrap items-center gap-1">
                  <button
                    type="button"
                    onClick={() => handlePageChange(currentPage - 1)}
                    disabled={currentPage <= 1 || loading}
                    aria-label="Previous page"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background hover:border-primary hover:text-primary disabled:opacity-40"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  {pageWindow[0] > 1 && (
                    <>
                      <PageButton page={1} current={currentPage} onClick={handlePageChange} />
                      {pageWindow[0] > 2 && <span className="px-1">…</span>}
                    </>
                  )}
                  {pageWindow.map((p) => (
                    <PageButton key={p} page={p} current={currentPage} onClick={handlePageChange} />
                  ))}
                  {pageWindow[pageWindow.length - 1] < pageCount && (
                    <>
                      {pageWindow[pageWindow.length - 1] < pageCount - 1 && <span className="px-1">…</span>}
                      <PageButton page={pageCount} current={currentPage} onClick={handlePageChange} />
                    </>
                  )}
                  <button
                    type="button"
                    onClick={() => handlePageChange(currentPage + 1)}
                    disabled={currentPage >= pageCount || loading}
                    aria-label="Next page"
                    className="flex h-8 w-8 items-center justify-center rounded-lg border border-border bg-background hover:border-primary hover:text-primary disabled:opacity-40"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Sub accounts of one main account */}
      <Dialog open={isModalOpen} onOpenChange={setIsModalOpen}>
        <DialogContent className="flex max-h-[85vh] w-[calc(100vw-24px)] max-w-2xl flex-col gap-0 overflow-hidden rounded-xl p-0">
          <DialogHeader className="space-y-1 border-b border-primary/15 bg-primary/5 px-5 py-4 pr-14 text-left">
            <DialogTitle className="text-lg font-bold text-primary">Sub Accounts</DialogTitle>
            {selectedSubAccounts && (
              <DialogDescription asChild>
                <div className="flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
                  {selectedSubAccounts.category && <span>{selectedSubAccounts.category}</span>}
                  {selectedSubAccounts.category && <ChevronRight className="h-3.5 w-3.5" />}
                  <span className="flex min-w-0 items-center gap-1.5">
                    {mainParts.code && (
                      <span className="rounded bg-primary/10 px-1.5 font-mono text-xs font-bold text-primary">
                        {mainParts.code}
                      </span>
                    )}
                    <span className="font-semibold text-foreground">{mainParts.name}</span>
                  </span>
                  <span className="inline-flex h-5 items-center rounded-full bg-primary/10 px-2 text-xs font-bold tabular-nums text-primary">
                    {selectedSubAccounts.subAccounts.length}
                  </span>
                </div>
              </DialogDescription>
            )}
          </DialogHeader>

          {selectedSubAccounts && selectedSubAccounts.subAccounts.length > 8 && (
            <div className="border-b border-border px-5 py-3">
              <label className="flex h-9 items-center gap-2 rounded-lg border border-border px-3 text-muted-foreground focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/15">
                <Search className="h-4 w-4 flex-shrink-0" />
                <input
                  value={subFilter}
                  onChange={(e) => setSubFilter(e.target.value)}
                  placeholder="Filter sub accounts…"
                  aria-label="Filter sub accounts"
                  className="min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
                />
              </label>
            </div>
          )}

          <div className="min-h-0 flex-1 overflow-y-auto">
            {subList.length === 0 ? (
              <p className="px-5 py-10 text-center text-sm text-muted-foreground">No sub account matches.</p>
            ) : (
              <ul className="divide-y divide-border/60">
                {subList.map((s, idx) => (
                  <li key={`${s.code}-${idx}`} className="flex items-center gap-3 px-5 py-2.5 hover:bg-primary/[0.03]">
                    <span className="min-w-[44px] flex-shrink-0 rounded bg-primary/10 px-1.5 py-0.5 text-center font-mono text-xs font-bold tabular-nums text-primary">
                      {s.code || "—"}
                    </span>
                    <span className="min-w-0 break-words text-sm font-medium text-foreground">{s.name}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="flex justify-end border-t border-border bg-muted/40 px-5 py-3">
            <Button variant="outline" className="h-10 bg-background" onClick={() => setIsModalOpen(false)}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
};

const PAGE_SIZES = [30, 40, 50, 60, 70].map((n) => ({ value: n, label: `${n} / page` }));

const errText = (error) =>
  error?.response?.data?.message || error?.response?.data?.error || error?.message || "Failed to load account data";

// "6 DEPRICABLE FIXED ASSETS" → { code: "6", name: "DEPRICABLE FIXED ASSETS" }.
// Display only — the exports keep their own extractNumber / extractText.
const splitCode = (text) => {
  const s = text == null ? "" : String(text);
  const m = s.match(/^(\d+)\s*(.*)$/);
  return m ? { code: m[1], name: m[2] } : { code: "", name: s };
};

const PageButton = ({ page, current, onClick }) => (
  <button
    type="button"
    onClick={() => onClick(page)}
    aria-current={page === current ? "page" : undefined}
    className={`h-8 min-w-[32px] rounded-lg border px-2 text-[13px] font-semibold tabular-nums ${
      page === current
        ? "border-primary bg-primary text-primary-foreground"
        : "border-border bg-background text-foreground hover:border-primary hover:text-primary"
    }`}
  >
    {page}
  </button>
);

const ErrorState = ({ message, onRetry }) => (
  <div className="flex flex-col items-center justify-center px-4 py-14 text-center">
    <span className="mb-3 flex h-12 w-12 items-center justify-center rounded-full bg-destructive/10 text-destructive">
      <AlertCircle className="h-6 w-6" />
    </span>
    <p className="font-semibold text-foreground">Could not load the accounts</p>
    <p className="mt-1 max-w-md text-sm text-muted-foreground">{message}</p>
    <Button variant="outline" className="mt-4 h-10 gap-2 bg-background" onClick={onRetry}>
      <RefreshCw className="h-4 w-4" />
      Try again
    </Button>
  </div>
);

export default ChartOfAccountsView;
