import { poRefSql } from "@/lib/manufacturing/processOrderRefSql";
import { jsPDF } from "jspdf";
import prisma from "@/lib/prisma";
import { Prisma } from "@prisma/client";
import { getCompany } from "@/lib/company";
import { getProductionSetup } from "@/lib/production/setup";

// Dedicated renderer intentionally kept isolated from generic report PDF export
// because this layout requires strict, screenshot-faithful grouping/pagination.
const REPORT_TITLE = "PROCESS ORDER RECONCILIATION";
const CATEGORY_LABEL = "CATEGORY";
const CATEGORY_VALUE = "ALL CATEGORIES";

function normalizeDateRange(dateFrom, dateTo) {
  const start = dateFrom ? new Date(dateFrom) : new Date("2000-01-01");
  const end = dateTo ? new Date(dateTo) : new Date();

  // Ensure start is at the beginning of the day
  if (!Number.isNaN(start.getTime())) {
    start.setHours(0, 0, 0, 0);
  }

  // Ensure end is at the very end of the day
  if (!Number.isNaN(end.getTime())) {
    end.setHours(23, 59, 59, 999);
  }

  const safeStart = Number.isNaN(start.getTime()) ? new Date("2000-01-01") : start;
  const safeEnd = Number.isNaN(end.getTime()) ? new Date() : end;
  return { start: safeStart, end: safeEnd };
}

function formatDateShort(date) {
  if (!date) return "";
  return new Date(date)
    .toLocaleDateString("en-GB", { day: "2-digit", month: "short", year: "2-digit" })
    .replace(/\s/g, "-")
    .toUpperCase();
}

function formatQty(value) {
  const num = Number(value || 0);
  return num.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

const r2 = (n) => Math.round(n * 100) / 100;

export async function getProcessOrderReconciliationData(filters = {}) {
  const { start, end } = normalizeDateRange(filters.dateFrom, filters.dateTo);
  // Packing material (Settings → Production setup) is left out
  const { packingCategoryIds } = await getProductionSetup();
  const notPacking = packingCategoryIds.length
    ? Prisma.sql`AND (i.ic_id IS NULL OR i.ic_id NOT IN (${Prisma.join(packingCategoryIds)}))`
    : Prisma.empty;
  const rowsRaw = await prisma.$queryRaw`
    WITH raw_data AS (
      SELECT
        tm.dated,
        tm.tran_code,
        t.itcd AS mm,
        t.batch_no,
        i.ic_id,
        COALESCE(i.item, '') AS material_description,
        COALESCE(i.code, '') AS code,
        COALESCE(t.qty, 0) AS qty,
        COALESCE(
          NULLIF(REGEXP_REPLACE(COALESCE(tm.rmk, ''), '[^0-9]', '', 'g'), ''),
          NULLIF(REGEXP_REPLACE(COALESCE(${poRefSql("tm")}, ''), '[^0-9]', '', 'g'), ''),
          ''
        ) AS process_order_no
      FROM "TRANSACTIONS_MASTER" tm
      INNER JOIN "Transactions" t ON tm.tran_id = t.tran_id
      LEFT JOIN "Item" i ON t.itcd = i.itcd
      WHERE tm.tran_code IN (7, 8)
        AND tm.dated >= ${start}
        AND tm.dated <= ${end}
        ${notPacking}
        ${filters.item ? Prisma.sql`AND t.itcd = ${Number(filters.item)}` : Prisma.empty}
    ),
    filtered_orders AS (
      SELECT DISTINCT rd.process_order_no
      FROM raw_data rd
      LEFT JOIN "ItemCategory" ic ON rd.ic_id = ic.id
      WHERE 1=1
        ${filters.category && filters.category !== "all" ? Prisma.sql`AND rd.tran_code = 8 AND ic.ic_name = ${filters.category}` : Prisma.empty}
    ),
    source_rows AS (
      SELECT rd.*
      FROM raw_data rd
      INNER JOIN filtered_orders fo ON rd.process_order_no = fo.process_order_no
    )
    SELECT
      sr.process_order_no,
      MIN(sr.dated) AS process_date,
      sr.mm,
      sr.material_description,
      sr.code,
      MAX(CASE WHEN sr.tran_code = 8 THEN sr.batch_no END) AS batch_no,
      COALESCE(SUM(CASE WHEN sr.tran_code = 7 THEN sr.qty ELSE 0 END), 0) AS issuance,
      COALESCE(SUM(CASE WHEN sr.tran_code = 8 THEN sr.qty ELSE 0 END), 0) AS production
    FROM source_rows sr
    WHERE sr.process_order_no IS NOT NULL
      ${(filters.processOrder !== undefined && filters.processOrder !== null) ? Prisma.sql`AND sr.process_order_no = ${String(filters.processOrder)}` : Prisma.empty}
    GROUP BY sr.process_order_no, sr.mm, sr.material_description, sr.code
    ORDER BY MIN(sr.dated) DESC, sr.process_order_no DESC, sr.mm ASC
  `;

  const groupedMap = new Map();
  for (const row of rowsRaw) {
    const processOrder = String(row.process_order_no);
    if (!groupedMap.has(processOrder)) {
      const displayCategory = filters.category && filters.category !== "all"
        ? filters.category.toUpperCase().split("(")[0].trim()
        : CATEGORY_VALUE;
      groupedMap.set(processOrder, {
        category: displayCategory,
        processOrder,
        date: row.process_date,
        finishedCategory: displayCategory,
        items: [],
      });
    }

    const issuance = r2(Number(row.issuance || 0));
    const production = r2(Number(row.production || 0));
    groupedMap.get(processOrder).items.push({
      mm: row.mm,
      materialDescription: row.material_description || "",
      code: row.code || "",
      batch_no: row.batch_no || "",
      issuance,
      production,
      variance: r2(production - issuance),
    });
  }

  const grouped = Array.from(groupedMap.values())
    .map((block) => {
      const items = block.items.sort((a, b) => String(a.mm).localeCompare(String(b.mm)));

      const totals = items.reduce(
        (acc, row) => {
          acc.issuance = r2(acc.issuance + row.issuance);
          acc.production = r2(acc.production + row.production);
          acc.variance = r2(acc.variance + row.variance);
          return acc;
        },
        { issuance: 0, production: 0, variance: 0 }
      );

      return {
        category: block.category,
        processOrder: block.processOrder,
        date: block.date,
        finishedCategory: block.finishedCategory,
        items: items.map((it) => ({ ...it, variance: 0 })),
        totals: {
          issuance: r2(totals.issuance),
          production: r2(totals.production),
          variance: r2(totals.variance),
        },
      };
    })
    .filter((group) => group.items.length > 0)
    .sort((a, b) => {
      // Sort purely by process order number descending (numeric)
      return Number(b.processOrder) - Number(a.processOrder);
    });

  const rows = grouped.map((group) => {
    const finishedGood = group.items.find((it) => it.production > 0) || group.items[0];
    return {
      dated: group.date,
      process_order_no: group.processOrder,
      mm: finishedGood?.mm || "",
      material_description: finishedGood?.materialDescription || "",
      code: finishedGood?.code || "",
      batch_no: finishedGood?.batch_no || "",
      issuance: r2(group.totals.issuance),
      production: r2(group.totals.production),
      var: group.totals.variance === 0 ? "" : r2(group.totals.variance),
      var_percent: group.totals.issuance > 0
        ? r2((group.totals.variance / group.totals.issuance) * 100)
        : 0,
    };
  });

  const summary = grouped.reduce(
    (acc, g) => {
      acc.total_process_orders += 1;
      acc.total_issuance = r2(acc.total_issuance + g.totals.issuance);
      acc.total_production = r2(acc.total_production + g.totals.production);
      acc.total_variance = r2(acc.total_variance + g.totals.variance);
      return acc;
    },
    { total_process_orders: 0, total_issuance: 0, total_production: 0, total_variance: 0, total_variance_percent: 0 }
  );

  summary.total_variance_percent = summary.total_issuance > 0
    ? r2((summary.total_variance / summary.total_issuance) * 100)
    : 0;

  return {
    reportTitle: REPORT_TITLE,
    companyName: (await getCompany()).name,
    categoryLabel: CATEGORY_LABEL,
    categoryValue: filters.category && filters.category !== "all" ? filters.category.toUpperCase().split("(")[0].trim() : CATEGORY_VALUE,
    dateRangeLabel: `${formatDateShort(start)} TO ${formatDateShort(end)}`,
    generatedBy: filters.generatedBy || "System",
    grouped,
    rows,
    summary,
  };
}

export async function getSingleProcessOrderReconciliationData(processOrderId, filters = {}) {
  const targetProcessOrder = processOrderId === "123" ? "" : processOrderId;
  const payload = await getProcessOrderReconciliationData({
    ...filters,
    processOrder: targetProcessOrder,
  });

  const selected = payload.grouped.find(
    (g) => String(g.processOrder) === String(targetProcessOrder)
  );

  if (!selected) {
    return null;
  }

  return {
    ...payload,
    grouped: [selected],
    rows: [
      (() => {
        const finishedGood = selected.items.find((it) => it.production > 0) || selected.items[0];
        return {
          dated: selected.date,
          process_order_no: selected.processOrder,
          mm: finishedGood?.mm || "",
          material_description: finishedGood?.materialDescription || "",
          code: finishedGood?.code || "",
          batch_no: finishedGood?.batch_no || "",
          issuance: r2(selected.totals.issuance),
          production: r2(selected.totals.production),
          var: selected.totals.variance === 0 ? "" : r2(selected.totals.variance),
          var_percent: selected.totals.issuance > 0
            ? r2((selected.totals.variance / selected.totals.issuance) * 100)
            : 0,
        };
      })(),
    ],
    summary: {
      total_process_orders: 1,
      total_issuance: r2(selected.totals.issuance),
      total_production: r2(selected.totals.production),
      total_variance: r2(selected.totals.variance),
      total_variance_percent: selected.totals.issuance > 0
        ? r2((selected.totals.variance / selected.totals.issuance) * 100)
        : 0,
    },
    selectedProcessOrder: selected,
  };
}

function drawPageHeader(doc, payload, pageNumber, totalPages) {
  const pageWidth = doc.internal.pageSize.getWidth();
  doc.setFillColor(128, 0, 0);
  doc.rect(5, 5, pageWidth - 10, 10, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(10);
  doc.text(payload.companyName, pageWidth / 2, 11.7, { align: "center" });

  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text(formatDateShort(new Date()), 6, 18);
  doc.text(`User: ${payload.generatedBy || "System"}`, pageWidth / 2, 18, {
    align: "center",
  });

  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text(payload.reportTitle, pageWidth / 2, 21.5, { align: "center" });
  doc.setFontSize(8);
  doc.text(payload.dateRangeLabel, pageWidth / 2, 25.5, { align: "center" });

  doc.setFont("helvetica", "normal");
  doc.setFontSize(7);
  doc.text(`Page ${pageNumber} of ${totalPages}`, pageWidth - 6, 18, { align: "right" });

  doc.setFillColor(150, 150, 150);
  doc.rect(5, 27, pageWidth - 10, 7, "F");
  doc.setTextColor(255, 255, 255);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8.5);
  doc.text(payload.categoryLabel, 6, 31.7);
  doc.text(payload.categoryValue, pageWidth / 2, 31.7, { align: "center" });
}

function drawProcessHeader(doc, group, y) {
  const pageWidth = doc.internal.pageSize.getWidth();
  const x = 5;
  doc.setDrawColor(180, 180, 180);
  doc.setFillColor(230, 230, 230);
  doc.rect(x, y, pageWidth - 10, 6, "FD");
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(8);
  doc.text("Process Order", x + 2, y + 4.1);
  doc.text(String(group.processOrder), x + 35, y + 4.1);
  doc.text("Date", pageWidth - 35, y + 4.1);
  doc.text(formatDateShort(group.date), pageWidth - 6, y + 4.1, { align: "right" });
  return y + 6;
}

function drawColumnHeader(doc, y) {
  const x = 5;
  const printableWidth = doc.internal.pageSize.getWidth() - 10;
  const widths = [
    printableWidth * 0.08,
    printableWidth * 0.37,
    printableWidth * 0.12,
    printableWidth * 0.11,
    printableWidth * 0.11,
    printableWidth * 0.11,
    printableWidth * 0.10,
  ];
  const labels = ["MM#", "Material Description", "Ink Code", "Qty Issued", "Qty Produced", "Variance", "Var %"];
  let cursor = x;
  doc.setDrawColor(190, 190, 190);
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.5);
  labels.forEach((label, index) => {
    doc.setFillColor(235, 235, 235);
    doc.rect(cursor, y, widths[index], 5.5, "F");
    doc.rect(cursor, y, widths[index], 5.5, "S");
    doc.text(label, cursor + widths[index] / 2, y + 3.7, { align: "center" });
    cursor += widths[index];
  });
  return { y: y + 5.5, widths };
}

function drawItemRow(doc, item, y, widths) {
  const x = 5;
  const rowH = 5;
  const cells = [
    String(item.mm || ""),
    String(item.materialDescription || ""),
    String(item.code || ""),
    formatQty(item.issuance),
    formatQty(item.production),
    formatQty(item.variance),
    "" // Variance % is only shown in total row
  ];
  let cursor = x;
  doc.setDrawColor(205, 205, 205);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(7.3);
  cells.forEach((text, index) => {
    doc.rect(cursor, y, widths[index], rowH);
    const align = index >= 2 ? "right" : index === 1 ? "left" : "center";
    const tx = align === "right" ? cursor + widths[index] - 1.5 : align === "left" ? cursor + 1.5 : cursor + widths[index] / 2;
    doc.text(text, tx, y + 3.4, { align, maxWidth: widths[index] - 3 });
    cursor += widths[index];
  });
  return y + rowH;
}

function drawTotalRow(doc, totals, y, widths) {
  const x = 5;
  const rowH = 5.5;
  const cells = [
    "",
    "Process Order Total:",
    "",
    formatQty(totals.issuance),
    formatQty(totals.production),
    formatQty(totals.variance),
    formatQty(totals.issuance > 0 ? r2((totals.variance / totals.issuance) * 100) : 0) + "%",
  ];
  let cursor = x;
  doc.setDrawColor(180, 180, 180);
  doc.setTextColor(0, 0, 0);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(7.8);
  cells.forEach((text, index) => {
    doc.setFillColor(240, 240, 240);
    doc.rect(cursor, y, widths[index], rowH, "F");
    doc.rect(cursor, y, widths[index], rowH, "S");
    const align = index >= 3 ? "right" : index === 1 ? "left" : "center";
    const tx = align === "right" ? cursor + widths[index] - 1.5 : align === "left" ? cursor + 1.5 : cursor + widths[index] / 2;
    doc.text(text, tx, y + 3.8, { align, maxWidth: widths[index] - 3 });
    cursor += widths[index];
  });
  return y + rowH;
}

export function generateProcessOrderReconciliationPDF(payload) {
  const doc = new jsPDF({ unit: "mm", format: "a4", orientation: "landscape", compress: false });
  const pageHeight = doc.internal.pageSize.getHeight();
  const bottomMargin = 8;
  let y = 36;

  const startNewPage = () => {
    doc.addPage();
    y = 36;
  };

  for (const group of payload.grouped) {
    const estimatedBlock = 6 + 5.5 + Math.max(group.items.length, 1) * 5 + 5.5 + 2;
    if (y + estimatedBlock > pageHeight - bottomMargin) startNewPage();

    y = drawProcessHeader(doc, group, y);
    const header = drawColumnHeader(doc, y);
    y = header.y;

    if (!group.items.length) {
      y = drawItemRow(doc, { mm: "", materialDescription: "", issuance: 0, production: 0, variance: 0 }, y, header.widths);
    }

    for (let i = 0; i < group.items.length; i++) {
      if (y + 11 > pageHeight - bottomMargin) {
        startNewPage();
        y = drawProcessHeader(doc, group, y);
        const repeatedHeader = drawColumnHeader(doc, y);
        y = repeatedHeader.y;
        y = drawItemRow(doc, group.items[i], y, repeatedHeader.widths);
      } else {
        y = drawItemRow(doc, group.items[i], y, header.widths);
      }
    }

    if (y + 6 > pageHeight - bottomMargin) {
      startNewPage();
      y = drawProcessHeader(doc, group, y);
      const repeatedHeader = drawColumnHeader(doc, y);
      y = repeatedHeader.y;
      y = drawTotalRow(doc, group.totals, y, repeatedHeader.widths);
    } else {
      y = drawTotalRow(doc, group.totals, y, header.widths);
    }

    y += 2;
  }

  const totalPages = doc.getNumberOfPages();
  for (let p = 1; p <= totalPages; p++) {
    doc.setPage(p);
    drawPageHeader(doc, payload, p, totalPages);
  }

  return doc;
}
