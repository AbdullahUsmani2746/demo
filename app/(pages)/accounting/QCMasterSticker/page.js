"use client";
// Printing → QC Master Sticker. Left: the date range to pull batches from the
// Quality Master. Right: the A4 sheets (18 stickers each) exactly as they
// print. Print prints only the .sticker-print-only copy.
import React, { useState } from "react";
import axios from "axios";
import { Printer, FileText, Search, Loader2, CalendarRange, Layers, StickyNote, AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { LabCard, LabEmpty, LabHeader, LabStat } from "@/components/Material/shared/LabUI";

const STICKERS_PER_PAGE = 18;
const COLS = 3;
const ROWS = 6;

const formatDate = (dateString) => {
  if (!dateString) return "";
  const date = new Date(dateString);
  return date.toLocaleDateString("en-GB");
};

const StickerField = ({ label, value }) => (
  <div className="sticker-field">
    <span className="sticker-field-label">{label}</span>
    <span className="sticker-field-value">{value || " "}</span>
  </div>
);

const StickerLabel = ({ sticker }) => (
  <div className="sticker-box">
    <StickerField label="INK CODE:" value={sticker.inkCode} />
    <StickerField label="DESCRIPTION:" value={sticker.description} />
    <StickerField label="BATCH NO." value={sticker.batchNo} />
    <StickerField label="DATE:" value={formatDate(sticker.date)} />
    <StickerField label="RETAINED BY:" value="" />
  </div>
);

const StickerPage = ({ pageStickers, pageIdx, totalPages }) => {
  const slots = Array.from({ length: STICKERS_PER_PAGE }, (_, i) =>
    pageStickers[i] || null,
  );

  return (
    <div
      className="sticker-page"
      style={{ pageBreakAfter: pageIdx < totalPages - 1 ? "always" : "auto" }}
    >
      <div className="sticker-grid">
        {slots.map((sticker, idx) => (
          <div key={idx} className="sticker-cell">
            {sticker && <StickerLabel sticker={sticker} />}
          </div>
        ))}
      </div>
    </div>
  );
};

const QCMasterSticker = () => {
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [stickers, setStickers] = useState([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [searched, setSearched] = useState(false);

  const fetchStickers = async () => {
    if (!dateFrom || !dateTo) {
      setError("Please select both Date From and Date To.");
      return;
    }

    if (new Date(dateFrom) > new Date(dateTo)) {
      setError("Date From cannot be after Date To.");
      return;
    }

    setLoading(true);
    setError("");
    setSearched(true);

    try {
      const response = await axios.get("/api/forms/qualitycontrol/stickers", {
        params: { dateFrom, dateTo },
      });
      setStickers(response.data.data || []);
    } catch (err) {
      setStickers([]);
      setError(
        err.response?.data?.error || "Failed to fetch QC master stickers.",
      );
    } finally {
      setLoading(false);
    }
  };

  const handlePrint = () => {
    if (stickers.length === 0) return;
    window.print();
  };

  const pages = [];
  for (let i = 0; i < stickers.length; i += STICKERS_PER_PAGE) {
    pages.push(stickers.slice(i, i + STICKERS_PER_PAGE));
  }

  return (
    <div className="qc-sticker-root min-h-screen bg-muted/40">
      {/* Screen */}
      <div className="print:hidden mx-auto max-w-[1600px] px-3 py-5 sm:px-6">
        <LabHeader
          icon={StickyNote}
          breadcrumb="Printing"
          title="QC Master Sticker"
          subtitle="Print QC stickers by date range from Quality Master"
          className="mb-4"
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[minmax(280px,360px)_minmax(0,1fr)]">
          {/* Left - setup */}
          <div className="space-y-4">
            <LabCard title="Date range" subtitle="Batches entered in QC Master" icon={CalendarRange} bodyClassName="space-y-3 p-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-1">
                <div className="space-y-1.5">
                  <Label htmlFor="qc-date-from" className="text-[13px]">Date From</Label>
                  <Input
                    id="qc-date-from"
                    type="date"
                    value={dateFrom}
                    onChange={(e) => setDateFrom(e.target.value)}
                  />
                </div>

                <div className="space-y-1.5">
                  <Label htmlFor="qc-date-to" className="text-[13px]">Date To</Label>
                  <Input
                    id="qc-date-to"
                    type="date"
                    value={dateTo}
                    onChange={(e) => setDateTo(e.target.value)}
                  />
                </div>
              </div>

              <Button onClick={fetchStickers} disabled={loading} variant="outline" className="w-full">
                {loading ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Search className="mr-2 h-4 w-4" />
                )}
                Search Batches
              </Button>

              {error && (
                <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-2.5 text-sm text-destructive">
                  <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
                  <span>{error}</span>
                </div>
              )}
            </LabCard>

            {stickers.length > 0 && (
              <div className="grid grid-cols-2 gap-3">
                <LabStat label="Batches" value={stickers.length} icon={Layers} />
                <LabStat label="Pages" value={pages.length} hint={`${STICKERS_PER_PAGE} stickers per page`} icon={FileText} />
              </div>
            )}
          </div>

          {/* Right - preview */}
          <LabCard
            title="Preview"
            subtitle="A4 portrait · as it prints"
            icon={Printer}
            className="min-w-0"
          >
            {loading ? (
              <div className="flex flex-col items-center gap-3 bg-muted/50 p-6" aria-busy="true">
                <div className="aspect-[210/297] w-full max-w-[420px] animate-pulse rounded-sm bg-background" />
              </div>
            ) : stickers.length > 0 ? (
              // Sticker Preview — always visible when data exists; scrolls sideways
              // inside the card on a narrow screen.
              <div className="sticker-print-area max-h-[calc(100vh-220px)] overflow-auto bg-muted/50 p-3 sm:p-5">
                <div className="flex w-max min-w-full flex-col items-center gap-6">
                  {pages.map((pageStickers, pageIdx) => (
                    <div key={pageIdx} className="space-y-1.5">
                      <p className="text-xs font-medium text-muted-foreground">
                        Page {pageIdx + 1} of {pages.length}
                      </p>
                      <div className="sticker-page-wrapper shadow-md ring-1 ring-border">
                        <StickerPage
                          pageStickers={pageStickers}
                          pageIdx={pageIdx}
                          totalPages={pages.length}
                        />
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            ) : (
              <LabEmpty
                icon={StickyNote}
                title={searched && !error ? "No batches found" : "Nothing to preview yet"}
                hint={
                  searched && !error
                    ? "No batches found in QC Master for the selected date range."
                    : "Pick a date range and press Search Batches."
                }
              />
            )}
          </LabCard>
        </div>

        {/* Action bar */}
        <div className="sticky bottom-0 z-10 -mx-3 mt-4 border-t border-border bg-background/95 px-3 py-3 backdrop-blur supports-[backdrop-filter]:bg-background/80 sm:-mx-6 sm:px-6">
          <div className="flex flex-wrap items-center gap-2 max-sm:[&>button]:flex-1">
            <p className="mr-auto hidden text-sm text-muted-foreground sm:block">
              {stickers.length > 0 ? (
                <>
                  <span className="font-semibold text-foreground">{stickers.length}</span> batch
                  {stickers.length !== 1 ? "es" : ""} on <span className="font-semibold text-foreground">{pages.length}</span> page
                  {pages.length !== 1 ? "s" : ""}
                </>
              ) : (
                "Search a date range to print stickers"
              )}
            </p>
            <Button onClick={handlePrint} disabled={stickers.length === 0 || loading}>
              <Printer className="mr-2 h-4 w-4" />
              Print Stickers ({stickers.length})
            </Button>
          </div>
        </div>
      </div>

      {/* Print-only copy — visibility trick ensures clean output */}
      {stickers.length > 0 && (
        <div className="sticker-print-only hidden print:block">
          {pages.map((pageStickers, pageIdx) => (
            <StickerPage
              key={`print-${pageIdx}`}
              pageStickers={pageStickers}
              pageIdx={pageIdx}
              totalPages={pages.length}
            />
          ))}
        </div>
      )}

      <style jsx global>{`
        .qc-sticker-root .sticker-page {
          width: 210mm;
          height: 297mm;
          padding: 8mm 10mm;
          box-sizing: border-box;
          background: #fff;
        }

        .qc-sticker-root .sticker-grid {
          display: grid;
          grid-template-columns: repeat(${COLS}, 1fr);
          grid-template-rows: repeat(${ROWS}, 1fr);
          gap: 2mm 3mm;
          width: 100%;
          height: 100%;
        }

        .qc-sticker-root .sticker-cell {
          min-height: 0;
        }

        .qc-sticker-root .sticker-box {
          border: 0.5mm solid #000;
          padding: 1.5mm 2.5mm;
          box-sizing: border-box;
          height: 100%;
          display: flex;
          flex-direction: column;
          justify-content: space-evenly;
          font-family: Arial, Helvetica, sans-serif;
          color: #000;
          background: #fff;
        }

        .qc-sticker-root .sticker-field {
          display: flex;
          align-items: flex-start;
          gap: 1.5mm;
        }

        .qc-sticker-root .sticker-field-label {
          font-size: 6.5pt;
          font-weight: 700;
          white-space: nowrap;
          text-transform: uppercase;
          letter-spacing: 0.02em;
          flex-shrink: 0;
          margin-top: 1px;
        }

        .qc-sticker-root .sticker-field-value {
          flex: 1;
          border-bottom: 0.35mm solid #000;
          font-size: 6.5pt;
          font-weight: 600;
          min-height: 3mm;
          padding-bottom: 0.2mm;
          overflow: hidden;
          white-space: normal;
          word-break: break-word;
          line-height: 1.1;
        }

        .qc-sticker-root .sticker-page-wrapper {
          background: #fff;
          overflow: hidden;
        }

        @media print {
          @page {
            size: A4 portrait;
            margin: 0;
          }

          html,
          body {
            margin: 0 !important;
            padding: 0 !important;
            background: #fff !important;
            print-color-adjust: exact;
            -webkit-print-color-adjust: exact;
          }

          body * {
            visibility: hidden;
          }

          .sticker-print-only,
          .sticker-print-only * {
            visibility: visible;
          }

          .sticker-print-only {
            position: absolute;
            left: 0;
            top: 0;
            width: 100%;
          }

          .print\\:hidden {
            display: none !important;
          }

          .qc-sticker-root .sticker-print-area {
            display: none !important;
          }

          .qc-sticker-root {
            background: #fff !important;
            min-height: auto !important;
          }

          .qc-sticker-root .sticker-page {
            margin: 0;
            box-shadow: none;
          }
        }
      `}</style>
    </div>
  );
};

export default QCMasterSticker;
